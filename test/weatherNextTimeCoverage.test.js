import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildBlendModel} from '../public/weather-fusion/blend.js';
import * as display from '../public/weather-fusion/weathernext-data.js';

const now=Date.parse('2026-10-14T09:49:00Z');
const row=(time,temperature=290)=>({time,values:{temperature_2m:{mean:temperature,p10:temperature-1,p90:temperature+1}}});
const point={id:'knightdale',name:'Knightdale',timeZone:'America/New_York',latitude:35.787,longitude:-78.4806};
const feed=hours=>({points:[point],sources:{surface:{runAt:'2026-10-12T00:00:00Z',fetchedAt:'2026-10-12T09:13:00Z',points:[{...point,hourly:hours}]}}});
const read=name=>readFileSync(new URL('../public/weather-fusion/'+name,import.meta.url),'utf8');

test('hourly displays keep only the exact current hour and future timestamps',()=>{
  const rows=[row('2026-10-14T10:00:00Z'),row('2026-10-14T08:00:00Z'),row('bad'),row('2026-10-14T09:00:00Z'),row('2026-10-14T09:30:00Z')];
  assert.deepEqual(display.forecastRows(rows,now).map(r=>r.time),['2026-10-14T09:00:00Z','2026-10-14T10:00:00Z']);
  assert.equal(display.currentForecastRow(rows,now).time,'2026-10-14T09:00:00Z');
  assert.equal(display.currentForecastRow([rows[0]],now),null,'An upcoming hour is not the current hour.');
  assert.deepEqual(display.forecastRows([rows[1]],now),[],'An ended forecast is not reused.');
  assert.equal(rows[0].time,'2026-10-14T10:00:00Z','Sorting leaves the downloaded source unchanged.');
});

test('model comparisons require identical valid times instead of matching by array index or flooring',()=>{
  const rows=[row('2026-10-14T09:30:00Z'),row('2026-10-14T10:00:00+00:00'),row('2026-10-12T09:00:00Z')];
  const matched=display.matchingForecastRows(rows,['2026-10-14T09:00:00Z','2026-10-14T10:00:00Z','2026-10-14T11:00:00Z']);
  assert.equal(matched[0],null);
  assert.equal(matched[1],rows[1]);
  assert.equal(matched[2],null);
});

test('expired daily coverage is unavailable even when the last forecast hour was earlier today',()=>{
  assert.deepEqual(display.daysFrom([row('2026-10-14T08:00:00Z')],'America/New_York',now),[]);
});

test('an ended part of today is not presented as upcoming coverage merely because tomorrow has data',()=>{
  const hours=[row('2026-10-14T08:00:00Z'),row('2026-10-15T09:00:00Z')];
  assert.deepEqual(display.daysFrom(hours,'America/New_York',now).map(d=>d.date),['2026-10-15']);
  const compact={points:[{...point,hourly:hours.map(r=>({time:r.time,temperatureF:55}))}]};
  const result=buildBlendModel({location:point,days:[{date:'2026-10-14'}]},compact,point.id,now);
  assert.deepEqual(result.aiDays.map(d=>d.label),['Thu']);
  assert.equal(result.week[0].wnHigh,null);
});

test('Blend drops yesterday from its AI days and aligns model hours exactly',()=>{
  const forecast={location:point,current:{temperature:60},hours:[{time:'2026-10-14T09:00:00Z',temperature:60}],days:[{date:'2026-10-14',high:65,low:50}]};
  const compact={runAt:'2026-10-13T18:00:00Z',points:[{...point,hourly:[
    {time:'2026-10-13T19:00:00Z',temperatureF:999},
    {time:'2026-10-14T09:30:00Z',temperatureF:61},
    {time:'2026-10-14T10:00:00Z',temperatureF:62},
    {time:'2026-10-15T04:00:00Z',temperatureF:55},
  ]}]};
  const result=buildBlendModel(forecast,compact,point.id,now);
  assert.deepEqual(result.aiDays.map(d=>[d.date,d.label]),[['2026-10-14','Today'],['2026-10-15','Thu']]);
  assert.equal(result.aiDays[0].high,62);
  assert.equal(result.series[0].wnMean,null,'The 9:30 forecast cannot masquerade as the 9:00 model hour.');
  assert.equal(result.week[0].wnHigh,62);
});

test('Blend labels tomorrow by its date when current-day coverage is missing',()=>{
  const compact={points:[{...point,hourly:[{time:'2026-10-15T04:00:00Z',temperatureF:55}]}]};
  const result=buildBlendModel({location:point},compact,point.id,now);
  assert.deepEqual(result.aiDays.map(d=>[d.date,d.label]),[['2026-10-15','Thu']]);
  const expired=buildBlendModel({location:point},{points:[{...point,hourly:[{time:'2026-10-14T08:00:00Z',temperatureF:55}]}]},point.id,now);
  assert.equal(expired.wnAvailable,false);
  assert.deepEqual(expired.aiDays,[]);
});

