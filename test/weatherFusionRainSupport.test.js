import test from 'node:test';
import assert from 'node:assert/strict';
import {precipitationLikelihood,validateSnapshot} from '../src/weatherFusionDirect.js';
import {EXTENDED_RAIN_WEIGHTS} from '../src/weatherFusionPolicy.js';
import {buildForecast} from '../src/weatherFusion.js';
import {modelExplanationHTML} from '../public/weather-fusion/model-explanation.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';

const extended=(pop,amounts)=>precipitationLikelihood(pop,{sourceValues:amounts},EXTENDED_RAIN_WEIGHTS);

test('the reported 0.055-inch ECMWF blip adds 20 points rather than 60',()=>{
  const score=extended(8,{hrrr:0,ecmwf:.055,nbm:0});
  assert.equal(score.sourcePoints.ecmwf,20);
  assert.equal(score.rawTotal,21.2);
  assert.equal(score.value,21);
  assert.equal(score.sourceAmounts.ecmwf,.055);
  assert.ok(Math.abs(score.sourceValues.ecmwf-100/3)<1e-8);
  assert.deepEqual(score.reductionReasons,{ecmwf:'uncorroborated'});
  assert.equal(score.sources.find(s=>s.id==='ecmwf').weight,.6);
});

test('NWS or another included meaningful model can corroborate full credit',()=>{
  assert.equal(extended(19,{ecmwf:.055,nbm:0}).sourcePoints.ecmwf,20);
  assert.equal(extended(20,{ecmwf:.055,nbm:0}).sourcePoints.ecmwf,60);
  assert.equal(extended(0,{ecmwf:.055,nbm:.010}).sourcePoints.ecmwf,20);
  const supported=extended(0,{ecmwf:.055,nbm:.010001});
  assert.equal(supported.sourcePoints.ecmwf,60);
  assert.equal(supported.sourcePoints.nbm,25);
  assert.deepEqual(supported.reducedSources,[]);
});

test('excluded HRRR and missing inputs cannot corroborate extended rain',()=>{
  for(const pop of [0,null])for(const nbm of [0,null]) {
    const score=extended(pop,{hrrr:1,ecmwf:.055,nbm});
    assert.equal(score.sourcePoints.ecmwf,20);
    assert.equal(score.sourcePoints.hrrr,null);
    assert.equal(score.sourcePoints.nbm,nbm===0?0:null);
    assert.ok(!score.drySources.includes('hrrr'));
    assert.equal(score.officialProbability,pop);
  }
});

test('the support cap also applies consistently to same-day models',()=>{
  for(const [id,points] of [['hrrr',10],['ecmwf',3.33333333],['nbm',6.66666667]]) {
    const amounts={hrrr:0,ecmwf:0,nbm:0,[id]:.055};
    const score=precipitationLikelihood(8,{sourceValues:amounts});
    assert.equal(score.sourcePoints[id],points);
    assert.equal(score.reductionReasons[id],'uncorroborated');
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
    assert.ok(rows.every(row=>row.rainLikelihood.value===21&&row.rainLikelihood.sourcePoints.ecmwf===20));
    assert.ok(rows.every(row=>row.rainLikelihood.sourceAmounts.ecmwf===.055));
    assert.ok(rows.every(row=>row.precipitation===.033));
    for(const hour of forecast.hours.filter(row=>rows.some(r=>r.time===row.time)))assert.equal(hour.rainLikelihood.value,21);
    const index=forecast.days.findIndex(day=>Date.parse(day.rainLikelihood.window.start)<=target&&Date.parse(day.rainLikelihood.window.end)>target);
    const day=forecast.days[index];
    assert.equal(day.rainLikelihood.value,21);
    assert.equal(day.rainLikelihood.peak.sourcePoints.ecmwf,20);
    const html=modelExplanationHTML(forecast,{index,phase:'overall',now});
    assert.match(html,/Uncorroborated rain: one-third of model points/);
    assert.match(html,/<td>20<small>of 60 max<\/small><\/td>/);
    assert.match(html,/1\.2 \+ 20 \+ 0 = 21\.2/);
    assert.match(html,/Shown: <b>21%/);
  });
}
