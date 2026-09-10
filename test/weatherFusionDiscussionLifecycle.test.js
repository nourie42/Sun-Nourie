import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDiscussionSource} from '../src/weatherFusionDiscussionSource.js';
import {approveDanTake,collectDanTakeEvidence,rebindDanTake,visibleDanTakeItems} from '../public/weather-fusion/dans-take.js';
import {createWeatherService} from '../src/weatherFusion.js';
import {now as fixtureNow,inputs,periods,hourlyPeriods,grid,snapshot} from './weatherFusion.fixtures.js';
const capture=JSON.parse(fs.readFileSync(new URL('./fixtures/rah-discussion-regression.json',import.meta.url)));
const newest=capture.newProduct,old=capture.oldProduct,at=Date.parse(capture.capturedAt),M=60000,H=60*M;
const row=p=>({'@id':'https://api.weather.gov/products/'+p.id,productCode:'AFD',issuanceTime:p.issuanceTime});
const list=(...p)=>({'@graph':p.map(row)});
const asForecast=(feed,sig='one')=>({signature:sig,location:{latitude:35.787,longitude:-78.4806,office:'RAH',timeZone:'America/New_York'},discussion:feed.value,feeds:[feed.meta]});
function createHarness(){
 let time=at,latest=newest,index=list(old),fail=false,details=new Map([[newest.id,newest],[old.id,old]]),calls=[];
 const request=async(url,options)=>{
  calls.push([url,options]);if(fail)throw Error('simulated failure');
  if(url.endsWith('/latest'))return latest;
  if(url.endsWith('/locations/RAH'))return index;
  return details.get(url.split('/').at(-1));
 };
 const load=createDiscussionSource({request,now:()=>time});
 return {load,calls,set:patch=>{if(patch.time!==undefined)time=patch.time;if(patch.latest!==undefined)latest=patch.latest;if(patch.index!==undefined)index=patch.index;if(patch.fail!==undefined)fail=patch.fail;if(patch.details)details=patch.details;},now:()=>time};
}
test('reproduces screenshot: old index is stale; direct latest restores actual coming-week source',async()=>{
 const h=createHarness(),feed=await h.load('RAH');
 assert.equal(feed.value.id,newest.id);assert.equal(feed.meta.status,'ready');
 assert.equal(feed.value.issuanceTime,newest.issuanceTime);
 const candidates=collectDanTakeEvidence(asForecast(feed),at).candidates;
 assert.ok(candidates.some(c=>/^This coming week/.test(c.period)&&/front/i.test(c.quote)));
 assert.ok(h.calls.every(([,o])=>o.revalidate===true));
});
test('newer verified source never gets overwritten when both NWS routes regress',async()=>{
 const h=createHarness(),first=await h.load('RAH');h.set({time:at+3*M,latest:old,index:list(old)});
 const next=await h.load('RAH');assert.equal(next.value.id,first.value.id);assert.equal(next.meta.retrievalStatus,'regression-ignored');
 assert.equal(next.meta.fetchedAt,first.meta.fetchedAt);assert.notEqual(next.meta.checkedAt,first.meta.checkedAt);
});
test('a newer collection product wins over a lagging latest-product endpoint',async()=>{
 const h=createHarness();h.set({latest:old,index:list(old,newest)});const feed=await h.load('RAH');assert.equal(feed.value.id,newest.id);
});
test('missing /latest implementation still resolves immutable indexed products',async()=>{
 const h=createHarness();h.set({latest:list(newest),index:list(old,newest)});assert.equal((await h.load('RAH')).value.id,newest.id);
});
test('an unavailable source retains a recent verified product without rewriting its timestamp',async()=>{
 const h=createHarness(),first=await h.load('RAH');h.set({time:at+3*M,fail:true});const f=await h.load('RAH');
 assert.equal(f.value.id,newest.id);assert.equal(f.meta.retrievalStatus,'last-verified');assert.equal(f.meta.fetchedAt,first.meta.fetchedAt);
});
test('a previously verified product expires at its original twelve-hour limit during an outage',async()=>{
 const h=createHarness();await h.load('RAH');h.set({time:Date.parse(newest.issuanceTime)+12*H,fail:true});const f=await h.load('RAH');
 assert.equal(f.meta.status,'stale');assert.equal(f.value,null);assert.equal(f.meta.issuedAt,newest.issuanceTime);
});
test('cold start with only old data reports stale, not available or a fabricated newer discussion',async()=>{
 const h=createHarness();h.set({latest:old,index:list(old)});const f=await h.load('RAH');assert.equal(f.value,null);assert.equal(f.meta.status,'stale');
});
test('future timestamp and foreign office cannot displace a verified source',async()=>{
 for(const bad of [{...newest,issuanceTime:'2026-09-08T07:00Z'},{...newest,issuingOffice:'KMHX'},{...newest,productCode:'SPS'},{...newest,productText:'\nAFDMHX\nWrong office text'}]){
  const h=createHarness();h.set({latest:bad,index:{'@graph':[]}});const f=await h.load('RAH');assert.equal(f.value,null);assert.equal(f.meta.status,'unavailable');
 }
});
test('foreign URLs and unsafe office input never cause arbitrary source requests',async()=>{
 const h=createHarness();h.set({latest:{},index:{'@graph':[{...row(newest),'@id':'https://evil.example/products/new'}]}});
 assert.equal((await h.load('RAH')).value,null);assert.equal((await h.load('../secrets')).value,null);assert.ok(h.calls.every(([u])=>u.startsWith('https://api.weather.gov/')));
});
test('index and fetched product dates must agree',async()=>{
 const h=createHarness();h.set({latest:{},index:{'@graph':[{...row(newest),issuanceTime:'2026-09-07T08:00Z'}]}});assert.equal((await h.load('RAH')).value,null);
});
test('coalesces concurrent lookups for one office and does not fetch repeatedly within cache window',async()=>{
 const h=createHarness();const all=await Promise.all(Array.from({length:20},()=>h.load('RAH')));
 assert.ok(all.every(f=>f.value.id===newest.id));assert.equal(h.calls.length,2);await h.load('RAH');assert.equal(h.calls.length,2);
});
test('rebind retains only exact-current-source take across changed numeric forecasts',async()=>{
 const h=createHarness(),feed=await h.load('RAH'),f=asForecast(feed),c=collectDanTakeEvidence(f,at).candidates.find(c=>/front/.test(c.quote));
 const b={mode:'ai',signature:f.signature,summary:'OLD FULL OUTLOOK MUST NOT BE CARRIED',generatedAt:new Date(at).toISOString(),...approveDanTake([{evidenceId:c.id,summary:'The front could arrive earlier or later than expected.'}],f,at)};
 const next={...f,signature:'changed-temperature'},take=rebindDanTake(b,next,at+M);
 assert.ok(take);assert.equal(take.signature,next.signature);assert.equal(take.summary,undefined);assert.equal(visibleDanTakeItems(take,next,at+M).length,1);
 for(const changed of [{...next,location:{...next.location,latitude:36}},{...next,discussion:{...next.discussion,id:'new-afd'}},{...next,discussion:{...next.discussion,text:'No upcoming concerns'}},{...next,feeds:[{id:'afd',status:'stale'}]}])assert.equal(rebindDanTake(b,changed,at+M),null);
 assert.equal(rebindDanTake(b,next,Date.parse(newest.issuanceTime)+12*H),null);
});
function response(d){return new Response(JSON.stringify(d),{status:200,headers:{'Content-Type':'application/json'}});}
for(const emptyReview of [false,true])test(emptyReview?'full service: successful empty review clears a retained same-source take':'full service: general AI budget exhaustion cannot erase an approved same-source card after refresh',async()=>{
 let time=fixtureNow,aiCalls=0;
 const date=new Date(time).toISOString(),product={id:'lifecycle-afd',productCode:'AFD',issuingOffice:'KRAH',issuanceTime:date,productText:'.DISCUSSION...\nThe timing of the front remains uncertain tomorrow.'};
 const fetchImpl=async(url,options)=>{
  const u=new URL(url);
  if(u.hostname==='api.openai.com'){
   aiCalls++;const facts=JSON.parse(JSON.parse(options.body).input),c=facts.danTakeEvidence.candidates[0];assert.ok(c);
   return response({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({headline:'Local outlook',summary:'The forecast is based on the latest local discussion.',nearTerm:'Clouds may linger.',extended:'A front approaches.',uncertainty:'',forecastChanges:emptyReview&&aiCalls>1?[]:[{evidenceId:c.id,summary:'The front could arrive earlier or later than expected.'}],sources:facts.requiredSources})}]}]});
  }
  if(u.hostname==='raw.githubusercontent.com'&&u.pathname.includes('/models/'))return response(snapshot(u.pathname.split('/').at(-1).replace('.json','')));
  if(u.pathname.startsWith('/points/'))return response({properties:{...inputs.point,forecast:'https://api.weather.gov/gridpoints/RAH/1,1/forecast',forecastHourly:'https://api.weather.gov/gridpoints/RAH/1,1/forecast/hourly',forecastGridData:'https://api.weather.gov/gridpoints/RAH/1,1'}});
  if(u.pathname.endsWith('/forecast/hourly'))return response({properties:{periods:hourlyPeriods}});
  if(u.pathname.endsWith('/forecast'))return response({properties:{periods,updateTime:date}});
  if(u.pathname==='/gridpoints/RAH/1,1')return response({properties:grid});
  if(u.pathname==='/alerts/active')return response({features:[]});
  if(u.pathname.endsWith('/latest'))return response(product);
  if(u.pathname.includes('/products/types/AFD/'))return response(list(product));
  throw new Error('Unmocked source: '+url);
 };
 const service=createWeatherService({now:()=>time,env:{OPENAI_API_KEY:'TEST',WEATHER_FUSION_AI_DAILY_LIMIT:emptyReview?'5':'1'},fetchImpl});
 const first=await service.getForecast({location:'knightdale'}),b=await service.getBriefing({location:'knightdale',signature:first.signature});
 assert.equal(b.forecastChanges.length,1);assert.equal(aiCalls,1);
 time+=11*M;
 const next=await service.getForecast({location:'knightdale'});assert.notEqual(next.signature,first.signature);assert.ok(next.danTake);
 assert.equal(visibleDanTakeItems(next.danTake,next,time).length,1);
 const fallback=await service.getBriefing({location:'knightdale',signature:next.signature});
 if(emptyReview){assert.equal(fallback.mode,'ai');assert.deepEqual(fallback.forecastChanges,[]);assert.equal(fallback.danTake,null);time+=2*M;const fresh=await service.getForecast({location:'knightdale'});assert.equal(fresh.danTake,null);assert.equal(aiCalls,2);}else{assert.equal(fallback.mode,'nws-summary');assert.match(fallback.reason,/limit/);assert.ok(fallback.danTake);assert.equal(aiCalls,1);}
});
