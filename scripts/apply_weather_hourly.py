"""Exact-match, one-time integration on a feature branch; never runs on main."""
from pathlib import Path

def replace(path,old,new,count=1):
 p=Path(path);text=p.read_text();found=text.count(old)
 if found!=count:raise RuntimeError(f'{path}: expected {count}, found {found}: {old[:100]!r}')
 p.write_text(text.replace(old,new))
def prefix(path,text):
 p=Path(path);p.write_text(text+p.read_text())
def section(path,start,end,new):
 p=Path(path);text=p.read_text();a=text.index(start);b=text.index(end,a)
 if text.count(start)!=1 or text.count(end)!=1:raise RuntimeError(f'{path}: ambiguous boundaries')
 p.write_text(text[:a]+new+text[b:])

app='public/weather-fusion/app.js'
prefix(app,"import {degrees,feelsAt,dayFeelsHTML} from './hourly-feels.js?v=2-hourly';\n")
replace(app,"from './experience.js?v=8-personal'","from './experience.js?v=9-hourly'")
replace(app,"from './personal-details.js?v=1-personal'","from './personal-details.js?v=2-hourly'")
replace(app,"from './bulletins.js?v=1-bulletins'","from './bulletins.js?v=2-special'")
replace(app,"from './dewpoint-meter.js?v=5-compact'","from './dewpoint-meter.js?v=6-future'")
replace(app,"  $('temperature').innerHTML = `${number(hero.temperature)}<span>°</span>`;", """  $('temperature').innerHTML = `${number(hero.temperature)}<span>°</span>`;
  if($('hero-feels'))$('hero-feels').innerHTML=`Feels like <strong>${degrees(data.comfort?.shade)}</strong><small>In the shade · ${c.type==='observation'?'based on the current station reading':'estimated from forecast data'}</small>`;""")
replace(app,"  $('temperature').innerHTML = '—<span>°</span>';", "  $('temperature').innerHTML = '—<span>°</span>';\n  if($('hero-feels'))$('hero-feels').textContent='Feels like —';")
replace(app,'<strong>${temperature(h.temperature)}</strong><small>', '<strong>${temperature(h.temperature)}</strong><span class="hour-feels">Feels like<b>${degrees(feelsAt(data,h.time))}</b></span><small>')
replace(app,'<div class="dialog-stats">','${dayFeelsHTML(forecast,index,p.tonight)}<div class="dialog-stats">')

html='public/weather-fusion/index.html'
replace(html,'app.js?v=8-personal','app.js?v=9-hourly')
replace(html,'  <link rel="stylesheet" href="/weather-fusion/personal-details.css?v=1-personal">','  <link rel="stylesheet" href="/weather-fusion/personal-details.css?v=1-personal">\n  <link rel="stylesheet" href="/weather-fusion/hourly-feels.css?v=2-hourly">')
replace(html,'        <div class="hero-condition"','        <div id="hero-feels" class="hero-feels" aria-live="polite">Feels like —</div>\n        <div class="hero-condition"')
replace(html,'    <p id="chart-note"></p>','    <p id="chart-companion" hidden></p>\n    <p id="chart-note"></p>')

