import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base='https://sun-nourie-live.onrender.com';
const dir='/tmp/weather-comparison-live';
await fs.mkdir(dir,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function response(path){
 return fetch(base+path,{signal:AbortSignal.timeout(30000),cache:'no-store',headers:{'Cache-Control':'no-cache'}});
}

let deployed=false;
for(let i=0;i<60;i++){
 try{
  const page=await response('/weathernext/?location=knightdale&deploy-check='+Date.now());
  const html=page.ok?await page.text():'';
  const script=await response('/weather-fusion/compare/app.js?source=google&location=knightdale&deploy-check='+Date.now());
  const js=script.ok?await script.text():'';
  if(page.status===200&&script.status===200&&html.includes('Experimental NVIDIA AI Weather')&&html.includes('/weather-fusion/compare/app.js?source=google')&&js.includes('compareBridge.requestForecast')&&js.includes('installComparisonPane')){
   deployed=true;
   break;
  }
 }catch{}
 await delay(10000);
}
assert.ok(deployed,'Render did not serve the repaired Google WeatherNext dashboard and generated browser script in time.');

const responseLocations=await response('/api/weather-fusion/compare/locations');
assert.equal(responseLocations.status,200);
const {points}=await responseLocations.json();
assert.ok(points.length>0);
const point=points.find(p=>p.id==='knightdale')||points[0];

const dataResponse=await response('/api/weather-fusion/compare/google?location='+encodeURIComponent(point.id));
assert.equal(dataResponse.status,200);
const data=await dataResponse.json();
assert.equal(data.comparison.source,'google');
assert.ok(data.hours.some(h=>Date.parse(h.time)>=Date.now()&&Number.isFinite(h.temperature)));
assert.ok(data.feeds.every(f=>f.id.startsWith('google-')));

const browser=await chromium.launch({headless:true});
const report={deployed:true,liveData:true,point:point.id,runs:data.comparison.runs,viewports:[],deviceCoordinates:false};

async function waitForGoogle(page){
 await page.waitForFunction(()=>{
   const temp=document.querySelector('#temperature')?.textContent?.trim()||'';
   const status=document.querySelector('#status')?.textContent||'';
   return /\d/.test(temp)&&!temp.includes('—')&&!/Connecting to weather sources|Getting device location/i.test(status);
 },null,{timeout:90000});
}

try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/weathernext/?location='+encodeURIComponent(point.id)+'&browser-check='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await waitForGoogle(page);
  assert.match(await page.locator('#city-name').innerText(),/Knightdale|Raleigh/i);
  assert.match(await page.locator('#temperature').innerText(),/\d/);
  assert.equal(await page.locator('.weather-jump-nav a').count(),5);
  assert.equal(await page.locator('#refresh').isEnabled(),true);
  assert.match(await page.locator('.forecast-compare-banner').innerText(),/Back to Dan/i);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#refresh').click();
  await waitForGoogle(page);
  await page.screenshot({path:`${dir}/live-google-${width}.png`,fullPage:false});
  assert.deepEqual(errors,[]);
  report.viewports.push(width);
  await context.close();
 }

 const context=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/weathernext/?latitude=35.7798&longitude=-78.5355&device-check='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
 await waitForGoogle(page);
 assert.match(await page.locator('#city-name').innerText(),/Knightdale|Raleigh/i);
 assert.match(await page.locator('#temperature').innerText(),/\d/);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:`${dir}/live-google-device-knightdale.png`,fullPage:false});
 report.deviceCoordinates=true;
 await context.close();
}finally{
 await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));
 await browser.close();
}
console.log('Live verification: the Google WeatherNext page loads data, responds to controls, and the user\'s Knightdale device coordinates resolve to the published local Google point.');
console.log(JSON.stringify(report,null,2));
