/* Aurora — Weather Nourie, explained.
 * One call to /api/weather-fusion/forecast drives the whole page — the same
 * blended forecast as the main site, presented in plain English with the
 * science shown, not hidden. No forecast logic lives here: Aurora only
 * reads, translates and displays. All API strings reach the DOM through
 * textContent; SVG is built from rounded numbers only. */

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => (finite(n) ? Math.round(n) : null);

/* Standard NWS feels-like formulas, valid ranges only (same as Glance). */
export function feelsLike(tempF, humidityPct, windMph) {
  if (!finite(tempF)) return null;
  if (tempF >= 80 && finite(humidityPct)) {
    const T = tempF, R = humidityPct;
    let hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R
      - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R
      + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    if (R > 85 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
    return round(hi);
  }
  if (tempF <= 50 && finite(windMph) && windMph > 3) {
    const v = Math.pow(windMph, 0.16);
    return round(35.74 + 0.6215 * tempF - 35.75 * v + 0.4275 * tempF * v);
  }
  return round(tempF);
}

const hourLabel = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date(ms));
const timeLabel = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
const dayLabel = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(ms));

function popOf(h) {
  const v = h?.rainLikelihood && Object.hasOwn(h.rainLikelihood, 'value') ? h.rainLikelihood.value : h?.pop;
  return finite(v) ? v : null;
}

export function tempWord(t) {
  if (!finite(t)) return '';
  if (t < 32) return 'freezing';
  if (t < 45) return 'cold';
  if (t < 58) return 'cool';
  if (t < 72) return 'mild';
  if (t < 82) return 'warm';
  if (t < 90) return 'hot';
  return 'very hot';
}

export function dewpointWord(dp) {
  if (!finite(dp)) return null;
  if (dp < 50) return { word: 'Comfortable', text: 'The air feels dry and pleasant — most people won’t notice the humidity at all.' };
  if (dp < 55) return { word: 'Pleasant', text: 'Just a touch of moisture in the air. Still comfortable for almost everyone.' };
  if (dp < 60) return { word: 'Noticeable', text: 'You can start to feel the moisture, especially if you’re working or exercising outside.' };
  if (dp < 65) return { word: 'Sticky', text: 'The air feels heavy and damp. Shade and water breaks start to matter.' };
  if (dp < 70) return { word: 'Muggy', text: 'Tropical-feeling air. Sweat doesn’t evaporate well, so it feels warmer than the thermometer says.' };
  return { word: 'Oppressive', text: 'Very humid air. Take it easy outside — heat stress becomes a real risk.' };
}

export function uvWord(v) {
  if (!finite(v)) return null;
  const i = Math.round(v);
  if (i <= 2) return { word: 'Low', text: 'Minimal sunburn risk for most people.' };
  if (i <= 5) return { word: 'Moderate', text: 'Fair skin can burn in about 25–30 minutes unprotected.' };
  if (i <= 7) return { word: 'High', text: 'Protection matters — unprotected skin can burn in about 20 minutes.' };
  if (i <= 10) return { word: 'Very high', text: 'Burns can happen in under 20 minutes. Hat, shade and sunscreen earn their keep.' };
  return { word: 'Extreme', text: 'Skin can burn in about 10 minutes. Midday sun is best avoided.' };
}

export function aqiWord(v) {
  if (!finite(v)) return null;
  if (v <= 50) return { word: 'Good', text: 'The air is clean — a great time to be outside.' };
  if (v <= 100) return { word: 'Moderate', text: 'Generally fine. Very sensitive people might notice it during long, hard exertion.' };
  if (v <= 150) return { word: 'Unhealthy for sensitive groups', text: 'People with asthma or heart conditions may want to ease up on long outdoor exertion.' };
  if (v <= 200) return { word: 'Unhealthy', text: 'Everyone may feel it during long exertion — consider moving workouts indoors.' };
  return { word: 'Very unhealthy', text: 'Avoid prolonged outdoor exertion and check local air-quality guidance.' };
}

const compass = (deg) => (finite(deg) ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) / 45)) % 8] : null);

