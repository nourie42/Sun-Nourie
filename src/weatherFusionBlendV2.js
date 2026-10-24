import {readFileSync} from 'node:fs';
export const BLEND_V2_CONFIG=JSON.parse(readFileSync(new URL('../config/weather_nourie_blend_v2.json',import.meta.url),'utf8'));
export const BLEND_V2_VERSION='weather-nourie-blend-v2.0.0';
const H=3600000,finite=v=>typeof v==='number'&&Number.isFinite(v);
export function blendBand(variable,leadHours){
 if(!finite(leadHours)||leadHours<0)return null;
 return BLEND_V2_CONFIG.variables[variable]?.bands?.find(b=>leadHours>=b.start_hour_inclusive&&leadHours<b.end_hour_exclusive)||null;
}
/** Values reaching here are normalized by the source adapter; no source aliasing. */
export function blendV2(values,{variable='temperature',validTime,issuedAt,eligible={}}={}){
 const leadHours=(validTime-issuedAt)/H,band=blendBand(variable,leadHours),requested=band?.weights_percent||{};
 const reasons={},available={};
 for(const [id,weight] of Object.entries(requested)){
  if(!weight){reasons[id]='Not requested in this lead window';continue;}
  if(eligible[id]!==true){reasons[id]=typeof eligible[id]==='string'?eligible[id]:'Verified source unavailable for this hour';continue;}
  const v=values[id];
  if(!finite(v)||(variable==='temperature'?(v< -150||v>160):(v<0||v>100))){reasons[id]='Missing or invalid value';continue;}
  available[id]=weight;
 }
 const sum=Object.values(available).reduce((a,b)=>a+b,0),policy={};let mode='blend';
 if(variable==='rain_probability'&&leadHours<168){
  const other=Object.entries(available).filter(([id])=>id!=='nws'),total=other.reduce((a,[,w])=>a+w,0);
  if(available.nws&&total){policy.nws=.4;for(const [id,w] of other)policy[id]=.6*w/total;}
  else if(available.nws){policy.nws=1;mode='nws-fallback';}
  else {mode='unavailable';reasons.nws='Official probability unavailable; no fixed-share blend can be claimed';}
 }else for(const [id,w] of Object.entries(available))policy[id]=w/sum;
 const sources=Object.entries(policy).map(([id,weight])=>({id,weight,value:values[id],requestedWeight:requested[id]/100}));
 return {value:sources.length?sources.reduce((n,s)=>n+s.value*s.weight,0):null,sources,policy,requestedWeights:requested,excluded:reasons,band:band?.id||null,leadHours,mode,version:BLEND_V2_VERSION,calibrated:false};
}
export function temperatureV2(values,index,validTime,issuedAt){
 const eligible=Object.fromEntries(['nws','hrrr','nbm','ecmwf','gefs','weathernext3'].map(id=>[id,finite(values[id])]));
 // Source adapters enforce their own actual run, point, units and valid horizon.
 return blendV2(values,{validTime,issuedAt,eligible});
}
/** Deterministic QPF signals never enter the probability adapter. */
export function officialRainV2(nwsProbability){
 const value=finite(nwsProbability)&&nwsProbability>=0&&nwsProbability<=100?nwsProbability:null;
 return {value,rawValue:value,rawTotal:value,weightedValue:value,mode:finite(value)?'nws-fallback':'unavailable',source:'Official NWS hourly probability · calibrated model probabilities unavailable',sources:finite(value)?[{id:'nws',weight:1,value,points:value}]:[],sourceValues:{nws:value},sourcePoints:{nws:value},missingModels:['hrrr','nbm','ecmwf','gefs','weathernext3'],calibrated:false,version:BLEND_V2_VERSION};
}

/** Adapter boundary for future true calibrated PoP feeds; period/threshold
 * mismatches and deterministic wet signals cannot acquire effective weight. */
export function calibratedProbabilityV2(inputs,{start,end,issuedAt,thresholdInches=.01}={}){
 const values={},eligible={};
 for(const [id,input] of Object.entries(inputs||{})){
  const official=id==='nws'&&input.kind==='official-probability';
  const probabilistic=input.kind==='calibrated-probability'&&typeof input.calibrationVersion==='string'&&input.calibrationVersion.length>0;
  const valid=Number.isFinite(start)&&Number.isFinite(end)&&end>start&&input.start===start&&input.end===end&&input.thresholdInches===thresholdInches&&input.verified===true&&input.fresh===true&&(official||probabilistic);
  values[id]=input.value;eligible[id]=valid?true:'Unverified probability, different period/threshold, or deterministic signal';
 }
 return blendV2(values,{variable:'rain_probability',validTime:start,issuedAt,eligible});
}
