// A small stand-in for Home Assistant's frontend `hass` object, so the dashboard can be
// tried in a plain browser. Service calls change the fake states the way a real home would.

export function createMockHass(data, onChange) {
  const start = Date.now();
  const states = {};
  const entities = {};
  for (const e of data.entities) {
    const changed = new Date(start - (e.ago || 0) * 60000).toISOString();
    states[e.id] = {
      entity_id: e.id,
      state: String(e.state),
      attributes: { friendly_name: e.name, ...(e.attrs || {}) },
      last_changed: changed,
      last_updated: changed,
      context: { id: '', parent_id: null, user_id: null },
    };
    entities[e.id] = {
      entity_id: e.id,
      platform: e.platform || '',
      device_id: e.device || null,
      area_id: e.area || null,
      entity_category: e.category || null,
      translation_key: e.key || null,
      hidden: false,
    };
  }

  let hass;
  const commit = () => {
    hass = { ...hass, states: { ...states } };
    onChange?.(hass);
  };

  const set = (id, state, attrs) => {
    const prev = states[id];
    if (!prev) return;
    const now = new Date().toISOString();
    const next = state === undefined ? prev.state : String(state);
    states[id] = {
      ...prev,
      state: next,
      attributes: { ...prev.attributes, ...(attrs || {}) },
      last_updated: now,
      last_changed: next !== prev.state ? now : prev.last_changed,
    };
  };

  const ids = (target) => (Array.isArray(target) ? target : [target]).filter(Boolean);
  const domainOf = (id) => id.split('.')[0];

  const handle = (domain, service, payload = {}) => {
    for (const id of ids(payload.entity_id)) {
      const st = states[id];
      if (!st) continue;
      const d = domainOf(id);
      if (domain === 'homeassistant' || ['switch', 'light', 'fan', 'input_boolean'].includes(domain)) {
        const on = service === 'toggle' ? st.state !== 'on' : service === 'turn_on';
        const attrs = {};
        if (d === 'fan' && on && !st.attributes.percentage) attrs.percentage = 50;
        if (d === 'light' && on && !st.attributes.brightness) attrs.brightness = 204;
        set(id, on ? 'on' : 'off', attrs);
      }
      if (domain === 'fan' && service === 'set_percentage') set(id, payload.percentage > 0 ? 'on' : 'off', { percentage: payload.percentage });
      if (domain === 'fan' && service === 'set_preset_mode') set(id, 'on', { preset_mode: payload.preset_mode });
      if (domain === 'climate' && service === 'set_temperature') {
        const attrs = {};
        for (const k of ['temperature', 'target_temp_low', 'target_temp_high']) if (payload[k] !== undefined) attrs[k] = payload[k];
        set(id, undefined, attrs);
      }
      if (domain === 'climate' && service === 'set_hvac_mode') {
        const action = { off: 'off', heat: 'heating', cool: 'cooling', heat_cool: 'idle', auto: 'idle', fan_only: 'fan', dry: 'drying' }[payload.hvac_mode];
        set(id, payload.hvac_mode, { hvac_action: action });
      }
      if (domain === 'vacuum') {
        if (service === 'start') set(id, 'cleaning', { error: null, status: 'Cleaning' });
        if (service === 'pause') set(id, 'paused');
        if (service === 'return_to_base') {
          set(id, 'returning');
          setTimeout(() => { set(id, 'docked'); commit(); }, 6000);
        }
        if (service === 'set_fan_speed') set(id, undefined, { fan_speed: payload.fan_speed });
      }
      if (domain === 'scene') set(id, new Date().toISOString());
    }
  };

  hass = {
    states: { ...states },
    entities,
    devices: data.devices || {},
    areas: data.areas || {},
    user: data.user || { name: 'Alex' },
    config: { unit_system: { temperature: '°F', length: 'mi' }, version: '2026.10.0', ...(data.config || {}) },
    locale: { language: 'en', time_format: 'language' },
    themes: { darkMode: true },
    callService: async (domain, service, payload) => {
      await new Promise((r) => setTimeout(r, 200));
      handle(domain, service, payload);
      commit();
    },
    callWS: async (msg) => {
      await new Promise((r) => setTimeout(r, 300));
      if (msg.type === 'history/history_during_period') {
        const from = Date.parse(msg.start_time);
        const to = Date.parse(msg.end_time);
        const out = {};
        for (const id of msg.entity_ids) {
          const st = states[id];
          if (!st) continue;
          out[id] = (data.history?.(st, from, to) || []).map(([t, v]) => ({ s: String(v), lu: t / 1000 }));
        }
        return out;
      }
      if (msg.type === 'logbook/get_events') return data.logbook?.() || [];
      throw new Error(`Unknown command ${msg.type}`);
    },
    connection: {
      subscribeMessage: async (callback, msg) => {
        if (msg.type === 'weather/subscribe_forecast') {
          setTimeout(() => callback({ type: msg.forecast_type, forecast: data.forecast?.(msg.forecast_type) || [] }), 60);
        }
        return () => {};
      },
    },
    hassUrl: (path) => path,
  };

  return {
    get hass() {
      return hass;
    },
    states,
    set,
    commit,
  };
}

// Deterministic, plausible 24-hour series so charts have something to draw.
export function synthHistory(st, from, to) {
  const cur = Number(st.state);
  if (!Number.isFinite(cur)) return [];
  let seed = 0;
  for (const c of st.entity_id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dc = st.attributes.device_class;
  const unit = String(st.attributes.unit_of_measurement || '');
  const step = 5 * 60000;
  const out = [];
  for (let t = from; t < to; t += step) {
    const d = new Date(t);
    const h = d.getHours() + d.getMinutes() / 60;
    let v;
    if (dc === 'carbon_dioxide') {
      const night = h >= 22 || h < 7 ? 1 : 0;
      v = 470 + night * 520 * Math.sin(((h + 2) % 24) / 9 * Math.PI) ** 2 + rnd() * 60;
    } else if (dc === 'pm25' || dc === 'pm10' || dc === 'pm1') {
      const cooking = (h > 7 && h < 8.2) || (h > 18 && h < 19.3) ? 14 : 0;
      v = 3 + rnd() * 3 + cooking * rnd();
    } else if (dc === 'power') {
      const base = /kw/i.test(unit) ? 0.4 : 400;
      const scale = /kw/i.test(unit) ? 0.001 : 1;
      const load = (h > 6.5 && h < 9 ? 1400 : 0) + (h > 17 && h < 22 ? 2200 : 0) + (rnd() < 0.08 ? 1800 : 0);
      v = cur === 0 && rnd() < 0.85 ? 0 : base + (load + rnd() * 300) * scale;
    } else if (/gal\/m|l\/min/i.test(unit)) {
      const shower = (h > 6.5 && h < 6.9) || (h > 7.3 && h < 7.5) || (h > 21 && h < 21.25);
      const dishes = h > 20 && h < 20.4;
      v = shower ? 2.1 + rnd() * 0.3 : dishes ? 0.9 : rnd() < 0.05 ? 0.6 + rnd() : 0;
    } else if (dc === 'temperature') {
      v = cur + Math.sin((h - 15) / 24 * 2 * Math.PI) * 2 + rnd() * 0.4;
    } else {
      v = cur * (0.85 + rnd() * 0.3);
    }
    out.push([t, Math.round(v * 100) / 100]);
  }
  out.push([to - 60000, cur]);
  return out;
}
