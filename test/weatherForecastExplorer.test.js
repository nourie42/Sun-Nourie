import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../scripts/weatherNourieFixture.js';
import {buildForecastExplorer,explorerScale,explorerValue,explorerLinePath} from '../public/weather-fusion/forecast-explorer.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js';
const forecast=fixture('knightdale');
const now=Date.parse(forecast.assembledAt)+5*60000,H=3600000;

test('explorer temperature, feels and wind match the exact hourly samples',()=>{
 const before=JSON.stringify(forecast),data=buildForecastExplorer(forecast,now);
 const samples=hourlyDisplaySamples(forecast,now).filter(sample=>sample.now||Date.parse(sample.time)<=now+48*H);
 assert.equal(data.rows.length,samples.length);
 data.rows.forEach((row,i)=>{
  assert.equal(row.id,samples[i].id);
  assert.equal(row.values.temperature,samples[i].temperature);
  assert.equal(row.values.feels,samples[i].feels);
  assert.equal(row.values.wind,samples[i].inputs.wind);
 });
 assert.equal(data.rows[0].isNow,true);
 assert.equal(data.rows[0].values.precipitation,null,'an hourly forecast accumulation is not a current observation');
 assert.equal(data.sources[0].sources.length,0,'current station temperature is not impersonated as a model blend');
 assert.equal(JSON.stringify(forecast),before,'presentation never rewrites the forecast');
});

test('explorer matches liquid amounts by instant and preserves zero versus missing',()=>{
 const f=structuredClone(forecast),future=f.hours.filter(row=>Date.parse(row.time)>now);
 f.metricForecasts.series.precipitation=[{time:future[2].time,value:.21},{time:future[0].time,value:0},{time:future[1].time,value:null}];
 const data=buildForecastExplorer(f,now),at=time=>data.rows.find(row=>row.time===Date.parse(time));
 assert.equal(at(future[0].time).values.precipitation,0);
 assert.equal(at(future[1].time).values.precipitation,null);
 assert.equal(at(future[2].time).values.precipitation,.21);
 assert.equal(explorerValue('precipitation',.001),'under 0.01 in');
 assert.equal(explorerValue('precipitation',null),'Unavailable');
});

test('small rain chances remain in evidence while display values stay hidden',()=>{
 const f=structuredClone(forecast),future=f.hours.filter(row=>Date.parse(row.time)>now);
 [0,4.99,5,100,null].forEach((value,i)=>{future[i].rainLikelihood={...future[i].rainLikelihood,value};future[i].pop=99;});
 const rows=buildForecastExplorer(f,now).rows.slice(1,6);
 assert.deepEqual(rows.map(row=>row.rain),[0,4.99,5,100,null]);
 assert.deepEqual(rows.map(row=>row.values.rain),[null,null,5,100,null]);
 assert.equal(explorerValue('rain',0),'');assert.equal(explorerValue('rain',4.99),'');
 assert.equal(explorerValue('rain',5),'5%');assert.equal(explorerValue('rain',null),'Unavailable');
});

test('cloud cover is published numeric coverage and never guessed from a sunny description',()=>{
 const f=structuredClone(forecast),future=f.hours.filter(row=>Date.parse(row.time)>now);
 const covers=[0,100,null,-2,104];
 covers.forEach((cover,i)=>{
  future[i].skyCover=cover;
  const point=f.metricForecasts.series.feels.find(row=>Date.parse(row.time)===Date.parse(future[i].time));
  point.inputs.skyCover=cover;
  const estimate=thermalComfort({...point.inputs,condition:future[i].condition,type:'guidance'},f.location,Date.parse(future[i].time));
  point.value=typeof estimate.rawOutdoors==='number'?Number(estimate.rawOutdoors.toFixed(1)):null;
 });
 const rows=buildForecastExplorer(f,now).rows.slice(1,6);
 assert.deepEqual(rows.map(row=>row.values.clouds),[0,100,null,null,null]);
});

test('graph scales keep percentages comparable and keep numeric values inside the domain',()=>{
 assert.deepEqual(explorerScale('rain',[12,85]),{min:0,max:100,ticks:[0,25,50,75,100]});
 assert.deepEqual(explorerScale('clouds',[30]),explorerScale('rain',[]));
 for(const [metric,values] of [['temperature',[-14,13,20]],['temperature',[78,78]],['feels',[32,33]],['wind',[0,35]],['precipitation',[0,.001,.24]]]){
  const scale=explorerScale(metric,values);
  assert.ok(scale.max>scale.min);
  assert.ok(values.every(value=>value>=scale.min&&value<=scale.max));
  if(metric==='wind'||metric==='precipitation')assert.equal(scale.min,0);
 }
});

test('missing graph points break the line rather than joining through a data gap',()=>{
 assert.equal(explorerLinePath([[0,12],[10,5],null,[30,15],[40,20]]),'M0.0 12.0L10.0 5.0M30.0 15.0L40.0 20.0');
});
