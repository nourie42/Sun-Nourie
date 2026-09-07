from pathlib import Path
import re

def edit(path,old,new,count=1):
 p=Path(path);s=p.read_text()
 if s.count(old)!=count:raise RuntimeError(f'{path}: anchor count {s.count(old)} expected {count}: {old[:100]}')
 p.write_text(s.replace(old,new))

path='src/weatherFusion.js'
edit(path,"import {stationWeather", "import {CHANGES_VERSION,changeContext,validateChanges,CHANGE_SCHEMA,CHANGE_INSTRUCTIONS} from '../public/weather-fusion/forecast-changes.js';\nimport {stationWeather")
p=Path(path);s=p.read_text();a=s.index('  function discussionUncertainty(data) {');b=s.index('  function fallback(data, reason)',a);s=s[:a]+s[b:];p.write_text(s)
edit(path,"uncertainty: discussionUncertainty(data),", "uncertainty: '', forecastChanges: [], changesVersion: CHANGES_VERSION,")
edit(path,"const briefing = await aiCache.get(data.signature, 30 * MINUTE, async () => {", "const changeEvidence=changeContext(data,now());\n    const briefingKey=`${CHANGES_VERSION}:${data.signature}:${Math.floor(now()/(15*MINUTE))}`;\n    const briefing = await aiCache.get(briefingKey, 15 * MINUTE, async () => {")
edit(path,"['headline', 'summary', 'nearTerm', 'extended', 'uncertainty']", "['headline', 'summary', 'nearTerm', 'extended']",2)
edit(path,"properties.sources = { type: 'array'", "properties.forecastChanges=CHANGE_SCHEMA;\n      properties.sources = { type: 'array'")
edit(path,"const facts = { currentLocalTime:", "const facts = { forecastChangeEvidence:changeEvidence, currentLocalTime:")
edit(path,"instructions: PLAIN_OUTLOOK_INSTRUCTIONS,", "instructions: PLAIN_OUTLOOK_INSTRUCTIONS+' '+CHANGE_INSTRUCTIONS,")
edit(path,"return { ...content, mode: 'ai', signature:", "const forecastChanges=validateChanges(content.forecastChanges,changeEvidence,now());\n        return { ...content, forecastChanges, uncertainty:forecastChanges.map(c=>`${c.periodLabel}: ${c.summary}`).join('\\n\\n'),changesVersion:CHANGES_VERSION, mode: 'ai', signature:")
edit(path,"if (briefing.mode !== 'ai') aiCache.values.delete(data.signature);\n    return briefing;", "if (briefing.mode !== 'ai') aiCache.values.delete(briefingKey);\n    // Recheck validity on every cache hit; an ended event is never made current by retrieval.\n    const active=(briefing.forecastChanges||[]).filter(c=>c.discussionId===data.discussion?.id&&Date.parse(c.validUntil)>now()&&now()-Date.parse(c.discussionIssuedAt)<=12*HOUR);\n    return {...briefing,forecastChanges:active,uncertainty:active.map(c=>`${c.periodLabel}: ${c.summary}`).join('\\n\\n')};")
edit(path,"result.aiConfigured = !!env.OPENAI_API_KEY;", "result.aiConfigured = !!env.OPENAI_API_KEY;\n      result.changesVersion=CHANGES_VERSION;\n      result.thermalAuditVersion='weather-nourie-thermal-audit-v1';")
# Preserve the source precision through calculations; rounding belongs to the display.
edit(path,"temperature: rounded(toF(o.temperature))", "temperature: toF(o.temperature)")
edit(path,"humidity: rounded(o.relativeHumidity?.value), dewpoint: rounded(toF(o.dewpoint))", "humidity: numeric(o.relativeHumidity?.value), dewpoint: toF(o.dewpoint)")
edit(path,"wind: rounded(toMph(o.windSpeed))", "wind: toMph(o.windSpeed)")
edit(path,"'weather-repair.css','utci.js'", "'weather-repair.css','utci.js','outdoor-feels.js','forecast-changes.js'")

p=Path('src/weatherFusionExperience.js');s=p.read_text()
s,n=re.subn(r'uncertainty one short sentence.*?Do not discuss model availability in uncertainty\.', 'forecastChanges must identify only a specific forecast-changing factor highlighted by the latest local discussion with future-dated evidence, or be an empty array. Never use generic boilerplate. Do not invent a concern when none is supported.',s)
assert n==1;nothing=p.write_text(s)