experience='public/weather-fusion/experience.js'
prefix(experience,"import {degrees,feelsAt,dailyFeels,forecastValue,peakFeelsHTML} from './hourly-feels.js?v=2-hourly';\n")
replace(experience,"from './personal-details.js?v=1-personal'","from './personal-details.js?v=2-hourly'")
replace(experience,"from './comfort-outlook.js'","from './comfort-outlook.js?v=2-hourly'")
replace(experience,"from './dewpoint-meter.js'","from './dewpoint-meter.js?v=6-future'")
replace(experience,"${summary?`<p class=\"comfort-later\"><strong>${temp(summary.chosen.value)}</strong> ${summary.label}</p>`:''}","${peakFeelsHTML(summary,forecast.location.timeZone)}")
replace(experience,'  const p=dailyDisplay(d,i,Date.now(),forecast.location.timeZone),bar=temperatureBar(p.primary,lo,hi);','  const p=dailyDisplay(d,i,Date.now(),forecast.location.timeZone),bar=temperatureBar(p.primary,lo,hi),feel=dailyFeels(forecast,i,Date.now());')
replace(experience,'<small>${p.primaryLabel}</small></span><span class="temp-track"','<small>${p.primaryLabel}</small><span class="daily-feels">Feels ${degrees(p.tonight?feel.low?.low?.value:feel.high?.high?.value)}${(p.tonight?feel.low:feel.high)?.partial?\' · partial\':\'\'}</span></span><span class="temp-track"')
replace(experience,'${temp(p.secondary)}<small>Low</small></span>','${temp(p.secondary)}<small>Low</small><span class="daily-feels">Feels ${degrees(feel.low?.low?.value)}${feel.low?.partial?\' · partial\':\'\'}</span></span>')
replace(experience," $('chart-time').textContent=formatTime(p.time,{weekday:'short',month:'short',day:'numeric'});", """ $('chart-time').textContent=formatTime(p.time,{weekday:'short',month:'short',day:'numeric'});
 const companion=$('chart-companion');
 if(companion){companion.hidden=!['temperature','feels'].includes(active);companion.textContent=active==='temperature'?`Feels like ${degrees(feelsAt(data,p.time))} in the shade at this hour`:active==='feels'?`Air temperature ${degrees(forecastValue(data,'temperature',p.time))} at this hour`:'';}""")
replace(experience," else {$('chart-value').textContent='Not available';", " else {if($('chart-companion')){$('chart-companion').hidden=true;$('chart-companion').textContent='';}$('chart-value').textContent='Not available';")

personal='public/weather-fusion/personal-details.js'
replace(personal,"import {dewpointGrossLevel} from './dewpoint-meter.js';","import {forecastGrossLevel} from './dewpoint-meter.js?v=6-future';\nimport {exposureScene} from './exposure-scene.js?v=2-wave';")
replace(personal,'level:dewpointGrossLevel(peak.value,wind)','level:forecastGrossLevel(peak.value,wind)')
section(personal,'function person(){','export function sunShadeHTML','')
replace(personal,'scene(false,daylight)','exposureScene(false,daylight)')
replace(personal,'scene(true,daylight)','exposureScene(true,daylight)')

meter='public/weather-fusion/dewpoint-meter.js'
replace(meter,'export function dewpointPoints', '''export function forecastGrossLevel(dewpoint,wind=0){
 const level=dewpointGrossLevel(dewpoint,wind);
 const labels={dry:'It will feel very dry',nice:'It should feel pretty comfortable','nice-breeze':'The breeze should make it feel comfortable',humid:'It will feel a bit humid',gross:'It will feel a bit gross',nogo:'It will feel very muggy',nope:'It will feel extremely muggy',unknown:'The dew-point forecast is unavailable'};
 return {...level,label:labels[level.key]||labels.unknown};
}
export function dewpointPoints''')
replace(meter,'const v=dewpointGrossLevel(p.value,pairedWind(forecast,p.time));','const v=forecastGrossLevel(p.value,pairedWind(forecast,p.time));')

backend='src/weatherFusionExperience.js'
prefix(backend,"import {rebuildHourlyFeels} from './weatherFusionHourlyFeels.js';\n")
replace(backend,"humidity:source(h.humidity,'Consistent forecast temperature + dew point')","humidity:source(humidity,'Consistent forecast temperature + dew point')")
replace(backend,' return out;', ''' rebuildHourlyFeels(out,{now,periods,
  temperatureAt:epoch=>mix(gridSample(grid,'temperature',epoch,'temperature'),epoch,'temperature_2m'),
  humidityAt:epoch=>gridSample(grid,'relativeHumidity',epoch,'percent')});
 return out;''')

