import { beatsPerBar, projectEnd, type Project } from './project';
import { scheduleSlice } from './scheduler';
import type { AudioEngine } from '../dsp/engine';

const LOOKAHEAD = 0.12; // seconds scheduled ahead of the audio clock
const TICK_MS = 25;
const START_DELAY = 0.06;

/**
 * A metronome tick from a dedicated worker: worker timers are not throttled like main-thread
 * timers in background tabs, which keeps the lookahead queue fed.
 */
function createTicker(onTick: () => void): { start(): void; stop(): void } {
  try {
    const src = 'let t=0;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = onTick;
    return { start: () => worker.postMessage(TICK_MS), stop: () => worker.postMessage(0) };
  } catch {
    let id = 0;
    return { start: () => (id = window.setInterval(onTick, TICK_MS)), stop: () => window.clearInterval(id) };
  }
}

export class Transport {
  playing = false;
  recording = false;
  metronome = false;
  /** Set while recording audio: takes are linear, so the loop is temporarily ignored. */
  ignoreLoop = false;
  /** During a count-in, the beat where recording starts; the metronome clicks until then. */
  countInEnd: number | null = null;
  /** Playhead while stopped (beats). */
  position = 0;

  private beat = 0;
  private time = 0;
  private segmentStart = false;
  private markers: { time: number; beat: number }[] = [];
  private readonly ticker = createTicker(() => this.tick());

  constructor(
    private readonly engine: AudioEngine,
    private readonly project: () => Project,
    private readonly onStop: (wasRecording: boolean) => void,
  ) {}

  /** Starts playback at `from` (default: the stopped position). May be negative for a count-in pre-roll. */
  play(from = this.position): void {
    if (this.playing) return;
    void this.engine.resume();
    this.playing = true;
    this.beat = from;
    this.time = this.engine.ctx.currentTime + START_DELAY;
    this.segmentStart = true;
    this.markers = [];
    this.engine.beginAutomation(this.project());
    this.tick();
    this.ticker.start();
  }

  stop(): void {
    if (!this.playing) return;
    this.position = Math.max(0, this.currentBeat());
    this.ticker.stop();
    this.playing = false;
    const wasRecording = this.recording;
    this.recording = false;
    this.countInEnd = null;
    this.engine.stopAll();
    this.onStop(wasRecording);
  }

  seek(beat: number): void {
    const resume = this.playing && !this.recording;
    this.stop();
    this.position = Math.max(0, beat);
    if (resume) this.play();
  }

  /** Musical position heard at audio-clock `time`, extrapolated linearly from the nearest scheduling marker. */
  beatAt(time: number): number {
    if (!this.playing || !this.markers.length) return this.position;
    let m = this.markers[0];
    for (const mk of this.markers) {
      if (mk.time <= time) m = mk;
      else break;
    }
    return m.beat + ((time - m.time) * this.project().bpm) / 60;
  }

  currentBeat(): number {
    if (!this.playing || !this.markers.length) return this.position;
    const now = this.engine.ctx.currentTime;
    return now < this.markers[0].time ? this.markers[0].beat : this.beatAt(now);
  }

  private tick(): void {
    if (!this.playing) return;
    const p = this.project();
    const now = this.engine.ctx.currentTime;
    const useLoop = !this.ignoreLoop;

    // After a long stall, jump to "now" rather than flooding the past with events.
    if (this.time < now) {
      this.beat += ((now - this.time) * p.bpm) / 60;
      this.time = now;
      this.segmentStart = true;
      const { loop } = p;
      if (useLoop && loop.enabled && this.beat >= loop.end && loop.end > loop.start) {
        this.beat = loop.start + ((this.beat - loop.start) % (loop.end - loop.start));
      }
    }

    while (this.time < now + LOOKAHEAD) {
      this.markers.push({ time: this.time, beat: this.beat });
      const r = scheduleSlice(p, this.engine, this.beat, this.time, {
        segmentStart: this.segmentStart,
        metronome: this.metronome || (this.countInEnd !== null && this.beat < this.countInEnd),
        useLoop,
      });
      this.beat = r.nextBeat;
      this.time = r.nextTime;
      this.segmentStart = r.wrapped;
    }
    while (this.markers.length > 2 && this.markers[1].time < now - 0.5) this.markers.shift();

    const looping = useLoop && p.loop.enabled;
    if (!this.recording && !looping && this.currentBeat() > projectEnd(p) + beatsPerBar(p)) {
      this.stop();
      this.position = 0;
    }
  }
}
