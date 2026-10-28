import { createFx, type FxSlot, type FxType } from '../core/project';
import { AMP_PRESETS, FX_DEFS } from '../dsp/fx/defs';
import type { App } from './app';
import { h } from './dom';
import { ICONS } from './icons';
import { paramControl } from './param-controls';

/** Per-channel insert rack (or the master bus): add, bypass, reorder, remove and tweak effects. */
export class FxRack {
  readonly el = h('div', { class: 'panel-pad fx-panel' });

  constructor(private readonly app: App) {}

  render(): void {
    this.el.innerHTML = '';
    const store = this.app.store;
    const ui = store.ui;
    const { track } = store.selection();
    const master = ui.fxTarget === 'master' || !track;
    const slots = master ? store.project.master.fx : track.fx;
    const setTarget = (t: 'track' | 'master') => () => {
      ui.fxTarget = t;
      this.render();
    };

    const add = h(
      'select',
      {
        class: 'sel',
        onchange: () => {
          const type = add.value as FxType;
          add.value = '';
          if (type) store.mutate(() => slots.push(createFx(type)));
        },
      },
      h('option', { value: '' }, '+ Add effect…'),
      ...Object.entries(FX_DEFS).map(([k, d]) => h('option', { value: k }, d.label)),
    );
    const amp = h(
      'select',
      {
        class: 'sel',
        onchange: () => {
          const name = amp.value;
          amp.value = '';
          if (name) this.app.applyAmpPreset(slots, name);
        },
      },
      h('option', { value: '' }, 'Load amp chain…'),
      ...Object.keys(AMP_PRESETS).map((k) => h('option', { value: k }, k)),
    );

    this.el.append(
      h(
        'div',
        { class: 'panel-head' },
        h(
          'div',
          { class: 'seg' },
          h('button', { class: !master ? 'on' : '', disabled: !track, onclick: setTarget('track') }, track ? `Track: ${track.name}` : 'Track'),
          h('button', { class: master ? 'on' : '', onclick: setTarget('master') }, 'Master bus'),
        ),
        add,
        amp,
        h('span', { class: 'hint' }, 'Signal flows left → right. The power button bypasses a module.'),
      ),
    );

    const chain = h('div', { class: 'fx-chain' }, h('div', { class: 'fx-io' }, master ? 'Mix' : track!.kind === 'audio' ? 'Input' : 'Instrument'));
    if (!slots.length) chain.append(h('div', { class: 'fx-empty' }, 'No effects — add one above or load an amp chain.'));
    slots.forEach((slot, i) => chain.append(this.card(slot, i, slots)));
    chain.append(h('div', { class: 'fx-io' }, master ? 'Output' : 'Fader'));
    this.el.append(chain);
  }

  private card(slot: FxSlot, index: number, slots: FxSlot[]): HTMLElement {
    const store = this.app.store;
    const def = FX_DEFS[slot.type];
    const icon = (svg: string, title: string, fn: () => void, disabled = false, cls = '') =>
      h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, innerHTML: svg, disabled, onclick: fn });
    const move = (d: number) => () =>
      store.mutate(() => {
        const [s] = slots.splice(index, 1);
        slots.splice(index + d, 0, s);
      });
    return h(
      'div',
      { class: `fx-card ${slot.bypass ? 'off' : ''}` },
      h(
        'div',
        { class: 'fx-head' },
        icon(ICONS.power, slot.bypass ? 'Enable' : 'Bypass', () => store.mutate(() => (slot.bypass = !slot.bypass)), false, slot.bypass ? '' : 'on'),
        h('span', { class: 'fx-title' }, def.label),
        icon(ICONS.left, 'Move earlier', move(-1), index === 0),
        icon(ICONS.right, 'Move later', move(1), index === slots.length - 1),
        icon(ICONS.close, 'Remove', () => store.mutate(() => slots.splice(index, 1))),
      ),
      h(
        'div',
        { class: 'fx-params' },
        ...def.params.map((d) =>
          paramControl(
            d,
            slot.params[d.key] ?? d.def,
            (v) => {
              slot.params[d.key] = v;
              store.emit('params');
            },
            () => store.checkpoint(),
          ),
        ),
      ),
    );
  }
}
