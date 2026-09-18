import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base=String(process.env.WEATHER_TODAY_BASE_URL||'https://sun-nourie-live.onrender.com').replace(/\/$/,'');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/weather-fusion/?today-live-smoke='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForSelector('#today-forecast .today-weather-card',{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#today-forecast .today-symbol strong')?.textContent?.includes('%'));

  const api=await page.evaluate(async()=>{
    const response=await fetch('/api/weather-fusion/forecast?location=knightdale&today-live-smoke='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('Forecast API '+response.status);
    return response.json();
  });

  const assembled=Date.parse(api.assembledAt);
  assert.ok(Number.isFinite(assembled),'assembledAt must be present');
  assert.ok(Date.now()-assembled<5*60*1000,'forecast snapshot is more than five minutes old');

  const day=api.days?.[0];
  assert.ok(day,'Today forecast missing');
  const expected=Math.round(day.rainLikelihood?.value);
  assert.ok(Number.isFinite(expected),'remaining-day rain likelihood missing');

  const displayedText=await page.locator('#today-forecast .today-symbol strong').innerText();
  const displayed=Number(displayedText.replace(/[^0-9.-]/g,''));
  assert.equal(displayed,expected,'Today tile does not match the API remaining-day rain chance');

  const name=await page.locator('#today-forecast .day-name').innerText();
  const localHour=await page.evaluate(()=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date()));
  const hour=Number(localHour);
  if(hour>=12&&hour<18)assert.equal(name,'Remainder of Today');

  const feels=await page.locator('#today-forecast .today-feels').boundingBox();
  const metrics=await page.locator('#today-forecast .today-metrics').boundingBox();
  assert.ok(feels&&metrics&&feels.y+feels.height<=metrics.y-2,'Live Today tile covers the feels-like reading');

  assert.ok(await page.locator('#today-forecast [data-rain-trend]').isVisible(),'Live Today tile is missing rain-change status');

  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});
    const f=await page.locator('#today-forecast .today-feels').boundingBox();
    const m=await page.locator('#today-forecast .today-metrics').boundingBox();
    assert.ok(f&&m&&f.y+f.height<=m.y-2,`Live Today tile overlap at ${width}px`);
  }

  console.log(JSON.stringify({
    ok:true,
    assembledAt:api.assembledAt,
    tileLabel:name,
    displayedRainChance:displayed,
    remainingDayRainChance:expected,
    daytimeRainChance:day.popDayLikelihood?.value??null,
    overnightRainChance:day.popNightLikelihood?.value??null,
    peakTime:day.rainLikelihood?.peakTime??null,
    sourceValues:day.rainLikelihood?.peak?.sourceValues??day.rainLikelihood?.sourceValues??null,
    trend:await page.locator('#today-forecast [data-rain-trend]').innerText(),
    checks:['fresh forecast snapshot','tile equals remaining-day API chance','feels-like unobstructed','rain-change status visible','320/390/430 mobile geometry']
  },null,2));
}finally{
  await browser.close();
}
