from pathlib import Path
import re

def edit(path, old, new, count=1):
    p=Path(path); text=p.read_text()
    if text.count(old)!=count: raise RuntimeError(f'{path}: expected {count}, got {text.count(old)}: {old[:90]}')
    p.write_text(text.replace(old,new))

p=Path('public/weather-fusion/weather-math.js'); s=p.read_text()
a=s.index('/** Tier-3 operational fallback'); b=s.index('export function thermalComfort',a)
s=s[:a]+'''/** One continuous UTCI calculation. No warmer-of-two-index selection.
 * MRT is explicitly a Tier-3 estimate, not measured radiation or skin temperature. */
export function thermalHumidity(current) {
  if(finite(current?.dewpoint))return humidityFromDewpoint(current.temperature,current.dewpoint);
  return finite(current?.humidity)&&current.humidity>=0&&current.humidity<=100?current.humidity:null;
}
export function radiationSky(current={}) {
  const cover=current.skyCover;
  // Numeric sky cover at THIS forecast hour wins over a 12-hour weather phrase.
  if(finite(cover)&&cover>=0&&cover<=100) {
    const condition=cover<=12?'Clear':cover<=62?'Partly Cloudy':'Cloudy';
    return {...weatherState(condition),condition,cover,source:current.skySource||'Same-hour forecast sky cover'};
  }
  const text=String(current.condition||'');
  // A chance of a shower does not erase explicitly forecast sunny skies.
  const sky=text.match(/mostly sunny|mostly clear|partly cloudy|partly sunny|mostly cloudy|overcast|sunny|clear|cloudy/i)?.[0];
  const condition=sky||text;
  return {...weatherState(condition),condition,cover:null,source:current.conditionSource||'Weather-description sky estimate'};
}
function estimatedMrtDelta(current,elevation,exposure) {
  if(!finite(elevation)||elevation<=0)return 0;
  const sky=radiationSky(current),sun=Math.max(0,Math.sin(elevation))**.72;
  const diffuse={clear:18,'partly-cloudy':15,cloudy:8,rain:5,storm:4,snow:10,fog:5,unknown:0}[sky.kind]??0;
  // Smooth interpolation avoids a threshold jump when cloud cover crosses a category.
  const cloud=finite(sky.cover)?sky.cover/100:null;
  const trans=cloud===null?(weatherTransmission(sky.condition)||0):Math.max(0,1-cloud);
  const diffuseLoad=cloud===null?diffuse:18-10*cloud;
  const direct=exposure==='outdoors'?130*sun*trans:0;
  return (diffuseLoad*sun+direct)/6.1;
}
export function tier3FeelsLike(current,location,now,exposure='shade') {
  if(!finite(current?.temperature)||!finite(current?.wind)||current.wind<0)return {value:null,method:'UTCI inputs unavailable'};
  const rh=thermalHumidity(current);
  if(!finite(rh))return {value:null,method:'UTCI moisture unavailable'};
  const elevation=solarElevation(now,location?.latitude,location?.longitude),deltaC=estimatedMrtDelta(current,elevation,exposure);
  const tr=current.temperature+deltaC*1.8,value=utciF(current.temperature,tr,current.wind,rh);
  return {value,method:finite(value)?'UTCI Tier-3 with estimated mean radiant temperature':'UTCI outside supported range',rh,tr,deltaMrtC:deltaC,
    windUsedMps:Math.max(.5,current.wind*.44704),warmerResultOverride:false};
}

'''+s[b:]
s=s.replace('const weather=weatherState(current.condition,current.skyCover);','const weather=radiationSky(current);')
s=s.replace('const rh=finite(current.humidity)?current.humidity:humidityFromDewpoint(current.temperature,current.dewpoint);','const rh=thermalHumidity(current);')
s=s.replace('Math.round(outdoor.value):shadeValue','Math.round(outdoor.value):null')
s=s.replace('return {shade:shadeValue,sun:', '''return {rawShade:shade.value,rawOutdoors:outdoor.value,
    inputEvidence:{temperature:current.temperature,dewpoint:current.dewpoint,humidity:rh,windMph:current.wind,windUsedMps:outdoor.windUsedMps,skyCover:weather.cover,skySource:weather.source,meanRadiantTemperatureF:outdoor.tr,sourceTime:current.time||null,station:current.station||null,stationDistanceKm:current.stationDistanceKm??null,
      windPolicy:current.wind*.44704<.5?'Calm-wind approximation: UTCI minimum 0.5 m/s':'Source wind; no observation-to-forecast adjustment',
      radiationBasis:daylight===false?'No solar load at night; unmeasured mean radiant temperature assumed equal to air':'Radiation estimated from the same-hour sky and solar elevation; not measured'},
    radiantCondition:weather.condition,shade:shadeValue,sun:''')
