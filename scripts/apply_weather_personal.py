"""One-time exact-match integration, executed on an isolated branch before release."""
from pathlib import Path

def replace(path, old, new, count=1):
    p=Path(path);text=p.read_text();actual=text.count(old)
    if actual!=count: raise RuntimeError(f'{path}: expected {count} occurrences, found {actual}: {old[:100]!r}')
    p.write_text(text.replace(old,new))

def section(path,start,end,new):
    p=Path(path);text=p.read_text()
    if text.count(start)!=1 or text.count(end)!=1: raise RuntimeError(f'Unexpected function boundaries in {path}')
    a=text.index(start);b=text.index(end,a);p.write_text(text[:a]+new+text[b:])

html='public/weather-fusion/index.html'
replace(html,'forecast-layout.css?v=2-forecast-details','forecast-layout.css?v=3-personal')
replace(html,'  <script type="module" src="/weather-fusion/app.js?v=7-forecast-details"></script>','  <link rel="stylesheet" href="/weather-fusion/personal-details.css?v=1-personal">\n  <script type="module" src="/weather-fusion/app.js?v=8-personal"></script>')
replace(html,'A CLEARER LOOK AHEAD','Because Apple, Google and Samsung weather suck')
replace(html,'        <div class="hero-temperature"','        <div class="current-temp-label">Current temperature</div>\n        <div class="hero-temperature"')
replace(html,'id="condition"','id="condition" hidden')
replace(html,'id="high-low"','id="high-low" hidden')
replace(html,'What could change</strong>',"What could change - Dan's take</strong>")
replace(html,'        <section class="glass hourly-panel"','''        <section class="glass bulletins-panel" id="nws-bulletins" aria-labelledby="bulletins-title">
          <div class="section-top"><h2 id="bulletins-title">NWS BULLETINS</h2><span>In plain words</span></div>
          <div id="alerts" class="alerts" aria-label="Official NWS notices and explanations"><p class="bulletin-time">Checking local NWS notices…</p></div>
        </section>
        <section class="glass hourly-panel"''')
replace(html,'      <section id="alerts" class="alerts" aria-label="Official weather alerts"></section>\n','')
replace(html,'          <div id="radar-legend"','          <p id="model-freshness" role="status" hidden></p>\n          <div id="radar-legend"')
replace(html,'It is still an estimate, not measured sunlight, so the ~ symbol marks the extra uncertainty.','These are estimated feels-like temperatures, not measured sunlight or body temperature.')

app='public/weather-fusion/app.js'
replace(app,"import {heroWeather} from './hero-mode.js';", "import {currentHero} from './current-temperature.js?v=1-current';\nimport {renderBulletins} from './bulletins.js?v=1-bulletins';\nimport {dailyGrossHTML,modelFreshnessText} from './personal-details.js?v=1-personal';")
replace(app,"from './experience.js';","from './experience.js?v=8-personal';")
replace(app,"from './dewpoint-meter.js';","from './dewpoint-meter.js?v=5-compact';")
replace(app,'const hero = heroWeather(data, Date.now());','const hero = currentHero(data, day);')
section(app,'function renderAlerts(data) {','function renderHours(data)', 'function renderAlerts(data) { renderBulletins(data); }\n')
replace(app,'What could change</strong>',"What could change - Dan's take</strong>")
replace(app,'async function load({ moveMap = false } = {})','async function load({ moveMap = false, refreshModels = false } = {})')
replace(app,'    render(data);\n', '''    render(data);
    // Official notices are rendered synchronously; AI explanations never delay them.
    api('bulletins', query({ signature: data.signature }), requestController.signal).then((bulletins) => {
      if (id === generation && bulletins.signature === forecast?.signature) renderBulletins(forecast, bulletins);
    }).catch((error) => {
      if (id === generation && error.name !== 'AbortError' && forecast) renderBulletins(forecast, {mode:'official', signature:forecast.signature});
    });
''')
replace(app,"if (selectedLayer !== 'radar' && (moveMap || Date.now()-modelFetched > 120000)) void loadModelMap();", "if (selectedLayer !== 'radar' && (refreshModels || moveMap || Date.now()-modelFetched >= 55000)) void loadModelMap(refreshModels);")
replace(app,'<a href="#scientific-stuff" class="science-link" id="day-science-link">','${dailyGrossHTML(forecast,index,p.tonight)}<a href="#scientific-stuff" class="science-link" id="day-science-link">')
replace(app,'async function loadModelMap(){','async function loadModelMap(force=false){')
replace(app,'if(!modelCatalog||Date.now()-modelFetched>120000)','if(force||!modelCatalog||Date.now()-modelFetched>=55000)')
replace(app,'    const layer=modelCatalog.layers[layerName];','''    const layer=modelCatalog.layers[layerName];
    const freshness=$('model-freshness');
    if(freshness){
      freshness.hidden=false;
      freshness.textContent=modelFreshnessText(layer,modelCatalog.checkedAt||new Date(modelFetched).toISOString(),forecast?.location?.timeZone);
      freshness.dataset.delayed=String(layer?.model==='hrrr'&&Date.now()-Date.parse(layer.runAt)>150*60000);
    }''')