# UTCI remains the single all-season fallback from the research document. There
# is no threshold at 75 F, no max(UTCI,Steadman), and no forced-warm result.
p=Path('public/weather-fusion/weather-math.js');s=p.read_text()
a=s.index('/** Tier-3 operational fallback');b=s.index('function genericMrtDeltaC',a)
s=s[:a]+'''/** All-season UTCI fallback. Mean radiant temperature is an estimate, not a
 * person-level measurement. Do not choose whichever unrelated index is warmer. */
export function thermalHumidity(current){
 if(finite(current?.dewpoint))return humidityFromDewpoint(current.temperature,current.dewpoint);
 return finite(current?.humidity)&&current.humidity>=0&&current.humidity<=100?current.humidity:null;
}
'''+s[b:]
a=s.index('export function tier3FeelsLike');b=s.index('export function thermalComfort',a)
s=s[:a]+'''export function tier3FeelsLike(current,location,now,exposure='shade') {
  if(!finite(current?.temperature)||!finite(current?.wind)||current.wind<0)return {value:null,method:'Tier-3 UTCI inputs unavailable'};
  const rh=thermalHumidity(current);
  if(!finite(rh))return {value:null,method:'Tier-3 UTCI moisture unavailable'};
  const elevation=solarElevation(now,location?.latitude,location?.longitude),deltaC=genericMrtDeltaC(current.condition,elevation,exposure);
  const tr=current.temperature+deltaC*1.8,windUsedMps=Math.max(.5,current.wind*.44704);
  const value=utciF(current.temperature,tr,current.wind,rh);
  return {value,method:finite(value)?'UTCI Tier-3 fallback with estimated mean radiant temperature':'UTCI input outside supported range',rh,tr,deltaMrtC:deltaC,windUsedMps,
   windPolicy:current.wind*.44704<.5?'Calm-wind approximation at the published minimum of 0.5 m/s':'Source wind, converted from mph to m/s',
   humiditySource:finite(current.dewpoint)?'Calculated from the same sample air temperature and dew point':'Source relative humidity',
   radiationBasis:!finite(elevation)?'Solar geometry unavailable':elevation<=0?'No short-wave sunlight; unmeasured nighttime MRT assumed equal to air temperature':'MRT estimated from solar elevation and sky state; radiation not measured',
   warmerResultOverride:false};
}

'''+s[b:]
s=s.replace('const rh=finite(current.humidity)?current.humidity:humidityFromDewpoint(current.temperature,current.dewpoint);','const rh=thermalHumidity(current);')
s=s.replace('Math.round(outdoor.value):shadeValue','Math.round(outdoor.value):null')
s=s.replace('return {shade:shadeValue,sun:', 'return {rawShade:shade.value,rawOutdoors:outdoor.value,inputEvidence:{temperature:current.temperature,dewpoint:current.dewpoint,humidity:rh,windMph:current.wind,windUsedMps:outdoor.windUsedMps,windPolicy:outdoor.windPolicy,humiditySource:outdoor.humiditySource,radiationBasis:outdoor.radiationBasis,meanRadiantTemperatureF:outdoor.tr,sourceTime:current.time||new Date(now).toISOString(),sourceType:current.type||\'guidance\',station:current.station||null,stationDistanceKm:current.stationDistanceKm??null},shade:shadeValue,sun:')
s=s.replace('In warm humid air, the warmer Steadman vapor-pressure apparent temperature is retained as a safeguard, so cloud cover can reduce radiant heating without wiping out the dew-point effect.', 'The published UTCI equation is used without selecting a warmer formula or forcing an offset above air temperature. Humidity is already an input. In calm conditions its supported minimum wind is used and disclosed; high winds outside its domain remain unavailable. Nighttime short-wave solar load is zero; local long-wave radiation and body-level wind are not measured.')
p.write_text(s)

p=Path('public/weather-fusion/utci.js');s=p.read_text()
s=s.replace('tdb<=-50||tdb>=50||d<=-30||d>=70||v<=.5||v>=17','tdb<-50||tdb>50||d<-30||d>70||v<.5||v>17')
s=s.replace('!finite(windMph))return null;const v=Math.max(.51,Math.min(16.99,windMph*.44704));','!finite(windMph)||windMph<0)return null;const v=Math.max(.5,windMph*.44704);')
p.write_text(s)

