/* Today — the complete Weather Nourie forecast in the cinematic layout.
 * Everything the main site shows: current, alerts, 24h blend arc, hourly,
 * 7-day, rain, details, comfort, severe outlook, NWS discussion,
 * plus "How the weather is calculated" with the house blend percentages.
 * Pure builders are exported for testing; DOM wiring runs in browser. */
import {currentAirQuality} from './air-quality.js?v=mobile-repair-v1';
import {currentSample,sampleCaption,windDirectionLabel} from './weather-display.js?v=low-rain-display-v1';
import {hourlyUvValue} from './daily-uv.js?v=weather-art-labels-v10';

const MODELS = [
  { id: 'nws', label: 'NWS', color: '#7fd4ff', desc: 'Official National Weather Service forecast' },
  { id: 'hrrr', label: 'HRRR', color: '#ffd479', desc: '3 km high-resolution rapid refresh' },
  { id: 'ecmwf', label: 'ECMWF', color: '#9dffb0', desc: 'European medium-range model' },
  { id: 'nbm', label: 'NBM', color: '#ff9d9d', desc: 'NWS National Blend of Models' },
];
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => (finite(n) ? Math.round(n) : null);
const MODEL_LABEL = { nws: 'NWS', hrrr: 'HRRR', ecmwf: 'ECMWF', nbm: 'NBM' };

function hourLabel(timeMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric' }).format(new Date(timeMs));
}
export function skyImage(hours, nowMs) {
  const h = (hours || []).find((x) => x.time <= nowMs && nowMs < x.time + 3600000) || hours?.[0] || null;
  const cond = String(h?.condition || '').toLowerCase();
  if (h?.isDay === false) return 'today-sky-night-v2.webp';
  if (/thunder|storm|tornado|hail/.test(cond)) return 'today-sky-storm.webp';
  if (/rain|shower|drizzle/.test(cond) || (h?.pop ?? 0) >= 40) return 'today-sky-rain.webp';
  if (/cloud|overcast|fog|mist|haze/.test(cond)) return 'today-sky-clouds.webp';
  return 'today-sky-clear.webp';
}

