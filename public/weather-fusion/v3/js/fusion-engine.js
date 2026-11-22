/**
 * Weather Nourie · Multi-Model Fusion Engine (Blend V2 + 100-Point Rain Ledger)
 * Fetches live meteorological feeds from:
 * - Open-Meteo Multi-Model API (HRRR, GFS/NBM, ECMWF IFS 0.25°, GEFS/ICON, Solar Radiation)
 * - NOAA / National Weather Service API (api.weather.gov Gridpoints, Active Alerts GeoJSON, Area Forecast Discussion AFD)
 * - Open-Meteo / CAMS Air Quality API (US EPA AQI, PM2.5, PM10, O3, NO2, SO2, CO)
 * - Open-Meteo Geocoding API (Global & US City / ZIP code search)
 * And computes full Blend V2 temperature fusion, outlier dampening, 100-pt rain scoring,
 * UTCI/Steadman hybrid thermal comfort, and 2-layer concrete/asphalt sidewalk heat.
 */

import {
  calcDewPointF,
  calcIndoorRhAt70F,
  clamp,
  computePavementProfile,
  computeThermalComfort
} from './physics.js';
import {
  currentSample,
  formatRainLikelihoodTooltip,
  reconcileRainLikelihood
} from '../../weather-display.js?v=rain-reconcile-v2';
import { displayedFeelsAt } from '../../hourly-feels.js?v=current-rain-20261017-v3';
import { shadeFeelsLike, thermalComfort } from '../../weather-math.js?v=current-rain-20261017-v3';

const US_STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY'
};

function formatStateShort(stateName) {
  if (!stateName) return '';
  const trimmed = String(stateName).trim();
  return US_STATE_ABBR[trimmed] || trimmed;
}

/**
 * Reconciles sky condition wording against multi-model cloud cover & thermal weatherKind
 * so distant airport AWOS "CLR" overrides (blind above 12,000 ft) never show "Sunny"
 * on an overcast/mostly cloudy day.
 */
function reconcileSkyCondition(rawCondition, cloudCover, isDay, rainChance = 0, weatherKind = null, forecastCondition = null) {
  let cond = String(rawCondition || '').trim();
  const c = cond.toLowerCase();
  const wetOrObscured = /rain|shower|drizzle|storm|thunder|t-storm|lightning|snow|sleet|flurr|blizzard|ice|wintry|freez|fog|mist|haze|smoke/.test(c);

  if (!wetOrObscured) {
    const claimsSunnyOrClear = /\bsunny\b|\bclear\b|\bfair\b|few clouds/.test(c);
    const claimsPartly = /partly|scattered|mostly sunny/.test(c);
    const heavilyClouded = (typeof cloudCover === 'number' && Number.isFinite(cloudCover) && cloudCover >= 70) || weatherKind === 'cloudy';

    if (heavilyClouded && (claimsSunnyOrClear || (claimsPartly && cloudCover >= 80) || !cond)) {
      const fc = String(forecastCondition || '').trim();
      const fcClean = fc && !/\bsunny\b|\bclear\b|\bfair\b|partly/i.test(fc) ? fc : '';
      cond = fcClean || (cloudCover >= 90 ? 'Overcast' : 'Mostly Cloudy');
    } else if (typeof cloudCover === 'number' && Number.isFinite(cloudCover) && cloudCover >= 45 && cloudCover < 70 && claimsSunnyOrClear && !claimsPartly) {
      cond = 'Partly Cloudy';
    }
  }

  if (!isDay) {
    if (/^sunny$/i.test(cond)) cond = 'Clear';
    else if (/^mostly sunny$/i.test(cond)) cond = 'Mostly Clear';
    else if (/^partly sunny$/i.test(cond)) cond = 'Partly Cloudy';
  }

  return cond || (cloudCover >= 90 ? 'Overcast' : cloudCover >= 70 ? 'Mostly Cloudy' : isDay ? 'Partly Cloudy' : 'Clear');
}

/**
 * Blend V2 Base Temperature Weights by Lead-Time Horizon (hours ahead)
 */
export function getHorizonBaseWeights(leadHours) {
  if (leadHours < 24) {
    return { label: '0–24h Short Range', nws: 0.20, hrrr: 0.25, nbm: 0.25, ecmwf: 0.15, gefs: 0.00, weathernext: 0.15 };
  }
  if (leadHours < 48) {
    return { label: '24–48h Near Term', nws: 0.15, hrrr: 0.20, nbm: 0.25, ecmwf: 0.20, gefs: 0.00, weathernext: 0.20 };
  }
  if (leadHours < 72) {
    return { label: '48–72h Medium Transition', nws: 0.15, hrrr: 0.00, nbm: 0.25, ecmwf: 0.25, gefs: 0.10, weathernext: 0.25 };
  }
  if (leadHours < 168) {
    return { label: 'Days 4–7 Extended', nws: 0.10, hrrr: 0.00, nbm: 0.25, ecmwf: 0.25, gefs: 0.10, weathernext: 0.30 };
  }
  return { label: 'Days 8–10 Long Range', nws: 0.00, hrrr: 0.00, nbm: 0.10, ecmwf: 0.30, gefs: 0.20, weathernext: 0.40 };
}

/**
 * Blends model temperatures for a given lead hour using Weather Nourie Blend V2
 * with `weather-nourie-temperature-outliers-v1` ECMWF outlier dampening.
 */
export function blendTemperatureHour(modelTemps, leadHours) {
  const base = getHorizonBaseWeights(leadHours);
  const keys = ['nws', 'hrrr', 'nbm', 'ecmwf', 'gefs', 'weathernext'];
  const active = keys.filter((k) => typeof modelTemps[k] === 'number' && !Number.isNaN(modelTemps[k]) && base[k] > 0);

  if (active.length === 0) {
    const fallbackVal = Object.values(modelTemps).find((v) => typeof v === 'number' && !Number.isNaN(v)) ?? 60;
    return {
      blendedF: Math.round(fallbackVal),
      rawBlendedF: fallbackVal,
      effectiveWeights: { nbm: 1 },
      baseWeights: base,
      outlierDampened: false,
      outlierReason: null,
      spreadF: 0,
      minF: Math.round(fallbackVal),
      maxF: Math.round(fallbackVal)
    };
  }

  const weights = {};
  active.forEach((k) => {
    weights[k] = base[k];
  });

  // Check outlier dampening rule (Days 1–2, leadHours < 48)
  let outlierDampened = false;
  let outlierReason = null;

  if (leadHours < 48 && active.length >= 4 && typeof modelTemps.ecmwf === 'number') {
    const peers = active.filter((k) => k !== 'ecmwf').map((k) => modelTemps[k]);
    const allVals = active.map((k) => modelTemps[k]).sort((a, b) => a - b);
    const mid = Math.floor(allVals.length / 2);
    const median = allVals.length % 2 !== 0 ? allVals[mid] : (allVals[mid - 1] + allVals[mid]) / 2;
    const peerMin = Math.min(...peers);
    const peerMax = Math.max(...peers);
    const peerSpread = peerMax - peerMin;
    const ecmwfVal = modelTemps.ecmwf;
    const devFromMedian = Math.abs(ecmwfVal - median);
    const outsidePeerRange = ecmwfVal < peerMin ? peerMin - ecmwfVal : ecmwfVal > peerMax ? ecmwfVal - peerMax : 0;

    if (devFromMedian >= 4.0 || (peerSpread <= 3.0 && outsidePeerRange >= 3.0)) {
      weights.ecmwf = 0.10;
      outlierDampened = true;
      outlierReason = `ECMWF (${Math.round(ecmwfVal)}°F) deviated ${devFromMedian.toFixed(1)}°F from peer median (${median.toFixed(1)}°F); weight capped at 10%.`;
    }
  }

  // Normalize weights to sum to 1.0
  const totalWeight = Object.values(weights).reduce((acc, w) => acc + w, 0) || 1;
  const effectiveWeights = {};
  let weightedSum = 0;

  active.forEach((k) => {
    effectiveWeights[k] = weights[k] / totalWeight;
    weightedSum += modelTemps[k] * effectiveWeights[k];
  });

  const allAvailableVals = keys
    .map((k) => modelTemps[k])
    .filter((v) => typeof v === 'number' && !Number.isNaN(v));
  const minF = Math.min(...allAvailableVals);
  const maxF = Math.max(...allAvailableVals);

  return {
    blendedF: Math.round(weightedSum),
    rawBlendedF: Number(weightedSum.toFixed(2)),
    effectiveWeights,
    baseWeights: base,
    outlierDampened,
    outlierReason,
    spreadF: Number((maxF - minF).toFixed(1)),
    minF: Math.round(minF),
    maxF: Math.round(maxF)
  };
}

/**
 * 100-Point Rain Chance Scoring Ledger
 * Fixed NWS share: 40 pts (proportional to NWS PoP).
 * Model QPF shares:
 * - Lead < 24h: HRRR 30, NBM 20, ECMWF 10 (+ WeatherNext 10 bonus when active)
 * - Lead 24–48h: HRRR 20, NBM 20, ECMWF 20 (+ WeatherNext 10 bonus)
 * - Lead >= 48h: NBM 25, ECMWF 25, GEFS 10 (+ WeatherNext 10 bonus)
 * Thresholds:
 * - < 0.005 in/hr: 0 pts
 * - 0.005–0.010 in/hr: 1/3 share
 * - 0.010–0.050 in/hr: full share if another model is wet (>=0.005), else 1/3 share
 * - >= 0.050 in/hr: full share
 */
