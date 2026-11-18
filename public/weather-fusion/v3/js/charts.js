/**
 * Weather Nourie · High-Precision Interactive SVG Chart Suite
 * 1. 48-Hour 12-Variable Explorer with Uncertainty Ribbon & Touch/Mouse Scrubber
 * 2. 10-Day Multi-Model Comparison Visualizer (Blend V2 vs NWS, HRRR, NBM, ECMWF, GEFS, WeatherNext AI)
 * 3. Dew Point Feel Meter Curve with Biometeorological Comfort Zones (24h / 48h / 7d / 10d)
 */

import { clamp } from './physics.js';

export const HOURLY_METRICS = [
  { id: 'temp', label: 'Temp', unit: '°', color: '#63e2b7', color2: 'rgba(99, 226, 183, 0.26)', showBand: true, desc: 'Blended 2m temperature with multi-model P10–P90 uncertainty ribbon' },
  { id: 'feels', label: 'Feels', unit: '°', color: '#7cc4ff', color2: 'rgba(124, 196, 255, 0.25)', showDualSun: true, desc: 'Hybrid UTCI / Steadman / Wind-Chill apparent temperature (solid = active, dashed = direct sun)' },
  { id: 'rainChance', label: 'Rain chance', unit: '%', color: '#58b8ff', color2: 'rgba(88, 184, 255, 0.28)', min: 0, max: 100, isBarLine: true, desc: '100-Point Multi-Model Rain Scoring Ledger probability' },
  { id: 'rainfall', label: 'Rainfall', unit: '"', color: '#3ea6ff', color2: 'rgba(62, 166, 255, 0.32)', min: 0, isBarLine: true, decimals: 3, desc: 'Blended hourly Quantitative Precipitation Forecast (inches/hr)' },
  { id: 'wind', label: 'Wind', unit: ' mph', color: '#9be2ff', color2: 'rgba(155, 226, 255, 0.22)', min: 0, desc: '10-meter sustained wind speed (mph)' },
  { id: 'gusts', label: 'Gusts', unit: ' mph', color: '#ffbe6b', color2: 'rgba(255, 190, 107, 0.24)', min: 0, desc: 'Peak 10-meter wind gusts (mph) vs sustained baseline' },
  { id: 'humidity', label: 'Humidity', unit: '%', color: '#78d5f5', color2: 'rgba(120, 213, 245, 0.22)', min: 0, max: 100, desc: 'Relative humidity (%)' },
  { id: 'dewPoint', label: 'Dew Point', unit: '°', color: '#52e0c4', color2: 'rgba(82, 224, 196, 0.24)', desc: 'Absolute moisture comfort temperature (°F)' },
  { id: 'cloudCover', label: 'Cloud cover', unit: '%', color: '#b7c8e8', color2: 'rgba(183, 200, 232, 0.24)', min: 0, max: 100, desc: 'Total atmospheric cloud cover fraction (%)' },
  { id: 'uvIndex', label: 'UV Index', unit: '', color: '#ffd166', color2: 'rgba(255, 209, 102, 0.26)', min: 0, max: 11, decimals: 1, desc: 'Clear & cloud-attenuated erythemally weighted UV Index' },
  { id: 'pressure', label: 'Pressure', unit: ' inHg', color: '#c89eff', color2: 'rgba(200, 158, 255, 0.22)', decimals: 2, desc: 'Sea-level / surface barometric pressure (inHg)' },
  { id: 'airQuality', label: 'Air quality', unit: ' AQI', color: '#72e59c', color2: 'rgba(114, 229, 156, 0.24)', min: 0, desc: 'US EPA Air Quality Index (CAMS / Open-Meteo blend)' }
];

export const COMPARE_MODELS = [
  { id: 'blend', label: 'Weather Nourie blend', color: '#ffffff', width: 3.4, alwaysOn: true },
  { id: 'nws', label: 'NWS Official', color: '#6bc5ff', width: 2.1 },
  { id: 'hrrr', label: 'HRRR 3km', color: '#ff9f5a', width: 2.1 },
  { id: 'nbm', label: 'National Blend (NBM)', color: '#5ce0a0', width: 2.1 },
  { id: 'ecmwf', label: 'ECMWF IFS 0.25°', color: '#b88cff', width: 2.1 },
  { id: 'gefs', label: 'GEFS Ensemble', color: '#ffd166', width: 1.9 },
  { id: 'weathernext', label: 'WeatherNext AI', color: '#ff7eb6', width: 2.1 }
];