s=s.replace('In warm humid air, the warmer Steadman vapor-pressure apparent temperature is retained as a safeguard, so cloud cover can reduce radiant heating without wiping out the dew-point effect.', 'No warmer-formula override or observation-to-forecast offset is used. Numeric hourly cloud cover is preferred over broad period descriptions. Calm wind uses the UTCI minimum 0.5 m/s; out-of-domain conditions stay unavailable. Cloud attenuation and MRT are estimates, not local radiometer measurements.')
p.write_text(s)
p=Path('public/weather-fusion/utci.js'); s=p.read_text().replace('tdb<=-50||tdb>=50||d<=-30||d>=70||v<=.5||v>=17','tdb<-50||tdb>50||d<-30||d>70||v<.5||v>17')
s=s.replace('!finite(windMph))return null;const v=Math.max(.51,Math.min(16.99,windMph*.44704));','!finite(windMph)||windMph<0)return null;const v=Math.max(.5,windMph*.44704);'); p.write_text(s)

# Preserve raw station precision. Source flags and station selection are unchanged.
p='src/weatherFusion.js'
edit(p,'temperature: rounded(toF(o.temperature))','temperature: toF(o.temperature)')
edit(p,'humidity: rounded(o.relativeHumidity?.value), dewpoint: rounded(toF(o.dewpoint))','humidity: numeric(o.relativeHumidity?.value), dewpoint: toF(o.dewpoint)')
edit(p,'wind: rounded(toMph(o.windSpeed))','wind: toMph(o.windSpeed)')
edit(p,'result.aiConfigured = !!env.OPENAI_API_KEY;',"result.aiConfigured = !!env.OPENAI_API_KEY;\n      result.integrityVersion='weather-nourie-integrity-v1';")
edit(p,"properties.sources = { type: 'array', items: { type: 'string', enum: ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm'] } };", "const requiredSources=['nws','afd',...data.modelContributions.map(m=>m.id)];\n      properties.sources = { type: 'array', items: { type: 'string', enum: requiredSources } };")
edit(p,"requiredSources: ['nws','afd',...data.modelContributions.map(m=>m.id)],",'requiredSources,')

