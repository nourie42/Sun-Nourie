import test from 'node:test';
import assert from 'node:assert/strict';
import {alignGuidanceCurrentWithHourly} from '../src/weatherFusionCurrent.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';

// Minimal records retained from the Oct 20, 2026 Knightdale live capture.
// Embedding the relevant evidence keeps this regression independent of local
// audit files and avoids rebuilding its expected values with the implementation.
const snapshots=[
 {hour:'13',temperature:52,dewpoint:37.5,wind:10,humidity:57.6,skyCover:.0017,
  feels:44.8,shade:41.5,sun:45,
  temperatureValues:[52,50.3,53.5,56.2,52.16489990234379],skyValues:[0,0,0,0,.01681362045928836]},
 {hour:'21',temperature:71,dewpoint:39.9,wind:10.4,humidity:32.3,skyCover:.5505,
  feels:64.2,shade:59.7,sun:64,
  temperatureValues:[71,71.6,68.3,72,72.55255859375004],skyValues:[1,0,0,1,.10548451682552695]},
];
const ids=['nws','hrrr','ecmwf','nbm','wn'],weights=[.36,.27,.09,.18,.1];
function fixture(saved){
 const time=`2026-10-20T${saved.hour}:00:00.000Z`,now=Date.parse(`2026-10-20T${saved.hour}:45:00.000Z`);
 const sources=values=>ids.map((id,i)=>({id,value:values[i],weight:weights[i]}));
 const skySources=sources(saved.skyValues),temperatureSources=sources(saved.temperatureValues);
 const inputs={temperature:saved.temperature,dewpoint:saved.dewpoint,wind:saved.wind,humidity:saved.humidity,skyCover:saved.skyCover,
  skySource:'NWS 36% / HRRR 27% / ECMWF 9% / NBM 18% / WN 10%',skySources};
 const feels={time,value:saved.feels,shadeValue:saved.shade,sunValue:saved.sun,condition:'Sunny',daylight:true,weatherKind:'clear',inputs};
 const out={assembledAt:new Date(now).toISOString(),location:{id:'knightdale',latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},
  current:{type:'guidance',temperature:51.8,dewpoint:44.2,wind:7.4,humidity:75,condition:'Sunny',time,
   sourceValidation:{accepted:false},localEstimate:{source:'NOAA National Blend · 2.5 km'}},
  hours:[{time,temperature:saved.temperature,condition:'Sunny',isDay:true,pop:0,precipitation:0,rainLikelihood:{value:0}}],
  days:[{date:'2026-10-20'}],metricForecasts:{series:{feels:[feels],
   temperature:[{time,value:saved.temperature,source:'Forecast blend',sources:temperatureSources}],
   dewpoint:[{time,value:saved.dewpoint,source:inputs.skySource}],wind:[{time,value:saved.wind,source:inputs.skySource}],
   humidity:[{time,value:saved.humidity,source:'Same-hour temperature and dew point'}]}}};
 return {out,now,time,feels};
}

for(const saved of snapshots)test(`saved ${saved.hour}:45Z modeled Now matches its canonical hour instead of a second solar clock`,()=>{
 const {out,now,time,feels}=fixture(saved),before=structuredClone(out.metricForecasts);
 const canonical=thermalComfort({...feels.inputs,condition:feels.condition,type:'guidance'},out.location,Date.parse(time));
 const actualClock=thermalComfort({...feels.inputs,condition:feels.condition,type:'guidance'},out.location,now);
  assert.ok(Math.abs(canonical.rawOutdoors-actualClock.rawOutdoors)>.2,'saved case must detect a changing solar exposure');
 alignGuidanceCurrentWithHourly(out,now);
 for(const key of ['temperature','dewpoint','wind','humidity','skyCover'])assert.equal(out.current[key],feels.inputs[key],key);
 assert.equal(out.current.time,time);assert.equal(out.current.thermalTime,time);
 assert.equal(out.current.localEstimate.basis,'canonical-hourly-blend');
 assert.equal(out.current.feelsLike,saved.feels);assert.equal(out.current.feelsLikeShade,saved.shade);assert.equal(out.current.feelsLikeSun,saved.sun);
 const sample=currentSample(out,now);
 assert.equal(sample.temperature,saved.temperature);assert.equal(sample.feels,saved.feels);
 assert.equal(sample.comfort.shade,saved.shade);assert.equal(sample.comfort.sun,saved.sun);
 assert.equal(sample.comfort.rawOutdoors,canonical.rawOutdoors);
 assert.equal(sample.inputs.thermalTime,time);assert.equal(sample.inputs.temperature,feels.inputs.temperature);
 assert.deepEqual(out.metricForecasts,before,'current alignment cannot rewrite future model data');
});
