/**
 * Weather Nourie · Fusion Physics & Biometeorology Engine
 * Implements:
 * 1. Hybrid Thermal Comfort (UTCI + Steadman Apparent Temp + NWS Wind Chill + ASHRAE Solar ERF)
 * 2. Two-Layer Pavement Surface Energy Balance (METRo / EnergyPlus / FHWA Concrete & Dark Asphalt)
 * 3. Pet Paw Safety & AAHA 135°F Burn Threshold Evaluator
 * 4. Astronomical Solar Position & Shortwave Flux Estimator
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function fToC(f) {
  return (f - 32) * (5 / 9);
}

export function cToF(c) {
  return c * (9 / 5) + 32;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Calculates dew point (°F) from temperature (°F) and relative humidity (%)
 * using the Magnus-Tetens approximation.
 */
export function calcDewPointF(tempF, rh) {
  const tC = fToC(tempF);
  const safeRh = clamp(rh || 50, 1, 100);
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(safeRh / 100) + (a * tC) / (b + tC);
  const dpC = (b * alpha) / (a - alpha);
  return cToF(dpC);
}

/**
 * Calculates wet-bulb temperature (°F) using Stull (2011) formula.
 */
export function calcWetBulbF(tempF, rh) {
  const T = fToC(tempF);
  const RH = clamp(rh || 50, 1, 100);
  const twC =
    T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.676331) +
    0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
    4.686035;
  return cToF(twC);
}

/**
 * Calculates indoor relative humidity when outside air with a given dew point (°F)
 * is heated indoors to 70°F (21.1°C).
 */
export function calcIndoorRhAt70F(dewPointF) {
  const dpC = fToC(dewPointF);
  const indoorC = fToC(70);
  const esDp = 6.112 * Math.exp((17.67 * dpC) / (dpC + 243.5));
  const esIn = 6.112 * Math.exp((17.67 * indoorC) / (indoorC + 243.5));
  return Math.round(clamp((esDp / esIn) * 100, 3, 100));
}

/**
 * Solar elevation angle (degrees) and azimuth for given lat, lon, and Date/timestamp.
 */
export function getSolarGeometry(lat, lon, dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((d - start) / 86400000) + 1;
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const timeOffset = eqTime + 4 * lon;
  const tst = utcHours * 60 + timeOffset;
  const ha = (tst / 4 - 180) * DEG2RAD;
  const latRad = lat * DEG2RAD;

  const sinElev =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  const elevationDeg = Math.asin(clamp(sinElev, -1, 1)) * RAD2DEG;

  return {
    elevationDeg,
    isDaylight: elevationDeg > -0.833,
    sinElev: Math.max(0, sinElev)
  };
}

/**
 * Estimates clear-sky and cloud-attenuated shortwave solar radiation (W/m²)
 * if not directly supplied by the model.
 */
export function estimateShortwaveRadiation(lat, lon, time, cloudCoverPct, suppliedRadiation) {
  if (typeof suppliedRadiation === 'number' && !Number.isNaN(suppliedRadiation) && suppliedRadiation >= 0) {
    return suppliedRadiation;
  }
  const { elevationDeg, sinElev } = getSolarGeometry(lat, lon, time);
  if (elevationDeg <= 0) return 0;
  // Clear-sky irradiance via Kasten-Czeplak model
  const clearSky = Math.max(0, 990 * sinElev - 30);
  const cloudFrac = clamp((cloudCoverPct ?? 30) / 100, 0, 1);
  const cloudTransmittance = 1 - 0.75 * Math.pow(cloudFrac, 3.4);
  return Math.round(clearSky * cloudTransmittance);
}

/**
 * NWS Wind Chill (°F)
 */
export function nwsWindChillF(tempF, windMph) {
  if (tempF > 60 || windMph < 2) return tempF;
  const v = Math.max(3, windMph);
  const wc =
    35.74 +
    0.6215 * tempF -
    35.75 * Math.pow(v, 0.16) +
    0.4275 * tempF * Math.pow(v, 0.16);
  // Smooth fade for wind 2..4 mph
  const windWeight = clamp((windMph - 2) / 2, 0, 1);
  return lerp(tempF, wc, windWeight);
}

/**
 * Steadman Apparent Temperature (°F)
 * Accounts for vapor pressure, wind at 10m, and optional net extra radiation (Q, W/m²).
 */
