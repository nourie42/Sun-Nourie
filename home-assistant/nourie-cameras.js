/*
 * Nourie Cameras: a live camera card for Home Assistant, built around Google Nest.
 *
 * Install: add this file as a dashboard resource (JavaScript module), then add a card
 *   type: custom:nourie-cameras-card
 *
 * Options, all optional:
 *   title: Cameras
 *   cameras: [camera.front_door, camera.backyard]   pin and order cameras (default: every camera, Nest first)
 *   exclude: [camera.old_one]
 *   layout: focus                                   focus = one large view, grid = every camera live
 *   focus_on_ring: true                             switch to the doorbell when it rings
 *   keep_warm: 60                                   seconds the camera you left keeps streaming, so switching back is instant
 *   remember_frames: true                           keep each camera's last frame on this device for instant previews
 *   transport: tcp                                  video over go2rtc's TCP port, falling back to UDP; auto = browser picks
 *
 * What it does differently from the stock camera cards, because of how Nest streams work:
 *  - Newer Nest cameras give Home Assistant no snapshots, so the card keeps its own last frame
 *    per camera and shows it the moment the dashboard opens.
 *  - Nest ends streams it cannot extend after about five minutes and the stock player freezes.
 *    This card notices when video stops arriving and starts a new stream. Once it has learned a
 *    camera's session length, it opens the next stream shortly before the old one ends and swaps
 *    them without a gap.
 *  - In Focus view only the camera on screen streams. The one you just left stays connected for
 *    a minute, so switching back is instant.
 *
 * Streams use Home Assistant's own camera API (camera/webrtc/offer, camera/stream), the same
 * signalling the built-in player uses, so nothing extra is needed on the server.
 *
 * The same file also provides type: custom:nourie-wall-card, a full-screen wall view (cameras on
 * the left; family radar, map and inside air on the right). Its options are listed further down.
 */

export const VERSION = '1.3.5';

const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Figtree:wght@400;500;600;700&display=swap';
const HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';
const STORE = 'nourie-cams:';

const CONNECT_TIMEOUT_MS = 30000;
const STALL_MS = 8000;
// A live stream counts as frozen once no new frame has been decoded for this long, and as choppy when
// it decodes under 40% of the frame rate that camera managed earlier in the session.
const FROZEN_MS = 2500;
const CHOPPY_RATIO = 0.4;
// Once choppy, a camera stays choppy until it is back above this share of its usual rate, so the badge doesn't flicker.
const CHOPPY_CLEAR_RATIO = 0.55;
// Video goes over go2rtc's TCP port when it offers one. Measured on the Home Assistant Pi's Wi-Fi, UDP lost
// 26-31% of the Driveway's packets and no frame could be rebuilt (go2rtc cannot resend them and Nest cannot
// send a fresh keyframe on request); the same stream over TCP lost none. If no TCP candidate arrives within
// this long, or the TCP connection fails, the camera falls back to UDP.
const TCP_WAIT_MS = 3000;
// A camera that stays choppy this long gets a fresh connection. When the Wall is its only viewer, go2rtc
// then drops its stalled link to Google and dials a new one, which is what cleared the doorbell in testing.
const CHOPPY_RESTART_MS = 20000;
const CHOPPY_RESTART_GAP_MS = 90000;
const BACKOFF_S = [0, 3, 8, 15, 30, 60];
const HIDDEN_GRACE_MS = 60000;
const DETACH_GRACE_MS = 8000;
const STILL_EVERY_MS = 5000;
const STILL_SAVE_MS = 30000;
const STILL_WIDTH = 480;
const LIFETIME_WINDOW_S = [240, 420];
const HANDOFF_LEAD_S = 35;
const SHADOW_TIMEOUT_MS = 25000;
// Home Assistant's go2rtc can sit on the first offer for a camera whose stream is cold while a
// second offer is answered at once, so an unanswered offer gets a parallel one after this long.
const HEDGE_AFTER_MS = 6000;
const GRID_STAGGER_MS = 600;
const CAMERA_STREAM_FEATURE = 2;
const DAY_MS = 86400000;

const now = () => Date.now();

// ------------------------------------------------------------------ helpers

const store = {
  get(key) {
    try {
      const raw = globalThis.localStorage?.getItem(STORE + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(STORE + key, JSON.stringify(value));
    } catch {
      // Storage can be full or blocked; the card works without it.
    }
  },
};

// Troubleshooting log. Events are kept in memory and sent to Home Assistant's nourie_stream_fix
// integration in one small batch every 30 s, which writes them to nourie_cameras_log.jsonl in the
// background. Nothing on the video path waits for it, and it switches itself off if that
// integration isn't installed.
const CAMLOG_FLUSH_MS = 30000;
const CAMLOG_SUMMARY_MS = 300000;
const camLog = {
  queue: [],
  timer: 0,
  disabled: false,
  hass: null,
  client: '',
  label() {
    if (this.client) return this.client;
    let id = store.get('client-id');
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      store.set('client-id', id);
    }
    const ua = globalThis.navigator?.userAgent || '';
    const browser = /SamsungBrowser|Tizen/.test(ua) ? 'Samsung' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    this.client = `${id} ${browser} ${os} ${globalThis.innerWidth || 0}x${globalThis.innerHeight || 0}`.replace(/\s+/g, ' ');
    return this.client;
  },
  add(event, fields = {}) {
    if (this.disabled) return;
    this.queue.push({ event, at: Date.now(), ...fields });
    if (this.queue.length > 300) this.queue.splice(0, this.queue.length - 300);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), CAMLOG_FLUSH_MS);
  },
  async flush() {
    this.timer = 0;
    const hass = this.hass;
    if (this.disabled || !hass?.callWS || !this.queue.length) return;
    const events = this.queue.splice(0, 100);
    try {
      await hass.callWS({ type: 'nourie_stream_fix/log', events, client: this.label() });
    } catch (err) {
      if (err?.code === 'unknown_command') {
        this.disabled = true;
        this.queue = [];
        return;
      }
    }
    if (this.queue.length && !this.timer) this.timer = setTimeout(() => this.flush(), CAMLOG_FLUSH_MS);
  },
};

const ICONS = {
  camera: '<path d="M4 8.5a2 2 0 0 1 2-2h1.8l1.4-2h5.6l1.4 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.8" r="3.2"/>',
  focus: '<rect x="3.5" y="4.5" width="17" height="10" rx="2"/><path d="M4.5 19h3.5M10.25 19h3.5M16 19h3.5"/>',
  grid: '<rect x="3.5" y="4.5" width="7.5" height="6.5" rx="1.5"/><rect x="13" y="4.5" width="7.5" height="6.5" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="6.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="6.5" rx="1.5"/>',
  sound: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  muted: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M16 9.6l4.8 4.8M20.8 9.6L16 14.4"/>',
  expand: '<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4"/><path d="M19.5 4.5V9H15"/>',
  offline: '<path d="M4 4l16 16"/><path d="M9.6 6.5h4.8l1.4 2H18a2 2 0 0 1 2 2v6"/><path d="M17.5 19H6a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2h.5"/>',
  alert: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.2M12 16.9v.1"/>',
  person: '<circle cx="12" cy="8.2" r="3.4"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>',
  motion: '<path d="M3.5 12h3.2l2.3-5.5 4.2 11 2.3-5.5h5"/>',
  wave: '<path d="M5 10.5v3M8.5 8v8M12 5.5v13M15.5 8v8M19 10.5v3"/>',
  bell: '<path d="M6.5 16.5h11l-1.4-2.2V11a4.1 4.1 0 0 0-8.2 0v3.3z"/><path d="M10.4 19a1.7 1.7 0 0 0 3.2 0"/>',
  home: '<path d="M4 11.2 12 4.5l8 6.7"/><path d="M6.5 9.5V19h11V9.5"/><path d="M10 19v-5h4v5"/>',
  car: '<path d="M5.5 16.5h13"/><path d="M4.5 16.5V12.8l1.9-4.6a1.5 1.5 0 0 1 1.4-.9h8.4a1.5 1.5 0 0 1 1.4.9l1.9 4.6v3.7"/><path d="M4.5 12.8h15"/><path d="M6.5 16.5v1.5M17.5 16.5v1.5"/>',
  pin: '<path d="M12 20.5s6-5.6 6-10.4a6 6 0 0 0-12 0c0 4.8 6 10.4 6 10.4z"/><circle cx="12" cy="10" r="2.2"/>',
  air: '<path d="M4 9h10a2.5 2.5 0 1 0-2.5-2.5"/><path d="M4 13h14a2.5 2.5 0 1 1-2.5 2.5"/><path d="M4 17h6"/>',
  family: '<circle cx="9" cy="8.5" r="2.8"/><path d="M3.8 18.5a5.2 5.2 0 0 1 10.4 0"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M15 13.7a4.3 4.3 0 0 1 5.2 4.8"/>',
  shrink: '<path d="M9 4.5V9H4.5M15 4.5V9h4.5M15 19.5V15h4.5M9 19.5V15H4.5"/>',
};

const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function setText(node, value) {
  const v = String(value ?? '');
  if (node && node._nc !== v) {
    node._nc = v;
    node.textContent = v;
  }
}

function setHTML(node, value) {
  if (node && node._nc !== value) {
    node._nc = value;
    node.innerHTML = value;
  }
}

function setSrc(img, value) {
  if (!img || img._nc === value) return;
  img._nc = value;
  if (value) img.src = value;
  else img.removeAttribute('src');
}

