/** Personal experiments use only the selected location's existing hourly evidence.
 * This module never fetches a model, fills a gap, or writes the published forecast. */
const HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const epoch = value => { const time = Date.parse(value); return finite(time) ? time : null; };
const valid = (value, metric) => finite(value) && (metric === 'rain' ? value >= 0 && value <= 100 : metric === 'amount' ? value >= 0 : true);

export const CUSTOM_FORECAST_MODELS = Object.freeze([
  { id: 'nws', label: 'NWS', description: 'Official National Weather Service', color: '#89ddff' },
  { id: 'hrrr', label: 'HRRR', description: 'Short-range high-resolution model', color: '#ffbd8a' },
  { id: 'nam', label: 'NAM', description: 'North American Mesoscale model', color: '#feb2d3' },
  { id: 'nbm', label: 'NBM', description: 'National Blend of Models', color: '#8cefc8' },
  { id: 'ecmwf', label: 'ECMWF', description: 'European forecast model', color: '#c7acff' },
  { id: 'wn', label: 'NVIDIA WeatherNext', description: 'AI weather model', color: '#ffe395' },
  { id: 'gfs', label: 'GFS', description: 'Global Forecast System', color: '#93b3ff' },
]);

const allowed = new Set(CUSTOM_FORECAST_MODELS.map(model => model.id));
const knownMap = (map, metric) => Object.fromEntries(Object.entries(map || {}).filter(([id, value]) => allowed.has(id) && valid(value, metric)));
function sourceMap(evidence, metric) {
  const output = knownMap(evidence?.sourceValues, metric);
  for (const source of evidence?.sources || []) {
    // An explicit null in sourceValues means this interval is incomplete.
    if (!Object.hasOwn(evidence?.sourceValues || {}, source.id) && allowed.has(source.id) && valid(source.value, metric)) output[source.id] = source.value;
  }
  return output;
}

export function normalizeCustomWeights(weights = {}) {
  const chosen = Object.entries(weights).filter(([id, weight]) => allowed.has(id) && finite(weight) && weight > 0);
  const sum = chosen.reduce((total, [, weight]) => total + weight, 0);
  if (!sum) return {};
  return allocate(chosen,100);
}

/** Largest remainders keep the actual calculation and the displayed sliders identical. */
function allocate(entries,total) {
  const sum = entries.reduce((result,[,value])=>result+value,0);
  if (!sum || !total) return {};
  const rows = entries.map(([id,value],index)=>({id,index,exact:value/sum*total,value:Math.floor(value/sum*total)}));
  let remaining = total-rows.reduce((result,row)=>result+row.value,0);
  const ranked = [...rows].sort((a,b)=>(b.exact-b.value)-(a.exact-a.value)||a.index-b.index);
  for (let index=0;index<remaining;index++) ranked[index].value++;
  return Object.fromEntries(rows.filter(row=>row.value>0).map(row=>[row.id,row.value]));
}

/** Keep the edited percentage, sharing the remaining percentage among enabled models. */
export function changeCustomWeight(weights, id, value) {
  if (!allowed.has(id) || !finite(value)) return normalizeCustomWeights(weights);
  const next = normalizeCustomWeights(weights);
  const others = Object.keys(next).filter(key => key !== id);
  if (!others.length) return { [id]: 100 };
  const requested = Math.round(Math.max(0, Math.min(100, value)));
  return { ...(requested ? {[id]:requested} : {}), ...allocate(others.map(key=>[key,next[key]]),100-requested) };
}

export function toggleCustomModel(weights, id, enabled) {
  if (!allowed.has(id)) return normalizeCustomWeights(weights);
  const next = { ...weights };
  if (!enabled) { delete next[id]; return normalizeCustomWeights(next); }
  if (finite(next[id]) && next[id] > 0) return normalizeCustomWeights(next);
  const normalized = normalizeCustomWeights(next);
  return Object.keys(normalized).length ? changeCustomWeight({ ...normalized, [id]: 0 }, id, 20) : { [id]: 100 };
}