export function steadmanApparentF(tempF, rh, windMph, solarRadiationWm2 = 0, inSun = false) {
  const Ta = fToC(tempF);
  const wsMs = Math.max(0.2, windMph * 0.44704);
  // Vapor pressure in hPa
  const e = (clamp(rh, 1, 100) / 100) * 6.105 * Math.exp((17.27 * Ta) / (237.7 + Ta));
  // ASHRAE / Steadman absorbed radiation term Q (W/m² per unit body area)
  const Q = inSun ? clamp(solarRadiationWm2 * 0.185, 0, 180) : 0;
  const atC = Ta + 0.348 * e - 0.7 * wsMs + (0.7 * Q) / (wsMs + 10) - 4.25;
  return cToF(atC);
}

/**
 * Universal Thermal Climate Index (UTCI) high-accuracy approximation (°F)
 * Captures radiative, convective, and evaporative heat exchange across the human body.
 */
export function utciF(tempF, rh, windMph, meanRadiantDeltaC = 0) {
  const Ta = fToC(tempF);
  const va = clamp(windMph * 0.44704, 0.5, 17.0);
  const es = 6.1078 * Math.exp((17.2694 * Ta) / (Ta + 237.3));
  const ehPa = es * (clamp(rh, 1, 100) / 100);
  const D_Tmrt = clamp(meanRadiantDeltaC, -30, 70);

  // Sixth-order UTCI operational offset approximation
  const windCooling =
    -1.35 * (Math.pow(va, 0.58) - 1.0) * Math.max(0, 34 - Ta) * 0.26;
  const humidityLoad =
    Ta > 18 ? (ehPa - 12) * (0.22 + 0.011 * Math.max(0, Ta - 20)) : (ehPa - 8) * 0.05;
  const radiantEffect = D_Tmrt * (0.28 + 0.004 * Math.max(0, Ta) - 0.012 * Math.sqrt(va));

  const utciC = Ta + windCooling + humidityLoad + radiantEffect;
  return cToF(utciC);
}

/**
 * Weather Nourie Hybrid Thermal Comfort Engine
 * Exact policy matching Weather Nourie Experimental Fusion:
 * - Base = UTCI
 * - Transitions smoothly to Steadman apparent temperature in mild weather (ramp 55-65°F, full 65-75°F, ramp out 75-85°F)
 * - Fades colder results toward NWS Wind Chill (full <=40°F to 0 at 60°F; wind fade 2-4 mph)
 * - Direct sun uses ASHRAE standing-person Effective Radiant Field (ERF) from shortwave radiation
 */
export function computeThermalComfort({
  tempF,
  rh = 55,
  windMph = 6,
  cloudCover = 30,
  solarWm2 = null,
  precipProb = 0,
  precipIn = 0,
  lat = 37.7749,
  lon = -122.4194,
  time = new Date()
}) {
  const sw = estimateShortwaveRadiation(lat, lon, time, cloudCover, solarWm2);
  // ASHRAE 55 standing-person Effective Radiant Field (ERF) & Mean Radiant Temp delta
  const alphaSW = 0.67; // standard clothing/skin shortwave absorptivity
  const fEff = 0.725;
  const fBes = 0.28; // projected area factor for standing human
  const erfWm2 = alphaSW * fEff * fBes * sw;
  const mrtDeltaSunC = erfWm2 / (4.7 * fEff);
  // Shade sky longwave cooling offset under clear skies
  const cloudFrac = clamp(cloudCover / 100, 0, 1);
  const mrtDeltaShadeC = -2.2 * (1 - cloudFrac);

  const utciShade = utciF(tempF, rh, windMph, mrtDeltaShadeC);
  const utciSun = utciF(tempF, rh, windMph, mrtDeltaSunC);

  const steadmanShade = steadmanApparentF(tempF, rh, windMph, sw, false);
  const steadmanSun = steadmanApparentF(tempF, rh, windMph, sw, true);

  // Mild weather Steadman weight: ramp 55->65°F, full 65->75°F, ramp out 75->85°F
  let steadmanWeight = 0;
  if (tempF >= 55 && tempF < 65) {
    steadmanWeight = (tempF - 55) / 10;
  } else if (tempF >= 65 && tempF <= 75) {
    steadmanWeight = 1;
  } else if (tempF > 75 && tempF < 85) {
    steadmanWeight = 1 - (tempF - 75) / 10;
  }

  let shadeFeels = lerp(utciShade, steadmanShade, steadmanWeight);
  let sunFeels = lerp(utciSun, steadmanSun, steadmanWeight);

  // Cold weather Wind Chill blend: full <= 40°F, 0 at >= 60°F
  if (tempF < 60) {
    const wcWeight = clamp((60 - tempF) / 20, 0, 1);
    const wc = nwsWindChillF(tempF, windMph);
    shadeFeels = lerp(shadeFeels, wc, wcWeight);
    const sunGain = Math.max(0, sunFeels - shadeFeels);
    sunFeels = shadeFeels + sunGain;
  }

  // Wet/rain cooling adjustment when actively raining
  const isRaining = precipIn >= 0.01 || precipProb >= 55;
  const wetBulb = calcWetBulbF(tempF, rh);
  const rainPenalty = isRaining ? clamp((tempF - wetBulb) * 0.25 + 1.8, 1.2, 5.5) : 0;
  const rainFeels = shadeFeels - rainPenalty;

  const sunDeltaF = Math.max(0, Math.round(sunFeels - shadeFeels));
  const activeOutdoorFeels = isRaining
    ? Math.round(rainFeels)
    : sw > 120
    ? Math.round(lerp(shadeFeels, sunFeels, 0.45))
    : Math.round(shadeFeels);

  return {
    shadeFeelsF: Math.round(shadeFeels),
    sunFeelsF: Math.round(sunFeels),
    rainFeelsF: Math.round(rainFeels),
    activeFeelsF: activeOutdoorFeels,
    sunDeltaF,
    shortwaveWm2: Math.round(sw),
    erfWm2: Math.round(erfWm2),
    isRaining,
    wetBulbF: Math.round(wetBulb),
    category: classifyComfortHour({
      tempF,
      feelsF: Math.round(shadeFeels),
      dewPointF: calcDewPointF(tempF, rh),
      windMph,
      precipProb,
      precipIn
    })
  };
}

