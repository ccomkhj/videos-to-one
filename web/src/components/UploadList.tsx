import type { Upload } from '../uploads.ts';

export function UploadList({ uploads, retry, dismiss }: { uploads: Upload[]; retry: (k: string) => void; dismiss: (k: string) => void }) {
  if (uploads.length === 0) return null;
  return (
    <ul className="uploads">
      {uploads.map((u) => (
        <li key={u.key} className={`upload ${u.status}`}>
          <span className="name">{u.file.name}</span>
          {u.status === 'failed' ? (
            <>
              <span className="error">{u.error}</span>
              <button className="btn small" onClick={() => retry(u.key)}>
                Retry
              </button>
              <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(u.key)}>
                ✕
              </button>
            </>
          ) : (
            <>
              <span className="pct">{u.status === 'queued' ? 'Waiting' : `${Math.round(u.progress * 100)}%`}</span>
              <progress max={1} value={u.progress} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
