/** User-selected weights, not a measured accuracy ranking. */
export const SAME_DAY_WEIGHTS = Object.freeze({nws: .4, hrrr: .4, ecmwf: .2});
export const REPAIR_VERSION = 'weather-nourie-morning-maps-v3';
export function calendarDate(time, zone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(time));
}
export function forecastDayIndex(time, now, zone) {
  return Math.max(0, Math.round((Date.parse(calendarDate(time,zone))-Date.parse(calendarDate(now,zone)))/86400000));
}
export function temperaturePolicy(index) {
  return index === 0 ? SAME_DAY_WEIGHTS : index === 1 ? {nws:.6,hrrr:.1,ecmwf:.2,nbm:.1} : {nws:.6,ecmwf:.25,nbm:.15};
}
export function precipitationPolicy(index) {
  return index === 0 ? SAME_DAY_WEIGHTS : {ecmwf:.6,nbm:.25,nws:.15};
}
/** Match the evening that starts on this date, not the pre-dawn period ending today. */
export function eveningPeriod(periods, date, zone, now) {
  return periods.find(p => !p.isDaytime && Date.parse(p.endTime)>now && calendarDate(Date.parse(p.startTime),zone)===date &&
    Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.startTime)))>=12);
}
