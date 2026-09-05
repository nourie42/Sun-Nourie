from pathlib import Path


def replace(path, old, new, count=1):
    p=Path(path); s=p.read_text()
    assert old in s, f'missing pattern in {path}: {old[:100]!r}'
    s=s.replace(old,new,count)
    p.write_text(s)

# Hero: after 3 PM, the hero is tonight's forecast, not the current/daytime temperature.
replace('public/weather-fusion/app.js',
"import {dailyDisplay} from './weather-math.js';",
"import {dailyDisplay} from './weather-math.js';\nimport {heroWeather} from './hero-mode.js';")
replace('public/weather-fusion/app.js',
"""  $('temperature').innerHTML = `${number(c.temperature)}<span>°</span>`;
  $('condition').textContent = c.condition || (data.hours[0]?.condition ? `${data.hours[0].condition} · forecast` : 'Current condition description unavailable');
  const currentDay = dailyDisplay(d, 0, Date.now(), data.location.timeZone);
  $('high-low').innerHTML = currentDay.tonight ? `Tonight’s low ${temperature(d.low)}` : `High ${temperature(d.high)} <span>Low ${temperature(d.low)}</span>`;
  $('observation-label').textContent = c.type === 'observation' ? `Nearby weather station · updated ${clock(c.time)}` : 'Estimated current conditions';
  $('hero-scene').innerHTML = icon(c.condition || data.hours[0]?.condition, day, 120);""",
"""  const currentDay = dailyDisplay(d, 0, Date.now(), data.location.timeZone);
  const hero = heroWeather(data, Date.now());
  $('temperature').innerHTML = `${number(hero.temperature)}<span>°</span>`;
  $('condition').textContent = hero.tonight ? `Tonight · ${hero.condition}` : hero.condition;
  $('high-low').textContent = hero.tonight ? 'Overnight low' : hero.range;
  $('observation-label').textContent = hero.tonight ? `Tonight’s forecast · updated ${clock(data.assembledAt)}` : (c.type === 'observation' ? `Nearby weather station · updated ${clock(c.time)}` : 'Estimated current conditions');
  $('hero-scene').innerHTML = icon(hero.condition, hero.isDay, 120);""")

# Extend the dew point and wind series with real decoded model data through ten days.
replace('src/weatherFusionExperience.js',
""" }
 const days=out.days.map((d,index)=>({date:d.date,...solarTimes(d.date,out.location.latitude,out.location.longitude)}));""",
""" }
 // The NWS hourly product is intentionally limited to 48 hours, but the Gross Meter
 // needs an honest extended dew-point outlook. Append only real direct-model values;
 // do not hold a reading flat or invent missing hours. HRRR wins when its fresh run
 // covers the hour, then ECMWF supplies the extended horizon.
 const extendedStart=Math.ceil(now/H)*H, extendedEnd=extendedStart+240*H;
 for(const [key,field,ids,digits] of [
  ['dewpoint','dew_point_2m',['hrrr','ecmwf','nbm'],1],
  ['wind','wind_speed_10m',['hrrr','ecmwf','nbm'],1],
 ]){
  const existing=new Set(series[key].map(p=>p.time));
  for(let time=extendedStart;time<=extendedEnd;time+=H){
   const stamp=new Date(time).toISOString();if(existing.has(stamp))continue;
   const value=modelSample(models,time,field,ids);
   if(finite(value.value))series[key].push({time:stamp,value:round(value.value,digits),source:value.source,...(value.runAt?{runAt:value.runAt}:{})});
  }
  series[key].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 }
 const days=out.days.map((d,index)=>({date:d.date,...solarTimes(d.date,out.location.latitude,out.location.longitude)}));""")
replace('src/weatherFusionExperience.js',
"""out.metricForecasts={version:EXPERIENCE_VERSION,series,solar:days,notes:{pressure:'Mean sea-level pressure forecast; separate from the observed station pressure on the card.',visibility:'NWS visibility where published, otherwise HRRR model visibility. Missing intervals stay blank.',feels:'Calculated shade apparent temperature using forecast temperature, humidity/dew point and wind. Not a measured skin temperature.',precipitation:'Hourly liquid-equivalent forecast amounts; coarse source intervals are apportioned uniformly. This does not predict minute-exact rain timing.',wind:'NWS grid/period wind first; numeric speed from a forecast range uses the upper value.',solar:'Astronomical sunrise, sunset and daylight duration; not cloud or sunshine duration.'}};""",
"""out.metricForecasts={version:EXPERIENCE_VERSION,series,solar:days,dewpointHorizonHours:240,notes:{pressure:'Mean sea-level pressure forecast; separate from the observed station pressure on the card.',visibility:'NWS visibility where published, otherwise HRRR model visibility. Missing intervals stay blank.',feels:'Calculated shade apparent temperature using forecast temperature, humidity/dew point and wind. Not a measured skin temperature.',dewpoint:'NWS/local guidance first in the near term; fresh HRRR and ECMWF direct-model dew points extend the Gross Meter. Missing hours are never filled from the current reading.',precipitation:'Hourly liquid-equivalent forecast amounts; coarse source intervals are apportioned uniformly. This does not predict minute-exact rain timing.',wind:'NWS grid/period wind first; numeric speed from a forecast range uses the upper value.',solar:'Astronomical sunrise, sunset and daylight duration; not cloud or sunshine duration.'}};""")

