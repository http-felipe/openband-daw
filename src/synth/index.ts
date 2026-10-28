import type { InstrumentType } from '../core/project';
import { DrumMachine } from './drums';
import { FmSynth } from './fm';
import type { Instrument } from './instrument';
import { PianoAndMallets } from './modal';
import { TonewheelOrgan } from './organ';
import { PluckedStrings } from './pluck';
import { SubtractiveSynth } from './subtractive';

export type { Instrument, VoiceHandle } from './instrument';

export function createInstrument(type: InstrumentType, ctx: BaseAudioContext): Instrument {
  switch (type) {
    case 'fm':
      return new FmSynth(ctx);
    case 'drums':
      return new DrumMachine(ctx);
    case 'pluck':
      return new PluckedStrings(ctx);
    case 'organ':
      return new TonewheelOrgan(ctx);
    case 'modal':
      return new PianoAndMallets(ctx);
    default:
      return new SubtractiveSynth(ctx);
  }
}
