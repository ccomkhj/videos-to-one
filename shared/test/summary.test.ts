import { describe, expect, it } from 'vitest';
import { defaultAspect, displaySize, HLG, inputSummary, orientation, originalGains, type Clip, type MediaInfo } from '../src/index.ts';

const clip = (m: Partial<MediaInfo>): Clip =>
  ({
    id: 'x',
    filename: 'x.mov',
    status: 'ready',
    segments: [{ start: 0, end: 10, removed: false }],
    media: { duration: 10, width: 1920, height: 1080, rotation: 0, fps: 30, hdr: false, colorTransfer: 'bt709', hasAudio: true, videoCodec: 'h264', ...m },
  }) as Clip;

describe('originalGains', () => {
  it('finds nothing to gain for 1080p SDR clips (the iPhone Photos-picker case)', () => {
    expect(originalGains([clip({}), clip({ width: 1080, height: 1920 })], '16:9')).toEqual({ resolution: false, hdr: false });
  });

  it('gains resolution from any clip above 1080p, judged by the short side for 1:1', () => {
    expect(originalGains([clip({}), clip({ width: 3840, height: 2160 })], '9:16').resolution).toBe(true);
    expect(originalGains([clip({ width: 2560, height: 1080 })], '16:9').resolution).toBe(true);
    expect(originalGains([clip({ width: 2560, height: 1080 })], '1:1').resolution).toBe(false);
  });

  it('gains HDR only when every clip is HLG', () => {
    const hlg = clip({ hdr: true, colorTransfer: HLG });
    expect(originalGains([hlg, hlg], '16:9').hdr).toBe(true);
    expect(originalGains([hlg, clip({})], '16:9').hdr).toBe(false);
    expect(originalGains([clip({ hdr: true, colorTransfer: 'smpte2084' })], '16:9').hdr).toBe(false);
  });
});

describe('manual rotation', () => {
  it('swaps the display size for quarter turns only', () => {
    expect(displaySize({ ...clip({}), rotate: 90 })).toEqual({ width: 1080, height: 1920 });
    expect(displaySize({ ...clip({}), rotate: 270 })).toEqual({ width: 1080, height: 1920 });
    expect(displaySize({ ...clip({}), rotate: 180 })).toEqual({ width: 1920, height: 1080 });
    expect(displaySize(clip({}))).toEqual({ width: 1920, height: 1080 });
  });

  it('counts a rotated clip in its new orientation for the default aspect and summary', () => {
    const turned: Clip = { ...clip({ width: 1080, height: 1920 }), rotate: 90 };
    expect(orientation(turned)).toBe('landscape');
    expect(defaultAspect([turned])).toBe('16:9');
    expect(inputSummary([turned, clip({})])).toMatch(/^All landscape/);
  });
});