server='src/weatherFusion.js'
prefix(server,"import {createSpecialDiscussionService} from './weatherFusionSpecialDiscussions.js';\n")
replace(server,'observation, alerts, models, feeds, now })','observation, alerts, specialDiscussions, models, feeds, now })')
replace(server,'discussion: discussion || null, alerts: alerts || [], feeds,','discussion: discussion || null, alerts: alerts || [], specialDiscussions: specialDiscussions || [], feeds,')
replace(server,"'api.openai.com'];","'api.openai.com', 'mapservices.weather.noaa.gov', 'www.spc.noaa.gov'];")
replace(server,'  async function getForecast(query) {','  const loadSpecialDiscussions=createSpecialDiscussionService({cached,now});\n  async function getForecast(query) {')
replace(server,"        hrrr: loadModel('hrrr', location),","        specialDiscussions: loadSpecialDiscussions(location),\n        hrrr: loadModel('hrrr', location),")
replace(server,'hours, discussion,\n    precipitation:','hours, discussion, specialDiscussions:output.specialDiscussions,\n    precipitation:')
replace(server,"'current-temperature.js']) app.get", "'current-temperature.js','hourly-feels.js','hourly-feels.css','exposure-scene.js']) app.get")

bulletins='public/weather-fusion/bulletins.js'
replace(bulletins,"from './bulletin-facts.js'","from './bulletin-facts.js?v=2-special'")
replace(bulletins,"f.id==='afd'","f.id==='special-discussions'")
replace(bulletins,'The local NWS discussion is unavailable or stale.','The special-discussion feed is unavailable or stale. Routine forecast discussions are not listed here.')
replace(bulletins,'regional discussion','special weather discussion',2)
replace(bulletins,'NWS regional discussion','NWS special discussion')
replace(bulletins,'Issued ${esc(time(item.issuedAt))}',"${item.kind==='discussion'?'Valid from':'Issued'} ${esc(time(item.issuedAt))}")

ai='src/weatherFusionBulletins.js'
replace(ai,'A forecast-office discussion is regional context, not a point warning.','A special mesoscale discussion describes a developing hazard in the supplied area, not an official warning. Do not summarize routine Area Forecast Discussions.')

scene='public/weather-fusion/exposure-scene.js'
replace(scene,'A smiling person with eyes and hair waving in the sunshine','A person in direct sunlight, smiling with eyes and hair and waving')
replace(scene,'A smiling person with eyes and hair waving beneath a tall shade tree','A person standing in the shade of a tall tree, smiling with eyes and hair and waving')

narrative='public/weather-fusion/comfort-outlook.js'
replace(narrative,'That forecast is not being forced above the current reading; changing humidity and wind can offset warmer air.','Changing humidity and wind can offset warmer air, so the feels-like and air-temperature peaks may occur at different times.')

# Maintain legacy test coverage while updating intentionally changed expectations.
for path in Path('test').glob('weatherFusion*.test.js'):
 text=path.read_text()
 if "'warmest today'" in text:path.write_text(text.replace("'warmest today'","'Forecast feels-like peak ahead'"))

oldtest='test/weatherFusionPersonalDetails.test.js'
replace(oldtest,"const source=()=>({signature:'s1',location,alerts:","const source=()=>({signature:'s1',location,specialDiscussions:[{id:'https://www.spc.noaa.gov/products/md/md2000.html',url:'https://www.spc.noaa.gov/products/md/md2000.html',event:'SPC special weather discussion',productType:'SPC-MD',applicable:true,sent:'2026-09-06T12:00:00Z',expires:'2026-09-06T16:00:00Z',description:'Rain may become heavy.',areaDesc:'Regional special discussion covering this point; not a warning.'}],alerts:")
replace(oldtest,"f.discussion.issuanceTime='2026-09-04T12:00:00Z';assert.equal(bulletinFacts(f,now).length,1);","f.specialDiscussions[0].expires='2026-09-06T12:00:00Z';assert.equal(bulletinFacts(f,now).length,1);assert.ok(bulletinFacts(f,now).every(i=>!i.title.includes('forecast discussion')));")
replace(oldtest,"test('stale regional discussion is not represented as current'","test('expired special discussion is removed and routine AFD never listed'")

