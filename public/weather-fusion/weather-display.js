import {hourlyUvValue,hourlyUvHTML} from './daily-uv.js?v=clear-weather-daygraph-v3';
import {outdoorExposure} from './outdoor-feels.js?v=clear-weather-daygraph-v3';
import {currentComfortInputs} from './current-inputs.js?v=clear-weather-daygraph-v3';
import {weatherState} from './weather-state.js';
import {thermalComfort, finite, solarElevation,rainChanceValue} from './weather-math.js?v=forecast-trace-v40';
import {feelsAt, forecastValue, degrees} from './hourly-feels.js?v=weather-art-labels-v10';
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
export function weatherMetricIcon(kind){
 const paths={wind:'M3 8h12c5 0 5-6 1-6M3 12h16c5 0 5 6 1 6M3 16h7c4 0 4 6 0 6',drop:'M12 2C9 7 5 12 5 16a7 7 0 0 0 14 0c0-4-4-9-7-14Z',sun:'M12 3V1M12 23v-2M3 12H1M23 12h-2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',humidity:'M12 2C9 7 5 12 5 16a7 7 0 0 0 14 0c0-4-4-9-7-14ZM9 18l6-7M9 12h.01M15 18h.01'};
 return `<svg class="weather-metric-icon" viewBox="0 0 24 24" fill="${kind==='drop'?'currentColor':'none'}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]||paths.wind}"/></svg>`;
}
export function windDirectionLabel(value){
 if(finite(value)&&value>=0&&value<=360)return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(value/22.5)%16];
 return typeof value==='string'&&/^(N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW|VRB)$/i.test(value)?value.toUpperCase():'—';
}
export function hourlyWindHTML(sample){
 const speed=sample.inputs?.wind,direction=windDirectionLabel(sample.windDirection);
 return `<span class="hour-wind" title="${sample.now?'Current':'Forecast'} wind">${weatherMetricIcon('wind')}<b>${finite(speed)&&speed>=0?`${Math.round(speed)} mph`:'— mph'}</b><small>${speed===0?'Calm':direction}</small></span>`;
}
export const HRRR_RAIN_THRESHOLD_IN=.01;
export function hrrrRainAmount(row){
 const value=row?.precipitationBlend?.sourceValues?.hrrr??row?.qpfBlend?.sourceValues?.hrrr;
 return finite(value)&&value>=HRRR_RAIN_THRESHOLD_IN?value:null;
}
export function hourlyRainHTML(sample){
 if(sample?.now&&sample.currentPrecipitation){
  const status=sample.currentPrecipitation;
  return `<span class="hour-rain" title="${esc(status.source)}"><small class="hour-pop">${weatherMetricIcon('drop')}${esc(status.label)}</small></span>`;
 }
 const blend=sample.rainLikelihood,value=sampleRainChance(sample);
 const votes=blend?.sourceValues||{},parts=[];
 if(finite(votes.nws))parts.push(`NWS ${Math.round(votes.nws)}%`);
 for(const id of ['hrrr','ecmwf'])if(finite(votes[id]))parts.push(`${id.toUpperCase()} QPF support ${Math.round(blend?.qpfSupport?.[id]??0)}/100, NWS-anchored input ${Math.round(votes[id])}%`);
 const detail=parts.length?` Inputs: ${parts.join(', ')}.`:'';
 return `<span class="hour-rain" title="Weather Nourie rain likelihood.${detail}"><small class="hour-pop">${weatherMetricIcon('drop')}${finite(value)?`${Math.round(value)}%`:'—'}</small></span>`;
}
function sampleRainChance(sample){
 return sample?.rainLikelihood&&Object.hasOwn(sample.rainLikelihood,'value')?rainChanceValue(sample.rainLikelihood):rainChanceValue(null,sample?.pop);
}
export function currentSample(forecast, now = Date.now()) {
  const current = currentComfortInputs(forecast,now), assembled = Date.parse(forecast?.assembledAt);
  const comfort = thermalComfort(current, forecast.location, finite(assembled) ? assembled : now);
  comfort.inputEvidence.estimatedFields=current.comfortEstimatedFields;
  comfort.inputEvidence.fallbackSources=current.comfortInputSources;
  const currentHour=forecast?.hours?.find(h=>Date.parse(h.time)<=now&&now<Date.parse(h.time)+3600000);
  const kind=weatherState(current.condition).kind,stationCondition=current.type==='observation'&&!/forecast/i.test(current.conditionSource||'')&&kind!=='unknown';
  const activePrecipitation=stationCondition&&['rain','storm','snow'].includes(kind);
  const radar=current.radarPrecipitation,radarReady=radar?.status==='ready';
  const radarHere=radarReady&&radar.atLocation===true,radarNearby=radarReady&&radar.nearby===true;
  const currentPrecipitation=activePrecipitation
    ? {active:true,label:kind==='snow'?'Snow now':'Rain now',source:'Current station reports precipitation.'}
    : radarHere
      ? {active:true,label:'Rain on radar',source:'NOAA observed radar shows precipitation at the selected location.'}
      : radarNearby
        ? {active:false,nearby:true,label:'Rain nearby',source:'NOAA observed radar shows precipitation near the selected location.'}
        : stationCondition
          ? {active:false,label:'Dry at station',source:'The nearby station reports no precipitation; radar is checked separately.'}
          : null;
  const currentLikelihood=activePrecipitation||radarHere?{value:100,source:activePrecipitation?'Current station observation':'NOAA observed radar'}:stationCondition?{value:0,source:'Current station observation'}:currentHour?.rainLikelihood;
  const displayCondition=radarHere&&!activePrecipitation?'Rain':current.condition;
  return {windDirection:current.windDirection,pop:rainChanceValue(currentLikelihood),officialPop:currentHour?.officialPop??currentHour?.pop,rainLikelihood:currentLikelihood,currentPrecipitation,precipitationBlend:currentHour?.precipitationBlend,uvIndex:hourlyUvValue(forecast,now),id:'now', now:true, time:current.time, temperature:finite(current.temperature) ? current.temperature : null,
    feels:outdoorExposure(comfort).value, exposure:outdoorExposure(comfort), comfort, condition:displayCondition || 'Sky conditions unavailable',
    isDay:comfort.daylight ?? (solarElevation(now,forecast.location.latitude,forecast.location.longitude) > 0),
    source:current.type === 'observation' ? 'Station observation' : 'Current estimate', inputs:current};
}
export function forecastSample(forecast, time) {
  const epoch = Date.parse(time), hour = forecast?.hours?.find(row => Date.parse(row.time) === epoch);
  const point = forecast?.metricForecasts?.series?.feels?.find(row => Date.parse(row.time) === epoch);
  if (!hour || !point) return null;
  const inputs = {...point.inputs, condition:hour.condition || point.condition || 'Sky conditions unavailable', type:'guidance'};
  const estimated = thermalComfort(inputs, forecast.location, epoch);
  const rounded=v=>finite(v)?Number(v.toFixed(1)):null;
  const value=rounded(estimated.rawOutdoors);
  if(finite(value)!==finite(point.value)||(finite(value)&&Math.abs(value-point.value)>.11))return null;
  const comfort={...estimated,outdoors:value,shade:rounded(estimated.rawShade),sun:estimated.sun===null?null:value};
  return {windDirection:hour.windDirectionDegrees??hour.windDirection,uvIndex:hourlyUvValue(forecast,epoch),id:new Date(epoch).toISOString(), now:false, time:hour.time,
    temperature:forecastValue(forecast,'temperature',hour.time), feels:feelsAt(forecast,hour.time),
    condition:inputs.condition, isDay:comfort.daylight, exposure:outdoorExposure(comfort), comfort, inputs, source:'Hourly forecast', pop:sampleRainChance(hour),officialPop:hour.officialPop??hour.pop,rainLikelihood:hour.rainLikelihood,precipitationBlend:hour.precipitationBlend};
}
export function hourlyDisplaySamples(forecast, now = Date.now()) {
  return [currentSample(forecast, now), ...(forecast?.hours || []).filter(hour => Date.parse(hour.time) > now)
    .map(hour => forecastSample(forecast,hour.time)).filter(Boolean)];
}
export function renderHourlyWeather(forecast, now = Date.now()) {
  const root = document.getElementById('hourly'); if (!root) return;
  const scroll = root.scrollLeft, zone = forecast.location.timeZone || 'America/New_York';
  const hour = time => new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(time)).replace(' ','');
  root.innerHTML = hourlyDisplaySamples(forecast,now).map(sample => `<button type="button" class="hour ${sample.now ? 'now hour-current' : 'forecast-hour'}" data-comfort-time="${esc(sample.id)}" data-time="${esc(sample.time)}" title="${esc(sample.condition)} · ${esc(sample.source)}" aria-label="${sample.now ? 'Now' : esc(hour(sample.time))}, ${esc(sample.condition)}, air ${degrees(sample.temperature)}, feels like ${degrees(sample.feels)} ${esc(sample.exposure.label.toLowerCase())}. Preview this weather."><span>${sample.now ? 'Now' : esc(hour(sample.time))}</span>${weatherIcon(sample.condition,sample.isDay)}<strong>${degrees(sample.temperature)}</strong><span class="hour-feels">Feels <b>${degrees(sample.feels)}</b><em class="hour-exposure sr-only">${esc(sample.exposure.shortLabel)}</em></span>${hourlyRainHTML(sample)}${hourlyUvHTML(sample.uvIndex)}${hourlyWindHTML(sample)}</button>`).join('');
  root.scrollLeft = scroll;
}
export function peakComparison(summary, currentShade) {
  if (!summary) return {kind:'missing', label:'Warmest feels like today unavailable', value:null, time:null, now:false};
  const peak = summary.chosen.value;
  if (summary.mode === 'day' && finite(currentShade) && currentShade > peak) {
    return {kind:'now', label:'Warmest feels like today', value:currentShade, time:summary.chosen.time, now:true, later:peak};
  }
  return {kind:'peak', label:summary.mode === 'day' ? 'Warmest feels like today' : summary.label, value:peak, time:summary.chosen.time, now:false};
}
export function peakComparisonHTML(summary, currentShade, zone = 'America/New_York', now=Date.now()) {
  const comparison = peakComparison(summary,currentShade);
  if(!summary&&finite(currentShade)){
    const clock=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(now));
    return `<div class="comfort-later" data-comparison="current-only"><span>Warmest feels like today</span><span class="peak-reading"><strong>${degrees(currentShade)}</strong></span><small>Now · ${esc(clock)} · later forecast unavailable</small></div>`;
  }
  if (!summary) return '<p class="comfort-later">Warmest feels like today unavailable. Missing readings stay blank.</p>';
  const clock=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(comparison.time));
  const time = comparison.now ? `Now · later peak ${degrees(comparison.later)} at ${clock}` : `${clock} · hourly forecast`;
  return `<div class="comfort-later" data-peak-time="${esc(comparison.time)}" data-comparison="${comparison.kind}"><span>${esc(comparison.label)}${summary.partial ? ' · partial forecast' : ''}</span><span class="peak-reading"><strong>${degrees(comparison.value)}</strong></span><small>${esc(time)}</small></div>`;
}
export function sampleCaption(sample, zone = 'America/New_York') {
  const valid = Number.isFinite(Date.parse(sample.time));
  const time = valid ? new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(sample.time)) : 'time unavailable';
  const station=sample.inputs?.station,km=sample.inputs?.stationDistanceKm;
  const site=station?` · ${station}${finite(km)?` · ${Math.round(km/1.609344)} mi away`:''}`:'';
  return sample.now ? `Current conditions · ${sample.source === 'Station observation' ? 'station estimate' : 'forecast estimate'}${site} at ${time}${sample.inputs?.comfortSourceNote?' · '+sample.inputs.comfortSourceNote:''}`
    : `${time} forecast · air ${degrees(sample.temperature)} · feels like ${degrees(sample.feels)} ${sample.exposure.label.toLowerCase()}`;
}

export function heroFeelsHTML(sample) {
  const source = sample.source === 'Station observation' ? 'based on the current station reading'+(sample.inputs.comfortSourceNote?' · '+sample.inputs.comfortSourceNote:'') : 'estimated from forecast data';
  return `Feels like <strong>${degrees(sample.feels)}</strong><small>${esc(sample.exposure.label)} · ${source}</small>`;
}
