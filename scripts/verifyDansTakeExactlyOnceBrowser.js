import assert from 'node:assert/strict';
import express from 'express';
import {chromium} from 'playwright';
import {fixture} from './weatherNourieFixture.js';
import {DAN_TAKE_VERSION,collectDanTakeEvidence,approveDanTake} from '../public/weather-fusion/dans-take.js';

const now=Date.parse('2026-09-05T16:00:00Z');
function forecastFixture(){
  const f=fixture('knightdale',now);
  f.signature='dans-take-exactly-once-fixture';
  f.aiConfigured=true;
  f.discussion={
    id:'afd-exact-one',office:'RAH',issuanceTime:'2026-09-05T14:00:00Z',url:'https://api.weather.gov/products/afd-exact-one',
    text:'.LONG TERM /MONDAY THROUGH TUESDAY/...\nThe front timing remains uncertain Monday into Tuesday.\n\nIt remains to be seen how much rain occurs with the front Monday into Tuesday.'
  };
  f.location.office='RAH';
  f.feeds=[...(f.feeds||[]).filter(x=>x.id!=='afd'),{id:'afd',label:'Local discussion',status:'ready',url:f.discussion.url,issuedAt:f.discussion.issuanceTime}];
  f.danTakeVersion=DAN_TAKE_VERSION;
  return f;
}
function approvedBriefing(f){
  const candidates=collectDanTakeEvidence(f,now).candidates;
  assert.ok(candidates.length>=2,'fixture must supply two eligible Dan take excerpts');
  const proposals=[
    {evidenceId:candidates[0].id,summary:"Dan's take: The front could arrive earlier or later than expected."},
    {evidenceId:candidates[1].id,summary:'DAN’S TAKE — Dans take: The amount of rain is still uncertain.'},
  ];
  const approved=approveDanTake(proposals,f,now);
  assert.equal(approved.forecastChanges.length,2,'both prefixed summaries must remain evidence-supported');
  return {mode:'ai',signature:f.signature,generatedAt:new Date(now).toISOString(),headline:'Prefixed outlook',summary:'The regular forecast remains available.',nearTerm:'Check the hourly forecast.',extended:'Check the week ahead.',sources:['nws','afd'],...approved};
}
function quietBriefing(f){
  return {mode:'ai',signature:f.signature,generatedAt:new Date(now).toISOString(),headline:'Quiet outlook',summary:'The regular forecast remains available.',nearTerm:'Check the hourly forecast.',extended:'Check the week ahead.',sources:['nws','afd'],danTakeVersion:DAN_TAKE_VERSION,forecastChanges:[]};
}

const f=forecastFixture();let mode='prefixed';
const app=express();
app.get('/api/weather-fusion/forecast',(_req,res)=>res.json(f));
app.get('/api/weather-fusion/briefing',(_req,res)=>res.json(mode==='prefixed'?approvedBriefing(f):quietBriefing(f)));
app.get('/api/weather-fusion/radar',(_req,res)=>res.json({frames:[],status:'unavailable'}));
app.get('/api/weather-fusion/models',(_req,res)=>res.json({layers:{}}));
app.use('/weather-fusion',express.static('public/weather-fusion'));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
  for(const scenario of ['prefixed','quiet']){
    mode=scenario;
    const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage(),errors=[];
    await page.addInitScript(time=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};},now);
    await page.route('https://unpkg.com/**',route=>route.fulfill({body:'',contentType:route.request().url().includes('.css')?'text/css':'application/javascript'}));
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
    await page.waitForFunction(title=>document.querySelector('#briefing-title')?.textContent===title,scenario==='prefixed'?'Prefixed outlook':'Quiet outlook');
    assert.equal(await page.locator('#today-uncertainty').isVisible(),true,scenario+' keeps the Dan take card visible');
    assert.equal(await page.locator('.today-uncertainty-label').count(),1,scenario+' has exactly one Dan take heading element');
    assert.equal((await page.locator('.today-uncertainty-label').innerText()).trim(),"Dan's take");
    assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0,'full outlook must not add a second Dan take block');
    const body=(await page.locator('#today-uncertainty-text').innerText()).trim();
    assert.equal(/dan\s*['’]?\s*s\s+take/i.test(body),false,'body must never repeat the Dan take label');
    assert.equal((await page.locator('body').innerText()).split("Dan's take").length-1,1,'visible page must contain the exact heading only once');
    if(scenario==='prefixed'){
      assert.match(body,/front could arrive earlier or later/i);
      assert.match(body,/amount of rain is still uncertain/i);
    }else{
      assert.equal(body,'No additional forecast changes to call out right now.');
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('DANS_TAKE_EXACTLY_ONCE_BROWSER_VERIFIED');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
