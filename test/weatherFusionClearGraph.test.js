import test from 'node:test';
import assert from 'node:assert/strict';
import {dayGraphPoints,dayGraphHTML} from '../public/weather-fusion/day-graph.js';
import {walkerOutfit} from '../public/weather-fusion/pavement.js';
import {danCard} from '../public/weather-fusion/dans-summary.js';
import {approveDanTake,collectDanTakeEvidence,plainDanWording,hasDanJargon} from '../public/weather-fusion/dans-take.js';
import {buildForecast} from '../src/weatherFusion.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
const H=3600000,now=Date.parse('2026-09-05T16:00Z'),location={latitude:35.787,longitude:-78.4806};
test('confidence uses final actual contributors and ignores zero-weight NBM today',()=>{
 const models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>[id,validateSnapshot(snapshot(id),id,location,now).value]));
 const f=buildForecast({...testInputs,models}),d=f.days[0];
 assert.deepEqual(d.confidence.sourceIds,['nws','hrrr','ecmwf']);assert.equal(d.confidence.sourceCount,3);
 assert.deepEqual(d.highBlend.sources.map(s=>[s.id,s.weight]),[['nws',.4],['hrrr',.4],['ecmwf',.2]]);
 const values=d.highBlend.sources.map(s=>s.value);assert.equal(d.highSpread,Math.round((Math.max(...values)-Math.min(...values))*10)/10);
 const missing=buildForecast({...testInputs,models:{}});assert.deepEqual(missing.days[0].confidence.sourceIds,['nws']);
 for(const day of f.days){const ids=[...new Set(Object.values(day.confidence.contributions).flat().filter(s=>s.weight>0&&Number.isFinite(s.value)).map(s=>s.id))].sort();assert.deepEqual([...day.confidence.sourceIds].sort(),ids);}
});
test('combined graph aligns UTC instants, keeps zero UV, gaps and date windows',()=>{
 const time='2026-09-05T16:00:00Z',f={location:{timeZone:'America/New_York'},days:[{date:'2026-09-05'}],metricForecasts:{series:{temperature:[{time,value:90}],feels:[{time,value:96}],dewpoint:[{time,value:72}]}},uv:{hourly:[{time,value:0}]}};
 const p=dayGraphPoints(f,0,false,now);assert.equal(p.length,19);assert.deepEqual([p[0].temperature,p[0].feels,p[0].dewpoint,p[0].uv],[90,96,72,0]);assert.equal(p[1].uv,null);assert.equal(p[1].feels,null);
 assert.equal(dayGraphPoints(f,0,true,now)[0].time,'2026-09-05T23:00:00.000Z');assert.match(dayGraphHTML(f,0,false,now),/data-series="uv"/);assert.doesNotMatch(dayGraphHTML(f,0,false,now),/NaN|undefined/);
 f.days[0].date='2026-03-07';assert.equal(dayGraphPoints(f,0,false,Date.parse('2026-03-07T00:00Z')).length,23);
 f.days[0].date='2026-10-31';assert.equal(dayGraphPoints(f,0,false,Date.parse('2026-10-31T00:00Z')).length,25);
});
test('dog outfits follow human feels-like thresholds, not pavement',()=>{
 for(const [feels,asset] of [[104,'hot'],[88,'hot'],[74,'hot'],[65,'mild'],[58,'mild'],[42,'cool'],[30,'cold']])assert.equal(walkerOutfit(feels).asset,asset==='cool'?'poodle-walk.png':`poodle-walk-${asset}.png`);
});
test('Dan translates the screenshot uncertainty and rejects technical paraphrases',()=>{
 assert.equal(plainDanWording('Rain may be less widespread than some runs indicate because a dry layer could linger.'),'Rain may be less widespread than expected because dry air could linger.');
 assert.ok(hasDanJargon('Earlier runs suggest more rain.'));
 const f={signature:'jargon',location:{...location,office:'MHX',timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd-test',office:'MHX',issuanceTime:new Date(now-H).toISOString(),text:'.SHORT TERM /Sunday/...\nShowers and storms are expected Sunday. Coverage may be limited as models are suggesting mid level subsidence and a dry layer lingering into Sunday.\n&&'}};
 const candidates=collectDanTakeEvidence(f,now).candidates;assert.equal(candidates.length,1);
 const card=danCard(null,f,now);assert.match(card.text,/Showers and storms may be less widespread than expected/);assert.doesNotMatch(card.text,/subsidence|sinking|mid level/);assert.ok(card.text.split(/\s+/).length<25);
 for(const summary of ['Mid level sinking may limit rain coverage.','Subsidence may limit the showers.','Instability and shear may increase storms.'])assert.equal(approveDanTake([{evidenceId:candidates[0].id,summary}],f,now).forecastChanges.length,0);
 f.discussion.text='.SHORT TERM /Sunday/...\nVorticity and isentropic lift may increase Sunday.\n&&';assert.equal(danCard(null,f,now).text,'');
});
test('Dan never shows convergence or trough wording from the forecast discussion',()=>{
 const f={signature:'screenshot-jargon',location:{...location,office:'MHX',timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd-screenshot',office:'MHX',issuanceTime:new Date(now-3600000).toISOString(),text:'.LONG TERM /Friday/...\nA few inland showers or storms may pop up Friday. There is some uncertainty regarding the strength of convergence along the inland trough.\n&&'}};
 const candidate=collectDanTakeEvidence(f,now).candidates[0];assert.ok(candidate);
 for(const copied of ['There is some uncertainty regarding the strength of convergence along the inland trough.','The trough and convergence may be stronger than expected.']){
  assert.ok(hasDanJargon(copied));
  assert.equal(approveDanTake([{evidenceId:candidate.id,summary:copied}],f,now).forecastChanges.length,0);
 }
 const simple='A few inland showers or storms may pop up, but they may not cover many places.';
 const approved=approveDanTake([{evidenceId:candidate.id,summary:simple}],f,now);
 assert.equal(approved.forecastChanges.length,1);assert.equal(approved.forecastChanges[0].summary,simple);
 assert.doesNotMatch(approved.forecastChanges[0].summary,/convergence|trough/i);
});