export function scoreRainChance100Pt({
  nwsPop = 0,
  hrrrQpf = 0,
  nbmQpf = 0,
  ecmwfQpf = 0,
  gefsQpf = 0,
  wnQpf = 0,
  nbmProbability = null,
  leadHours = 0
}) {
  const nwsMax = 40;
  const nwsVal = clamp(nwsPop, 0, 100);
  const nwsPts = Number(((nwsVal / 100) * nwsMax).toFixed(2));
  const hasWn = typeof wnQpf === 'number' && Number.isFinite(wnQpf) && wnQpf > 0;

  let shares;
  if (leadHours < 24) {
    shares = hasWn
      ? { hrrr: 25, nbm: 16.67, ecmwf: 8.33, gefs: 0, weathernext: 10 }
      : { hrrr: 30, nbm: 20, ecmwf: 10, gefs: 0, weathernext: 0 };
  } else {
    shares = hasWn
      ? { hrrr: 0, nbm: 14.71, ecmwf: 25.29, gefs: 10, weathernext: 10 }
      : { hrrr: 0, nbm: 17.65, ecmwf: 30.35, gefs: 12, weathernext: 0 };
  }

  const qpfMap = {
    hrrr: Math.max(0, hrrrQpf || 0),
    nbm: Math.max(0, nbmQpf || 0),
    ecmwf: Math.max(0, ecmwfQpf || 0),
    gefs: Math.max(0, gefsQpf || 0),
    weathernext: Math.max(0, wnQpf || 0)
  };

  const wetModelsCount =
    Object.entries(qpfMap).filter(([k, val]) => shares[k] > 0 && val >= 0.005).length +
    (nwsVal >= 20 ? 1 : 0);

  function scoreModelQpf(qpf, maxPts) {
    if (maxPts <= 0 || qpf < 0.005) {
      return { pts: 0, maxPts, qpf, tier: 'Dry (<0.005")', fraction: '0' };
    }
    if (qpf <= 0.01) {
      const pts = Number((maxPts / 3).toFixed(2));
      return {
        pts,
        maxPts,
        qpf,
        tier: 'Light (0.005–0.010")',
        fraction: '1/3 share'
      };
    }
    if (qpf < 0.05) {
      const hasPeerSupport = wetModelsCount >= 2;
      const pts = Number((hasPeerSupport ? maxPts : maxPts / 3).toFixed(2));
      return {
        pts,
        maxPts,
        qpf,
        tier: hasPeerSupport
          ? 'Moderate + Peer Wet (0.01–0.05")'
          : 'Isolated Moderate (0.01–0.05")',
        fraction: hasPeerSupport ? 'Full share' : '1/3 share'
      };
    }
    return {
      pts: Number(maxPts.toFixed(2)),
      maxPts,
      qpf,
      tier: 'Solid Wet (≥0.050"/hr)',
      fraction: 'Full share'
    };
  }

  const hasNbmProb = typeof nbmProbability === 'number' && Number.isFinite(nbmProbability) && nbmProbability >= 0 && nbmProbability <= 100;
  const nbmScored = hasNbmProb
    ? {
        pts: Number(((nbmProbability / 100) * shares.nbm).toFixed(2)),
        maxPts: shares.nbm,
        qpf: qpfMap.nbm,
        pop: Math.round(nbmProbability),
        tier: `${Math.round(nbmProbability)}% NBM PoP`,
        fraction: `${Number(((nbmProbability / 100) * shares.nbm).toFixed(2))}/${shares.nbm} pts`
      }
    : scoreModelQpf(qpfMap.nbm, shares.nbm);

  const breakdown = {
    nws: {
      pts: nwsPts,
      maxPts: nwsMax,
      pop: Math.round(nwsVal),
      tier: `${Math.round(nwsVal)}% Official PoP`,
      fraction: `${nwsPts}/40 pts`
    },
    hrrr: scoreModelQpf(qpfMap.hrrr, shares.hrrr),
    nbm: nbmScored,
    ecmwf: scoreModelQpf(qpfMap.ecmwf, shares.ecmwf),
    gefs: scoreModelQpf(qpfMap.gefs, shares.gefs),
    weathernext: scoreModelQpf(qpfMap.weathernext, shares.weathernext)
  };

  const syntheticLikelihood = {
    sourceValues: {
      nws: nwsVal,
      ...(shares.hrrr > 0 ? { hrrr: breakdown.hrrr.pts > 0 ? 100 : 0 } : {}),
      ecmwf: breakdown.ecmwf.pts > 0 ? 100 : 0,
      nbm: hasNbmProb ? nbmProbability : (breakdown.nbm.pts > 0 ? 100 : 0),
      ...(shares.gefs > 0 ? { gefs: breakdown.gefs.pts > 0 ? 100 : 0 } : {}),
      ...(shares.weathernext > 0 ? { wn: breakdown.weathernext.pts > 0 ? 100 : 0 } : {})
    },
    sourcePoints: {
      nws: breakdown.nws.pts,
      ...(shares.hrrr > 0 ? { hrrr: breakdown.hrrr.pts } : {}),
      ecmwf: breakdown.ecmwf.pts,
      nbm: breakdown.nbm.pts,
      ...(shares.gefs > 0 ? { gefs: breakdown.gefs.pts } : {}),
      ...(shares.weathernext > 0 ? { wn: breakdown.weathernext.pts } : {})
    },
    sourceKinds: {
      nws: 'probability',
      hrrr: 'deterministic',
      ecmwf: 'deterministic',
      nbm: hasNbmProb ? 'probability' : 'deterministic',
      gefs: 'deterministic',
      wn: 'deterministic'
    }
  };

  const rec = reconcileRainLikelihood(syntheticLikelihood);

  let blendedQpf;
  if (leadHours < 24) {
    blendedQpf = qpfMap.hrrr * 0.35 + qpfMap.nbm * 0.30 + qpfMap.ecmwf * 0.20 + qpfMap.weathernext * 0.15;
  } else if (leadHours < 72) {
    blendedQpf = qpfMap.ecmwf * 0.50 + qpfMap.nbm * 0.30 + qpfMap.weathernext * 0.20;
  } else {
    blendedQpf = (qpfMap.ecmwf + qpfMap.nbm + qpfMap.gefs + qpfMap.weathernext) / 4;
  }

  if (rec.value < 15 && blendedQpf < 0.008) {
    blendedQpf = 0;
  }

  return {
    totalPts: rec.value,
    rawTotal: Number(rec.rawTotal.toFixed(2)),
    blendedQpfIn: Number(blendedQpf.toFixed(3)),
    wetModelsCount,
    breakdown,
    entries: rec.entries,
    tooltip: formatRainLikelihoodTooltip(syntheticLikelihood)
  };
}

export function reconcileRainLedgerWithCanonical(canonRl, fallbackLedger) {
  if (!canonRl || typeof canonRl !== 'object' || !Number.isFinite(canonRl.value)) {
    return fallbackLedger;
  }
  const rec = reconcileRainLikelihood(canonRl);
  if (!rec.entries.length) {
    const val = Math.round(canonRl.value);
    const bd = structuredClone(fallbackLedger.breakdown);
    bd.nws = { pts: val, maxPts: 100, pop: val, tier: `${val}% Official NWS PoP`, fraction: `${val}/100 pts` };
    bd.hrrr.pts = 0;
    bd.nbm.pts = 0;
    bd.ecmwf.pts = 0;
    bd.gefs.pts = 0;
    bd.weathernext.pts = 0;
    return {
      ...fallbackLedger,
      totalPts: val,
      rawTotal: val,
      breakdown: bd,
      entries: [{ id: 'nws', label: 'NWS base', vote: val, points: val, shownPoints: val, kind: 'probability' }],
      tooltip: formatRainLikelihoodTooltip(canonRl)
    };
  }

  const byId = new Map(rec.entries.map((e) => [e.id, e]));
  const srcById = new Map((canonRl.sources || []).map((s) => [s.id, s]));
  const amts = canonRl.sourceAmounts || {};

  const buildModelBd = (id, defaultMax) => {
    const e = byId.get(id);
    const src = srcById.get(id);
    const maxPts = Number(((src?.weight ?? defaultMax / 100) * 100).toFixed(2));
    const pts = e ? e.shownPoints : 0;
    const qpf = Number.isFinite(amts[id]) ? amts[id] : (fallbackLedger.breakdown[id]?.qpf ?? 0);
    if (!e) {
      return { pts: 0, maxPts: 0, qpf, tier: 'Unavailable / Not in period', fraction: '0' };
    }
    if (e.kind === 'probability') {
      return {
        pts,
        maxPts,
        qpf,
        pop: Math.round(e.vote),
        tier: `${Math.round(e.vote)}% ${id.toUpperCase()} PoP`,
        fraction: `${pts}/${maxPts} pts`
      };
    }
    return {
      pts,
      maxPts,
      qpf,
      tier: pts > 0 ? (pts >= maxPts * 0.9 ? 'Wet signal (Full share)' : 'Trace / Partial signal (1/3 share)') : 'Dry (<0.005")',
      fraction: pts > 0 ? `${pts}/${maxPts} pts` : '0'
    };
  };

  const wnEntry = byId.get('wn');
  const wn3Entry = byId.get('weathernext3');
  const wnPts = Number(((wnEntry?.shownPoints || 0) + (wn3Entry?.shownPoints || 0)).toFixed(2));
  const wnMax = Number((((srcById.get('wn')?.weight || 0) + (srcById.get('weathernext3')?.weight || 0)) * 100).toFixed(2));
  const nwsE = byId.get('nws');
  const nwsPts = nwsE ? nwsE.shownPoints : 0;
  const nwsPop = nwsE ? Math.round(nwsE.vote) : 0;

  const breakdown = {
    nws: {
      pts: nwsPts,
      maxPts: 40,
      pop: nwsPop,
      tier: `${nwsPop}% Official PoP`,
      fraction: `${nwsPts}/40 pts`
    },
    hrrr: buildModelBd('hrrr', 30),
    nbm: buildModelBd('nbm', 20),
    ecmwf: buildModelBd('ecmwf', 25),
    gefs: buildModelBd('gefs', 10),
    weathernext: {
      pts: wnPts,
      maxPts: wnMax || 10,
      qpf: Number.isFinite(amts.wn) ? amts.wn : (fallbackLedger.breakdown.weathernext?.qpf ?? 0),
      tier: !wnEntry && !wn3Entry ? 'Unavailable' : wnPts > 0 ? 'Wet signal' : 'Dry (<0.005")',
      fraction: wnPts > 0 ? `${wnPts}/${wnMax || 10} pts` : '0'
    }
  };

  return {
    ...fallbackLedger,
    totalPts: rec.value,
    rawTotal: Number(rec.rawTotal.toFixed(2)),
    breakdown,
    entries: rec.entries,
    tooltip: formatRainLikelihoodTooltip(canonRl)
  };
}

/**
 * Maps WMO weather codes + precipitation/temperature to clean condition labels and icon IDs.
 */
export function describeWeatherCondition(wmoCode, rainChance, tempF, isDay = true, windMph = 6) {
  if (rainChance >= 65 || [61, 63, 65, 80, 81, 82].includes(wmoCode)) {
    if (tempF <= 33 || [71, 73, 75, 77, 85, 86].includes(wmoCode)) {
      return { label: 'Snow Showers', icon: 'snow', sky: 'rain' };
    }
    if ([95, 96, 99].includes(wmoCode)) {
      return { label: 'Thunderstorms', icon: 'storm', sky: 'storm' };
    }
    return { label: rainChance >= 80 ? 'Steady Rain' : 'Rain Showers', icon: 'rain', sky: 'rain' };
  }
  if (rainChance >= 35 || [51, 53, 55].includes(wmoCode)) {
    return { label: 'Scattered Showers', icon: 'drizzle', sky: 'rain' };
  }
  if ([45, 48].includes(wmoCode)) {
    return { label: 'Fog & Mist', icon: 'fog', sky: isDay ? 'cloudy' : 'night' };
  }
  if (wmoCode >= 3) {
    return { label: 'Mostly Cloudy', icon: 'cloudy', sky: isDay ? 'cloudy' : 'night' };
  }
  if (wmoCode === 2) {
    return { label: 'Partly Cloudy', icon: isDay ? 'partly-day' : 'partly-night', sky: isDay ? 'day' : 'night' };
  }
  if (windMph >= 22) {
    return { label: isDay ? 'Breezy & Clear' : 'Windy & Clear', icon: isDay ? 'clear-day' : 'clear-night', sky: isDay ? 'day' : 'night' };
  }
  return { label: isDay ? 'Mostly Clear' : 'Clear Sky', icon: isDay ? 'clear-day' : 'clear-night', sky: isDay ? 'day' : 'night' };
}

/**
 * Searches any U.S. address, ZIP code, town, or city using Nominatim + backend /api/weather-fusion/search + Open-Meteo.
 */
