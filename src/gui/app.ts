import { createDemoProject } from '../core/demo';
import {
  beatsPerBar,
  clamp,
  createEmptyProject,
  createFxChain,
  createMidiClip,
  createTrack,
  colorFor,
  parseProject,
  nextSplitName,
  serializeProject,
  splitClip,
  uid,
  type AudioClip,
  type Clip,
  type FxSlot,
  type InstrumentType,
  type MidiClip,
  type Note,
  type Project,
  type TrackKind,
} from '../core/project';
import { Store, type BottomTab, type ChangeReason } from '../core/store';
import { Transport } from '../core/transport';
import { encodeWav, fromBase64, toBase64 } from '../core/wav';
import { AudioEngine, listInputDevices, type InputDevice, type InputSettings } from '../dsp/engine';
import { AMP_PRESETS } from '../dsp/fx/defs';
import { renderProject } from '../dsp/render';
import { MidiInputManager, type MidiEvent } from '../midi/webmidi';
import type { VoiceHandle } from '../synth';
import { INSTRUMENT_CATALOG, INSTRUMENT_DEFS } from '../synth/defs';
import { download, h } from './dom';
import { showContextMenu, type MenuHeader, type MenuItem } from './menu';
import { FxRack } from './fx-rack';
import { InstrumentPanel } from './instrument-panel';
import { KeyboardView } from './keyboard';
import { PianoRoll } from './pianoroll';
import { Timeline } from './timeline';
import { Toolbar } from './toolbar';
import { TrackList } from './tracklist';
import { Tuner } from './tuner';

const AUTOSAVE_KEY = 'openband.autosave.v1';
const AUTOSAVE_LIMIT = 4_000_000; // characters; localStorage is ~5 MB per origin
/** Input device/channel is a property of this machine, not of the project, so it lives outside the project file. */
const INPUT_KEY = 'openband.input.v1';

function loadInputSettings(): InputSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(INPUT_KEY) ?? 'null') as Partial<InputSettings> | null;
    return {
      deviceId: typeof raw?.deviceId === 'string' ? raw.deviceId : '',
      channel: typeof raw?.channel === 'number' && raw.channel >= 0 ? Math.floor(raw.channel) : 0,
    };
  } catch {
    return { deviceId: '', channel: 0 };
  }
}

function saveInputSettings(s: InputSettings): void {
  try {
    localStorage.setItem(INPUT_KEY, JSON.stringify(s));
  } catch {
    /* best effort */
  }
}

/** Count-in length (bars) is a personal preference, not part of the project. */
const COUNT_IN_KEY = 'openband.countin.v1';
/** Waveform resolution used for drawing audio clips. */
const PEAKS_PER_SECOND = 200;

interface AudioTake {
  trackIds: string[];
  /** Beat where the clip starts; audio captured during the count-in stays hidden behind the clip offset. */
  recordStart: number;
  /** Musical position of the first captured sample (latency-compensated); null until the first chunk. */
  firstBeat: number | null;
  sampleRate: number;
  chunks: Float32Array[];
  frames: number;
  /** Live waveform peaks, built incrementally as chunks arrive. */
  peaks: number[];
  peakHop: number;
  peakMax: number;
  peakFill: number;
}

/** A recorded MIDI note still held down: written into each take clip at once and stretched until release. */
interface PendingNote {
  beat: number;
  notes: { clip: MidiClip; note: Note }[];
}

function loadCountIn(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_IN_KEY) ?? 1);
    return [0, 1, 2].includes(n) ? n : 1;
  } catch {
    return 1;
  }
}

function loadAutosave(): Project | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? parseProject(json) : null;
  } catch {
    return null;
  }
}

/** Composition root: owns the store, engine and transport, wires views together and handles input/recording/files. */
export class App {
  static async boot(root: HTMLElement): Promise<App> {
    const engine = await AudioEngine.create();
    const app = new App(root, engine, loadAutosave() ?? createDemoProject());
    await app.restoreAudio(app.store.project);
    app.timeline.dirty = true;
    return app;
  }

  readonly store: Store;
  readonly transport: Transport;
  readonly toolbar: Toolbar;
  readonly tracklist: TrackList;
  readonly timeline: Timeline;
  readonly roll: PianoRoll;
  readonly keyboard: KeyboardView;
  readonly tuner: Tuner;
  focusArea: 'arrange' | 'roll' = 'arrange';
  inputDevices: InputDevice[] = [];

