/** HTTP API (SPEC §6.3) + static web app. */
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  validateSegments,
  type AppInfo,
  type Aspect,
  type ExportOptions,
  type Fill,
  type LatLon,
  type Preset,
  type SessionSnapshot,
} from '@vto/shared';
import type { Config } from './config.ts';
import type { Encoders } from './encoders.ts';
import type { Geocoder } from './geocode.ts';
import { Ingest, originalPath } from './ingest.ts';
import { Renderer } from './render.ts';
import { SessionStore } from './session.ts';

export interface AppDeps {
  geocoder: Geocoder;
  tzAt: (loc: LatLon) => string | undefined;
  /** Final-encode backends from `detectEncoders`; software if omitted. */
  encoders?: Encoders;
}

export interface App {
  server: FastifyInstance;
  store: SessionStore;
  ingest: Ingest;
  renderer: Renderer;
}

const ASPECTS: Aspect[] = ['16:9', '9:16', '1:1'];
const FILLS: Fill[] = ['blur', 'bars'];
const PRESETS: Preset[] = ['compatible', 'original'];

export async function buildApp(config: Config, deps: AppDeps): Promise<App> {
  const sessionDir = path.join(config.dataDir, 'session');
  const outputDir = path.join(config.dataDir, 'output');
  const store = new SessionStore(sessionDir);
  await store.load();
  await mkdir(sessionDir, { recursive: true });

  const ingest = new Ingest({ store, geocoder: deps.geocoder, tzAt: deps.tzAt, timeZone: config.timeZone });
  const renderer = new Renderer({
    store,
    outputDir,
    fonts: config.fonts,
    timeZone: config.timeZone,
    ...(deps.encoders ? { encoders: deps.encoders } : {}),
  });

  // Clips interrupted by a restart are analyzed again.
  for (const clip of store.ordered()) if (clip.status === 'analyzing') ingest.enqueue(clip.id);

  const server = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  await server.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 ** 3, files: 1, fields: 5 } });
  await server.register(fastifyStatic, { root: config.webDist ?? sessionDir, serve: !!config.webDist, wildcard: false });

  const snapshot = (): SessionSnapshot => ({
    clips: store.ordered(),
    manualOrder: store.manualOrder,
    render: renderer.state,
    lastOutput: store.lastOutput,
  });

  // --- live updates -------------------------------------------------------
  const listeners = new Set<FastifyReply>();
  let pending: NodeJS.Timeout | null = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
      for (const reply of listeners) reply.raw.write(msg);
    }, 50);
  };
  store.on('change', broadcast);
  renderer.on('change', broadcast);

  server.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    listeners.add(reply);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      listeners.delete(reply);
    });
  });

  server.addHook('onClose', async () => {
    for (const reply of listeners) reply.raw.end();
    listeners.clear();
    renderer.cancel();
    await renderer.settled();
  });

  // --- session ------------------------------------------------------------
  server.get('/api/session', async () => snapshot());

  server.get('/api/info', async (): Promise<AppInfo> => ({
    phoneUrl: config.publicHost ? `http://${config.publicHost}:${config.port}` : null,
    version: config.version,
    geocoder: config.geocoder,
  }));

  server.post('/api/session/reset', async (_req, reply) => {
    if (renderer.running) return reply.code(409).send({ error: 'A render is running' });
    await store.reset();
    return snapshot();
  });

  // --- clips --------------------------------------------------------------
  server.post('/api/clips', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    const field = file.fields.lastModified as { value?: unknown } | undefined;
    const lastModified = Number(field?.value) || undefined;
    const id = randomUUID().slice(0, 12);
    const dir = store.clipDir(id);
    const generation = store.generation;
    await mkdir(dir, { recursive: true });
    const dest = originalPath(dir, file.filename);
    try {
      await pipeline(file.file, createWriteStream(dest));
      if (file.file.truncated) throw new Error('File too large');
      // "Start over" was pressed while this file was uploading.
      if (store.generation !== generation) throw new Error('The session was cleared during the upload');
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Upload failed' });
    }
    const clip = store.add({
      id,
      filename: path.basename(file.filename),
      status: 'analyzing',
      segments: [],
      ...(lastModified ? { lastModified } : {}),
    });
    ingest.enqueue(id);
    return reply.code(201).send(clip);
  });

  server.delete<{ Params: { id: string } }>('/api/clips/:id', async (req, reply) => {
    if (renderer.running) return reply.code(409).send({ error: 'Clips can be removed once the render finishes' });
    if (!(await store.remove(req.params.id))) return reply.code(404).send({ error: 'No such clip' });
    return snapshot();
  });

  server.patch<{ Params: { id: string }; Body: { segments?: unknown } }>('/api/clips/:id', async (req, reply) => {
    const clip = store.get(req.params.id);
    if (!clip) return reply.code(404).send({ error: 'No such clip' });
    if (!clip.media) return reply.code(409).send({ error: 'Clip is still being analyzed' });
    const error = validateSegments(req.body?.segments, clip.media.duration);
    if (error) return reply.code(400).send({ error });
    return store.update(clip.id, { segments: req.body.segments as typeof clip.segments });
  });

  server.put<{ Body: { ids?: unknown; sort?: unknown } }>('/api/order', async (req, reply) => {
    const body = req.body ?? {};
    if (body.sort === 'date') store.sortByDate();
    else if (Array.isArray(body.ids) && body.ids.every((x) => typeof x === 'string')) store.setOrder(body.ids);
    else return reply.code(400).send({ error: 'Send {ids: string[]} or {sort: "date"}' });
    return snapshot();
  });

  const clipFile = (name: string, type: string) =>
    server.get<{ Params: { id: string } }>(`/api/clips/:id/${name}`, (req, reply) => {
      const dir = store.clipDir(path.basename(req.params.id));
      if (!store.get(req.params.id) || !existsSync(path.join(dir, name))) return reply.code(404).send({ error: 'Not found' });
      reply.type(type);
      return reply.sendFile(name, dir);
    });
  clipFile('proxy.mp4', 'video/mp4');
  clipFile('strip.jpg', 'image/jpeg');

  // --- export -------------------------------------------------------------
  server.post<{ Body: Partial<ExportOptions> }>('/api/export', async (req, reply) => {
    const b = req.body ?? {};
    if (!ASPECTS.includes(b.aspect as Aspect) || !FILLS.includes(b.fill as Fill) || !PRESETS.includes(b.preset as Preset)) {
      return reply.code(400).send({ error: 'Invalid export options' });
    }
    const options: ExportOptions = {
      aspect: b.aspect as Aspect,
      fill: b.fill as Fill,
      preset: b.preset as Preset,
      title: typeof b.title === 'string' ? Array.from(b.title).slice(0, 120).join('') : '',
    };
    try {
      renderer.start(options);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : 'Cannot start render' });
    }
    return reply.code(202).send(renderer.state);
  });

  server.post('/api/export/cancel', async () => ({ cancelled: renderer.cancel() }));

  server.get('/api/export/latest', (_req, reply) => {
    const name = store.lastOutput;
    if (!name || !existsSync(path.join(outputDir, name))) return reply.code(404).send({ error: 'Nothing exported yet' });
    reply.header('Content-Disposition', `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    reply.type('video/mp4');
    return reply.sendFile(name, outputDir);
  });

  // --- web app ------------------------------------------------------------
  server.setNotFoundHandler((req, reply) => {
    if (config.webDist && req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });

  return { server, store, ingest, renderer };
}

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