/* ---------- plain-English headline ---------- */
export function buildHeadline(model) {
  const parts = [];
  const t = model.hero.temp;
  const cond = String(model.hero.condition || '').toLowerCase();
  const wet = /rain|shower|drizzle|storm|thunder|snow|ice/.test(cond);
  if (finite(t)) {
    parts.push(wet ? `It’s ${tempWord(t)} out, with ${model.hero.condition.toLowerCase()}` : `It’s a ${tempWord(t)} ${model.isDay ? 'day' : 'night'} — ${model.hero.condition.toLowerCase()}`);
  }
  const next12 = model.hours.slice(0, 12);
  const rainy = next12.find((h) => finite(h.pop) && h.pop >= 50);
  const chance = next12.find((h) => finite(h.pop) && h.pop >= 30);
  if (rainy) parts.push(`rain is likely around ${hourLabel(rainy.time, model.timeZone)} (${Math.round(rainy.pop)}% chance)`);
  else if (chance) parts.push(`there’s a chance of rain around ${hourLabel(chance.time, model.timeZone)} (${Math.round(chance.pop)}%)`);
  else if (next12.length) parts.push('no rain is expected in the next 12 hours');
  const f = model.hero.feels;
  if (finite(f) && finite(t) && Math.abs(f - t) >= 4) {
    parts.push(f < t ? `the wind will make it feel nearer ${f}°` : `the humidity will make it feel nearer ${f}°`);
  }
  if (!parts.length) return '';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

/* ---------- 24h arc (numbers only into SVG) ---------- */
export function buildArc(hours, solar, tz) {
  const pts = (hours || []).slice(0, 24).filter((h) => finite(h.temperature));
  if (pts.length < 4) return '';
  const W = 640, H = 240, PL = 12, PR = 12, PT = 36, PB = 44;
  const temps = pts.map((p) => p.temperature);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = mid - 3; hi = mid + 3; }
  const X = (i) => PL + (i * (W - PL - PR)) / (pts.length - 1);
  const Y = (t) => PT + (1 - (t - lo) / (hi - lo)) * (H - PT - PB);
  const xy = pts.map((p, i) => [X(i), Y(p.temperature)]);
  let d = `M ${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)], p1 = xy[i], p2 = xy[i + 1], p3 = xy[Math.min(xy.length - 1, i + 2)];
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${d} L ${xy[xy.length - 1][0].toFixed(1)} ${H - PB} L ${xy[0][0].toFixed(1)} ${H - PB} Z`;
  let rain = '';
  pts.forEach((p, i) => {
    if (finite(p.pop) && p.pop >= 30) {
      const x0 = i === 0 ? X(0) : (X(i - 1) + X(i)) / 2;
      const x1 = i === pts.length - 1 ? X(i) : (X(i) + X(i + 1)) / 2;
      rain += `<rect class="arc-rain" x="${x0.toFixed(1)}" y="${PT}" width="${(x1 - x0).toFixed(1)}" height="${H - PT - PB}" rx="4" opacity="${(0.22 + Math.min(p.pop, 100) / 170).toFixed(2)}"/>`;
    }
  });
  let marks = '';
  const t0 = pts[0].time, tN = pts[pts.length - 1].time + 3600000;
  for (const [key, glyph] of [['sunrise', '↑'], ['sunset', '↓']]) {
    const t = solar?.[key] ? Date.parse(solar[key]) : NaN;
    if (Number.isFinite(t) && t >= t0 && t <= tN) {
      const x = PL + ((t - t0) / (tN - t0)) * (W - PL - PR);
      marks += `<text class="arc-sun" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${glyph} ${hourLabel(t, tz)}</text>`;
    }
  }
  let labels = '';
  for (let i = 0; i < pts.length; i += 3) {
    labels += `<text x="${X(i).toFixed(1)}" y="${H - 24}" text-anchor="middle">${hourLabel(pts[i].time, tz)}</text>`;
    labels += `<text class="arc-temp" x="${X(i).toFixed(1)}" y="${(Y(pts[i].temperature) - 10).toFixed(1)}" text-anchor="middle">${Math.round(pts[i].temperature)}°</text>`;
  }
  const nowMark = `<line class="arc-now" x1="${X(0).toFixed(1)}" y1="${PT - 6}" x2="${X(0).toFixed(1)}" y2="${H - PB}"/><circle class="arc-now-dot" cx="${X(0).toFixed(1)}" cy="${Y(pts[0].temperature).toFixed(1)}" r="5"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><linearGradient id="arcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd4ff" stop-opacity=".5"/><stop offset="1" stop-color="#7fd4ff" stop-opacity="0"/></linearGradient></defs>${rain}<path class="arc-fill" d="${area}"/><path class="arc-line" d="${d}"/>${nowMark}${marks}${labels}</svg>`;
}

