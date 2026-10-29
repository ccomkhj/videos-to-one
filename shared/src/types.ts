export interface KeepRange {
  start: number;
  end: number;
}

export interface Segment extends KeepRange {
  removed: boolean;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Recording time resolved per SPEC §5.2. */
export interface RecordedAt {
  /** Wall-clock time where the clip was recorded, `YYYY-MM-DDTHH:mm:ss`. */
  local: string;
  /** Absolute instant (ms since epoch), used for sorting. */
  utcMs: number;
  source: 'quicktime' | 'creation_time+gps' | 'creation_time+tz' | 'lastModified';
}

/** What ffprobe tells us about a clip (SPEC §5.1). */
export interface MediaInfo {
  duration: number;
  /** Display size, after rotation. */
  width: number;
  height: number;
  rotation: number;
  fps: number;
  hdr: boolean;
  colorTransfer?: string;
  hasAudio: boolean;
  videoCodec: string;
}

export type ClipStatus = 'analyzing' | 'ready' | 'error';

export interface Clip {
  id: string;
  filename: string;
  status: ClipStatus;
  error?: string;
  /** Increments per upload; ties and undated clips keep upload order. */
  uploadIndex: number;
  /** `File.lastModified` sent with the upload: the date of last resort (SPEC §5.2). */
  lastModified?: number;
  media?: MediaInfo;
  recordedAt?: RecordedAt;
  location?: LatLon;
  place?: string;
  segments: Segment[];
}

export type Aspect = '16:9' | '9:16' | '1:1';
export type Fill = 'blur' | 'bars';
export type Preset = 'compatible' | 'original';

export interface ExportOptions {
  aspect: Aspect;
  fill: Fill;
  preset: Preset;
  title: string;
}

export type RenderState =
  | { state: 'idle' }
  | { state: 'running'; progress: number; etaSec: number | null; step: string }
  | { state: 'done'; file: string }
  | { state: 'error'; message: string }
  | { state: 'cancelled' };

export interface SessionSnapshot {
  clips: Clip[];
  manualOrder: boolean;
  render: RenderState;
  lastOutput: string | null;
}

export interface AppInfo {
  phoneUrl: string | null;
  version: string;
  geocoder: 'nominatim' | 'off';
}