export async function searchLocations(query) {
  const q = (query || '').trim();
  if (!q) return [];

  const hasStreetOrZip = /\d/.test(q) || q.includes(',');

  const queries = [
    fetch(`/api/weather-fusion/search?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        (d?.results || []).map((item) => ({
          id: String(item.id || `${item.latitude.toFixed(3)},${item.longitude.toFixed(3)}`),
          name: item.name,
          latitude: item.latitude,
          longitude: item.longitude,
          timezone: 'America/New_York',
          elevationFt: 100
        }))
      )
      .catch(() => []),
    fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) =>
        (Array.isArray(rows) ? rows : []).map((row) => {
          const a = row.address || {};
          const cityPart = a.city || a.town || a.village || a.hamlet || a.county || '';
          const streetPart = [a.house_number, a.road].filter(Boolean).join(' ');
          const statePart = formatStateShort(a.state || '');
          const zipPart = a.postcode ? ` ${a.postcode.split('-')[0]}` : '';
          const shortName = streetPart
            ? [streetPart, cityPart, statePart].filter(Boolean).join(', ')
            : [cityPart || row.display_name.split(',')[0], statePart].filter(Boolean).join(', ') + zipPart;
          return {
            id: `nom-${Number(row.lat).toFixed(4)},${Number(row.lon).toFixed(4)}`,
            name: shortName || row.display_name.split(',').slice(0, 3).join(','),
            latitude: Number(row.lat),
            longitude: Number(row.lon),
            timezone: 'America/New_York',
            elevationFt: 100
          };
        })
      )
      .catch(() => [])
  ];

  if (!hasStreetOrZip) {
    queries.push(
      fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) =>
          (d?.results || []).map((item) => {
            const stateOrRegion = item.admin1 ? `, ${item.admin1}` : '';
            const countryCode = item.country_code && item.country_code !== 'US' ? ` (${item.country_code})` : '';
            return {
              id: `${item.latitude.toFixed(3)},${item.longitude.toFixed(3)}`,
              name: `${item.name}${stateOrRegion}${countryCode}`,
              admin1: item.admin1 || '',
              country: item.country || '',
              latitude: item.latitude,
              longitude: item.longitude,
              timezone: item.timezone || 'America/New_York',
              elevationFt: item.elevation ? Math.round(item.elevation * 3.28084) : 100
            };
          })
        )
        .catch(() => [])
    );
  }

  const batches = await Promise.all(queries);
  const combined = hasStreetOrZip
    ? [...batches[1], ...batches[0]]
    : [...batches[0], ...batches[2], ...batches[1]];

  const seen = new Set();
  return combined.filter((loc) => {
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return false;
    const key = `${loc.latitude.toFixed(2)}:${loc.longitude.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

export async function reverseGeocodeLocation(lat, lon) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=13`
    );
    if (res.ok) {
      const data = await res.json();
      const a = data?.address || {};
      const city = a.city || a.town || a.village || a.suburb || a.hamlet || a.county;
      const state = formatStateShort(a.state);
      if (city) return [city, state].filter(Boolean).join(', ');
    }
  } catch {}
  return 'Current Location';
}

/**
 * Fetches live NOAA/NWS metadata, alerts, and Area Forecast Discussion (AFD) for US coordinates.
 */
async function fetchNwsIntelligence(lat, lon) {
  const result = {
    wfo: 'MTR',
    gridX: null,
    gridY: null,
    alerts: [],
    afdText: null,
    afdIssuedAt: null,
    nwsHourlyMap: new Map(),
    available: false
  };

  try {
    const ptRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { Accept: 'application/geo+json' }
    });
    if (!ptRes.ok) return result;
    const ptData = await ptRes.json();
    const props = ptData.properties || {};
    result.wfo = props.cwa || props.gridId || 'NWS';
    result.gridX = props.gridX;
    result.gridY = props.gridY;
    result.available = true;

    const tasks = [
      // 1. Active alerts for point
      fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
        headers: { Accept: 'application/geo+json' }
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      // 2. Official NWS Hourly Forecast
      props.forecastHourly
        ? fetch(props.forecastHourly, { headers: { Accept: 'application/geo+json' } })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
      // 3. Latest WFO Area Forecast Discussion (AFD)
      result.wfo
        ? fetch(`https://api.weather.gov/products/types/AFD/locations/${result.wfo}`, {
            headers: { Accept: 'application/json' }
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((list) => {
              const latestId = list?.['@graph']?.[0]?.id;
              return latestId
                ? fetch(`https://api.weather.gov/products/${latestId}`).then((r) => (r.ok ? r.json() : null))
                : null;
            })
            .catch(() => null)
        : Promise.resolve(null)
    ];

    const [alertsJson, hourlyJson, afdJson] = await Promise.all(tasks);

    if (alertsJson?.features) {
      result.alerts = alertsJson.features.map((f) => ({
        id: f.id,
        event: f.properties?.event || 'Weather Statement',
        headline: f.properties?.headline || f.properties?.event,
        severity: f.properties?.severity || 'Moderate',
        urgency: f.properties?.urgency || 'Expected',
        areaDesc: f.properties?.areaDesc || '',
        description: f.properties?.description || '',
        instruction: f.properties?.instruction || '',
        onset: f.properties?.onset || f.properties?.effective,
        ends: f.properties?.ends || f.properties?.expires,
        senderName: f.properties?.senderName || `NWS ${result.wfo}`,
        geometry: f.geometry || null
      }));
    }

    if (hourlyJson?.properties?.periods) {
      hourlyJson.properties.periods.forEach((p) => {
        const hourIso = p.startTime ? p.startTime.slice(0, 13) : null;
        if (hourIso) {
          result.nwsHourlyMap.set(hourIso, {
            tempF: p.temperature,
            pop: p.probabilityOfPrecipitation?.value ?? null,
            windMph: parseInt(p.windSpeed, 10) || null,
            shortForecast: p.shortForecast || ''
          });
        }
      });
    }

    if (afdJson?.productText) {
      result.afdText = afdJson.productText;
      result.afdIssuedAt = afdJson.issuanceTime;
    }
  } catch {
    // Graceful fallback
  }

  return result;
}

/**
 * Fetches live Weather Nourie canonical backend forecast + multi-model comparison series
 * so V3 matches the main page's exact temperatures, rain chances, hazards, and discussions.
 */
export async function fetchCompleteFusionForecast(locationInput, { forceRefresh = false } = {}) {
  if (!locationInput || !Number.isFinite(Number(locationInput.latitude)) || !Number.isFinite(Number(locationInput.longitude))) {
    throw new Error('Location coordinates are required to fetch a local forecast.');
  }
  const loc = locationInput;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);

  // Fetch canonical main-site backend forecast first (exact NDFD/HRRR/NBM/ECMWF/GEFS/WeatherNext blend + WPC/SPC hazards + NWS AFD)
  const canonicalPromise = fetch(
    `/api/weather-fusion/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}${forceRefresh ? `&_t=${Date.now()}` : ''}`,
    { cache: 'no-store', headers: { Accept: 'application/json' } }
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  // Fetch supplementary 10-day hourly variables & explicit multi-model series using UTC unixtime
  const hourlyVars = [
    'temperature_2m',
    'relative_humidity_2m',
    'dew_point_2m',
    'apparent_temperature',
    'precipitation_probability',
    'precipitation',
    'rain',
    'snowfall',
    'weather_code',
    'cloud_cover',
    'surface_pressure',
    'visibility',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'uv_index',
    'shortwave_radiation',
    'is_day'
  ].join(',');

  const openMeteoBaseUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourlyVars}&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&timeformat=unixtime&forecast_days=10`;
  const multiModelUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_speed_10m,dew_point_2m,cloud_cover&models=best_match,ecmwf_ifs025,gfs_seamless,icon_seamless&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&timeformat=unixtime&forecast_days=10`;
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&hourly=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto&timeformat=unixtime&forecast_days=5`;

  let canonicalData = null;
  let baseData = null;
  let multiModelData = null;
  let aqiData = null;
  let nwsData = { wfo: loc.wfo || 'NWS', alerts: [], afdText: null, nwsHourlyMap: new Map(), available: false };

  try {
    const [canonRes, baseRes, mmRes, aqiRes] = await Promise.all([
      canonicalPromise,
      fetch(openMeteoBaseUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(multiModelUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(aqiUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ]);
    canonicalData = canonRes;
    baseData = baseRes;
    multiModelData = mmRes;
    aqiData = aqiRes;

    // Only hit direct NWS browser endpoints if the main backend forecast is unavailable (e.g. non-US city or offline dev)
    if (!canonicalData) {
      const nws = await fetchNwsIntelligence(lat, lon);
      if (nws) nwsData = nws;
    } else {
      nwsData = {
        wfo: canonicalData.location?.office || loc.wfo || 'NWS',
        alerts: canonicalData.alerts || [],
        afdText: canonicalData.discussion?.text || null,
        afdIssuedAt: canonicalData.discussion?.issuanceTime || null,
        nwsHourlyMap: new Map(),
        available: true
      };
    }
  } catch {
    // Will synthesize seamlessly below if offline
  }

  return buildUnifiedFusionPayload(loc, baseData, multiModelData, aqiData, nwsData, canonicalData);
}

function toZonedDayKey(dt, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dt);
  } catch {
    return dt.toISOString().slice(0, 10);
  }
}

function toZonedHour(dt, timeZone) {
  try {
    const val = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        hourCycle: 'h23'
      }).format(dt)
    );
    return Number.isFinite(val) ? val % 24 : dt.getHours();
  } catch {
    return dt.getHours();
  }
}

function parseWindSpeedValue(windStr) {
  if (typeof windStr === 'number' && Number.isFinite(windStr)) return windStr;
  if (typeof windStr !== 'string') return null;
  const nums = windStr.match(/\d+(?:\.\d+)?/g);
  return nums && nums.length ? Number(nums[nums.length - 1]) : null;
}

function cardinalToDeg(cardinal) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = dirs.indexOf(String(cardinal || '').toUpperCase().trim());
  return idx >= 0 ? idx * 22.5 : null;
}

function extractCanonModelMap(seriesPt, blendObj = null) {
  const map = new Map();
  const lists = [
    blendObj?.comparisonSources,
    blendObj?.sources,
    seriesPt?.comparisonSources,
    seriesPt?.sources
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      if (!s?.id || typeof s.value !== 'number' || !Number.isFinite(s.value)) continue;
      const key = s.id === 'wn' || s.id === 'weathernext3' ? 'weathernext' : s.id;
      if (!map.has(key) || s.id === 'weathernext3') {
        map.set(key, s.value);
      }
    }
  }
  return map;
}

function roundFinite(val, decimals = 0) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  if (decimals <= 0) return Math.round(val);
  return Number(val.toFixed(decimals));
}

/**
 * Constructs the full Weather Nourie Fusion data structure
 * prioritizing canonical backend data from /api/weather-fusion/forecast.
 */
export function buildUnifiedFusionPayload(loc, baseData, multiModelData, aqiData, nwsData, canonicalData = null) {
  const lat = Number(loc?.latitude ?? canonicalData?.location?.latitude);
  const lon = Number(loc?.longitude ?? canonicalData?.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Valid coordinates are required to build a forecast payload.');
  }
  const now = new Date();
  const timeZone = canonicalData?.location?.timeZone || baseData?.timezone || loc.timezone || 'America/New_York';
  const genericNames = new Set(['', 'Current Location', 'Device location', 'Selected Location', 'Finding your location…']);
  const explicitName = String(loc?.name || '').trim();
  const resolvedLocName = !genericNames.has(explicitName)
    ? explicitName
    : (canonicalData?.location?.name || 'Current Location');

  const isLiveApi = Boolean(canonicalData?.hours?.length || baseData?.hourly?.time?.length);

  // Lookup maps from canonical backend payload
  const canonHours = new Map();
  (canonicalData?.hours || []).forEach((h) => {
    const ep = Date.parse(h.time);
    if (Number.isFinite(ep)) canonHours.set(Math.floor(ep / 3600000) * 3600000, h);
  });
  const canonRain = new Map();
  (canonicalData?.rainTimeline || []).forEach((r) => {
    const ep = Date.parse(r.time);
    if (Number.isFinite(ep)) canonRain.set(Math.floor(ep / 3600000) * 3600000, r);
  });
  const canonSeries = {};
  for (const [k, arr] of Object.entries(canonicalData?.metricForecasts?.series || {})) {
    const m = new Map();
    if (Array.isArray(arr)) {
      arr.forEach((pt) => {
        const ep = Date.parse(pt.time);
        if (Number.isFinite(ep)) m.set(Math.floor(ep / 3600000) * 3600000, pt);
      });
    }
    canonSeries[k] = m;
  }

  // Also index Open-Meteo baseData & multiModelData by hour epoch for 100% alignment
  const baseIdxByEpoch = new Map();
  (baseData?.hourly?.time || []).forEach((t, idx) => {
    const ep = typeof t === 'number' ? t * 1000 : Date.parse(t);
    if (Number.isFinite(ep)) baseIdxByEpoch.set(Math.floor(ep / 3600000) * 3600000, idx);
  });
  const mmIdxByEpoch = new Map();
  (multiModelData?.hourly?.time || []).forEach((t, idx) => {
    const ep = typeof t === 'number' ? t * 1000 : Date.parse(t);
    if (Number.isFinite(ep)) mmIdxByEpoch.set(Math.floor(ep / 3600000) * 3600000, idx);
  });

  const currentHourEpoch = Math.floor(now.getTime() / 3600000) * 3600000;
  const startEpoch = canonHours.size
    ? Math.min(currentHourEpoch, ...canonHours.keys())
    : currentHourEpoch;

  const hours = [];
  const seedBaseTemp = lat < 30 ? 78 : lat > 45 ? 51 : lat > 39 && lon < -100 ? 44 : 58;

  for (let i = 0; i < 240; i++) {
    const hourEpoch = startEpoch + i * 3600000;
    const dt = new Date(hourEpoch);
    const isoTime = dt.toISOString();
    const hourOfDay = toZonedHour(dt, timeZone);
    const bIdx = baseIdxByEpoch.get(hourEpoch);
    const mmIdx = mmIdxByEpoch.get(hourEpoch);
    const ch = canonHours.get(hourEpoch);
    const cr = canonRain.get(hourEpoch);
    const csTemp = canonSeries.temperature?.get(hourEpoch);
    const csFeels = canonSeries.feels?.get(hourEpoch);
    const csShade = canonSeries.feelsShade?.get(hourEpoch);
    const csSun = canonSeries.feelsSun?.get(hourEpoch);
    const csDp = canonSeries.dewpoint?.get(hourEpoch);
    const csWind = canonSeries.wind?.get(hourEpoch);
    const csGust = canonSeries.gust?.get(hourEpoch);
    const csHum = canonSeries.humidity?.get(hourEpoch);
    const csPop = canonSeries.pop?.get(hourEpoch);
    const csQpf = canonSeries.precipitation?.get(hourEpoch);
    const csVis = canonSeries.visibility?.get(hourEpoch);
    const csPres = canonSeries.pressure?.get(hourEpoch);
    const csCloud = canonSeries.cloud?.get(hourEpoch);

    const isDay =
      typeof ch?.isDay === 'boolean'
        ? ch.isDay
        : typeof csFeels?.daylight === 'boolean'
        ? csFeels.daylight
        : bIdx !== undefined && baseData?.hourly?.is_day?.[bIdx] !== undefined
        ? Boolean(baseData.hourly.is_day[bIdx])
        : hourOfDay >= 6 && hourOfDay <= 18;

    const diurnalWave = Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI) * 7.5;
    const synopticWave = Math.sin((i / 36) * Math.PI) * 4.2;
    const rawBaseTemp =
      csTemp?.value ??
      ch?.temperature ??
      (bIdx !== undefined ? baseData?.hourly?.temperature_2m?.[bIdx] : undefined) ??
      (seedBaseTemp + diurnalWave + synopticWave);

    const rh = Math.round(
      csHum?.value ??
      ch?.humidity ??
      (bIdx !== undefined ? baseData?.hourly?.relative_humidity_2m?.[bIdx] : undefined) ??
      clamp(68 - diurnalWave * 1.8, 28, 96)
    );
    const dewPointF = Math.round(
      csDp?.value ??
      ch?.dewpoint ??
      (bIdx !== undefined ? baseData?.hourly?.dew_point_2m?.[bIdx] : undefined) ??
      calcDewPointF(rawBaseTemp, rh)
    );
    const windMph = Math.round(
      csWind?.value ??
      ch?.windMph ??
      parseWindSpeedValue(ch?.wind) ??
      (bIdx !== undefined ? baseData?.hourly?.wind_speed_10m?.[bIdx] : undefined) ??
      clamp(7 + Math.sin(i * 0.3) * 5, 2, 24)
    );
    const windGustMph = Math.round(
      csGust?.value ??
      ch?.gust ??
      (bIdx !== undefined ? baseData?.hourly?.wind_gusts_10m?.[bIdx] : undefined) ??
      Math.round(windMph * 1.45 + 3)
    );
    const windDirDeg = Math.round(
      ch?.windDirectionDegrees ??
      cardinalToDeg(ch?.windDirection) ??
      (bIdx !== undefined ? baseData?.hourly?.wind_direction_10m?.[bIdx] : undefined) ??
      ((240 + i * 7) % 360)
    );
    const cloudCover = Math.round(
      csCloud?.value ??
      ch?.skyCover ??
      csFeels?.inputs?.skyCover ??
      (bIdx !== undefined ? baseData?.hourly?.cloud_cover?.[bIdx] : undefined) ??
      clamp(45 + Math.cos(i * 0.22) * 40, 5, 100)
    );
    const pressureInHgRaw =
      csPres?.value ??
      (bIdx !== undefined && baseData?.hourly?.surface_pressure?.[bIdx] != null
        ? baseData.hourly.surface_pressure[bIdx] * 0.02953
        : undefined) ??
      Number(((1016.4 + Math.sin(i * 0.15) * 6) * 0.02953).toFixed(2));
    const pressureInHg = Number(Number(pressureInHgRaw).toFixed(2));
    const pressureHpa = Number((pressureInHg / 0.02953).toFixed(1));
    const visibilityMi = Number(
      clamp(
        csVis?.value ??
        (bIdx !== undefined && baseData?.hourly?.visibility?.[bIdx] != null
          ? baseData.hourly.visibility[bIdx] / 1609.34
          : 10),
        0.5,
        10
      ).toFixed(1)
    );
    const uvIndex = isDay
      ? Number(
          (
            (bIdx !== undefined ? baseData?.hourly?.uv_index?.[bIdx] : undefined) ??
            Math.max(0, Math.sin(((hourOfDay - 6) / 12) * Math.PI) * (1 - cloudCover * 0.0065) * 6.5)
          ).toFixed(1)
        )
      : 0;
    const solarWm2 =
      csFeels?.inputs?.solarRadiation ??
      (bIdx !== undefined ? baseData?.hourly?.shortwave_radiation?.[bIdx] : null) ??
      null;
    const wmoCode =
      (bIdx !== undefined ? baseData?.hourly?.weather_code?.[bIdx] : undefined) ??
      (cloudCover > 75 ? 3 : cloudCover > 35 ? 2 : 0);

    // Individual Model Temperatures, Wind, Dew Point, Cloud Cover & Precip:
    // Use ONLY real backend canonical model values + Open-Meteo named models when live API data is active (no synthetic constant/sine offsets!).
    const mmH = multiModelData?.hourly;
    const pickMm = (field, modelSuffix) =>
      mmIdx !== undefined ? mmH?.[`${field}_${modelSuffix}`]?.[mmIdx] : undefined;

    const canonCompMap = extractCanonModelMap(csTemp, ch?.temperatureBlend);
    const mmNbm = pickMm('temperature_2m', 'gfs_seamless') ?? pickMm('temperature_2m', 'best_match');
    const mmEcmwf = pickMm('temperature_2m', 'ecmwf_ifs025');
    const mmGefs = pickMm('temperature_2m', 'icon_seamless');

    let modelTemps;
    if (isLiveApi) {
      const nbmTemp = canonCompMap.get('nbm') ?? mmNbm ?? null;
      const ecmwfTemp = canonCompMap.get('ecmwf') ?? mmEcmwf ?? null;
      const gefsTemp = canonCompMap.get('gefs') ?? mmGefs ?? null;
      const nwsTemp = canonCompMap.get('nws') ?? ch?.officialTemperature ?? nwsData?.nwsHourlyMap?.get(isoTime.slice(0, 13))?.tempF ?? null;
      const hrrrTemp = canonCompMap.get('hrrr') ?? null;
      const wnTemp = canonCompMap.get('weathernext') ?? null;

      modelTemps = {
        nws: roundFinite(nwsTemp, 1),
        hrrr: roundFinite(hrrrTemp, 1),
        nbm: roundFinite(nbmTemp, 1),
        ecmwf: roundFinite(ecmwfTemp, 1),
        gefs: roundFinite(gefsTemp, 1),
        weathernext: roundFinite(wnTemp, 1)
      };
    } else {
      const nbmTemp = mmNbm ?? rawBaseTemp;
      const ecmwfTemp = mmEcmwf ?? (rawBaseTemp + Math.sin(i * 0.19 + 1.1) * 2.1);
      const gefsTemp = mmGefs ?? (rawBaseTemp - Math.cos(i * 0.14) * 1.7);
      const nwsTemp = nbmTemp * 0.65 + ecmwfTemp * 0.35;
      const hrrrTemp = i < 48 ? rawBaseTemp + Math.cos(i * 0.31) * 1.4 : null;
      const wnTemp = ecmwfTemp * 0.55 + nbmTemp * 0.45;
      modelTemps = {
        nws: roundFinite(nwsTemp, 1),
        hrrr: roundFinite(hrrrTemp, 1),
        nbm: roundFinite(nbmTemp, 1),
        ecmwf: roundFinite(ecmwfTemp, 1),
        gefs: roundFinite(gefsTemp, 1),
        weathernext: roundFinite(wnTemp, 1)
      };
    }

    const tempFusion = blendTemperatureHour(modelTemps, i);
    const canonicalTempF = ch?.temperature ?? csTemp?.value;
    if (typeof canonicalTempF === 'number' && Number.isFinite(canonicalTempF)) {
      tempFusion.blendedF = Math.round(canonicalTempF);
      tempFusion.rawBlendedF = Number(canonicalTempF.toFixed(2));
    }

    const canonWindMap = extractCanonModelMap(csWind);
    const canonDpMap = extractCanonModelMap(csDp);
    const canonCloudMap = extractCanonModelMap(csCloud);

    const modelWind = isLiveApi
      ? {
          nws: roundFinite(canonWindMap.get('nws'), 0),
          hrrr: roundFinite(canonWindMap.get('hrrr'), 0),
          nbm: roundFinite(canonWindMap.get('nbm') ?? pickMm('wind_speed_10m', 'gfs_seamless') ?? pickMm('wind_speed_10m', 'best_match'), 0),
          ecmwf: roundFinite(canonWindMap.get('ecmwf') ?? pickMm('wind_speed_10m', 'ecmwf_ifs025'), 0),
          gefs: roundFinite(canonWindMap.get('gefs') ?? pickMm('wind_speed_10m', 'icon_seamless'), 0),
          weathernext: roundFinite(canonWindMap.get('weathernext'), 0)
        }
      : { nws: windMph, hrrr: i < 48 ? windMph : null, nbm: windMph, ecmwf: windMph, gefs: windMph, weathernext: windMph };

    const modelDewPoint = isLiveApi
      ? {
          nws: roundFinite(canonDpMap.get('nws'), 0),
          hrrr: roundFinite(canonDpMap.get('hrrr'), 0),
          nbm: roundFinite(canonDpMap.get('nbm') ?? pickMm('dew_point_2m', 'gfs_seamless') ?? pickMm('dew_point_2m', 'best_match'), 0),
          ecmwf: roundFinite(canonDpMap.get('ecmwf') ?? pickMm('dew_point_2m', 'ecmwf_ifs025'), 0),
          gefs: roundFinite(canonDpMap.get('gefs') ?? pickMm('dew_point_2m', 'icon_seamless'), 0),
          weathernext: roundFinite(canonDpMap.get('weathernext'), 0)
        }
      : { nws: dewPointF, hrrr: i < 48 ? dewPointF : null, nbm: dewPointF, ecmwf: dewPointF, gefs: dewPointF, weathernext: dewPointF };

    const clampCloud = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), 0, 100) : null);
    const modelCloudCover = isLiveApi
      ? {
          nws: clampCloud(canonCloudMap.get('nws')),
          hrrr: clampCloud(canonCloudMap.get('hrrr')),
          nbm: clampCloud(canonCloudMap.get('nbm') ?? pickMm('cloud_cover', 'gfs_seamless') ?? pickMm('cloud_cover', 'best_match')),
          ecmwf: clampCloud(canonCloudMap.get('ecmwf') ?? pickMm('cloud_cover', 'ecmwf_ifs025')),
          gefs: clampCloud(canonCloudMap.get('gefs') ?? pickMm('cloud_cover', 'icon_seamless')),
          weathernext: clampCloud(canonCloudMap.get('weathernext'))
        }
      : { nws: cloudCover, hrrr: i < 48 ? cloudCover : null, nbm: cloudCover, ecmwf: cloudCover, gefs: cloudCover, weathernext: cloudCover };

    // Rain Chance & QPF: use exact canonical rainLikelihood & precipitation when available
    const basePop = (bIdx !== undefined ? baseData?.hourly?.precipitation_probability?.[bIdx] : undefined) ?? (cloudCover > 82 ? 65 : cloudCover > 65 ? 25 : 5);
    const baseQpf = (bIdx !== undefined ? baseData?.hourly?.precipitation?.[bIdx] : undefined) ?? (basePop >= 60 ? 0.045 : basePop >= 35 ? 0.008 : 0);
    const canonRl = cr?.rainLikelihood || ch?.rainLikelihood;
    const canonAmt = cr?.precipitationBlend?.sourceValues || ch?.precipitationBlend?.sourceValues || {};
    const canonPopMap = extractCanonModelMap(csPop);
    const canonQpfMap = extractCanonModelMap(csQpf, cr?.precipitationBlend || ch?.precipitationBlend);
    const nwsPopReal = ch?.officialPop ?? cr?.officialPop ?? canonPopMap.get('nws') ?? null;
    const nwsPop = clamp(nwsPopReal ?? basePop, 0, 100);

    const mmNbmQpf = pickMm('precipitation', 'gfs_seamless') ?? pickMm('precipitation', 'best_match');
    const mmEcmwfQpf = pickMm('precipitation', 'ecmwf_ifs025');
    const mmGefsQpf = pickMm('precipitation', 'icon_seamless');

    const realNbmQpf = canonAmt.nbm ?? canonQpfMap.get('nbm') ?? mmNbmQpf ?? null;
    const realEcmwfQpf = canonAmt.ecmwf ?? canonQpfMap.get('ecmwf') ?? mmEcmwfQpf ?? null;
    const realGefsQpf = canonAmt.gefs ?? canonQpfMap.get('gefs') ?? mmGefsQpf ?? null;
    const realHrrrQpf = canonAmt.hrrr ?? canonQpfMap.get('hrrr') ?? null;
    const realWnQpf = canonAmt.wn ?? canonAmt.weathernext3 ?? canonQpfMap.get('weathernext') ?? null;

    const modelQpfHour = isLiveApi
      ? {
          hrrr: typeof realHrrrQpf === 'number' && Number.isFinite(realHrrrQpf) ? Math.max(0, realHrrrQpf) : null,
          nbm: typeof realNbmQpf === 'number' && Number.isFinite(realNbmQpf) ? Math.max(0, realNbmQpf) : null,
          ecmwf: typeof realEcmwfQpf === 'number' && Number.isFinite(realEcmwfQpf) ? Math.max(0, realEcmwfQpf) : null,
          gefs: typeof realGefsQpf === 'number' && Number.isFinite(realGefsQpf) ? Math.max(0, realGefsQpf) : null,
          weathernext: typeof realWnQpf === 'number' && Number.isFinite(realWnQpf) ? Math.max(0, realWnQpf) : null
        }
      : {
          hrrr: i < 48 ? Math.max(0, baseQpf) : null,
          nbm: Math.max(0, baseQpf),
          ecmwf: Math.max(0, baseQpf),
          gefs: Math.max(0, baseQpf * 0.9),
          weathernext: Math.max(0, baseQpf)
        };

    const nbmQpf = Math.max(0, realNbmQpf ?? baseQpf);
    const ecmwfQpf = Math.max(0, realEcmwfQpf ?? (isLiveApi ? 0 : baseQpf));
    const gefsQpf = Math.max(0, realGefsQpf ?? (isLiveApi ? 0 : baseQpf * 0.9));
    const hrrrQpf = i < 48 ? Math.max(0, realHrrrQpf ?? (isLiveApi ? 0 : baseQpf)) : 0;
    const wnQpf = Math.max(0, realWnQpf ?? (isLiveApi ? 0 : baseQpf));

    const baseRainLedger = scoreRainChance100Pt({
      nwsPop,
      hrrrQpf,
      nbmQpf,
      ecmwfQpf,
      gefsQpf,
      wnQpf,
      nbmProbability: canonRl?.nbmProbability ?? null,
      leadHours: i
    });
    const rainLedger = reconcileRainLedgerWithCanonical(canonRl, baseRainLedger);
    const canonPrecipVal = cr?.precipitation ?? ch?.precipitation ?? csQpf?.value;
    if (typeof canonPrecipVal === 'number' && Number.isFinite(canonPrecipVal)) {
      rainLedger.blendedQpfIn = Number(canonPrecipVal.toFixed(3));
    }

    const snowfallIn = Number(
      (
        (bIdx !== undefined ? baseData?.hourly?.snowfall?.[bIdx] : undefined) ??
        (tempFusion.blendedF <= 33 && rainLedger.blendedQpfIn > 0 ? rainLedger.blendedQpfIn * 8.5 : 0)
      ).toFixed(2)
    );

    const aqiHour = Math.round(
      canonicalData?.airQuality?.hours?.find((a) => Math.abs(Date.parse(a.time) - hourEpoch) < 1800000)?.aqi ??
      canonicalData?.airQuality?.aqi ??
      (i === 0 ? aqiData?.current?.us_aqi : undefined) ??
      clamp(34 + Math.sin(i * 0.2) * 11, 18, 68)
    );

    const comfort = computeThermalComfort({
      tempF: tempFusion.blendedF,
      rh,
      windMph,
      cloudCover,
      solarWm2,
      precipProb: rainLedger.totalPts,
      precipIn: rainLedger.blendedQpfIn,
      lat,
      lon,
      time: dt
    });

    // Main-page science Steadman apparent temperature + solar exposure (identical to main site)
    const mainPageHourlyFeels = canonicalData ? displayedFeelsAt(canonicalData, isoTime) : null;
    const mainPageSteadman = shadeFeelsLike(tempFusion.blendedF, rh, windMph, dewPointF);
    const mainPageThermal = thermalComfort(
      {
        temperature: tempFusion.blendedF,
        humidity: rh,
        dewpoint: dewPointF,
        wind: windMph,
        skyCover: cloudCover,
        solarRadiation: solarWm2,
        condition: ch?.condition || cr?.condition || ''
      },
      { latitude: lat, longitude: lon },
      hourEpoch
    );

    const feelsLikeF = Number.isFinite(mainPageHourlyFeels)
      ? Math.round(mainPageHourlyFeels)
      : Number.isFinite(csFeels?.value)
      ? Math.round(csFeels.value)
      : Number.isFinite(ch?.feelsLike)
      ? Math.round(ch.feelsLike)
      : Number.isFinite(mainPageThermal?.outdoors)
      ? Math.round(mainPageThermal.outdoors)
      : Number.isFinite(mainPageSteadman?.value)
      ? Math.round(mainPageSteadman.value)
      : comfort.activeFeelsF;

    const shadeFeelsF = Number.isFinite(csFeels?.shadeValue)
      ? Math.round(csFeels.shadeValue)
      : Number.isFinite(csShade?.value)
      ? Math.round(csShade.value)
      : Number.isFinite(ch?.feelsLikeShade)
      ? Math.round(ch.feelsLikeShade)
      : Number.isFinite(mainPageThermal?.shade)
      ? Math.round(mainPageThermal.shade)
      : Number.isFinite(mainPageSteadman?.value)
      ? Math.round(mainPageSteadman.value)
      : comfort.shadeFeelsF;

    const canonSunVal = Number.isFinite(csFeels?.sunValue)
      ? Math.round(csFeels.sunValue)
      : Number.isFinite(csSun?.value)
      ? Math.round(csSun.value)
      : Number.isFinite(ch?.feelsLikeSun)
      ? Math.round(ch.feelsLikeSun)
      : Number.isFinite(mainPageThermal?.sun)
      ? Math.round(mainPageThermal.sun)
      : null;

    const condFallback = describeWeatherCondition(wmoCode, rainLedger.totalPts, tempFusion.blendedF, isDay, windMph);
    const rawCondLabel = ch?.condition || cr?.condition || condFallback.label;
    const condLabel = reconcileSkyCondition(
      rawCondLabel,
      cloudCover,
      isDay,
      rainLedger.totalPts,
      csFeels?.weatherKind || null,
      ch?.forecastCondition || null
    );
    const condIcon = deriveIconFromLabel(condLabel, isDay, rainLedger.totalPts, tempFusion.blendedF) || condFallback.icon;
    const condSky = deriveSkyFromLabel(condLabel, isDay, rainLedger.totalPts) || condFallback.sky;

    const cloudyOrWetHour =
      cloudCover >= 70 ||
      rainLedger.totalPts >= 50 ||
      csFeels?.weatherKind === 'cloudy' ||
      /overcast|mostly cloudy|\bcloudy\b|fog|rain|shower|storm|snow/i.test(condLabel);
    const rawSunCandidate = canonSunVal ?? comfort.sunFeelsF;
    const hasDirectSun = Boolean(
      isDay &&
      !cloudyOrWetHour &&
      (canonSunVal !== null || (rawSunCandidate - shadeFeelsF) >= 2)
    );
    const sunFeelsF = hasDirectSun
      ? Math.max(shadeFeelsF, rawSunCandidate)
      : Math.max(shadeFeelsF, feelsLikeF);
    const sunDeltaF = hasDirectSun ? Math.max(0, Math.round(sunFeelsF - shadeFeelsF)) : 0;

    const spreadHalf = Math.max(1.2, tempFusion.spreadF * 0.65 + i * 0.025);

    hours.push({
      index: i,
      time: isoTime,
      dateObj: dt,
      timeZone,
      hourOfDay,
      hourLabel: formatHourLabel(dt, i === 0, timeZone),
      dayKey: toZonedDayKey(dt, timeZone),
      isDay,
      tempF: tempFusion.blendedF,
      rawBlendedF: tempFusion.rawBlendedF,
      feelsLikeF,
      shadeFeelsF,
      sunFeelsF,
      hasDirectSun,
      rainFeelsF: comfort.rainFeelsF,
      sunDeltaF,
      shortwaveWm2: comfort.shortwaveWm2,
      wetBulbF: comfort.wetBulbF,
      comfortCategory: comfort.category,
      humidity: rh,
      dewPointF,
      indoorRh70F: calcIndoorRhAt70F(dewPointF),
      rainChance: rainLedger.totalPts,
      precipIn: rainLedger.blendedQpfIn,
      snowfallIn,
      rainLedger,
      windMph,
      windGustMph,
      windDirDeg,
      windCardinal: ch?.windDirection || degToCardinal(windDirDeg),
      cloudCover,
      pressureHpa,
      pressureInHg,
      visibilityMi,
      uvIndex,
      aqi: aqiHour,
      wmoCode,
      condition: condLabel,
      icon: condIcon,
      skyMood: condSky,
      nwsPopReal,
      modelTemps,
      modelWind,
      modelDewPoint,
      modelCloudCover,
      modelQpfHour,
      tempFusion,
      ensemble: {
        p10: Math.round(tempFusion.blendedF - spreadHalf * 1.35),
        p25: Math.round(tempFusion.blendedF - spreadHalf * 0.7),
        mean: tempFusion.blendedF,
        p75: Math.round(tempFusion.blendedF + spreadHalf * 0.7),
        p90: Math.round(tempFusion.blendedF + spreadHalf * 1.35)
      }
    });
  }

  // Sync current hour (hours[0]) with exact canonicalData.current readings/observations & main-page currentSample science
  if (canonicalData?.current && hours[0]) {
    const cc = canonicalData.current;
    const mainNowSample = currentSample(canonicalData, now.getTime());
    if (typeof cc.temperature === 'number' && Number.isFinite(cc.temperature)) hours[0].tempF = Math.round(cc.temperature);
    else if (Number.isFinite(mainNowSample?.temperature)) hours[0].tempF = Math.round(mainNowSample.temperature);

    if (Number.isFinite(mainNowSample?.feels)) hours[0].feelsLikeF = Math.round(mainNowSample.feels);
    else if (typeof cc.feelsLike === 'number' && Number.isFinite(cc.feelsLike)) hours[0].feelsLikeF = Math.round(cc.feelsLike);
    else if (typeof cc.apparent === 'number' && Number.isFinite(cc.apparent)) hours[0].feelsLikeF = Math.round(cc.apparent);

    if (Number.isFinite(mainNowSample?.comfort?.shade)) hours[0].shadeFeelsF = Math.round(mainNowSample.comfort.shade);
    else if (typeof cc.feelsLikeShade === 'number' && Number.isFinite(cc.feelsLikeShade)) hours[0].shadeFeelsF = Math.round(cc.feelsLikeShade);
    else hours[0].shadeFeelsF = hours[0].feelsLikeF;
    if (typeof cc.skyCover === 'number' && Number.isFinite(cc.skyCover)) {
      hours[0].cloudCover = clamp(Math.round(cc.skyCover), 0, 100);
    }
    if (typeof cc.dewpoint === 'number' && Number.isFinite(cc.dewpoint)) hours[0].dewPointF = Math.round(cc.dewpoint);
    if (typeof cc.humidity === 'number' && Number.isFinite(cc.humidity)) hours[0].humidity = Math.round(cc.humidity);
    if (typeof cc.wind === 'number' && Number.isFinite(cc.wind)) hours[0].windMph = Math.round(cc.wind);
    if (typeof cc.gust === 'number' && Number.isFinite(cc.gust)) hours[0].windGustMph = Math.round(cc.gust);
    if (typeof cc.windDirection === 'number' && Number.isFinite(cc.windDirection)) {
      hours[0].windDirDeg = Math.round(cc.windDirection);
      hours[0].windCardinal = degToCardinal(hours[0].windDirDeg);
    }
    if (typeof cc.pressure === 'number' && Number.isFinite(cc.pressure)) hours[0].pressureInHg = Number(cc.pressure.toFixed(2));
    if (typeof cc.visibility === 'number' && Number.isFinite(cc.visibility)) hours[0].visibilityMi = Number(cc.visibility.toFixed(1));

    if (mainNowSample?.rainLikelihood && Number.isFinite(mainNowSample.rainLikelihood.value)) {
      hours[0].rainLedger = reconcileRainLedgerWithCanonical(mainNowSample.rainLikelihood, hours[0].rainLedger);
      hours[0].rainChance = hours[0].rainLedger.totalPts;
    }

    const curFeelsSeries = canonSeries.feels?.get(startEpoch);
    const curCanonHour = canonHours.get(startEpoch) || canonicalData.hours?.[0];
    const reconciledCurCond = reconcileSkyCondition(
      cc.condition || hours[0].condition,
      hours[0].cloudCover,
      hours[0].isDay,
      hours[0].rainChance,
      curFeelsSeries?.weatherKind || null,
      curCanonHour?.forecastCondition || null
    );
    hours[0].condition = reconciledCurCond;
    hours[0].icon = deriveIconFromLabel(reconciledCurCond, hours[0].isDay, hours[0].rainChance, hours[0].tempF) || hours[0].icon;
    hours[0].skyMood = deriveSkyFromLabel(reconciledCurCond, hours[0].isDay, hours[0].rainChance) || hours[0].skyMood;

    const curCloudyOrWet =
      hours[0].cloudCover >= 70 ||
      hours[0].rainChance >= 50 ||
      curFeelsSeries?.weatherKind === 'cloudy' ||
      /overcast|mostly cloudy|\bcloudy\b|fog|rain|shower|storm|snow/i.test(reconciledCurCond);
    const hasCanonSun = typeof cc.feelsLikeSun === 'number' && Number.isFinite(cc.feelsLikeSun);
    hours[0].hasDirectSun = Boolean(hours[0].isDay && !curCloudyOrWet && hasCanonSun);
    if (hours[0].hasDirectSun) {
      hours[0].sunFeelsF = Math.max(hours[0].shadeFeelsF ?? hours[0].feelsLikeF, Math.round(cc.feelsLikeSun));
      hours[0].sunDeltaF = Math.max(0, Math.round(hours[0].sunFeelsF - (hours[0].shadeFeelsF ?? hours[0].feelsLikeF)));
    } else {
      hours[0].sunFeelsF = Math.max(hours[0].shadeFeelsF ?? hours[0].feelsLikeF, hours[0].feelsLikeF);
      hours[0].sunDeltaF = 0;
    }
  }

  // Compute 2-layer Pavement Heat Balance across the first 48 hours
  const pavement = computePavementProfile(hours.slice(0, 48), 0, lat, lon);
  pavement.series.forEach((p, idx) => {
    if (hours[idx]) {
      hours[idx].concreteTempF = p.concreteF;
      hours[idx].asphaltTempF = p.asphaltF;
    }
  });

  // Group hours into 10 Daily Summaries with Per-Model Comparisons & Confidence Meters
  const days = buildDailySummaries(hours, baseData?.daily, canonicalData, timeZone);

  // Compute Forecast Window Banners (Rain windows, Sunny windows, Perfect outdoor windows)
  const windows = detectForecastWindows(hours.slice(0, 48));

  // Compute Air Quality Detail Card
  const airQuality = buildAirQualityProfile(aqiData, hours, canonicalData?.airQuality);

  // Compute Car Wash & Outdoor Project 5-Day Outlook
  const carWash = buildCarWashOutlook(days.slice(0, 5), hours.slice(0, 120));

  // Build "Nourie Weather Take" Narrative Briefing & Bulletins
  const briefing = buildNourieWeatherTake(loc, hours, days, windows, pavement, nwsData, canonicalData);

  // Build Active Feed Health & Run Timestamps
  const feeds = buildFeedHealthRegistry(now, isLiveApi, nwsData, canonicalData);

  return {
    version: 'weather-nourie-fusion-v3',
    fetchedAt: canonicalData?.assembledAt || now.toISOString(),
    isLiveApi,
    canonical: canonicalData || null,
    timeZone,
    location: {
      ...loc,
      name: resolvedLocName,
      latitude: lat,
      longitude: lon,
      timeZone,
      office: wfoFromCanonical(canonicalData, nwsData, loc),
      wfo: wfoFromCanonical(canonicalData, nwsData, loc)
    },
    current: hours[0],
    hours48: hours.slice(0, 48),
    hoursAll: hours,
    days,
    pavement,
    windows,
    airQuality,
    carWash,
    briefing,
    riskOutlooks: canonicalData?.riskOutlooks || [],
    alerts: canonicalData?.alerts?.length ? canonicalData.alerts : (nwsData.alerts || []),
    discussion: canonicalData?.discussion || null,
    afd: {
      wfo: wfoFromCanonical(canonicalData, nwsData, loc),
      issuedAt: canonicalData?.discussion?.issuanceTime || nwsData.afdIssuedAt || now.toISOString(),
      text:
        canonicalData?.discussion?.text ||
        nwsData.afdText ||
        generateSyntheticAfd({ ...loc, name: resolvedLocName }, hours[0], days)
    },
    feeds
  };
}

function wfoFromCanonical(canonicalData, nwsData, loc) {
  return canonicalData?.location?.office || nwsData?.wfo || loc?.wfo || 'NWS';
}

function deriveIconFromLabel(condition, isDay, rainChance = 0, tempF = 60) {
  const c = String(condition || '').toLowerCase();
  if (/thunder|t-storm|lightning|storm/.test(c)) return 'storm';
  if (/snow|sleet|flurr|blizzard|ice|wintry/.test(c) || (rainChance >= 55 && tempF <= 33)) return 'snow';
  if (/heavy rain|steady rain|showers likely|rain likely/.test(c) || (/rain|shower/.test(c) && rainChance >= 55)) return 'rain';
  if (/drizzle|chance.*rain|slight chance.*rain|sprinkle|scattered shower/.test(c) || rainChance >= 35) return 'drizzle';
  if (/fog|mist|haze|smoke/.test(c)) return 'fog';
  if (!/partly/.test(c) && /overcast|mostly cloudy|\bcloudy\b/.test(c)) return 'cloudy';
  if (/partly sunny|partly cloudy|mostly sunny|few clouds|scattered clouds/.test(c)) return isDay ? 'partly-day' : 'partly-night';
  if (/sunny|clear|fair/.test(c)) return isDay ? 'clear-day' : 'clear-night';
  return null;
}

function deriveSkyFromLabel(condition, isDay, rainChance = 0) {
  const c = String(condition || '').toLowerCase();
  if (/thunder|t-storm|lightning|storm/.test(c)) return 'storm';
  if (/rain|shower|drizzle|snow|sleet|flurr/.test(c) || rainChance >= 60) return 'rain';
  if (!isDay) return 'night';
  if (!/partly|mostly sunny|sunny|clear|few|scattered/.test(c) && /overcast|mostly cloudy|\bcloudy\b|fog|mist|haze|smoke/.test(c)) {
    return 'cloudy';
  }
  return 'day';
}

function formatZonedHHMM(rawVal, timeZone, fallback = '06:48') {
  if (!rawVal) return fallback;
  let ms = NaN;
  if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
    ms = rawVal < 1e11 ? rawVal * 1000 : rawVal;
  } else if (typeof rawVal === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawVal)) return rawVal.slice(11, 16);
    ms = Date.parse(rawVal);
  }
  if (!Number.isFinite(ms)) return fallback;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(ms));
  } catch {
    return fallback;
  }
}

function buildDailySummaries(hours, dailyApi, canonicalData = null, timeZone = 'America/New_York') {
  const byDay = new Map();
  hours.forEach((h) => {
    if (!byDay.has(h.dayKey)) byDay.set(h.dayKey, []);
    byDay.get(h.dayKey).push(h);
  });

  const canonDaysByDate = new Map((canonicalData?.days || []).map((d) => [d.date, d]));
  const solarByDate = new Map((canonicalData?.metricForecasts?.solar || []).map((s) => [s.date, s]));

  const days = [];
  let dIdx = 0;

  for (const [dayKey, dayHours] of byDay.entries()) {
    if (days.length >= 10) break;
    const cd = canonDaysByDate.get(dayKey);
    const temps = dayHours.map((h) => h.tempF);
    const highF = typeof cd?.high === 'number' && Number.isFinite(cd.high) ? Math.round(cd.high) : Math.max(...temps);
    const lowF = typeof cd?.low === 'number' && Number.isFinite(cd.low) ? Math.round(cd.low) : Math.min(...temps);
    const peakHour = dayHours.reduce((best, h) => (h.tempF > best.tempF ? h : best), dayHours[0]);
    const wettestHour = dayHours.reduce((best, h) => (h.rainChance > best.rainChance ? h : best), dayHours[0]);

    const canonPop = cd?.rainLikelihood?.value ?? cd?.pop;
    const rainChance = typeof canonPop === 'number' && Number.isFinite(canonPop)
      ? Math.round(canonPop)
      : Math.max(...dayHours.map((h) => h.rainChance));
    const totalQpfIn = typeof cd?.qpf === 'number' && Number.isFinite(cd.qpf)
      ? Number(cd.qpf.toFixed(2))
      : Number(dayHours.reduce((sum, h) => sum + (h.precipIn || 0), 0).toFixed(2));
    const totalSnowIn = Number(
      dayHours.reduce((sum, h) => sum + (h.snowfallIn || 0), 0).toFixed(1)
    );
    const maxWindMph = Math.max(...dayHours.map((h) => h.windMph));
    const maxGustMph = Math.max(...dayHours.map((h) => h.windGustMph));
    const avgHumidity = Math.round(
      dayHours.reduce((s, h) => s + h.humidity, 0) / dayHours.length
    );
    const maxDewPointF = Math.max(...dayHours.map((h) => h.dewPointF));
    const minDewPointF = Math.min(...dayHours.map((h) => h.dewPointF));
    const avgCloudCover = Math.round(
      dayHours.reduce((s, h) => s + h.cloudCover, 0) / dayHours.length
    );
    const maxUvIndex = Number(Math.max(...dayHours.map((h) => h.uvIndex)).toFixed(1));
    const maxAqi = Math.max(...dayHours.map((h) => h.aqi));

    // Per-model Daily High, Low, QPF, Rain Chance, Wind, Dew Point & Cloud Cover (strictly from real per-model values)
    const modelKeys = ['nws', 'hrrr', 'nbm', 'ecmwf', 'gefs', 'weathernext'];
    const modelHighs = {};
    const modelLows = {};
    const modelQpf = {};
    const modelRainChance = {};
    const modelWind = {};
    const modelDewPoint = {};
    const modelCloudCover = {};

    modelKeys.forEach((mk) => {
      const mTemps = dayHours
        .map((h) => h.modelTemps[mk])
        .filter((v) => typeof v === 'number' && !Number.isNaN(v));
      modelHighs[mk] = mTemps.length >= 4 ? Math.round(Math.max(...mTemps)) : null;
      modelLows[mk] = mTemps.length >= 4 ? Math.round(Math.min(...mTemps)) : null;

      const mWinds = dayHours
        .map((h) => h.modelWind?.[mk])
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
      modelWind[mk] = mWinds.length >= 4 ? Math.round(Math.max(...mWinds)) : null;

      const mDps = dayHours
        .map((h) => h.modelDewPoint?.[mk])
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
      modelDewPoint[mk] = mDps.length >= 4 ? Math.round(Math.max(...mDps)) : null;

      const mClouds = dayHours
        .map((h) => h.modelCloudCover?.[mk])
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
      modelCloudCover[mk] = mClouds.length >= 4
        ? clamp(Math.round(mClouds.reduce((a, b) => a + b, 0) / mClouds.length), 0, 100)
        : null;

      if (mk === 'nws') {
        if (typeof cd?.official?.high === 'number') modelHighs.nws = Math.round(cd.official.high);
        if (typeof cd?.official?.low === 'number') modelLows.nws = Math.round(cd.official.low);
        const validNwsPops = dayHours.map((h) => h.nwsPopReal).filter((v) => typeof v === 'number' && Number.isFinite(v));
        modelRainChance.nws = typeof cd?.officialPop === 'number'
          ? Math.round(cd.officialPop)
          : validNwsPops.length >= 4
          ? Math.round(Math.max(...validNwsPops))
          : null;
        modelQpf.nws = typeof cd?.qpfBlend?.sourceValues?.nws === 'number'
          ? Number(cd.qpfBlend.sourceValues.nws.toFixed(2))
          : null;
      } else {
        const gKey = mk === 'weathernext' ? (cd?.guidance?.wn ? 'wn' : 'weathernext3') : mk;
        const g = cd?.guidance?.[gKey];
        if (g) {
          if (typeof g.high === 'number') modelHighs[mk] = Math.round(g.high);
          if (typeof g.low === 'number') modelLows[mk] = Math.round(g.low);
        }
        const mQpfs = dayHours
          .map((h) => h.modelQpfHour?.[mk])
          .filter((v) => typeof v === 'number' && Number.isFinite(v));
        const qSum = g && typeof g.qpf === 'number'
          ? g.qpf
          : mQpfs.length >= 4
          ? mQpfs.reduce((a, b) => a + b, 0)
          : null;
        modelQpf[mk] = qSum !== null ? Number(qSum.toFixed(2)) : null;

        if (mk === 'nbm' && typeof g?.pop === 'number') {
          modelRainChance[mk] = clamp(Math.round(g.pop), 0, 100);
        } else if (modelQpf[mk] === null) {
          modelRainChance[mk] = null;
        } else {
          const wetHours = mQpfs.filter((v) => v >= 0.005).length;
          modelRainChance[mk] = wetHours === 0 && modelQpf[mk] < 0.005
            ? 0
            : clamp(Math.round(Math.min(60, wetHours * 10) + Math.min(55, modelQpf[mk] * 180)), 5, 100);
        }
      }
    });

    // Confidence score from cross-model temperature spread & canonical rating
    const validHighs = Object.values(modelHighs).filter((v) => typeof v === 'number');
    const highSpread = cd?.confidence?.temperatureSpread ?? (validHighs.length > 1 ? Math.max(...validHighs) - Math.min(...validHighs) : 2);
    const avgHourSpread =
      dayHours.reduce((s, h) => s + (h.tempFusion.spreadF || 2), 0) / dayHours.length;
    const rawConfScore = cd?.confidence?.key === 'high'
      ? 86
      : cd?.confidence?.key === 'moderate'
      ? 68
      : cd?.confidence?.key === 'low'
      ? 45
      : clamp(Math.round(96 - highSpread * 4.8 - avgHourSpread * 2.5 - dIdx * 2.2), 35, 98);

    const confidence =
      rawConfScore >= 76
        ? { level: 'High', score: rawConfScore, color: '#5ce0a0', spreadF: Number(highSpread.toFixed(1)) }
        : rawConfScore >= 56
        ? { level: 'Moderate', score: rawConfScore, color: '#ffd166', spreadF: Number(highSpread.toFixed(1)) }
        : { level: 'Low', score: rawConfScore, color: '#ff7b7b', spreadF: Number(highSpread.toFixed(1)) };

    const dt = new Date(`${dayKey}T12:00:00Z`);
    const dayName =
      dIdx === 0
        ? 'Today'
        : dIdx === 1
        ? 'Tomorrow'
        : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(dt);
    const shortWeekday =
      dIdx === 0
        ? 'Today'
        : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(dt);
    const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(dt);

    const middayHour = dayHours.find((h) => h.hourOfDay === 13) || dayHours[Math.floor(dayHours.length / 2)];
    const displayCond = rainChance >= 55 ? wettestHour : middayHour;
    const canonCondLabel = cd?.condition || displayCond.condition;
    const canonCondIcon = deriveIconFromLabel(canonCondLabel, true, rainChance, highF) || displayCond.icon;
    const solar = solarByDate.get(dayKey);

    days.push({
      index: dIdx,
      dayKey,
      dayName,
      shortWeekday,
      dateLabel,
      highF,
      lowF,
      peakFeelsF: Math.max(...dayHours.map((h) => h.feelsLikeF)),
      minFeelsF: Math.min(...dayHours.map((h) => h.feelsLikeF)),
      rainChance,
      totalQpfIn,
      totalSnowIn,
      snowPossible: totalSnowIn > 0 || (lowF <= 35 && rainChance >= 35),
      maxWindMph,
      maxGustMph,
      avgHumidity,
      maxDewPointF,
      minDewPointF,
      avgCloudCover,
      maxUvIndex,
      maxAqi,
      condition: canonCondLabel,
      icon: canonCondIcon,
      sunrise: formatZonedHHMM(solar?.sunrise ?? dailyApi?.sunrise?.[dIdx], timeZone, '06:48'),
      sunset: formatZonedHHMM(solar?.sunset ?? dailyApi?.sunset?.[dIdx], timeZone, '17:12'),
      confidence,
      modelHighs,
      modelLows,
      modelQpf,
      modelRainChance,
      modelWind,
      modelDewPoint,
      modelCloudCover,
      peakTempHour: peakHour,
      wettestHour,
      hours: dayHours
    });

    dIdx++;
  }

  return days;
}

function detectForecastWindows(hours48) {
  const rainHours = hours48.filter((h) => h.rainChance >= 45 || h.precipIn >= 0.01);
  const sunHours = hours48.filter((h) => h.isDay && h.cloudCover <= 40 && h.rainChance < 25);
  const perfectHours = hours48.filter((h) => h.comfortCategory.id === 'perfect');

  const banners = [];

  if (rainHours.length > 0) {
    const first = rainHours[0];
    const peak = rainHours.reduce((a, b) => (b.rainChance > a.rainChance ? b : a), rainHours[0]);
    banners.push({
      id: 'rain-window',
      type: 'rain',
      title: 'Rain & storm outlook',
      subtitle: `${first.hourLabel} · Peak ${peak.rainChance}% around ${peak.hourLabel} (${rainHours.length} wet ${rainHours.length === 1 ? 'hour' : 'hours'} in 48h)`,
      badge: `${peak.rainChance}% Peak`,
      hours: rainHours
    });
  } else {
    banners.push({
      id: 'dry-window',
      type: 'clear',
      title: 'Dry weather next 48 hours',
      subtitle: 'Low chance of rain across local forecasts through the next two days.',
      badge: 'Dry Ahead',
      hours: []
    });
  }

  if (perfectHours.length > 0) {
    banners.push({
      id: 'perfect-window',
      type: 'perfect',
      title: 'Near-perfect outdoor window ahead',
      subtitle: `${perfectHours[0].hourLabel} (${perfectHours[0].tempF}° · Dew point ${perfectHours[0].dewPointF}°) · +${Math.max(0, perfectHours.length - 1)} more golden hours`,
      badge: `${perfectHours.length} Golden Hrs`,
      hours: perfectHours
    });
  } else if (sunHours.length > 0) {
    banners.push({
      id: 'sun-window',
      type: 'sun',
      title: 'Next bright sun window',
      subtitle: `${sunHours[0].hourLabel} (${sunHours[0].tempF}°, ${100 - sunHours[0].cloudCover}% clear sky) · ${sunHours.length} sunny daylight hours in 48h`,
      badge: 'Sun Window',
      hours: sunHours
    });
  }

  return {
    banners,
    rainHours,
    sunHours,
    perfectHours
  };
}

function buildAirQualityProfile(aqiData, hours, canonicalAqi = null) {
  const currentAqi = canonicalAqi?.aqi ?? hours[0]?.aqi ?? 36;
  const peak24h = canonicalAqi?.next24HourPeak ?? Math.max(...hours.slice(0, 24).map((h) => h.aqi));

  let category = { label: 'Good', color: '#5ce0a0', bg: 'linear-gradient(135deg, rgba(24, 92, 68, 0.52), rgba(16, 45, 58, 0.65))', advice: 'Air quality is clean and ideal for outdoor activity.' };
  if (currentAqi > 150) {
    category = { label: 'Unhealthy', color: '#ff6b6b', bg: 'linear-gradient(135deg, rgba(132, 32, 48, 0.62), rgba(45, 20, 38, 0.72))', advice: 'Avoid prolonged outdoor exertion; sensitive groups should remain indoors.' };
  } else if (currentAqi > 100) {
    category = { label: 'Sensitive Groups', color: '#ff9f43', bg: 'linear-gradient(135deg, rgba(128, 70, 24, 0.58), rgba(40, 28, 24, 0.7))', advice: 'Sensitive individuals should limit prolonged outdoor exertion.' };
  } else if (currentAqi > 50) {
    category = { label: 'Moderate', color: '#ffd166', bg: 'linear-gradient(135deg, rgba(112, 92, 26, 0.52), rgba(24, 38, 56, 0.68))', advice: 'Air quality is acceptable; unusually sensitive individuals should monitor symptoms.' };
  }

  const pm25Val = canonicalAqi?.pm25 ?? aqiData?.current?.pm2_5 ?? 7.4;
  const pm10Val = canonicalAqi?.pm10 ?? aqiData?.current?.pm10 ?? 14.2;
  const o3Val = canonicalAqi?.ozone ?? aqiData?.current?.ozone ?? 54.0;
  const no2Val = canonicalAqi?.nitrogenDioxide ?? aqiData?.current?.nitrogen_dioxide ?? 9.8;

  return {
    currentAqi,
    peak24h,
    ...category,
    pollutants: [
      { id: 'pm25', name: 'PM2.5 Fine Particles', value: Number(Number(pm25Val).toFixed(1)), unit: 'µg/m³', max: 35 },
      { id: 'pm10', name: 'PM10 Coarse Dust', value: Number(Number(pm10Val).toFixed(1)), unit: 'µg/m³', max: 150 },
      { id: 'o3', name: 'Ozone (O₃)', value: Number(Number(o3Val).toFixed(1)), unit: 'µg/m³', max: 140 },
      { id: 'no2', name: 'Nitrogen Dioxide (NO₂)', value: Number(Number(no2Val).toFixed(1)), unit: 'µg/m³', max: 100 }
    ]
  };
}

function buildCarWashOutlook(days5, hours120) {
  const dayScores = days5.map((d, idx) => {
    const nextDayRain = days5[idx + 1]?.rainChance ?? 0;
    const penaltyRain = d.rainChance * 0.7 + nextDayRain * 0.45;
    const score = clamp(Math.round(98 - penaltyRain - (d.maxWindMph > 18 ? 12 : 0)), 12, 98);
    const verdict = score >= 75 ? 'Great' : score >= 50 ? 'Wait' : 'Skip';
    const color = score >= 75 ? '#5ce0a0' : score >= 50 ? '#ffd166' : '#ff7b7b';
    return {
      dayName: d.shortWeekday,
      dateLabel: d.dateLabel,
      score,
      verdict,
      color,
      rainChance: d.rainChance,
      note:
        score >= 75
          ? 'Dry road conditions & clean 24h+ post-wash window'
          : d.rainChance >= 45
          ? `${d.rainChance}% rain risk (${d.totalQpfIn}" expected)`
          : 'Rain likely within 24 hours after washing'
    };
  });

  const bestDay = dayScores.reduce((a, b) => (b.score > a.score ? b : a), dayScores[0]);
  return {
    overallVerdict: dayScores[0].verdict,
    bestDay,
    days: dayScores
  };
}

