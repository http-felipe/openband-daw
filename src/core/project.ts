import { INSTRUMENT_DEFS, firstPreset, presetParams } from '../synth/defs';
import { FX_DEFS, fxDefaults, type FxPresetChain } from '../dsp/fx/defs';
import { sanitizeParams } from './params';

export type TrackKind = 'midi' | 'audio';
export type InstrumentType = 'subtractive' | 'fm' | 'drums' | 'pluck' | 'organ' | 'modal';
export type FxType = 'gain' | 'eq3' | 'drive' | 'cabinet' | 'delay' | 'reverb' | 'compressor' | 'chorus' | 'tremolo' | 'phaser';
export type AutomationParam = 'volume' | 'pan';

/** All positions and lengths are in beats (quarter notes). */
export interface Note {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

export interface MidiClip {
  id: string;
  kind: 'midi';
  name: string;
  start: number;
  length: number;
  notes: Note[];
}

export interface AudioClip {
  id: string;
  kind: 'audio';
  name: string;
  start: number;
  length: number;
  audioId: string;
  /** Seconds into the source audio where playback begins. */
  offset: number;
}

export type Clip = MidiClip | AudioClip;

export interface AutomationPoint {
  beat: number;
  value: number;
}

export interface FxSlot {
  id: string;
  type: FxType;
  bypass: boolean;
  params: Record<string, number>;
}

export interface InstrumentConfig {
  type: InstrumentType;
  preset: string;
  params: Record<string, number>;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  instrument?: InstrumentConfig;
  /** Fader in dB. */
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  armed: boolean;
  /** Route the live audio input through this track's chain (audio tracks). */
  monitor: boolean;
  fx: FxSlot[];
  automation: Record<AutomationParam, AutomationPoint[]>;
  clips: Clip[];
}

export interface AudioAsset {
  name: string;
  sampleRate: number;
  channels: number;
  /** 16-bit PCM WAV, base64. Absent when stripped for autosave. */
  wav?: string;
}

export const PROJECT_FORMAT = 'openband-project';
export const PROJECT_VERSION = 1;

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  bpm: number;
  timeSignature: [number, number];
  key: string;
  loop: { enabled: boolean; start: number; end: number };
  master: { volume: number; fx: FxSlot[] };
  tracks: Track[];
  audioPool: Record<string, AudioAsset>;
}

export const AUTOMATION_RANGE: Record<AutomationParam, [number, number]> = { volume: [-48, 6], pan: [-1, 1] };
export const TRACK_COLORS = ['#f2a23a', '#4fb0ff', '#9b7bff', '#3ccf91', '#ff6b8b', '#e8d44d', '#43d1d6', '#ff8f5a'];

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const colorFor = (index: number) => TRACK_COLORS[((index % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length];
export const beatsPerBar = (p: Project) => (p.timeSignature[0] * 4) / p.timeSignature[1];

/** Last beat that contains any clip (at least one bar). */
export function projectEnd(p: Project): number {
  let end = beatsPerBar(p);
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
  return end;
}

// ---------- factories ----------

export function createEmptyProject(name = 'Untitled'): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    bpm: 120,
    timeSignature: [4, 4],
    key: 'C',
    loop: { enabled: false, start: 0, end: 16 },
    master: { volume: 0, fx: [] },
    tracks: [],
    audioPool: {},
  };
}

export interface TrackOptions {
  name?: string;
  instrument?: InstrumentType;
  preset?: string;
  color?: string;
}

export function createTrack(kind: TrackKind, opts: TrackOptions = {}): Track {
  const track: Track = {
    id: uid('trk'),
    name: opts.name ?? (kind === 'audio' ? 'Audio' : 'Synth'),
    kind,
    color: opts.color ?? colorFor(Math.floor(Math.random() * TRACK_COLORS.length)),
    volume: -6,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    monitor: false,
    fx: [],
    automation: { volume: [], pan: [] },
    clips: [],
  };
  if (kind === 'midi') {
    const type = opts.instrument ?? 'subtractive';
    const preset = opts.preset ?? firstPreset(type);
    track.instrument = { type, preset, params: presetParams(type, preset) };
  }
  return track;
}