/* ---- view model (pure) ---- */
export function buildTodayModel(forecast, nowMs = Date.now()) {
  const loc = forecast?.location || {};
  const timeZone = loc.timeZone || 'America/New_York';
  const current=currentSample({...forecast,location:loc},nowMs),cur=current.inputs;
  const allHours = (forecast?.hours || [])
    .map((h) => ({ ...h, time: Date.parse(h.time) }))
    .filter((h) => Number.isFinite(h.time));
  const hours = allHours.filter((h) => h.time + 3600000 > nowMs);
  const weights = forecast?.blendPolicy?.sameDay || { nws: 0.4, hrrr: 0.3, ecmwf: 0.1, nbm: 0.2 };
  const rainWeights = forecast?.blendPolicy?.extendedRain || { nws: 0.15, ecmwf: 0.6, nbm: 0.25 };
  const contrib = Object.fromEntries((forecast?.modelContributions || []).map((m) => [m.id, m]));
  const solar = forecast?.solar || {};

  const fmtT = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(t)) : null;
  };

  const series = hours.slice(0, 24).map((h) => {
    const src = Object.fromEntries((h.temperatureBlend?.sources || []).map((s) => [s.id, s.value]));
    return {
      time: h.time,
      blend: finite(h.temperatureBlend?.value) ? h.temperatureBlend.value : h.temperature,
      models: Object.fromEntries(MODELS.map((m) => [m.id, src[m.id] ?? null])),
      pop: finite(h.rainLikelihood?.value) ? Math.round(h.rainLikelihood.value) : (finite(h.pop) ? Math.round(h.pop) : null),
    };
  });

  const uvNow = hourlyUvValue(forecast,nowMs);
  const aqi = currentAirQuality(forecast,nowMs)?.aqi;
  const feels = current.feels;
  const wdir=windDirectionLabel(cur.windDirection),wind=finite(cur.wind)?cur.wind:cur.windMph;

  const details = [
    { k: 'Wind', v: `${round(wind) ?? '--'} mph${wdir&&wdir!=='—' ? ` ${wdir}` : ''}` },
    { k: 'Humidity', v: `${round(cur.humidity) ?? '--'}%` },
    { k: 'Dew point', v: `${round(cur.dewpoint) ?? '--'}°` },
    { k: 'Pressure', v: finite(cur.pressureInHg ?? cur.pressure) ? `${(cur.pressureInHg ?? cur.pressure).toFixed(2)} in` : '--' },
    { k: 'Visibility', v: finite(cur.visibility) ? `${cur.visibility.toFixed(1)} mi` : '--' },
    { k: 'UV index now', v: uvNow != null ? `${uvNow.toFixed(1)}` : '--' },
    { k: 'Air quality', v: finite(aqi) ? `${Math.round(aqi)} AQI` : '--' },
    { k: 'Sun', v: solar.sunrise && solar.sunset ? `↑ ${fmtT(solar.sunrise)} · ↓ ${fmtT(solar.sunset)}` : '--' },
  ];

  const comfort = current.comfort || {};
  const rainTl = (forecast?.rainTimeline || []).slice(0, 12);
  const rainStart = rainTl.find((r) => (r.rainLikelihood?.value ?? r.officialPop ?? 0) >= 30);
  const discuss = forecast?.discussion || {};

  return {
    place: loc.name || 'Knightdale / Raleigh',
    updatedAt: nowMs,
    timeZone,
    sky: skyImage(hours, nowMs),
    hero: {
      temp: round(cur.temperature),
      feels: round(feels),
      condition: current.condition || 'Conditions unavailable',
      feelsSource:sampleCaption(current,timeZone),
      high: round(forecast?.days?.[0]?.high),
      low: round(forecast?.days?.[0]?.low),
      sunrise: fmtT(solar.sunrise),
      sunset: fmtT(solar.sunset),
    },
    alerts: (forecast?.alerts || []).map((a) => ({
      title: a.headline || a.event || 'Weather alert',
      desc: String(a.description || a.instruction || '').slice(0, 260),
      when: a.effective && a.expires ? `${fmtT(a.effective)} – ${fmtT(a.expires)}` : null,
    })),
    series,
    weights,
    hours12: hours.slice(0, 12).map((h) => ({
      time: h.time,
      temp: round(finite(h.temperatureBlend?.value) ? h.temperatureBlend.value : h.temperature),
      pop: finite(h.rainLikelihood?.value) ? Math.round(h.rainLikelihood.value) : (finite(h.pop) ? Math.round(h.pop) : null),
    })),
    days7: (forecast?.days || []).slice(0, 7).map((d) => ({
      label: d.label || d.date,
      high: round(d.high),
      low: round(d.low),
      condition: d.condition || '',
      pop: finite(d.pop) ? Math.round(d.pop) : null,
    })),
    rainHours: rainTl.map((r) => ({
      time: Date.parse(r.time),
      pop: finite(r.rainLikelihood?.value) ? Math.round(r.rainLikelihood.value) : (finite(r.officialPop) ? Math.round(r.officialPop) : null),
    })),
    rainNote: rainStart
      ? `Rain likely around ${hourLabel(Date.parse(rainStart.time), timeZone)} — plan around it.`
      : 'No significant rain expected in the next 12 hours.',
    details,
    comfort: {
      outdoors: round(comfort.outdoors),
      shade: round(comfort.shade),
      label: comfort.weatherLabel || comfort.condition || '',
    },
    risks: (forecast?.riskOutlooks || []).map((r) => ({ title: r.title || r.level, summary: r.summary || '' })),
    discussion: {
      office: discuss.office || 'NWS',
      stamp: discuss.issuanceTime ? new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(discuss.issuanceTime)) : '',
      text: String(discuss.text || '').replace(/^\s+/, '').slice(0, 2200),
    },
    calc: {
      weights,
      rainWeights,
      models: MODELS.map((m) => ({
        ...m,
        weight: weights[m.id],
        runAt: contrib[m.id]?.runAt || null,
        resolution: contrib[m.id]?.resolution || null,
      })),
      rainPolicy: forecast?.blendPolicy?.precipitation || '',
    },
  };
}

