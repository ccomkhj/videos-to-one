/** Upload processing (SPEC §6.4 "On upload"): probe → metadata → place → proxy → filmstrip. */
import { initialSegments, type LatLon } from '@vto/shared';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { proxyArgs, stripArgs } from './ffmpeg-args.ts';
import { probe, run } from './ffmpeg.ts';
import type { Geocoder } from './geocode.ts';
import { parseProbe } from './metadata.ts';
import type { SessionStore } from './session.ts';

export function originalPath(clipDir: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return path.join(clipDir, `original${/^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.mp4'}`);
}

export interface IngestDeps {
  store: SessionStore;
  geocoder: Geocoder;
  tzAt: (loc: LatLon) => string | undefined;
  timeZone: string;
  /** Called once a clip turns ready (orientation detection hooks in here). */
  onReady?: (id: string) => void;
}

export class Ingest {
  private queue: string[] = [];
  private active = 0;
  private idleWaiters: Array<() => void> = [];
  /** Per-clip filmstrip regeneration, serialized so the last rotation wins. */
  private strips = new Map<string, Promise<void>>();

  constructor(private readonly deps: IngestDeps, private readonly concurrency = 2) {}

  enqueue(id: string): void {
    this.queue.push(id);
    this.pump();
  }

  /** Resolves when nothing is queued or running (used by tests and shutdown). */
  idle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  /** Regenerates the filmstrip after a manual rotation, in the background (SPEC §6.4). */
  restrip(id: string): Promise<void> {
    const prev = this.strips.get(id) ?? Promise.resolve();
    const next = prev.then(() => this.writeStrip(id)).catch(() => {});
    this.strips.set(id, next);
    void next.finally(() => {
      if (this.strips.get(id) === next) this.strips.delete(id);
    });
    return next;
  }

  private async writeStrip(id: string): Promise<void> {
    const { store } = this.deps;
    const clip = store.get(id);
    if (!clip?.media || clip.status !== 'ready') return;
    const dir = store.clipDir(id);
    const tmp = path.join(dir, 'strip.tmp.jpg');
    try {
      await run('ffmpeg', stripArgs(path.join(dir, 'proxy.mp4'), clip.media.duration, tmp, clip.rotate));
      await rename(tmp, path.join(dir, 'strip.jpg'));
    } catch {
      await rm(tmp, { force: true });
      return;
    }
    if (store.get(id)) store.update(id, { stripRev: (store.get(id)!.stripRev ?? 0) + 1 });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.active++;
      this.process(id).finally(() => {
        this.active--;
        this.pump();
        if (this.active === 0 && this.queue.length === 0) this.idleWaiters.splice(0).forEach((r) => r());
      });
    }
  }

  private async process(id: string): Promise<void> {
    const { store } = this.deps;
    const clip = store.get(id);
    if (!clip) return;
    const dir = store.clipDir(id);
    const original = originalPath(dir, clip.filename);
    try {
      const parsed = parseProbe(await probe(original), {
        fallbackTz: this.deps.timeZone,
        tzAt: this.deps.tzAt,
        ...(clip.lastModified ? { lastModified: clip.lastModified } : {}),
      });
      if (!(parsed.media.duration >= 1)) throw new Error('clip is shorter than 1 second');
      store.update(id, {
        media: parsed.media,
        ...(parsed.recordedAt ? { recordedAt: parsed.recordedAt } : {}),
        ...(parsed.location ? { location: parsed.location } : {}),
        // Re-analysis after a restart keeps cuts already made.
        ...(clip.segments.length ? {} : { segments: initialSegments(Math.round(parsed.media.duration * 1000) / 1000) }),
      });
      // The rate-limited place lookup runs alongside the proxy instead of holding up the queue.
      const place = parsed.location ? this.deps.geocoder.placeAt(parsed.location) : Promise.resolve(undefined);
      const proxy = path.join(dir, 'proxy.mp4');
      await run('ffmpeg', proxyArgs(original, parsed.media, proxy));
      // A rotation chosen while the proxy was being made is already in the filmstrip.
      await run('ffmpeg', stripArgs(proxy, parsed.media.duration, path.join(dir, 'strip.jpg'), store.get(id)?.rotate));
      const label = await place;
      if (store.get(id)) {
        store.update(id, { ...(label ? { place: label } : {}), status: 'ready' });
        this.deps.onReady?.(id);
      }
    } catch (err) {
      if (store.get(id)) store.update(id, { status: 'error', error: friendlyError(err) });
    }
  }
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/no video stream|Invalid data found/i.test(msg)) return 'Not a playable video file';
  return msg.slice(0, 300);
}
