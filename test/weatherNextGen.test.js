import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import {nextGenDocument,experimentalWithNextGen,registerWeatherNextGenRoutes} from '../src/weatherNextGenRoutes.js';
import {buildNextGenModel,comparisonRows,availableModels,portraitForSample,exposureReading,selectedSample,hourlyRows,weeklyRows,sourceRange} from '../public/experimental/next-gen/model.js';
import {currentSample} from '../public/weather-fusion/weather-display.js?v=low-rain-display-v1';
import {dailyForecastReadings} from '../public/weather-fusion/seven-day.js?v=low-rain-display-v1';
import {fixture} from '../scripts/weatherNourieFixture.js';
import {monotonePath,splitSegments,niceDomain,graphSpec} from '../public/experimental/next-gen/charts.js';

const original=await readFile(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
const shell=await readFile(new URL('../public/experimental/next-gen/shell.html',import.meta.url),'utf8');
const ids=html=>new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));

test('the separate document preserves every existing element required by the weather controller',()=>{
  const page=nextGenDocument(original,shell),existing=ids(original),next=ids(page);
  for(const id of existing)assert.ok(next.has(id),`Missing original element: ${id}`);
  assert.match(page,/<title>Weather Nourie — Next Gen<\/title>/);
  assert.match(page,/data-controller="\/weather-fusion\/app\.js\?/);
  assert.equal([...page.matchAll(/\bid="([^"]+)"/g)].length,next.size,'No duplicate DOM IDs');
  for(const layer of ['radar','hrrr','ecmwf','nbm','temperature','wind','clouds'])assert.match(page,new RegExp('data-layer="'+layer+'"'));
});

test('only the feature-branch Experimental page gains the new link and all original links remain',()=>{
  const page=experimentalWithNextGen(original);
  assert.match(page,/id="next-gen-link" href="\/experimental\/next-gen\/"/);
  for(const href of [...original.matchAll(/href="([^"]+)"/g)].map(m=>m[1]))assert.ok(page.includes(`href="${href}"`));
  assert.equal(experimentalWithNextGen(page),page,'Navigation injection is idempotent');
  assert.equal(original.includes('id="next-gen-link"'),false,'The source production HTML is unchanged');
});

test('Next Gen never loads the original PWA registration or an independent background forecast poller',()=>{
  const page=nextGenDocument(original,shell);
  assert.doesNotMatch(page,/<script[^>]*src="[^\"]*(pwa-bridge|experimental-sky|header-sky|experimental-enhance)\.js/);
  assert.doesNotMatch(page,/<link[^>]*rel="manifest"[^>]*href="\/weather-fusion/);
  assert.match(page,/rel="manifest" href="\/experimental\/next-gen\/manifest.webmanifest"/);
});

for(const location of ['knightdale','greenville'])test(`${location}: current, hourly and daily figures match the existing presentation helpers without mutating the forecast`,()=>{
  const now=Date.parse('2026-09-05T22:00:00Z'),forecast=fixture(location,now),before=JSON.stringify(forecast),model=buildNextGenModel(forecast,now);
  const expected=currentSample(forecast,now);
  assert.equal(model.current.temperature,expected.temperature);
  assert.equal(model.current.feels,expected.feels);
  assert.deepEqual(model.days,dailyForecastReadings(forecast,now,7));
  assert.equal(model.days.length,7);
  for(const hour of hourlyRows(model,48)){
    const sample=selectedSample(model,hour.id);
    assert.equal(hour.temperature,sample.temperature);
    assert.equal(hour.feels,sample.feels);
    assert.equal(hour.rain,sample.pop);
  }
  assert.deepEqual(weeklyRows(model).map(({time,...day})=>day),model.days);
  assert.equal(JSON.stringify(forecast),before);
});

test('comparison traces retain the exact canonical blend and comparison-only model values',()=>{
  const now=Date.parse('2026-11-21T12:00Z');
  const forecast={metricForecasts:{series:{temperature:[{time:new Date(now).toISOString(),value:51.25,comparisonSources:[{id:'nws',value:52},{id:'gefs',value:0},{id:'weathernext3',value:null}]},{time:new Date(now+3600000).toISOString(),value:52,comparisonSources:[{id:'nws',value:null},{id:'gefs',value:1.25}]}]}}};
  const rows=comparisonRows(forecast,'temperature',now);
  assert.equal(rows[0].nourie,51.25);assert.equal(rows[0].gefs,0);
  assert.equal(rows[1].nws,null);assert.equal(rows[1].gefs,1.25);
  assert.deepEqual(availableModels(rows),['nourie','nws','gefs']);
  assert.deepEqual(comparisonRows(forecast,'wind',now),[],'Unsupported variables are not borrowed');
});

test('the chart specification gives probability and hourly rainfall different labeled axes',()=>{
  const rain=graphSpec('hourly','rain');
  assert.equal(rain.unit,'%');assert.equal(rain.secondary,'in');assert.equal(rain.series[1].secondary,true);
  assert.equal(rain.series[1].bars,true);
  assert.deepEqual(graphSpec('hourly','wind').series.map(s=>s.key),['wind','gust']);
  assert.deepEqual(graphSpec('hourly','dewpoint').series.map(s=>s.key),['temperature','dewpoint']);
});

test('source spread is the available independent min/max, never the blend or an invented confidence interval',()=>{
  const row={nourie:110,nws:52,nbm:48,hrrr:null,gefs:50};
  assert.deepEqual(sourceRange(row,['nourie','nws','nbm','hrrr','gefs']),{min:48,max:52,sources:3});
  assert.equal(sourceRange(row,['nourie','nws']),null);
  assert.deepEqual(row,{nourie:110,nws:52,nbm:48,hrrr:null,gefs:50});
});

test('chart gaps remain gaps and a missing entire time interval is not bridged',()=>{
  const points=[{x:0,y:0},{x:1,y:3},null,{x:3,y:1},{x:9,y:2}];
  assert.deepEqual(splitSegments(points,2).map(g=>g.length),[2,1,1]);
  assert.equal(niceDomain([null,0,2],{zero:true})[0],0);
  assert.deepEqual(niceDomain([null,50],{percent:true}),[0,100]);
});

test('the monotone curve passes through every original knot without overshooting sharp peaks or plateaus',()=>{
  const points=[{x:0,y:3},{x:1,y:12},{x:2,y:2},{x:3,y:2},{x:4,y:8}];
  const path=monotonePath(points);
  const curves=[...path.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)].map(m=>m.slice(1).map(Number));
  assert.equal(curves.length,points.length-1);
  for(let i=0;i<curves.length;i++){
    const [x1,y1,x2,y2,x3,y3]=curves[i],a=points[i],b=points[i+1];
    assert.equal(x3,b.x);assert.equal(y3,b.y);assert.ok(x1>=a.x&&x2<=b.x);
    for(let n=0;n<=100;n++){const t=n/100,u=1-t,y=u**3*a.y+3*u*u*t*y1+3*u*t*t*y2+t**3*y3;assert.ok(y>=Math.min(a.y,b.y)-.002&&y<=Math.max(a.y,b.y)+.002);}
  }
});

test('the portrait uses the shared temperature bands, preserves real night, and hides sunlight under overcast',()=>{
  const now=Date.parse('2026-09-05T22:00Z'),model=buildNextGenModel(fixture('knightdale',now),now);
  const base={...model.current,id:'now',now:true,time:new Date(now).toISOString(),temperature:55,feels:50,condition:'Clear',inputs:{...model.current.inputs,skyCover:100},isDay:true};
  const overcast=portraitForSample({...model,timeline:[]},base);
  assert.match(overcast.file,/cloudy-day-feels-32-59f/);
  const night=portraitForSample({...model,timeline:[]},{...base,inputs:{...base.inputs,skyCover:0},isDay:false,time:'2026-09-06T04:00Z',now:false});
  assert.match(night.file,/-night-/);
  const snow=portraitForSample({...model,timeline:[]},{...base,condition:'Snow',feels:24,inputs:{...base.inputs,wind:20}});
  assert.match(snow.file,/snow-day-feels-below-32f/);
  assert.match(snow.clothing,/coat|mittens/i);
});

test('sun and night exposure modes do not invent values for the wrong light or missing thermal inputs',()=>{
  const now=Date.parse('2026-09-05T22:00Z'),model=buildNextGenModel(fixture('knightdale',now),now);
  const night={...model.current,isDay:false,comfort:{...model.current.comfort,sun:null}};
  assert.equal(exposureReading(model,night,'sun').value,null);
  assert.match(exposureReading(model,night,'sun').note,/night/i);
  const missing={...model.current,isDay:true,feels:null,condition:'Clear',inputs:{skyCover:10},comfort:{sun:null,weatherKind:'clear'}};
  assert.equal(exposureReading(model,missing,'sun').value,null);
  assert.match(exposureReading(model,missing,'sun').note,/missing|unavailable/i);
  assert.doesNotMatch(exposureReading(model,missing,'sun').note,/No sun forecast/);
});

test('portrait and overlay PWA assets are entirely separate from the original app installation',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../public/experimental/next-gen/manifest.webmanifest',import.meta.url),'utf8'));
  const worker=await readFile(new URL('../public/experimental/next-gen/sw.js',import.meta.url),'utf8');
  assert.equal(manifest.id,'/experimental/next-gen/');assert.equal(manifest.scope,manifest.id);
  assert.ok(manifest.start_url.startsWith(manifest.scope));
  assert.match(worker,/url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker,/weather-nourie-next-gen-static/);
  assert.doesNotMatch(worker,/caches\.delete\(['"]weather-fusion/);
});

test('the isolated routes serve the new app, its assets, and the existing Experimental page without changing production',async t=>{
  const app=express();registerWeatherNextGenRoutes(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  for(const route of ['/experimental/next-gen','/experimental/next-gen/','/experimental/next-gen/app.js','/experimental/next-gen/charts.js','/experimental/next-gen/manifest.webmanifest','/experimental/next-gen/sw.js']){
    const response=await fetch(base+route);assert.equal(response.status,200,route);
    if(route.endsWith('sw.js'))assert.equal(response.headers.get('cache-control'),'no-cache');
    if(route.endsWith('.webmanifest'))assert.match(response.headers.get('content-type'),/application\/manifest\+json/);
  }
  assert.equal((await fetch(base+'/weather-fusion/')).status,404,'The new router does not claim the production route');
  const experimental=await (await fetch(base+'/weather-fusion/experimental-weather.html')).text();assert.match(experimental,/Weather Nourie Next Gen/);
});