/* ---------- model builder ---------- */
export function buildModel(data, nowMs = Date.now()) {
  const loc = data?.location || {};
  const tz = loc.timeZone || 'America/New_York';
  const allHours = (data?.hours || [])
    .map((h) => ({ ...h, time: Date.parse(h.time), pop: popOf(h) }))
    .filter((h) => Number.isFinite(h.time));
  const hours = allHours.filter((h) => h.time + 3600000 > nowMs).slice(0, 24);
  const nowHour = hours[0] || allHours[0] || {};
  const cur = data?.current || {};
  const temp = round(cur.temperature ?? cur.temp ?? nowHour.temperature);
  const humidity = round(cur.humidity ?? nowHour.humidity);
  const wind = round(cur.wind ?? (finite(nowHour.wind) ? nowHour.wind : null));
  const feels = round(cur.apparent) ?? feelsLike(temp, humidity, wind);
  const days = (data?.days || []).slice(0, 7).map((d) => ({
    label: d.label || '', high: round(d.high), low: round(d.low),
    condition: d.condition || '', detail: d.detail || '',
    pop: finite(d.pop) ? Math.round(d.pop) : null,
    agreement: d.agreement || null,
    highSpread: finite(d.highSpread) ? d.highSpread : null,
    confidence: d.confidence || null,
    qpf: finite(d.qpf) ? d.qpf : null,
  }));
  const solar = data?.solar || null;
  const sunrise = solar?.sunrise ? Date.parse(solar.sunrise) : NaN;
  const sunset = solar?.sunset ? Date.parse(solar.sunset) : NaN;
  const isDay = Number.isFinite(sunrise) && Number.isFinite(sunset) ? nowMs >= sunrise && nowMs < sunset : nowHour.isDay !== false;
  const uvHour = Math.floor(nowMs / 3600000) * 3600000;
  const uv = data?.uv?.hourly?.find((p) => Date.parse(p.time) === uvHour)?.value;
  const aq = data?.airQuality;
  const aqFresh = aq && finite(aq.aqi) && Number.isFinite(Date.parse(aq.time)) && nowMs - Date.parse(aq.time) <= 2 * 3600000 && Date.parse(aq.time) - nowMs <= 5 * 60000;
  const model = {
    place: loc.name || 'Knightdale / Raleigh',
    timeZone: tz,
    updatedAt: data?.assembledAt || null,
    isDay,
    sky: skyKind(nowHour.condition, isDay),
    hero: {
      temp, condition: cur.condition || nowHour.condition || 'Conditions unavailable',
      feels, high: days[0]?.high ?? null, low: days[0]?.low ?? null,
      sunrise: Number.isFinite(sunrise) ? timeLabel(sunrise, tz) : null,
      sunset: Number.isFinite(sunset) ? timeLabel(sunset, tz) : null,
    },
    hours, days, solar,
    alerts: (data?.alerts || []).slice(0, 3).map((a) => ({
      event: a.event || 'Weather alert', headline: a.headline || '', watch: /watch/i.test(a.event || ''),
    })),
    confidence: days[0]?.confidence || null,
    methodology: data?.methodology || '',
    details: { humidity, dewpoint: round(cur.dewpoint ?? nowHour.dewpoint), wind, gust: round(cur.gust ?? nowHour.gust), windDir: compass(cur.windDirection), uv: finite(uv) ? uv : null, aqi: aqFresh ? aq.aqi : null, visibility: finite(cur.visibility) ? cur.visibility : null, pressure: finite(cur.pressure) ? cur.pressure : null },
  };
  model.headline = buildHeadline(model);
  return model;
}

