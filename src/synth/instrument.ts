export interface VoiceHandle {
  /** Begin the release phase at audio-clock `time`. Idempotent. */
  release(time: number): void;
}

export interface Instrument {
  readonly output: GainNode;
  noteOn(pitch: number, velocity: number, time: number): VoiceHandle;
  allNotesOff(): void;
  setParams(params: Record<string, number>): void;
  /** Optional: pre-render (pitch, velocity) pairs the project will play, in the background. */
  prepare?(notes: Iterable<[number, number]>): void;
  dispose(): void;
}

export const mtof = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Freeze the parameter at `time`, then glide to zero. Falls back where cancelAndHoldAtTime is missing. */
export function releaseParam(param: AudioParam, time: number, tau: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(time);
  else param.cancelScheduledValues(time);
  param.setTargetAtTime(0, time, Math.max(0.002, tau));
}

interface Voice {
  handle: VoiceHandle;
  started: number;
  released: boolean;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise, shared by every instrument on a context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** Voice bookkeeping shared by all instruments: polyphony limit, stealing and node cleanup. */
export abstract class BaseInstrument implements Instrument {
  readonly output: GainNode;
  protected params: Record<string, number> = {};
  protected maxVoices = 24;
  private voices = new Set<Voice>();

  constructor(protected readonly ctx: BaseAudioContext) {
    this.output = ctx.createGain();
  }

  abstract noteOn(pitch: number, velocity: number, time: number): VoiceHandle;

  setParams(params: Record<string, number>): void {
    this.params = params;
  }

  allNotesOff(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) v.handle.release(now);
  }

  dispose(): void {
    this.allNotesOff();
    this.output.disconnect();
  }

  protected p(key: string, fallback = 0): number {
    return this.params[key] ?? fallback;
  }

  /**
   * Track a voice. `endSource` fires `ended` when the voice has finished sounding; at that point all of
   * its nodes are disconnected (plus `onEnd`, e.g. to detach a shared LFO) so the graph doesn't grow.
   */
  protected register(
    nodes: AudioNode[],
    endSource: AudioScheduledSourceNode,
    onRelease: (time: number) => void,
    started: number,
    onEnd?: () => void,
  ): VoiceHandle {
    this.steal();
    const voice: Voice = {
      started,
      released: false,
      handle: {
        release: (t: number) => {
          if (voice.released) return;
          voice.released = true;
          onRelease(Math.max(t, this.ctx.currentTime));
        },
      },
    };
    this.voices.add(voice);
    endSource.onended = () => {
      onEnd?.();
      for (const n of nodes) n.disconnect();
      this.voices.delete(voice);
    };
    return voice.handle;
  }

  /** Low-frequency oscillator feeding a gain whose output modulates voices (vibrato, tremolo). Started immediately. */
  protected lfo(rate: number, depth = 0): { osc: OscillatorNode; depth: GainNode } {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    osc.start();
    return { osc, depth: g };
  }

  private steal(): void {
    let active = 0;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (v.released) continue;
      active++;
      if (!oldest || v.started < oldest.started) oldest = v;
    }
    if (active >= this.maxVoices && oldest) oldest.handle.release(this.ctx.currentTime);
  }
}