export function customForecastInput(forecast, now = Date.now()) {
  const location = forecast?.location || {};
  const rows = new Map();
  const accept = row => {
    const time = epoch(row?.time);
    return time !== null && time + HOUR > now && time < now + 7 * 24 * HOUR ? time : null;
  };
  for (const row of forecast?.rainTimeline || []) {
    const time = accept(row);
    // A multi-hour total must not be presented as a single hour's rainfall.
    if (time !== null && epoch(row.end) === time + HOUR) rows.set(time, { rain: row });
  }
  for (const row of forecast?.hours || []) {
    const time = accept(row);
    if (time !== null) {
      const previous = rows.get(time) || {};
      rows.set(time, { ...previous, hour: row, rain: previous.rain || ((row.end == null || epoch(row.end) === time + HOUR) ? row : null) });
    }
  }
  for (const row of forecast?.metricForecasts?.series?.temperature || []) {
    const time = accept(row);
    if (time !== null) rows.set(time, { ...(rows.get(time) || {}), temperature: row });
  }
  const times = [...rows.keys()].sort((a, b) => a - b);
  const hours = [];
  // Insert missing clock hours so charts and totals cannot conceal a gap.
  for (let time = times[0]; finite(time) && time <= times.at(-1); time += HOUR) {
    const { hour, rain, temperature: temperatureRow } = rows.get(time) || {};
    const temperature = { ...sourceMap(temperatureRow, 'temperature'), ...sourceMap(hour?.temperatureBlend, 'temperature') };
    if (!Object.hasOwn(temperature, 'nws') && valid(hour?.officialTemperature, 'temperature')) temperature.nws = hour.officialTemperature;
    const amount = sourceMap(rain?.precipitationBlend, 'amount');
    const official = rain?.officialPop ?? rain?.rainLikelihood?.officialProbability ?? hour?.officialPop;
    const rainProbability = valid(official, 'rain') ? official : null;
    const publishedRain = rain?.rainLikelihood?.value ?? rain?.pop;
    hours.push({
      time: new Date(time).toISOString(), timestamp: time, end: new Date(time + HOUR).toISOString(),
      fraction: Math.min(1, Math.max(0, (time + HOUR - Math.max(time, now)) / HOUR)),
      sources: { temperature, amount, rain: rainProbability === null ? {} : { nws: rainProbability } },
      baseline: {
        temperature: valid(temperatureRow?.value, 'temperature') ? temperatureRow.value : valid(hour?.temperature, 'temperature') ? hour.temperature : null,
        rain: valid(publishedRain, 'rain') ? publishedRain : null,
        amount: valid(rain?.precipitation, 'amount') ? rain.precipitation : null,
      },
    });
  }
  const models = CUSTOM_FORECAST_MODELS.map(model => {
    const coverage = Object.fromEntries(['temperature', 'rain', 'amount'].map(metric => [metric, hours.filter(row => Object.hasOwn(row.sources[metric], model.id)).length]));
    const run = (forecast?.modelContributions || []).find(item => item.id === model.id);
    return { ...model, coverage, available: Object.values(coverage).some(Boolean), runAt: run?.runAt || (model.id === 'nws' ? (forecast?.feeds || []).find(feed => feed.id === 'hourly')?.issuedAt : null) || null };
  });
  const available = new Set(models.filter(model => model.available).map(model => model.id));
  const requested = forecast?.blendPolicy?.sameDay || { nws: 40, hrrr: 30, ecmwf: 10, nbm: 20 };
  let defaultWeights = normalizeCustomWeights(Object.fromEntries(Object.entries(requested).filter(([id]) => available.has(id))));
  if (!Object.keys(defaultWeights).length) defaultWeights = normalizeCustomWeights(Object.fromEntries([...available].map(id => [id, 1])));
  return { locationKey: `${location.latitude}|${location.longitude}|${location.timeZone || ''}`, location: { ...location }, timeZone: location.timeZone || 'America/New_York', assembledAt: forecast?.assembledAt || null, hours, models, defaultWeights };
}

export function customPresetWeights(input, preset = 'nourie') {
  const available = input.models.filter(model => model.available).map(model => model.id);
  if (preset === 'nws') return available.includes('nws') ? { nws: 100 } : {};
  if (preset === 'equal') return normalizeCustomWeights(Object.fromEntries(available.map(id => [id, 1])));
  if (preset === 'models') return normalizeCustomWeights(Object.fromEntries(available.filter(id => id !== 'nws').map(id => [id, 1])));
  return { ...input.defaultWeights };
}

function weightedMetric(values, weights, metric) {
  const selected = Object.keys(weights).filter(id => weights[id] > 0);
  const ids = selected.filter(id => valid(values[id], metric));
  const total = ids.reduce((sum, id) => sum + weights[id], 0);
  return {
    value: total ? ids.reduce((sum, id) => sum + values[id] * weights[id] / total, 0) : null,
    weights: total ? Object.fromEntries(ids.map(id => [id, weights[id] / total * 100])) : {},
    values: Object.fromEntries(ids.map(id => [id, values[id]])),
    missing: selected.filter(id => !ids.includes(id)),
  };
}

export function blendCustomForecast(input, requestedWeights) {
  const weights = normalizeCustomWeights(requestedWeights);
  const hours = input.hours.map(row => {
    return { ...row, custom: {
      temperature: weightedMetric(row.sources.temperature, weights, 'temperature'),
      // Native probability evidence only. A deterministic rain amount is never a probability.
      rain: weightedMetric(row.sources.rain, weights, 'rain'),
      amount: weightedMetric(row.sources.amount, weights, 'amount'),
    } };
  });
  return { ...input, weights, hours };
}

export function customForecastSummary(hours, metric) {
  const custom = hours.map(row => row.custom[metric].value), baseline = hours.map(row => row.baseline[metric]);
  const completeCustom = hours.length > 0 && custom.every(finite), completeBaseline = hours.length > 0 && baseline.every(finite);
  const aggregate = (values, complete) => {
    if (!values.some(finite)) return null;
    if (metric === 'amount') return complete ? values.reduce((sum, value, index) => sum + value * hours[index].fraction, 0) : null;
    return Math.max(...values.filter(finite));
  };
  const paired = hours.filter(row => finite(row.custom[metric].value) && finite(row.baseline[metric]));
  const biggest = paired.reduce((result, row) => !result || Math.abs(row.custom[metric].value - row.baseline[metric]) > Math.abs(result.custom[metric].value - result.baseline[metric]) ? row : result, null);
  return { custom: aggregate(custom, completeCustom), baseline: aggregate(baseline, completeBaseline), completeCustom, completeBaseline, customHours: custom.filter(finite).length, baselineHours: baseline.filter(finite).length, hours: hours.length, biggest };
}