# Collect ten-day NBM/IFS guidance and every completed HRRR hourly cycle.
replace('scripts/weather_fusion_collect.py',
'    "nbm": {"label": "NOAA National Blend", "resolution": "2.5 km native grid", "hours": 192, "url": "https://www.nco.ncep.noaa.gov/pmb/products/blend/"},\n    "ecmwf": {"label": "ECMWF IFS", "resolution": "0.25° Open Data grid", "hours": 192, "url": "https://www.ecmwf.int/en/forecasts/datasets/open-data"},',
'    "nbm": {"label": "NOAA National Blend", "resolution": "2.5 km native grid", "hours": 240, "url": "https://www.nco.ncep.noaa.gov/pmb/products/blend/"},\n    "ecmwf": {"label": "ECMWF IFS", "resolution": "0.25° Open Data grid", "hours": 240, "url": "https://www.ecmwf.int/en/forecasts/datasets/open-data"},')
replace('scripts/weather_fusion_collect.py',
"""    run = None
    for back in range(1, 31):
        candidate = (now-dt.timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
        if model == "hrrr" and candidate.hour % 6:
            continue
        if model == "ecmwf" and candidate.hour not in [0, 12]:
            continue
        _, index = urls(model, candidate, SOURCES[model]["hours"])
        try:
            entries = parse_index(model, get(index, retries=0).decode())
            if any(r["field"] == "temperature" for r in entries):
                run = candidate
                break
        except Exception:
            pass
    if run is None:
        raise RuntimeError(f"No complete recent {model} run found")""",
"""    run = None
    run_hours = None
    for back in range(1, 31):
        candidate = (now-dt.timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
        if model == "ecmwf" and candidate.hour not in [0, 12]:
            continue
        # HRRR produces a new CONUS run every hour. The 00/06/12/18Z cycles
        # extend to 48 h; the intervening cycles provide the shorter operational
        # horizon. Probe 18 h first so a fresh hourly run is never ignored.
        probe = 18 if model == "hrrr" else SOURCES[model]["hours"]
        _, index = urls(model, candidate, probe)
        try:
            entries = parse_index(model, get(index, retries=0).decode())
            if any(r["field"] == "temperature" for r in entries):
                run = candidate
                run_hours = probe
                if model == "hrrr" and candidate.hour % 6 == 0:
                    try:
                        _, extended_index = urls(model, candidate, 48)
                        extended = parse_index(model, get(extended_index, retries=0).decode())
                        if any(r["field"] == "temperature" for r in extended):
                            run_hours = 48
                    except Exception:
                        pass
                break
        except Exception:
            pass
    if run is None or run_hours is None:
        raise RuntimeError(f"No complete recent {model} run found")""")
replace('scripts/weather_fusion_collect.py',
'        if old.get("runAt") == iso(run) and old.get("schema") == SCHEMA and old.get("complete") and old.get("cardFieldsVersion") == 1:',
'        if old.get("runAt") == iso(run) and old.get("schema") == SCHEMA and old.get("complete") and old.get("cardFieldsVersion") == 1 and old.get("forecastHours") == run_hours:')
replace('scripts/weather_fusion_collect.py',
'    steps = list(range(49)) if model == "hrrr" else list(range(1,37)) + list(range(42,193,6)) if model == "nbm" else list(range(0,145,3)) + list(range(150,193,6))',
'    steps = list(range(run_hours+1)) if model == "hrrr" else list(range(1,37)) + list(range(42,241,6)) if model == "nbm" else list(range(0,145,3)) + list(range(150,241,6))')
replace('scripts/weather_fusion_collect.py',
'"validUntil":iso(run+dt.timedelta(hours=SOURCES[model]["hours"]))',
'"validUntil":iso(run+dt.timedelta(hours=run_hours)),"forecastHours":run_hours')
replace('scripts/weather_fusion_collect.py',
'"cyclePolicy":"Latest fully published extended run (HRRR 00/06/12/18Z; IFS 00/12Z; NBM hourly)."',
'"cyclePolicy":"Latest completed run: HRRR checked hourly (48 h at 00/06/12/18Z, shorter horizon on intervening cycles); ECMWF IFS 00/12Z; NBM hourly."')

# Poll often enough to catch hourly HRRR/NBM publications soon after they appear.
replace('.github/workflows/weather-fusion-data.yml',
"    - cron: '17 * * * *'",
"    - cron: '12,42 * * * *'")
