import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fixture} from '../scripts/weatherNourieFixture.js';
import {buildTimeline,skyScene,mixScene,cloudCover,consensus,rainBreakdown,comfortBin,comfortGrid,perfectWindows,sourceSpread,seriesIndex,dailyOutlook,sunDay,placeFromQuery,PRESETS,H} from '../public/weather-fusion/atmos-model.js';
import {sunPosition,moonIllumination,moonPhaseName} from '../public/weather-fusion/atmos-sky.js';
import {hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js';
import {forecastValue,displayedFeelsAt} from '../public/weather-fusion/hourly-feels.js';
import {dailyForecastReadings} from '../public/weather-fusion/seven-day.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';
import {isPublicWeatherPath,isProtectedWeatherPath} from '../src/weatherSiteAccess.js';

const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const serverSource=readFileSync(new URL('../src/weatherFusion.js',import.meta.url),'utf8');
const forecast=fixture('knightdale');
const now=Date.parse(forecast.assembledAt)+5*60000;

test('Atmos files are served by the explicit weather routes and stay behind the weather password',()=>{
  const list=serverSource.match(/for \(const name of \[([\s\S]*?)\]\) app\.get\(`\/weather-fusion\/\$\{name\}`/);
  assert.ok(list,'weather assets use an auditable explicit route list');
  const allowed=new Set([...list[1].matchAll(/'([^']+)'/g)].map(match=>match[1]));
  for(const name of ['atmos.html','atmos.css','atmos.js','atmos-model.js','atmos-sky.js','archivo-latin-wdth-normal.woff2']){
    assert.ok(allowed.has(name),`${name} is routed`);
    assert.ok(existsSync(new URL(`../public/weather-fusion/${name}`,import.meta.url)),`${name} exists`);
  }
  assert.match(serverSource,/\/weather-fusion\/atmos', '\/weather-fusion\/atmos\/'\], \(_req, res\) => res\.redirect\(302, '\/weather-fusion\/atmos\.html'\)/);
  assert.equal(isProtectedWeatherPath('/weather-fusion/atmos.html'),true);
  assert.equal(isPublicWeatherPath('/weather-fusion/atmos.html'),false,'like the other alternate views, the page needs the weather password');
  assert.equal(isPublicWeatherPath('/weather-fusion/atmos.js'),true);
});

test('every module Atmos imports exists, so the page cannot load a missing file',()=>{
  const pending=['atmos.js'],seen=new Set();
  while(pending.length){
    const name=pending.shift();if(seen.has(name))continue;seen.add(name);
    for(const match of read(name).matchAll(/(?:from\s*|import\s*)['"]\.\/([^?'"]+)/g)){
      assert.ok(existsSync(new URL(`../public/weather-fusion/${match[1]}`,import.meta.url)),`${name} imports missing ${match[1]}`);
      pending.push(match[1]);
    }
  }
  assert.ok(seen.has('atmos-model.js')&&seen.has('atmos-sky.js')&&seen.has('pavement.js'));
  const html=read('atmos.html');
  assert.match(html,/<script type="module" src="\/weather-fusion\/atmos\.js\?v=/);
  assert.match(html,/not an official National Weather Service product/);
  assert.match(html,/<noscript>[\s\S]*weather\.gov/);
  assert.match(read('index.html'),/id="atmos-link" href="\/weather-fusion\/atmos\.html"/);
});

test('the 48-hour clock shows exactly the main page hourly samples',()=>{
  const steps=buildTimeline(forecast,now),samples=hourlyDisplaySamples(forecast,now);
  assert.equal(steps.length,samples.length);
  assert.equal(steps[0].isNow,true);
  assert.equal(steps[0].temperature,forecast.current.temperature,'Now is the station reading, as on the main page');
  for(const step of steps.slice(1)){
    const iso=new Date(step.time).toISOString();
    assert.equal(step.temperature,forecastValue(forecast,'temperature',iso));
    assert.equal(step.feels,displayedFeelsAt(forecast,iso));
  }
  assert.ok(steps.every((s,i)=>i===0||s.time>steps[i-1].time),'times increase');
  assert.ok(steps.every(s=>s.rainShown===null||s.rainShown>=5),'rain chances below 5% are never printed');
});

test('the sky draws rain, snow, fog and thunder only from the displayed condition',()=>{
  const base={kind:'clear',condition:'Sunny',chance:false,rain:2,precip:0,dewpoint:50,wind:6,windDir:270};
  assert.equal(skyScene(base).rain,0);assert.equal(skyScene(base).storm,false);assert.ok(skyScene(base).cover<.1);
  const rain={...base,kind:'rain',condition:'Rain',rain:90,precip:.2};
  assert.ok(skyScene(rain).rain>.5);assert.equal(skyScene(rain).storm,false,'a plain rain forecast never shows lightning');
  const storm={...base,kind:'storm',condition:'Showers And Thunderstorms',rain:80,precip:.3};
  assert.equal(skyScene(storm).storm,true);
  const chance={...base,kind:'rain',condition:'Chance Showers',chance:true,rain:30,precip:.02};
  assert.ok(skyScene(chance).rain<skyScene({...chance,chance:false,rain:80}).rain,'chance wording draws lighter, scattered rain');
  assert.ok(skyScene({...base,kind:'snow',condition:'Snow',precip:.1}).snow>0);
  assert.ok(skyScene({...base,kind:'fog',condition:'Dense Fog'}).fog>skyScene({...base,kind:'fog',condition:'Patchy Fog'}).fog);
  assert.ok(skyScene({...base,dewpoint:72}).haze>skyScene({...base,dewpoint:55}).haze,'muggy air adds haze');
  const mixed=mixScene(skyScene(base),skyScene(rain),.5);
  assert.ok(mixed.cover>skyScene(base).cover&&mixed.cover<skyScene(rain).cover);
});

test('cloud cover uses numeric sky cover first, then the NWS sky-condition terms',()=>{
  assert.equal(cloudCover({skyCover:37,condition:'Sunny'}),.37);
  assert.equal(cloudCover({condition:'Sunny'}),.03);
  assert.equal(cloudCover({condition:'Mostly Sunny'}),.2);
  assert.equal(cloudCover({condition:'Partly Cloudy'}),.5);
  assert.equal(cloudCover({condition:'Mostly Cloudy'}),.8);
  assert.equal(cloudCover({condition:'Overcast'}),1);
});

test('the blend panel shows the canonical temperature and every source around it',()=>{
  const steps=buildTimeline(forecast,now),rows=consensus(steps),index=seriesIndex(forecast);
  for(const row of rows.filter(r=>r.sources.length)){
    assert.equal(row.blend,index.temperature.get(row.hourStart).value);
    assert.ok(row.min<=row.max);
    assert.deepEqual(row.sources.map(s=>s.id),[...row.sources.map(s=>s.id)].sort((a,b)=>['nws','hrrr','ecmwf','nbm','wn'].indexOf(a)-['nws','hrrr','ecmwf','nbm','wn'].indexOf(b)));
  }
  assert.ok(rows.some(r=>r.sources.length>=3));
});

test('the rain breakdown adds up to the published score and explains each source',()=>{
  const hour=forecast.hours.find(h=>h.rainLikelihood?.sources?.length);
  const breakdown=rainBreakdown(hour.rainLikelihood);
  const sum=breakdown.rows.reduce((total,row)=>total+row.points,0);
  assert.ok(Math.abs(sum-hour.rainLikelihood.rawTotal)<1e-6);
  assert.equal(breakdown.total,hour.rainLikelihood.value);
  const notes=rainBreakdown({value:43,rawTotal:43.3,officialProbability:40,sourceAmounts:{hrrr:.004,ecmwf:.2,nbm:.0004},sources:[
    {id:'nbm',value:0,weight:.2,points:0,reductionReason:'below-minimum'},{id:'nws',value:40,weight:.4,points:16},
    {id:'hrrr',value:100/3,weight:.3,points:10,reductionReason:'trace'},{id:'ecmwf',value:100/3,weight:.1,points:3.3,reductionReason:'uncorroborated'}]});
  assert.deepEqual(notes.rows.map(r=>r.id),['nws','hrrr','ecmwf','nbm']);
  assert.match(notes.rows[0].note,/Official 40% chance, counted at 40%/);
  assert.match(notes.rows[1].note,/trace.*third of its 30 points/);
  assert.match(notes.rows[2].note,/no backup.*third of its 10 points/);
  assert.match(notes.rows[3].note,/Less than 0.001 in/);
});

test('comfort classes centre on the 72° ideal and follow the UTCI heat-stress limits',()=>{
  assert.equal(comfortBin(72).key,'n');
  assert.equal(comfortBin(78.7).key,'n');assert.equal(comfortBin(78.8).key,'w1');
  assert.equal(comfortBin(89.6).key,'w2');assert.equal(comfortBin(100.4).key,'w3');
  assert.equal(comfortBin(65.2).key,'n');assert.equal(comfortBin(65.1).key,'c1');
  assert.equal(comfortBin(48.2).key,'c1');assert.equal(comfortBin(32).key,'c2');assert.equal(comfortBin(31.9).key,'c3');
  assert.equal(comfortBin(null),null);
});

test('perfect hours use the shared rules and merge into windows',()=>{
  const data=structuredClone(forecast),series=data.metricForecasts.series;
  const start=Date.parse(series.feels[3].time);
  const set=(key,time,value)=>{const row=series[key].find(p=>Date.parse(p.time)===time);if(row)row.value=value;};
  for(let i=0;i<4;i++){
    const time=start+i*H;
    set('temperature',time,72);set('dewpoint',time,55);set('wind',time,4);set('feels',time,72);
    const rain=data.rainTimeline.find(r=>Date.parse(r.time)===time);if(rain){rain.condition='Sunny';rain.rainLikelihood={...rain.rainLikelihood,value:5};}
  }
  set('temperature',start+4*H,90);
  const grid=comfortGrid(data,now),windows=perfectWindows(grid);
  const window=windows.find(w=>w.start===start);
  assert.ok(window,'a calm, dry 72° stretch is a perfect window');
  assert.ok(window.hours>=4&&window.rules.includes('A'));
  assert.equal(grid.length,Math.min(7,data.days.length));
  assert.ok(grid.every(row=>row.cells.length===24));
});

test('a source counts toward a daily spread only when it covers every hour',()=>{
  const t0=Date.parse('2026-09-06T04:00:00Z'),index=new Map();
  for(let i=0;i<24;i++)index.set(t0+i*H,{value:70,sources:[{id:'nws',value:60+i},{id:'ecmwf',value:65},...(i<20?[{id:'hrrr',value:99}]:[])]});
  const spread=sourceSpread(index,{start:t0,end:t0+24*H});
  assert.deepEqual(spread.highs.map(s=>s.id),['nws','ecmwf']);
  assert.deepEqual(spread.high,[65,83]);assert.deepEqual(spread.low,[60,65]);
  assert.equal(sourceSpread(index,{start:t0,end:t0}),null);
});

test('the ten-day list keeps the main page daily readings',()=>{
  const ours=dailyOutlook(forecast,now),main=dailyForecastReadings(forecast,now,10);
  assert.equal(ours.length,main.length);
  ours.forEach((day,i)=>{
    assert.equal(day.label,main[i].label);assert.equal(day.high,main[i].high);assert.equal(day.low,main[i].low);
    assert.equal(day.condition,main[i].condition);assert.equal(day.confidence,main[i].confidence);
  });
});

test('sun and moon positions follow the shared solar formula',()=>{
  const {latitude,longitude}=PRESETS[0];
  for(const time of [Date.parse('2026-09-05T16:00:00Z'),Date.parse('2026-12-21T17:12:00Z'),Date.parse('2026-06-21T03:00:00Z')]){
    assert.ok(Math.abs(sunPosition(time,latitude,longitude).altitude-solarElevation(time,latitude,longitude)*180/Math.PI)<1e-6);
  }
  const noon=sunPosition(Date.parse('2026-12-21T17:12:00Z'),latitude,longitude);
  assert.ok(Math.abs(noon.azimuth-180)<4,'the sun is due south near solar noon');
  assert.ok(Math.abs(noon.altitude-(90-latitude-23.44))<1);
  assert.ok(moonIllumination(Date.parse('2024-04-08T18:20:00Z')).fraction<.02,'new moon during the April 2024 eclipse');
  assert.ok(moonIllumination(Date.parse('2024-04-23T23:49:00Z')).fraction>.98,'full moon of April 23, 2024');
  assert.equal(moonPhaseName(.5),'Full moon');assert.equal(moonPhaseName(.86),'Waning crescent moon');
  const day=sunDay(forecast.location,Date.parse('2026-09-05T04:00:00Z'),Date.parse('2026-09-06T04:00:00Z'),forecast.solar);
  assert.equal(day.sunrise,Date.parse(forecast.solar.sunrise),'the published sunrise wins');
  assert.equal(day.sunset,Date.parse(forecast.solar.sunset));
  assert.ok(day.sunrise<day.noon&&day.noon<day.goldenEveningStart&&day.goldenEveningStart<day.sunset);
});

test('places come from presets or validated U.S. coordinates only',()=>{
  assert.equal(placeFromQuery('?location=greenville').name,'Greenville, NC');
  assert.deepEqual(placeFromQuery('?lat=35.9&lon=-78.6&name=Wake').latitude,35.9);
  assert.equal(placeFromQuery('?lat=51.5&lon=-0.1'),null);
  assert.equal(placeFromQuery('?lat=abc&lon=-78'),null);
  assert.equal(placeFromQuery(''),null);
});
