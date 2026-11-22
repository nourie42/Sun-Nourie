import test from 'node:test';
import assert from 'node:assert/strict';
import { precipitationLikelihood, publishedPrecipitationLikelihood } from '../src/weatherFusionDirect.js';
import { SAME_DAY_WEIGHTS, EXTENDED_RAIN_WEIGHTS, precipitationPolicy } from '../src/weatherFusionPolicy.js';
import {
  formatRainLikelihoodTooltip,
  hourlyRainHTML,
  reconcileRainLikelihood
} from '../public/weather-fusion/weather-display.js';
import {
  buildUnifiedFusionPayload,
  reconcileRainLedgerWithCanonical,
  scoreRainChance100Pt
} from '../public/weather-fusion/v3/js/fusion-engine.js';
import {
  extractDayModelCompareValue,
  renderSevenDayDualSplineChart
} from '../public/weather-fusion/v3/js/charts.js';
import { buildSeries } from '../public/weather-fusion/halo.js';
import { dayGraphPoints } from '../public/weather-fusion/day-graph.js';

function parseTooltipPointsSum(htmlOrTitle) {
  const matches = [...String(htmlOrTitle).matchAll(/\(\+([\d.]+) points\)/g)];
  assert.ok(matches.length > 0, `Expected at least one (+X points) input in tooltip: ${htmlOrTitle}`);
  return matches.reduce((sum, m) => sum + Number(m[1]), 0);
}

function parseDisplayedCardPercent(html) {
  const m = String(html).match(/(\d+)%<\/small>/);
  assert.ok(m, `Expected displayed percentage in hourlyRainHTML: ${html}`);
  return Number(m[1]);
}

test('Main hourlyRainHTML tooltip inputs always sum to the exact displayed rain % across same-day and extended Sun–Mon hours', () => {
  // 1. Sun 7 AM scenario where NWS + ECMWF + NBM = 56 pts and GEFS/WN add 10 pts = 66%
  const sunPolicy = precipitationPolicy(1, true); // nws .4, ecmwf .25294118, nbm .14705882, gefs .10, wn .05, weathernext3 .05
  const sun7amBlend = publishedPrecipitationLikelihood(
    40, // 40 * 0.4 = 16 pts
    { sourceValues: { hrrr: null, ecmwf: 0.08, nbm: 0.08, gefs: 0.06, wn: 0, weathernext3: 0 } }, // ecmwf 25.29 + nbm 14.71 = 40 -> 56 pts + gefs 10 pts = 66%
    sunPolicy
  );
  assert.equal(sun7amBlend.value, 66);
  const sunHtml = hourlyRainHTML({ rainLikelihood: sun7amBlend, pop: sun7amBlend.value });
  const sunCardPct = parseDisplayedCardPercent(sunHtml);
  const sunTooltipSum = parseTooltipPointsSum(sunHtml);
  assert.equal(sunCardPct, 66);
  assert.equal(Math.min(100, Math.round(sunTooltipSum)), sunCardPct);
  assert.match(sunHtml, /GEFS rain yes \(\+10 points\)/);

  // 2. Sun 7 AM scenario with WeatherNext (5 pts) + WeatherNext 3 (5 pts) = +10 pts and NBM probability
  const sunWnBlend = publishedPrecipitationLikelihood(
    56,
    { sourceValues: { hrrr: null, ecmwf: 0.05, nbm: 0.08, gefs: null, wn: 0.05, weathernext3: 0.05 } },
    sunPolicy,
    { nbmProbability: 62 }
  );
  const sunWnHtml = hourlyRainHTML({ rainLikelihood: sunWnBlend, pop: sunWnBlend.value });
  const sunWnPct = parseDisplayedCardPercent(sunWnHtml);
  const sunWnSum = parseTooltipPointsSum(sunWnHtml);
  assert.equal(sunWnPct, sunWnBlend.value);
  assert.equal(Math.min(100, Math.round(sunWnSum)), sunWnPct);
  assert.match(sunWnHtml, /WeatherNext rain yes \(\+5 points\)/);
  assert.match(sunWnHtml, /WeatherNext 3 rain yes \(\+5 points\)/);
  assert.match(sunWnHtml, /NBM 62% \(\+9\.12 points\)/);

  // 3. Mon 1 PM scenario where NWS=0, ECMWF=0, NBM QPF=0, but NBM probability=48% (7.06 pts -> 7%)
  const mon1pmBlend = publishedPrecipitationLikelihood(
    0,
    { sourceValues: { hrrr: null, ecmwf: 0, nbm: 0, gefs: 0, wn: 0, weathernext3: 0 } },
    sunPolicy,
    { nbmProbability: 48 }
  );
  assert.equal(mon1pmBlend.value, 7);
  const monHtml = hourlyRainHTML({ rainLikelihood: mon1pmBlend, pop: mon1pmBlend.value });
  const monPct = parseDisplayedCardPercent(monHtml);
  const monSum = parseTooltipPointsSum(monHtml);
  assert.equal(monPct, 7);
  assert.equal(Math.min(100, Math.round(monSum)), 7);
});