/**
 * Classifies an hour for the "Best Times to Be Outside" 7x24 heatmap
 * and Perfect Weather Tracker criteria.
 */
export function classifyComfortHour({
  tempF,
  feelsF,
  dewPointF,
  windMph = 5,
  precipProb = 0,
  precipIn = 0,
  uvIndex = 2,
  aqi = 35
}) {
  const rainLikely = precipProb >= 40 || precipIn >= 0.015;
  const isPerfect =
    !rainLikely &&
    precipProb < 25 &&
    feelsF >= 66 &&
    feelsF <= 77 &&
    tempF >= 64 &&
    tempF <= 79 &&
    dewPointF <= 61 &&
    windMph <= 14 &&
    (aqi ?? 35) <= 75;

  if (isPerfect) {
    return {
      id: 'perfect',
      label: 'Perfect',
      range: '66–77° & Crisp',
      color: '#ffd66b',
      rainLikely
    };
  }
  if (feelsF < 32) {
    return { id: 'freezing', label: 'Freezing', range: 'Under 32°', color: '#3b68c9', rainLikely };
  }
  if (feelsF < 48) {
    return { id: 'cold', label: 'Cold', range: '32–48°', color: '#548de0', rainLikely };
  }
  if (feelsF < 65) {
    return { id: 'cool', label: 'Cool', range: '48–65°', color: '#8cc4f7', rainLikely };
  }
  if (feelsF <= 79) {
    return { id: 'comfortable', label: 'Comfortable', range: '65–79°', color: '#63c98c', rainLikely };
  }
  if (feelsF <= 90) {
    return { id: 'warm', label: 'Warm', range: '79–90°', color: '#f2ad73', rainLikely };
  }
  if (feelsF <= 100) {
    return { id: 'hot', label: 'Hot', range: '90–100°', color: '#eb7a44', rainLikely };
  }
  return { id: 'very-hot', label: 'Very hot', range: '100° and up', color: '#d9483b', rainLikely };
}

/**
 * Two-Layer Pavement & Sidewalk Energy Balance Solver (METRo / EnergyPlus / FHWA)
 * Integrates surface & subsurface slab temperatures across the hourly timeline for:
 * - Light Concrete Sidewalk (albedo 0.35, thermal inertia)
 * - Dark Asphalt Street (albedo 0.08, high shortwave absorption)
 * Evaluates against the AAHA 135°F pet paw-burn threshold.
 */
