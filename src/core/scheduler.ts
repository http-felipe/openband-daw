import { beatsPerBar, type AutomationParam, type AutomationPoint, type Project } from './project';

/** Anything that can receive scheduled events: the realtime engine, the offline renderer or a test double. */
export interface ScheduleTarget {
  noteOn(trackId: string, pitch: number, velocity: number, time: number, duration: number): void;
  playAudio(trackId: string, audioId: string, time: number, offset: number, duration: number): void;
  automate(trackId: string, param: AutomationParam, value: number, time: number, jump: boolean): void;
  click(time: number, accent: boolean): void;
}

export interface SliceOptions {
  /** First slice after start or a loop wrap: resume audio clips mid-way and jump automation. */
  segmentStart: boolean;
  metronome: boolean;
  useLoop: boolean;
}

export interface SliceResult {
  nextBeat: number;
  nextTime: number;
  wrapped: boolean;
}

/** Scheduling resolution in beats: fine enough for smooth automation ramps, coarse enough to keep ticks cheap. */
export const SLICE_BEATS = 0.125;
const EPS = 1e-9;

/**
 * Schedules every event in [beat, beat + SLICE_BEATS) — clipped at the loop end — starting at audio-clock `time`.
 * Pure with respect to the project, so the realtime transport, offline export and tests share it.
 */
export function scheduleSlice(p: Project, target: ScheduleTarget, beat: number, time: number, opts: SliceOptions): SliceResult {
  const spb = 60 / p.bpm;
  const loopOn = opts.useLoop && p.loop.enabled && p.loop.end > p.loop.start && beat < p.loop.end - EPS;
  const end = loopOn ? Math.min(beat + SLICE_BEATS, p.loop.end) : beat + SLICE_BEATS;
  // Sounds are cut at the loop end so they never overlap the next pass of the loop.
  const limit = loopOn ? p.loop.end : Infinity;
  const at = (b: number) => time + (b - beat) * spb;

  for (const track of p.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.start + clip.length;
      if (clipEnd <= beat || clip.start >= end) continue;
      const stop = Math.min(clipEnd, limit);
      if (clip.kind === 'midi') {
        for (const n of clip.notes) {
          if (n.start >= clip.length) continue;
          const nb = clip.start + n.start;
          if (nb >= beat - EPS && nb < end - EPS) {
            target.noteOn(track.id, n.pitch, n.velocity, at(nb), Math.min(nb + n.duration, stop) * spb - nb * spb);
          }
        }
      } else if (clip.start >= beat - EPS) {
        target.playAudio(track.id, clip.audioId, at(clip.start), clip.offset, (stop - clip.start) * spb);
      } else if (opts.segmentStart) {
        target.playAudio(track.id, clip.audioId, time, clip.offset + (beat - clip.start) * spb, (stop - beat) * spb);
      }
    }
    for (const param of ['volume', 'pan'] as const) {
      const points = track.automation[param];
      if (!points.length) continue;
      if (opts.segmentStart) target.automate(track.id, param, automationValue(points, beat), time, true);
      target.automate(track.id, param, automationValue(points, end), at(end), false);
    }
  }

  if (opts.metronome) {
    const bpb = beatsPerBar(p);
    for (let k = Math.ceil(beat - EPS); k < end - EPS; k++) {
      const inBar = k % bpb;
      target.click(at(k), Math.abs(inBar) < EPS || Math.abs(inBar - bpb) < EPS);
    }
  }

  const wrapped = loopOn && end >= p.loop.end - EPS;
  return { nextBeat: wrapped ? p.loop.start : end, nextTime: at(end), wrapped };
}

/** Linear interpolation between breakpoints; holds the first/last value outside the range. */
export function automationValue(points: AutomationPoint[], beat: number): number {
  if (!points.length) return 0;
  if (beat <= points[0].beat) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (beat <= b.beat) {
      const a = points[i - 1];
      const span = b.beat - a.beat;
      return span <= 0 ? b.value : a.value + ((beat - a.beat) / span) * (b.value - a.value);
    }
  }
  return points[points.length - 1].value;
}
