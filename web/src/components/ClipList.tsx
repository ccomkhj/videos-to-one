import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDate, formatDuration, keptDuration, type Clip, type Rotation } from '@vto/shared';
import { stripUrl } from '../api.ts';

interface Props {
  clips: Clip[];
  onOpen: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onDelete: (id: string) => void;
  onRotate: (id: string, rotate: Rotation) => void;
  onKeep: (id: string) => void;
}

/** The detected rotation, if it differs from the current one and wasn't dismissed (SPEC §5.8). */
export function suggestion(c: Clip): Rotation | null {
  const o = c.orientation;
  if (!o || o.dismissed || c.status !== 'ready' || o.suggested === (c.rotate ?? 0)) return null;
  return o.suggested;
}

export function ClipList({ clips, onOpen, onReorder, onDelete, onRotate, onKeep }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = clips.map((c) => c.id);
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  const sideways = clips.filter((c) => suggestion(c) !== null);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {sideways.length > 0 && (
        <div className="rotate-banner">
          <span>↻ {sideways.length === 1 ? '1 clip looks' : `${sideways.length} clips look`} rotated</span>
          <button className="btn small" onClick={() => sideways.forEach((c) => onRotate(c.id, suggestion(c)!))}>
            Fix all
          </button>
        </div>
      )}
      <SortableContext items={clips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="clips">
          {clips.map((c) => (
            <ClipRow key={c.id} clip={c} onOpen={onOpen} onDelete={onDelete} onRotate={onRotate} onKeep={onKeep} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function ClipRow({ clip, onOpen, onDelete, onRotate, onKeep }: { clip: Clip } & Omit<Props, 'clips' | 'onReorder'>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });
  const ready = clip.status === 'ready';
  const total = clip.media?.duration ?? 0;
  const kept = keptDuration(clip.segments);
  const cut = ready && Math.abs(kept - total) > 0.05;
  const missing = [!clip.location && 'location', !clip.recordedAt && 'date'].filter(Boolean) as string[];
  const suggested = suggestion(clip);

  return (
    <li
      ref={setNodeRef}
      className={`clip-row ${isDragging ? 'dragging' : ''} ${clip.status}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        className="handle"
        aria-label={`Reorder ${clip.filename}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button className="clip-main" disabled={!ready} onClick={() => onOpen(clip.id)}>
        <span className="thumb" style={ready ? { backgroundImage: `url(${stripUrl(clip.id, clip.stripRev)})` } : undefined} />
        <span className="meta">
          <span className="place">{clip.place ?? clip.filename}</span>
          <span className="sub">
            {clip.recordedAt ? formatDate(clip.recordedAt.local) : 'No date'}
            {ready && (
              <>
                {' · '}
                {cut ? `${formatDuration(kept)} / ${formatDuration(total)}` : formatDuration(total)}
              </>
            )}
            {missing.length > 0 && ready && (
              <span
                className="hint"
                title={`No ${missing.join(' or ')} in this file. Uploads from iPhone Safari can lose it: AirDrop the clip to the computer and drag it in instead.`}
              >
                ⓘ no {missing.join('/')}
              </span>
            )}
          </span>
          {clip.status === 'analyzing' && <span className="status">Analyzing…</span>}
          {clip.status === 'error' && <span className="status error">{clip.error ?? 'Error'}</span>}
        </span>
      </button>
      <button className="icon-btn delete" aria-label={`Delete ${clip.filename}`} onClick={() => onDelete(clip.id)}>
        ✕
      </button>
      {suggested !== null && (
        <div className="suggest">
          <span>↻ Looks sideways</span>
          <button className="btn small" onClick={() => onRotate(clip.id, suggested)}>
            Rotate
          </button>
          <button className="btn small" onClick={() => onKeep(clip.id)}>
            Keep
          </button>
        </div>
      )}
    </li>
  );
}
