import {calendarDayWindow} from '../public/weather-fusion/calendar-day.js';
import {forecastConfidence} from '../public/weather-fusion/forecast-confidence.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';
import {MIN_RAIN_SIGNAL_INCHES,TRACE_QPF_THRESHOLD_INCHES} from './weatherFusionDirect.js';

export const CONDITION_CONFIDENCE_VERSION='weather-nourie-sky-rain-agreement-v1';
const H=3600000,finite=value=>typeof value==='number'&&Number.isFinite(value),round=value=>Math.round(value*1000)/1000;
const sourceIds=['nws','hrrr','ecmwf','nbm','wn'];
const iso=time=>finite(time)?new Date(time).toISOString():null;
const skyCategory=value=>value<=30?'clear':value>=70?'cloudy':'mixed';
const rainCategory=value=>value<MIN_RAIN_SIGNAL_INCHES?'dry':value<=TRACE_QPF_THRESHOLD_INCHES?'trace':'wet';
const categories={clear:0,mixed:1,cloudy:2,dry:0,trace:1,wet:1};
const names={nws:'NWS',hrrr:'HRRR',ecmwf:'ECMWF',nbm:'NBM',wn:'Google WeatherNext'};
const number=value=>String(Number(value.toFixed(4)));
function localClock(time,zone){try{return new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(time)).replace(':00','');}catch{return time;}}
function rangeSummary(kind,evidence,other,zone){
 const hour=evidence.worstHour;if(!hour?.sources?.length)return null;
 const low=hour.sources.reduce((a,b)=>a.value<=b.value?a:b),high=hour.sources.reduce((a,b)=>a.value>=b.value?a:b);
 const unit=kind==='sky'?'%':' in',label=kind==='sky'?'Cloud cover':'Hourly precipitation';
 return `${label} ranges from ${number(low.value)}${unit} (${names[low.id]||low.id}) to ${number(high.value)}${unit} (${names[high.id]||high.id}) at ${localClock(hour.time,zone)}.${other.score>=85?kind==='sky'?' Rain guidance agrees.':' Sky-cover guidance agrees.':''}`;
}

