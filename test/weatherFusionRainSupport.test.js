import test from 'node:test';
import assert from 'node:assert/strict';
import {precipitationLikelihood,publishedPrecipitationLikelihood,deterministicRainSignal,MIN_RAIN_SIGNAL_INCHES,validateSnapshot} from '../src/weatherFusionDirect.js';
import {EXTENDED_RAIN_WEIGHTS,precipitationPolicy} from '../src/weatherFusionPolicy.js';
import {buildForecast} from '../src/weatherFusion.js';
import {modelExplanationHTML} from '../public/weather-fusion/model-explanation.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';

const extended=(pop,amounts)=>precipitationLikelihood(pop,{sourceValues:amounts},EXTENDED_RAIN_WEIGHTS);

test('every positive WeatherNext amount through .010 receives one-third of its share',()=>{
 const policy=precipitationPolicy(1,true);
 for(const amount of [.00000214,.00001069,.00000316,.00099999]){
  const score=publishedPrecipitationLikelihood(2,{sourceValues:{hrrr:0,ecmwf:0,nbm:0,wn:amount}},policy);
  assert.equal(score.sourcePoints.wn,3.33333333);
  assert.equal(score.value,4);
  assert.equal(score.officialProbability,2);
  assert.equal(score.sourceAmounts.wn,amount,'retain the actual published model amount');
  assert.equal(score.sources.find(s=>s.id==='wn').weight,.1);
  assert.equal(score.reductionReasons.wn,'trace');
  assert.ok(score.wetSources.includes('wn'));
  assert.ok(!score.drySources.includes('wn'),'do not mislabel a tiny positive amount as a published zero');
 }
});

test('the hourly signal boundaries follow zero, one-third and full-credit tiers exactly',()=>{
 assert.equal(MIN_RAIN_SIGNAL_INCHES,0);
 assert.equal(deterministicRainSignal(null),null);
 assert.equal(deterministicRainSignal(0),0);
 for(const amount of [Number.MIN_VALUE,.00000214,.00099999,.001,.00306636,.010])assert.ok(Math.abs(deterministicRainSignal(amount)-100/3)<1e-8);
 assert.equal(deterministicRainSignal(.010001),100);
 for(const id of ['hrrr','ecmwf','nbm']){
  const score=precipitationLikelihood(0,{sourceValues:{hrrr:0,ecmwf:0,nbm:0,[id]:.00000214}});
  assert.ok(score.sourcePoints[id]>0);
  assert.equal(score.reductionReasons[id],'trace');
 }
 const missing=publishedPrecipitationLikelihood(40,{sourceValues:{hrrr:0,ecmwf:0,nbm:null}});
 assert.equal(missing.value,40);assert.equal(missing.mode,'nws-fallback');
});

test('QPF above .010 receives the model full share without corroboration',()=>{
  const score=extended(8,{hrrr:0,ecmwf:.055,nbm:0});
  assert.equal(score.sourcePoints.ecmwf,42.352941);
  assert.equal(score.rawTotal,45.552941);
  assert.equal(score.value,46);
  assert.equal(score.sourceAmounts.ecmwf,.055);
  assert.equal(score.sourceValues.ecmwf,100);
  assert.deepEqual(score.reductionReasons,{});
  assert.equal(score.sources.find(s=>s.id==='ecmwf').weight,.42352941);
});

test('the full-credit tier does not depend on NWS or another model',()=>{
  assert.equal(extended(0,{ecmwf:.055,nbm:0}).sourcePoints.ecmwf,42.352941);
  assert.equal(extended(19,{ecmwf:.055,nbm:0}).sourcePoints.ecmwf,42.352941);
  assert.equal(extended(20,{ecmwf:.055,nbm:0}).sourcePoints.ecmwf,42.352941);
  assert.equal(extended(0,{ecmwf:.055,nbm:.010}).sourcePoints.ecmwf,42.352941);
  const supported=extended(0,{ecmwf:.055,nbm:.010001});
  assert.equal(supported.sourcePoints.ecmwf,42.352941);
  assert.equal(supported.sourcePoints.nbm,17.647059);
  assert.deepEqual(supported.reducedSources,[]);
});

test('excluded HRRR and missing inputs cannot corroborate extended rain',()=>{
  for(const pop of [0,null])for(const nbm of [0,null]) {
    const score=extended(pop,{hrrr:1,ecmwf:.055,nbm});
    assert.equal(score.sourcePoints.ecmwf,42.352941);
    assert.equal(score.sourcePoints.hrrr,null);
    assert.equal(score.sourcePoints.nbm,nbm===0?0:null);
    assert.ok(!score.drySources.includes('hrrr'));
    assert.equal(score.officialProbability,pop);
  }
});

test('the full-credit tier applies consistently to same-day models',()=>{
  for(const [id,points] of [['hrrr',30],['ecmwf',10],['nbm',20]]) {
    const amounts={hrrr:0,ecmwf:0,nbm:0,[id]:.055};
    const score=precipitationLikelihood(8,{sourceValues:amounts});
    assert.equal(score.sourcePoints[id],points);
    assert.equal(score.reductionReasons[id],undefined);
  }
  const supported=precipitationLikelihood(0,{sourceValues:{hrrr:.02,ecmwf:.02,nbm:0}});
  assert.equal(supported.sourcePoints.hrrr,30);
  assert.equal(supported.sourcePoints.ecmwf,10);
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
    assert.ok(rows.every(row=>row.rainLikelihood.value===46&&row.rainLikelihood.sourcePoints.ecmwf===42.352941));
    assert.ok(rows.every(row=>row.rainLikelihood.sourceAmounts.ecmwf===.055));
    assert.ok(rows.every(row=>row.precipitation===.033));
    for(const hour of forecast.hours.filter(row=>rows.some(r=>r.time===row.time)))assert.equal(hour.rainLikelihood.value,46);
    const index=forecast.days.findIndex(day=>Date.parse(day.rainLikelihood.window.start)<=target&&Date.parse(day.rainLikelihood.window.end)>target);
    const day=forecast.days[index];
    assert.equal(day.rainLikelihood.value,46);
    assert.equal(day.rainLikelihood.peak.sourcePoints.ecmwf,42.352941);
    const html=modelExplanationHTML(forecast,{index,phase:'overall',now});
    assert.match(html,/above 0\.010 in\/hour gets all of its points/i);
    assert.match(html,/<td>42\.352941<small>of 42\.3529 max<\/small><\/td>/);
    assert.match(html,/3\.2 \+ 42\.3529 \+ 0 = 45\.552941/);
    assert.match(html,/Shown: <b>46%/);
  });
}
