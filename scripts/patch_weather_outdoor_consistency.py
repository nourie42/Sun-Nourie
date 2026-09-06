from pathlib import Path
import re

ROOT=Path('.')
def change(path, old, new, count=1):
    p=ROOT/path
    text=p.read_text()
    if text.count(old)!=count:
        raise RuntimeError(f'{path}: expected {count} exact anchors, found {text.count(old)}: {old[:100]}')
    p.write_text(text.replace(old,new))

p=ROOT/'public/weather-fusion/outdoor-feels.js'
assert not p.exists()
p.write_text('''import {finite} from './weather-math.js';
export const OUTDOOR_FEELS_VERSION = 'weather-nourie-outdoor-v1';
/** One exposure contract for every primary feels-like reading. The existing
 * thermal model is unchanged; shade is a separately named comparison, never
 * silently substituted for a valid outdoor result. Explicit missing stays missing.
 */
export function outdoorExposure(comfort = {}) {
  const day = comfort.daylight;
  const kind = comfort.weatherKind || 'unknown';
  const condition = comfort.condition || '';
  const chance = /chance|possible|isolated|scattered (?:showers|storms)/i.test(condition);
  const labels = {
    clear:['In direct sun','In sun'],
    'partly-cloudy':['During sunny breaks','Sunny breaks'],
    cloudy:['Under clouds','Under clouds'],
    rain:chance?['Rain possible','Rain possible']:['In rainy weather','In rain'],
    storm:chance?['Storms possible','Storms possible']:['In stormy weather','In storms'],
    snow:['In snowy weather','In snow'], fog:['In fog or haze','In fog'],
    unknown:['Outdoors · shade estimate only','Shade estimate']
  };
  const [label,shortLabel] = day === false ? ['Outdoors at night','At night'] : (labels[kind] || labels.unknown);
  const candidate = Object.hasOwn(comfort,'outdoors') ? comfort.outdoors
    : day && ['clear','partly-cloudy'].includes(kind) && finite(comfort.sun) ? comfort.sun : comfort.shade;
  return {value:finite(candidate)?candidate:null,label,shortLabel,basis:'outdoors'};
}
''')

path='src/weatherFusionHourlyFeels.js'
change(path,"const H=3600000", "import {OUTDOOR_FEELS_VERSION} from '../public/weather-fusion/outdoor-feels.js';\nconst H=3600000")
change(path,'const temperatures=[],feels=[],suns=[],humidities=[],dewpoints=[];','const temperatures=[],feels=[],shades=[],suns=[],humidities=[],dewpoints=[];')
change(path,"const estimate=tier3FeelsLike({...inputs,condition,type:'guidance'},out.location,epoch,'shade');", "const estimate=tier3FeelsLike({...inputs,condition,type:'guidance'},out.location,epoch,'outdoors');\n  const shade=tier3FeelsLike({...inputs,condition,type:'guidance'},out.location,epoch,'shade');")
change(path,"feels.push({time,value,inputs,source:estimate.method,alignmentFactor:0,rawInputs:inputs});\n  suns.push({time,value:sun.sun,inputs,source:'Estimated direct-sun apparent temperature at this forecast hour',daylight:sun.daylight});\n  if(hour){hour.feelsLike=value;hour.feelsLikeSun=sun.sun;hour.feelsLikeInputs=inputs;hour.apparent=value;}", "const shadeValue=round(shade.value),sunValue=finite(sun.sun)?value:null;\n  feels.push({time,value,inputs,condition,exposure:'outdoors',shadeValue,sunValue,daylight:sun.daylight,weatherKind:sun.weatherKind,source:estimate.method,alignmentFactor:0,rawInputs:inputs});\n  shades.push({time,value:shadeValue,inputs,condition,exposure:'shade',source:shade.method});\n  suns.push({time,value:sunValue,inputs,source:'Estimated sun-exposed apparent temperature at this forecast hour',daylight:sun.daylight});\n  if(hour){hour.feelsLike=value;hour.feelsLikeShade=shadeValue;hour.feelsLikeSun=sunValue;hour.feelsLikeExposure='outdoors';hour.feelsLikeInputs=inputs;hour.apparent=value;}")
change(path,'series.feels=feels;series.feelsSun=suns;', 'series.feels=feels;series.feelsShade=shades;series.feelsSun=suns;')
change(path,'One timestamp-matched all-weather shade estimate per hour.', 'One timestamp-matched outdoor exposure estimate per hour, including the same sky and sunlight estimate shown by the outdoor figure. Shade is retained separately in feelsShade.')
change(path,"out.humidFeelsVersion='weather-nourie-humid-v1';", "out.outdoorFeelsVersion=OUTDOOR_FEELS_VERSION;\n if(out.current){\n  out.comfort=out.comfort||thermalComfort(out.current,out.location,now);\n  out.current.feelsLike=out.comfort.outdoors;out.current.feelsLikeShade=out.comfort.shade;\n  out.current.feelsLikeSun=out.comfort.sun;out.current.feelsLikeExposure='outdoors';\n }\n out.humidFeelsVersion='weather-nourie-humid-v1';")

