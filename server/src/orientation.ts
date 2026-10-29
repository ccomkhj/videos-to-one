/**
 * Sideways-clip detection (SPEC §5.8): a face detector first, an orientation CNN as the
 * fallback. Runs on the SDR proxy after a clip is ready, one clip at a time; the result
 * is only a suggestion the user accepts or dismisses.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROTATIONS, type OrientationSuggestion } from '@vto/shared';
import type * as Ort from 'onnxruntime-node';
import { rotateFilter } from './ffmpeg-args.ts';
import { runBuffer } from './ffmpeg.ts';
import type { SessionStore } from './session.ts';

export const FACE_MODEL = 'version-RFB-320.onnx';
export const ORIENTATION_MODEL = 'orientation_model_v2_0.9882.onnx';

export const FRAMES = 6;
const FACE_W = 320;
const FACE_H = 240;
const FACE_SCORE = 0.9;
const CNN_SIZE = 384;
const CNN_PROB = 0.7;
const CNN_AGREE = 4;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export type Decision = Omit<OrientationSuggestion, 'dismissed'>;

/**
 * Picks the suggestion. `faceHits[i]` counts frames with a confident face after turning
 * them by ROTATIONS[i]; `cnnProbs` is one 4-way probability row per frame.
 * Faces win when decisive; otherwise the CNN must be confident and consistent.
 */
export function decide(faceHits: readonly number[], cnnProbs: readonly (readonly number[])[]): Decision {
  const top = argmax(faceHits);
  const best = faceHits[top] ?? 0;
  if (best >= 2 && faceHits.every((h, i) => i === top || best >= 2 * h)) {
    const total = faceHits.reduce((a, b) => a + b, 0);
    return { suggested: ROTATIONS[top]!, source: 'faces', confidence: round2(best / total) };
  }
  if (cnnProbs.length === 0) return { suggested: 0, source: 'model', confidence: 0 };
  const mean = [0, 1, 2, 3].map((c) => cnnProbs.reduce((s, p) => s + (p[c] ?? 0), 0) / cnnProbs.length);
  const cls = argmax(mean);
  const agree = cnnProbs.filter((p) => argmax(p) === cls).length;
  if (cls !== 0 && mean[cls]! >= CNN_PROB && agree >= Math.min(CNN_AGREE, cnnProbs.length)) {
    return { suggested: ROTATIONS[cls]!, source: 'model', confidence: round2(mean[cls]!) };
  }
  return { suggested: 0, source: 'model', confidence: round2(mean[0]!) };
}

/** Frame times: the middle of each sixth of the clip. */
const sampleTimes = (duration: number) => Array.from({ length: FRAMES }, (_, k) => ((k + 0.5) / FRAMES) * duration);

/** One frame per sample time, concatenated into a single stream `[f]`. */
function sampleGraph(proxy: string, duration: number): { inputs: string[]; graph: string } {
  const times = sampleTimes(duration);
  const inputs = times.flatMap((t) => ['-ss', t.toFixed(3), '-i', proxy]);
  const frames = times.map((_, k) => `[${k}:v]trim=end_frame=1,setpts=PTS-STARTPTS,setsar=1[s${k}]`);
  const concat = `${times.map((_, k) => `[s${k}]`).join('')}concat=n=${times.length}:v=1:a=0[f]`;
  return { inputs, graph: [...frames, concat].join(';') };
}

