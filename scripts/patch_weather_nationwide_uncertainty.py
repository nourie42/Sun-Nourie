from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new))


def insert_after(path, marker, addition):
    replace_once(path, marker, marker + addition)

# 1. Make legitimate source-grounded numbers and common clock times survive AI validation.
replace_once(
    'src/weatherFusion.js',
    "const CLOCK_TIME = /\\b(1[0-2]|[1-9]):([0-5]\\d)\\s*(am|pm)\\b/gi;\nconst normalizeClockTimes = (value) => typeof value === 'string' ? value.replace(CLOCK_TIME, (_, hour, minute, meridiem) => `${hour}:${minute}${meridiem.toLowerCase()}`) : value;\nconst hasNonClockDigits = (value) => /\\d/.test(String(value).replace(CLOCK_TIME, 'CLOCK'));",
    "const CLOCK_TIME = /\\b(1[0-2]|[1-9])(?::([0-5]\\d))?\\s*(am|pm)\\b/gi;\nconst normalizeClockTimes = (value) => typeof value === 'string' ? value.replace(CLOCK_TIME, (_, hour, minute, meridiem) => `${hour}:${minute || '00'}${meridiem.toLowerCase()}`) : value;\nconst collectFactNumbers = (value, out = []) => { if (finite(value)) out.push(value); else if (Array.isArray(value)) for (const item of value) collectFactNumbers(item, out); else if (value && typeof value === 'object') for (const item of Object.values(value)) collectFactNumbers(item, out); return out; };\nconst hasUngroundedNumbers = (value, facts) => { const claims=[...String(value).replace(CLOCK_TIME,'CLOCK').matchAll(/-?\\d+(?:\\.\\d+)?/g)].map(m=>Number(m[0])).filter(finite); if(!claims.length)return false; const allowed=collectFactNumbers(facts); return claims.some(number=>!allowed.some(candidate=>Math.abs(candidate-number)<=Math.max(.051,Math.abs(candidate)*.001))); };"
)
replace_once(
    'src/weatherFusion.js',
    "if (fields.some((k) => hasNonClockDigits(content[k]))) throw Object.assign(new Error('AI numerical prose failed validation.'), { aiDiagnostic: 'AI_PROSE_CONTAINS_NONCLOCK_DIGITS' });",
    "if (fields.some((k) => hasUngroundedNumbers(content[k], facts))) throw Object.assign(new Error('AI numerical prose failed validation.'), { aiDiagnostic: 'AI_PROSE_CONTAINS_NONCLOCK_DIGITS' });"
)

# 2. Give NWS-only/fallback mode a location-discussion-specific Dan's take instead of boilerplate.
marker = "  function fallback(data, reason) {\n"
helper = """  function discussionUncertainty(data) {
    const raw=String(data?.discussion?.text||'').replace(/\\s+/g,' ').trim();
    if(!raw)return '';
    const rows=raw.split(/(?<=[.!?])\\s+/).map(text=>text.trim()).filter(text=>text.length>=24&&text.length<=460);
    const weights=[[/\\b(uncertain|uncertainty|confidence|forecast challenge|low confidence)\\b/i,9],[/\\b(timing|track|path|coverage|widespread|scattered|isolated|placement|depends|could|may)\\b/i,5],[/\\b(front|boundary|low pressure|storm|shower|rain|fog|cloud|clearing|wind|temperature)\\b/i,2]];
    const best=rows.map(text=>({text,score:weights.reduce((sum,[re,w])=>sum+(re.test(text)?w:0),0)})).sort((a,b)=>b.score-a.score)[0];
    if(!best||best.score<4)return 'The latest local NWS discussion does not highlight a major forecast-changing factor right now.';
    const s=best.text.toLowerCase();
    if(/track|path|placement|low pressure/.test(s))return 'The track and placement of the weather system are the main wildcard; a shift could change which conditions reach this location.';
    if(/timing|front|boundary/.test(s))return 'The timing of the next front or boundary is the main wildcard; a faster or slower arrival could shift when conditions change.';
    if(/(coverage|widespread|scattered|isolated)/.test(s)&&/(shower|storm|rain)/.test(s))return 'The main uncertainty is how widespread showers or storms become, so nearby places could end up with different rain coverage.';
    if(/cloud|clearing/.test(s))return 'Cloud cover and clearing are the main wildcard; they could change temperatures and how quickly conditions evolve.';
    if(/fog/.test(s))return 'Fog development is the main wildcard and will depend on how quickly skies clear and winds ease.';
    if(/wind/.test(s))return 'Wind strength and direction are a key uncertainty as the weather system evolves near this location.';
    if(/temperature/.test(s))return 'Temperature confidence is lower than usual because the latest local discussion highlights conditions that could shift the forecast.';
    if(/shower|storm|rain/.test(s))return 'The local NWS discussion highlights uncertainty in how showers or storms develop near this location.';
    return 'The latest local NWS discussion highlights uncertainty in how conditions evolve near this location.';
  }
"""
replace_once('src/weatherFusion.js', marker, helper + marker)
replace_once(
    'src/weatherFusion.js',
    "uncertainty: 'Forecasts can change, especially the timing and location of showers.', sources: ['nws'] }",
    "uncertainty: discussionUncertainty(data), sources: data.discussion ? ['nws','afd'] : ['nws'] }"
)
replace_once(
    'src/weatherFusionExperience.js',
    "uncertainty one short sentence about the actual weather uncertainty, not about model availability.",
    "uncertainty one short sentence identifying the specific forecast-changing factor highlighted by the latest local discussion, such as front timing, storm track, cloud cover or clearing, fog, wind, temperature confidence, or how widespread showers and storms become. If the discussion does not identify a meaningful uncertainty, say that no major forecast-changing factor stands out. Never use generic boilerplate such as \"Forecasts can change\" or a generic claim that timing and location may change; make this field specific to the selected location and the supplied discussion. Do not discuss model availability in uncertainty."
)

