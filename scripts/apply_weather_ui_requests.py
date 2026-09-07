from pathlib import Path
import re

def edit(path, old, new, count=1):
    p=Path(path); s=p.read_text()
    if s.count(old)!=count:
        raise RuntimeError(f'{path}: expected {count}, got {s.count(old)} for {old[:100]}')
    p.write_text(s.replace(old,new))

# Backend forecast confidence: transparent relative index, not a probability.
p='src/weatherFusion.js'
edit(p,"import {createDiscussionSource,DISCUSSION_SOURCE_VERSION} from './weatherFusionDiscussionSource.js';",
       "import {createDiscussionSource,DISCUSSION_SOURCE_VERSION} from './weatherFusionDiscussionSource.js';\nimport {FORECAST_CONFIDENCE_VERSION,forecastConfidence} from '../public/weather-fusion/forecast-confidence.js';")
edit(p,"    const agreement = spread == null ? 'Limited guidance' : spread <= 3 ? 'Close agreement' : spread <= 6 ? 'Some disagreement' : 'Wide disagreement';",
       "    const agreement = spread == null ? 'Limited guidance' : spread <= 3 ? 'Close agreement' : spread <= 6 ? 'Some disagreement' : 'Wide disagreement';\n    const qpfValues=Object.values(modelValues).map(v=>v.qpf).filter(finite);\n    const qpfSpread=qpfValues.length>=2?max(qpfValues)-min(qpfValues):null;\n    const guidanceCount=Object.values(modelValues).filter(v=>finite(v.high)||finite(v.low)||finite(v.qpf)).length;\n    const confidence=forecastConfidence({dayIndex:index,highSpread:spread,qpfSpread,guidanceCount,officialDay:high!==null,officialNight:low!==null});")
edit(p,"      guidance: modelValues, illustrativeBlend: index === 0 ? blend : null, agreement, highSpread: rounded(spread, 1),",
       "      guidance: modelValues, illustrativeBlend: index === 0 ? blend : null, agreement, highSpread: rounded(spread, 1), qpfSpread:rounded(qpfSpread,2), confidence,")
edit(p,"  output.danTakeVersion=DAN_TAKE_VERSION;",
       "  output.danTakeVersion=DAN_TAKE_VERSION;\n  output.forecastConfidenceVersion=FORECAST_CONFIDENCE_VERSION;")
edit(p,"Model high/low comparisons use calendar days; the NWS low is overnight. Precipitation includes liquid-equivalent snow/ice.' };",
       "Model high/low comparisons use calendar days; the NWS low is overnight. Precipitation includes liquid-equivalent snow/ice. Daily forecast confidence is a relative index, not a probability; it uses lead time, NWS/model high-temperature spread, rainfall-guidance spread, usable guidance coverage, and NWS day/night availability.' };")

# Dan's take: direct wording and one date heading per period.
p='public/weather-fusion/dans-take.js'
edit(p,"if(/forecast(?:s)? can change|no (?:major|meaningful|significant).*uncertaint|main sources? of forecast uncertainty|all clear|guaranteed|perfectly safe|\\b(?:HRRR|ECMWF|NBM|CAPE|QPF|synoptic|advection|deterministic|convection|guidance)\\b/i.test(text))return false;",
       "if(/forecast(?:s)? can change|no (?:major|meaningful|significant).*uncertaint|main sources? of forecast uncertainty|all clear|guaranteed|perfectly safe|\\bforecasters?\\s+(?:indicate|say|expect|think|believe|are unsure)|\\b(?:HRRR|ECMWF|NBM|CAPE|QPF|synoptic|advection|deterministic|convection|guidance)\\b/i.test(text))return false;")
edit(p,"export const danTakeText = items => items.map(item=>`${item.period}: ${item.summary}`).join('\\n\\n');",
       "export function danTakeText(items){\n  const groups=new Map();\n  for(const item of Array.isArray(items)?items:[]){\n    if(!item?.period||!item?.summary)continue;\n    if(!groups.has(item.period))groups.set(item.period,[]);\n    const list=groups.get(item.period),key=item.summary.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();\n    if(!list.some(entry=>entry.key===key))list.push({key,text:item.summary.trim()});\n  }\n  return [...groups].map(([period,list])=>`${period}: ${list.map(x=>x.text).join(' ')}`).join('\\n\\n');\n}")

p='src/weatherFusionExperience.js'
edit(p,"Each item's summary is one or two short sentences in everyday English explaining only the possible change or caveat actually supported by that quote and context.",
       "Each item's summary is one or two short sentences in everyday English explaining only the possible change or caveat actually supported by that quote and context. State the uncertainty directly as Dan's take; never write 'forecasters indicate', 'forecasters say', 'forecasters expect', 'forecasters think', or 'forecasters are unsure'.")

