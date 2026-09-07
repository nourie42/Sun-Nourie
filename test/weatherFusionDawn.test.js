import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDanTakeService,DAN_TAKE_INSTRUCTIONS} from '../src/weatherFusionDanTake.js';
import {collectDanTakeEvidence,approveDanTake,visibleDanTakeItems,combineDanTake,danTakeText} from '../public/weather-fusion/dans-take.js';
import {sourceTransition,solarEffectText} from '../public/weather-fusion/source-transition.js';
import {thermalComfort,solarElevation} from '../public/weather-fusion/weather-math.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/weather-dawn-discussions.json',import.meta.url)));
const raw=fixtures.knightdale,now=Date.parse(raw.assembledAt),H=3600000;
const resultFor=body=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(body)}]}]});
function proposals(data=raw){return collectDanTakeEvidence(data,now).candidates.map(c=>({evidenceId:c.id,summary:/QPF/.test(c.quote)?'How much rain the front brings is still uncertain.':'The front could arrive earlier or later, shifting when rain reaches the area.'}));}
function approved(data=raw){return {...approveDanTake(proposals(data),data,now),signature:data.signature,mode:'ai'};}
test('actual Raleigh discussion produces both late-week front timing and rainfall amount candidates',()=>{
 const e=collectDanTakeEvidence(raw,now);assert.equal(e.candidates.length,2);
 assert.ok(e.candidates.every(c=>c.period.startsWith('This coming week — Thursday night')));
 assert.ok(e.candidates.every(c=>c.eventEnd==='2026-09-12T04:00:00.000Z'));
 const b=approved();assert.equal(b.forecastChanges.length,2);assert.equal(b.danTakeReview.rejected.length,0);
 assert.match(danTakeText(visibleDanTakeItems(b,raw,now)),/Friday/);
});
test('PoPs and QPF translate to rain without silently rejecting source-supported words',()=>{
 for(const c of collectDanTakeEvidence(raw,now).candidates){const b=approveDanTake([{evidenceId:c.id,summary:'Rain chances and amounts could turn out differently than expected.'}],raw,now);assert.equal(b.forecastChanges.length,1);}
});
test('Denver model disagreement is a real late-week concern; quiet White Lake gets none',()=>{
 const d=fixtures.denver,e=collectDanTakeEvidence(d,Date.parse(d.assembledAt));assert.equal(e.candidates.length,1);assert.match(e.candidates[0].quote,/GFS is faster/);assert.match(e.candidates[0].period,/Sunday/);
 assert.equal(collectDanTakeEvidence(fixtures['white-lake'],now).candidates.length,0);
});
test('snow cannot be invented from the Raleigh rainfall passage',()=>{
 const p=proposals();p[0].summary='Heavy snow could cause travel problems.';const r=approveDanTake(p,raw,now);
 assert.equal(r.forecastChanges.length,1);assert.equal(r.danTakeReview.rejected[0].reason,'unsupported-paraphrase');
});
test('independent generation accounts for all evidence and caches by AFD, not observation',async()=>{
 let calls=0,claims=0;
 const svc=createDanTakeService({env:{OPENAI_API_KEY:'fixture'},now:()=>now,claimRequest:()=>{claims++;return true;},request:async(url,opts)=>{
  calls++;assert.match(url,/api.openai.com/);assert.equal(opts.body.instructions,DAN_TAKE_INSTRUCTIONS);assert.equal(JSON.parse(opts.body.input).candidates.length,2);
  return resultFor({items:proposals(),omissions:[]});
 }});
 const [a,b]=await Promise.all([svc(raw),svc(raw)]);assert.equal(a.mode,'ai');assert.equal(b.mode,'ai');assert.equal(calls,1);
 const next=await svc({...raw,signature:'changed-station-temperature',current:{temperature:99}});
 assert.equal(next.signature,'changed-station-temperature');assert.equal(next.cached,true);assert.equal(calls,1);assert.equal(claims,1);assert.equal(next.forecastChanges.length,2);
});
test('missing AI items trigger repair, not a silently successful blank card',async()=>{
 let calls=0;
 const svc=createDanTakeService({env:{OPENAI_API_KEY:'fixture'},now:()=>now,request:async()=>{calls++;return resultFor(calls===1?{items:[],omissions:[]}:{items:proposals(),omissions:[]});}});
 const b=await svc(raw);assert.equal(calls,2);assert.equal(b.mode,'ai');assert.equal(b.forecastChanges.length,2);
});
test('unsupported wording is retried and failed validation is reported',async()=>{
 let calls=0;const svc=createDanTakeService({env:{OPENAI_API_KEY:'fixture'},now:()=>now,request:async()=>{calls++;return resultFor({items:proposals().map(p=>({...p,summary:'Snow could be heavy.'})),omissions:[]});}});
 const b=await svc(raw);assert.equal(calls,2);assert.equal(b.mode,'unavailable');assert.equal(b.danTakeDiagnostic,'AI_UNSUPPORTED_PARAPHRASE');assert.equal(b.forecastChanges.length,0);
});
test('quiet discussion costs no AI request and gets no filler',async()=>{
 const svc=createDanTakeService({env:{OPENAI_API_KEY:'fixture'},now:()=>now,request:async()=>{throw Error('should not request');}});
 const b=await svc(fixtures['white-lake']);assert.equal(b.mode,'none');assert.equal(b.uncertainty,'');
});
test('existing daily AI limit is respected and not confused with no concern',async()=>{
 const svc=createDanTakeService({env:{OPENAI_API_KEY:'fixture'},now:()=>now,claimRequest:()=>false,request:async()=>{throw Error('budget exceeded');}});
 const b=await svc(raw);assert.equal(b.mode,'unavailable');assert.equal(b.danTakeDiagnostic,'AI_DAILY_LIMIT');
});
test('new AFD or location cannot reuse another source cache',async()=>{
 let calls=0;
 const svc=createDanTakeService({env:{OPENAI_API_KEY:'fixture'},now:()=>now,request:async()=>{calls++;return resultFor({items:proposals(),omissions:[]});}});
 await svc(raw);await svc({...raw,discussion:{...raw.discussion,id:'new-afd'}});assert.equal(calls,2);
 await svc({...raw,location:{...raw.location,latitude:35.8}});assert.equal(calls,3);
});
test('source age and event bounds are rechecked while a browser stays open',async()=>{
 let time=now;const svc=createDanTakeService({env:{OPENAI_API_KEY:'fixture'},now:()=>time,request:async()=>resultFor({items:proposals(),omissions:[]})});
 const b=await svc(raw);assert.equal(b.mode,'ai');time=Date.parse(raw.discussion.issuanceTime)+12*H+1;
 const end=await svc(raw);assert.equal(end.mode,'none');assert.equal(end.forecastChanges.length,0);assert.deepEqual(visibleDanTakeItems(b,raw,time),[]);
});
test('late empty full outlook cannot erase independently approved take',()=>{
 const take=approved();const combined=combineDanTake({mode:'nws-summary',signature:raw.signature,forecastChanges:[],summary:'Ordinary forecast'},take,raw,now);
 assert.equal(combined.summary,'Ordinary forecast');assert.equal(combined.mode,'nws-summary');assert.equal(combined.danTakeMode,'ai');assert.equal(visibleDanTakeItems(combined,raw,now).length,2);
 const changed=combineDanTake({mode:'nws-summary',signature:'elsewhere'},take,{...raw,signature:'elsewhere'},now);assert.equal(changed.forecastChanges,undefined);
});
test('no three-hour timer: holding weather fixed, dawn adds heat immediately in four locations',()=>{
 for(const f of Object.values(fixtures))for(const skyCover of [0,14,62,100]){
  const sample={temperature:66.2,dewpoint:64.4,wind:4.8,skyCover,condition:'Clear'};
  const start=Math.floor(Date.parse(f.assembledAt)/H)*H;let previous=null,sunlit=0;
  for(let t=start;t<start+8*H;t+=5*60000){
   const e=solarElevation(t,f.location.latitude,f.location.longitude);if(e>Math.PI/4)break;
   const c=thermalComfort(sample,f.location,t);
   if(e<=0)assert.equal(c.rawShade,c.rawOutdoors);else if(skyCover<100){assert.ok(c.rawOutdoors>c.rawShade);sunlit++;}
   if(previous!==null)assert.ok(c.rawOutdoors>=previous-1e-8,`${f.location.name} ${new Date(t).toISOString()}`);
   previous=c.rawOutdoors;
  }
  if(skyCover<100)assert.ok(sunlit>0);
 }
});
test('sunlight benefit is isolated from other input changes, not used to force temperatures upward',()=>{
 const location=raw.location,t=Date.parse('2026-09-07T11:00Z');
 const calm=thermalComfort({temperature:66.2,dewpoint:64.4,wind:0,condition:'Clear'},location,Date.parse('2026-09-07T10:40Z'));
 const dawn=thermalComfort({temperature:64,dewpoint:61.4,wind:4.8,skyCover:14,condition:'Sunny'},location,t);
 assert.ok(dawn.rawOutdoors>dawn.rawShade);assert.ok(dawn.rawOutdoors<calm.rawOutdoors);
 assert.match(solarEffectText(dawn),/less than 1°/);assert.match(solarEffectText({...dawn,daylight:false}),/No sunlight/);
});
test('sunrise explanation preserves station and point inputs, including zero wind',()=>{
 const time=Date.parse('2026-09-07T10:40Z'),pointTime='2026-09-07T11:00:00.000Z';
 const f={location:raw.location,assembledAt:new Date(time).toISOString(),current:{type:'observation',temperature:66.2,dewpoint:64.4,wind:0,station:'KJNX',stationDistanceKm:28.6,time:'2026-09-07T09:55Z',condition:'Clear'},metricForecasts:{series:{feels:[{time:pointTime,value:63.6,inputs:{temperature:64,dewpoint:61.4,wind:4.8,skyCover:14},condition:'Sunny'}]}}};
 const saved=JSON.stringify(f),d=sourceTransition(f,time);assert.equal(JSON.stringify(f),saved);assert.equal(d.currentWind,0);assert.equal(d.wind,4.8);assert.ok(d.solarEffect>0);assert.ok(d.feels<d.currentFeels);
 assert.equal(Math.round(d.distanceMiles),18);assert.equal(d.observationAgeMinutes,45);
});
test('displayed humidity, dewpoint and daylight use the exact calculated hourly sample',()=>{
 const time='2026-09-07T10:00:00.000Z',rows=v=>[{time,value:v}];
 const f={location:raw.location,current:{temperature:66.2,dewpoint:64.4,wind:0,condition:'Clear'},hours:[{time,temperature:65,humidity:11,dewpoint:9,wind:'50 mph',isDay:true,condition:'Clear'}],metricForecasts:{notes:{},series:{temperature:rows(65),dewpoint:rows(63),wind:rows(4)}}};
 rebuildHourlyFeels(f,{now:Date.parse('2026-09-07T10:40Z'),temperatureAt:()=>null,humidityAt:()=>null,skyAt:()=>14});
 const h=f.hours[0];assert.equal(h.dewpoint,h.feelsLikeInputs.dewpoint);assert.equal(h.humidity,h.feelsLikeInputs.humidity);assert.equal(h.windMph,h.feelsLikeInputs.wind);assert.equal(h.isDay,false);
});
test('failed independent request cannot erase valid source-checked full-outlook evidence',()=>{
 const f=structuredClone(fixtures.knightdale),at=Date.parse(f.assembledAt),e=collectDanTakeEvidence(f,at);
 const valid={mode:'ai',signature:f.signature,...approveDanTake([{evidenceId:e.candidates[0].id,summary:'The front may arrive earlier or later than expected.'}],f,at)};
 const result=combineDanTake(valid,{mode:'unavailable',signature:f.signature,danTakeDiagnostic:'AI_PROVIDER_UNAVAILABLE'},f,at);
 assert.equal(visibleDanTakeItems(result,f,at).length,1);
});
