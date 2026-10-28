import { BaseInstrument, mtof, releaseParam, type VoiceHandle } from './instrument';

/**
 * Two-operator FM (sine carrier, sine modulator with a decaying index) plus an optional fast-decaying
 * second modulator that adds the metallic "tine"/hammer transient typical of electric pianos.
 */
export class FmSynth extends BaseInstrument {
  noteOn(pitch: number, velocity: number, time: number): VoiceHandle {
    const ctx = this.ctx;
    const f = mtof(pitch);
    const attack = Math.max(0.001, this.p('attack'));
    const release = Math.max(0.01, this.p('release'));
    const indexDecay = Math.max(0.005, this.p('indexDecay', 0.5));

    const carrier = ctx.createOscillator();
    carrier.frequency.value = f;

    const mod = ctx.createOscillator();
    mod.frequency.value = f * this.p('ratio', 1);
    const modGain = ctx.createGain();
    const depth = this.p('index') * f * (0.4 + 0.6 * velocity); // peak deviation in Hz
    modGain.gain.setValueAtTime(depth, time);
    modGain.gain.setTargetAtTime(depth * 0.12, time, indexDecay / 3);
    mod.connect(modGain).connect(carrier.frequency);

    const nodes: AudioNode[] = [carrier, mod, modGain];
    const oscs = [carrier, mod];
    if (this.p('ratio2') > 0 && this.p('index2') > 0) {
      const tine = ctx.createOscillator();
      tine.frequency.value = f * this.p('ratio2');
      const tineGain = ctx.createGain();
      const tineDepth = this.p('index2') * f * velocity;
      tineGain.gain.setValueAtTime(tineDepth, time);
      tineGain.gain.setTargetAtTime(0, time, Math.max(0.003, indexDecay * 0.08));
      tine.connect(tineGain).connect(carrier.frequency);
      nodes.push(tine, tineGain);
      oscs.push(tine);
    }

    const vca = ctx.createGain();
    const amp = 0.3 * this.p('level', 0.6) * (0.2 + 0.8 * velocity);
    vca.gain.setValueAtTime(0, time);
    vca.gain.linearRampToValueAtTime(amp, time + attack);
    vca.gain.setTargetAtTime(amp * this.p('sustain'), time + attack, Math.max(0.003, this.p('decay', 1) / 3));
    carrier.connect(vca).connect(this.output);
    nodes.push(vca);

    for (const o of oscs) o.start(time);
    return this.register(nodes, carrier, (t) => {
      const r = Math.max(t, time + 0.005);
      releaseParam(vca.gain, r, release / 4);
      const end = r + release * 1.5 + 0.05;
      for (const o of oscs) o.stop(end);
    }, time);
  }
}