// Conflicting duplicate timestamps cannot become a verified hour by accident.
function axis(rows){
 const result=new Map();
 for(const row of rows||[]){const time=Date.parse(row?.time);if(finite(time))result.set(time,result.has(time)?null:row);}
 return result;
}
function validSources(raw,kind){
 const seen=new Map();
 for(const source of raw||[]){
  if(!sourceIds.includes(source?.id)||!finite(source.weight)||source.weight<=0||!finite(source.value)||source.value<0||(kind==='sky'&&source.value>100))continue;
  if(seen.has(source.id)){seen.set(source.id,null);continue;}
  seen.set(source.id,{id:source.id,value:source.value,weight:source.weight,category:(kind==='sky'?skyCategory:rainCategory)(source.value),runAt:source.runAt||null});
 }
 return [...seen.values()].filter(Boolean);
}
function agreement(sources,kind){
 if(sources.length<2)return null;
 let total=0,count=0;
 for(let i=0;i<sources.length;i++)for(let j=i+1;j<sources.length;j++){
  total+=1-Math.abs(categories[sources[i].category]-categories[sources[j].category])/(kind==='sky'?2:1);count++;
 }
 return total/count;
}
function component(hours,window,scope){
 const coverage={},expectedHours=hours.reduce((sum,hour)=>sum+hour.durationHours,0);
 let coveredHours=0,comparedHours=0,total=0,worstHour=null;
 for(const hour of hours){
  if(hour.sources.length)coveredHours+=hour.durationHours;
  for(const source of hour.sources)coverage[source.id]=(coverage[source.id]||0)+hour.durationHours;
  if(finite(hour.agreement)){
   comparedHours+=hour.durationHours;total+=hour.agreement*hour.durationHours;
   if(!worstHour||hour.agreement<worstHour.agreement)worstHour=hour;
  }
 }
 const completeSources=sourceIds.filter(id=>expectedHours>0&&(coverage[id]||0)>=expectedHours-1e-8);
 const complete=expectedHours>0&&comparedHours>=expectedHours-1e-8;
 // A short contradictory period cannot disappear inside a mostly quiet day.
 let score=comparedHours&&worstHour?Math.round(Math.min(total/comparedHours*100,worstHour.agreement*100+20)):null;
 if(score!==null)score=Math.min(score,completeSources.length>=3?100:completeSources.length===2?80:60,complete?100:60);
 return {scope,window,expectedHours:round(expectedHours),coveredHours:round(coveredHours),comparedHours:round(comparedHours),completeSources,
  sourceCoverage:Object.fromEntries(sourceIds.filter(id=>coverage[id]).map(id=>[id,round(coverage[id])])),complete,score,hours,worstHour};
}
function temperatureComponent(day,index){
 const current=day.confidence,coverage=current.coverage?.temperature;
 const complete=(current.contributions?.high||[]).filter(source=>source.complete&&finite(source.value)&&source.weight>0);
 const ids=complete.map(source=>source.id),expected=coverage?.expectedHours,nws=(current.contributions?.high||[]).find(source=>source.id==='nws');
 const result=forecastConfidence({dayIndex:index,highSpread:current.temperatureSpread,temperatureSpreadBasis:current.temperatureSpreadBasis||'same-hour',
  temperatureOutlierHours:current.temperatureComparison?.adjustments?.length||0,qpfSpread:0,guidanceCount:ids.length,sourceIds:ids,
  officialCoverage:finite(expected)&&expected>0?(nws?.coverageHours||0)/expected:null,temperatureCoverage:coverage?.complete??false,rainCoverage:true,
  temperatureSourceCount:ids.length,rainSourceCount:ids.length,rainFallback:false});
 result.factors=result.factors.filter(factor=>!/rainfall|rain-model|rain forecast/i.test(factor));
 result.factors.push(`${ids.length} temperature sources cover all assessed hours`);
 result.reasons=result.reasons.filter(reason=>!/rainfall|rain-model|rain forecast/i.test(reason));
 result.summary=result.reasons.length?result.reasons.join(' '):'Temperature forecasts agree closely for these hours.';
 return {...result,scope:'temperature',temperatureSpread:current.temperatureSpread,rawTemperatureSpread:current.rawTemperatureSpread,
  temperatureComparison:current.temperatureComparison,window:current.window,coverage:{temperature:coverage},contributions:{high:current.contributions?.high||[],low:current.contributions?.low||[]},
  note:'Relative temperature-confidence index using temperature agreement, lead time and temperature-source coverage. It is separate from sky/rain agreement and is not a calibrated accuracy percentage.'};
}

