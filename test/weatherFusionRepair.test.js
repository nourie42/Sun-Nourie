import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecast} from '../src/weatherFusion.js';
import {temperaturePolicy,eveningPeriod,forecastDayIndex,REPAIR_VERSION} from '../src/weatherFusionPolicy.js';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
import {testInputs,snapshot} from './weatherFusion.fixtures.js';
import {alignComfortHours} from '../src/weatherFusionNowcast.js';
import {shadeFeelsLike} from '../public/weather-fusion/weather-math.js';
import {comfortMode,comfortWindow,comfortNarrative} from '../public/weather-fusion/comfort-outlook.js';
import {heroWeather} from '../public/weather-fusion/hero-mode.js';
import {dewpointPoints,graphGeometry} from '../public/weather-fusion/dewpoint-meter.js';
import {createFramePlayer} from '../public/weather-fusion/frame-player.js';
const H=3600000,now=testInputs.now,zone='America/New_York';
const models=()=>Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>[id,validateSnapshot(snapshot(id),id,testInputs.location,now).value]));
test('today uses requested 40/40/20 in daily high and every same-calendar-day hour',()=>{
 const out=buildForecast({...testInputs,models:models()});
 assert.equal(out.repairVersion,REPAIR_VERSION);
 assert.deepEqual(temperaturePolicy(0),{nws:.4,hrrr:.4,ecmwf:.2});
 assert.equal(out.days[0].high,86); // .4*84 + .4*90 + .2*80 = 85.6
 for(const h of out.hours){if(forecastDayIndex(Date.parse(h.time),now,zone)!==0)continue;
  assert.deepEqual(h.temperatureBlend.sources.map(s=>[s.id,s.weight]),[['nws',.4],['hrrr',.4],['ecmwf',.2]]);
  assert.equal(h.temperature,Math.round(.4*h.officialTemperature+.4*90+.2*80));
 }
 assert.equal(out.hours[0].pop,testInputs.hourly.periods[0].probabilityOfPrecipitation.value);
});
test('partial HRRR rain horizon contributes in covered hours, not discarded from whole-day totals',()=>{
 const m=models(),start=now/1000;
 m.hrrr.precipitationIntervals=Array.from({length:4},(_,i)=>({start:start+i*3600,end:start+(i+1)*3600,value:.3}));
 m.ecmwf.precipitationIntervals=Array.from({length:24},(_,i)=>({start:start+i*3600,end:start+(i+1)*3600,value:.2}));
 const grid={quantitativePrecipitation:{uom:'wmoUnit:in',values:[{validTime:new Date(now).toISOString()+'/PT24H',value:2.4}]}};
 const out=buildForecast({...testInputs,models:m,grid});
 assert.ok(Math.abs(out.precipitation.value-(4*.2+20*(.1*2/3+.2/3)))<.001);
 assert.equal(out.precipitation.sources.find(s=>s.id==='hrrr').coverageHours,4);
 assert.ok(out.precipitation.sources.some(s=>s.id==='nws'));
});
test('new model initialization invalidates forecast signature even if values are unchanged',()=>{
 const m=models(),a=buildForecast({...testInputs,models:m});m.hrrr.runAt='2026-09-05T13:00:00Z';
 const b=buildForecast({...testInputs,models:m});assert.notEqual(a.signature,b.signature);
});
test('same instant with UTC and local offset becomes one dew-point hour, not a sawtooth',()=>{
 const input=structuredClone(testInputs);input.models=models();
 input.hourly.periods[0].startTime='2026-09-05T12:00:00-04:00';
 const out=buildForecast(input),rows=out.metricForecasts.series.dewpoint;
 assert.equal(rows.length,new Set(rows.map(p=>Date.parse(p.time))).size);
 for(let i=1;i<rows.length;i++)assert.equal(Date.parse(rows[i].time)-Date.parse(rows[i-1].time),H);
 const p=dewpointPoints({metricForecasts:{series:{dewpoint:[{time:'2026-09-05T12:00:00-04:00',value:70},{time:'2026-09-05T16:00:00Z',value:67}]}}},now,24);
 assert.equal(p.length,1);assert.equal(p[0].value,70);
});
test('full-range compact graph fits available width and retains real time spacing',()=>{
 const points=[0,1,10].map(n=>({epoch:now+n*H,value:65+n/2}));
 const g=graphGeometry(points,240,310);assert.equal(g.W,310);assert.equal(g.height,210);
 assert.ok(Math.abs((g.x(points[2].epoch)-g.x(now))/(g.x(points[1].epoch)-g.x(now))-10)<.001);
 assert.ok(g.min>=55,'vertical scale should fit the actual dewpoint range');
});
test('5:40 AM is today, never tonight or the previous overnight minimum',()=>{
 const t=Date.parse('2026-09-06T09:40:00Z'),f={location:{timeZone:zone},current:{temperature:73},days:[{high:84,low:65}],metricForecasts:{series:{feels:[{time:'2026-09-06T11:00Z',value:74},{time:'2026-09-06T18:00Z',value:91},{time:'2026-09-07T09:00Z',value:66}]}}};
 assert.equal(comfortMode(t,zone),'day');assert.equal(comfortMode(Date.parse('2026-09-06T08:59Z'),zone),'predawn');
 const summary=comfortWindow(f,t);assert.equal(summary.label,'Forecast feels-like peak ahead');assert.equal(summary.chosen.value,91);
 assert.equal(heroWeather(f,t).tonight,false);
 assert.doesNotMatch(comfortNarrative({temperature:73,dewpoint:73,wind:0},{shade:82},summary,zone),/tonight|overnight|bottoms out/i);
 assert.equal(comfortMode(Date.parse('2026-09-06T19:00Z'),zone),'overnight');
});
test('night low is the coming evening, not the predawn period with the same calendar date',()=>{
 const early={startTime:'2026-09-06T04:00:00Z',endTime:'2026-09-06T10:00:00Z',isDaytime:false,temperature:69};
 const night={startTime:'2026-09-06T22:00:00Z',endTime:'2026-09-07T10:00:00Z',isDaytime:false,temperature:65};
 assert.equal(eveningPeriod([early,night],'2026-09-06',zone,Date.parse('2026-09-06T09:40Z')),night);
 const f={location:{timeZone:zone},current:{temperature:82},days:[{low:null}]};
 assert.equal(heroWeather(f,Date.parse('2026-09-06T19:00Z')).temperature,null,'Do not relabel current temperature as tonight low');
});
test('bounded thermal observation alignment fades from the actual observation, not each refresh',()=>{
 const time=Date.parse('2026-09-06T09:41Z'),obs=Date.parse('2026-09-06T09:15Z');
 const raw=Array.from({length:8},(_,i)=>({epoch:Date.parse('2026-09-06T09:00Z')+i*H,temperature:i===2?69:70,dewpoint:70,wind:3.5,humidity:100}));
 const current={type:'observation',station:'TEST',stationDistanceKm:25,time:new Date(obs).toISOString(),temperature:73,dewpoint:73,wind:0};
 const a=alignComfortHours(raw,current,time),b=alignComfortHours(raw,current,time+5*60000);
 assert.equal(a.alignment.status,'applied');assert.deepEqual(a.hours,b.hours);
 const at7=a.hours[2],uncorrected=shadeFeelsLike(69,100,3.5,70).value;
 assert.ok(at7.feels>uncorrected);assert.ok(at7.alignmentFactor>0&&at7.alignmentFactor<1);
 assert.equal(a.hours[5].alignmentFactor,0);
 assert.equal(at7.feels,shadeFeelsLike(at7.temperature,at7.humidity,at7.wind,at7.dewpoint).value);
 for(const row of a.hours)assert.ok(row.dewpoint<=row.temperature);
 assert.equal(alignComfortHours(raw,{...current,stationDistanceKm:90},time).alignment.status,'not-applied');
 assert.equal(alignComfortHours(raw,current,time+2*H).alignment.status,'not-applied');
});
function fakePlayer(){
 const layers=new Set(),made=[],map={removeLayer:l=>layers.delete(l)};
 const makeImage=(url,bounds,options)=>{const handlers={},element={dataset:{}};const l={url,opacity:options.opacity,on(k,f){handlers[k]=f;return l;},off(){for(const k of Object.keys(handlers))delete handlers[k];},addTo(){layers.add(l);return l;},setOpacity(v){l.opacity=v;},getElement(){return element;},fire(k){handlers[k]?.();},capture(k){return handlers[k];}};made.push(l);return l;};
 return {player:createFramePlayer({map,makeImage}),layers,made};
}
test('slow HRRR frame A -> pending B -> pending C cannot strand A below C',async()=>{
 const {player,layers,made}=fakePlayer();const frame=n=>({url:String(n),bounds:[],time:String(n)});
 const a=player.show(frame('A'));made[0].fire('load');await a;
 const b=player.show(frame('B'));const stale=made[1].capture('load');
 const c=player.show(frame('C'));assert.equal(await b,false);assert.equal(layers.size,2);
 made[2].fire('load');assert.equal(await c,true);stale();
 assert.equal(layers.size,1);assert.equal(player.visible.url,'C');assert.equal(player.visible.opacity,1);
 player.clear();assert.equal(layers.size,0);
});
test('switching products, errors and rapid scrubbing remove every owned image',async()=>{
 const {player,layers,made}=fakePlayer();let error=false;
 const a=player.show({url:'HRRR',bounds:[]});made[0].fire('load');await a;
 const b=player.show({url:'NEXT',bounds:[]});const late=made[1].capture('load');player.clear();assert.equal(await b,false);late();assert.equal(layers.size,0);
 const c=player.show({url:'NBM',bounds:[]},{},{error:()=>error=true});made[2].fire('error');assert.equal(await c,false);assert.equal(error,true);assert.equal(layers.size,0);
 assert.equal(player.loading,false);
});

test('daytime outlook before sunrise does not draw a sun on the comfort tile',async()=>{
 const {comfortWeatherKind}=await import('../public/weather-fusion/experience.js');
 const f={location:{timeZone:zone,latitude:35.787,longitude:-78.4806},current:{condition:'Clear',wind:0},days:[{condition:'Sunny',pop:0,nightCondition:'Chance Showers',popNight:60}]};
 assert.equal(comfortWeatherKind(f,Date.parse('2026-09-06T09:40:00Z')),'night');
 assert.equal(comfortWeatherKind(f,Date.parse('2026-09-06T16:00:00Z')),'sun');
});
