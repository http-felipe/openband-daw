import type { FxType } from '../../core/project';
import { defaultsOf, optionParam, type ParamDef } from '../../core/params';
import { DRIVE_MODES } from '../shapes';

export const CABINET_MODES = ['1x12 Filter', '4x12 Filter', 'Vintage IR', 'Modern IR'];

export const DELAY_SYNC: { label: string; beats: number }[] = [
  { label: 'Free', beats: 0 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8 dotted', beats: 0.75 },
  { label: '1/16', beats: 0.25 },
  { label: '1/4 triplet', beats: 2 / 3 },
];

export const FX_DEFS: Record<FxType, { label: string; params: ParamDef[] }> = {
  gain: {
    label: 'Gain',
    params: [{ key: 'gain', label: 'Gain', min: -24, max: 36, step: 0.5, def: 0, unit: 'dB' }],
  },
  eq3: {
    label: '3-Band EQ',
    params: [
      { key: 'low', label: 'Low', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
      { key: 'mid', label: 'Mid', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
      { key: 'midFreq', label: 'Mid Freq', min: 200, max: 5000, step: 1, def: 800, unit: 'Hz', log: true },
      { key: 'high', label: 'High', min: -15, max: 15, step: 0.5, def: 0, unit: 'dB' },
    ],
  },
  drive: {
    label: 'Drive',
    params: [
      optionParam('mode', 'Mode', DRIVE_MODES, 0),
      { key: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'output', label: 'Output', min: -36, max: 12, step: 0.5, def: -6, unit: 'dB' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  cabinet: {
    label: 'Cabinet',
    params: [
      optionParam('mode', 'Model', CABINET_MODES, 0),
      { key: 'lowCut', label: 'Low Cut', min: 30, max: 300, step: 1, def: 80, unit: 'Hz', log: true },
      { key: 'highCut', label: 'High Cut', min: 1500, max: 12000, step: 10, def: 5000, unit: 'Hz', log: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    ],
  },
  delay: {
    label: 'Delay',
    params: [
      optionParam('sync', 'Sync', DELAY_SYNC.map((s) => s.label), 2),
      { key: 'time', label: 'Time', min: 10, max: 1500, step: 1, def: 350, unit: 'ms' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, step: 0.01, def: 0.35 },
      { key: 'tone', label: 'Tone', min: 500, max: 12000, step: 10, def: 4000, unit: 'Hz', log: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.25 },
    ],
  },
  reverb: {
    label: 'Reverb',
    params: [
      { key: 'decay', label: 'Decay', min: 0.2, max: 8, step: 0.1, def: 2.2, unit: 's' },
      { key: 'predelay', label: 'Pre-delay', min: 0, max: 200, step: 1, def: 20, unit: 'ms' },
      { key: 'tone', label: 'Tone', min: 1000, max: 16000, step: 10, def: 7000, unit: 'Hz', log: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.25 },
    ],
  },
  chorus: {
    label: 'Chorus',
    params: [
      { key: 'rate', label: 'Rate', min: 0.05, max: 5, step: 0.01, def: 0.8, unit: 'Hz' },
      { key: 'depth', label: 'Depth', min: 0, max: 10, step: 0.1, def: 3, unit: 'ms' },
      { key: 'delay', label: 'Delay', min: 5, max: 30, step: 0.5, def: 14, unit: 'ms' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  tremolo: {
    label: 'Tremolo',
    params: [
      optionParam('shape', 'Shape', ['Sine', 'Square', 'Triangle'], 0),
      { key: 'rate', label: 'Rate', min: 0.5, max: 15, step: 0.1, def: 5, unit: 'Hz' },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  phaser: {
    label: 'Phaser',
    params: [
      { key: 'rate', label: 'Rate', min: 0.05, max: 5, step: 0.01, def: 0.4, unit: 'Hz' },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.7 },
      { key: 'center', label: 'Center', min: 200, max: 3000, step: 10, def: 900, unit: 'Hz', log: true },
      { key: 'resonance', label: 'Resonance', min: 0.3, max: 6, step: 0.1, def: 1 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
  },
  compressor: {
    label: 'Compressor',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 0.5, def: -18, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.1, def: 4, unit: ':1' },
      { key: 'attack', label: 'Attack', min: 0.001, max: 0.2, step: 0.001, def: 0.01, unit: 's' },
      { key: 'release', label: 'Release', min: 0.02, max: 1, step: 0.01, def: 0.2, unit: 's' },
      { key: 'makeup', label: 'Makeup', min: 0, max: 24, step: 0.5, def: 3, unit: 'dB' },
    ],
  },
};

export const fxDefaults = (type: FxType) => defaultsOf(FX_DEFS[type].params);

export type FxPresetChain = { type: FxType; params?: Record<string, number> }[];

/** Complete amp-simulator chains: Input → Gain → EQ → Drive → Cabinet → Delay → Reverb. */
export const AMP_PRESETS: Record<string, FxPresetChain> = {
  'Clean Combo': [
    { type: 'gain', params: { gain: 0 } },
    { type: 'eq3', params: { low: 2, mid: 0, midFreq: 800, high: 2 } },
    { type: 'drive', params: { mode: 0, drive: 0.15, tone: 0.7, output: 0, mix: 1 } },
    { type: 'cabinet', params: { mode: 0, lowCut: 80, highCut: 6500, mix: 1 } },
    { type: 'delay', params: { sync: 2, feedback: 0.25, tone: 4000, mix: 0.15 } },
    { type: 'reverb', params: { decay: 2.2, predelay: 20, tone: 7000, mix: 0.25 } },
  ],
  'Clean Chorus': [
    { type: 'eq3', params: { low: 1, mid: -1, midFreq: 700, high: 3 } },
    { type: 'drive', params: { mode: 0, drive: 0.1, tone: 0.75, output: 1, mix: 1 } },
    { type: 'cabinet', params: { mode: 0, lowCut: 80, highCut: 7000, mix: 1 } },
    { type: 'chorus', params: { rate: 0.7, depth: 3.5, delay: 14, mix: 0.5 } },
    { type: 'reverb', params: { decay: 2.4, predelay: 20, tone: 7000, mix: 0.28 } },
  ],
  'Surf Tremolo': [
    { type: 'eq3', params: { low: 0, mid: 1, midFreq: 1200, high: 4 } },
    { type: 'drive', params: { mode: 0, drive: 0.2, tone: 0.8, output: -1, mix: 1 } },
    { type: 'cabinet', params: { mode: 0, lowCut: 100, highCut: 7500, mix: 1 } },
    { type: 'tremolo', params: { shape: 0, rate: 6, depth: 0.6 } },
    { type: 'reverb', params: { decay: 3.2, predelay: 10, tone: 8000, mix: 0.4 } },
  ],
  'British Crunch': [
    { type: 'gain', params: { gain: 3 } },
    { type: 'eq3', params: { low: 1, mid: 3, midFreq: 900, high: 1 } },
    { type: 'drive', params: { mode: 2, drive: 0.55, tone: 0.55, output: 10, mix: 1 } },
    { type: 'cabinet', params: { mode: 2, lowCut: 90, highCut: 5000, mix: 1 } },
    { type: 'delay', params: { sync: 2, feedback: 0.2, tone: 3500, mix: 0.1 } },
    { type: 'reverb', params: { decay: 1.5, predelay: 15, tone: 6000, mix: 0.18 } },
  ],
  'High-Gain Lead': [
    { type: 'gain', params: { gain: 6 } },
    { type: 'eq3', params: { low: 3, mid: -3, midFreq: 700, high: 2 } },
    { type: 'drive', params: { mode: 1, drive: 0.85, tone: 0.5, output: 8, mix: 1 } },
    { type: 'cabinet', params: { mode: 3, lowCut: 100, highCut: 5500, mix: 1 } },
    { type: 'delay', params: { sync: 0, time: 420, feedback: 0.4, tone: 3000, mix: 0.22 } },
    { type: 'reverb', params: { decay: 2.6, predelay: 30, tone: 6000, mix: 0.22 } },
  ],
  'Fuzz Box': [
    { type: 'drive', params: { mode: 3, drive: 0.8, tone: 0.4, output: -6, mix: 1 } },
    { type: 'cabinet', params: { mode: 1, lowCut: 70, highCut: 4500, mix: 1 } },
    { type: 'reverb', params: { decay: 1.8, predelay: 10, tone: 5000, mix: 0.2 } },
  ],
  'Phased Funk': [
    { type: 'compressor', params: { threshold: -24, ratio: 4, attack: 0.005, release: 0.15, makeup: 4 } },
    { type: 'drive', params: { mode: 0, drive: 0.15, tone: 0.7, output: -2, mix: 1 } },
    { type: 'phaser', params: { rate: 0.5, depth: 0.8, center: 900, resonance: 1.5, mix: 0.5 } },
    { type: 'cabinet', params: { mode: 0, lowCut: 90, highCut: 6500, mix: 1 } },
    { type: 'reverb', params: { decay: 1.4, predelay: 10, tone: 6000, mix: 0.15 } },
  ],
  'Bass Amp': [
    { type: 'compressor', params: { threshold: -20, ratio: 4, attack: 0.01, release: 0.2, makeup: 4 } },
    { type: 'eq3', params: { low: 4, mid: -2, midFreq: 500, high: 0 } },
    { type: 'drive', params: { mode: 2, drive: 0.3, tone: 0.35, output: -4, mix: 0.5 } },
    { type: 'cabinet', params: { mode: 1, lowCut: 40, highCut: 3500, mix: 1 } },
  ],
};
