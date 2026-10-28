import { BaseInstrument, mtof, releaseParam, type VoiceHandle } from './instrument';

const MAX_CACHED = 96; // ~96 notes × a few seconds of mono audio
const VELOCITY_LAYERS = 4;

/**
 * Instrument whose notes are synthesised offline (see render.ts) into AudioBuffers, cached per pitch and
 * velocity layer, and played back with a release envelope. Notes used by the project are pre-rendered in
 * the background (`prepare`) so playback never waits on synthesis.
 */
export abstract class RenderedInstrument extends BaseInstrument {
  /** Where voices connect; subclasses may insert a body/tremolo stage before `output`. */
  protected bus: AudioNode;
  private cache = new Map<string, AudioBuffer>();
  private renderKey = '';
  private queue: string[] = [];
  private warming = false;

  constructor(ctx: BaseAudioContext) {
    super(ctx);
    this.bus = this.output;
  }

  /** Synthesise one note. `velocity` is quantised to a layer (0.25, 0.5, 0.75, 1). */
  protected abstract render(freq: number, velocity: number, sampleRate: number): Float32Array;
  /** Params that change the rendered audio (others, like level or release, don't invalidate the cache). */
  protected abstract renderParams: string[];

  setParams(params: Record<string, number>): void {
    super.setParams(params);
    const key = this.renderParams.map((k) => params[k]).join('|');
    if (key !== this.renderKey) {
      this.renderKey = key;
      this.cache.clear();
    }
  }

  noteOn(pitch: number, velocity: number, time: number): VoiceHandle {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(pitch, velocity);
    const vca = this.ctx.createGain();
    vca.gain.value = this.p('level', 0.7);
    src.connect(vca).connect(this.bus);
    src.start(time);
    const release = Math.max(0.02, this.p('release', 0.3));
    return this.register([src, vca], src, (t) => {
      const r = Math.max(t, time + 0.005);
      releaseParam(vca.gain, r, release / 4);
      src.stop(r + release * 1.5 + 0.05);
    }, time);
  }

  /** Queue background rendering for (pitch, velocity) pairs the project will play. */
  prepare(notes: Iterable<[number, number]>): void {
    for (const [pitch, velocity] of notes) {
      const key = this.key(pitch, velocity);
      if (!this.cache.has(key) && !this.queue.includes(key)) this.queue.push(key);
    }
    if (this.queue.length && !this.warming) {
      this.warming = true;
      setTimeout(() => this.warm(), 0);
    }
  }

  dispose(): void {
    this.queue = [];
    this.cache.clear();
    super.dispose();
  }

  private warm(): void {
    // A couple of notes per task keeps the main thread (and the scheduler) responsive.
    for (let i = 0; i < 2 && this.queue.length; i++) {
      const [pitch, layer] = this.queue.shift()!.split('|').map(Number);
      this.buffer(pitch, layer / VELOCITY_LAYERS);
    }
    if (this.queue.length) setTimeout(() => this.warm(), 0);
    else this.warming = false;
  }

  private key(pitch: number, velocity: number): string {
    return `${pitch}|${Math.max(1, Math.round(velocity * VELOCITY_LAYERS))}`;
  }

  private buffer(pitch: number, velocity: number): AudioBuffer {
    const key = this.key(pitch, velocity);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key); // LRU: re-insert as most recent
      this.cache.set(key, hit);
      return hit;
    }
    const layer = Number(key.split('|')[1]) / VELOCITY_LAYERS;
    const data = this.render(mtof(pitch), layer, this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buf.copyToChannel(data, 0);
    this.cache.set(key, buf);
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    return buf;
  }
}
