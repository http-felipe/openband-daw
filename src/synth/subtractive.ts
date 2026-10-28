import { BaseInstrument, mtof, releaseParam, type VoiceHandle } from './instrument';

const WAVES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
const clampHz = (f: number) => Math.min(18000, Math.max(20, f));

/** Two oscillators → resonant low-pass with its own envelope and key tracking → ADSR amplifier, plus shared vibrato. */
export class SubtractiveSynth extends BaseInstrument {
  private vib = this.lfo(5.5);

  setParams(params: Record<string, number>): void {
    super.setParams(params);
    const now = this.ctx.currentTime;
    this.vib.osc.frequency.setTargetAtTime(this.p('vibRate', 5.5), now, 0.05);
    this.vib.depth.gain.setTargetAtTime(this.p('vibDepth'), now, 0.05); // cents
  }

  dispose(): void {
    this.vib.osc.stop();
    super.dispose();
  }

  noteOn(pitch: number, velocity: number, time: number): VoiceHandle {
    const ctx = this.ctx;
    const f = mtof(pitch);
    const attack = Math.max(0.001, this.p('attack'));
    const release = Math.max(0.01, this.p('release'));
    const detune = this.p('detune');

    const osc1 = ctx.createOscillator();
    osc1.type = WAVES[this.p('wave1')] ?? 'sawtooth';
    osc1.frequency.value = f;
    osc1.detune.value = -detune;
    const osc2 = ctx.createOscillator();
    osc2.type = WAVES[this.p('wave2')] ?? 'square';
    osc2.frequency.value = f * Math.pow(2, this.p('semi2') / 12);
    osc2.detune.value = detune;

    const g1 = ctx.createGain();
    g1.gain.value = 1 - this.p('mix');
    const g2 = ctx.createGain();
    g2.gain.value = this.p('mix');

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = this.p('reso', 1);
    const base = clampHz(this.p('cutoff', 2000) * Math.pow(2, (pitch - 60) / 24));
    const peak = clampHz(base * Math.pow(2, this.p('envAmt') * 6 * (0.5 + 0.5 * velocity)));
    const fAttack = time + Math.min(attack, 0.05) + 0.002;
    filter.frequency.setValueAtTime(base, time);
    filter.frequency.linearRampToValueAtTime(peak, fAttack);
    filter.frequency.setTargetAtTime(base, fAttack, Math.max(0.005, this.p('fdecay') / 3));

    const vca = ctx.createGain();
    const amp = 0.28 * this.p('level', 0.7) * (0.25 + 0.75 * velocity);
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(amp, time + attack);
    vca.gain.setTargetAtTime(amp * this.p('sustain'), time + attack, Math.max(0.003, this.p('decay') / 3));

    osc1.connect(g1).connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(vca).connect(this.output);
    this.vib.depth.connect(osc1.detune);
    this.vib.depth.connect(osc2.detune);
    osc1.start(time);
    osc2.start(time);

    return this.register(
      [osc1, osc2, g1, g2, filter, vca],
      osc1,
      (t) => {
        const r = Math.max(t, time + 0.005);
        releaseParam(vca.gain, r, release / 4);
        const end = r + release * 1.5 + 0.05;
        osc1.stop(end);
        osc2.stop(end);
      },
      time,
      () => {
        this.vib.depth.disconnect(osc1.detune);
        this.vib.depth.disconnect(osc2.detune);
      },
    );
  }
}
