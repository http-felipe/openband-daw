import { renderModal } from './render';
import { RenderedInstrument } from './rendered';

/** Pianos and tuned percussion from decaying modes, with an optional vibraphone-style tremolo. */
export class PianoAndMallets extends RenderedInstrument {
  protected renderParams = ['model', 'brightness', 'decay', 'hardness'];
  private trem: GainNode;
  private tremLfo: { osc: OscillatorNode; depth: GainNode };

  constructor(ctx: BaseAudioContext) {
    super(ctx);
    this.trem = ctx.createGain();
    this.trem.connect(this.output);
    this.tremLfo = this.lfo(5.5);
    this.tremLfo.depth.connect(this.trem.gain);
    this.bus = this.trem;
  }

  setParams(params: Record<string, number>): void {
    super.setParams(params);
    const depth = this.p('tremolo') * 0.45;
    this.trem.gain.value = 1 - depth;
    this.tremLfo.depth.gain.value = depth;
  }

  dispose(): void {
    this.tremLfo.osc.stop();
    super.dispose();
  }

  protected render(freq: number, velocity: number, sr: number): Float32Array {
    return renderModal(
      { model: Math.round(this.p('model')), brightness: this.p('brightness', 0.6), decay: this.p('decay', 1), hardness: this.p('hardness', 0.4) },
      freq,
      velocity,
      sr,
    );
  }
}
