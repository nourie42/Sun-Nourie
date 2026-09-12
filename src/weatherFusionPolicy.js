/** User-selected weights, not a measured accuracy ranking. */
export const SAME_DAY_WEIGHTS = Object.freeze({nws: .4, hrrr: .3, ecmwf: .1, nbm: .2});
export const REPAIR_VERSION = 'weather-nourie-rain-base-v7';
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
  return SAME_DAY_WEIGHTS;
}
/** Match the evening that starts on this date, not the pre-dawn period ending today. */
export function eveningPeriod(periods, date, zone, now) {
  return periods.find(p => !p.isDaytime && Date.parse(p.endTime)>now && calendarDate(Date.parse(p.startTime),zone)===date &&
    Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.startTime)))>=12);
}
