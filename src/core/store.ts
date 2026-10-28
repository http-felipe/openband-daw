import { validateProject, type AutomationParam, type Clip, type Project, type Track } from './project';

/**
 * What changed, so views can do the minimum work:
 * - project:   everything (load, undo)
 * - structure: tracks/clips/fx/instrument layout changed → rebuild DOM panels
 * - params:    values changed → refresh values, redraw canvases
 * - selection / view / transport: no project change
 */
export type ChangeReason = 'project' | 'structure' | 'params' | 'selection' | 'view' | 'transport';

export type SnapKey = 'bar' | '1/4' | '1/8' | '1/16' | '1/32' | 'off';
export type BottomTab = 'editor' | 'instrument' | 'fx';

export interface UIState {
  selectedTrackId: string | null;
  selectedClipId: string | null;
  selectedNoteIds: Set<string>;
  snap: SnapKey;
  /** Pixels per beat in the arrange view. */
  zoom: number;
  /** First visible beat in the arrange view. */
  scrollX: number;
  bottomTab: BottomTab;
  fxTarget: 'track' | 'master';
  automation: Record<string, AutomationParam | undefined>;
  octave: number;
  velocity: number;
}

const HISTORY = 100;

export class Store {
  readonly ui: UIState = {
    selectedTrackId: null,
    selectedClipId: null,
    selectedNoteIds: new Set(),
    snap: '1/16',
    zoom: 36,
    scrollX: 0,
    bottomTab: 'editor',
    fxTarget: 'track',
    automation: {},
    octave: 3,
    velocity: 0.8,
  };
  private listeners = new Set<(reason: ChangeReason) => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(public project: Project) {
    this.ui.selectedTrackId = project.tracks[0]?.id ?? null;
  }

  on(fn: (reason: ChangeReason) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason: ChangeReason): void {
    for (const fn of this.listeners) fn(reason);
  }

  /** Snapshot the current state onto the undo stack. Call once before a (possibly continuous) edit. */
  checkpoint(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  mutate(fn: (p: Project) => void, reason: ChangeReason = 'structure'): void {
    this.checkpoint();
    fn(this.project);
    this.emit(reason);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  load(project: Project): void {
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.ui.selectedTrackId = project.tracks[0]?.id ?? null;
    this.ui.selectedClipId = null;
    this.ui.selectedNoteIds.clear();
    this.ui.automation = {};
    this.ui.scrollX = 0;
    this.emit('project');
  }

  track(id: string | null): Track | null {
    return this.project.tracks.find((t) => t.id === id) ?? null;
  }

  selection(): { track: Track | null; clip: Clip | null } {
    const track = this.track(this.ui.selectedTrackId);
    const clip = track?.clips.find((c) => c.id === this.ui.selectedClipId) ?? null;
    return { track, clip };
  }

  /** Undo history excludes the (large, append-only) audio pool. */
  private snapshot(): string {
    return JSON.stringify(this.project, (k, v) => (k === 'audioPool' ? undefined : v));
  }

  private restore(snapshot: string): void {
    const pool = this.project.audioPool;
    this.project = validateProject({ ...JSON.parse(snapshot), audioPool: pool });
    this.project.audioPool = pool;
    if (!this.track(this.ui.selectedTrackId)) this.ui.selectedTrackId = this.project.tracks[0]?.id ?? null;
    if (!this.selection().clip) this.ui.selectedClipId = null;
    this.emit('project');
  }
}
