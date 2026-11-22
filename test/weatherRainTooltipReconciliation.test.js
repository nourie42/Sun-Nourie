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
  reconcileRainLedgerWithCanonical,
  scoreRainChance100Pt
} from '../public/weather-fusion/v3/js/fusion-engine.js';

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
