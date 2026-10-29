/** Reverse geocoding via OpenStreetMap Nominatim (SPEC §5.3). */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LatLon } from '@vto/shared';

export interface Geocoder {
  /** Place label like "Kyoto, Japan", or undefined. Never throws. */
  placeAt(loc: LatLon): Promise<string | undefined>;
}

export const noGeocoder: Geocoder = { placeAt: async () => undefined };

/** `<locality>, <country>`, locality = city → town → village → municipality → county → state. */
export function placeLabel(address: Record<string, string> | undefined): string | undefined {
  if (!address) return undefined;
  const locality = ['city', 'town', 'village', 'municipality', 'county', 'state']
    .map((k) => address[k])
    .find(Boolean);
  const parts = [locality, address.country].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

export interface NominatimOptions {
  cacheFile: string;
  language: string;
  userAgent: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  minIntervalMs?: number;
}

export class NominatimGeocoder implements Geocoder {
  private cache: Record<string, string | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;

  constructor(private readonly opts: NominatimOptions) {}

  async placeAt(loc: LatLon): Promise<string | undefined> {
    // ~100 m grid, so nearby clips share one lookup.
    const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
    const cache = await this.loadCache();
    if (key in cache) return cache[key] ?? undefined;
    const result = this.queue.then(() => this.lookup(loc, key));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async lookup(loc: LatLon, key: string): Promise<string | undefined> {
    const cache = await this.loadCache();
    if (key in cache) return cache[key] ?? undefined;
    const wait = this.lastRequest + (this.opts.minIntervalMs ?? 1100) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
    try {
      const url = new URL('/reverse', this.opts.baseUrl ?? 'https://nominatim.openstreetmap.org');
      url.search = new URLSearchParams({
        format: 'jsonv2',
        lat: String(loc.lat),
        lon: String(loc.lon),
        zoom: '10',
        'accept-language': this.opts.language,
      }).toString();
      const res = await (this.opts.fetch ?? fetch)(url, {
        headers: { 'User-Agent': this.opts.userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return undefined; // not cached: may work next time
      const body = (await res.json()) as { address?: Record<string, string> };
      const label = placeLabel(body.address);
      cache[key] = label ?? null;
      await this.saveCache();
      return label;
    } catch {
      return undefined;
    }
  }

  private async loadCache(): Promise<Record<string, string | null>> {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(await readFile(this.opts.cacheFile, 'utf8'));
      } catch {
        this.cache = {};
      }
    }
    return this.cache!;
  }

  private async saveCache(): Promise<void> {
    await mkdir(path.dirname(this.opts.cacheFile), { recursive: true });
    const tmp = `${this.opts.cacheFile}.tmp`;
    await writeFile(tmp, JSON.stringify(this.cache));
    await rename(tmp, this.opts.cacheFile);
  }
}
