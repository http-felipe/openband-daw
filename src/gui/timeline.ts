import { AUTOMATION_RANGE, beatsPerBar, clamp, createMidiClip, type AutomationParam, type AutomationPoint, type Clip, type MidiClip, type Track } from '../core/project';
import type { App } from './app';
import { CANVAS as C, h, hexA, sizeCanvas } from './dom';
import { showContextMenu } from './menu';

export const ROW_H = 84;
const RULER_H = 30;
const EDGE = 7; // px grab zone for resizing a clip's right edge
const AUTO_PAD = 7;

type Drag =
  | { kind: 'move'; clip: Clip; trackId: string; grab: number; changed: boolean }
  | { kind: 'resize'; clip: Clip; changed: boolean }
  | { kind: 'auto'; track: Track; param: AutomationParam; point: AutomationPoint };

/** Arrange view: ruler + multitrack lanes on canvas, with clip editing and automation lanes. */
export class Timeline {
  dirty = true;
  private drag: Drag | null = null;
  private rulerDrag: { start: number; x: number; moved: boolean; changed: boolean } | null = null;
  private renameInput: HTMLInputElement | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    private readonly app: App,
    private readonly ruler: HTMLCanvasElement,
    private readonly lanes: HTMLCanvasElement,
    private readonly body: HTMLElement,
  ) {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(lanes.parentElement as HTMLElement);
    ro.observe(body);
    lanes.addEventListener('pointerdown', (e) => this.onDown(e));
    lanes.addEventListener('pointermove', (e) => this.onMove(e));
    lanes.addEventListener('pointerup', () => (this.drag = null));
    lanes.addEventListener('pointercancel', () => (this.drag = null));
    lanes.addEventListener('dblclick', (e) => this.onDouble(e));
    lanes.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    lanes.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    ruler.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    ruler.addEventListener('pointerdown', (e) => this.onRulerDown(e));
    ruler.addEventListener('pointermove', (e) => this.onRulerMove(e));
    ruler.addEventListener('pointerup', () => this.onRulerUp());
  }

  private get ui() {
    return this.app.store.ui;
  }

  private x(beat: number): number {
    return (beat - this.ui.scrollX) * this.ui.zoom;
  }

  private beatAt(x: number): number {
    return x / this.ui.zoom + this.ui.scrollX;
  }

  private snap(beat: number, mode: 'round' | 'floor' = 'round'): number {
    const s = this.app.snapBeats();
    if (!s) return beat;
    return (mode === 'floor' ? Math.floor(beat / s) : Math.round(beat / s)) * s;
  }

  resize(): void {
    const wrap = this.lanes.parentElement as HTMLElement;
    this.dpr = window.devicePixelRatio || 1;
    this.width = wrap.clientWidth;
    this.height = Math.max(this.app.store.project.tracks.length * ROW_H, this.body.clientHeight - 2);
    sizeCanvas(this.lanes, this.width, this.height, this.dpr);
    sizeCanvas(this.ruler, this.width, RULER_H, this.dpr);
    this.draw();
  }

  /** Inline name editor over the clip's header strip. Enter or clicking away saves, Esc cancels. */
  startRename(trackId: string, clipId: string): void {
    const store = this.app.store;
    const row = store.project.tracks.findIndex((t) => t.id === trackId);
    const clip = store.project.tracks[row]?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    this.renameInput?.blur();
    this.revealTrack(row);
    if (this.x(clip.start) < 0 || this.x(clip.start) > this.width - 60) {
      this.ui.scrollX = Math.max(0, clip.start - 1);
      this.draw();
    }
    const left = Math.max(0, this.x(clip.start)) + 3;
    const width = clamp(clip.length * this.ui.zoom - 8, 140, 280);
    const input = h('input', { class: 'clip-rename', value: clip.name, 'aria-label': 'Clip name', style: `left:${left}px;top:${row * ROW_H + 4}px;width:${width}px` });
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      input.remove();
      this.renameInput = null;
      const name = input.value.trim();
      if (commit && name && name !== clip.name) store.mutate(() => (clip.name = name));
      else this.draw();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name must not trigger transport shortcuts
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    (this.lanes.parentElement as HTMLElement).append(input);
    this.renameInput = input;
    input.focus();
    input.select();
  }

  /** Scroll the arrange view vertically so the given track row is visible. */
  revealTrack(index: number): void {
    const top = index * ROW_H;
    if (top < this.body.scrollTop || top + ROW_H > this.body.scrollTop + this.body.clientHeight) {
      this.body.scrollTop = top + ROW_H - this.body.clientHeight;
    }
  }

  // ---------- drawing ----------

  draw(): void {
    this.dirty = false;
    const c = this.lanes.getContext('2d');
    if (!c || !this.width) return;
    const { store, transport } = this.app;
    const p = store.project;
    if (transport.playing && !this.drag) this.follow(transport.currentBeat());

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, this.width, this.height);
    p.tracks.forEach((t, i) => {
      c.fillStyle = t.id === this.ui.selectedTrackId ? C.rowSel : i % 2 ? C.rowAlt : C.row;
      c.fillRect(0, i * ROW_H, this.width, ROW_H);
      c.fillStyle = C.line;
      c.fillRect(0, (i + 1) * ROW_H - 1, this.width, 1);
    });
    this.drawGrid(c, this.height);
    if (p.loop.enabled) {
      const x0 = this.x(p.loop.start);
      c.fillStyle = 'rgba(255,159,67,0.045)';
      c.fillRect(x0, 0, this.x(p.loop.end) - x0, this.height);
    }
    const live = this.app.liveTake();
    p.tracks.forEach((t, i) => {
      for (const clip of t.clips) this.drawClip(c, t, clip, i * ROW_H);
      if (live?.trackIds.includes(t.id)) this.drawLiveTake(c, t, i * ROW_H, live);
      const param = this.ui.automation[t.id];
      if (param) this.drawAutomation(c, t, param, i * ROW_H);
    });
    if (!p.tracks.length) {
      c.fillStyle = C.muted;
      c.font = '13px system-ui, sans-serif';
      c.fillText('No tracks yet — add one with the + buttons on the left.', 24, 40);
    }
    const ph = this.x(transport.currentBeat());
    if (ph >= 0 && ph <= this.width) {
      c.fillStyle = C.playhead;
      c.fillRect(Math.round(ph), 0, 1.5, this.height);
    }
    this.drawRuler();
  }

  private drawGrid(c: CanvasRenderingContext2D, height: number): void {
    const bpb = beatsPerBar(this.app.store.project);
    const zoom = this.ui.zoom;
    const sub = zoom > 140 ? 0.25 : zoom > 70 ? 0.5 : 1;
    const barEvery = bpb * zoom < 18 ? 4 : 1; // thin out bar lines when zoomed far out
    for (let b = Math.floor(this.beatAt(0)); b <= this.beatAt(this.width); b += sub) {
      const barIdx = b / bpb;
      const isBar = Math.abs(barIdx - Math.round(barIdx)) < 1e-6;
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6;
      if (isBar && Math.round(barIdx) % barEvery !== 0) continue;
      if (!isBar && zoom < 14) continue;
      c.fillStyle = isBar ? C.bar : isBeat ? C.beat : C.sub;
      c.fillRect(Math.round(this.x(b)), 0, 1, height);
    }
  }

  private drawClip(c: CanvasRenderingContext2D, t: Track, clip: Clip, rowY: number): void {
    const x0 = this.x(clip.start);
    const w = Math.max(3, clip.length * this.ui.zoom);
    if (x0 + w < 0 || x0 > this.width) return;
    const selected = clip.id === this.ui.selectedClipId;
    const y = rowY + 4;
    const hgt = ROW_H - 9;
    c.save();
    c.beginPath();
    c.roundRect(x0, y, w, hgt, 5);
    c.fillStyle = hexA(t.color, selected ? 0.4 : 0.26);
    c.fill();
    c.clip();
    c.fillStyle = hexA(t.color, selected ? 0.95 : 0.78);
    c.fillRect(x0, y, w, 16);
    c.fillStyle = '#121418';
    c.font = '600 11px system-ui, sans-serif';
    c.fillText(clip.name, Math.max(x0, 0) + 6, y + 12);
    c.fillStyle = hexA(t.color, 1);
    if (clip.kind === 'midi') this.drawMiniNotes(c, clip, x0, y + 20, hgt - 24);
    else this.drawWave(c, this.app.peaksFor(clip.audioId), clip.offset, x0, y + 18, w, hgt - 20);
    c.restore();
    c.beginPath();
    c.roundRect(x0 + 0.5, y + 0.5, w - 1, hgt - 1, 5);
    c.strokeStyle = selected ? '#ffffff' : hexA(t.color, 0.9);
    c.lineWidth = selected ? 1.5 : 1;
    c.stroke();
  }

  private drawMiniNotes(c: CanvasRenderingContext2D, clip: MidiClip, x0: number, y: number, hgt: number): void {
    if (!clip.notes.length) return;
    let lo = 127;
    let hi = 0;
    for (const n of clip.notes) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
    }
    const range = Math.max(12, hi - lo + 1);
    const base = lo - (range - (hi - lo + 1)) / 2;
    const rowH = Math.max(2, hgt / range - 0.5);
    for (const n of clip.notes) {
      if (n.start >= clip.length) continue;
      const nx = x0 + n.start * this.ui.zoom;
      if (nx > this.width) continue;
      const nw = Math.max(2, Math.min(n.duration, clip.length - n.start) * this.ui.zoom - 1);
      c.fillRect(nx, y + hgt - ((n.pitch - base + 1) / range) * hgt, nw, rowH);
    }
  }

  /** A take that is still being recorded: drawn like a clip, growing in real time. */
  private drawLiveTake(c: CanvasRenderingContext2D, t: Track, rowY: number, take: NonNullable<ReturnType<App['liveTake']>>): void {
    const x0 = this.x(take.start);
    const w = Math.max(3, take.length * this.ui.zoom);
    if (x0 + w < 0 || x0 > this.width) return;
    const y = rowY + 4;
    const hgt = ROW_H - 9;
    c.save();
    c.beginPath();
    c.roundRect(x0, y, w, hgt, 5);
    c.fillStyle = hexA(t.color, 0.3);
    c.fill();
    c.clip();
    c.fillStyle = 'rgba(255,77,94,0.85)';
    c.fillRect(x0, y, w, 16);
    c.fillStyle = '#fff';
    c.font = '600 11px system-ui, sans-serif';
    c.fillText('● Recording', Math.max(x0, 0) + 6, y + 12);
    c.fillStyle = hexA(t.color, 1);
    this.drawWave(c, take.peaks, take.offset, x0, y + 18, w, hgt - 20);
    c.restore();
    c.beginPath();
    c.roundRect(x0 + 0.5, y + 0.5, w - 1, hgt - 1, 5);
    c.strokeStyle = 'rgba(255,77,94,0.9)';
    c.lineWidth = 1.5;
    c.stroke();
  }

  private drawWave(c: CanvasRenderingContext2D, peaks: { data: ArrayLike<number>; rate: number } | null, offset: number, x0: number, y: number, w: number, hgt: number): void {
    if (!peaks) {
      c.fillStyle = C.muted;
      c.font = '11px system-ui, sans-serif';
      c.fillText('audio missing', x0 + 6, y + hgt / 2 + 4);
      return;
    }
    const spb = 60 / this.app.store.project.bpm;
    const mid = y + hgt / 2;
    const from = Math.max(0, Math.floor(x0));
    const to = Math.min(this.width, x0 + w);
    for (let px = from; px < to; px++) {
      const sec = offset + ((px - x0) / this.ui.zoom) * spb;
      const idx = Math.floor(sec * peaks.rate);
      if (idx >= peaks.data.length) break;
      const v = Math.min(1, peaks.data[idx]) * (hgt / 2);
      c.fillRect(px, mid - v, 1, Math.max(1, v * 2));
    }
  }

  private autoY(param: AutomationParam, value: number): number {
    const [lo, hi] = AUTOMATION_RANGE[param];
    return AUTO_PAD + (1 - (value - lo) / (hi - lo)) * (ROW_H - 2 * AUTO_PAD);
  }

  private autoValue(param: AutomationParam, yInRow: number): number {
    const [lo, hi] = AUTOMATION_RANGE[param];
    const v = lo + (1 - (yInRow - AUTO_PAD) / (ROW_H - 2 * AUTO_PAD)) * (hi - lo);
    return Math.round(clamp(v, lo, hi) * 100) / 100;
  }

  private drawAutomation(c: CanvasRenderingContext2D, t: Track, param: AutomationParam, rowY: number): void {
    const points = t.automation[param];
    c.fillStyle = 'rgba(12,13,17,0.55)';
    c.fillRect(0, rowY, this.width, ROW_H - 1);
    c.strokeStyle = C.auto;
    c.fillStyle = C.auto;
    c.lineWidth = 1.5;
    c.beginPath();
    if (!points.length) {
      const y = rowY + this.autoY(param, param === 'volume' ? t.volume : t.pan);
      c.setLineDash([4, 4]);
      c.moveTo(0, y);
      c.lineTo(this.width, y);
      c.stroke();
      c.setLineDash([]);
    } else {
      c.moveTo(0, rowY + this.autoY(param, points[0].value));
      for (const pt of points) c.lineTo(this.x(pt.beat), rowY + this.autoY(param, pt.value));
      c.lineTo(this.width, rowY + this.autoY(param, points[points.length - 1].value));
      c.stroke();
      for (const pt of points) {
        c.beginPath();
        c.arc(this.x(pt.beat), rowY + this.autoY(param, pt.value), 3.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.font = '600 11px system-ui, sans-serif';
    c.fillText(`${param === 'volume' ? 'Volume' : 'Pan'} automation · click to add, drag to move, right-click to delete`, 8, rowY + 16);
  }

  private drawRuler(): void {
    const c = this.ruler.getContext('2d');
    if (!c) return;
    const p = this.app.store.project;
    const bpb = beatsPerBar(p);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = C.ruler;
    c.fillRect(0, 0, this.width, RULER_H);
    c.fillStyle = C.line;
    c.fillRect(0, RULER_H - 1, this.width, 1);

    const lx0 = this.x(p.loop.start);
    c.fillStyle = p.loop.enabled ? hexA(C.accent, 0.85) : 'rgba(120,128,145,0.35)';
    c.beginPath();
    c.roundRect(lx0, 2, this.x(p.loop.end) - lx0, 7, 3);
    c.fill();

    const labelEvery = Math.max(1, Math.ceil(36 / (bpb * this.ui.zoom)));
    c.font = '11px system-ui, sans-serif';
    for (let bar = Math.max(0, Math.floor(this.beatAt(0) / bpb)); bar * bpb <= this.beatAt(this.width); bar++) {
      const x = Math.round(this.x(bar * bpb));
      const major = bar % labelEvery === 0;
      c.fillStyle = major ? '#4a5160' : '#2d323d';
      c.fillRect(x, major ? 12 : 20, 1, RULER_H);
      if (major) {
        c.fillStyle = C.text;
        c.fillText(String(bar + 1), x + 4, 24);
      }
      if (this.ui.zoom >= 14) {
        c.fillStyle = '#2d323d';
        for (let b = 1; b < bpb; b++) c.fillRect(Math.round(this.x(bar * bpb + b)), 24, 1, 6);
      }
    }
    const ph = this.x(this.app.transport.currentBeat());
    if (ph >= -6 && ph <= this.width + 6) {
      c.fillStyle = C.playhead;
      c.beginPath();
      c.moveTo(ph - 6, 12);
      c.lineTo(ph + 6, 12);
      c.lineTo(ph, RULER_H - 1);
      c.closePath();
      c.fill();
    }
  }

  private follow(beat: number): void {
    const x = this.x(beat);
    if (x > this.width * 0.92 || x < 0) {
      this.ui.scrollX = Math.max(0, beat - (this.width * 0.08) / this.ui.zoom);
    }
  }

  // ---------- interaction ----------

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.lanes.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitClip(track: Track, x: number): Clip | null {
    for (let i = track.clips.length - 1; i >= 0; i--) {
      const c = track.clips[i];
      const x0 = this.x(c.start);
      if (x >= x0 && x <= x0 + Math.max(3, c.length * this.ui.zoom)) return c;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    this.app.focusArea = 'arrange';
    const { x, y } = this.local(e);
    const row = Math.floor(y / ROW_H);
    const track = this.app.store.project.tracks[row];
    if (!track) return;
    const param = this.ui.automation[track.id];
    if (param) {
      this.onAutomationDown(e, track, param, x, y - row * ROW_H);
      return;
    }
    if (e.button !== 0) return;
    const clip = this.hitClip(track, x);
    if (!clip) {
      this.app.selectTrack(track.id);
      return;
    }
    this.app.selectClip(track.id, clip.id);
    const resize = this.x(clip.start + clip.length) - x < EDGE;
    this.drag = resize
      ? { kind: 'resize', clip, changed: false }
      : { kind: 'move', clip, trackId: track.id, grab: this.beatAt(x) - clip.start, changed: false };
    this.lanes.setPointerCapture(e.pointerId);
  }

  private onAutomationDown(e: PointerEvent, track: Track, param: AutomationParam, x: number, yInRow: number): void {
    const store = this.app.store;
    const points = track.automation[param];
    const hit = points.find((pt) => Math.abs(this.x(pt.beat) - x) < 7 && Math.abs(this.autoY(param, pt.value) - yInRow) < 7);
    if (e.button === 2) {
      if (hit) store.mutate(() => points.splice(points.indexOf(hit), 1), 'params');
      return;
    }
    if (e.button !== 0) return;
    store.checkpoint();
    let point = hit;
    if (!point) {
      point = { beat: Math.max(0, this.snap(this.beatAt(x))), value: this.autoValue(param, yInRow) };
      points.push(point);
      points.sort((a, b) => a.beat - b.beat);
      store.emit('params');
    }
    this.drag = { kind: 'auto', track, param, point };
    this.lanes.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const d = this.drag;
    if (!d) {
      this.updateCursor(x, y);
      return;
    }
    const store = this.app.store;
    const p = store.project;
    if (d.kind === 'auto') {
      const rowY = p.tracks.indexOf(d.track) * ROW_H;
      d.point.beat = Math.max(0, this.snap(this.beatAt(x)));
      d.point.value = this.autoValue(d.param, y - rowY);
      d.track.automation[d.param].sort((a, b) => a.beat - b.beat);
      store.emit('params');
      return;
    }
    const touch = () => {
      if (!d.changed) {
        store.checkpoint();
        d.changed = true;
      }
    };
    if (d.kind === 'move') {
      const start = Math.max(0, this.snap(this.beatAt(x) - d.grab));
      const target = p.tracks[Math.floor(y / ROW_H)];
      if (target && target.id !== d.trackId && target.kind === d.clip.kind) {
        touch();
        const from = store.track(d.trackId);
        if (from) from.clips.splice(from.clips.indexOf(d.clip), 1);
        target.clips.push(d.clip);
        d.trackId = target.id;
        this.ui.selectedTrackId = target.id;
      }
      if (start !== d.clip.start) {
        touch();
        d.clip.start = start;
      }
    } else {
      let len = Math.max(this.app.snapBeats() || 0.25, this.snap(this.beatAt(x)) - d.clip.start);
      if (d.clip.kind === 'audio') {
        const buf = this.app.engine.buffers.get(d.clip.audioId);
        if (buf) len = Math.min(len, ((buf.duration - d.clip.offset) * p.bpm) / 60);
      }
      if (len !== d.clip.length) {
        touch();
        d.clip.length = len;
      }
    }
    store.emit('params');
  }

  private updateCursor(x: number, y: number): void {
    const track = this.app.store.project.tracks[Math.floor(y / ROW_H)];
    let cursor = 'default';
    if (track && this.ui.automation[track.id]) cursor = 'crosshair';
    else if (track) {
      const clip = this.hitClip(track, x);
      if (clip) cursor = this.x(clip.start + clip.length) - x < EDGE ? 'ew-resize' : 'grab';
    }
    this.lanes.style.cursor = cursor;
  }

  private onDouble(e: MouseEvent): void {
    const { x, y } = this.local(e);
    const store = this.app.store;
    const p = store.project;
    const row = Math.floor(y / ROW_H);
    const track = p.tracks[row];
    if (!track || this.ui.automation[track.id]) return;
    const clip = this.hitClip(track, x);
    if (clip) {
      // Double-click the name strip (or an audio clip) to rename; a MIDI clip's body opens the editor.
      const onHeader = y - row * ROW_H < 22;
      if (onHeader || clip.kind === 'audio') this.startRename(track.id, clip.id);
      else this.app.setTab('editor');
      return;
    }
    if (track.kind !== 'midi') return;
    const bpb = beatsPerBar(p);
    const created = createMidiClip(Math.max(0, Math.floor(this.beatAt(x) / bpb) * bpb), bpb, track.name);
    store.mutate(() => track.clips.push(created), 'structure');
    this.app.selectClip(track.id, created.id);
    this.app.setTab('editor');
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const { x, y } = this.local(e);
    const track = this.app.store.project.tracks[Math.floor(y / ROW_H)];
    if (!track || this.ui.automation[track.id]) return; // right-click deletes points there
    const clip = this.hitClip(track, x);
    if (!clip) return;
    this.app.selectClip(track.id, clip.id);
    const { app } = this;
    const here = this.snap(this.beatAt(x));
    const playhead = app.transport.currentBeat();
    const contains = (b: number) => b > clip.start + 1e-6 && b < clip.start + clip.length - 1e-6;
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Split at playhead', shortcut: 'S', disabled: !contains(playhead), action: () => app.splitAt(playhead) },
      { label: 'Split here', disabled: !contains(here), action: () => app.splitAt(here) },
      { label: 'Rename…', action: () => this.startRename(track.id, clip.id) },
      { label: 'Duplicate', shortcut: '⌘D', action: () => app.duplicateSelectedClip() },
      ...(clip.kind === 'midi' ? [{ label: 'Open in Piano Roll', action: () => app.setTab('editor') }] : []),
      { label: 'Delete', shortcut: '⌫', danger: true, action: () => app.deleteSelectedClip() },
    ]);
  }

  private onWheel(e: WheelEvent): void {
    const ui = this.ui;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = this.lanes.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const anchor = this.beatAt(mx);
      ui.zoom = clamp(ui.zoom * Math.exp(-e.deltaY * 0.01), 4, 400);
      ui.scrollX = Math.max(0, anchor - mx / ui.zoom);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const delta = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      ui.scrollX = Math.max(0, ui.scrollX + delta / ui.zoom);
    } else return;
    this.draw();
  }

  private onRulerDown(e: PointerEvent): void {
    this.rulerDrag = { start: this.beatAt(e.offsetX), x: e.offsetX, moved: false, changed: false };
    this.ruler.setPointerCapture(e.pointerId);
  }

  private onRulerMove(e: PointerEvent): void {
    const rd = this.rulerDrag;
    if (!rd) return;
    if (Math.abs(e.offsetX - rd.x) > 4) rd.moved = true;
    if (!rd.moved) return;
    const here = this.beatAt(e.offsetX);
    const a = Math.max(0, this.snap(Math.min(rd.start, here)));
    const b = this.snap(Math.max(rd.start, here));
    if (b - a < (this.app.snapBeats() || 0.25)) return;
    const store = this.app.store;
    if (!rd.changed) {
      store.checkpoint();
      rd.changed = true;
    }
    store.project.loop = { enabled: true, start: a, end: b };
    store.emit('params');
  }

  private onRulerUp(): void {
    const rd = this.rulerDrag;
    this.rulerDrag = null;
    if (rd && !rd.moved) {
      this.app.transport.seek(Math.max(0, this.snap(rd.start)));
      this.app.store.emit('transport');
    }
  }
}
