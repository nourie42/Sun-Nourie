/**
 * Weather Nourie · High-Precision Interactive SVG Chart Suite
 * 1. 48-Hour 12-Variable Explorer with Uncertainty Ribbon & Touch/Mouse Scrubber
 * 2. 10-Day Multi-Model Comparison Visualizer (Blend V2 vs NWS, HRRR, NBM, ECMWF, GEFS, WeatherNext AI)
 * 3. Dew Point Feel Meter Curve with Biometeorological Comfort Zones (24h / 48h / 7d / 10d)
 */

import { clamp } from './physics.js';

export const HOURLY_METRICS = [
  { id: 'temp', label: 'Temp', unit: '°', color: '#63e2b7', color2: 'rgba(99, 226, 183, 0.26)', showBand: true, desc: 'Hour-by-hour temperature trend' },
  { id: 'feels', label: 'Feels Like', unit: '°', color: '#7cc4ff', color2: 'rgba(124, 196, 255, 0.25)', showDualSun: true, desc: 'How it actually feels outside (solid = shade/ambient, dashed = direct sun)' },
  { id: 'rainChance', label: 'Rain Chance', unit: '%', color: '#58b8ff', color2: 'rgba(88, 184, 255, 0.28)', min: 0, max: 100, isBarLine: true, desc: 'Hourly chance of rain (%)' },
  { id: 'rainfall', label: 'Rainfall', unit: '"', color: '#3ea6ff', color2: 'rgba(62, 166, 255, 0.32)', min: 0, isBarLine: true, decimals: 3, desc: 'Expected rainfall per hour (inches)' },
  { id: 'wind', label: 'Wind', unit: ' mph', color: '#9be2ff', color2: 'rgba(155, 226, 255, 0.22)', min: 0, desc: 'Wind speed (mph)' },
  { id: 'gusts', label: 'Wind Gusts', unit: ' mph', color: '#ffbe6b', color2: 'rgba(255, 190, 107, 0.24)', min: 0, desc: 'Strongest wind gusts (mph)' },
  { id: 'humidity', label: 'Humidity', unit: '%', color: '#78d5f5', color2: 'rgba(120, 213, 245, 0.22)', min: 0, max: 100, desc: 'Relative humidity (%)' },
  { id: 'dewPoint', label: 'Dew Point', unit: '°', color: '#52e0c4', color2: 'rgba(82, 224, 196, 0.24)', desc: 'How muggy or dry the air feels' },
  { id: 'cloudCover', label: 'Clouds', unit: '%', color: '#b7c8e8', color2: 'rgba(183, 200, 232, 0.24)', min: 0, max: 100, desc: 'Expected sky cloud cover (%)' },
  { id: 'uvIndex', label: 'UV Index', unit: '', color: '#ffd166', color2: 'rgba(255, 209, 102, 0.26)', min: 0, max: 11, decimals: 1, desc: 'Sun strength / UV index' },
  { id: 'pressure', label: 'Pressure', unit: ' inHg', color: '#c89eff', color2: 'rgba(200, 158, 255, 0.22)', decimals: 2, desc: 'Barometric air pressure (inHg)' },
  { id: 'airQuality', label: 'Air Quality', unit: ' AQI', color: '#72e59c', color2: 'rgba(114, 229, 156, 0.24)', min: 0, desc: 'Air quality index' }
];

export const COMPARE_MODELS = [
  { id: 'blend', label: 'Weather Nourie', color: '#ffffff', width: 4.8, dash: '', alwaysOn: true },
  { id: 'nws', label: 'NWS', color: '#38bdf8', width: 2.2, dash: '' },
  { id: 'hrrr', label: 'HRRR', color: '#ff9248', width: 2.2, dash: '' },
  { id: 'nbm', label: 'NBM', color: '#34d399', width: 2.2, dash: '6 3' },
  { id: 'ecmwf', label: 'ECMWF', color: '#c084fc', width: 2.2, dash: '' },
  { id: 'gefs', label: 'GEFS', color: '#facc15', width: 2.0, dash: '3 3' },
  { id: 'weathernext', label: 'WeatherNext AI', color: '#f472b6', width: 2.2, dash: '8 3' }
];

