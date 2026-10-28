// Captures the (mono) input bus as raw PCM on the audio thread and streams it to the main thread in
// small chunks, each stamped with the audio-clock frame of its first sample.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: unknown): void;
declare const currentFrame: number;

const CHUNK = 2048; // ~46 ms at 44.1 kHz: frequent enough for a live waveform

class RecorderProcessor extends AudioWorkletProcessor {
  private recording = false;
  private chunk = new Float32Array(CHUNK);
  private fill = 0;
  private chunkStart = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'start') {
        this.recording = true;
        this.fill = 0;
      } else if (e.data === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.recording) return true;
    const ch = inputs[0]?.[0];
    const n = ch ? ch.length : 128;
    for (let i = 0; i < n; i++) {
      if (this.fill === 0) this.chunkStart = currentFrame + i;
      this.chunk[this.fill++] = ch ? ch[i] : 0;
      if (this.fill === CHUNK) this.flush();
    }
    return true;
  }

  private flush(): void {
    if (!this.fill) return;
    const data = this.chunk.slice(0, this.fill);
    this.port.postMessage({ frame: this.chunkStart, data }, [data.buffer]);
    this.fill = 0;
  }
}

registerProcessor('ob-recorder', RecorderProcessor);