test('daily labels use the selected location date on both sides of UTC midnight',()=>{
  const california={...point,timeZone:'America/Los_Angeles'};
  const compact={points:[{...california,hourly:[
    {time:'2026-10-13T06:00:00Z',temperatureF:999},
    {time:'2026-10-14T06:00:00Z',temperatureF:55},
    {time:'2026-10-14T07:00:00Z',temperatureF:54},
  ]}]};
  const result=buildBlendModel({location:california},compact,point.id,Date.parse('2026-10-14T06:15:00Z'));
  assert.deepEqual(result.aiDays.map(d=>[d.date,d.label]),[['2026-10-13','Today'],['2026-10-14','Wed']]);
});

function browserContext(source){
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',dataset:{},style:{},classList:{toggle(){}},addEventListener(){},setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];}});return elements.get(id);};
  const context={...display,forecastRows:rows=>display.forecastRows(rows,now),currentForecastRow:rows=>display.currentForecastRow(rows,now),daysFrom:(rows,zone)=>display.daysFrom(rows,zone,now),Date:class extends Date{static now(){return now;}},document:{getElementById:get,querySelector:get,querySelectorAll:()=>[],body:{dataset:{}}},console};
  vm.createContext(context);
  vm.runInContext(source.replace(/^import .*;\s*$/mg,'').replace(/\nload\(\);\s*(?:if\(typeof window!==\x27undefined\x27\)installForecastRefresh\(load\);)?\s*$/,''),context);
  return {context,get};
}

test('WN explorer presents the current valid hour and clears values when its run ends',()=>{
  const {context,get}=browserContext(read('wn.js'));
  context.fixture=feed([row('2026-10-12T01:00:00Z',310),row('2026-10-14T09:00:00Z',290),row('2026-10-14T10:00:00Z',291)]);
  context.catalogFixture={fields:[{id:'temperature_2m',kind:'temperature',label:'Air temperature'}]};
  vm.runInContext('feed=fixture;catalog=catalogFixture;setSky=()=>{};renderChart=()=>{};renderDaily=()=>{};renderTable=()=>{};render();',context);
  assert.equal(get('hero-value').textContent,'62°');
  assert.match(get('hero-meta').textContent,/Oct 14/);
  assert.match(get('stat-tiles').innerHTML,/>Now</);
  vm.runInContext('feed.sources.surface.points[0].hourly=feed.sources.surface.points[0].hourly.filter(r=>r.time>"2026-10-14T09:00:00Z");render();',context);
  assert.match(get('stat-tiles').innerHTML,/>Next forecast</);
  vm.runInContext('feed.sources.surface.points[0].hourly=[];render();',context);
  assert.equal(get('hero-value').textContent,'—');
  assert.match(get('hero-meta').textContent,/no current or upcoming/);
  assert.equal(get('stat-tiles').innerHTML,'');
});

test('Ultimate clears an ended AI forecast and does not draw its old hours over current model data',()=>{
  const {context,get}=browserContext(read('ultimate.js'));
  context.fixture=feed([row('2026-10-14T08:00:00Z',310),row('2026-10-12T09:00:00Z',320)]);
  vm.runInContext('wnFeed=fixture;forecast={hours:[{time:"2026-10-14T09:00:00Z",temperature:60},{time:"2026-10-14T10:00:00Z",temperature:61}]};renderModels();renderAILab();',context);
  assert.doesNotMatch(get('blend-chart').innerHTML,/<polygon/);
  assert.match(get('wn-chart2').innerHTML,/No current or upcoming/);
  assert.match(get('wn-age').textContent,/has ended/);
});

for(const name of ['weathernext-site.js','weathernext-site.html']){
  test(`${name} starts the explorer at the current model hour and cannot select an ended run hour`,()=>{
    let source=read(name);
    if(name.endsWith('.html'))source=source.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    source=source.slice(0,source.indexOf("document.querySelector('form')"));
    const {context,get}=browserContext(source);
    context.fixture=feed([row('2026-10-12T01:00:00Z',310),row('2026-10-14T09:00:00Z',290),row('2026-10-14T10:00:00Z',291)]);
    vm.runInContext('feed=fixture;pointId="knightdale";indexes.set("surface:knightdale",{rows:feed.sources.surface.points[0].hourly});selectFirstFuture();',context);
    assert.deepEqual(Array.from(vm.runInContext('visibleRows().map(r=>r.time)',context)),['2026-10-14T09:00:00Z','2026-10-14T10:00:00Z']);
    assert.equal(vm.runInContext('hourIndex',context),0);
    vm.runInContext('indexes.set("surface:knightdale",{rows:[{time:"2026-10-14T08:00:00Z"}]});selectFirstFuture();renderReadout();',context);
    assert.equal(vm.runInContext('visibleRows().length',context),0);
    assert.equal(get('temperature').textContent,'—');
  });
}
