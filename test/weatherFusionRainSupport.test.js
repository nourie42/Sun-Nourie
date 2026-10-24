import test from 'node:test';
import assert from 'node:assert/strict';
import {precipitationLikelihood,publishedPrecipitationLikelihood,deterministicRainSignal,MIN_RAIN_SIGNAL_INCHES,validateSnapshot} from '../src/weatherFusionDirect.js';
import {EXTENDED_RAIN_WEIGHTS,precipitationPolicy} from '../src/weatherFusionPolicy.js';
import {buildForecast} from '../src/weatherFusion.js';
import {modelExplanationHTML} from '../public/weather-fusion/model-explanation.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';

const extended=(pop,amounts)=>precipitationLikelihood(pop,{sourceValues:amounts},EXTENDED_RAIN_WEIGHTS);

test('the reported tiny WeatherNext amounts do not create a repeated 3.33-point rain floor',()=>{
 const policy=precipitationPolicy(1,true);
 for(const amount of [.00000214,.00001069,.00000316,.00099999]){
  const score=publishedPrecipitationLikelihood(2,{sourceValues:{hrrr:0,ecmwf:0,nbm:0,wn:amount}},policy);
  assert.equal(score.sourcePoints.wn,0);
  assert.equal(score.value,0);
  assert.equal(score.officialProbability,2);
  assert.equal(score.sourceAmounts.wn,amount,'retain the actual published model amount');
  assert.equal(score.sources.find(s=>s.id==='wn').weight,.1);
  assert.equal(score.reductionReasons.wn,'below-minimum');
  assert.ok(score.negligibleSources.includes('wn'));
  assert.ok(!score.drySources.includes('wn'),'do not mislabel a tiny positive amount as a published zero');
 }
});

test('the hourly signal floor preserves resolved light rain, zero and unavailable inputs',()=>{
 assert.equal(MIN_RAIN_SIGNAL_INCHES,.001);
 assert.equal(deterministicRainSignal(null),null);
 assert.equal(deterministicRainSignal(0),0);
 assert.equal(deterministicRainSignal(.00099999),0);
 for(const amount of [.001,.00306636,.010])assert.ok(Math.abs(deterministicRainSignal(amount)-100/3)<1e-8);
 assert.equal(deterministicRainSignal(.010001),100);
 for(const id of ['hrrr','ecmwf','nbm']){
  const score=precipitationLikelihood(0,{sourceValues:{hrrr:0,ecmwf:0,nbm:0,[id]:.00000214}});
  assert.equal(score.sourcePoints[id],0);
  assert.equal(score.reductionReasons[id],'below-minimum');
 }
 const missing=publishedPrecipitationLikelihood(40,{sourceValues:{hrrr:0,ecmwf:0,nbm:null}});
 assert.equal(missing.value,40);assert.equal(missing.mode,'nws-fallback');
});

test('the reported 0.055-inch ECMWF blip adds 9.4017 points rather than 28.2051',()=>{
  const score=extended(8,{hrrr:0,ecmwf:.055,nbm:0});
  assert.equal(score.sourcePoints.ecmwf,9.40170933);
  assert.equal(score.rawTotal,11.65811957);
  assert.equal(score.value,12);
  assert.equal(score.sourceAmounts.ecmwf,.055);
  assert.ok(Math.abs(score.sourceValues.ecmwf-100/3)<1e-8);
  assert.deepEqual(score.reductionReasons,{ecmwf:'uncorroborated'});
  assert.equal(score.sources.find(s=>s.id==='ecmwf').weight,.28205128);
});

test('NWS or another included meaningful model can corroborate full credit',()=>{
  assert.equal(extended(19,{ecmwf:.055,nbm:0}).sourcePoints.ecmwf,9.40170933);
  assert.equal(extended(20,{ecmwf:.055,nbm:0}).sourcePoints.ecmwf,28.205128);
  assert.equal(extended(0,{ecmwf:.055,nbm:.010}).sourcePoints.ecmwf,9.40170933);
  const supported=extended(0,{ecmwf:.055,nbm:.010001});
  assert.equal(supported.sourcePoints.ecmwf,28.205128);
  assert.equal(supported.sourcePoints.nbm,43.589744);
  assert.deepEqual(supported.reducedSources,[]);
});