export function ago(ms, t = now()) {
  const s = Math.max(0, (t - ms) / 1000);
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr`;
  return `${Math.round(h / 24)} d`;
}

function errText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || err.error?.message || err.code || '';
}

const hassUrl = (hass, path) => (typeof hass?.hassUrl === 'function' ? hass.hassUrl(path) : path);

export function describeError(message, code) {
  const raw = String(message || '').replace(/^Nest API error:\s*/i, '').replace(/^Error from API:\s*/i, '').trim();
  if (code === 'timeout') return { title: 'The camera took too long to start', detail: 'No video arrived from the camera within 30 seconds.', wait: 0 };
  if (/RESOURCE_EXHAUSTED|rate.?limit|\b429\b/i.test(raw)) return { title: 'Google is limiting stream requests', detail: 'Too many streams were opened in a short time.', wait: 60 };
  if (/UNAUTHENTICATED|PERMISSION_DENIED|\b401\b|\b403\b|invalid_grant|re-?auth/i.test(raw)) return { title: 'Home Assistant lost access to this camera', detail: 'Re-authorize the Nest integration in Home Assistant.', wait: 120 };
  if (/NOT_FOUND|\b404\b/i.test(raw)) return { title: 'The camera stream could not be opened', detail: 'Trying a fresh connection.', wait: 5 };
  if (/FAILED_PRECONDITION|UNAVAILABLE|offline|not available/i.test(raw)) return { title: "The camera didn't start its stream", detail: 'It may be off, asleep or offline in the Google Home app.', wait: 20 };
  if (code === 'nostream' || code === 'support' || /not supported|does not support/i.test(raw)) {
    return { title: "This camera can't stream here", detail: raw || 'Home Assistant reports no live stream for it.', fatal: true };
  }
  return { title: 'The stream stopped', detail: raw ? raw.slice(0, 140) : 'The connection to the camera dropped.', wait: 0 };
}

function loadFonts() {
  if (!globalThis.document?.head) return;
  if (document.getElementById('nourie-cams-fonts') || document.getElementById('nourie-home-fonts')) return;
  const link = document.createElement('link');
  link.id = 'nourie-cams-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_CSS;
  document.head.appendChild(link);
}

let hlsPromise = null;
function loadHls() {
  if (globalThis.Hls?.isSupported) return Promise.resolve(globalThis.Hls);
  if (!hlsPromise) {
    hlsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HLS_JS;
      script.async = true;
      script.onload = () => (globalThis.Hls?.isSupported ? resolve(globalThis.Hls) : reject(new Error('The video player did not start')));
      script.onerror = () => {
        hlsPromise = null;
        reject(new Error('The video player could not load'));
      };
      document.head.appendChild(script);
    });
  }
  return hlsPromise;
}

// ------------------------------------------------------------- cameras

function cameraName(hass, id) {
  const st = hass?.states?.[id];
  return String(st?.attributes?.friendly_name || hass?.entities?.[id]?.name || id.split('.')[1]?.replace(/_/g, ' ') || id).replace(/\s+/g, ' ').trim();
}

function cameraModel(hass, id) {
  const device = hass?.devices?.[hass?.entities?.[id]?.device_id];
  return device?.model || '';
}

const isNest = (hass, id) => hass?.entities?.[id]?.platform === 'nest';

export function pickCameras(hass, config = {}) {
  const states = hass?.states || {};
  if (Array.isArray(config.cameras) && config.cameras.length) {
    return config.cameras.filter((id, i, all) => typeof id === 'string' && states[id] && all.indexOf(id) === i);
  }
  const exclude = new Set(Array.isArray(config.exclude) ? config.exclude : []);
  const ents = hass?.entities || {};
  // Live cameras only: picture-only entities such as robot vacuum maps join when listed under cameras.
  const streams = (id) => isNest(hass, id) || (Number(states[id]?.attributes?.supported_features) || 0) & CAMERA_STREAM_FEATURE;
  return Object.keys(states)
    .filter((id) => id.startsWith('camera.') && !exclude.has(id) && !ents[id]?.hidden && !ents[id]?.entity_category && streams(id))
    .sort((a, b) => Number(!isNest(hass, a)) - Number(!isNest(hass, b)) || cameraName(hass, a).localeCompare(cameraName(hass, b)));
}

// ------------------------------------------------------------ sessions

// Receiver rates are interval measurements, not a claim about the age of the scene.
export function connectionTraffic(report, previous, observedAt) {
  const stamp = Number.isFinite(report.timestamp) ? report.timestamp : observedAt;
  const same = previous && previous.id === report.id;
  const elapsed = same ? stamp - previous.stamp : 0;
  const rate = (key, multiplier) => same && elapsed >= 50 && elapsed <= 5000
    && Number.isFinite(report[key]) && Number.isFinite(previous[key]) && report[key] >= previous[key]
    ? multiplier * (report[key] - previous[key]) / elapsed : null;
  const packetCounter = (value, signed = false) => Number.isSafeInteger(value) && (signed || value >= 0);
  const packetDelta = (key, signed = false) => {
    if (!same || !(elapsed >= 50 && elapsed <= 5000) || !packetCounter(report[key], signed)
      || !packetCounter(previous[key], signed) || (!signed && report[key] < previous[key])) return null;
    const delta = report[key] - previous[key];
    return Number.isSafeInteger(delta) ? delta : null;
  };
  const received = packetDelta('packetsReceived');
  // Lost packets may decrease when late packets arrive. Preserve that correction,
  // but do not turn it into a negative loss percentage or a fabricated zero.
  const lost = packetDelta('packetsLost', true);
  const total = received != null && lost != null ? received + lost : null;
  return {
    incomingBps: rate('bytesReceived', 8000),
    decodedFps: rate('framesDecoded', 1000),
    packetsReceivedDelta: received, packetsLostDelta: lost,
    lossPct: received != null && lost != null && lost >= 0 && Number.isFinite(total) && total > 0 ? 100 * lost / total : null,
    previous: { id: report.id, stamp, bytesReceived: report.bytesReceived, framesDecoded: report.framesDecoded,
      packetsReceived: report.packetsReceived, packetsLost: report.packetsLost },
  };
}

// Only a transport's selected pair identifies the active path. Nominated or
// succeeded pairs alone may be old alternatives. Never retain addresses or ids.
export function connectionPath(report, video) {
  const records = new Map();
  const transports = [];
  report.forEach((r) => {
    records.set(r.id, r);
    if (r.type === 'transport' && r.selectedCandidatePairId) transports.push(r);
  });
  const linked = video?.transportId ? records.get(video.transportId)
    : transports.length === 1 ? transports[0] : null;
  const transport = linked?.type === 'transport' ? linked : null;
  const selected = records.get(transport?.selectedCandidatePairId);
  const pair = selected?.type === 'candidate-pair' ? selected : null;
  const localRecord = records.get(pair?.localCandidateId);
  const remoteRecord = records.get(pair?.remoteCandidateId);
  const local = localRecord?.type === 'local-candidate' ? localRecord : null;
  const remote = remoteRecord?.type === 'remote-candidate' ? remoteRecord : null;
  const choice = (value, allowed) => allowed.includes(value) ? value : null;
  const type = (value) => choice(value, ['host', 'srflx', 'prflx', 'relay']);
  const protocol = (value) => choice(value, ['udp', 'tcp']);
  return {
    pathSelected: !!pair,
    dtlsState: choice(transport?.dtlsState, ['new', 'connecting', 'connected', 'closed', 'failed']),
    pairState: choice(pair?.state, ['frozen', 'waiting', 'in-progress', 'failed', 'succeeded']),
    localCandidateType: type(local?.candidateType), remoteCandidateType: type(remote?.candidateType),
    localProtocol: protocol(local?.protocol), remoteProtocol: protocol(remote?.protocol),
    relayProtocol: local?.candidateType === 'relay' ? choice(local.relayProtocol, ['udp', 'tcp', 'tls']) : null,
    roundTripMs: Number.isFinite(pair?.currentRoundTripTime) && Number.isFinite(pair.currentRoundTripTime * 1000) && pair.currentRoundTripTime >= 0
      ? pair.currentRoundTripTime * 1000 : null,
  };
}

// What the viewer actually sees on a live WebRTC stream: ok, choppy or frozen.
export function playbackHealth(player, t) {
  const s = player.session;
  if (player.status !== 'live' || s?.kind !== 'webrtc' || s.closed) return { state: 'ok', fps: null };
  const painted = player.smoother?.recent();
  const shown = Math.max(s.lastDecodeAt || 0, player.rtcPresentation?.lastAt || 0);
  // The canvas owns the visible picture while active. A past pause describes uneven
  // playback; only the age of its latest paint means that it is currently frozen.
  const age = painted ? painted.ageMs : shown ? Math.max(0, t - shown) : null;
  if (age != null && age >= FROZEN_MS) return { state: 'frozen', age, fps: 0 };
  if (!painted && !shown) return { state: 'ok', fps: null };
  const fps = painted ? painted.fps : s.stats?.recentFps;
  const ratio = player.healthState === 'choppy' ? CHOPPY_CLEAR_RATIO : CHOPPY_RATIO;
  if (Number.isFinite(fps) && s.typicalFps >= 6 && fps < Math.max(2, s.typicalFps * ratio)) return { state: 'choppy', fps };
  // Uneven frames look choppy even at a decent average: a pause of 3+ frame times on screen
  // (painted), or a swing in frame timing larger than the frame time itself (browser player).
  const even = painted ? painted.gapMs <= Math.max(300, 3000 / Math.max(fps, 1)) : !(s.stats?.frameSpread > 1);
  if (!even && player.healthState !== 'choppy') return { state: 'choppy', fps };
  if (player.healthState === 'choppy' && !(painted ? painted.gapMs <= Math.max(250, 2500 / Math.max(fps, 1)) : s.stats?.frameSpread <= 0.7)) return { state: 'choppy', fps };
  return { state: 'ok', fps: Number.isFinite(fps) ? fps : null };
}

export function connectionGraphSample(player, t) {
  const session = player.session;
  const kind = session?.kind || player.protocol || '';
  const stats = session?.stats || {};
  const fresh = !!session && !session.closed && Number.isFinite(stats.sampleAt) && t - stats.sampleAt >= 0 && t - stats.sampleAt <= 3500;
  const metric = kind === 'webrtc' ? 'traffic' : kind === 'hls' ? 'buffer' : 'none';
  const raw = metric === 'traffic' ? stats.incomingBps : metric === 'buffer' ? stats.behind : null;
  const value = fresh && Number.isFinite(raw) && raw >= 0 ? raw : null;
  const frameAt = Math.max(player.rtcPresentation?.lastAt || 0, session?.lastDecodeAt || 0) || null;
  return { at: t, kind, metric, value, state: player.status || 'idle',
    fps: fresh && Number.isFinite(stats.decodedFps) ? stats.decodedFps : null,
    frameAgeMs: frameAt ? Math.max(0, t - frameAt) : null };
}

export function connectionGraphHtml(player, t) {
  // HA can update unrelated entities many times per second. Keep this sampled plot
  // at 1 Hz while making a new session or connection state visible immediately.
  const bucket = Math.floor(t / 1000);
  const session = player.session || null;
  const kind = session?.kind || player.protocol || '';
  const connectionState = player.status || 'idle';
  const closed = !!session?.closed;
  const cache = player.connectionGraphCache;
  if (cache && cache.bucket === bucket && cache.session === session && cache.kind === kind
    && cache.state === connectionState && cache.closed === closed) return cache.html;
  const sample = connectionGraphSample(player, t);
  const history = player.connectionHistory || (player.connectionHistory = []);
  if (!history.length || t - history[history.length - 1].at >= 1000) history.push(sample);
  while (history.length && t - history[0].at > 60000) history.shift();
  const values = history.filter((point) => point.metric === sample.metric && point.kind === sample.kind && point.value != null).map((point) => point.value);
  const ceiling = Math.max(sample.metric === 'buffer' ? 5 : 1, ...values);
  let drawing = false;
  let previousAt = null;
  const path = history.map((point) => {
    if (point.metric !== sample.metric || point.kind !== sample.kind || point.value == null) { drawing = false; return ''; }
    if (previousAt != null && point.at - previousAt > 3500) drawing = false;
    previousAt = point.at;
    const x = 1 + 158 * Math.max(0, Math.min(1, (point.at - (t - 60000)) / 60000));
    const y = 17 - 15 * Math.min(1, point.value / ceiling);
    const command = drawing ? 'L' : 'M'; drawing = true;
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const point = history[history.length - 1];
  const lastY = point?.value == null || point.metric !== sample.metric || point.kind !== sample.kind ? null : 17 - 15 * Math.min(1, point.value / ceiling);
  const lastX = point ? 1 + 158 * Math.max(0, Math.min(1, (point.at - (t - 60000)) / 60000)) : 159;
  const measured = sample.value == null ? '—' : sample.metric === 'buffer' ? `${sample.value.toFixed(1)} s buffer`
    : sample.value >= 1000000 ? `${(sample.value / 1000000).toFixed(1)} Mb/s` : `${Math.round(sample.value / 1000)} kb/s`;
  const protocol = sample.kind === 'webrtc' ? 'RTC' : sample.kind === 'hls' ? 'HLS' : sample.kind === 'mjpeg' ? 'MJPEG' : 'No stream';
  const state = sample.state === 'live' ? '' : ` · ${sample.state === 'waiting' ? 'retrying' : sample.state}`;
  const health = playbackHealth(player, t);
  const playback = health.state === 'frozen' ? `frozen ${Math.round(health.age / 1000)} s`
    : sample.metric === 'traffic'
    ? sample.fps == null ? 'decode —' : `${Math.round(sample.fps)} fps decoded`
    : sample.metric === 'buffer' ? 'buffer behind live edge' : 'waiting for receiver data';
  const frame = sample.frameAgeMs == null ? 'frame progress timing unavailable' : `last frame progress ${(sample.frameAgeMs / 1000).toFixed(1)} s ago`;
  const label = `Last 60 seconds: ${sample.metric === 'buffer' ? 'HLS buffer seconds' : 'incoming video bitrate'}. ${protocol}${state}. ${measured}. ${playback}. ${frame}. Gaps mean no measurement.`;
  const warning = sample.state !== 'live' || health.state !== 'ok' || sample.fps === 0
    || (sample.metric === 'traffic' && sample.value === 0) || sample.frameAgeMs > FROZEN_MS;
  const html = `<div class="connection ${warning ? 'connection-wait' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}"><div class="connection-label"><span>${esc(protocol + state)}</span><b>${esc(measured)}</b></div><svg viewBox="0 0 160 20" aria-hidden="true"><path class="connection-base" d="M1,18 H159"></path><path class="connection-line" d="${path}"></path>${lastY == null ? '' : `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="1.5"></circle>`}</svg><div class="connection-caption"><span>${esc(playback)}</span><span>60s</span></div></div>`;
  player.connectionGraphCache = { bucket, session, kind, state: connectionState, closed, html };
  return html;
}

// WebRTC through Home Assistant's camera/webrtc/offer subscription, mirroring the built-in player.
export class RtcSession {
  constructor(player) {
    this.player = player;
    this.kind = 'webrtc';
    this.audioEnabled = player.card?.audioEnabled !== false;
    this.stream = new MediaStream();
    this.pc = null;
    this.unsub = null;
    this.sessionId = '';
    this.localPending = [];
    this.remotePending = [];
    this.closed = false;
    this.failed = false;
    this.onfail = null;
    this.startedAt = now();
    this.firstMediaAt = 0;
    this.lastMediaAt = 0;
    this.decodedFrames = null;
    this.previousReport = null;
    this.trafficPrevious = null;
    this.lastDecodeAt = 0;
    this.decodeHistory = [];
    this.tcpOnly = player.card?.transport !== 'auto' && !player.tcpFailed;
    this.sawTcp = false;
    this.heldUdp = [];
    this.tcpTimer = 0;
    // Start from what this camera usually manages, so a camera that is slow from the start still reads as choppy.
    this.typicalFps = Number(store.get(`fps:${player.id}`)) * 0.9 || 0;
    this.stats = {};
  }

  async open() {
    const { hass, id } = this.player;
    let cfg;
    try {
      cfg = await hass.callWS({ type: 'camera/webrtc/get_client_config', entity_id: id });
    } catch (err) {
      this.fail(errText(err), 'config');
      return;
    }
    if (this.closed) return;

    let pc;
    try {
      pc = new RTCPeerConnection(cfg?.configuration || {});
    } catch (err) {
      this.fail(errText(err), 'support');
      return;
    }
    this.pc = pc;
    // Nest needs a data channel in the offer before it will answer.
    if (cfg?.dataChannel) {
      try {
        pc.createDataChannel(cfg.dataChannel);
      } catch {
        // Not every browser allows it; Nest will say so if it matters.
      }
    }
    pc.ontrack = (ev) => {
      if (this.closed) return;
      if (!this.audioEnabled && ev.track.kind === 'audio') {
        try { ev.track.stop(); } catch { /* Never attach unexpected audio to a video-only stream. */ }
        return;
      }
      if (!this.stream.getTracks().includes(ev.track)) this.stream.addTrack(ev.track);
      this.player.onTrack(this);
    };
    pc.onicecandidate = (ev) => {
      const c = ev.candidate;
      if (this.closed || !c?.candidate) return;
      if (this.sessionId) this.sendCandidate(c);
      else this.localPending.push(c);
    };
    pc.onconnectionstatechange = () => {
      if (!this.closed && pc.connectionState === 'failed') {
        if (this.tcpOnly) {
          this.player.tcpFailed = true;
          camLog.add('transport', { camera: this.player.id, change: 'tcp_failed_use_udp' });
        }
        this.fail('The video connection failed', 'ice');
      }
    };
    // Omitting the audio transceiver removes m=audio from the offer, rather than only muting playback.
    for (const kind of this.audioEnabled ? ['audio', 'video'] : ['video']) {
      // The browser's adaptive jitter buffer is left alone: forcing it to 0 or raising it both measured worse
      // on the bursty Nest streams (a high target made Chrome drop a third of the frames).
      pc.addTransceiver(kind, { direction: 'recvonly' });
    }

    let offer;
    try {
      offer = await pc.createOffer();
      if (this.closed) return;
      await pc.setLocalDescription(offer);
    } catch (err) {
      this.fail(errText(err), 'offer');
      return;
    }
    if (this.closed) return;

    try {
      this.unsub = hass.connection.subscribeMessage(
        (msg) => this.onMessage(msg),
        { type: 'camera/webrtc/offer', entity_id: id, offer: offer.sdp },
        { resubscribe: false },
      );
      this.unsub.catch((err) => this.fail(errText(err), 'offer'));
    } catch (err) {
      this.fail(errText(err), 'offer');
    }
  }

  onMessage(msg) {
    if (this.closed || !msg) return;
    const pc = this.pc;
    if (msg.type === 'session') {
      this.sessionId = msg.session_id;
      for (const c of this.localPending.splice(0)) this.sendCandidate(c);
      return;
    }
    if (msg.type === 'answer') {
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      let sdp = msg.answer;
      if (this.tcpOnly) {
        let mid = '0';
        sdp = sdp.split('\r\n').filter((line) => {
          if (line.startsWith('a=mid:') && mid === '0') mid = line.slice(6);
          if (!line.startsWith('a=candidate')) return true;
          if (/ tcp /i.test(line)) {
            this.sawTcp = true;
            return true;
          }
          this.heldUdp.push({ candidate: line.slice(2), sdpMid: mid });
          return false;
        }).join('\r\n');
        this.armTcpWait();
      }
      pc.setRemoteDescription({ type: 'answer', sdp })
        .then(() => {
          for (const c of this.remotePending.splice(0)) this.addRemote(c);
        })
        .catch((err) => this.fail(errText(err), 'answer'));
      return;
    }
    if (msg.type === 'candidate') {
      if (pc?.remoteDescription) this.addRemote(msg.candidate);
      else this.remotePending.push(msg.candidate);
      return;
    }
    if (msg.type === 'error') this.fail(msg.message || 'The camera refused to stream', msg.code || 'error');
  }

  awaitingAnswer() {
    return !!this.pc && !this.closed && this.pc.signalingState === 'have-local-offer';
  }

  // Gives TCP a moment to turn up, then lets UDP candidates through if it hasn't.
  armTcpWait() {
    if (this.tcpTimer || !this.tcpOnly) return;
    this.tcpTimer = setTimeout(() => {
      if (this.closed || this.sawTcp || !this.tcpOnly) return;
      this.tcpOnly = false;
      camLog.add('transport', { camera: this.player.id, change: 'no_tcp_offered_use_udp' });
      for (const c of this.heldUdp.splice(0)) this.addRemote(c);
    }, TCP_WAIT_MS);
  }

  addRemote(c) {
    if (!c || !this.pc || this.closed) return;
    if (this.tcpOnly && c.candidate) {
      if (/ tcp /i.test(c.candidate)) this.sawTcp = true;
      else {
        this.heldUdp.push(c);
        this.armTcpWait();
        return;
      }
    }
    const init = c.sdpMid || c.sdpMLineIndex != null ? c : { candidate: c.candidate, sdpMid: '0' };
    this.pc.addIceCandidate(init).catch(() => {});
  }

  sendCandidate(c) {
    const { hass, id } = this.player;
    Promise.resolve()
      .then(() => hass.callWS({ type: 'camera/webrtc/candidate', entity_id: id, session_id: this.sessionId, candidate: c.toJSON() }))
      .catch(() => {});
  }

  // Packet health also works for unattached shadows. The mounted player separately verifies playback.
  async poll() {
    const pc = this.pc;
    if (!pc || this.closed) return;
    let video = null;
    let report;
    try {
      report = await pc.getStats();
      report.forEach((r) => {
        if (r.type === 'inbound-rtp' && (r.kind || r.mediaType) === 'video') video = r;
      });
    } catch {
      return;
    }
    if (this.closed) return;
    const t = now();
    const pathStats = { ...connectionPath(report, video), transportSampleAt: t };
    if (!video) {
      // Preserve the age of the last RTP sample; path measurements cannot make
      // old media rates fresh or count as a packet/frame heartbeat.
      this.stats = { ...this.stats, ...pathStats };
      return;
    }
    // These are inbound media counters, not transport keepalives. Even a small byte
    // increase is a heartbeat; either frame counter may work when the other stays zero.
    // A replacement stats report establishes a baseline rather than apparent progress.
    const previous = this.previousReport;
    const keys = ['framesReceived', 'framesDecoded', 'bytesReceived'];
    const moved = keys.some((key) => Number.isFinite(video[key]) && (previous
      ? previous.id === video.id && Number.isFinite(previous[key]) && video[key] > previous[key]
      : video[key] > 0));
    if (moved) {
      if (!this.firstMediaAt) this.firstMediaAt = t;
      this.lastMediaAt = t;
    }
    this.decodedFrames = Number.isFinite(video.framesDecoded) ? video.framesDecoded : null;
    const delta = (key) => previous && previous.id === video.id && Number.isFinite(video[key])
      && Number.isFinite(previous[key]) && video[key] >= previous[key] ? video[key] - previous[key] : null;
    const decoded = delta('framesDecoded');
    const emitted = delta('jitterBufferEmittedCount');
    const decodeTime = delta('totalDecodeTime');
    const interDelay = delta('totalInterFrameDelay');
    const interSquared = delta('totalSquaredInterFrameDelay');
    let frameSpread = null;
    if (decoded > 2 && interDelay > 0 && interSquared != null) {
      const mean = interDelay / decoded;
      frameSpread = Math.sqrt(Math.max(0, interSquared / decoded - mean * mean)) / mean;
    }
    const jitterTime = delta('jitterBufferDelay');
    const traffic = connectionTraffic(video, this.trafficPrevious, t);
    // Decoded frames are the honest measure of what is on screen: packets can keep trickling in
    // while the picture sits still, and that must not read as live.
    let recentFps = null;
    if (Number.isFinite(video.framesDecoded)) {
      if (previous && previous.id !== video.id) this.decodeHistory = [];
      const last = this.decodeHistory[this.decodeHistory.length - 1];
      if (video.framesDecoded > 0 && (!last || video.framesDecoded > last.n)) this.lastDecodeAt = t;
      this.decodeHistory.push({ t, n: video.framesDecoded });
      while (this.decodeHistory.length > 2 && t - this.decodeHistory[0].t > 6000) this.decodeHistory.shift();
      const first = this.decodeHistory[0];
      if (t - first.t >= 3000) recentFps = (1000 * (video.framesDecoded - first.n)) / (t - first.t);
      if (recentFps != null) {
        this.typicalFps = Math.max(recentFps, this.typicalFps * 0.9995);
        if (!this.savedFpsAt || t - this.savedFpsAt > 60000) {
          this.savedFpsAt = t;
          store.set(`fps:${this.player.id}`, Math.round(this.typicalFps * 10) / 10);
        }
      }
    }
    this.stats = {
      recentFps,
      frameSpread,
      ...pathStats,
      width: video.frameWidth || 0, height: video.frameHeight || 0, fps: Math.round(video.framesPerSecond || 0),
      decodedFramesDelta: decoded,
      decodeMs: decoded > 0 && decodeTime != null ? 1000 * decodeTime / decoded : null,
      jitterBufferMs: emitted > 0 && jitterTime != null ? 1000 * jitterTime / emitted : null,
      sampleAt: t, incomingBps: traffic.incomingBps, decodedFps: traffic.decodedFps,
      packetsReceived: Number.isFinite(video.packetsReceived) ? video.packetsReceived : null,
      packetsLost: Number.isFinite(video.packetsLost) ? video.packetsLost : null,
      pliCount: Number.isFinite(video.pliCount) ? video.pliCount : null,
      packetsReceivedDelta: traffic.packetsReceivedDelta, packetsLostDelta: traffic.packetsLostDelta,
      lossPct: traffic.lossPct,
      jitterMs: Number.isFinite(video.jitter) && Number.isFinite(video.jitter * 1000) && video.jitter >= 0 ? video.jitter * 1000 : null,
    };
    this.trafficPrevious = traffic.previous;
    this.previousReport = Object.fromEntries(['id', 'framesReceived', 'bytesReceived', 'framesDecoded', 'totalDecodeTime', 'jitterBufferDelay', 'jitterBufferEmittedCount', 'totalInterFrameDelay', 'totalSquaredInterFrameDelay'].map((key) => [key, video[key]]));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.tcpTimer);
    const unsub = this.unsub;
    this.unsub = null;
    if (unsub) {
      unsub.then(
        (fn) => {
          try {
            Promise.resolve(fn()).catch(() => {});
          } catch {
            // The connection may already be gone.
          }
        },
        () => {},
      );
    }
    try {
      this.pc?.close();
    } catch {
      // Already closed.
    }
    this.pc = null;
    for (const track of this.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Already stopped.
      }
    }
  }

  fail(message, code) {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.onfail?.({ message, code });
  }
}

// HLS through camera/stream, for cameras Home Assistant can't hand over as WebRTC.
const HLS_EXCESS_LAG_S = 10;
const HLS_EDGE_OFFSET_S = 3;
const HLS_CATCH_UP_COOLDOWN_MS = 15000;

function hlsLivePosition(video, hls) {
  if (!Number.isFinite(video.currentTime)) return null;
  let start;
  let end;
  try {
    const ranges = video.seekable;
    if (!ranges?.length) return null;
    start = ranges.start(ranges.length - 1);
    end = ranges.end(ranges.length - 1);
  } catch {
    return null;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= 0.25) return null;
  const margin = Math.min(0.25, (end - start) / 4);
  const fallback = end - Math.min(HLS_EDGE_OFFSET_S, (end - start) / 2);
  const liveSync = hls?.liveSyncPosition;
  const sync = Number.isFinite(liveSync) && liveSync > start && liveSync < end ? liveSync : fallback;
  const target = Math.max(start + margin, Math.min(end - margin, sync));
  return {
    target,
    excess: Math.max(0, target - video.currentTime),
    behind: Number.isFinite(hls?.latency) ? Math.max(0, hls.latency) : Math.max(0, end - video.currentTime),
  };
}

class HlsSession {
  constructor(player) {
    this.player = player;
    this.kind = 'hls';
    this.closed = false;
    this.failed = false;
    this.onfail = null;
    this.startedAt = now();
    this.firstMediaAt = 0;
    this.lastMediaAt = 0;
    this.lastFrames = 0;
    this.lastTime = 0;
    this.hls = null;
    this.stats = {};
    this.lastCatchUpAt = -Infinity;
    this.catchUp = null;
  }

  async open() {
    const { hass, id, video } = this.player;
    const components = hass.config?.components;
    if (Array.isArray(components) && !components.includes('stream')) {
      this.fail("Home Assistant's stream integration isn't running", 'nostream');
      return;
    }
    let url;
    try {
      const res = await hass.callWS({ type: 'camera/stream', entity_id: id, format: 'hls' });
      url = hassUrl(hass, res.url);
    } catch (err) {
      this.fail(errText(err), 'stream');
      return;
    }
    if (this.closed) return;
    let Hls;
    let libraryError;
    try {
      Hls = await loadHls();
    } catch (err) {
      libraryError = err;
    }
    if (this.closed) return;
    // Some Chromium versions advertise native HLS without actually starting it.
    // Prefer the working MSE player; native HLS remains available when it cannot run.
    if (!Hls?.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        this.player.playIfMounted();
      } else {
        this.fail(libraryError?.message || "This browser can't play this camera's stream", libraryError ? 'lib' : 'support');
      }
      return;
    }
    const hls = new Hls({
      backBufferLength: 30,
      fragLoadingTimeOut: 30000,
      manifestLoadingTimeOut: 30000,
      levelLoadingTimeOut: 30000,
      maxLiveSyncPlaybackRate: 2,
      lowLatencyMode: true,
    });
    this.hls = hls;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data?.fatal || this.closed) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      this.fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'The stream stopped loading' : 'The stream could not be played', 'hls');
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    this.player.playIfMounted();
  }

  poll() {
    const video = this.player.video;
    const t = now();
    const quality = video.getVideoPlaybackQuality?.();
    const hasFrameCount = Number.isFinite(quality?.totalVideoFrames) && Number.isFinite(quality?.droppedVideoFrames);
    const frames = hasFrameCount ? Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames) : 0;
    const position = hlsLivePosition(video, this.hls);
    // Seeking changes currentTime immediately; wait for later decoded/playback progress
    // near the live target before treating the recovery as complete.
    const pending = this.catchUp;
    if (pending && t > pending.at && position && position.excess <= HLS_EXCESS_LAG_S
      && video.readyState >= 2 && !video.paused && !video.seeking
      && (hasFrameCount ? frames > pending.frames : video.currentTime > pending.position + 0.05)) {
      this.catchUp = null;
    }
    const moved = frames > this.lastFrames || (!hasFrameCount && !this.catchUp && !video.seeking && video.currentTime > this.lastTime + 0.05);
    if (moved && video.readyState >= 2) {
      if (!this.firstMediaAt) this.firstMediaAt = t;
      this.lastMediaAt = t;
    }
    this.lastFrames = frames;
    this.lastTime = video.currentTime;
    if (position && position.excess > HLS_EXCESS_LAG_S && this.player.mount && this.player.wanted
      && !this.closed && !globalThis.document?.hidden && video.readyState >= 2 && !video.paused && !video.seeking
      && t - this.lastCatchUpAt >= HLS_CATCH_UP_COOLDOWN_MS) {
      this.lastCatchUpAt = t;
      try {
        video.currentTime = position.target;
        this.catchUp = { at: t, frames, position: position.target };
      } catch {
        // Keep the delayed status and retry after the cooldown if seeking is rejected.
      }
    }
    const behind = position?.behind ?? (Number.isFinite(this.hls?.latency) ? this.hls.latency : null);
    this.stats = {
      width: video.videoWidth || 0, height: video.videoHeight || 0, behind,
      sampleAt: t,
      delayed: !!this.catchUp || !!(position && position.excess > HLS_EXCESS_LAG_S),
      catchingUp: !!this.catchUp,
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.hls?.destroy();
    } catch {
      // Already gone.
    }
    this.hls = null;
  }

  fail(message, code) {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.onfail?.({ message, code });
  }
}

// Motion JPEG through camera_proxy_stream, for cameras with no stream support at all.
class MjpegSession {
  constructor(player) {
    this.player = player;
    this.kind = 'mjpeg';
    this.closed = false;
    this.failed = false;
    this.onfail = null;
    this.startedAt = now();
    this.firstMediaAt = 0;
    this.lastMediaAt = 0;
    this.stats = {};
  }

  open() {
    const p = this.player;
    const token = p.state?.attributes?.access_token;
    if (!token) {
      this.fail('', 'nostream');
      return;
    }
    const img = p.ensureImg();
    img.onload = () => {
      if (this.closed) return;
      const t = now();
      if (!this.firstMediaAt) this.firstMediaAt = t;
      this.lastMediaAt = t;
      p.changed();
    };
    img.onerror = () => this.fail('The camera picture stopped loading', 'mjpeg');
    img.src = hassUrl(p.hass, `/api/camera_proxy_stream/${p.id}?token=${encodeURIComponent(token)}`);
  }

  poll() {
    if (this.firstMediaAt) this.lastMediaAt = now();
    const img = this.player.img;
    this.stats = { width: img?.naturalWidth || 0, height: img?.naturalHeight || 0 };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const img = this.player.img;
    if (img) {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
    }
  }

  fail(message, code) {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.onfail?.({ message, code });
  }
}


// --------------------------------------------------------------- smooth playback

// Some Nest cameras (here the Hallway and Living Room) encode with B-frames, so frames leave the
// decoder out of display order: their RTP timestamps run +333, -67, +334, -134 ms. Browsers' WebRTC
// players show frames as they come, so anything moving jerks back and forth, and these streams also
// arrive in clumps with gaps up to 1.5 s. Google Home reorders and paces them; this does the same:
// it takes each decoded frame, sorts by capture time and paints it on a canvas at that time, after
// a delay that adapts to how late frames have recently been (typically 0.1-0.6 s, at most 1.5 s).
const SMOOTH_MIN_DELAY_MS = 60;
const SMOOTH_MAX_DELAY_MS = 1500;
const SMOOTH_WINDOW_MS = 15000;
const SMOOTH_MAX_QUEUE = 90;

export class FrameSmoother {
  constructor(player) {
    this.player = player;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'smooth';
    this.canvas.hidden = true;
    this.ctx = null;
    this.track = null;
    this.processorTrack = null;
    this.failedTrack = null;
    this.reader = null;
    this.queue = [];
    this.lags = [];
    this.delay = 200;
    this.unwrapped = null;
    this.lastRaw = null;
    this.lastDrawnM = -Infinity;
    this.drawn = [];
    this.timer = 0;
    this.timerDue = 0;
    this.active = false;
  }

  static supported() {
    return typeof globalThis.MediaStreamTrackProcessor === 'function' && typeof globalThis.createImageBitmap === 'function';
  }

  start(track) {
    if (!track || track === this.track || track === this.failedTrack) return;
    this.stop();
    this.failedTrack = null;
    this.track = track;
    let reader;
    let clone;
    try {
      // Clumps of up to seven frames arrive at once; the default one-frame buffer would drop most of them.
      clone = track.clone();
      reader = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 30 }).readable.getReader();
    } catch {
      try { clone?.stop(); } catch { /* Already ended. */ }
      this.failedTrack = track;
      this.track = null;
      return;
    }
    this.processorTrack = clone;
    this.reader = reader;
    this.active = true;
    this.startedAt = performance.now();
    this.pump(reader);
  }

  // Timers, not animation frames: Chrome slows animation frames to a few a second in windows it
  // considers occluded, while a frame painted on time still shows wherever the window is visible.
  schedule() {
    if (!this.active || !this.queue.length) return;
    const due = this.queue[0].m + this.base + this.delay;
    const wait = Math.max(0, Math.min(1000, due - performance.now()));
    if (this.timer && this.timerDue <= due) return;
    clearTimeout(this.timer);
    this.timerDue = due;
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.render();
      this.schedule();
    }, wait);
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = 0;
    const reader = this.reader;
    const clone = this.processorTrack;
    this.reader = null;
    this.processorTrack = null;
    try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* Already done. */ }
    try { clone?.stop(); } catch { /* Already ended. */ }
    this.track = null;
    for (const f of this.queue) f.bitmap?.close?.();
    this.queue = [];
    this.lags = [];
    this.unwrapped = null;
    this.lastRaw = null;
    this.lastDrawnM = -Infinity;
    this.drawn = [];
    this.delay = 200;
    this.canvas.hidden = true;
  }

  fail() {
    const track = this.track;
    this.stop();
    // Keep native video visible for this track; a new session may try smoothing again.
    this.failedTrack = track;
  }

  mediaMs(frame) {
    let raw = null;
    try { raw = frame.metadata?.().rtpTimestamp; } catch { raw = null; }
    if (!Number.isFinite(raw)) return frame.timestamp / 1000;
    if (this.lastRaw === null) this.unwrapped = raw;
    else {
      let d = raw - this.lastRaw;
      if (d > 2147483648) d -= 4294967296;
      else if (d < -2147483648) d += 4294967296;
      this.unwrapped += d;
    }
    this.lastRaw = raw;
    return this.unwrapped / 90;
  }

  async pump(reader) {
    while (this.active && reader === this.reader) {
      let result;
      try {
        result = await reader.read();
      } catch {
        break;
      }
      if (result.done || !this.active || reader !== this.reader) {
        result.value?.close?.();
        break;
      }
      const frame = result.value;
      const arrival = performance.now();
      const m = this.mediaMs(frame);
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(frame);
      } catch {
        frame.close();
        if (reader === this.reader) this.fail();
        return;
      }
      frame.close();
      if (!bitmap || !this.active || reader !== this.reader) {
        bitmap?.close?.();
        continue;
      }
      this.accept(m, arrival, bitmap);
    }
    if (reader === this.reader) this.fail();
  }

  accept(m, arrival, bitmap) {
    if (!Number.isFinite(m) || !Number.isFinite(arrival)) {
      bitmap.close();
      this.fail();
      return;
    }
    // A big jump means a new stream behind the same track: start the timeline again.
    const last = this.lags[this.lags.length - 1];
    if (last && Math.abs((arrival - m) - last.lag) > 10000) {
      for (const f of this.queue) f.bitmap.close();
      this.queue = [];
      this.lags = [];
      this.lastDrawnM = -Infinity;
    }
    // go2rtc hands a new viewer its cached frames all at once; those say nothing about the network.
    this.lags.push({ at: arrival, lag: arrival - m, warm: arrival - this.startedAt < 2500 });
    while (this.lags.length && arrival - this.lags[0].at > SMOOTH_WINDOW_MS) this.lags.shift();
    const steady = this.lags.filter((x) => !x.warm);
    const pool = steady.length >= 10 ? steady : this.lags;
    const base = Math.min(...pool.map((x) => x.lag));
    const late = pool.map((x) => x.lag - base).sort((a, b) => a - b);
    const p95 = late[Math.min(late.length - 1, Math.floor(late.length * 0.95))] || 0;
    const want = Math.max(SMOOTH_MIN_DELAY_MS, Math.min(SMOOTH_MAX_DELAY_MS, p95 + 40));
    // Grow at once so frames are not skipped; shrink slowly so playback speed barely changes.
    this.delay = want > this.delay ? want : Math.max(want, this.delay - 2);
    this.base = base;
    // Frames that missed their display deadline still teach the delay estimator
    // how much reordering is needed. Never paint them over a newer frame.
    if (m <= this.lastDrawnM) {
      bitmap.close();
      this.schedule();
      return;
    }
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].m > m) i -= 1;
    this.queue.splice(i, 0, { m, bitmap });
    while (this.queue.length > SMOOTH_MAX_QUEUE) this.queue.shift().bitmap.close();
    this.schedule();
  }

  render() {
    const now = performance.now();
    let show = null;
    while (this.queue.length && this.queue[0].m + this.base + this.delay <= now) {
      show?.bitmap.close();
      show = this.queue.shift();
    }
    if (!show) return;
    const { bitmap } = show;
    const c = this.canvas;
    try {
      if (c.width !== bitmap.width || c.height !== bitmap.height) {
        c.width = bitmap.width;
        c.height = bitmap.height;
        this.ctx = null;
      }
      this.ctx = this.ctx || c.getContext('2d', { alpha: false, desynchronized: true });
      if (!this.ctx) throw new Error('Canvas context unavailable');
      this.ctx.drawImage(bitmap, 0, 0);
    } catch {
      this.fail();
      return;
    } finally {
      bitmap.close();
    }
    this.lastDrawnM = show.m;
    this.drawn.push(now);
    while (this.drawn.length && now - this.drawn[0] > 6000) this.drawn.shift();
    if (c.hidden) c.hidden = false;
  }

  // What was actually painted: frames per second and the longest pause, over the last 3 s.
  recent(now = performance.now()) {
    const shown = this.drawn.filter((t) => now - t <= 3000);
    if (!this.active || this.canvas.hidden || !this.drawn.length) return null;
    const age = Math.max(0, now - this.drawn[this.drawn.length - 1]);
    let gap = age;
    for (let i = 1; i < shown.length; i++) gap = Math.max(gap, shown[i] - shown[i - 1]);
    return { fps: shown.length / 3, ageMs: age, gapMs: gap, delayMs: Math.round(this.delay) };
  }
}

// --------------------------------------------------------------- player

// One per camera. Owns the video element and keeps a stream alive while the card wants it.
export class Player {
  constructor(card, id) {
    this.card = card;
    this.id = id;
    const video = document.createElement('video');
    video.className = 'feed';
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('disablepictureinpicture', '');
    video.addEventListener('loadeddata', () => this.changed());
    video.addEventListener('pause', () => this.pauseRtcWatch());
    this.video = video;
    this.img = null;
    this.canvas = null;
    this.smoother = card?.smooth !== false && FrameSmoother.supported() ? new FrameSmoother(this) : null;

    this.session = null;
    this.shadow = null;
    this.status = 'idle';
    this.problem = null;
    this.protocol = '';
    this.caps = null;
    this.capsAt = 0;
    this.rtcFails = 0;

    this.wanted = false;
    this.warmUntil = 0;
    this.mount = null;
    this.starting = false;
    this.startGeneration = 0;
    this.lastReconnectAt = -Infinity;
    this.startTimer = 0;
    this.retryTimer = 0;
    this.retryAt = 0;
    this.providerWaitUntil = 0;
    this.attempt = 0;
    this.requestAt = 0;
    this.everLive = false;
    this.liveSince = 0;
    this.readyMs = 0;
    this.restarts = 0;
    this.renewals = 0;
    this.coverUntil = 0;
    this.handoffBroken = false;
    this.shadowFor = '';
    this.pollBusy = false;
    this.shadowBusy = false;
    this.rtcPresentation = null;
    this.attachmentGeneration = 0;
    this.frameCallbackId = null;

    const saved = card.remember ? store.get(`still:${id}`) : null;
    this.still = typeof saved?.u === 'string' ? saved.u : '';
    this.stillAt = Number(saved?.t) || 0;
    this.stillAspect = Number(saved?.a) || 0;
    this.lastCapture = 0;
    this.lastSave = 0;
    this.lifetimeS = Number(store.get(`life:${id}`)) || 0;
  }

  get hass() {
    return this.card._hass;
  }

  get state() {
    return this.hass?.states?.[this.id];
  }

  get offline() {
    const st = this.state;
    return !st || st.state === 'unavailable';
  }

  changed() {
    this.card.queueRefresh();
  }

  setStatus(status) {
    if (this.status === status) return;
    const from = this.status;
    this.status = status;
    camLog.add('status', { camera: this.id, from, to: status, protocol: this.session?.kind || this.protocol || null,
      readyMs: status === 'live' ? this.readyMs : undefined, problem: status === 'live' ? undefined : this.problem?.detail || this.problem?.title });
    this.changed();
  }

  ensureImg() {
    if (!this.img) {
      this.img = document.createElement('img');
      this.img.className = 'feed';
      this.img.alt = '';
    }
    return this.img;
  }

  element() {
    return this.protocol === 'mjpeg' ? this.ensureImg() : this.video;
  }

  mountIn(container) {
    if (!container) return;
    const nodes = this.protocol !== 'mjpeg' && this.smoother ? [this.video, this.smoother.canvas] : [this.element()];
    this.mount = container;
    if (container.childNodes.length !== nodes.length || nodes.some((n, i) => container.childNodes[i] !== n)) container.replaceChildren(...nodes);
    this.startSmoothing(this.session);
    this.playIfMounted();
  }

  unmount() {
    this.pauseRtcWatch();
    this.smoother?.stop();
    for (const node of [this.video, this.img, this.smoother?.canvas]) {
      if (node && node.parentNode === this.mount) node.remove();
    }
    this.mount = null;
  }

  playIfMounted() {
    if (!this.mount || this.protocol === 'mjpeg') return;
    const video = this.video;
    const playing = video.play();
    if (playing?.catch) playing.catch(() => {});
  }

  // The card wants this camera streaming, optionally after a short delay.
  want(delayMs = 0) {
    this.wanted = true;
    this.warmUntil = 0;
    if (this.session || this.starting || this.retryTimer) {
      this.playIfMounted();
      return;
    }
    clearTimeout(this.startTimer);
    this.startTimer = 0;
    if (delayMs > 0) {
      this.startTimer = setTimeout(() => {
        this.startTimer = 0;
        this.ensure();
      }, delayMs);
      if (this.status === 'idle') this.setStatus('connecting');
      this.requestAt = this.requestAt || now();
    } else {
      this.ensure();
    }
  }

  // The card no longer shows this camera. Keep the stream warm for a while, or stop now.
  release(warmMs) {
    if (!this.wanted) return;
    this.wanted = false;
    this.pauseRtcWatch();
    clearTimeout(this.startTimer);
    this.startTimer = 0;
    this.video.muted = true;
    if (warmMs > 0 && this.session) this.warmUntil = now() + warmMs;
    else this.stop();
  }

  ensure() {
    if (!this.wanted || !this.hass) return;
    if (this.offline) {
      this.setStatus('offline');
      return;
    }
    if (this.session || this.starting || this.retryTimer || this.startTimer || this.status === 'error') return;
    this.start(this.everLive);
  }

  stop() {
    this.wanted = false;
    this.warmUntil = 0;
    clearTimeout(this.retryTimer);
    clearTimeout(this.startTimer);
    this.retryTimer = 0;
    this.startTimer = 0;
    this.retryAt = 0;
    this.closeSessions();
    this.setStatus(this.offline ? 'offline' : this.status === 'error' ? 'error' : 'idle');
  }

  // The page has been in the background for a while: free the stream but keep wanting it.
  suspend() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.startTimer);
    this.retryTimer = 0;
    this.startTimer = 0;
    this.retryAt = 0;
    if (this.session || this.shadow || this.starting) {
      this.capture(true);
      this.closeSessions();
    }
    if (!this.wanted) this.warmUntil = 0;
    if (this.status !== 'error') this.setStatus(this.offline ? 'offline' : 'idle');
  }

  closeSessions() {
    this.clearRtcPresentation();
    this.smoother?.stop();
    this.startGeneration += 1;
    this.shadow?.close();
    this.shadow = null;
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.starting = false;
    const video = this.video;
    try {
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
    } catch {
      // Nothing was loaded.
    }
  }

  async capabilities() {
    if (this.caps && now() - this.capsAt < 600000) return this.caps;
    const st = this.state;
    if (!st) return [];
    if (!((Number(st.attributes?.supported_features) || 0) & CAMERA_STREAM_FEATURE)) {
      this.caps = [];
      this.capsAt = now();
      return this.caps;
    }
    const res = await this.hass.callWS({ type: 'camera/capabilities', entity_id: this.id });
    this.caps = Array.isArray(res?.frontend_stream_types) ? res.frontend_stream_types : [];
    this.capsAt = now();
    return this.caps;
  }

  pickProtocol(caps) {
    const rtc = typeof RTCPeerConnection !== 'undefined';
    if (this.card.preferredProtocol === 'hls' && caps.includes('hls')) return 'hls';
    if (caps.includes('web_rtc') && rtc && !(this.rtcFails >= 2 && caps.includes('hls'))) return 'webrtc';
    if (caps.includes('hls')) return 'hls';
    if (caps.includes('web_rtc') && rtc) return 'webrtc';
    if (!caps.length && this.state?.attributes?.access_token) return 'mjpeg';
    return '';
  }

  async start(isRestart) {
    const generation = ++this.startGeneration;
    this.starting = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.retryAt = 0;
    if (this.providerWaitUntil > now()) {
      this.starting = false;
      this.scheduleRetryAt(this.providerWaitUntil);
      return;
    }
    if (!this.requestAt || this.status === 'live' || this.status === 'idle' || this.status === 'waiting') this.requestAt = now();
    this.setStatus(isRestart ? 'reconnecting' : 'connecting');

    let caps;
    try {
      caps = await this.capabilities();
    } catch (err) {
      if (generation !== this.startGeneration) return;
      this.starting = false;
      if (this.wanted) this.scheduleRetry(describeError(errText(err)));
      else this.setStatus('idle');
      return;
    }
    if (generation !== this.startGeneration) return;
    if (!this.wanted) {
      this.starting = false;
      this.setStatus('idle');
      return;
    }
    const kind = this.pickProtocol(caps);
    if (!kind) {
      this.starting = false;
      this.fatal({ title: "This camera can't stream here", detail: 'Home Assistant reports no live stream for it.' });
      return;
    }
    this.protocol = kind;
    const session = kind === 'webrtc' ? new RtcSession(this) : kind === 'hls' ? new HlsSession(this) : new MjpegSession(this);
    session.onfail = (err) => this.onFail(session, err);
    this.session = session;
    this.starting = false;
    this.attach(session);
    this.changed();
    await session.open();
  }

  attach(session) {
    this.clearRtcPresentation();
    this.smoother?.stop();
    const video = this.video;
    if (session.kind === 'webrtc') {
      video.removeAttribute('src');
      video.srcObject = session.stream;
      this.beginRtcPresentation(session);
      this.startSmoothing(session);
    } else if (session.kind === 'hls') {
      video.srcObject = null;
    }
    if (this.mount) this.mountIn(this.mount);
    else this.playIfMounted();
  }

  onTrack(session) {
    if (session !== this.session) return;
    if (this.video.srcObject !== session.stream) this.attach(session);
    this.startSmoothing(session);
    this.playIfMounted();
  }

  startSmoothing(session) {
    if (!this.mount || !this.smoother || session?.kind !== 'webrtc' || session !== this.session) return;
    const track = session.stream.getVideoTracks()[0];
    if (track) this.smoother.start(track);
  }

  // Only native WebRTC cameras need parallel Nest offers/renewal. Provider-backed RTSP
  // (advertised with HLS) uses a named go2rtc stream whose registration must not race.
  canUseShadow() {
    return !!this.caps?.includes('web_rtc') && !this.caps.includes('hls');
  }

  clearRtcPresentation() {
    this.attachmentGeneration += 1;
    if (this.frameCallbackId != null) {
      try { this.video.cancelVideoFrameCallback?.(this.frameCallbackId); } catch { /* Already delivered. */ }
    }
    this.frameCallbackId = null;
    this.rtcPresentation = null;
  }

  pauseRtcWatch() {
    if (this.rtcPresentation) this.rtcPresentation.watching = false;
  }

  rtcWatchable(session) {
    return session === this.session && !session.closed && this.wanted && !!this.mount
      && this.video.parentNode === this.mount && this.video.isConnected !== false
      && (!this.video.getClientRects || this.video.getClientRects().length > 0)
      && !globalThis.document?.hidden && !this.video.paused && this.video.srcObject === session.stream;
  }

  presentedCount() {
    try {
      const q = this.video.getVideoPlaybackQuality?.();
      return Number.isFinite(q?.totalVideoFrames) && Number.isFinite(q?.droppedVideoFrames)
        ? Math.max(0, q.totalVideoFrames - q.droppedVideoFrames) : null;
    } catch { return null; }
  }

  watchRtcPresentation(t) {
    const p = this.rtcPresentation;
    if (!p || !this.rtcWatchable(p.session)) {
      this.pauseRtcWatch();
      return false;
    }
    if (!p.watching) {
      p.watching = true;
      p.watchSince = t;
      p.firstAt = 0;
      p.lastAt = 0;
      p.boundary = globalThis.performance?.now() ?? 0;
      p.lastCount = this.presentedCount();
      p.lastDecodedCount = p.session.decodedFrames;
      p.lastDecodedReport = p.session.previousReport?.id;
      p.callbackSeen = false;
      p.observable = false;
      p.evidence = null;
      if (this.status === 'live') this.setStatus('reconnecting');
    }
    return true;
  }

  beginRtcPresentation(session) {
    const video = this.video;
    const generation = this.attachmentGeneration;
    const callbacks = !this.card.lowOverhead && typeof video.requestVideoFrameCallback === 'function';
    const source = callbacks ? 'presented' : this.presentedCount() != null ? 'playback-quality' : 'decoded';
    const p = this.rtcPresentation = { session, generation, source, watching: false, watchSince: 0,
      firstAt: 0, lastAt: 0, lastCount: null, lastDecodedCount: null, callbackSeen: false, observable: false, evidence: null, boundary: globalThis.performance?.now() ?? 0 };
    if (!callbacks) return;
    const onFrame = (_time, metadata = {}) => {
      if (this.rtcPresentation !== p || generation !== this.attachmentGeneration
        || session !== this.session || session.closed || video.srcObject !== session.stream) return;
      this.frameCallbackId = null;
      const t = now();
      if (this.watchRtcPresentation(t) && video.readyState >= 2
        && (!Number.isFinite(metadata.presentationTime) || metadata.presentationTime >= p.boundary)) {
        p.firstAt = p.firstAt || t;
        p.lastAt = t;
        p.callbackSeen = true;
        p.evidence = 'presented';
      }
      this.frameCallbackId = video.requestVideoFrameCallback(onFrame);
    };
    this.frameCallbackId = video.requestVideoFrameCallback(onFrame);
  }

  pollRtcPresentation(session, t) {
    const p = this.rtcPresentation;
    if (!p || p.session !== session || !this.watchRtcPresentation(t)) return null;
    // Frame callbacks are optional browser evidence, not a prerequisite for working video.
    // Independently check frame counters so an exposed but silent callback API cannot keep
    // a playing stream behind the still or repeatedly restart it. MediaStream currentTime
    // is deliberately excluded: it can advance while every video frame is frozen.
    const count = this.presentedCount();
    const decoded = session.decodedFrames;
    const renderedMoved = count != null && p.lastCount != null && count > p.lastCount;
    const reportId = session.previousReport?.id;
    const decodedMoved = decoded != null && p.lastDecodedCount != null && decoded > p.lastDecodedCount
      && reportId === p.lastDecodedReport;
    const wasObservable = p.observable;
    p.observable = count != null || decoded != null || p.callbackSeen;
    if (!p.observable) {
      // A gap in optional measurements is not a frozen frame. Do not reuse pre-gap proof
      // or an expired deadline when counters become available again.
      p.firstAt = 0;
      p.lastAt = 0;
      p.evidence = null;
    }
    if (p.observable && !wasObservable && !p.firstAt) p.watchSince = t;
    if ((renderedMoved || decodedMoved) && this.video.readyState >= 2) {
      p.firstAt = p.firstAt || t;
      p.lastAt = t;
      p.evidence = renderedMoved ? 'playback-quality' : 'decoded';
    }
    // Establish fresh baselines per attachment/resume; decreases are resets, not progress.
    p.lastCount = count;
    p.lastDecodedCount = decoded;
    p.lastDecodedReport = reportId;
    return p;
  }

  // Temporary, opt-in troubleshooting in Home Assistant's own log. Never include raw
  // errors, stream URLs, credentials, SDP, candidates or signaling session identifiers.
  logConnectionFailure(session, cause) {
    if (this.card.connectionDiagnostics !== true || !session || session !== this.session) return;
    const hass = this.hass;
    if (typeof hass?.callService !== 'function' || !/^camera\.[a-z0-9_]{1,120}$/.test(this.id)) return;
    const t = now();
    const recent = this.card.connectionDiagnosticTimes ||= new Map();
    if (recent.has(this.id) && t - recent.get(this.id) < 30000) return;
    recent.set(this.id, t);
    if (recent.size > 64) recent.delete(recent.keys().next().value);
    const number = (value) => Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
    const signedNumber = (value) => Number.isSafeInteger(value) ? value : null;
    const age = (value) => value ? number(Math.max(0, t - value)) : null;
    const choice = (value, allowed) => allowed.includes(value) ? value : 'unknown';
    const stats = session.stats || {};
    const presentation = this.rtcPresentation;
    const snapshot = {
      build: VERSION, camera: this.id,
      cause: choice(cause, ['entity_unavailable', 'no_frames', 'no_packets', 'config', 'support', 'offer', 'answer', 'ice', 'nostream', 'stream', 'lib', 'hls', 'mjpeg', 'error']),
      protocol: choice(session.kind, ['webrtc', 'hls', 'mjpeg']),
      phase: session.firstMediaAt ? 'active' : 'startup',
      connection: choice(session.pc?.connectionState, ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']),
      ice: choice(session.pc?.iceConnectionState, ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']),
      packetAgeMs: age(session.lastMediaAt), frameAgeMs: age(presentation?.lastAt),
      statsAgeMs: age(stats.sampleAt), sessionAgeMs: age(session.startedAt),
      incomingBps: number(stats.incomingBps), decodedFps: number(stats.decodedFps),
      decodeMs: number(stats.decodeMs), jitterBufferMs: number(stats.jitterBufferMs),
      packetsReceived: number(stats.packetsReceived), packetsLost: number(stats.packetsLost), pliCount: number(stats.pliCount),
      transportAgeMs: age(stats.transportSampleAt), pathSelected: stats.pathSelected === true,
      dtls: choice(stats.dtlsState, ['new', 'connecting', 'connected', 'closed', 'failed']),
      pairState: choice(stats.pairState, ['frozen', 'waiting', 'in-progress', 'failed', 'succeeded']),
      localCandidateType: choice(stats.localCandidateType, ['host', 'srflx', 'prflx', 'relay']),
      remoteCandidateType: choice(stats.remoteCandidateType, ['host', 'srflx', 'prflx', 'relay']),
      localProtocol: choice(stats.localProtocol, ['udp', 'tcp']), remoteProtocol: choice(stats.remoteProtocol, ['udp', 'tcp']),
      relayProtocol: choice(stats.relayProtocol, ['udp', 'tcp', 'tls']),
      roundTripMs: number(stats.roundTripMs), jitterMs: number(stats.jitterMs),
      packetsReceivedDelta: number(stats.packetsReceivedDelta), packetsLostDelta: signedNumber(stats.packetsLostDelta),
      lossPct: Number.isFinite(stats.lossPct) && stats.lossPct >= 0 && stats.lossPct <= 100 ? number(stats.lossPct) : null,
      frameEvidence: choice(presentation?.evidence, ['presented', 'playback-quality', 'decoded']),
      framesObservable: !!presentation?.observable, readyState: number(this.video.readyState),
      paused: !!this.video.paused, hidden: !!globalThis.document?.hidden, wanted: !!this.wanted,
    };
    // Do not await logging or let unavailable/unauthorized services affect video recovery.
    Promise.resolve().then(() => hass.callService('system_log', 'write', {
      logger: 'nourie.wall.camera', level: 'warning', message: JSON.stringify(snapshot),
    })).catch(() => {});
  }

  onFail(session, err) {
    if (session === this.shadow) {
      session.close();
      this.shadow = null;
      if (this.shadowFor === 'renew') this.handoffBroken = true;
      return;
    }
    if (session !== this.session) return;
    this.logConnectionFailure(session, err?.code === 'timeout' ? 'no_packets' : err?.code);
    this.capture(true);
    this.clearRtcPresentation();
    this.smoother?.stop();
    session.close();
    this.session = null;
    this.shadow?.close();
    this.shadow = null;
    try {
      this.video.srcObject = null;
    } catch {
      // Nothing attached.
    }
    if (session.kind === 'webrtc' && (['ice', 'answer', 'offer'].includes(err?.code)
      || (err?.code === 'timeout' && !session.firstMediaAt))) this.rtcFails += 1;
    const info = describeError(err?.message, err?.code);
    if (info.fatal) {
      this.fatal(info);
      return;
    }
    if (!this.wanted) {
      this.warmUntil = 0;
      this.setStatus('idle');
      return;
    }
    this.scheduleRetry(info);
  }

  scheduleRetry(info) {
    this.problem = info;
    camLog.add('retry', { camera: this.id, problem: info?.detail || info?.title, attempt: this.attempt });
    const t = now();
    if ((info.wait || 0) >= 60) this.providerWaitUntil = Math.max(this.providerWaitUntil, t + info.wait * 1000);
    const wait = Math.max(BACKOFF_S[Math.min(this.attempt, BACKOFF_S.length - 1)], info.wait || 0, (this.providerWaitUntil - t) / 1000);
    this.attempt += 1;
    this.scheduleRetryAt(t + wait * 1000);
  }

  scheduleRetryAt(deadline) {
    clearTimeout(this.retryTimer);
    this.retryAt = deadline;
    this.status = 'waiting';
    this.changed();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = 0;
      this.retryAt = 0;
      if (this.wanted) this.start(true);
      else this.setStatus('idle');
    }, Math.max(0, deadline - now()));
  }

  retryNow() {
    if (this.providerWaitUntil > now()) return;
    this.attempt = 0;
    this.problem = null;
    this.caps = null;
    this.rtcFails = 0;
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.retryAt = 0;
    this.status = 'idle';
    this.wanted = true;
    if (!this.session && !this.starting) this.start(true);
  }

  canReconnect(t = now()) {
    return this.wanted && !!this.mount && !this.offline && !globalThis.document?.hidden
      && t >= this.providerWaitUntil
      && !(this.retryAt > t && (this.problem?.wait || 0) >= 60)
      && t - this.lastReconnectAt >= 5000;
  }

  reconnect() {
    const t = now();
    if (!this.canReconnect(t)) return false;
    this.lastReconnectAt = t;
    this.capture(true);
    clearTimeout(this.startTimer);
    clearTimeout(this.retryTimer);
    this.startTimer = 0;
    this.retryTimer = 0;
    this.retryAt = 0;
    this.warmUntil = 0;
    this.attempt = 0;
    this.problem = null;
    this.requestAt = t;
    // Preserve capabilities and fallback history; reconnect only this camera.
    this.closeSessions();
    this.restarts += 1;
    this.start(true);
    return true;
  }

  fatal(info) {
    this.problem = info;
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.retryAt = 0;
    this.status = 'error';
    this.changed();
  }

  tick(t) {
    if (this.offline) {
      if (this.status !== 'offline') {
        this.logConnectionFailure(this.session, 'entity_unavailable');
        clearTimeout(this.retryTimer);
        this.retryTimer = 0;
        this.retryAt = 0;
        this.closeSessions();
        this.setStatus('offline');
      }
      return;
    }
    if (this.status === 'offline') {
      this.setStatus('idle');
      this.ensure();
    }
    if (!this.wanted && this.warmUntil && t >= this.warmUntil) {
      this.stop();
      return;
    }
    const session = this.session;
    if (session && !this.pollBusy) {
      this.pollBusy = true;
      Promise.resolve()
        .then(() => session.poll())
        .catch(() => {})
        .finally(() => {
          this.pollBusy = false;
          this.afterPoll(session, now());
        });
    }
    const shadow = this.shadow;
    if (shadow && !this.shadowBusy) {
      this.shadowBusy = true;
      Promise.resolve()
        .then(() => shadow.poll())
        .catch(() => {})
        .finally(() => {
          this.shadowBusy = false;
          this.afterShadowPoll(shadow, now());
        });
    }
  }

  afterPoll(session, t) {
    if (session !== this.session || session.closed) return;
    const rtc = session.kind === 'webrtc';
    const presentation = rtc ? this.pollRtcPresentation(session, t) : null;
    const hlsStarting = session.kind === 'hls' && !session.firstMediaAt;
    // Autoplay can fail before the first frame. A wanted, visible HLS startup must
    // still time out while paused, rather than staying in Reconnecting forever.
    const watched = rtc ? this.rtcWatchable(session) : hlsStarting
      ? this.wanted && !!this.mount && this.video.parentNode === this.mount
        && this.video.isConnected !== false && !globalThis.document?.hidden
        && (!this.video.getClientRects || this.video.getClientRects().length > 0)
      : (this.mount && !this.video.paused);
    const painted = rtc && watched ? this.smoother?.recent() : null;
    if (painted && painted.ageMs > this.card.stallMs && presentation?.lastAt
      && t - presentation.lastAt <= this.card.stallMs) {
      // A stopped canvas must not cover working native playback indefinitely.
      // Drop only the optional display layer; the camera connection stays open.
      this.smoother.fail();
    }
    if (!session.firstMediaAt) {
      if (watched && t - (presentation?.watchSince || session.startedAt) > CONNECT_TIMEOUT_MS) {
        session.fail('The camera took too long to start', 'timeout');
        return;
      }
      if (session.kind === 'webrtc' && !this.shadow && session.awaitingAnswer() && t - session.startedAt > HEDGE_AFTER_MS) this.startShadow('hedge');
      return;
    }
    if (this.shadow && this.shadowFor === 'hedge') {
      this.shadow.close();
      this.shadow = null;
    }
    // If the browser supplies no usable frame measurement, preserve its normal ready-state
    // behavior instead of waiting forever for unsupported metrics. Known zero/frozen counters
    // do not take this fallback and still require frame progress.
    const readyAt = rtc ? (presentation?.firstAt || (presentation && !presentation.observable
      && this.video.readyState >= 2 ? session.firstMediaAt : 0)) : session.firstMediaAt;
    if (readyAt && this.status !== 'live' && (!this.mount || this.protocol === 'mjpeg' || this.video.readyState >= 2)) {
      this.readyMs = Math.max(0, readyAt - (this.requestAt || session.startedAt));
      this.everLive = true;
      this.liveSince = t;
      this.problem = null;
      this.requestAt = 0;
      this.setStatus('live');
    }
    // Packet flow does not prove a mounted video is decoding/presenting. Do not charge time
    // spent paused, hidden or unmounted, and allow a newly attached shadow its own startup grace.
    if (presentation?.observable) {
      const deadline = presentation.firstAt ? presentation.lastAt + this.card.stallMs
        : presentation.watchSince + CONNECT_TIMEOUT_MS;
      if (t > deadline) {
        this.onStall(session, 'presentation');
        return;
      }
    }
    if (watched && session.lastMediaAt && t - Math.max(session.lastMediaAt, presentation?.watchSince || 0) > this.card.stallMs) {
      this.onStall(session);
      return;
    }
    if (rtc && watched) {
      const health = playbackHealth(this, t);
      if (health.state !== (this.healthState || 'ok')) {
        camLog.add('health', { camera: this.id, from: this.healthState || 'ok', to: health.state,
          fps: health.fps != null ? Math.round(health.fps * 10) / 10 : null, typicalFps: Math.round((session.typicalFps || 0) * 10) / 10 });
        if (this.healthState === 'frozen') this.frozenMs = (this.frozenMs || 0) + (t - (this.frozenSince || t));
        if (health.state === 'frozen') this.frozenSince = t - health.age;
        this.healthState = health.state;
      }
      const frames = session.decodedFrames;
      if (!this.summaryAt) {
        this.summaryAt = t;
        this.summaryFrames = frames;
        this.summaryRestarts = this.restarts;
        this.frozenMs = 0;
      } else if (t - this.summaryAt >= CAMLOG_SUMMARY_MS) {
        const frozenNow = this.healthState === 'frozen' ? t - (this.frozenSince || t) : 0;
        camLog.add('summary', { camera: this.id, minutes: Math.round((t - this.summaryAt) / 6000) / 10,
          avgFps: frames != null && this.summaryFrames != null && frames >= this.summaryFrames ? Math.round(10000 * (frames - this.summaryFrames) / (t - this.summaryAt)) / 10 : null,
          frozenS: Math.round(((this.frozenMs || 0) + frozenNow) / 1000), restarts: this.restarts - (this.summaryRestarts || 0),
          kbps: session.stats?.incomingBps != null ? Math.round(session.stats.incomingBps / 1000) : null, lossPct: session.stats?.lossPct != null ? Math.round(session.stats.lossPct * 10) / 10 : null,
          res: session.stats?.width ? `${session.stats.width}x${session.stats.height}` : null, path: session.stats?.localProtocol || null });
        this.summaryAt = t;
        this.summaryFrames = frames;
        this.summaryRestarts = this.restarts;
        this.frozenMs = 0;
        if (this.healthState === 'frozen') this.frozenSince = t;
      }
      // A fresh connection can't make a camera send more frames, so only near-stalls get one.
      this.choppySince = health.state === 'choppy' && Number.isFinite(health.fps) && health.fps < 2 ? this.choppySince || t : 0;
      if (this.choppySince && t - this.choppySince > CHOPPY_RESTART_MS && t - (this.choppyRestartAt || 0) > CHOPPY_RESTART_GAP_MS) {
        this.choppyRestartAt = t;
        this.choppySince = 0;
        this.onStall(session, 'presentation');
        return;
      }
    }
    if (this.status === 'live' && t - this.liveSince > 120000) {
      this.attempt = 0;
      if (rtc && watched && this.card.rtcStallFallback === true) this.rtcFails = 0;
    }
    if (!this.card.lowOverhead && this.mount && this.status === 'live' && t - this.lastCapture >= STILL_EVERY_MS) this.capture();

    // Seamless renewal for cameras whose sessions end on a fixed clock.
    const lead = this.card.handoffLeadS;
    if (session.kind === 'webrtc' && this.lifetimeS && this.wanted && !this.shadow && !this.handoffBroken && this.lifetimeS - lead >= Math.min(20, this.lifetimeS / 2)) {
      if (t >= session.startedAt + (this.lifetimeS - lead) * 1000) this.startShadow('renew');
    }
  }

  onStall(session, reason = 'media') {
    camLog.add('restart', { camera: this.id, reason: this.choppyRestartAt && now() - this.choppyRestartAt < 1000 ? 'choppy' : reason === 'presentation' ? 'frozen' : 'no_video',
      ranForS: Math.round((now() - session.startedAt) / 1000), fps: session.stats?.recentFps != null ? Math.round(session.stats.recentFps * 10) / 10 : null });
    this.logConnectionFailure(session, reason === 'presentation' ? 'no_frames' : 'no_packets');
    // A connection that repeatedly starts and freezes also needs the existing HLS
    // fallback. Close this camera's RTC/shadow below before opening its replacement.
    if (session.kind === 'webrtc' && this.card.rtcStallFallback === true) this.rtcFails += 1;
    const ranFor = (session.lastMediaAt - session.startedAt) / 1000;
    const [lo, hi] = this.card.lifetimeWindow;
    if (session.kind === 'webrtc' && this.canUseShadow() && reason === 'media' && ranFor >= lo && ranFor <= hi) {
      this.lifetimeS = Math.round(ranFor);
      store.set(`life:${this.id}`, this.lifetimeS);
      this.handoffBroken = false;
    }
    this.capture(true);
    this.clearRtcPresentation();
    this.smoother?.stop();
    session.close();
    if (this.session === session) this.session = null;
    this.shadow?.close();
    this.shadow = null;
    if (!this.wanted) {
      this.warmUntil = 0;
      this.setStatus('idle');
      return;
    }
    this.restarts += 1;
    if (ranFor < 20) {
      this.scheduleRetry({ title: 'The stream keeps stopping', detail: reason === 'presentation' ? 'Video playback stopped advancing.' : 'The camera stopped sending video.', wait: 0 });
      return;
    }
    this.start(true);
  }

  startShadow(purpose) {
    if (!this.canUseShadow() || this.shadow || !this.session || !this.rtcWatchable(this.session)) return;
    this.shadowFor = purpose;
    const shadow = new RtcSession(this);
    shadow.onfail = (err) => this.onFail(shadow, err);
    this.shadow = shadow;
    shadow.open();
  }

  afterShadowPoll(shadow, t) {
    if (shadow !== this.shadow || shadow.closed) return;
    if (shadow.firstMediaAt) {
      this.swapToShadow();
      return;
    }
    if (t - shadow.startedAt > SHADOW_TIMEOUT_MS) {
      shadow.close();
      this.shadow = null;
      if (this.shadowFor === 'renew') this.handoffBroken = true;
    }
  }

  swapToShadow() {
    const old = this.session;
    const shadow = this.shadow;
    this.shadow = null;
    this.capture(true);
    this.coverUntil = 0;
    this.setStatus('reconnecting');
    this.session = shadow;
    this.attach(shadow);
    old?.close();
    if (this.shadowFor === 'renew') this.renewals += 1;
    this.liveSince = now();
    this.changed();
  }

  capture(force = false) {
    const t = now();
    if (!this.mount || (!force && t - this.lastCapture < 1000)) return;
    if (this.session?.kind === 'webrtc' && !this.rtcPresentation?.firstAt
      && !(this.status === 'live' && this.rtcPresentation?.observable === false)) return;
    const source = this.protocol === 'mjpeg' ? this.img : this.video;
    const w = source?.videoWidth || source?.naturalWidth || 0;
    const h = source?.videoHeight || source?.naturalHeight || 0;
    if (!w || !h || (source === this.video && this.video.readyState < 2)) return;
    try {
      const cw = Math.min(STILL_WIDTH, w);
      const ch = Math.round((cw * h) / w);
      const canvas = this.canvas || (this.canvas = document.createElement('canvas'));
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext('2d').drawImage(source, 0, 0, cw, ch);
      this.still = canvas.toDataURL('image/jpeg', 0.72);
      this.stillAt = t;
      this.stillAspect = w / h;
      this.lastCapture = t;
      if (this.card.remember && (force || t - this.lastSave >= STILL_SAVE_MS)) {
        this.lastSave = t;
        store.set(`still:${this.id}`, { u: this.still, t, a: Math.round((w / h) * 1000) / 1000 });
      }
      this.changed();
    } catch {
      // A picture from another origin can't be read back; keep the previous frame.
    }
  }

  // Width over height of what this camera sends, so a portrait doorbell gets a portrait view.
  aspect() {
    const source = this.protocol === 'mjpeg' ? this.img : this.video;
    const w = source?.videoWidth || source?.naturalWidth || 0;
    const h = source?.videoHeight || source?.naturalHeight || 0;
    return w && h ? w / h : this.stillAspect;
  }

  info() {
    const stats = this.session?.stats || {};
    return {
      protocol: this.protocol,
      // Local snapshot only; presentation/receiver metrics cannot establish scene freshness.
      build: VERSION,
      presentationSource: this.rtcPresentation?.evidence || null,
      frameAgeMs: this.rtcPresentation?.lastAt ? Math.max(0, now() - this.rtcPresentation.lastAt) : null,
      packetAgeMs: this.session?.lastMediaAt ? Math.max(0, now() - this.session.lastMediaAt) : null,
      decodedFramesDelta: stats.decodedFramesDelta ?? null,
      decodeMs: stats.decodeMs ?? null,
      jitterBufferMs: stats.jitterBufferMs ?? null,
      width: stats.width || this.video.videoWidth || 0,
      height: stats.height || this.video.videoHeight || 0,
      fps: stats.fps || 0,
      behind: stats.behind,
      readyMs: this.readyMs,
      restarts: this.restarts,
      renewals: this.renewals,
    };
  }
}

// ---------------------------------------------------------------- events

const EVENT_KIND = { ring: 'ring', doorbell_chime: 'ring', camera_person: 'person', camera_motion: 'motion', camera_sound: 'sound' };
const EVENT_LABEL = { ring: 'Ring', person: 'Person', motion: 'Motion', sound: 'Sound' };
const EVENT_ICON = { ring: 'bell', person: 'person', motion: 'motion', sound: 'wave' };
const EVENT_ORDER = ['ring', 'person', 'motion', 'sound'];

function dayStart(t = now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Nest's event entities (doorbell chime; motion, person and sound) sit on the camera's device.
class EventTracker {
  constructor(card) {
    this.card = card;
    this.cams = new Map();
    this.seen = new Map();
    this.day = 0;
    this.loadAt = 0;
  }

  map(hass, ids) {
    const ents = hass.entities || {};
    const byDevice = new Map();
    for (const id of Object.keys(hass.states || {})) {
      if (!id.startsWith('event.')) continue;
      const device = ents[id]?.device_id;
      if (!device) continue;
      if (!byDevice.has(device)) byDevice.set(device, []);
      byDevice.get(device).push(id);
    }
    const next = new Map();
    for (const cam of ids) {
      const device = ents[cam]?.device_id;
      const prev = this.cams.get(cam);
      const entities = (device && byDevice.get(device)) || [];
      next.set(cam, {
        entities,
        last: prev?.last || {},
        today: prev?.today || {},
        doorbell: entities.some((id) => hass.states[id]?.attributes?.device_class === 'doorbell'),
      });
    }
    const hadAll = [...this.cams.values()].flatMap((c) => c.entities).join('|');
    this.cams = next;
    if (this.day && hadAll !== [...next.values()].flatMap((c) => c.entities).join('|')) this.reload(hass);
  }

  isDoorbell(cam) {
    return !!this.cams.get(cam)?.doorbell;
  }

  update(hass) {
    const t = now();
    if (dayStart(t) !== this.day) this.reload(hass);
    for (const [cam, info] of this.cams) {
      for (const id of info.entities) {
        const st = hass.states?.[id];
        if (!st) continue;
        const prev = this.seen.get(id);
        if (prev === st.state) continue;
        this.seen.set(id, st.state);
        const ts = Date.parse(st.state);
        const kind = EVENT_KIND[st.attributes?.event_type];
        if (!Number.isFinite(ts) || !kind) continue;
        info.last[kind] = Math.max(info.last[kind] || 0, ts);
        if (prev !== undefined && ts > this.loadAt && ts >= this.day) {
          info.today[kind] = (info.today[kind] || 0) + 1;
          if (t - ts < 120000) this.card.onCameraEvent(cam, kind);
        }
      }
    }
  }

  reload(hass) {
    this.day = dayStart();
    for (const info of this.cams.values()) info.today = {};
    this.load(hass);
  }

  async load(hass) {
    const ids = [...this.cams.values()].flatMap((c) => c.entities);
    const from = this.day;
    const until = now();
    this.loadAt = until;
    if (!ids.length || typeof hass?.callWS !== 'function') return;
    let res;
    try {
      res = await hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(from).toISOString(),
        end_time: new Date(until).toISOString(),
        entity_ids: ids,
        minimal_response: false,
        no_attributes: false,
        significant_changes_only: false,
      });
    } catch {
      return;
    }
    if (from !== this.day || !res) return;
    for (const info of this.cams.values()) {
      for (const id of info.entities) {
        let type = null;
        for (const row of res[id] || []) {
          type = row.a?.event_type ?? row.attributes?.event_type ?? type;
          const kind = EVENT_KIND[type];
          const ts = Date.parse(row.s ?? row.state);
          if (!kind || !Number.isFinite(ts) || ts < from || ts > until) continue;
          info.today[kind] = (info.today[kind] || 0) + 1;
          info.last[kind] = Math.max(info.last[kind] || 0, ts);
        }
      }
    }
    this.card.queueRefresh();
  }

  latest(cam, t = now()) {
    const info = this.cams.get(cam);
    if (!info) return [];
    return Object.entries(info.last)
      .filter(([, ts]) => t - ts < DAY_MS)
      .map(([kind, ts]) => ({ kind, ts }))
      .sort((a, b) => b.ts - a.ts);
  }

  today(cam) {
    return this.cams.get(cam)?.today || {};
  }
}

// ------------------------------------------------------------ rendering

// [tone, label, seconds] for the status pill; seconds render in lowercase beside the label.
function pillFor(p, t) {
  if (p.offline) return ['bad', 'Offline', ''];
  switch (p.status) {
    case 'live': {
      const health = playbackHealth(p, t);
      if (health.state === 'frozen') return ['wait', 'Frozen', `${Math.round(health.age / 1000)}s`];
      if (health.state === 'choppy') return ['wait', 'Choppy', `${Math.round(health.fps)} fps`];
      if (p.session?.kind === 'hls' && p.session.stats.delayed) {
        return ['wait', p.session.stats.catchingUp ? 'Catching up' : 'Delayed', ''];
      }
      return ['live', 'Live', ''];
    }
    case 'connecting': {
      const s = p.requestAt ? Math.round((t - p.requestAt) / 1000) : 0;
      return ['wait', 'Connecting', s >= 3 ? `${s}s` : ''];
    }
    case 'reconnecting':
      return ['wait', 'Reconnecting', ''];
    case 'waiting':
      return ['wait', 'Retry in', `${Math.max(1, Math.ceil((p.retryAt - t) / 1000))}s`];
    case 'error':
      return ['bad', 'No stream', ''];
    default:
      return ['idle', p.session ? 'Ready' : 'Paused', ''];
  }
}

function setPill(node, [tone, label, secs]) {
  const cls = `pill p-${tone}`;
  if (node.className !== cls) node.className = cls;
  setHTML(node, `<span>${esc(label)}</span>${secs ? ` <span class="n">${esc(secs)}</span>` : ''}`);
}

function dotFor(p) {
  if (p.offline || p.status === 'error') return 'd-bad';
  if (p.status === 'live') {
    if (playbackHealth(p, now()).state !== 'ok') return 'd-wait';
    return p.wanted ? 'd-live' : 'd-ready';
  }
  if (p.status === 'connecting' || p.status === 'reconnecting' || p.status === 'waiting') return 'd-wait';
  return '';
}

function tileSub(p, t, onScreen) {
  if (p.offline) return 'Offline';
  if (p.status === 'error') return 'No stream';
  if (p.status === 'waiting') return 'Retrying';
  if (p.status === 'live') return onScreen ? 'On screen' : 'Ready';
  if (p.status === 'connecting' || p.status === 'reconnecting') return 'Connecting';
  if (p.stillAt) {
    const a = ago(p.stillAt, t);
    return a === 'now' ? 'Seen just now' : `Seen ${a} ago`;
  }
  return 'Tap to view';
}

function stageMessage(p, t, hasStill, nest) {
  if (p.offline) {
    return { icon: 'offline', title: 'Camera offline', detail: nest ? 'Home Assistant reports it as unavailable. Check it in the Google Home app.' : 'Home Assistant reports it as unavailable.' };
  }
  if (p.status === 'error') return { icon: 'alert', title: p.problem?.title || 'No stream', detail: p.problem?.detail || '', retry: true };
  if (p.status === 'waiting') {
    const s = Math.max(1, Math.ceil((p.retryAt - t) / 1000));
    const detail = [p.problem?.detail, `Trying again in ${s}s.`].filter(Boolean).join(' ');
    return { icon: 'retry', title: p.problem?.title || 'The stream stopped', detail, retry: true };
  }
  if ((p.status === 'connecting' || p.status === 'reconnecting') && !hasStill) {
    const s = p.requestAt ? Math.round((t - p.requestAt) / 1000) : 0;
    const detail = nest ? (s >= 8 ? 'Nest cameras on battery can take a few seconds to wake up.' : 'Waiting for Nest to send video.') : 'Waiting for the camera to send video.';
    return { icon: 'spin', title: p.status === 'reconnecting' ? 'Reconnecting' : 'Starting the stream', detail, soft: true };
  }
  return null;
}

function chipsHTML(list, t, max = 3) {
  return list
    .slice(0, max)
    .map(({ kind, ts }) => `<span class="chip k-${kind}${t - ts < 120000 ? ' fresh' : ''}">${ic(EVENT_ICON[kind])}<span>${EVENT_LABEL[kind]}</span><b>${esc(ago(ts, t))}</b></span>`)
    .join('');
}

function metaLine(p) {
  if (p.status !== 'live') return '';
  const i = p.info();
  const parts = [i.protocol === 'webrtc' ? 'WebRTC' : i.protocol === 'hls' ? 'HLS' : 'Motion JPEG'];
  if (i.width && i.height) parts.push(`${i.width}×${i.height}`);
  if (i.fps) parts.push(`${i.fps} fps`);
  if (i.protocol === 'hls' && Number.isFinite(i.behind)) parts.push(`${i.behind.toFixed(1)} s behind live`);
  if (i.readyMs) parts.push(`started in ${(i.readyMs / 1000).toFixed(1)} s`);
  if (i.renewals) parts.push(`renewed ${i.renewals}× with no gap`);
  if (i.restarts) parts.push(`reconnected ${i.restarts}×`);
  return parts.join(' · ');
}

function todayLine(counts) {
  const parts = EVENT_ORDER.filter((k) => counts?.[k]).map((k) => `${EVENT_LABEL[k]} ${counts[k]}`);
  return parts.length ? `Today · ${parts.join(' · ')}` : '';
}

// ----------------------------------------------------------------- styles

const STYLES = `
:host {
  /* Phone-first: one large live view with a strip of cameras under it; the strip moves to the right from 760px. */
  --nc-bg: #050d18;
  --nc-ink: #e9f5ff;
  --nc-dim: #93abc4;
  --nc-faint: #637d97;
  --nc-line: rgba(124, 214, 255, 0.14);
  --nc-line-2: rgba(124, 214, 255, 0.26);
  --nc-veil: rgba(4, 12, 22, 0.72);
  --nc-screen: #02070e;
  --nc-cyan: #4de3ff;
  --nc-amber: #ffb547;
  --nc-bad: #ff5470;
  --nc-violet: #b197ff;
  --nc-display: "Chakra Petch", "Rajdhani", "Segoe UI", system-ui, sans-serif;
  --nc-body: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  display: block;
  container-type: inline-size;
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
button:focus-visible { outline: 2px solid var(--nc-cyan); outline-offset: 2px; }
.ic { width: 1em; height: 1em; display: block; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.nc { position: relative; isolation: isolate; overflow: hidden; display: grid; gap: 12px; padding: 14px; border-radius: var(--ha-card-border-radius, 20px); background: var(--nc-bg); color: var(--nc-ink); font: 400 14px/1.4 var(--nc-body); -webkit-font-smoothing: antialiased; border: 1px solid var(--nc-line); }
.nc::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(70% 45% at 0% 0%, rgba(77, 227, 255, .12), transparent 70%), radial-gradient(60% 40% at 100% 100%, rgba(177, 151, 255, .08), transparent 70%); }

.top { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; }
.ttl { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; min-width: 0; }
.kicker { font: 600 12.5px/1 var(--nc-display); letter-spacing: .16em; text-transform: uppercase; }
.sum { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.sumc { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; font: 600 11.5px/1 var(--nc-body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sumc.s-live { color: var(--nc-cyan); background: rgba(77, 227, 255, .12); border: 1px solid rgba(77, 227, 255, .3); }
.sumc.s-bad { color: var(--nc-bad); background: rgba(255, 84, 112, .12); border: 1px solid rgba(255, 84, 112, .32); }
.seg { display: inline-flex; gap: 3px; padding: 3px; border-radius: 13px; background: rgba(4, 12, 22, .6); border: 1px solid var(--nc-line); flex: none; }
.seg button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 11px; border-radius: 10px; font-size: 12.5px; font-weight: 600; color: var(--nc-dim); }
.seg button .ic { font-size: 16px; }
.seg button.on { color: var(--nc-ink); background: linear-gradient(180deg, rgba(77, 227, 255, .2), rgba(77, 227, 255, .05)); box-shadow: inset 0 0 0 1px rgba(77, 227, 255, .3); }
.seg button.on .ic { color: var(--nc-cyan); }

.focus { display: grid; gap: 10px; min-width: 0; }
.stage, .cell { position: relative; aspect-ratio: 16 / 9; max-width: 100%; overflow: hidden; background: var(--nc-screen); border: 1px solid var(--nc-line-2); }
.stage { width: 100%; max-height: 78vh; border-radius: 16px; box-shadow: 0 18px 40px -22px rgba(0, 0, 0, .9); }
.backdrop { position: absolute; inset: -24px; width: calc(100% + 48px); height: calc(100% + 48px); max-width: none; object-fit: cover; filter: blur(24px) brightness(.42) saturate(1.15); pointer-events: none; }
.vid { position: absolute; inset: 0; }
.vid > video, .vid > img { width: 100%; height: 100%; display: block; object-fit: contain; background: transparent; }
.vid > canvas.smooth { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: contain; }
.vid > canvas.smooth[hidden] { display: none; }
.still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity .35s ease; pointer-events: none; }
.still.show { opacity: 1; }
.scrim { position: absolute; left: 0; right: 0; display: flex; justify-content: space-between; gap: 8px; pointer-events: none; }
.scrim.top { top: 0; align-items: flex-start; padding: 11px 12px 26px; background: linear-gradient(rgba(2, 7, 14, .68), rgba(2, 7, 14, 0)); }
.scrim.bot { bottom: 0; align-items: flex-end; padding: 24px 8px 8px; background: linear-gradient(rgba(2, 7, 14, 0), rgba(2, 7, 14, .6)); }
.stage .tools { position: absolute; right: 10px; bottom: 10px; z-index: 1; }
.who { display: grid; gap: 4px; min-width: 0; }
.name { font: 600 17px/1.1 var(--nc-display); letter-spacing: .01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 8px rgba(0, 0, 0, .6); }
.model { font: 600 10.5px/1 var(--nc-display); letter-spacing: .14em; text-transform: uppercase; color: var(--nc-dim); }
.model:empty { display: none; }

.pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; flex: none; white-space: nowrap; font: 600 11px/1 var(--nc-display); letter-spacing: .12em; text-transform: uppercase; font-variant-numeric: tabular-nums; color: var(--nc-dim); background: var(--nc-veil); border: 1px solid var(--nc-line-2); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.pill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.pill .n { margin-left: -2px; text-transform: none; letter-spacing: .03em; }
.p-live { color: var(--nc-cyan); border-color: rgba(77, 227, 255, .42); }
.p-live::before { animation: beat 1.8s ease-out infinite; }
.p-wait { color: var(--nc-amber); border-color: rgba(255, 181, 71, .42); }
.p-wait::before { animation: blink 1s steps(2, start) infinite; }
.p-bad { color: var(--nc-bad); border-color: rgba(255, 84, 112, .45); }
.p-idle { color: var(--nc-faint); }
@keyframes beat { 0% { box-shadow: 0 0 0 0 rgba(77, 227, 255, .65); } 70%, 100% { box-shadow: 0 0 0 7px rgba(77, 227, 255, 0); } }
@keyframes blink { to { opacity: .25; } }

.chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px 0 7px; border-radius: 999px; white-space: nowrap; font-size: 12px; font-weight: 600; color: var(--nc-ink); background: var(--nc-veil); border: 1px solid var(--nc-line-2); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.chip .ic { font-size: 14px; color: var(--nc-dim); }
.chip b { font-weight: 500; color: var(--nc-dim); font-variant-numeric: tabular-nums; }
.chip.k-ring .ic { color: var(--nc-violet); }
.chip.fresh { border-color: rgba(255, 181, 71, .6); }
.chip.fresh .ic { color: var(--nc-amber); }
.chip.mini { height: 22px; gap: 4px; padding: 0 7px 0 5px; font-size: 11px; }
.chip.mini .ic { font-size: 12px; }

.tools { display: flex; gap: 6px; flex: none; }
.tool { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; font-size: 19px; color: var(--nc-ink); background: var(--nc-veil); border: 1px solid var(--nc-line-2); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.tool.on { color: var(--nc-cyan); border-color: rgba(77, 227, 255, .45); }

.msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 6px; padding: 56px 24px; text-align: center; background: rgba(2, 7, 14, .55); }
.msg.soft { background: transparent; }
.msg-ic { font-size: 26px; color: var(--nc-dim); display: grid; place-items: center; min-height: 26px; }
.msg-t { font: 600 15px/1.25 var(--nc-display); letter-spacing: .02em; text-wrap: balance; }
.msg-d { max-width: 36ch; font-size: 12.5px; color: var(--nc-dim); text-wrap: pretty; }
.retry { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; min-height: 36px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--nc-cyan); border: 1px solid rgba(77, 227, 255, .4); background: rgba(77, 227, 255, .08); }
.retry .ic { font-size: 15px; }
.spin { width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(77, 227, 255, .2); border-top-color: var(--nc-cyan); animation: turn .9s linear infinite; }
@keyframes turn { to { transform: rotate(360deg); } }

.meta { display: grid; gap: 4px; min-height: 18px; padding: 0 2px; font-size: 12px; color: var(--nc-faint); font-variant-numeric: tabular-nums; min-width: 0; }
.meta .chips { margin-bottom: 4px; }
.meta-a { color: var(--nc-dim); }
.meta > :empty { display: none; }

.cmsg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 6px; padding: 44px 16px 16px; text-align: center; font-size: 12.5px; color: var(--nc-dim); }
.cmsg-ic { font-size: 22px; display: grid; place-items: center; min-height: 22px; }
.cmsg .spin { width: 22px; height: 22px; }

.rail { display: flex; gap: 10px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; padding: 2px 2px 4px; scrollbar-width: none; min-width: 0; }
.rail::-webkit-scrollbar { display: none; }
.tile { flex: none; width: 152px; display: grid; gap: 6px; scroll-snap-align: start; }
.thumb { position: relative; display: block; aspect-ratio: 16 / 9; max-width: 100%; border-radius: 12px; overflow: hidden; background: #081423; border: 1px solid var(--nc-line); transition: border-color .2s, box-shadow .2s; }
.thumb img { width: 100%; height: 100%; display: block; object-fit: cover; }
.ph { position: absolute; inset: 0; display: grid; place-items: center; font-size: 22px; color: var(--nc-faint); }
.dot { position: absolute; top: 8px; left: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--nc-faint); box-shadow: 0 0 0 2px rgba(2, 7, 14, .7); }
.dot.d-live { background: var(--nc-cyan); box-shadow: 0 0 0 2px rgba(2, 7, 14, .7), 0 0 8px rgba(77, 227, 255, .9); }
.dot.d-ready { background: rgba(77, 227, 255, .55); }
.dot.d-wait { background: var(--nc-amber); }
.dot.d-bad { background: var(--nc-bad); }
.thumb .chip { position: absolute; top: 5px; right: 5px; }
.tname { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tsub { margin-top: -4px; font-size: 11.5px; color: var(--nc-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile.on .thumb { border-color: var(--nc-cyan); box-shadow: 0 0 0 1px var(--nc-cyan), 0 0 18px -6px rgba(77, 227, 255, .8); }
.tile.on .tname { color: var(--nc-cyan); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 10px; }
.cell { border-radius: 14px; }
.cell .scrim.top { align-items: center; padding: 10px 10px 26px; }
.cell .name { font-size: 14px; }
.cell .scrim.bot { justify-content: flex-start; padding: 24px 8px 8px; }
.cell .hit { position: absolute; inset: 0; z-index: 2; border-radius: inherit; }

.empty { display: grid; justify-items: center; gap: 6px; padding: 30px 18px; text-align: center; color: var(--nc-dim); }
.empty .ic { font-size: 30px; color: var(--nc-faint); }
.empty b { color: var(--nc-ink); font-size: 15px; }
.empty span { max-width: 44ch; text-wrap: pretty; }
.empty code { font-size: 12px; color: var(--nc-cyan); }

.stage:fullscreen { aspect-ratio: auto; width: 100vw; height: 100vh; max-width: none; border: 0; border-radius: 0; }

@container (min-width: 760px) {
  .focus { grid-template-columns: minmax(0, 1fr) 208px; align-items: start; }
  .stage, .meta { grid-column: 1; }
  .rail { grid-column: 2; grid-row: 1 / span 2; align-self: stretch; contain: size; flex-direction: column; overflow-x: hidden; overflow-y: auto; scroll-snap-type: y proximity; padding: 2px; }
  .tile { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .p-live::before, .p-wait::before, .spin { animation: none; }
  .still, .thumb { transition: none; }
}
`;

// ------------------------------------------------------------------- card

const Base = globalThis.HTMLElement || class {};

export class NourieCamerasCard extends Base {
  constructor() {
    super();
    this._hass = null;
    this.ids = [];
    this.players = new Map();
    this.events = new EventTracker(this);
    this.focusId = '';
    this.muted = true;
    this.attached = false;
    this.built = false;
    this.listKey = '';
    this.tiles = new Map();
    this.cells = new Map();
    this._raf = 0;
    this._tick = 0;
    this._hiddenTimer = 0;
    this._detachTimer = 0;
    this._onVisibility = () => this.onVisibility();
    this.applyConfig({});
  }

  applyConfig(config) {
    this.config = { ...config };
    this.remember = config.remember_frames !== false;
    this.keepWarmMs = Math.max(0, Number(config.keep_warm ?? 60) || 0) * 1000;
    this.transport = config.transport === 'auto' ? 'auto' : 'tcp';
    this.smooth = config.smooth !== false;
    this.stallMs = Number(config._stall_ms) || STALL_MS;
    this.lifetimeWindow = Array.isArray(config._lifetime_window) ? config._lifetime_window : LIFETIME_WINDOW_S;
    this.handoffLeadS = Number(config._handoff_lead_s) || HANDOFF_LEAD_S;
    const saved = store.get('layout');
    this.layout = saved === 'grid' || saved === 'focus' ? saved : config.layout === 'grid' ? 'grid' : 'focus';
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    if (config.cameras !== undefined && !Array.isArray(config.cameras)) throw new Error('cameras must be a list of camera entity IDs');
    if (config.exclude !== undefined && !Array.isArray(config.exclude)) throw new Error('exclude must be a list of camera entity IDs');
    this.applyConfig(config);
    this.listKey = '';
    if (this._hass) {
      this.sync();
      this.applyLayout();
    }
  }

  set hass(hass) {
    camLog.hass = hass;
    this._hass = hass;
    if (!this.built) this.build();
    this.sync();
    this.events.update(hass);
    this.queueRefresh();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  getLayoutOptions() {
    return { grid_columns: 4, grid_min_columns: 2, grid_rows: 'auto' };
  }

  static getStubConfig() {
    return {};
  }

  connectedCallback() {
    this.attached = true;
    clearTimeout(this._detachTimer);
    this._detachTimer = 0;
    loadFonts();
    if (!this.built) this.build();
    document.addEventListener('visibilitychange', this._onVisibility);
    if (!this._tick) this._tick = setInterval(() => this.tick(), 1000);
    this.applyLayout();
  }

  disconnectedCallback() {
    this.attached = false;
    document.removeEventListener('visibilitychange', this._onVisibility);
    clearTimeout(this._detachTimer);
    // Dashboards detach and re-attach cards while you move around; only stop if it stays gone.
    this._detachTimer = setTimeout(() => {
      if (this.attached) return;
      clearInterval(this._tick);
      this._tick = 0;
      for (const p of this.players.values()) p.stop();
    }, DETACH_GRACE_MS);
  }

  build() {
    if (this.built) return;
    this.built = true;
    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLES}</style>
<div class="nc">
  <header class="top">
    <div class="ttl"><span class="kicker"></span><span class="sum"></span></div>
    <div class="seg" role="group" aria-label="Layout">
      <button type="button" data-layout="focus" aria-pressed="true">${ic('focus')}<span>Focus</span></button>
      <button type="button" data-layout="grid" aria-pressed="false">${ic('grid')}<span>All</span></button>
    </div>
  </header>
  <section class="focus">
    <div class="stage">
      <img class="backdrop" alt="" aria-hidden="true">
      <div class="vid"></div>
      <img class="still" alt="">
      <div class="msg" hidden><span class="msg-ic"></span><span class="msg-t"></span><span class="msg-d"></span><button type="button" class="retry" hidden>${ic('retry')}<span>Try again</span></button></div>
      <div class="scrim top"><div class="who"><span class="name"></span><span class="model"></span></div><span class="pill"></span></div>
      <div class="tools">
        <button type="button" class="tool sound" aria-label="Turn sound on">${ic('muted')}</button>
        <button type="button" class="tool full" aria-label="Full screen">${ic('expand')}</button>
        <button type="button" class="tool info" aria-label="Camera details">${ic('info')}</button>
      </div>
    </div>
    <div class="meta"><div class="chips"></div><span class="meta-a"></span><span class="meta-b"></span></div>
    <div class="rail"></div>
  </section>
  <section class="grid" hidden></section>
  <div class="empty" hidden>${ic('camera')}<b>No cameras yet</b><span>This card shows the camera entities in Home Assistant. Nest cameras appear once the Nest integration adds them, or list cameras under <code>cameras:</code> in the card's settings.</span></div>
</div>`;
    const q = (s) => root.querySelector(s);
    this.$ = {
      kicker: q('.kicker'), sum: q('.sum'), seg: q('.seg'), focus: q('.focus'), stage: q('.stage'),
      backdrop: q('.stage .backdrop'), vid: q('.stage .vid'), still: q('.stage .still'), name: q('.stage .name'),
      model: q('.stage .model'), pill: q('.stage .pill'), msg: q('.msg'), msgIc: q('.msg-ic'), msgT: q('.msg-t'),
      msgD: q('.msg-d'), retry: q('.retry'), chips: q('.meta .chips'), sound: q('.tool.sound'), full: q('.tool.full'),
      info: q('.tool.info'), metaA: q('.meta-a'), metaB: q('.meta-b'), rail: q('.rail'), grid: q('.grid'), empty: q('.empty'),
    };
    const $ = this.$;
    $.seg.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-layout]');
      if (b) this.setLayout(b.dataset.layout);
    });
    $.rail.addEventListener('click', (ev) => {
      const tile = ev.target.closest('.tile');
      if (tile) this.focus(tile.dataset.id);
    });
    $.grid.addEventListener('click', (ev) => {
      const cell = ev.target.closest('.cell');
      if (!cell) return;
      this.focusId = cell.dataset.id;
      store.set('focus', this.focusId);
      this.setLayout('focus');
    });
    $.sound.addEventListener('click', () => this.toggleSound());
    $.full.addEventListener('click', () => this.fullscreen());
    $.info.addEventListener('click', () => this.moreInfo(this.focusId));
    $.retry.addEventListener('click', () => this.players.get(this.focusId)?.retryNow());
  }

  sync() {
    const hass = this._hass;
    if (!hass || !this.built) return;
    const ids = pickCameras(hass, this.config);
    const entityKey = ids.map((id) => `${id}:${hass.entities?.[id]?.device_id || ''}:${cameraName(hass, id)}`).join('|');
    if (entityKey === this.listKey) return;
    this.listKey = entityKey;
    for (const [id, p] of this.players) {
      if (!ids.includes(id)) {
        p.stop();
        p.unmount();
        this.players.delete(id);
      }
    }
    for (const id of ids) if (!this.players.has(id)) this.players.set(id, new Player(this, id));
    this.events.map(hass, ids);
    // Doorbells first among auto-discovered cameras; a pinned list keeps its own order.
    this.ids = Array.isArray(this.config.cameras) && this.config.cameras.length ? ids : [...ids].sort((a, b) => Number(this.events.isDoorbell(b)) - Number(this.events.isDoorbell(a)));
    // Two cameras with the same name (say, two called Hallway) read as Hallway and Hallway 2.
    this.names = new Map();
    const seen = new Map();
    for (const id of this.ids) {
      const base = cameraName(hass, id);
      const n = (seen.get(base.toLowerCase()) || 0) + 1;
      seen.set(base.toLowerCase(), n);
      this.names.set(id, n === 1 ? base : `${base} ${n}`);
    }
    if (!this.ids.includes(this.focusId)) this.focusId = this.defaultFocus();
    this.renderList();
    this.applyLayout();
  }

  nameOf(id) {
    return this.names?.get(id) || cameraName(this._hass, id);
  }

  defaultFocus() {
    const saved = store.get('focus');
    if (saved && this.ids.includes(saved)) return saved;
    return this.ids.find((id) => this.events.isDoorbell(id)) || this.ids[0] || '';
  }

  renderList() {
    const $ = this.$;
    for (const p of this.players.values()) if (p.mount && p.mount !== $.vid) p.unmount();
    $.rail.replaceChildren();
    $.grid.replaceChildren();
    this.tiles.clear();
    this.cells.clear();
    for (const id of this.ids) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.dataset.id = id;
      tile.innerHTML = `<span class="thumb"><img alt="" hidden><span class="ph">${ic('camera')}</span><span class="dot"></span><span class="chip mini" hidden></span></span><span class="tname"></span><span class="tsub"></span>`;
      $.rail.append(tile);
      this.tiles.set(id, {
        node: tile, img: tile.querySelector('img'), ph: tile.querySelector('.ph'), dot: tile.querySelector('.dot'),
        chip: tile.querySelector('.chip'), name: tile.querySelector('.tname'), sub: tile.querySelector('.tsub'),
      });
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.id = id;
      cell.innerHTML = `<img class="backdrop" alt="" aria-hidden="true"><div class="vid"></div><img class="still" alt=""><div class="cmsg" hidden><span class="cmsg-ic"></span><span class="cmsg-t"></span></div><div class="scrim top"><span class="name"></span><span class="pill"></span></div><div class="scrim bot"><span class="chip mini" hidden></span></div><button type="button" class="hit"></button>`;
      $.grid.append(cell);
      this.cells.set(id, {
        node: cell, vid: cell.querySelector('.vid'), still: cell.querySelector('.still'), backdrop: cell.querySelector('.backdrop'),
        name: cell.querySelector('.name'), pill: cell.querySelector('.pill'), chip: cell.querySelector('.chip'), hit: cell.querySelector('.hit'),
        msg: cell.querySelector('.cmsg'), msgIc: cell.querySelector('.cmsg-ic'), msgT: cell.querySelector('.cmsg-t'),
      });
    }
  }

  get gridOn() {
    return this.layout === 'grid' && this.ids.length > 1;
  }

  applyLayout() {
    if (!this.built || !this._hass) return;
    const $ = this.$;
    const grid = this.gridOn;
    $.focus.hidden = grid || !this.ids.length;
    $.grid.hidden = !grid;
    $.empty.hidden = this.ids.length > 0;
    const active = this.attached && !document.hidden;
    if (grid) {
      this.ids.forEach((id, i) => {
        const p = this.players.get(id);
        const cell = this.cells.get(id);
        if (!p || !cell) return;
        p.video.muted = true;
        if (p.mount !== cell.vid) {
          p.unmount();
          p.mountIn(cell.vid);
        } else p.playIfMounted();
        if (active) p.want(p.session ? 0 : i * GRID_STAGGER_MS);
      });
    } else {
      for (const [id, p] of this.players) {
        if (id === this.focusId) continue;
        if (p.mount) p.unmount();
        if (p.wanted) p.release(this.keepWarmMs);
      }
      const p = this.players.get(this.focusId);
      if (p) {
        if (p.mount !== $.vid) {
          p.unmount();
          p.mountIn($.vid);
        } else p.playIfMounted();
        p.video.muted = this.muted;
        if (active) p.want(0);
      }
    }
    this.queueRefresh();
  }

  setLayout(layout) {
    this.layout = layout === 'grid' ? 'grid' : 'focus';
    store.set('layout', this.layout);
    this.applyLayout();
  }

  focus(id) {
    if (!this.players.has(id)) return;
    if (id !== this.focusId) {
      this.focusId = id;
      store.set('focus', id);
    }
    this.applyLayout();
  }

  onCameraEvent(cam, kind) {
    if (kind === 'ring' && this.config.focus_on_ring !== false && this.players.has(cam)) {
      this.focusId = cam;
      this.layout = 'focus';
      this.applyLayout();
    }
    this.queueRefresh();
  }

  toggleSound() {
    this.muted = !this.muted;
    const p = this.players.get(this.focusId);
    if (p) {
      p.video.muted = this.muted;
      if (!this.muted) p.playIfMounted();
    }
    this.queueRefresh();
  }

  fullscreen() {
    const stage = this.$.stage;
    const video = this.players.get(this.focusId)?.video;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.());
    } else {
      video?.webkitEnterFullscreen?.();
    }
  }

  moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  onVisibility() {
    for (const p of this.players.values()) p.pauseRtcWatch();
    if (document.hidden) {
      clearTimeout(this._hiddenTimer);
      this._hiddenTimer = setTimeout(() => {
        for (const p of this.players.values()) p.suspend();
        this.queueRefresh();
      }, HIDDEN_GRACE_MS);
    } else {
      clearTimeout(this._hiddenTimer);
      this._hiddenTimer = 0;
      this.applyLayout();
    }
  }

  tick() {
    const t = now();
    for (const p of this.players.values()) p.tick(t);
    this.refresh();
  }

  queueRefresh() {
    if (this._raf || !this.built) return;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    this._raf = raf(() => {
      this._raf = 0;
      this.refresh();
    });
  }

  refresh() {
    if (!this.built || !this._hass) return;
    const $ = this.$;
    const hass = this._hass;
    const t = now();
    setText($.kicker, this.config.title || 'Cameras');
    let live = 0;
    let offline = 0;
    for (const p of this.players.values()) {
      if (p.offline) offline += 1;
      else if (p.status === 'live' && p.wanted) live += 1;
    }
    setHTML($.sum, `${live ? `<span class="sumc s-live">${live} live</span>` : ''}${offline ? `<span class="sumc s-bad">${offline} offline</span>` : ''}`);
    const grid = this.gridOn;
    $.seg.hidden = this.ids.length < 2;
    for (const b of $.seg.querySelectorAll('button')) {
      const on = b.dataset.layout === (grid ? 'grid' : 'focus');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (!this.ids.length) return;
    if (grid) this.refreshGrid(hass, t);
    else this.refreshStage(hass, t);
    this.refreshRail(hass, t, grid);
  }

  refreshStage(hass, t) {
    const $ = this.$;
    const id = this.focusId;
    const p = this.players.get(id);
    if (!p) return;
    const nest = isNest(hass, id);
    setText($.name, this.nameOf(id));
    setText($.model, cameraModel(hass, id));
    setPill($.pill, pillFor(p, t));
    const aspect = p.aspect();
    const ratio = aspect ? String(Math.round(Math.min(16 / 9, Math.max(0.75, aspect)) * 1000) / 1000) : '';
    if ($.stage.style.aspectRatio !== ratio) $.stage.style.aspectRatio = ratio;
    setSrc($.still, p.still);
    setSrc($.backdrop, p.still);
    $.backdrop.hidden = !p.still;
    $.still.classList.toggle('show', !!p.still && (p.status !== 'live' || p.coverUntil > t));
    const m = stageMessage(p, t, !!p.still, nest);
    $.msg.hidden = !m;
    if (m) {
      setHTML($.msgIc, m.icon === 'spin' ? '<span class="spin"></span>' : ic(m.icon));
      setText($.msgT, m.title);
      setText($.msgD, m.detail);
      $.retry.hidden = !m.retry;
      $.msg.classList.toggle('soft', !!m.soft);
    }
    setHTML($.chips, chipsHTML(this.events.latest(id, t), t));
    setHTML($.sound, ic(this.muted ? 'muted' : 'sound'));
    $.sound.setAttribute('aria-label', this.muted ? 'Turn sound on' : 'Turn sound off');
    $.sound.classList.toggle('on', !this.muted);
    $.sound.hidden = p.protocol === 'mjpeg';
    setText($.metaA, metaLine(p));
    setText($.metaB, todayLine(this.events.today(id)));
  }

  refreshRail(hass, t, grid) {
    for (const [id, tile] of this.tiles) {
      const p = this.players.get(id);
      if (!p) continue;
      const on = !grid && id === this.focusId;
      tile.node.classList.toggle('on', on);
      tile.node.setAttribute('aria-pressed', String(on));
      const name = this.nameOf(id);
      tile.node.setAttribute('aria-label', `Show ${name}`);
      setText(tile.name, name);
      setSrc(tile.img, p.still);
      tile.img.hidden = !p.still;
      tile.ph.hidden = !!p.still;
      tile.dot.className = `dot ${dotFor(p)}`;
      const last = this.events.latest(id, t)[0];
      tile.chip.hidden = !last;
      if (last) {
        tile.chip.className = `chip mini k-${last.kind}${t - last.ts < 120000 ? ' fresh' : ''}`;
        setHTML(tile.chip, `${ic(EVENT_ICON[last.kind])}<span>${esc(ago(last.ts, t))}</span>`);
      }
      setText(tile.sub, tileSub(p, t, on));
    }
  }

  refreshGrid(hass, t) {
    for (const [id, cell] of this.cells) {
      const p = this.players.get(id);
      if (!p) continue;
      const name = this.nameOf(id);
      setText(cell.name, name);
      cell.hit.setAttribute('aria-label', `Show ${name} large`);
      setPill(cell.pill, pillFor(p, t));
      setSrc(cell.still, p.still);
      setSrc(cell.backdrop, p.still);
      cell.backdrop.hidden = !p.still;
      cell.still.classList.toggle('show', !!p.still && (p.status !== 'live' || p.coverUntil > t));
      const m = stageMessage(p, t, !!p.still, isNest(hass, id));
      cell.msg.hidden = !m;
      if (m) {
        setHTML(cell.msgIc, m.icon === 'spin' ? '<span class="spin"></span>' : ic(m.icon));
        setText(cell.msgT, m.title);
      }
      const last = this.events.latest(id, t)[0];
      cell.chip.hidden = !last;
      if (last) {
        cell.chip.className = `chip mini k-${last.kind}${t - last.ts < 120000 ? ' fresh' : ''}`;
        setHTML(cell.chip, `${ic(EVENT_ICON[last.kind])}<span>${EVENT_LABEL[last.kind]}</span><b>${esc(ago(last.ts, t))}</b>`);
      }
    }
  }
}