export function createFx(type: FxType, params: Record<string, number> = {}): FxSlot {
  return { id: uid('fx'), type, bypass: false, params: { ...fxDefaults(type), ...params } };
}

export function createFxChain(chain: FxPresetChain): FxSlot[] {
  return chain.map((s) => createFx(s.type, s.params));
}

export function createMidiClip(start: number, length: number, name = 'MIDI', notes: Note[] = []): MidiClip {
  return { id: uid('clip'), kind: 'midi', name, start, length, notes };
}

/**
 * Splits `clip` at absolute `beat`: `clip` becomes the left part and the new right part is returned
 * (null when the beat isn't strictly inside). MIDI notes belong to the side they start on and are
 * shortened at the cut; audio parts share the source and the right one starts deeper into it.
 */
export function splitClip(clip: Clip, beat: number, bpm: number): Clip | null {
  const cut = beat - clip.start;
  if (cut <= 1e-6 || cut >= clip.length - 1e-6) return null;
  const rest = clip.length - cut;
  clip.length = cut;
  if (clip.kind === 'audio') {
    return { ...clip, id: uid('clip'), start: beat, length: rest, offset: clip.offset + (cut * 60) / bpm };
  }
  const right: MidiClip = {
    ...clip,
    id: uid('clip'),
    start: beat,
    length: rest,
    notes: clip.notes.filter((n) => n.start >= cut).map((n) => ({ ...n, id: uid('n'), start: n.start - cut })),
  };
  clip.notes = clip.notes.filter((n) => n.start < cut).map((n) => ({ ...n, duration: Math.min(n.duration, cut - n.start) }));
  return right;
}

/**
 * Name for the right-hand part of a split: the base name (without a trailing ".N") plus the next free
 * number among `existing` — "Take 1" → "Take 1.1", then "Take 1.2", also when splitting "Take 1.1".
 */