replace(app,'  selectedLayer=layer;stopRadar();++mapSelectionToken;++modelFrameToken;', '''  selectedLayer=layer;stopRadar();++mapSelectionToken;++modelFrameToken;
  const freshness=$('model-freshness');if(freshness){freshness.hidden=layer==='radar';freshness.textContent=layer==='radar'?'':'Checking the latest published run…';freshness.dataset.delayed='false';}''')
replace(app,"$('refresh').addEventListener('click', () => { if (!busy) void load(); });", "$('refresh').addEventListener('click', () => { if (!busy) void load({refreshModels:true}); });")

experience='public/weather-fusion/experience.js'
p=Path(experience);p.write_text("import {pressureMb,stationPressureMb,pressureTrendText,sunShadeHTML} from './personal-details.js?v=1-personal';\n"+p.read_text())
replace(experience,"pressure:{title:'Pressure',unit:' inHg',field:'pressure',note:'How air pressure is expected to change.',color:'#c6bafa',digits:2},", "pressure:{title:'Pressure',unit:' mb',field:'pressure',note:'How sea-level pressure is expected to change.',color:'#c6bafa',digits:1},")
replace(experience," return (data.metricForecasts?.series?.[defs[key].field]||[]).slice(0,hours);", " const points=(data.metricForecasts?.series?.[defs[key].field]||[]).slice(0,hours);\n return key==='pressure'?points.map(p=>({...p,value:pressureMb(p.value)})):points;")
replace(experience," $('skin-values').innerHTML=`<span><strong>${temp(c.shade)}</strong> right now</span>${summary?`<span><strong>~${temp(summary.chosen.value)}</strong> ${summary.label}</span>`:''}`;", " $('skin-values').innerHTML=`${sunShadeHTML(c,forecast.location,now)}${summary?`<p class=\"comfort-later\"><strong>${temp(summary.chosen.value)}</strong> ${summary.label}</p>`:''}`;")
replace(experience,"  ['pressure','gauge',`${number(c.pressure,2)}<small>inHg</small>`,'Current air pressure.'],", "  ['pressure','gauge',`${number(stationPressureMb(c),1)}<small>mb</small>`,pressureTrendText(c)],")
replace(experience,'data-metric="${key}" aria-haspopup="dialog"', 'data-metric="${key}"${key===\'pressure\'?` data-pressure-trend="${esc(c.pressureTrend?.direction||\'unknown\')}"`:\'\'} aria-haspopup="dialog"')
replace(experience,"def.unit===' inHg'?v.toFixed(2)","def.unit===' mb'?v.toFixed(1)")
replace(experience,'Sea-level forecast · separate from the station reading.','Sea-level forecast in mb · separate from the station reading and its observed trend.')
replace(experience,'Current pressure is station pressure; the pressure graph is explicitly labeled mean sea-level pressure. One is not appended to the other.','All displayed pressures use millibars (mb). The trend compares the same station about three hours apart. Current pressure is station pressure; the graph is mean sea-level forecast pressure. These are kept separate.')

