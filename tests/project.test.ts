import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../src/core/demo';
import {
  createFx,
  createMidiClip,
  createNote,
  createTrack,
  type FxType,
  type InstrumentType,
  nextSplitName,
  parseProject,
  projectEnd,
  serializeProject,
  splitClip,
  validateProject,
  type AudioClip,
  type MidiClip,
} from '../src/core/project';
import { INSTRUMENT_CATALOG, INSTRUMENT_DEFS } from '../src/synth/defs';
import { FX_DEFS } from '../src/dsp/fx/defs';

describe('project format', () => {
  it('round-trips the demo project losslessly', () => {
    const demo = createDemoProject();
    const again = parseProject(serializeProject(demo));
    expect(again).toEqual(demo);
  });

  it('rejects files that are not OpenBand projects', () => {
    expect(() => validateProject({ format: 'something-else' })).toThrow(/Not an OpenBand/);
    expect(() => validateProject(null)).toThrow();
  });

  it('rejects projects from a newer schema version', () => {
    expect(() => validateProject({ format: 'openband-project', version: 99 })).toThrow(/newer/);
  });

  it('fills defaults, clamps values and drops unknown effects', () => {
    const p = validateProject({
      format: 'openband-project',
      version: 1,
      bpm: 9999,
      tracks: [
        {
          kind: 'midi',
          volume: 50,
          instrument: { type: 'fm', params: { index: 999 } },
          fx: [{ type: 'flanger-from-the-future' }, { type: 'reverb', params: { mix: 3, bogus: 1 } }],
          clips: [{ kind: 'midi', start: -4, notes: [{ pitch: 300, start: 0, duration: 1 }] }, { kind: 'audio', audioId: 'x' }],
        },
      ],
    });
    expect(p.bpm).toBe(300);
    const t = p.tracks[0];
    expect(t.volume).toBe(6);
    expect(t.instrument?.params.index).toBe(12);
    expect(Object.keys(t.instrument!.params).sort()).toEqual(INSTRUMENT_DEFS.fm.params.map((d) => d.key).sort());
    expect(t.fx).toHaveLength(1);
    expect(t.fx[0].params.mix).toBe(1);
    expect(t.fx[0].params).not.toHaveProperty('bogus');
    expect(t.clips).toHaveLength(1); // the audio clip is dropped from a MIDI track
    expect(t.clips[0].start).toBe(0);
    expect(t.clips[0].kind === 'midi' && t.clips[0].notes[0].pitch).toBe(127);
    expect(t.id).toMatch(/^trk_/);
  });

  it('round-trips every instrument engine and effect type', () => {
    const p = createDemoProject();
    for (const type of Object.keys(INSTRUMENT_DEFS) as InstrumentType[]) {
      const t = createTrack('midi', { instrument: type });
      t.fx = (Object.keys(FX_DEFS) as FxType[]).map((fx) => createFx(fx));
      p.tracks.push(t);
    }
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it('only lists catalogue entries whose preset exists, with in-range values', () => {
    for (const entry of INSTRUMENT_CATALOG) {
      const def = INSTRUMENT_DEFS[entry.type];
      expect(def.presets[entry.preset], `${entry.name} → ${entry.preset}`).toBeDefined();
    }
    for (const def of Object.values(INSTRUMENT_DEFS)) {
      for (const [name, preset] of Object.entries(def.presets)) {
        for (const [key, value] of Object.entries(preset)) {
          const param = def.params.find((d) => d.key === key);
          expect(param, `${name}.${key} is a known param`).toBeDefined();
          expect(value, `${name}.${key}`).toBeGreaterThanOrEqual(param!.min);
          expect(value, `${name}.${key}`).toBeLessThanOrEqual(param!.max);
        }
      }
    }
  });

  it('computes the song end from clips', () => {
    expect(projectEnd(createDemoProject())).toBe(16);
  });
});

describe('splitClip', () => {
  it('splits a MIDI clip, cutting notes that cross the boundary', () => {
    const clip = createMidiClip(4, 8, 'riff', [createNote(60, 0, 1), createNote(62, 2.5, 3), createNote(64, 5, 1)]);
    const right = splitClip(clip, 8, 120) as MidiClip;
    expect(clip).toMatchObject({ start: 4, length: 4 });
    expect(clip.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([[60, 0, 1], [62, 2.5, 1.5]]);
    expect(right).toMatchObject({ kind: 'midi', start: 8, length: 4, name: 'riff' });
    expect(right.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([[64, 1, 1]]);
    expect(right.id).not.toBe(clip.id);
  });

  it('splits an audio clip so the right part continues where the left one stops', () => {
    const clip: AudioClip = { id: 'a', kind: 'audio', name: 'Take 1', start: 2, length: 6, audioId: 'aud', offset: 0.5 };
    const right = splitClip(clip, 4, 120) as AudioClip; // 2 beats in = 1 s at 120 BPM
    expect(clip).toMatchObject({ start: 2, length: 2, offset: 0.5 });
    expect(right).toMatchObject({ start: 4, length: 4, offset: 1.5, audioId: 'aud' });
  });

  it('numbers split parts after the base name', () => {
    expect(nextSplitName('Take 1', ['Take 1'])).toBe('Take 1.1');
    expect(nextSplitName('Take 1', ['Take 1', 'Take 1.1'])).toBe('Take 1.2');
    // splitting a part again continues the same sequence
    expect(nextSplitName('Take 1.1', ['Take 1', 'Take 1.1', 'Take 1.2'])).toBe('Take 1.3');
    // other clips and look-alike names don't interfere; regex characters are literal
    expect(nextSplitName('Take 1', ['Take 10.4', 'Take 2.7', 'Take 1x1'])).toBe('Take 1.1');
    expect(nextSplitName('Riff (A)', ['Riff (A).1'])).toBe('Riff (A).2');
  });

  it('refuses to split at or outside the clip edges', () => {
    const clip = createMidiClip(0, 4);
    expect(splitClip(clip, 0, 120)).toBeNull();
    expect(splitClip(clip, 4, 120)).toBeNull();
    expect(splitClip(clip, 9, 120)).toBeNull();
    expect(clip.length).toBe(4);
  });
});
