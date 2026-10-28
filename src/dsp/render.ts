import { projectEnd, type Project } from '../core/project';
import { scheduleSlice } from '../core/scheduler';
import { AudioEngine } from './engine';

/**
 * Bounces the whole song (ignoring the loop) faster than realtime: the same engine and scheduler
 * run against an OfflineAudioContext, so the export matches what you hear.
 */
export async function renderProject(project: Project, buffers: Map<string, AudioBuffer>, sampleRate = 44100, tailSeconds = 3): Promise<AudioBuffer> {
  const spb = 60 / project.bpm;
  const end = projectEnd(project);
  const ctx = new OfflineAudioContext(2, Math.ceil((end * spb + tailSeconds) * sampleRate), sampleRate);
  const engine = await AudioEngine.create(ctx);
  for (const [id, buf] of buffers) engine.buffers.set(id, buf);
  engine.sync(project);
  engine.beginAutomation(project);

  let beat = 0;
  let time = 0;
  let segmentStart = true;
  while (beat < end) {
    const r = scheduleSlice(project, engine, beat, time, { segmentStart, metronome: false, useLoop: false });
    beat = r.nextBeat;
    time = r.nextTime;
    segmentStart = false;
  }
  return ctx.startRendering();
}
