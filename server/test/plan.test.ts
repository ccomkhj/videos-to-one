import { describe, expect, it } from 'vitest';
import { defaultAspect, inputSummary, type Clip, type ExportOptions, type MediaInfo } from '@vto/shared';
import { buildPlan, type PlanInput } from '../src/plan.ts';

let n = 0;
function clip(over: Omit<Partial<Clip>, 'media'> & { media?: Partial<MediaInfo> } = {}): Clip {
  const media: MediaInfo = {
    duration: 10,
    width: 1920,
    height: 1080,
    rotation: 0,
    fps: 30,
    hdr: false,
    hasAudio: true,
    videoCodec: 'h264',
    ...over.media,
  };
  n++;
  return {
    id: over.id ?? `c${n}`,
    filename: `c${n}.mov`,
    status: 'ready',
    uploadIndex: n,
    ...over,
    segments: over.segments ?? [{ start: 0, end: media.duration, removed: false }],
    media,
  };
}

const opts = (o: Partial<ExportOptions> = {}): ExportOptions => ({
  aspect: '16:9',
  fill: 'blur',
  preset: 'compatible',
  title: '',
  ...o,
});

const input = (clips: Clip[], o: Partial<ExportOptions> = {}, extra: Partial<PlanInput> = {}): PlanInput => ({
  clips,
  options: opts(o),
  loudness: {},
  sourcePath: (c) => `/data/${c.id}.mov`,
  now: new Date(Date.UTC(2026, 9, 29, 13, 5)),
  timeZone: 'Europe/Berlin',
  ...extra,
});

