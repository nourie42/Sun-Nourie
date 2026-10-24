/**
 * Researched blend weights (2026-10-24): shares shrink toward equal weighting,
 * step with lead time, and cap correlated families (NWS+NBM start from the
 * same grids; ECMWF+WeatherNext share ERA5/HRES heritage). GFS has no point
 * feed in this pipeline, so its researched share is redistributed
 * proportionally among the remaining sources. Each band lists shares WITH
 * WeatherNext; when WeatherNext is unavailable its share is redistributed
 * proportionally too. Precipitation shares score rain probability — amounts
 * keep the same band shares on their own weighted average.
 */
function band(weights) {
  const {wn = 0, ...rest} = weights;
  const total = Object.values(rest).reduce((sum, weight) => sum + weight, 0);
  const withoutWn = Object.freeze(Object.fromEntries(Object.entries(rest).map(([id, weight]) => [id, Number((weight / total).toFixed(8))])));
  return Object.freeze({withWn: Object.freeze({...weights}), withoutWn});
}
const TEMPERATURE_BANDS = Object.freeze([
  band({nws: .21, hrrr: .26, ecmwf: .11, nbm: .26, wn: .16}), // Day 0-1
  band({nws: .22, ecmwf: .22, nbm: .28, wn: .28}),            // Days 2-3
  band({nws: .12, ecmwf: .24, nbm: .29, wn: .35}),            // Days 4-7
  band({ecmwf: .38, nbm: .12, wn: .50}),                      // Days 8-15
]);
const PRECIPITATION_BANDS = Object.freeze([
  band({nws: .21, hrrr: .32, ecmwf: .11, nbm: .26, wn: .10}), // Day 0-1
  band({nws: .22, ecmwf: .22, nbm: .34, wn: .22}),            // Days 2-3
  band({nws: .11, ecmwf: .33, nbm: .28, wn: .28}),            // Days 4-7
  band({ecmwf: .44, nbm: .12, wn: .44}),                      // Days 8-15
]);
export const BLEND_BAND_LABELS = Object.freeze(['Day 0-1', 'Days 2-3', 'Days 4-7', 'Days 8-15']);
function bandIndex(index) {
  return index <= 1 ? 0 : index <= 3 ? 1 : index <= 7 ? 2 : 3;
}
function bandPolicy(bands, index, weatherNext) {
  const selected = bands[bandIndex(Math.max(0, index))];
  return weatherNext ? selected.withWn : selected.withoutWn;
}
/** Today's temperature shares without WeatherNext (legacy export). */
export const SAME_DAY_WEIGHTS = TEMPERATURE_BANDS[0].withoutWn;
/** Days 2-3 precipitation shares without WeatherNext (legacy exports). */
export const EXTENDED_RAIN_WEIGHTS = PRECIPITATION_BANDS[1].withoutWn;
export const EXTENDED_QPF_WEIGHTS = PRECIPITATION_BANDS[1].withoutWn;
/** WeatherNext's Day 0-1 temperature share (display metadata). */
export const WEATHERNEXT_WEIGHT = .16;
/** Bands carry their WeatherNext share already; strip it when unavailable. */
export function weatherNextPolicy(policy, available = false) {
  if (available || !policy || policy.wn == null) return policy;
  const {wn, ...rest} = policy;
  const total = Object.values(rest).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(Object.entries(rest).map(([id, weight]) => [id, Number((weight / total).toFixed(8))]));
}
export const REPAIR_VERSION = 'weather-nourie-researched-blend-v16';
export function calendarDate(time, zone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(time));
}
export function forecastDayIndex(time, now, zone) {
  return Math.max(0, Math.round((Date.parse(calendarDate(time,zone))-Date.parse(calendarDate(now,zone)))/86400000));
}
export function temperaturePolicy(index, weatherNext = false) {
  return bandPolicy(TEMPERATURE_BANDS, index, weatherNext);
}
export function precipitationPolicy(index, weatherNext = false) {
  return bandPolicy(PRECIPITATION_BANDS, index, weatherNext);
}
export function precipitationAmountPolicy(index, weatherNext = false) {
  return bandPolicy(PRECIPITATION_BANDS, index, weatherNext);
}
export function blendBands(weatherNext = false) {
  return {
    temperature: TEMPERATURE_BANDS.map((entry, i) => ({label: BLEND_BAND_LABELS[i], weights: weatherNext ? entry.withWn : entry.withoutWn})),
    precipitation: PRECIPITATION_BANDS.map((entry, i) => ({label: BLEND_BAND_LABELS[i], weights: weatherNext ? entry.withWn : entry.withoutWn})),
  };
}
/** Match the evening that starts on this date, not the pre-dawn period ending today. */
export function eveningPeriod(periods, date, zone, now) {
  return periods.find(p => !p.isDaytime && Date.parse(p.endTime)>now && calendarDate(Date.parse(p.startTime),zone)===date &&
    Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.startTime)))>=12);
}
