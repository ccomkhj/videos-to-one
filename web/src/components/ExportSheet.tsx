import { useState } from 'react';
import { defaultAspect, inputSummary, originalGains, type Aspect, type Fill, type Preset, type SessionSnapshot } from '@vto/shared';
import { api } from '../api.ts';

/** Export options, render progress and download (SPEC §4.3). */
export function ExportSheet({ session, onClose }: { session: SessionSnapshot; onClose: () => void }) {
  const ready = session.clips.filter((c) => c.status === 'ready');
  const [aspect, setAspect] = useState<Aspect>(() => defaultAspect(ready));
  const [fill, setFill] = useState<Fill>('blur');
  const [preset, setPreset] = useState<Preset>('compatible');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const render = session.render;
  const pending = session.clips.length - ready.length;
  const gains = originalGains(ready, aspect);

  const start = async () => {
    setError(null);
    setAgain(false);
    try {
      await api.startExport({ aspect, fill, preset, title });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="modal sheet-backdrop" onClick={(e) => e.target === e.currentTarget && render.state !== 'running' && onClose()}>
      <div className="sheet" role="dialog" aria-label="Export">
        <header className="modal-head">
          <strong>Export</strong>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {render.state === 'running' ? (
          <div className="render-progress">
            <p>{render.step}…</p>
            <progress max={1} value={render.progress} />
            <p className="muted">
              {Math.round(render.progress * 100)}%{render.etaSec !== null ? ` · about ${formatEta(render.etaSec)} left` : ''}
            </p>
            <button className="btn" onClick={() => api.cancelExport()}>
              Cancel
            </button>
          </div>
        ) : render.state === 'done' && session.lastOutput && !again ? (
          <div className="render-done">
            <p>
              Your video is ready: <strong>{session.lastOutput}</strong>
            </p>
            <a className="btn primary big wide" href="/api/export/latest" download={session.lastOutput}>
              Download
            </a>
            <p className="muted small">A copy is saved in the output folder on the computer.</p>
            <button className="btn link" onClick={() => setAgain(true)}>
              Change options and render again
            </button>
          </div>
        ) : (
          <div className="export-form">
            <p className="summary">{inputSummary(ready)}</p>
            {pending > 0 && <p className="muted small">{pending} clip(s) still processing or failed; they won't be included.</p>}

            <Choice
              label="Aspect"
              value={aspect}
              onChange={setAspect}
              options={[
                ['16:9', '16:9 landscape'],
                ['9:16', '9:16 portrait'],
                ['1:1', '1:1 square'],
              ]}
            />
            <Choice
              label="Fill"
              value={fill}
              onChange={setFill}
              options={[
                ['blur', 'Blur'],
                ['bars', 'Black bars'],
              ]}
            />
            <Choice
              label="Quality"
              value={preset}
              onChange={setPreset}
              options={[
                ['compatible', 'Compatible 1080p'],
                ['original', 'Original quality (slow)'],
              ]}
            />
            {preset === 'original' && ready.length > 0 && !gains.resolution && !gains.hdr && (
              <p className="muted small">
                For these clips, Original quality looks the same as Compatible: 1080p, not HDR. Only the file is
                smaller (HEVC), and some older devices can't play it.
              </p>
            )}
            <label className="field">
              <span>Title (optional)</span>
              <input value={title} maxLength={120} placeholder="No title card" onChange={(e) => setTitle(e.target.value)} />
            </label>

            {render.state === 'error' && <p className="error">Render failed: {render.message}</p>}
            {render.state === 'cancelled' && <p className="muted">Render cancelled.</p>}
            {error && <p className="error">{error}</p>}

            <button className="btn primary big wide" disabled={ready.length === 0} onClick={start}>
              Render
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <fieldset className="choice">
      <legend>{label}</legend>
      <div className="segmented">
        {options.map(([v, text]) => (
          <button key={v} type="button" className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function formatEta(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  return `${Math.round(sec / 60)} min`;
}
