import { AMP_PRESETS } from '../dsp/fx/defs';
import {
  TRACK_COLORS,
  createEmptyProject,
  createFx,
  createFxChain,
  createMidiClip,
  createNote,
  createTrack,
  type Note,
  type Project,
} from './project';

const KICK = 36, SNARE = 38, CLAP = 39, CHH = 42, OHH = 46;

/** A 4-bar Am–F–C–G loop that exercises every engine: drums, subtractive bass/lead, FM keys and an amp-sim track. */
export function createDemoProject(): Project {
  const p = createEmptyProject('Demo Song');
  p.bpm = 104;
  p.loop = { enabled: true, start: 0, end: 16 };
  p.master.fx = [createFx('compressor', { threshold: -14, ratio: 2.5, attack: 0.02, release: 0.25, makeup: 2 })];

  // Drums
  const drumNotes: Note[] = [];
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * 4;
    for (const b of [0, 2, 2.5]) drumNotes.push(createNote(KICK, o + b, 0.25, 0.95));
    for (const b of [1, 3]) drumNotes.push(createNote(SNARE, o + b, 0.25, 0.85));
    for (let i = 0; i < 8; i++) {
      const b = i * 0.5;
      if (bar === 3 && b === 3.5) drumNotes.push(createNote(OHH, o + b, 0.5, 0.6));
      else drumNotes.push(createNote(CHH, o + b, 0.25, i % 2 ? 0.45 : 0.7));
    }
  }
  drumNotes.push(createNote(CLAP, 15, 0.25, 0.7));
  const drums = createTrack('midi', { name: 'Drums', instrument: 'drums', preset: 'Tight Kit', color: TRACK_COLORS[0] });
  drums.volume = -4;
  drums.clips.push(createMidiClip(0, 16, 'Beat', drumNotes));

  // Bass
  const roots = [45, 41, 48, 43]; // A2 F2 C3 G2
  const bassNotes: Note[] = [];
  roots.forEach((r, bar) => {
    const o = bar * 4;
    const pattern: [number, number, number][] = [
      [0, r, 0.75], [1, r + 12, 0.25], [1.5, r, 0.45], [2, r, 0.45], [2.75, r + 7, 0.25], [3, r, 0.45], [3.5, r + 12, 0.4],
    ];
    for (const [b, pitch, d] of pattern) bassNotes.push(createNote(pitch, o + b, d, b % 1 ? 0.7 : 0.9));
  });
  const bass = createTrack('midi', { name: 'Bass', instrument: 'subtractive', preset: 'Sub Bass', color: TRACK_COLORS[1] });
  bass.volume = -7;
  bass.clips.push(createMidiClip(0, 16, 'Bass', bassNotes));

  // Keys
  const chords = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]];
  const keyNotes: Note[] = [];
  chords.forEach((chord, bar) => {
    for (const pitch of chord) {
      keyNotes.push(createNote(pitch, bar * 4, 1.5, 0.7));
      keyNotes.push(createNote(pitch, bar * 4 + 2.5, 1.4, 0.6));
    }
  });
  const keys = createTrack('midi', { name: 'Keys', instrument: 'fm', preset: 'Electric Piano', color: TRACK_COLORS[2] });
  keys.volume = -9;
  keys.pan = -0.2;
  keys.fx = [createFx('reverb', { decay: 2.4, mix: 0.3 })];
  keys.clips.push(createMidiClip(0, 16, 'Chords', keyNotes));

  // Lead
  const melody: [number, number, number][] = [
    [76, 0, 1], [74, 1, 0.5], [72, 1.5, 0.5], [69, 2, 1.5],
    [72, 4, 0.5], [69, 4.5, 0.5], [69, 5, 1], [72, 6, 0.5], [74, 6.5, 1.5],
    [76, 8, 1.5], [79, 9.5, 0.5], [76, 10, 1], [74, 11, 1],
    [74, 12, 1], [71, 13, 1], [67, 14, 2],
  ];
  const lead = createTrack('midi', { name: 'Lead', instrument: 'subtractive', preset: 'Analog Lead', color: TRACK_COLORS[3] });
  lead.volume = -11;
  lead.pan = 0.15;
  lead.fx = [createFx('delay', { sync: 3, feedback: 0.35, mix: 0.22 }), createFx('reverb', { decay: 2.8, mix: 0.25 })];
  lead.automation.volume = [
    { beat: 0, value: -24 },
    { beat: 4, value: -9 },
  ];
  lead.clips.push(createMidiClip(0, 16, 'Melody', melody.map(([pitch, s, d]) => createNote(pitch, s, d, 0.8))));

  // Guitar input through the amp simulator (no clips until you record a take)
  const guitar = createTrack('audio', { name: 'Guitar (Amp)', color: TRACK_COLORS[4] });
  guitar.fx = createFxChain(AMP_PRESETS['British Crunch']);

  p.tracks.push(drums, bass, keys, lead, guitar);
  return p;
}
