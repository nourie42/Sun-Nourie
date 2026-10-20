import test from 'node:test';
import assert from 'node:assert/strict';
import {addConditionConfidence,CONDITION_CONFIDENCE_VERSION} from '../src/weatherFusionConditionConfidence.js';
const H=3600000,now=Date.parse('2026-10-20T00:00:00Z'),ids=['nws','ecmwf','nbm'];
const sources=(value,selected=ids)=>selected.map(id=>({id,value,weight:1/selected.length,runAt:'2026-10-19T18:00:00Z'}));
function fixture(count=1){
 const days=Array.from({length:count},(_,i)=>({date:new Date(now+i*24*H).toISOString().slice(0,10),confidence:{score:55,key:'low',label:'Low',summary:'Temperature forecasts differ.',factors:['Temperature gap'],temperatureSpread:9.5,rawTemperatureSpread:9.5,
  window:{start:new Date(now+i*24*H).toISOString(),end:new Date(now+(i+1)*24*H).toISOString()},temperatureComparison:{confidenceSpread:9.5},
  coverage:{temperature:{expectedHours:24,availableHours:24,complete:true,completeSources:ids},rain:{complete:true}},
  contributions:{high:ids.map((id,j)=>({id,value:70+j*4.75,weight:1/3,complete:true,coverageHours:24})),low:[],rain:[]}}}));
 const feels=Array.from({length:count*24},(_,i)=>({time:new Date(now+i*H).toISOString(),value:60,daylight:i%24>=7&&i%24<18,inputs:{skyCover:0,skySources:sources(0)}}));
 const rainTimeline=feels.map(row=>({time:row.time,end:new Date(Date.parse(row.time)+H).toISOString(),officialPop:0,precipitation:0,precipitationBlend:{sources:sources(0)}}));
 return {location:{timeZone:'UTC',latitude:35.787,longitude:-78.4806},days,metricForecasts:{series:{feels}},rainTimeline};
}
const calculate=out=>{addConditionConfidence(out,{now});return out.days[0].confidence.weather;};

test('ten days of complete sunny dry agreement remain High independently of temperature or lead time',()=>{
 const out=fixture(10),legacy=out.days.map(day=>({score:day.confidence.score,summary:day.confidence.summary,temperatureSpread:day.confidence.temperatureSpread}));
 addConditionConfidence(out,{now});
 for(const [i,day] of out.days.entries()){
  assert.equal(day.confidence.weather.label,'High');assert.equal(day.confidence.weather.score,100);assert.equal(day.confidence.weather.version,CONDITION_CONFIDENCE_VERSION);
  assert.equal(day.confidence.weather.scope,'sky-and-rain');assert.equal(day.confidence.weather.leadDays,i);
  assert.equal(day.confidence.score,legacy[i].score);assert.equal(day.confidence.summary,legacy[i].summary);assert.equal(day.confidence.temperatureSpread,legacy[i].temperatureSpread);
  assert.ok(day.confidence.temperature.score<85);assert.ok(day.confidence.temperature.factors.every(factor=>!/rain/i.test(factor)));
 }
});

test('cloud agreement uses all raw positive source values rather than the blended cloud percentage',()=>{
 const out=fixture();for(const row of out.metricForecasts.series.feels){row.inputs.skyCover=0;row.inputs.skySources=sources(0);row.inputs.skySources[2].value=100;}
 const weather=calculate(out);assert.equal(weather.key,'low');assert.equal(weather.evidence.sky.worstHour.sources.length,3);
 assert.deepEqual(weather.evidence.sky.worstHour.sources.map(source=>source.value),[0,0,100]);
});

test('a short cloud disagreement remains visible instead of disappearing in a daily average',()=>{
 const out=fixture();out.metricForecasts.series.feels[12].inputs.skySources[2].value=100;
 const weather=calculate(out);assert.notEqual(weather.key,'high');assert.equal(weather.evidence.sky.worstHour.time,new Date(now+12*H).toISOString());
});

test('equal daily rain totals at different hours do not imply agreement on rain timing',()=>{
 const out=fixture();out.rainTimeline[9].precipitationBlend.sources[1].value=.1;out.rainTimeline[15].precipitationBlend.sources[2].value=.1;
 const weather=calculate(out);assert.notEqual(weather.key,'high');assert.equal(weather.evidence.rain.worstHour.category,'split');
});

test('two complete sources cap agreement at Moderate while one source cannot establish agreement',()=>{
 for(const count of [2,1]){
  const out=fixture();for(const row of out.metricForecasts.series.feels)row.inputs.skySources=sources(0,ids.slice(0,count));for(const row of out.rainTimeline)row.precipitationBlend.sources=sources(0,ids.slice(0,count));
  const weather=calculate(out);assert.equal(weather.key,count===2?'moderate':'unavailable');
 }
});

test('missing rain or cloud measurements remain unknown rather than dry or clear',()=>{
 const out=fixture();for(const row of out.rainTimeline)row.precipitationBlend.sources=[];
 assert.equal(calculate(out).score,null);assert.equal(out.days[0].confidence.weather.evidence.rain.hours[0].category,null);
 const noCloud=fixture();for(const row of noCloud.metricForecasts.series.feels)row.inputs.skySources=[];
 assert.equal(calculate(noCloud).score,null);assert.equal(noCloud.days[0].confidence.weather.evidence.sky.hours[0].category,null);
});

