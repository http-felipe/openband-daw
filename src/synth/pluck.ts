import { renderPluck } from './render';
import { RenderedInstrument } from './rendered';

/** Plucked strings (Karplus–Strong) through a simple two-resonance body. */
export class PluckedStrings extends RenderedInstrument {
  protected renderParams = ['brightness', 'decay', 'damping', 'pick'];
  private lowBody: BiquadFilterNode;
  private midBody: BiquadFilterNode;

  constructor(ctx: BaseAudioContext) {
    super(ctx);
    this.lowBody = ctx.createBiquadFilter();
    this.lowBody.type = 'peaking';
    this.lowBody.frequency.value = 110;
    this.lowBody.Q.value = 1.2;
    this.midBody = ctx.createBiquadFilter();
    this.midBody.type = 'peaking';
    this.midBody.frequency.value = 240;
    this.midBody.Q.value = 1.4;
    this.lowBody.connect(this.midBody).connect(this.output);
    this.bus = this.lowBody;
  }

  setParams(params: Record<string, number>): void {
    super.setParams(params);
    const body = this.p('body', 0.5);
    this.lowBody.gain.value = body * 7;
    this.midBody.gain.value = body * 4;
  }

  protected render(freq: number, velocity: number, sr: number): Float32Array {
    return renderPluck(
      { brightness: this.p('brightness', 0.6), decay: this.p('decay', 3), damping: this.p('damping', 0.4), pick: this.p('pick', 0.2) },
      freq,
      velocity,
      sr,
    );
  }
}
