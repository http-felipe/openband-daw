// Offline note rendering for physically-inspired instruments. Pure functions (Float32Array in/out), so they
// run anywhere — including tests — and their output is cached per note by the instruments.

const TAU = Math.PI * 2;
const LN_1000 = Math.log(1000); // −60 dB

/** Deterministic noise so a given note always renders identically (offline export == realtime). */
function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

const midiOf = (freq: number) => 69 + 12 * Math.log2(freq / 440);

/** Removes DC and fades the last few ms so a truncated tail never clicks. */
function finish(out: Float32Array, sr: number): Float32Array {
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < out.length; i++) {
    const y = out[i] - x1 + 0.995 * y1;
    x1 = out[i];
    y1 = y;
    out[i] = y;
  }
  const fade = Math.min(out.length, Math.floor(sr * 0.03));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

// ---------------------------------------------------------------- plucked strings (Karplus–Strong)

export interface PluckSpec {
  /** 0..1 excitation brightness (pick hardness). */
  brightness: number;
  /** Seconds until the fundamental has decayed by 60 dB. */
  decay: number;
  /** 0..1 loss-filter strength: higher = high harmonics die faster (darker, nylon-like). */
  damping: number;
  /** 0..1 plucking position from the bridge (comb-filters the excitation). */
  pick: number;
}

/**
 * Extended Karplus–Strong: a filtered noise burst circulates in a fractional delay line of one period,
 * through a blend of all-pass and two-point-average loss filters whose delay is compensated so the pitch stays true.
 */
export function renderPluck(spec: PluckSpec, freq: number, velocity: number, sr: number): Float32Array {
  const period = sr / freq;
  const len = Math.ceil(sr * Math.min(8, spec.decay * 1.1 + 0.1));
  const out = new Float32Array(len);

  const exLen = Math.max(2, Math.round(period));
  const ex = new Float32Array(exLen);
  const rand = rng(Math.round(freq * 997));
  const coef = Math.min(1, Math.max(0.02, spec.brightness * (0.45 + 0.55 * velocity)));
  let lp = 0;
  for (let i = 0; i < exLen; i++) ex[i] = lp += (rand() - lp) * coef;
  const pickOff = Math.round(spec.pick * exLen * 0.5);
  if (pickOff > 0) for (let i = exLen - 1; i >= pickOff; i--) ex[i] -= ex[i - pickOff];
  let peak = 0;
  for (let i = 0; i < exLen; i++) peak = Math.max(peak, Math.abs(ex[i]));
  const scale = velocity / (peak || 1);

  const damp = Math.min(1, Math.max(0, spec.damping));
  const delay = period - 0.5 * damp; // the averaging filter adds half a sample of delay
  const g = Math.pow(10, -3 / (Math.max(0.05, spec.decay) * freq)); // per-period loss for the requested T60
  for (let n = 0; n < len; n++) {
    let x = n < exLen ? ex[n] * scale : 0;
    const pos = n - delay;
    if (pos >= 1) {
      const i = Math.floor(pos);
      const f = pos - i;
      const cur = out[i] + (out[i + 1] - out[i]) * f;
      const prev = out[i - 1] + (out[i] - out[i - 1]) * f;
      x += g * ((1 - damp) * cur + damp * 0.5 * (cur + prev));
    }
    out[n] = x;
  }
  return finish(out, sr);
}

// ---------------------------------------------------------------- modal synthesis (piano & mallets)

export const MODAL_MODELS = ['Grand Piano', 'Upright Piano', 'Marimba', 'Vibraphone', 'Kalimba', 'Music Box', 'Steel Drum', 'Glockenspiel'];

/** [frequency ratio, relative amplitude, T60 seconds at middle C] per mode, for the mallet/tine models. */
const MALLET_MODES: Record<number, [number, number, number][]> = {
  2: [[1, 1, 0.8], [3.99, 0.22, 0.22], [10.65, 0.06, 0.06]],
  3: [[1, 1, 4.5], [3.99, 0.32, 1.2], [9.2, 0.1, 0.35]],
  4: [[1, 1, 2.2], [5.4, 0.28, 0.4], [9.6, 0.1, 0.15]],
  5: [[1, 1, 2.6], [6.27, 0.35, 0.6], [17.55, 0.15, 0.2]],
  6: [[1, 1, 1.6], [2, 0.6, 1.3], [3, 0.35, 0.9], [4.03, 0.2, 0.6], [5.1, 0.12, 0.4]],
  7: [[1, 1, 3.2], [2.71, 0.35, 1.1], [5.15, 0.2, 0.5], [8.43, 0.1, 0.3]],
};

export interface ModalSpec {
  model: number;
  /** 0..1 upper-partial strength. */
  brightness: number;
  /** Multiplier on all decay times. */
  decay: number;
  /** 0..1 strike noise (hammer/mallet contact). */
  hardness: number;
}

interface Mode {
  freq: number;
  amp: number;
  t60: number;
}

