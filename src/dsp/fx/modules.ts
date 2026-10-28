import { dbToGain, type FxType } from '../../core/project';
import { makeCabinetIR, makeReverbIR } from '../ir';
import { drivePreGain, shapeSample } from '../shapes';
import { DELAY_SYNC } from './defs';

/** What an effect needs from its host engine. */
export interface FxHost {
  readonly ctx: BaseAudioContext;
  readonly bpm: number;
  readonly workletReady: boolean;
  readonly realtime: boolean;
}

/** One insert: `input` → (internal graph) → `output`. Parameters are applied incrementally. */
export abstract class FxModule {
  readonly input: GainNode;
  readonly output: GainNode;
  protected readonly ctx: BaseAudioContext;
  protected values: Record<string, number> = {};
  private applied: Record<string, number> = {};
  private immediate = false;

  constructor(
    readonly type: FxType,
    protected readonly host: FxHost,
  ) {
    this.ctx = host.ctx;
    this.input = this.ctx.createGain();
    this.output = this.ctx.createGain();
  }

  update(params: Record<string, number>, force = false): void {
    this.values = params;
    this.immediate = force; // first application: jump to values instead of gliding from the defaults
    for (const key of Object.keys(params)) {
      const v = params[key];
      if (force || this.applied[key] !== v) {
        this.applied[key] = v;
        this.apply(key, v);
      }
    }
    this.immediate = false;
  }

  onTempo(): void {}

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
  }

  protected abstract apply(key: string, value: number): void;

  /** Click-free parameter change (instant on the module's first update, so nothing passes at default levels). */
  protected set(param: AudioParam, value: number): void {
    if (this.immediate) param.setValueAtTime(value, this.ctx.currentTime);
    else param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  protected filter(type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  /** Equal-power dry/wet crossfade. */
  protected crossfade(dry: GainNode, wet: GainNode, mix: number): void {
    this.set(dry.gain, Math.cos((mix * Math.PI) / 2));
    this.set(wet.gain, Math.sin((mix * Math.PI) / 2));
  }
}

class GainFx extends FxModule {
  constructor(host: FxHost) {
    super('gain', host);
    this.input.connect(this.output);
  }
  protected apply(_key: string, value: number): void {
    this.set(this.output.gain, dbToGain(value));
  }
}

class Eq3Fx extends FxModule {
  private low = this.filter('lowshelf', 120);
  private mid = this.filter('peaking', 800, 0.9);
  private high = this.filter('highshelf', 5000);
  constructor(host: FxHost) {
    super('eq3', host);
    this.input.connect(this.low).connect(this.mid).connect(this.high).connect(this.output);
  }
  protected apply(key: string, value: number): void {
    if (key === 'low') this.set(this.low.gain, value);
    else if (key === 'mid') this.set(this.mid.gain, value);
    else if (key === 'midFreq') this.set(this.mid.frequency, value);
    else if (key === 'high') this.set(this.high.gain, value);
  }
}

/** Input → HPF → saturator (AudioWorklet, or WaveShaper fallback) → tone LPF → level ⇄ dry mix. */
class DriveFx extends FxModule {
  private hp = this.filter('highpass', 35);
  private tone = this.filter('lowpass', 5000);
  private level = this.ctx.createGain();
  private wet = this.ctx.createGain();
  private dry = this.ctx.createGain();
  private worklet: AudioWorkletNode | null = null;
  private shaper: WaveShaperNode | null = null;

  constructor(host: FxHost) {
    super('drive', host);
    let core: AudioNode;
    if (host.workletReady) {
      this.worklet = new AudioWorkletNode(this.ctx, 'ob-drive');
      core = this.worklet;
    } else {
      this.shaper = this.ctx.createWaveShaper();
      this.shaper.oversample = '4x';
      core = this.shaper;
    }
    this.input.connect(this.hp).connect(core).connect(this.tone).connect(this.level).connect(this.wet).connect(this.output);
    this.input.connect(this.dry).connect(this.output);
  }

  protected apply(key: string, value: number): void {
    switch (key) {
      case 'drive':
      case 'mode':
        if (this.worklet) this.worklet.parameters.get(key)?.setValueAtTime(value, this.ctx.currentTime);
        else this.rebuildCurve();
        break;
      case 'tone':
        this.set(this.tone.frequency, 600 * Math.pow(2, value * 4.5));
        break;
      case 'output':
        this.set(this.level.gain, dbToGain(value));
        break;
      case 'mix':
        this.crossfade(this.dry, this.wet, value);
        break;
    }
  }

  private rebuildCurve(): void {
    if (!this.shaper) return;
    const pre = drivePreGain(this.values.drive ?? 0.5);
    const mode = Math.round(this.values.mode ?? 0);
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = shapeSample(((i / (n - 1)) * 2 - 1) * pre, mode);
    this.shaper.curve = curve;
  }

  dispose(): void {
    super.dispose();
    this.worklet?.disconnect();
  }
}

/** Speaker cabinet: either a biquad voicing (fast) or a convolution with a synthetic IR. */
const CAB_VOICING: [number, number, number][][] = [
  // [freq, gain dB, Q] × 3 for "1x12 Filter" and "4x12 Filter"
  [[120, 3, 1.2], [1800, 3, 1], [500, -2, 1]],
  [[95, 5, 1.4], [2400, 4, 1.2], [400, -4, 0.9]],
];

class CabinetFx extends FxModule {
  private hp = this.filter('highpass', 80);
  private peaks = [this.filter('peaking', 120), this.filter('peaking', 1800), this.filter('peaking', 500)];
  private conv = this.ctx.createConvolver();
  private lp1 = this.filter('lowpass', 5000, 0.9);
  private lp2 = this.filter('lowpass', 5750, 0.6);
  /** Level compensation: the filter voicings' resonant peaks add ~4 dB; normalised IRs don't. */
  private trim = this.ctx.createGain();
  private wet = this.ctx.createGain();
  private dry = this.ctx.createGain();

  constructor(host: FxHost) {
    super('cabinet', host);
    this.input.connect(this.hp);
    this.lp1.connect(this.lp2).connect(this.trim).connect(this.wet).connect(this.output);
    this.input.connect(this.dry).connect(this.output);
  }

  protected apply(key: string, value: number): void {
    if (key === 'mode') this.setModel(Math.round(value));
    else if (key === 'lowCut') this.set(this.hp.frequency, value);
    else if (key === 'highCut') {
      this.set(this.lp1.frequency, value);
      this.set(this.lp2.frequency, value * 1.15);
    } else if (key === 'mix') this.crossfade(this.dry, this.wet, value);
  }

  private setModel(mode: number): void {
    this.hp.disconnect();
    for (const p of this.peaks) p.disconnect();
    this.conv.disconnect();
    this.trim.gain.value = mode >= 2 ? 1 : 0.6;
    if (mode >= 2) {
      this.conv.buffer = makeCabinetIR(this.ctx, mode === 2 ? 'vintage' : 'modern');
      this.hp.connect(this.conv).connect(this.lp1);
      return;
    }
    CAB_VOICING[mode].forEach(([f, g, q], i) => {
      this.peaks[i].frequency.value = f;
      this.peaks[i].gain.value = g;
      this.peaks[i].Q.value = q;
    });
    this.hp.connect(this.peaks[0]).connect(this.peaks[1]).connect(this.peaks[2]).connect(this.lp1);
  }
}

/** Feedback delay with a damping filter inside the loop; time is free (ms) or tempo-synced. */
class DelayFx extends FxModule {
  private delay = this.ctx.createDelay(2);
  private feedback = this.ctx.createGain();
  private damp = this.filter('lowpass', 4000);
  private wet = this.ctx.createGain();
  private dry = this.ctx.createGain();

  constructor(host: FxHost) {
    super('delay', host);
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.delay).connect(this.damp).connect(this.wet).connect(this.output);
    this.damp.connect(this.feedback).connect(this.delay);
  }

  protected apply(key: string, value: number): void {
    if (key === 'time' || key === 'sync') this.retime();
    else if (key === 'feedback') this.set(this.feedback.gain, value);
    else if (key === 'tone') this.set(this.damp.frequency, value);
    else if (key === 'mix') this.crossfade(this.dry, this.wet, value);
  }

  onTempo(): void {
    this.retime();
  }

  private retime(): void {
    const sync = DELAY_SYNC[Math.round(this.values.sync ?? 0)];
    const seconds = sync && sync.beats > 0 ? (sync.beats * 60) / this.host.bpm : (this.values.time ?? 350) / 1000;
    this.set(this.delay.delayTime, Math.min(1.99, seconds));
  }
}

