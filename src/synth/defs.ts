import type { InstrumentType } from '../core/project';
import { defaultsOf, optionParam, type ParamDef } from '../core/params';
import { DRAWBAR_LABELS, MODAL_MODELS } from './render';

export const WAVE_OPTIONS = ['Saw', 'Square', 'Triangle', 'Sine'];

export interface InstrumentDef {
  label: string;
  /** Three-letter badge shown in the track header. */
  badge: string;
  params: ParamDef[];
  presets: Record<string, Record<string, number>>;
}

/** Drawbar registrations, 16' … 1', as the familiar 9-digit organ notation. */
const drawbars = (digits: string) => Object.fromEntries([...digits].map((d, i) => [`d${i + 1}`, Number(d)]));

export const INSTRUMENT_DEFS: Record<InstrumentType, InstrumentDef> = {
  subtractive: {
    label: 'Subtractive Synth',
    badge: 'SYN',
    params: [
      optionParam('wave1', 'Osc 1', WAVE_OPTIONS, 0),
      optionParam('wave2', 'Osc 2', WAVE_OPTIONS, 1),
      { key: 'mix', label: 'Osc Mix', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'semi2', label: 'Osc 2 Pitch', min: -24, max: 24, step: 1, def: 0, unit: 'st' },
      { key: 'detune', label: 'Detune', min: 0, max: 50, step: 0.5, def: 8, unit: 'ct' },
      { key: 'cutoff', label: 'Cutoff', min: 40, max: 16000, step: 1, def: 2200, unit: 'Hz', log: true },
      { key: 'reso', label: 'Resonance', min: 0.1, max: 20, step: 0.1, def: 2 },
      { key: 'envAmt', label: 'Filter Env', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'fdecay', label: 'Filter Decay', min: 0.01, max: 3, step: 0.01, def: 0.3, unit: 's' },
      { key: 'attack', label: 'Attack', min: 0.001, max: 3, step: 0.001, def: 0.005, unit: 's' },
      { key: 'decay', label: 'Decay', min: 0.01, max: 3, step: 0.01, def: 0.3, unit: 's' },
      { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, def: 0.6 },
      { key: 'release', label: 'Release', min: 0.01, max: 4, step: 0.01, def: 0.25, unit: 's' },
      { key: 'vibRate', label: 'Vibrato Rate', min: 0.1, max: 10, step: 0.1, def: 5.5, unit: 'Hz' },
      { key: 'vibDepth', label: 'Vibrato Depth', min: 0, max: 60, step: 1, def: 0, unit: 'ct' },
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, def: 0.7 },
    ],
    presets: {
      'Analog Lead': { wave1: 0, wave2: 0, mix: 0.5, semi2: 0, detune: 12, cutoff: 2600, reso: 4, envAmt: 0.45, fdecay: 0.25, attack: 0.004, decay: 0.25, sustain: 0.7, release: 0.2, vibDepth: 6, level: 0.55 },
      'Supersaw Lead': { wave1: 0, wave2: 0, mix: 0.5, semi2: 0, detune: 32, cutoff: 5200, reso: 1.5, envAmt: 0.25, fdecay: 0.4, attack: 0.005, decay: 0.5, sustain: 0.8, release: 0.3, vibDepth: 4, level: 0.5 },
      'Square Lead': { wave1: 1, wave2: 1, mix: 0.4, semi2: 12, detune: 6, cutoff: 3000, reso: 2, envAmt: 0.3, fdecay: 0.3, attack: 0.004, decay: 0.3, sustain: 0.75, release: 0.2, vibDepth: 8, vibRate: 6, level: 0.45 },
      'Sub Bass': { wave1: 0, wave2: 1, mix: 0.5, semi2: -12, detune: 4, cutoff: 480, reso: 3, envAmt: 0.55, fdecay: 0.18, attack: 0.002, decay: 0.25, sustain: 0.75, release: 0.08, level: 0.8 },
      'Acid Bass': { wave1: 0, wave2: 1, mix: 0.1, semi2: 0, detune: 0, cutoff: 320, reso: 16, envAmt: 0.9, fdecay: 0.14, attack: 0.002, decay: 0.2, sustain: 0.5, release: 0.06, level: 0.7 },
      'Reese Bass': { wave1: 0, wave2: 0, mix: 0.5, semi2: 0, detune: 25, cutoff: 700, reso: 2, envAmt: 0.1, fdecay: 0.5, attack: 0.01, decay: 0.5, sustain: 1, release: 0.15, level: 0.7 },
      'Soft Sine Bass': { wave1: 3, wave2: 2, mix: 0.2, semi2: 0, detune: 0, cutoff: 4000, reso: 0.5, envAmt: 0, attack: 0.008, decay: 0.5, sustain: 0.85, release: 0.15, level: 0.85 },
      'Strings': { wave1: 0, wave2: 0, mix: 0.5, semi2: 0, detune: 14, cutoff: 3200, reso: 0.8, envAmt: 0.1, fdecay: 1, attack: 0.35, decay: 1, sustain: 0.85, release: 0.9, vibRate: 5, vibDepth: 10, level: 0.5 },
      'Brass': { wave1: 0, wave2: 0, mix: 0.4, semi2: 0, detune: 8, cutoff: 900, reso: 1.5, envAmt: 0.7, fdecay: 0.35, attack: 0.06, decay: 0.4, sustain: 0.75, release: 0.2, vibRate: 5.5, vibDepth: 5, level: 0.55 },
      'Warm Pad': { wave1: 0, wave2: 0, mix: 0.5, semi2: 0, detune: 18, cutoff: 1400, reso: 1, envAmt: 0.2, fdecay: 1.5, attack: 0.9, decay: 1, sustain: 0.8, release: 1.6, level: 0.45 },
      'Synth Choir': { wave1: 2, wave2: 0, mix: 0.3, semi2: 12, detune: 10, cutoff: 1600, reso: 4, envAmt: 0.1, fdecay: 1, attack: 0.5, decay: 1, sustain: 0.9, release: 1.2, vibRate: 5, vibDepth: 12, level: 0.5 },
      'Pluck': { wave1: 1, wave2: 0, mix: 0.3, semi2: 12, detune: 6, cutoff: 600, reso: 6, envAmt: 0.8, fdecay: 0.15, attack: 0.001, decay: 0.35, sustain: 0, release: 0.3, level: 0.6 },
      'Square Keys': { wave1: 1, wave2: 2, mix: 0.35, semi2: 12, detune: 3, cutoff: 1800, reso: 1.5, envAmt: 0.35, fdecay: 0.4, attack: 0.003, decay: 0.8, sustain: 0.35, release: 0.3, level: 0.55 },
      'Chiptune': { wave1: 1, wave2: 1, mix: 0, semi2: 0, detune: 0, cutoff: 16000, reso: 0.1, envAmt: 0, fdecay: 0.1, attack: 0.001, decay: 0.1, sustain: 0.8, release: 0.05, level: 0.45 },
    },
  },
  fm: {
    label: 'FM Synth',
    badge: 'FM',
    params: [
      { key: 'ratio', label: 'Mod Ratio', min: 0.5, max: 16, step: 0.5, def: 1 },
      { key: 'index', label: 'Mod Index', min: 0, max: 12, step: 0.1, def: 3 },
      { key: 'indexDecay', label: 'Index Decay', min: 0.02, max: 4, step: 0.01, def: 0.7, unit: 's' },
      { key: 'ratio2', label: 'Tine Ratio', min: 0, max: 20, step: 0.5, def: 0 },
      { key: 'index2', label: 'Tine Index', min: 0, max: 12, step: 0.1, def: 0 },
      { key: 'attack', label: 'Attack', min: 0.001, max: 2, step: 0.001, def: 0.002, unit: 's' },
      { key: 'decay', label: 'Decay', min: 0.05, max: 5, step: 0.01, def: 1.2, unit: 's' },
      { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, def: 0.2 },
      { key: 'release', label: 'Release', min: 0.01, max: 4, step: 0.01, def: 0.4, unit: 's' },
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, def: 0.6 },
    ],
    presets: {
      'Electric Piano': { ratio: 1, index: 1.2, indexDecay: 1.2, ratio2: 14, index2: 1.8, attack: 0.002, decay: 2.2, sustain: 0.25, release: 0.5, level: 0.55 },
      'FM Piano': { ratio: 1, index: 2.2, indexDecay: 0.5, ratio2: 4, index2: 1, attack: 0.002, decay: 1.6, sustain: 0.12, release: 0.35, level: 0.6 },
      'Clavinet': { ratio: 1, index: 4, indexDecay: 0.15, ratio2: 3, index2: 2, attack: 0.001, decay: 0.6, sustain: 0.3, release: 0.08, level: 0.5 },
      'Harpsichord': { ratio: 1, index: 5, indexDecay: 0.3, ratio2: 7, index2: 1.5, attack: 0.001, decay: 1.5, sustain: 0, release: 0.3, level: 0.5 },
      'Toy Piano': { ratio: 4, index: 2.5, indexDecay: 0.2, ratio2: 0, index2: 0, attack: 0.001, decay: 0.8, sustain: 0, release: 0.3, level: 0.55 },
      'Glass Bell': { ratio: 3.5, index: 4, indexDecay: 2, ratio2: 0, index2: 0, attack: 0.002, decay: 3, sustain: 0, release: 1.5, level: 0.45 },
      'Tubular Bells': { ratio: 3.5, index: 5, indexDecay: 3, ratio2: 7, index2: 0.8, attack: 0.002, decay: 4, sustain: 0, release: 2, level: 0.45 },
      'Brass Stab': { ratio: 1, index: 4, indexDecay: 0.5, ratio2: 0, index2: 0, attack: 0.05, decay: 0.4, sustain: 0.6, release: 0.2, level: 0.5 },
      'FM Pad': { ratio: 2, index: 1, indexDecay: 4, ratio2: 0, index2: 0, attack: 0.8, decay: 2, sustain: 0.8, release: 1.5, level: 0.45 },
      'Metallic Lead': { ratio: 1.5, index: 3, indexDecay: 1, ratio2: 0, index2: 0, attack: 0.01, decay: 0.5, sustain: 0.7, release: 0.2, level: 0.45 },
      'Woody Pluck': { ratio: 0.5, index: 2, indexDecay: 0.15, ratio2: 0, index2: 0, attack: 0.001, decay: 0.4, sustain: 0, release: 0.2, level: 0.65 },
      'FM Bass': { ratio: 1, index: 3, indexDecay: 0.25, ratio2: 0, index2: 0, attack: 0.002, decay: 0.5, sustain: 0.5, release: 0.1, level: 0.8 },
    },
  },
  pluck: {
    label: 'Plucked Strings',
    badge: 'PLK',
    params: [
      { key: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, def: 0.6 },
      { key: 'decay', label: 'Sustain Time', min: 0.2, max: 8, step: 0.1, def: 3, unit: 's' },
      { key: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'pick', label: 'Pick Position', min: 0, max: 1, step: 0.01, def: 0.2 },
      { key: 'body', label: 'Body', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'release', label: 'Release', min: 0.02, max: 4, step: 0.01, def: 0.4, unit: 's' },
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, def: 0.75 },
    ],
    presets: {
      'Acoustic Guitar': { brightness: 0.65, decay: 3.5, damping: 0.35, pick: 0.22, body: 0.6, release: 0.4, level: 0.75 },
      'Nylon Guitar': { brightness: 0.4, decay: 3, damping: 0.75, pick: 0.25, body: 0.7, release: 0.5, level: 0.8 },
      'Clean Electric': { brightness: 0.7, decay: 4.5, damping: 0.25, pick: 0.15, body: 0.1, release: 0.3, level: 0.7 },
      'Muted Guitar': { brightness: 0.5, decay: 0.35, damping: 0.6, pick: 0.2, body: 0.4, release: 0.08, level: 0.8 },
      'Picked Bass': { brightness: 0.55, decay: 3, damping: 0.5, pick: 0.3, body: 0.5, release: 0.15, level: 0.9 },
      'Harp': { brightness: 0.45, decay: 4.5, damping: 0.55, pick: 0.5, body: 0.4, release: 2.5, level: 0.75 },
      'Koto': { brightness: 0.8, decay: 2.5, damping: 0.3, pick: 0.1, body: 0.3, release: 0.6, level: 0.7 },
      'Banjo': { brightness: 0.9, decay: 1.6, damping: 0.2, pick: 0.08, body: 0.2, release: 0.3, level: 0.65 },
      'Mandolin': { brightness: 0.85, decay: 1.8, damping: 0.2, pick: 0.12, body: 0.4, release: 0.3, level: 0.65 },
    },
  },
  organ: {
    label: 'Tonewheel Organ',
    badge: 'ORG',
    params: [
      ...DRAWBAR_LABELS.map((label, i): ParamDef => ({ key: `d${i + 1}`, label: `Drawbar ${label}`, min: 0, max: 8, step: 1, def: i < 3 ? 8 : 0 })),
      { key: 'perc', label: 'Percussion', min: 0, max: 1, step: 0.01, def: 0 },
      optionParam('percHarm', 'Perc. Harmonic', ['2nd', '3rd'], 1),
      { key: 'percDecay', label: 'Perc. Decay', min: 0.1, max: 1.5, step: 0.01, def: 0.4, unit: 's' },
      { key: 'vibrato', label: 'Vibrato', min: 0, max: 1, step: 0.01, def: 0.4 },
      optionParam('leslie', 'Rotary Speaker', ['Off', 'Slow', 'Fast'], 1),
      { key: 'click', label: 'Key Click', min: 0, max: 1, step: 0.01, def: 0.3 },
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, def: 0.7 },
    ],
    presets: {
      'Jazz Organ': { ...drawbars('888000000'), perc: 0.8, percHarm: 1, percDecay: 0.35, vibrato: 0.5, leslie: 1, click: 0.4 },
      'Rock Organ': { ...drawbars('888600000'), perc: 0, vibrato: 0.3, leslie: 2, click: 0.6 },
      'Gospel Full': { ...drawbars('888888888'), perc: 0.3, percHarm: 0, vibrato: 0.6, leslie: 2, click: 0.5 },
      'Soft Ballad': { ...drawbars('838000000'), perc: 0, vibrato: 0.5, leslie: 1, click: 0.1 },
      'Church Principal': { ...drawbars('608605034'), perc: 0, vibrato: 0, leslie: 0, click: 0 },
      'Flute Stop': { ...drawbars('008000000'), perc: 0, vibrato: 0.7, leslie: 1, click: 0.1 },
      'Reedy': { ...drawbars('006876540'), perc: 0, vibrato: 0.3, leslie: 1, click: 0.3 },
      'Bright Lead': { ...drawbars('008080808'), perc: 1, percHarm: 0, percDecay: 0.25, vibrato: 0.2, leslie: 2, click: 0.5 },
    },
  },
  modal: {
    label: 'Piano & Mallets',
    badge: 'PNO',
    params: [
      optionParam('model', 'Instrument', MODAL_MODELS, 0),
      { key: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, def: 0.55 },
      { key: 'decay', label: 'Decay', min: 0.2, max: 2, step: 0.01, def: 1 },
      { key: 'hardness', label: 'Hardness', min: 0, max: 1, step: 0.01, def: 0.35 },
      { key: 'tremolo', label: 'Tremolo', min: 0, max: 1, step: 0.01, def: 0 },
      { key: 'release', label: 'Release', min: 0.02, max: 3, step: 0.01, def: 0.35, unit: 's' },
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, def: 0.8 },
    ],
    presets: {
      'Grand Piano': { model: 0, brightness: 0.55, decay: 1, hardness: 0.35, tremolo: 0, release: 0.35, level: 0.8 },
      'Bright Piano': { model: 0, brightness: 0.85, decay: 0.9, hardness: 0.55, tremolo: 0, release: 0.3, level: 0.8 },
      'Mellow Piano': { model: 0, brightness: 0.25, decay: 1.1, hardness: 0.2, tremolo: 0, release: 0.4, level: 0.85 },
      'Upright Piano': { model: 1, brightness: 0.55, decay: 1, hardness: 0.45, tremolo: 0, release: 0.3, level: 0.8 },
      'Marimba': { model: 2, brightness: 0.5, decay: 1, hardness: 0.5, tremolo: 0, release: 0.6, level: 0.85 },
      'Vibraphone': { model: 3, brightness: 0.45, decay: 1, hardness: 0.3, tremolo: 0.55, release: 1.2, level: 0.75 },
      'Kalimba': { model: 4, brightness: 0.5, decay: 1, hardness: 0.6, tremolo: 0, release: 0.5, level: 0.8 },
      'Music Box': { model: 5, brightness: 0.6, decay: 1, hardness: 0.3, tremolo: 0, release: 1, level: 0.7 },
      'Steel Drum': { model: 6, brightness: 0.6, decay: 1, hardness: 0.4, tremolo: 0, release: 0.6, level: 0.75 },
      'Glockenspiel': { model: 7, brightness: 0.6, decay: 1, hardness: 0.5, tremolo: 0, release: 1, level: 0.6 },
    },
  },
  drums: {
    label: 'Drum Machine',
    badge: 'DRM',
    params: [
      { key: 'kickTune', label: 'Kick Tune', min: 0.5, max: 2, step: 0.01, def: 1 },
      { key: 'kickDecay', label: 'Kick Decay', min: 0.1, max: 1.5, step: 0.01, def: 0.5, unit: 's' },
      { key: 'kickPunch', label: 'Kick Punch', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'snareTune', label: 'Snare Tune', min: 0.5, max: 2, step: 0.01, def: 1 },
      { key: 'snareTone', label: 'Snare Snap', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'snareDecay', label: 'Snare Decay', min: 0.05, max: 0.6, step: 0.01, def: 0.18, unit: 's' },
      { key: 'tomTune', label: 'Tom Tune', min: 0.5, max: 2, step: 0.01, def: 1 },
      { key: 'hatDecay', label: 'Hat Decay', min: 0.02, max: 0.5, step: 0.005, def: 0.05, unit: 's' },
      { key: 'hatTone', label: 'Hat Tone', min: 0.5, max: 1.5, step: 0.01, def: 1 },
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, def: 0.8 },
    ],
    presets: {
      'Boom Kit': { kickTune: 0.9, kickDecay: 0.9, kickPunch: 0.3, snareTone: 0.5, snareDecay: 0.22, hatDecay: 0.05, hatTone: 1, level: 0.8 },
      'Tight Kit': { kickTune: 1.1, kickDecay: 0.35, kickPunch: 0.8, snareTone: 0.3, snareDecay: 0.14, hatDecay: 0.035, hatTone: 1.2, level: 0.8 },
      'Rock Kit': { kickTune: 1, kickDecay: 0.4, kickPunch: 0.9, snareTune: 0.9, snareTone: 0.55, snareDecay: 0.3, tomTune: 0.9, hatDecay: 0.08, hatTone: 0.9, level: 0.85 },
      'Trap Kit': { kickTune: 0.7, kickDecay: 1.4, kickPunch: 0.2, snareTune: 1.2, snareTone: 0.7, snareDecay: 0.15, hatDecay: 0.03, hatTone: 1.3, level: 0.8 },
      'House Kit': { kickTune: 1, kickDecay: 0.5, kickPunch: 0.7, snareTune: 1.1, snareTone: 0.6, snareDecay: 0.2, hatDecay: 0.06, hatTone: 1.15, level: 0.8 },
      'Electro Kit': { kickTune: 1.2, kickDecay: 0.3, kickPunch: 1, snareTune: 1.4, snareTone: 0.8, snareDecay: 0.12, tomTune: 1.3, hatDecay: 0.025, hatTone: 1.4, level: 0.8 },
      'Brushes': { kickTune: 0.85, kickDecay: 0.3, kickPunch: 0.1, snareTune: 0.8, snareTone: 1, snareDecay: 0.45, tomTune: 0.8, hatDecay: 0.09, hatTone: 0.7, level: 0.7 },
      'Lo-Fi Kit': { kickTune: 0.8, kickDecay: 0.5, kickPunch: 0.4, snareTone: 0.6, snareDecay: 0.25, hatDecay: 0.07, hatTone: 0.7, level: 0.75 },
    },
  },
};