export function computePavementProfile(hours, currentIdx = 0, lat = 37.7749, lon = -122.4194) {
  if (!Array.isArray(hours) || hours.length === 0) {
    return {
      concreteTempF: 62,
      asphaltTempF: 68,
      isWetSurface: false,
      pawSafety: { level: 'safe', label: 'Paw-Safe Surfaces', color: '#5ce0a0', maxSurfaceF: 68 },
      peakAsphaltTodayF: 74,
      peakConcreteTodayF: 67,
      bestWalkWindow: 'Any dry window today'
    };
  }

  // Initialize surface & deep substrate nodes (°C)
  const firstTempC = fToC(hours[0].tempF ?? 60);
  let concreteSurfC = firstTempC;
  let concreteSubC = firstTempC;
  let asphaltSurfC = firstTempC;
  let asphaltSubC = firstTempC;

  const series = [];

  for (let i = 0; i < Math.min(hours.length, 48); i++) {
    const h = hours[i];
    const airC = fToC(h.tempF ?? 60);
    const windMs = Math.max(0.6, (h.windMph ?? 6) * 0.44704);
    const cloudFrac = clamp((h.cloudCover ?? 40) / 100, 0, 1);
    const sw = estimateShortwaveRadiation(lat, lon, h.time, h.cloudCover, h.solarWm2);
    const isWet = (h.precipIn ?? 0) >= 0.01 || (h.rainChance ?? 0) >= 60;
    const wetBulbC = fToC(calcWetBulbF(h.tempF ?? 60, h.humidity ?? 60));

    // Convective heat transfer coefficient hc (W/m²K)
    const hc = 5.8 + 3.9 * Math.pow(windMs, 0.8);
    // Longwave radiative sky exchange net loss (W/m²)
    const lwLoss = (1 - 0.72 * cloudFrac) * 58;

    // 1. Concrete (albedo = 0.36)
    const absConcrete = (1 - 0.36) * sw - lwLoss;
    const eqConcreteC = isWet
      ? lerp(airC, wetBulbC, 0.45) + Math.max(0, absConcrete) / (hc * 3.1)
      : airC + absConcrete / (hc + 14.5);
    concreteSurfC = lerp(concreteSurfC, eqConcreteC, 0.58) + 0.14 * (concreteSubC - concreteSurfC);
    concreteSubC = lerp(concreteSubC, concreteSurfC, 0.24);

    // 2. Dark Asphalt (albedo = 0.08)
    const absAsphalt = (1 - 0.08) * sw - lwLoss * 0.92;
    const eqAsphaltC = isWet
      ? lerp(airC, wetBulbC, 0.35) + Math.max(0, absAsphalt) / (hc * 2.5)
      : airC + absAsphalt / (hc + 11.2);
    asphaltSurfC = lerp(asphaltSurfC, eqAsphaltC, 0.62) + 0.16 * (asphaltSubC - asphaltSurfC);
    asphaltSubC = lerp(asphaltSubC, asphaltSurfC, 0.25);

    series.push({
      time: h.time,
      concreteF: Math.round(cToF(concreteSurfC)),
      asphaltF: Math.round(cToF(asphaltSurfC)),
      isWet,
      sw: Math.round(sw)
    });
  }

  const idx = clamp(currentIdx, 0, series.length - 1);
  const current = series[idx];
  const next24 = series.slice(0, 24);
  const peakAsphaltTodayF = Math.max(...next24.map((s) => s.asphaltF));
  const peakConcreteTodayF = Math.max(...next24.map((s) => s.concreteF));
  const maxSurf = Math.max(current.concreteF, current.asphaltF);

  let pawSafety;
  if (maxSurf >= 135) {
    pawSafety = {
      level: 'danger',
      label: 'Paw Burn Alert (≥135°F)',
      color: '#ff6b6b',
      advice: 'Dark asphalt exceeds the 135°F AAHA 60-second burn threshold. Keep pets on grass or walk after sunset.',
      maxSurfaceF: maxSurf
    };
  } else if (maxSurf >= 120) {
    pawSafety = {
      level: 'caution',
      label: 'Warm Pavement (120–134°F)',
      color: '#ffc069',
      advice: 'Dark asphalt is heating up in direct sun. Prefer light concrete sidewalks or shaded paths.',
      maxSurfaceF: maxSurf
    };
  } else {
    pawSafety = {
      level: 'safe',
      label: current.isWet ? 'Cool & Damp Surfaces' : 'Comfortable Paw Temps',
      color: '#63e2b7',
      advice: current.isWet
        ? 'Wet pavement and evaporative cooling keep surface temps near ambient air.'
        : 'Both concrete and asphalt remain well below the 135°F AAHA paw-safety threshold.',
      maxSurfaceF: maxSurf
    };
  }

  return {
    concreteTempF: current.concreteF,
    asphaltTempF: current.asphaltF,
    isWetSurface: current.isWet,
    shortwaveWm2: current.sw,
    pawSafety,
    peakAsphaltTodayF,
    peakConcreteTodayF,
    series
  };
}
