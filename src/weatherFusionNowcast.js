/** Transparent short-lead observation alignment, NOT a new physiological model.
 * A bounded station-minus-forecast residual fades to zero over 3 hours from the
 * observation timestamp. Never reset that clock on refresh. It is an unverified
 * local correction, not a promise of accuracy or a measured skin temperature.
 */
import {finite, humidityFromDewpoint, shadeFeelsLike} from '../public/weather-fusion/weather-math.js';
const H=3600000, clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function at(rows, time, field) {
  const sorted=rows.filter(r=>finite(r[field])).sort((a,b)=>a.epoch-b.epoch);
  const a=sorted.findLast(r=>r.epoch<=time),b=sorted.find(r=>r.epoch>=time);
  if(a&&b&&b.epoch-a.epoch<=H)return a.epoch===b.epoch?a[field]:a[field]+(b[field]-a[field])*(time-a.epoch)/(b.epoch-a.epoch);
  const near=sorted.reduce((best,r)=>!best||Math.abs(r.epoch-time)<Math.abs(best.epoch-time)?r:best,null);
  return near&&Math.abs(near.epoch-time)<=H?near[field]:null;
}
export function alignComfortHours(raw,current,now) {
  const observedAt=Date.parse(current?.time), age=now-observedAt;
  const eligible=current?.type==='observation'&&finite(observedAt)&&age>=-300000&&age<=90*60000&&
    finite(current.stationDistanceKm)&&current.stationDistanceKm<=50;
  const residuals={};
  for(const [key,bound] of [['temperature',6],['dewpoint',6],['wind',8]]) {
    const baseline=at(raw,observedAt,key),obs=current?.[key];
    if(eligible&&finite(baseline)&&finite(obs))residuals[key]=clamp(obs-baseline,-bound,bound);
  }
  const status=Object.keys(residuals).length?'applied':'not-applied';
  const hours=raw.map(r=>{
    const ageHours=(r.epoch-observedAt)/H;
    const factor=status==='applied'&&ageHours>=0?clamp(1-ageHours/3,0,1):0;
    const inputs=Object.fromEntries(['temperature','dewpoint','wind'].map(k=>[k,finite(r[k])?r[k]+(residuals[k]||0)*factor:null]));
    if(finite(inputs.wind))inputs.wind=Math.max(0,inputs.wind);
    if(finite(inputs.temperature)&&finite(inputs.dewpoint))inputs.dewpoint=Math.min(inputs.temperature,inputs.dewpoint);
    const humidity=humidityFromDewpoint(inputs.temperature,inputs.dewpoint)??r.humidity;
    const feel=shadeFeelsLike(inputs.temperature,humidity,inputs.wind,inputs.dewpoint);
    return {...r,rawInputs:{temperature:r.temperature,dewpoint:r.dewpoint,wind:r.wind,humidity:r.humidity},...inputs,humidity,
      feels:feel.value,method:feel.method,alignmentFactor:factor};
  });
  return {hours,alignment:{status,observedAt:finite(observedAt)?new Date(observedAt).toISOString():null,
    station:current?.station||null,stationDistanceKm:current?.stationDistanceKm??null,decayHours:3,residuals,
    note:'Near-term thermal estimates use a bounded nearby-station residual, fading over three hours from the observation. Raw forecast temperatures and weights remain available separately. This local adjustment has not been skill-calibrated.'}};
}
