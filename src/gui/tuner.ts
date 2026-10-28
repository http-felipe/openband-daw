import { clamp } from '../core/project';
import { detectPitch, downsample2, noteFromFrequency, type NoteReading } from '../dsp/pitch';
import type { App } from './app';
import { h, select } from './dom';
import { ICONS } from './icons';

const SETTINGS_KEY = 'openband.tuner.v1';
const ANALYSIS_EVERY = 3; // frames: ~20 detections per second is plenty for a tuner
const HOLD_MS = 1500; // keep showing the last note this long after the string fades
const IN_TUNE_CENTS = 3;

/** Open-string MIDI notes, low to high. */
const TUNINGS: Record<string, number[]> = {
  'Guitar · Standard E': [40, 45, 50, 55, 59, 64],
  'Guitar · Drop D': [38, 45, 50, 55, 59, 64],
  'Guitar · Half step down': [39, 44, 49, 54, 58, 63],
  'Bass · 4 strings': [28, 33, 38, 43],
  'Bass · 5 strings': [23, 28, 33, 38, 43],
};

interface TunerSettings {
  a4: number;
  tuning: string;
}

function loadSettings(): TunerSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<TunerSettings> | null;
    return {
      a4: typeof raw?.a4 === 'number' ? clamp(raw.a4, 415, 466) : 440,
      tuning: typeof raw?.tuning === 'string' && raw.tuning in TUNINGS ? raw.tuning : Object.keys(TUNINGS)[0],
    };
  } catch {
    return { a4: 440, tuning: Object.keys(TUNINGS)[0] };
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const noteLabel = (midi: number) => noteFromFrequency(440 * Math.pow(2, (midi - 69) / 12)).name;

/** Chromatic tuner on the selected audio input (floating panel opened from the toolbar). */
export class Tuner {
  readonly el: HTMLElement;
  private openState = false;
  private settings = loadSettings();
  private buf = new Float32Array(4096);
  private half = new Float32Array(2048);
  private recent: number[] = [];
  private shownCents = 0;
  private shownMidi = -1;
  private lastHeard = 0;
  private frame = 0;

  private note: HTMLElement;
  private octave: HTMLElement;
  private needle: HTMLElement;
  private readout: HTMLElement;
  private strings: HTMLElement;
  private source: HTMLElement;
  private enable: HTMLButtonElement;

  constructor(private readonly app: App) {
    this.note = h('span', { class: 'tn-note' }, '–');
    this.octave = h('span', { class: 'tn-oct' });
    this.needle = h('div', { class: 'tn-needle' });
    this.readout = h('div', { class: 'tn-readout' }, 'Play a string');
    this.strings = h('div', { class: 'tn-strings' });
    this.source = h('span', { class: 'tn-source' });
    this.enable = h('button', { class: 'tb-text', onclick: () => void this.app.enableInput().then(() => this.refreshSource()) }, 'Enable audio input');

    const a4 = h('input', {
      class: 'num',
      type: 'number',
      min: 415,
      max: 466,
      step: 1,
      value: this.settings.a4,
      title: 'Reference pitch for A4',
      onchange: () => {
        this.settings.a4 = clamp(Math.round(Number(a4.value) || 440), 415, 466);
        a4.value = String(this.settings.a4);
        this.save();
      },
    });
    const tuning = select(
      Object.keys(TUNINGS).map((k) => [k, k]),
      this.settings.tuning,
      (v) => {
        this.settings.tuning = v;
        this.save();
        this.buildStrings();
      },
    );

    const scale = h('div', { class: 'tn-scale' }, ...[-50, -25, 0, 25, 50].map((c) => h('span', { style: `left:${50 + c}%` }, c > 0 ? `+${c}` : String(c))));
    this.el = h(
      'div',
      { class: 'tuner', hidden: true, role: 'dialog', 'aria-label': 'Tuner' },
      h(
        'div',
        { class: 'tn-head' },
        h('span', { class: 'tn-title', innerHTML: `${ICONS.tuner}<span>Tuner</span>` }),
        this.source,
        h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close tuner', innerHTML: ICONS.close, onclick: () => this.close() }),
      ),
      h('div', { class: 'tn-display' }, this.note, this.octave),
      h('div', { class: 'tn-meter' }, h('div', { class: 'tn-zone' }), h('div', { class: 'tn-center' }), this.needle, scale),
      this.readout,
      this.strings,
      this.enable,
      h('div', { class: 'tn-foot' }, tuning, h('label', { class: 'field' }, h('span', {}, 'A4 ='), a4, h('span', {}, 'Hz'))),
    );
    this.buildStrings();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  open(): void {
    this.openState = true;
    this.el.hidden = false;
    this.reset();
    this.refreshSource();
    if (!this.app.engine.inputEnabled) void this.app.enableInput().then(() => this.refreshSource());
    this.app.store.emit('view');
  }

  close(): void {
    this.openState = false;
    this.el.hidden = true;
    this.app.store.emit('view');
  }

  /** Called every animation frame while open. */
  tick(): void {
    if (++this.frame % ANALYSIS_EVERY) return;
    const { engine } = this.app;
    if (!engine.readInput(this.buf)) return;
    downsample2(this.buf, this.half);
    const freq = detectPitch(this.half, engine.ctx.sampleRate / 2);
    const now = performance.now();
    if (freq !== null) {
      // Restart the smoothing window when a different note is played, so the display reacts at once.
      if (this.recent.length && Math.abs(1200 * Math.log2(freq / median(this.recent))) > 80) this.recent = [];
      this.recent.push(freq);
      if (this.recent.length > 5) this.recent.shift();
      this.lastHeard = now;
      this.show(noteFromFrequency(median(this.recent), this.settings.a4), median(this.recent));
    } else if (now - this.lastHeard > HOLD_MS) {
      this.reset();
    }
  }

  private show(reading: NoteReading, freq: number): void {
    if (reading.midi !== this.shownMidi) {
      this.shownMidi = reading.midi;
      this.shownCents = reading.cents;
    } else {
      this.shownCents += (reading.cents - this.shownCents) * 0.35;
    }
    const c = this.shownCents;
    const state = Math.abs(c) <= IN_TUNE_CENTS ? 'in' : Math.abs(c) <= 15 ? 'near' : 'off';
    this.el.dataset.state = state;
    this.note.textContent = reading.name;
    this.octave.textContent = String(reading.octave);
    this.needle.style.left = `${50 + clamp(c, -50, 50)}%`;
    const rounded = Math.round(c);
    const direction = state === 'in' ? 'in tune' : c < 0 ? 'flat — tighten' : 'sharp — loosen';
    this.readout.textContent = `${freq.toFixed(1)} Hz · ${rounded > 0 ? '+' : ''}${rounded} cents · ${direction}`;
    for (const chip of this.strings.children) (chip as HTMLElement).classList.toggle('on', Number((chip as HTMLElement).dataset.midi) === reading.midi);
  }

  private reset(): void {
    this.recent = [];
    this.shownMidi = -1;
    delete this.el.dataset.state;
    this.note.textContent = '–';
    this.octave.textContent = '';
    this.needle.style.left = '50%';
    this.readout.textContent = 'Play a single string';
    for (const chip of this.strings.children) chip.classList.remove('on');
  }

  private buildStrings(): void {
    const midis = TUNINGS[this.settings.tuning];
    this.strings.replaceChildren(
      ...midis.map((m, i) => h('span', { class: 'tn-string', 'data-midi': String(m), title: `String ${midis.length - i}` }, `${noteLabel(m)}${Math.floor(m / 12) - 1}`)),
    );
  }

  private refreshSource(): void {
    const { engine, inputDevices } = this.app;
    const device = inputDevices.find((d) => d.id === engine.input.deviceId)?.label ?? 'System default input';
    this.source.textContent = engine.inputEnabled ? `Input ${engine.input.channel + 1} · ${device}` : 'Input off';
    this.enable.hidden = engine.inputEnabled;
  }

  private save(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* best effort */
    }
  }
}