describe('buildPlan', () => {
  it('chains one segment per keep range with 0.5 s crossfade offsets', () => {
    const a = clip({ media: { duration: 10 } });
    const b = clip({
      media: { duration: 8 },
      segments: [
        { start: 0, end: 2, removed: false },
        { start: 2, end: 5, removed: true },
        { start: 5, end: 8, removed: false },
      ],
    });
    const plan = buildPlan(input([a, b]));
    expect(plan.segments.map((s) => s.duration)).toEqual([10, 2, 3]);
    // offsets: 10-0.5 = 9.5, then 9.5 + 2 - 0.5 = 11
    expect(plan.offsets).toEqual([9.5, 11]);
    expect(plan.totalDuration).toBeCloseTo(14);
  });

  it('shows the overlay only on the first kept segment of each clip, for 4 s or the segment length', () => {
    const a = clip({
      place: 'Kyoto, Japan',
      recordedAt: { local: '2026-10-29T14:32:10', utcMs: 0, source: 'quicktime' },
      media: { duration: 10 },
      segments: [
        { start: 0, end: 2.5, removed: false },
        { start: 2.5, end: 4, removed: true },
        { start: 4, end: 10, removed: false },
      ],
    });
    const plan = buildPlan(input([a]));
    const [first, second] = plan.segments;
    expect(first).toMatchObject({ kind: 'clip', start: 0, overlay: { place: 'Kyoto, Japan', date: '29 Oct 2026', duration: 2.5 } });
    expect(second).toMatchObject({ kind: 'clip', start: 4, overlay: null });
  });

  it('omits missing overlay fields, and the whole overlay when nothing is known', () => {
    const onlyDate = clip({ recordedAt: { local: '2026-03-05T08:00:00', utcMs: 0, source: 'quicktime' } });
    const nothing = clip();
    const plan = buildPlan(input([onlyDate, nothing]));
    expect(plan.segments[0]).toMatchObject({ overlay: { date: '5 Mar 2026', duration: 4 } });
    expect(plan.segments[0]!.kind === 'clip' && plan.segments[0]!.overlay?.place).toBeUndefined();
    expect(plan.segments[1]).toMatchObject({ overlay: null });
  });

  it('adds a 3 s title card with the date range, which crossfades into the first clip', () => {
    const a = clip({ recordedAt: { local: '2026-10-12T10:00:00', utcMs: 1, source: 'quicktime' } });
    const b = clip({ recordedAt: { local: '2026-10-18T10:00:00', utcMs: 2, source: 'quicktime' } });
    const plan = buildPlan(input([a, b], { title: '  Kyoto trip ' }));
    expect(plan.segments[0]).toEqual({ kind: 'title', duration: 3, title: 'Kyoto trip', subtitle: '12 – 18 Oct 2026' });
    expect(plan.offsets[0]).toBe(2.5);
    expect(plan.filename).toBe('Kyoto trip_20261029-1405.mp4');
  });

  it('names the file after the date range, or "videos-to-one" without dates', () => {
    const dated = clip({ recordedAt: { local: '2026-10-12T10:00:00', utcMs: 1, source: 'quicktime' } });
    expect(buildPlan(input([dated])).filename).toBe('12 Oct 2026_20261029-1405.mp4');
    expect(buildPlan(input([clip()])).filename).toBe('videos-to-one_20261029-1405.mp4');
    expect(buildPlan(input([clip()], { title: 'a/b:c?' })).filename).toBe('a-b-c-_20261029-1405.mp4');
    // Truncation never splits an emoji (a lone surrogate would break the download header).
    const long = buildPlan(input([clip()], { title: `${'x'.repeat(79)}🎉🎉` })).filename;
    expect(long).toBe(`${'x'.repeat(79)}🎉_20261029-1405.mp4`);
    expect(() => encodeURIComponent(long)).not.toThrow();
  });

  it('uses fixed 1080p canvases for the compatible preset', () => {
    const c = [clip({ media: { width: 3840, height: 2160 } })];
    expect(buildPlan(input(c, { aspect: '16:9' })).canvas).toEqual({ width: 1920, height: 1080 });
    expect(buildPlan(input(c, { aspect: '9:16' })).canvas).toEqual({ width: 1080, height: 1920 });
    expect(buildPlan(input(c, { aspect: '1:1' })).canvas).toEqual({ width: 1080, height: 1080 });
  });

  it('sizes the original-quality canvas from the largest input, capped at 4K', () => {
    const uhd = [clip({ media: { width: 2160, height: 3840 } }), clip({ media: { width: 1280, height: 720 } })];
    expect(buildPlan(input(uhd, { preset: 'original', aspect: '16:9' })).canvas).toEqual({ width: 3840, height: 2160 });
    expect(buildPlan(input(uhd, { preset: 'original', aspect: '1:1' })).canvas).toEqual({ width: 2160, height: 2160 });
    const big = [clip({ media: { width: 7680, height: 4320 } })];
    expect(buildPlan(input(big, { preset: 'original', aspect: '9:16' })).canvas).toEqual({ width: 2160, height: 3840 });
    const hd = [clip({ media: { width: 2704, height: 1520 } })];
    expect(buildPlan(input(hd, { preset: 'original', aspect: '16:9' })).canvas).toEqual({ width: 2704, height: 1522 });
    const small = [clip({ media: { width: 640, height: 480 } })];
    expect(buildPlan(input(small, { preset: 'original' })).canvas).toEqual({ width: 1920, height: 1080 });
  });

  it('sizes the original canvas from rotated clips and passes the rotation to their segments', () => {
    // A 2160×3840 portrait clip turned sideways is 3840 wide.
    const turned = clip({ media: { width: 2160, height: 3840 }, rotate: 90 });
    const plan = buildPlan(input([turned, clip({ media: { width: 1080, height: 1920 } })], { preset: 'original', aspect: '1:1' }));
    expect(plan.canvas).toEqual({ width: 2160, height: 2160 });
    expect(plan.segments.map((s) => (s.kind === 'clip' ? s.rotate : null))).toEqual([90, undefined]);
    expect(buildPlan(input([clip({ media: { width: 1080, height: 1920 }, rotate: 270 })], { preset: 'original' })).canvas).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('picks the frame rate with the most kept duration, snapped and capped at 60', () => {
    expect(buildPlan(input([clip({ media: { fps: 29.97, duration: 10 } }), clip({ media: { fps: 60, duration: 5 } })])).fps).toBe(30);
    expect(buildPlan(input([clip({ media: { fps: 240, duration: 10 } })])).fps).toBe(60);
    expect(buildPlan(input([clip({ media: { fps: 23.976 } })])).fps).toBe(24);
    expect(buildPlan(input([clip({ media: { fps: 25 } })])).fps).toBe(25);
  });

  it('keeps HDR only for original quality when every clip is HDR', () => {
    const hdr = () => clip({ media: { hdr: true, colorTransfer: 'arib-std-b67' } });
    expect(buildPlan(input([hdr(), hdr()], { preset: 'original' })).hdr).toBe(true);
    expect(buildPlan(input([hdr(), clip()], { preset: 'original' })).hdr).toBe(false);
    expect(buildPlan(input([hdr()], { preset: 'compatible' })).hdr).toBe(false);
  });

  it('applies one loudness gain per clip towards -16 LUFS, limited by the -1.5 dBTP ceiling', () => {
    const quiet = clip({ id: 'quiet' });
    const peaky = clip({ id: 'peaky' });
    const silent = clip({ id: 'silent' });
    const plan = buildPlan(
      input([quiet, peaky, silent], {}, {
        loudness: { quiet: { i: -26, tp: -12 }, peaky: { i: -24, tp: -3 }, silent: { i: -Infinity, tp: -Infinity } },
      }),
    );
    const gains = plan.segments.map((s) => (s.kind === 'clip' ? s.gainDb : null));
    expect(gains).toEqual([10, 1.5, 0]);
  });

  it('rejects an export with no kept footage', () => {
    expect(() => buildPlan(input([]))).toThrow(/no clips/);
  });
});

describe('export sheet helpers', () => {
  it('defaults the aspect to the orientation with the most total duration', () => {
    const land = clip({ media: { duration: 10 } });
    const port = clip({ media: { width: 1080, height: 1920, duration: 25 } });
    expect(defaultAspect([land, port])).toBe('9:16');
    expect(defaultAspect([land])).toBe('16:9');
    expect(defaultAspect([clip({ media: { width: 1080, height: 1080 } })])).toBe('1:1');
    expect(defaultAspect([])).toBe('16:9');
  });

  it('summarizes mixed inputs, and collapses to one line when all clips match', () => {
    const mixed = [
      clip({ media: { hdr: true, fps: 30 } }),
      clip({ media: { width: 1080, height: 1920, fps: 59.94 } }),
      clip({ media: { width: 1080, height: 1080, fps: 30 } }),
    ];
    expect(inputSummary(mixed)).toBe('1 landscape · 1 portrait · 1 square — 1 HDR, 2 SDR — 30 fps ×2, 60 fps ×1');
    const same = [clip({ media: { width: 3840, height: 2160 } }), clip({ media: { width: 3840, height: 2160 } })];
    expect(inputSummary(same)).toBe('All landscape, 4K, 30 fps');
  });
});
