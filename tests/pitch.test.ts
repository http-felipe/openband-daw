import { describe, expect, it } from 'vitest';
import { detectPitch, downsample2, frequencyOf, noteFromFrequency } from '../src/dsp/pitch';

const SR = 44100;
const N = 4096;

function tone(freq: number, harmonics: number[] = [1], amp = 0.3, noise = 0): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    harmonics.forEach((h, k) => (s += h * Math.sin((2 * Math.PI * freq * (k + 1) * i) / SR)));
    out[i] = amp * s + noise * (Math.random() * 2 - 1);
  }
  return out;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('detectPitch', () => {
  // Standard guitar tuning plus a bass low E and a high fret.
  for (const f of [41.2, 82.41, 110, 146.83, 196, 246.94, 329.63, 880]) {
    it(`finds ${f} Hz within 2 cents`, () => {
      const found = detectPitch(tone(f), SR);
      expect(found).not.toBeNull();
      expect(Math.abs(cents(found!, f))).toBeLessThan(2);
    });
  }

  it('is not fooled by a strong 2nd harmonic (no octave error)', () => {
    // A plucked low E often has more energy at 2× than at the fundamental.
    const found = detectPitch(tone(82.41, [0.4, 1, 0.6, 0.3]), SR);
    expect(Math.abs(cents(found!, 82.41))).toBeLessThan(5);
  });

  it('tolerates some noise', () => {
    const found = detectPitch(tone(110, [1, 0.5], 0.3, 0.02), SR);
    expect(Math.abs(cents(found!, 110))).toBeLessThan(5);
  });

  it('stays accurate on the half-rate signal the tuner analyses', () => {
    for (const f of [30.87, 82.41, 329.63, 987.77]) {
      const half = new Float32Array(N / 2);
      downsample2(tone(f, [1, 0.6, 0.3]), half);
      const found = detectPitch(half, SR / 2);
      expect(Math.abs(cents(found!, f))).toBeLessThan(2);
    }
  });

  it('returns null for silence and for pure noise', () => {
    expect(detectPitch(new Float32Array(N), SR)).toBeNull();
    const noise = new Float32Array(N).map(() => (Math.random() * 2 - 1) * 0.3);
    expect(detectPitch(noise, SR)).toBeNull();
  });
});

describe('noteFromFrequency', () => {
  it('names notes and measures cents', () => {
    expect(noteFromFrequency(440)).toMatchObject({ name: 'A', octave: 4, midi: 69 });
    expect(noteFromFrequency(82.41)).toMatchObject({ name: 'E', octave: 2 });
    expect(noteFromFrequency(440 * Math.pow(2, 10 / 1200)).cents).toBeCloseTo(10, 5);
    expect(noteFromFrequency(440 * Math.pow(2, -20 / 1200)).cents).toBeCloseTo(-20, 5);
  });

  it('honours a different reference pitch', () => {
    expect(noteFromFrequency(432, 432)).toMatchObject({ name: 'A', octave: 4 });
    expect(noteFromFrequency(432, 432).cents).toBeCloseTo(0, 5);
    expect(frequencyOf(69, 442)).toBe(442);
  });
});
