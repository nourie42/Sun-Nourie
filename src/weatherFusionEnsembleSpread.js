/** Daily high/low spread from ECMWF ENS and GEFS members.
 * The hourly GEFS ensemble mean runs warm overnight and was being scored as if
 * it were an independent forecast. Member spread is the uncertainty signal.
 * A failed fetch returns an unavailable spread so confidence can fall back.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const round=(value,digits=2)=>Number(value.toFixed(digits));
export const ENSEMBLE_SPREAD_VERSION='weather-nourie-ensemble-spread-v1';
const MIN_MEMBERS=15;
const MEMBER=/^temperature_2m_(max|min)_member\d+_(.+)$/;
const LEAD_TRIM=[0,0,0,2,4,10,16,20];

export function ensembleLeadTrim(leadDays){
 const day=Number.isFinite(leadDays)?Math.max(0,Math.trunc(leadDays)):0;
 if(day<LEAD_TRIM.length)return LEAD_TRIM[day];
 return LEAD_TRIM[LEAD_TRIM.length-1]+(day-(LEAD_TRIM.length-1))*3;
}
export function ensembleSpreadPenalty(uncertainty){
 if(!finite(uncertainty)||uncertainty<0)return null;
 if(uncertainty<=2)return 0;
 if(uncertainty<=3)return 5;
 if(uncertainty<=4)return 12;
 if(uncertainty<=5.5)return 20;
 if(uncertainty<=7)return 32;
 return 45;
}
export function deterministicGapPenalty(gap){
 if(!finite(gap)||gap<0)return 18;
 if(gap<=2)return 0;
 if(gap<=4)return 6;
 if(gap<=6)return 14;
 if(gap<=8)return 32;
 return 45;
}
function rating(raw){
 const score=Math.max(35,Math.min(100,Math.round(raw)));
 const label=score>=85?'High':score>=70?'Moderate':score>=55?'Low':'Very low';
 return {score,label,key:label.toLowerCase().replace(/\s+/g,'-')};
}
function modelId(token){
 const name=String(token||'').toLowerCase();
 if(name.includes('ecmwf'))return 'ecmwf';
 if(name.includes('gefs')||name.includes('gfs'))return 'gefs';
 return null;
}
function sampleStats(values){
 const nums=values.filter(finite);
 if(nums.length<MIN_MEMBERS)return null;
 const mean=nums.reduce((sum,value)=>sum+value,0)/nums.length;
 const variance=nums.reduce((sum,value)=>sum+(value-mean)**2,0)/(nums.length-1);
 return {mean:round(mean,2),sd:round(Math.sqrt(variance),2),count:nums.length};
}
/** Representative °F uncertainty for one local date.
 * Daily-high differences between ensemble means count at half weight.
 * Daily-low differences ignore the first 6°F because the GEFS mean runs warm
 * overnight even when its members are tightly clustered.
 */
export function representativeUncertainty(day){
 const models=['ecmwf','gefs'].map(id=>day?.models?.[id]).filter(model=>finite(model?.maxSd)||finite(model?.minSd));
 const spreads=models.flatMap(model=>[model.maxSd,model.minSd]).filter(finite);
 if(!spreads.length)return null;
 let uncertainty=Math.max(...spreads);
 const ecmwf=day.models?.ecmwf,gefs=day.models?.gefs;
 if(finite(ecmwf?.maxMean)&&finite(gefs?.maxMean))uncertainty=Math.max(uncertainty,Math.abs(ecmwf.maxMean-gefs.maxMean)/2);
 if(finite(ecmwf?.minMean)&&finite(gefs?.minMean))uncertainty=Math.max(uncertainty,Math.max(0,Math.abs(ecmwf.minMean-gefs.minMean)-6)/4);
 return round(uncertainty,2);
}
export function scoreEnsembleTemperature({dayIndex=0,uncertainty,models=[]}={}){
 const penalty=ensembleSpreadPenalty(uncertainty);
 if(penalty===null)return null;
 const rated=rating(100-penalty);
 const shown=Number(uncertainty).toFixed(1);
 const names=models.length?models.map(id=>id==='ecmwf'?'ECMWF ENS':id==='gefs'?'GEFS':id).join(' and '):'The ensembles';
 const summary=penalty===0
  ?`${names} members agree within ${shown}°F on the daily high and low.`
  :`${names} daily high and low member spread is ${shown}°F.`;
 return {...rated,evidenceScore:rated.score,uncappedScore:rated.score,uncertainty:Number(shown),spreadPenalty:penalty,summary,
  factors:[`${shown}°F ensemble member spread for the daily high and low`,names==='The ensembles'?'Ensemble member spread':`Ensembles: ${names}`],
  reasons:[summary],version:ENSEMBLE_SPREAD_VERSION,basis:'ensemble-daily-spread'};
}
export function scoreDeterministicTemperature({dayIndex=0,spread,gefsExcluded=false}={}){
 const penalty=deterministicGapPenalty(spread);
 const rated=rating(100-penalty);
 const shown=finite(spread)?Number(spread).toFixed(1):null;
 const summary=!shown?'Temperature agreement cannot be compared from the available hourly sources.'
  :gefsExcluded&&penalty===0?'Temperature forecasts agree closely once the GEFS ensemble mean is set aside.'
  :penalty===0?'Temperature forecasts agree closely for these hours.'
  :gefsExcluded?`Hourly forecasts other than the GEFS ensemble mean differ by up to ${shown}°F.`
  :`Hourly temperature forecasts differ by up to ${shown}°F.`;
 return {...rated,evidenceScore:rated.score,uncappedScore:rated.score,spreadPenalty:penalty,summary,
  factors:[shown?`${shown}°F hourly temperature gap${gefsExcluded?' after setting aside the GEFS ensemble mean':''}`:'limited hourly temperature comparison',dayIndex===0?'same-day lead time':`${dayIndex}-day lead time`],
  reasons:[summary],version:ENSEMBLE_SPREAD_VERSION,basis:'deterministic-hourly-gap'};
}

