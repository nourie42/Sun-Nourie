import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {forecastConfidence,FORECAST_CONFIDENCE_VERSION} from '../public/weather-fusion/forecast-confidence.js';
import {clothingForFeels,exposureScene} from '../public/weather-fusion/exposure-scene.js';
import {collectDanTakeEvidence,approveDanTake,danTakeText} from '../public/weather-fusion/dans-take.js';
const now=Date.parse('2026-09-07T12:00:00Z');
const forecast={signature:'ui-request',location:{latitude:35.787,longitude:-78.4806,timeZone:'America/New_York',office:'RAH'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd-ui',office:'RAH',issuanceTime:'2026-09-07T11:00:00Z',text:'.LONG TERM /THURSDAY THROUGH FRIDAY/...\nThe timing of the front is uncertain Thursday into Friday.\n\nIt remains to be seen how much QPF is realized with the front Thursday into Friday.',url:'https://api.weather.gov/products/afd-ui'}};

test('confidence is a relative scientific index, not a probability',()=>{
 const c=forecastConfidence({dayIndex:3,highSpread:4,qpfSpread:.12,guidanceCount:3,officialDay:true,officialNight:true});
 assert.equal(c.version,FORECAST_CONFIDENCE_VERSION);assert.ok(c.score>=35&&c.score<=100);assert.match(c.note,/not a probability/i);
 assert.ok(c.factors.some(x=>/temperature spread/.test(x)));assert.ok(c.factors.some(x=>/rainfall-guidance spread/.test(x)));
});
test('same evidence loses confidence with lead time',()=>{
 const base={highSpread:2,qpfSpread:.04,guidanceCount:3,officialDay:true,officialNight:true};
 const scores=Array.from({length:7},(_,dayIndex)=>forecastConfidence({...base,dayIndex}).score);
 for(let i=1;i<scores.length;i++)assert.ok(scores[i]<=scores[i-1]);
});
test('later day can rate better when actual guidance agreement is materially better',()=>{
 const early=forecastConfidence({dayIndex:2,highSpread:10,qpfSpread:.6,guidanceCount:1,officialDay:true,officialNight:false});
 const later=forecastConfidence({dayIndex:4,highSpread:1,qpfSpread:.02,guidanceCount:3,officialDay:true,officialNight:true});
 assert.ok(later.score>early.score);
});
test('missing official periods and model coverage lower confidence',()=>{
 const full=forecastConfidence({dayIndex:2,highSpread:3,qpfSpread:.05,guidanceCount:3,officialDay:true,officialNight:true});
 const limited=forecastConfidence({dayIndex:2,highSpread:3,qpfSpread:.05,guidanceCount:0,officialDay:false,officialNight:false});
 assert.ok(limited.score<full.score);
});

test('clothing follows the figure feels-like temperature from hot to cold',()=>{
 assert.deepEqual([[95,'hot'],[82,'warm'],[66,'mild'],[48,'cool'],[30,'cold']].map(([v])=>clothingForFeels(v)),['hot','warm','mild','cool','cold']);
 for(const [v,outfit] of [[95,'hot'],[82,'warm'],[66,'mild'],[48,'cool'],[30,'cold']]){
  const svg=exposureScene(true,true,'Clear',v);assert.match(svg,new RegExp(`data-outfit="${outfit}"`));
 }
 assert.match(exposureScene(true,true,'Clear',30),/coat, scarf and warm hat/);
 assert.match(exposureScene(true,true,'Clear',95),/light hot-weather clothing/);
});

test('Dan take groups one period and strips every repeated Dan take label from body text',()=>{
 const period='This coming week — Thursday, Sep 10 – Friday, Sep 11';
 const text=danTakeText([{period,summary:"Dan's take: The front could arrive earlier or later."},{period,summary:'DAN’S TAKE — Dans take: The amount of rain is still uncertain.'},{period,summary:'The amount of rain is still uncertain.'}]);
 assert.equal(text.split(period).length-1,1);assert.match(text,/front could arrive/);assert.match(text,/amount of rain/);
 assert.equal((text.match(/dan\s*['’]?\s*s\s+take/gi)||[]).length,0);
});
test('Dan take rejects forecaster-attribution filler and accepts direct wording',()=>{
 const candidates=collectDanTakeEvidence(forecast,now).candidates;assert.ok(candidates.length>=1);
 const id=candidates[0].id;
 assert.equal(approveDanTake([{evidenceId:id,summary:'Forecasters indicate the front could arrive later.'}],forecast,now).forecastChanges.length,0);
 assert.equal(approveDanTake([{evidenceId:id,summary:'The front could arrive earlier or later than expected.'}],forecast,now).forecastChanges.length,1);
});

test('requested current comfort heading is exact and daily renderer includes Forecast confidence',()=>{
 const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
 const experience=fs.readFileSync(new URL('../public/weather-fusion/experience.js',import.meta.url),'utf8');
 assert.match(html,/id="skin-kicker">How does it feel outside right now<\/h2>/);
 assert.match(experience,/Forecast confidence/);
 assert.match(html,/Forecast confidence<\/strong>/);
});
