import { describe, expect, it } from 'vitest';
import { assembleArgs, encoderProbeArgs, loudnessArgs, proxyArgs, rotateFilter, segmentArgs, stripArgs } from '../src/ffmpeg-args.ts';
import type { ClipSegment, Plan, TitleSegment } from '../src/plan.ts';

const fonts = { latin: '/fonts/NotoSans-Regular.ttf', cjk: '/fonts/NotoSansCJK-Regular.ttc' };

const basePlan = (over: Partial<Plan> = {}): Plan => ({
  canvas: { width: 1920, height: 1080 },
  fps: 30,
  hdr: false,
  preset: 'compatible',
  fill: 'blur',
  segments: [],
  offsets: [],
  totalDuration: 0,
  filename: 'x.mp4',
  ...over,
});

const seg = (over: Partial<ClipSegment> = {}): ClipSegment => ({
  kind: 'clip',
  clipId: 'a',
  source: '/data/session/clips/a/original.mov',
  start: 1.5,
  duration: 6,
  hdr: false,
  hasAudio: true,
  gainDb: 3.2,
  overlay: { place: 'Kyoto, Japan', date: '29 Oct 2026', duration: 4 },
  ...over,
});

const texts = { line1: '/r/0-place.txt', line2: '/r/0-date.txt' };

describe('segmentArgs', () => {
  it('normalizes an SDR clip with blur fill, overlay and gain', () => {
    const args = segmentArgs(seg(), basePlan(), { out: '/r/0.mkv', fonts, texts });
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6)).toEqual(['-ss', '1.5', '-t', '6', '-i', seg().source]);
    expect(args).toMatchSnapshot();
  });

  it('tone-maps HDR to SDR, uses bars, and adds silence for a clip without audio', () => {
    const args = segmentArgs(
      seg({ hdr: true, colorTransfer: 'arib-std-b67', hasAudio: false, overlay: null }),
      basePlan({ fill: 'bars', canvas: { width: 1080, height: 1920 } }),
      { out: '/r/1.mkv', fonts, texts: {} },
    );
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('tonemap=tonemap=hable');
    expect(graph).toContain('pad=1080:1920');
    expect(graph).not.toContain('drawtext');
    expect(args).toContain('anullsrc=r=48000:cl=stereo');
    expect(args).toMatchSnapshot();
  });

  it('keeps HLG HDR in 10-bit when the plan is HDR', () => {
    const args = segmentArgs(seg({ hdr: true, colorTransfer: 'arib-std-b67', overlay: null }), basePlan({ hdr: true, preset: 'original' }), {
      out: '/r/2.mkv',
      fonts,
      texts: {},
    });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).not.toContain('tonemap');
    expect(graph).toContain('format=yuv420p10le');
    expect(args).toContain('arib-std-b67');
  });

  it('picks the CJK font for non-Latin place names', () => {
    const args = segmentArgs(seg({ overlay: { place: '京都市, 日本', duration: 4 } }), basePlan(), {
      out: '/r/3.mkv',
      fonts,
      texts: { line1: '/r/3-place.txt' },
    });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("fontfile='/fonts/NotoSansCJK-Regular.ttc'");
    expect(graph.match(/drawtext/g)).toHaveLength(1);
  });

  it('renders a title card on black with the date range below', () => {
    const title: TitleSegment = { kind: 'title', duration: 3, title: 'Kyoto trip', subtitle: '12 – 18 Oct 2026' };
    const args = segmentArgs(title, basePlan(), { out: '/r/t.mkv', fonts, texts: { line1: '/r/t-title.txt', line2: '/r/t-sub.txt' } });
    expect(args).toMatchSnapshot();
  });
});

