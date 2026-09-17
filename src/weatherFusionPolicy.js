/** User-selected weights, not a measured accuracy ranking. */
export const SAME_DAY_WEIGHTS = Object.freeze({nws: .4, hrrr: .3, ecmwf: .1, nbm: .2});
export const EXTENDED_RAIN_WEIGHTS = Object.freeze({nws: 1});
export const EXTENDED_QPF_WEIGHTS = Object.freeze({nws: .15, ecmwf: .6, nbm: .25});
export const REPAIR_VERSION = 'weather-nourie-rain-base-v10';
export function calendarDate(time, zone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(time));
}
export function forecastDayIndex(time, now, zone) {
  return Math.max(0, Math.round((Date.parse(calendarDate(time,zone))-Date.parse(calendarDate(now,zone)))/86400000));
}
export function temperaturePolicy(index) {
  return SAME_DAY_WEIGHTS;
}
export function precipitationPolicy(index) {
  return index === 0 ? SAME_DAY_WEIGHTS : EXTENDED_RAIN_WEIGHTS;
}
export function precipitationAmountPolicy(index) {
  return index === 0 ? SAME_DAY_WEIGHTS : EXTENDED_QPF_WEIGHTS;
}
/** Match the evening that starts on this date, not the pre-dawn period ending today. */
export function eveningPeriod(periods, date, zone, now) {
  return periods.find(p => !p.isDaytime && Date.parse(p.endTime)>now && calendarDate(Date.parse(p.startTime),zone)===date &&
    Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.startTime)))>=12);
}
