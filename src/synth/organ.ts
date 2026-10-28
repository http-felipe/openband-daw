import { BaseInstrument, mtof, noiseBuffer, releaseParam, type VoiceHandle } from './instrument';
import { drawbarHarmonics } from './render';

const LESLIE_RATES = [0, 0.8, 6.4]; // off / chorale (slow) / tremolo (fast), Hz

/**
 * Tonewheel-style organ: nine drawbars summed into one PeriodicWave per voice, a decaying percussion
 * harmonic, key click, chorus-vibrato, and a rotary-speaker effect (amplitude + stereo swirl that
 * spins up/down smoothly when the speed changes).
 */
export class TonewheelOrgan extends BaseInstrument {
  private wave: PeriodicWave | null = null;
  private waveKey = '';
  private vib: { osc: OscillatorNode; depth: GainNode };
  private rotor: { osc: OscillatorNode; depth: GainNode };
  private rotorPan: GainNode;
  private amp: GainNode;
  private pan: StereoPannerNode;

  constructor(ctx: BaseAudioContext) {
    super(ctx);
    this.amp = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.amp.connect(this.pan).connect(this.output);
    this.vib = this.lfo(6.8);
    this.rotor = this.lfo(0.8);
    this.rotor.depth.connect(this.amp.gain);
    this.rotorPan = ctx.createGain();
    this.rotor.osc.connect(this.rotorPan).connect(this.pan.pan);
  }

  setParams(params: Record<string, number>): void {
    super.setParams(params);
    const bars = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'].map((k) => this.p(k));
    const key = bars.join('');
    if (key !== this.waveKey) {
      this.waveKey = key;
      const imag = drawbarHarmonics(bars);
      this.wave = this.ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    }
    const now = this.ctx.currentTime;
    this.vib.depth.gain.setTargetAtTime(this.p('vibrato') * 28, now, 0.05); // cents
    const speed = Math.round(this.p('leslie'));
    const depth = speed ? 0.22 : 0;
    this.amp.gain.setTargetAtTime(1 - depth, now, 0.05);
    this.rotor.depth.gain.setTargetAtTime(depth, now, 0.05);
    this.rotorPan.gain.setTargetAtTime(speed ? 0.55 : 0, now, 0.05);
    // A rotating horn takes about a second to change speed.
    if (speed) this.rotor.osc.frequency.setTargetAtTime(LESLIE_RATES[speed], now, 0.7);
  }

  noteOn(pitch: number, velocity: number, time: number): VoiceHandle {
    const ctx = this.ctx;
    const f = mtof(pitch);
    const level = 0.16 * this.p('level', 0.7); // organs aren't velocity sensitive
    const osc = ctx.createOscillator();
    if (this.wave) osc.setPeriodicWave(this.wave);
    osc.frequency.value = f / 2; // the wave's fundamental is the 16' sub-octave
    this.vib.depth.connect(osc.detune);
    const vca = ctx.createGain();
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(level, time + 0.006);
    osc.connect(vca).connect(this.amp);
    osc.start(time);
    const nodes: AudioNode[] = [osc, vca];
    const extra: AudioScheduledSourceNode[] = [];

    const perc = this.p('perc');
    if (perc > 0) {
      const p = ctx.createOscillator();
      p.frequency.value = f * (Math.round(this.p('percHarm')) ? 3 : 2);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(level * perc * 1.6, time);
      pg.gain.setTargetAtTime(0, time, Math.max(0.03, this.p('percDecay', 0.4)) / 3);
      p.connect(pg).connect(this.amp);
      p.start(time);
      nodes.push(p, pg);
      extra.push(p);
    }
    const click = this.p('click');
    if (click > 0) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(level * click * 1.5 * (0.5 + 0.5 * velocity), time);
      cg.gain.setTargetAtTime(0, time, 0.003);
      n.connect(bp).connect(cg).connect(this.amp);
      n.start(time, Math.random() * 0.5);
      n.stop(time + 0.03);
      nodes.push(n, bp, cg);
    }

    return this.register(
      nodes,
      osc,
      (t) => {
        const r = Math.max(t, time + 0.01);
        releaseParam(vca.gain, r, 0.012);
        osc.stop(r + 0.08);
        for (const s of extra) s.stop(r + 0.08);
      },
      time,
      () => this.vib.depth.disconnect(osc.detune),
    );
  }

  dispose(): void {
    this.vib.osc.stop();
    this.rotor.osc.stop();
    super.dispose();
  }
}
