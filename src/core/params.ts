/** Declarative description of one automatable/editable parameter. The UI and validation are generated from these. */
export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** Discrete choice; the stored value is the option index. */
  options?: string[];
  /** Slider moves on a logarithmic scale (frequencies). */
  log?: boolean;
}

export function optionParam(key: string, label: string, options: string[], def = 0): ParamDef {
  return { key, label, min: 0, max: options.length - 1, step: 1, def, options };
}

export function defaultsOf(defs: ParamDef[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs) out[d.key] = d.def;
  return out;
}

/** Keeps only known keys, fills missing ones with defaults and clamps everything into range. */
export function sanitizeParams(defs: ParamDef[], raw: unknown): Record<string, number> {
  const out = defaultsOf(defs);
  if (raw && typeof raw === 'object') {
    const src = raw as Record<string, unknown>;
    for (const d of defs) {
      const v = src[d.key];
      if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = Math.min(d.max, Math.max(d.min, v));
    }
  }
  return out;
}