  private readonly instrumentPanel: InstrumentPanel;
  private readonly fxRack: FxRack;
  private readonly midi = new MidiInputManager();
  private readonly tabs: Record<BottomTab, { button: HTMLButtonElement; panel: HTMLElement }>;
  private readonly toastEl: HTMLElement;
  private readonly selectionLabel: HTMLElement;
  private readonly peakCache = new Map<string, { data: Float32Array; rate: number }>();
  private live = new Map<number, VoiceHandle[]>();
  private sustain = false;
  private sustained = new Set<number>();
  private recPending = new Map<number, PendingNote>();
  private takes = new Map<string, MidiClip>();
  private recordLoop = false;
  private audioTake: AudioTake | null = null;
  /** Bars of metronome before recording starts from a stopped transport (0 = off). */
  countInBars = loadCountIn();
  private autosaveTimer = 0;
  private toastTimer = 0;

  private constructor(
    root: HTMLElement,
    readonly engine: AudioEngine,
    project: Project,
  ) {
    this.store = new Store(project);
    engine.input = loadInputSettings();
    this.transport = new Transport(engine, () => this.store.project, (wasRecording) => {
      if (wasRecording) void this.finishRecording();
      this.store.emit('transport');
    });

    // ----- layout -----
    root.innerHTML = '';
    const toolbarEl = h('header', { class: 'toolbar' });
    const ruler = h('canvas', { class: 'ruler' });
    const lanes = h('canvas', { class: 'lanes' });
    const trackListEl = h('div', { class: 'tracklist' });
    const body = h('div', { class: 'arrange-body' }, trackListEl, h('div', { class: 'lanes-wrap' }, lanes));
    const addBtn = (label: string, title: string, fn: () => void) => h('button', { class: 'chip', title, onclick: fn }, label);
    const corner = h(
      'div',
      { class: 'arrange-corner' },
      addBtn('+ Instrument ▾', 'New instrument track: choose a sound', () => this.showInstrumentMenu(corner)),
      addBtn('+ Drums', 'New drum machine track', () => this.addTrack('midi', 'drums', undefined, 'Drums')),
      addBtn('+ Audio', 'New audio/guitar track with amp chain', () => this.addTrack('audio')),
    );
    const arrange = h('main', { class: 'arrange' }, h('div', { class: 'arrange-head' }, corner, h('div', { class: 'ruler-wrap' }, ruler)), body);

    this.roll = new PianoRoll(this);
    this.instrumentPanel = new InstrumentPanel(this);
    this.fxRack = new FxRack(this);
    const tab = (id: BottomTab, label: string, panel: HTMLElement) => ({
      button: h('button', { class: 'tab', onclick: () => this.setTab(id) }, label),
      panel: h('div', { class: 'panel' }, panel),
    });
    this.tabs = { editor: tab('editor', 'Piano Roll', this.roll.el), instrument: tab('instrument', 'Instrument', this.instrumentPanel.el), fx: tab('fx', 'Effects', this.fxRack.el) };
    this.selectionLabel = h('span', { class: 'tab-info' });
    const resizer = h('div', { class: 'resizer', title: 'Drag to resize' });
    const bottom = h(
      'section',
      { class: 'bottom' },
      resizer,
      h('nav', { class: 'tabs' }, ...Object.values(this.tabs).map((t) => t.button), this.selectionLabel),
      ...Object.values(this.tabs).map((t) => t.panel),
    );
    this.keyboard = new KeyboardView(this);
    this.toastEl = h('div', { class: 'toast', role: 'status' });
    this.tuner = new Tuner(this);
    root.append(toolbarEl, arrange, bottom, h('footer', { class: 'keys' }, this.keyboard.el), this.tuner.el, this.toastEl);

    this.toolbar = new Toolbar(this, toolbarEl);
    this.tracklist = new TrackList(this, trackListEl);
    this.timeline = new Timeline(this, ruler, lanes, body);
    this.setupResizer(resizer, root);

    // ----- wiring -----
    this.store.on((r) => this.onChange(r));
    engine.sync(project);
    this.tracklist.render();
    this.setTab(this.store.ui.bottomTab);
    this.renderPanels();

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.refreshInputDevices());
    void this.refreshInputDevices();
    const unlock = () => {
      void engine.resume();
      this.connectMidi();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    const frame = () => {
      const playing = this.transport.playing;
      if (playing || this.timeline.dirty) this.timeline.draw();
      if (playing || this.roll.dirty) this.roll.draw();
      this.tracklist.tick();
      this.toolbar.tick();
      if (this.store.ui.bottomTab === 'instrument') this.instrumentPanel.tick();
      if (this.tuner.isOpen) this.tuner.tick();
      if (this.transport.recording) this.growTakes();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- change propagation ----------

  private onChange(reason: ChangeReason): void {
    const projectChanged = reason === 'project' || reason === 'structure' || reason === 'params';
    if (projectChanged) {
      this.engine.sync(this.store.project);
      this.scheduleAutosave();
    }
    if (reason === 'project' || reason === 'structure') {
      this.tracklist.render();
      this.timeline.resize();
    } else this.tracklist.refresh();
    if (reason === 'project' || reason === 'structure' || reason === 'selection') this.renderPanels();
    else if (reason === 'params') this.roll.layout();
    this.toolbar.refresh();
    this.timeline.dirty = true;
    this.roll.dirty = true;
  }

  private renderPanels(): void {
    this.instrumentPanel.render();
    this.fxRack.render();
    this.roll.render();
    const { track, clip } = this.store.selection();
    this.selectionLabel.textContent = track ? `${track.name}${clip ? ` · ${clip.name}` : ''}` : '';
  }

  setTab(tab: BottomTab): void {
    this.store.ui.bottomTab = tab;
    for (const [id, t] of Object.entries(this.tabs)) {
      t.button.classList.toggle('on', id === tab);
      t.panel.hidden = id !== tab;
    }
    if (tab === 'editor') this.roll.layout();
  }

  private setupResizer(handle: HTMLElement, root: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const start = parseFloat(getComputedStyle(root).getPropertyValue('--bottom-h')) || 300;
      const move = (ev: PointerEvent) => root.style.setProperty('--bottom-h', `${clamp(start - (ev.clientY - startY), 160, window.innerHeight * 0.7)}px`);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2800);
  }

  snapBeats(): number {
    switch (this.store.ui.snap) {
      case 'bar':
        return beatsPerBar(this.store.project);
      case '1/4':
        return 1;
      case '1/8':
        return 0.5;
      case '1/16':
        return 0.25;
      case '1/32':
        return 0.125;
      default:
        return 0;
    }
  }

  /** Max-abs peaks at 200 points per second, cached per audio asset (for waveform drawing). */
  peaksFor(audioId: string): { data: Float32Array; rate: number } | null {
    const hit = this.peakCache.get(audioId);
    if (hit) return hit;
    const buf = this.engine.buffers.get(audioId);
    if (!buf) return null;
    const hop = Math.max(1, Math.floor(buf.sampleRate / PEAKS_PER_SECOND));
    const src = buf.getChannelData(0);
    const data = new Float32Array(Math.ceil(src.length / hop));
    for (let i = 0; i < data.length; i++) {
      let m = 0;
      for (let j = i * hop, end = Math.min(src.length, j + hop); j < end; j++) m = Math.max(m, Math.abs(src[j]));
      data[i] = m;
    }
    const peaks = { data, rate: buf.sampleRate / hop };
    this.peakCache.set(audioId, peaks);
    return peaks;
  }

  // ---------- tracks & selection ----------

  /** Grouped catalogue of ready-made sounds; picking one creates a track with that engine and preset. */
  private showInstrumentMenu(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const items: (MenuItem | MenuHeader)[] = [];
    let group = '';
    for (const entry of INSTRUMENT_CATALOG) {
      if (entry.group !== group) items.push({ header: (group = entry.group) });
      items.push({ label: entry.name, action: () => this.addTrack('midi', entry.type, entry.preset, entry.name) });
    }
    showContextMenu(r.left + 6, r.bottom + 2, items);
  }

  addTrack(kind: TrackKind, instrument?: InstrumentType, preset?: string, name?: string): void {
    const p = this.store.project;
    const track = createTrack(kind, {
      instrument,
      preset,
      name: name ?? (kind === 'audio' ? 'Guitar' : INSTRUMENT_DEFS[instrument ?? 'subtractive'].label),
      color: colorFor(p.tracks.length),
    });
    if (kind === 'audio') track.fx = createFxChain(AMP_PRESETS['Clean Combo']);
    else track.clips.push(createMidiClip(0, beatsPerBar(p) * 4, track.name));
    this.store.mutate(() => p.tracks.push(track));
    this.timeline.revealTrack(p.tracks.length - 1);
    this.selectTrack(track.id);
    if (kind === 'midi') this.selectClip(track.id, track.clips[0].id);
  }

  removeTrack(id: string): void {
    const t = this.store.track(id);
    if (!t) return;
    if (t.clips.length && !confirm(`Delete track "${t.name}" and its ${t.clips.length} clip(s)?`)) return;
    this.store.mutate((p) => p.tracks.splice(p.tracks.indexOf(t), 1));
    if (this.store.ui.selectedTrackId === id) this.selectTrack(this.store.project.tracks[0]?.id ?? null);
  }

  selectTrack(id: string | null): void {
    const ui = this.store.ui;
    if (ui.selectedTrackId === id) return;
    ui.selectedTrackId = id;
    ui.selectedClipId = null;
    if (id) ui.fxTarget = 'track';
    this.store.emit('selection');
  }

  selectClip(trackId: string, clipId: string | null): void {
    const ui = this.store.ui;
    if (ui.selectedTrackId === trackId && ui.selectedClipId === clipId) return;
    ui.selectedTrackId = trackId;
    ui.selectedClipId = clipId;
    ui.fxTarget = 'track';
    this.store.emit('selection');
  }

  toggleTrackFlag(id: string, flag: 'mute' | 'solo'): void {
    const t = this.store.track(id);
    if (t) this.store.mutate(() => (t[flag] = !t[flag]), 'params');
  }

  toggleArm(id: string): void {
    const t = this.store.track(id);
    if (!t) return;
    this.store.mutate(() => (t.armed = !t.armed), 'params');
    if (t.armed && t.kind === 'audio') void this.enableInput();
    if (this.store.ui.bottomTab === 'instrument') this.renderPanels();
  }

  async toggleMonitor(id: string): Promise<void> {
    const t = this.store.track(id);
    if (!t) return;
    if (!t.monitor && !(await this.enableInput())) return;
    this.store.mutate(() => (t.monitor = !t.monitor));
  }

  cycleAutomation(id: string): void {
    const auto = this.store.ui.automation;
    auto[id] = auto[id] === undefined ? 'volume' : auto[id] === 'volume' ? 'pan' : undefined;
    this.store.emit('view');
  }

  applyAmpPreset(slots: FxSlot[], name: string): void {
    const chain = AMP_PRESETS[name];
    if (!chain) return;
    this.store.mutate(() => slots.splice(0, slots.length, ...createFxChain(chain)));
    this.toast(`Loaded amp chain “${name}”`);
  }

  /** Opens the input with the saved device/channel (or applies a change to them) and remembers the choice. */
  async enableInput(change: Partial<InputSettings> = {}): Promise<boolean> {
    try {
      await this.engine.resume();
      await this.engine.enableInput(change);
    } catch (err) {
      const e = err as Error;
      const missing = e.name === 'OverconstrainedError' || e.name === 'NotFoundError';
      this.toast(`Audio input unavailable: ${missing ? 'the selected device is not connected' : e.message}`);
      // While closed, keep the requested channel and drop a device that isn't there so a stale choice
      // can't lock the user out. While open, the previous (working) device stays in use.
      if (!this.engine.inputEnabled) {
        this.engine.input = { ...this.engine.input, ...change, ...(missing ? { deviceId: '' } : {}) };
        saveInputSettings(this.engine.input);
      }
      this.renderPanels();
      return false;
    }
    const { input, inputChannels } = this.engine;
    if (input.channel >= inputChannels) {
      this.toast(`This device delivers ${inputChannels} channel(s); using channel ${inputChannels} instead of ${input.channel + 1}.`);
      this.engine.input = { ...input, channel: inputChannels - 1 };
      await this.engine.enableInput();
    }
    saveInputSettings(this.engine.input);
    await this.refreshInputDevices();
    return true;
  }

  /** Re-reads the device list (labels appear once permission is granted) and redraws the input panel. */
  async refreshInputDevices(): Promise<void> {
    try {
      this.inputDevices = await listInputDevices();
    } catch {
      this.inputDevices = [];
    }
    this.renderPanels();
  }

  deleteSelectedClip(): void {
    const { track, clip } = this.store.selection();
    if (!track || !clip) return;
    this.store.mutate(() => track.clips.splice(track.clips.indexOf(clip), 1));
    this.store.ui.selectedClipId = null;
    this.store.emit('selection');
  }

  duplicateSelectedClip(): void {
    const { track, clip } = this.store.selection();
    if (!track || !clip) return;
    const copy = JSON.parse(JSON.stringify(clip)) as MidiClip | AudioClip;
    copy.id = uid('clip');
    copy.start = clip.start + clip.length;
    if (copy.kind === 'midi') copy.notes.forEach((n) => (n.id = uid('n')));
    this.store.mutate(() => track.clips.push(copy));
    this.selectClip(track.id, copy.id);
  }

  // ---------- transport ----------

  togglePlay(): void {
    if (this.transport.playing) this.transport.stop();
    else this.transport.play();
    this.store.emit('transport');
  }

  stop(): void {
    if (this.transport.playing) this.transport.stop();
    else this.goToStart();
    this.store.emit('transport');
  }

  goToStart(): void {
    const p = this.store.project;
    const target = p.loop.enabled && this.transport.position !== p.loop.start ? p.loop.start : 0;
    this.transport.seek(target);
    this.store.ui.scrollX = Math.min(this.store.ui.scrollX, target);
    this.store.emit('transport');
  }

  toggleLoop(): void {
    this.store.mutate((p) => (p.loop.enabled = !p.loop.enabled), 'params');
  }

  toggleMetronome(): void {
    this.transport.metronome = !this.transport.metronome;
    this.store.emit('transport');
  }

  setCountIn(bars: number): void {
    this.countInBars = bars;
    try {
      localStorage.setItem(COUNT_IN_KEY, String(bars));
    } catch {
      /* best effort */
    }
  }

  // ---------- live playing ----------

  private liveTracks(): string[] {
    const tracks = this.store.project.tracks;
    const armed = tracks.filter((t) => t.armed && t.kind === 'midi').map((t) => t.id);
    if (armed.length) return armed;
    const { track } = this.store.selection();
    return track && track.kind === 'midi' ? [track.id] : [];
  }

  noteOn(pitch: number, velocity: number): void {
    void this.engine.resume();
    this.releaseLive(pitch);
    this.sustained.delete(pitch);
    const now = this.engine.ctx.currentTime;
    const voices: VoiceHandle[] = [];
    for (const id of this.liveTracks()) {
      const inst = this.engine.strips.get(id)?.instrument;
      if (inst) voices.push(inst.noteOn(pitch, velocity, now));
    }
    this.live.set(pitch, voices);
    this.keyboard.highlight(pitch, true);
    this.recordNoteOn(pitch, velocity);
  }

  noteOff(pitch: number): void {
    this.keyboard.highlight(pitch, false);
    this.recordNoteOff(pitch);
    if (this.sustain) this.sustained.add(pitch);
    else this.releaseLive(pitch);
  }

  private releaseLive(pitch: number): void {
    const now = this.engine.ctx.currentTime;
    for (const v of this.live.get(pitch) ?? []) v.release(now);
    this.live.delete(pitch);
  }

  private setSustain(on: boolean): void {
    this.sustain = on;
    if (on) return;
    for (const p of this.sustained) this.releaseLive(p);
    this.sustained.clear();
  }

  /** Short audition used by the piano roll. Returns a function that releases the note. */
  previewNote(trackId: string, pitch: number, velocity: number): () => void {
    void this.engine.resume();
    const inst = this.engine.strips.get(trackId)?.instrument;
    if (!inst) return () => {};
    const v = inst.noteOn(pitch, velocity, this.engine.ctx.currentTime);
    return () => v.release(this.engine.ctx.currentTime);
  }

  private connectMidi(): void {
    if (!this.midi.supported) {
      this.keyboard.setMidiStatus(null);
      return;
    }
    this.midi.init((e) => this.onMidi(e), (names) => this.keyboard.setMidiStatus(names)).catch(() => this.keyboard.setMidiStatus(null));
  }

  private onMidi(e: MidiEvent): void {
    if (e.type === 'on') this.noteOn(e.note, e.velocity / 127);
    else if (e.type === 'off') this.noteOff(e.note);
    else if (e.type === 'cc' && e.controller === 64) this.setSustain(e.value >= 64);
  }

  // ---------- recording ----------

  async toggleRecord(): Promise<void> {
    if (this.transport.recording) {
      // Punch out but keep playing: a count-in still in progress stops with the recording.
      this.transport.recording = false;
      this.transport.countInEnd = null;
      await this.finishRecording();
      this.store.emit('transport');
      return;
    }
    const p = this.store.project;
    const armed = p.tracks.filter((t) => t.armed);
    if (!armed.length) {
      this.toast('Arm a track first (R button in its header).');
      return;
    }
    await this.engine.resume();
    const bpb = beatsPerBar(p);
    const wasPlaying = this.transport.playing;
    const from = wasPlaying ? this.transport.currentBeat() : this.transport.position;
    const audioTracks = armed.filter((t) => t.kind === 'audio');
    if (audioTracks.length && !(await this.enableInput())) return;

    this.store.checkpoint();
    this.recordLoop = !audioTracks.length && p.loop.enabled && from >= p.loop.start && from < p.loop.end;
    this.takes.clear();
    for (const t of armed) {
      if (t.kind !== 'midi') continue;
      let clip: MidiClip | undefined;
      if (this.recordLoop) {
        const len = p.loop.end - p.loop.start;
        clip = t.clips.find((c): c is MidiClip => c.kind === 'midi' && c.start === p.loop.start && c.length === len);
        if (!clip) t.clips.push((clip = createMidiClip(p.loop.start, len, `${t.name} take`)));
      } else {
        t.clips.push((clip = createMidiClip(Math.floor(from / bpb) * bpb, bpb, `${t.name} take`)));
      }
      this.takes.set(t.id, clip);
    }
    if (audioTracks.length) this.transport.ignoreLoop = true;
    this.transport.recording = true;
    if (!wasPlaying) {
      // Count-in: start early with the metronome forced on; recording begins at `from`.
      const preRoll = this.countInBars * bpb;
      this.transport.countInEnd = preRoll ? from : null;
      this.transport.play(from - preRoll);
    }
    // Capture starts only once the transport has its timing markers, so chunks map onto beats.
    if (audioTracks.length) this.startAudioTake(audioTracks.map((t) => t.id), from);
    this.store.emit('structure');
  }

  /** Beat the performer was hearing when they played (compensates output latency). */
  private heardBeat(): number {
    return this.transport.beatAt(this.engine.ctx.currentTime - this.engine.outputLatency);
  }

  private recordNoteOn(pitch: number, velocity: number): void {
    if (!this.transport.recording || !this.takes.size) return;
    const beat = this.heardBeat();
    const countIn = this.transport.countInEnd;
    if (countIn !== null && beat < countIn - 0.25) return; // still counting in
    if (this.recPending.has(pitch)) this.recordNoteOff(pitch, beat);
    // The note is written immediately and grows while held, so it shows up as you play.
    const notes: PendingNote['notes'] = [];
    for (const clip of this.takes.values()) {
      let rel = beat - clip.start;
      if (this.recordLoop) rel = ((rel % clip.length) + clip.length) % clip.length;
      else if (rel < -0.25) continue;
      const note: Note = { id: uid('n'), pitch, start: Math.max(0, rel), duration: 1 / 32, velocity };
      clip.notes.push(note);
      notes.push({ clip, note });
    }
    this.recPending.set(pitch, { beat, notes });
    this.store.emit('params');
  }

  private recordNoteOff(pitch: number, endBeat = this.heardBeat()): void {
    const pending = this.recPending.get(pitch);
    if (!pending) return;
    this.recPending.delete(pitch);
    this.stretchPending(pending, endBeat);
    this.store.emit('params');
  }

  private stretchPending(pending: PendingNote, beat: number): void {
    const bpb = beatsPerBar(this.store.project);
    for (const { clip, note } of pending.notes) {
      let dur = beat - pending.beat;
      if (this.recordLoop && dur < 0) dur += clip.length; // held across the loop boundary
      note.duration = Math.max(1 / 32, Math.min(dur, clip.length - note.start + (this.recordLoop ? 0 : Infinity)));
      if (!this.recordLoop) clip.length = Math.max(clip.length, Math.ceil((note.start + note.duration) / bpb) * bpb);
    }
  }

  /** Called every frame while recording: grows take clips and held notes up to the playhead. */
  private growTakes(): void {
    const beat = this.heardBeat();
    for (const pending of this.recPending.values()) this.stretchPending(pending, beat);
    if (this.recordLoop) return;
    const bpb = beatsPerBar(this.store.project);
    for (const clip of this.takes.values()) {
      if (beat > clip.start) clip.length = Math.max(clip.length, Math.ceil((beat - clip.start) / bpb) * bpb);
    }
  }

  private async finishRecording(): Promise<void> {
    const end = this.transport.playing ? this.heardBeat() : this.transport.position;
    for (const pitch of [...this.recPending.keys()]) this.recordNoteOff(pitch, end);
    this.takes.clear();
    this.transport.ignoreLoop = false;
    const take = this.audioTake;
    if (take) await this.stopAudioTake(take);
    this.audioTake = null;
    this.store.emit('structure');
  }

  private startAudioTake(trackIds: string[], recordStart: number): void {
    const sampleRate = this.engine.ctx.sampleRate;
    const hop = Math.max(1, Math.floor(sampleRate / PEAKS_PER_SECOND));
    const take: AudioTake = { trackIds, recordStart, firstBeat: null, sampleRate, chunks: [], frames: 0, peaks: [], peakHop: hop, peakMax: 0, peakFill: 0 };
    try {
      this.engine.startCapture((chunk) => {
        if (take.firstBeat === null) {
          // A sample stamped at T was played (by the performer, in time with what they heard)
          // input + output latency earlier on the musical timeline.
          const heardAt = chunk.frame / sampleRate - this.engine.outputLatency - this.engine.inputLatency;
          take.firstBeat = this.transport.beatAt(heardAt);
        }
        take.chunks.push(chunk.data);
        take.frames += chunk.data.length;
        for (let i = 0; i < chunk.data.length; i++) {
          const a = Math.abs(chunk.data[i]);
          if (a > take.peakMax) take.peakMax = a;
          if (++take.peakFill === take.peakHop) {
            take.peaks.push(take.peakMax);
            take.peakMax = 0;
            take.peakFill = 0;
          }
        }
      });
      this.audioTake = take;
    } catch (err) {
      this.toast(`Could not record audio: ${(err as Error).message}`);
    }
  }

  /** Where a take sits on the timeline: audio captured during the count-in stays hidden behind `offset`. */
  private takePlacement(take: AudioTake): { start: number; offset: number; length: number } | null {
    if (take.firstBeat === null) return null;
    const spb = 60 / this.store.project.bpm;
    const start = Math.max(take.recordStart, take.firstBeat, 0);
    const end = take.firstBeat + take.frames / take.sampleRate / spb;
    return { start, offset: (start - take.firstBeat) * spb, length: end - start };
  }

  /** The take being recorded, for live drawing in the arrange view. */
  liveTake(): { trackIds: string[]; start: number; length: number; offset: number; peaks: { data: ArrayLike<number>; rate: number } } | null {
    const take = this.audioTake;
    const place = take && this.takePlacement(take);
    if (!take || !place || place.length <= 0) return null;
    return { trackIds: take.trackIds, ...place, peaks: { data: take.peaks, rate: take.sampleRate / take.peakHop } };
  }

  private async stopAudioTake(take: AudioTake): Promise<void> {
    await this.engine.stopCapture();
    const place = this.takePlacement(take);
    if (!place || place.length <= 0 || !take.frames) return;
    const buffer = this.engine.ctx.createBuffer(1, take.frames, take.sampleRate);
    let offset = 0;
    for (const chunk of take.chunks) {
      buffer.copyToChannel(chunk, 0, offset);
      offset += chunk.length;
    }
    const p = this.store.project;
    const id = uid('aud');
    const name = `Take ${Object.keys(p.audioPool).length + 1}`;
    this.engine.buffers.set(id, buffer);
    this.peakCache.set(id, { data: Float32Array.from(take.peaks), rate: take.sampleRate / take.peakHop });
    p.audioPool[id] = { name, sampleRate: buffer.sampleRate, channels: 1, wav: toBase64(encodeWav(buffer)) };
    for (const trackId of take.trackIds) {
      const clip: AudioClip = { id: uid('clip'), kind: 'audio', name, audioId: id, ...place };
      this.store.track(trackId)?.clips.push(clip);
    }
    this.toast(`Recorded ${name} (${((place.length * 60) / p.bpm).toFixed(1)} s)`);
  }

  // ---------- clip editing ----------

  /** Splits the selected clip — or every clip of the selected track under the position — at `beat` (default: playhead). */
  splitAt(beat = this.transport.currentBeat()): void {
    const { track, clip } = this.store.selection();
    if (!track) return;
    const at = Math.round(beat * 960) / 960; // tidy float noise (1/960 beat ≈ 1 tick)
    const inside = (c: Clip) => at > c.start + 1e-6 && at < c.start + c.length - 1e-6;
    const targets = clip && inside(clip) ? [clip] : track.clips.filter(inside);
    if (!targets.length) {
      this.toast('Put the playhead over a clip on the selected track to split it.');
      return;
    }
    let last: Clip | null = null;
    this.store.mutate((p) => {
      const names = p.tracks.flatMap((t) => t.clips.map((c) => c.name));
      for (const c of targets) {
        const right = splitClip(c, at, p.bpm);
        if (!right) continue;
        right.name = nextSplitName(c.name, names);
        names.push(right.name);
        track.clips.push((last = right));
      }
    });
    if (last) this.selectClip(track.id, (last as Clip).id);
  }

  // ---------- files ----------

  private async restoreAudio(p: Project): Promise<void> {
    let missing = 0;
    for (const [id, asset] of Object.entries(p.audioPool)) {
      if (!asset.wav) {
        missing++;
        continue;
      }
      try {
        this.engine.buffers.set(id, await this.engine.ctx.decodeAudioData(fromBase64(asset.wav)));
      } catch {
        missing++;
      }
    }
    if (missing) this.toast(`${missing} audio take(s) could not be restored`);
    this.timeline.dirty = true;
  }

  private async loadProject(p: Project): Promise<void> {
    this.transport.stop();
    this.transport.position = 0;
    this.engine.buffers.clear();
    this.peakCache.clear();
    await this.restoreAudio(p);
    this.store.load(p);
  }

  newProject(): void {
    if (!confirm('Start a new empty project? Unsaved changes in the current one will be lost.')) return;
    const p = createEmptyProject('Untitled');
    const t = createTrack('midi', { name: 'Synth', color: colorFor(0) });
    t.clips.push(createMidiClip(0, 16, 'Synth'));
    p.tracks.push(t);
    void this.loadProject(p);
  }

  loadDemo(): void {
    if (!confirm('Load the demo song? Unsaved changes in the current project will be lost.')) return;
    void this.loadProject(createDemoProject());
  }

  saveProject(): void {
    const p = this.store.project;
    download(new Blob([serializeProject(p)], { type: 'application/json' }), `${p.name.replace(/[^\w\- ]+/g, '_') || 'project'}.obproj.json`);
    this.toast('Project saved to your downloads');
  }

  openProject(): void {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const p = parseProject(await file.text());
        await this.loadProject(p);
        this.toast(`Opened “${p.name}”`);
      } catch (err) {
        this.toast(`Could not open file: ${(err as Error).message}`);
      }
    });
    input.click();
  }

  async exportWav(): Promise<void> {
    const p = this.store.project;
    this.toast('Rendering…');
    try {
      const buf = await renderProject(p, this.engine.buffers);
      download(new Blob([encodeWav(buf)], { type: 'audio/wav' }), `${p.name || 'mix'}.wav`);
      this.toast(`Exported ${buf.duration.toFixed(1)} s WAV`);
    } catch (err) {
      this.toast(`Export failed: ${(err as Error).message}`);
    }
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      const p = this.store.project;
      try {
        let json = serializeProject(p);
        if (json.length > AUTOSAVE_LIMIT) {
          const pool = Object.fromEntries(Object.entries(p.audioPool).map(([id, a]) => [id, { ...a, wav: undefined }]));
          json = serializeProject({ ...p, audioPool: pool });
        }
        localStorage.setItem(AUTOSAVE_KEY, json);
      } catch {
        /* storage full or unavailable: autosave is best-effort, Save still works */
      }
    }, 800);
  }

  // ---------- keyboard ----------

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const type = (target as HTMLInputElement).type;
    const editing = target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(type));
    if (editing) return;

    if (e.metaKey || e.ctrlKey) {
      const actions: Record<string, () => void> = {
        KeyZ: () => (e.shiftKey ? this.store.redo() : this.store.undo()),
        KeyY: () => this.store.redo(),
        KeyS: () => this.saveProject(),
        KeyO: () => this.openProject(),
        KeyD: () => this.duplicateSelectedClip(),
        KeyA: () => this.focusArea === 'roll' && this.roll.selectAll(),
      };
      const fn = actions[e.code];
      if (fn) {
        e.preventDefault();
        fn();
      }
      return;
    }

    switch (e.code) {
      case 'Escape':
        if (this.tuner.isOpen) this.tuner.close();
        break;
      case 'Space':
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        this.togglePlay();
        break;
      case 'KeyR':
        void this.toggleRecord();
        break;
      case 'Enter':
      case 'Home':
        this.goToStart();
        break;
      case 'KeyL':
        this.toggleLoop();
        break;
      case 'KeyK':
        this.toggleMetronome();
        break;
      case 'KeyS':
        this.splitAt();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (this.focusArea === 'roll') this.roll.deleteSelected();
        else this.deleteSelectedClip();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        if (this.focusArea !== 'roll') break;
        e.preventDefault();
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') this.roll.nudge((e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1), 0);
        else this.roll.nudge(0, (e.code === 'ArrowRight' ? 1 : -1) * (this.snapBeats() || 0.25));
        break;
    }
  }
}
