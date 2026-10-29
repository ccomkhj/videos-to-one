/** Export-sheet helpers shared by the planner and the web UI (SPEC §4.3, §5.7). */
import { keptDuration } from './segments.ts';
import type { Aspect, Clip } from './types.ts';

const STANDARD_FPS = [24, 25, 30, 50, 60];

/** Snap to 24/25/30/50/60, capped at 60. */
export function snapFps(fps: number): number {
  if (fps >= 60) return 60;
  return STANDARD_FPS.reduce((best, f) => (Math.abs(f - fps) < Math.abs(best - fps) ? f : best));
}

export type Orientation = 'landscape' | 'portrait' | 'square';

export function orientation(c: Clip): Orientation {
  const w = c.media?.width ?? 0;
  const h = c.media?.height ?? 0;
  if (Math.abs(w - h) <= Math.max(w, h) * 0.02) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

const ASPECT_FOR: Record<Orientation, Aspect> = { landscape: '16:9', portrait: '9:16', square: '1:1' };

/** The orientation with the most total kept duration. */
export function defaultAspect(clips: readonly Clip[]): Aspect {
  const total = new Map<Orientation, number>();
  for (const c of clips) total.set(orientation(c), (total.get(orientation(c)) ?? 0) + keptDuration(c.segments));
  let best: Orientation = 'landscape';
  for (const [o, d] of total) if (d > (total.get(best) ?? 0)) best = o;
  return ASPECT_FOR[best];
}

/** Transfer characteristic of HLG HDR, the only HDR kept in the output (SPEC §5.7). */
export const HLG = 'arib-std-b67';

/**
 * What Original quality adds over Compatible 1080p for these clips: a canvas above 1080p,
 * and/or HLG HDR kept. Mirrors the planner's canvas and HDR rules.
 */
export function originalGains(clips: readonly Clip[], aspect: Aspect): { resolution: boolean; hdr: boolean } {
  const media = clips.flatMap((c) => (c.media ? [c.media] : []));
  const long = Math.max(0, ...media.map((m) => Math.max(m.width, m.height)));
  const short = Math.max(0, ...media.map((m) => Math.min(m.width, m.height)));
  return {
    resolution: aspect === '1:1' ? short > 1080 : long > 1920,
    hdr: media.length > 0 && media.every((m) => m.colorTransfer === HLG),
  };
}

function resolutionLabel(c: Clip): string {
  const short = Math.min(c.media?.width ?? 0, c.media?.height ?? 0);
  if (short >= 2160) return '4K';
  if (short >= 1440) return '1440p';
  if (short >= 1080) return '1080p';
  if (short >= 720) return '720p';
  return `${short}p`;
}

/** e.g. "6 landscape · 3 portrait — 8 HDR, 1 SDR — 30 fps ×8, 60 fps ×1", or one line if uniform. */
export function inputSummary(clips: readonly Clip[]): string {
  if (clips.length === 0) return '';
  const count = <K>(f: (c: Clip) => K) => {
    const m = new Map<K, number>();
    for (const c of clips) m.set(f(c), (m.get(f(c)) ?? 0) + 1);
    return m;
  };
  const orients = count(orientation);
  const hdr = count((c) => (c.media?.hdr ? 'HDR' : 'SDR'));
  const fps = count((c) => snapFps(c.media?.fps ?? 30));
  const res = count(resolutionLabel);

  if (orients.size === 1 && hdr.size === 1 && fps.size === 1) {
    const parts = [`All ${[...orients.keys()][0]}`];
    if (res.size === 1) parts.push([...res.keys()][0]!);
    if (hdr.has('HDR')) parts.push('HDR');
    parts.push(`${[...fps.keys()][0]} fps`);
    return parts.join(', ');
  }

  const order: Orientation[] = ['landscape', 'portrait', 'square'];
  const o = order.filter((k) => orients.has(k)).map((k) => `${orients.get(k)} ${k}`).join(' · ');
  const h =
    hdr.size === 1 ? `all ${[...hdr.keys()][0]}` : `${hdr.get('HDR')} HDR, ${hdr.get('SDR')} SDR`;
  const f = [...fps.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([k, v]) => `${k} fps ×${v}`)
    .join(', ');
  return `${o} — ${h} — ${f}`;
}
