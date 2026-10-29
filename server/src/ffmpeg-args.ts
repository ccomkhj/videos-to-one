/**
 * Argument builders for every ffmpeg call (SPEC §6.4). Pure, so the generated
 * filter graphs can be snapshot-tested; `ffmpeg.ts` runs them.
 */
import type { KeepRange, MediaInfo, Preset } from '@vto/shared';
import type { Encoder } from './encoders.ts';
import { CROSSFADE, HLG, type Plan, type PlanSegment } from './plan.ts';

export interface Fonts {
  latin: string;
  cjk: string;
}

export interface SegmentContext {
  out: string;
  fonts: Fonts;
  /** Text files for drawtext: overlay place/date, or title/subtitle. */
  texts: { line1?: string; line2?: string };
}

const BASE = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
const PROGRESS = ['-progress', 'pipe:1', '-nostats'];
const n = (x: number) => String(Math.round(x * 1000) / 1000);

/** Quote a value for an ffmpeg filter-graph option. */
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "'\\\\''").replace(/:/g, '\\:')}'`;

const NON_LATIN = /[^\u0000-ɏḀ-ỿ -⁯₠-⃏]/;
export const fontFor = (text: string, fonts: Fonts) => (NON_LATIN.test(text) ? fonts.cjk : fonts.latin);

export function probeArgs(src: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src];
}

/** HDR (HLG/PQ) → SDR BT.709 (SPEC R3: one well-tested zscale + tonemap chain). */
export function tonemapChain(transfer: string | undefined): string {
  const tin = transfer === 'smpte2084' ? 'smpte2084' : HLG;
  return [
    `zscale=tin=${tin}:pin=bt2020:min=bt2020nc:t=linear:npl=100`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
  ].join(',');
}

/** Tags the frames themselves: generated frames (title card) carry none, and the encoder follows the frames. */
const colorParams = (hdr: boolean) =>
  hdr
    ? `setparams=color_primaries=bt2020:color_trc=${HLG}:colorspace=bt2020nc`
    : 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709';

const colorFlags = (hdr: boolean) =>
  hdr
    ? ['-color_primaries', 'bt2020', '-color_trc', HLG, '-colorspace', 'bt2020nc']
    : ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];

/** 720p SDR H.264 with a 1 s GOP for fast seeking in the editor. */
export function proxyArgs(src: string, media: Pick<MediaInfo, 'width' | 'height' | 'hdr' | 'colorTransfer'>, out: string): string[] {
  const scale = media.width >= media.height ? "scale=-2:'min(720,ih)'" : "scale='min(720,iw)':-2";
  const vf = [media.hdr ? tonemapChain(media.colorTransfer) : null, scale, 'format=yuv420p'].filter(Boolean).join(',');
  return [
    ...BASE,
    '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-movflags', '+faststart',
    out,
  ];
}

/** Ten thumbnails side by side, read from the (already SDR) proxy. */
export function stripArgs(proxy: string, duration: number, out: string): string[] {
  return [
    ...BASE,
    '-i', proxy,
    '-vf', `fps=${n(10 / Math.max(duration, 0.1))},scale=-2:120,tile=10x1`,
    '-frames:v', '1', '-q:v', '4',
    out,
  ];
}

/** Integrated loudness and true peak over a clip's kept parts; result is JSON on stderr. */
export function loudnessArgs(src: string, ranges: readonly KeepRange[]): string[] {
  const inputs = ranges.flatMap((r) => ['-ss', n(r.start), '-t', n(r.end - r.start), '-i', src]);
  const measure = 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json';
  const graph =
    ranges.length === 1
      ? `[0:a]${measure}[m]`
      : `${ranges.map((_, i) => `[${i}:a]`).join('')}concat=n=${ranges.length}:v=0:a=1,${measure}[m]`;
  return ['-hide_banner', '-nostdin', '-vn', ...inputs, '-filter_complex', graph, '-map', '[m]', '-f', 'null', '-'];
}