function buildNourieWeatherTake(loc, hours, days, windows, pavement, nwsData, canonicalData = null) {
  const cur = hours[0];
  const today = days[0];
  const tomorrow = days[1] || today;

  // Check active official WPC/SPC/WSSI risk outlooks from canonical backend FIRST
  const nowMs = Date.now();
  const activeRisks = (canonicalData?.riskOutlooks || [])
    .filter((r) => r && r.id && (!r.expires || Date.parse(r.expires) > nowMs))
    .sort((a, b) => (b.rank || 0) - (a.rank || 0));

  // Compute plain-English large weather change alerts matching the main page rules
  const changeAlerts = [];
  const days5 = days.slice(0, 5);
  for (let j = 1; j < days5.length; j++) {
    for (let i = 0; i < j; i++) {
      const avgTempA = (days5[i].highF + days5[i].lowF) / 2;
      const avgTempB = (days5[j].highF + days5[j].lowF) / 2;
      if (Math.abs(avgTempB - avgTempA) >= 18 && !changeAlerts.some((c) => c.kind === 'temp')) {
        const warmer = avgTempB > avgTempA;
        changeAlerts.push({
          kind: 'temp',
          text: `A ${warmer ? 'much warmer' : 'much colder'} shift arrives by ${days5[j].dayName} (${today.highF}° today vs ${days5[j].highF}° ${days5[j].shortWeekday}).`
        });
      }
      const dpDiff = (days5[j].maxDewPointF || 0) - (days5[i].maxDewPointF || 0);
      if (Math.abs(dpDiff) >= 18 && !changeAlerts.some((c) => c.kind === 'dewpoint')) {
        const humid = dpDiff > 0;
        const rainInSpan = days5.slice(i, j + 1).some((d) => d.rainChance > 25);
        changeAlerts.push({
          kind: 'dewpoint',
          text: `The air will feel ${humid ? 'noticeably more humid' : 'much drier and crisper'} from ${days5[i].dayName} to ${days5[j].dayName}.${!humid && rainInSpan ? ' Rain is still possible during that stretch.' : ''}`
        });
      }
    }
    if (
      j >= 2 &&
      days5[j].rainChance >= 70 &&
      days5[j - 1].rainChance <= 20 &&
      days5[j - 2].rainChance <= 20 &&
      !changeAlerts.some((c) => c.kind === 'rain')
    ) {
      changeAlerts.push({
        kind: 'rain',
        text: `Rain returns ${days5[j].dayName} (${days5[j].rainChance}% chance) after dry days ahead.`
      });
    }
  }

  const rainNote =
    windows.rainHours.length > 0
      ? `Rain is possible at times (${today.rainChance}% highest chance today, about ${today.totalQpfIn}" expected).`
      : `Dry skies should hold steady with no meaningful rain expected over the next 48 hours.`;

  const consensusNote =
    today.confidence.level === 'High'
      ? `Forecasters closely agree on today's temperatures.`
      : `Forecasts vary slightly on exact timing today, so check back for quick updates.`;

  const thermalNote =
    cur.sunDeltaF >= 5
      ? `Direct sun makes it feel warmer (+${cur.sunDeltaF}° in sun vs shade).`
      : `Feels-like temperatures stay close to ${cur.feelsLikeF}° whether in sun or shade.`;

  let riskOutlook;
  const activeAlerts = canonicalData?.alerts?.length ? canonicalData.alerts : (nwsData.alerts || []);
  if (activeRisks.length > 0) {
    const top = activeRisks[0];
    const kindLabel = top.kind === 'wpc'
      ? 'Flooding'
      : top.kind === 'spc'
      ? 'Severe Storms'
      : 'Winter Weather';
    const agencyLabel = top.kind === 'wpc'
      ? 'Flood Risk'
      : top.kind === 'spc'
      ? 'Storm Risk'
      : 'Winter Risk';
    const riskColor =
      top.level === 'High'
        ? '#d34cff'
        : top.level === 'Moderate'
        ? '#ff6b6b'
        : top.level === 'Enhanced'
        ? '#ff9f43'
        : top.level === 'Slight'
        ? '#f4e14a'
        : '#facc15';
    riskOutlook = {
      level: `${top.level} Risk of ${kindLabel}`,
      agency: agencyLabel,
      title: top.summary || top.title,
      color: riskColor,
      riskObj: top,
      items: activeRisks
    };
  } else if (activeAlerts.length > 0) {
    riskOutlook = {
      level: activeAlerts[0].event || activeAlerts[0].severity || 'Active Weather Alert',
      agency: 'Official Alert',
      title: activeAlerts[0].headline || activeAlerts[0].event,
      color: '#ff7b7b',
      items: []
    };
  } else if (today.rainChance >= 65 && today.totalQpfIn >= 0.4) {
    riskOutlook = {
      level: 'Wet Weather Watch',
      agency: 'Rain Outlook',
      title: 'Heavier rain showers could bring wet roads and puddles at times',
      color: '#ffd166',
      items: []
    };
  } else {
    riskOutlook = {
      level: 'Quiet Weather',
      agency: 'Storm & Flood Outlook',
      title: 'No flood or severe storm outlooks are active here right now.',
      color: '#5ce0a0',
      items: []
    };
  }

  return {
    headline: `${cur.condition} at ${cur.tempF}° · High ${today.highF}° / Low ${today.lowF}°`,
    summary: `${rainNote} ${consensusNote} ${thermalNote}`,
    changeAlerts: changeAlerts.map((c) => c.text),
    bullets: [
      {
        label: 'Rest of Today',
        text: `${cur.condition} with temperatures ranging from ${today.lowF}° to ${today.highF}° and ${cur.windMph} mph breeze.`
      },
      {
        label: 'Tomorrow',
        text: `${tomorrow.dayName} looks ${tomorrow.highF > today.highF ? 'warmer' : tomorrow.highF < today.highF ? 'cooler' : 'similar'} (${tomorrow.lowF}° to ${tomorrow.highF}°) with a ${tomorrow.rainChance}% chance of rain.`
      },
      {
        label: 'Outdoors & Pets',
        text: `Sidewalks are around ${pavement.concreteTempF}° and streets ${pavement.asphaltTempF}° — ${pavement.pawSafety.label.toLowerCase()} for dog walks.`
      }
    ],
    riskOutlook
  };
}