/* ---- 24h arc (pure) ---- */
function smoothPath(xy) {
  let d = `M ${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)], p1 = xy[i], p2 = xy[i + 1], p3 = xy[Math.min(xy.length - 1, i + 2)];
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)},`
      + ` ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)},`
      + ` ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
export function buildTodayArc(model) {
  const pts = (model.series || []).filter((s) => finite(s.blend));
  if (pts.length < 4) return '';
  const W = 640, H = 240, PL = 12, PR = 12, PT = 28, PB = 40;
  const all = [];
  for (const p of pts) {
    all.push(p.blend);
    for (const m of MODELS) if (finite(p.models[m.id])) all.push(p.models[m.id]);
  }
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = mid - 3; hi = mid + 3; }
  const X = (i) => PL + (i * (W - PL - PR)) / (pts.length - 1);
  const Y = (t) => PT + (1 - (t - lo) / (hi - lo)) * (H - PT - PB);
  const line = (vals) => {
    const xy = [];
    vals.forEach((v, i) => { if (finite(v)) xy.push([X(i), Y(v)]); });
    return xy.length >= 2 ? smoothPath(xy) : '';
  };
  const base = H - PB;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Blended temperature over the next 24 hours">`;
  for (let i = 0; i < pts.length; i++) {
    if ((pts[i].pop ?? 0) >= 30) {
      const w = (W - PL - PR) / (pts.length - 1);
      svg += `<rect class="arc-rain" x="${(X(i) - w / 2).toFixed(1)}" y="${PT}" width="${w.toFixed(1)}" height="${(base - PT).toFixed(1)}" rx="4"/>`;
    }
  }
  for (const m of MODELS) {
    const d = line(pts.map((p) => p.models[m.id]));
    if (d) svg += `<path class="arc-line" d="${d}" style="stroke:${m.color}"/>`;
  }
  const bd = line(pts.map((p) => p.blend));
  if (bd) svg += `<path class="arc-blend" d="${bd}"/>`;
  svg += `<line class="arc-now" x1="${X(0).toFixed(1)}" y1="${PT - 6}" x2="${X(0).toFixed(1)}" y2="${base}"/>`
    + `<circle class="arc-now-dot" cx="${X(0).toFixed(1)}" cy="${Y(pts[0].blend).toFixed(1)}" r="5"/>`;
  for (let i = 0; i < pts.length; i += 4) {
    svg += `<text x="${X(i).toFixed(1)}" y="${(H - 22).toFixed(1)}" text-anchor="middle">${hourLabel(pts[i].time, model.timeZone)}</text>`;
    svg += `<text class="arc-temp" x="${X(i).toFixed(1)}" y="${(Y(pts[i].blend) - 10).toFixed(1)}" text-anchor="middle">${Math.round(pts[i].blend)}°</text>`;
  }
  return svg + '</svg>';
}