function skyKind(condition, isDay) {
  const c = String(condition || '').toLowerCase();
  if (/thunder|storm|tornado|hail/.test(c)) return 'storm';
  if (/snow|ice|sleet|flurr/.test(c)) return 'snow';
  if (/rain|shower|drizzle/.test(c)) return 'rain';
  if (!isDay) return 'night';
  if (/cloud|overcast|fog|mist|haze/.test(c)) return 'clouds';
  return 'clear-day';
}

/* ---------- insights ---------- */
function buildInsights(model) {
  const out = [];
  const tz = model.timeZone, hours = model.hours;
  const h12 = hours.slice(0, 12);
  let best = null, run = null;
  h12.forEach((h, i) => {
    if (i && h.time !== h12[i - 1].time + 3600000) run = null;
    if (finite(h.pop) && h.pop < 20) { run = run || { start: i, len: 0 }; run.len++; if (!best || run.len > best.len) best = { ...run }; }
    else run = null;
  });
  if (best && best.len >= 2) out.push({ k: 'Driest window', v: `${hourLabel(h12[best.start].time, tz)} – ${hourLabel(h12[best.start + best.len - 1].time + 3600000, tz)}`, s: 'Best stretch to be outside' });
  const wet = hours.find((h) => finite(h.pop) && h.pop >= 40);
  if (wet) out.push({ k: 'Rain likely from', v: `${hourLabel(wet.time, tz)} · ${Math.round(wet.pop)}%`, s: 'Plan around it if you can' });
  else out.push({ k: 'Rain', v: 'Not expected', s: 'Nothing likely in the next 24 hours' });
  const peak = hours.filter((h) => finite(h.temperature)).reduce((a, b) => (!a || b.temperature > a.temperature ? b : a), null);
  if (peak) out.push({ k: 'Warmest today', v: `${Math.round(peak.temperature)}° around ${hourLabel(peak.time, tz)}`, s: tempWord(peak.temperature) ? `Feels ${tempWord(peak.temperature)}` : '' });
  if (finite(model.days[0]?.low)) out.push({ k: 'Tonight’s low', v: `${model.days[0].low}°`, s: model.days[0].low < 45 ? 'A real jacket night' : model.days[0].low < 60 ? 'Light jacket weather' : 'Mild overnight' });
  return out.slice(0, 4);
}

