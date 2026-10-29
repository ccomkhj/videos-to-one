/** Runs ffmpeg/ffprobe as child processes (SPEC §6.1). */
import { spawn } from 'node:child_process';
import type { KeepRange } from '@vto/shared';
import { loudnessArgs, probeArgs } from './ffmpeg-args.ts';
import type { ProbeJson } from './metadata.ts';
import type { Loudness } from './plan.ts';

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

export interface RunOptions {
  /** Called with seconds of output written, from `-progress pipe:1`. */
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal;
}

export function run(cmd: 'ffmpeg' | 'ffprobe', args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError());
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let partial = '';
    const onAbort = () => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (!opts.onProgress) {
        stdout += text;
        return;
      }
      const lines = (partial + text).split('\n');
      partial = lines.pop()!;
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m) opts.onProgress(Number(m[1]) / 1e6);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return reject(new CancelledError());
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

export async function probe(src: string): Promise<ProbeJson> {
  const { stdout } = await run('ffprobe', probeArgs(src));
  return JSON.parse(stdout) as ProbeJson;
}

export async function measureLoudness(src: string, ranges: readonly KeepRange[], signal?: AbortSignal): Promise<Loudness> {
  const { stderr } = await run('ffmpeg', loudnessArgs(src, ranges), signal ? { signal } : {});
  const json = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  const parsed = JSON.parse(json) as { input_i: string; input_tp: string };
  const num = (s: string) => (s === '-inf' ? -Infinity : Number(s));
  return { i: num(parsed.input_i), tp: num(parsed.input_tp) };
}

/** Runs ffmpeg and returns stdout as raw bytes (decoded frames for orientation detection). */
export function runBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-16_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}