/** Convolution reverb on a procedurally generated IR; regenerated (debounced) when the decay changes. */
class ReverbFx extends FxModule {
  private pre = this.ctx.createDelay(1);
  private conv = this.ctx.createConvolver();
  private tone = this.filter('lowpass', 7000);
  private wet = this.ctx.createGain();
  private dry = this.ctx.createGain();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: FxHost) {
    super('reverb', host);
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.pre).connect(this.conv).connect(this.tone).connect(this.wet).connect(this.output);
  }

  protected apply(key: string, value: number): void {
    if (key === 'decay') this.regenerate(value);
    else if (key === 'predelay') this.set(this.pre.delayTime, value / 1000);
    else if (key === 'tone') this.set(this.tone.frequency, value);
    else if (key === 'mix') this.crossfade(this.dry, this.wet, value);
  }

  private regenerate(seconds: number): void {
    const build = () => {
      this.conv.buffer = makeReverbIR(this.ctx, seconds);
    };
    if (!this.host.realtime || !this.conv.buffer) {
      build();
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(build, 150);
  }

  dispose(): void {
    clearTimeout(this.timer);
    super.dispose();
  }
}

/** LFO helper for modulation effects: an oscillator scaled by `depth`. */
function modLfo(ctx: BaseAudioContext): { osc: OscillatorNode; depth: GainNode } {
  const osc = ctx.createOscillator();
  const depth = ctx.createGain();
  osc.connect(depth);
  osc.start();
  return { osc, depth };
}