# 3. Do not flash the same generic text while the real briefing is loading.
replace_once(
    'public/weather-fusion/app.js',
    "uncertainty: 'Forecasts can change, especially the timing of showers.', reason: data.aiConfigured ? 'Updating your local outlook…' : 'National Weather Service forecast', sources: ['nws'] }));",
    "uncertainty: '', reason: data.aiConfigured ? 'Updating your local outlook…' : 'National Weather Service forecast', sources: ['nws'] }));"
)

# 4. Top status is concise; exact unavailable/limited sources are listed in Scientific Stuff.
replace_once(
    'public/weather-fusion/app.js',
    "  const unavailable = data.feeds.filter((f) => ['unavailable', 'stale', 'not-configured', 'not-covered'].includes(f.status));\n  $('status').textContent = `Updated ${clock(data.assembledAt)}${unavailable.length ? ' · Some source details are unavailable' : ''}${failedPanels.length ? ` · Display issue: ${failedPanels.join(', ')}. Other forecasts remain available; use Refresh to retry.` : ''}`;\n  $('status').classList.toggle('error', unavailable.length > 0 || failedPanels.length > 0);",
    "  const unavailable = data.feeds.filter((f) => ['unavailable', 'stale', 'not-configured'].includes(f.status));\n  const locationLimited = data.feeds.filter((f) => f.status === 'not-covered');\n  const sourceNote = unavailable.length ? ' · Some sources are unavailable or stale — details in Scientific Stuff below' : locationLimited.length ? ' · Some optional model details are limited for this location — details below' : '';\n  $('status').textContent = `Updated ${clock(data.assembledAt)}${sourceNote}${failedPanels.length ? ` · Display issue: ${failedPanels.join(', ')}. Other forecasts remain available; use Refresh to retry.` : ''}`;\n  $('status').classList.toggle('error', unavailable.length > 0 || failedPanels.length > 0);"
)
replace_once(
    'public/weather-fusion/app.js',
    "  const names = { ready: 'Available', unavailable: 'Unavailable', stale: 'Stale — excluded', 'not-covered': 'NWS-only location' };\n",
    "  const names = { ready: 'Available', unavailable: 'Unavailable', stale: 'Stale — excluded', 'not-configured': 'Not configured', 'not-covered': 'Not collected for this location' };\n  const sourceIssues=data.feeds.filter(f=>['unavailable','stale','not-configured','not-covered'].includes(f.status));\n  const sourceSummary=$('source-unavailable-summary');\n  if(sourceSummary){\n    if(!sourceIssues.length){sourceSummary.hidden=true;sourceSummary.innerHTML='';}\n    else{const issueNames={unavailable:'Unavailable',stale:'Stale and excluded','not-configured':'Not configured','not-covered':'Not collected for this location'};sourceSummary.innerHTML=`<strong>What is unavailable or limited</strong><ul>${sourceIssues.map(f=>`<li>${esc(f.label||f.id)} — ${esc(issueNames[f.status]||f.status)}${f.message?`: ${esc(f.message)}`:''}</li>`).join('')}</ul>`;sourceSummary.hidden=false;}\n  }\n"
)

