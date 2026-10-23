import { weatherDateTimeFormat } from './weatherDateTimeFormat.js';

/** User-selected weights, not a measured accuracy ranking. */
export const SAME_DAY_WEIGHTS = Object.freeze({nws: .4, hrrr: .3, ecmwf: .1, nbm: .2});
// Rain chance always reserves the user-required 40-point share for NWS.
// With HRRR unavailable after the current local day, the remaining 60 points
// retain the established ECMWF:NBM ratio (60:25).
export const EXTENDED_RAIN_WEIGHTS = Object.freeze({nws: .4, ecmwf: .42352941, nbm: .17647059});
export const EXTENDED_QPF_WEIGHTS = Object.freeze({nws: .15, ecmwf: .6, nbm: .25});
export const WEATHERNEXT_WEIGHT = .10;
/** Keep the existing relative shares and reserve the established Google WeatherNext share. */
export function weatherNextPolicy(policy, available = false) {
  return available ? {...Object.fromEntries(Object.entries(policy).map(([id, weight])=>[id, Number((weight * (1-WEATHERNEXT_WEIGHT)).toFixed(8))])), wn:WEATHERNEXT_WEIGHT} : policy;
}
/** Add WeatherNext without reducing the fixed 40-point NWS rain share. */
export function weatherNextRainPolicy(policy, available = false) {
  if(!available)return policy;
  const nws=policy.nws;
  const models=Object.entries(policy).filter(([id,weight])=>id!=='nws'&&weight>0);
  const modelTotal=models.reduce((sum,[,weight])=>sum+weight,0);
  const availableModelShare=1-nws-WEATHERNEXT_WEIGHT;
  return {nws,...Object.fromEntries(models.map(([id,weight])=>[id,Number((weight*availableModelShare/modelTotal).toFixed(8))])),wn:WEATHERNEXT_WEIGHT};
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
export function precipitationAmountPolicy(index, weatherNext = false) {
  return weatherNextPolicy(index === 0 ? SAME_DAY_WEIGHTS : EXTENDED_QPF_WEIGHTS, weatherNext);
}
/** Match the evening that starts on this date, not the pre-dawn period ending today. */
export function eveningPeriod(periods, date, zone, now) {
  return periods.find(p => !p.isDaytime && Date.parse(p.endTime)>now && calendarDate(Date.parse(p.startTime),zone)===date &&
    Number(weatherDateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.startTime)))>=12);
}
