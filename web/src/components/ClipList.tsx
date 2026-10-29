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
import { formatDate, formatDuration, keptDuration, type Clip } from '@vto/shared';
import { stripUrl } from '../api.ts';

interface Props {
  clips: Clip[];
  onOpen: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onDelete: (id: string) => void;
}

export function ClipList({ clips, onOpen, onReorder, onDelete }: Props) {
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={clips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="clips">
          {clips.map((c) => (
            <ClipRow key={c.id} clip={c} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function ClipRow({ clip, onOpen, onDelete }: { clip: Clip; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });
  const ready = clip.status === 'ready';
  const total = clip.media?.duration ?? 0;
  const kept = keptDuration(clip.segments);
  const cut = ready && Math.abs(kept - total) > 0.05;
  const missing = [!clip.location && 'location', !clip.recordedAt && 'date'].filter(Boolean) as string[];

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
        <span className="thumb" style={ready ? { backgroundImage: `url(${stripUrl(clip.id)})` } : undefined} />
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
    </li>
  );
}
