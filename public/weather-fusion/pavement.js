import {finite,solarElevation,thermalHumidity} from './weather-math.js?v=clear-weather-daygraph-v3';
import {clothingForFeels} from './exposure-scene.js?v=clear-weather-daygraph-v3';
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
/** Two-layer finite-volume heat balance. Convection and LW use inward-positive
 * signs. Dry surfaces have NO evaporative term. Integration never treats rain
 * chance as measured wetness. Parameter bounds are an engineering envelope. */
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
export function pavementEstimate(forecast,current,now=Date.now()){
 const assembled=Date.parse(forecast?.assembledAt),raw=forecast?.exposureWeather?.rows;
 const missing=reason=>({version:PAVEMENT_VERSION,status:'unavailable',reason,concrete:null,asphalt:null});
 if(!finite(assembled)||now-assembled>90*60000||now<assembled-5*60000)return missing('The weather update is too old for a current surface estimate.');
 if(!Array.isArray(raw))return missing('Surface-weather data is temporarily unavailable. Check the actual pavement before walking.');
 const timed=raw.map(r=>({...r,epoch:Date.parse(r.time)})).filter(r=>finite(r.epoch)).sort((a,b)=>a.epoch-b.epoch);
 const rows=timed.filter(r=>r.epoch>=now-48*H&&r.epoch<now);
 const a=timed.findLast(r=>r.epoch<=now),b=timed.find(r=>r.epoch>=now);
 if(!a||!b||b.epoch-a.epoch>1.5*H||rows.length<24)return missing('At least a day of recent weather is needed to estimate heat stored in pavement.');
 const last={...interpolate(a,b,now),epoch:now};
 // Current observed air plus clearly labelled current-hour companion estimates.
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
 return {version:PAVEMENT_VERSION,status:'estimated',...results,historyHours:(now-rows[0].epoch)/H,wet,frozen,skyCover:last.skyCover,time:new Date(now).toISOString(),
  note:frozen?'Snow, ice and freezing change surface behavior; these dry-surface estimates are unreliable in these conditions.':wet?'Recent modeled rain may mean wet surfaces. These are dry-surface estimates; wet pavement can be cooler.':'Estimated dry, exposed surfaces. Shade, color and local shelter can change the actual temperature.',
  advice:'Check the actual surface with the back of your hand. If it feels too hot, choose grass or a cooler route.'};
}
export function walkerOutfit(feels){
 const outfit=clothingForFeels(feels),asset=outfit==='hot'||outfit==='warm'?'poodle-walk-hot.png':outfit==='cold'?'poodle-walk-cold.png':outfit==='cool'?'poodle-walk.png':'poodle-walk-mild.png';
 return {outfit,asset};
}
export function pavementHTML(result,feels){
 const walker=walkerOutfit(feels);
 const warning=pavementWarning(result);
 const value=r=>r?`${r.value}°`:'—';
 return `<figure class="exposure-person pavement-person" id="pavement-content" data-status="${result.status}" aria-label="Estimated hard-surface temperature for dogs right now"><span class="exposure-label">For Pets</span><span class="exposure-alert-slot">${warning?`<span class="pavement-warning" data-risk="${warning.level}" role="status">${warning.label}</span>`:''}</span><svg class="poodle-scene" viewBox="0 -240 220 420" role="img" aria-label="A person walking a light brown toy poodle"><image class="poodle-walk" data-outfit="${walker.outfit}" href="/weather-fusion/${walker.asset}" x="-55" y="-29" width="319" height="212.667"/></svg><figcaption><strong>${value(result.concrete)}</strong><small class="pavement-secondary">Asphalt ${value(result.asphalt)}</small><small>Est. surface · °F</small></figcaption></figure>`;
}
/** AAHA reports rapid paw burns at 135°F. The upper engineering bound triggers
 * an earlier precaution; it is not a measured temperature or probability. No
 * warning must never be interpreted as a guarantee of paw safety. */
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
