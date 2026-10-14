/** Isolated prerelease snowfall evidence. Importing this file performs no I/O.
 * Open-Meteo snowfall is a deterministic depth accumulated in the PRECEDING
 * hour, including provider interpolation/processing. It is never a probability.
 * Sources: https://open-meteo.com/en/docs/gfs-api
 *          https://open-meteo.com/en/docs/ecmwf-api
 *          https://open-meteo.com/en/docs/model-updates
 * Explicit GFS013 is intentional: GFS025 does not supply snowfall. Neither a
 * seamless model nor NDFD may silently occupy another requested source's slot.
 */
const HOUR = 3600000, MINUTE = 60000, MAX_RESPONSE_HOURS = 384;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timestamp = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const iso = value => new Date(value).toISOString();
const emptyProbabilities = () => ({ snow: null, freezingRain: null, sleet: null });
export const PRERELEASE_WINTER_WEIGHTS = Object.freeze({
  within24h: Object.freeze({ wpc: .60, hrrr: .25, nam: .15 }),
  beyond24h: Object.freeze({ wpc: .60, ecmwf: .20, weathernext: .10, gfs: .10 }),
});
export const PRERELEASE_WINTER_MODELS = Object.freeze({
  hrrr: Object.freeze({ model: 'ncep_hrrr_conus', label: 'HRRR CONUS (3 km)', maxAgeHours: 6, maxPointDistanceKm: 5, horizonHours: 48, spatialResolution: '3 km', documentationUrl: 'https://open-meteo.com/en/docs/gfs-api' }),
  nam: Object.freeze({ model: 'ncep_nam_conus', label: 'NAM CONUS nest (3 km)', maxAgeHours: 18, maxPointDistanceKm: 5, horizonHours: 60, spatialResolution: '3 km', documentationUrl: 'https://open-meteo.com/en/docs/gfs-api' }),
  ecmwf: Object.freeze({ model: 'ecmwf_ifs025', label: 'ECMWF IFS (0.25°)', maxAgeHours: 24, maxPointDistanceKm: 25, horizonHours: 360, spatialResolution: '0.25°', documentationUrl: 'https://open-meteo.com/en/docs/ecmwf-api' }),
  gfs: Object.freeze({ model: 'ncep_gfs013', label: 'GFS (0.11°, approximately 13 km)', maxAgeHours: 18, maxPointDistanceKm: 15, horizonHours: 384, spatialResolution: '0.11°, approximately 13 km', documentationUrl: 'https://open-meteo.com/en/docs/gfs-api' }),
});
function fail(message, status = 'unavailable') {
  const error = new Error(message); error.status = status; throw error;
}
function validateLocation(location) {
  if (!finite(location?.latitude) || !finite(location?.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) fail('A valid latitude and longitude are required.');
}
function modelFor(id) {
  if (!Object.hasOwn(PRERELEASE_WINTER_MODELS, id)) fail('Unknown winter source.');
  return PRERELEASE_WINTER_MODELS[id];
}
function distanceKm(a, b) {
  const radians = n => n * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, v))));
}
export function prereleaseWinterModelUrl(id, location) {
  validateLocation(location);
  const model = modelFor(id);
  return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude),
    models: model.model, hourly: 'snowfall', timezone: 'GMT', timeformat: 'unixtime',
    precipitation_unit: 'mm', forecast_days: '10', cell_selection: 'nearest',
  })}`;
}
export function prereleaseWinterMetadataUrl(id) {
  return `https://api.open-meteo.com/data/${modelFor(id).model}/static/meta.json`;
}
function checkedFetchedAt(value, now) {
  const time = timestamp(value);
  if (!finite(time) || time > now + 5 * MINUTE) fail('The source retrieval timestamp is missing or invalid.');
  if (now - time > 30 * MINUTE) fail('The cached winter source is older than 30 minutes.', 'stale');
  return time;
}
/** Metadata describes the latest separately observed feed, NOT the run bound to
 * the point response. Even matching retrieval times cannot prove that binding.
 * Reject a point cache predating availability (+10 min propagation allowance).
 */