path='public/weather-fusion/weather-display.js'
change(path,"import {weatherState}", "import {outdoorExposure} from './outdoor-feels.js';\nimport {weatherState}")
change(path,'feels:comfort.shade, comfort,', 'feels:outdoorExposure(comfort).value, exposure:outdoorExposure(comfort), comfort,')
change(path,"const inputs = {...point.inputs, condition:hour.condition || 'Sky conditions unavailable', type:'guidance'};\n  const comfort = {...thermalComfort(inputs, forecast.location, epoch), shade:point.value};\n  if (comfort.radiationStatus !== 'estimated') comfort.outdoors = point.value;", "const inputs = {...point.inputs, condition:hour.condition || point.condition || 'Sky conditions unavailable', type:'guidance'};\n  const estimated = thermalComfort(inputs, forecast.location, epoch);\n  // The API series is canonical. Never overwrite outdoors with shade, or let\n  // the illustration independently recalculate a different displayed number.\n  const comfort = {...estimated,outdoors:point.value,\n    shade:Object.hasOwn(point,'shadeValue')?point.shadeValue:estimated.shade,\n    sun:estimated.daylight && ['clear','partly-cloudy'].includes(estimated.weatherKind)?point.value:null};")
change(path,'condition:inputs.condition, isDay:comfort.daylight, comfort, inputs,', 'condition:inputs.condition, isDay:comfort.daylight, exposure:outdoorExposure(comfort), comfort, inputs,')
change(path,'feels like ${degrees(sample.feels)}. Preview this weather.', 'feels like ${degrees(sample.feels)} ${esc(sample.exposure.label.toLowerCase())}. Preview this weather.')
change(path,'Feels like<b>${degrees(sample.feels)}</b></span>', 'Feels like<b>${degrees(sample.feels)}</b><em class="hour-exposure">${esc(sample.exposure.shortLabel)}</em></span>')
change(path,'feels like ${degrees(sample.feels)} in the shade`;', 'feels like ${degrees(sample.feels)} ${sample.exposure.label.toLowerCase()}`;')
with (ROOT/path).open('a') as f:
    f.write('''\nexport function heroFeelsHTML(sample) {
  const source = sample.source === 'Station observation' ? 'based on the current station reading' : 'estimated from forecast data';
  return `Feels like <strong>${degrees(sample.feels)}</strong><small>${esc(sample.exposure.label)} · ${source}</small>`;
}
''')

path='public/weather-fusion/app.js'
change(path,'import {weatherIcon,renderHourlyWeather}', 'import {weatherIcon,renderHourlyWeather,currentSample,heroFeelsHTML}')
change(path,"if($('hero-feels'))$('hero-feels').innerHTML=`Feels like <strong>${degrees(data.comfort?.shade)}</strong><small>In the shade · ${c.type==='observation'?'based on the current station reading':'estimated from forecast data'}</small>`;", "if($('hero-feels'))$('hero-feels').innerHTML=heroFeelsHTML(currentSample(data));")

path='public/weather-fusion/personal-details.js'
change(path,"import {solarElevation}", "import {outdoorExposure} from './outdoor-feels.js';\nimport {solarElevation}")
change(path,"const outdoorValue=finite(comfort?.outdoors)?comfort.outdoors:daylight&&finite(comfort?.sun)?comfort.sun:comfort?.shade;", "const exposure=outdoorExposure({...comfort,daylight,weatherKind:kind,condition});\n const outdoorValue=exposure.value;")
change(path,"const label=!daylight?'Outdoors at night':labels[kind]||labels.unknown;", "const label=exposure.label;")
change(path,'Estimated feels-like temperatures · °F${note}${basis}', 'Estimated feels-like temperatures · °F${note}${basis} Main readings match the outdoor figure; shade is shown separately.')