/** Stereo chorus: two short delays swept by one LFO in opposite directions, panned left and right. */
class ChorusFx extends FxModule {
  private left = this.ctx.createDelay(0.1);
  private right = this.ctx.createDelay(0.1);
  private lfo = modLfo(this.ctx);
  private invert = this.ctx.createGain();
  private merge = this.ctx.createChannelMerger(2);
  private wet = this.ctx.createGain();
  private dry = this.ctx.createGain();

  constructor(host: FxHost) {
    super('chorus', host);
    this.invert.gain.value = -1;
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.left).connect(this.merge, 0, 0);
    this.input.connect(this.right).connect(this.merge, 0, 1);
    this.merge.connect(this.wet).connect(this.output);
    this.lfo.depth.connect(this.left.delayTime);
    this.lfo.depth.connect(this.invert).connect(this.right.delayTime);
  }

  protected apply(key: string, value: number): void {
    if (key === 'rate') this.set(this.lfo.osc.frequency, value);
    else if (key === 'depth') this.set(this.lfo.depth.gain, value / 1000);
    else if (key === 'delay') {
      this.set(this.left.delayTime, value / 1000);
      this.set(this.right.delayTime, value / 1000);
    } else if (key === 'mix') this.crossfade(this.dry, this.wet, value);
  }

  dispose(): void {
    this.lfo.osc.stop();
    super.dispose();
  }
}

/** Amplitude modulation: gain = 1 − depth/2 ± depth/2. */
class TremoloFx extends FxModule {
  private amp = this.ctx.createGain();
  private lfo = modLfo(this.ctx);

  constructor(host: FxHost) {
    super('tremolo', host);
    this.input.connect(this.amp).connect(this.output);
    this.lfo.depth.connect(this.amp.gain);
  }

  protected apply(key: string, value: number): void {
    if (key === 'shape') this.lfo.osc.type = (['sine', 'square', 'triangle'] as OscillatorType[])[Math.round(value)] ?? 'sine';
    else if (key === 'rate') this.set(this.lfo.osc.frequency, value);
    else if (key === 'depth') {
      this.set(this.amp.gain, 1 - value / 2);
      this.set(this.lfo.depth.gain, value / 2);
    }
  }

  dispose(): void {
    this.lfo.osc.stop();
    super.dispose();
  }
}

/** Four all-pass stages swept by an LFO; mixing with the dry signal creates moving notches. */
class PhaserFx extends FxModule {
  private stages = Array.from({ length: 4 }, () => this.filter('allpass', 900, 1));
  private lfo = modLfo(this.ctx);
  private wet = this.ctx.createGain();
  private dry = this.ctx.createGain();

  constructor(host: FxHost) {
    super('phaser', host);
    this.input.connect(this.dry).connect(this.output);
    let node: AudioNode = this.input;
    for (const s of this.stages) {
      node.connect(s);
      node = s;
      this.lfo.depth.connect(s.frequency);
    }
    node.connect(this.wet).connect(this.output);
  }

  protected apply(key: string, value: number): void {
    if (key === 'rate') this.set(this.lfo.osc.frequency, value);
    else if (key === 'center' || key === 'depth') {
      const center = this.values.center ?? 900;
      for (const s of this.stages) this.set(s.frequency, center);
      this.set(this.lfo.depth.gain, center * 0.8 * (this.values.depth ?? 0.7)); // sweep ±80% of centre
    } else if (key === 'resonance') for (const s of this.stages) this.set(s.Q, value);
    // Equal parts dry and wet give the deepest notches; mix scales the wet side only.
    else if (key === 'mix') {
      this.set(this.wet.gain, value);
      this.set(this.dry.gain, 1 - value * 0.5);
    }
  }

  dispose(): void {
    this.lfo.osc.stop();
    super.dispose();
  }
}

class CompressorFx extends FxModule {
  private comp = this.ctx.createDynamicsCompressor();
  private makeup = this.ctx.createGain();
  constructor(host: FxHost) {
    super('compressor', host);
    this.comp.knee.value = 6;
    this.input.connect(this.comp).connect(this.makeup).connect(this.output);
  }
  protected apply(key: string, value: number): void {
    if (key === 'makeup') this.set(this.makeup.gain, dbToGain(value));
    else if (key === 'threshold') this.set(this.comp.threshold, value);
    else if (key === 'ratio') this.set(this.comp.ratio, value);
    else if (key === 'attack') this.set(this.comp.attack, value);
    else if (key === 'release') this.set(this.comp.release, value);
  }
}

export function createFxModule(type: FxType, host: FxHost): FxModule {
  switch (type) {
    case 'gain':
      return new GainFx(host);
    case 'eq3':
      return new Eq3Fx(host);
    case 'drive':
      return new DriveFx(host);
    case 'cabinet':
      return new CabinetFx(host);
    case 'delay':
      return new DelayFx(host);
    case 'reverb':
      return new ReverbFx(host);
    case 'compressor':
      return new CompressorFx(host);
    case 'chorus':
      return new ChorusFx(host);
    case 'tremolo':
      return new TremoloFx(host);
    case 'phaser':
      return new PhaserFx(host);
  }
}
