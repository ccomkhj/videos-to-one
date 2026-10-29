/** The single working session (SPEC §6.2), persisted to `session.json`. */
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { orderClips, type Clip } from '@vto/shared';

interface Persisted {
  clips: Clip[];
  manualOrder: string[] | null;
  nextUploadIndex: number;
  lastOutput: string | null;
}

export class SessionStore extends EventEmitter<{ change: [] }> {
  private data: Persisted = { clips: [], manualOrder: null, nextUploadIndex: 0, lastOutput: null };
  private saving: Promise<void> = Promise.resolve();
  /** Bumped by reset(), so uploads that straddle "Start over" can be discarded. */
  generation = 0;

  constructor(readonly dir: string) {
    super();
  }

  get file() {
    return path.join(this.dir, 'session.json');
  }

  clipDir(id: string) {
    return path.join(this.dir, 'clips', id);
  }

  async load(): Promise<void> {
    try {
      this.data = { ...this.data, ...JSON.parse(await readFile(this.file, 'utf8')) };
    } catch {
      // No session yet.
    }
  }

  ordered(): Clip[] {
    return orderClips(this.data.clips, this.data.manualOrder);
  }

  get manualOrder() {
    return this.data.manualOrder !== null;
  }

  get lastOutput() {
    return this.data.lastOutput;
  }

  get(id: string): Clip | undefined {
    return this.data.clips.find((c) => c.id === id);
  }

  add(clip: Omit<Clip, 'uploadIndex'>): Clip {
    const full: Clip = { ...clip, uploadIndex: this.data.nextUploadIndex++ };
    this.data.clips.push(full);
    this.changed();
    return full;
  }

  update(id: string, patch: Partial<Clip>): Clip | undefined {
    const clip = this.get(id);
    if (!clip) return undefined;
    Object.assign(clip, patch);
    this.changed();
    return clip;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.data.clips.length;
    this.data.clips = this.data.clips.filter((c) => c.id !== id);
    if (this.data.manualOrder) this.data.manualOrder = this.data.manualOrder.filter((x) => x !== id);
    if (this.data.clips.length === before) return false;
    this.changed();
    await rm(this.clipDir(id), { recursive: true, force: true });
    return true;
  }

  /** A drag sets a manual order; unknown ids are ignored, missing ones go after it. */
  setOrder(ids: string[]): void {
    const known = new Set(this.data.clips.map((c) => c.id));
    this.data.manualOrder = [...new Set(ids)].filter((id) => known.has(id));
    this.changed();
  }

  sortByDate(): void {
    this.data.manualOrder = null;
    this.changed();
  }

  setLastOutput(file: string): void {
    this.data.lastOutput = file;
    this.changed();
  }

  /** "Start over": clears clips; finished videos in the output folder are kept. */
  async reset(): Promise<void> {
    this.generation++;
    this.data = { clips: [], manualOrder: null, nextUploadIndex: 0, lastOutput: this.data.lastOutput };
    this.changed();
    await this.saving;
    await rm(path.join(this.dir, 'clips'), { recursive: true, force: true });
  }

  flush(): Promise<void> {
    return this.saving;
  }

  private changed(): void {
    const snapshot = JSON.stringify(this.data, null, 1);
    this.saving = this.saving.then(async () => {
      await mkdir(this.dir, { recursive: true });
      await writeFile(`${this.file}.tmp`, snapshot);
      await rename(`${this.file}.tmp`, this.file);
    });
    this.emit('change');
  }
}