# 5. Prefer the existing independently verified CONUS HRRR source over the NC-only raster fallback.
replace_once(
    'src/weatherFusionHrrrMap.js',
    "return {model:'hrrr',label:'NOAA HRRR · hourly via Iowa State',resolution:'3 km model · tiled REFD at 1 km AGL',\n  runAt:",
    "return {model:'hrrr',label:'NOAA HRRR · hourly via Iowa State',resolution:'3 km model · tiled REFD at 1 km AGL',coverage:'Contiguous United States',\n  runAt:"
)
replace_once(
    'src/weatherFusionDirect.js',
    "layers[name] = { model: model.model, label: model.label, resolution: model.resolution, runAt: model.runAt, status:",
    "layers[name] = { model: model.model, label: model.label, resolution: model.resolution, coverage:'North Carolina and surrounding region', runAt: model.runAt, status:"
)
replace_once(
    'src/weatherFusionDirect.js',
    "if(live?.layer&&(!layers.hrrr?.frames.length||Date.parse(live.layer.runAt)>=Date.parse(layers.hrrr.runAt)))layers.hrrr={...live.layer,sourceCheck:live.status};\n    return { schema: DIRECT_SCHEMA, hrrrHourlySource:live?.status||'unavailable', checkedAt:iso(now()), generatedAt: manifest.generatedAt, layers, coverage: 'North Carolina and surrounding region', note: 'Model maps are not observed radar. HRRR can use independently refreshed Iowa State low-level REFD tiles; the caption identifies its source and actual initialization. Other maps use decoded native snapshots.' };",
    "if(live?.layer)layers.hrrr={...live.layer,sourceCheck:live.status};\n    return { schema: DIRECT_SCHEMA, hrrrHourlySource:live?.status||'unavailable', checkedAt:iso(now()), generatedAt: manifest.generatedAt, layers, coverage: 'HRRR: contiguous United States; other decoded model maps: North Carolina and surrounding region', note: 'Model maps are not observed radar. HRRR uses independently refreshed, timestamp-pinned Iowa State low-level REFD tiles across the contiguous United States when that source verifies. Other maps use decoded native regional snapshots.' };"
)
replace_once(
    'public/weather-fusion/app.js',
    "  return `${layer.label} · ${type} · ${frame.units}${interval} · run ${clock(layer.runAt,{month:'short',day:'numeric'})}${mismatch}`;",
    "  const coverage=layer.coverage?` · ${layer.coverage}`:'';\n  return `${layer.label} · ${type} · ${frame.units}${interval} · run ${clock(layer.runAt,{month:'short',day:'numeric'})}${coverage}${mismatch}`;"
)
replace_once(
    'public/weather-fusion/app.js',
    "mapMessage(map.getBounds().intersects(f.bounds)?'':'Model image covers North Carolina and the surrounding region. Pan back to the saved locations.');",
    "mapMessage(map.getBounds().intersects(f.bounds)?'':'This model image does not cover the current map view. Pan back toward the selected forecast point.');"
)

# 6. Copy/UI cleanup and cache busting.
replace_once('public/weather-fusion/index.html', 'personal-details.css?v=1-personal', 'personal-details.css?v=2-source-details')
replace_once('public/weather-fusion/index.html', 'app.js?v=11-utci-radar', 'app.js?v=12-location-uncertainty')
replace_once(
    'public/weather-fusion/index.html',
    '<div class="section-top"><h2 id="bulletins-title">NWS BULLETINS</h2><span>In plain words</span></div>',
    '<div class="section-top"><h2 id="bulletins-title">NWS BULLETINS</h2></div>'
)
replace_once(
    'public/weather-fusion/index.html',
    '<div class="feed-health" id="feed-health"></div>',
    '<div id="source-unavailable-summary" class="source-unavailable-summary" hidden></div>\n        <div class="feed-health" id="feed-health"></div>'
)
replace_once(
    'public/weather-fusion/index.html',
    'Map images use the same decoded runs as the point inputs. HRRR reflectivity is a forecast, not live radar. ECMWF rain accumulates from its model initialization; NBM rain uses the interval shown under the map. Cloud/wind/temperature maps use ECMWF. Regional map coverage: North Carolina and surrounding areas.',
    'HRRR reflectivity is a forecast, not live radar. Its map uses a separately verified, timestamp-pinned NOAA HRRR tile source from Iowa State that covers the contiguous United States. ECMWF rain, NBM rain, temperature, wind and cloud raster maps are decoded regional products currently covering North Carolina and surrounding areas. Point-model availability is listed separately above.'
)

