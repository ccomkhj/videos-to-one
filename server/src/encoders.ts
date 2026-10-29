/**
 * Final-encode backends (SPEC §6.4 step 4, R2). Software x264/x265 always works; a hardware
 * encoder is used when the OS has one and a test encode succeeds at startup:
 * macOS → VideoToolbox, Linux → NVENC (NVIDIA) or VAAPI (Intel/AMD).
 */
import { existsSync } from 'node:fs';
import type { Preset } from '@vto/shared';

export type HardwareKind = 'videotoolbox' | 'nvenc' | 'vaapi';
export type EncoderKind = 'software' | HardwareKind;
export type EncoderSetting = 'auto' | EncoderKind;

export interface Encoder {
  kind: EncoderKind;
  /** VAAPI render node, e.g. /dev/dri/renderD128. */
  device?: string;
}

/** One encoder per preset: hardware may do H.264 but not 10-bit HEVC. */
export type Encoders = Record<Preset, Encoder>;

export const SOFTWARE: Encoders = { compatible: { kind: 'software' }, original: { kind: 'software' } };

export const ENCODER_SETTINGS: EncoderSetting[] = ['auto', 'software', 'videotoolbox', 'nvenc', 'vaapi'];

/** Hardware encoders worth trying on this OS, best first. */
export function candidates(platform: NodeJS.Platform, setting: EncoderSetting, vaapiDevice: string): Encoder[] {
  if (setting === 'software') return [];
  const vaapi: Encoder = { kind: 'vaapi', device: vaapiDevice };
  const all: Encoder[] =
    platform === 'darwin'
      ? [{ kind: 'videotoolbox' }]
      : platform === 'linux'
        ? [{ kind: 'nvenc' }, ...(existsSync(vaapiDevice) ? [vaapi] : [])]
        : [];
  if (setting === 'auto') return all;
  // Forced: still only if it passes the test encode.
  return [setting === 'vaapi' ? vaapi : { kind: setting }];
}

/**
 * Picks, per preset, the first candidate whose test encode succeeds; software otherwise.
 * `probe` runs a short real encode and resolves to whether it worked.
 */
export async function detectEncoders(
  list: readonly Encoder[],
  probe: (encoder: Encoder, preset: Preset) => Promise<boolean>,
): Promise<Encoders> {
  const pick = async (preset: Preset): Promise<Encoder> => {
    for (const enc of list) if (await probe(enc, preset)) return enc;
    return { kind: 'software' };
  };
  return { compatible: await pick('compatible'), original: await pick('original') };
}

export const describeEncoder = (e: Encoder) => (e.kind === 'vaapi' ? `vaapi (${e.device})` : e.kind);