# Every hour, including day seven and beyond the short hourly text forecast,
# receives its own sky-cover grid sample. Never reuse today's station cloud cover.
p='src/weatherFusionExperience.js'
edit(p,"humidityAt:epoch=>gridSample(grid,'relativeHumidity',epoch,'percent')", "humidityAt:epoch=>gridSample(grid,'relativeHumidity',epoch,'percent'),\n  skyAt:epoch=>gridSample(grid,'skyCover',epoch,'percent')")
edit(p,'Cite nws and afd plus the model IDs in modelContributions in the sources array,', 'Return EXACTLY requiredSources in the sources array. A model mentioned inside the AFD is attributed to afd, not a separately contributing model. Cite nws and afd plus only the model IDs in modelContributions,')
p='src/weatherFusionHourlyFeels.js'
edit(p,'humidityAt,periods=[]','humidityAt,skyAt=()=>null,periods=[]')
edit(p,'const inputs={temperature,dewpoint,wind,humidity};',"const skyCover=skyAt(epoch);\n  const inputs={temperature,dewpoint,wind,humidity,skyCover:finite(skyCover)?skyCover:null,skySource:finite(skyCover)?'NWS same-hour sky-cover grid':null};")
edit(p,'if(hour){hour.feelsLike=value;',"if(hour){hour.skyCover=inputs.skyCover;hour.skySource=inputs.skySource;hour.wind=finite(wind)?`${wind} mph`:null;hour.windMph=wind;hour.feelsLike=value;")
edit(p,'out.comfort=out.comfort||thermalComfort(out.current,out.location,now);','out.comfort=thermalComfort(out.current,out.location,now);')
edit(p,'UTCI remains the all-season base; in warm humid air the warmer Steadman vapor-pressure result is kept as a moisture safeguard so cloud cover does not erase the dew-point effect.', 'UTCI is used across all hours without a warmer-index override. Same-hour sky cover controls estimated radiation. Calm-wind limits and source inputs are disclosed.')
edit(p,'source:estimate.method,alignmentFactor:0','source:estimate.method,inputEvidence:sun.inputEvidence,alignmentFactor:0')

# Independently recompute illustration values; corrupted cached API values cannot
# coerce the figure. A genuine API/calculation disagreement is treated as unavailable.
p='public/weather-fusion/weather-display.js'
edit(p,'const comfort = forecast.comfort || thermalComfort(current, forecast.location, finite(assembled) ? assembled : now);','const comfort = thermalComfort(current, forecast.location, finite(assembled) ? assembled : now);')
pth=Path(p); s=pth.read_text(); a=s.index('  // The API series is canonical.'); b=s.index('  return {id:new Date(epoch)',a)
s=s[:a]+'''  const rounded=v=>finite(v)?Number(v.toFixed(1)):null;
  const value=rounded(estimated.rawOutdoors);
  if(finite(value)!==finite(point.value)||(finite(value)&&Math.abs(value-point.value)>.11))return null;
  const comfort={...estimated,outdoors:value,shade:rounded(estimated.rawShade),sun:estimated.sun===null?null:value};
'''+s[b:]; pth.write_text(s)
edit(p,"${sample.now ? 'Current' : finite(sample.pop)","${sample.now ? 'Station estimate' : finite(sample.pop)")
edit(p,"return sample.now ? `Current conditions · ${sample.source === 'Station observation' ? 'station reading' : 'estimate'} at ${time}`", "const station=sample.inputs?.station,km=sample.inputs?.stationDistanceKm;\n  const site=station?` · ${station}${finite(km)?` · ${Math.round(km/1.609344)} mi away`:''}`:'';\n  return sample.now ? `Current conditions · ${sample.source === 'Station observation' ? 'station estimate' : 'forecast estimate'}${site} at ${time}`")
p='public/weather-fusion/personal-details.js'
edit(p,"const condition=context.condition||comfort?.condition||", "const condition=comfort?.radiantCondition||context.condition||comfort?.condition||")

# Keep existing source/quote/expiry validation, correct out-of-order alternative
# dates, and attach the requested natural-language week framing by local date.
p='public/weather-fusion/dans-take.js'
edit(p,'weather-nourie-dans-take-v2','weather-nourie-dans-take-integrity-v1')
edit(p,"  let first=found[0],last=found.at(-1);\n  if(last.start<first.start&&found.length>1){\n    const p=localParts(last.start,zone);last=partRange(addDays(p.date,7),last.part,zone);\n  }", "  const first=found.reduce((a,b)=>a.start<=b.start?a:b);\n  const last=found.reduce((a,b)=>a.end>=b.end?a:b);")
edit(p,"const period=a===b?a+(range.part?` ${range.part}`:''):`${a} – ${b}`;", "const daysAhead=Math.round((Date.parse(localParts(range.start,zone).date+'T12:00Z')-Date.parse(localParts(now,zone).date+'T12:00Z'))/DAY);\n        const prefix=daysAhead>=2&&daysAhead<=7?'This coming week — ':'';\n        const period=prefix+(a===b?a+(range.part?` ${range.part}`:''):`${a} – ${b}`);")

