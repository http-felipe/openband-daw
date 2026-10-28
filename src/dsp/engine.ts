import { dbToGain, type AutomationParam, type Project, type Track } from '../core/project';
import type { ScheduleTarget } from '../core/scheduler';
import { createInstrument, type Instrument } from '../synth';
import { FxChain } from './fx/chain';
import type { FxHost } from './fx/modules';
import driveWorkletUrl from './worklets/drive.worklet.ts?worker&url';
import recorderWorkletUrl from './worklets/recorder.worklet.ts?worker&url';

const smooth = (param: AudioParam, value: number, now: number) => param.setTargetAtTime(value, now, 0.012);

export interface InputSettings {
  deviceId: string;
  channel: number;
}

export interface CaptureChunk {
  /** Audio-clock frame (ctx.currentTime × sampleRate) of `data[0]`. */
  frame: number;
  data: Float32Array;
}

export interface InputDevice {
  id: string;
  label: string;
}

/** Audio inputs the system exposes. Labels are only filled in once microphone permission was granted. */
export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Input device ${i + 1}` }));
}

/** Peak level (linear) of an analyser tap. */
function peakOf(analyser: AnalyserNode, buf: Float32Array): number {
  analyser.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Channel strip: source → inserts → fader → pan → mute/solo → master bus (metered post-fader). */
export class TrackStrip {
  readonly input: GainNode;
  readonly fx: FxChain;
  readonly fader: GainNode;
  readonly panner: StereoPannerNode;
  readonly gate: GainNode;
  readonly meter: AnalyserNode;
  instrument: Instrument | null = null;
  /** While playing, automated params are driven by the scheduler instead of the static fader/pan. */
  automating: Record<AutomationParam, boolean> = { volume: false, pan: false };
  private instrumentType: string | null = null;
  private fresh = true;
  private liveInput: AudioNode | null = null;
  private meterBuf: Float32Array;

  constructor(private readonly engine: AudioEngine) {
    const ctx = engine.ctx;
    this.input = ctx.createGain();
    this.fx = new FxChain(engine);
    this.fader = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.gate = ctx.createGain();
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.meterBuf = new Float32Array(this.meter.fftSize);
    this.input.connect(this.fx.input);
    // A StereoPanner attenuates mono input by 3 dB at centre but passes stereo through at unity, so a stereo
    // effect (chorus, reverb) would jump in level. Up-mix everything to stereo first, at the mono level.
    const stereo = ctx.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    stereo.channelInterpretation = 'speakers';
    stereo.gain.value = Math.SQRT1_2;
    this.fx.output.connect(this.fader).connect(stereo).connect(this.panner).connect(this.gate).connect(engine.masterIn);
    this.gate.connect(this.meter);
  }

  update(t: Track, anySolo: boolean): void {
    const now = this.engine.ctx.currentTime;
    if (t.kind === 'midi' && t.instrument) {
      let inst = this.instrument;
      if (!inst || this.instrumentType !== t.instrument.type) {
        inst?.dispose();
        inst = createInstrument(t.instrument.type, this.engine.ctx);
        inst.output.connect(this.input);
        this.instrument = inst;
        this.instrumentType = t.instrument.type;
      }
      inst.setParams(t.instrument.params);
      if (inst.prepare) {
        const notes: [number, number][] = [];
        for (const c of t.clips) if (c.kind === 'midi') for (const n of c.notes) notes.push([n.pitch, n.velocity]);
        inst.prepare(notes);
      }
    } else if (this.instrument) {
      this.instrument.dispose();
      this.instrument = null;
      this.instrumentType = null;
    }
    this.fx.sync(t.fx);
    // The first update jumps straight to the mix settings; later ones glide to avoid zipper noise.
    const set = this.fresh ? (p: AudioParam, v: number) => p.setValueAtTime(v, now) : (p: AudioParam, v: number) => smooth(p, v, now);
    this.fresh = false;
    if (!(this.automating.volume && t.automation.volume.length)) set(this.fader.gain, dbToGain(t.volume));
    if (!(this.automating.pan && t.automation.pan.length)) set(this.panner.pan, t.pan);
    set(this.gate.gain, !t.mute && (!anySolo || t.solo) ? 1 : 0);
  }

  setLiveInput(node: AudioNode | null): void {
    if (node === this.liveInput) return;
    this.liveInput?.disconnect(this.input);
    this.liveInput = node;
    node?.connect(this.input);
  }

  level(): number {
    return peakOf(this.meter, this.meterBuf);
  }

  dispose(): void {
    this.setLiveInput(null);
    this.instrument?.dispose();
    this.fx.dispose();
    this.gate.disconnect();
    this.input.disconnect();
  }
}

/**
 * Owns the audio graph for one (realtime or offline) context and implements the scheduler's target interface.
 * The project is the single source of truth; `sync()` reconciles the graph with it.
 */
export class AudioEngine implements FxHost, ScheduleTarget {
  bpm = 120;
  workletReady = false;
  readonly masterIn: GainNode;
  readonly masterFx: FxChain;
  readonly masterVol: GainNode;
  readonly masterMeter: AnalyserNode;
  readonly strips = new Map<string, TrackStrip>();
  readonly buffers = new Map<string, AudioBuffer>();
  /** Selected interface and (0-based) channel. Empty deviceId = system default input. */
  input: InputSettings = { deviceId: '', channel: 0 };
  /** Channels the open input device actually delivers (0 while closed). */
  inputChannels = 0;
  private inputStream: MediaStream | null = null;
  private inputSrc: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private channelMeters: AnalyserNode[] = [];
  /** Mono bus carrying only the selected channel: feeds monitoring and recording. */
  private readonly inputBus: GainNode;
  private recorder: AudioWorkletNode | null = null;
  private onCapture: ((chunk: CaptureChunk) => void) | null = null;
  private captureDone: (() => void) | null = null;
  private inputTap: AnalyserNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private lastProject: Project | null = null;
  private masterBuf = new Float32Array(512);

  static async create(ctx: BaseAudioContext = new AudioContext({ latencyHint: 'interactive' })): Promise<AudioEngine> {
    const engine = new AudioEngine(ctx);
    try {
      await ctx.audioWorklet.addModule(driveWorkletUrl);
      await ctx.audioWorklet.addModule(recorderWorkletUrl);
      engine.workletReady = true;
    } catch (err) {
      console.warn('[OpenBand] AudioWorklet unavailable, using WaveShaper fallback', err);
    }
    return engine;
  }

  private constructor(readonly ctx: BaseAudioContext) {
    this.masterIn = ctx.createGain();
    this.masterFx = new FxChain(this);
    this.masterVol = ctx.createGain();
    this.masterMeter = ctx.createAnalyser();
    this.masterMeter.fftSize = 512;
    this.inputBus = ctx.createGain();
    this.masterIn.connect(this.masterFx.input);
    // Safety limiter: a fast, high-ratio compressor just below 0 dBFS so the output never clips digitally.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    this.masterFx.output.connect(this.masterVol).connect(limiter).connect(ctx.destination);
    this.masterVol.connect(this.masterMeter); // metered before the limiter so overs still show red
  }

  get realtime(): boolean {
    return typeof AudioContext !== 'undefined' && this.ctx instanceof AudioContext;
  }

  get inputEnabled(): boolean {
    return this.inputStream !== null;
  }

  /** Output latency: what you hear lags `currentTime` by this much. Used to align recorded notes. */
  get outputLatency(): number {
    const c = this.ctx as AudioContext;
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }

  /** Delay between a sound reaching the interface and its samples reaching the graph, as reported by the browser. */
  get inputLatency(): number {
    const settings = this.inputStream?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    return settings?.latency ?? 0;
  }

  async resume(): Promise<void> {
    if (this.realtime && this.ctx.state !== 'running') await (this.ctx as AudioContext).resume();
  }

  sync(p: Project): void {
    this.lastProject = p;
    if (this.bpm !== p.bpm) {
      this.bpm = p.bpm;
      for (const s of this.strips.values()) s.fx.onTempo();
      this.masterFx.onTempo();
    }
    const ids = new Set(p.tracks.map((t) => t.id));
    for (const [id, s] of this.strips) {
      if (!ids.has(id)) {
        s.dispose();
        this.strips.delete(id);
      }
    }
    const anySolo = p.tracks.some((t) => t.solo);
    for (const t of p.tracks) {
      let s = this.strips.get(t.id);
      if (!s) {
        s = new TrackStrip(this);
        this.strips.set(t.id, s);
      }
      s.update(t, anySolo);
      s.setLiveInput(t.kind === 'audio' && t.monitor && this.inputStream ? this.inputBus : null);
    }
    this.masterFx.sync(p.master.fx);
    smooth(this.masterVol.gain, dbToGain(p.master.volume), this.ctx.currentTime);
  }

  /**
   * Opens (or re-targets) the audio input. Changing the device reopens it; changing only the channel
   * re-routes the splitter without asking for permission again. Browser voice processing is disabled.
   */
  async enableInput(settings: Partial<InputSettings> = {}): Promise<void> {
    if (!this.realtime) throw new Error('Audio input needs a realtime context');
    const next: InputSettings = { ...this.input, ...settings };
    if (!this.inputStream || next.deviceId !== this.input.deviceId) await this.openDevice(next);
    this.input = next;
    this.routeChannel();
    if (this.lastProject) this.sync(this.lastProject);
  }

  /** Peak level of every channel the input device delivers (for picking the right one). */
  inputLevels(): number[] {
    const buf = this.masterBuf;
    return this.channelMeters.map((a) => peakOf(a, buf));
  }

  /**
   * Copies the latest samples of the selected input channel into `out` (up to 4096, ~93 ms at 44.1 kHz)
   * for the tuner. Returns false while the input is closed.
   */
  readInput(out: Float32Array): boolean {
    if (!this.inputStream) return false;
    if (!this.inputTap) {
      this.inputTap = this.ctx.createAnalyser();
      this.inputTap.fftSize = 4096;
      this.inputBus.connect(this.inputTap);
    }
    this.inputTap.getFloatTimeDomainData(out);
    return true;
  }

  /**
   * Starts streaming the dry, selected-channel input (effects are applied on playback) as raw PCM.
   * Each chunk carries the audio-clock frame of its first sample, so takes can be placed exactly.
   */
  startCapture(onChunk: (chunk: CaptureChunk) => void): void {
    if (!this.inputStream) throw new Error('Audio input is not enabled');
    if (!this.workletReady) throw new Error('Recording needs AudioWorklet support');
    if (!this.recorder) {
      const node = new AudioWorkletNode(this.ctx, 'ob-recorder', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
      const silent = this.ctx.createGain();
      silent.gain.value = 0;
      this.inputBus.connect(node);
      node.connect(silent).connect(this.ctx.destination); // keeps the node pulled by the graph
      node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array } | { done: true }>) => {
        if ('done' in e.data) {
          this.captureDone?.();
          this.captureDone = null;
        } else this.onCapture?.(e.data);
      };
      this.recorder = node;
    }
    this.onCapture = onChunk;
    this.recorder.port.postMessage('start');
  }

  /** Stops capturing; resolves once the last chunk has been delivered. */
  stopCapture(): Promise<void> {
    const node = this.recorder;
    if (!node || !this.onCapture) return Promise.resolve();
    return new Promise((resolve) => {
      this.captureDone = () => {
        this.onCapture = null;
        resolve();
      };
      node.port.postMessage('stop');
    });
  }

  private async openDevice(settings: InputSettings): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
        channelCount: { ideal: Math.max(2, settings.channel + 1) },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.closeInput();
    const ctx = this.ctx as AudioContext;
    const channels = Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 2);
    this.inputStream = stream;
    this.inputSrc = ctx.createMediaStreamSource(stream);
    this.splitter = ctx.createChannelSplitter(channels);
    this.inputSrc.connect(this.splitter);
    this.channelMeters = Array.from({ length: channels }, () => {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      return a;
    });
    this.inputChannels = channels;
  }

  private routeChannel(): void {
    const split = this.splitter;
    if (!split) return;
    split.disconnect();
    this.channelMeters.forEach((a, i) => split.connect(a, i));
    split.connect(this.inputBus, Math.min(this.input.channel, this.inputChannels - 1));
  }

  private closeInput(): void {
    this.inputStream?.getTracks().forEach((t) => t.stop());
    this.inputSrc?.disconnect();
    this.splitter?.disconnect();
    this.inputStream = null;
    this.inputSrc = null;
    this.splitter = null;
    this.channelMeters = [];
    this.inputChannels = 0;
  }

  masterLevel(): number {
    return peakOf(this.masterMeter, this.masterBuf);
  }

  // ---------- ScheduleTarget ----------

  noteOn(trackId: string, pitch: number, velocity: number, time: number, duration: number): void {
    const inst = this.strips.get(trackId)?.instrument;
    if (!inst) return;
    inst.noteOn(pitch, velocity, time).release(time + duration);
  }

  playAudio(trackId: string, audioId: string, time: number, offset: number, duration: number): void {
    const buf = this.buffers.get(audioId);
    const strip = this.strips.get(trackId);
    if (!buf || !strip || offset >= buf.duration || duration <= 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(strip.input);
    src.start(Math.max(time, this.ctx.currentTime), offset, Math.min(duration, buf.duration - offset));
    this.sources.add(src);
    src.onended = () => {
      src.disconnect();
      this.sources.delete(src);
    };
  }

  automate(trackId: string, param: AutomationParam, value: number, time: number, jump: boolean): void {
    const strip = this.strips.get(trackId);
    if (!strip) return;
    const target = param === 'volume' ? strip.fader.gain : strip.panner.pan;
    const v = param === 'volume' ? dbToGain(value) : value;
    if (jump) {
      target.cancelScheduledValues(time);
      target.setValueAtTime(v, time);
    } else {
      target.linearRampToValueAtTime(v, time);
    }
  }

  click(time: number, accent: boolean): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.45 : 0.28, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    o.connect(g).connect(this.ctx.destination);
    o.start(time);
    o.stop(time + 0.08);
    o.onended = () => g.disconnect();
  }

  // ---------- transport hooks ----------

  beginAutomation(p: Project): void {
    for (const t of p.tracks) {
      const s = this.strips.get(t.id);
      if (s) s.automating = { volume: t.automation.volume.length > 0, pan: t.automation.pan.length > 0 };
    }
  }

  stopAll(): void {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    for (const s of this.strips.values()) {
      s.instrument?.allNotesOff();
      if (s.automating.volume) s.fader.gain.cancelScheduledValues(0);
      if (s.automating.pan) s.panner.pan.cancelScheduledValues(0);
      s.automating = { volume: false, pan: false };
    }
    if (this.lastProject) this.sync(this.lastProject);
  }
}
