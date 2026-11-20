// Historical model accuracy & multi-metric past-forecast verification engine.
// Evaluates Weather Nourie against 7 major US & global weather models across
// Temperature, Rain/Precipitation, Wind Speed, Cloud Cover, and Humidity
// using real NWS ASOS/METAR station observations and ERA5 archive reanalysis.

const H = 3600000;
const DAY_MS = 86400000;
const CACHE_TTL_MS = 20 * 60 * 1000;

export const ACCURACY_MODELS = [
  { id: 'nourie', name: 'Weather Nourie', subtitle: 'Consensus Blend (HRRR · NBM · ECMWF · Global)', color: '#ffffff', isNourie: true },
  { id: 'hrrr', omModel: 'ncep_hrrr_conus', name: 'NOAA HRRR', subtitle: '3 km Rapid Refresh CONUS', color: '#ffb47d' },
  { id: 'nbm', omModel: 'ncep_nbm_conus', name: 'NOAA NBM', subtitle: 'National Blend of Models', color: '#7de8a8' },
  { id: 'ecmwf', omModel: 'ecmwf_ifs025', name: 'ECMWF IFS', subtitle: 'European 0.25° Global', color: '#b48cff' },
  { id: 'icon', omModel: 'icon_seamless', name: 'DWD ICON', subtitle: 'German Global Icosahedral', color: '#68e5dc' },
  { id: 'ukmo', omModel: 'ukmo_seamless', name: 'UK Met Office', subtitle: 'UKMO Global Unified Model', color: '#fbbf24' },
  { id: 'gem', omModel: 'gem_global', name: 'Canadian GEM', subtitle: 'Environment Canada Global', color: '#60a5fa' },
  { id: 'gfs', omModel: 'gfs_global', name: 'NOAA GFS', subtitle: 'American 0.25° Global', color: '#ff8fc8' },
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function round(v, dp = 2) {
  if (!finite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function cToF(c) {
  return finite(c) ? (c * 9) / 5 + 32 : null;
}

function kmhToMph(kmh) {
  return finite(kmh) ? kmh * 0.621371 : null;
}

function normalizeHourIso(raw) {
  if (!raw) return null;
  const iso = raw.endsWith('Z') || /[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}:00Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const floored = Math.floor((ms + 30 * 60000) / H) * H;
  return new Date(floored).toISOString();
}

function bucketNwsObservations(features) {
  const byHour = new Map();
  if (!Array.isArray(features)) return byHour;
  for (const feat of features) {
    const props = feat?.properties;
    const ts = Date.parse(props?.timestamp || '');
    const tempC = props?.temperature?.value;
    if (!Number.isFinite(ts) || !finite(tempC)) continue;
    const nearestHour = Math.round(ts / H) * H;
    const dist = Math.abs(ts - nearestHour);
    if (dist > 35 * 60000) continue;
    const key = new Date(nearestHour).toISOString();
    const existing = byHour.get(key);
    if (!existing || dist < existing.dist) {
      byHour.set(key, {
        dist,
        tempF: cToF(tempC),
        windMph: kmhToMph(props?.windSpeed?.value),
        precipIn: finite(props?.precipitationLastHour?.value) ? props.precipitationLastHour.value / 25.4 : null,
        humidityPct: finite(props?.relativeHumidity?.value) ? props.relativeHumidity.value : null,
        source: 'nws-station',
      });
    }
  }
  return byHour;
}

export function computeNourieHistoricalPoint(modelValues, horizon = 24) {
  const weights =
    horizon <= 24
      ? { hrrr: 0.30, nbm: 0.34, ecmwf: 0.16, icon: 0.08, ukmo: 0.06, gem: 0.03, gfs: 0.03 }
      : { nbm: 0.36, ecmwf: 0.26, icon: 0.14, ukmo: 0.12, gem: 0.06, gfs: 0.06, hrrr: 0 };

  let sumW = 0;
  let sumVal = 0;
  for (const [id, w] of Object.entries(weights)) {
    const val = modelValues[id];
    if (w > 0 && finite(val)) {
      sumW += w;
      sumVal += val * w;
    }
  }
  if (sumW <= 0) return null;
  return sumVal / sumW;
}

export function scoreModelAgainstTruth(pairs) {
  if (!pairs.length) return null;
  let absSum = 0;
  let sqSum = 0;
  let biasSum = 0;
  let within2 = 0;
  let within3 = 0;
  let maxAbs = 0;

  let windAbsSum = 0;
  let windCount = 0;

  let wetObs = 0;
  let wetHits = 0;
  let dryObs = 0;
  let dryHits = 0;
  let precipAbsSum = 0;
  let precipCount = 0;

  let cloudAbsSum = 0;
  let cloudCount = 0;

  let humAbsSum = 0;
  let humCount = 0;

  for (const row of pairs) {
    const {
      pred, obs,
      predWind, obsWind,
      predPrecip, obsPrecip,
      predCloud, obsCloud,
      predHumidity, obsHumidity,
    } = row;
    const err = pred - obs;
    const absErr = Math.abs(err);
    absSum += absErr;
    sqSum += err * err;
    biasSum += err;
    if (absErr <= 2.0) within2 += 1;
    if (absErr <= 3.0) within3 += 1;
    if (absErr > maxAbs) maxAbs = absErr;

    if (finite(predWind) && finite(obsWind)) {
      windAbsSum += Math.abs(predWind - obsWind);
      windCount += 1;
    }
    if (finite(predPrecip) && finite(obsPrecip)) {
      precipAbsSum += Math.abs(predPrecip - obsPrecip);
      precipCount += 1;
      const obsWet = obsPrecip >= 0.01;
      const predWet = predPrecip >= 0.01;
      if (obsWet) {
        wetObs += 1;
        if (predWet) wetHits += 1;
      } else {
        dryObs += 1;
        if (!predWet) dryHits += 1;
      }
    }
    if (finite(predCloud) && finite(obsCloud)) {
      cloudAbsSum += Math.abs(predCloud - obsCloud);
      cloudCount += 1;
    }
    if (finite(predHumidity) && finite(obsHumidity)) {
      humAbsSum += Math.abs(predHumidity - obsHumidity);
      humCount += 1;
    }
  }

  const n = pairs.length;
  const maeF = absSum / n;
  const rmseF = Math.sqrt(sqSum / n);
  const biasF = biasSum / n;
  const within2F = (within2 / n) * 100;
  const within3F = (within3 / n) * 100;

  const windMaeMph = windCount > 0 ? windAbsSum / windCount : null;
  const precipTotal = wetObs + dryObs;
  const precipHitPct = precipTotal > 0 ? ((wetHits + dryHits) / precipTotal) * 100 : null;
  const precipMaeIn = precipCount > 0 ? precipAbsSum / precipCount : null;
  const cloudMaePct = cloudCount > 0 ? cloudAbsSum / cloudCount : null;
  const humidityMaePct = humCount > 0 ? humAbsSum / humCount : null;

  // Individual 0..100 normalized skill sub-scores across all 5 verified weather dimensions
  const tempScore = clamp(100 - maeF * 7.5, 0, 100);
  const rainScore =
    finite(precipHitPct)
      ? clamp(precipHitPct * 0.72 + clamp(100 - (precipMaeIn || 0) * 550, 0, 100) * 0.28, 0, 100)
      : null;
  const windScore = finite(windMaeMph) ? clamp(100 - windMaeMph * 6.5, 0, 100) : null;
  const cloudScore = finite(cloudMaePct) ? clamp(100 - cloudMaePct * 1.15, 0, 100) : null;
  const humidityScore = finite(humidityMaePct) ? clamp(100 - humidityMaePct * 1.4, 0, 100) : null;

  // Composite Multi-Metric Overall Score:
  // 40% Temperature + 25% Rain/Precip + 15% Wind + 10% Cloud Cover + 10% Humidity
  const parts = [
    [tempScore, 0.40],
    [rainScore, 0.25],
    [windScore, 0.15],
    [cloudScore, 0.10],
    [humidityScore, 0.10],
  ].filter(([s]) => finite(s));
  const wSum = parts.reduce((acc, [, w]) => acc + w, 0) || 1;
  const overallScore = parts.reduce((acc, [s, w]) => acc + s * w, 0) / wSum;

  return {
    maeF: round(maeF, 2),
    rmseF: round(rmseF, 2),
    biasF: round(biasF, 2),
    within2F: round(within2F, 1),
    within3F: round(within3F, 1),
    maxAbsErrF: round(maxAbs, 1),
    windMaeMph: round(windMaeMph, 1),
    precipHitPct: round(precipHitPct, 1),
    precipMaeIn: round(precipMaeIn, 3),
    cloudMaePct: round(cloudMaePct, 1),
    humidityMaePct: round(humidityMaePct, 1),
    sampleHours: n,
    overallScore: round(overallScore, 1),
    accuracyScore: Math.round(overallScore),
    scores: {
      overall: round(overallScore, 1),
      temp: round(tempScore, 1),
      rain: round(rainScore, 1),
      wind: round(windScore, 1),
      cloud: round(cloudScore, 1),
      humidity: round(humidityScore, 1),
    },
  };
}

export function createAccuracyService({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const liveLedger = new Map();

  function recordRuntimeForecast(forecast) {
    if (!forecast?.location || !Array.isArray(forecast.hours)) return;
    const latKey = Number(forecast.location.latitude).toFixed(2);
    const lonKey = Number(forecast.location.longitude).toFixed(2);
    const assembledMs = Date.parse(forecast.assembledAt || '') || now();
    for (const hr of forecast.hours) {
      const hrMs = Date.parse(hr?.time || '');
      if (!Number.isFinite(hrMs)) continue;
      const leadH = (hrMs - assembledMs) / H;
      if (leadH < 12 || leadH > 54) continue;
      const hourIso = new Date(Math.round(hrMs / H) * H).toISOString();
      const key = `${latKey}:${lonKey}:${hourIso}`;
      const existing = liveLedger.get(key) || {};
      liveLedger.set(key, {
        ...existing,
        nourie: finite(hr.temperature) ? hr.temperature : existing.nourie,
        nws: finite(hr.nwsTemperature) ? hr.nwsTemperature : existing.nws,
      });
    }
    if (liveLedger.size > 15000) {
      const oldest = [...liveLedger.keys()].slice(0, 3000);
      for (const k of oldest) liveLedger.delete(k);
    }
  }

  async function fetchJson(url) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'WeatherNourie/1.0' },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
      }
    }
    throw lastErr;
  }

  async function loadNwsStationObservations(lat, lon) {
    try {
      const pts = await fetchJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
      const stationsUrl = pts?.properties?.observationStations;
      if (!stationsUrl) return { stationId: null, stationName: null, byHour: new Map() };
      const stList = await fetchJson(stationsUrl);
      const first = stList?.features?.[0];
      const stationId = first?.properties?.stationIdentifier || null;
      const stationName = first?.properties?.name || stationId;
      if (!stationId) return { stationId: null, stationName: null, byHour: new Map() };
      const obs = await fetchJson(`https://api.weather.gov/stations/${stationId}/observations?limit=350`);
      return {
        stationId,
        stationName,
        byHour: bucketNwsObservations(obs?.features),
      };
    } catch {
      return { stationId: null, stationName: null, byHour: new Map() };
    }
  }

  async function loadArchiveObservations(lat, lon, startDate, endDate) {
    const byHour = new Map();
    try {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${startDate}&end_date=${endDate}&hourly=temperature_2m,precipitation,wind_speed_10m,cloud_cover,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=UTC`;
      const data = await fetchJson(url);
      const times = data?.hourly?.time || [];
      for (let i = 0; i < times.length; i++) {
        const tempF = data.hourly.temperature_2m?.[i];
        if (!finite(tempF)) continue;
        const iso = normalizeHourIso(times[i]);
        if (!iso) continue;
        byHour.set(iso, {
          tempF,
          windMph: data.hourly.wind_speed_10m?.[i] ?? null,
          precipIn: data.hourly.precipitation?.[i] ?? null,
          cloudPct: data.hourly.cloud_cover?.[i] ?? null,
          humidityPct: data.hourly.relative_humidity_2m?.[i] ?? null,
          source: 'era5-archive',
        });
      }
    } catch {
      // Falls back cleanly to NWS station & Day-0 analysis
    }
    return byHour;
  }

  async function getAccuracy({ latitude, longitude, days = 10, horizon = 24 }) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    const windowDays = Math.max(3, Math.min(14, Number(days) || 10));
    const horizonHours = Number(horizon) === 48 ? 48 : 24;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('Valid latitude and longitude are required.');
    }

    const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}:${windowDays}:${horizonHours}:v2`;
    const entry = cache.get(cacheKey);
    if (entry && now() - entry.at < CACHE_TTL_MS) {
      return entry.payload;
    }

    const currentMs = now();
    const pastHoursTotal = windowDays * 24;
    const endDate = new Date(currentMs - DAY_MS).toISOString().slice(0, 10);
    const startDate = new Date(currentMs - (windowDays + 1) * DAY_MS).toISOString().slice(0, 10);

    const prevModels = ACCURACY_MODELS.filter((m) => m.omModel).map((m) => m.omModel).join(',');
    const prevVars = [
      'temperature_2m', 'temperature_2m_previous_day1', 'temperature_2m_previous_day2',
      'precipitation', 'precipitation_previous_day1', 'precipitation_previous_day2',
      'wind_speed_10m', 'wind_speed_10m_previous_day1', 'wind_speed_10m_previous_day2',
      'cloud_cover', 'cloud_cover_previous_day1', 'cloud_cover_previous_day2',
      'relative_humidity_2m', 'relative_humidity_2m_previous_day1', 'relative_humidity_2m_previous_day2',
    ].join(',');
    const prevUrl = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${prevVars}&models=${prevModels}&past_days=${windowDays}&forecast_days=1&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=UTC`;

    const [prevData, nwsObs, era5Map] = await Promise.all([
      fetchJson(prevUrl),
      loadNwsStationObservations(lat, lon),
      loadArchiveObservations(lat, lon, startDate, endDate),
    ]);

    const times = prevData?.hourly?.time || [];
    const suffixLead = horizonHours === 48 ? '_previous_day2' : '_previous_day1';
    const currentFloorHourMs = Math.floor(currentMs / H) * H;
    const cutoffStartMs = currentFloorHourMs - pastHoursTotal * H;
    const latKey = lat.toFixed(2);
    const lonKey = lon.toFixed(2);

    const rows = [];
    let nwsStationHours = 0;
    let era5Hours = 0;
    let analysisHours = 0;

    for (let i = 0; i < times.length; i++) {
      const iso = normalizeHourIso(times[i]);
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (ms > currentFloorHourMs || ms < cutoffStartMs) continue;

      const hr = prevData.hourly;
      const preds = {};
      const winds = {};
      const precips = {};
      const clouds = {};
      const humidities = {};
      const day0Temp = [];
      const day0Cloud = [];
      const day0Hum = [];

      for (const m of ACCURACY_MODELS) {
        if (!m.omModel) continue;
        const tVal = hr[`temperature_2m${suffixLead}_${m.omModel}`]?.[i];
        const wVal = hr[`wind_speed_10m${suffixLead}_${m.omModel}`]?.[i];
        const pVal = hr[`precipitation${suffixLead}_${m.omModel}`]?.[i];
        const cVal = hr[`cloud_cover${suffixLead}_${m.omModel}`]?.[i];
        const hVal = hr[`relative_humidity_2m${suffixLead}_${m.omModel}`]?.[i];
        if (finite(tVal)) preds[m.id] = tVal;
        if (finite(wVal)) winds[m.id] = wVal;
        if (finite(pVal)) precips[m.id] = pVal;
        if (finite(cVal)) clouds[m.id] = cVal;
        if (finite(hVal)) humidities[m.id] = hVal;

        const d0t = hr[`temperature_2m_${m.omModel}`]?.[i];
        const d0c = hr[`cloud_cover_${m.omModel}`]?.[i];
        const d0h = hr[`relative_humidity_2m_${m.omModel}`]?.[i];
        if (finite(d0t)) day0Temp.push(d0t);
        if (finite(d0c)) day0Cloud.push(d0c);
        if (finite(d0h)) day0Hum.push(d0h);
      }

      const ledgerHit = liveLedger.get(`${latKey}:${lonKey}:${iso}`);
      const nourieT = finite(ledgerHit?.nourie) ? ledgerHit.nourie : computeNourieHistoricalPoint(preds, horizonHours);
      if (finite(nourieT)) preds.nourie = nourieT;
      const nourieW = computeNourieHistoricalPoint(winds, horizonHours);
      if (finite(nourieW)) winds.nourie = nourieW;
      const nourieP = computeNourieHistoricalPoint(precips, horizonHours);
      if (finite(nourieP)) precips.nourie = nourieP;
      const nourieC = computeNourieHistoricalPoint(clouds, horizonHours);
      if (finite(nourieC)) clouds.nourie = nourieC;
      const nourieH = computeNourieHistoricalPoint(humidities, horizonHours);
      if (finite(nourieH)) humidities.nourie = nourieH;

      const nwsHit = nwsObs.byHour.get(iso);
      const eraHit = era5Map.get(iso);
      let obsTemp = null;
      let obsWind = null;
      let obsPrecip = null;
      let obsCloud = eraHit?.cloudPct ?? (day0Cloud.length >= 2 ? day0Cloud.reduce((s, x) => s + x, 0) / day0Cloud.length : null);
      let obsHumidity = nwsHit?.humidityPct ?? eraHit?.humidityPct ?? (day0Hum.length >= 2 ? day0Hum.reduce((s, x) => s + x, 0) / day0Hum.length : null);
      let truthTier = null;

      if (nwsHit && finite(nwsHit.tempF)) {
        obsTemp = nwsHit.tempF;
        obsWind = nwsHit.windMph ?? eraHit?.windMph ?? null;
        obsPrecip = nwsHit.precipIn ?? eraHit?.precipIn ?? null;
        truthTier = 'nws-station';
        nwsStationHours += 1;
      } else if (eraHit && finite(eraHit.tempF)) {
        obsTemp = eraHit.tempF;
        obsWind = eraHit.windMph;
        obsPrecip = eraHit.precipIn;
        truthTier = 'era5-archive';
        era5Hours += 1;
      } else if (day0Temp.length >= 2) {
        obsTemp = day0Temp.reduce((s, x) => s + x, 0) / day0Temp.length;
        truthTier = 'day0-analysis';
        analysisHours += 1;
      }

      if (!finite(obsTemp)) continue;
      rows.push({
        time: iso,
        ms,
        obs: obsTemp,
        obsWind,
        obsPrecip,
        obsCloud,
        obsHumidity,
        truthTier,
        preds,
        winds,
        precips,
        clouds,
        humidities,
      });
    }

    const minRequired = Math.max(12, Math.floor(rows.length * 0.4));
    const activeModels = ACCURACY_MODELS.filter((m) => {
      const count = rows.reduce((c, r) => c + (finite(r.preds[m.id]) ? 1 : 0), 0);
      return count >= minRequired;
    });

    const rankingsRaw = [];
    for (const m of activeModels) {
      const pairs = rows
        .filter((r) => finite(r.preds[m.id]))
        .map((r) => ({
          pred: r.preds[m.id],
          obs: r.obs,
          predWind: r.winds[m.id],
          obsWind: r.obsWind,
          predPrecip: r.precips[m.id],
          obsPrecip: r.obsPrecip,
          predCloud: r.clouds[m.id],
          obsCloud: r.obsCloud,
          predHumidity: r.humidities[m.id],
          obsHumidity: r.obsHumidity,
        }));
      const stats = scoreModelAgainstTruth(pairs);
      if (!stats) continue;
      rankingsRaw.push({
        id: m.id,
        name: m.name,
        subtitle: m.subtitle,
        color: m.color,
        isNourie: Boolean(m.isNourie),
        ...stats,
      });
    }

    // Rank by Overall Multi-Metric Score (highest wins), breaking ties by lower Temp MAE
    rankingsRaw.sort((a, b) => b.overallScore - a.overallScore || a.maeF - b.maeF);
    const rankings = rankingsRaw.map((item, idx) => ({ ...item, rank: idx + 1 }));

    const dailyMap = new Map();
    for (const r of rows) {
      const dayKey = r.time.slice(0, 10);
      let bucket = dailyMap.get(dayKey);
      if (!bucket) {
        bucket = { date: dayKey, obsSum: 0, obsMax: -999, obsMin: 999, count: 0, byModel: {} };
        dailyMap.set(dayKey, bucket);
      }
      bucket.obsSum += r.obs;
      if (r.obs > bucket.obsMax) bucket.obsMax = r.obs;
      if (r.obs < bucket.obsMin) bucket.obsMin = r.obs;
      bucket.count += 1;

      for (const m of activeModels) {
        const pv = r.preds[m.id];
        if (!finite(pv)) continue;
        if (!bucket.byModel[m.id]) bucket.byModel[m.id] = { errSum: 0, predSum: 0, predMax: -999, n: 0 };
        const mb = bucket.byModel[m.id];
        mb.errSum += Math.abs(pv - r.obs);
        mb.predSum += pv;
        if (pv > mb.predMax) mb.predMax = pv;
        mb.n += 1;
      }
    }

    const fmtDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const dailySeries = [...dailyMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        const modelsOut = {};
        for (const [id, mb] of Object.entries(d.byModel)) {
          modelsOut[id] = {
            maeF: round(mb.errSum / mb.n, 2),
            meanF: round(mb.predSum / mb.n, 1),
            highF: round(mb.predMax, 1),
          };
        }
        return {
          date: d.date,
          label: fmtDay.format(new Date(`${d.date}T12:00:00Z`)),
          observedMeanF: round(d.obsSum / d.count, 1),
          observedHighF: round(d.obsMax, 1),
          observedLowF: round(d.obsMin, 1),
          hours: d.count,
          models: modelsOut,
        };
      });

    const step = rows.length > 120 ? 2 : 1;
    const hourlySeries = [];
    for (let i = 0; i < rows.length; i += step) {
      const r = rows[i];
      const pt = { time: r.time, observed: round(r.obs, 1), tier: r.truthTier };
      for (const m of activeModels) {
        if (finite(r.preds[m.id])) pt[m.id] = round(r.preds[m.id], 1);
      }
      hourlySeries.push(pt);
    }

    const payload = {
      version: 2,
      location: {
        latitude: round(lat, 4),
        longitude: round(lon, 4),
        stationId: nwsObs.stationId,
        stationName: nwsObs.stationName,
      },
      windowDays,
      horizonHours,
      generatedAt: new Date(currentMs).toISOString(),
      truthSummary: {
        totalHours: rows.length,
        nwsStationHours,
        era5Hours,
        analysisHours,
        stationId: nwsObs.stationId,
      },
      scoringFormula: 'Overall Score (0–100) = 40% Temperature + 25% Rain/Precip + 15% Wind + 10% Cloud Cover + 10% Humidity.',
      methodology: `${horizonHours}h-ahead archived model runs evaluated across 5 weather metrics against ${nwsStationHours ? `NWS station ${nwsObs.stationId} METAR observations & ` : ''}ERA5 verification over the past ${windowDays} days.`,
      activeModels: activeModels.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        isNourie: Boolean(m.isNourie),
      })),
      rankings,
      dailySeries,
      hourlySeries,
    };

    cache.set(cacheKey, { at: currentMs, payload });
    if (cache.size > 150) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    return payload;
  }

  return { getAccuracy, recordRuntimeForecast };
}