const RAW = ['-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
const BASE = ['-hide_banner', '-nostdin', '-loglevel', 'error'];

/** Each frame turned by 0/90/180/270, letterboxed to 320×240: rotation-major order. */
export function faceFramesArgs(proxy: string, duration: number): string[] {
  const { inputs, graph } = sampleGraph(proxy, duration);
  const fit = `scale=${FACE_W}:${FACE_H}:force_original_aspect_ratio=decrease,pad=${FACE_W}:${FACE_H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const turns = ROTATIONS.map((r, i) => `[r${i}]${[rotateFilter(r), fit].filter(Boolean).join(',')}[o${i}]`);
  return [
    ...BASE,
    ...inputs,
    '-filter_complex',
    `${graph};[f]split=4${ROTATIONS.map((_, i) => `[r${i}]`).join('')};${turns.join(';')};` +
      `${ROTATIONS.map((_, i) => `[o${i}]`).join('')}concat=n=4:v=1:a=0,format=rgb24[out]`,
    '-map', '[out]',
    ...RAW,
  ];
}

/** Each frame squashed to 416×416 and center-cropped to 384, as the CNN was trained. */
export function cnnFramesArgs(proxy: string, duration: number): string[] {
  const { inputs, graph } = sampleGraph(proxy, duration);
  return [
    ...BASE,
    ...inputs,
    '-filter_complex', `${graph};[f]scale=416:416,crop=${CNN_SIZE}:${CNN_SIZE},format=rgb24[out]`,
    '-map', '[out]',
    ...RAW,
  ];
}

export interface DetectorDeps {
  store: SessionStore;
  modelsDir: string;
  enabled: boolean;
  log?: (msg: string) => void;
}

interface Models {
  ort: typeof Ort;
  face: Ort.InferenceSession;
  cnn: Ort.InferenceSession;
}

export class OrientationDetector {
  private queue: string[] = [];
  private running = false;
  private models: Promise<Models | null> | null = null;
  private idleWaiters: Array<() => void> = [];
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: DetectorDeps) {
    this.log = deps.log ?? ((m) => console.log(m));
  }

  enqueue(id: string): void {
    if (!this.deps.enabled || this.queue.includes(id)) return;
    this.queue.push(id);
    void this.pump();
  }

  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      try {
        await this.detect(id);
      } catch (err) {
        this.log(`Orientation check failed for ${this.deps.store.get(id)?.filename ?? id}: ${(err as Error).message}`);
      }
    }
    this.running = false;
    this.idleWaiters.splice(0).forEach((r) => r());
  }

  private load(): Promise<Models | null> {
    this.models ??= (async () => {
      const face = path.join(this.deps.modelsDir, FACE_MODEL);
      const cnn = path.join(this.deps.modelsDir, ORIENTATION_MODEL);
      if (!existsSync(face) || !existsSync(cnn)) {
        this.log(`Orientation models not found in ${this.deps.modelsDir} (run \`npm run models\`): sideways clips won't be suggested.`);
        return null;
      }
      try {
        // Local and private (SPEC §1): onnxruntime must not phone home.
        process.env.ORT_DISABLE_TELEMETRY ??= '1';
        const mod = await import('onnxruntime-node');
        const ort = ((mod as { default?: typeof Ort }).default ?? mod) as typeof Ort;
        const opts = { logSeverityLevel: 3 as const };
        return { ort, face: await ort.InferenceSession.create(face, opts), cnn: await ort.InferenceSession.create(cnn, opts) };
      } catch (err) {
        this.log(`Orientation models failed to load: ${(err as Error).message}`);
        return null;
      }
    })();
    return this.models;
  }

  private async detect(id: string): Promise<void> {
    const { store } = this.deps;
    const clip = store.get(id);
    if (!clip?.media || clip.status !== 'ready' || clip.orientation) return;
    const models = await this.load();
    if (!models) {
      this.queue = [];
      return;
    }
    const started = Date.now();
    const proxy = path.join(store.clipDir(id), 'proxy.mp4');
    const duration = clip.media.duration;
    const faceHits = await this.faceHits(models, await runBuffer(faceFramesArgs(proxy, duration)));
    const cnnProbs = await this.cnnProbs(models, await runBuffer(cnnFramesArgs(proxy, duration)));
    const d = decide(faceHits, cnnProbs);
    if (!store.get(id)) return;
    store.update(id, { orientation: d });
    const mean = [0, 1, 2, 3].map((c) => (cnnProbs.reduce((s, p) => s + p[c]!, 0) / (cnnProbs.length || 1)).toFixed(2));
    this.log(
      `Orientation ${clip.filename}: ${d.suggested}° (${d.source} ${d.confidence}) faces [${faceHits.join(',')}] ` +
        `cnn [${mean.join(',')}] in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  }

  /** Frames with a confident face, per candidate rotation. */
  private async faceHits({ ort, face }: Models, raw: Buffer): Promise<number[]> {
    const size = FACE_W * FACE_H * 3;
    const perTurn = Math.floor(raw.length / size / ROTATIONS.length);
    const hits = [0, 0, 0, 0];
    for (let r = 0; r < ROTATIONS.length; r++) {
      for (let k = 0; k < perTurn; k++) {
        const frame = raw.subarray((r * perTurn + k) * size, (r * perTurn + k + 1) * size);
        const input = toChw(frame, FACE_W, FACE_H, (v) => (v - 127) / 128);
        const out = await face.run({ [face.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, FACE_H, FACE_W]) });
        const scores = out[face.outputNames[0]!]!.data as Float32Array;
        let found = false;
        for (let i = 1; i < scores.length; i += 2) if (scores[i]! >= FACE_SCORE) found = true;
        if (found) hits[r]!++;
      }
    }
    return hits;
  }

  /** Softmax probabilities per frame, classes 0/90/180/270. */
  private async cnnProbs({ ort, cnn }: Models, raw: Buffer): Promise<number[][]> {
    const size = CNN_SIZE * CNN_SIZE * 3;
    const n = Math.floor(raw.length / size);
    if (n === 0) return [];
    const input = new Float32Array(n * size);
    for (let k = 0; k < n; k++) {
      input.set(
        toChw(raw.subarray(k * size, (k + 1) * size), CNN_SIZE, CNN_SIZE, (v, c) => (v / 255 - MEAN[c]!) / STD[c]!),
        k * size,
      );
    }
    const out = await cnn.run({ [cnn.inputNames[0]!]: new ort.Tensor('float32', input, [n, 3, CNN_SIZE, CNN_SIZE]) });
    const logits = Array.from(out[cnn.outputNames[0]!]!.data as Float32Array);
    return Array.from({ length: n }, (_, k) => softmax(logits.slice(k * 4, k * 4 + 4)));
  }
}

/** Interleaved RGB bytes → planar float CHW. */
function toChw(rgb: Uint8Array, w: number, h: number, norm: (v: number, channel: number) => number): Float32Array {
  const plane = w * h;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = norm(rgb[i * 3 + c]!, c);
  }
  return out;
}

function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

function argmax(xs: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i]! > xs[best]!) best = i;
  return best;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
