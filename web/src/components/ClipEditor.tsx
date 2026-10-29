import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  formatDate,
  formatDuration,
  keptDuration,
  resetSegments,
  splitAt,
  toggleRemoved,
  trimEnd,
  trimStart,
  type Clip,
  type Rotation,
  type Segment,
} from '@vto/shared';
import { api, proxyUrl, stripUrl } from '../api.ts';

/** Per-clip cutting: trim, split at playhead, remove/restore parts (SPEC §4.2). */
export function ClipEditor({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const duration = clip.media!.duration;
  const [segs, setSegs] = useState<Segment[]>(clip.segments);
  const [time, setTime] = useState(clip.segments[0]?.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rotate, setRotate] = useState<Rotation>(clip.rotate ?? 0);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const segsRef = useRef(segs);
  segsRef.current = segs;

  // Save shortly after each change, so the other device sees it too.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => save(), 400);
    return () => clearTimeout(t);
  }, [segs]);

  const save = useCallback(async () => {
    if (!dirty.current) return true;
    dirty.current = false;
    try {
      await api.saveSegments(clip.id, segsRef.current);
      setSaveError(null);
      return true;
    } catch (err) {
      dirty.current = true;
      setSaveError((err as Error).message);
      return false;
    }
  }, [clip.id]);

  const edit = (next: Segment[]) => {
    if (next === segs) return;
    dirty.current = true;
    setSegs(next);
  };

  // Playback skips trimmed and removed parts.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (!v) return;
      const s = segsRef.current;
      let t = v.currentTime;
      const first = s[0]!;
      const last = s[s.length - 1]!;
      if (t < first.start - 0.05) t = v.currentTime = first.start;
      const cur = s.find((x) => t >= x.start && t < x.end);
      if (!cur || t >= last.end) {
        v.pause();
        v.currentTime = last.end;
        setPlaying(false);
      } else if (cur.removed) {
        const next = s.find((x) => x.start >= cur.end && !x.removed);
        if (next) v.currentTime = next.start;
        else {
          v.pause();
          setPlaying(false);
        }
      }
      setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (t: number) => {
    const clamped = Math.max(0, Math.min(duration, t));
    if (video.current) video.current.currentTime = clamped;
    setTime(clamped);
  };

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      return;
    }
    const first = segs[0]!;
    const last = segs[segs.length - 1]!;
    const inRemoved = segs.find((x) => v.currentTime >= x.start && v.currentTime < x.end)?.removed;
    if (v.currentTime < first.start || v.currentTime >= last.end - 0.05 || inRemoved) {
      v.currentTime = segs.find((x) => !x.removed)!.start;
    }
    v.play().then(() => setPlaying(true), () => setPlaying(false));
  };

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * duration;
  };

  const scrub = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragHandle = (side: 'start' | 'end') => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = timeAt(ev.clientX);
      const next = side === 'start' ? trimStart(segsRef.current, t) : trimEnd(segsRef.current, t, duration);
      dirty.current = true;
      setSegs(next);
      seek(side === 'start' ? next[0]!.start : next[next.length - 1]!.end - 0.05);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Rotation is saved at once; the preview turns the proxy with CSS, nothing is re-encoded.
  const turn = (by: 90 | 270) => {
    const prev = rotate;
    const next = ((rotate + by) % 360) as Rotation;
    setRotate(next);
    api.setRotate(clip.id, next).then(
      () => setSaveError(null),
      (err: Error) => {
        setRotate(prev);
        setSaveError(err.message);
      },
    );
  };
  const quarter = rotate === 90 || rotate === 270;
  const { width: mw, height: mh } = clip.media!;
  const aspect = quarter ? mh / mw : mw / mh;

  const done = async () => {
    video.current?.pause();
    if (await save()) onClose();
  };

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const canSplit = splitAt(segs, time) !== segs;

  return (
    <div className="modal editor" role="dialog" aria-label={`Edit ${clip.filename}`}>
      <header className="modal-head">
        <div className="title-stack">
          <strong>{clip.place ?? clip.filename}</strong>
          <span className="muted small">
            {clip.recordedAt ? `${formatDate(clip.recordedAt.local)} · ` : ''}keeps {formatDuration(keptDuration(segs))} of{' '}
            {formatDuration(duration)}
          </span>
        </div>
        <button className="btn primary" onClick={done}>
          Done
        </button>
      </header>

      <div className="player" style={{ aspectRatio: String(aspect), width: `min(100%, calc(55vh * ${aspect.toFixed(4)}))` }}>
        <video
          className={quarter ? 'quarter' : undefined}
          style={rotate ? { transform: `${quarter ? 'translate(-50%, -50%) ' : ''}rotate(${rotate}deg)` } : undefined}
          ref={video}
          src={proxyUrl(clip.id)}
          playsInline
          preload="auto"
          onLoadedMetadata={() => seek(first.start)}
          onClick={togglePlay}
          onPause={() => setPlaying(false)}
        />
      </div>

      <div className="timeline">
        <div ref={track} className="track" style={{ backgroundImage: `url(${stripUrl(clip.id, clip.stripRev)})` }} onPointerDown={scrub}>
          <div className="trimmed" style={{ left: 0, width: pct(first.start) }} />
          <div className="trimmed" style={{ left: pct(last.end), right: 0 }} />
          {segs.map((s, i) =>
            s.removed ? <div key={i} className="removed-shade" style={{ left: pct(s.start), width: pct(s.end - s.start) }} /> : null,
          )}
          {segs.slice(1).map((s, i) => (
            <div key={i} className="split-mark" style={{ left: pct(s.start) }} />
          ))}
          <div className="handle-trim start" style={{ left: pct(first.start) }} onPointerDown={dragHandle('start')} aria-label="Trim start" />
          <div className="handle-trim end" style={{ left: pct(last.end) }} onPointerDown={dragHandle('end')} aria-label="Trim end" />
          <div className="playhead" style={{ left: pct(time) }} />
        </div>
        <div className="seg-row">
          {segs.map((s, i) => (
            <button
              key={i}
              className={`seg ${s.removed ? 'removed' : ''}`}
              style={{ left: pct(s.start), width: pct(s.end - s.start) }}
              disabled={segs.length === 1}
              onClick={() => edit(toggleRemoved(segs, i))}
              title={s.removed ? 'Tap to restore' : 'Tap to remove'}
            >
              {segs.length > 1 && (s.removed ? 'Restore' : 'Remove')}
            </button>
          ))}
        </div>
      </div>

      <div className="editor-actions">
        <button className="btn round" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="time">{formatTenths(time)}</span>
        <button className="btn" disabled={!canSplit} onClick={() => edit(splitAt(segs, time))}>
          ✂ Split at playhead
        </button>
        <button className="btn" onClick={() => edit(resetSegments(duration))}>
          Reset
        </button>
        <span className="rotate-btns">
          <button className="btn" onClick={() => turn(270)} aria-label="Rotate left" title="Rotate left">
            ⟲
          </button>
          <button className="btn" onClick={() => turn(90)} aria-label="Rotate right" title="Rotate right">
            ⟳
          </button>
        </span>
      </div>
      <p className="muted small center">
        Drag the white handles to trim. Split, then tap a part to remove it. Parts must be at least 1 second long.
      </p>
      {saveError && <p className="error center">Couldn't save: {saveError}</p>}
    </div>
  );
}

function formatTenths(t: number): string {
  const tenths = Math.round(t * 10);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
}