export function nextSplitName(name: string, existing: Iterable<string>): string {
  const base = name.replace(/\.\d+$/, '');
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\.(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = pattern.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base}.${max + 1}`;
}

export function createNote(pitch: number, start: number, duration: number, velocity = 0.8): Note {
  return { id: uid('n'), pitch, start, duration, velocity };
}

// ---------- (de)serialization ----------

export function serializeProject(p: Project): string {
  return JSON.stringify(p);
}

export function parseProject(json: string): Project {
  return validateProject(JSON.parse(json));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number, lo = -Infinity, hi = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def;
const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
const bool = (v: unknown) => v === true;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ident = (v: unknown, prefix: string) => (typeof v === 'string' && v.length > 0 ? v : uid(prefix));
const present = <T>(v: T | null): v is T => v !== null;

function validateNote(raw: unknown): Note | null {
  if (!isObj(raw)) return null;
  return {
    id: ident(raw.id, 'n'),
    pitch: Math.round(num(raw.pitch, 60, 0, 127)),
    start: num(raw.start, 0, 0),
    duration: num(raw.duration, 1, 1 / 64),
    velocity: num(raw.velocity, 0.8, 0, 1),
  };
}

function validateClip(raw: unknown): Clip | null {
  if (!isObj(raw)) return null;
  const base = { id: ident(raw.id, 'clip'), name: str(raw.name, 'Clip'), start: num(raw.start, 0, 0), length: num(raw.length, 4, 1 / 16) };
  if (raw.kind === 'audio') {
    if (typeof raw.audioId !== 'string') return null;
    return { ...base, kind: 'audio', audioId: raw.audioId, offset: num(raw.offset, 0, 0) };
  }
  return { ...base, kind: 'midi', notes: list(raw.notes).map(validateNote).filter(present) };
}

function validateFx(raw: unknown): FxSlot | null {
  if (!isObj(raw) || typeof raw.type !== 'string' || !(raw.type in FX_DEFS)) return null;
  const type = raw.type as FxType;
  return { id: ident(raw.id, 'fx'), type, bypass: bool(raw.bypass), params: sanitizeParams(FX_DEFS[type].params, raw.params) };
}

function validateInstrument(raw: unknown): InstrumentConfig {
  const src = isObj(raw) ? raw : {};
  const type: InstrumentType = typeof src.type === 'string' && src.type in INSTRUMENT_DEFS ? (src.type as InstrumentType) : 'subtractive';
  const preset = str(src.preset, firstPreset(type));
  const params = isObj(src.params) ? sanitizeParams(INSTRUMENT_DEFS[type].params, src.params) : presetParams(type, preset);
  return { type, preset, params };
}

function validatePoints(raw: unknown, param: AutomationParam): AutomationPoint[] {
  const [lo, hi] = AUTOMATION_RANGE[param];
  return list(raw)
    .filter(isObj)
    .map((p) => ({ beat: num(p.beat, 0, 0), value: num(p.value, 0, lo, hi) }))
    .sort((a, b) => a.beat - b.beat);
}

function validateTrack(raw: unknown, index: number): Track | null {
  if (!isObj(raw)) return null;
  const kind: TrackKind = raw.kind === 'audio' ? 'audio' : 'midi';
  const auto = isObj(raw.automation) ? raw.automation : {};
  const track: Track = {
    id: ident(raw.id, 'trk'),
    name: str(raw.name, `Track ${index + 1}`),
    kind,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : colorFor(index),
    volume: num(raw.volume, -6, -60, 6),
    pan: num(raw.pan, 0, -1, 1),
    mute: bool(raw.mute),
    solo: bool(raw.solo),
    armed: bool(raw.armed),
    monitor: bool(raw.monitor),
    fx: list(raw.fx).map(validateFx).filter(present),
    automation: { volume: validatePoints(auto.volume, 'volume'), pan: validatePoints(auto.pan, 'pan') },
    clips: list(raw.clips)
      .map(validateClip)
      .filter(present)
      .filter((c) => (kind === 'audio' ? c.kind === 'audio' : c.kind === 'midi')),
  };
  if (kind === 'midi') track.instrument = validateInstrument(raw.instrument);
  return track;
}

/** Turns untrusted JSON into a well-formed project: unknown fields dropped, defaults filled, values clamped. */
export function validateProject(raw: unknown): Project {
  if (!isObj(raw) || raw.format !== PROJECT_FORMAT) throw new Error('Not an OpenBand project file');
  const version = num(raw.version, 1);
  if (version > PROJECT_VERSION) throw new Error(`Project version ${version} is newer than this app supports`);

  const ts = list(raw.timeSignature);
  const denominator = [2, 4, 8, 16].includes(ts[1] as number) ? (ts[1] as number) : 4;
  const loopRaw = isObj(raw.loop) ? raw.loop : {};
  const loopStart = num(loopRaw.start, 0, 0);
  const loopEnd = num(loopRaw.end, 16, 0);
  const master = isObj(raw.master) ? raw.master : {};

  const audioPool: Record<string, AudioAsset> = {};
  if (isObj(raw.audioPool)) {
    for (const [id, a] of Object.entries(raw.audioPool)) {
      if (!isObj(a)) continue;
      audioPool[id] = {
        name: str(a.name, 'Audio'),
        sampleRate: num(a.sampleRate, 44100, 3000, 384000),
        channels: Math.round(num(a.channels, 1, 1, 32)),
        ...(typeof a.wav === 'string' ? { wav: a.wav } : {}),
      };
    }
  }

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: str(raw.name, 'Untitled'),
    bpm: num(raw.bpm, 120, 20, 300),
    timeSignature: [Math.round(num(ts[0], 4, 1, 16)), denominator],
    key: str(raw.key, 'C'),
    loop: { enabled: bool(loopRaw.enabled) && loopEnd > loopStart, start: loopStart, end: Math.max(loopEnd, loopStart + 1) },
    master: { volume: num(master.volume, 0, -60, 6), fx: list(master.fx).map(validateFx).filter(present) },
    tracks: list(raw.tracks).map(validateTrack).filter(present),
    audioPool,
  };
}
