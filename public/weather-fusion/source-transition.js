import {finite,thermalComfort} from './weather-math.js';
const H=3600000;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const degrees=v=>finite(v)?`${Math.round(v)}°`:'unavailable';
const wind=v=>!finite(v)?'unavailable':v<.5?'calm':`${Math.round(v)} mph`;
/** A diagnostic comparison, never an adjustment to either sample. Each solar
 * effect holds the same hour's T/dewpoint/wind fixed and changes only exposure. */
export function sourceTransition(forecast,now=Date.now()){
  const c=forecast?.current,points=forecast?.metricForecasts?.series?.feels||[];
  if(!c||!forecast?.location)return null;
  const next=points.find(p=>Date.parse(p.time)>now&&Date.parse(p.time)<=now+2*H&&finite(p.value));
  if(!next)return null;
  const at=Date.parse(forecast.assembledAt),current=thermalComfort(c,forecast.location,finite(at)?at:now);
  const nextComfort=thermalComfort({...next.inputs,condition:next.condition},forecast.location,Date.parse(next.time));
  return {sourceType:c.type,station:c.station,stationName:c.stationName||c.station,distanceMiles:finite(c.stationDistanceKm)?c.stationDistanceKm/1.609344:null,
    observedAt:c.time,observationAgeMinutes:finite(Date.parse(c.time))?Math.max(0,(now-Date.parse(c.time))/60000):null,
    currentAir:c.temperature,currentWind:c.wind,currentDewpoint:c.dewpoint,currentFeels:current.rawOutdoors,
    time:next.time,air:next.inputs?.temperature,wind:next.inputs?.wind,dewpoint:next.inputs?.dewpoint,feels:nextComfort.rawOutdoors,
    shade:nextComfort.rawShade,daylight:nextComfort.daylight,solarEffect:finite(nextComfort.rawOutdoors)&&finite(nextComfort.rawShade)?nextComfort.rawOutdoors-nextComfort.rawShade:null,
    temperatureDifference:finite(c.temperature)&&finite(next.inputs?.temperature)?next.inputs.temperature-c.temperature:null,
    windDifference:finite(c.wind)&&finite(next.inputs?.wind)?next.inputs.wind-c.wind:null};
}
export function solarEffectText(comfort){
  if(comfort?.daylight===false)return 'No sunlight at this hour.';
  const effect=comfort?.rawOutdoors-comfort?.rawShade;
  if(!finite(comfort?.rawOutdoors)||!finite(comfort?.rawShade)||comfort?.daylight!==true)return '';
  if(effect<.05)return 'No direct-sun contribution in this sky estimate.';
  return `Sun effect: ${effect<1?'less than 1°':`about ${Math.round(effect)}°`} warmer than this same hour in the shade.`;
}
export function renderSourceTransition(forecast,now=Date.now()){
  const root=document.getElementById('hourly-source-note');if(!root)return;
  const d=sourceTransition(forecast,now);if(!d){root.hidden=true;root.innerHTML='';return;}
  const zone=forecast.location.timeZone||'America/New_York';
  const clock=t=>finite(Date.parse(t))?new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(t)):'time unavailable';
  const hour=clock(d.time),reasons=[];
  if(d.temperatureDifference<-.5)reasons.push('cooler air');else if(d.temperatureDifference>.5)reasons.push('warmer air');
  if(d.windDifference>.5)reasons.push('more wind');else if(d.windDifference<-.5)reasons.push('less wind');
  const source=d.sourceType==='observation'?`Now uses ${d.stationName||'a nearby station'}${finite(d.distanceMiles)?`, ${Math.round(d.distanceMiles)} miles away`:''}, observed at ${clock(d.observedAt)}.`:'Now and the following hours are forecast estimates.';
  const summary=reasons.length?`${hour}: ${reasons.join(' and ')} than the ${d.sourceType==='observation'?'station reading':'current estimate'}`:`How Now and ${hour} are calculated`;
  const sun=solarEffectText({daylight:d.daylight,rawOutdoors:d.feels,rawShade:d.shade});
  root.hidden=false;
  root.innerHTML=`<p class="hourly-source-caption">${esc(source)} Following hours forecast your selected location.</p><details><summary>${esc(summary)}</summary><p>Now: air ${degrees(d.currentAir)}, wind ${wind(d.currentWind)}, dew point ${degrees(d.currentDewpoint)}. ${esc(hour)}: air ${degrees(d.air)}, wind ${wind(d.wind)}, dew point ${degrees(d.dewpoint)}.</p><p>${esc(sun)} There is no waiting period for sunlight in this calculation. Each hour uses its own weather inputs; a warmer sun contribution can be offset by cooler air or more wind.</p><p class="muted">Sun and shade are model estimates, not measured skin temperatures. A station away from your location may experience different conditions.</p></details>`;
}
