import { describe, expect, it } from 'vitest';
import { candidates, detectEncoders, type Encoder } from '../src/encoders.ts';

describe('candidates', () => {
  it('tries VideoToolbox on macOS and NVENC on Linux', () => {
    expect(candidates('darwin', 'auto', '/nonexistent')).toEqual([{ kind: 'videotoolbox' }]);
    // No VAAPI render node here, so only NVENC.
    expect(candidates('linux', 'auto', '/nonexistent')).toEqual([{ kind: 'nvenc' }]);
    expect(candidates('win32', 'auto', '/nonexistent')).toEqual([]);
  });

  it('honours a forced setting, including software', () => {
    expect(candidates('darwin', 'software', '/x')).toEqual([]);
    expect(candidates('linux', 'vaapi', '/dev/dri/renderD129')).toEqual([{ kind: 'vaapi', device: '/dev/dri/renderD129' }]);
  });
});

describe('detectEncoders', () => {
  const nvenc: Encoder = { kind: 'nvenc' };
  const vaapi: Encoder = { kind: 'vaapi', device: '/dev/dri/renderD128' };

  it('picks the first encoder that passes, per preset', async () => {
    // NVENC can't do 10-bit HEVC here; VAAPI can.
    const probed: string[] = [];
    const got = await detectEncoders([nvenc, vaapi], async (e, preset) => {
      probed.push(`${e.kind}/${preset}`);
      return !(e.kind === 'nvenc' && preset === 'original');
    });
    expect(got).toEqual({ compatible: nvenc, original: vaapi });
    expect(probed).toEqual(['nvenc/compatible', 'nvenc/original', 'vaapi/original']);
  });

  it('falls back to software when nothing works', async () => {
    expect(await detectEncoders([nvenc, vaapi], async () => false)).toEqual({
      compatible: { kind: 'software' },
      original: { kind: 'software' },
    });
  });
});