export const COMPARE_VARIABLES = [
  { id: 'highTemp', label: 'High Temp', unit: '°' },
  { id: 'lowTemp', label: 'Low Temp', unit: '°' },
  { id: 'rainChance', label: 'Rain Chance', unit: '%', min: 0, max: 100 },
  { id: 'qpf', label: 'Rain Amount', unit: '"', decimals: 2, min: 0 },
  { id: 'wind', label: 'Peak Wind', unit: ' mph', min: 0 },
  { id: 'dewPoint', label: 'Dew Point', unit: '°' },
  { id: 'cloudCover', label: 'Cloud Cover', unit: '%', min: 0, max: 100 }
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

  if (metric.decimals) {
    const rawSpan = Math.max(0.06, maxVal - minVal);
    const pad = Math.max(0.03, rawSpan * 0.15);
    if (metric.min === undefined) minVal = Number((minVal - pad).toFixed(metric.decimals));
    if (metric.max === undefined) maxVal = Number((maxVal + pad).toFixed(metric.decimals));
  } else if (maxVal - minVal < 6) {
    const pad = 3;
    if (metric.min === undefined) minVal = Math.floor(minVal - pad);
    if (metric.max === undefined) maxVal = Math.ceil(maxVal + pad);
  } else {
    const span = maxVal - minVal;
    if (metric.min === undefined) minVal = Math.floor(minVal - Math.max(1.5, span * 0.1));
    if (metric.max === undefined) maxVal = Math.ceil(maxVal + Math.max(1.5, span * 0.12));
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
export function extractDayModelCompareValue(day, modelId, variableId = 'highTemp', useCelsius = false) {
  if (!day) return null;
  const convT = (f) => (f === null || f === undefined || Number.isNaN(f) ? null : useCelsius ? Math.round(((f - 32) * 5) / 9) : f);
  switch (variableId) {
    case 'highTemp':
      return convT(modelId === 'blend' ? day.highF : day.modelHighs?.[modelId] ?? null);
    case 'lowTemp':
      return convT(modelId === 'blend' ? day.lowF : day.modelLows?.[modelId] ?? null);
    case 'qpf':
      return modelId === 'blend' ? day.totalQpfIn : (day.modelQpf?.[modelId] ?? null);
    case 'rainChance':
      return modelId === 'blend' ? day.rainChance : (day.modelRainChance?.[modelId] ?? null);
    case 'wind':
      return modelId === 'blend' ? day.maxWindMph : (day.modelWind?.[modelId] ?? null);
    case 'dewPoint':
      return convT(modelId === 'blend' ? day.maxDewPointF : (day.modelDewPoint?.[modelId] ?? null));
    case 'cloudCover':
      return modelId === 'blend' ? day.avgCloudCover : (day.modelCloudCover?.[modelId] ?? null);
    default:
      return convT(day.highF);
  }
}

export function renderModelCompareChart({
  containerEl,
  days,
  horizonDays = 5,
  variableId = 'highTemp',
  enabledModels = new Set(['blend', 'nws', 'hrrr', 'nbm', 'ecmwf', 'gefs', 'weathernext']),
  selectedDayIdx = 0,
  highlightedModelId = null,
  useCelsius = false,
  onSelectDay,
  onSelectModel
}) {
  if (!containerEl || !Array.isArray(days) || days.length === 0) return;

  const visibleDays = days.slice(0, clamp(horizonDays, 3, days.length));
  const variable = COMPARE_VARIABLES.find((v) => v.id === variableId) || COMPARE_VARIABLES[0];
  const getDayModelValue = (day, modelId) => extractDayModelCompareValue(day, modelId, variableId, useCelsius);

  // 340px-wide native coordinate space -> 1:1 physical pixel scale on mobile with zero shrinking
  const W = 340;
  const H = 285;
  const padL = 50;
  const padR = 24;
  const padT = 32;
  const padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allNums = [];
  COMPARE_MODELS.forEach((m) => {
    if (!enabledModels.has(m.id) && !m.alwaysOn) return;
    visibleDays.forEach((d) => {
      const v = getDayModelValue(d, m.id);
      if (typeof v === 'number' && !Number.isNaN(v)) allNums.push(v);
    });
  });

  // Tight bounds so real model differences stand out clearly, while clamping percentages 0..100%
  let minV = allNums.length ? Math.min(...allNums) : 40;
  let maxV = allNums.length ? Math.max(...allNums) : 80;
  const rawSpan = maxV - minV;
  if (variable.decimals) {
    const pad = Math.max(0.05, rawSpan * 0.14);
    minV = Math.max(0, Number((minV - pad * 0.5).toFixed(variable.decimals)));
    maxV = Number((maxV + pad).toFixed(variable.decimals));
    if (maxV - minV < 0.25) maxV = Number((minV + 0.25).toFixed(variable.decimals));
  } else if (rawSpan < 4) {
    minV = Math.floor(minV - 2);
    maxV = Math.ceil(maxV + 2);
  } else {
    const pad = Math.max(1, rawSpan * 0.10);
    minV = Math.floor(minV - pad);
    maxV = Math.ceil(maxV + pad * 1.15);
  }
  if (variable.min !== undefined) minV = Math.max(variable.min, minV);
  if (variable.max !== undefined) {
    maxV = Math.min(variable.max, maxV);
    if (!variable.decimals && maxV - minV < 8) minV = Math.max(variable.min ?? 0, maxV - 8);
  }

  const xForDay = (i) => padL + (i / Math.max(1, visibleDays.length - 1)) * plotW;
  const yForVal = (v) => padT + plotH - clamp((v - minV) / (maxV - minV || 1), 0, 1) * plotH;

  // Per-day min/max across active models to draw a shaded model-spread envelope
  const dayBounds = visibleDays.map((d, idx) => {
    const dayVals = [];
    COMPARE_MODELS.forEach((m) => {
      if (!enabledModels.has(m.id) && !m.alwaysOn) return;
      const v = getDayModelValue(d, m.id);
      if (typeof v === 'number' && !Number.isNaN(v)) dayVals.push(v);
    });
    const dMin = dayVals.length ? Math.min(...dayVals) : minV;
    const dMax = dayVals.length ? Math.max(...dayVals) : maxV;
    return { x: xForDay(idx), minV: dMin, maxV: dMax, minY: yForVal(dMin), maxY: yForVal(dMax) };
  });
  const spreadPolygonPts = [
    ...dayBounds.map((b) => `${b.x.toFixed(1)},${b.maxY.toFixed(1)}`),
    ...[...dayBounds].reverse().map((b) => `${b.x.toFixed(1)},${b.minY.toFixed(1)}`)
  ].join(' ');

  // Individual models first, Weather Nourie Blend and any user-clicked model cleanly on top
  const orderedModels = [
    ...COMPARE_MODELS.filter((m) => m.id !== 'blend' && m.id !== highlightedModelId),
    ...COMPARE_MODELS.filter((m) => m.id === 'blend' && m.id !== highlightedModelId),
    ...COMPARE_MODELS.filter((m) => m.id === highlightedModelId)
  ];

  const selIdx = clamp(selectedDayIdx, 0, visibleDays.length - 1);
  const selX = xForDay(selIdx);
  const selDay = visibleDays[selIdx] || visibleDays[0];
  const fmtV = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${variable.decimals ? Number(v).toFixed(variable.decimals) : Math.round(v)}${variable.unit}`);

  const modelPathsSvg = orderedModels.map((m) => {
    if (!enabledModels.has(m.id) && !m.alwaysOn) return '';
    const pts = [];
    visibleDays.forEach((d, idx) => {
      const val = getDayModelValue(d, m.id);
      if (typeof val === 'number' && !Number.isNaN(val)) {
        pts.push({ x: xForDay(idx), y: yForVal(val), val, dayIdx: idx });
      }
    });
    if (pts.length === 0) return '';
    const pathD = pts.length >= 2 ? buildSmoothSvgPath(pts, 0.22) : '';
    const isBlend = m.id === 'blend';
    const isHighlighted = m.id === highlightedModelId;
    const isProminent = isHighlighted || (!highlightedModelId && isBlend);
    const strokeW = isHighlighted ? 3.5 : isBlend ? 3.0 : 2.1;
    const strokeOp = isHighlighted ? '1' : highlightedModelId ? (isBlend ? '0.78' : '0.45') : (isBlend ? '1' : '0.92');
    return `
      <g class="compare-model-series" data-model="${m.id}" style="cursor:pointer;">
        ${
          pathD
            ? `<path d="${pathD}" fill="none" stroke="transparent" stroke-width="16" stroke-linecap="round"/>`
            : ''
        }
        ${
          pathD && isProminent
            ? `<path d="${pathD}" fill="none" stroke="${m.color}" stroke-opacity="0.28" stroke-width="7" stroke-linecap="round"/>`
            : ''
        }
        ${
          pathD
            ? `<path d="${pathD}" fill="none" stroke="${m.color}" stroke-width="${strokeW}" stroke-dasharray="${isBlend || isHighlighted ? '' : (m.dash ? '4 3' : '')}" stroke-linecap="round" stroke-linejoin="round" opacity="${strokeOp}"/>`
            : ''
        }
        ${pts
          .map((p, idx) => {
            const isSel = p.dayIdx === selIdx;
            const showValue = isProminent && (isSel || visibleDays.length <= 5 || idx % 2 === 0);
            const lblY = p.y - 12 < 14 ? p.y + 18 : p.y - 11;
            const lblX = clamp(p.x, padL + 12, W - 18);
            const dotR = isProminent ? (isSel ? '4.8' : '3.2') : (isSel ? '3.6' : '2.3');
            return `
              <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotR}" fill="${m.color}" stroke="${isSel ? 'rgba(6,16,34,0.9)' : 'none'}" stroke-width="${isSel ? '1.4' : '0'}" opacity="${isProminent || isSel ? '1' : strokeOp}"/>
              ${
                showValue
                  ? isSel
                    ? `<g transform="translate(${lblX.toFixed(1)}, ${(lblY - 3).toFixed(1)})">
                        <rect x="-22" y="-12" width="44" height="17" rx="6" fill="rgba(8, 22, 44, 0.94)" stroke="${m.color}" stroke-width="1.2"/>
                        <text text-anchor="middle" y="0" fill="#ffffff" font-size="11.5" font-weight="800">${
                          variable.decimals ? p.val.toFixed(variable.decimals) : Math.round(p.val)
                        }${variable.unit}</text>
                      </g>`
                    : `<text x="${lblX.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="middle" fill="#f8fbff" font-size="11.5" font-weight="700" style="paint-order:stroke;stroke:rgba(6,16,34,0.75);stroke-width:2.5px;">${
                        variable.decimals ? p.val.toFixed(variable.decimals) : Math.round(p.val)
                      }${variable.unit}</text>`
                  : ''
              }
            `;
          })
          .join('')}
      </g>
    `;
  }).join('');

  // Clean horizontal gridlines
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const v = minV + ((maxV - minV) * i) / 4;
    yTicks.push({
      y: yForVal(v),
      label: `${variable.decimals ? v.toFixed(variable.decimals) : Math.round(v)}${variable.unit}`
    });
  }

  const activeModelObj = COMPARE_MODELS.find((m) => m.id === (highlightedModelId || 'blend')) || COMPARE_MODELS[0];
  const activeModelVal = getDayModelValue(selDay, activeModelObj.id);
  const wnSelVal = getDayModelValue(selDay, 'blend');
  const activeDiff =
    activeModelObj.id !== 'blend' && typeof activeModelVal === 'number' && typeof wnSelVal === 'number'
      ? activeModelVal - wnSelVal
      : null;
  const activeDiffText =
    activeDiff === null
      ? 'Consensus Blend'
      : Math.abs(activeDiff) < (variable.decimals ? 0.01 : 0.5)
      ? 'Matches Weather Nourie'
      : `${activeDiff > 0 ? '+' : ''}${variable.decimals ? activeDiff.toFixed(variable.decimals) : Math.round(activeDiff)}${variable.unit} vs Weather Nourie (${fmtV(wnSelVal)})`;

  containerEl.innerHTML = `
    <div class="compare-live-banner" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:7px 11px;margin-bottom:6px;border-radius:11px;background:rgba(12,26,48,0.45);border:1px solid ${activeModelObj.color};font-size:12.5px;">
      <span style="display:inline-flex;align-items:center;gap:7px;">
        <i style="width:12px;height:3.5px;border-radius:2px;background:${activeModelObj.color};display:inline-block;"></i>
        <strong style="color:#ffffff;">${activeModelObj.id === 'blend' ? 'Weather Nourie' : activeModelObj.label}</strong>
        <span style="color:#cfe2f6;">· ${selDay.shortWeekday} (${selDay.dateLabel}):</span>
        <strong style="color:${activeModelObj.color};font-size:14px;">${fmtV(activeModelVal)}</strong>
      </span>
      <span style="font-size:11.5px;color:#9fd3ff;">${activeDiffText} · Tap any line or day</span>
    </div>
    <svg class="compare-models-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="cursor:pointer;">
      ${yTicks
        .map(
          (t) => `
        <line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${W - padR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
        <text x="${padL - 8}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="rgba(218,234,252,0.78)" font-size="11.5" font-weight="600">${t.label}</text>
      `
        )
        .join('')}

      <polygon points="${spreadPolygonPts}" fill="rgba(125, 211, 252, 0.13)" />
      <line x1="${selX.toFixed(1)}" y1="${padT}" x2="${selX.toFixed(1)}" y2="${padT + plotH}" stroke="rgba(125, 211, 252, 0.55)" stroke-width="1.2" stroke-dasharray="3 3"/>

      ${modelPathsSvg}

      ${visibleDays
        .map((d, i) => {
          const x = xForDay(i).toFixed(1);
          const dateNum = d.dateLabel.replace(/^[A-Za-z]+\s+/, '');
          const isSel = i === selIdx;
          const labelStep = visibleDays.length > 7 && i % 2 === 1 && !isSel;
          if (labelStep) return '';
          return `
            <g>
              <text x="${x}" y="${H - 25}" text-anchor="middle" fill="${isSel ? '#ffffff' : 'rgba(215,232,252,0.86)'}" font-size="12.5" font-weight="${isSel ? '800' : '600'}">${d.shortWeekday}</text>
              <text x="${x}" y="${H - 8}" text-anchor="middle" fill="${isSel ? '#7dd3fc' : 'rgba(190,214,248,0.75)'}" font-size="11" font-weight="600">${d.index === 0 ? d.dateLabel : dateNum}</text>
            </g>
          `;
        })
        .join('')}
    </svg>
  `;

  const svg = containerEl.querySelector('svg');
  if (svg) {
    svg.addEventListener('pointerdown', (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
      const relY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * H;
      const ratio = clamp((relX - padL) / plotW, 0, 1);
      const dayIdx = Math.round(ratio * (visibleDays.length - 1));
      const d = visibleDays[dayIdx];

      // Find which model curve is closest to the tap Y coordinate at this day
      const seriesGroup = e.target?.closest?.('[data-model]');
      let pickedModel = seriesGroup?.getAttribute('data-model') || null;
      if (!pickedModel && d) {
        let bestDist = 26;
        COMPARE_MODELS.forEach((m) => {
          if (!enabledModels.has(m.id) && !m.alwaysOn) return;
          const v = getDayModelValue(d, m.id);
          if (typeof v === 'number' && !Number.isNaN(v)) {
            const dist = Math.abs(yForVal(v) - relY);
            if (dist < bestDist) {
              bestDist = dist;
              pickedModel = m.id;
            }
          }
        });
      }
      if (pickedModel && typeof onSelectModel === 'function') {
        onSelectModel(pickedModel, dayIdx);
      } else if (typeof onSelectDay === 'function') {
        onSelectDay(dayIdx);
      }
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

/**
 * Renders ALL 24 upcoming hours in the "Next 24 Hours" card on screen simultaneously
 * (Zero horizontal scrolling!) with 8 evenly spaced 3-hour anchor icons/values + interactive 24-hour scrubber.
 */
export function renderNext24HoursSplineChart({
  containerEl,
  hours,
  metricId = 'temp',
  selectedHourIdx = 0,
  useCelsius = false,
  renderIconFn,
  onSelectHour
}) {
  if (!containerEl || !Array.isArray(hours) || hours.length === 0) return;

  const slice = hours.slice(0, 24);
  const convT = (f) => (useCelsius ? Math.round(((f - 32) * 5) / 9) : Math.round(f));

  const getVal = (h) => {
    if (metricId === 'feels') return convT(h.feelsLikeF);
    if (metricId === 'rain') return Math.round(h.rainChance ?? 0);
    if (metricId === 'wind') return Math.round(h.windMph ?? 0);
    return convT(h.tempF);
  };
  const fmtVal = (v) => {
    if (metricId === 'rain') return `${v}%`;
    if (metricId === 'wind') return `${v} mph`;
    return `${v}°`;
  };
  const fmtShort = (v) => {
    if (metricId === 'rain') return `${v}%`;
    if (metricId === 'wind') return `${v}`;
    return `${v}°`;
  };
  const compactTime = (lbl, idx) =>
    idx === 0 ? 'Now' : String(lbl || '').replace(/AM$/i, 'a').replace(/PM$/i, 'p');

  const unitSuffix = metricId === 'rain' ? '%' : metricId === 'wind' ? '' : '°';
  const vals = slice.map(getVal);
  let minVal = metricId === 'rain' || metricId === 'wind' ? 0 : Math.min(...vals);
  let maxVal = metricId === 'rain' ? Math.max(40, Math.max(...vals)) : Math.max(...vals);

  if (metricId === 'temp' || metricId === 'feels') {
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const pad = Math.max(2, Math.ceil((rawMax - rawMin) * 0.15));
    minVal = rawMin - pad;
    maxVal = rawMax + pad;
    if (maxVal - minVal < 6) {
      minVal -= 2;
      maxVal += 2;
    }
  } else if (metricId === 'rain') {
    maxVal = Math.min(100, Math.max(20, Math.ceil((maxVal + 5) / 10) * 10));
  } else {
    const rawMin = Math.min(...vals);
    minVal = Math.max(0, rawMin - 2);
    maxVal = Math.max(minVal + 6, Math.ceil(maxVal + 2));
  }

  // Native 340px width fits 1:1 inside mobile card with zero scrolling & large readable text
  const W = 340;
  const H = 160;
  const padL = 42;
  const padR = 14;
  const padT = 26;
  const padB = 12;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xForIdx = (i) => padL + (i / Math.max(1, slice.length - 1)) * plotW;
  const yForVal = (v) => padT + plotH - clamp((v - minVal) / (maxVal - minVal || 1), 0, 1) * plotH;

  const points = vals.map((v, i) => ({ x: xForIdx(i), y: yForVal(v), val: v, hour: slice[i] }));
  const smoothPath = buildSmoothSvgPath(points, 0.22);
  const areaPath = `${smoothPath} L ${points[points.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const tickCount = 3;
  const yTicks = [];
  for (let t = 0; t <= tickCount; t++) {
    const v = minVal + ((maxVal - minVal) * t) / tickCount;
    yTicks.push({
      y: yForVal(v),
      label: `${Math.round(v)}${unitSuffix}`
    });
  }

  const strokeGradId = `n24-stroke-${metricId}`;
  const fillGradId = `n24-fill-${metricId}`;
  const isRain = metricId === 'rain';
  const isWind = metricId === 'wind';
  const cStart = isRain ? '#8dc4f0' : isWind ? '#9fd3c7' : '#ecc18d';
  const cMid = isRain ? '#7db7ea' : isWind ? '#8ec4d8' : '#e5a77e';
  const cEnd = isRain ? '#9cbbe8' : isWind ? '#9ecae0' : '#d6b69c';

  // 8 evenly spaced 3-hour anchor points across the full 24 hours
  const anchorIndices = [0, 3, 6, 9, 12, 15, 18, 21].filter((idx) => idx < slice.length);
  const activeLocalIdx = clamp(selectedHourIdx, 0, slice.length - 1);
  const activePt = points[activeLocalIdx];

  const colDx = anchorIndices.length > 1 ? xForIdx(anchorIndices[1]) - xForIdx(anchorIndices[0]) : plotW / 8;
  const footLeftPct = clamp(((xForIdx(anchorIndices[0]) - colDx / 2) / W) * 100, 0, 20);
  const footRightPct = clamp(((W - (xForIdx(anchorIndices[anchorIndices.length - 1]) + colDx / 2)) / W) * 100, 0, 20);

  const readoutText = (idx) => {
    const h = slice[idx];
    const lbl = idx === 0 ? 'Now' : h.hourLabel;
    const vStr = fmtVal(vals[idx]);
    return `<strong>${lbl}</strong> · <span style="color:${cMid};font-weight:800;">${vStr}</span> · ${h.condition} · 💧 ${h.rainChance}% · ${h.windMph} mph`;
  };

  containerEl.innerHTML = `
    <div class="n24-chart-shell n24-no-scroll">
      <div class="n24-live-readout">
        <span id="n24-live-readout-text">${readoutText(activeLocalIdx)}</span>
        <span class="n24-scrub-tip">All 24h · slide</span>
      </div>

      <svg class="n24-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Next 24 hours ${metricId} spline chart">
        <defs>
          <linearGradient id="${strokeGradId}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${cStart}"/>
            <stop offset="55%" stop-color="${cMid}"/>
            <stop offset="100%" stop-color="${cEnd}"/>
          </linearGradient>
          <linearGradient id="${fillGradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${cStart}" stop-opacity="0.22"/>
            <stop offset="65%" stop-color="${cMid}" stop-opacity="0.06"/>
            <stop offset="100%" stop-color="${cEnd}" stop-opacity="0.0"/>
          </linearGradient>
        </defs>

        ${yTicks
          .map(
            (t) => `
          <line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${W - padR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.09)" stroke-width="1"/>
          <text x="${padL - 8}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="rgba(225,238,252,0.78)" font-size="11.5" font-weight="600">${t.label}</text>
        `
          )
          .join('')}

        <path d="${areaPath}" fill="url(#${fillGradId})"/>
        <path d="${smoothPath}" fill="none" stroke="url(#${strokeGradId})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>

        <line id="n24-cursor-line" x1="${activePt.x.toFixed(1)}" y1="${padT - 4}" x2="${activePt.x.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="rgba(255,255,255,0.42)" stroke-width="1.2" stroke-dasharray="3 3"/>

        ${anchorIndices
          .map((idx) => {
            const p = points[idx];
            const valX = idx === 0 ? p.x + 8 : p.x;
            return `
              <g class="n24-anchor-pt" data-h-idx="${idx}" style="cursor:pointer;">
                <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.0" fill="#ffffff" stroke="${cStart}" stroke-width="1.3"/>
                <text x="${valX.toFixed(1)}" y="${Math.max(15, p.y - 10).toFixed(1)}" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="700">${fmtShort(p.val)}</text>
              </g>
            `;
          })
          .join('')}

        <circle id="n24-cursor-dot" cx="${activePt.x.toFixed(1)}" cy="${activePt.y.toFixed(1)}" r="4.6" fill="#ffffff" stroke="${cStart}" stroke-width="2.0"/>
      </svg>

      <div class="n24-cols-footer-8" style="padding-left:${footLeftPct.toFixed(2)}%;padding-right:${footRightPct.toFixed(2)}%;">
        ${anchorIndices
          .map((idx) => {
            const h = slice[idx];
            const bucketIdx = Math.floor(activeLocalIdx / 3) * 3;
            return `
              <button type="button" class="n24-col-btn ${bucketIdx === idx ? 'active' : ''}" data-h-idx="${idx}">
                <span class="n24-col-icon">${typeof renderIconFn === 'function' ? renderIconFn(h.icon, 24) : ''}</span>
                <span class="n24-col-time">${compactTime(h.hourLabel, idx)}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    </div>
  `;

  const svg = containerEl.querySelector('.n24-svg');
  const readoutSpan = containerEl.querySelector('#n24-live-readout-text');
  const cursorLine = containerEl.querySelector('#n24-cursor-line');
  const cursorDot = containerEl.querySelector('#n24-cursor-dot');

  function updateVisualScrub(idx, commit = false) {
    const clamped = clamp(idx, 0, slice.length - 1);
    const p = points[clamped];
    if (readoutSpan) readoutSpan.innerHTML = readoutText(clamped);
    if (cursorLine) {
      cursorLine.setAttribute('x1', p.x.toFixed(1));
      cursorLine.setAttribute('x2', p.x.toFixed(1));
    }
    if (cursorDot) {
      cursorDot.setAttribute('cx', p.x.toFixed(1));
      cursorDot.setAttribute('cy', p.y.toFixed(1));
    }
    const bucketIdx = Math.floor(clamped / 3) * 3;
    containerEl.querySelectorAll('.n24-col-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.hIdx) === bucketIdx);
    });
    if (typeof onSelectHour === 'function') {
      onSelectHour(clamped, { commit });
    }
  }

  if (svg) {
    let dragging = false;
    const idxFromClientX = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
      const ratio = clamp((relX - padL) / plotW, 0, 1);
      return Math.round(ratio * (slice.length - 1));
    };
    svg.addEventListener('pointerdown', (e) => {
      dragging = true;
      updateVisualScrub(idxFromClientX(e.clientX), false);
      window.addEventListener(
        'pointerup',
        () => {
          dragging = false;
        },
        { once: true, passive: true }
      );
    });
    svg.addEventListener('pointermove', (e) => {
      if (dragging || e.pointerType === 'mouse') {
        updateVisualScrub(idxFromClientX(e.clientX), false);
      }
    });
  }

  containerEl.querySelectorAll('[data-h-idx]').forEach((el) => {
    el.addEventListener('click', () => {
      updateVisualScrub(Number(el.dataset.hIdx) || 0, true);
    });
  });
}

/**
 * Renders the "7-Day Outlook" unified High, Low & Dew Point Spline Card.
 * Warm amber-orange High curve + cool cyan-blue Low curve + mint-teal Dew Point curve +
 * shaded thermal band + aligned weather icon, Day/Date, and rain probability columns underneath.
 */
export function renderSevenDayDualSplineChart({
  containerEl,
  days7,
  selectedDayIdx = null,
  activeCurveId = null,
  useCelsius = false,
  renderIconFn,
  onSelectDay,
  onSelectCurve
}) {
  if (!containerEl || !Array.isArray(days7) || days7.length === 0) return;

  const days = days7.slice(0, 7);
  const convT = (f) => (useCelsius ? Math.round(((f - 32) * 5) / 9) : Math.round(f));
  const highs = days.map((d) => convT(d.highF));
  const lows = days.map((d) => convT(d.lowF));
  const dewPoints = days.map((d) => {
    const rawDp = Number.isFinite(d.maxDewPointF)
      ? d.maxDewPointF
      : Number.isFinite(d.dewPointF)
      ? d.dewPointF
      : (d.lowF ?? 50) - 2;
    return convT(rawDp);
  });

  let minVal = Math.floor(Math.min(...lows, ...dewPoints) - 3);
  let maxVal = Math.ceil(Math.max(...highs, ...dewPoints) + 3);
  if (maxVal - minVal < 12) {
    minVal -= 3;
    maxVal += 3;
  }

  // Native 350px coordinate space renders at ~1:1 scale on phones for ~2x larger, ultra-legible labels
  const W = 350;
  const H = 204;
  const padL = 34;
  const padR = 10;
  const padT = 28;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const colW = plotW / days.length;
  const xForIdx = (i) => padL + colW * (i + 0.5);
  const yForVal = (v) => padT + plotH - clamp((v - minVal) / (maxVal - minVal || 1), 0, 1) * plotH;

  const hiPts = highs.map((v, i) => ({ x: xForIdx(i), y: yForVal(v), val: v }));
  const loPts = lows.map((v, i) => ({ x: xForIdx(i), y: yForVal(v), val: v }));
  const dpPts = dewPoints.map((v, i) => ({ x: xForIdx(i), y: yForVal(v), val: v }));

  const hiPath = buildSmoothSvgPath(hiPts, 0.22);
  const loPath = buildSmoothSvgPath(loPts, 0.22);
  const dpPath = buildSmoothSvgPath(dpPts, 0.22);

  // Shaded band between High and Low curves
  const bandPts = [
    ...hiPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    ...[...loPts].reverse().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  ].join(' ');

  const loAreaPath = `${loPath} L ${loPts[loPts.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${loPts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const yTicks = [];
  const step = Math.max(10, Math.round((maxVal - minVal) / 4 / 5) * 5);
  for (let v = minVal; v <= maxVal; v += step) {
    yTicks.push({ y: yForVal(v), label: `${v}°` });
  }

  const hasActive = typeof selectedDayIdx === 'number' && selectedDayIdx >= 0;
  const activeIdx = hasActive ? clamp(selectedDayIdx, 0, days.length - 1) : -1;
  const readoutIdx = activeIdx >= 0 ? activeIdx : 0;
  const rDay = days[readoutIdx] || days[0];
  const dpFeeling = dewPoints[readoutIdx] < 50 ? 'Crisp & Dry' : dewPoints[readoutIdx] < 60 ? 'Comfortable' : dewPoints[readoutIdx] < 66 ? 'Humid' : 'Muggy';

  const hiActive = !activeCurveId || activeCurveId === 'high';
  const loActive = !activeCurveId || activeCurveId === 'low';
  const dpActive = !activeCurveId || activeCurveId === 'dewPoint';

  containerEl.innerHTML = `
    <div class="d7-dual-shell">
      <div class="d7-legend-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 2px 6px;font-size:11.5px;color:rgba(225,238,252,0.92);flex-wrap:wrap;">
        <span id="d7-live-readout" style="font-size:12px;color:#e8f3ff;">
          <strong>${rDay.shortWeekday} (${rDay.dateLabel}):</strong>
          <span style="color:#eab38c;font-weight:700;">High ${highs[readoutIdx]}°</span> ·
          <span style="color:#96c7ec;font-weight:700;">Low ${lows[readoutIdx]}°</span> ·
          <span style="color:#5eead4;font-weight:700;">Dew Pt ${dewPoints[readoutIdx]}° (${dpFeeling})</span>
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <button type="button" data-d7-curve="high" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;border:1px solid ${activeCurveId === 'high' ? '#e39c74' : 'rgba(255,255,255,0.2)'};background:${activeCurveId === 'high' ? 'rgba(227,156,116,0.22)' : 'rgba(255,255,255,0.06)'};color:#ffffff;font:600 11px inherit;cursor:pointer;">
            <i style="width:10px;height:3px;border-radius:2px;background:#e39c74;display:inline-block;"></i>High
          </button>
          <button type="button" data-d7-curve="low" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;border:1px solid ${activeCurveId === 'low' ? '#7eb8e6' : 'rgba(255,255,255,0.2)'};background:${activeCurveId === 'low' ? 'rgba(126,184,230,0.22)' : 'rgba(255,255,255,0.06)'};color:#ffffff;font:600 11px inherit;cursor:pointer;">
            <i style="width:10px;height:3px;border-radius:2px;background:#7eb8e6;display:inline-block;"></i>Low
          </button>
          <button type="button" data-d7-curve="dewPoint" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;border:1px solid ${activeCurveId === 'dewPoint' ? '#5eead4' : 'rgba(255,255,255,0.2)'};background:${activeCurveId === 'dewPoint' ? 'rgba(94,234,212,0.22)' : 'rgba(255,255,255,0.06)'};color:#ffffff;font:600 11px inherit;cursor:pointer;">
            <i style="width:10px;height:3px;border-radius:2px;background:#5eead4;display:inline-block;"></i>Dew Point
          </button>
        </span>
      </div>
      <svg class="d7-dual-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="cursor:pointer;" role="img" aria-label="7-day high, low, and dew point temperature spline chart">
        <defs>
          <linearGradient id="d7-hi-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#eab38c"/>
            <stop offset="50%" stop-color="#e39c74"/>
            <stop offset="100%" stop-color="#e8b288"/>
          </linearGradient>
          <linearGradient id="d7-lo-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#96c7ec"/>
            <stop offset="50%" stop-color="#7eb8e6"/>
            <stop offset="100%" stop-color="#9bc4ea"/>
          </linearGradient>
          <linearGradient id="d7-band-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e39c74" stop-opacity="0.16"/>
            <stop offset="100%" stop-color="#7eb8e6" stop-opacity="0.06"/>
          </linearGradient>
          <linearGradient id="d7-lo-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7eb8e6" stop-opacity="0.10"/>
            <stop offset="100%" stop-color="#7eb8e6" stop-opacity="0.0"/>
          </linearGradient>
        </defs>

        ${yTicks
          .map(
            (t) => `
          <line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${W - padR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.09)" stroke-width="1"/>
          <text x="${padL - 6}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="rgba(220,234,250,0.78)" font-size="11.5" font-weight="600">${t.label}</text>
        `
          )
          .join('')}

        <!-- Subtle vertical stems connecting High -> Low -> axis -->
        ${hiPts
          .map(
            (hp, idx) => `
          <line x1="${hp.x.toFixed(1)}" y1="${hp.y.toFixed(1)}" x2="${hp.x.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="${idx === activeIdx ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.10)'}" stroke-width="${idx === activeIdx ? '1.5' : '1'}"/>
        `
          )
          .join('')}

        <polygon points="${bandPts}" fill="url(#d7-band-fill)"/>
        <path d="${loAreaPath}" fill="url(#d7-lo-fill)"/>
        ${activeCurveId === 'high' ? `<path d="${hiPath}" fill="none" stroke="#e39c74" stroke-opacity="0.32" stroke-width="7" stroke-linecap="round"/>` : ''}
        <path d="${hiPath}" fill="none" stroke="url(#d7-hi-stroke)" stroke-width="${activeCurveId === 'high' ? '3.4' : '2.5'}" opacity="${hiActive ? '1' : '0.35'}" stroke-linecap="round"/>
        ${activeCurveId === 'low' ? `<path d="${loPath}" fill="none" stroke="#7eb8e6" stroke-opacity="0.32" stroke-width="7" stroke-linecap="round"/>` : ''}
        <path d="${loPath}" fill="none" stroke="url(#d7-lo-stroke)" stroke-width="${activeCurveId === 'low' ? '3.4' : '2.3'}" opacity="${loActive ? '1' : '0.35'}" stroke-linecap="round"/>
        ${activeCurveId === 'dewPoint' ? `<path d="${dpPath}" fill="none" stroke="#5eead4" stroke-opacity="0.32" stroke-width="7" stroke-linecap="round"/>` : ''}
        <path d="${dpPath}" fill="none" stroke="#5eead4" stroke-width="${activeCurveId === 'dewPoint' ? '3.2' : '2.1'}" stroke-dasharray="${activeCurveId === 'dewPoint' ? '' : '4 3'}" opacity="${dpActive ? '1' : '0.35'}" stroke-linecap="round"/>

        ${hiPts
          .map((hp, idx) => {
            const lp = loPts[idx];
            const dp = dpPts[idx];
            const isSel = idx === activeIdx;
            const dpBelowLow = dp.y >= lp.y;
            const loLblY = dpBelowLow && Math.abs(dp.y - lp.y) < 14
              ? Math.max(hp.y + 13, lp.y - 7)
              : Math.min(H - 6, lp.y + 15);
            const dpLblY = dpBelowLow
              ? Math.min(H - 4, Math.max(dp.y + 14, loLblY + 11))
              : Math.max(hp.y + 13, Math.min(dp.y - 7, lp.y - 10));
            return `
              <g data-d7-idx="${idx}" style="cursor:pointer;">
                <circle cx="${hp.x.toFixed(1)}" cy="${hp.y.toFixed(1)}" r="${isSel ? '4.2' : '3.0'}" fill="#ffffff" stroke="#e39c74" stroke-width="1.4" opacity="${hiActive ? '1' : '0.35'}"/>
                <text x="${hp.x.toFixed(1)}" y="${Math.max(15, hp.y - 9).toFixed(1)}" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="700" opacity="${hiActive ? '1' : '0.4'}">${hp.val}°</text>
                <circle cx="${lp.x.toFixed(1)}" cy="${lp.y.toFixed(1)}" r="${isSel ? '4.0' : '2.8'}" fill="#ffffff" stroke="#7eb8e6" stroke-width="1.4" opacity="${loActive ? '1' : '0.35'}"/>
                <text x="${lp.x.toFixed(1)}" y="${loLblY.toFixed(1)}" text-anchor="middle" fill="#d0e5f8" font-size="11.5" font-weight="600" opacity="${loActive ? '1' : '0.4'}">${lp.val}°</text>
                <circle cx="${dp.x.toFixed(1)}" cy="${dp.y.toFixed(1)}" r="${isSel ? '3.8' : '2.5'}" fill="#0b2038" stroke="#5eead4" stroke-width="1.5" opacity="${dpActive ? '1' : '0.35'}"/>
                <text x="${dp.x.toFixed(1)}" y="${dpLblY.toFixed(1)}" text-anchor="middle" fill="#7ef4df" font-size="10.5" font-weight="700" opacity="${dpActive ? '1' : '0.4'}">${dp.val}°</text>
              </g>
            `;
          })
          .join('')}
      </svg>

      <div class="d7-cols-footer" style="padding-left:${((padL / W) * 100).toFixed(2)}%;padding-right:${((padR / W) * 100).toFixed(2)}%;">
        ${days
          .map(
            (d, idx) => `
          <button type="button" class="d7-col-btn ${idx === activeIdx ? 'active' : ''}" data-d7-btn="${idx}" aria-expanded="${idx === activeIdx}">
            <span class="d7-col-icon">${typeof renderIconFn === 'function' ? renderIconFn(d.icon, 26) : ''}</span>
            <span class="d7-col-day">${d.shortWeekday}</span>
            <span class="d7-col-date">${d.dateLabel}</span>
            <span class="d7-col-rain ${d.rainChance >= 35 ? 'wet' : ''}">💧 ${d.rainChance}%</span>
          </button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  containerEl.querySelectorAll('[data-d7-curve]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cId = btn.dataset.d7Curve;
      if (typeof onSelectCurve === 'function') {
        onSelectCurve(activeCurveId === cId ? null : cId);
      }
    });
  });

  if (typeof onSelectDay === 'function') {
    containerEl.querySelectorAll('[data-d7-btn]').forEach((el) => {
      el.addEventListener('click', () => {
        onSelectDay(Number(el.dataset.d7Btn) || 0);
      });
    });
    const svg = containerEl.querySelector('.d7-dual-svg');
    svg?.addEventListener('pointerdown', (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
      const relY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * H;
      const dayIdx = clamp(Math.floor((relX - padL) / colW), 0, days.length - 1);
      const dHi = Math.abs(hiPts[dayIdx].y - relY);
      const dLo = Math.abs(loPts[dayIdx].y - relY);
      const dDp = Math.abs(dpPts[dayIdx].y - relY);
      const minD = Math.min(dHi, dLo, dDp);
      let curve = null;
      if (minD < 26) {
        curve = minD === dHi ? 'high' : minD === dLo ? 'low' : 'dewPoint';
      }
      if (curve && typeof onSelectCurve === 'function') {
        onSelectCurve(curve, dayIdx);
      } else {
        onSelectDay(dayIdx);
      }
    });
  }
}
