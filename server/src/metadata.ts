/**
 * ffprobe JSON → media info, recording time and location (SPEC §5.1, §5.2).
 * Pure: timezone lookup is injected so tests don't need geo data.
 */
import type { LatLon, MediaInfo, RecordedAt } from '@vto/shared';

export interface ProbeJson {
  streams?: Array<Record<string, any>>;
  format?: { duration?: string; tags?: Record<string, string> };
}

export interface ParseOptions {
  /** Fallback IANA timezone (the container's `TZ`). */
  fallbackTz: string;
  /** Offline timezone lookup for a position. */
  tzAt: (loc: LatLon) => string | undefined;
  /** `File.lastModified` from the browser, ms since epoch. */
  lastModified?: number;
}

export interface ParsedClip {
  media: MediaInfo;
  recordedAt?: RecordedAt;
  location?: LatLon;
}

const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);

export function parseProbe(probe: ProbeJson, opts: ParseOptions): ParsedClip {
  const streams = probe.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('no video stream');
  const tags = lowerKeys({ ...(video.tags ?? {}), ...(probe.format?.tags ?? {}) });

  const rotation = readRotation(video);
  const swap = rotation === 90 || rotation === 270;
  const w = Number(video.width) || 0;
  const h = Number(video.height) || 0;
  const transfer: string | undefined = video.color_transfer;

  const media: MediaInfo = {
    duration: Number(probe.format?.duration ?? video.duration ?? 0),
    width: swap ? h : w,
    height: swap ? w : h,
    rotation,
    fps: readFps(video),
    hdr: transfer !== undefined && HDR_TRANSFERS.has(transfer),
    ...(transfer ? { colorTransfer: transfer } : {}),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    videoCodec: String(video.codec_name ?? 'unknown'),
  };

  const location =
    parseLocation(tags['com.apple.quicktime.location.iso6709']) ??
    parseLocation(tags['location']) ??
    parseLocation(tags['location-eng']);

  const recordedAt = resolveRecordedAt(tags, location, opts);
  return { media, ...(recordedAt ? { recordedAt } : {}), ...(location ? { location } : {}) };
}

function resolveRecordedAt(
  tags: Record<string, string>,
  location: LatLon | undefined,
  opts: ParseOptions,
): RecordedAt | undefined {
  const qt = tags['com.apple.quicktime.creationdate'];
  const m = qt?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}):?(\d{2})$/);
  if (m) {
    const utcMs = Date.parse(`${m[1]}${m[2]}:${m[3]}`);
    if (!Number.isNaN(utcMs)) return { local: m[1]!, utcMs, source: 'quicktime' };
  }

  const ct = tags['creation_time'];
  const ctMs = ct ? Date.parse(ct) : NaN;
  // Some cameras write 1970/1904 epochs when the clock is unset; treat as missing.
  if (!Number.isNaN(ctMs) && ctMs > Date.UTC(1990, 0, 1)) {
    const gpsTz = location ? opts.tzAt(location) : undefined;
    if (gpsTz) return { local: localTime(ctMs, gpsTz), utcMs: ctMs, source: 'creation_time+gps' };
    return { local: localTime(ctMs, opts.fallbackTz), utcMs: ctMs, source: 'creation_time+tz' };
  }

  if (opts.lastModified && Number.isFinite(opts.lastModified)) {
    const tz = (location && opts.tzAt(location)) || opts.fallbackTz;
    return { local: localTime(opts.lastModified, tz), utcMs: opts.lastModified, source: 'lastModified' };
  }
  return undefined;
}

/** Wall-clock `YYYY-MM-DDTHH:mm:ss` of an instant in an IANA timezone. */
export function localTime(utcMs: number, timeZone: string): string {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return localTime(utcMs, 'UTC');
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** ISO 6709 (`+35.0116+135.7681+040.000/`), as written by iPhones and the MP4 `©xyz` tag. */
export function parseLocation(value: string | undefined): LatLon | undefined {
  const m = value?.trim().match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return undefined;
  if (lat === 0 && lon === 0) return undefined;
  return { lat, lon };
}

function readRotation(video: Record<string, any>): number {
  const matrix = (video.side_data_list ?? []).find((d: any) => typeof d.rotation === 'number');
  // Display-matrix rotation is counter-clockwise; the legacy `rotate` tag is clockwise.
  const deg = matrix ? -matrix.rotation : Number(video.tags?.rotate ?? 0) || 0;
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

function readFps(video: Record<string, any>): number {
  for (const key of ['avg_frame_rate', 'r_frame_rate']) {
    const [n, d] = String(video[key] ?? '0/0').split('/').map(Number);
    if (n && d) return n / d;
  }
  return 30;
}

function lowerKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
}