function checkedMetadata(response, model, id, forecastFetchedAt, now) {
  const fetchedAt = checkedFetchedAt(response?.fetchedAt, now), data = response?.data;
  const seconds = key => finite(data?.[key]) && Number.isInteger(data[key]) ? data[key] * 1000 : NaN;
  const run = seconds('last_run_initialisation_time'), available = seconds('last_run_availability_time');
  const modified = seconds('last_run_modification_time'), dataEnd = seconds('data_end_time');
  if (!finite(run) || run % HOUR !== 0 || run > now + 5 * MINUTE || !finite(available) || available < run || available > fetchedAt + 5 * MINUTE) fail('The latest model initialization or availability metadata is invalid.');
  if (now - run > model.maxAgeHours * HOUR) fail('The latest reported model initialization is stale.', 'stale');
  if (data.last_run_modification_time != null && (!finite(modified) || modified < run || modified > available + 5 * MINUTE)) fail('The model modification metadata is inconsistent.');
  if (![3600, 10800, 21600].includes(data.temporal_resolution_seconds) || data.update_interval_seconds !== (id === 'hrrr' ? 3600 : 21600)) fail('The model temporal-resolution or update metadata is invalid.');
  if (forecastFetchedAt < available + 10 * MINUTE) fail('The point forecast predates stable availability of the latest model update; refresh is needed.', 'stale');
  const horizonHours = id === 'hrrr' && new Date(run).getUTCHours() % 6 !== 0 ? 18 : model.horizonHours;
  if (data.data_end_time != null && (!finite(dataEnd) || dataEnd <= run || dataEnd > run + (model.horizonHours + 24) * HOUR)) fail('The model data-end metadata is invalid.');
  // data_end_time is a conservative upper bound, not evidence of coverage for
  // every variable. Actual non-null snowfall rows are still required below.
  const horizonEnd = Math.min(run + horizonHours * HOUR, finite(dataEnd) ? dataEnd : Infinity);
  return { latestRunAt: iso(run), availableAt: iso(available), modifiedAt: finite(modified) ? iso(modified) : null,
    fetchedAt: iso(fetchedAt), dataEnd: finite(dataEnd) ? iso(dataEnd) : null,
    horizonHours, conservativeHorizonEnd: iso(horizonEnd), nativeTemporalResolutionSeconds: data.temporal_resolution_seconds,
    forecastRunBound: false, sourceUrl: prereleaseWinterMetadataUrl(id),
    note: 'Latest feed metadata was checked separately. The forecast API does not identify the run of each returned value.' };
}
function sourceBase(id, location) {
  const model = modelFor(id);
  return { id, sourceId: id, label: model.label, modelVariant: model.model, metric: 'snow', quantity: 'snowfall-depth',
    statistic: 'deterministic-amount', unit: 'inches', threshold: null, initializedAt: null, issuedAt: null,
    fetchedAt: null, status: 'unavailable', intervals: [], location: { latitude: location.latitude, longitude: location.longitude },
    modelGrid: null, coverageStart: null, coverageEnd: null, coveredHours: 0, expectedHours: 0, coverageFraction: 0,
    probabilities: emptyProbabilities(), probabilityReason: 'These deterministic amounts do not provide precipitation-type probabilities.',
    sourceUrl: prereleaseWinterModelUrl(id, location), documentationUrl: model.documentationUrl, spatialResolution: model.spatialResolution,
    amountMethod: 'Open-Meteo processed snowfall depth, summed over the preceding hour. Hourly values may be interpolated from coarser model steps; they are not a storm-total probability.',
    metadata: null };
}
export function normalizePrereleaseWinterModel(forecast, metadata, id, location, now = Date.now()) {
  validateLocation(location);
  if (!finite(now)) fail('A valid current time is required.');
  const model = modelFor(id), base = sourceBase(id, location), data = forecast?.data;
  const fetchedAt = checkedFetchedAt(forecast?.fetchedAt, now);
  if (!data || data.error || Array.isArray(data)) fail('The point model response is unavailable.');
  validateLocation(data);
  if (distanceKm(location, data) > model.maxPointDistanceKm) fail('The returned model grid point does not match this location.');
  const times = data.hourly?.time, amounts = data.hourly?.snowfall, units = data.hourly_units;
  if (units?.time !== 'unixtime' || data.utc_offset_seconds !== 0 || !Array.isArray(times) || !times.length || times.length > MAX_RESPONSE_HOURS || times.some((t, i) => !Number.isSafeInteger(t) || t % 3600 !== 0 || (i > 0 && t - times[i - 1] !== 3600))) fail('The snowfall time axis has missing, duplicate or invalid UTC hours.');
  if (!Array.isArray(amounts) || amounts.length !== times.length) fail('The snowfall values do not match the time axis.');
  if (!['cm', 'inch', 'in'].includes(units.snowfall)) fail('The source does not supply verified snowfall-depth units.');
  const divisor = units.snowfall === 'cm' ? 2.54 : 1;
  if (amounts.some(v => v !== null && (!finite(v) || v < 0 || v / divisor > 300 / 2.54))) fail('The snowfall values contain invalid or implausible amounts.');
  const feed = checkedMetadata(metadata, model, id, fetchedAt, now), horizonEnd = timestamp(feed.conservativeHorizonEnd);
  // Ignore historical hours and do not extrapolate either nulls or a short-cycle
  // HRRR forecast to a longer horizon. The current partial hour is retained as
  // a whole source interval and cannot be prorated into an amount from now.
  const intervals = times.flatMap((time, index) => {
    const end = time * 1000;
    return end > now && end <= horizonEnd ? [{ start: iso(end - HOUR), end: iso(end), value: finite(amounts[index]) ? amounts[index] / divisor : null, unit: 'inches' }] : [];
  });
  const coveredHours = intervals.filter(row => finite(row.value)).length, expectedHours = intervals.length;
  const status = coveredHours === 0 ? 'unavailable' : coveredHours === expectedHours ? 'ready' : 'partial';
  return { ...base, status, fetchedAt: iso(fetchedAt), metadata: feed,
    modelGrid: { latitude: data.latitude, longitude: data.longitude, distanceKm: distanceKm(location, data) }, intervals,
    coverageStart: intervals[0]?.start ?? null, coverageEnd: intervals.at(-1)?.end ?? null,
    coveredHours, expectedHours, coverageFraction: expectedHours ? coveredHours / expectedHours : 0,
    reason: coveredHours === 0 ? 'No usable future snowfall amounts are available within this model horizon.' : status === 'partial' ? 'Some snowfall hours are missing; only complete intervals can be totaled.' : 'Current point guidance is available within the stated coverage; its exact model-run association is not supplied.' };
}
/** No proration, rounding, overlapping intervals, silent missing hours or
 * cumulative-from-run fields. This sums ONLY complete one-hour depth rows. */