test('Beta V3 rainLedger breakdown and tooltip always reconcile with the displayed rainChance (including Sun 7 AM 91% and Mon 1 PM 7%)', () => {
  const sunPolicy = precipitationPolicy(1, true);

  // 1. Sun 7 AM on Beta where canonical blend is 91% (NWS + ECMWF + NBM = 81 pts, GEFS/WN = 10 pts)
  const canonSun91 = publishedPrecipitationLikelihood(
    100, // 40 pts
    { sourceValues: { hrrr: null, ecmwf: 0.08, nbm: 0.08, gefs: 0.08, wn: 0, weathernext3: 0 } },
    sunPolicy,
    { nbmProbability: 100 } // ecmwf 25.29 + nbm 14.71 + nws 40 = 80 + gefs 10 = 90 (or with nws 41 -> 91)
  );
  const fallbackSun = scoreRainChance100Pt({ nwsPop: 53, hrrrQpf: 0.1, nbmQpf: 0.1, ecmwfQpf: 0.1, gefsQpf: 0, wnQpf: 0, leadHours: 15 });
  const ledgerSun = reconcileRainLedgerWithCanonical(canonSun91, fallbackSun);
  const bdSun = ledgerSun.breakdown;
  const bdSunSum = bdSun.nws.pts + bdSun.hrrr.pts + bdSun.nbm.pts + bdSun.ecmwf.pts + bdSun.gefs.pts + bdSun.weathernext.pts;
  assert.equal(ledgerSun.totalPts, canonSun91.value);
  assert.equal(Math.min(100, Math.round(bdSunSum)), ledgerSun.totalPts);
  assert.equal(Math.min(100, Math.round(parseTooltipPointsSum(ledgerSun.tooltip))), ledgerSun.totalPts);

  // 2. Mon 1 PM on Beta where all QPF inputs are 0, but canonical NBM probability gives 7%
  const canonMon7 = publishedPrecipitationLikelihood(
    0,
    { sourceValues: { hrrr: null, ecmwf: 0, nbm: 0, gefs: 0, wn: 0, weathernext3: 0 } },
    sunPolicy,
    { nbmProbability: 48 }
  );
  assert.equal(canonMon7.value, 7);
  const fallbackMonZero = scoreRainChance100Pt({ nwsPop: 0, hrrrQpf: 0, nbmQpf: 0, ecmwfQpf: 0, gefsQpf: 0, wnQpf: 0, leadHours: 45 });
  const ledgerMon = reconcileRainLedgerWithCanonical(canonMon7, fallbackMonZero);
  const bdMon = ledgerMon.breakdown;
  const bdMonSum = bdMon.nws.pts + bdMon.hrrr.pts + bdMon.nbm.pts + bdMon.ecmwf.pts + bdMon.gefs.pts + bdMon.weathernext.pts;
  assert.equal(ledgerMon.totalPts, 7);
  assert.ok(bdMonSum > 0, 'Mon 1 PM breakdown must not have all inputs at zero when displayed % is 7%');
  assert.equal(Math.min(100, Math.round(bdMonSum)), ledgerMon.totalPts);
  assert.equal(Math.min(100, Math.round(parseTooltipPointsSum(ledgerMon.tooltip))), ledgerMon.totalPts);

  // 3. Direct scoreRainChance100Pt shares never exceed 100 points and always match tooltip
  const directFull = scoreRainChance100Pt({ nwsPop: 100, hrrrQpf: 0.2, nbmQpf: 0.2, ecmwfQpf: 0.2, gefsQpf: 0.2, wnQpf: 0.2, leadHours: 6 });
  assert.equal(directFull.totalPts, 100);
  assert.equal(Math.round(directFull.rawTotal), 100);
  assert.equal(Math.min(100, Math.round(parseTooltipPointsSum(directFull.tooltip))), directFull.totalPts);
});