/** Append separate component indicators without changing legacy confidence. */
export function addConditionConfidence(out,{now=Date.now()}={}){
 const feels=axis(out.metricForecasts?.series?.feels),cloud=axis(out.metricForecasts?.series?.cloud),rain=axis(out.rainTimeline);
 for(const [index,day] of (out.days||[]).entries()){
  if(!day.confidence)continue;
  const dateWindow=calendarDayWindow(day,index,now,out.location?.timeZone),start=Math.max(dateWindow.start,now),end=dateWindow.end;
  const window={start:iso(start),end:iso(end)},allSky=[],rainHours=[];
  if(finite(start)&&finite(end)&&end>start)for(let time=Math.floor(start/H)*H;time<end;time+=H){
   const left=Math.max(start,time),right=Math.min(end,time+H),durationHours=(right-left)/H,point=feels.has(time)?feels.get(time):cloud.get(time);
   const raw=point?.inputs?.skySources??point?.sources??[],sources=validSources(raw,'sky');
   const partial=left>time;
   const elevation=solarElevation(partial?left:left+(right-left)/2,out.location?.latitude,out.location?.longitude);
   const daylight=partial&&finite(elevation)?elevation>0:typeof point?.daylight==='boolean'?point.daylight:finite(elevation)&&elevation>0;
   allSky.push({time:iso(left),end:iso(right),durationHours,daylight,agreement:agreement(sources,'sky'),category:sources.length?new Set(sources.map(source=>source.category)).size===1?sources[0].category:'split':null,sources});
   const candidate=rain.get(time),row=candidate&&Date.parse(candidate.end)===time+H?candidate:null;
   const rainSources=validSources(row?.precipitationBlend?.sources,'rain');
   const officialPop=finite(row?.officialPop)&&row.officialPop>=0&&row.officialPop<=100?row.officialPop:null;
   const models=rainSources.filter(source=>source.id!=='nws'),allDry=models.length>0&&models.every(source=>source.category==='dry'),allWet=models.length>0&&models.every(source=>source.category!=='dry');
   const probabilityConflict=officialPop!==null&&((officialPop>=20&&allDry)||(officialPop<=10&&allWet));
   const rawAgreement=agreement(rainSources,'rain');
   const probabilityAgreement=probabilityConflict?(officialPop>=20&&officialPop<50?.8:.5):1;
   const category=rainSources.length?new Set(rainSources.map(source=>source.category)).size===1?rainSources[0].category:'split':null;
   rainHours.push({time:iso(left),end:iso(right),durationHours,agreement:rawAgreement,probabilityAgreement,
    category:category==='dry'&&officialPop>=20?'rain-possible':category,sources:rainSources,officialPop,probabilityConflict,officialFallback:row?.rainLikelihood?.mode==='nws-fallback'});
  }
  const daylight=allSky.filter(hour=>hour.daylight),skyHours=daylight.length?daylight:allSky;
  const skyWindow=skyHours.length?{start:skyHours[0].time,end:skyHours.at(-1).end}:window;
  const sky=component(skyHours,skyWindow,daylight.length?'daylight':'remaining-night'),rainEvidence=component(rainHours,window,'calendar-day');
  rainEvidence.officialProbabilityCoveredHours=round(rainHours.filter(hour=>hour.officialPop!==null).reduce((sum,hour)=>sum+hour.durationHours,0));
  rainEvidence.officialProbabilityComplete=rainEvidence.expectedHours>0&&rainEvidence.officialProbabilityCoveredHours>=rainEvidence.expectedHours-1e-8;
  rainEvidence.fallbackHours=round(rainHours.filter(hour=>hour.officialFallback).reduce((sum,hour)=>sum+hour.durationHours,0));
  rainEvidence.probabilityConflictCap=rainHours.reduce((cap,hour)=>Math.min(cap,hour.probabilityAgreement*100),100);
  rainEvidence.worstModelHour=rainEvidence.worstHour;
  for(const hour of rainHours.filter(hour=>hour.probabilityConflict))if(!rainEvidence.worstHour||hour.probabilityAgreement<Math.min(rainEvidence.worstHour.agreement??1,rainEvidence.worstHour.probabilityAgreement))rainEvidence.worstHour=hour;
  const scores=[sky.score,rainEvidence.score],probabilityCoverageCap=rainEvidence.officialProbabilityComplete&&rainEvidence.fallbackHours===0?100:80;
  const score=scores.every(finite)?Math.min(...scores,probabilityCoverageCap,rainEvidence.probabilityConflictCap):null;
  const key=score===null?'unavailable':score>=85?'high':score>=70?'moderate':'low',label=key==='unavailable'?'Unavailable':key[0].toUpperCase()+key.slice(1);
  const ids=sourceIds.filter(id=>sky.completeSources.includes(id)||rainEvidence.completeSources.includes(id));
  const factors=[`${sky.completeSources.length} sky sources and ${rainEvidence.completeSources.length} rain-amount sources cover all assessed hours`,
   sky.scope==='daylight'?'Sky cover is compared during remaining daylight hours':'No daylight remains in this window; sky cover is compared during nighttime hours',
   `Forecast lead: ${index} day${index===1?'':'s'}; lead time does not reduce this agreement indicator`];
  if(!sky.complete||!rainEvidence.complete)factors.push('Some hours lack enough named forecast sources to compare.');
  if(rainEvidence.officialProbabilityCoveredHours<rainEvidence.expectedHours)factors.push('The official rain probability is unavailable for some assessed hours; the available model amounts are shown separately.');
  if(rainEvidence.fallbackHours>0)factors.push(`Official NWS rain fallback is used for ${rainEvidence.fallbackHours} assessed hours because required rain-model inputs are missing.`);
  if(rainHours.some(hour=>hour.probabilityConflict))factors.push('The official rain chance conflicts with the model rain amounts in some hours.');
  let summary=score===null?`${!sky.comparedHours&&!rainEvidence.comparedHours?'Cloud-cover and rain-amount forecasts':!sky.comparedHours?'Cloud-cover forecasts':'Rain-amount forecasts'} are unavailable or lack a second comparable source for these hours.`:key==='high'?'Available forecasts agree closely on sky cover and precipitation timing.':'Sky/rain agreement is limited by the available source coverage.';
  if(score!==null&&key!=='high'){
   if(rainEvidence.probabilityConflictCap<=score&&rainEvidence.probabilityConflictCap<100){
    const conflict=rainHours.filter(hour=>hour.probabilityConflict).sort((a,b)=>a.probabilityAgreement-b.probabilityAgreement)[0];
    summary=`NWS gives a ${conflict.officialPop}% rain chance at ${localClock(conflict.time,out.location?.timeZone)}, while the model amounts ${conflict.officialPop>=20?'stay below 0.001 inch for that hour':'show precipitation'}.`;
   }else if(sky.score<=score&&sky.score<85&&sky.worstHour?.agreement<1)summary=rangeSummary('sky',sky,rainEvidence,out.location?.timeZone)||summary;
   else if(rainEvidence.score<=score&&rainEvidence.score<85&&rainEvidence.worstModelHour?.agreement<1)summary=rangeSummary('rain',{...rainEvidence,worstHour:rainEvidence.worstModelHour},sky,out.location?.timeZone)||summary;
   else if(probabilityCoverageCap<=score&&probabilityCoverageCap<100)summary=rainEvidence.fallbackHours>0?`Required rain-model inputs are missing for ${rainEvidence.fallbackHours} hours, so those hours use the official NWS rain fallback.`:`The official rain probability is missing for ${round(rainEvidence.expectedHours-rainEvidence.officialProbabilityCoveredHours)} assessed hours; the available model amounts agree more closely.`;
   else if(!sky.complete||!rainEvidence.complete)summary=`Comparable ${!sky.complete?'sky-cover':'rain-amount'} evidence is missing for some assessed hours.`;
   else summary=`Only ${Math.min(sky.completeSources.length,rainEvidence.completeSources.length)} named sources cover both the assessed sky and rain windows.`;
  }
  day.confidence.weather={version:CONDITION_CONFIDENCE_VERSION,scope:'sky-and-rain',label,key,score,summary,factors,sourceIds:ids,sourceCount:ids.length,leadDays:index,
   note:'Agreement among named forecast sources about sky cover and precipitation timing, not a calibrated accuracy percentage or a claim that the sources are statistically independent. Temperature, wind and winter precipitation type are assessed separately. Hourly amounts below 0.001 inch are below the existing rain-signal minimum; 0.001 through 0.010 inch is trace precipitation, and larger amounts are wet. Missing values are never dry weather.',
   evidence:{window,sky,rain:rainEvidence}};
  day.confidence.temperature=temperatureComponent(day,index);
 }
 return out;
}
