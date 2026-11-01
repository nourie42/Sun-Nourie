import { weatherDateTimeFormat } from './weatherDateTimeFormat.js';

/** User-selected weights, not a measured accuracy ranking. */
export const SAME_DAY_WEIGHTS = Object.freeze({nws: .4, hrrr: .3, ecmwf: .1, nbm: .2});
// Rain chance always reserves the user-required 40-point share for NWS.
// With HRRR unavailable after the current local day, the remaining 60 points
// split ECMWF 30.35 / NBM 17.65 / GEFS 12. Owner decision 2026-11-01: the
// GEFS share is carved from ECMWF (42.35 -> 30.35) so every available model
// contributes to the rain chance; NBM's share is unchanged.
export const EXTENDED_RAIN_WEIGHTS = Object.freeze({nws: .4, ecmwf: .30352941, nbm: .17647059, gefs: .12});
export const EXTENDED_QPF_WEIGHTS = Object.freeze({nws: .15, ecmwf: .6, nbm: .25});
export const WEATHERNEXT_WEIGHT = .10;
/** Keep the existing relative shares and reserve the established Google WeatherNext share. */
export function weatherNextPolicy(policy, available = false) {
  return available ? {...Object.fromEntries(Object.entries(policy).map(([id, weight])=>[id, Number((weight * (1-WEATHERNEXT_WEIGHT)).toFixed(8))])), wn:WEATHERNEXT_WEIGHT} : policy;
}
/** Add the Google feeds without reducing the fixed 40-point NWS rain share.
 * Owner decision 2026-11-01: the two WeatherNext feeds split the established
 * 10-point Google share (5 each) instead of WeatherNext taking all 10, the
 * same one-family-one-vote treatment the amount policies already use. */
export function weatherNextRainPolicy(policy, available = false) {
  if(!available)return policy;
  const nws=policy.nws;
  const models=Object.entries(policy).filter(([id,weight])=>id!=='nws'&&weight>0);
  const modelTotal=models.reduce((sum,[,weight])=>sum+weight,0);
  const availableModelShare=1-nws-WEATHERNEXT_WEIGHT;
  return {nws,...Object.fromEntries(models.map(([id,weight])=>[id,Number((weight*availableModelShare/modelTotal).toFixed(8))])),wn:WEATHERNEXT_WEIGHT/2,weathernext3:WEATHERNEXT_WEIGHT/2};
}
export const REPAIR_VERSION = 'weather-nourie-nvidia-blend-v16';
export function calendarDate(time, zone = 'America/New_York') {
  return weatherDateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(time));
}
export function forecastDayIndex(time, now, zone) {
  return Math.max(0, Math.round((Date.parse(calendarDate(time,zone))-Date.parse(calendarDate(now,zone)))/86400000));
}
export function temperaturePolicy(index, weatherNext = false) {
  return weatherNextPolicy(SAME_DAY_WEIGHTS, weatherNext);
}
export function precipitationPolicy(index, weatherNext = false) {
  return weatherNextRainPolicy(index === 0 ? SAME_DAY_WEIGHTS : EXTENDED_RAIN_WEIGHTS, weatherNext);
}
// The first three local days use the owner amount weights. weighted()
// renormalizes over sources that have data. From day three, every available
// source is averaged, and the two Google WeatherNext feeds share one vote.
export const AVERAGED_QPF_FIRST_DAY = 3;
export function averagedPrecipitationAmountPolicy(index, weatherNext = false) {
  if (index < AVERAGED_QPF_FIRST_DAY) return precipitationAmountPolicy(index, weatherNext);
  return {nws:1, nbm:1, ecmwf:1, gefs:1, wn:.5, weathernext3:.5};
}
export function precipitationAmountPolicy(index, weatherNext = false) {
  return weatherNextPolicy(index === 0 ? SAME_DAY_WEIGHTS : EXTENDED_QPF_WEIGHTS, weatherNext);
}
/** Match the evening that starts on this date, not the pre-dawn period ending today. */
export function eveningPeriod(periods, date, zone, now) {
  return periods.find(p => !p.isDaytime && Date.parse(p.endTime)>now && calendarDate(Date.parse(p.startTime),zone)===date &&
    Number(weatherDateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.startTime)))>=12);
}
