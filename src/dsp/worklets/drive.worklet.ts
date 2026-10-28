// Non-linear saturation running on the audio rendering thread.
import { drivePreGain, shapeSample } from '../shapes';

declare class AudioWorkletProcessor {
  constructor();
}
declare function registerProcessor(name: string, ctor: unknown): void;

class DriveProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
    ];
  }

  // Per-channel state: previous pre-gained input (for interpolation) and DC-blocker memory.
  private prev: number[] = [];
  private dcX: number[] = [];
  private dcY: number[] = [];

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];
    const pre = drivePreGain(params.drive[0]);
    const mode = Math.round(params.mode[0]);

    for (let ch = 0; ch < output.length; ch++) {
      const out = output[ch];
      const inp = input && input.length ? input[Math.min(ch, input.length - 1)] : undefined;
      if (!inp) {
        out.fill(0);
        continue;
      }
      let prev = this.prev[ch] ?? 0;
      let dcX = this.dcX[ch] ?? 0;
      let dcY = this.dcY[ch] ?? 0;
      for (let i = 0; i < out.length; i++) {
        const x = inp[i] * pre;
        // 2x oversampling: shape the interpolated midpoint and the sample, then average (cheap anti-aliasing).
        const y = 0.5 * (shapeSample((prev + x) * 0.5, mode) + shapeSample(x, mode));
        prev = x;
        // DC blocker: asymmetric curves (tube mode) introduce an offset.
        const yy = y - dcX + 0.995 * dcY;
        dcX = y;
        dcY = yy;
        out[i] = yy;
      }
      this.prev[ch] = prev;
      this.dcX[ch] = dcX;
      this.dcY[ch] = dcY;
    }
    return true;
  }
}

registerProcessor('ob-drive', DriveProcessor);
