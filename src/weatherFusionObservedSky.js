// Observed-sky override. If any of the nearest 3 stations (within 50 km, report < 90 min old)
// reports CLR/FEW/SCT with visibility >= 5 mi, the current state is clear / mostly clear and
// forecast fog/cloud wording must not win for "now" (hero, Now card, background, header).
export const OBSERVED_SKY_VERSION='observed-sky-v2';
const LABEL={SKC:'Clear',CLR:'Clear',FEW:'Mostly Clear',SCT:'Mostly Clear'};
const WET=/thunder|storm|rain|shower|drizzle|snow|sleet|flurr|ice|freezing|hail/i;
const FOGGY=/fog|mist|haze|smoke|cloud|overcast/i;
export function observedClearSky(list=[],now=Date.now()){
 for(const o of (list||[]).slice(0,3)){
  const t=Date.parse(o?.time);
  if(!o||!Number.isFinite(t)||now-t>90*60000||t>now+5*60000)continue;
  if(!(o.stationDistanceKm<=50))continue;
  if(!LABEL[o.skyCover])continue;
  if(Number.isFinite(o.visibility)&&o.visibility<5)continue;
  if(WET.test(o.condition||''))continue;
  return {condition:LABEL[o.skyCover],station:o.station,skyCover:o.skyCover,visibility:o.visibility,time:o.time,distanceKm:o.stationDistanceKm};
 }
 return null;
}
// "Patchy Fog then Sunny" -> "Sunny" once the fog part is observed gone or past.
export function dominantDaytime(condition=''){
 const m=String(condition).match(/^(.*?)\s+then\s+(.+)$/i);
 if(!m||!FOGGY.test(m[1])||WET.test(m[1])||WET.test(m[2]))return null;
 return m[2].replace(/\s+then\s+.*$/i,'').trim();
}
export function applyObservedSky(output,list,now=Date.now()){
 const sky=observedClearSky(list,now);
 output.observedSky=sky?{...sky,version:OBSERVED_SKY_VERSION,applied:false}:{version:OBSERVED_SKY_VERSION,applied:false};
 if(!sky)return output;
 const cur=output.current||{};
 if(WET.test(cur.condition||''))return output;
 const day=output.hours?.find(h=>{const t=Date.parse(h.time);return t<=now&&now<t+3600000;})?.isDay;
 const label=day&&sky.condition==='Clear'?'Sunny':day&&sky.condition==='Mostly Clear'?'Mostly Sunny':sky.condition;
 const visibility=Number.isFinite(sky.visibility)?`visibility ${sky.visibility} mi`:'visibility unavailable';
 const distance=Number.isFinite(sky.distanceKm)?`station ${Math.round(sky.distanceKm/1.609344)} mi away`:'station distance unavailable';
 Object.assign(cur,{condition:label,conditionSource:`Station sky observation (${sky.station} ${sky.skyCover}; ${visibility}; ${distance}); overrides forecast wording`,observedSky:sky});
 if(cur.weather)cur.weather={...cur.weather,kind:'clear',label,known:true};
 for(const h of output.hours||[]){const t=Date.parse(h.time);if(t<=now&&now<t+3600000&&!WET.test(h.condition||'')){h.forecastCondition=h.condition;h.condition=label;}}
 const d0=output.days?.[0],dom=d0&&dominantDaytime(d0.condition);
 if(dom){d0.forecastCondition=d0.condition;d0.condition=dom;}
 output.observedSky.applied=true;
 return output;
}