/* ---------- DOM ---------- */
const el = (id) => document.getElementById(id);
function make(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

function render(model) {
  document.body.dataset.sky = model.sky;
  el('place').textContent = model.place;
  el('updated').textContent = Number.isFinite(Date.parse(model.updatedAt))
    ? `Forecast updated ${timeLabel(Date.parse(model.updatedAt), model.timeZone)} · ${dayLabel(Date.now(), model.timeZone)}`
    : dayLabel(Date.now(), model.timeZone);
  const chip = el('confidence-chip');
  if (model.confidence?.label) {
    chip.hidden = false;
    chip.dataset.level = model.confidence.key || '';
    chip.textContent = `Forecast confidence: ${model.confidence.label}`;
    chip.title = 'How much the weather models agree — see “How sure are we?” below.';
  } else chip.hidden = true;

  el('now-temp').textContent = model.hero.temp ?? '--';
  el('now-cond').textContent = model.hero.condition;
  const feels = el('now-feels');
  feels.textContent = finite(model.hero.feels) && finite(model.hero.temp) && model.hero.feels !== model.hero.temp
    ? `Feels like ${model.hero.feels}° — ${model.hero.feels < model.hero.temp ? 'the wind is stealing warmth' : 'the humidity is holding heat in'}.`
    : '';
  el('headline').textContent = model.headline;
  el('now-hilo').textContent = model.hero.high != null ? `High ${model.hero.high}° · Low ${model.hero.low ?? '--'}°` : '';
  el('sun-times').textContent = model.hero.sunrise ? `Sunrise ${model.hero.sunrise} · Sunset ${model.hero.sunset}` : '';

  const strip = el('alert-strip');
  strip.innerHTML = '';
  strip.hidden = !model.alerts.length;
  for (const a of model.alerts) {
    const d = make('div', 'alert-chip' + (a.watch ? ' watch' : ''), a.headline ? `${a.event}: ${a.headline}` : a.event);
    strip.appendChild(d);
  }

  const row = el('insight-row');
  row.innerHTML = '';
  for (const ins of buildInsights(model)) {
    const d = make('div', 'insight');
    d.append(make('div', 'k', ins.k), make('div', 'v', ins.v), make('div', 's', ins.s));
    row.appendChild(d);
  }

  el('arc').innerHTML = buildArc(model.hours, model.solar, model.timeZone);
  const hourly = el('hourly');
  hourly.innerHTML = '';
  model.hours.slice(0, 24).forEach((h, i) => {
    const d = make('div', 'hour' + (i === 0 ? ' now' : ''));
    d.append(
      make('div', 'ht', i === 0 ? 'Now' : hourLabel(h.time, model.timeZone)),
      make('div', 'hv', finite(h.temperature) ? `${Math.round(h.temperature)}°` : '--'),
      make('div', 'hp', finite(h.pop) && h.pop >= 10 ? `${Math.round(h.pop)}%` : ''),
    );
    hourly.appendChild(d);
  });

  /* Days */
  const list = el('day-list');
  list.innerHTML = '';
  const lows = model.days.map((d) => d.low).filter(finite);
  const highs = model.days.map((d) => d.high).filter(finite);
  const wLo = lows.length ? Math.min(...lows) : 0, wHi = highs.length ? Math.max(...highs) : 100;
  model.days.forEach((d, idx) => {
    const det = make('details', 'day');
    if (idx === 0) det.open = true;
    const sum = make('summary');
    const left = make('span', 'dl', d.label || '');
    const mid = make('span', 'dc', d.condition || '');
    const right = make('span', 'dr');
    const hl = make('span', 'dhl');
    hl.append(document.createTextNode(d.high != null ? `${d.high}° ` : '-- '));
    const sm = make('small', null, d.low != null ? `/ ${d.low}°` : '');
    hl.appendChild(sm);
    right.appendChild(hl);
    if (d.pop != null && d.pop >= 10) right.appendChild(make('div', 'dp', `Rain ${d.pop}%`));
    sum.append(left, mid, right);
    if (finite(d.low) && finite(d.high) && wHi > wLo) {
      const bar = make('div', 'rangebar');
      const fill = make('i');
      fill.style.left = `${(((d.low - wLo) / (wHi - wLo)) * 100).toFixed(1)}%`;
      fill.style.width = `${Math.max(4, (((d.high - d.low) / (wHi - wLo)) * 100)).toFixed(1)}%`;
      bar.appendChild(fill);
      sum.appendChild(bar);
    }
    det.appendChild(sum);
    const body = make('div', 'dbody');
    if (d.detail) body.appendChild(make('p', null, d.detail));
    if (finite(d.qpf) && d.qpf > 0) body.appendChild(make('p', null, `Expected rain, if it comes: about ${d.qpf < 0.1 ? 'a few hundredths' : d.qpf.toFixed(2)} of an inch — ${d.qpf < 0.1 ? 'barely enough to wet the pavement' : d.qpf < 0.5 ? 'a light soaking' : d.qpf < 1 ? 'a solid rain' : 'a heavy rain; watch for puddles and slow drains'}.`));
    if (d.agreement || finite(d.highSpread)) {
      const p = make('p');
      const tag = make('span', 'agree ' + (/close/i.test(d.agreement || '') ? 'close' : /some/i.test(d.agreement || '') ? 'some' : /wide/i.test(d.agreement || '') ? 'wide' : ''), d.agreement || 'Model agreement');
      p.appendChild(tag);
      if (finite(d.highSpread)) p.appendChild(document.createTextNode(`  The models’ highs for this day span ${d.highSpread}° — ${d.highSpread <= 3 ? 'they’re basically telling the same story.' : d.highSpread <= 6 ? 'a little daylight between them; the truth is probably in the middle.' : 'they genuinely disagree, so treat this day as a rough sketch, not a promise.'}`));
      body.appendChild(p);
    }
    if (d.confidence?.summary) body.appendChild(make('p', null, `Confidence: ${d.confidence.label}. ${d.confidence.summary}`));
    det.appendChild(body);
    list.appendChild(det);
  });

  /* Detail cards — value, meaning, why */
  const cards = [];
  const D = model.details;
  if (finite(model.hero.feels)) cards.push({ k: 'Feels like', v: `${model.hero.feels}°`, m: model.hero.feels === model.hero.temp ? 'Right now your body agrees with the thermometer.' : model.hero.feels < model.hero.temp ? 'Wind is carrying heat away from your skin faster than your body replaces it.' : 'Humid air slows sweat evaporation, so your body cools less efficiently.', why: '“Feels like” combines the thermometer with wind chill in cold weather and the heat index in hot, humid weather — the two things your skin actually notices. It is the better number for deciding what to wear.' });
  if (finite(D.dewpoint)) { const w = dewpointWord(D.dewpoint); cards.push({ k: 'Dew point — the stickiness meter', v: `${D.dewpoint}°`, m: w ? `${w.word}. ${w.text}` : '', why: 'The dew point is the temperature at which air becomes saturated and dew forms. Unlike relative humidity, it reads the same all day, which is why forecasters trust it as the true “how muggy is it” number.' }); }
  if (finite(D.humidity)) cards.push({ k: 'Humidity', v: `${D.humidity}%`, m: D.humidity >= 70 ? 'The air is holding a lot of moisture.' : D.humidity <= 30 ? 'Dry air — skin and sinuses may notice.' : 'A middle-of-the-road amount of moisture.', why: 'Relative humidity is how full the air is compared with how much water it could hold at this temperature. Warm air holds more, so the same air feels drier as the day warms — that’s why dew point is the steadier guide.' });
  if (finite(D.wind)) cards.push({ k: 'Wind', v: `${D.wind} `, unit: `mph${D.windDir ? ' ' + D.windDir : ''}${finite(D.gust) && D.gust > D.wind ? ` · gusts ${D.gust}` : ''}`, m: D.wind >= 25 ? 'Strong — loose objects and high vehicles will feel it.' : D.wind >= 15 ? 'Breezy — you’ll notice it in trees and flags.' : D.wind >= 8 ? 'A light, noticeable breeze.' : 'Light air — barely a rustle.', why: 'The number is the sustained wind; gusts are the short bursts on top of it. Gusts, not the average, are what knock over the patio umbrella.' });
  if (finite(D.uv)) { const w = uvWord(D.uv); cards.push({ k: 'UV index', v: `${Math.round(D.uv)}`, m: w ? `${w.word}. ${w.text}` : '', why: 'The UV index rates the sun’s burning strength, peaking near solar noon. Clouds cut it less than most people expect — a bright overcast day can still burn.' }); }
  if (finite(D.aqi)) { const w = aqiWord(D.aqi); cards.push({ k: 'Air quality (AQI)', v: `${Math.round(D.aqi)}`, m: w ? `${w.word}. ${w.text}` : '', why: 'The Air Quality Index bundles pollutants like ozone and fine particles into one 0–500 scale. 50 or under is good; above 100, sensitive groups should start paying attention.' }); }
  if (finite(D.visibility)) cards.push({ k: 'Visibility', v: `${D.visibility} `, unit: 'mi', m: D.visibility >= 8 ? 'Clear views — you can see for miles.' : D.visibility >= 4 ? 'A bit hazy or misty in the distance.' : 'Poor — slow down and use headlights if you’re driving.', why: 'Visibility is how far you can see a large object in daylight. Fog, rain and smoke are what pull it down.' });
  if (finite(D.pressure)) cards.push({ k: 'Pressure', v: `${D.pressure} `, unit: 'in', m: 'Falling pressure usually means unsettled weather is on the way; rising pressure usually means calming skies.', why: 'Barometric pressure is simply the weight of the air above you. Storms are low-pressure systems; fair-weather highs are the heavy, sinking air that clears the sky.' });
  const grid = el('detail-grid');
  grid.innerHTML = '';
  for (const c of cards) {
    const d = make('div', 'detail');
    d.appendChild(make('div', 'dk', c.k));
    const dv = make('div', 'dv', c.v);
    if (c.unit) dv.appendChild(make('small', null, c.unit));
    d.appendChild(dv);
    if (c.m) d.appendChild(make('p', 'dm', c.m));
    const det = make('details', 'why');
    const sum = make('summary', null, 'What’s this?');
    det.append(sum, make('p', null, c.why));
    d.appendChild(det);
    grid.appendChild(d);
  }

  /* Science / confidence */
  const story = el('confidence-story');
  if (model.confidence?.label) {
    story.textContent = `Today’s forecast confidence is ${model.confidence.label.toLowerCase()}. ${model.confidence.summary || ''} That rating comes from agreement — how closely independent weather models match each other — not from anyone’s gut feeling.`;
  } else {
    story.textContent = 'Confidence measures how closely the independent weather models agree with each other. When they converge, the forecast is sturdy; when they spread out, we show the spread instead of pretending certainty.';
  }
  const ag = el('agreement-list');
  ag.innerHTML = '';
  for (const d of model.days.slice(0, 4)) {
    if (!finite(d.highSpread) && !d.agreement) continue;
    const row = make('div', 'agreement');
    row.appendChild(make('span', 'al', d.label || ''));
    const txt = make('span', null, finite(d.highSpread)
      ? `Model highs span ${d.highSpread}°${d.agreement ? ` — ${d.agreement.toLowerCase()}` : ''}. ${d.highSpread <= 3 ? 'Same story from every model.' : d.highSpread <= 6 ? 'Minor differences; the middle is the best bet.' : 'Real disagreement — keep plans flexible.'}`
      : (d.agreement || ''));
    row.appendChild(txt);
    ag.appendChild(row);
  }
  if (model.methodology) el('methodology').textContent = `The fine print, straight from the forecast engine: ${model.methodology}`;
}

/* ---------- loading ---------- */
let lastData = null, requestSeq = 0;
async function load(locationId) {
  const seq = ++requestSeq;
  const err = el('error');
  err.hidden = true;
  try {
    const res = await fetch(`/api/weather-fusion/forecast?location=${encodeURIComponent(locationId)}`, { credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/weather-fusion/login?returnTo=' + encodeURIComponent('/weather-fusion/aurora.html'); return; }
    if (!res.ok) throw new Error(`Weather service responded ${res.status}`);
    const data = await res.json();
    if (seq !== requestSeq) return;
    lastData = data;
    render(buildModel(data));
    el('loading').hidden = true;
    el('main').hidden = false;
  } catch (e) {
    if (seq !== requestSeq) return;
    if (lastData) render(buildModel(lastData));
    el('loading').hidden = true;
    el('main').hidden = false;
    err.hidden = false;
    err.textContent = 'Couldn’t refresh the forecast just now — showing the last one we received. Please try again in a bit.';
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  const select = el('loc-select');
  const initial = params.get('location') || 'knightdale';
  if ([...select.options].some((o) => o.value === initial)) select.value = initial;
  const go = () => {
    const url = new URL(location.href);
    url.searchParams.set('location', select.value);
    history.replaceState(null, '', url);
    load(select.value);
  };
  select.addEventListener('change', go);
  el('refresh').addEventListener('click', () => load(select.value));
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 2 * 60000) load(select.value);
  });
  setInterval(() => { if (!document.hidden) load(select.value); }, 10 * 60000);
  load(select.value);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