// =================================================================== wall

// A full-screen wall view for a desktop or wall tablet: live cameras on the left;
// the family radar, the family map and inside air on the right.
//
//   type: custom:nourie-wall-card
//   audio: false                            default; request video only and reduce Wall browser work
//                                           true restores audio negotiation, frame callbacks and periodic previews
//   connection_diagnostics: false           opt in to bounded failure metrics in HA system_log (no raw errors/URLs)
//   preferred_protocol: auto                auto or hls; HLS uses HA's low latency HTTP stream when supported
//                                           (HLS opens a second Nest stream per camera; WebRTC shares go2rtc's)
//   hls_fallback: false                     true switches a camera to HLS after repeated WebRTC stalls
//   smooth: true                            reorder and pace frames on a canvas (fixes jerky B-frame cameras)
//   transport: tcp                          tcp = video over go2rtc's TCP port (lossless; falls back to UDP
//                                           on its own when TCP isn't offered or fails); auto = browser picks
//   camera_priority: false                  maximize the camera grid; side panel uses space only while visible
//   air_visible: true                       false hides the Inside air panel
//   air_visibility: always                  always or family (show air only with the family panel)
//   cameras: [camera.driveway, camera.front_door, camera.hallway, camera.living_room]
//   people: [person.dan, person.alicia]      optional; default is every person with a tracker
//   location_sources:                       optional; use these trackers for location/status, keeping person names/photos
//     person.dan: device_tracker.life360_dan
//   air: [{device: Angelroom, name: Angel}]  optional; only these air monitors, in this order, with these names
//   air_exclude: [Master blue]               optional; device names to leave out of Inside air
//   fit: contain                             contain (whole picture) or cover (fill each tile)
//   family_visibility: always                always or driving (only current drivers)
//   family_view: radar_map                   radar_map or map

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const PERSON_COLORS = ['#b197ff', '#4de3ff', '#ff7ab6', '#a6e35a', '#ffb547', '#5ad1c8', '#ff8f6b'];
const LEVEL_TONES = ['good', 'lime', 'fair', 'poor', 'bad'];
const AIR_STEPS = { co2: [600, 1000, 1500, 2000], pm25: [5, 12, 35.4, 55.4], pm10: [20, 54, 154, 254] };
const OUTSIDE_RE = /\b(outside|outdoors?|exterior|yard|patio|porch|garden)\b/i;
const SIDE_REFRESH_MS = 3000;

