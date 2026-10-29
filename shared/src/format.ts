const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const ymd = (local: string): Ymd => ({
  y: Number(local.slice(0, 4)),
  m: Number(local.slice(5, 7)),
  d: Number(local.slice(8, 10)),
});

const dm = (p: Ymd) => `${p.d} ${MONTHS[p.m - 1]}`;

/** `2026-10-29T14:32:10` → `29 Oct 2026` (SPEC §5.4). */
export function formatDate(local: string): string {
  const p = ymd(local);
  return `${dm(p)} ${p.y}`;
}

/** Date range for the title card and filename, e.g. `12 – 18 Oct 2026`. Null if no dates. */
export function formatDateRange(locals: readonly string[]): string | null {
  if (locals.length === 0) return null;
  const sorted = [...locals].map((l) => l.slice(0, 10)).sort();
  const a = ymd(sorted[0]!);
  const b = ymd(sorted[sorted.length - 1]!);
  if (a.y !== b.y) return `${dm(a)} ${a.y} – ${dm(b)} ${b.y}`;
  if (a.m !== b.m) return `${dm(a)} – ${dm(b)} ${b.y}`;
  if (a.d !== b.d) return `${a.d} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${dm(a)} ${a.y}`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
