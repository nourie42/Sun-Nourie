/** Real touch/mouse regression for repeatable model-chart tooltip dismissal. */
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=process.env.WEATHER_TOOLTIP_PROOF_DIR||'/tmp/weather-model-tooltip-proof';
await fs.mkdir(out,{recursive:true});
const now=Date.parse('2026-09-05T22:00:00Z'),forecast=fixture('knightdale',now);
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#14233f;color:white;font-family:sans-serif}.hero{height:16px}button{padding:8px}#after-chart{height:1600px}</style></head><body><button id="outside">Outside graph</button><div class="hero"></div><button id="open-compare">Model comparison</button><div id="after-chart"></div><script type="module" src="/weather-fusion/wn-blend.js"></script></body></html>';
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
 if(url.pathname==='/api/weather-fusion/forecast'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(forecast));return;}
 const file=path.resolve(root,'public',decodeURIComponent(url.pathname).replace(/^\//,''));
 if(!file.startsWith(path.join(root,'public')+'/')){res.writeHead(403);res.end();return;}
 try{const body=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
await context.route('https://raw.githubusercontent.com/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
await context.addInitScript(value=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[value]));}static now(){return value;}};},now);
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const base=`http://127.0.0.1:${server.address().port}`;
const tip=page.locator('#wn-compare-chart .wn-tip');
async function point(index){
 return page.locator('#wn-compare-chart svg').evaluate((svg,i)=>{
  const dot=svg.querySelector(`[data-series="nourie"][data-index="${i}"]`),r=svg.getBoundingClientRect();
  return {x:r.left+Number(dot.getAttribute('cx'))*r.width/svg.viewBox.baseVal.width,y:r.bottom-48};
 },index);
}
async function tapPoint(index){const p=await point(index);await page.touchscreen.tap(p.x,p.y);}
async function visible(){await page.waitForFunction(()=>document.querySelector('#wn-compare-chart .wn-tip')?.style.display==='block');}
async function hidden(){await page.waitForFunction(()=>document.querySelector('#wn-compare-chart .wn-tip')?.style.display==='none');}
async function resetScroll(){
 // A real touch release can continue scrolling through Chromium's compositor.
 // Wait for that fling to finish before resetting the next interaction's view.
 await page.evaluate(()=>new Promise(resolve=>{
  let previous=scrollY,stable=0;
  const tick=()=>{stable=scrollY===previous?stable+1:0;previous=scrollY;if(stable>=8)resolve();else requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
 }));
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 await page.waitForFunction(()=>Math.abs(scrollY)<1);
}
async function drag(from,to){
 const session=await context.newCDPSession(page);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
 for(let step=1;step<=8;step++){
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*step/8,y:from.y+(to.y-from.y)*step/8}]});
  await page.waitForTimeout(16);
 }
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await session.detach();
}
const report={fixtureClock:new Date(now).toISOString(),checks,errors};
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#wn-compare-chart svg',{state:'attached'});
 await page.locator('#open-compare').tap();await page.waitForSelector('#wn-compare-chart svg');
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 await page.waitForTimeout(400);
 await page.evaluate(()=>{
  globalThis.tooltipEventTrace=[];
  for(const type of ['pointerdown','pointermove','pointerup','pointerleave','pointercancel','scroll'])document.addEventListener(type,event=>{
   const entry={type,pointerType:event.pointerType,target:event.target?.classList?.value};
   queueMicrotask(()=>{entry.visible=document.querySelector('.wn-tip')?.style.display;tooltipEventTrace.push(entry);});
  },true);
 });
 // The original once:true listener was consumed by the first graph tap.
 for(let cycle=0;cycle<3;cycle++){
  await tapPoint(1);await visible();await page.locator('#outside').tap();await hidden();
 }
 checks.push('touch show/outside dismiss works for three consecutive cycles');
 await tapPoint(1);await visible();await tapPoint(1);await hidden();
 checks.push('tapping the selected day toggles the tooltip off');
 await tapPoint(1);await visible();const first=await tip.innerText();await tapPoint(2);await visible();assert.notEqual(await tip.innerText(),first);
 checks.push('tapping a different day updates its model values');
 await page.locator('.wn-tip-close').tap();await hidden();
 checks.push('explicit close control dismisses the touch tooltip');
 await tapPoint(1);await visible();await page.keyboard.press('Escape');await hidden();
 checks.push('Escape dismisses the tooltip');
 await tapPoint(1);await visible();await page.evaluate(()=>window.scrollBy(0,80));await hidden();
 await resetScroll();
 checks.push('page scrolling dismisses the tooltip');
 const from=await point(0),to=await point(3);await drag(from,to);await visible();
 const scrubbed=await tip.innerText();await tapPoint(0);await visible();assert.notEqual(await tip.innerText(),scrubbed);
 checks.push('horizontal touch drag scrubs the selected day');
 await drag(await point(2),{...(await point(2)),y:(await point(2)).y-120});await hidden();
 await resetScroll();
 checks.push('vertical touch scrolling dismisses instead of trapping the page');
 await tapPoint(1);await visible();
 await page.locator('#wn-compare-chart svg').dispatchEvent('pointercancel',{pointerType:'touch',pointerId:44});await hidden();
 checks.push('a cancelled touch clears the tooltip');
 await page.evaluate(()=>globalThis.previousTooltipController=document.querySelector('#wn-compare-chart')._wnTooltipAbort);
 await page.locator('#wn-compare-chart button.wn-chip').first().tap();
 assert.equal(await page.evaluate(()=>previousTooltipController.signal.aborted),true);
 assert.equal(await page.evaluate(()=>document.querySelector('#wn-compare-chart')._wnTooltipAbort.signal.aborted),false);
 for(let cycle=0;cycle<2;cycle++){await tapPoint(1);await visible();await page.locator('#outside').tap();await hidden();}
 checks.push('rerender aborts old handlers and preserves repeated touch dismissal');
 const mousePoint=await point(2);await page.mouse.move(mousePoint.x,mousePoint.y);await visible();await page.mouse.move(2,2);await hidden();
 checks.push('mouse hover and leaving the graph retain their usual behavior');
 await tapPoint(1);await visible();
 await page.locator('#wn-compare-chart').screenshot({path:path.join(out,'model-tooltip-touch-open.png')});
 await page.locator('.wn-tip-close').tap();await hidden();
 await page.locator('#wn-compare-chart').screenshot({path:path.join(out,'model-tooltip-touch-dismissed.png')});
 assert.deepEqual(errors,[]);report.success=true;
}catch(error){report.error=error.stack;report.eventTrace=await page.evaluate(()=>globalThis.tooltipEventTrace);await page.screenshot({path:path.join(out,'model-tooltip-failure.png'),fullPage:true});throw error;}
finally{await fs.writeFile(path.join(out,'model-tooltip-browser-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(report,null,2));