const toNum = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function fmtNum(value, digits = 0) {
  const n = toNum(value);
  if (n === null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function levelOf(metric, value) {
  const steps = AIR_STEPS[metric];
  const n = toNum(value);
  if (!steps || n === null) return null;
  const i = steps.findIndex((s) => n <= s);
  return i === -1 ? 4 : i;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

function fmtDistance(km, metric) {
  if (km === null || km === undefined) return '';
  const d = metric ? km : km * 0.621371;
  if (d < 0.1) return 'nearby';
  return `${d < 10 ? d.toFixed(1) : Math.round(d).toLocaleString()} ${metric ? 'km' : 'mi'}`;
}

let leafletPromise = null;
function loadLeaflet() {
  if (globalThis.L?.map) return Promise.resolve(globalThis.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.async = true;
      script.onload = () => (globalThis.L?.map ? resolve(globalThis.L) : reject(new Error('The map did not start')));
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error('The map could not load'));
      };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

// ------------------------------------------------------------- family

function homeOf(hass) {
  const zone = hass.states?.['zone.home'];
  const lat = toNum(zone?.attributes?.latitude ?? hass.config?.latitude);
  const lon = toNum(zone?.attributes?.longitude ?? hass.config?.longitude);
  return lat === null || lon === null ? null : { lat, lon, radius: toNum(zone?.attributes?.radius) || 100 };
}

function zonesOf(hass) {
  return Object.keys(hass.states || {})
    .filter((id) => id.startsWith('zone.'))
    .map((id) => {
      const a = hass.states[id].attributes || {};
      return { id, name: a.friendly_name || id.slice(5), lat: toNum(a.latitude), lon: toNum(a.longitude), radius: toNum(a.radius) || 100, home: id === 'zone.home', passive: !!a.passive };
    })
    .filter((z) => z.lat !== null && z.lon !== null && !z.passive);
}

export function trackerDriving(tracker, isHome = false) {
  if (!tracker || typeof tracker.state !== 'string' || ['unknown', 'unavailable'].includes(tracker.state.toLowerCase())) return false;
  const a = tracker.attributes || {};
  const raw = a.driving;
  if (typeof raw === 'boolean') return raw;
  if (raw === 1 || raw === 0) return raw === 1;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(value)) return true;
    if (['false', 'off', 'no', '0'].includes(value)) return false;
  }
  if (tracker.state.toLowerCase() === 'driving') return true;
  // Life360 supplies an explicit driving flag. Only use another tracker's speed
  // when its units are supplied; an unlabeled number is not evidence of driving.
  if (isHome) return false;
  const speed = toNum(a.speed);
  const unit = String(a.speed_unit || a.speed_units || a.speed_unit_of_measurement || a.unit_of_measurement || '').trim().toLowerCase();
  const factor = { 'm/s': 1, 'km/h': 1 / 3.6, kph: 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, 'mi/h': 0.44704 }[unit];
  return speed !== null && factor !== undefined && speed * factor > 6;
}

function personOf(hass, id, index, home, locationId) {
  const st = hass.states[id];
  const a = st.attributes || {};
  const trackers = Array.isArray(a.device_trackers) ? a.device_trackers : [];
  const explicitSource = locationId !== undefined;
  const trackerId = explicitSource ? locationId : trackers.find((t) => hass.entities?.[t]?.platform === 'life360') || a.source || trackers[0] || null;
  const tracker = trackerId && hass.states[trackerId];
  // An explicit source must never fall back to a different phone or a wall tablet.
  const unavailable = explicitSource && (!tracker || ['unknown', 'unavailable'].includes(tracker.state));
  const t = (!unavailable && tracker?.attributes) || {};
  const state = explicitSource ? (unavailable ? 'unavailable' : tracker.state) : st.state;
  const lat = toNum(explicitSource ? t.latitude : a.latitude ?? t.latitude);
  const lon = toNum(explicitSource ? t.longitude : a.longitude ?? t.longitude);
  const isHome = state === 'home';
  const name = String(a.friendly_name || id.split('.')[1].replace(/_/g, ' ')).replace(/\s+/g, ' ').trim();
  const distKm = home && lat !== null && lon !== null ? distanceKm(home.lat, home.lon, lat, lon) : null;
  return {
    id,
    name,
    first: name.split(' ')[0],
    picture: a.entity_picture || '',
    color: PERSON_COLORS[index % PERSON_COLORS.length],
    state,
    isHome,
    zone: !isHome && !['not_home', 'unknown', 'unavailable'].includes(state) ? state : '',
    lat,
    lon,
    accuracy: toNum(explicitSource ? t.gps_accuracy : a.gps_accuracy ?? t.gps_accuracy),
    distKm,
    bearing: distKm !== null && distKm > 0.05 ? bearingDeg(home.lat, home.lon, lat, lon) : null,
    driving: trackerDriving(tracker, isHome),
  };
}

// People are person entities that have a tracker, so service accounts stay out.
export function familyOf(hass, config = {}) {
  const states = hass?.states || {};
  const home = homeOf(hass);
  const ids = Array.isArray(config.people)
    ? config.people.filter((id) => states[id])
    : Object.keys(states).filter((id) => id.startsWith('person.') && (states[id].attributes?.device_trackers || []).length).sort();
  const people = ids.map((id, i) => personOf(hass, id, i, home, config.location_sources?.[id]));
  people.sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.name.localeCompare(b.name));
  return { home, zones: zonesOf(hass), people, metric: hass?.config?.unit_system?.length === 'km' };
}