/* ---------- DOM wiring (browser only) ---------- */
function el(id) { return document.getElementById(id); }
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let skyFlip = false;
function setSky(image) {
  const url = `/weather-fusion/${image}`;
  const show = skyFlip ? el('sky-a') : el('sky-b');
  const hide = skyFlip ? el('sky-b') : el('sky-a');
  if (show.dataset.img === image) return;
  const pre = new Image();
  pre.onload = () => {
    show.style.backgroundImage = `url("${url}")`;
    show.dataset.img = image;
    show.classList.add('on');
    hide.classList.remove('on');
    skyFlip = !skyFlip;
  };
  pre.onerror = () => {};
  pre.src = url;
}
function countUp(node, target) {
  if (!node || !finite(target)) { if (node) node.textContent = target ?? '--'; return; }
  if (reducedMotion()) { node.textContent = target; return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 3);
    node.textContent = Math.round(target * e);
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function fmtRunAt(iso) {
  if (!iso) return 'run time unknown';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'run time unknown';
  return 'run ' + new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

export function render(model) {
  setSky(model.sky);
  countUp(el('now-temp'), model.hero.temp);
  el('now-cond').textContent = model.hero.condition;
  el('now-feels').textContent = model.hero.feels != null ? `Feels like ${model.hero.feels}°` : '';
  el('now-feels').title=model.hero.feelsSource||'';
  el('now-hilo').textContent = model.hero.high != null ? `H ${model.hero.high}°  ·  L ${model.hero.low ?? '--'}°` : '';
  el('now-sun').textContent = model.hero.sunrise ? `Sunrise ${model.hero.sunrise} · Sunset ${model.hero.sunset}` : '';

  const al = el('alert-list');
  al.innerHTML = '';
  for (const a of model.alerts) {
    const c = document.createElement('div'); c.className = 'alert-card';
    const t = document.createElement('div'); t.className = 'at'; t.textContent = a.title; c.appendChild(t);
    if (a.desc) { const d = document.createElement('div'); d.className = 'ad'; d.textContent = a.desc; c.appendChild(d); }
    if (a.when) { const w = document.createElement('div'); w.className = 'aw'; w.textContent = a.when; c.appendChild(w); }
    al.appendChild(c);
  }

  el('today-arc').innerHTML = buildTodayArc(model);
  const legend = el('today-legend');
  legend.innerHTML = '';
  const addLegend = (color, label) => {
    const s = document.createElement('span');
    const sw = document.createElement('i'); sw.style.background = color;
    s.appendChild(sw); s.appendChild(document.createTextNode(label));
    legend.appendChild(s);
  };
  addLegend('#fff', 'House blend');
  for (const m of model.calc.models) addLegend(m.color, `${m.label} ${Math.round((m.weight || 0) * 100)}%`);

  const hs = el('hour-strip');
  hs.innerHTML = '';
  for (const h of model.hours12) {
    const c = document.createElement('div'); c.className = 'hour-cell';
    const hh = document.createElement('div'); hh.className = 'hh'; hh.textContent = hourLabel(h.time, model.timeZone); c.appendChild(hh);
    const ht = document.createElement('div'); ht.className = 'ht'; ht.textContent = h.temp != null ? `${h.temp}°` : '--'; c.appendChild(ht);
    const hp = document.createElement('div'); hp.className = 'hp'; hp.textContent = h.pop != null ? `${h.pop}%` : ''; c.appendChild(hp);
    hs.appendChild(c);
  }

  const dc = el('day-cards');
  dc.innerHTML = '';
  for (const d of model.days7) {
    const c = document.createElement('div'); c.className = 'day-card';
    const dd = document.createElement('div'); dd.className = 'd'; dd.textContent = d.label;
    if (d.condition) { const sm = document.createElement('small'); sm.textContent = d.condition; dd.appendChild(sm); }
    c.appendChild(dd);
    const hl = document.createElement('div'); hl.className = 'hl';
    hl.append(document.createTextNode(`${d.high ?? '--'}° `));
    const sm = document.createElement('small'); sm.textContent = `/ ${d.low ?? '--'}°`; hl.appendChild(sm);
    c.appendChild(hl);
    const pop = document.createElement('div'); pop.className = 'pop'; pop.textContent = d.pop != null ? `${d.pop}%` : '';
    c.appendChild(pop);
    dc.appendChild(c);
  }

  el('rain-note').textContent = model.rainNote;
  const rb = el('rain-bars');
  rb.innerHTML = '';
  for (const r of model.rainHours) {
    const b = document.createElement('div'); b.className = 'rain-bar';
    const bar = document.createElement('div'); bar.className = 'bar';
    bar.style.height = `${Math.max(3, Math.round((r.pop || 0) * 1.1))}px`;
    const pl = document.createElement('div'); pl.className = 'pl'; pl.textContent = r.pop != null ? `${r.pop}%` : '—';
    const hl = document.createElement('div'); hl.className = 'hl'; hl.textContent = hourLabel(r.time, model.timeZone);
    b.append(bar, pl, hl);
    rb.appendChild(b);
  }

  const dg = el('detail-grid');
  dg.innerHTML = '';
  for (const d of model.details) {
    const c = document.createElement('div'); c.className = 'detail';
    const k = document.createElement('div'); k.className = 'k'; k.textContent = d.k; c.appendChild(k);
    const v = document.createElement('div'); v.className = 'v'; v.textContent = d.v; c.appendChild(v);
    dg.appendChild(c);
  }

  const cf = el('comfort');
  cf.innerHTML = '';
  const cfData = [
    ['Feels like · outdoors', model.comfort.outdoors != null ? `${model.comfort.outdoors}°` : '--'],
    ['Feels like · shade', model.comfort.shade != null ? `${model.comfort.shade}°` : '--'],
  ];
  for (const [k, v] of cfData) {
    const c = document.createElement('div'); c.className = 'cf';
    const kk = document.createElement('div'); kk.className = 'k'; kk.textContent = k; c.appendChild(kk);
    const vv = document.createElement('div'); vv.className = 'v'; vv.textContent = v; c.appendChild(vv);
    cf.appendChild(c);
  }

  const rs = el('risk-section');
  if (model.risks.length) {
    rs.hidden = false;
    const rl = el('risk-list');
    rl.innerHTML = '';
    for (const r of model.risks) {
      const c = document.createElement('div'); c.className = 'risk';
      const t = document.createElement('div'); t.className = 'rt'; t.textContent = r.title; c.appendChild(t);
      if (r.summary) { const s = document.createElement('div'); s.className = 'rs'; s.textContent = r.summary; c.appendChild(s); }
      rl.appendChild(c);
    }
  } else rs.hidden = true;

  el('discuss-head').textContent = `From the National Weather Service${model.discussion.office ? ` (${model.discussion.office})` : ''}${model.discussion.stamp ? ` · ${model.discussion.stamp}` : ''}`;
  el('discuss-text').textContent = model.discussion.text || 'No discussion available.';

  // How the weather is calculated
  const wb = el('weight-bar');
  wb.innerHTML = '';
  const order = ['nws', 'hrrr', 'nbm', 'ecmwf'].map((id) => model.calc.models.find((m) => m.id === id)).filter(Boolean);
  for (const m of order) {
    const seg = document.createElement('div'); seg.className = 'seg';
    seg.style.width = `${Math.round((m.weight || 0) * 100)}%`;
    seg.style.background = m.color;
    seg.textContent = `${m.label} ${Math.round((m.weight || 0) * 100)}%`;
    seg.title = `${m.label}: ${Math.round((m.weight || 0) * 100)}%`;
    wb.appendChild(seg);
  }
  const cm = el('calc-models');
  cm.innerHTML = '';
  for (const m of order) {
    const c = document.createElement('div'); c.className = 'calc-model';
    const pct = document.createElement('div'); pct.className = 'pct'; pct.textContent = `${Math.round((m.weight || 0) * 100)}%`; c.appendChild(pct);
    const mid = document.createElement('div');
    const cn = document.createElement('div'); cn.className = 'cn'; cn.textContent = m.label; mid.appendChild(cn);
    const cd = document.createElement('div'); cd.className = 'cd';
    cd.textContent = `${m.desc}. ${fmtRunAt(m.runAt)}${m.resolution ? ` · ${m.resolution} resolution` : ''}.`;
    mid.appendChild(cd); c.appendChild(mid);
    const dot = document.createElement('div'); dot.className = 'dot'; dot.style.background = m.color; c.appendChild(dot);
    cm.appendChild(c);
  }
  const rw = model.calc.rainWeights;
  el('rain-blend-note').textContent =
    `Rain is blended separately: on the current local day, NWS fills its ${Math.round((model.calc.weights.nws || 0) * 100)}-point share proportionally; HRRR is worth ${Math.round((model.calc.weights.hrrr || 0) * 100)} points, ECMWF ${Math.round((model.calc.weights.ecmwf || 0) * 100)} and NBM ${Math.round((model.calc.weights.nbm || 0) * 100)}. ` +
    `After the current local day, NWS fills a ${Math.round((rw.nws || 0) * 100)}-point share; ECMWF is worth ${Math.round((rw.ecmwf || 0) * 100)} points and NBM ${Math.round((rw.nbm || 0) * 100)}, with no HRRR contribution.`;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  el('updated').textContent = 'Updated ' + new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(model.updatedAt));
}

async function load(locationId) {
  const err = el('error');
  err.hidden = true;
  el('now-cond').textContent = 'Loading…';
  try {
    const res = await fetch(`/api/weather-fusion/forecast?location=${encodeURIComponent(locationId)}`, { credentials: 'same-origin' });
    if (res.status === 401) {
      location.href = '/weather-fusion/login?returnTo=' + encodeURIComponent('/weather-fusion/today.html');
      return;
    }
    if (!res.ok) throw new Error(`Weather service responded ${res.status}`);
    render(buildTodayModel(await res.json()));
  } catch (e) {
    err.hidden = false;
    err.textContent = 'Could not load the forecast right now. Please retry in a bit.';
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  const select = el('loc-select');
  const initial = params.get('location') || 'knightdale';
  if ([...select.options].some((o) => o.value === initial)) select.value = initial;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('location', select.value);
    history.replaceState(null, '', url);
    load(select.value);
  });
  load(select.value);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
