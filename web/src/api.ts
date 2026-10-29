import type { AppInfo, Clip, ExportOptions, Rotation, Segment, SessionSnapshot } from '@vto/shared';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  info: () => call<AppInfo>('GET', '/api/info'),
  session: () => call<SessionSnapshot>('GET', '/api/session'),
  deleteClip: (id: string) => call<SessionSnapshot>('DELETE', `/api/clips/${id}`),
  saveSegments: (id: string, segments: Segment[]) => call<Clip>('PATCH', `/api/clips/${id}`, { segments }),
  setRotate: (id: string, rotate: Rotation) => call<Clip>('PATCH', `/api/clips/${id}`, { rotate }),
  dismissSuggestion: (id: string) => call<Clip>('PATCH', `/api/clips/${id}`, { dismissSuggestion: true }),
  setOrder: (ids: string[]) => call<SessionSnapshot>('PUT', '/api/order', { ids }),
  sortByDate: () => call<SessionSnapshot>('PUT', '/api/order', { sort: 'date' }),
  reset: () => call<SessionSnapshot>('POST', '/api/session/reset'),
  startExport: (o: ExportOptions) => call<unknown>('POST', '/api/export', o),
  cancelExport: () => call<unknown>('POST', '/api/export/cancel'),
};

export const proxyUrl = (id: string) => `/api/clips/${id}/proxy.mp4`;
export const stripUrl = (id: string, rev?: number) => `/api/clips/${id}/strip.jpg${rev ? `?r=${rev}` : ''}`;

/** Upload one file with progress (fetch has no upload progress). */
export function uploadFile(file: File, onProgress: (fraction: number) => void): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('POST', '/api/clips');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Upload failed (${xhr.status})`;
      try {
        msg = JSON.parse(xhr.responseText).error ?? msg;
      } catch {}
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Connection lost'));
    xhr.onabort = () => reject(new Error('Cancelled'));
    const form = new FormData();
    form.append('lastModified', String(file.lastModified));
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