narrative='public/weather-fusion/comfort-outlook.js'
p=Path(narrative);lines=p.read_text().splitlines(keepends=True);removed=[line for line in lines if 'In direct sun right now, the estimate is about' in line]
assert len(removed)==1
p.write_text(''.join(line for line in lines if line not in removed))
meter='public/weather-fusion/dewpoint-meter.js'
replace(meter,'dewpoint-meter.css?v=4-fit','dewpoint-meter.css?v=5-compact')
replace(meter,'),height=300,L=W<400?40:48', '),height=W<600?210:230,L=W<400?40:48')

server='src/weatherFusion.js'
p=Path(server);p.write_text("import {createBulletinService} from './weatherFusionBulletins.js';\nimport {pressureTrendFromObservations} from './weatherFusionPressure.js';\n"+p.read_text())
replace(server,"pressure: o.barometricPressure?.unitCode === 'wmoUnit:Pa' && finite(o.barometricPressure.value) ? rounded(o.barometricPressure.value / 3386.389, 2) : null };", "pressurePa: o.barometricPressure?.unitCode === 'wmoUnit:Pa' ? numeric(o.barometricPressure.value) : null,\n                pressure: o.barometricPressure?.unitCode === 'wmoUnit:Pa' && finite(o.barometricPressure.value) ? rounded(o.barometricPressure.value / 3386.389, 2) : null };")
replace(server,'          return candidates.find(Boolean) || null;', '''          const chosen=candidates.find(Boolean)||null;
          if(chosen?.station&&finite(chosen.pressurePa)){
            try{
              const stamp=Date.parse(chosen.time);
              const params=new URLSearchParams({start:iso(stamp-3.5*HOUR),end:iso(stamp-2.5*HOUR),limit:'100'});
              const {data:history}=await cached(`https://api.weather.gov/stations/${chosen.station}/observations?${params}`,5*MINUTE);
              chosen.pressureTrend=pressureTrendFromObservations(history.features,chosen);
            }catch{chosen.pressureTrend={status:'unavailable',direction:'unknown'};}
          }
          return chosen;''')
replace(server,"f.properties?.status === 'Actual' && Date.parse(f.properties?.expires) > now()", "f.properties?.status === 'Actual' && f.properties?.messageType !== 'Cancel' && Date.parse(f.properties?.expires) > now()")
replace(server,'  return { getForecast, getBriefing, search, radar, modelMaps: direct.maps };', '  const getBulletins=createBulletinService({getForecast,request,env,now});\n  return { getForecast, getBriefing, getBulletins, search, radar, modelMaps: direct.maps };')
replace(server,"'comfort-outlook.js']) app.get", "'comfort-outlook.js','forecast-layout.css','personal-details.js','personal-details.css','bulletin-facts.js','bulletins.js','current-temperature.js']) app.get")
replace(server,"  app.get('/api/weather-fusion/briefing', route(service.getBriefing));", "  app.get('/api/weather-fusion/briefing', route(service.getBriefing));\n  app.get('/api/weather-fusion/bulletins', route(service.getBulletins));")

direct='src/weatherFusionDirect.js'
replace(direct,"'User-Agent': 'Sun-Nourie-WeatherFusion/2.1' }, redirect: 'error'", "'User-Agent': 'Sun-Nourie-WeatherFusion/2.1', 'Cache-Control':'no-cache' }, cache:'no-store', redirect: 'error'")
replace(direct,'cache.set(file, { until: now()+2*60000, data });','cache.set(file, { until: now()+60000, data });')
replace(direct,'return { schema: DIRECT_SCHEMA, generatedAt: manifest.generatedAt, layers, coverage:', 'return { schema: DIRECT_SCHEMA, checkedAt:iso(now()), generatedAt: manifest.generatedAt, layers, coverage:')

