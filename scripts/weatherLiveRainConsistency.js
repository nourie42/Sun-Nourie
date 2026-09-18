import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base=String(process.env.WEATHER_TODAY_BASE_URL||'https://sun-nourie-live.onrender.com').replace(/\/$/,'');
const radarResponse=await fetch(base+'/api/weather-fusion/radar?location=knightdale&live-rain='+Date.now(),{cache:'no-store'});
assert.equal(radarResponse.ok,true,'Live radar API failed: '+radarResponse.status);
const radar=await radarResponse.json();
const precipitation=radar.precipitation||{};
assert.equal(radar.status,'ready','Live radar must have a current NOAA frame');
assert.equal(radar.detectionSource,'noaa-arcgis-mrms','Current-rain detection must use the NOAA ArcGIS MRMS service');
assert.equal(precipitation.status,'ready','Current precipitation detection must be available');
assert.ok(Number.isFinite(Date.parse(precipitation.observedAt))&&Date.now()-Date.parse(precipitation.observedAt)<20*60*1000,'Live radar observation is stale or missing');

const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(base+'/weather-fusion/?live-rain='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForSelector('#hourly .hour-current',{timeout:60000});
  // Let the separate live-radar request finish and re-render the page.
  await page.waitForTimeout(3500);

  const condition=(await page.locator('#condition').innerText()).trim();
  const source=(await page.locator('#observation-label').innerText()).trim();
  const nowCard=(await page.locator('#hourly .hour-current').innerText()).trim();
  const scenes=await page.locator('#skin-exposure svg.reference-scene').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-scene')));
  const outdoorLabel=await page.locator('#skin-exposure .sun-person .exposure-label').innerText();

  const exact=precipitation.status==='ready'&&precipitation.atLocation===true;
  const close=precipitation.status==='ready'&&(precipitation.close===true||(Number.isFinite(precipitation.nearestRainMiles)&&precipitation.nearestRainMiles<=5));
  if(exact){
    assert.equal(condition,'Rain now');
    assert.match(source,/Rain now · observed radar over this location/);
    assert.match(nowCard,/Rain now/);
    assert.ok(scenes.length>=3&&scenes.every(scene=>scene==='rain'),'All current comfort scenes must be rain when radar is over the point');
    assert.equal(outdoorLabel,'Rain');
  }else if(close){
    assert.equal(condition,'Rain Around');
    assert.match(source,/Rain Around/);
    assert.ok(scenes.length>=3&&scenes.every(scene=>scene==='rain'),'All current comfort scenes must be rain when radar is within 5 miles');
    assert.equal(outdoorLabel,'Rain');
  }

  console.log(JSON.stringify({
    ok:true,
    radarStatus:radar.status,
    precipitation,
    page:{condition,source,nowCard,outdoorLabel,scenes},
    assertionMode:exact?'exact-point-rain':close?'rain-within-5-miles':'no-current-point-rain-to-assert'
  },null,2));
}finally{
  await browser.close();
}
