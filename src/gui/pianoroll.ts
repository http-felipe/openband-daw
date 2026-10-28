import { beatsPerBar, clamp, uid, type MidiClip, type Note, type Track } from '../core/project';
import { DRUM_MAP } from '../synth/defs';
import type { App } from './app';
import { CANVAS as C, h, hexA, sizeCanvas } from './dom';

const KEY_W = 64;
const ROW = 14;
const LOW = 21; // A0
const HIGH = 108; // C8
const ROWS = HIGH - LOW + 1;
const MAX_WIDTH = 12000;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

export const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

type Orig = Map<string, { start: number; pitch: number; duration: number }>;
type RollDrag =
  | { mode: 'move' | 'resize'; anchorBeat: number; anchorPitch: number; orig: Orig; changed: boolean; lastPitch: number; lead: Note }
  | { mode: 'audition' };

/** MIDI note editor for the selected clip: click to add, drag to move, drag the right edge to resize. */
export class PianoRoll {
  readonly el: HTMLElement;
  dirty = true;
  private bar: HTMLElement;
  private scroll: HTMLElement;
  private canvas: HTMLCanvasElement;
  private empty: HTMLElement;
  private ppb = 64;
  private width = 0;
  private dpr = 1;
  private shownClip: string | null = null;
  private drag: RollDrag | null = null;
  private lastLen = 1;
  private lastVel = 0.8;
  private stopPreview: (() => void) | null = null;

