import {finite,solarElevation,thermalHumidity} from './weather-math.js?v=clear-weather-daygraph-v3';
import {clothingForFeels,referenceScene} from './exposure-scene.js?v=reference-comfort-v18';
import {thermalRisk} from './thermal-risk.js?v=weather-art-labels-v10';
import {weatherShapes} from './weather-display.js?v=weather-art-labels-v10';
import {weatherState} from './weather-state.js';
const H=3600000,SIGMA=5.670374419e-8,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const c=f=>(f-32)/1.8,f=c=>c*1.8+32;
export const PAVEMENT_VERSION='pavement-energy-balance-v1';
export function solarRadiation(row,location,time){
 if(finite(row.solar)&&row.solar>=0)return row.solar;
 const elevation=solarElevation(time,location?.latitude,location?.longitude);
 if(!finite(elevation))return null;
 const mu=Math.max(0,Math.sin(elevation));if(mu===0)return 0;
 if(!finite(row.skyCover))return null;
 return 1098*mu*Math.exp(-.059/mu)*(1-.75*(clamp(row.skyCover,0,100)/100)**3.4);
}
export function skyLongwave(row){
 const ta=c(row.temperature),rh=thermalHumidity(row);
 let td=finite(row.dewpoint)&&row.dewpoint<=row.temperature+1?Math.min(ta,c(row.dewpoint)):null;
 if(!finite(td)&&finite(rh)&&rh>0){const gamma=Math.log(rh/100)+17.625*ta/(243.04+ta);td=243.04*gamma/(17.625-gamma);}
 if(!finite(td)||!finite(row.skyCover))return null;
 const n=clamp(row.skyCover,0,100)/10;
 const emissivity=clamp((.787+.764*Math.log((td+273.15)/273))*(1+.0224*n-.0035*n*n+.00028*n*n*n),0,1);
 return emissivity*SIGMA*(ta+273.15)**4;
}
function interpolate(a,b,t){
 const fraction=clamp((t-a.epoch)/(b.epoch-a.epoch||1),0,1),out={};
 for(const key of ['temperature','dewpoint','humidity','wind','skyCover','solar','rain'])out[key]=finite(a[key])&&finite(b[key])?a[key]+fraction*(b[key]-a[key]):null;
 return out;
}
export function integrateSurface(rows,location,{albedo=.3,k=2,capacity=2.2e6,windFactor=1,solarFactor=1,initialOffset=0,stepSeconds=60}={}){
 if(rows.length<2)return null;
 const deep=rows.reduce((sum,r)=>sum+c(r.temperature),0)/rows.length;
 let ts=c(rows[0].temperature)+initialOffset,tb=deep+initialOffset*.5;
 const cs=capacity*.03,cb=capacity*.15,g=k/.09,gd=k/.25;
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i],span=b.epoch-a.epoch;
  if(span<=0||span>1.51*H)return null;
  for(let time=a.epoch;time<b.epoch;){
   const dt=Math.min(stepSeconds,(b.epoch-time)/1000),r=interpolate(a,b,time+dt*500);
   const sw=solarRadiation(r,location,time+dt*500),lw=skyLongwave(r);
   if(![r.temperature,r.wind,sw,lw].every(finite)||r.wind<0)return null;
   const v=r.wind*.44704*.7*windFactor,h=v<=5?5.6+4*v:7.3*v**.78;
   const conduction=g*(ts-tb);
   const flux=(1-albedo)*sw*solarFactor+.95*(lw-SIGMA*(ts+273.15)**4)+h*(c(r.temperature)-ts)-conduction;
   ts+=dt*flux/cs;tb+=dt*(conduction-gd*(tb-deep))/cb;
   if(!finite(ts)||ts< -100||ts>150)return null;
   time+=dt*1000;
  }
 }
 return f(ts);
}
export function pavementEstimate(forecast,current,now=Date.now(),{checkedAt=now}={}){
 const assembled=Date.parse(forecast?.assembledAt),raw=forecast?.exposureWeather?.rows;
 const elevation=solarElevation(now,forecast?.location?.latitude,forecast?.location?.longitude),daylight=finite(elevation)?elevation>0:null;
 const missing=reason=>({version:PAVEMENT_VERSION,status:'unavailable',reason,concrete:null,asphalt:null,daylight});
 if(!finite(assembled)||checkedAt-assembled>90*60000||checkedAt<assembled-5*60000)return missing('The weather update is too old for a surface estimate.');
 if(!Array.isArray(raw))return missing('Surface-weather data is temporarily unavailable. Check the actual pavement before walking.');
 const timed=raw.map(r=>({...r,epoch:Date.parse(r.time)})).filter(r=>finite(r.epoch)).sort((a,b)=>a.epoch-b.epoch);
 const rows=timed.filter(r=>r.epoch>=now-48*H&&r.epoch<now);
 const a=timed.findLast(r=>r.epoch<=now),b=timed.find(r=>r.epoch>=now);
 if(!a||!b||b.epoch-a.epoch>1.5*H||rows.length<24)return missing('At least a day of recent weather is needed to estimate heat stored in pavement.');
 const last={...interpolate(a,b,now),epoch:now};
 for(const key of ['temperature','dewpoint','humidity','wind'])if(finite(current?.[key]))last[key]=current[key];
 if(finite(current?.skyCover)){
  const transmission=n=>1-.75*(clamp(n,0,100)/100)**3.4;
  if(finite(last.solar)&&finite(last.skyCover))last.solar*=transmission(current.skyCover)/transmission(last.skyCover);
  last.skyCover=current.skyCover;
 }
 rows.push(last);
 if(!rows.every(r=>finite(r.temperature)&&finite(r.wind)&&finite(r.skyCover)&&finite(thermalHumidity(r))))return missing('Recent weather has gaps. Check the actual surface before walking.');
 const materials={concrete:{albedo:.3,k:2},asphalt:{albedo:.1,k:1.5}},results={};
 for(const [id,material] of Object.entries(materials)){
  const center=integrateSurface(rows,forecast.location,material);
  const cool=integrateSurface(rows,forecast.location,{...material,albedo:material.albedo+.1,k:material.k*1.25,capacity:2.5e6,windFactor:1.4,solarFactor:.75,initialOffset:-6});
  const warm=integrateSurface(rows,forecast.location,{...material,albedo:Math.max(.05,material.albedo-.1),k:material.k*.75,capacity:1.8e6,windFactor:.6,solarFactor:1.25,initialOffset:6});
  if(![center,cool,warm].every(finite))return missing('Surface-weather data has gaps; a reliable estimate cannot be calculated.');
  results[id]={value:Math.round(center),low:Math.floor((Math.min(center,cool,warm)-4)/5)*5,high:Math.ceil((Math.max(center,cool,warm)+4)/5)*5};
 }
 const wet=rows.slice(-4).some(r=>finite(r.rain)&&r.rain>0),frozen=current.temperature<=32;
 return {version:PAVEMENT_VERSION,status:'estimated',...results,historyHours:(now-rows[0].epoch)/H,wet,frozen,skyCover:last.skyCover,time:new Date(now).toISOString(),daylight,
  note:frozen?'Snow, ice and freezing change surface behavior; these dry-surface estimates are unreliable in these conditions.':wet?'Recent modeled rain may mean wet surfaces. These are dry-surface estimates; wet pavement can be cooler.':'Estimated dry, exposed surfaces. Shade, color and local shelter can change the actual temperature.',
  advice:'Check the actual surface with the back of your hand. If it feels too hot, choose grass or a cooler route.'};
}
export function walkerOutfit(feels){
 const outfit=clothingForFeels(feels),asset=outfit==='hot'||outfit==='warm'?'poodle-walk-hot.png':outfit==='cold'?'poodle-walk-cold.png':outfit==='cool'?'poodle-walk.png':'poodle-walk-mild.png';
 return {outfit,asset};
}
function petWeatherWarning(feels){
 const risk=thermalRisk(feels);
 if(!risk)return null;
 return {level:risk.level,label:risk.short,source:'weather'};
}
export function petSurfaceSubtitle(result){
 if(result?.status!=='estimated')return 'Check the actual pavement';
 const hottest=Math.max(result.concrete?.value??-Infinity,result.asphalt?.value??-Infinity);
 if(!finite(hottest))return 'Surface temperature unavailable';
 if(hottest>=135)return 'Dangerously hot pavement';
 if(hottest>=115)return 'Very hot on pavement';
 if(hottest>=95)return 'Hot on pavement';
 if(hottest>=80)return 'Warm pavement';
 return 'Pavement is relatively cool';
}
export function pavementHTML(result,feels,context={}){
 const walker=walkerOutfit(feels);
 const surfaceWarning=pavementWarning(result),weatherWarning=petWeatherWarning(feels),warning=surfaceWarning||weatherWarning;
 const value=r=>r?`${r.value}°`:'—',night=result?.daylight===false;
 let sky=night
  ? `<rect width="300" height="360" fill="url(#pet-night-sky)"/><g class="pet-stars" fill="#dcecff" opacity=".86"><circle cx="28" cy="34" r="2"/><circle cx="73" cy="66" r="1.7"/><circle cx="126" cy="35" r="1.5"/><circle cx="169" cy="73" r="2"/><circle cx="223" cy="38" r="1.5"/><circle cx="270" cy="84" r="1.8"/><circle cx="246" cy="124" r="1.2"/><circle cx="105" cy="116" r="1.2"/></g><path class="pet-moon" d="M238 54A28 28 0 1 0 262 96A31 31 0 0 1 238 54Z" fill="#eef3ff"/>`
  : `<rect width="300" height="360" fill="url(#pet-day-sky)"/><g class="sky-sun" transform="translate(238 67)"><circle r="42" fill="#ffe680" opacity=".18"/><g stroke="#ffda63" stroke-width="7" stroke-linecap="round"><path d="M0-49V-37M0 49V37M-49 0H-37M49 0H37M-35-35L-26-26M35 35L26 26M-35 35L-26 26M35-35L26-26"/></g><circle r="27" fill="#ffe56f"/></g>`;
 if(context.condition&&weatherState(context.condition).kind!=='clear')sky=`<rect width="300" height="360" fill="url(#pet-${night?'night':'day'}-sky)"/><g transform="translate(205 35) scale(1.6)">${weatherShapes(context.condition,!night)}</g>`;
 const illustrated=referenceScene(2,!night,context.condition||'Clear',feels);
 const horizon=night?'#173d4c':'#2d9b5d';
 return `<figure class="exposure-person pavement-person" id="pavement-content" data-status="${result.status}" data-daylight="${night?'false':'true'}" aria-label="Estimated hard-surface temperature for dogs ${context.forecast?'at the selected forecast hour':'right now'}"><span class="exposure-label">For Pets</span><span class="exposure-subtitle">${petSurfaceSubtitle(result)}</span><span class="exposure-alert-slot">${warning?`<span class="pavement-warning${warning.source==='weather'?' pet-weather-warning':''}" data-risk="${warning.level}" role="status">${warning.label}</span>`:''}</span>${illustrated||`<svg class="poodle-scene" viewBox="0 0 300 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A person walking a light brown toy poodle"><defs><linearGradient id="pet-road" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${night?'#4f6170':'#7f929d'}"/><stop offset="1" stop-color="${night?'#293b49':'#405463'}"/></linearGradient><linearGradient id="pet-day-sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#078fe0"/><stop offset=".68" stop-color="#61d1fb"/><stop offset="1" stop-color="#9bdcf0"/></linearGradient><linearGradient id="pet-night-sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#071c46"/><stop offset=".58" stop-color="#123c69"/><stop offset="1" stop-color="#285e7b"/></linearGradient></defs>${sky}<g class="pet-horizon" fill="${horizon}" opacity=".92"><circle cx="22" cy="242" r="34"/><circle cx="61" cy="235" r="29"/><circle cx="248" cy="238" r="37"/><circle cx="288" cy="246" r="32"/></g><path d="M0 272Q77 257 153 271Q226 252 300 270V360H0Z" fill="url(#pet-road)"/><image class="poodle-walk" data-outfit="${walker.outfit}" href="/weather-fusion/${walker.asset}" x="-22" y="96" width="344" height="229.333" preserveAspectRatio="xMidYMid meet"/></svg>`}<figcaption><strong>${value(result.concrete)}</strong><small class="pavement-secondary">Asphalt ${value(result.asphalt)}</small><small>Est. surface temp · °F</small></figcaption></figure>`;
}
export function pavementWarning(result){
 if(result?.status!=='estimated')return null;
 const surfaces=[result.concrete,result.asphalt].filter(Boolean);
 if(surfaces.some(s=>finite(s.value)&&s.value>=135))return {level:'danger',label:'Paw burn risk'};
 if(surfaces.some(s=>finite(s.high)&&s.high>=135))return {level:'caution',label:'Hot pavement possible'};
 return null;
}
export function pavementDetailsHTML(result){
 const range=(r,label)=>r?`${label}: ${r.low}–${r.high}°F.`:`${label}: unavailable.`;
 return `<details class="pavement-details"><summary>Sidewalk ranges & paw care</summary><p>${range(result.concrete,'Concrete')}${' '}${range(result.asphalt,'Dark asphalt')}</p><p>${result.note||result.reason}</p><p>${result.advice||'Check the actual surface before walking. Choose grass or a cooler route when it feels hot.'}</p><a href="#pavement-science">How the sidewalk estimate works ↓</a></details>`;
}