export function familyPresentation(fam, config = {}) {
  const drivingOnly = config.family_visibility === 'driving';
  const people = drivingOnly ? fam.people.filter((p) => p.driving) : fam.people;
  return {
    visible: !drivingOnly || people.length > 0,
    drivingOnly,
    mapOnly: config.family_view === 'map',
    family: drivingOnly ? { ...fam, people, zones: fam.zones.filter((z) => z.home) } : fam,
  };
}

export function compassLabel(bearing) {
  if (!Number.isFinite(bearing)) return '';
  return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((bearing % 360) + 360) % 360 / 22.5) % 16];
}

function personStatus(p, metric) {
  if (p.driving) return 'Driving';
  if (p.isHome) return 'Home';
  if (p.zone) return p.zone;
  if (p.distKm !== null) return `${fmtDistance(p.distKm, metric)}${compassLabel(p.bearing) ? ` ${compassLabel(p.bearing)}` : ''}`;
  if (p.state === 'not_home') return 'Away';
  return 'No location';
}

function avatarHtml(p, cls = '') {
  const initials = p.name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="ava ${cls}" style="--pc:${p.color}">${p.picture ? `<img src="${esc(p.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials)}${p.driving ? `<i class="ava-b">${ic('car')}</i>` : ''}</span>`;
}

// Every visible person pin is centered on their true position. Never displace
// pins for overlap: the family chips above supply names and presence separately.
export function radarGeometry(fam) {
  const metric = fam.metric;
  const unit = metric ? 'km' : 'mi';
  const toUnit = (km) => (metric ? km : km * 0.621371);
  const radius = 92;
  const away = fam.people.filter((p) => !p.isHome && Number.isFinite(p.distKm) && p.distKm >= 0).map((p) => {
    // familyOf suppresses bearings inside 50 m; valid nearby coordinates still
    // deserve a measured point instead of disappearing or being marked Home.
    const hasCoords = [fam.home?.lat, fam.home?.lon, p.lat, p.lon].every(Number.isFinite);
    const bearing = Number.isFinite(p.bearing) ? p.bearing : p.distKm === 0 ? 0 : hasCoords ? bearingDeg(fam.home.lat, fam.home.lon, p.lat, p.lon) : null;
    return { p, bearing };
  }).filter((m) => Number.isFinite(m.bearing));
  const farthest = Math.max(1, ...away.map(({ p }) => toUnit(p.distKm)));
  const magnitude = 10 ** Math.floor(Math.log10(farthest));
  const maxDistance = [1, 2, 5, 10].find((n) => n * magnitude >= farthest * (1 - Number.EPSILON * 4)) * magnitude;
  const rOf = (d) => (d / maxDistance) * radius;
  const rings = [0.25, 0.5, 0.75, 1].map((fraction) => ({ d: fraction * maxDistance, r: fraction * radius }));
  const marks = [];
  for (const { p, bearing } of away) {
    const r = rOf(toUnit(p.distKm));
    const b = (bearing * Math.PI) / 180;
    marks.push({ p, x: Math.sin(b) * r, y: -Math.cos(b) * r, bearing, away: true });
  }
  return { unit, radius, maxDistance, rings, marks };
}

// Nearby people are easier to pick out; distant people stay readable. Size
// depends on distance from home, while each marker's center stays in place.
export function radarPinRadius(distKm) {
  if (!Number.isFinite(distKm) || distKm < 0) return 7;
  return clampNum(7 + 4 / (1 + distKm / 32), 7, 11);
}

export function radarHtml(fam) {
  const { unit, radius, maxDistance, rings, marks } = radarGeometry(fam);
  const ringLabel = (d) => d.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const svg = `<svg class="radar-svg" viewBox="-100 -100 200 200" aria-hidden="true">
      ${rings.map((g, i) => `<circle class="rr${i < rings.length - 1 ? ' dash' : ''}" r="${g.r.toFixed(1)}"/><text class="rl" x="2" y="${(-g.r + 7).toFixed(1)}">${ringLabel(g.d)} ${unit}</text>`).join('')}
      <path class="rx" d="M0 -${radius} V${radius} M-${radius} 0 H${radius}"/>
      <text class="rl n" x="0" y="-${radius + 3}" text-anchor="middle">N</text>
      <text class="rl" x="0" y="98" text-anchor="middle">Linear distance from home</text>
    </svg>`;
  const pins = marks.map(({ p, x, y, bearing }) => {
    const label = `${p.name} · ${fmtDistance(p.distKm, fam.metric)} ${compassLabel(bearing)} from home`;
    const initial = (p.first || p.name || '?').slice(0, 1).toUpperCase();
    const pinRadius = radarPinRadius(p.distKm);
    return `<g class="radar-pin" data-person="${esc(p.id)}" style="--pc:${p.color}" transform="translate(${x.toFixed(3)} ${y.toFixed(3)})" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><circle class="radar-location" r="${pinRadius.toFixed(2)}"/><text class="radar-initial" style="font-size:${(pinRadius * 1.25).toFixed(2)}px" text-anchor="middle" dominant-baseline="central">${esc(initial)}</text></g>`;
  }).join('');
  const points = `<svg class="radar-svg radar-points" viewBox="-100 -100 200 200" role="group" aria-label="Family locations">${pins}</svg>`;
  return `<div class="radar-box" title="Distance from home; outer ring ${ringLabel(maxDistance)} ${unit}"><div class="sweep"></div>${svg}<span class="rm-home" title="Home">${ic('home')}</span>${points}</div>`;
}

function peopleHtml(fam, drivingOnly = false) {
  if (!fam.people.length) return '<span class="none">Add a person with a phone tracker in Home Assistant and they show up here.</span>';
  return fam.people
    .map((p) => {
      const status = drivingOnly ? (p.distKm === null ? 'Location unavailable' : `${fmtDistance(p.distKm, fam.metric)} ${compassLabel(p.bearing)}`.trim()) : personStatus(p, fam.metric);
      const tone = p.isHome ? 'home' : p.lat !== null ? 'away' : 'unknown';
      return `<span class="who-chip ${tone}" style="--pc:${p.color}">${avatarHtml(p, 'xs')}<b>${esc(p.first)}</b><small>${esc(status)}</small></span>`;
    })
    .join('');
}

function tileLayers() {
  const esri = { attribution: `Tiles &copy; Esri &mdash; Esri, HERE, Garmin, ${OSM_CREDIT}`, maxNativeZoom: 16, maxZoom: 19 };
  return [
    { url: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, options: esri },
    { url: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, options: { maxNativeZoom: 16, maxZoom: 19, className: 'nc-labels' } },
  ];
}

// ------------------------------------------------------------------- air

// One row per indoor air monitor: PM0.3 particles and PM2.5 (or PM10); CO2 is not displayed.
// With air: set, only those monitors show, in that order, under the names given.
export function airRoomsOf(hass, config = {}) {
  const S = hass?.states || {};
  const E = hass?.entities || {};
  const D = hass?.devices || {};
  const A = hass?.areas || {};
  const pins = Array.isArray(config.air)
    ? config.air.map((x) => (typeof x === 'string' ? { device: x } : x)).filter((x) => x && typeof x.device === 'string')
    : null;
  const pinned = pins ? new Map(pins.map((x) => [x.device.trim().toLowerCase(), x])) : null;
  const exclude = new Set((Array.isArray(config.air_exclude) ? config.air_exclude : []).map((x) => String(x).toLowerCase()));
  const rooms = new Map();
  for (const id of Object.keys(S)) {
    if (!id.startsWith('sensor.')) continue;
    const ent = E[id];
    if (!ent?.device_id || ent.hidden || ent.entity_category) continue;
    const st = S[id];
    const objectId = id.slice(7);
    const label = `${objectId} ${st.attributes?.friendly_name || ''}`;
    const dc = st.attributes?.device_class;
    let metric = null;
    if (/(^|[_\s])pm0[_.]?3([_\s]|$)|pm\s?0\.3/i.test(label)) metric = 'pm03';
    else if (/raw|count/i.test(objectId)) metric = null;
    else if (dc === 'carbon_dioxide') metric = 'co2';
    else if (dc === 'pm25') metric = 'pm25';
    else if (dc === 'pm10') metric = 'pm10';
    if (!metric) continue;
    const device = D[ent.device_id] || {};
    const deviceName = String(device.name_by_user || device.name || '').trim();
    const area = A[ent.area_id || device.area_id]?.name || '';
    if (!deviceName) continue;
    if (pinned) {
      if (!pinned.has(deviceName.toLowerCase())) continue;
    } else if (OUTSIDE_RE.test(deviceName) || OUTSIDE_RE.test(area) || exclude.has(deviceName.toLowerCase())) continue;
    if (!rooms.has(ent.device_id)) {
      const name = pinned?.get(deviceName.toLowerCase())?.name || deviceName;
      const sub = /^(all|none)$/i.test(area) || area.toLowerCase() === String(name).toLowerCase() ? '' : area;
      rooms.set(ent.device_id, { key: ent.device_id, deviceName, name, area: sub, ids: {}, values: {} });
    }
    const room = rooms.get(ent.device_id);
    if (room.ids[metric]) continue;
    room.ids[metric] = id;
    room.values[metric] = toNum(st.state);
  }
  const list = [...rooms.values()].map((r) => {
    const levels = ['pm25', 'pm10'].map((k) => levelOf(k, r.values[k])).filter((l) => l !== null);
    const offline = ['pm03', 'pm25', 'pm10'].every((k) => r.values[k] == null);
    return { ...r, offline, level: levels.length ? Math.max(...levels) : null };
  });
  if (pins) {
    const order = pins.map((x) => x.device.trim().toLowerCase());
    return list.sort((a, b) => order.indexOf(a.deviceName.toLowerCase()) - order.indexOf(b.deviceName.toLowerCase()));
  }
  return list.sort((a, b) => Number(a.offline) - Number(b.offline) || Number(!a.ids.pm03) - Number(!b.ids.pm03) || a.name.localeCompare(b.name));
}

function airValue(label, metric, value) {
  const level = levelOf(metric, value);
  const digits = metric === 'pm25' && toNum(value) !== null && value < 10 ? 1 : 0;
  return `<span class="rv t-${level === null ? 'dim' : LEVEL_TONES[level]}">${label} <b>${fmtNum(value, digits)}</b></span>`;
}

function airRowHtml(r, maxPm03) {
  const tone = r.offline || r.level === null ? 'dim' : LEVEL_TONES[r.level];
  const pm = r.values.pm03;
  const width = pm === null || pm === undefined || !maxPm03 ? 0 : clampNum((pm / maxPm03) * 100, 2, 100);
  const pmCell = r.ids.pm03
    ? `<span class="pm"><span class="pm-v"><b>${fmtNum(pm)}</b><small>/dL</small></span><span class="bar"><i style="width:${width.toFixed(1)}%"></i></span></span>`
    : '<span class="pm none"><small>No PM0.3 sensor</small></span>';
  const values = [];
  if (r.ids.pm25) values.push(airValue('PM2.5', 'pm25', r.values.pm25));
  else if (r.ids.pm10) values.push(airValue('PM10', 'pm10', r.values.pm10));
  const secondary = r.offline ? '<small>Offline</small>' : values.join('');
  const target = r.ids.pm03 || r.ids.pm25 || r.ids.pm10;
  return `<button type="button" class="room t-${tone}${r.offline ? ' off' : ''}${secondary ? '' : ' no-secondary'}" data-entity="${esc(target || '')}" ${target ? '' : 'disabled '}aria-label="${esc(r.name)} ${target ? 'air history' : 'particulate measurements unavailable'}">
      <span class="rname"><i class="rdot"></i><span><b>${esc(r.name)}</b>${r.area ? `<small>${esc(r.area)}</small>` : ''}</span></span>
      ${pmCell}
      ${secondary ? `<span class="rvals">${secondary}</span>` : ''}
    </button>`;
}

// ----------------------------------------------------------------- styles

const WALL_STYLES = `
:host {
  /* Wall: cameras fill the left two-thirds in a 2x2 grid; a fixed-width column on the right holds family and air. */
  --nc-bg: #050d18;
  --nc-ink: #e9f5ff;
  --nc-dim: #93abc4;
  --nc-faint: #637d97;
  --nc-line: rgba(124, 214, 255, 0.14);
  --nc-line-2: rgba(124, 214, 255, 0.26);
  --nc-panel: rgba(12, 28, 46, 0.62);
  --nc-veil: rgba(4, 12, 22, 0.72);
  --nc-screen: #02070e;
  --nc-cyan: #4de3ff;
  --nc-amber: #ffb547;
  --nc-bad: #ff5470;
  --nc-violet: #b197ff;
  --nc-good: #43e08e;
  --nc-lime: #a6e35a;
  --nc-fair: #ffd65c;
  --nc-poor: #ff9447;
  --nc-display: "Chakra Petch", "Rajdhani", "Segoe UI", system-ui, sans-serif;
  --nc-body: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  display: block;
  container-type: inline-size;
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; -webkit-tap-highlight-color: transparent; }
button:focus-visible { outline: 2px solid var(--nc-cyan); outline-offset: 2px; }
.ic { width: 1em; height: 1em; display: block; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.t-good { --tone: var(--nc-good); } .t-lime { --tone: var(--nc-lime); } .t-fair { --tone: var(--nc-fair); }
.t-poor { --tone: var(--nc-poor); } .t-bad { --tone: var(--nc-bad); } .t-dim { --tone: var(--nc-faint); }

.wall { position: relative; isolation: isolate; height: var(--nc-wall-height, calc(100vh - var(--header-height, 56px))); min-height: 560px; display: grid; grid-template-columns: minmax(0, 1fr) clamp(340px, 29%, 560px); gap: 10px; padding: 10px; background: var(--nc-bg); color: var(--nc-ink); font: 400 14px/1.4 var(--nc-body); -webkit-font-smoothing: antialiased; overflow: hidden; }
.wall::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(60% 45% at 0% 0%, rgba(77, 227, 255, .1), transparent 70%), radial-gradient(50% 40% at 100% 100%, rgba(177, 151, 255, .08), transparent 70%); }

.cams { display: grid; gap: 10px; min-height: 0; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
.cams[data-n="1"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.cams[data-n="2"] { grid-template-rows: minmax(0, 1fr); }
.cams[data-n="5"], .cams[data-n="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cams.solo .cell:not(.on) { display: none; }
.cams.solo .cell.on { grid-column: 1 / -1; grid-row: 1 / -1; }

.cell { position: relative; min-height: 0; min-width: 0; overflow: hidden; border-radius: 16px; background: var(--nc-screen); border: 1px solid var(--nc-line-2); }
.cell.ring { border-color: var(--nc-violet); box-shadow: 0 0 0 1px var(--nc-violet), 0 0 28px -6px rgba(177, 151, 255, .9); }
.backdrop { position: absolute; inset: -24px; width: calc(100% + 48px); height: calc(100% + 48px); max-width: none; object-fit: cover; filter: blur(24px) brightness(.42) saturate(1.15); pointer-events: none; }
.vid { position: absolute; inset: 0; }
.vid > video, .vid > img { width: 100%; height: 100%; display: block; object-fit: var(--nc-fit, contain); background: transparent; }
.vid > canvas.smooth { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: var(--nc-fit, contain); }
.vid > canvas.smooth[hidden] { display: none; }
.still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: var(--nc-fit, contain); opacity: 0; transition: opacity .35s ease; pointer-events: none; }
.still.show { opacity: 1; }
.scrim { position: absolute; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; pointer-events: none; }
.scrim.top { top: 0; padding: 12px 12px 28px; background: linear-gradient(rgba(2, 7, 14, .7), rgba(2, 7, 14, 0)); }
.scrim.bot { bottom: 0; padding: 26px 10px 10px; background: linear-gradient(rgba(2, 7, 14, 0), rgba(2, 7, 14, .6)); }
/* The connection plot overlays the feed; it never takes grid or video space. */
.connection-slot { position: absolute; z-index: 3; right: 10px; bottom: 10px; width: 170px; pointer-events: auto; }
.connection { padding: 5px 7px 4px; border-radius: 8px; background: rgba(3, 12, 21, .76); color: var(--nc-cyan); border: 1px solid var(--nc-line-2); backdrop-filter: blur(5px); font: 500 10px/1.15 var(--nc-display); font-variant-numeric: tabular-nums; }
.connection-label, .connection-caption { display: flex; align-items: center; justify-content: space-between; gap: 6px; white-space: nowrap; }
.connection-label > span { overflow: hidden; text-overflow: ellipsis; }
.connection-label b { flex: none; font-weight: 600; }
.connection svg { display: block; width: 100%; height: 19px; overflow: visible; }
.connection-line { fill: none; stroke: currentColor; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.connection-base { fill: none; stroke: currentColor; opacity: .24; stroke-width: .7; }
.connection circle { fill: currentColor; }
.connection-caption { font-size: 9px; color: var(--nc-dim); }
.connection-wait { color: var(--nc-amber); }
.cell .connection-slot ~ .tool { bottom: 66px; }
.camera-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.reconnect { position: relative; z-index: 3; pointer-events: auto; display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 8px; color: var(--nc-cyan); background: var(--nc-veil); border: 1px solid var(--nc-line-2); }
.reconnect:disabled { opacity: .4; cursor: default; }
.cname { font: 600 16px/1.1 var(--nc-display); letter-spacing: .01em; text-shadow: 0 1px 8px rgba(0, 0, 0, .6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hit { position: absolute; inset: 0; z-index: 2; }
.cell .tool { position: absolute; right: 10px; bottom: 10px; z-index: 3; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; font-size: 17px; color: var(--nc-ink); background: var(--nc-veil); border: 1px solid var(--nc-line-2); opacity: 0; transition: opacity .2s; }
.cell:hover .tool, .cell.on .tool, .cell .tool:focus-visible { opacity: 1; }

.pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; flex: none; white-space: nowrap; font: 600 11px/1 var(--nc-display); letter-spacing: .12em; text-transform: uppercase; font-variant-numeric: tabular-nums; color: var(--nc-dim); background: var(--nc-veil); border: 1px solid var(--nc-line-2); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.pill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.pill .n { margin-left: -2px; text-transform: none; letter-spacing: .03em; }
.p-live { color: var(--nc-cyan); border-color: rgba(77, 227, 255, .42); }
.p-live::before { animation: beat 1.8s ease-out infinite; }
.p-wait { color: var(--nc-amber); border-color: rgba(255, 181, 71, .42); }
.p-wait::before { animation: blink 1s steps(2, start) infinite; }
.p-bad { color: var(--nc-bad); border-color: rgba(255, 84, 112, .45); }
.p-idle { color: var(--nc-faint); }
@keyframes beat { 0% { box-shadow: 0 0 0 0 rgba(77, 227, 255, .65); } 70%, 100% { box-shadow: 0 0 0 7px rgba(77, 227, 255, 0); } }
@keyframes blink { to { opacity: .25; } }
.chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px 0 6px; border-radius: 999px; white-space: nowrap; font-size: 11.5px; font-weight: 600; color: var(--nc-ink); background: var(--nc-veil); border: 1px solid var(--nc-line-2); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.chip .ic { font-size: 13px; color: var(--nc-dim); }
.chip b { font-weight: 500; color: var(--nc-dim); font-variant-numeric: tabular-nums; }
.chip.k-ring .ic { color: var(--nc-violet); }
.chip.fresh { border-color: rgba(255, 181, 71, .6); }
.chip.fresh .ic { color: var(--nc-amber); }
.cmsg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 6px; padding: 44px 16px 16px; text-align: center; font-size: 13px; color: var(--nc-dim); }
.cmsg-ic { font-size: 24px; display: grid; place-items: center; min-height: 24px; }
.spin { width: 24px; height: 24px; border-radius: 50%; border: 2px solid rgba(77, 227, 255, .2); border-top-color: var(--nc-cyan); animation: turn .9s linear infinite; }
@keyframes turn { to { transform: rotate(360deg); } }

.side { display: flex; flex-direction: column; gap: 10px; min-height: 0; min-width: 0; }
.panel { position: relative; border-radius: 18px; background: linear-gradient(180deg, rgba(20, 44, 70, .5), rgba(9, 23, 39, .72)); border: 1px solid var(--nc-line); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .04); }
.sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px 0; }
.kicker { display: inline-flex; align-items: center; gap: 8px; font: 600 12.5px/1 var(--nc-display); letter-spacing: .16em; text-transform: uppercase; }
.kicker .ic { font-size: 16px; color: var(--nc-cyan); }
.sec small { font-size: 11.5px; color: var(--nc-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }

.fam { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.people { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px 0; }
.people .none, .radar .none { font-size: 12px; color: var(--nc-faint); text-align: center; }
.who-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 3px; border-radius: 999px; background: rgba(4, 12, 22, .55); border: 1px solid var(--nc-line); white-space: nowrap; }
.who-chip b { font-size: 12.5px; font-weight: 600; }
.who-chip small { font-size: 11.5px; color: var(--nc-dim); }
.who-chip.home small { color: var(--nc-cyan); }
.who-chip.unknown { opacity: .7; }
.who-chip.unknown small { color: var(--nc-faint); }
.radar { position: relative; flex: 0 0 auto; height: clamp(170px, 30vh, 340px); container-type: size; display: grid; place-items: center; margin: 4px 12px 0; }
.radar-box { position: relative; width: min(100cqw, 100cqh); height: min(100cqw, 100cqh); }
.radar-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.radar-points { z-index: 3; pointer-events: none; }
.radar-pin { pointer-events: all; }
.radar-location { fill: var(--pc); stroke: #06101c; stroke-width: 1; }
.radar-initial { fill: #06101c; font: 700 7px var(--nc-display); }
.rr { fill: none; stroke: rgba(124, 214, 255, .2); stroke-width: .6; }
.rr.dash { stroke-dasharray: 1.5 3; stroke: rgba(124, 214, 255, .16); }
.rx { stroke: rgba(124, 214, 255, .07); stroke-width: .5; }
.rl { fill: #637d97; font: 600 5.5px var(--nc-display); letter-spacing: .08em; }
.rl.n { fill: #93abc4; }
.sweep { position: absolute; inset: 4%; border-radius: 50%; background: conic-gradient(from 0deg, rgba(77, 227, 255, .2), rgba(77, 227, 255, 0) 24%, transparent); animation: turn 8s linear infinite; }
.rm-home { position: absolute; z-index: 1; left: 50%; top: 50%; width: 20px; height: 20px; transform: translate(-50%, -50%); display: grid; place-items: center; font-size: 14px; color: var(--nc-cyan); }
.ava { position: relative; display: grid; place-items: center; flex: none; width: 38px; height: 38px; border-radius: 50%; font: 600 14px/1 var(--nc-display); color: #06101c; background: var(--pc); box-shadow: 0 0 0 2px #06101c, 0 0 0 3.5px var(--pc), 0 0 16px -2px var(--pc); }
.ava img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.ava.sm { width: 32px; height: 32px; font-size: 12px; }
.ava.xs { width: 22px; height: 22px; font-size: 9.5px; box-shadow: 0 0 0 1.5px #06101c, 0 0 0 2.5px var(--pc); }
.ava-b { position: absolute; right: -6px; bottom: -6px; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; font-size: 11px; font-style: normal; color: var(--nc-amber); background: #0b1c2f; border: 1px solid var(--nc-line-2); }
.map { position: relative; flex: 1 1 0; min-height: 140px; margin: 10px 12px 12px; border-radius: 14px; overflow: hidden; border: 1px solid var(--nc-line); background: #07121f; }
.map-canvas { position: absolute; inset: 0; }
.map-msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 6px; padding: 16px; text-align: center; font-size: 12.5px; color: var(--nc-dim); }
.map-msg .ic { font-size: 22px; color: var(--nc-faint); }
.nc-marker { background: none; border: 0; }
.mk { position: relative; width: 40px; height: 40px; }
.mk .ava { width: 40px; height: 40px; font-size: 14px; }
.mk-home { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; font-size: 15px; color: var(--nc-cyan); background: rgba(5, 13, 24, .9); box-shadow: 0 0 0 1.5px rgba(77, 227, 255, .7), 0 0 18px rgba(77, 227, 255, .5); }
.mk-zone { display: inline-block; transform: translate(-50%, -50%); padding: 2px 8px; border-radius: 999px; font: 600 10.5px var(--nc-body); white-space: nowrap; color: var(--nc-dim); background: rgba(5, 13, 24, .8); border: 1px solid var(--nc-line); }

.air { flex: 0 1 auto; min-height: 0; max-height: 46%; display: flex; flex-direction: column; }
.rooms { display: grid; gap: 6px; padding: 10px 10px 12px; overflow-y: auto; min-height: 0; scrollbar-width: thin; }
.room { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 12px; background: rgba(4, 12, 22, .45); border: 1px solid var(--nc-line); }
.room.no-secondary { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
.room:hover { border-color: var(--nc-line-2); }
.room.off { opacity: .55; }
.rname { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rname > span { display: grid; min-width: 0; }
.rname b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rname small { font-size: 11px; color: var(--nc-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rdot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 8px var(--tone); }
.pm { display: grid; gap: 4px; min-width: 0; }
.pm-v { display: flex; align-items: baseline; gap: 3px; }
.pm-v b { font: 600 18px/1 var(--nc-display); font-variant-numeric: tabular-nums; }
.pm small { font-size: 11px; color: var(--nc-faint); }
.bar { position: relative; height: 4px; border-radius: 2px; background: rgba(124, 214, 255, .12); overflow: hidden; }
.bar i { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: linear-gradient(90deg, rgba(77, 227, 255, .55), var(--nc-cyan)); }
.rvals { display: grid; justify-items: end; gap: 3px; font-variant-numeric: tabular-nums; }
.rv { font-size: 11.5px; color: var(--nc-faint); white-space: nowrap; }
.rv b { font-weight: 600; color: var(--tone); }
.rvals small { font-size: 11.5px; color: var(--nc-faint); }
.air-note { padding: 0 14px 10px; font-size: 11px; color: var(--nc-faint); }

.leaflet-pane, .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-tile-container, .leaflet-pane > svg, .leaflet-pane > canvas, .leaflet-zoom-box, .leaflet-image-layer, .leaflet-layer { position: absolute; left: 0; top: 0; }
.leaflet-container { overflow: hidden; background: #07121f; font: 12px/1.5 var(--nc-body); -webkit-tap-highlight-color: transparent; }
.leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow { -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
.leaflet-marker-icon, .leaflet-marker-shadow { display: block; }
.leaflet-container .leaflet-overlay-pane svg { max-width: none !important; max-height: none !important; }
.leaflet-container .leaflet-marker-pane img, .leaflet-container .leaflet-tile-pane img, .leaflet-container img.leaflet-image-layer, .leaflet-container .leaflet-tile { max-width: none !important; max-height: none !important; width: auto; padding: 0; }
.leaflet-container.leaflet-touch-zoom { touch-action: pan-x pan-y; }
.leaflet-container.leaflet-touch-drag { touch-action: pinch-zoom; }
.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom { touch-action: none; }
.leaflet-tile { filter: inherit; visibility: hidden; }
.leaflet-tile-loaded { visibility: inherit; }
.leaflet-pane { z-index: 400; }
.leaflet-tile-pane { z-index: 200; filter: sepia(.45) hue-rotate(172deg) saturate(2.2) brightness(.82) contrast(1.12); }
.leaflet-tile-pane .nc-labels { filter: brightness(1.6); }
.leaflet-overlay-pane { z-index: 400; }
.leaflet-shadow-pane { z-index: 500; }
.leaflet-marker-pane { z-index: 600; }
.leaflet-tooltip-pane { z-index: 650; }
.leaflet-popup-pane { z-index: 700; }
.leaflet-map-pane canvas { z-index: 100; }
.leaflet-map-pane svg { z-index: 200; }
.leaflet-control { position: relative; z-index: 800; pointer-events: auto; float: left; clear: both; }
.leaflet-top, .leaflet-bottom { position: absolute; z-index: 1000; pointer-events: none; }
.leaflet-top { top: 0; }
.leaflet-bottom { bottom: 0; }
.leaflet-left { left: 0; }
.leaflet-right { right: 0; }
.leaflet-bottom .leaflet-control { margin-bottom: 6px; }
.leaflet-left .leaflet-control { margin-left: 8px; }
.leaflet-zoom-animated { transform-origin: 0 0; }
.leaflet-zoom-anim .leaflet-zoom-animated { transition: transform .25s cubic-bezier(0, 0, .25, 1); }
.leaflet-zoom-anim .leaflet-tile, .leaflet-pan-anim .leaflet-tile { transition: none; }
.leaflet-zoom-anim .leaflet-zoom-hide { visibility: hidden; }
.leaflet-interactive { cursor: pointer; }
.leaflet-grab { cursor: grab; }
.leaflet-dragging .leaflet-grab, .leaflet-dragging .leaflet-grab .leaflet-interactive { cursor: grabbing; }
.leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-image-layer, .leaflet-pane > svg path, .leaflet-tile-container { pointer-events: none; }
.leaflet-marker-icon.leaflet-interactive, .leaflet-image-layer.leaflet-interactive, .leaflet-pane > svg path.leaflet-interactive { pointer-events: auto; }
.leaflet-control-attribution { margin: 0; padding: 1px 7px; border-radius: 8px; font-size: 9.5px; line-height: 1.4; color: var(--nc-faint); background: rgba(5, 13, 24, .72); }
.leaflet-control-attribution a { color: var(--nc-dim); text-decoration: none; }
.leaflet-attribution-flag { display: none !important; }

@container (max-width: 980px) {
  .wall { height: auto; min-height: 0; grid-template-columns: minmax(0, 1fr); }
  .cams, .cams[data-n] { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; }
  .cell { aspect-ratio: 16 / 9; }
  .cams.solo .cell.on { grid-row: auto; }
  .radar { height: 300px; }
  .map { flex: none; height: 260px; }
  .air { max-height: none; }
}
/* Camera priority is opt-in: no permanent sidebar, no tile borders or reserved headings. */
.wall.camera-priority { height: var(--nc-wall-height, calc(100vh - var(--header-height, 56px))); min-height: 0; grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 4px; }
.wall.camera-priority.side-visible { grid-template-columns: minmax(0, 1fr) clamp(240px, 22%, 320px); }
.camera-priority .cams { gap: 4px; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
.camera-priority .cams[data-n="1"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.camera-priority .cams[data-n="2"] { grid-template-rows: minmax(0, 1fr); }
.camera-priority .cams[data-n="5"], .camera-priority .cams[data-n="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.camera-priority .cell { aspect-ratio: auto; border: 0; border-radius: 6px; }
.camera-priority .cams.solo .cell.on { grid-row: 1 / -1; }
.camera-priority .side { min-width: 0; min-height: 0; }
.camera-priority .fam { min-height: 0; }
.camera-priority .map { flex: 1 1 0; height: auto; min-height: 0; margin: 8px; border-radius: 8px; }
.camera-priority .sec { padding: 10px 10px 0; }
.camera-priority .people { padding: 8px 10px 0; }

@media (prefers-reduced-motion: reduce) {
  .p-live::before, .p-wait::before, .spin, .sweep { animation: none; }
  .still, .cell .tool { transition: none; }
}
`;

// ------------------------------------------------------------------- card

export class NourieWallCard extends Base {
  constructor() {
    super();
    this._hass = null;
    this.ids = [];
    this.players = new Map();
    this.events = new EventTracker(this);
    this.cells = new Map();
    this.attached = false;
    this.built = false;
    this.listKey = '';
    this.solo = '';
    this.ringUntil = new Map();
    this._raf = 0;
    this._tick = 0;
    this._hiddenTimer = 0;
    this._detachTimer = 0;
    this._sideAt = 0;
    this._sideDirty = true;
    this._map = null;
    this._L = null;
    this._mapLoading = false;
    this._mapFailed = false;
    this._familyVisible = false;
    this._familyDriverIds = '';
    this._mapEpoch = 0;
    this._mapFitFrame = 0;
    this._markers = new Map();
    this._zoneSig = '';
    this._fitSig = null;
    this._onVisibility = () => this.onVisibility();
    this.applyConfig({});
  }

  applyConfig(config) {
    this.config = { ...config };
    this.remember = config.remember_frames !== false;
    this.audioEnabled = config.audio === true;
    this.lowOverhead = !this.audioEnabled;
    // HLS makes Home Assistant open a second Nest stream per camera next to go2rtc's, so it is opt-in only.
    this.rtcStallFallback = config.hls_fallback === true;
    this.preferredProtocol = config.preferred_protocol ?? 'auto';
    this.transport = config.transport === 'auto' ? 'auto' : 'tcp';
    this.smooth = config.smooth !== false;
    this.connectionDiagnostics = config.connection_diagnostics === true;
    this.stallMs = Number(config._stall_ms) || STALL_MS;
    this.lifetimeWindow = Array.isArray(config._lifetime_window) ? config._lifetime_window : LIFETIME_WINDOW_S;
    this.handoffLeadS = Number(config._handoff_lead_s) || HANDOFF_LEAD_S;
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    if (config.audio !== undefined && typeof config.audio !== 'boolean') throw new Error('audio must be true or false');
    if (config.connection_diagnostics !== undefined && typeof config.connection_diagnostics !== 'boolean') throw new Error('connection_diagnostics must be true or false');
    if (config.preferred_protocol !== undefined && !['auto', 'hls'].includes(config.preferred_protocol)) throw new Error('preferred_protocol must be auto or hls');
    if (config.hls_fallback !== undefined && typeof config.hls_fallback !== 'boolean') throw new Error('hls_fallback must be true or false');
    if (config.transport !== undefined && !['tcp', 'auto'].includes(config.transport)) throw new Error('transport must be tcp or auto');
    if (config.family_visibility !== undefined && !['always', 'driving'].includes(config.family_visibility)) throw new Error('family_visibility must be always or driving');
    if (config.family_view !== undefined && !['radar_map', 'map'].includes(config.family_view)) throw new Error('family_view must be radar_map or map');
    if (config.air_visibility !== undefined && !['always', 'family'].includes(config.air_visibility)) throw new Error('air_visibility must be always or family');
    for (const key of ['camera_priority', 'air_visible']) {
      if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new Error(`${key} must be true or false`);
    }
    for (const key of ['cameras', 'people', 'air', 'air_exclude']) {
      if (config[key] !== undefined && !Array.isArray(config[key])) throw new Error(`${key} must be a list`);
    }
    if (config.location_sources !== undefined && (
      !config.location_sources || typeof config.location_sources !== 'object' || Array.isArray(config.location_sources)
      || Object.values(config.location_sources).some((id) => typeof id !== 'string' || !id.trim())
    )) throw new Error('location_sources must map person entity IDs to tracker entity IDs');
    this.applyConfig(config);
    this.listKey = '';
    this._sideDirty = true;
    if (this._hass) {
      this.sync();
      this.refreshSide();
      this._sideDirty = false;
      this._sideAt = now();
    }
  }

  set hass(hass) {
    camLog.hass = hass;
    this._hass = hass;
    if (!this.built) this.build();
    this.sync();
    this.events.update(hass);
    this._sideDirty = true;
    if (this.config.family_visibility === 'driving') {
      const fam = familyOf(hass, this.config);
      const presentation = familyPresentation(fam, this.config);
      const driverIds = presentation.family.people.map((p) => p.id).sort().join('|');
      if (presentation.visible !== this._familyVisible || driverIds !== this._familyDriverIds) {
        // Visibility changes must also cancel a pending map load immediately.
        this.refreshSide(fam);
        this._sideDirty = false;
        this._sideAt = now();
      }
    }
    this.queueRefresh();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 12;
  }

  getGridOptions() {
    return { columns: 'full', rows: 'auto' };
  }

  static getStubConfig() {
    return {};
  }

  connectedCallback() {
    this.attached = true;
    clearTimeout(this._detachTimer);
    this._detachTimer = 0;
    loadFonts();
    if (!this.built) this.build();
    document.addEventListener('visibilitychange', this._onVisibility);
    if (!this._tick) this._tick = setInterval(() => this.tick(), 1000);
    this._sideDirty = true;
    this._sideAt = 0;
    this.applyStreams();
    if (this.familyMapActive()) this._map?.invalidateSize();
  }

  disconnectedCallback() {
    this.attached = false;
    this.stopFamilyMap();
    document.removeEventListener('visibilitychange', this._onVisibility);
    clearTimeout(this._detachTimer);
    this._detachTimer = setTimeout(() => {
      if (this.attached) return;
      clearInterval(this._tick);
      this._tick = 0;
      for (const p of this.players.values()) p.stop();
    }, DETACH_GRACE_MS);
  }

  build() {
    if (this.built) return;
    this.built = true;
    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${WALL_STYLES}</style>
<div class="wall">
  <section class="cams" aria-label="Cameras"></section>
  <aside class="side">
    <section class="fam panel" aria-label="Family">
      <header class="sec"><span class="kicker">${ic('family')}<span class="family-title">Family</span></span><small class="fam-sum"></small></header>
      <div class="people"></div>
      <div class="radar"></div>
      <div class="map"><div class="map-canvas"></div><div class="map-msg" hidden></div></div>
    </section>
    <section class="air panel" aria-label="Inside air">
      <header class="sec"><span class="kicker">${ic('air')}Inside air</span><small>PM0.3 per 100 mL</small></header>
      <div class="rooms"></div>
    </section>
  </aside>
</div>`;
    const q = (s) => root.querySelector(s);
    this.$ = {
      wall: q('.wall'), side: q('.side'), air: q('.air'), cams: q('.cams'), family: q('.fam'), familyTitle: q('.family-title'), famSum: q('.fam-sum'), people: q('.people'), radar: q('.radar'),
      map: q('.map'), mapCanvas: q('.map-canvas'), mapMsg: q('.map-msg'), rooms: q('.rooms'),
    };
    this.$.family.hidden = this.config.family_visibility === 'driving';
    this.$.air.hidden = this.config.air_visible === false || (this.config.air_visibility === 'family' && this.$.family.hidden);
    this.$.radar.hidden = this.config.family_view === 'map';
    this.$.cams.addEventListener('click', (ev) => {
      const reconnect = ev.target.closest('.reconnect');
      const tool = ev.target.closest('.tool');
      const cell = ev.target.closest('.cell');
      if (!cell) return;
      if (reconnect) {
        ev.stopPropagation();
        this.players.get(cell.dataset.id)?.reconnect();
        this.queueRefresh();
        return;
      }
      if (tool) this.moreInfo(cell.dataset.id);
      else this.toggleSolo(cell.dataset.id);
    });
    this.$.rooms.addEventListener('click', (ev) => {
      const row = ev.target.closest('.room');
      if (row?.dataset.entity) this.moreInfo(row.dataset.entity);
    });
    if (globalThis.ResizeObserver) {
      this._resize = new ResizeObserver(() => { if (this.familyMapActive()) this._map?.invalidateSize(); });
      this._resize.observe(this.$.map);
    }
  }

  cameraIds() {
    const hass = this._hass;
    if (Array.isArray(this.config.cameras) && this.config.cameras.length) return this.config.cameras.filter((id, i, all) => hass.states[id] && all.indexOf(id) === i).slice(0, 6);
    return pickCameras(hass, {}).slice(0, 4);
  }

  sync() {
    const hass = this._hass;
    if (!hass || !this.built) return;
    const ids = this.cameraIds();
    const key = ids.map((id) => `${id}:${hass.entities?.[id]?.device_id || ''}:${cameraName(hass, id)}`).join('|');
    if (key === this.listKey) return;
    this.listKey = key;
    for (const [id, p] of this.players) {
      if (!ids.includes(id)) {
        p.stop();
        p.unmount();
        this.players.delete(id);
      }
    }
    for (const id of ids) if (!this.players.has(id)) this.players.set(id, new Player(this, id));
    this.ids = ids;
    this.events.map(hass, ids);
    this.names = new Map();
    const seen = new Map();
    for (const id of ids) {
      const base = cameraName(hass, id);
      const n = (seen.get(base.toLowerCase()) || 0) + 1;
      seen.set(base.toLowerCase(), n);
      this.names.set(id, n === 1 ? base : `${base} ${n}`);
    }
    if (!ids.includes(this.solo)) this.solo = '';
    this.renderCells();
    this.applyStreams();
  }

  renderCells() {
    const $ = this.$;
    for (const p of this.players.values()) p.unmount();
    $.cams.replaceChildren();
    this.cells.clear();
    $.cams.dataset.n = String(this.ids.length);
    $.cams.style.setProperty('--nc-fit', this.config.fit === 'cover' ? 'cover' : 'contain');
    const backdrop = this.lowOverhead && this.config.fit === 'cover' ? '' : '<img class="backdrop" alt="" aria-hidden="true">';
    for (const id of this.ids) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.id = id;
      cell.innerHTML = `${backdrop}<div class="vid"></div><img class="still" alt=""><div class="cmsg" hidden><span class="cmsg-ic"></span><span class="cmsg-t"></span></div><div class="scrim top"><span class="cname"></span><span class="camera-actions"><span class="pill"></span><button type="button" class="reconnect" aria-label="Reconnect camera">${ic('retry')}</button></span></div><div class="scrim bot"><span class="chip" hidden></span></div><div class="connection-slot"></div><button type="button" class="hit"></button><button type="button" class="tool" aria-label="Camera details">${ic('info')}</button>`;
      $.cams.append(cell);
      this.cells.set(id, {
        node: cell, vid: cell.querySelector('.vid'), still: cell.querySelector('.still'), backdrop: cell.querySelector('.backdrop'),
        name: cell.querySelector('.cname'), pill: cell.querySelector('.pill'), reconnect: cell.querySelector('.reconnect'), chip: cell.querySelector('.chip'), hit: cell.querySelector('.hit'),
        connection: cell.querySelector('.connection-slot'),
        msg: cell.querySelector('.cmsg'), msgIc: cell.querySelector('.cmsg-ic'), msgT: cell.querySelector('.cmsg-t'),
      });
    }
  }

  applyStreams() {
    if (!this.built || !this._hass) return;
    const active = this.attached && !document.hidden;
    this.ids.forEach((id, i) => {
      const p = this.players.get(id);
      const cell = this.cells.get(id);
      if (!p || !cell) return;
      p.video.muted = true;
      if (p.mount !== cell.vid) {
        p.unmount();
        p.mountIn(cell.vid);
      } else p.playIfMounted();
      if (active) p.want(p.session ? 0 : i * GRID_STAGGER_MS);
    });
    this.queueRefresh();
  }

  toggleSolo(id) {
    this.solo = this.solo === id ? '' : id;
    this.queueRefresh();
    for (const p of this.players.values()) p.playIfMounted();
  }

  moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  onCameraEvent(cam, kind) {
    if (kind === 'ring') this.ringUntil.set(cam, now() + 30000);
    this.queueRefresh();
  }

  onVisibility() {
    if (document.hidden) this.stopFamilyMap();
    else { this._sideDirty = true; this._sideAt = 0; }
    for (const p of this.players.values()) p.pauseRtcWatch();
    if (document.hidden) {
      clearTimeout(this._hiddenTimer);
      this._hiddenTimer = setTimeout(() => {
        for (const p of this.players.values()) p.suspend();
        this.queueRefresh();
      }, HIDDEN_GRACE_MS);
    } else {
      clearTimeout(this._hiddenTimer);
      this._hiddenTimer = 0;
      this.applyStreams();
    }
  }

  tick() {
    const t = now();
    for (const p of this.players.values()) p.tick(t);
    this.refresh();
  }

  queueRefresh() {
    if (this._raf || !this.built) return;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    this._raf = raf(() => {
      this._raf = 0;
      this.refresh();
    });
  }

  refresh() {
    if (!this.built || !this._hass) return;
    const t = now();
    this.refreshCells(t);
    if (this._sideDirty && t - this._sideAt >= SIDE_REFRESH_MS) {
      this._sideDirty = false;
      this._sideAt = t;
      this.refreshSide();
    }
  }

  refreshCells(t) {
    const hass = this._hass;
    const $ = this.$;
    $.cams.classList.toggle('solo', !!this.solo);
    for (const [id, cell] of this.cells) {
      const p = this.players.get(id);
      if (!p) continue;
      const name = this.names?.get(id) || cameraName(hass, id);
      setText(cell.name, name);
      cell.node.classList.toggle('on', this.solo === id);
      cell.node.classList.toggle('ring', (this.ringUntil.get(id) || 0) > t);
      cell.hit.setAttribute('aria-label', this.solo === id ? `Show all cameras` : `Show ${name} large`);
      cell.reconnect.setAttribute('aria-label', `Reconnect ${name}`);
      cell.reconnect.title = `Reconnect ${name}`;
      cell.reconnect.disabled = !p.canReconnect(t);
      setHTML(cell.connection, connectionGraphHtml(p, t));
      setPill(cell.pill, pillFor(p, t));
      setSrc(cell.still, p.still);
      if (cell.backdrop) {
        setSrc(cell.backdrop, p.still);
        cell.backdrop.hidden = !p.still;
      }
      cell.still.classList.toggle('show', !!p.still && (p.status !== 'live' || p.coverUntil > t));
      const m = stageMessage(p, t, !!p.still, isNest(hass, id));
      cell.msg.hidden = !m;
      if (m) {
        setHTML(cell.msgIc, m.icon === 'spin' ? '<span class="spin"></span>' : ic(m.icon));
        setText(cell.msgT, m.title);
      }
      const last = this.events.latest(id, t)[0];
      cell.chip.hidden = !last;
      if (last) {
        cell.chip.className = `chip k-${last.kind}${t - last.ts < 120000 ? ' fresh' : ''}`;
        setHTML(cell.chip, `${ic(EVENT_ICON[last.kind])}<span>${EVENT_LABEL[last.kind]}</span><b>${esc(ago(last.ts, t))}</b>`);
      }
    }
  }

  refreshSide(sourceFamily = familyOf(this._hass, this.config)) {
    const hass = this._hass;
    const $ = this.$;
    const presentation = familyPresentation(sourceFamily, this.config);
    const fam = presentation.family;
    this._fam = fam;
    this._familyVisible = presentation.visible;
    this._familyDriverIds = presentation.drivingOnly ? fam.people.map((p) => p.id).sort().join('|') : '';
    $.family.hidden = !presentation.visible;
    $.wall.classList.toggle('family-visible', presentation.visible);
    $.radar.hidden = presentation.mapOnly;
    setText($.familyTitle, presentation.drivingOnly ? 'Driving' : 'Family');
    const home = fam.people.filter((p) => p.isHome).length;
    setText($.famSum, presentation.drivingOnly ? `${fam.people.length} driving` : fam.people.length ? `${home} of ${fam.people.length} home` : '');
    if (presentation.visible) {
      setHTML($.people, peopleHtml(fam, presentation.drivingOnly));
      if (!presentation.mapOnly) setHTML($.radar, fam.home ? radarHtml(fam) : '<span class="none">Set your home location in Home Assistant to see the radar.</span>');
      else setHTML($.radar, '');
      this.syncMap(fam);
    } else {
      this.stopFamilyMap();
      setHTML($.people, '');
      setHTML($.radar, '');
    }

    $.wall.classList.toggle('camera-priority', this.config.camera_priority === true);
    $.air.hidden = this.config.air_visible === false || (this.config.air_visibility === 'family' && !presentation.visible);
    $.side.hidden = $.air.hidden && $.family.hidden;
    $.wall.classList.toggle('side-visible', !$.side.hidden);
    if ($.air.hidden) {
      setHTML($.rooms, '');
      return;
    }
    const rooms = airRoomsOf(hass, this.config);
    const maxPm = Math.max(0, ...rooms.map((r) => toNum(r.values.pm03) || 0));
    setHTML($.rooms, rooms.length ? rooms.map((r) => airRowHtml(r, maxPm)).join('') : '<span class="air-note">No indoor air sensors found.</span>');
  }

  familyMapActive() {
    return this.attached && this._familyVisible && !globalThis.document?.hidden;
  }

  stopFamilyMap() {
    this._mapEpoch += 1;
    if (this._mapFitFrame) globalThis.cancelAnimationFrame?.(this._mapFitFrame);
    this._mapFitFrame = 0;
    this._map?.stop?.();
    this._map?.remove();
    this._map = null;
    this._L = null;
    this._mapLoading = false;
    this._mapFailed = false;
    this._zoneLayer = null;
    this._peopleLayer = null;
    this._markers.clear();
    this._zoneSig = '';
    this._fitSig = null;
    if (this.$?.mapMsg) this.$.mapMsg.hidden = true;
  }

  async syncMap(fam) {
    if (!this.familyMapActive()) return;
    const $ = this.$;
    const epoch = this._mapEpoch;
    if (!this._map) {
      if (this._mapLoading || this._mapFailed) return;
      this._mapLoading = true;
      $.mapMsg.hidden = false;
      setHTML($.mapMsg, `${ic('pin')}<span>Loading map…</span>`);
      try {
        const L = await loadLeaflet();
        if (epoch !== this._mapEpoch || !this.familyMapActive()) return;
        this._L = L;
        this._map = L.map($.mapCanvas, { zoomControl: false, attributionControl: false, worldCopyJump: true, zoomSnap: 0.5, scrollWheelZoom: false });
        L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(this._map);
        for (const layer of tileLayers()) L.tileLayer(layer.url, layer.options).addTo(this._map);
        this._zoneLayer = L.layerGroup().addTo(this._map);
        this._peopleLayer = L.layerGroup().addTo(this._map);
        $.mapMsg.hidden = true;
      } catch {
        if (epoch !== this._mapEpoch || !this.familyMapActive()) return;
        this.stopFamilyMap();
        this._mapFailed = true;
        $.mapMsg.hidden = false;
        $.mapMsg.innerHTML = `${ic('pin')}<span>The map could not load. Check the internet connection.</span>`;
        return;
      } finally {
        if (epoch === this._mapEpoch) this._mapLoading = false;
      }
    }
    if (epoch !== this._mapEpoch || !this.familyMapActive()) return;
    // Loading Leaflet may span several HA updates; plot the current drivers.
    fam = familyPresentation(familyOf(this._hass, this.config), this.config).family;
    this._fam = fam;
    const L = this._L;
    const map = this._map;
    const drivingOnly = this.config.family_visibility === 'driving';
    const zoneSig = JSON.stringify(fam.zones.map((z) => [z.id, z.lat, z.lon, z.radius]));
    if (zoneSig !== this._zoneSig) {
      this._zoneSig = zoneSig;
      this._zoneLayer.clearLayers();
      for (const z of fam.zones) {
        L.circle([z.lat, z.lon], { radius: z.radius, color: z.home ? '#4de3ff' : '#b197ff', weight: 1.2, opacity: 0.7, dashArray: z.home ? null : '4 6', fillOpacity: z.home ? 0.1 : 0.05, interactive: false }).addTo(this._zoneLayer);
        const html = z.home ? `<span class="mk-home">${ic('home')}</span>` : `<span class="mk-zone">${esc(z.name)}</span>`;
        L.marker([z.lat, z.lon], { icon: L.divIcon({ className: 'nc-marker', html, iconSize: z.home ? [30, 30] : [0, 0], iconAnchor: z.home ? [15, 15] : [0, 0] }), interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(this._zoneLayer);
      }
    }
    const placed = fam.people.filter((p) => p.lat !== null && p.lon !== null && (drivingOnly || !(p.isHome && fam.home)));
    const seen = new Set();
    for (const p of placed) {
      seen.add(p.id);
      const html = `<div class="mk">${avatarHtml(p)}</div>`;
      let mk = this._markers.get(p.id);
      if (!mk) {
        const marker = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'nc-marker', html, iconSize: [40, 40], iconAnchor: [20, 20] }), keyboard: false, riseOnHover: true }).addTo(this._peopleLayer);
        marker.on('click', () => this.moreInfo(p.id));
        mk = { marker, html };
        this._markers.set(p.id, mk);
      } else {
        mk.marker.setLatLng([p.lat, p.lon]);
        if (mk.html !== html) {
          mk.marker.setIcon(L.divIcon({ className: 'nc-marker', html, iconSize: [40, 40], iconAnchor: [20, 20] }));
          mk.html = html;
        }
      }
    }
    for (const [id, mk] of this._markers) {
      if (seen.has(id)) continue;
      this._peopleLayer.removeLayer(mk.marker);
      this._markers.delete(id);
    }
    // Fit everyone (and home) when who is on the map changes; otherwise leave the view alone.
    const fitSig = drivingOnly ? JSON.stringify([fam.home && [fam.home.lat, fam.home.lon], placed.map((p) => [p.id, p.lat, p.lon])])
      : `${fam.home ? 'home|' : ''}${placed.map((p) => p.id).sort().join('|')}`;
    if (fitSig !== this._fitSig) {
      this._fitSig = fitSig;
      if (this._mapFitFrame) globalThis.cancelAnimationFrame?.(this._mapFitFrame);
      this._mapFitFrame = requestAnimationFrame(() => {
        this._mapFitFrame = 0;
        if (epoch !== this._mapEpoch || map !== this._map || !this.familyMapActive()) return;
        map.invalidateSize();
        const pts = placed.map((p) => [p.lat, p.lon]);
        if (fam.home) pts.push([fam.home.lat, fam.home.lon]);
        if (!pts.length) map.setView([20, 0], 2, drivingOnly ? { animate: false } : undefined);
        else if (pts.length === 1) map.setView(pts[0], 15, drivingOnly ? { animate: false } : undefined);
        else map.fitBounds(pts, { padding: [36, 36], maxZoom: 15, ...(drivingOnly ? { animate: false } : {}) });
      });
    }
  }
}

if (globalThis.customElements) {
  if (!customElements.get('nourie-cameras-card')) customElements.define('nourie-cameras-card', NourieCamerasCard);
  if (!customElements.get('nourie-wall-card')) customElements.define('nourie-wall-card', NourieWallCard);
  window.customCards = window.customCards || [];
  const cards = [
    { type: 'nourie-cameras-card', name: 'Nourie Cameras', description: 'Live Nest cameras that reconnect on their own: one large view, the rest a tap away.' },
    { type: 'nourie-wall-card', name: 'Nourie Wall', description: 'Full-screen wall view: live cameras, the family radar and map, and inside air.' },
  ];
  for (const c of cards) if (!window.customCards.some((x) => x.type === c.type)) window.customCards.push({ ...c, preview: false });
  console.info(`%c NOURIE CAMERAS %c ${VERSION} `, 'background:#4de3ff;color:#06101c;font-weight:700;border-radius:3px 0 0 3px', 'background:#0a1a2c;color:#4de3ff;border-radius:0 3px 3px 0');
}
