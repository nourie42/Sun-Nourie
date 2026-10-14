/** Winter guidance is independent of the site's rain/temperature blend.
 * Named deterministic model snowfall is an amount, never a snow probability.
 * Accumulations cover the hour PRECEDING their timestamp (Open-Meteo contract).
 */
const HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const WINTER_MODELS = {
  ecmwf: { model: 'ecmwf_ifs025', domain: 'ecmwf_ifs025', label: 'ECMWF IFS', horizon: 240, maxAge: 30 },
  gfs: { model: 'ncep_gfs_global', domain: 'ncep_gfs025', label: 'NOAA GFS', horizon: 240, maxAge: 18 },
  hrrr: { model: 'ncep_hrrr_conus', domain: 'ncep_hrrr_conus', label: 'NOAA HRRR', horizon: 48, maxAge: 12 },
  nam: { model: 'ncep_nam_conus', domain: 'ncep_nam_conus', label: 'NOAA NAM', horizon: 60, maxAge: 18 },
};
export const WINTER_WEIGHTS = {
  nearTerm: { wpc: 60, hrrr: 25, nam: 15 },
  extended: { wpc: 60, ecmwf: 20, weathernext: 10, gfs: 10 },
};
export function winterWeights(start, now = Date.now()) {
  return Date.parse(start) - now < 24 * HOUR ? { ...WINTER_WEIGHTS.nearTerm } : { ...WINTER_WEIGHTS.extended };
}
export function winterModelUrl(id, location) {
  const model = WINTER_MODELS[id];
  if (!model) throw new Error('Unknown winter model.');
  const fields = ['snowfall', 'weather_code'];
  // Weather codes preserve the provider's freezing-rain classification. The
  // internal categorical field is not a documented public API parameter.
  return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude),
    models: model.model, hourly: fields.join(','), timezone: 'GMT', timeformat: 'unixtime', forecast_days: '10' })}`;
}
export function normalizeWinterModel(data, metadata, id, location, now = Date.now()) {
  const model = WINTER_MODELS[id], run = metadata?.last_run_initialisation_time * 1000;
  if (!model || !finite(run) || run > now + 15 * 60000 || now - run > model.maxAge * HOUR) throw new Error('Winter model initialization is unavailable or stale.');
  if (![data?.latitude, data?.longitude].every(finite) || Math.abs(data.latitude - location.latitude) > .35 || Math.abs(data.longitude - location.longitude) > .35) throw new Error('Winter model grid does not match this location.');
  const times = data.hourly?.time, units = data.hourly_units;
  if (units?.time !== 'unixtime' || !Array.isArray(times) || times.length < 12 || times.length > 500 || times.some((t, i) => !finite(t) || (i > 0 && t - times[i - 1] !== 3600))) throw new Error('Invalid winter model time axis.');
  const snow = data.hourly.snowfall;
  if (!Array.isArray(snow) || snow.length !== times.length || !['cm', 'inch', 'in'].includes(units.snowfall) || snow.some(v => v !== null && (!finite(v) || v < 0 || v > 300))) throw new Error('Invalid winter model snowfall units or amounts.');
  const freezing = data.hourly.categorical_freezing_rain, code = data.hourly.weather_code;
  const factor = units.snowfall === 'cm' ? 1 / 2.54 : 1;
  const intervals = times.flatMap((time, i) => {
    const end = time * 1000;
    // Values beyond the actual named-model horizon are not valid zero forecasts.
    if (end > run + model.horizon * HOUR) return [];
    return [{ start: end - HOUR, end, value: finite(snow[i]) ? snow[i] * factor : null,
      weatherCode: finite(code?.[i]) ? code[i] : null,
      freezingRainSignal: finite(freezing?.[i]) && freezing[i] >= 0 && freezing[i] <= 1 ? freezing[i] > 0 : null }];
  });
  if (!intervals.some(row => row.end > now && finite(row.value))) throw new Error('No future winter model snowfall.');
  return { id, label: model.label, unit: 'in', runAt: new Date(run).toISOString(),
    validUntil: new Date(Math.max(...intervals.map(row => row.end))).toISOString(), intervals,
    modelGrid: { latitude: data.latitude, longitude: data.longitude },
    transport: 'Open-Meteo explicit named-model point API',
    sourceUrl: 'https://open-meteo.com/en/docs/gfs-api',
    amountMethod: 'Model frozen-precipitation fraction converted by the provider to snowfall depth; the provider uses 0.7 cm snowfall per mm water equivalent for NOAA models.',
    probabilityMethod: 'Deterministic snowfall and categorical freezing rain are signals, not probabilities.' };
}
export const WINTER_PROBABILITY_FIELDS = { snow: 'snowfall_probability', freezingRain: 'freezing_rain_probability', sleet: 'ice_pellets_probability' };
export function normalizeWinterProbabilities(data, metadata, location, now = Date.now()) {
  const run = metadata?.last_run_initialisation_time * 1000;
  if (!finite(run) || run > now + 15 * 60000 || now - run > 12 * HOUR) throw new Error('NBM initialization is unavailable or stale.');
  if (![data?.latitude, data?.longitude].every(finite) || Math.abs(data.latitude - location.latitude) > .35 || Math.abs(data.longitude - location.longitude) > .35) throw new Error('NBM grid does not match this location.');
  const times = data.hourly?.time;
  if (data.hourly_units?.time !== 'unixtime' || !Array.isArray(times) || times.length < 12 || times.length > 500 || times.some((t, i) => !finite(t) || (i && t - times[i - 1] !== 3600))) throw new Error('Invalid NBM probability time axis.');
  const series = {};
  for (const [kind, field] of Object.entries(WINTER_PROBABILITY_FIELDS)) {
    const values = data.hourly[field];
    if (!Array.isArray(values) || values.length !== times.length || values.some(v => v !== null && (!finite(v) || v < 0 || v > 100)) || (values.some(finite) && data.hourly_units[field] !== '%')) throw new Error('Invalid NBM type probability units or range.');
    series[kind] = values;
  }
  const rows = times.filter(t => t * 1000 <= run + 264 * HOUR).map(time => {
    const index = times.indexOf(time);
    return { time: time * 1000, ...Object.fromEntries(Object.entries(series).map(([kind, values]) => [kind, values[index]])) };
  });
  if (!rows.some(row => row.time > now && Object.keys(WINTER_PROBABILITY_FIELDS).some(kind => finite(row[kind])))) throw new Error('No future NBM type probabilities.');
  return { source: 'NWS NBM', runAt: new Date(run).toISOString(), rows,
    sourceUrl: 'https://open-meteo.com/en/docs/gfs-api',
    method: 'Peak published hourly precipitation-type probability in the stated interval; not a combined daily or storm occurrence probability. Supplemental probabilities do not change the requested snowfall-amount weights.' };
}
export function createWinterModelService({ cached, now = Date.now }) {
  return async location => {
    const probabilityTask = (async () => {
      const meta = { id: 'winter-nbm-probabilities', label: 'NWS NBM precipitation-type probabilities', status: 'unavailable', issuedAt: null, fetchedAt: null, url: 'https://open-meteo.com/en/docs/gfs-api' };
      try {
        const query = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), models: 'ncep_nbm_conus', hourly: Object.values(WINTER_PROBABILITY_FIELDS).join(','), timezone: 'GMT', timeformat: 'unixtime', forecast_days: '10' });
        const [forecast, metadata] = await Promise.all([cached(`https://api.open-meteo.com/v1/forecast?${query}`, 10 * 60000, { timeout: 16000 }), cached('https://api.open-meteo.com/data/ncep_nbm_conus/static/meta.json', 5 * 60000, { timeout: 12000 })]);
        const value = normalizeWinterProbabilities(forecast.data, metadata.data, location, now());
        return { id: 'probabilities', value, meta: { ...meta, status: 'ready', issuedAt: value.runAt, fetchedAt: forecast.fetchedAt } };
      } catch (error) { return { id: 'probabilities', value: null, meta: { ...meta, message: String(error.message).slice(0, 180) } }; }
    })();
    const rows = await Promise.all([...Object.entries(WINTER_MODELS).map(async ([id, model]) => {
      const meta = { id: `winter-${id}`, label: `${model.label} winter guidance`, status: 'unavailable', issuedAt: null, fetchedAt: null, url: 'https://open-meteo.com/en/docs/gfs-api' };
      try {
        const [forecast, metadata] = await Promise.all([
          cached(winterModelUrl(id, location), 10 * 60000, { timeout: 16000 }),
          cached(`https://api.open-meteo.com/data/${model.domain}/static/meta.json`, 5 * 60000, { timeout: 12000 }),
        ]);
        const value = normalizeWinterModel(forecast.data, metadata.data, id, location, now());
        return { id, value, meta: { ...meta, status: 'ready', issuedAt: value.runAt, fetchedAt: forecast.fetchedAt, validUntil: value.validUntil } };
      } catch (error) { return { id, value: null, meta: { ...meta, message: String(error.message).slice(0, 180) } }; }
    }), probabilityTask]);
    return { value: Object.fromEntries(rows.map(row => [row.id, row.value])), meta: rows.map(row => row.meta) };
  };
}
/** Integrate exactly aligned intervals. A missing hour invalidates the amount;
 * zero-valued hours still constitute usable coverage. */
