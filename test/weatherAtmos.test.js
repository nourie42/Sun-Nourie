import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fixture} from '../scripts/weatherNourieFixture.js';
import {buildTimeline,skyScene,mixScene,cloudCover,consensus,rainBreakdown,comfortBin,comfortGrid,perfectWindows,sourceSpread,seriesIndex,dailyOutlook,sunDay,placeFromQuery,PRESETS,H,
  TRUST_STOPS,LAB_PRESETS,normalTrust,isNourieTrust,matchingPreset,mixValue,rainScoreMix,recipeShares,sourceCoverage,customForecast,labDifferences,rainOutlook,relativeHour} from '../public/weather-fusion/atmos-model.js';
import {sunPosition,moonIllumination,moonPhaseName} from '../public/weather-fusion/atmos-sky.js';
import {hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js';
import {forecastValue,displayedFeelsAt} from '../public/weather-fusion/hourly-feels.js';
import {dailyForecastReadings} from '../public/weather-fusion/seven-day.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';
import {isPublicWeatherPath,isProtectedWeatherPath} from '../src/weatherSiteAccess.js';

const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const legacySource=readFileSync(new URL('../legacy-server.js',import.meta.url),'utf8');
const forecast=fixture('knightdale');
const now=Date.parse(forecast.assembledAt)+5*60000;

test('Atmos is served by the existing static server and the weather password protects it',()=>{
  for(const name of ['atmos.html','atmos.css','atmos.js','atmos-model.js','atmos-sky.js']){
    assert.ok(existsSync(new URL(`../public/weather-fusion/${name}`,import.meta.url)),`${name} exists`);
  }
  assert.match(legacySource,/express\.static\(path\.join\(__dirname, "public"\)/,'public/ is served as-is, so no route had to change');
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
  assert.match(html,/id="lab"[\s\S]*Make your own forecast/);
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

test('Atmos uses the main page’s own look: shared stylesheets, header band and the same sky photographs',()=>{
  const html=read('atmos.html'),sky=read('atmos-sky.js');
  for(const sheet of ['style.css','forecast-layout.css','weather-polish.css','page-unify.css','header-sky.css'])
    assert.match(html,new RegExp(`href="/weather-fusion/${sheet.replace('.','\\.')}`),`${sheet} is shared with the main page`);
  assert.match(html,/class="topbar sky-header"/);
  assert.match(html,/src="\/weather-fusion\/header-sky\.js\?v=/);
  for(const name of ['clear','clouds','rain','storm','night-v2']){
    assert.match(sky,new RegExp(`today-sky-${name}\\.webp`),`the sky draws the main page's today-sky-${name} photograph`);
    assert.ok(existsSync(new URL(`../public/weather-fusion/today-sky-${name}.webp`,import.meta.url)),`today-sky-${name}.webp exists`);
  }
  assert.doesNotMatch(sky,/cumulus|paintLandscape|deciduous|evergreen|LEAVES|season/i,'no painted cartoon sprites, lollipop trees or seasonal leaves');
  assert.doesNotMatch(read('atmos.css')+html,/Archivo|woff2/,'the page uses the same system type stack as the main page');
  assert.doesNotMatch(html,/class="card"/,'sections are the main page’s glass tiles');
});

/* ---------- Make your own forecast ---------- */
test('at Normal the forecast lab shows Weather Nourie’s own values, hour by hour and day by day',()=>{
  const result=customForecast(forecast,{},now);
  assert.equal(result.exact,true);
  assert.ok(result.temperature.length>100&&result.rain.length>100);
  assert.ok(result.temperature.every(row=>row.mine===row.base));
  assert.ok(result.rain.every(row=>row.mine===row.base&&row.amountMine===row.amountBase));
  const main=dailyForecastReadings(forecast,now,10);
  result.days.forEach((day,i)=>{
    assert.deepEqual(day.mine,day.base);
    assert.equal(day.base.high,main[i].high,`${day.date} high matches the main page`);
    assert.equal(day.base.low,main[i].low,`${day.date} low matches the main page`);
    if(!main[i].observed)assert.equal(day.base.rain,main[i].pop,`${day.date} rain chance matches the main page`);
    if(Number.isFinite(main[i].amount))assert.ok(Math.abs(day.base.amount-main[i].amount)<1e-6,`${day.date} rain total matches the main page`);
  });
});

test('the lab reproduces the server blend arithmetic before any slider moves',()=>{
  const index=seriesIndex(forecast);let temps=0,rains=0,amounts=0;
  for(const hour of forecast.hours){
    const time=Date.parse(hour.time);
    if(hour.temperatureBlend?.sources?.length){temps++;assert.ok(Math.abs(mixValue(hour.temperatureBlend.sources,{})-hour.temperatureBlend.value)<1e-3);}
    const row=index.temperature.get(time);
    if(row?.sources?.length)assert.ok(Math.abs(mixValue(row.sources,{})-row.value)<=.5,'the published hourly value is the rounded blend');
  }
  for(const row of forecast.rainTimeline){
    const likelihood=row.rainLikelihood;
    if(likelihood?.sources?.length&&likelihood.mode!=='nws-fallback'){rains++;assert.ok(Math.abs(rainScoreMix(likelihood,{})-likelihood.rawTotal)<1e-6,'the rain score is the same sum of points');}
    if(row.precipitationBlend?.sources?.length&&Number.isFinite(row.precipitation)){amounts++;assert.ok(Math.abs(mixValue(row.precipitationBlend.sources,{})-row.precipitation)<1e-6);}
  }
  assert.ok(temps>20&&rains>100&&amounts>100);
});

test('turning forecasts off or up re-weights only the values each source published',()=>{
  const nwsOnly=customForecast(forecast,LAB_PRESETS.find(p=>p.id==='nws').trust,now);
  const index=seriesIndex(forecast);
  for(const row of nwsOnly.temperature){
    const nws=index.temperature.get(row.time)?.sources?.find(s=>s.id==='nws');
    if(nws)assert.ok(Math.abs(row.mine-nws.value)<1e-9,'just the NWS means the NWS value');
    else assert.equal(row.mine,null,'an hour the NWS does not cover is left blank, not filled in');
  }
  const noHrrr=customForecast(forecast,{hrrr:0},now);
  const hour=forecast.hours.find(h=>h.temperatureBlend?.sources?.some(s=>s.id==='hrrr')&&h.temperatureBlend.sources.length>2);
  const others=hour.temperatureBlend.sources.filter(s=>s.id!=='hrrr'),weight=others.reduce((n,s)=>n+s.weight,0);
  const expected=others.reduce((n,s)=>n+s.weight*s.value,0)/weight;
  assert.ok(Math.abs(noHrrr.temperature.find(r=>r.time===Date.parse(hour.time)).mine-expected)<1e-9,'the remaining shares are rescaled to 100%');
  const doubled=mixValue([{id:'nws',weight:.4,value:70},{id:'ecmwf',weight:.1,value:80}],{ecmwf:4});
  assert.ok(Math.abs(doubled-(.4*70+.4*80)/.8)<1e-9,'4× multiplies a share before rescaling');
});

test('the rain score keeps its point rules when the mix changes',()=>{
  const sources=[{id:'nws',value:40,weight:.4},{id:'hrrr',value:100,weight:.3},{id:'ecmwf',value:0,weight:.1},{id:'nbm',value:100/3,weight:.2}];
  assert.ok(Math.abs(rainScoreMix({sources},{})-(16+30+0+6.666666666666667))<1e-9);
  assert.ok(Math.abs(rainScoreMix({sources},{nws:1,hrrr:0,ecmwf:0,nbm:0})-40)<1e-9,'just the NWS is the official chance');
  const laterDay=[{id:'ecmwf',value:100,weight:.6},{id:'nbm',value:0,weight:.25}];
  assert.ok(Math.abs(rainScoreMix({sources:laterDay},{})-60)<1e-9,'past the NWS hourly forecast its 15% share adds no points, as on the main page');
  assert.equal(rainScoreMix({sources:laterDay},{nws:1,ecmwf:0,nbm:0}),null,'no kept forecast covers the hour, so it is blank');
  const fallback={mode:'nws-fallback',sources:[{id:'nws',value:30,weight:1}],partialBlend:{sources:[{id:'nws',value:30,weight:.4},{id:'ecmwf',value:100,weight:.1}]}};
  assert.ok(Math.abs(rainScoreMix(fallback,{hrrr:2})-(.4*30+.1*100)/.5)<1e-9,'with a model missing, the present sources split the score instead of counting it as dry');
});

test('recipes accept only the slider stops, and the shares add up',()=>{
  assert.deepEqual(normalTrust({nws:'4',hrrr:7,ecmwf:-1,nbm:null}),{nws:1,hrrr:1,ecmwf:1,nbm:1,wn:1},'anything off the slider reads as Normal');
  assert.deepEqual(normalTrust({nws:0,hrrr:4}),{nws:0,hrrr:4,ecmwf:1,nbm:1,wn:1});
  assert.ok(TRUST_STOPS.includes(1)&&TRUST_STOPS[0]===0&&TRUST_STOPS.at(-1)===4);
  assert.equal(isNourieTrust({}),true);assert.equal(isNourieTrust({wn:2}),false);
  assert.equal(matchingPreset({nws:1,hrrr:0,ecmwf:0,nbm:0,wn:0}),'nws');assert.equal(matchingPreset({ecmwf:2}),null);
  const data={blendPolicy:{sameDay:{nws:.36,hrrr:.27,ecmwf:.09,nbm:.18,wn:.1},extendedRain:{nws:.135,ecmwf:.54,nbm:.225,wn:.1}}};
  const shares=recipeShares(data,{ecmwf:4});
  for(const list of [shares.today,shares.later])assert.ok(Math.abs(list.reduce((n,r)=>n+r.share,0)-1)<1e-9);
  assert.ok(Math.abs(shares.today.find(r=>r.id==='ecmwf').share-.36/1.27)<1e-9);
  assert.equal(shares.later.some(r=>r.id==='hrrr'),false,'HRRR is not part of the later-day rain recipe');
  const coverage=sourceCoverage(forecast,now);
  assert.ok(coverage.ecmwf.last>coverage.hrrr.last,'the coverage note shows HRRR stops sooner than ECMWF');
});

test('the lab summary finds the biggest change',()=>{
  const day=(index,mine,base)=>({index,label:'Mon',longLabel:'Monday',mine,base});
  const diffs=labDifferences({days:[day(0,{high:80,low:60,rain:20,amount:.1},{high:81,low:60,rain:20,amount:.1}),day(1,{high:75,low:58,rain:55,amount:.4},{high:79,low:58,rain:30,amount:.2})]});
  assert.equal(diffs.temperature.delta,-4);assert.equal(diffs.temperature.kind,'high');
  assert.equal(diffs.rain.delta,25);assert.equal(diffs.days,2);
});

test('the plain-language outlook reads the same hourly chances the clock shows',()=>{
  const base=Date.parse('2026-09-05T22:00:00Z');
  const hour=(i,rain,kind='cloudy')=>({isNow:i===0,time:base+i*H,rain,rainShown:rain>=5?rain:null,kind});
  assert.equal(rainOutlook([hour(0,0),hour(1,2),hour(2,3)]).kind,'dry');
  assert.equal(rainOutlook([hour(0,0),hour(1,20),hour(2,3)]).kind,'slight');
  assert.equal(rainOutlook([hour(0,0),hour(1,35),hour(2,20)]).kind,'chance');
  assert.equal(rainOutlook([hour(0,0),hour(1,35),hour(2,60)]).step.rainShown,60,'likely rain is the headline over an earlier small chance');
  assert.equal(rainOutlook([hour(0,0),hour(1,10),hour(2,60)]).kind,'likely');
  assert.equal(rainOutlook([hour(0,0),hour(1,40,'storm'),hour(2,70)]).kind,'storm');
  assert.equal(rainOutlook([{...hour(0,0),rainNow:true},hour(1,0)]).kind,'now');
  const zone='America/New_York';
  assert.equal(relativeHour(base+3*H,base,zone),'around 9 PM');
  assert.equal(relativeHour(base+9*H,base,zone),'overnight, around 3 AM');
  assert.equal(relativeHour(base+20*H,base,zone),'tomorrow around 2 PM');
  assert.match(relativeHour(base+50*H,base,zone),/^Monday around/);
});
