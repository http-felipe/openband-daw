import type { InstrumentType, Track } from '../core/project';
import { AMP_PRESETS } from '../dsp/fx/defs';
import { INSTRUMENT_DEFS, firstPreset, presetParams } from '../synth/defs';
import type { App } from './app';
import { h, select } from './dom';
import { paramControl } from './param-controls';
import { setMeter } from './toolbar';

/** Instrument editor (MIDI tracks) or input/amp setup (audio tracks) for the selected track. */
export class InstrumentPanel {
  readonly el = h('div', { class: 'panel-pad' });
  private channelMeters: HTMLElement[] = [];

  constructor(private readonly app: App) {}

  render(): void {
    this.el.innerHTML = '';
    this.channelMeters = [];
    const { track } = this.app.store.selection();
    if (!track) {
      this.el.append(h('div', { class: 'placeholder' }, 'Select a track to edit its instrument.'));
      return;
    }
    if (track.kind === 'audio') this.renderAudio(track);
    else this.renderInstrument(track);
  }

  private renderInstrument(track: Track): void {
    const store = this.app.store;
    const inst = track.instrument!;
    const def = INSTRUMENT_DEFS[inst.type];
    const typeSel = select(
      Object.entries(INSTRUMENT_DEFS).map(([k, d]) => [k, d.label]),
      inst.type,
      (v) =>
        store.mutate(() => {
          const type = v as InstrumentType;
          const preset = firstPreset(type);
          track.instrument = { type, preset, params: presetParams(type, preset) };
        }),
    );
    const presetSel = select(
      Object.keys(def.presets).map((k) => [k, k]),
      inst.preset,
      (v) =>
        store.mutate(() => {
          inst.preset = v;
          inst.params = presetParams(inst.type, v);
        }),
    );
    this.el.append(
      h(
        'div',
        { class: 'panel-head' },
        h('h3', {}, track.name),
        h('label', { class: 'field' }, h('span', {}, 'Engine'), typeSel),
        h('label', { class: 'field' }, h('span', {}, 'Preset'), presetSel),
        h('span', { class: 'hint' }, 'Play with the on-screen keys or a USB MIDI controller. Double-click a slider to reset it.'),
      ),
      h(
        'div',
        { class: 'param-grid' },
        ...def.params.map((d) =>
          paramControl(
            d,
            inst.params[d.key] ?? d.def,
            (v) => {
              inst.params[d.key] = v;
              store.emit('params');
            },
            () => store.checkpoint(),
          ),
        ),
      ),
    );
  }

  /** Live per-channel input meters; called every frame while this tab is visible. */
  tick(): void {
    if (!this.channelMeters.length) return;
    const levels = this.app.engine.inputLevels();
    this.channelMeters.forEach((el, i) => setMeter(el, levels[i] ?? 0));
  }

  private inputCard(): HTMLElement {
    const { app } = this;
    const { engine } = app;
    const enabled = engine.inputEnabled;
    const devices = app.inputDevices;
    const known = devices.some((d) => d.id === engine.input.deviceId);
    const deviceSel = select(
      [['', 'System default input'], ...devices.map((d): [string, string] => [d.id, d.label]), ...(!known && engine.input.deviceId ? [[engine.input.deviceId, 'Saved device (not connected)'] as [string, string]] : [])],
      engine.input.deviceId,
      (id) => void app.enableInput({ deviceId: id }),
    );
    deviceSel.title = 'Audio interface / microphone';

    // Until the device is open we don't know its channel count; offer the usual stereo pair.
    const count = enabled ? engine.inputChannels : Math.max(2, engine.input.channel + 1);
    this.channelMeters = [];
    const channels = Array.from({ length: count }, (_, i) => {
      const fill = h('div', { class: 'meter-fill' });
      if (enabled) this.channelMeters.push(fill);
      return h(
        'button',
        {
          class: `ch-btn ${engine.input.channel === i ? 'on' : ''}`,
          title: `Use input channel ${i + 1}`,
          onclick: () => void app.enableInput({ channel: i }),
        },
        h('span', {}, `Input ${i + 1}`),
        h('div', { class: 'meter' }, fill),
      );
    });

    return h(
      'div',
      { class: 'setup-card' },
      h('h4', {}, '1 · Input'),
      h('label', { class: 'field stack' }, h('span', {}, 'Device'), deviceSel),
      h('div', { class: 'field stack' }, h('span', {}, 'Channel — play and watch which meter moves'), h('div', { class: 'ch-row' }, ...channels)),
      enabled
        ? h('p', {}, `Listening to input ${engine.input.channel + 1} of ${engine.inputChannels}. Browser voice processing is off.`)
        : h('button', { class: 'tb-text', onclick: () => void app.enableInput() }, 'Enable audio input'),
    );
  }

  private renderAudio(track: Track): void {
    const { app } = this;
    this.el.append(
      h('div', { class: 'panel-head' }, h('h3', {}, track.name), h('span', { class: 'hint' }, 'Audio track: plug in a guitar/bass through your audio interface and monitor it through the amp chain.')),
      h(
        'div',
        { class: 'audio-setup' },
        this.inputCard(),
        h(
          'div',
          { class: 'setup-card' },
          h('h4', {}, '2 · Monitor'),
          h('p', {}, 'Routes the input through this track’s effects in real time. Use headphones to avoid feedback.'),
          h('button', { class: `tb-text ${track.monitor ? 'on' : ''}`, onclick: () => void app.toggleMonitor(track.id) }, track.monitor ? 'Monitoring on' : 'Turn monitoring on'),
        ),
        h(
          'div',
          { class: 'setup-card' },
          h('h4', {}, '3 · Amp'),
          h('p', {}, 'Load a complete chain (Gain → EQ → Drive → Cabinet → Delay → Reverb) and fine-tune it in the Effects tab.'),
          h('div', { class: 'chip-row' }, ...Object.keys(AMP_PRESETS).map((name) => h('button', { class: 'chip', onclick: () => app.applyAmpPreset(track.fx, name) }, name))),
        ),
        h(
          'div',
          { class: 'setup-card' },
          h('h4', {}, '4 · Record'),
          h('p', {}, 'Arm the track (R) and press Record. Takes are stored inside the project file.'),
          h('button', { class: `tb-text ${track.armed ? 'on rec' : ''}`, onclick: () => app.toggleArm(track.id) }, track.armed ? 'Armed' : 'Arm track'),
        ),
      ),
    );
  }
}
