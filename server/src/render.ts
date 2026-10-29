/** Export job (SPEC §6.4 "On export"). One render at a time. */
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { keepRanges, type Clip, type ExportOptions, type Preset, type RenderState } from '@vto/shared';
import { describeEncoder, SOFTWARE, type Encoder, type Encoders } from './encoders.ts';
import { assembleArgs, segmentArgs, type Fonts } from './ffmpeg-args.ts';
import { CancelledError, measureLoudness, run } from './ffmpeg.ts';
import { originalPath } from './ingest.ts';
import { buildPlan, type Loudness } from './plan.ts';
import type { SessionStore } from './session.ts';

export interface RendererDeps {
  store: SessionStore;
  outputDir: string;
  fonts: Fonts;
  timeZone: string;
  /** Final-encode backend per preset; software if omitted. */
  encoders?: Encoders;
}

/**
 * Share of the progress bar (and so of the ETA) per stage: loudness, segments; the join gets
 * the rest. Measured on an Apple M4 with 1080p iPhone clips: per 30 s of footage, segments
 * take ~7 s, the final x264 encode ~14 s, the x265 one ~30 s and VideoToolbox ~4 s.
 * A real 17 min VideoToolbox export split 6% / 60% / 34%.
 */
const WEIGHTS: Record<Preset | 'hardware', [number, number]> = {
  compatible: [0.04, 0.31],
  original: [0.02, 0.18],
  hardware: [0.06, 0.6],
};

/** One line per finished render, for the server log. */
export interface RenderSummary {
  state: 'done' | 'cancelled' | 'error';
  preset: Preset;
  /** Final-encode backend that produced the output; notes a fallback to software. */
  encoder: string;
  clips: number;
  /** Output duration, seconds. */
  duration: number;
  /** Wall-clock seconds per stage. */
  seconds: { loudness: number; segments: number; join: number; total: number };
}

export class Renderer extends EventEmitter<{ change: []; finished: [RenderSummary] }> {
  state: RenderState = { state: 'idle' };
  /** Final-encode backend per preset. */
  encoders: Encoders;
  private abort: AbortController | null = null;
  private job: Promise<void> | null = null;

  constructor(private readonly deps: RendererDeps) {
    super();
    this.encoders = deps.encoders ?? SOFTWARE;
  }

  get running() {
    return this.state.state === 'running';
  }

  /** Starts a render; throws if one is running or there is nothing to export. */
  start(options: ExportOptions): void {
    if (this.running) throw new Error('a render is already running');
    // A copy, so edits made while rendering don't change this render.
    const clips = structuredClone(this.deps.store.ordered().filter((c) => c.status === 'ready' && c.media));
    if (clips.length === 0) throw new Error('no clips to export');
    this.abort = new AbortController();
    this.set({ state: 'running', progress: 0, etaSec: null, step: 'Measuring loudness' });
    this.job = this.execute(clips, options, this.abort.signal);
  }

  cancel(): boolean {
    if (!this.running || !this.abort) return false;
    this.abort.abort();
    return true;
  }

  /** Resolves when the current render settles. */
  async settled(): Promise<void> {
    await this.job;
  }

