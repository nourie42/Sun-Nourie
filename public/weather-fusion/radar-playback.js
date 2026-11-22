// Keep the last complete radar image visible while the next tiles load.
export class RadarTileBuffer {
  constructor(map, opacity) {
    this.map = map;
    this.opacity = opacity;
    this.entries = new Map();
    this.active = null;
    this.selection = 0;
  }

  prepare(key, makeLayer) {
    if (this.entries.has(key)) return this.entries.get(key);
    const layer = makeLayer().setOpacity(0);
    const entry = {key, layer, ready: false};
    this.entries.set(key, entry);
    entry.promise = new Promise(resolve => {
      let failed = false, finished = false;
      const tileError = () => { failed = true; };
      const finish = ready => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        layer.off('load', loaded).off('tileerror', tileError);
        entry.ready = ready;
        if (!ready && this.entries.get(key) === entry) this.remove(key);
        resolve(ready);
      };
      const loaded = () => finish(!failed);
      const timeout = setTimeout(() => finish(false), 8000);
      entry.cancel = () => finish(false);
      layer.on('tileerror', tileError).on('load', loaded).addTo(this.map);
    });
    return entry;
  }

  async show(key, makeLayer) {
    const selection = ++this.selection;
    const entry = this.prepare(key, makeLayer);
    if (!(await entry.promise) || selection !== this.selection) return false;
    if (this.active !== entry) {
      if (this.active) this.active.layer.setOpacity(0);
      entry.layer.setOpacity(this.opacity);
      this.active = entry;
    }
    return true;
  }

  trim(keep = []) {
    for (const [key, entry] of this.entries) {
      if (entry !== this.active && !keep.includes(key)) this.remove(key);
    }
  }

  remove(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (!entry.ready) entry.cancel();
    this.map.removeLayer(entry.layer);
  }

  clear() {
    ++this.selection;
    this.active = null;
    for (const key of this.entries.keys()) this.remove(key);
  }
}

export const RADAR_STEP_MS = 330;
export const RADAR_LATEST_HOLD_MS = 700;
