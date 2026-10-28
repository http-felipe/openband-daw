import { describe, expect, it } from 'vitest';
import { createEmptyProject, createMidiClip, createNote, createTrack, type AutomationParam, type Project } from '../src/core/project';
import { SLICE_BEATS, automationValue, scheduleSlice, type ScheduleTarget } from '../src/core/scheduler';

type Event =
  | { kind: 'note'; pitch: number; time: number; duration: number }
  | { kind: 'audio'; time: number; offset: number; duration: number }
  | { kind: 'auto'; param: AutomationParam; value: number; time: number; jump: boolean }
  | { kind: 'click'; time: number; accent: boolean };

function recorder(): ScheduleTarget & { events: Event[] } {
  const events: Event[] = [];
  return {
    events,
    noteOn: (_t, pitch, _v, time, duration) => events.push({ kind: 'note', pitch, time, duration }),
    playAudio: (_t, _a, time, offset, duration) => events.push({ kind: 'audio', time, offset, duration }),
    automate: (_t, param, value, time, jump) => events.push({ kind: 'auto', param, value, time, jump }),
    click: (time, accent) => events.push({ kind: 'click', time, accent }),
  };
}

/** Runs the scheduler from beat 0 for `beats` of musical time, like the transport does. */
function run(p: Project, beats: number, opts: { metronome?: boolean; useLoop?: boolean } = {}) {
  const target = recorder();
  let beat = 0;
  let time = 0;
  let segmentStart = true;
  let elapsed = 0;
  const wraps: number[] = [];
  while (elapsed < beats - 1e-9) {
    const r = scheduleSlice(p, target, beat, time, { segmentStart, metronome: !!opts.metronome, useLoop: opts.useLoop ?? true });
    elapsed += ((r.nextTime - time) * p.bpm) / 60;
    if (r.wrapped) wraps.push(r.nextTime);
    beat = r.nextBeat;
    time = r.nextTime;
    segmentStart = r.wrapped;
  }
  return { events: target.events, wraps };
}

function songWith(notes: [number, number, number][], bpm = 120): Project {
  const p = createEmptyProject();
  p.bpm = bpm;
  const t = createTrack('midi');
  t.clips.push(createMidiClip(0, 4, 'clip', notes.map(([pitch, start, dur]) => createNote(pitch, start, dur))));
  p.tracks.push(t);
  return p;
}

describe('scheduleSlice', () => {
  it('schedules notes at the correct audio time and duration', () => {
    const p = songWith([[60, 0, 1], [64, 1.5, 0.5]], 120); // 0.5 s per beat
    const notes = run(p, 4).events.filter((e) => e.kind === 'note');
    expect(notes).toEqual([
      { kind: 'note', pitch: 60, time: 0, duration: 0.5 },
      { kind: 'note', pitch: 64, time: 0.75, duration: 0.25 },
    ]);
  });

  it('never schedules a note twice across slice boundaries', () => {
    const p = songWith(Array.from({ length: 32 }, (_, i) => [60, i * SLICE_BEATS, SLICE_BEATS] as [number, number, number]));
    expect(run(p, 4).events.filter((e) => e.kind === 'note')).toHaveLength(32);
  });

  it('wraps at the loop end and replays the loop region', () => {
    const p = songWith([[60, 0, 0.5], [62, 2, 0.5]], 60); // 1 s per beat
    p.loop = { enabled: true, start: 0, end: 2 };
    const { events, wraps } = run(p, 6);
    expect(wraps).toEqual([2, 4, 6]);
    expect(events.filter((e) => e.kind === 'note').map((e) => (e as { time: number }).time)).toEqual([0, 2, 4]);
  });

  it('truncates notes at the clip end', () => {
    const p = songWith([[60, 3, 4]], 60);
    const note = run(p, 4).events.find((e) => e.kind === 'note');
    expect(note).toMatchObject({ time: 3, duration: 1 });
  });

  it('accents the downbeat of each bar on the metronome', () => {
    const p = songWith([], 60);
    const clicks = run(p, 8, { metronome: true }).events.filter((e) => e.kind === 'click') as { time: number; accent: boolean }[];
    expect(clicks.map((c) => c.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false, true, false, false, false]);
  });

  it('clicks with bar accents through a negative count-in pre-roll', () => {
    const p = songWith([], 60);
    const target = recorder();
    let beat = -4;
    let time = 0;
    while (beat < 0) {
      const r = scheduleSlice(p, target, beat, time, { segmentStart: false, metronome: true, useLoop: true });
      beat = r.nextBeat;
      time = r.nextTime;
    }
    const clicks = target.events.filter((e) => e.kind === 'click') as { time: number; accent: boolean }[];
    expect(clicks.map((c) => c.time)).toEqual([0, 1, 2, 3]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it('resumes audio clips mid-way after a loop wrap', () => {
    const p = createEmptyProject();
    p.bpm = 60;
    p.loop = { enabled: true, start: 1, end: 3 };
    const t = createTrack('audio');
    t.clips.push({ id: 'a', kind: 'audio', name: 'take', start: 0, length: 8, audioId: 'aud', offset: 0.5 });
    p.tracks.push(t);
    const audio = run(p, 3.5).events.filter((e) => e.kind === 'audio');
    // first pass starts before the loop and is cut at the loop end (beat 3)
    expect(audio[0]).toMatchObject({ time: 0, offset: 0.5, duration: 3 });
    // after wrapping to beat 1 at t=3s the clip restarts 1 s into the clip, again cut at the loop end
    expect(audio[1]).toMatchObject({ time: 3, offset: 1.5, duration: 2 });
  });

  it('cuts notes that would ring past the loop end', () => {
    const p = songWith([[60, 1, 4]], 60);
    p.loop = { enabled: true, start: 0, end: 2 };
    const note = run(p, 2).events.find((e) => e.kind === 'note');
    expect(note).toMatchObject({ time: 1, duration: 1 });
  });

  it('jumps automation at segment start and ramps afterwards', () => {
    const p = songWith([], 60);
    p.tracks[0].automation.volume = [{ beat: 0, value: -24 }, { beat: 4, value: 0 }];
    const autos = run(p, 1).events.filter((e) => e.kind === 'auto') as { value: number; jump: boolean }[];
    expect(autos[0]).toMatchObject({ value: -24, jump: true });
    expect(autos.at(-1)).toMatchObject({ value: -18, jump: false });
  });
});

describe('automationValue', () => {
  const pts = [{ beat: 2, value: 10 }, { beat: 4, value: 20 }];
  it('holds outside the range and interpolates inside', () => {
    expect(automationValue(pts, 0)).toBe(10);
    expect(automationValue(pts, 3)).toBe(15);
    expect(automationValue(pts, 9)).toBe(20);
    expect(automationValue([], 1)).toBe(0);
  });
});
