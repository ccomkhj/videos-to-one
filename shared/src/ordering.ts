/** Clip order (SPEC §5.5). */
import type { Clip } from './types.ts';

/** Chronological, undated clips last in upload order. */
export function byDate(a: Clip, b: Clip): number {
  const ta = a.recordedAt?.utcMs;
  const tb = b.recordedAt?.utcMs;
  if (ta !== undefined && tb !== undefined && ta !== tb) return ta - tb;
  if (ta !== undefined && tb === undefined) return -1;
  if (ta === undefined && tb !== undefined) return 1;
  return a.uploadIndex - b.uploadIndex;
}

/**
 * The manual order (if any) comes first, then every clip not in it, sorted by date.
 * So clips uploaded after a drag are appended, chronological among themselves.
 */
export function orderClips(clips: readonly Clip[], manual: readonly string[] | null): Clip[] {
  const byId = new Map(clips.map((c) => [c.id, c]));
  const head = (manual ?? []).flatMap((id) => byId.get(id) ?? []);
  const inHead = new Set(head.map((c) => c.id));
  const tail = clips.filter((c) => !inHead.has(c.id)).sort(byDate);
  return [...head, ...tail];
}
