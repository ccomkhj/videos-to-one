import { useEffect, useRef, useState } from 'react';
import type { Clip } from '@vto/shared';
import { api } from './api.ts';
import { ClipEditor } from './components/ClipEditor.tsx';
import { ClipList } from './components/ClipList.tsx';
import { ConnectCard } from './components/ConnectCard.tsx';
import { ExportSheet } from './components/ExportSheet.tsx';
import { UploadList } from './components/UploadList.tsx';
import { useIsLaptop, useSession } from './useSession.ts';
import { useUploads } from './uploads.ts';

export function App() {
  const { session, connected, setSession } = useSession();
  const laptop = useIsLaptop();
  const uploads = useUploads();
  const [editing, setEditing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Page-wide drop target on the laptop (the AirDrop fallback, SPEC R1).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) uploads.add(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [uploads.add]);

  if (!session) {
    return <div className="loading">{connected ? 'Loading…' : 'Connecting…'}</div>;
  }

  const clips = session.clips;
  const ready = clips.filter((c) => c.status === 'ready');
  const editingClip: Clip | undefined = clips.find((c) => c.id === editing);
  const busy = uploads.uploads.some((u) => u.status !== 'failed');

  // Server state arrives over SSE; responses are not applied, so they can't overwrite newer events.
  const act = (p: Promise<unknown>) => p.catch((err: Error) => alert(err.message));

  const startOver = () => {
    setMenuOpen(false);
    if (!confirm('Start over? This removes all clips from the session. Finished videos stay in the output folder.')) return;
    act(api.reset());
  };

  return (
    <div className={`app ${laptop ? 'is-laptop' : 'is-phone'}`}>
      <header className="topbar">
        <h1>videos-to-one</h1>
        {!connected && <span className="offline">Reconnecting…</span>}
        <div className="menu">
          <button className="icon-btn" aria-label="More" onClick={() => setMenuOpen((o) => !o)}>
            ⋯
          </button>
          {menuOpen && (
            <div className="menu-pop" role="menu">
              <button role="menuitem" onClick={startOver}>
                Start over
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="layout">
        <section className="clips-col">
          <div className="actions">
            <button className="btn primary big" onClick={() => fileInput.current?.click()}>
              ＋ Add videos
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="video/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) uploads.add(e.target.files);
                e.target.value = '';
              }}
            />
            {session.manualOrder && clips.length > 1 && (
              <button className="btn" onClick={() => act(api.sortByDate())}>
                Sort by date
              </button>
            )}
          </div>

          {laptop && (
            <div className={`dropzone ${dragging ? 'active' : ''}`} onClick={() => fileInput.current?.click()}>
              Drop videos here
              <small>Files AirDropped to this computer keep their original date and location.</small>
            </div>
          )}

          <UploadList {...uploads} />
          {busy && !laptop && <p className="tip">Keep the screen on until uploads finish.</p>}

          {clips.length === 0 && uploads.uploads.length === 0 ? (
            <div className="empty">
              <p>No clips yet.</p>
              <p className="muted">Add a few videos: they'll be joined in recording order, each labelled with where and when it was filmed.</p>
            </div>
          ) : (
            <ClipList
              clips={clips}
              onOpen={setEditing}
              onReorder={(ids) => {
                setSession({ ...session, clips: ids.map((id) => clips.find((c) => c.id === id)!), manualOrder: true });
                api.setOrder(ids).catch((err: Error) => {
                  alert(`Couldn't save the new order: ${err.message}`);
                  api.session().then(setSession, () => {});
                });
              }}
              onDelete={(id) => act(api.deleteClip(id))}
            />
          )}
        </section>

        {laptop && (
          <aside className="side-col">
            <ConnectCard />
          </aside>
        )}
      </main>

      <footer className="export-bar">
        <button className="btn primary big wide" disabled={ready.length === 0} onClick={() => setExporting(true)}>
          {session.render.state === 'running' ? `Rendering… ${Math.round(session.render.progress * 100)}%` : 'Export'}
        </button>
      </footer>

      {editingClip && editingClip.media && (
        <ClipEditor key={editingClip.id} clip={editingClip} onClose={() => setEditing(null)} />
      )}
      {exporting && <ExportSheet session={session} onClose={() => setExporting(false)} />}
      {dragging && <div className="drop-overlay">Drop to add videos</div>}
    </div>
  );
}
