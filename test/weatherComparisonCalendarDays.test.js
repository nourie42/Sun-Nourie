import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';
import {modelExplanationView,modelExplanationHTML} from '../public/weather-fusion/model-explanation.js';

const H=3600000,now=Date.parse('2026-10-16T23:00:00Z'),midnight=Date.parse('2026-10-17T04:00:00Z');
const iso=epoch=>new Date(epoch).toISOString();
const end=midnight+24*H,close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} should equal ${b}`);
function fixture(){
 const rows=Array.from({length:(end-now)/H},(_,index)=>{
  const epoch=now+index*H,today=epoch<midnight;
  const temperature=today?75-index:95-(index-5),value=today?12:95;
  return {time:iso(epoch),end:iso(epoch+H),temperature,condition:'Chance Rain Showers',skyCover:80,
   precipitation:today?.01:.2,precipitationBlend:{sourceValues:{nws:today?.01:.2,wn:today?.02:.3}},
   rainLikelihood:{value,sourceValues:{nws:value,hrrr:today?0:100,wn:today?0:100}}};
 });
 const period=(start,stop,value)=>({value,aggregation:'maximum-hourly',window:{start:iso(start),end:iso(stop)},coverage:{complete:true},peakTime:iso(start),peak:rows.find(row=>Date.parse(row.time)===start).rainLikelihood});
 const days=[{date:'2026-10-16',start:now,end:midnight,value:12},{date:'2026-10-17',start:midnight,end,value:95}].map(day=>({
  date:day.date,high:999,low:-999,condition:'Chance Rain Showers',rainLikelihood:period(day.start,day.end,day.value),
  popNightLikelihood:period(now,midnight+6*H,99),qpfBlend:{sources:[{id:'nws',value:100}]},
  highWindow:{start:iso(now),end:iso(midnight)},lowWindow:{start:iso(now),end:iso(midnight+6*H)}
 }));
 const temperature=rows.map(row=>({time:row.time,value:row.temperature,sources:[{id:'nws',value:row.temperature+1},{id:'wn',value:row.temperature+2}]}));
 return {location:{timeZone:'America/New_York'},days,hours:rows,rainTimeline:rows,metricForecasts:{series:{temperature}}};
}

test('evening comparison temperatures use date highs and same-date model maxima',()=>{
 const forecast=fixture(),built=buildSeries(forecast,null,'temp',now);
 assert.deepEqual(built.forecastValues,[75,95]);
 assert.deepEqual(built.modelMaps,[{nws:76,wn:77},{nws:96,wn:97}]);
 assert.equal(built.days[0].tonight,false);
 assert.equal(built.windows[0].end,midnight);
 assert.equal(built.windows[1].start,midnight);
});

test('evening comparison rain and per-model chances cannot borrow tomorrow morning',()=>{
 const forecast=fixture(),rain=buildSeries(forecast,null,'rain',now),pop=buildSeries(forecast,null,'pop',now);
 close(rain.forecastValues[0],.05);close(rain.forecastValues[1],4.8);
 close(rain.modelMaps[0].nws,.05);close(rain.modelMaps[0].wn,.10);
 close(rain.modelMaps[1].nws,4.8);close(rain.modelMaps[1].wn,7.2);
 assert.deepEqual(pop.forecastValues,[12,95]);
 assert.deepEqual(pop.modelMaps[0],{nws:12,hrrr:0,wn:0});
 assert.deepEqual(pop.modelMaps[1],{nws:95,hrrr:100,wn:100});
});

test('WeatherNext comparison uses maxima through midnight instead of a following-night minimum',()=>{
 const forecast=fixture(),hourly=forecast.hours.map(row=>({time:row.time,values:{temperature_2m:{mean:(row.temperature-32)*5/9+273.15}}}));
 const built=buildSeries(forecast,{hourly},'temp',now);
 close(built.wnVals[0],75);close(built.wnVals[1],95);
});

test('model explanation defaults to the calendar day after 6 PM',()=>{
 const forecast=fixture(),view=modelExplanationView(forecast,{now});
 assert.equal(view.phase,'overall');assert.equal(view.value,12);
 assert.equal(view.end,midnight);
 assert.ok(view.rows.every(row=>Date.parse(row.time)<midnight));
 const html=modelExplanationHTML(forecast,{now});
 assert.match(html,/Calendar day · highest hourly/);
 assert.match(html,/NWS overnight \(includes next morning\)/);
 assert.equal(modelExplanationView(forecast,{now,phase:'overnight'}).phase,'overnight');
});

test('a cached elapsed 95% peak yields to the remaining 16% hours without losing fallback evidence',()=>{
 const forecast=fixture(),day=forecast.days[0],elapsed=now-H;
 forecast.rainTimeline.unshift({time:iso(elapsed),end:iso(now),precipitation:0,rainLikelihood:{value:95,mode:'nws-fallback',sourceValues:{nws:95}}});
 Object.assign(day.rainLikelihood,{value:95,window:{start:iso(elapsed),end:iso(midnight)},peakTime:iso(elapsed)});
 for(const row of forecast.rainTimeline.filter(row=>Date.parse(row.time)>=now&&Date.parse(row.time)<midnight))row.rainLikelihood={
  value:16,mode:'nws-fallback',sourceValues:{nws:16},partialBlend:{value:5,sourceValues:{nws:16,ecmwf:0}},sources:[{id:'nws',value:16,weight:1}]
 };
 const view=modelExplanationView(forecast,{now:now+H});
 assert.equal(view.value,16);assert.equal(view.maximum,16);assert.equal(view.mismatch,false);
 assert.ok(view.rows.every(row=>Date.parse(row.time)>=now+H&&Date.parse(row.time)<midnight));
 assert.equal(view.peak.mode,'nws-fallback');assert.equal(view.peak.partialBlend.value,5);
 assert.equal(view.period.value,16);assert.equal(view.period.window.end,iso(midnight));
});