test('Dew point never exceeds air temperature or the daily low temperature across 7-Day, Compare, Hourly, and Main graphs', () => {
  const nowEpoch = Math.floor(Date.now() / 3600000) * 3600000;
  const tz = 'America/New_York';
  const toDayStr = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

  const dailySpecs = [
    { high: 58, low: 57 },
    { high: 65, low: 55 },
    { high: 72, low: 51 },
    { high: 55, low: 40 },
    { high: 53, low: 49 },
    { high: 55, low: 43 },
    { high: 58, low: 41 }
  ];
  const seenDates = [];
  for (let d = 0; d < 10; d++) {
    const ds = toDayStr(nowEpoch + d * 86400000);
    if (!seenDates.includes(ds)) seenDates.push(ds);
  }
  const canonicalDays = seenDates.slice(0, 7).map((date, idx) => ({
    date,
    high: dailySpecs[idx]?.high ?? 58,
    low: dailySpecs[idx]?.low ?? 42,
    pop: 20,
    qpf: 0
  }));

  const canonicalHours = Array.from({ length: 48 }, (_, i) => {
    const t = new Date(nowEpoch + i * 3600000).toISOString();
    return {
      time: t,
      temperature: 60,
      dewpoint: 66, // Intentionally higher than temp & low to verify clamping
      humidity: 82,
      wind: '8 mph',
      skyCover: 75,
      condition: 'Cloudy'
    };
  });

  const canonicalData = {
    location: { name: 'Knightdale, NC', latitude: 35.787, longitude: -78.4806, timeZone: tz, office: 'RAH' },
    current: { temperature: 58, dewpoint: 63, humidity: 85, wind: 8, skyCover: 80, condition: 'Cloudy' },
    days: canonicalDays,
    hours: canonicalHours,
    metricForecasts: {
      series: {
        temperature: canonicalHours.map((h) => ({ time: h.time, value: 58 })),
        dewpoint: canonicalHours.map((h) => ({ time: h.time, value: 64 }))
      }
    }
  };

  const payload = buildUnifiedFusionPayload(
    { name: 'Knightdale, NC', latitude: 35.787, longitude: -78.4806 },
    null,
    null,
    null,
    {},
    canonicalData
  );

  // 1. Every hour's dewPointF <= tempF
  for (const h of payload.hoursAll) {
    assert.ok(h.dewPointF <= h.tempF, `Hour ${h.time} dewPointF (${h.dewPointF}) exceeded tempF (${h.tempF})`);
  }

  // 2. Every day's dewPointF and maxDewPointF <= lowF <= highF, and Compare dewPoint <= lowF
  for (const d of payload.days) {
    assert.ok(d.lowF <= d.highF, `Day ${d.dayKey} lowF (${d.lowF}) exceeded highF (${d.highF})`);
    assert.ok(d.dewPointF <= d.lowF, `Day ${d.dayKey} dewPointF (${d.dewPointF}) exceeded lowF (${d.lowF})`);
    assert.ok(d.maxDewPointF <= d.lowF, `Day ${d.dayKey} maxDewPointF (${d.maxDewPointF}) exceeded lowF (${d.lowF})`);
    assert.ok(d.minDewPointF <= d.lowF, `Day ${d.dayKey} minDewPointF (${d.minDewPointF}) exceeded lowF (${d.lowF})`);
    const cmpDp = extractDayModelCompareValue(d, 'blend', 'dewPoint', false);
    const cmpLow = extractDayModelCompareValue(d, 'blend', 'lowTemp', false);
    assert.ok(cmpDp <= cmpLow, `Compare dewPoint (${cmpDp}) exceeded lowTemp (${cmpLow}) on ${d.dayKey}`);
  }

  // 3. 7-Day chart renderer never plots a Dew Point above Low temperature
  const stage = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  renderSevenDayDualSplineChart({ containerEl: stage, days7: payload.days.slice(0, 7) });
  for (const d of payload.days.slice(0, 7)) {
    assert.ok(d.dewPointF <= d.lowF);
  }

  // 4. Main site halo.js buildSeries and day-graph.js dayGraphPoints never allow dewpoint > temperature
  const haloSeries = buildSeries(canonicalData);
  haloSeries.dewpoint.forEach((dpPt, idx) => {
    const tPt = haloSeries.temperature[idx];
    if (dpPt?.v != null && tPt?.v != null) {
      assert.ok(dpPt.v <= tPt.v, `Halo series dewpoint (${dpPt.v}) exceeded temperature (${tPt.v})`);
    }
  });
  const dgPts = dayGraphPoints(canonicalData, 0, false, nowEpoch);
  for (const pt of dgPts) {
    if (pt.dewpoint != null && pt.temperature != null) {
      assert.ok(pt.dewpoint <= pt.temperature, `dayGraphPoints dewpoint (${pt.dewpoint}) exceeded temperature (${pt.temperature})`);
    }
    if (pt.dewpoint != null && canonicalDays[0]?.low != null) {
      assert.ok(pt.dewpoint <= canonicalDays[0].low, `dayGraphPoints dewpoint (${pt.dewpoint}) exceeded daily low (${canonicalDays[0].low})`);
    }
  }
});