path='src/weatherFusionHourlyFeels.js'
edit(path,'out.comfort=out.comfort||thermalComfort(out.current,out.location,now);','out.comfort=thermalComfort(out.current,out.location,now);')
edit(path,'UTCI remains the all-season base; in warm humid air the warmer Steadman vapor-pressure result is kept as a moisture safeguard so cloud cover does not erase the dew-point effect.', 'The published UTCI equation is the all-season base, without a warmer-formula override. Source wind, calm-wind handling and estimated radiation are disclosed separately.')
edit(path,"source:estimate.method,alignmentFactor:0", "source:estimate.method,inputEvidence:sun.inputEvidence,alignmentFactor:0")

path='public/weather-fusion/weather-display.js'
edit(path,'const comfort = forecast.comfort || thermalComfort(current, forecast.location, finite(assembled) ? assembled : now);','const comfort = thermalComfort(current, forecast.location, finite(assembled) ? assembled : now);')
# A corrupt cached number must fail validation, not overwrite a correctly calculated figure.
old="""  // The API series is canonical. Never overwrite outdoors with shade, or let
  // the illustration independently recalculate a different displayed number.
  const comfort = {...estimated,outdoors:point.value,
    shade:Object.hasOwn(point,'shadeValue')?point.shadeValue:estimated.shade,
    sun:estimated.daylight && ['clear','partly-cloudy'].includes(estimated.weatherKind)?point.value:null};"""
new="""  const rounded=v=>finite(v)?Number(v.toFixed(1)):null;
  const calculated=rounded(estimated.rawOutdoors);
  if((finite(calculated)!==finite(point.value))||(finite(calculated)&&Math.abs(calculated-point.value)>.11))return null;
  const comfort = {...estimated,outdoors:calculated,shade:rounded(estimated.rawShade),
    sun:estimated.sun===null?null:calculated};"""
edit(path,old,new)
edit(path,"...(forecast?.hours || []).filter(hour => Date.parse(hour.time) > now)", "...(forecast?.hours || []).filter(hour => Date.parse(hour.time)+3600000 > now)")
edit(path,"${sample.now ? 'Current' : finite(sample.pop)", "${sample.now ? 'Station estimate' : finite(sample.pop)")
edit(path,"return sample.now ? `Current conditions · ${sample.source === 'Station observation' ? 'station reading' : 'estimate'} at ${time}`", "const station=sample.inputs?.station,km=sample.inputs?.stationDistanceKm;\n  const site=station?` · ${station}${finite(km)?` · ${Math.round(km/1.609344)} mi away`:''}`:'';\n  return sample.now ? `Current conditions · ${sample.source === 'Station observation' ? 'station estimate' : 'forecast estimate'}${site} at ${time}`")