# Source details explain a station/forecast difference without changing either.
p='public/weather-fusion/app.js'
edit(p,'function renderEvidence(data) {', '''function renderEvidence(data) {
  const root=$('thermal-input-evidence');
  if(root){
    const c=data.current||{},e=data.comfort?.inputEvidence||{};
    const next=data.metricForecasts?.series?.feels?.find(p=>Date.parse(p.time)>Date.now());
    const n=(v,s='')=>finite(v)?`${Math.round(v*10)/10}${s}`:'Unavailable';
    root.innerHTML=`<p><strong>Current station inputs:</strong> ${esc(c.stationName||c.station||'Forecast estimate')}${finite(c.stationDistanceKm)?` · ${Math.round(c.stationDistanceKm/1.609344)} miles away`:''}; ${esc(c.time||'time unavailable')}. Air ${n(c.temperature,'°F')}, dew point ${n(c.dewpoint,'°F')}, wind ${n(c.wind,' mph')}. Outdoor UTCI ${n(data.comfort?.rawOutdoors,'°F')}.</p>${next?`<p><strong>Next forecast hour — separate inputs:</strong> ${esc(next.time)}. Air ${n(next.inputs.temperature,'°F')}, dew point ${n(next.inputs.dewpoint,'°F')}, wind ${n(next.inputs.wind,' mph')}, cloud cover ${n(next.inputs.skyCover,'%')}. Outdoor UTCI ${n(next.value,'°F')}.</p>`:''}<p>${esc(e.windPolicy||'')} · ${esc(e.radiationBasis||'')}. Station estimates are not copied into future forecasts. No output is raised or lowered to make values match.</p>`;
  }''')
p='public/weather-fusion/index.html'
edit(p,'What could change - Dan\'s take',"Dan's take")
edit(p,'<p id="skin-science">','<div id="thermal-input-evidence"></div><p id="skin-science">')
edit(p,'app.js?v=14-dated-dans-take','app.js?v=integrity-v1')
edit(p,'hourly-feels.css?v=3-outdoor','hourly-feels.css?v=integrity-v1')
p='public/weather-fusion/experience.js'
edit(p,'<span class="daily-feels">Feels ${degrees(p.tonight?feel.low?.low?.value:feel.high?.high?.value)}','<span class="daily-feels"><span>Feels</span><b>${degrees(p.tonight?feel.low?.low?.value:feel.high?.high?.value)}</b>')
edit(p,'<span class="daily-feels">Feels ${degrees(feel.low?.low?.value)}','<span class="daily-feels"><span>Feels</span><b>${degrees(feel.low?.low?.value)}</b>')
with Path('public/weather-fusion/hourly-feels.css').open('a') as f:
    f.write('''\n/* Two- and three-digit feels-like values share exactly the air-temperature axis. */
.day-row .day-high,.day-row .day-low{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0}
.day-row .daily-feels{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;width:100%;line-height:1.35}
.day-row .daily-feels b{display:block;font:inherit;font-weight:700;white-space:nowrap}
''')
# Uniform cache bust for the actual changed dependency graph.
for p in Path('public/weather-fusion').glob('*.js'):
    s=p.read_text();s=re.sub(r"(\./(?:weather-math|utci|weather-display|experience|outdoor-feels|hourly-feels|personal-details|comfort-outlook|dans-take)\.js)(?:\?v=[^'\"]*)?(?=['\"])",r'\1?v=integrity-v1',s);p.write_text(s)
print('Applied forecast integrity repair; no output cap, smoothing, or warmer-index override.')