/** General-MIDI style drum map used by the drum machine and the piano-roll labels. */
export const DRUM_MAP: Record<number, string> = {
  36: 'Kick',
  37: 'Rim',
  38: 'Snare',
  39: 'Clap',
  41: 'Low Tom',
  42: 'Closed Hat',
  45: 'Mid Tom',
  46: 'Open Hat',
  48: 'High Tom',
  49: 'Crash',
};

export function firstPreset(type: InstrumentType): string {
  return Object.keys(INSTRUMENT_DEFS[type].presets)[0];
}

export function presetParams(type: InstrumentType, preset: string): Record<string, number> {
  const def = INSTRUMENT_DEFS[type];
  return { ...defaultsOf(def.params), ...(def.presets[preset] ?? {}) };
}

/** Curated entries for the "+ Instrument" menu: a friendly name mapped to an engine and preset. */
export const INSTRUMENT_CATALOG: { group: string; name: string; type: InstrumentType; preset: string }[] = [
  { group: 'Keys', name: 'Grand Piano', type: 'modal', preset: 'Grand Piano' },
  { group: 'Keys', name: 'Upright Piano', type: 'modal', preset: 'Upright Piano' },
  { group: 'Keys', name: 'Electric Piano', type: 'fm', preset: 'Electric Piano' },
  { group: 'Keys', name: 'Clavinet', type: 'fm', preset: 'Clavinet' },
  { group: 'Keys', name: 'Harpsichord', type: 'fm', preset: 'Harpsichord' },
  { group: 'Organ', name: 'Jazz Organ', type: 'organ', preset: 'Jazz Organ' },
  { group: 'Organ', name: 'Rock Organ', type: 'organ', preset: 'Rock Organ' },
  { group: 'Organ', name: 'Church Organ', type: 'organ', preset: 'Church Principal' },
  { group: 'Guitar & Strings', name: 'Acoustic Guitar', type: 'pluck', preset: 'Acoustic Guitar' },
  { group: 'Guitar & Strings', name: 'Nylon Guitar', type: 'pluck', preset: 'Nylon Guitar' },
  { group: 'Guitar & Strings', name: 'Clean Electric', type: 'pluck', preset: 'Clean Electric' },
  { group: 'Guitar & Strings', name: 'Harp', type: 'pluck', preset: 'Harp' },
  { group: 'Guitar & Strings', name: 'Strings', type: 'subtractive', preset: 'Strings' },
  { group: 'Bass', name: 'Picked Bass', type: 'pluck', preset: 'Picked Bass' },
  { group: 'Bass', name: 'Synth Bass', type: 'subtractive', preset: 'Sub Bass' },
  { group: 'Bass', name: 'Acid Bass', type: 'subtractive', preset: 'Acid Bass' },
  { group: 'Mallets', name: 'Marimba', type: 'modal', preset: 'Marimba' },
  { group: 'Mallets', name: 'Vibraphone', type: 'modal', preset: 'Vibraphone' },
  { group: 'Mallets', name: 'Kalimba', type: 'modal', preset: 'Kalimba' },
  { group: 'Mallets', name: 'Music Box', type: 'modal', preset: 'Music Box' },
  { group: 'Mallets', name: 'Steel Drum', type: 'modal', preset: 'Steel Drum' },
  { group: 'Synth', name: 'Analog Lead', type: 'subtractive', preset: 'Analog Lead' },
  { group: 'Synth', name: 'Supersaw Lead', type: 'subtractive', preset: 'Supersaw Lead' },
  { group: 'Synth', name: 'Warm Pad', type: 'subtractive', preset: 'Warm Pad' },
  { group: 'Synth', name: 'Brass', type: 'subtractive', preset: 'Brass' },
  { group: 'Synth', name: 'Synth Choir', type: 'subtractive', preset: 'Synth Choir' },
  { group: 'Synth', name: 'Bells', type: 'fm', preset: 'Tubular Bells' },
];