# Figures receive their own actual displayed apparent temperature, so the two outfits can differ.
p='public/weather-fusion/personal-details.js'
edit(p,"${exposureScene(false,daylight,condition)}", "${exposureScene(false,daylight,condition,comfort?.shade)}")
edit(p,"${exposureScene(true,daylight,condition)}", "${exposureScene(true,daylight,condition,outdoorValue)}")
edit(p,"./exposure-scene.js?v=3-weather","./exposure-scene.js?v=ui-requests-v1")

# Exact requested title and browser asset revisions.
p='public/weather-fusion/index.html'
edit(p,'<h2 class="skin-kicker">How’s it really gonna feel?</h2>','<h2 class="skin-kicker" id="skin-kicker">How does it feel outside right now</h2>')
edit(p,'app.js?v=source-v3','app.js?v=ui-requests-v1')
edit(p,'forecast-layout.css?v=3-personal','forecast-layout.css?v=4-confidence')

# Current title stays exact; selected future hour switches tense. Add per-day confidence row.
p='public/weather-fusion/experience.js'
edit(p,"import {weatherState} from './weather-state.js';",
       "import {FORECAST_CONFIDENCE_VERSION} from './forecast-confidence.js';\nimport {weatherState} from './weather-state.js';")
edit(p," const c=sample.comfort,zone=forecast.location.timeZone,summary=comfortWindow(forecast,now+1);",
       " const c=sample.comfort,zone=forecast.location.timeZone,summary=comfortWindow(forecast,now+1);\n const kicker=$('skin-kicker');if(kicker)kicker.textContent=sample.now?'How does it feel outside right now':`How will it feel outside at ${formatTime(sample.time)}?`;")
old="  return `<button class=\"day-row ${p.tonight?'tonight-row':''}\" data-day=\"${i}\" aria-label=\"${esc(p.label)}, ${p.primaryLabel} ${number(p.primary)} degrees${finite(p.secondary)?`, low ${number(p.secondary)} degrees`:''}. Open details.\"><span class=\"day-name\">${esc(p.label)}</span>"
new="  const confidence=d.confidence||{label:'Unavailable',score:null,key:'unavailable',factors:[],note:'Forecast confidence data is unavailable.'};\n  const confidenceTitle=`Forecast confidence: ${confidence.label}. ${confidence.factors?.join('; ')||confidence.note||''} ${confidence.note||''}`.trim();\n  return `<button class=\"day-row ${p.tonight?'tonight-row':''}\" data-day=\"${i}\" aria-label=\"${esc(p.label)}, ${p.primaryLabel} ${number(p.primary)} degrees${finite(p.secondary)?`, low ${number(p.secondary)} degrees`:''}. Forecast confidence ${esc(confidence.label)}. Open details.\"><span class=\"day-name\">${esc(p.label)}</span>"
edit(p,old,new)
old="${p.tonight?'<span class=\"night-label\">☾<small>Overnight</small></span>':`<span class=\"day-low\">${temp(p.secondary)}<small>Low</small><span class=\"daily-feels\"><span>Feels</span><b>${degrees(feel.low?.low?.value)}</b>${feel.low?.partial?' · partial':''}</span></span>`}</button>`;"
new="${p.tonight?'<span class=\"night-label\">☾<small>Overnight</small></span>':`<span class=\"day-low\">${temp(p.secondary)}<small>Low</small><span class=\"daily-feels\"><span>Feels</span><b>${degrees(feel.low?.low?.value)}</b>${feel.low?.partial?' · partial':''}</span></span>`}<span class=\"forecast-confidence\" data-confidence=\"${esc(confidence.key)}\" title=\"${esc(confidenceTitle)}\"><span>Forecast confidence</span><b>${esc(confidence.label)}</b>${finite(confidence.score)?`<i class=\"confidence-meter\" aria-hidden=\"true\"><em style=\"width:${confidence.score}%\"></em></i>`:''}</span></button>`;"
edit(p,old,new)
edit(p," if($('today-forecast'))$('today-forecast').innerHTML='<p class=\"muted\">Daily data is loading.</p>';",
       " if($('today-forecast'))$('today-forecast').innerHTML='<p class=\"muted\">Daily data is loading.</p>';\n if($('skin-kicker'))$('skin-kicker').textContent='How does it feel outside right now';")

# Confidence evidence appears in the day details.
p='public/weather-fusion/app.js'
edit(p,"${dailyGrossHTML(forecast,index,p.tonight)}<a href=\"#scientific-stuff\" class=\"science-link\" id=\"day-science-link\">Scientific stuff ↓</a>`;",
       "${d.confidence?`<div class=\"dialog-confidence\" data-confidence=\"${esc(d.confidence.key)}\"><strong>Forecast confidence: ${esc(d.confidence.label)}</strong><p>${esc(d.confidence.factors.join(' · '))}</p><small>${esc(d.confidence.note)}</small></div>`:''}${dailyGrossHTML(forecast,index,p.tonight)}<a href=\"#scientific-stuff\" class=\"science-link\" id=\"day-science-link\">Scientific stuff ↓</a>`;")

