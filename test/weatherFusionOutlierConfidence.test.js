import test from 'node:test';
import assert from 'node:assert/strict';
import {weightedTemperature,weighted,refreshCalendarConfidence} from '../src/weatherFusionDirect.js';
import {temperaturePolicy} from '../src/weatherFusionPolicy.js';
import {confidenceTemperatureEvidenceHTML} from '../public/weather-fusion/forecast-confidence.js';

const H=3600000,now=Date.parse('2026-10-19T12:00:00Z'),iso=t=>new Date(t).toISOString();
function fixture({dayIndex=2,values={nws:60,ecmwf:61,nbm:62,wn:80},adjust=true}={}){
 const start=Date.parse('2026-10-19T00:00:00Z')+dayIndex*24*H,ids=Object.keys(values);
 const days=Array.from({length:dayIndex+1},(_,i)=>({date:iso(Date.parse('2026-10-19T00:00:00Z')+i*24*H).slice(0,10)}));
 const qpfValues=Object.fromEntries(ids.map((id,i)=>[id,i===0?.1:0]));
 Object.assign(days[dayIndex],{qpf:.03,qpfBlend:{sourceValues:qpfValues,sources:ids.map(id=>({id,value:qpfValues[id],weight:1/ids.length}))},rainLikelihood:{coverage:{complete:true}}});
 const rows=Array.from({length:24},(_,i)=>{
  const blend=adjust?weightedTemperature(values,dayIndex):weighted(values,temperaturePolicy(dayIndex,Number.isFinite(values.wn)));
  return {time:iso(start+i*H),value:blend.value,sources:blend.sources,temperatureAdjustment:blend.temperatureAdjustment??null};
 });
 return {assembledAt:iso(now),location:{timeZone:'UTC'},days,metricForecasts:{series:{temperature:rows}},rainTimeline:rows.map(row=>({time:row.time,end:iso(Date.parse(row.time)+H),rainLikelihood:{mode:'blend',value:0}}))};
}
const compute=(f,index=2)=>{refreshCalendarConfidence(f,{now});return f.days[index].confidence;};

test('one isolated outlier cannot make an otherwise well-covered day low confidence',()=>{
 const before=compute(fixture({adjust:false})),out=fixture(),after=compute(out);
 assert.equal(before.key,'low');assert.equal(after.key,'high');assert.ok(after.score>before.score);
 assert.equal(after.temperatureSpread,2);assert.equal(after.rawTemperatureSpread,20);
 assert.equal(after.temperatureSpreadBasis,'peer-consensus');assert.equal(after.temperatureOutlierHours,24);
 assert.equal(after.temperatureComparison.worstHour.spread,20);assert.equal(after.temperatureComparison.confidenceHour.spread,2);
 assert.deepEqual(after.temperatureComparison.confidenceHour.sources.map(s=>s.id),['nws','ecmwf','nbm']);
 assert.match(after.summary,/reduced influence.*ECMWF/);
});
test('the day after tomorrow and tomorrow both use peer agreement only with the applied rule',()=>{
 for(const dayIndex of [1,2]){const c=compute(fixture({dayIndex}),dayIndex);assert.equal(c.temperatureOutlierHours,24);assert.equal(c.temperatureSpread,2);}
 for(const dayIndex of [0,3]){const c=compute(fixture({dayIndex}),dayIndex);assert.equal(c.temperatureOutlierHours,0);assert.equal(c.temperatureSpread,20);}
});
test('multiple disagreeing sources and an isolated ECMWF forecast retain their full uncertainty',()=>{
 for(const values of [{nws:60,ecmwf:70,nbm:62,wn:80},{nws:60,ecmwf:80,nbm:62,wn:61}]){
  const c=compute(fixture({values}));assert.equal(c.temperatureSpread,20);assert.equal(c.temperatureOutlierHours,0);assert.equal(c.key,'low');
 }
});
test('a stale or forged outlier flag cannot hide current source disagreement',()=>{
 for(const mutation of ['wide-peers','wrong-version','wrong-transfer','missing-adjustment']){
  const f=fixture();
  for(const row of f.metricForecasts.series.temperature){
   if(mutation==='wide-peers'){row.sources.find(s=>s.id==='nws').value=60;row.sources.find(s=>s.id==='nbm').value=64;row.sources.find(s=>s.id==='ecmwf').value=67;}
   if(mutation==='wrong-version')row.temperatureAdjustment.version='old';
   if(mutation==='wrong-transfer')row.temperatureAdjustment.transferredWeight=0;
   if(mutation==='missing-adjustment')row.temperatureAdjustment=null;
  }
  const c=compute(f);assert.equal(c.temperatureOutlierHours,0,mutation);assert.equal(c.temperatureSpread,20,mutation);
 }
});
test('missing rainfall coverage still limits confidence after a temperature outlier is reduced',()=>{
 const f=fixture();f.days[2].rainLikelihood.coverage.complete=false;
 const c=compute(f);assert.equal(c.key,'low');assert.match(c.summary,/rain forecast hours are missing/);assert.equal(c.temperatureSpread,2);
});
test('confidence details retain the full range and show actual reduced weights beside the score gap',()=>{
 const c=compute(fixture()),html=confidenceTemperatureEvidenceHTML(c,{timeZone:'UTC',assembledAt:iso(now)});
 assert.match(html,/Full model gap:.*20\.0°F/);assert.match(html,/Gap used for confidence:.*2\.0°F/);
 assert.match(html,/keeps 10%.*other 90% goes to ECMWF/);
 assert.match(html,/NVIDIA WeatherNext<small>reduced weight/);assert.match(html,/1\.4%<small>was 13\.7%/);
 assert.match(html,/24\.7%<small>was 12\.3%/);
 assert.match(html,/80\.0°/);
 assert.match(html,/Reduced temperature weights \(24 hours\)/);
 assert.match(html,/13\.7% → 1\.4%/);
 assert.match(html,/12\.3 percentage points transferred to ECMWF/);
});
