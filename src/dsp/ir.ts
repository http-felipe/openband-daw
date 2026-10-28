// Procedurally generated impulse responses — no recorded IRs are shipped.

/** Small deterministic PRNG so the same settings always render the same IR (offline export == realtime). */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stereo exponentially decaying noise whose spectrum darkens over time, plus a few early reflections. */
export function makeReverbIR(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(256, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rand = rng(1234 + ch * 77);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const smoothing = 0.1 + 0.85 * t; // high-frequency damping grows with time
      lp += (rand() * 2 - 1 - lp) * (1 - smoothing);
      d[i] = lp * Math.exp(-6.9 * t); // -60 dB at the end
    }
    const fade = Math.min(len, Math.floor(sr * 0.004));
    for (let i = 0; i < fade; i++) d[i] *= i / fade;
    for (let k = 0; k < 8; k++) {
      const idx = Math.floor(sr * (0.007 + k * 0.011 + rand() * 0.005));
      if (idx < len) d[idx] += (rand() * 2 - 1) * 0.5 * (1 - k / 8);
    }
  }
  return buf;
}

export type CabinetVariant = 'vintage' | 'modern';

/** [frequency Hz, amplitude, decay τ seconds] resonances of an idealised speaker + enclosure. */
const CAB_MODES: Record<CabinetVariant, [number, number, number][]> = {
  vintage: [[110, 1, 0.01], [750, 0.5, 0.004], [1900, 0.55, 0.003], [3100, 0.3, 0.0018]],
  modern: [[85, 1, 0.012], [1300, 0.6, 0.0035], [2700, 0.6, 0.0028], [4200, 0.35, 0.0015]],
};

const cabCache = new WeakMap<BaseAudioContext, Map<CabinetVariant, AudioBuffer>>();

/** Short (~45 ms) synthetic cabinet IR: damped resonances + a noise transient, then a gentle top-end roll-off. */
export function makeCabinetIR(ctx: BaseAudioContext, variant: CabinetVariant): AudioBuffer {
  let cache = cabCache.get(ctx);
  if (!cache) cabCache.set(ctx, (cache = new Map()));
  const hit = cache.get(variant);
  if (hit) return hit;

  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.045);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rand = rng(variant === 'vintage' ? 7 : 11);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = (rand() * 2 - 1) * Math.exp(-t / 0.0015) * 0.5;
    for (const [f, a, tau] of CAB_MODES[variant]) s += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t);
    d[i] = s;
  }
  const c = variant === 'vintage' ? 0.35 : 0.5;
  let lp = 0;
  for (let i = 0; i < len; i++) d[i] = lp += (d[i] - lp) * c;
  cache.set(variant, buf);
  return buf;
}
