import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFile } from './api.ts';

export interface Upload {
  key: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'failed';
  error?: string;
}

const CONCURRENCY = 2;

/** Upload queue: 2 at a time, per-file progress and retry (SPEC §6.3). */
export function useUploads() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const active = useRef(new Set<string>());

  const patch = (key: string, p: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)));

  const add = useCallback((files: Iterable<File>) => {
    const fresh = [...files]
      .filter((f) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|3gp|mkv|webm|avi|mts)$/i.test(f.name))
      .map((file) => ({ key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, progress: 0, status: 'queued' as const }));
    setUploads((list) => [...list, ...fresh]);
    return fresh.length;
  }, []);

  const retry = useCallback((key: string) => patch(key, { status: 'queued', progress: 0 }), []);
  const dismiss = useCallback((key: string) => setUploads((list) => list.filter((u) => u.key !== key)), []);

  useEffect(() => {
    const free = CONCURRENCY - active.current.size;
    const next = uploads.filter((u) => u.status === 'queued' && !active.current.has(u.key)).slice(0, Math.max(0, free));
    for (const u of next) {
      active.current.add(u.key);
      patch(u.key, { status: 'uploading' });
      const { promise } = uploadFile(u.file, (progress) => patch(u.key, { progress }));
      promise.then(
        () => {
          active.current.delete(u.key);
          setUploads((list) => list.filter((x) => x.key !== u.key));
        },
        (err: Error) => {
          active.current.delete(u.key);
          patch(u.key, { status: 'failed', error: err.message });
        },
      );
    }
  }, [uploads]);

  return { uploads, add, retry, dismiss };
}
