import { clamp } from '../core/project';
import type { App } from './app';
import { h } from './dom';
import { noteName } from './pianoroll';

const OCTAVES = 3;
const WHITE = [0, 2, 4, 5, 7, 9, 11];
/** MIDI note of C in `octave` (C4 = 60). */
const octaveBase = (octave: number) => (octave + 1) * 12;

/** On-screen piano (mouse/touch, with glissando), octave/velocity controls and MIDI device status. */
export class KeyboardView {
  readonly el: HTMLElement;
  private keys: HTMLElement;
  private keyEls = new Map<number, HTMLElement>();
  private octaveLabel: HTMLElement;
  private midiStatus: HTMLElement;
  private velocity: HTMLInputElement;
  private pointerNote: number | null = null;

  constructor(private readonly app: App) {
    const ui = app.store.ui;
    this.octaveLabel = h('span', { class: 'kb-oct' });
    this.midiStatus = h('span', { class: 'kb-midi', title: 'Web MIDI inputs' }, 'MIDI: click anywhere to connect');
    this.velocity = h('input', { type: 'range', class: 'slider', min: 1, max: 127, step: 1, value: Math.round(ui.velocity * 127), title: 'Velocity' });
    this.velocity.addEventListener('input', () => (ui.velocity = Number(this.velocity.value) / 127));
    this.keys = h('div', { class: 'kb-keys' });
    this.el = h(
      'div',
      { class: 'kb' },
      h(
        'div',
        { class: 'kb-ctrl' },
        h('div', { class: 'btn-pair' }, h('button', { class: 'tb-text', title: 'Octave down', onclick: () => this.shiftOctave(-1) }, '−'), this.octaveLabel, h('button', { class: 'tb-text', title: 'Octave up', onclick: () => this.shiftOctave(1) }, '+')),
        h('label', { class: 'field' }, h('span', {}, 'Vel'), this.velocity),
        this.midiStatus,
      ),
      this.keys,
    );
    this.keys.addEventListener('pointerdown', (e) => this.onPointer(e, true));
    this.keys.addEventListener('pointerover', (e) => e.buttons & 1 && this.onPointer(e, false));
    window.addEventListener('pointerup', () => this.releasePointer());
    this.build();
  }

  build(): void {
    const ui = this.app.store.ui;
    const base = octaveBase(ui.octave);
    this.keys.innerHTML = '';
    this.keyEls.clear();
    const whites = OCTAVES * 7 + 1;
    let whiteIndex = 0;
    for (let note = base; note <= base + OCTAVES * 12; note++) {
      const pc = (note - base) % 12;
      const isWhite = WHITE.includes(pc);
      const el = h('div', { class: isWhite ? 'key white' : 'key black', 'data-note': String(note) });
      if (isWhite) {
        el.style.left = `${(whiteIndex / whites) * 100}%`;
        el.style.width = `${100 / whites}%`;
        if (pc === 0) el.append(h('span', {}, noteName(note)));
        whiteIndex++;
      } else {
        el.style.left = `${(whiteIndex / whites) * 100 - 100 / whites / 3}%`;
        el.style.width = `${(100 / whites) * 0.62}%`;
      }
      this.keyEls.set(note, el);
      this.keys.append(el);
    }
    this.octaveLabel.textContent = `C${ui.octave}`;
  }

  shiftOctave(d: number): void {
    const ui = this.app.store.ui;
    ui.octave = clamp(ui.octave + d, 0, 7);
    this.build();
  }

  highlight(note: number, on: boolean): void {
    this.keyEls.get(note)?.classList.toggle('down', on);
  }

  setMidiStatus(names: string[] | null): void {
    if (names === null) this.midiStatus.textContent = 'MIDI: unavailable';
    else this.midiStatus.textContent = names.length ? `MIDI: ${names.join(', ')}` : 'MIDI: no devices';
    this.midiStatus.classList.toggle('ok', !!names?.length);
  }

  private onPointer(e: PointerEvent, first: boolean): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.key');
    if (!el) return;
    const note = Number(el.dataset.note);
    if (note === this.pointerNote) return;
    // Touch input implicitly captures the pointer; release it so sliding across keys plays a glissando.
    if (first && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    this.releasePointer();
    const r = el.getBoundingClientRect();
    const velocity = clamp(0.35 + 0.65 * ((e.clientY - r.top) / r.height), 0.1, 1);
    this.pointerNote = note;
    this.app.noteOn(note, velocity);
  }

  private releasePointer(): void {
    if (this.pointerNote === null) return;
    this.app.noteOff(this.pointerNote);
    this.pointerNote = null;
  }
}
