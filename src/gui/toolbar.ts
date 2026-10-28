import { beatsPerBar, clamp } from '../core/project';
import type { SnapKey } from '../core/store';
import type { App } from './app';
import { h, select } from './dom';
import { ICONS } from './icons';

const SNAPS: [SnapKey, string][] = [
  ['bar', 'Bar'],
  ['1/4', '1/4'],
  ['1/8', '1/8'],
  ['1/16', '1/16'],
  ['1/32', '1/32'],
  ['off', 'Off'],
];
const SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'];

export class Toolbar {
  private play: HTMLButtonElement;
  private rec: HTMLButtonElement;
  private loop: HTMLButtonElement;
  private metro: HTMLButtonElement;
  private tuner: HTMLButtonElement;
  private undo: HTMLButtonElement;
  private redo: HTMLButtonElement;
  private bpm: HTMLInputElement;
  private sig: HTMLSelectElement;
  private snap: HTMLSelectElement;
  private countIn: HTMLSelectElement;
  private name: HTMLInputElement;
  private pos: HTMLElement;
  private clock: HTMLElement;
  private masterVol: HTMLInputElement;
  private masterMeter: HTMLElement;

  constructor(
    private readonly app: App,
    root: HTMLElement,
  ) {
    const btn = (icon: string, title: string, onclick: () => void, cls = '') =>
      h('button', { class: `tb-btn ${cls}`, title, 'aria-label': title, innerHTML: icon, onclick });
    const store = app.store;

    this.play = btn(ICONS.play, 'Play / Pause (Space)', () => app.togglePlay(), 'play');
    this.rec = btn(ICONS.record, 'Record (R)', () => void app.toggleRecord(), 'rec');
    this.loop = btn(ICONS.loop, 'Cycle / loop (L)', () => app.toggleLoop());
    this.metro = btn(ICONS.metronome, 'Metronome (K)', () => app.toggleMetronome());
    this.tuner = btn(ICONS.tuner, 'Tuner', () => app.tuner.toggle());
    this.undo = btn(ICONS.undo, 'Undo (⌘Z)', () => store.undo());
    this.redo = btn(ICONS.redo, 'Redo (⇧⌘Z)', () => store.redo());

    this.pos = h('span', { class: 'lcd-pos' }, '1.1.1');
    this.clock = h('span', { class: 'lcd-time' }, '0:00.0');

    this.bpm = h('input', {
      class: 'num lcd-input',
      type: 'number',
      min: 20,
      max: 300,
      step: 1,
      title: 'Tempo (BPM)',
      onchange: () => store.mutate((p) => (p.bpm = clamp(Math.round(Number(this.bpm.value) || 120), 20, 300)), 'params'),
    });
    this.sig = select(
      SIGNATURES.map((s) => [s, s]),
      '4/4',
      (v) => store.mutate((p) => (p.timeSignature = v.split('/').map(Number) as [number, number]), 'params'),
      'sel lcd-input',
    );
    this.snap = select(SNAPS, store.ui.snap, (v) => {
      store.ui.snap = v as SnapKey;
      store.emit('view');
    });
    this.snap.title = 'Snap to grid';
    this.countIn = select(
      [
        ['0', 'No count-in'],
        ['1', 'Count-in 1 bar'],
        ['2', 'Count-in 2 bars'],
      ],
      String(app.countInBars),
      (v) => app.setCountIn(Number(v)),
    );
    this.countIn.title = 'Metronome bars before recording starts (when recording from stop)';

    this.name = h('input', {
      class: 'txt project-name',
      title: 'Project name',
      onchange: () => store.mutate((p) => (p.name = this.name.value.trim() || 'Untitled'), 'params'),
    });

    this.masterVol = h('input', { type: 'range', class: 'slider', min: -60, max: 6, step: 0.5, title: 'Master volume' });
    this.masterVol.addEventListener('pointerdown', () => store.checkpoint());
    this.masterVol.addEventListener('input', () => {
      store.project.master.volume = Number(this.masterVol.value);
      store.emit('params');
    });
    this.masterVol.addEventListener('dblclick', () => store.mutate((p) => (p.master.volume = 0), 'params'));
    this.masterMeter = h('div', { class: 'meter-fill' });

    const textBtn = (label: string, title: string, onclick: () => void) => h('button', { class: 'tb-text', title, onclick }, label);

    root.append(
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '◐'), h('span', {}, 'OpenBand')),
      h('div', { class: 'tb-group' }, btn(ICONS.rewind, 'Go to start (Enter)', () => app.goToStart()), this.play, btn(ICONS.stop, 'Stop', () => app.stop()), this.rec),
      h(
        'div',
        { class: 'lcd' },
        h('div', { class: 'lcd-cell' }, this.pos, h('small', {}, 'position')),
        h('div', { class: 'lcd-cell' }, this.clock, h('small', {}, 'time')),
        h('div', { class: 'lcd-cell' }, this.bpm, h('small', {}, 'bpm')),
        h('div', { class: 'lcd-cell' }, this.sig, h('small', {}, 'signature')),
      ),
      h('div', { class: 'tb-group' }, this.loop, this.metro, this.tuner),
      this.countIn,
      h('label', { class: 'tb-snap' }, h('span', {}, 'Snap'), this.snap),
      h('div', { class: 'tb-spacer' }),
      this.name,
      h('div', { class: 'tb-group' }, this.undo, this.redo),
      h(
        'div',
        { class: 'tb-group files' },
        textBtn('New', 'New empty project', () => app.newProject()),
        textBtn('Open', 'Open project (⌘O)', () => app.openProject()),
        textBtn('Save', 'Save project (⌘S)', () => app.saveProject()),
        textBtn('Export', 'Bounce the song to WAV', () => void app.exportWav()),
        textBtn('Demo', 'Load the demo song', () => app.loadDemo()),
      ),
      h('div', { class: 'tb-master' }, h('span', {}, 'Master'), this.masterVol, h('div', { class: 'meter' }, this.masterMeter)),
    );
    this.refresh();
  }

  refresh(): void {
    const { store, transport } = this.app;
    const p = store.project;
    this.play.innerHTML = transport.playing ? ICONS.pause : ICONS.play;
    this.play.classList.toggle('on', transport.playing);
    this.rec.classList.toggle('on', transport.recording);
    this.loop.classList.toggle('on', p.loop.enabled);
    this.metro.classList.toggle('on', transport.metronome);
    this.tuner.classList.toggle('on', this.app.tuner.isOpen);
    this.undo.disabled = !store.canUndo;
    this.redo.disabled = !store.canRedo;
    const active = document.activeElement;
    if (active !== this.bpm) this.bpm.value = String(p.bpm);
    this.sig.value = p.timeSignature.join('/');
    this.snap.value = store.ui.snap;
    if (active !== this.name) this.name.value = p.name;
    if (active !== this.masterVol) this.masterVol.value = String(p.master.volume);
  }

  /** Called every animation frame. */
  tick(): void {
    const { store, transport, engine } = this.app;
    const p = store.project;
    const raw = transport.currentBeat();
    const countIn = transport.countInEnd;
    this.pos.classList.toggle('counting', countIn !== null && raw < countIn);
    if (countIn !== null && raw < countIn) {
      // Count-in: show the beats left before recording starts.
      this.pos.textContent = `− ${Math.ceil(countIn - raw)} −`;
      setMeter(this.masterMeter, engine.masterLevel());
      return;
    }
    const beat = Math.max(0, raw);
    const bpb = beatsPerBar(p);
    const bar = Math.floor(beat / bpb) + 1;
    const inBar = beat - (bar - 1) * bpb;
    this.pos.textContent = `${bar}.${Math.floor(inBar) + 1}.${Math.floor((inBar % 1) * 4) + 1}`;
    const secs = (beat * 60) / p.bpm;
    this.clock.textContent = `${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, '0')}`;
    setMeter(this.masterMeter, engine.masterLevel());
  }
}

const meterHold = new WeakMap<HTMLElement, number>();

/** Peak meter: -60 dBFS … +6 dBFS mapped to width, with a falling ballistic so short transients stay visible. */
export function setMeter(el: HTMLElement, peak: number): void {
  const shown = Math.max(peak, (meterHold.get(el) ?? 0) * 0.92);
  meterHold.set(el, shown);
  const db = 20 * Math.log10(shown + 1e-9);
  el.style.width = `${clamp((db + 60) / 66, 0, 1) * 100}%`;
  el.classList.toggle('clip', peak >= 1);
}
