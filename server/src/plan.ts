/**
 * Export planning (SPEC §5.7, §6.4 step 1): turns the ordered clips and export
 * options into a list of segments plus everything the ffmpeg stage needs.
 * Pure: loudness is measured beforehand and passed in.
 */
import {
  formatDate,
  formatDateRange,
  keepRanges,
  snapFps,
  type Clip,
  type ExportOptions,
  type Fill,
  type Preset,
} from '@vto/shared';
import { localTime } from './metadata.ts';

export const CROSSFADE = 0.5;
export const OVERLAY_SECONDS = 4;
export const TITLE_SECONDS = 3;
const TARGET_LUFS = -16;
const TARGET_TP = -1.5;
export const HLG = 'arib-std-b67';

export interface Loudness {
  /** Integrated loudness, LUFS (-Infinity for silence). */
  i: number;
  /** True peak, dBTP. */
  tp: number;
}

export interface PlanInput {
  /** Ready clips in output order. */
  clips: Clip[];
  options: ExportOptions;
  loudness: Record<string, Loudness>;
  sourcePath: (clip: Clip) => string;
  now: Date;
  /** Timezone for the filename timestamp. */
  timeZone: string;
}

export interface Overlay {
  place?: string;
  date?: string;
  duration: number;
}

export interface ClipSegment {
  kind: 'clip';
  clipId: string;
  source: string;
  start: number;
  duration: number;
  hdr: boolean;
  colorTransfer?: string;
  hasAudio: boolean;
  gainDb: number;
  overlay: Overlay | null;
}

export interface TitleSegment {
  kind: 'title';
  duration: number;
  title: string;
  subtitle: string | null;
}

export type PlanSegment = ClipSegment | TitleSegment;

export interface Plan {
  canvas: { width: number; height: number };
  fps: number;
  /** Output stays HLG HDR (original preset, every clip HLG). */
  hdr: boolean;
  preset: Preset;
  fill: Fill;
  segments: PlanSegment[];
  /** xfade offset for joining segment k+1 onto the chain of segments 0..k. */
  offsets: number[];
  totalDuration: number;
  filename: string;
}

export function buildPlan(input: PlanInput): Plan {
  const { clips, options } = input;
  const segments: PlanSegment[] = [];
  const title = options.title.trim();
  const dates = clips.flatMap((c) => (c.recordedAt ? [c.recordedAt.local] : []));
  const dateRange = formatDateRange(dates);
  if (title) segments.push({ kind: 'title', duration: TITLE_SECONDS, title, subtitle: dateRange });

  const fpsWeight = new Map<number, number>();
  for (const clip of clips) {
    const media = clip.media;
    if (!media) continue;
    const ranges = keepRanges(clip.segments);
    const gainDb = gainFor(input.loudness[clip.id]);
    ranges.forEach((r, k) => {
      const duration = round3(r.end - r.start);
      fpsWeight.set(snapFps(media.fps), (fpsWeight.get(snapFps(media.fps)) ?? 0) + duration);
      segments.push({
        kind: 'clip',
        clipId: clip.id,
        source: input.sourcePath(clip),
        start: r.start,
        duration,
        hdr: media.hdr,
        ...(media.colorTransfer ? { colorTransfer: media.colorTransfer } : {}),
        hasAudio: media.hasAudio,
        gainDb,
        overlay: k === 0 ? overlayFor(clip, duration) : null,
      });
    });
  }
  if (!segments.some((s) => s.kind === 'clip')) throw new Error('no clips to export');

  const offsets: number[] = [];
  let chain = segments[0]!.duration;
  for (const s of segments.slice(1)) {
    offsets.push(round3(chain - CROSSFADE));
    chain = round3(chain - CROSSFADE + s.duration);
  }

  const ready = clips.filter((c) => c.media);
  return {
    canvas: canvasFor(options, ready),
    fps: [...fpsWeight.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 30,
    hdr: options.preset === 'original' && ready.length > 0 && ready.every((c) => c.media!.colorTransfer === HLG),
    preset: options.preset,
    fill: options.fill,
    segments,
    offsets,
    totalDuration: chain,
    filename: `${safeName(title || dateRange || 'videos-to-one')}_${stamp(input.now, input.timeZone)}.mp4`,
  };
}

function overlayFor(clip: Clip, segDuration: number): Overlay | null {
  const place = clip.place;
  const date = clip.recordedAt ? formatDate(clip.recordedAt.local) : undefined;
  if (!place && !date) return null;
  return {
    ...(place ? { place } : {}),
    ...(date ? { date } : {}),
    duration: Math.min(OVERLAY_SECONDS, segDuration),
  };
}

function gainFor(l: Loudness | undefined): number {
  if (!l || !Number.isFinite(l.i)) return 0;
  const gain = Math.min(TARGET_LUFS - l.i, Number.isFinite(l.tp) ? TARGET_TP - l.tp : Infinity);
  return round3(Math.max(-30, Math.min(30, gain)));
}

const even = (x: number) => Math.round(x / 2) * 2;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function canvasFor(options: ExportOptions, clips: Clip[]): Plan['canvas'] {
  let long = 1920;
  let square = 1080;
  if (options.preset === 'original') {
    const longs = clips.map((c) => Math.max(c.media!.width, c.media!.height));
    const shorts = clips.map((c) => Math.min(c.media!.width, c.media!.height));
    long = even(clamp(Math.max(0, ...longs), 1920, 3840));
    square = even(clamp(Math.max(0, ...shorts), 1080, 2160));
  }
  const short = even((long * 9) / 16);
  switch (options.aspect) {
    case '16:9':
      return { width: long, height: short };
    case '9:16':
      return { width: short, height: long };
    case '1:1':
      return { width: square, height: square };
  }
}

function safeName(s: string): string {
  const clean = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, 80).join('').trim();
}

function stamp(now: Date, tz: string): string {
  const l = localTime(now.getTime(), tz);
  return `${l.slice(0, 4)}${l.slice(5, 7)}${l.slice(8, 10)}-${l.slice(11, 13)}${l.slice(14, 16)}`;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