  private async execute(clips: Clip[], options: ExportOptions, signal: AbortSignal): Promise<void> {
    const { store } = this.deps;
    const workDir = path.join(store.dir, 'render');
    const started = Date.now();
    let encoder: Encoder = this.encoders[options.preset];
    let encoderNote = describeEncoder(encoder);
    const [W_LOUDNESS, W_SEGMENTS] = WEIGHTS[encoder.kind === 'software' ? options.preset : 'hardware'];
    const marks = { loudness: started, segments: started, join: started };
    let duration = 0;
    let outFile: string | null = null;
    let final: RenderState;
    const report = (progress: number, step: string) => {
      const elapsed = (Date.now() - started) / 1000;
      const etaSec = progress > 0.03 ? Math.round((elapsed / progress) * (1 - progress)) : null;
      this.set({ state: 'running', progress: Math.min(0.999, progress), etaSec, step });
    };

    try {
      await rm(workDir, { recursive: true, force: true });
      await mkdir(workDir, { recursive: true });
      await mkdir(this.deps.outputDir, { recursive: true });

      const loudness: Record<string, Loudness> = {};
      for (const [k, clip] of clips.entries()) {
        const src = originalPath(store.clipDir(clip.id), clip.filename);
        if (clip.media!.hasAudio) loudness[clip.id] = await measureLoudness(src, keepRanges(clip.segments), signal);
        report((W_LOUDNESS * (k + 1)) / clips.length, 'Measuring loudness');
      }
      marks.loudness = marks.segments = marks.join = Date.now();

      const plan = buildPlan({
        clips,
        options,
        loudness,
        sourcePath: (c) => originalPath(store.clipDir(c.id), c.filename),
        now: new Date(),
        timeZone: this.deps.timeZone,
      });

      duration = plan.totalDuration;
      const total = plan.segments.reduce((s, x) => s + x.duration, 0);
      const intermediates: string[] = [];
      let done = 0;
      for (const [k, seg] of plan.segments.entries()) {
        const texts: { line1?: string; line2?: string } = {};
        const [t1, t2] = seg.kind === 'title' ? [seg.title, seg.subtitle] : [seg.overlay?.place, seg.overlay?.date];
        if (t1) await writeFile((texts.line1 = path.join(workDir, `${k}-1.txt`)), t1);
        if (t2) await writeFile((texts.line2 = path.join(workDir, `${k}-2.txt`)), t2);
        const out = path.join(workDir, `${k}.mkv`);
        const step = `Preparing clip ${k + 1} of ${plan.segments.length}`;
        await run('ffmpeg', segmentArgs(seg, plan, { out, fonts: this.deps.fonts, texts }), {
          signal,
          onProgress: (t) => report(W_LOUDNESS + (W_SEGMENTS * (done + Math.min(t, seg.duration))) / total, step),
        });
        done += seg.duration;
        intermediates.push(out);
        marks.segments = marks.join = Date.now();
      }

      outFile = uniquePath(path.join(this.deps.outputDir, plan.filename));
      const join = (enc: Encoder) =>
        run('ffmpeg', assembleArgs(intermediates, plan, outFile!, enc), {
          signal,
          onProgress: (t) =>
            report(W_LOUDNESS + W_SEGMENTS + (1 - W_LOUDNESS - W_SEGMENTS) * Math.min(1, t / plan.totalDuration), 'Joining clips'),
        });
      try {
        await join(encoder);
      } catch (err) {
        // A hardware encoder passed the startup test but failed on the real job: redo in software.
        if (encoder.kind === 'software' || signal.aborted) throw err;
        encoderNote = `software (${describeEncoder(encoder)} failed: ${err instanceof Error ? err.message.slice(0, 200) : err})`;
        encoder = { kind: 'software' };
        await join(encoder);
      }

      marks.join = Date.now();
      store.setLastOutput(path.basename(outFile));
      final = { state: 'done', file: path.basename(outFile) };
    } catch (err) {
      if (outFile) await rm(outFile, { force: true });
      if (err instanceof CancelledError || signal.aborted) final = { state: 'cancelled' };
      else final = { state: 'error', message: err instanceof Error ? err.message.slice(0, 500) : String(err) };
    }
    // Stay "running" until cleaned up, so a new render can't start and lose its work dir.
    await rm(workDir, { recursive: true, force: true });
    this.abort = null;
    this.set(final);
    const sec = (a: number, b: number) => Math.round((b - a) / 100) / 10;
    this.emit('finished', {
      state: final.state as RenderSummary['state'],
      preset: options.preset,
      encoder: encoderNote,
      clips: clips.length,
      duration,
      seconds: {
        loudness: sec(started, marks.loudness),
        segments: sec(marks.loudness, marks.segments),
        join: sec(marks.segments, marks.join),
        total: sec(started, Date.now()),
      },
    });
  }

  private set(state: RenderState): void {
    this.state = state;
    this.emit('change');
  }
}

function uniquePath(file: string): string {
  if (!existsSync(file)) return file;
  const { dir, name, ext } = path.parse(file);
  for (let i = 2; ; i++) {
    const candidate = path.join(dir, `${name}-${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
}
