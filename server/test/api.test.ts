/**
 * End-to-end through the HTTP API with real ffmpeg and synthetic clips.
 * The geocoder is faked; everything else is the production code path.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Clip, SessionSnapshot } from '@vto/shared';
import { buildApp, type App } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { candidates, detectEncoders, SOFTWARE } from '../src/encoders.ts';
import { encoderProbeArgs } from '../src/ffmpeg-args.ts';
import { run } from '../src/ffmpeg.ts';
import type { RenderSummary } from '../src/render.ts';
import { ffprobeJson, makeClips, type SynthClip } from './helpers/synth.ts';

// The hardware encoder this machine has (VideoToolbox on a Mac), if any.
const hardware = await detectEncoders(candidates(process.platform, 'auto', '/dev/dri/renderD128'), (enc, preset) =>
  run('ffmpeg', encoderProbeArgs(enc, preset)).then(
    () => true,
    () => false,
  ),
);

let root: string;
let app: App;
let base: string;
let clips: ReturnType<typeof makeClips>;
const placesAsked: Array<{ lat: number; lon: number }> = [];

async function upload(c: SynthClip, lastModified?: number): Promise<Clip> {
  const form = new FormData();
  if (lastModified) form.append('lastModified', String(lastModified));
  form.append('file', new Blob([readFileSync(c.file)]), c.name);
  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: form });
  expect(res.status).toBe(201);
  return (await res.json()) as Clip;
}

const session = async () => (await (await fetch(`${base}/api/session`)).json()) as SessionSnapshot;
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'vto-'));
  clips = makeClips(mkdtempSync(path.join(root, 'src-')));
  const config = loadConfig({ DATA_DIR: path.join(root, 'data'), TZ: 'Europe/Berlin', PUBLIC_HOST: '192.168.1.23', PORT: '8080', WEB_DIST: '/nonexistent', ORIENTATION: 'off' });
  app = await buildApp(config, {
    geocoder: {
      placeAt: async (loc) => {
        placesAsked.push(loc);
        return loc.lat > 40 ? 'Paris, France' : 'Kyoto, Japan';
      },
    },
    tzAt: (loc) => (loc.lat > 40 ? 'Europe/Paris' : 'Asia/Tokyo'),
  });
  await app.server.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('ingest', () => {
  it('reports the phone URL from PUBLIC_HOST', async () => {
    const info = await (await fetch(`${base}/api/info`)).json();
    expect(info).toMatchObject({ phoneUrl: 'http://192.168.1.23:8080', geocoder: 'nominatim' });
  });

  it('uploads, analyzes and sorts clips by recording time', async () => {
    const lastModified = Date.UTC(2026, 6, 15, 12, 0, 0);
    await upload(clips.paris);
    await upload(clips.rotatedNoMeta, lastModified);
    await upload(clips.kyoto);
    await app.ingest.idle();

    const s = await session();
    expect(s.clips.map((c) => c.filename)).toEqual(['IMG_0001.MOV', 'paris.mp4', 'rotated.mp4']);
    expect(s.clips.every((c) => c.status === 'ready')).toBe(true);

    const [kyoto, paris, rotated] = s.clips as [Clip, Clip, Clip];
    expect(kyoto).toMatchObject({
      place: 'Kyoto, Japan',
      recordedAt: { local: '2026-07-13T09:00:00', source: 'quicktime' },
      media: { width: 720, height: 1280, fps: 60, hasAudio: false },
    });
    expect(paris).toMatchObject({
      place: 'Paris, France',
      recordedAt: { local: '2026-07-14T12:00:00', source: 'creation_time+gps' },
      media: { width: 1280, height: 720, hasAudio: true },
    });
    expect(rotated.place).toBeUndefined();
    expect(rotated).toMatchObject({
      recordedAt: { local: '2026-07-15T14:00:00', source: 'lastModified' },
      media: { width: 360, height: 640, rotation: 270 },
    });
    expect(paris.segments).toEqual([{ start: 0, end: paris.media!.duration, removed: false }]);
  });

  it('serves the proxy with range requests and the filmstrip', async () => {
    const [kyoto] = (await session()).clips;
    const proxy = await fetch(`${base}/api/clips/${kyoto!.id}/proxy.mp4`, { headers: { range: 'bytes=0-99' } });
    expect(proxy.status).toBe(206);
    expect((await proxy.arrayBuffer()).byteLength).toBe(100);
    const strip = await fetch(`${base}/api/clips/${kyoto!.id}/strip.jpg`);
    expect(strip.status).toBe(200);
    expect(strip.headers.get('content-type')).toMatch(/image\/jpeg/);
  });

  it('marks a non-video upload as an error without affecting the others', async () => {
    const bad = path.join(root, 'notes.txt');
    await writeFile(bad, 'not a video');
    const clip = await upload({ file: bad, name: 'notes.mov' });
    await app.ingest.idle();
    const s = await session();
    expect(s.clips.find((c) => c.id === clip.id)).toMatchObject({ status: 'error', error: 'Not a playable video file' });
    await fetch(`${base}/api/clips/${clip.id}`, { method: 'DELETE' });
    expect((await session()).clips).toHaveLength(3);
  });
});

describe('editing and ordering', () => {
  it('stores cuts and rejects invalid ones', async () => {
    const paris = (await session()).clips[1]!;
    const segments = [
      { start: 0, end: 1.5, removed: false },
      { start: 1.5, end: 2.5, removed: true },
      { start: 2.5, end: 4, removed: false },
    ];
    const ok = await fetch(`${base}/api/clips/${paris.id}`, json('PATCH', { segments }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Clip).segments).toEqual(segments);

    const bad = await fetch(`${base}/api/clips/${paris.id}`, json('PATCH', { segments: [{ start: 0, end: 0.4, removed: false }] }));
    expect(bad.status).toBe(400);
  });

  it('stores a manual rotation, rejects invalid ones, and regenerates the filmstrip', async () => {
    const paris = (await session()).clips[1]!;
    const stripWidth = async () => {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', path.join(app.store.clipDir(paris.id), 'strip.jpg')]);
      return Number(stdout.trim());
    };
    const before = await stripWidth();

    const bad = await fetch(`${base}/api/clips/${paris.id}`, json('PATCH', { rotate: 45 }));
    expect(bad.status).toBe(400);

    const ok = await fetch(`${base}/api/clips/${paris.id}`, json('PATCH', { rotate: 90 }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Clip).rotate).toBe(90);
    await app.ingest.restrip(paris.id);
    const turned = app.store.get(paris.id)!;
    expect(turned.stripRev).toBeGreaterThanOrEqual(1);
    expect(turned.segments).toHaveLength(3); // cuts are untouched
    expect(await stripWidth()).toBeLessThan(before);

    await fetch(`${base}/api/clips/${paris.id}`, json('PATCH', { rotate: 0 }));
    await app.ingest.restrip(paris.id);
    expect(await stripWidth()).toBe(before);
  });

  it('dismisses an orientation suggestion', async () => {
    const paris = (await session()).clips[1]!;
    app.store.update(paris.id, { orientation: { suggested: 90, source: 'model', confidence: 0.9 } });
    const res = await fetch(`${base}/api/clips/${paris.id}`, json('PATCH', { dismissSuggestion: true }));
    expect(((await res.json()) as Clip).orientation).toEqual({ suggested: 90, source: 'model', confidence: 0.9, dismissed: true });
    expect((await fetch(`${base}/api/clips/${paris.id}`, json('PATCH', {}))).status).toBe(400);
  });

  it('keeps a manual order, appends new uploads after it, and re-sorts by date', async () => {
    const ids = (await session()).clips.map((c) => c.id);
    const reversed = [...ids].reverse();
    await fetch(`${base}/api/order`, json('PUT', { ids: reversed }));
    expect((await session()).clips.map((c) => c.id)).toEqual(reversed);

    const extra = await upload(clips.paris);
    await app.ingest.idle();
    let s = await session();
    expect(s.manualOrder).toBe(true);
    expect(s.clips.map((c) => c.id)).toEqual([...reversed, extra.id]);

    await fetch(`${base}/api/order`, json('PUT', { sort: 'date' }));
    s = await session();
    expect(s.manualOrder).toBe(false);
    expect(s.clips.map((c) => c.filename)).toEqual(['IMG_0001.MOV', 'paris.mp4', 'paris.mp4', 'rotated.mp4']);

    await fetch(`${base}/api/clips/${extra.id}`, { method: 'DELETE' });
  });

  it('pushes the session to SSE subscribers', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    ctrl.abort();
    const text = new TextDecoder().decode(value);
    expect(text.startsWith('data: ')).toBe(true);
    expect(JSON.parse(text.slice(6).trim()).clips).toHaveLength(3);
  });
});

describe('export', () => {
  it('renders the compatible preset with a title card, overlays, crossfades and cuts', async () => {
    const start = await fetch(`${base}/api/export`, json('POST', { aspect: '16:9', fill: 'blur', preset: 'compatible', title: 'Summer 100%' }));
    expect(start.status).toBe(202);
    const kyotoId = (await session()).clips[0]!.id;
    const del = await fetch(`${base}/api/clips/${kyotoId}`, { method: 'DELETE' });
    expect(del.status).toBe(409);
    const again = await fetch(`${base}/api/export`, json('POST', { aspect: '16:9', fill: 'blur', preset: 'compatible', title: '' }));
    expect(again.status).toBe(409);
    await app.renderer.settled();

    const s = await session();
    expect(s.render).toMatchObject({ state: 'done' });
    expect(s.lastOutput).toMatch(/^Summer 100%_\d{8}-\d{4}\.mp4$/);

    const res = await fetch(`${base}/api/export/latest`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const out = path.join(root, 'download.mp4');
    await writeFile(out, Buffer.from(await res.arrayBuffer()));

    // 3 s each at 60, 30 and 25 fps: the tie goes to the higher rate.
    const probe = ffprobeJson(out);
    const v = probe.streams.find((x: any) => x.codec_type === 'video');
    const a = probe.streams.find((x: any) => x.codec_type === 'audio');
    expect(v).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p', avg_frame_rate: '60/1' });
    // The title card comes first; its color tags must not be lost (it's generated, not decoded).
    expect(v).toMatchObject({ color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709' });
    expect(a).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 });
    // title 3 + kyoto 3 + paris (1.5 + 1.5) + rotated 3, minus 4 crossfades of 0.5 s
    expect(Number(probe.format.duration)).toBeCloseTo(10, 1);
    expect((await readdir(path.join(root, 'data', 'output')))).toContain(s.lastOutput);
    await expect(readdir(path.join(root, 'data', 'session', 'render'))).rejects.toThrow();
  });

  it('renders the original-quality preset as HEVC (hvc1) in the chosen aspect', async () => {
    await fetch(`${base}/api/export`, json('POST', { aspect: '9:16', fill: 'bars', preset: 'original', title: '' }));
    await app.renderer.settled();
    const s = await session();
    expect(s.render).toMatchObject({ state: 'done' });
    expect(s.lastOutput).toMatch(/^13 – 15 Jul 2026_/);
    const probe = ffprobeJson(path.join(root, 'data', 'output', s.lastOutput!));
    const v = probe.streams.find((x: any) => x.codec_type === 'video');
    expect(v).toMatchObject({ codec_name: 'hevc', codec_tag_string: 'hvc1', width: 1080, height: 1920, pix_fmt: 'yuv420p10le' });
    // kyoto 3 + paris (1.5 + 1.5) + rotated 3, minus 3 crossfades
    expect(Number(probe.format.duration)).toBeCloseTo(7.5, 1);
  });

  it.runIf(hardware.compatible.kind !== 'software')('renders with the hardware encoder when the OS has one', async () => {
    app.renderer.encoders = hardware;
    const finished = new Promise<RenderSummary>((resolve) => app.renderer.once('finished', resolve));
    await fetch(`${base}/api/export`, json('POST', { aspect: '16:9', fill: 'blur', preset: 'compatible', title: 'HW' }));
    await app.renderer.settled();
    app.renderer.encoders = SOFTWARE;
    expect((await session()).render).toMatchObject({ state: 'done' });
    expect((await finished).encoder).toBe(hardware.compatible.kind);
    const probe = ffprobeJson(path.join(root, 'data', 'output', (await session()).lastOutput!));
    const v = probe.streams.find((x: any) => x.codec_type === 'video');
    expect(v).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080, color_transfer: 'bt709' });
  });

  it('falls back to software when the hardware encoder fails on the real job', async () => {
    app.renderer.encoders = { compatible: { kind: 'vaapi', device: '/nonexistent' }, original: { kind: 'software' } };
    const finished = new Promise<RenderSummary>((resolve) => app.renderer.once('finished', resolve));
    await fetch(`${base}/api/export`, json('POST', { aspect: '16:9', fill: 'bars', preset: 'compatible', title: '' }));
    await app.renderer.settled();
    app.renderer.encoders = SOFTWARE;
    expect((await session()).render).toMatchObject({ state: 'done' });
    expect((await finished).encoder).toMatch(/^software \(vaapi \(\/nonexistent\) failed: /);
    const probe = ffprobeJson(path.join(root, 'data', 'output', (await session()).lastOutput!));
    expect(probe.streams.find((x: any) => x.codec_type === 'video')).toMatchObject({ codec_name: 'h264' });
  });

  it('cancels a running render and leaves no partial output', async () => {
    const before = await readdir(path.join(root, 'data', 'output'));
    await fetch(`${base}/api/export`, json('POST', { aspect: '1:1', fill: 'blur', preset: 'original', title: 'Cancelled' }));
    const res = await fetch(`${base}/api/export/cancel`, { method: 'POST' });
    expect(await res.json()).toEqual({ cancelled: true });
    await app.renderer.settled();
    expect((await session()).render).toEqual({ state: 'cancelled' });
    expect(await readdir(path.join(root, 'data', 'output'))).toEqual(before);
  });

  it('survives a restart: the session is reloaded from disk', async () => {
    await app.store.flush();
    const saved = JSON.parse(await readFile(path.join(root, 'data', 'session', 'session.json'), 'utf8'));
    expect(saved.clips).toHaveLength(3);
  });

  it('"Start over" clears the session but keeps finished videos', async () => {
    const res = await fetch(`${base}/api/session/reset`, { method: 'POST' });
    expect(((await res.json()) as SessionSnapshot).clips).toEqual([]);
    expect((await readdir(path.join(root, 'data', 'output'))).length).toBeGreaterThan(0);
    await expect(readdir(path.join(root, 'data', 'session', 'clips'))).rejects.toThrow();
  });
});
