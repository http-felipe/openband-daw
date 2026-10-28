import { describe, expect, it } from 'vitest';
import { encodeWav, fromBase64, toBase64 } from '../src/core/wav';
import { parseMidiMessage } from '../src/midi/webmidi';
import { shapeSample } from '../src/dsp/shapes';

describe('WAV encoding', () => {
  const src = {
    numberOfChannels: 2,
    sampleRate: 48000,
    length: 3,
    getChannelData: (ch: number) => (ch === 0 ? new Float32Array([0, 1, -1]) : new Float32Array([0.5, 2, -2])),
  };

  it('writes a valid 16-bit PCM header and clamps samples', () => {
    const v = new DataView(encodeWav(src));
    const ascii = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(3 * 2 * 2);
    // interleaved: L0 R0 L1 R1 L2 R2
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(v.getInt16(48, true)).toBe(0x7fff);
    expect(v.getInt16(50, true)).toBe(0x7fff);
    expect(v.getInt16(52, true)).toBe(-0x8000);
  });

  it('survives a base64 round trip', () => {
    const wav = encodeWav(src);
    expect(new Uint8Array(fromBase64(toBase64(wav)))).toEqual(new Uint8Array(wav));
  });
});

describe('MIDI parsing', () => {
  it('decodes note on/off, velocity-0 note off, CC and pitch bend', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ type: 'on', note: 60, velocity: 100, channel: 0 });
    expect(parseMidiMessage([0x91, 60, 0])).toEqual({ type: 'off', note: 60, channel: 1 });
    expect(parseMidiMessage([0x80, 61, 64])).toEqual({ type: 'off', note: 61, channel: 0 });
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'cc', controller: 64, value: 127, channel: 0 });
    expect(parseMidiMessage([0xe0, 0, 64])).toEqual({ type: 'bend', value: 0, channel: 0 });
    expect(parseMidiMessage([0xf8])).toBeNull();
  });
});

describe('saturation curves', () => {
  it('are bounded, odd-ish and silent at zero', () => {
    for (const mode of [0, 1, 2, 3]) {
      expect(shapeSample(0, mode)).toBeCloseTo(0, 9);
      for (const x of [-100, -1, -0.1, 0.1, 1, 100]) expect(Math.abs(shapeSample(x, mode))).toBeLessThanOrEqual(1.5);
    }
    expect(shapeSample(10, 1)).toBe(1);
    expect(shapeSample(-10, 1)).toBe(-1);
  });
});