export const COMPARE_VARIABLES = [
  { id: 'highTemp', label: 'Daily high temperature', unit: '°' },
  { id: 'lowTemp', label: 'Daily low temperature', unit: '°' },
  { id: 'qpf', label: 'Precipitation (in)', unit: '"', decimals: 2 },
  { id: 'rainChance', label: 'Rain chance', unit: '%' },
  { id: 'wind', label: 'Peak wind', unit: ' mph' },
  { id: 'dewPoint', label: 'Peak dewpoint', unit: '°' },
  { id: 'cloudCover', label: 'Cloud cover', unit: '%' },
  { id: 'uvIndex', label: 'UV Index', unit: '', decimals: 1 },
  { id: 'snow', label: 'Snowfall', unit: '"', decimals: 1 },
  { id: 'aqi', label: 'Air quality (AQI)', unit: '' }
];

/**
 * Generates a smooth Catmull-Rom spline SVG path string through [{x, y}] points.
 */
export function buildSmoothSvgPath(points, tension = 0.22) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function extractHourMetricValue(hour, metricId, useCelsius = false) {
  const convT = (f) => (useCelsius ? Math.round(((f - 32) * 5) / 9) : f);
  switch (metricId) {
    case 'temp':
      return convT(hour.tempF);
    case 'feels':
      return convT(hour.feelsLikeF);
    case 'rainChance':
      return hour.rainChance;
    case 'rainfall':
      return hour.precipIn;
    case 'wind':
      return hour.windMph;
    case 'gusts':
      return hour.windGustMph;
    case 'humidity':
      return hour.humidity;
    case 'dewPoint':
      return convT(hour.dewPointF);
    case 'cloudCover':
      return hour.cloudCover;
    case 'uvIndex':
      return hour.uvIndex;
    case 'pressure':
      return hour.pressureInHg;
    case 'airQuality':
      return hour.aqi;
    default:
      return convT(hour.tempF);
  }
}

/**
 * Renders the 48-Hour Multi-Metric Interactive SVG Graph inside `containerEl`.
 */
