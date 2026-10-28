import { BaseInstrument, noiseBuffer, releaseParam, type VoiceHandle } from './instrument';

const NOOP: VoiceHandle = { release() {} };
const SILENT = 0.0001;
/** Inharmonic square-wave ratios for metallic cymbal tones (classic analog drum-machine approach). */
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

/** Fully synthesized one-shot drum kit, triggered by General-MIDI drum note numbers. */
export class DrumMachine extends BaseInstrument {
  private openHat: AudioParam | null = null;

  noteOn(pitch: number, velocity: number, time: number): VoiceHandle {
    const v = velocity * this.p('level', 0.8);
    switch (pitch) {
      case 35:
      case 36:
        return this.kick(time, v);
      case 37:
        return this.rim(time, v);
      case 38:
      case 40:
        return this.snare(time, v);
      case 39:
        return this.clap(time, v);
      case 42:
      case 44:
        return this.hat(time, v, false);
      case 46:
        return this.hat(time, v, true);
      case 41:
      case 43:
        return this.tom(time, v, 95);
      case 45:
      case 47:
        return this.tom(time, v, 135);
      case 48:
      case 50:
        return this.tom(time, v, 185);
      case 49:
      case 57:
        return this.crash(time, v);
      default:
        return NOOP;
    }
  }

  private noise(time: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx);
    src.start(time, Math.random() * 0.5);
    src.stop(time + duration);
    return src;
  }

  /** Sine with a fast exponential pitch sweep, plus a filtered noise click for attack. */
  private kick(time: number, v: number): VoiceHandle {
    const tune = this.p('kickTune', 1);
    const decay = this.p('kickDecay', 0.5);
    const punch = this.p('kickPunch', 0.5);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(150 * tune * (1 + punch), time);
    osc.frequency.exponentialRampToValueAtTime(48 * tune, time + 0.04 + (1 - punch) * 0.06);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v, time);
    g.gain.exponentialRampToValueAtTime(SILENT, time + decay);
    osc.connect(g).connect(this.output);
    osc.start(time);
    osc.stop(time + decay + 0.05);

    const click = this.noise(time, 0.02);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(v * punch * 0.6, time);
    cg.gain.exponentialRampToValueAtTime(SILENT, time + 0.012);
    click.connect(hp).connect(cg).connect(this.output);
    return this.register([osc, g, click, hp, cg], osc, () => {}, time);
  }

  /** Pitched triangle "body" + high-passed noise "snares". */
  private snare(time: number, v: number): VoiceHandle {
    const snap = this.p('snareTone', 0.4);
    const decay = this.p('snareDecay', 0.18);
    const body = this.ctx.createOscillator();
    body.type = 'triangle';
    const tune = this.p('snareTune', 1);
    body.frequency.setValueAtTime(240 * tune, time);
    body.frequency.exponentialRampToValueAtTime(180 * tune, time + 0.03);
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(v * (1 - snap * 0.6) * 0.8, time);
    bg.gain.exponentialRampToValueAtTime(SILENT, time + decay * 0.6);
    body.connect(bg).connect(this.output);
    body.start(time);
    body.stop(time + decay + 0.05);

    const n = this.noise(time, decay + 0.05);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500 * tune;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(v * (0.35 + snap * 0.65), time);
    ng.gain.exponentialRampToValueAtTime(SILENT, time + decay);
    n.connect(hp).connect(ng).connect(this.output);
    return this.register([body, bg, n, hp, ng], n, () => {}, time);
  }

  /** Three quick band-passed noise bursts followed by a short tail. */
  private clap(time: number, v: number): VoiceHandle {
    const n = this.noise(time, 0.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150;
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    for (const k of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(v, time + k);
      g.gain.exponentialRampToValueAtTime(v * 0.15, time + k + 0.01);
    }
    g.gain.setValueAtTime(v * 0.7, time + 0.034);
    g.gain.exponentialRampToValueAtTime(SILENT, time + 0.22);
    n.connect(bp).connect(g).connect(this.output);
    return this.register([n, bp, g], n, () => {}, time);
  }

  /** Six detuned squares → band-pass → high-pass. A closed hat chokes a ringing open hat. */
  private hat(time: number, v: number, open: boolean): VoiceHandle {
    const tone = this.p('hatTone', 1);
    const decay = this.p('hatDecay', 0.05) * (open ? 6 : 1);
    if (!open && this.openHat) {
      releaseParam(this.openHat, time, 0.008);
      this.openHat = null;
    }
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 10000 * tone;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000 * tone;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(SILENT, time);
    g.gain.exponentialRampToValueAtTime(v * 0.45, time + 0.002);
    g.gain.exponentialRampToValueAtTime(SILENT, time + decay);
    const oscs = METAL_RATIOS.map((r) => {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 40 * r * tone;
      o.connect(bp);
      o.start(time);
      o.stop(time + decay + 0.05);
      return o;
    });
    bp.connect(hp).connect(g).connect(this.output);
    if (open) this.openHat = g.gain;
    return this.register([...oscs, bp, hp, g], oscs[0], () => {}, time);
  }

  private tom(time: number, v: number, freq: number): VoiceHandle {
    const tune = this.p('tomTune', 1);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * tune, time);
    osc.frequency.exponentialRampToValueAtTime(freq * tune * 0.6, time + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v * 0.9, time);
    g.gain.exponentialRampToValueAtTime(SILENT, time + 0.45);
    osc.connect(g).connect(this.output);
    osc.start(time);
    osc.stop(time + 0.5);
    return this.register([osc, g], osc, () => {}, time);
  }

  private rim(time: number, v: number): VoiceHandle {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1700;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v * 0.9, time);
    g.gain.exponentialRampToValueAtTime(SILENT, time + 0.03);
    osc.connect(bp).connect(g).connect(this.output);
    osc.start(time);
    osc.stop(time + 0.05);
    return this.register([osc, bp, g], osc, () => {}, time);
  }

  private crash(time: number, v: number): VoiceHandle {
    const tone = this.p('hatTone', 1);
    const n = this.noise(time, 1.6);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000 * tone;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v * 0.5, time);
    g.gain.exponentialRampToValueAtTime(SILENT, time + 1.5);
    n.connect(hp).connect(g).connect(this.output);
    return this.register([n, hp, g], n, () => {}, time);
  }
}