path='public/weather-fusion/app.js'
edit(path,"import {weatherIcon", "import {changesText,activeChanges} from './forecast-changes.js';\nimport {weatherIcon")
edit(path,"  $('briefing-detail').innerHTML =", "  const uncertainty=changesText(data,forecast);\n  $('briefing-detail').innerHTML =")
edit(path,"<div><strong>What could change - Dan's take</strong><p>${esc(data.uncertainty || '')}</p></div>", "<div data-dans-take-detail ${uncertainty?'':'hidden'}><strong>Dan's take</strong><p>${esc(uncertainty)}</p></div>")
edit(path,"  const uncertainty = typeof data.uncertainty === 'string' ? data.uncertainty.trim() : '';\n",'')
# Preserve evidence at the bottom, not in the headline card.
edit(path,"\n}\nasync function load({ moveMap", "\n  const evidence=activeChanges(data,forecast);\n  if(evidence.length)$('outlook-science').innerHTML+=`<details><summary>Dan's take — source evidence</summary>${evidence.map(c=>`<p><strong>${esc(c.periodLabel)}</strong> · NWS ${esc(c.office)} · section issued ${esc(c.sectionIssuedAt)}</p><blockquote>${esc(c.text)}</blockquote>`).join('')}</details>`;\n}\nfunction expireDansTake(){\n const text=changesText(currentBriefing,forecast),root=$('today-uncertainty'),body=$('today-uncertainty-text');\n if(root&&body){body.textContent=text;root.hidden=!text;}\n const detail=document.querySelector('[data-dans-take-detail]');\n if(detail){detail.hidden=!text;const p=detail.querySelector('p');if(p)p.textContent=text;}\n}\nasync function load({ moveMap")
with Path(path).open('a') as f:f.write("\nsetInterval(expireDansTake,60000);\ndocument.addEventListener('visibilitychange',expireDansTake);\n")
# Input provenance explains observed versus forecast estimates without changing either.
edit(path,"function renderEvidence(data) {", """function renderEvidence(data) {
  const inputRoot=$('thermal-input-evidence');
  if(inputRoot){
    const c=data.current||{},rows=data.metricForecasts?.series?.feels||[],at=Date.now();
    const currentHour=rows.find(p=>Date.parse(p.time)<=at&&at<Date.parse(p.time)+3600000);
    const n=(v,suffix='')=>finite(v)?`${Math.round(v*10)/10}${suffix}`:'Unavailable';
    inputRoot.innerHTML=`<p><strong>Current station sample</strong>: ${esc(c.stationName||c.station||'Forecast estimate')}${finite(c.stationDistanceKm)?` · ${Math.round(c.stationDistanceKm/1.609344)} miles from the selected point`:''}; ${esc(c.time||'time unavailable')}. Air ${n(c.temperature,'°F')}; dew point ${n(c.dewpoint,'°F')}; wind ${n(c.wind,' mph')}. Calculated outdoor UTCI ${n(data.comfort?.rawOutdoors,'°F')}.</p>${currentHour?`<p><strong>Current-hour forecast, kept separate</strong>: ${esc(currentHour.time)}. Air ${n(currentHour.inputs?.temperature,'°F')}; dew point ${n(currentHour.inputs?.dewpoint,'°F')}; wind ${n(currentHour.inputs?.wind,' mph')}. Calculated outdoor UTCI ${n(currentHour.value,'°F')}.</p>`:''}<p>${esc(data.comfort?.inputEvidence?.windPolicy||'')}. ${esc(data.comfort?.inputEvidence?.radiationBasis||'')}. The station estimate is not copied into the hourly forecast. Sun, shade, and future hours are distinct exposures and samples; equal-looking displays are not a validation of local human sensation.</p>`;
  }""")

path='public/weather-fusion/index.html'
edit(path,"What could change - Dan's take","Dan's take")
edit(path,'app.js?v=13-outdoor-consistency','app.js?v=14-evidence-thermal')
edit(path,'hourly-feels.css?v=3-outdoor','hourly-feels.css?v=4-inputs')
edit(path,'<p id="skin-science">','<div id="thermal-input-evidence"></div><p id="skin-science">')
with Path('public/weather-fusion/hourly-feels.css').open('a') as f:f.write('\n.today-uncertainty p,[data-dans-take-detail] p{white-space:pre-line}\n')
# Cache bust the whole changed dependency graph, including shared math.
for p in Path('public/weather-fusion').glob('*.js'):
 s=p.read_text();s=re.sub(r"(\./(?:weather-math|utci|weather-display|experience|outdoor-feels|hourly-feels|personal-details|comfort-outlook|forecast-changes)\.js)(?:\?v=[^'\"]*)?(?=['\"])",r'\1?v=evidence-v1',s);p.write_text(s)
# The old prompt-string test must now inspect the evidence validator instead of keyword boilerplate.
p=Path('test/weatherFusionUserFeedback.test.js');s=p.read_text().replace(r'assert.match(server,/function discussionUncertainty\(data\)/);',r'assert.match(server,/validateChanges/);');p.write_text(s)
# Existing responsive test fixture has an unverified legacy uncertainty string:
# it should no longer produce a Dan take. The new dedicated suite tests real evidence.
for name in ['scripts/weatherFusionPersonalBrowser.js','scripts/weatherFusionBrowserSmoke.js']:
 p=Path(name);s=p.read_text().replace("What could change - Dan's take","Dan's take")
 if name.endswith('PersonalBrowser.js'):
  s=s.replace("assert.equal(await page.locator('#today-uncertainty-text').innerText(),b.uncertainty);", "assert.equal(await page.locator('#today-uncertainty').isVisible(),false);")
 p.write_text(s)
print('Applied evidence-only Dan take and independently auditable thermal inputs.')
