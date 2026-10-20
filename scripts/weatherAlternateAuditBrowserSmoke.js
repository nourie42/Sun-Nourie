/** Local browser replay for alternate layouts; no production authentication or writes. */
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildUltimateCurrent} from '../public/weather-fusion/ultimate.js';
const root=process.cwd(),fixturePath=process.env.WEATHER_AUDIT_FIXTURE;
if(!fixturePath)throw new Error('Set WEATHER_AUDIT_FIXTURE to a captured Weather Nourie forecast payload.');
const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8')),now=Date.parse(fixture.assembledAt),out=process.env.WEATHER_ALTERNATE_PROOF_DIR||'/tmp/weather-alternate-audit-proof';await fs.mkdir(out,{recursive:true});
let payload=fixture,failForecast=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/api/weather-fusion/forecast'){if(failForecast){res.writeHead(503).end('{}');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));return;}const target=path.resolve(root,'public','.'+u.pathname);if(!target.startsWith(path.resolve(root,'public')+path.sep)){res.writeHead(404).end();return;}const body=await fs.readFile(target);res.setHeader('Content-Type',({'html':'text/html','js':'text/javascript','css':'text/css','json':'application/json','webp':'image/webp','svg':'image/svg+xml'})[path.extname(target).slice(1)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});const checks=[],errors=[];
try{
 for(const name of ['today','glance','blend','ultimate','halo']){
  payload=fixture;failForecast=false;const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',reducedMotion:'reduce'}),page=await context.newPage();
  await page.clock.install({time:now});page.on('pageerror',error=>errors.push({name,error:error.message}));
  await page.route('https://**/*',route=>route.fulfill({status:503,body:'{}'}));
  await page.goto(`${base}/weather-fusion/${name}.html`,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#now-temp')?.textContent.match(/[0-9]/));
  const current=buildUltimateCurrent(fixture,now),high=Math.round(current.days[0].high),low=Math.round(current.days[0].low);
  assert.match(await page.locator('#now-hilo').innerText(),new RegExp(`H[: ]${high}°.*L[: ]${low}°`));
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).slice(0,8).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))}));if(overflow.scroll>overflow.width+1){await page.screenshot({path:path.join(out,name+'-overflow.png')});console.log(JSON.stringify({name,overflow}));}assert.ok(overflow.scroll<=overflow.width+1,name+' mobile overflow');
  if(name==='ultimate'){
   assert.match(await page.locator('#metric-grid').innerText(),/UV now\s*0/i);assert.match(await page.locator('#metric-grid').innerText(),/Peak today 5/);
   assert.match(await page.locator('#detail-list').textContent(),/Air quality30/);
  }
  await page.locator('#now-hilo').screenshot({path:path.join(out,`${name}-calendar.png`)});
  if(name!=='blend'){
   payload=structuredClone(fixture);const missing=Math.floor(now/3600000)*3600000+3*3600000;
   for(const key of ['hours','rainTimeline'])payload[key]=(payload[key]||[]).filter(row=>Date.parse(row.time)!==missing).map(row=>({...row,rainLikelihood:{...row.rainLikelihood,value:0}}));
   await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#now-temp')?.textContent.match(/[0-9]/));
   const selector=({today:'#rain-note',glance:'#rain-text',ultimate:'#hourly-desc',halo:'#hourly-summary'})[name];
   assert.match(await page.locator(selector).innerText(),/unavailable|incomplete/i,name+' missing rain hour cannot imply dry weather');
   if(name==='ultimate'&&await page.locator('#insight-row').count())assert.match(await page.locator('#insight-row').innerText(),/Rain outlook unavailable/);
  }
  failForecast=true;await page.clock.fastForward(3*3600000);await page.waitForTimeout(100);
  assert.match(await page.locator('#now-temp').innerText(),/—|--/);assert.doesNotMatch(await page.locator('#now-temp').innerText(),/[0-9]/);
  if(name==='ultimate')assert.match(await page.locator('#detail-list').textContent(),/Air quality—/);
  checks.push(`${name}: matching calendar high/low, mobile layout, ${name==='blend'?'':'missing rain-hour guard, '}and expired current data after failed refresh`);
  await context.close();
 }
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({success:true,checks,errors},null,2));console.log(JSON.stringify({success:true,checks,errors},null,2));
}catch(error){await fs.writeFile(path.join(out,'report.json'),JSON.stringify({success:false,checks,errors,error:error.stack},null,2));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
