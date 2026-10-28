// Monophonic pitch detection for the tuner (YIN: de Cheveigné & Kawahara, 2002).

export interface PitchOptions {
  minHz?: number;
  maxHz?: number;
  /** Below this RMS the frame is treated as silence. */
  minRms?: number;
  /** Aperiodicity threshold of the normalised difference function (lower = stricter). */
  threshold?: number;
}

let scratch = new Float32Array(0);

/**
 * Fundamental frequency of `buf` in Hz, or null when the frame is silent or not periodic enough.
 * The defaults cover a 5-string bass (B0 ≈ 31 Hz) up to the high frets of a guitar.
 */
export function detectPitch(buf: Float32Array, sampleRate: number, opts: PitchOptions = {}): number | null {
  const { minHz = 30, maxHz = 1400, minRms = 0.003, threshold = 0.12 } = opts;
  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
  if (Math.sqrt(energy / buf.length) < minRms) return null;

  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const window = buf.length - maxTau;
  if (scratch.length < maxTau + 1) scratch = new Float32Array(maxTau + 1);
  const d = scratch;

  // Difference function, then cumulative-mean normalisation (d'(0) = 1).
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // First dip below the threshold, followed down to its local minimum (avoids octave-too-low errors).
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Parabolic interpolation around the minimum for sub-sample accuracy.
  const a = d[tau - 1] ?? d[tau];
  const b = d[tau];
  const c = tau + 1 <= maxTau ? d[tau + 1] : d[tau];
  const denom = a - 2 * b + c;
  const refined = denom !== 0 ? tau + (0.5 * (a - c)) / denom : tau;
  return sampleRate / refined;
}

/**
 * Halves the sample rate by averaging sample pairs (a crude but sufficient anti-alias filter here):
 * tuner pitches are far below the new Nyquist, and YIN's cost drops ~4×.
 */
export function downsample2(src: Float32Array, dst: Float32Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] = 0.5 * (src[2 * i] + src[2 * i + 1]);
}

const NOTE_NAMES =['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface NoteReading {
  midi: number;
  name: string;
  octave: number;
  /** Deviation from the nearest equal-tempered note, −50…+50. */
  cents: number;
}

export function noteFromFrequency(freq: number, a4 = 440): NoteReading {
  const exact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(exact);
  return { midi, name: NOTE_NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: (exact - midi) * 100 };
}

export const frequencyOf = (midi: number, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);
