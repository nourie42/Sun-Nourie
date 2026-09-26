// Local deterministic fixtures only. No production forecasts or AI calls.
import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';
import {fixture} from './weatherNourieFixture.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const now=Date.parse('2026-09-05T12:00:00Z'), H=3600000;
const reportDir=process.env.WEATHER_REPORT_DIR || 'outputs/forecast-window-qa';
await fs.mkdir(reportDir,{recursive:true});

function forecast(qualifying=true) {
  const data=fixture('knightdale',now), series=data.metricForecasts.series;
  data.location.name='Knightdale, NC';
  data.hours=[];data.rainTimeline=[];
  for(const key of ['feels','dewpoint','cloud','gust','temperature','wind','pop','precipitation'])series[key]=[];
  for(let i=0;i<72;i++){
    const time=new Date(now+i*H).toISOString(),end=new Date(now+(i+1)*H).toISOString();
    const perfect=qualifying && i%24>=2 && i%24<=4;
    const thunder=qualifying && i===33;
    const chance=qualifying && [8,9].includes(i)?65:qualifying && i===10?85:thunder?30:10;
    const condition=thunder?'Chance thunderstorms':chance>=60?'Rain':'Mostly Sunny';
    const feels=perfect?72:60, rain=chance>=60?.02:0;
    const hour={time,end,temperature:68,dewpoint:50,skyCover:20,wind:'35 mph',windMph:35,gust:55,feelsLike:feels,isDay:true,condition,rainLikelihood:{value:chance},precipitation:rain,pop:99};
    if(i<48)data.hours.push(hour);
    data.rainTimeline.push({time,end,condition,precipitation:rain,rainLikelihood:{value:chance},officialPop:99});
    series.feels.push({time,value:feels,daylight:true,condition,inputs:{skyCover:20,dewpoint:50,temperature:68,wind:35}});
    for(const [key,value] of Object.entries({dewpoint:50,cloud:20,gust:55,temperature:68,wind:35,pop:chance,precipitation:rain}))series[key].push({time,value});
  }
  data.signature=qualifying?'banner-fixture':'empty-fixture';
  data.assembledAt=new Date(now).toISOString();
  return data;
}

let qualifying=true;
const app=express();
app.get('/api/weather-fusion/forecast',(_req,res)=>res.json(forecast(qualifying)));
app.get('/api/weather-fusion/*',(_req,res)=>res.status(503).json({error:'Optional feed disabled in local fixture'}));
registerWeatherFusionRoutes(app,{fetchImpl:async()=>{throw Error('External sources disabled in fixture');}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const report={success:false,widths:[],errors:[],checks:[]};
try {
  browser=await chromium.launch({headless:true,...(process.env.WEATHER_BROWSER_CHANNEL?{channel:process.env.WEATHER_BROWSER_CHANNEL}:{})});
  for(const width of [320,390,1280]){
    qualifying=true;
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',permissions:['geolocation'],geolocation:{latitude:35.787,longitude:-78.4806}});
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.addInitScript(t=>{Date.now=()=>t;},now);
    await page.route('https://**',r=>r.abort());
    await page.goto(base+'/weather-fusion/experimental-weather.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelectorAll('[data-forecast-window]').length===2);
    assert.equal(await page.locator('#experimental-whats-up-link').count(),0);
    const perfect=page.locator('[data-forecast-window="perfect"]');
    assert.match(await perfect.innerText(),/Today · 10am–1pm · \+2 more/);
    await perfect.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(reportDir,`banners-${width}.png`)});
    await perfect.click();
    await page.waitForFunction(()=>document.querySelector('#forecast-window-dialog').open);
    assert.equal(await page.locator('#forecast-window-dialog .forecast-window-day').count(),3);
    assert.equal(await page.locator('#forecast-window-dialog tbody tr').count(),9,'Every qualifying hour, including beyond the 48h strip');
    assert.ok((await page.locator('#forecast-window-dialog tbody').first().innerText()).includes('72°'));
    assert.equal(await page.locator('#forecast-window-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Dialog fits mobile width');
    assert.equal(await page.locator('.forecast-window-table-wrap').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)),true,'Hourly tables fit without horizontal scrolling');
    await page.screenshot({path:path.join(reportDir,`perfect-${width}.png`)});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#forecast-window-dialog').open);
    assert.equal(await perfect.evaluate(el=>document.activeElement===el),true,'Escape restores focus');
    await page.locator('[data-forecast-window="rain"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#forecast-window-dialog').open);
    const rainText=await page.locator('#forecast-window-content').innerText();
    assert.match(rainText,/Rain likely/);assert.match(rainText,/High rain likelihood/);assert.match(rainText,/Thunderstorms possible/);
    assert.doesNotMatch(rainText,/definite|storm probability/i);
    assert.equal(await page.locator('#forecast-window-dialog tbody tr').count(),4);
    await page.screenshot({path:path.join(reportDir,`rain-${width}.png`)});
    await page.getByRole('button',{name:'Close forecast times',exact:true}).click();
    qualifying=false;
    await page.getByRole('button',{name:'Refresh weather',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#forecast-window-banners').hidden);
    assert.equal(await page.locator('[data-forecast-window]').count(),0,'No empty alert banners');
    qualifying=true;
    await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>/Updated/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#forecast-window-banners').isVisible(),false,'Main page does not display experimental banners');
    assert.equal(await page.locator('[data-forecast-window]').count(),0);
    report.widths.push(width);await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.success=true;
  report.checks=['Both compact banners open all qualifying days and hours','35 mph wind and 55 mph gusts do not block 72°F feels-like','Plain rain and explicit thunder retain separate labels','Escape, Enter and close controls work with focus restoration','No qualifying forecast hides the banners','Experimental-only visibility','320px, 390px and desktop layout without table overflow'];
} finally {
  await fs.writeFile(path.join(reportDir,'report.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(report,null,2));