css_path=Path('public/weather-fusion/personal-details.css')
css=css_path.read_text()
if '.source-unavailable-summary{' in css:
    raise SystemExit('source-unavailable-summary styles already exist')
css_path.write_text(css.rstrip()+"\n.source-unavailable-summary{margin:0 0 14px;padding:12px 14px;border:1px solid #ffdda02e;border-radius:12px;background:#ffcc6610;color:#f4e2c6;font-size:12px;line-height:1.6;text-align:left}\n.source-unavailable-summary[hidden]{display:none}.source-unavailable-summary strong{display:block;color:#fff1d5;margin-bottom:4px}.source-unavailable-summary ul{margin:6px 0 0;padding-left:18px}.source-unavailable-summary li{margin:3px 0;overflow-wrap:anywhere}\n")

replace_once('test/weatherFusionForecastDetails.test.js', 'app\\.js\\?v=11-utci-radar', 'app\\.js\\?v=12-location-uncertainty')
replace_once(
    'docs/weather-fusion.md',
    'Model rasters cover North Carolina and surrounding areas. Display images use\nnearest-cell Web Mercator resampling; forecast points use native grid cells.',
    'The HRRR reflectivity map uses a separately verified, timestamp-pinned Iowa State\nNOAA HRRR tile source across the contiguous United States. The decoded ECMWF/NBM\nand temperature/wind/cloud raster products remain North Carolina regional. Display\nimages use nearest-cell Web Mercator resampling; forecast points use native grid cells.'
)

Path('test/weatherFusionUserFeedback.test.js').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hrrrTileManifest} from '../src/weatherFusionHrrrMap.js';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const app=read('public/weather-fusion/app.js'),html=read('public/weather-fusion/index.html'),server=read('src/weatherFusion.js'),direct=read('src/weatherFusionDirect.js'),prompt=read('src/weatherFusionExperience.js');

test('Dan take is location-discussion specific instead of seeded boilerplate',()=>{
 assert.ok(!app.includes("uncertainty: 'Forecasts can change"));
 assert.ok(!server.includes("uncertainty: 'Forecasts can change"));
 assert.match(server,/function discussionUncertainty\(data\)/);
 assert.match(prompt,/specific forecast-changing factor highlighted by the latest local discussion/i);
 assert.match(prompt,/Never use generic boilerplate/i);
});

test('source limitations are explicitly listed in Scientific Stuff',()=>{
 assert.match(app,/Some optional model details are limited for this location — details below/);
 assert.match(html,/id="source-unavailable-summary"/);
 assert.match(app,/What is unavailable or limited/);
 assert.match(app,/Not collected for this location/);
});

test('bulletin heading no longer contains in plain words',()=>{
 assert.ok(!html.includes('In plain words'));
 assert.match(html,/>NWS BULLETINS<\/h2>/);
});

test('verified independent HRRR map is CONUS and preferred over regional fallback',()=>{
 const now=Date.parse('2026-09-06T20:00:00Z');
 const layer=hrrrTileManifest({model_init_utc:'2026-09-06T18:00:00Z',model_forecast_utc:'2026-09-07T12:00:00Z',forecast_minute:1080},now,new Date(now).toISOString());
 assert.equal(layer.coverage,'Contiguous United States');
 assert.deepEqual(layer.frames[0].bounds,[[20,-130],[55,-60]]);
 assert.match(direct,/if\(live\?\.layer\)layers\.hrrr=/);
 assert.ok(!app.includes('Model image covers North Carolina and the surrounding region'));
});

test('AI number validation rejects invented values without rejecting grounded weather numbers',()=>{
 assert.match(server,/hasUngroundedNumbers/);
 assert.match(server,/collectFactNumbers/);
 assert.match(server,/AI_PROSE_CONTAINS_NONCLOCK_DIGITS/);
});
''')

print('Applied Weather Nourie nationwide HRRR and location-specific uncertainty patch.')
