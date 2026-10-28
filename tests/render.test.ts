import { describe, expect, it } from 'vitest';
import { detectPitch } from '../src/dsp/pitch';
import { DRAWBAR_HARMONICS, drawbarHarmonics, renderModal, renderPluck } from '../src/synth/render';

const SR = 44100;
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

/** Pitch of a window taken after the attack transient. */
function pitchOf(buf: Float32Array, from = 0.15): number | null {
  const start = Math.floor(SR * from);
  return detectPitch(buf.subarray(start, start + 4096), SR);
}

const peak = (buf: Float32Array) => buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('renderPluck (Karplus–Strong)', () => {
  const spec = { brightness: 0.7, decay: 3, damping: 0.4, pick: 0.2 };
  for (const freq of [82.41, 110, 196, 329.63, 659.25]) {
    it(`is in tune at ${freq} Hz`, () => {
      const found = pitchOf(renderPluck(spec, freq, 0.8, SR));
      expect(found).not.toBeNull();
      expect(Math.abs(cents(found!, freq))).toBeLessThan(8);
    });
  }

  it('stays in tune with heavy damping and decays towards silence', () => {
    const buf = renderPluck({ ...spec, damping: 1, decay: 1.5 }, 146.83, 1, SR);
    expect(Math.abs(cents(pitchOf(buf)!, 146.83))).toBeLessThan(8);
    const early = peak(buf.subarray(0, SR * 0.2));
    const late = peak(buf.subarray(Math.floor(SR * 1.3), Math.floor(SR * 1.5)));
    expect(late).toBeLessThan(early * 0.05);
    expect(early).toBeLessThanOrEqual(1.5);
  });

  it('is louder at higher velocity', () => {
    expect(peak(renderPluck(spec, 220, 1, SR))).toBeGreaterThan(peak(renderPluck(spec, 220, 0.25, SR)) * 2);
  });
});

describe('renderModal (piano & mallets)', () => {
  const base = { brightness: 0.6, decay: 1, hardness: 0.4 };
  // The music box's strong inharmonic 6.27× mode confuses the detector while it rings; measure once it has died away.
  for (const [model, label, from] of [[0, 'grand piano', 0.05], [1, 'upright', 0.05], [2, 'marimba', 0.05], [3, 'vibraphone', 0.05], [5, 'music box', 1.2]] as const) {
    it(`${label} sounds at the played pitch`, () => {
      const found = pitchOf(renderModal({ ...base, model }, 220, 0.8, SR), from);
      expect(found).not.toBeNull();
      expect(Math.abs(cents(found!, 220))).toBeLessThan(10);
    });
  }

  it('produces finite, bounded samples across the keyboard', () => {
    for (const freq of [27.5, 65.4, 261.6, 1046.5, 4186]) {
      const buf = renderModal({ ...base, model: 0 }, freq, 1, SR);
      expect(buf.every(Number.isFinite)).toBe(true);
      expect(peak(buf)).toBeLessThan(2);
      expect(peak(buf)).toBeGreaterThan(0.01);
    }
  });
});

describe('drawbarHarmonics', () => {
  it('maps drawbars to harmonics of the 16\' pitch with 3 dB steps', () => {
    const imag = drawbarHarmonics([8, 0, 8, 0, 0, 0, 0, 0, 0]);
    expect(imag[DRAWBAR_HARMONICS[0]]).toBeCloseTo(1, 6); // 16'
    expect(imag[DRAWBAR_HARMONICS[2]]).toBeCloseTo(1, 6); // 8' = 2nd harmonic of 16'
    expect(imag[3]).toBe(0);
    expect(drawbarHarmonics([5, 0, 0, 0, 0, 0, 0, 0, 0])[1]).toBeCloseTo(Math.pow(10, -9 / 20), 6);
  });
});