export function parseEnsembleDaily(data,location){
 if(!finite(data?.latitude)||!finite(data?.longitude)||!finite(location?.latitude)||!finite(location?.longitude))throw new Error('Ensemble response has no grid point');
 if(Math.abs(data.latitude-location.latitude)>.5||Math.abs(data.longitude-location.longitude)>.5)throw new Error('Ensemble grid does not match the selected location');
 const daily=data.daily,times=daily?.time;
 if(!Array.isArray(times)||!times.length||times.length>16||times.some(day=>!/^\d{4}-\d{2}-\d{2}$/.test(day)))throw new Error('Ensemble daily dates are missing');
 const grouped=new Map();
 for(const key of Object.keys(daily)){
  const match=MEMBER.exec(key);if(!match)continue;
  const id=modelId(match[2]);if(!id)continue;
  if(data.daily_units?.[key]!=='°F')throw new Error('Ensemble temperatures must be Fahrenheit');
  const bucket=grouped.get(id)||{max:[],min:[]};
  bucket[match[1]].push(daily[key]);
  grouped.set(id,bucket);
 }
 if(!grouped.size)throw new Error('Ensemble response did not include member temperatures');
 const days=times.map((date,index)=>{
  const models={};
  for(const [id,series] of grouped){
   const read=kind=>{
    const values=series[kind].map(row=>row?.[index]).filter(value=>finite(value)&&value>=-80&&value<=140);
    return sampleStats(values);
   };
   const max=read('max'),min=read('min');
   if(!max&&!min)continue;
   models[id]={maxMean:max?.mean??null,maxSd:max?.sd??null,maxCount:max?.count??0,minMean:min?.mean??null,minSd:min?.sd??null,minCount:min?.count??0};
  }
  const modelIds=['ecmwf','gefs'].filter(id=>models[id]);
  const uncertainty=representativeUncertainty({models});
  return {date,usable:finite(uncertainty)&&modelIds.length>0,uncertainty,modelIds,models};
 });
 if(!days.some(day=>day.usable))throw new Error('Ensemble members were missing for every date');
 return {version:ENSEMBLE_SPREAD_VERSION,status:'ready',latitude:data.latitude,longitude:data.longitude,timezone:data.timezone||null,days};
}
export function publishedEnsembleSpread(value){
 if(value?.status==='ready'&&Array.isArray(value.days))return value;
 return {version:ENSEMBLE_SPREAD_VERSION,status:'unavailable',days:[],message:typeof value?.message==='string'?value.message.slice(0,180):'Ensemble spread unavailable'};
}

export function createEnsembleSpread({fetchImpl=globalThis.fetch,now=Date.now}={}){
 const cache=new Map();let retryAt=0;
 return async function loadEnsembleSpread(location,timeZone){
  const key=`${location?.latitude},${location?.longitude}`;
  const unavailable=message=>({value:publishedEnsembleSpread({message}),meta:{id:'ensemble-spread',label:'ECMWF ENS and GEFS member spread',status:'unavailable',message}});
  try{
   if(!finite(location?.latitude)||!finite(location?.longitude))throw new Error('Ensemble spread needs a location');
   const hit=cache.get(key);if(hit&&hit.until>now())return hit.result;
   if(now()<retryAt)throw new Error('Ensemble provider rate limit; retry after '+new Date(retryAt).toISOString());
   const zone=typeof timeZone==='string'&&timeZone.includes('/')?timeZone:'auto';
   const query=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),daily:'temperature_2m_max,temperature_2m_min',models:'ecmwf_ifs025,gfs025',temperature_unit:'fahrenheit',timezone:zone,forecast_days:'10'});
   const response=await fetchImpl('https://ensemble-api.open-meteo.com/v1/ensemble?'+query,{redirect:'error',signal:AbortSignal.timeout(12000)});
   if(!response.ok){
    if(response.status===429){const header=response.headers?.get?.('retry-after'),seconds=Number(header),delay=header&&Number.isFinite(seconds)?seconds*1000:Date.parse(header)-now();retryAt=now()+Math.max(60000,Number.isFinite(delay)&&delay>0?delay:5*60000);}
    throw new Error(`Ensemble HTTP ${response.status}`);
   }
   const text=await response.text();
   if(Buffer.byteLength(text)>1500000)throw new Error('Ensemble response too large');
   const value=parseEnsembleDaily(JSON.parse(text),location);
   const result={value,meta:{id:'ensemble-spread',label:'ECMWF ENS and GEFS member spread',status:'ready',issuedAt:new Date(now()).toISOString(),message:'Daily high and low spread from ECMWF ENS and GEFS members.'}};
   cache.set(key,{until:now()+15*60000,result});while(cache.size>24)cache.delete(cache.keys().next().value);
   return result;
  }catch(error){return unavailable(error?.message||'Ensemble spread unavailable');}
 };
}