test('excluded HRRR and missing inputs cannot corroborate extended rain',()=>{
  for(const pop of [0,null])for(const nbm of [0,null]) {
    const score=extended(pop,{hrrr:1,ecmwf:.055,nbm});
    assert.equal(score.sourcePoints.ecmwf,9.40170933);
    assert.equal(score.sourcePoints.hrrr,null);
    assert.equal(score.sourcePoints.nbm,nbm===0?0:null);
    assert.ok(!score.drySources.includes('hrrr'));
    assert.equal(score.officialProbability,pop);
  }
});

test('the support cap also applies consistently to same-day models',()=>{
  for(const [id,points] of [['hrrr',11.851852],['ecmwf',4.074074],['nbm',9.62962967]]) {
    const amounts={hrrr:0,ecmwf:0,nbm:0,[id]:.055};
    const score=precipitationLikelihood(8,{sourceValues:amounts});
    assert.equal(score.sourcePoints[id],points);
    assert.equal(score.reductionReasons[id],'uncorroborated');
  }
  const supported=precipitationLikelihood(0,{sourceValues:{hrrr:.02,ecmwf:.02,nbm:0}});
  assert.equal(supported.sourcePoints.hrrr,35.555556);
  assert.equal(supported.sourcePoints.ecmwf,12.222222);
});

for(const [name,latitude,longitude] of [['Greenville, NC',35.6127,-77.3664],['Raleigh, NC',35.7796,-78.6382]]) {
  test(`${name}: a three-hour ECMWF interval cannot inflate hourly, daily or explanation scores`,()=>{
    const input=structuredClone(testInputs),now=input.now,H=3600000,target=now+36*H;
    input.location={...input.location,name,latitude,longitude};
    input.grid.quantitativePrecipitation.values.forEach(row=>{row.value=0;});
    input.hourly.periods=Array.from({length:180},(_,i)=>({
      startTime:new Date(now+i*H).toISOString(),endTime:new Date(now+(i+1)*H).toISOString(),
      probabilityOfPrecipitation:{value:8},temperature:70,shortForecast:'Partly Sunny'
    }));
    input.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{
      const native=snapshot(id),point=native.points[0];
      point.latitude=latitude;point.longitude=longitude;
      point.precipitationIntervals.forEach(row=>{row.value=0;});
      if(id==='ecmwf') {
        const intervals=point.precipitationIntervals;
        const start=intervals.findIndex(row=>row.start*1000===target);
        intervals.splice(start,3,{start:target/1000,end:(target+3*H)/1000,value:.165});
      }
      return [id,validateSnapshot(native,id,input.location,now).value];
    }));
    const forecast=buildForecast(input),rows=forecast.rainTimeline.filter(row=>Date.parse(row.time)>=target&&Date.parse(row.time)<target+3*H);
    assert.equal(rows.length,3);
    assert.ok(rows.every(row=>row.rainLikelihood.value===12&&row.rainLikelihood.sourcePoints.ecmwf===9.40170933));
    assert.ok(rows.every(row=>row.rainLikelihood.sourceAmounts.ecmwf===.055));
    assert.ok(rows.every(row=>row.precipitation===.0155128));
    for(const hour of forecast.hours.filter(row=>rows.some(r=>r.time===row.time)))assert.equal(hour.rainLikelihood.value,12);
    const index=forecast.days.findIndex(day=>Date.parse(day.rainLikelihood.window.start)<=target&&Date.parse(day.rainLikelihood.window.end)>target);
    const day=forecast.days[index];
    assert.equal(day.rainLikelihood.value,12);
    assert.equal(day.rainLikelihood.peak.sourcePoints.ecmwf,9.40170933);
    const html=modelExplanationHTML(forecast,{index,phase:'overall',now});
    assert.match(html,/Uncorroborated rain: one-third of model points/);
    assert.match(html,/<td>9\.401709<small>of 28\.2051 max<\/small><\/td>/);
    assert.match(html,/2\.2564 \+ 9\.4017 \+ 0 = 11\.65811957/);
    assert.match(html,/Shown: <b>12%/);
  });
}