path='public/weather-fusion/experience.js'
change(path,"note:'How warm or cool it may feel in the shade.'", "note:'Outdoor feels-like forecast using the sky and sunlight at each hour. The outdoor figure and hourly forecast use this same reading.'")
change(path,'Shade feels like ${degrees(sample.feels)}.', 'Outdoors feels like ${degrees(sample.feels)}; shade ${degrees(c.shade)}.')
change(path,"['feels','temp',temp(currentComfort.shade),'UTCI Tier-3 fallback using temperature, moisture, wind and sky/radiant context.']", "['feels','temp',degrees(currentSample(forecast).feels),`${currentSample(forecast).exposure.label} · same outdoor estimate as Now.`]")
change(path,'in the shade at this hour', 'outdoors at this hour')

path='public/weather-fusion/comfort-outlook.js'
change(path,"import {finite,localHour}", "import {outdoorExposure} from './outdoor-feels.js';\nimport {finite,localHour}")
change(path,'const t=current?.temperature,dp=current?.dewpoint,wind=current?.wind,sentences=[];', 'const t=current?.temperature,dp=current?.dewpoint,wind=current?.wind,sentences=[],outdoor=outdoorExposure(comfort).value;')
p=ROOT/path
p.write_text(p.read_text().replace('comfort?.shade','outdoor').replace('comfort.shade','outdoor').replace('shade estimate','outdoor estimate'))

path='public/weather-fusion/hourly-feels.js'
change(path,'Shade estimates from each hour’s temperature, dew point and wind.', 'Outdoor estimates from each hour’s temperature, dew point, wind and sky/sun exposure; the same values appear in the hourly forecast and outdoor figure.')
change(path,' · in the shade · hourly forecast', ' · outdoors · hourly forecast')

with (ROOT/'public/weather-fusion/hourly-feels.css').open('a') as f:
    f.write('\n/* Exposure labels make the primary outdoor basis explicit at every hour. */\n.hour .hour-feels .hour-exposure{font-style:normal;font-size:10px;font-weight:500;line-height:1.25;white-space:normal;overflow-wrap:anywhere;text-align:center;max-width:76px;min-height:2.5em;margin-top:4px;color:#c4e7fb}\n')

# Every changed module gets one uniform URL throughout the dependency graph.
modules='weather-display|outdoor-feels|hourly-feels|personal-details|experience|comfort-outlook'
for p in (ROOT/'public/weather-fusion').glob('*.js'):
    text=p.read_text()
    updated=re.sub(r"(\./(?:"+modules+r")\.js)(?:\?v=[^'\"]*)?(?=['\"])",r'\1?v=outdoor-v1',text)
    if updated!=text:p.write_text(updated)
change('public/weather-fusion/index.html','app.js?v=12-location-uncertainty','app.js?v=13-outdoor-consistency')
change('public/weather-fusion/index.html','hourly-feels.css?v=2-hourly','hourly-feels.css?v=3-outdoor')

# Update only expectations that explicitly described the old shade-only contract.
change('test/weatherFusionSkyConsistency.test.js','assert.equal(samples[0].feels,f.comfort.shade);','assert.equal(samples[0].feels,f.comfort.outdoors);')
change('test/weatherFusionHourlyConsistency.test.js',"Date.parse(h.time),'shade').value", "Date.parse(h.time),'outdoors').value")
for p in (ROOT/'test').glob('weatherFusion*.test.js'):
    text=p.read_text();updated=text.replace('12-location-uncertainty','13-outdoor-consistency')
    if updated!=text:p.write_text(updated)

