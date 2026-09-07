/** Real DOM integration with explicitly recorded public-weather fixtures.
 * This is not live verification: the separate live audit uses real endpoints. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import express from 'express';
import {chromium} from 'playwright';
import {collectDanTakeEvidence,approveDanTake,danTakeText} from '../public/weather-fusion/dans-take.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {sourceTransition,solarEffectText} from '../public/weather-fusion/source-transition.js';
const source=process.env.WEATHER_DAWN_FIXTURES||'/tmp/dawn-source/live';
const dir=process.env.WEATHER_DAWN_REPORT||'/tmp/weather-dawn-browser';
await fs.mkdir(dir,{recursive:true});
const captured=Object.fromEntries(await Promise.all(['knightdale','white-lake','denver','seattle'].map(async name=>[name,JSON.parse(await fs.readFile(source+'/'+name+'-forecast.json','utf8'))])));
const prepare=name=>{
 const f=structuredClone(captured[name]),at=Date.parse(f.assembledAt);
 const cover=new Map(f.metricForecasts.series.feels.map(p=>[Date.parse(p.time),p.inputs.skyCover]));
 rebuildHourlyFeels(f,{now:at,temperatureAt:()=>({value:null}),humidityAt:()=>null,skyAt:t=>cover.get(t)??null});
 return f;
};
const data=Object.fromEntries(Object.keys(captured).map(name=>[name,prepare(name)]));
function take(f){
 const now=Date.parse(f.assembledAt),evidence=collectDanTakeEvidence(f,now);
 const proposals=evidence.candidates.map(c=>({evidenceId:c.id,summary:/QPF|rainfall amount/i.test(c.quote)?'How much rain the front brings is still uncertain.':'The front could arrive earlier or later, shifting when conditions change.'}));
 return {...approveDanTake(proposals,f,now),signature:f.signature,mode:'ai',generatedAt:f.assembledAt};
}
const app=express();app.use('/weather-fusion',express.static('public/weather-fusion'));
app.get('/api/weather-fusion/:kind',async(req,res)=>{
 const name=req.query.location||'knightdale',f=data[name]||data.knightdale;
 if(req.params.kind==='forecast')return res.json(f);
 if(req.params.kind==='dans-take')return res.json(take(f));
 if(req.params.kind==='briefing'){
  await new Promise(r=>setTimeout(r,650));
  return res.json({mode:'nws-summary',signature:f.signature,headline:'Late regular outlook',summary:'Fixture official forecast remains available.',nearTerm:'',extended:'',sources:['nws'],forecastChanges:[],uncertainty:''});
 }
 if(req.params.kind==='bulletins')return res.json({signature:f.signature,mode:'none',summaries:[]});
 if(req.params.kind==='models')return res.json({layers:{}});
 if(req.params.kind==='radar')return res.json({frames:[],message:'Not loaded in this fixture test.'});
 return res.json({results:[]});
});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const report={fixture:true,checks:[],browserErrors:[],success:false};
try{
 for(const width of [320,390,1365])for(const name of Object.keys(data)){
  const f=data[name],at=Date.parse(f.assembledAt),context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>report.browserErrors.push(e.message));
  await page.addInitScript(({at,name,place})=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};localStorage.setItem('weather-fusion-place',JSON.stringify({...place,id:name}));},{at,name,place:f.location});
  await page.route('https://unpkg.com/**',r=>r.fulfill({body:'',contentType:r.request().url().includes('.css')?'text/css':'application/javascript'}));
  await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#briefing-title').textContent==='Late regular outlook');
  const items=take(f).forecastChanges;
  assert.equal(await page.locator('#today-uncertainty').isVisible(),items.length>0,'Late empty regular forecast must not erase a valid independent take');
  assert.equal((await page.locator('#today-uncertainty-text').textContent()).trim(),danTakeText(items));
  if(name==='knightdale'){
   assert.equal(items.length,2,'Captured RAH discussion has two explicit later-week possibilities');
   assert.match(await page.locator('#today-uncertainty-text').innerText(),/This coming week.*Thursday night.*Friday/s);
   assert.match(await page.locator('#today-uncertainty-text').innerText(),/How much rain/);
   assert.match(await page.locator('#hourly-source-note').innerText(),/18 miles away/);
  }
  const transition=sourceTransition(f,at);
  if(transition){
   await page.locator('#hourly-source-note > details > summary').click();
   assert.match(await page.locator('#hourly-source-note').innerText(),/Each hour uses its own weather inputs/);
  }
  const initial=(await page.locator('#hourly .hour-current .hour-feels b').innerText()).trim();
  assert.equal(initial,Math.round(thermalComfort(f.current,f.location,at).rawOutdoors)+'°');
  const sunrise=f.metricForecasts.series.feels.find(p=>Date.parse(p.time)>at&&p.daylight&&Number.isFinite(p.value));
  if(sunrise&&await page.locator(`#hourly [data-time="${sunrise.time}"]`).count()){
   await page.locator(`#hourly [data-time="${sunrise.time}"]`).click();
   const c=thermalComfort({...sunrise.inputs,condition:sunrise.condition},f.location,Date.parse(sunrise.time));
   assert.equal((await page.locator('.sun-person figcaption strong').innerText()).trim(),Math.round(c.rawOutdoors)+'°');
   assert.equal((await page.locator('.solar-impact').innerText()).trim(),solarEffectText(c));
   if(name==='knightdale')assert.match(await page.locator('.solar-impact').innerText(),/less than 1°/);
  }
  const geometry=await page.locator('#daily .day-high').evaluateAll(cols=>cols.map(col=>{const a=col.querySelector(':scope>strong').getBoundingClientRect(),b=col.querySelector('.daily-feels b').getBoundingClientRect();return {difference:Math.abs(a.x+a.width/2-b.x-b.width/2),text:col.textContent};}));
  assert.equal(geometry.length,7);assert.ok(geometry.every(g=>g.difference<=1),'All seven daytime values remain centered');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(width===390&&name==='knightdale'){
   await page.locator('.today-panel').screenshot({path:dir+'/dans-take.png'});
   await page.locator('.hourly-panel').screenshot({path:dir+'/hourly-source.png'});
   await page.locator('#skin-exposure').screenshot({path:dir+'/sunrise-effect.png'});
   await page.locator('.daily-panel').screenshot({path:dir+'/seven-days.png'});
  }
  report.checks.push({name,width,takeItems:items.length,lateOutlookPreservesTake:true,sourceTransition:transition,centering:geometry,solarEffectVerified:true});
  await context.close();
 }
 assert.deepEqual(report.browserErrors,[]);report.success=true;
}finally{await browser.close();await new Promise(r=>server.close(r));await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({success:report.success,fixture:true,checks:report.checks.length}));
