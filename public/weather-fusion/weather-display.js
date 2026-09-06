import {weatherState} from './weather-state.js';
import {thermalComfort, finite, solarElevation} from './weather-math.js';
import {feelsAt, forecastValue, degrees} from './hourly-feels.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function weatherShapes(condition, isDay = true) {
  const weather = weatherState(condition);
  const sun = '<g class="sky-sun"><circle cx="18" cy="16" r="8" fill="#ffdb83"/><path d="M18 3V0M18 29v3M5 16H2M31 16h3M8 6L6 4M28 26l2 2M8 26l-2 2M28 6l2-2" stroke="#ffdb83" stroke-width="2.3" stroke-linecap="round"/></g>';
  const moon = '<path class="sky-moon" d="M27 5A13 13 0 1 0 36 27 14 14 0 0 1 27 5" fill="#e6eaf5"/>';
  const cloud = '<g class="sky-cloud"><path d="M10 32a8 8 0 0 1-1-16 12 12 0 0 1 22-4 9 9 0 1 1 5 20Z" fill="#e4edf8"/><path d="M10 32h26a9 9 0 0 0 7-3H7a8 8 0 0 0 3 3" fill="#bcd3e7"/></g>';
  if (weather.kind === 'clear') return isDay ? `<g transform="translate(7 8)">${sun}</g>` : moon;
  if (weather.kind === 'partly-cloudy') return (isDay ? sun : moon) + cloud;
  if (weather.kind === 'cloudy') return cloud;
  if (weather.kind === 'rain') return cloud + '<path class="sky-rain" d="m14 38-2 5m13-5-2 5m13-5-2 5" stroke="#9fdcff" stroke-width="3" stroke-linecap="round"/>';
  if (weather.kind === 'storm') return cloud + '<path class="sky-lightning" d="m23 31-5 10h6l-2 7 11-14h-7l3-5" fill="#ffdd83"/>';
  if (weather.kind === 'snow') return cloud + '<g class="sky-snow" fill="#d8f1ff"><circle cx="14" cy="40" r="2"/><circle cx="25" cy="43" r="2"/><circle cx="36" cy="39" r="2"/></g>';
  if (weather.kind === 'fog') return cloud + '<path class="sky-fog" d="M9 38h29M13 44h21" stroke="#c9dfed" stroke-width="2.5" stroke-linecap="round"/>';
  return '<g class="sky-unknown"><circle cx="25" cy="25" r="17" fill="none" stroke="#b5cce1" stroke-width="2"/><path d="M20 19a6 6 0 1 1 9 5q-4 2-4 5" fill="none" stroke="#d7e6f6" stroke-width="2.5" stroke-linecap="round"/><circle cx="25" cy="35" r="1.7" fill="#d7e6f6"/></g>';
}
export function weatherIcon(condition = '', isDay = true, size = 32) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 50 50" aria-hidden="true" data-weather-kind="${weatherState(condition).kind}">${weatherShapes(condition, isDay)}</svg>`;
}
export function currentSample(forecast, now = Date.now()) {
  const current = forecast?.current || {}, assembled = Date.parse(forecast?.assembledAt);
  const comfort = forecast.comfort || thermalComfort(current, forecast.location, finite(assembled) ? assembled : now);
  return {id:'now', now:true, time:current.time, temperature:finite(current.temperature) ? current.temperature : null,
    feels:comfort.outdoors, comfort, condition:current.condition || 'Sky conditions unavailable',
    isDay:comfort.daylight ?? (solarElevation(now,forecast.location.latitude,forecast.location.longitude) > 0),
    source:current.type === 'observation' ? 'Station observation' : 'Current estimate', inputs:current};
}
export function forecastSample(forecast, time) {
  const epoch = Date.parse(time), hour = forecast?.hours?.find(row => Date.parse(row.time) === epoch);
  const point = forecast?.metricForecasts?.series?.feels?.find(row => Date.parse(row.time) === epoch);
  if (!hour || !point) return null;
  const inputs = {...point.inputs, condition:hour.condition || 'Sky conditions unavailable', type:'guidance'};
  const comfort = {...thermalComfort(inputs, forecast.location, epoch), outdoors:point.value};
  return {id:new Date(epoch).toISOString(), now:false, time:hour.time,
    temperature:forecastValue(forecast,'temperature',hour.time), feels:feelsAt(forecast,hour.time),
    condition:inputs.condition, isDay:comfort.daylight, comfort, inputs, source:'Hourly forecast', pop:hour.pop};
}
export function hourlyDisplaySamples(forecast, now = Date.now()) {
  return [currentSample(forecast, now), ...(forecast?.hours || []).filter(hour => Date.parse(hour.time) > now)
    .map(hour => forecastSample(forecast,hour.time)).filter(Boolean)];
}
export function renderHourlyWeather(forecast, now = Date.now()) {
  const root = document.getElementById('hourly'); if (!root) return;
  const scroll = root.scrollLeft, zone = forecast.location.timeZone || 'America/New_York';
  const hour = time => new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(time)).replace(' ','');
  root.innerHTML = hourlyDisplaySamples(forecast,now).map(sample => `<button type="button" class="hour ${sample.now ? 'now hour-current' : 'forecast-hour'}" data-comfort-time="${esc(sample.id)}" data-time="${esc(sample.time)}" title="${esc(sample.condition)} · ${esc(sample.source)}" aria-label="${sample.now ? 'Now' : esc(hour(sample.time))}, ${esc(sample.condition)}, air ${degrees(sample.temperature)}, feels like ${degrees(sample.feels)}. Preview this weather."><span>${sample.now ? 'Now' : esc(hour(sample.time))}</span>${weatherIcon(sample.condition,sample.isDay)}<strong>${degrees(sample.temperature)}</strong><span class="hour-feels">Feels like<b>${degrees(sample.feels)}</b></span><small>${sample.now ? 'Current' : finite(sample.pop) ? `${Math.round(sample.pop)}%` : '—'}</small></button>`).join('');
  root.scrollLeft = scroll;
}
export function peakComparison(summary,currentValue){
 if(!summary)return {kind:'missing',label:'Later forecast unavailable',value:null,isNow:false};
 const low=summary.mode!=='day',chosen=summary.chosen.value;
 const isNow=finite(currentValue)&&(low?currentValue<=chosen:currentValue>=chosen);
 return {kind:isNow?'now':'forecast',label:low?'Coolest from now on':'Warmest from now on',value:isNow?currentValue:chosen,isNow};
}
export function peakComparisonHTML(summary,currentValue,zone='America/New_York'){
 const x=peakComparison(summary,currentValue);
 if(!summary)return '<p class="comfort-later">Later forecast unavailable. Missing readings stay blank.</p>';
 const when=x.isNow?'Now':new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(summary.chosen.time));
 return `<div class="comfort-later" data-peak-time="${x.isNow?'now':esc(summary.chosen.time)}" data-comparison="${x.kind}"><span>${esc(x.label)}${summary.partial?' · partial forecast':''}</span><strong>${degrees(x.value)}</strong><small>${when} · ${x.isNow?(summary.mode==='day'?'Current reading is highest; later forecast is no warmer':'Current reading is lowest; later forecast is no colder'):'Same hourly weather-exposure estimate'}</small></div>`;
}
export function sampleCaption(sample, zone = 'America/New_York') {
  const valid = Number.isFinite(Date.parse(sample.time));
  const time = valid ? new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(sample.time)) : 'time unavailable';
  return sample.now ? `Current conditions · ${sample.source === 'Station observation' ? 'station reading' : 'estimate'} at ${time}`
    : `${time} forecast · air ${degrees(sample.temperature)} · feels like ${degrees(sample.feels)} in this weather`;
}
