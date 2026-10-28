import type { ParamDef } from '../core/params';
import { h } from './dom';

const LOG_STEPS = 1000;

export function formatParam(def: ParamDef, v: number): string {
  if (def.options) return def.options[Math.round(v)] ?? String(v);
  const digits = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : def.step >= 0.01 ? 2 : 3;
  const text = def.unit === 'Hz' && v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} k` : v.toFixed(digits);
  return def.unit ? `${text}${def.unit === 'Hz' && v >= 1000 ? 'Hz' : ` ${def.unit}`}` : text;
}

const toSlider = (def: ParamDef, v: number) =>
  def.log ? Math.round((Math.log(v / def.min) / Math.log(def.max / def.min)) * LOG_STEPS) : v;
const fromSlider = (def: ParamDef, s: number) => {
  if (!def.log) return s;
  const v = def.min * Math.pow(def.max / def.min, s / LOG_STEPS);
  return Math.round(v / def.step) * def.step;
};

/**
 * A labelled control generated from a ParamDef: select for options, slider otherwise (log-scaled for
 * frequencies). `onStart` fires once per gesture so the caller can push a single undo checkpoint.
 * Double-click resets to the default value.
 */
export function paramControl(def: ParamDef, value: number, onChange: (v: number) => void, onStart: () => void): HTMLElement {
  if (def.options) {
    const sel = h(
      'select',
      { class: 'sel', onchange: () => (onStart(), onChange(Number(sel.value))) },
      ...def.options.map((o, i) => h('option', { value: String(i) }, o)),
    );
    sel.value = String(Math.round(value));
    return h('label', { class: 'param' }, h('span', { class: 'param-label' }, def.label), sel);
  }
  const out = h('span', { class: 'param-value' }, formatParam(def, value));
  const input = h('input', {
    type: 'range',
    class: 'slider',
    min: def.log ? 0 : def.min,
    max: def.log ? LOG_STEPS : def.max,
    step: def.log ? 1 : def.step,
    value: toSlider(def, value),
    title: 'Double-click to reset',
  });
  const commit = (v: number) => {
    out.textContent = formatParam(def, v);
    onChange(v);
  };
  input.addEventListener('pointerdown', onStart);
  input.addEventListener('keydown', onStart);
  input.addEventListener('input', () => commit(fromSlider(def, Number(input.value))));
  input.addEventListener('dblclick', () => {
    onStart();
    input.value = String(toSlider(def, def.def));
    commit(def.def);
  });
  return h('label', { class: 'param' }, h('span', { class: 'param-label' }, def.label), input, out);
}