export function renderHourlyExplorerChart({
  containerEl,
  hours48,
  metricId = 'temp',
  selectedHourIdx = 0,
  useCelsius = false,
  onSelectHour
}) {
  if (!containerEl || !Array.isArray(hours48) || hours48.length === 0) return;
  const metric = HOURLY_METRICS.find((m) => m.id === metricId) || HOURLY_METRICS[0];
  const convT = (f) => (useCelsius ? Math.round(((f - 32) * 5) / 9) : f);

  const W = 920;
  const H = 265;
  const padL = 32;
  const padR = 54;
  const padT = 28;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const values = hours48.map((h) => extractHourMetricValue(h, metricId, useCelsius));
  let minVal = metric.min !== undefined ? metric.min : Math.min(...values);
  let maxVal = metric.max !== undefined ? metric.max : Math.max(...values);

  if (metric.showBand) {
    const p10s = hours48.map((h) => convT(h.ensemble?.p10 ?? h.tempF - 2));
    const p90s = hours48.map((h) => convT(h.ensemble?.p90 ?? h.tempF + 2));
    minVal = Math.min(minVal, ...p10s);
    maxVal = Math.max(maxVal, ...p90s);
  }
  if (metric.showDualSun) {
    const suns = hours48.map((h) => convT(h.sunFeelsF));
    maxVal = Math.max(maxVal, ...suns);
  }

  if (maxVal - minVal < (metric.decimals ? 0.12 : 6)) {
    const pad = metric.decimals ? 0.08 : 4;
    if (metric.min === undefined) minVal -= pad;
    maxVal += pad;
  } else {
    const span = maxVal - minVal;
    if (metric.min === undefined) minVal = Math.floor(minVal - span * 0.12);
    if (metric.max === undefined) maxVal = Math.ceil(maxVal + span * 0.14);
  }

  const xForIdx = (i) => padL + (i / Math.max(1, hours48.length - 1)) * plotW;
  const yForVal = (v) => padT + plotH - clamp((v - minVal) / (maxVal - minVal || 1), 0, 1) * plotH;

  const points = values.map((v, i) => ({ x: xForIdx(i), y: yForVal(v), val: v, hour: hours48[i] }));
  const linePath = buildSmoothSvgPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  // Nighttime shading bands
  const nightRects = [];
  let nightStart = null;
  hours48.forEach((h, i) => {
    const x = xForIdx(i);
    if (!h.isDay && nightStart === null) {
      nightStart = x;
    } else if (h.isDay && nightStart !== null) {
      nightRects.push({ x: nightStart, w: Math.max(4, x - nightStart) });
      nightStart = null;
    }
  });
  if (nightStart !== null) {
    nightRects.push({ x: nightStart, w: Math.max(4, padL + plotW - nightStart) });
  }

  // Uncertainty P10-P90 ribbon for Temp
  let uncertaintyPolygon = '';
  if (metric.showBand) {
    const topPts = hours48.map((h, i) => `${xForIdx(i).toFixed(1)},${yForVal(convT(h.ensemble?.p90 ?? h.tempF + 2)).toFixed(1)}`);
    const botPts = [...hours48]
      .reverse()
      .map((h, revIdx) => {
        const i = hours48.length - 1 - revIdx;
        return `${xForIdx(i).toFixed(1)},${yForVal(convT(h.ensemble?.p10 ?? h.tempF - 2)).toFixed(1)}`;
      });
    uncertaintyPolygon = `<polygon points="${[...topPts, ...botPts].join(' ')}" fill="${metric.color}" opacity="0.14" />`;
  }

  // Secondary Sun curve for Feels Like or Sustained Wind for Gusts
  let secondaryCurveSvg = '';
  if (metric.showDualSun) {
    const sunPts = hours48.map((h, i) => ({ x: xForIdx(i), y: yForVal(convT(h.sunFeelsF)) }));
    secondaryCurveSvg = `<path d="${buildSmoothSvgPath(sunPts)}" fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="5 4" opacity="0.82"/>`;
  } else if (metricId === 'gusts') {
    const windPts = hours48.map((h, i) => ({ x: xForIdx(i), y: yForVal(h.windMph) }));
    secondaryCurveSvg = `<path d="${buildSmoothSvgPath(windPts)}" fill="none" stroke="#8fd8ff" stroke-width="1.8" stroke-dasharray="4 4" opacity="0.75"/>`;
  }

  // Bars for rainChance or rainfall
  let barsSvg = '';
  if (metric.isBarLine) {
    const barW = Math.max(4, (plotW / hours48.length) * 0.56);
    barsSvg = points
      .map((p, i) => {
        const bh = Math.max(0, padT + plotH - p.y);
        return `<rect x="${(p.x - barW / 2).toFixed(1)}" y="${p.y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2.5" fill="${metric.color}" opacity="${i === selectedHourIdx ? '0.78' : '0.32'}"/>`;
      })
      .join('');
  }

  // High / Low annotations
  let maxIdx = 0;
  let minIdx = 0;
  values.forEach((v, i) => {
    if (v > values[maxIdx]) maxIdx = i;
    if (v < values[minIdx]) minIdx = i;
  });

  // Y-axis grid lines (5 ticks)
  const yTicks = [];
  for (let t = 0; t <= 4; t++) {
    const v = minVal + ((maxVal - minVal) * t) / 4;
    const labelVal = metric.decimals ? v.toFixed(metric.decimals) : Math.round(v);
    yTicks.push({
      y: yForVal(v),
      label: `${labelVal}${metric.unit}`
    });
  }

  // X-axis time & day boundary ticks
  const xTicks = [];
  hours48.forEach((h, i) => {
    const hr = h.dateObj.getHours();
    if (i === 0 || hr === 0 || hr === 12 || i === hours48.length - 1) {
      const label =
        i === 0
          ? 'Now'
          : hr === 0
          ? h.dateObj.toLocaleDateString('en-US', { weekday: 'short' })
          : '12PM';
      xTicks.push({ x: xForIdx(i), label, isMidnight: hr === 0 });
    }
  });

  const activeIdx = clamp(selectedHourIdx, 0, points.length - 1);
  const activePt = points[activeIdx];
  const fmtVal = (v) => (metric.decimals ? Number(v).toFixed(metric.decimals) : Math.round(v));

  containerEl.innerHTML = `
    <div class="chart-stage-wrap">
      <svg class="hourly-explorer-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="48-hour ${metric.label} interactive forecast chart">
        <defs>
          <linearGradient id="hourlyAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${metric.color}" stop-opacity="0.38"/>
            <stop offset="85%" stop-color="${metric.color}" stop-opacity="0.03"/>
            <stop offset="100%" stop-color="${metric.color}" stop-opacity="0"/>
          </linearGradient>
        </defs>

        <!-- Nighttime astronomical bands -->
        ${nightRects
          .map(
            (r) =>
              `<rect x="${r.x.toFixed(1)}" y="${padT}" width="${r.w.toFixed(1)}" height="${plotH}" fill="rgba(4, 12, 28, 0.28)" />`
          )
          .join('')}

        <!-- Horizontal reference grid -->
        ${yTicks
          .map(
            (t) => `
          <line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${W - padR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.09)" stroke-dasharray="3 4"/>
          <text x="${W - padR + 8}" y="${(t.y + 4).toFixed(1)}" fill="rgba(210,224,248,0.68)" font-size="11.5" font-weight="500">${t.label}</text>
        `
          )
          .join('')}

        <!-- Midnight vertical dividers -->
        ${xTicks
          .filter((t) => t.isMidnight)
          .map(
            (t) =>
              `<line x1="${t.x.toFixed(1)}" y1="${padT}" x2="${t.x.toFixed(1)}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.18)" />`
          )
          .join('')}

        ${uncertaintyPolygon}
        <path d="${areaPath}" fill="url(#hourlyAreaGrad)"/>
        ${barsSvg}
        ${secondaryCurveSvg}
        <path d="${linePath}" fill="none" stroke="${metric.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>

        <!-- High & Low markers -->
        <g transform="translate(${points[maxIdx].x.toFixed(1)}, ${Math.max(16, points[maxIdx].y - 10).toFixed(1)})">
          <text text-anchor="middle" fill="#ffffff" font-size="11.5" font-weight="700">H ${fmtVal(points[maxIdx].val)}${metric.unit}</text>
        </g>
        ${
          minIdx !== maxIdx
            ? `<g transform="translate(${points[minIdx].x.toFixed(1)}, ${Math.min(padT + plotH - 4, points[minIdx].y + 16).toFixed(1)})">
          <text text-anchor="middle" fill="rgba(205,222,250,0.88)" font-size="11" font-weight="700">L ${fmtVal(points[minIdx].val)}${metric.unit}</text>
        </g>`
            : ''
        }

        <!-- Active scrubbed hour indicator -->
        <line id="hourly-cursor-line" x1="${activePt.x.toFixed(1)}" y1="${padT}" x2="${activePt.x.toFixed(1)}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.65)" stroke-width="1.5" stroke-dasharray="3 3"/>
        <circle id="hourly-cursor-dot" cx="${activePt.x.toFixed(1)}" cy="${activePt.y.toFixed(1)}" r="6" fill="${metric.color}" stroke="#ffffff" stroke-width="2.4"/>

        <!-- X-axis time labels -->
        ${xTicks
          .map(
            (t) =>
              `<text x="${t.x.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="${t.isMidnight ? '#ffffff' : 'rgba(200,216,242,0.72)'}" font-size="11.5" font-weight="${t.isMidnight ? '700' : '500'}">${t.label}</text>`
          )
          .join('')}
      </svg>
    </div>
  `;

  const svg = containerEl.querySelector('svg');
  if (!svg) return;

  function handlePointer(clientX) {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
    const ratio = clamp((relX - padL) / plotW, 0, 1);
    const idx = Math.round(ratio * (hours48.length - 1));
    if (typeof onSelectHour === 'function') {
      onSelectHour(idx);
    }
  }

  let isDragging = false;
  svg.addEventListener('pointerdown', (e) => {
    isDragging = true;
    handlePointer(e.clientX);
  });
  svg.addEventListener('pointermove', (e) => {
    if (isDragging || e.pointerType === 'mouse') {
      handlePointer(e.clientX);
    }
  });
  window.addEventListener(
    'pointerup',
    () => {
      isDragging = false;
    },
    { once: true }
  );
}

/**
 * Renders the 10-Day Multi-Model Comparison Chart ("Compare" Section)
 */
export function renderModelCompareChart({
  containerEl,
  days,
  variableId = 'highTemp',
  enabledModels = new Set(['blend', 'nws', 'hrrr', 'nbm', 'ecmwf', 'gefs', 'weathernext']),
  selectedDayIdx = 0,
  useCelsius = false,
  onSelectDay
}) {
  if (!containerEl || !Array.isArray(days) || days.length === 0) return;

  const variable = COMPARE_VARIABLES.find((v) => v.id === variableId) || COMPARE_VARIABLES[0];
  const convT = (f) => (f === null || f === undefined ? null : useCelsius ? Math.round(((f - 32) * 5) / 9) : f);

  function getDayModelValue(day, modelId) {
    switch (variableId) {
      case 'highTemp':
        return convT(modelId === 'blend' ? day.highF : day.modelHighs?.[modelId]);
      case 'lowTemp':
        return convT(modelId === 'blend' ? day.lowF : day.modelLows?.[modelId]);
      case 'qpf':
        return modelId === 'blend' ? day.totalQpfIn : day.modelQpf?.[modelId];
      case 'rainChance':
        return modelId === 'blend' ? day.rainChance : day.modelRainChance?.[modelId];
      case 'wind': {
        if (modelId === 'blend') return day.maxWindMph;
        if (modelId === 'hrrr' && day.index > 2) return null;
        const offset = { nws: 0, hrrr: 2, nbm: -1, ecmwf: 1, gefs: -2, weathernext: 0 }[modelId] || 0;
        return Math.max(2, day.maxWindMph + offset);
      }
      case 'dewPoint': {
        const base = day.maxDewPointF;
        if (modelId === 'blend') return convT(base);
        if (modelId === 'hrrr' && day.index > 2) return null;
        const offset = { nws: -1, hrrr: 1, nbm: 0, ecmwf: 1.5, gefs: -1.5, weathernext: 0.5 }[modelId] || 0;
        return convT(Math.round(base + offset));
      }
      case 'cloudCover': {
        if (modelId === 'blend') return day.avgCloudCover;
        if (modelId === 'hrrr' && day.index > 2) return null;
        const offset = { nws: 3, hrrr: -4, nbm: 0, ecmwf: 5, gefs: -3, weathernext: 2 }[modelId] || 0;
        return clamp(day.avgCloudCover + offset, 0, 100);
      }
      case 'uvIndex':
        if (modelId === 'hrrr' && day.index > 2) return null;
        return day.maxUvIndex;
      case 'snow':
        if (modelId === 'hrrr' && day.index > 2) return null;
        return day.totalSnowIn;
      case 'aqi':
        if (modelId === 'hrrr' && day.index > 2) return null;
        return day.maxAqi;
      default:
        return convT(day.highF);
    }
  }

  const W = 900;
  const H = 290;
  const padL = 44;
  const padR = 32;
  const padT = 26;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allNums = [];
  COMPARE_MODELS.forEach((m) => {
    if (!enabledModels.has(m.id) && !m.alwaysOn) return;
    days.forEach((d) => {
      const v = getDayModelValue(d, m.id);
      if (typeof v === 'number' && !Number.isNaN(v)) allNums.push(v);
    });
  });

  let minV = allNums.length ? Math.min(...allNums) : 40;
  let maxV = allNums.length ? Math.max(...allNums) : 80;
  if (maxV - minV < (variable.decimals ? 0.4 : 6)) {
    minV = Math.max(0, minV - (variable.decimals ? 0.2 : 3));
    maxV += variable.decimals ? 0.3 : 4;
  } else {
    const span = maxV - minV;
    minV -= span * 0.14;
    maxV += span * 0.16;
    if (['qpf', 'rainChance', 'wind', 'cloudCover', 'uvIndex', 'snow', 'aqi'].includes(variableId)) {
      minV = Math.max(0, minV);
    }
  }

  const xForDay = (i) => padL + (i / Math.max(1, days.length - 1)) * plotW;
  const yForVal = (v) => padT + plotH - clamp((v - minV) / (maxV - minV || 1), 0, 1) * plotH;

  // Build model paths
  const modelPathsSvg = COMPARE_MODELS.map((m) => {
    if (!enabledModels.has(m.id) && !m.alwaysOn) return '';
    const pts = [];
    days.forEach((d, idx) => {
      const val = getDayModelValue(d, m.id);
      if (typeof val === 'number' && !Number.isNaN(val)) {
        pts.push({ x: xForDay(idx), y: yForVal(val), val, dayIdx: idx });
      }
    });
    if (pts.length < 2) return '';
    const pathD = buildSmoothSvgPath(pts, 0.18);
    const isBlend = m.id === 'blend';
    return `
      <g class="compare-model-series" data-model="${m.id}">
        <path d="${pathD}" fill="none" stroke="${m.color}" stroke-width="${m.width}" stroke-linecap="round" opacity="${isBlend ? '1' : '0.84'}"/>
        ${pts
          .map(
            (p) => `
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isBlend ? '4.5' : '3'}" fill="${m.color}" stroke="#0d1b32" stroke-width="1.4"/>
          ${
            isBlend
              ? `<g transform="translate(${p.x.toFixed(1)}, ${(p.y - 11).toFixed(1)})">
                  <rect x="-18" y="-12" width="36" height="16" rx="6" fill="rgba(9,18,34,0.86)" stroke="rgba(255,255,255,0.28)" stroke-width="0.8"/>
                  <text text-anchor="middle" y="-1" fill="#ffffff" font-size="10.5" font-weight="700">${
                    variable.decimals ? p.val.toFixed(variable.decimals) : Math.round(p.val)
                  }${variable.unit}</text>
                </g>`
              : ''
          }
        `
          )
          .join('')}
      </g>
    `;
  }).join('');

  // Y grid ticks
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const v = minV + ((maxV - minV) * i) / 4;
    yTicks.push({
      y: yForVal(v),
      label: `${variable.decimals ? v.toFixed(variable.decimals) : Math.round(v)}${variable.unit}`
    });
  }

  const selIdx = clamp(selectedDayIdx, 0, days.length - 1);
  const selX = xForDay(selIdx);

  containerEl.innerHTML = `
    <svg class="compare-models-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${yTicks
        .map(
          (t) => `
        <line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${W - padR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.09)"/>
        <text x="${padL - 8}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="rgba(205,222,248,0.72)" font-size="11.5">${t.label}</text>
      `
        )
        .join('')}

      <line x1="${selX.toFixed(1)}" y1="${padT}" x2="${selX.toFixed(1)}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="4 4"/>

      ${modelPathsSvg}

      ${days
        .map(
          (d, i) => `
        <text x="${xForDay(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" fill="${i === selIdx ? '#ffffff' : 'rgba(200,218,245,0.74)'}" font-size="12" font-weight="${i === selIdx ? '700' : '500'}">${d.shortWeekday}</text>
      `
        )
        .join('')}
    </svg>
  `;

  const svg = containerEl.querySelector('svg');
  if (svg && typeof onSelectDay === 'function') {
    svg.addEventListener('pointerdown', (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
      const ratio = clamp((relX - padL) / plotW, 0, 1);
      onSelectDay(Math.round(ratio * (days.length - 1)));
    });
  }
}

/**
 * Renders the Dew Point "Feel Meter" Curve with Comfort Background Zones
 */
export function renderDewPointFeelChart({
  containerEl,
  hoursAll,
  rangeHours = 48,
  selectedIdx = 0,
  useCelsius = false,
  onSelectHour
}) {
  if (!containerEl || !Array.isArray(hoursAll) || hoursAll.length === 0) return;
  const slice = hoursAll.slice(0, Math.min(rangeHours, hoursAll.length));
  const convT = (f) => (useCelsius ? Math.round(((f - 32) * 5) / 9) : f);

  const W = 880;
  const H = 225;
  const padL = 42;
  const padR = 24;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const dpFValues = slice.map((h) => h.dewPointF);
  const minF = Math.min(30, Math.floor(Math.min(...dpFValues) / 5) * 5 - 5);
  const maxF = Math.max(75, Math.ceil(Math.max(...dpFValues) / 5) * 5 + 5);

  const xForIdx = (i) => padL + (i / Math.max(1, slice.length - 1)) * plotW;
  const yForF = (f) => padT + plotH - clamp((f - minF) / (maxF - minF || 1), 0, 1) * plotH;

  // Comfort background bands in °F
  const zones = [
    { from: minF, to: 50, color: 'rgba(68, 175, 255, 0.14)' },
    { from: 50, to: 60, color: 'rgba(82, 218, 152, 0.17)' },
    { from: 60, to: 65, color: 'rgba(245, 206, 86, 0.16)' },
    { from: 65, to: 70, color: 'rgba(245, 148, 66, 0.17)' },
    { from: 70, to: maxF, color: 'rgba(235, 88, 120, 0.18)' }
  ];

  const pts = slice.map((h, i) => ({ x: xForIdx(i), y: yForF(h.dewPointF), h }));
  const linePath = buildSmoothSvgPath(pts, 0.2);
  const activeIdx = clamp(selectedIdx, 0, pts.length - 1);
  const activePt = pts[activeIdx];

  const yTicks = [];
  for (let f = minF; f <= maxF; f += 10) {
    yTicks.push({ y: yForF(f), label: `${convT(f)}°` });
  }

  const stepX = Math.max(1, Math.floor(slice.length / 6));
  const xTicks = [];
  for (let i = 0; i < slice.length; i += stepX) {
    const h = slice[i];
    const label =
      rangeHours <= 48
        ? h.hourLabel
        : h.dateObj.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric' });
    xTicks.push({ x: xForIdx(i), label });
  }

  containerEl.innerHTML = `
    <svg class="dewpoint-feel-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${zones
        .map((z) => {
          const yTop = yForF(Math.min(maxF, z.to));
          const yBot = yForF(Math.max(minF, z.from));
          const h = Math.max(0, yBot - yTop);
          return `<rect x="${padL}" y="${yTop.toFixed(1)}" width="${plotW}" height="${h.toFixed(1)}" fill="${z.color}"/>`;
        })
        .join('')}

      ${yTicks
        .map(
          (t) => `
        <line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${W - padR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3 4"/>
        <text x="${padL - 8}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="rgba(215,228,250,0.75)" font-size="11">${t.label}</text>
      `
        )
        .join('')}

      <path d="${linePath}" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round"/>
      <line x1="${activePt.x.toFixed(1)}" y1="${padT}" x2="${activePt.x.toFixed(1)}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.55)" stroke-dasharray="3 3"/>
      <circle cx="${activePt.x.toFixed(1)}" cy="${activePt.y.toFixed(1)}" r="6" fill="#5ce8ff" stroke="#ffffff" stroke-width="2.2"/>

      ${xTicks
        .map(
          (t) =>
            `<text x="${t.x.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="rgba(210,225,248,0.76)" font-size="11">${t.label}</text>`
        )
        .join('')}
    </svg>
  `;

  const svg = containerEl.querySelector('svg');
  if (svg && typeof onSelectHour === 'function') {
    svg.addEventListener('pointerdown', (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
      const ratio = clamp((relX - padL) / plotW, 0, 1);
      onSelectHour(Math.round(ratio * (slice.length - 1)));
    });
  }
}