collector='scripts/weather_fusion_collect.py'
replace(collector,'    parser.add_argument("--output",required=True)','    parser.add_argument("--output",required=True)\n    parser.add_argument("--models",nargs="+",choices=list(SOURCES),default=list(SOURCES))')
replace(collector,'tasks={executor.submit(collect_model,m,str(out)):m for m in SOURCES}', 'tasks={executor.submit(collect_model,m,str(out)):m for m in args.models}')
replace(collector,'        old = json.loads(target.read_text())','''        old = json.loads(target.read_text())
        if old.get("schema") == SCHEMA and old.get("complete") and old.get("runAt", "") > iso(run):
            print(f"KEEP newer verified {model} run={old['runAt']}", flush=True)
            return {"model": model, "runAt": old["runAt"], "reused": True}''')
replace(collector,'    (out/"collection-status.json").write_text(json.dumps({"checkedAt":iso(dt.datetime.now(UTC)),"results":results},indent=2))', '''    checked=iso(dt.datetime.now(UTC))
    previous={}
    try:
        previous={r["model"]:r for r in json.loads((out/"collection-status.json").read_text()).get("results",[])}
    except (OSError,ValueError,KeyError):
        pass
    previous.update({r["model"]:{**r,"checkedAt":checked} for r in results})
    (out/"collection-status.json").write_text(json.dumps({"checkedAt":checked,"results":list(previous.values())},indent=2))''')

oldtest='test/weatherFusionForecastDetails.test.js'
replace(oldtest,'What could change',"What could change - Dan's take")
replace(oldtest,'forecast-layout\\.css\\?v=2-forecast-details','forecast-layout\\.css\\?v=3-personal')
replace(oldtest,'app\\.js\\?v=7-forecast-details','app\\.js\\?v=8-personal')

smoke='scripts/weatherFusionBrowserSmoke.js'
replace(smoke,"const paths=['index.html'", "const paths=['personal-details.js','personal-details.css','bulletin-facts.js','bulletins.js','current-temperature.js','comfort-outlook.js','index.html'")
replace(smoke,'  const hourly=panel.nextElementSibling;', "  const next=panel.nextElementSibling;\n  const hourly=next?.id==='nws-bulletins'?next.nextElementSibling:next;")
replace(smoke,"'Hourly must remain immediately after the Today/Tonight panel'", "'Hourly must follow the Today/Tonight and bulletin panels'")
replace(smoke,' return details;',''' assert.equal((await page.locator('.current-temp-label').innerText()).trim(),'Current temperature');
 assert.equal(await page.locator('#high-low').isVisible(),false);
 assert.equal(await page.locator('#condition').isVisible(),false);
 assert.equal(await page.locator('.sun-shade-comparison figure').count(),2);
 assert.ok(!(await page.locator('#skin-exposure').innerText()).includes('~'));
 assert.match(await page.locator('.brand small').innerText(),/Because Apple, Google and Samsung weather suck/);
 assert.equal(await page.locator('.today-uncertainty-label').innerText(),"What could change - Dan's take");
 return details;''')
replace(smoke,"  assert.equal(ai.mode,'ai',JSON.stringify(ai));", """  assert.equal(ai.mode,'ai',JSON.stringify(ai));
  const bulletins=await json('/api/weather-fusion/bulletins?location='+location);
  if(data.discussion||data.alerts.length)assert.equal(bulletins.mode,'ai',JSON.stringify(bulletins));
  (report.nwsBulletins??=[]).push({location,mode:bulletins.mode,summaries:bulletins.summaries?.length||0,pressureTrend:data.current.pressureTrend||null});""")
replace(smoke,"assert.ok((await page.locator('#day-content').innerText()).includes('WEATHER NOURIE'));", "assert.ok((await page.locator('#day-content').innerText()).includes('WEATHER NOURIE'));\n assert.equal(await page.locator('#day-content .day-gross').count(),1);")
replace(smoke,"  if(key==='pressure')await page.screenshot({path:dir+'/pressure-graph.png'});", "  if(key==='pressure'){if(available)assert.match(value,/mb/);await page.screenshot({path:dir+'/pressure-graph.png'});}")

# CSS shorthand must not combine a family-wide inherit keyword with a font size.
replace('public/weather-fusion/personal-details.css','font:12px/1.65 inherit;','font-family:inherit;font-size:12px;line-height:1.65;')
print('Applied exact-match production edits. All changes remain on the feature branch until tested.')
