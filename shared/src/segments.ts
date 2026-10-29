/**
 * Per-clip cut list (SPEC §5.6). A clip stores contiguous segments spanning
 * [trimStart, trimEnd]; removed segments are kept so they can be restored.
 * The renderer only sees the derived keep ranges.
 */
import type { KeepRange, Segment } from './types.ts';

export const MIN_SEGMENT = 1.0;
const EPS = 1e-6;

export const snap = (t: number): number => Math.round(t * 10) / 10;

export function initialSegments(duration: number): Segment[] {
  return [{ start: 0, end: duration, removed: false }];
}

export const resetSegments = initialSegments;

/** Kept parts as ranges; adjacent kept segments merge into one range. */
export function keepRanges(segs: readonly Segment[]): KeepRange[] {
  const out: KeepRange[] = [];
  for (const s of segs) {
    if (s.removed) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.end - s.start) < EPS) last.end = s.end;
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

export function keptDuration(segs: readonly Segment[]): number {
  return keepRanges(segs).reduce((sum, r) => sum + (r.end - r.start), 0);
}

const hasKept = (segs: readonly Segment[]) => segs.some((s) => !s.removed);

export function trimStart(segs: readonly Segment[], t: number): Segment[] {
  const first = segs[0];
  if (!first) return [...segs];
  t = Math.max(0, snap(t));
  if (t <= first.start) return [{ ...first, start: t }, ...segs.slice(1)];
  let i = segs.findIndex((s) => t < s.end - EPS);
  if (i < 0) i = segs.length - 1;
  const seg = segs[i]!;
  const start = Math.min(t, snap(seg.end - MIN_SEGMENT));
  const next = [{ ...seg, start: Math.max(seg.start, start) }, ...segs.slice(i + 1)];
  return hasKept(next) ? next : [...segs];
}

export function trimEnd(segs: readonly Segment[], t: number, duration: number): Segment[] {
  const last = segs[segs.length - 1];
  if (!last) return [...segs];
  t = Math.min(duration, snap(t));
  if (t >= last.end) return [...segs.slice(0, -1), { ...last, end: t }];
  let i = -1;
  for (let k = segs.length - 1; k >= 0; k--) {
    if (t > segs[k]!.start + EPS) {
      i = k;
      break;
    }
  }
  if (i < 0) i = 0;
  const seg = segs[i]!;
  const end = Math.max(t, snap(seg.start + MIN_SEGMENT));
  const next = [...segs.slice(0, i), { ...seg, end: Math.min(seg.end, end) }];
  return hasKept(next) ? next : [...segs];
}

/** Split the segment under `t`. Returns the input unchanged if a part would be < 1.0 s. */
export function splitAt(segs: Segment[], t: number): Segment[] {
  t = snap(t);
  const i = segs.findIndex((s) => t > s.start && t < s.end);
  if (i < 0) return segs;
  const seg = segs[i]!;
  if (t - seg.start < MIN_SEGMENT - EPS || seg.end - t < MIN_SEGMENT - EPS) return segs;
  return [...segs.slice(0, i), { ...seg, end: t }, { ...seg, start: t }, ...segs.slice(i + 1)];
}

/** Remove or restore a segment. Removing the last kept segment is refused. */
export function toggleRemoved(segs: Segment[], index: number): Segment[] {
  const seg = segs[index];
  if (!seg) return segs;
  const next = segs.map((s, k) => (k === index ? { ...s, removed: !s.removed } : s));
  return hasKept(next) ? next : segs;
}

/** Returns an error message, or null if the list is valid for a clip of `duration`. */
export function validateSegments(segs: unknown, duration: number): string | null {
  if (!Array.isArray(segs) || segs.length === 0) return 'need at least one segment';
  let prevEnd: number | null = null;
  for (const s of segs as Segment[]) {
    if (typeof s?.start !== 'number' || typeof s?.end !== 'number' || typeof s?.removed !== 'boolean') {
      return 'segments need numeric start/end and boolean removed';
    }
    if (s.start < -EPS || s.end > duration + 0.05) return 'segment outside the clip duration';
    if (s.end - s.start < MIN_SEGMENT - 0.01) return 'segments must be at least 1.0 s long';
    if (prevEnd !== null && Math.abs(s.start - prevEnd) > 0.01) return 'segments must be contiguous';
    prevEnd = s.end;
  }
  if (!hasKept(segs as Segment[])) return 'at least one segment must be kept';
  return null;
}