browser='scripts/weatherFusionPersonalBrowser.js'
prefix(browser,"import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';\nimport {thermalComfort,shadeFeelsLike} from '../public/weather-fusion/weather-math.js';\nimport {feelsAt,dailyFeels} from '../public/weather-fusion/hourly-feels.js';\n")
replace(browser," return {signature:place+'-personal-fixture'"," const result={signature:place+'-personal-fixture'")
replace(browser,"};\n}\nconst app=express();", """};
 result.specialDiscussions=[{id:'https://www.spc.noaa.gov/products/md/md2000.html',url:'https://www.spc.noaa.gov/products/md/md2000.html',event:'SPC special weather discussion',productType:'SPC-MD',applicable:true,sent:new Date(epoch-H).toISOString(),expires:new Date(epoch+12*H).toISOString(),areaDesc:'Special discussion covering this location',description:'Heavy rain may develop.'}];
 result.feeds.push({id:'special-discussions',status:'ready'});
 result.comfort=thermalComfort(result.current,result.location,epoch);
 rebuildHourlyFeels(result,{now:epoch,temperatureAt:()=>({value:null}),humidityAt:()=>null});
 return result;
}
const app=express();""")
replace(browser,"assert.match(await page.locator('.sun-shade-comparison').innerText(),/84°/)","assert.ok((await page.locator('.sun-shade-comparison').innerText()).includes(fixture().comfort.sun+'°'))")
replace(browser,'  report.checks.push({width,...layout,', '''  assert.match(await page.locator('#hero-feels').innerText(),new RegExp('Feels like '+fixture('greenville').comfort.shade+'°'));
  const activeFixture=fixture('greenville');
  const hourlyLabels=await page.locator('#hourly .hour-feels b').allTextContents();
  assert.deepEqual(hourlyLabels,activeFixture.hours.map(h=>Math.round(feelsAt(activeFixture,h.time))+'°'));
  assert.equal(await page.locator('#daily .daily-feels').count(),14);
  assert.ok(!(await page.locator('#alerts').innerText()).includes('forecast discussion'));
  assert.equal(await page.locator('.person-eyes').count(),2);
  assert.equal(await page.locator('.friendly-wave').count(),2);
  assert.ok(await page.locator('.exposure-tree').evaluate(el=>el.getBBox().height>el.closest('svg').querySelector('.exposure-person-art').getBBox().height*1.5));
  await page.locator('#daily [data-day="2"]').click();
  assert.equal(await page.locator('#day-dialog .day-feels').count(),1);
  assert.match(await page.locator('#day-dialog .day-gross-verdict').innerText(),/will|should/);
  assert.ok(!(await page.locator('#day-dialog .day-gross-verdict').innerText()).includes('gettin'));
  await page.keyboard.press('Escape');
  await page.locator('#temperature').click();
  await page.locator('#chart-scrubber').fill('6');
  assert.match(await page.locator('#chart-companion').innerText(),new RegExp(Math.round(feelsAt(activeFixture,activeFixture.metricForecasts.series.temperature[6].time))+'°'));
  await page.keyboard.press('Escape');
  report.checks.push({width,...layout,pairedHourly:true,futureTense:true,wavingFaces:true,tallTree:true,''')

smoke='scripts/weatherFusionBrowserSmoke.js'
replace(smoke,"const paths=['personal-details.js'", "const paths=['hourly-feels.js','hourly-feels.css','exposure-scene.js','personal-details.js'")
replace(smoke,"if(data.discussion||data.alerts.length)assert.equal(bulletins.mode,'ai',JSON.stringify(bulletins));", "if(data.alerts.length||data.specialDiscussions?.length)assert.equal(bulletins.mode,'ai',JSON.stringify(bulletins));")
replace(smoke," return details;", """ assert.match(await page.locator('#hero-feels').innerText(),/Feels like/);
 assert.equal(await page.locator('#hourly .hour-feels').count(),await page.locator('#hourly .hour').count());
 assert.equal(await page.locator('.person-eyes').count(),2);
 assert.equal(await page.locator('.friendly-wave').count(),2);
 assert.ok(!(await page.locator('#alerts').textContent()).includes('forecast discussion'));
 return details;""")
replace(smoke," assert.equal(data.version,'weather-fusion-v2-direct');", """ assert.equal(data.version,'weather-fusion-v2-direct');
 assert.equal(data.thermalVersion,'weather-nourie-hourly-feels-v2');
 for(const h of data.hours){const p=data.metricForecasts.series.feels.find(p=>Date.parse(p.time)===Date.parse(h.time));assert.ok(p,'Missing paired hourly row');assert.equal(h.feelsLike,p.value);assert.equal(p.inputs.temperature,h.temperature);}
""")
print('Applied hour-matched temperatures, future wording, special-only discussions and waving figures.')