function fillChain(plan: Plan): string {
  const { width: W, height: H } = plan.canvas;
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
  if (plan.fill === 'bars') return `${fit},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const w4 = Math.round(W / 4);
  const h4 = Math.round(H / 4);
  return (
    `split=2[bg][fg];` +
    `[bg]scale=${w4}:${h4}:force_original_aspect_ratio=increase,crop=${w4}:${h4},gblur=sigma=12,eq=brightness=-0.12,scale=${W}:${H},setsar=1[bgb];` +
    `[fg]${fit}[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2`
  );
}

interface TextLine {
  file: string;
  text: string;
  size: number;
  x: string;
  y: string;
}

function drawtext(line: TextLine, fonts: Fonts, shadow: number, fade: number | null): string {
  const opts = [
    `fontfile=${q(fontFor(line.text, fonts))}`,
    `textfile=${q(line.file)}`,
    'expansion=none',
    'fontcolor=white',
    `fontsize=${line.size}`,
    `x=${line.x}`,
    `y=${line.y}`,
    'shadowcolor=black@0.55',
    `shadowx=${shadow}`,
    `shadowy=${shadow}`,
  ];
  if (fade !== null) {
    // 0.3 s fade in, hold, 0.5 s fade out ending at `fade` seconds.
    opts.push(`alpha='if(lt(t,0.3),t/0.3,if(lt(t,${n(fade - 0.5)}),1,max(0,(${n(fade)}-t)/0.5)))'`);
    opts.push(`enable='lt(t,${n(fade)})'`);
  }
  return `drawtext=${opts.join(':')}`;
}

/** Overlay (bottom-left of the canvas, SPEC §5.4) or title-card text. */
function textChain(seg: PlanSegment, plan: Plan, ctx: SegmentContext): string[] {
  const { width: W, height: H } = plan.canvas;
  const short = Math.min(W, H);
  const shadow = Math.max(1, Math.round(short / 540));
  const { line1, line2 } = ctx.texts;

  if (seg.kind === 'title') {
    const s1 = Math.round(short * 0.07);
    const s2 = Math.round(short * 0.035);
    const out: string[] = [];
    if (line1) {
      const y = seg.subtitle && line2 ? `(h-text_h)/2-${Math.round(s2 * 0.9)}` : '(h-text_h)/2';
      out.push(drawtext({ file: line1, text: seg.title, size: s1, x: '(w-text_w)/2', y }, ctx.fonts, shadow, null));
    }
    if (seg.subtitle && line2) {
      const y = `(h/2)+${Math.round(s1 * 0.6)}`;
      out.push(drawtext({ file: line2, text: seg.subtitle, size: s2, x: '(w-text_w)/2', y }, ctx.fonts, shadow, null));
    }
    return out;
  }

  const ov = seg.overlay;
  if (!ov) return [];
  const margin = Math.round(short * 0.04);
  const s1 = Math.round(short * 0.045);
  const s2 = Math.round(short * 0.034);
  const out: string[] = [];
  const dateY = H - margin - s2;
  if (ov.place && line1) {
    const y = ov.date ? dateY - Math.round(s1 * 1.35) : H - margin - s1;
    out.push(drawtext({ file: line1, text: ov.place, size: s1, x: String(margin), y: String(y) }, ctx.fonts, shadow, ov.duration));
  }
  if (ov.date && line2) {
    out.push(drawtext({ file: line2, text: ov.date, size: s2, x: String(margin), y: String(dateY) }, ctx.fonts, shadow, ov.duration));
  }
  return out;
}

/** Normalize one segment (or the title card) into a high-quality intermediate (SPEC §6.4 step 2–3). */
export function segmentArgs(seg: PlanSegment, plan: Plan, ctx: SegmentContext): string[] {
  const { width: W, height: H } = plan.canvas;
  const d = n(seg.duration);
  const pix = plan.hdr ? 'yuv420p10le' : 'yuv420p';
  const audioFmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const silence = ['-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=48000:cl=stereo'];

  let inputs: string[];
  let video: string;
  let audio: string;
  if (seg.kind === 'title') {
    inputs = ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${plan.fps}:d=${d}`, ...silence];
    video = ['[0:v]setsar=1', ...textChain(seg, plan, ctx), `format=${pix}`, `${colorParams(plan.hdr)}[v]`].join(',');
    audio = `[1:a]${audioFmt}[a]`;
  } else {
    inputs = ['-ss', n(seg.start), '-t', d, '-i', seg.source, ...(seg.hasAudio ? [] : silence)];
    const tonemap = seg.hdr && !plan.hdr ? [tonemapChain(seg.colorTransfer)] : [];
    video = [
      '[0:v]setpts=PTS-STARTPTS',
      ...tonemap,
      `fps=${plan.fps}`,
      'tpad=stop_mode=clone:stop_duration=1',
      fillChain(plan),
      ...textChain(seg, plan, ctx),
      `format=${pix}`,
      `${colorParams(plan.hdr)}[v]`,
    ].join(',');
    const gain = seg.gainDb !== 0 ? `,volume=${n(seg.gainDb)}dB` : '';
    audio = seg.hasAudio ? `[0:a]asetpts=PTS-STARTPTS,${audioFmt}${gain},apad[a]` : `[1:a]${audioFmt}[a]`;
  }

  return [
    ...BASE,
    ...inputs,
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-t', d,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', pix,
    ...colorFlags(plan.hdr),
    '-c:a', 'pcm_s16le',
    ...PROGRESS,
    '-f', 'matroska', ctx.out,
  ];
}