test('one uncovered current-hour interval prevents a High agreement claim',()=>{
 const out=fixture();out.rainTimeline.splice(12,1);
 const weather=calculate(out);assert.equal(weather.key,'low');assert.equal(weather.evidence.rain.complete,false);assert.equal(weather.evidence.rain.coveredHours,23);
});

test('the existing rain minimum and trace thresholds preserve real drizzle evidence',()=>{
 const out=fixture();for(const row of out.rainTimeline){row.officialPop=40;row.precipitationBlend.sources=sources(.004);}
 const weather=calculate(out);assert.equal(weather.evidence.rain.hours[0].category,'trace');assert.ok(weather.evidence.rain.hours[0].sources.every(source=>source.category==='trace'));
 const boundary=fixture();boundary.rainTimeline[0].precipitationBlend.sources=sources(.001);assert.equal(calculate(boundary).evidence.rain.hours[0].category,'trace');
});

test('an official meaningful rain chance cannot be described as agreed dry weather',()=>{
 const out=fixture();out.rainTimeline[12].officialPop=60;
 const weather=calculate(out);assert.notEqual(weather.key,'high');assert.equal(weather.evidence.rain.worstHour.probabilityConflict,true);assert.equal(weather.evidence.rain.worstHour.category,'rain-possible');
});

test('invalid zero-weight and duplicate source records do not inflate independent coverage',()=>{
 const out=fixture();for(const row of out.metricForecasts.series.feels)row.inputs.skySources.push({id:'hrrr',value:100,weight:0},{id:'wn',value:NaN,weight:.1});
 const weather=calculate(out);assert.equal(weather.key,'high');assert.deepEqual(weather.evidence.sky.completeSources,ids);
 const duplicate=fixture();for(const row of duplicate.rainTimeline)row.precipitationBlend.sources.push({...row.precipitationBlend.sources[0]});
 assert.equal(calculate(duplicate).key,'moderate');
});

test('a duplicate timestamp cannot conceal conflicting canonical data',()=>{
 const out=fixture();out.rainTimeline.push({...out.rainTimeline[12],precipitationBlend:{sources:sources(.2)}});
 const weather=calculate(out);assert.equal(weather.key,'low');assert.equal(weather.evidence.rain.complete,false);
});

test('condition confidence does not modify original raw cloud rain or temperature evidence',()=>{
 const out=fixture(),before=structuredClone({feels:out.metricForecasts.series.feels,rain:out.rainTimeline,temperature:out.days[0].confidence.temperatureComparison});
 calculate(out);assert.deepEqual(out.metricForecasts.series.feels,before.feels);assert.deepEqual(out.rainTimeline,before.rain);assert.deepEqual(out.days[0].confidence.temperatureComparison,before.temperature);
});

test('missing official probabilities cap the main grade without concealing model agreement',()=>{
 const out=fixture();for(const row of out.rainTimeline)row.officialPop=null;
 const weather=calculate(out);assert.equal(weather.key,'moderate');assert.equal(weather.score,80);
 assert.equal(weather.evidence.rain.score,100);assert.equal(weather.evidence.rain.officialProbabilityComplete,false);assert.equal(weather.evidence.rain.officialProbabilityCoveredHours,0);
 assert.match(weather.factors.join(' '),/official rain probability is unavailable/);
});

test('official fallback hours cap the grade and disclose the missing model inputs',()=>{
 const out=fixture();out.rainTimeline[12].rainLikelihood={mode:'nws-fallback'};
 const weather=calculate(out);assert.equal(weather.key,'moderate');assert.equal(weather.evidence.rain.fallbackHours,1);assert.equal(weather.evidence.rain.score,100);
 assert.match(weather.factors.join(' '),/fallback.*1 assessed hours/);
});

test('one conflicting official probability cannot be averaged away',()=>{
 for(const [chance,score] of [[25,80],[60,50]]){
  const out=fixture();out.rainTimeline[12].officialPop=chance;
  const weather=calculate(out);assert.equal(weather.score,score);assert.equal(weather.evidence.rain.score,100);assert.equal(weather.evidence.rain.worstHour.officialPop,chance);
 }
});

test('dark remaining minutes after sunset cannot inherit an old daylight flag',()=>{
 const out=fixture(),time=Date.parse('2026-10-20T22:50:00Z');out.metricForecasts.series.feels[22].daylight=true;out.metricForecasts.series.feels[23].daylight=false;
 addConditionConfidence(out,{now:time});assert.equal(out.days[0].confidence.weather.evidence.sky.scope,'remaining-night');
});

test('a lower sky grade names the actual source values and local disagreement hour',()=>{
 const out=fixture();for(const row of out.metricForecasts.series.feels)row.inputs.skySources.push({id:'hrrr',value:0,weight:.25});
 out.metricForecasts.series.feels[12].inputs.skySources.find(source=>source.id==='hrrr').value=77;
 const weather=calculate(out);assert.notEqual(weather.key,'high');assert.match(weather.summary,/0% \(NWS\).*77% \(HRRR\).*Tue.*12 PM.*Rain guidance agrees/);
});
