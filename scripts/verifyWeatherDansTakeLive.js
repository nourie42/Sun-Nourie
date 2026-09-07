import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {DAN_TAKE_VERSION,collectDanTakeEvidence,visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
const base='https://sun-nourie-live.onrender.com',output='/tmp/weather-dans-take-live.json';
const report={checkedAt:new Date().toISOString(),commit:process.env.GITHUB_SHA,base,fixture:false,success:false,locations:[]};
const assets=['index.html','app.js','dans-take.js'],digest=v=>createHash('sha256').update(v).digest('hex');
const expected=Object.fromEntries(await Promise.all(assets.map(async p=>[p,digest(await fs.readFile('public/weather-fusion/'+p))])));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ready=false,browser;
try{
 for(let attempt=0;attempt<35&&!ready;attempt++){
  try{
   const r=await fetch(base+'/api/weather-fusion/forecast?location=knightdale',{signal:AbortSignal.timeout(45000),cache:'no-store'}),f=await r.json();
   if(r.ok&&f.danTakeVersion===DAN_TAKE_VERSION){
    const matches=await Promise.all(assets.map(async p=>{const r=await fetch(base+'/weather-fusion/'+p+'?verify-take='+Date.now(),{signal:AbortSignal.timeout(20000),cache:'no-store'});return r.ok&&digest(await r.text())===expected[p];}));
    ready=matches.every(Boolean);
   }
  }catch(e){console.log('Waiting for exact deployed version:',e.message);}
  if(!ready)await delay(15000);
 }
 assert.ok(ready,'Production must serve the new backend contract and exact reviewed frontend bytes');
 report.deployed={version:DAN_TAKE_VERSION,exactAssets:expected};console.log('DATED_TAKE_DEPLOYMENT_VERIFIED',process.env.GITHUB_SHA);
 browser=await chromium.launch({headless:true});
 for(const place of [
  {id:'knightdale',name:'Knightdale / Raleigh',latitude:35.787,longitude:-78.4806},
  {id:'',name:'White Lake, NC',latitude:34.6385,longitude:-78.5025},
  {id:'',name:'Jacksonville, FL',latitude:30.3322,longitude:-81.6557},
  {id:'',name:'Denver, CO',latitude:39.7392,longitude:-104.9903}
 ]){
  const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage(),errors=[];
  await page.addInitScript(place=>localStorage.setItem('weather-fusion-place',JSON.stringify(place)),place);
  page.on('pageerror',e=>errors.push(e.message));
  let f,b,matched=false;
  for(let attempt=0;attempt<3&&!matched;attempt++){
   const getForecast=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.status()===200,{timeout:90000});
   const getBriefing=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/briefing?'),{timeout:100000});
   getBriefing.catch(()=>{});
   await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:90000});
   f=await (await getForecast).json();assert.equal(f.danTakeVersion,DAN_TAKE_VERSION);
   assert.equal(f.current.feelsLike,f.comfort.outdoors,'Existing outdoor-feels contract must remain intact');
   if(!f.aiConfigured){b={mode:'unconfigured'};break;}
   const response=await getBriefing;
   if(!response.ok()){await delay(3000);continue;}
   b=await response.json();matched=b.signature===f.signature;
  }
  assert.ok(b&&(!f.aiConfigured||matched),'Briefing must belong to the exact displayed forecast');
  const time=Date.now(),items=visibleDanTakeItems(b,f,time),text=danTakeText(items),sourceEvidence=collectDanTakeEvidence(f,time);
  if(f.aiConfigured)assert.equal(b.danTakeVersion,DAN_TAKE_VERSION);
  if(b.mode==='ai'){
   assert.equal(b.uncertainty,text,'API compatibility text must be built from approved items only');
   assert.equal((b.forecastChanges||[]).length,items.length);
  }else assert.equal(items.length,0,'No unverified or non-AI take is allowed');
  await page.waitForFunction(expected=>document.querySelector('#today-uncertainty-text')?.textContent===expected,text,{timeout:15000});
  const displayed=await page.evaluate(()=>({text:document.querySelector('#today-uncertainty-text').textContent,hidden:document.querySelector('#today-uncertainty').hidden,fullOutlookSections:document.querySelectorAll('#briefing-detail [data-dans-take]').length,overflow:document.documentElement.scrollWidth>innerWidth+1}));
  assert.equal(displayed.hidden,!items.length);assert.equal(displayed.fullOutlookSections,items.length?1:0);assert.equal(displayed.overflow,false);
  for(const item of items){
   assert.ok(Date.parse(item.eventEnd)>time&&Date.parse(item.validUntil)>time);
   assert.ok(f.discussion.text.replace(/\s+/g,' ').includes(item.sourceQuote));
   assert.ok(!/yesterday|last night|Forecasts can change|main sources of forecast uncertainty/i.test(item.summary));
   assert.ok(item.period&&item.sectionIssuedAt);
  }
  assert.deepEqual(errors,[]);
  const evidence={place:place.name,verifiedAt:new Date(time).toISOString(),aiMode:b.mode,aiReason:b.reason||null,aiDiagnostic:b.diagnostic||null,review:b.danTakeReview||null,takeStatus:b.danTakeStatus,source:sourceEvidence.source,eligibleExcerpts:sourceEvidence.candidates,displayed,approvedChanges:items,discussion:f.discussion?{id:f.discussion.id,office:f.discussion.office,issuedAt:f.discussion.issuanceTime,url:f.discussion.url,text:f.discussion.text}:null};
  report.locations.push(evidence);console.log('LIVE_DATED_TAKE',JSON.stringify({place:place.name,aiMode:b.mode,diagnostic:b.diagnostic||null,review:b.danTakeReview||null,visible:!displayed.hidden,items,text}));
  await context.close();
 }
 report.actualAIGenerations=report.locations.filter(r=>r.aiMode==='ai').length;
 assert.ok(report.actualAIGenerations>=2,'At least two locations must verify actual AI, not only hidden fallback cards');
 report.actualVisibleChanges=report.locations.reduce((n,r)=>n+r.approvedChanges.length,0);
 assert.ok(report.actualVisibleChanges>0,'Live acceptance must demonstrate a real supported future change, not only hidden cards');
 report.success=true;console.log('LIVE_DATED_TAKE_VERIFIED',JSON.stringify({commit:report.commit,locations:report.locations.length,actualAI:report.actualAIGenerations,success:true}));
}finally{
 if(browser)await browser.close();await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
}