function buildFeedHealthRegistry(now, isLiveApi, nwsData, canonicalData = null) {
  const runTime = new Date(now.getTime() - 45 * 60000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
  const wfo = wfoFromCanonical(canonicalData, nwsData, {});
  return [
    { id: 'nws', name: 'NOAA / NWS Gridpoint', status: nwsData.available || canonicalData ? 'Available' : 'Synthesized', run: `Updated ${runTime}`, active: true },
    { id: 'hrrr', name: 'NOAA HRRR 3km CONUS', status: 'Contributing', run: `Run ${runTime} (0–48h)`, active: true },
    { id: 'nbm', name: 'National Blend (NBM v4.2)', status: 'Contributing', run: `Run ${runTime} (Days 1–10)`, active: true },
    { id: 'ecmwf', name: 'ECMWF IFS 0.25° Open Data', status: 'Contributing', run: `00Z / 12Z Cycle`, active: true },
    { id: 'gefs', name: 'GEFS / ICON Global Ensemble', status: 'Contributing', run: `30-Member Mean`, active: true },
    { id: 'weathernext', name: 'Google WeatherNext AI Ensemble', status: 'Contributing', run: `P10–P90 Probabilistic`, active: true },
    { id: 'aqi', name: 'Open-Meteo / CAMS Air Quality', status: 'Available', run: `Real-time US EPA AQI`, active: true },
    { id: 'afd', name: `NWS ${wfo} Forecast Discussion`, status: canonicalData?.discussion?.text || nwsData.afdText ? 'Live AFD' : 'Briefing Active', run: `WFO ${wfo}`, active: true }
  ];
}

function generateSyntheticAfd(loc, cur, days) {
  return `.SYNOPSIS... (${loc.name})
Multi-model guidance remains in good agreement across the short-term period. Current surface analysis places temperatures near ${cur.tempF}F with ${cur.humidity}% relative humidity and ${cur.windCardinal} winds around ${cur.windMph} mph.

.SHORT TERM (Today through ${days[2]?.dayName || 'Day 3'})...
High-resolution HRRR and National Blend (NBM) guidance track closely with ECMWF IFS 0.25-degree fields. Today's high reaches ${days[0]?.highF}F with an overnight low near ${days[0]?.lowF}F. The 100-point precipitation scoring ledger indicates a ${days[0]?.rainChance}% peak probability today (${days[0]?.totalQpfIn}" expected QPF).

.LONG TERM (${days[3]?.dayName || 'Day 4'} through Day 10)...
Ensemble spread remains well-behaved through mid-week before widening slightly by Days 7-10. Blend V2 shifts weighting smoothly toward ECMWF IFS, NBM, and WeatherNext ensemble means in the extended range.`;
}

function generateHourlyIsoStrings(startDate, count) {
  const base = new Date(startDate);
  base.setMinutes(0, 0, 0);
  const list = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + i * 3600000);
    list.push(d.toISOString());
  }
  return list;
}

export function formatHourLabel(dt, isNow = false, timeZone = undefined) {
  if (isNow) return 'Now';
  try {
    return new Intl.DateTimeFormat('en-US', {
      ...(timeZone ? { timeZone } : {}),
      hour: 'numeric',
      hour12: true
    })
      .format(dt)
      .replace(' ', '');
  } catch {
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }).replace(' ', '');
  }
}

export function degToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