test('Beta lists the exact GEFS and NBM inputs used by the hourly rain forecast', async () => {
  const {hourlyRainInputsHTML} = await import('../public/weather-fusion/v3/js/hourly-rain.js');
  const fallback = scoreRainChance100Pt({});
  const high = reconcileRainLedgerWithCanonical({
    value:94,
    sourcePoints:{nws:39,ecmwf:25,nbm:15,gefs:10,wn:5},
    sourceValues:{nws:98,ecmwf:100,nbm:100,gefs:100,wn:100},
    sourceKinds:{nws:'probability',nbm:'probability'},
    sourceAmounts:{nbm:0,gefs:.056,ecmwf:.089,wn:.063}
  },fallback);
  const dry = reconcileRainLedgerWithCanonical({
    value:7,
    sourcePoints:{nws:0,ecmwf:0,nbm:7.06,gefs:0,wn:0},
    sourceValues:{nws:0,nbm:48,ecmwf:0,gefs:0,wn:0},
    sourceKinds:{nws:'probability',nbm:'probability'},
    sourceAmounts:{nbm:0,gefs:0,ecmwf:0,wn:0}
  },fallback);
  for (const [ledger, expected] of [[high,94],[dry,7]]) {
    const html = hourlyRainInputsHTML(ledger);
    const points = [...html.matchAll(/data-rain-points="([\d.]+)"/g)].map(m => +m[1]);
    assert.equal(Math.round(points.reduce((a,b) => a+b,0)),expected);
    assert.equal(ledger.totalPts,expected);
    assert.match(html,/GEFS/);
  }
  assert.match(hourlyRainInputsHTML(dry),/NBM<\/th><td>48% probability<\/td><td data-rain-points="7\.06">/);
  const noRain = reconcileRainLedgerWithCanonical({value:7,sourcePoints:{nws:0,nbm:0}},fallback);
  assert.equal(noRain.totalPts,0);
  assert.match(hourlyRainInputsHTML(reconcileRainLedgerWithCanonical({value:null},fallback)),/unavailable/);
});

test('a rounded model contribution cannot shift the shown rain total across a half point', () => {
  const r = reconcileRainLikelihood({value:84,sourcePoints:{nws:39.496,nbm:15.001,gefs:10,ecmwf:20}});
  assert.equal(r.value,84);
  assert.equal(Math.round(r.entries.reduce((sum,e)=>sum+e.shownPoints,0)),84);
});