export function sumPrereleaseWinterIntervals(intervals, start, end) {
  const from = timestamp(start), through = timestamp(end), expectedHours = (through - from) / HOUR;
  const unavailable = (reason, coveredHours = 0) => ({ value: null, unit: 'inches', complete: false, coveredHours, expectedHours: finite(expectedHours) && expectedHours > 0 ? expectedHours : null, reason });
  if (!finite(from) || !finite(through) || through <= from || from % HOUR || through % HOUR || expectedHours > MAX_RESPONSE_HOURS || !Array.isArray(intervals)) return unavailable('A nonempty, hour-aligned interval is required; source hours are never prorated.');
  const relevant = [];
  for (const row of intervals) {
    const a = timestamp(row?.start), b = timestamp(row?.end);
    if (!finite(a) || !finite(b) || b <= a) return unavailable('An invalid source interval prevents a verified total.');
    if (b > from && a < through) relevant.push({ ...row, a, b });
  }
  relevant.sort((a, b) => a.a - b.a);
  let cursor = from, total = 0, coveredHours = 0;
  for (const row of relevant) {
    if (row.a !== cursor || row.b - row.a !== HOUR || row.b > through || row.unit !== 'inches' || !finite(row.value) || row.value < 0) return unavailable('A source hour is missing, overlapping, incomplete or incompatible.', coveredHours);
    total += row.value; coveredHours++; cursor = row.b;
  }
  if (cursor !== through) return unavailable('The source does not cover the complete interval.', coveredHours);
  return { value: total, unit: 'inches', complete: true, coveredHours, expectedHours, reason: null };
}
function unavailableRequestedSource(id) {
  const wpc = id === 'wpc';
  return { id, sourceId: id, label: wpc ? 'NWS WPC winter guidance' : 'Google WeatherNext', status: 'unavailable',
    value: null, metric: 'snow', quantity: 'snowfall-depth', statistic: 'expected-amount', unit: 'inches',
    initializedAt: null, issuedAt: null, fetchedAt: null, intervals: [], probabilities: emptyProbabilities(),
    reason: wpc ? 'A compatible WPC expected snowfall amount is not connected. Threshold probabilities and NDFD amounts cannot fill this slot.' : 'No verified native WeatherNext snowfall, freezing-rain or sleet product is connected.',
    sourceUrl: wpc ? 'https://www.wpc.ncep.noaa.gov/pwpf/about_pwpf_products.shtml' : 'https://developers.google.com/weathernext/guides/models' };
}
export function prereleaseWinterPeriod(sources, start, end, now = Date.now()) {
  const from = timestamp(start), through = timestamp(end), boundary = now + 24 * HOUR;
  const valid = finite(from) && finite(through) && through > from && through > now;
  const crosses = valid && from < boundary && through > boundary;
  const kind = !valid ? 'unavailable' : crosses ? 'split-required' : through <= boundary ? 'within-24h' : 'beyond-24h';
  const requestedWeights = !valid || crosses ? null : kind === 'within-24h' ? { ...PRERELEASE_WINTER_WEIGHTS.within24h } : { ...PRERELEASE_WINTER_WEIGHTS.beyond24h };
  const sourceAmounts = Object.fromEntries(['wpc', 'hrrr', 'nam', 'ecmwf', 'weathernext', 'gfs'].map(id => {
    const source = sources?.[id];
    const sum = valid && ['ready', 'partial'].includes(source?.status) ? sumPrereleaseWinterIntervals(source.intervals, start, end) : { value: null, unit: 'inches', complete: false, coveredHours: 0, expectedHours: valid ? (through - from) / HOUR : null, reason: source?.reason || 'Source unavailable.' };
    return [id, { ...sum, source: id, statistic: source?.statistic ?? null }];
  }));
  return { start, end, kind, sourceAmounts, probabilities: emptyProbabilities(), requestedBlend: {
    value: null, unit: 'inches', status: 'unavailable', requestedWeights,
    availableSources: requestedWeights ? Object.keys(requestedWeights).filter(id => sourceAmounts[id].complete) : [],
    missingSources: requestedWeights ? Object.keys(requestedWeights).filter(id => !sourceAmounts[id].complete) : [],
    reason: crosses ? 'This interval crosses the 24-hour weight boundary; it cannot be blended as one period.' : 'The requested WPC/WeatherNext winter inputs are not available. Exact requested shares are preserved; no sources are substituted or reweighted.',
  } };
}
export function createPrereleaseWinterService({ cached, now = Date.now }) {
  if (typeof cached !== 'function' || typeof now !== 'function') throw new TypeError('cached and now must be functions.');
  return async location => {
    validateLocation(location);
    const checkedAt = now();
    if (!finite(checkedAt)) fail('A valid current time is required.');
    const results = await Promise.all(Object.keys(PRERELEASE_WINTER_MODELS).map(async id => {
      let forecast = null;
      try {
        const responses = await Promise.all([
          cached(prereleaseWinterModelUrl(id, location), 10 * MINUTE, { timeout: 16000 }),
          cached(prereleaseWinterMetadataUrl(id), 5 * MINUTE, { timeout: 12000 }),
        ]);
        forecast = responses[0];
        return normalizePrereleaseWinterModel(forecast, responses[1], id, location, checkedAt);
      } catch (error) {
        return { ...sourceBase(id, location), status: error?.status === 'stale' ? 'stale' : 'unavailable',
          fetchedAt: finite(timestamp(forecast?.fetchedAt)) ? iso(timestamp(forecast.fetchedAt)) : null,
          reason: String(error?.message || 'Winter source could not be checked.').replace(/[<>]/g, '').slice(0, 220) };
      }
    }));
    const sources = Object.fromEntries(results.map(source => [source.id, source]));
    sources.wpc = unavailableRequestedSource('wpc'); sources.weathernext = unavailableRequestedSource('weathernext');
    const windowStart = Math.ceil(checkedAt / HOUR) * HOUR;
    // These are explicitly aligned 24-hour comparison windows, NOT calendar
    // days or a prorated total beginning at the current minute.
    const windows = Array.from({ length: 7 }, (_, i) => ({
      label: i === 0 ? 'Next 24 complete forecast hours' : `24-hour comparison window ${i + 1}`,
      ...prereleaseWinterPeriod(sources, iso(windowStart + i * 24 * HOUR), iso(windowStart + (i + 1) * 24 * HOUR), checkedAt),
    }));
    const value = { version: 'prerelease-winter-sources-v1', assembledAt: iso(checkedAt),
      location: { latitude: location.latitude, longitude: location.longitude }, sources, windows,
      requestedWeights: { within24h: { ...PRERELEASE_WINTER_WEIGHTS.within24h }, beyond24h: { ...PRERELEASE_WINTER_WEIGHTS.beyond24h } },
      probabilities: emptyProbabilities(), requestedBlend: { value: null, status: 'unavailable', reason: 'Required compatible WPC and WeatherNext winter inputs are unavailable; no missing shares are redistributed.' },
      note: 'Individual model amounts are supplemental deterministic guidance. They do not alter the main weather forecast or provide type-specific probabilities.' };
    const meta = Object.values(sources).map(source => ({ id: `prerelease-winter-${source.id}`, label: source.label,
      status: source.status, issuedAt: null, initializedAt: null, fetchedAt: source.fetchedAt,
      validFrom: source.coverageStart ?? null, validUntil: source.coverageEnd ?? null,
      latestFeedRunAt: source.metadata?.latestRunAt ?? null, forecastRunBound: false,
      url: source.sourceUrl, message: source.reason }));
    return { value, meta };
  };
}