  constructor(private readonly app: App) {
    this.bar = h('div', { class: 'roll-bar' });
    this.canvas = h('canvas', { class: 'roll-canvas' });
    this.scroll = h('div', { class: 'roll-scroll' }, this.canvas);
    this.empty = h('div', { class: 'placeholder' }, 'Select a MIDI clip to edit its notes — or double-click an empty spot in a MIDI track to create one.');
    this.el = h('div', { class: 'roll' }, this.bar, this.scroll, this.empty);
    this.scroll.addEventListener('scroll', () => this.draw());
    new ResizeObserver(() => this.layout()).observe(this.scroll);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', () => this.onUp());
    this.canvas.addEventListener('pointercancel', () => this.onUp());
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private target(): { track: Track; clip: MidiClip } | null {
    const { track, clip } = this.app.store.selection();
    return track && clip && clip.kind === 'midi' ? { track, clip } : null;
  }

  private get selected(): Set<string> {
    return this.app.store.ui.selectedNoteIds;
  }

  private snap(): number {
    return this.app.snapBeats();
  }

  /** Notes the toolbar actions apply to: the selection, or the whole clip if nothing is selected. */
  private targets(clip: MidiClip): Note[] {
    const sel = clip.notes.filter((n) => this.selected.has(n.id));
    return sel.length ? sel : clip.notes;
  }

  render(): void {
    this.bar.innerHTML = '';
    const t = this.target();
    if (t) this.buildBar(t.track, t.clip);
    this.layout();
  }

  private buildBar(track: Track, clip: MidiClip): void {
    const store = this.app.store;
    const bpb = beatsPerBar(store.project);
    const name = h('input', { class: 'txt', value: clip.name, onchange: () => store.mutate(() => (clip.name = name.value || clip.name), 'params') });
    const length = h('input', {
      class: 'num',
      type: 'number',
      min: 1,
      max: 64,
      step: 1,
      value: Math.max(1, Math.round(clip.length / bpb)),
      onchange: () => store.mutate(() => (clip.length = clamp(Math.round(Number(length.value) || 1), 1, 64) * bpb), 'structure'),
    });
    const vel = h('input', { type: 'range', class: 'slider', min: 1, max: 127, step: 1, value: Math.round(this.lastVel * 127), title: 'Velocity of selected notes (or of new notes)' });
    vel.addEventListener('pointerdown', () => store.checkpoint());
    vel.addEventListener('input', () => {
      const v = Number(vel.value) / 127;
      this.lastVel = v;
      for (const n of clip.notes) if (this.selected.has(n.id)) n.velocity = v;
      store.emit('params');
    });
    const act = (label: string, title: string, fn: () => void) => h('button', { class: 'tb-text', title, onclick: fn }, label);
    const transpose = (d: number) => () => store.mutate(() => this.targets(clip).forEach((n) => (n.pitch = clamp(n.pitch + d, LOW, HIGH))), 'params');
    this.bar.append(
      h('span', { class: 'roll-swatch', style: `background:${track.color}` }),
      h('label', { class: 'field' }, h('span', {}, 'Clip'), name),
      h('label', { class: 'field' }, h('span', {}, 'Bars'), length),
      act('Quantize', 'Snap note starts and lengths to the grid (selection, or all notes)', () =>
        store.mutate(() => {
          const s = this.snap() || 0.25;
          for (const n of this.targets(clip)) {
            n.start = Math.round(n.start / s) * s;
            n.duration = Math.max(s, Math.round(n.duration / s) * s);
          }
        }, 'params'),
      ),
      h('div', { class: 'btn-pair' }, act('−12', 'Octave down', transpose(-12)), act('−1', 'Semitone down', transpose(-1)), act('+1', 'Semitone up', transpose(1)), act('+12', 'Octave up', transpose(12))),
      h('label', { class: 'field' }, h('span', {}, 'Velocity'), vel),
      h('span', { class: 'hint' }, 'Click: add · Drag: move · Edge: resize · Shift: multi-select · Double/right-click: delete · ⌫ deletes selection'),
    );
  }

  layout(): void {
    const t = this.target();
    this.empty.hidden = !!t;
    this.scroll.hidden = !t;
    this.bar.hidden = !t;
    if (!t) {
      this.shownClip = null;
      return;
    }
    const cw = this.scroll.clientWidth || 900;
    this.ppb = clamp((cw - KEY_W - 2) / t.clip.length, 20, 240);
    if (KEY_W + t.clip.length * this.ppb > MAX_WIDTH) this.ppb = (MAX_WIDTH - KEY_W) / t.clip.length;
    this.width = Math.ceil(KEY_W + t.clip.length * this.ppb);
    this.dpr = window.devicePixelRatio || 1;
    sizeCanvas(this.canvas, this.width, ROWS * ROW, this.dpr);
    if (this.shownClip !== t.clip.id) {
      this.shownClip = t.clip.id;
      this.selected.clear();
      const pitches = t.clip.notes.map((n) => n.pitch);
      const center = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : t.track.instrument?.type === 'drums' ? 42 : 60;
      this.scroll.scrollTop = (HIGH - center) * ROW - this.scroll.clientHeight / 2;
      this.scroll.scrollLeft = 0;
    }
    this.draw();
  }

  draw(): void {
    this.dirty = false;
    const t = this.target();
    const c = this.canvas.getContext('2d');
    if (!t || !c) return;
    const { track, clip } = t;
    const drums = track.instrument?.type === 'drums';
    const bpb = beatsPerBar(this.app.store.project);
    const height = ROWS * ROW;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (let p = HIGH; p >= LOW; p--) {
      const y = (HIGH - p) * ROW;
      c.fillStyle = drums ? (DRUM_MAP[p] ? '#222833' : '#191c22') : BLACK.has(p % 12) ? '#191c22' : '#1f232b';
      c.fillRect(KEY_W, y, this.width - KEY_W, ROW);
      if (p % 12 === 0) {
        c.fillStyle = '#2f3542';
        c.fillRect(KEY_W, y + ROW - 1, this.width, 1);
      }
    }

    let step = this.snap() || 0.25;
    while (step * this.ppb < 6) step *= 2;
    for (let b = 0; b <= clip.length + 1e-9; b += step) {
      const isBar = Math.abs(b / bpb - Math.round(b / bpb)) < 1e-6;
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6;
      c.fillStyle = isBar ? '#3a4150' : isBeat ? '#2a303b' : '#22262e';
      c.fillRect(Math.round(KEY_W + b * this.ppb), 0, 1, height);
    }

    c.font = '600 10px system-ui, sans-serif';
    for (const n of clip.notes) {
      const x = KEY_W + n.start * this.ppb;
      const y = (HIGH - n.pitch) * ROW;
      const w = Math.max(3, n.duration * this.ppb - 1);
      const sel = this.selected.has(n.id);
      c.beginPath();
      c.roundRect(x, y + 1, w, ROW - 2, 3);
      c.fillStyle = hexA(track.color, 0.35 + 0.65 * n.velocity);
      c.fill();
      if (sel) {
        c.strokeStyle = '#ffffff';
        c.lineWidth = 1.5;
        c.stroke();
      }
      if (w > 30 && !drums) {
        c.fillStyle = 'rgba(10,12,16,0.85)';
        c.fillText(noteName(n.pitch), x + 4, y + ROW - 4);
      }
    }

    const { transport } = this.app;
    const beat = transport.currentBeat() - clip.start;
    if (transport.playing && beat >= 0 && beat <= clip.length) {
      c.fillStyle = C.playhead;
      c.fillRect(Math.round(KEY_W + beat * this.ppb), 0, 1.5, height);
    }

    // Sticky keyboard column, drawn at the current horizontal scroll offset.
    const sx = this.scroll.scrollLeft;
    c.fillStyle = '#101216';
    c.fillRect(sx, 0, KEY_W, height);
    for (let p = HIGH; p >= LOW; p--) {
      const y = (HIGH - p) * ROW;
      const black = BLACK.has(p % 12);
      if (drums) {
        c.fillStyle = DRUM_MAP[p] ? '#2b3240' : '#181b21';
        c.fillRect(sx, y, KEY_W - 1, ROW - 1);
        if (DRUM_MAP[p]) {
          c.fillStyle = C.text;
          c.fillText(DRUM_MAP[p], sx + 5, y + ROW - 4);
        }
        continue;
      }
      c.fillStyle = black ? '#2a2e37' : '#e7eaf0';
      c.fillRect(sx, y, black ? KEY_W * 0.62 : KEY_W - 1, ROW - 1);
      if (p % 12 === 0) {
        c.fillStyle = '#2a2e37';
        c.fillText(noteName(p), sx + KEY_W - 26, y + ROW - 4);
      }
    }
    c.fillStyle = '#000';
    c.fillRect(sx + KEY_W - 1, 0, 1, height);
  }

  // ---------- editing ----------

  deleteSelected(): void {
    const t = this.target();
    if (!t || !this.selected.size) return;
    this.app.store.mutate(() => (t.clip.notes = t.clip.notes.filter((n) => !this.selected.has(n.id))), 'params');
    this.selected.clear();
  }

  selectAll(): void {
    const t = this.target();
    if (!t) return;
    for (const n of t.clip.notes) this.selected.add(n.id);
    this.dirty = true;
  }

  nudge(semitones: number, beats: number): void {
    const t = this.target();
    if (!t || !this.selected.size) return;
    this.app.store.mutate(() => {
      for (const n of t.clip.notes) {
        if (!this.selected.has(n.id)) continue;
        n.pitch = clamp(n.pitch + semitones, LOW, HIGH);
        n.start = clamp(n.start + beats, 0, t.clip.length - n.duration);
      }
    }, 'params');
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pitchAt(y: number): number {
    return clamp(HIGH - Math.floor(y / ROW), LOW, HIGH);
  }

  private hitNote(clip: MidiClip, beat: number, pitch: number): Note | null {
    for (let i = clip.notes.length - 1; i >= 0; i--) {
      const n = clip.notes[i];
      if (n.pitch === pitch && beat >= n.start && beat < n.start + n.duration) return n;
    }
    return null;
  }

  private originals(clip: MidiClip): Orig {
    const m: Orig = new Map();
    for (const n of clip.notes) if (this.selected.has(n.id)) m.set(n.id, { start: n.start, pitch: n.pitch, duration: n.duration });
    return m;
  }

  private preview(track: Track, pitch: number, velocity: number): void {
    this.stopPreview?.();
    this.stopPreview = this.app.previewNote(track.id, pitch, velocity);
  }

  private onDown(e: PointerEvent): void {
    this.app.focusArea = 'roll';
    const t = this.target();
    if (!t) return;
    const { track, clip } = t;
    const { x, y } = this.local(e);
    const pitch = this.pitchAt(y);
    this.canvas.setPointerCapture(e.pointerId);

    if (x < this.scroll.scrollLeft + KEY_W) {
      this.preview(track, pitch, this.lastVel);
      this.drag = { mode: 'audition' };
      return;
    }
    const beat = (x - KEY_W) / this.ppb;
    const hit = this.hitNote(clip, beat, pitch);
    if (e.button === 2) {
      if (hit) this.app.store.mutate(() => clip.notes.splice(clip.notes.indexOf(hit), 1), 'params');
      return;
    }
    if (e.button !== 0) return;

    const store = this.app.store;
    if (hit) {
      if (e.shiftKey) {
        if (this.selected.has(hit.id)) this.selected.delete(hit.id);
        else this.selected.add(hit.id);
        this.dirty = true;
        if (!this.selected.has(hit.id)) return;
      } else if (!this.selected.has(hit.id)) {
        this.selected.clear();
        this.selected.add(hit.id);
      }
      const edge = KEY_W + (hit.start + hit.duration) * this.ppb - x < 7;
      this.drag = { mode: edge ? 'resize' : 'move', anchorBeat: beat, anchorPitch: pitch, orig: this.originals(clip), changed: false, lastPitch: pitch, lead: hit };
      this.lastVel = hit.velocity;
      this.preview(track, hit.pitch, hit.velocity);
      this.dirty = true;
      return;
    }

    const s = this.snap();
    const start = s ? Math.floor(beat / s) * s : beat;
    if (start >= clip.length) return;
    store.checkpoint();
    const note: Note = { id: uid('n'), pitch, start, duration: Math.min(this.lastLen, clip.length - start), velocity: this.lastVel };
    clip.notes.push(note);
    if (!e.shiftKey) this.selected.clear();
    this.selected.add(note.id);
    this.drag = { mode: 'resize', anchorBeat: beat, anchorPitch: pitch, orig: this.originals(clip), changed: true, lastPitch: pitch, lead: note };
    this.preview(track, pitch, this.lastVel);
    store.emit('params');
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    const t = this.target();
    if (!t) return;
    const { x, y } = this.local(e);
    if (!d) {
      const hit = this.hitNote(t.clip, (x - KEY_W) / this.ppb, this.pitchAt(y));
      this.canvas.style.cursor = x < this.scroll.scrollLeft + KEY_W ? 'pointer' : hit ? (KEY_W + (hit.start + hit.duration) * this.ppb - x < 7 ? 'ew-resize' : 'grab') : 'crosshair';
      return;
    }
    if (d.mode === 'audition') return;
    const s = this.snap();
    const minLen = s || 1 / 16;
    const rawDelta = (x - KEY_W) / this.ppb - d.anchorBeat;
    const delta = s ? Math.round(rawDelta / s) * s : rawDelta;
    const store = this.app.store;
    if (!d.changed) {
      if (Math.abs(rawDelta * this.ppb) < 3 && this.pitchAt(y) === d.anchorPitch) return;
      store.checkpoint();
      d.changed = true;
    }
    if (d.mode === 'move') {
      const dp = this.pitchAt(y) - d.anchorPitch;
      for (const n of t.clip.notes) {
        const o = d.orig.get(n.id);
        if (!o) continue;
        n.start = clamp(o.start + delta, 0, Math.max(0, t.clip.length - minLen));
        n.pitch = clamp(o.pitch + dp, LOW, HIGH);
      }
      if (d.lead.pitch !== d.lastPitch) {
        d.lastPitch = d.lead.pitch;
        this.preview(t.track, d.lead.pitch, d.lead.velocity);
      }
    } else {
      for (const n of t.clip.notes) {
        const o = d.orig.get(n.id);
        if (o) n.duration = clamp(o.duration + delta, minLen, t.clip.length - n.start);
      }
    }
    store.emit('params');
  }

  private onUp(): void {
    const d = this.drag;
    this.drag = null;
    this.stopPreview?.();
    this.stopPreview = null;
    if (d && d.mode === 'resize') this.lastLen = d.lead.duration;
  }

  private onDouble(e: MouseEvent): void {
    const t = this.target();
    if (!t) return;
    const { x, y } = this.local(e);
    if (x < this.scroll.scrollLeft + KEY_W) return;
    const hit = this.hitNote(t.clip, (x - KEY_W) / this.ppb, this.pitchAt(y));
    if (!hit) return;
    this.selected.delete(hit.id);
    this.app.store.mutate(() => t.clip.notes.splice(t.clip.notes.indexOf(hit), 1), 'params');
  }
}