describe('assembleArgs', () => {
  it('chains xfade and acrossfade with the planned offsets and encodes the compatible preset', () => {
    const plan = basePlan({ offsets: [5.5, 9] });
    expect(assembleArgs(['/r/0.mkv', '/r/1.mkv', '/r/2.mkv'], plan, '/out/x.mp4')).toMatchSnapshot();
  });

  it('encodes a single segment as HDR HEVC for the original preset, tagging the frames', () => {
    const args = assembleArgs(['/r/0.mkv'], basePlan({ hdr: true, preset: 'original' }), '/out/x.mp4');
    expect(args).not.toContain('xfade');
    expect(args).toEqual(expect.arrayContaining(['libx265', 'hvc1', 'yuv420p10le', '256k', '+faststart', '0:a']));
    expect(args.join(' ')).toContain('transfer=arib-std-b67');
    expect(args.join(' ')).toContain('[0:v]format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc[vout]');
  });

  it.each([
    ['videotoolbox', 'compatible'],
    ['videotoolbox', 'original'],
    ['nvenc', 'compatible'],
    ['nvenc', 'original'],
    ['vaapi', 'compatible'],
    ['vaapi', 'original'],
  ] as const)('encodes with %s for the %s preset', (kind, preset) => {
    const plan = basePlan({ offsets: [5.5], preset });
    const enc = kind === 'vaapi' ? { kind, device: '/dev/dri/renderD128' } : { kind };
    expect(assembleArgs(['/r/0.mkv', '/r/1.mkv'], plan, '/out/x.mp4', enc)).toMatchSnapshot();
  });
});

describe('encoderProbeArgs', () => {
  it('test-encodes a generated picture through the same tail and codec options', () => {
    expect(encoderProbeArgs({ kind: 'vaapi', device: '/dev/dri/renderD129' }, 'original')).toEqual([
      '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
      '-vaapi_device', '/dev/dri/renderD129',
      '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=0.5',
      '-filter_complex', '[0:v]format=p010,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,hwupload[v]',
      '-map', '[v]',
      '-c:v', 'hevc_vaapi', '-qp', '22', '-profile:v', 'main10', '-tag:v', 'hvc1',
      '-f', 'null', '-',
    ]);
  });
});

describe('ingest and loudness args', () => {
  it('builds proxy, filmstrip and loudness commands', () => {
    expect(proxyArgs('/c/original.mov', { width: 1080, height: 1920, hdr: true, colorTransfer: 'arib-std-b67' }, '/c/proxy.mp4')).toMatchSnapshot();
    expect(stripArgs('/c/proxy.mp4', 12, '/c/strip.jpg')).toMatchSnapshot();
    expect(
      loudnessArgs('/c/original.mov', [
        { start: 0, end: 2 },
        { start: 5, end: 8 },
      ]),
    ).toMatchSnapshot();
  });
});

describe('manual rotation', () => {
  it('maps clockwise quarter turns to transpose/flip filters', () => {
    expect([0, 90, 180, 270, undefined].map((r) => rotateFilter(r as 0 | undefined))).toEqual([
      null,
      'transpose=clock',
      'hflip,vflip',
      'transpose=cclock',
      null,
    ]);
  });

  it('turns a segment right after resetting its timestamps', () => {
    const graph = (r: 90 | 270) => segmentArgs(seg({ rotate: r }), basePlan(), { out: '/r/0.mkv', fonts, texts }).join(' ');
    expect(segmentArgs(seg({ rotate: 90 }), basePlan(), { out: '/r/0.mkv', fonts, texts })).toMatchSnapshot();
    expect(graph(90)).toContain('[0:v]setpts=PTS-STARTPTS,transpose=clock,fps=30');
    expect(graph(270)).toContain('[0:v]setpts=PTS-STARTPTS,transpose=cclock,fps=30');
  });

  it('turns the filmstrip', () => {
    expect(stripArgs('/c/proxy.mp4', 12, '/c/strip.jpg', 270)).toMatchSnapshot();
    expect(stripArgs('/c/proxy.mp4', 12, '/c/strip.jpg', 0)).toEqual(stripArgs('/c/proxy.mp4', 12, '/c/strip.jpg'));
  });
});
