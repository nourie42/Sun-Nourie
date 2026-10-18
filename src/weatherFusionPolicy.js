/** User-selected weights, not a measured accuracy ranking. */
export const SAME_DAY_WEIGHTS = Object.freeze({nws: .4, hrrr: .3, ecmwf: .1, nbm: .2});
export const EXTENDED_RAIN_WEIGHTS = Object.freeze({nws: .15, ecmwf: .6, nbm: .25});
export const EXTENDED_QPF_WEIGHTS = Object.freeze({nws: .15, ecmwf: .6, nbm: .25});
export const WEATHERNEXT_WEIGHT = .10;
/** Keep the existing relative shares and reserve the established NVIDIA share. */
export function weatherNextPolicy(policy, available = false) {
  return available ? {...Object.fromEntries(Object.entries(policy).map(([id, weight])=>[id, Number((weight * (1-WEATHERNEXT_WEIGHT)).toFixed(8))])), wn:WEATHERNEXT_WEIGHT} : policy;
}
export const REPAIR_VERSION = 'weather-nourie-nvidia-blend-v15';
export function calendarDate(time, zone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(time));
}
export function forecastDayIndex(time, now, zone) {
  return Math.max(0, Math.round((Date.parse(calendarDate(time,zone))-Date.parse(calendarDate(now,zone)))/86400000));
}
export function temperaturePolicy(index, weatherNext = false) {
  return weatherNextPolicy(SAME_DAY_WEIGHTS, weatherNext);
}
export function precipitationPolicy(index, weatherNext = false) {
  return weatherNextPolicy(index === 0 ? SAME_DAY_WEIGHTS : EXTENDED_RAIN_WEIGHTS, weatherNext);
}
export function precipitationAmountPolicy(index, weatherNext = false) {
  return weatherNextPolicy(index === 0 ? SAME_DAY_WEIGHTS : EXTENDED_QPF_WEIGHTS, weatherNext);
}
/** Match the evening that starts on this date, not the pre-dawn period ending today. */
export function eveningPeriod(periods, date, zone, now) {
  return periods.find(p => !p.isDaytime && Date.parse(p.endTime)>now && calendarDate(Date.parse(p.startTime),zone)===date &&
    Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.startTime)))>=12);
}
