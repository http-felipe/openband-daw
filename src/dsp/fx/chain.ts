import type { FxSlot } from '../../core/project';
import { createFxModule, type FxHost, type FxModule } from './modules';

/**
 * Ordered, bypassable insert chain. `sync()` reconciles live audio nodes with the project's slot list:
 * modules are created/disposed by slot id, params applied incrementally, and the graph is rewired
 * only when order or bypass state changes.
 */
export class FxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private modules = new Map<string, FxModule>();
  private wiring = '';

  constructor(private readonly host: FxHost) {
    this.input = host.ctx.createGain();
    this.output = host.ctx.createGain();
    this.input.connect(this.output);
  }

  sync(slots: FxSlot[]): void {
    const seen = new Set<string>();
    for (const slot of slots) {
      seen.add(slot.id);
      let m = this.modules.get(slot.id);
      if (!m || m.type !== slot.type) {
        m?.dispose();
        m = createFxModule(slot.type, this.host);
        this.modules.set(slot.id, m);
        m.update(slot.params, true);
      } else {
        m.update(slot.params);
      }
    }
    for (const [id, m] of this.modules) {
      if (!seen.has(id)) {
        m.dispose();
        this.modules.delete(id);
      }
    }
    const wiring = slots.map((s) => `${s.id}:${s.bypass ? 0 : 1}`).join('|');
    if (wiring !== this.wiring) {
      this.wiring = wiring;
      this.rewire(slots);
    }
  }

  onTempo(): void {
    for (const m of this.modules.values()) m.onTempo();
  }

  dispose(): void {
    for (const m of this.modules.values()) m.dispose();
    this.modules.clear();
    this.input.disconnect();
    this.output.disconnect();
  }

  private rewire(slots: FxSlot[]): void {
    this.input.disconnect();
    for (const m of this.modules.values()) m.output.disconnect();
    let node: AudioNode = this.input;
    for (const slot of slots) {
      if (slot.bypass) continue;
      const m = this.modules.get(slot.id);
      if (!m) continue;
      node.connect(m.input);
      node = m.output;
    }
    node.connect(this.output);
  }
}
