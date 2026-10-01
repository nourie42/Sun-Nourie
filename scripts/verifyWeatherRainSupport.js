import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {precipitationLikelihood,summarizeRainTimeline} from '../src/weatherFusionDirect.js';
import {precipitationPolicy,forecastDayIndex,REPAIR_VERSION} from '../src/weatherFusionPolicy.js';
import {modelExplanationView} from '../public/weather-fusion/model-explanation.js';

// Replay captured production source amounts through the same canonical scorer
// and period aggregation as the server. Optionally pass captured API snapshots;
// without a directory, fetch current public inputs for the three tested points.
const directory=process.argv[2];
const report={version:REPAIR_VERSION,verifiedAt:new Date().toISOString(),mode:directory?'captured-live-input-replay':'current-live-input-replay',cities:[]};
for(const [city,latitude,longitude] of [['greenville',35.6127,-77.3664],['raleigh',35.7796,-78.6382],['knightdale',35.787,-78.4806]]) {
  const original=directory?JSON.parse(await readFile(`${directory}/${city}.json`,'utf8')):await (async()=>{
    const response=await fetch(`https://sun-nourie-live.onrender.com/api/weather-fusion/forecast?latitude=${latitude}&longitude=${longitude}`,{cache:'no-store',signal:AbortSignal.timeout(90000)});
    assert.equal(response.ok,true,`${city}: forecast HTTP ${response.status}`);
    return response.json();
  })();
  const forecast=structuredClone(original),now=Date.parse(forecast.assembledAt),zone=forecast.location.timeZone;
  const changes=[];
  for(const row of forecast.rainTimeline) {
    const previous=row.rainLikelihood;
    const policy=precipitationPolicy(forecastDayIndex(Date.parse(row.time),now,zone));
    row.rainLikelihood=precipitationLikelihood(row.officialPop,{sourceValues:previous.sourceAmounts},policy);
    row.rainLikelihood.sources=row.rainLikelihood.sources.map(source=>({...source,runAt:previous.sources.find(s=>s.id===source.id)?.runAt||null}));
    if(previous.value!==row.rainLikelihood.value)changes.push({time:row.time,old:previous.value,new:row.rainLikelihood.value,amounts:previous.sourceAmounts,reductionReasons:row.rainLikelihood.reductionReasons});
    for(const source of row.rainLikelihood.sources)if(source.id!=='nws'&&source.value===100) {
      assert.ok(row.officialPop>=20||row.rainLikelihood.sources.some(s=>s.id!==source.id&&s.id!=='nws'&&row.rainLikelihood.sourceAmounts[s.id]>.010));
    }
  }
  for(const hour of forecast.hours)hour.rainLikelihood=forecast.rainTimeline.find(row=>row.time===hour.time)?.rainLikelihood||hour.rainLikelihood;
  for(const [index,day] of forecast.days.entries())for(const [key,phase] of [['rainLikelihood','overall'],['popDayLikelihood','daytime'],['popNightLikelihood','overnight']]) {
    const old=day[key];
    day[key]=summarizeRainTimeline(forecast.rainTimeline,Date.parse(old.window.start),Date.parse(old.window.end));
    const view=modelExplanationView(forecast,{index,phase,now});
    assert.equal(view.mismatch,false,`${city} ${day.date} ${phase}`);
    assert.equal(view.value,day[key].value);
    if(view.complete)assert.equal(view.maximum,view.value);
  }
  assert.deepEqual(forecast.rainTimeline.map(r=>r.precipitation),original.rainTimeline.map(r=>r.precipitation));
  assert.deepEqual(forecast.days.map(d=>d.qpf),original.days.map(d=>d.qpf));
  const unsupported=forecast.rainTimeline.filter(r=>r.rainLikelihood.sources.some(s=>s.id==='ecmwf'&&s.weight===.6)&&r.rainLikelihood.sourceAmounts.ecmwf>.010&&!(r.officialPop>=20)&&!(r.rainLikelihood.sourceAmounts.nbm>.010));
  assert.ok(unsupported.every(r=>r.rainLikelihood.sourcePoints.ecmwf===20),`${city}: unsupported ECMWF signal is capped`);
  const supported=forecast.rainTimeline.filter(r=>r.rainLikelihood.sourcePoints.ecmwf===60&&r.rainLikelihood.sourcePoints.nbm===25);
  const previousSupported=original.rainTimeline.filter(r=>r.rainLikelihood.sourcePoints.ecmwf===60&&r.rainLikelihood.sourcePoints.nbm===25);
  assert.equal(supported.length,previousSupported.length,`${city}: corroborated rainy period remains intact`);
  const friday=forecast.days.find(day=>day.date==='2026-10-02');
  const previousFriday=original.days.find(day=>day.date==='2026-10-02');
  report.cities.push({city,location:forecast.location,sourceAssembledAt:original.assembledAt,hours:forecast.rainTimeline.length,changedHours:changes.length,friday:{old:previousFriday?.rainLikelihood.value,new:friday?.rainLikelihood.value},supportedHours:supported.length,amountsUnchanged:true,changes});
  if(directory)await writeFile(`${directory}/${city}-fixed.json`,JSON.stringify(forecast));
}
await writeFile(new URL('../docs/weather-rain-support-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cities:report.cities.map(({changes,...city})=>city)},null,2));