# Explain exactly what confidence means under Scientific Stuff.
p='public/weather-fusion/index.html'
old='<div><strong>AI explains the evidence</strong><p>The AI receives the blended numbers, individual model estimates, HRRR simulated reflectivity and latest local NWS discussion. It cannot change numeric cards or official alerts. Starting blend weights are not a statistically calibrated skill ranking.</p></div>'
new=old+'<div><strong>Forecast confidence</strong><p>Each daily Forecast confidence label is a relative index, not a probability. It starts with lead time and then uses the spread among NWS/model high temperatures, the spread in available rainfall guidance, the number of usable guidance sources, and whether official NWS day/night periods are present. Larger disagreement or missing coverage lowers confidence; a later day can rate better than an earlier day when the scientific guidance agrees better.</p></div>'
edit(p,old,new)

with Path('public/weather-fusion/forecast-layout.css').open('a') as f:
    f.write('''\n/* Relative forecast confidence: evidence-based, explicitly not a probability. */
.forecast-confidence{grid-column:1/-1;display:grid;grid-template-columns:auto auto minmax(54px,90px);justify-content:end;align-items:center;gap:7px;margin:1px 0 4px;color:#b9cce3;font-size:9px;line-height:1.2;text-align:right}
.forecast-confidence>b{font-size:10px;color:#eef6ff;font-weight:750;white-space:nowrap}.confidence-meter{display:block;width:100%;height:4px;background:#10243b88;border-radius:20px;overflow:hidden}.confidence-meter em{display:block;height:100%;background:linear-gradient(90deg,#93cde3,#d8e6b0,#ffd58f);border-radius:20px}
.dialog-confidence{margin:16px 0;padding:12px 14px;border:1px solid #d8e8ff20;border-radius:12px;background:#ffffff08}.dialog-confidence strong{font-size:13px}.dialog-confidence p{margin:5px 0;font-size:11px;line-height:1.5;color:#d3e0f0}.dialog-confidence small{font-size:9px;color:#aebfd4;line-height:1.5;display:block}
.today-panel .forecast-confidence{font-size:10px;margin-top:4px}.today-panel .forecast-confidence>b{font-size:11px}
@media(max-width:600px){.forecast-confidence{grid-template-columns:auto auto 52px;gap:5px;font-size:8px}.forecast-confidence>b{font-size:9px}.today-panel .forecast-confidence{font-size:8px}.today-panel .forecast-confidence>b{font-size:9px}}
''')

# Browser fixture gets real confidence data and verifies the requested visible changes.
p='scripts/weatherFusionPersonalBrowser.js'
s=Path(p).read_text()
s=s.replace("import {thermalComfort,shadeFeelsLike} from '../public/weather-fusion/weather-math.js';",
            "import {thermalComfort,shadeFeelsLike} from '../public/weather-fusion/weather-math.js';\nimport {forecastConfidence} from '../public/weather-fusion/forecast-confidence.js';")
s=s.replace("qpf:.1,qpfWindow:","qpf:.1,confidence:forecastConfidence({dayIndex:i,highSpread:i<2?2:i<5?4:7,qpfSpread:i<3?.04:i<5?.12:.3,guidanceCount:i<2?3:2,officialDay:true,officialNight:true}),qpfWindow:")
anchor="  assert.equal((await page.locator('.brand small').innerText()).trim(),'Because Apple, Google and Samsung weather suck');"
if s.count(anchor)!=1:raise RuntimeError('browser heading anchor')
s=s.replace(anchor,anchor+"\n  assert.equal((await page.locator('#skin-kicker').innerText()).trim(),'How does it feel outside right now');\n  assert.equal(await page.locator('#daily .forecast-confidence').count(),7);\n  assert.ok((await page.locator('#daily .forecast-confidence').allTextContents()).every(t=>t.includes('Forecast confidence')));")
anchor2="  assert.equal(await page.locator('.person-eyes').count(),2);"
if s.count(anchor2)!=1:raise RuntimeError('browser clothing anchor')
s=s.replace(anchor2,"  assert.equal(await page.locator('.sun-shade-comparison svg[data-outfit=\"warm\"]').count(),2,'75–80°F fixture should use warm-weather clothing');\n"+anchor2)
Path(p).write_text(s)

# Cache-bust changed browser dependencies.
for p in Path('public/weather-fusion').glob('*.js'):
    s=p.read_text()
    u=re.sub(r"(\./(?:experience|personal-details|exposure-scene|forecast-confidence|dans-take)\.js)(?:\?v=[^'\"]*)?(?=['\"])",r'\1?v=ui-requests-v1',s)
    if u!=s:p.write_text(u)

print('Applied all remaining requested UI/content changes; feels-like equation unchanged.')
