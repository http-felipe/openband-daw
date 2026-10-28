// Transfer curves shared by the drive AudioWorklet and its WaveShaper fallback.

export const DRIVE_MODES = ['Soft', 'Hard', 'Tube', 'Fuzz'];

const TUBE_BIAS = 0.3;
const TUBE_OFFSET = Math.tanh(TUBE_BIAS);

export function shapeSample(x: number, mode: number): number {
  switch (mode) {
    case 1: // hard clip
      return x > 1 ? 1 : x < -1 ? -1 : x;
    case 2: // biased tanh: asymmetric, adds even harmonics like a single-ended tube stage
      return Math.tanh(x + TUBE_BIAS) - TUBE_OFFSET;
    case 3: // fuzz: very steep exponential knee, almost square at high drive
      return Math.sign(x) * (1 - Math.exp(-3 * Math.abs(x)));
    default: // soft clip
      return Math.tanh(x);
  }
}

/** Maps the 0..1 "drive" control to a linear pre-gain (0 dB … +48 dB). */
export const drivePreGain = (drive: number) => Math.pow(10, drive * 2.4);
