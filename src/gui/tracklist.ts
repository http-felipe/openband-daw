import type { Track } from '../core/project';
import { INSTRUMENT_DEFS } from '../synth/defs';
import type { App } from './app';
import { h } from './dom';
import { ICONS } from './icons';
import { ROW_H } from './timeline';
import { setMeter } from './toolbar';

interface RowRefs {
  row: HTMLElement;
  name: HTMLInputElement;
  mute: HTMLButtonElement;
  solo: HTMLButtonElement;
  arm: HTMLButtonElement;
  auto: HTMLButtonElement;
  input: HTMLButtonElement | null;
  vol: HTMLInputElement;
  pan: HTMLInputElement;
  meter: HTMLElement;
  sub: HTMLElement;
}

/** Track headers (left column): name, M/S/R, automation lane toggle, input monitor, fader, pan, meter. */
export class TrackList {
  private rows = new Map<string, RowRefs>();

  constructor(
    private readonly app: App,
    private readonly el: HTMLElement,
  ) {}

  render(): void {
    this.el.innerHTML = '';
    this.rows.clear();
    for (const t of this.app.store.project.tracks) this.el.append(this.buildRow(t));
    this.refresh();
  }

  refresh(): void {
    const { store } = this.app;
    const active = document.activeElement;
    for (const t of store.project.tracks) {
      const r = this.rows.get(t.id);
      if (!r) continue;
      r.row.classList.toggle('selected', t.id === store.ui.selectedTrackId);
      r.mute.classList.toggle('on', t.mute);
      r.solo.classList.toggle('on', t.solo);
      r.arm.classList.toggle('on', t.armed);
      const auto = store.ui.automation[t.id];
      r.auto.classList.toggle('on', !!auto);
      r.auto.textContent = auto === 'pan' ? 'P' : 'A';
      r.auto.title = auto ? `Showing ${auto} automation (click to cycle)` : 'Show automation lane';
      r.input?.classList.toggle('on', t.monitor);
      if (active !== r.name) r.name.value = t.name;
      if (active !== r.vol) r.vol.value = String(t.volume);
      if (active !== r.pan) r.pan.value = String(t.pan);
      r.vol.title = `Volume ${t.volume.toFixed(1)} dB`;
      r.pan.title = `Pan ${t.pan === 0 ? 'C' : t.pan < 0 ? `L${Math.round(-t.pan * 100)}` : `R${Math.round(t.pan * 100)}`}`;
      r.sub.textContent = t.kind === 'audio' ? 'Audio · amp/input' : `${INSTRUMENT_DEFS[t.instrument!.type].label} · ${t.instrument!.preset}`;
    }
  }

  tick(): void {
    for (const [id, r] of this.rows) setMeter(r.meter, this.app.engine.strips.get(id)?.level() ?? 0);
  }

  private buildRow(t: Track): HTMLElement {
    const { app } = this;
    const store = app.store;
    const small = (label: string, title: string, onclick: () => void, cls: string) =>
      h('button', { class: `trk-btn ${cls}`, title, 'aria-label': title, onclick: (e: Event) => (e.stopPropagation(), onclick()) }, label);

    const name = h('input', {
      class: 'trk-name',
      value: t.name,
      onchange: () => store.mutate(() => (t.name = name.value.trim() || t.name), 'params'),
      onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && name.blur(),
    });
    const fader = (min: number, max: number, step: number, value: number, set: (v: number) => void, reset: number, cls: string) => {
      const input = h('input', { type: 'range', class: `slider ${cls}`, min, max, step, value });
      input.addEventListener('pointerdown', (e) => (e.stopPropagation(), store.checkpoint()));
      input.addEventListener('input', () => (set(Number(input.value)), store.emit('params')));
      input.addEventListener('dblclick', () => store.mutate(() => set(reset), 'params'));
      return input;
    };
    const refs: RowRefs = {
      row: h('div'),
      name,
      mute: small('M', 'Mute', () => app.toggleTrackFlag(t.id, 'mute'), 'mute'),
      solo: small('S', 'Solo', () => app.toggleTrackFlag(t.id, 'solo'), 'solo'),
      arm: small('R', 'Record arm', () => app.toggleArm(t.id), 'arm'),
      auto: small('A', 'Show automation lane', () => app.cycleAutomation(t.id), 'auto'),
      input: t.kind === 'audio' ? small('I', 'Input monitoring (live amp)', () => void app.toggleMonitor(t.id), 'input') : null,
      vol: fader(-60, 6, 0.5, t.volume, (v) => (t.volume = v), 0, 'vol'),
      pan: fader(-1, 1, 0.01, t.pan, (v) => (t.pan = v), 0, 'pan'),
      meter: h('div', { class: 'meter-fill' }),
      sub: h('div', { class: 'trk-sub' }),
    };
    const del = h('button', {
      class: 'trk-btn del',
      title: 'Delete track',
      'aria-label': 'Delete track',
      innerHTML: ICONS.close,
      onclick: (e: Event) => (e.stopPropagation(), app.removeTrack(t.id)),
    });
    refs.row = h(
      'div',
      { class: 'trk', style: `--c:${t.color};height:${ROW_H}px`, onpointerdown: () => app.selectTrack(t.id) },
      h('div', { class: 'trk-color' }),
      h(
        'div',
        { class: 'trk-main' },
        h('div', { class: 'trk-top' }, h('span', { class: `trk-kind ${t.kind}` }, t.kind === 'audio' ? 'AUD' : INSTRUMENT_DEFS[t.instrument!.type].badge), name, del),
        refs.sub,
        h('div', { class: 'trk-ctrl' }, refs.mute, refs.solo, refs.arm, refs.auto, refs.input, h('span', { class: 'trk-lbl' }, 'Vol'), refs.vol, h('span', { class: 'trk-lbl' }, 'Pan'), refs.pan),
        h('div', { class: 'meter' }, refs.meter),
      ),
    );
    this.rows.set(t.id, refs);
    return refs.row;
  }
}
