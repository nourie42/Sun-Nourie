import test from 'node:test';
import assert from 'node:assert/strict';
import {addConditionConfidence} from '../src/weatherFusionConditionConfidence.js';
import {refreshCalendarConfidence} from '../src/weatherFusionDirect.js';
import {confidenceTemperatureEvidenceHTML} from '../public/weather-fusion/forecast-confidence.js';
import {createEnsembleSpread,parseEnsembleDaily,representativeUncertainty,scoreEnsembleTemperature} from '../src/weatherFusionEnsembleSpread.js';

const H=3600000;
function payload({latitude=35.79,longitude=-78.48,ecmwf=70,gefs=71,days=2,gefsSpread=0}={}){
 const time=Array.from({length:days},(_,i)=>`2026-10-2${4+i}`);
 const daily={time};
 for(let member=1;member<=20;member++){
  daily[`temperature_2m_max_member${String(member).padStart(2,'0')}_ecmwf_ifs025_ensemble`]=Array(days).fill(ecmwf);
  daily[`temperature_2m_min_member${String(member).padStart(2,'0')}_ecmwf_ifs025_ensemble`]=Array(days).fill(50);
  daily[`temperature_2m_max_member${String(member).padStart(2,'0')}_ncep_gefs025`]=Array.from({length:days},()=>gefs+(member-10)*gefsSpread);
  daily[`temperature_2m_min_member${String(member).padStart(2,'0')}_ncep_gefs025`]=Array(days).fill(48);
 }
 daily.temperature_2m_max_ecmwf_ifs025_ensemble=Array(days).fill(99);
 daily.temperature_2m_min_ecmwf_ifs025_ensemble=Array(days).fill(1);
 const daily_units=Object.fromEntries(Object.keys(daily).map(key=>[key,key==='time'?'iso8601':'°F']));
 return {latitude,longitude,timezone:'America/New_York',daily_units,daily};
}

test('member spread ignores the published ensemble mean and a warm daily-low bias',()=>{
 const parsed=parseEnsembleDaily(payload(),{latitude:35.787,longitude:-78.4806});
 assert.equal(parsed.status,'ready');
 assert.equal(parsed.days[0].models.ecmwf.maxSd,0);
 assert.equal(parsed.days[0].models.ecmwf.maxMean,70);
 assert.ok(parsed.days[0].uncertainty<1);
 const biased=representativeUncertainty({models:{ecmwf:{maxSd:1,minSd:1,maxMean:70,minMean:40},gefs:{maxSd:1.5,minSd:1,maxMean:74,minMean:47}}});
 assert.equal(biased,2);
 const split=representativeUncertainty({models:{ecmwf:{maxSd:1,minSd:1,maxMean:60,minMean:40},gefs:{maxSd:1,minSd:1,maxMean:72,minMean:41}}});
 assert.equal(split,6);
});

test('a tight near day rates High and a still-tight later day steps down only in the combined rating',()=>{
 const near=scoreEnsembleTemperature({dayIndex:3,uncertainty:2.24,models:['ecmwf','gefs']});
 const later=scoreEnsembleTemperature({dayIndex:6,uncertainty:2.92,models:['ecmwf','gefs']});
 const wide=scoreEnsembleTemperature({dayIndex:1,uncertainty:8,models:['ecmwf','gefs']});
 assert.equal(near.key,'high');assert.equal(later.key,'high');assert.ok(later.score>=85);
 assert.equal(wide.key,'low');
 assert.match(near.summary,/member spread|agree within/);
 assert.ok(near.factors.every(factor=>!/rain/i.test(factor)));
});

test('bad ensemble payloads and fetch failures stay unavailable',async()=>{
 assert.throws(()=>parseEnsembleDaily(payload({latitude:40}),{latitude:35.787,longitude:-78.4806}),/grid/);
 const badUnits=payload();badUnits.daily_units.temperature_2m_max_member01_ecmwf_ifs025_ensemble='°C';
 assert.throws(()=>parseEnsembleDaily(badUnits,{latitude:35.787,longitude:-78.4806}),/Fahrenheit/);
 const failed=await createEnsembleSpread({fetchImpl:async()=>{throw new Error('offline');}})({latitude:35.787,longitude:-78.4806},'America/New_York');
 assert.equal(failed.value.status,'unavailable');assert.deepEqual(failed.value.days,[]);
 const ready=await createEnsembleSpread({fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(payload())})})({latitude:35.787,longitude:-78.4806},'America/New_York');
 assert.equal(ready.value.status,'ready');assert.equal(ready.value.days[0].usable,true);
});