# Exercise the actual production DOM under sunny, cloudy, partly cloudy, rainy,
# snowy, foggy, cold, missing-input and nighttime conditions at mobile/desktop sizes.
path='scripts/weatherFusionPersonalBrowser.js'
anchor=" const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();"
new=r''' for(const width of [320,390,1365]){
  for(const [condition,time,patch] of [
   ['Sunny',epoch,{}],['Partly Cloudy',epoch,{}],['Cloudy',epoch,{}],['Rain',epoch,{}],['Fog',epoch,{}],
   ['Snow',epoch,{temperature:25,dewpoint:20}],['Clear',Date.parse('2026-09-07T02:00:00Z'),{}],
   ['Sunny',epoch,{wind:null}],['Clear',epoch,{temperature:0,dewpoint:-5}]
  ]){
   const make=(place='knightdale')=>{
    const f=fixture(place);f.assembledAt=new Date(time).toISOString();
    f.current={...f.current,temperature:79,dewpoint:68,humidity:null,wind:0,condition,...patch,time:new Date(time-900000).toISOString()};
    f.comfort=thermalComfort(f.current,f.location,time);
    for(const h of f.hours)h.condition=condition;
    rebuildHourlyFeels(f,{now:time,temperatureAt:()=>({value:null}),humidityAt:()=>null});
    return f;
   };
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   await page.addInitScript(time=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};},time);
   await page.route('https://unpkg.com/**',r=>r.fulfill({body:'',contentType:r.request().url().includes('.css')?'text/css':'application/javascript'}));
   await page.route('**/api/weather-fusion/forecast?**',r=>r.fulfill({json:make(new URL(r.request().url()).searchParams.get('location')||'knightdale')}));
   page.on('pageerror',e=>report.browserErrors.push(e.message));
   await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
   const degree=v=>Number.isFinite(v)?Math.round(v)+'°':'—';
   const assertNow=async(place='knightdale')=>{
    const f=make(place),expected=degree(f.comfort.outdoors);
    assert.equal((await page.locator('#hero-feels strong').innerText()).trim(),expected,'Hero uses outdoors');
    assert.equal((await page.locator('#hourly .hour-current .hour-feels b').innerText()).trim(),expected,'Now equals hero');
    assert.equal((await page.locator('.metric-feels .metric-value').innerText()).trim(),expected,'Metric equals Now');
    assert.equal((await page.locator('.sun-person figcaption strong').innerText()).trim(),expected==='—'?'Unavailable':expected,'Outdoor figure equals Now');
    assert.equal((await page.locator('.shade-person figcaption strong').innerText()).trim(),Number.isFinite(f.comfort.shade)?degree(f.comfort.shade):'Unavailable','Shade remains separately labeled');
    assert.ok((await page.locator('#hourly .hour-current .hour-exposure').innerText()).trim());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    return f;
   };
   const f=await assertNow();
   if(condition==='Sunny'&&patch.wind!==null)assert.ok(f.comfort.outdoors>f.comfort.shade,'The test must catch differing sun and shade values');
   if(!f.comfort.daylight||!['clear','partly-cloudy'].includes(f.comfort.weatherKind))assert.equal(await page.locator('.sun-person .sky-sun').count(),0);
   const future=page.locator('#hourly .forecast-hour').first(),instant=await future.getAttribute('data-time');
   const expected=degree(feelsAt(f,instant));
   await future.click();
   assert.equal((await page.locator('.sun-person figcaption strong').innerText()).trim(),expected==='—'?'Unavailable':expected,'Selected hourly value equals the outdoor preview');
   await page.locator('#hourly .hour-current').click();await assertNow();
   await page.locator('[data-metric="feels"]').click();
   const index=f.metricForecasts.series.feels.findIndex(p=>Date.parse(p.time)===Date.parse(instant));
   await page.locator('#chart-scrubber').fill(String(index));
   assert.equal((await page.locator('#chart-value').innerText()).trim(),expected==='—'?'Not available':expected,'Graph equals the selected hour');
   await page.keyboard.press('Escape');
   await page.locator('[data-place="greenville"]').click();
   await page.waitForFunction(()=>document.querySelector('#city-name').textContent.includes('Greenville'));
   await assertNow('greenville');
   if(width===390&&condition==='Sunny'&&patch.wind!==null){
    await page.locator('#hourly').screenshot({path:dir+'/outdoor-hourly-390.png'});
    await page.locator('#skin-exposure').screenshot({path:dir+'/outdoor-figures-390.png'});
   }
   (report.outdoorExposureChecks??=[]).push({width,condition,time:new Date(time).toISOString(),missingWind:patch.wind===null,heroNowMetricOutdoorAgree:true,shadeSeparate:true,forecastPreviewAndGraphAgree:true,locationSwitch:true});
   await context.close();
  }
 }
'''+anchor
change(path,anchor,new)

with (ROOT/'docs/weather-nourie-experience.md').open('a') as f:
    f.write('\n## Outdoor feels-like contract — September 6, 2026\nMain feels-like numbers (hero, Now, hourly forecast, metric, graphs, daily extrema and outdoor figure) use the same outdoors exposure. Shade is retained as a separately labeled comparison. Each forecast hour uses its own temperature, moisture, wind, sky and solar time. No numeric value is raised simply to match another exposure. The thermal equations are unchanged. API `metricForecasts.series.feels` is outdoors; `feelsShade` retains shade, and `outdoorFeelsVersion` identifies this contract. Legacy `current.apparent` remains the named Steadman diagnostic; UI consumers use `current.feelsLike` / `comfort.outdoors`.\n')
print('Applied the shared outdoor exposure contract; no thermal equation was changed.')