export function winterIntervalAmount(intervals, start, end) {
  const from = typeof start === 'number' ? start : Date.parse(start), through = typeof end === 'number' ? end : Date.parse(end);
  if (!finite(from) || !finite(through) || through <= from || !Array.isArray(intervals)) return { value: null, coveredHours: 0, expectedHours: finite(through - from) ? (through - from) / HOUR : null };
  const rows = intervals.filter(row => [row.start, row.end, row.value].every(finite) && row.value >= 0 && row.end > row.start && row.end > from && row.start < through).sort((a, b) => a.start - b.start);
  let cursor = from, total = 0, covered = 0;
  for (const row of rows) {
    const a = Math.max(from, row.start), b = Math.min(through, row.end);
    if (a > cursor + 1 || a < cursor - 1) return { value: null, coveredHours: covered / HOUR, expectedHours: (through - from) / HOUR };
    total += row.value * (b - a) / (row.end - row.start);
    covered += b - a; cursor = b;
  }
  return { value: Math.abs(cursor - through) <= 1 ? total : null, coveredHours: covered / HOUR, expectedHours: (through - from) / HOUR };
}
/** Amount blending requires every contributor to represent the same interval.
 * Missing providers are omitted and remaining weights normalized, with the
 * original requested-weight coverage exposed alongside the result. */
export function blendWinterAmounts(values, weights) {
  const sources = Object.entries(weights).map(([id, weight]) => ({ id, requestedWeight: weight, value: finite(values[id]) && values[id] >= 0 ? values[id] : null }));
  const coverage = sources.filter(row => finite(row.value)).reduce((sum, row) => sum + row.requestedWeight, 0);
  const actualWeights = Object.fromEntries(sources.map(row => [row.id, finite(row.value) && coverage ? row.requestedWeight / coverage * 100 : 0]));
  return { value: coverage ? sources.filter(row => finite(row.value)).reduce((sum, row) => sum + row.value * row.requestedWeight / coverage, 0) : null,
    unit: 'in', weights, coverage, actualWeights, status: coverage === 100 ? 'ready' : coverage > 0 ? 'partial' : 'unavailable', sources,
    method: 'Weighted mean of same-interval snowfall depths; unavailable sources are excluded and remaining requested weights normalized. This is an experimental guidance blend, not a calibrated probabilistic forecast.' };
}