test('settled ensemble days are High early and lower later, while a real sky disagreement still blocks High',()=>{
 const now=Date.parse('2026-10-24T16:00:00Z'),ids=['nws','ecmwf','nbm'];
 const sources=value=>ids.map(id=>({id,value,weight:1/ids.length}));
 const days=Array.from({length:7},(_,i)=>({date:`2026-10-${24+i}`,confidence:{score:60,key:'low',label:'Low',summary:'Hourly gap',factors:['gap'],temperatureSpread:8,temperatureSpreadExcludingGefs:2,
  window:{start:new Date(now+i*24*H).toISOString(),end:new Date(now+(i+1)*24*H).toISOString()},temperatureComparison:{basis:'maximum-same-hour-spread',confidenceBasis:'same-hour',worstHour:null,dailyHigh:null},
  coverage:{temperature:{expectedHours:24,availableHours:24,complete:true,completeSources:ids},rain:{complete:true}},
  contributions:{high:ids.map(id=>({id,value:70,weight:1/3,complete:true,coverageHours:24})),low:[],rain:[]}}}));
 const feels=Array.from({length:7*24},(_,i)=>({time:new Date(now+i*H).toISOString(),value:60,daylight:true,inputs:{skyCover:10,skySources:sources(10)}}));
 const rainTimeline=feels.map(row=>({time:row.time,end:new Date(Date.parse(row.time)+H).toISOString(),officialPop:0,precipitationBlend:{sources:sources(0)}}));
 const uncertainties=[1.6,1.7,2.1,2.24,2.64,3.32,2.92];
 const out={location:{timeZone:'UTC',latitude:35.787,longitude:-78.4806},days,metricForecasts:{series:{feels}},rainTimeline,
  ensembleSpread:{status:'ready',days:days.map((day,index)=>({date:day.date,usable:true,uncertainty:uncertainties[index],modelIds:['ecmwf','gefs']}))}};
 addConditionConfidence(out,{now});
 const labels=out.days.map(day=>day.confidence.overall.label);
 assert.deepEqual(labels,['High','High','High','High','High','High','Moderate']);
 assert.equal(out.days[3].confidence.temperature.key,'high');
 assert.equal(out.days[6].confidence.temperature.key,'high');
 assert.equal(out.days[6].confidence.temperature.temperatureComparison.confidenceBasis,'ensemble-daily-spread');
 assert.ok(out.days[6].confidence.overall.score<out.days[3].confidence.overall.score);
 out.metricForecasts.series.feels.forEach(row=>{row.inputs.skySources[2].value=100;});
 addConditionConfidence(out,{now});
 assert.notEqual(out.days[0].confidence.overall.key,'high');
});

test('an overnight GEFS mean gap does not set the temperature rating when member spread is missing',()=>{
 const now=Date.parse('2026-10-19T12:00:00Z'),start=Date.parse('2026-10-21T00:00:00Z');
 const days=[{date:'2026-10-19'},{date:'2026-10-20'},{date:'2026-10-21'}];
 const ids=['nws','ecmwf','nbm'];
 const qpfValues=Object.fromEntries([...ids,'gefs'].map(id=>[id,0]));
 Object.assign(days[2],{qpf:0,qpfBlend:{sourceValues:qpfValues,sources:[...ids,'gefs'].map(id=>({id,value:0,weight:.25}))},rainLikelihood:{coverage:{complete:true}}});
 const rows=Array.from({length:24},(_,i)=>({time:new Date(start+i*H).toISOString(),value:60,sources:[...ids.map(id=>({id,value:60,weight:.25})),{id:'gefs',value:68,weight:.25}]}));
 const out={assembledAt:new Date(now).toISOString(),location:{timeZone:'UTC'},days,metricForecasts:{series:{temperature:rows}},rainTimeline:rows.map(row=>({time:row.time,end:new Date(Date.parse(row.time)+H).toISOString(),rainLikelihood:{mode:'blend',value:0}}))};
 refreshCalendarConfidence(out,{now});
 const confidence=out.days[2].confidence;
 assert.equal(confidence.temperatureSpread,8);
 assert.equal(confidence.temperatureSpreadExcludingGefs,0);
 assert.equal(confidence.temperature.key,'high');
 assert.match(confidence.temperature.summary,/GEFS ensemble mean/);
});

test('ensemble details keep the existing temperature table and explain the member spread',()=>{
 const html=confidenceTemperatureEvidenceHTML({temperatureComparison:{basis:'maximum-same-hour-spread',confidenceBasis:'ensemble-daily-spread',ensembleUncertainty:2.2,
  worstHour:{time:'2026-10-27T05:00:00Z',spread:8,low:{id:'nbm',value:44},high:{id:'gefs',value:52},sources:[{id:'nbm',value:44},{id:'gefs',value:52}]},
  dailyHigh:{spread:2,low:{id:'nws',value:70},high:{id:'ecmwf',value:72},sources:[{id:'nws',value:70},{id:'ecmwf',value:72}]}}}, {timeZone:'UTC',temperatureRating:true});
 assert.match(html,/data-temperature-basis="ensemble-daily-spread"/);
 assert.match(html,/ensemble member spread/);
 assert.match(html,/Largest same-hour gap/);
 assert.doesNotMatch(html,/checks hourly differences/);
 assert.equal((html.match(/<section/g)||[]).length,1);
});