function modesFor(spec: ModalSpec, freq: number, velocity: number): Mode[] {
  const modes: Mode[] = [];
  if (spec.model <= 1) {
    // Piano: stiff-string partials f_n = n·f·√(1 + B·n²), struck 1/8 along the string,
    // a slightly detuned second string per key for beating, and a longer, quieter "aftersound".
    const upright = spec.model === 1;
    const midi = midiOf(freq);
    const B = (upright ? 0.0003 : 0.00012) * Math.pow(2, (midi - 60) / 24);
    const tilt = 1.7 - spec.brightness * (0.5 + 0.5 * velocity);
    const t1 = Math.min(14, Math.max(0.8, 7 * Math.pow(261.6 / freq, 0.55))) * (upright ? 0.6 : 1) * spec.decay;
    const count = Math.min(22, Math.floor(9000 / freq));
    for (let n = 1; n <= count; n++) {
      const ratio = n * Math.sqrt(1 + B * n * n);
      const amp = Math.abs(Math.sin(Math.PI * n * 0.125)) / Math.pow(n, tilt);
      if (amp < 1e-3) continue; // the strike-position node: inaudible, skip the work
      const t60 = t1 / (1 + 0.25 * (n - 1));
      modes.push({ freq: freq * ratio, amp, t60 });
      if (n <= 8) modes.push({ freq: freq * ratio * 1.0008, amp: amp * 0.35, t60: t60 * 1.6 });
    }
    return modes;
  }
  const upper = 0.3 + 1.4 * spec.brightness * (0.6 + 0.4 * velocity);
  const scale = Math.pow(261.6 / freq, spec.model === 2 ? 0.4 : 0.2) * spec.decay;
  MALLET_MODES[spec.model].forEach(([ratio, amp, t60], i) => modes.push({ freq: freq * ratio, amp: i ? amp * upper : amp, t60: t60 * scale }));
  return modes;
}

/** Sum of exponentially decaying sinusoidal modes (damped two-pole resonators) plus a strike transient. */
export function renderModal(spec: ModalSpec, freq: number, velocity: number, sr: number): Float32Array {
  const modes = modesFor(spec, freq, velocity).filter((m) => m.freq < sr * 0.45);
  const longest = Math.max(0.2, ...modes.map((m) => m.t60));
  const len = Math.ceil(sr * Math.min(6, longest + 0.05));
  const out = new Float32Array(len);
  const total = modes.reduce((s, m) => s + m.amp, 0) || 1;
  // ×0.5 (−6 dB) matches the loudness of the other engines for the same chord.
  const gain = (0.5 * (0.25 + 0.75 * velocity)) / total;

  for (const m of modes) {
    const w = (TAU * m.freq) / sr;
    const r = Math.exp(-LN_1000 / (m.t60 * sr));
    const c = 2 * r * Math.cos(w);
    const r2 = r * r;
    const a = m.amp * gain;
    // Stop once this mode is below −80 dB relative to its start (inaudible under the others).
    const end = Math.min(len, Math.ceil(Math.log(1e-4) / Math.log(r)));
    let y1 = a * r * Math.sin(w);
    let y2 = 0;
    for (let n = 1; n < end; n++) {
      out[n] += y1;
      const y = c * y1 - r2 * y2;
      y2 = y1;
      y1 = y;
    }
  }

  // Strike transient: short low-passed noise burst.
  const noiseLen = Math.floor(sr * 0.012);
  const rand = rng(Math.round(freq * 131));
  const coef = Math.min(1, (freq * 6) / sr + 0.05);
  let lp = 0;
  const amt = spec.hardness * 0.25 * velocity;
  for (let n = 0; n < Math.min(noiseLen, len); n++) {
    lp += (rand() - lp) * coef;
    out[n] += lp * amt * Math.exp(-n / (sr * 0.003));
  }
  // Pianos get a ~2 ms onset so the hammer doesn't click; mallets keep their sharp attack.
  if (spec.model <= 1) {
    const att = Math.floor(sr * 0.002);
    for (let n = 0; n < att && n < len; n++) out[n] *= n / att;
  }
  return finish(out, sr);
}

// ---------------------------------------------------------------- tonewheel organ

export const DRAWBAR_LABELS = ["16'", "5⅓'", "8'", "4'", "2⅔'", "2'", "1⅗'", "1⅓'", "1'"];
/** Harmonic number of each drawbar relative to the 16' sub-fundamental (one octave below the played note). */
export const DRAWBAR_HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16];

/**
 * Fourier coefficients (sine terms) for a PeriodicWave whose fundamental is the 16' pitch.
 * Each drawbar step is ~3 dB, as on tonewheel organs; 0 is silent.
 */
export function drawbarHarmonics(levels: number[]): Float32Array {
  const imag = new Float32Array(17);
  levels.forEach((level, i) => {
    if (level > 0) imag[DRAWBAR_HARMONICS[i]] += Math.pow(10, ((Math.round(level) - 8) * 3) / 20);
  });
  return imag;
}
