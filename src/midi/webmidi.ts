export type MidiEvent =
  | { type: 'on'; note: number; velocity: number; channel: number }
  | { type: 'off'; note: number; channel: number }
  | { type: 'cc'; controller: number; value: number; channel: number }
  | { type: 'bend'; value: number; channel: number };

/** Decodes a raw MIDI 1.0 channel message. Running status and SysEx are not used by the app. */
export function parseMidiMessage(data: ArrayLike<number>): MidiEvent | null {
  if (data.length < 2) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const d1 = data[1] & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;
  switch (status) {
    case 0x90:
      return d2 > 0 ? { type: 'on', note: d1, velocity: d2, channel } : { type: 'off', note: d1, channel };
    case 0x80:
      return { type: 'off', note: d1, channel };
    case 0xb0:
      return { type: 'cc', controller: d1, value: d2, channel };
    case 0xe0:
      return { type: 'bend', value: ((d2 << 7) | d1) / 8192 - 1, channel };
    default:
      return null;
  }
}

/** Listens to every connected MIDI input (USB keyboards, pads) and tracks hot-plugging. */
export class MidiInputManager {
  readonly supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  private started = false;

  async init(onEvent: (e: MidiEvent) => void, onDevices: (names: string[]) => void): Promise<void> {
    if (!this.supported || this.started) return;
    this.started = true;
    const access = await navigator.requestMIDIAccess();
    const bind = () => {
      const names: string[] = [];
      access.inputs.forEach((input) => {
        input.onmidimessage = (msg) => {
          const ev = msg.data ? parseMidiMessage(msg.data) : null;
          if (ev) onEvent(ev);
        };
        names.push(input.name ?? 'MIDI input');
      });
      onDevices(names);
    };
    bind();
    access.onstatechange = bind;
  }
}