interface VideoEncode {
  /** Global options before the inputs. */
  pre: string[];
  /** Filters ending the video graph: pixel format, color tags, upload to the GPU if needed. */
  tail: string;
  codec: string[];
}

/** Final video encoder settings per backend; quality targets roughly match x264/x265 CRF 20. */
export function videoEncode(encoder: Encoder, preset: Preset, hdr: boolean): VideoEncode {
  const hevc = preset === 'original';
  const tail = (pix: string, upload = false) => [`format=${pix}`, colorParams(hdr), ...(upload ? ['hwupload'] : [])].join(',');
  switch (encoder.kind) {
    case 'software':
      return {
        pre: [],
        tail: tail(hevc ? 'yuv420p10le' : 'yuv420p'),
        codec: hevc
          ? [
              '-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
              '-x265-params',
              hdr ? `log-level=error:colorprim=bt2020:transfer=${HLG}:colormatrix=bt2020nc` : 'log-level=error',
            ]
          : ['-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-crf', '20', '-pix_fmt', 'yuv420p'],
      };
    case 'videotoolbox':
      return {
        pre: [],
        tail: tail(hevc ? 'p010le' : 'yuv420p'),
        codec: hevc
          ? ['-c:v', 'hevc_videotoolbox', '-q:v', '65', '-profile:v', 'main10', '-pix_fmt', 'p010le', '-tag:v', 'hvc1']
          : ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
      };
    case 'nvenc': {
      const rc = ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0'];
      return {
        pre: [],
        tail: tail(hevc ? 'p010le' : 'yuv420p'),
        codec: hevc
          ? ['-c:v', 'hevc_nvenc', ...rc, '-profile:v', 'main10', '-pix_fmt', 'p010le', '-tag:v', 'hvc1']
          : ['-c:v', 'h264_nvenc', ...rc, '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
      };
    }
    case 'vaapi':
      return {
        pre: ['-vaapi_device', encoder.device ?? '/dev/dri/renderD128'],
        tail: tail(hevc ? 'p010' : 'nv12', true),
        codec: hevc
          ? ['-c:v', 'hevc_vaapi', '-qp', '22', '-profile:v', 'main10', '-tag:v', 'hvc1']
          : ['-c:v', 'h264_vaapi', '-qp', '22', '-profile:v', 'high'],
      };
  }
}

/** A half-second test encode: does this encoder work here for this preset? */
export function encoderProbeArgs(encoder: Encoder, preset: Preset): string[] {
  const enc = videoEncode(encoder, preset, false);
  return [
    ...BASE,
    ...enc.pre,
    '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=0.5',
    '-filter_complex', `[0:v]${enc.tail}[v]`,
    '-map', '[v]',
    ...enc.codec,
    '-f', 'null', '-',
  ];
}

/** Crossfade the intermediates together and encode the final MP4 (SPEC §6.4 step 4). */
export function assembleArgs(inputs: readonly string[], plan: Plan, out: string, encoder: Encoder = { kind: 'software' }): string[] {
  const enc = videoEncode(encoder, plan.preset, plan.hdr);
  const ins = inputs.flatMap((f) => ['-i', f]);
  const parts: string[] = [];
  let v = '[0:v]';
  let a = '[0:a]';
  for (let i = 1; i < inputs.length; i++) {
    const last = i === inputs.length - 1;
    const vo = `[v${i}]`;
    const ao = last ? '[aout]' : `[a${i}]`;
    parts.push(`${v}[${i}:v]xfade=transition=fade:duration=${CROSSFADE}:offset=${n(plan.offsets[i - 1]!)}${vo}`);
    parts.push(`${a}[${i}:a]acrossfade=d=${CROSSFADE}:c1=tri:c2=tri${ao}`);
    v = vo;
    a = ao;
  }
  parts.push(`${v}${enc.tail}[vout]`);
  const map = ['-filter_complex', parts.join(';'), '-map', '[vout]', '-map', inputs.length === 1 ? '0:a' : '[aout]'];
  const audio = ['-c:a', 'aac', '-b:a', plan.preset === 'compatible' ? '192k' : '256k', '-ar', '48000', '-ac', '2'];

  return [...BASE, ...enc.pre, ...ins, ...map, ...enc.codec, ...colorFlags(plan.hdr), ...audio, '-movflags', '+faststart', ...PROGRESS, out];
}
