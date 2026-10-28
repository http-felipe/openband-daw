type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

/**
 * Tiny element factory. `on*` keys become listeners, known DOM properties are assigned, everything
 * else becomes an attribute. `value` is applied last so range inputs see their min/max first.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  let value: unknown;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' || k.startsWith('data-') || k.startsWith('aria-')) el.setAttribute(k, String(v));
    else if (k in el) (el as unknown as Attrs)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  if (value !== undefined) (el as unknown as Attrs).value = value;
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function select(options: [string, string][], value: string, onChange: (v: string) => void, cls = 'sel'): HTMLSelectElement {
  const s = h('select', { class: cls, onchange: () => onChange(s.value) }, ...options.map(([v, label]) => h('option', { value: v }, label)));
  s.value = value;
  return s;
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** '#rrggbb' + alpha → 'rgba(...)'. */
export function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Size a canvas for crisp rendering; returns true when the backing store changed. */
export function sizeCanvas(c: HTMLCanvasElement, width: number, height: number, dpr: number): boolean {
  const w = Math.max(1, Math.round(width * dpr));
  const hh = Math.max(1, Math.round(height * dpr));
  if (c.width === w && c.height === hh) return false;
  c.width = w;
  c.height = hh;
  c.style.width = `${width}px`;
  c.style.height = `${height}px`;
  return true;
}

export const CANVAS = {
  bg: '#16181d',
  row: '#1a1d23',
  rowAlt: '#1c1f26',
  rowSel: '#232834',
  bar: '#343a48',
  beat: '#262b35',
  sub: '#20242c',
  line: '#0f1115',
  text: '#c9ceda',
  muted: '#7f879a',
  accent: '#ff9f43',
  playhead: '#ff9f43',
  auto: '#ffd166',
  ruler: '#1d2027',
};
