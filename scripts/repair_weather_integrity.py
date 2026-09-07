from pathlib import Path

BRANCH = 'fix/weather-current-feels-inputs'

def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected text not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

# 1) Keep the observed temperature, but if the selected station omits the
# moisture or wind input required by UTCI, fill ONLY those missing inputs from
# the matching NWS current-hour forecast.  Mark the fill explicitly so the UI
# never presents it as a pure station observation.
replace_once(
    'public/weather-fusion/weather-state.js',
    "const finite = value => typeof value === 'number' && Number.isFinite(value);\nexport function weatherState",
    """const finite = value => typeof value === 'number' && Number.isFinite(value);
function matchingCurrentHour(hours = [], now = Date.now()) {
  return hours.find(row => { const time = Date.parse(row?.time); return finite(time) && time <= now && now < time + 3600000; }) || null;
}
function hourlyWindMph(value) {
  if (finite(value)) return value >= 0 ? value : null;
  const text = String(value || '').trim();
  if (/\\bcalm\\b/i.test(text)) return 0;
  const values = [...text.matchAll(/\\d+(?:\\.\\d+)?/g)].map(match => Number(match[0])).filter(finite);
  return values.length ? values.reduce((sum, number) => sum + number, 0) / values.length : null;
}
function supplementObservedThermal(current, hour) {
  if (current?.type !== 'observation' || !hour) return current || {};
  const patch = {}, fields = [];
  const humidityOk = finite(current.humidity) && current.humidity >= 0 && current.humidity <= 100;
  const dewpointOk = finite(current.dewpoint) && (!finite(current.temperature) || current.dewpoint <= current.temperature + 1);
  if (!dewpointOk) {
    if (humidityOk) {
      if (finite(current.dewpoint)) patch.dewpoint = null;
    } else if (finite(hour.dewpoint)) {
      patch.dewpoint = hour.dewpoint;
      fields.push('dew point');
    } else if (finite(hour.humidity) && hour.humidity >= 0 && hour.humidity <= 100) {
      patch.dewpoint = null;
      patch.humidity = hour.humidity;
      fields.push('humidity');
    }
  }
  if (!finite(current.wind) || current.wind < 0) {
    const wind = hourlyWindMph(hour.wind);
    if (finite(wind)) { patch.wind = wind; fields.push('wind'); }
  }
  if (!fields.length && !Object.keys(patch).length) return current;
  return {...current, ...patch, ...(fields.length ? {
    thermalInputFallbackFields: fields,
    thermalInputFallbackSource: 'NWS current-hour forecast',
    thermalInputFallbackTime: hour.time,
  } : {})};
}
export function weatherState"""
)

old_resolver = """export function resolveCurrentWeather(current, hours = [], now = Date.now(), skyCover = null) {
  const observed = weatherState(current?.condition, current?.skyCover);
  if (observed.known) return {...current, weather: observed,
    conditionSource: current.conditionSource || (current.type === 'observation' ? 'Station weather report' : 'Hourly forecast')};
  const hour = hours.find(row => { const t = Date.parse(row.time); return t <= now && now < t + 3600000; });
  const fallback = weatherState(hour?.condition, skyCover);
  if (fallback.known) return {...current, condition: weatherState(hour?.condition).known ? hour.condition : fallback.label, weather: fallback,
    conditionSource: hour && weatherState(hour.condition).known ? 'NWS current-hour forecast (sky only)' : 'NWS current-hour sky-cover forecast',
    conditionTime: hour?.time || new Date(now).toISOString()};
  return {...current, condition: 'Sky conditions unavailable', weather: weatherState(), conditionSource: 'Sky conditions unavailable'};
}"""
new_resolver = """export function resolveCurrentWeather(current, hours = [], now = Date.now(), skyCover = null) {
  const hour = matchingCurrentHour(hours, now);
  const resolvedCurrent = supplementObservedThermal(current, hour);
  const observed = weatherState(resolvedCurrent?.condition, resolvedCurrent?.skyCover);
  if (observed.known) return {...resolvedCurrent, weather: observed,
    conditionSource: resolvedCurrent.conditionSource || (resolvedCurrent.type === 'observation' ? 'Station weather report' : 'Hourly forecast')};
  const fallback = weatherState(hour?.condition, skyCover);
  if (fallback.known) return {...resolvedCurrent, condition: weatherState(hour?.condition).known ? hour.condition : fallback.label, weather: fallback,
    conditionSource: hour && weatherState(hour.condition).known ? 'NWS current-hour forecast (sky only)' : 'NWS current-hour sky-cover forecast',
    conditionTime: hour?.time || new Date(now).toISOString()};
  return {...resolvedCurrent, condition: 'Sky conditions unavailable', weather: weatherState(), conditionSource: 'Sky conditions unavailable'};
}"""
replace_once('public/weather-fusion/weather-state.js', old_resolver, new_resolver)

# 2) User-facing source labels must say when a station observation needed a
# current-hour forecast fill.  This keeps the restored feels-like numeric while
# preserving provenance.
replace_once(
    'public/weather-fusion/weather-display.js',
    "const esc = value => String(value ?? '').replace(/[&<>\\\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;',\"'\":'&#39;'}[c]));\nexport function weatherShapes",
    """const esc = value => String(value ?? '').replace(/[&<>\\\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;',\"'\":'&#39;'}[c]));
const currentSource = current => current?.type === 'observation'
  ? (Array.isArray(current.thermalInputFallbackFields) && current.thermalInputFallbackFields.length ? 'Station observation + current-hour forecast' : 'Station observation')
  : 'Current estimate';
export function weatherShapes"""
)
replace_once(
    'public/weather-fusion/weather-display.js',
    "    source:current.type === 'observation' ? 'Station observation' : 'Current estimate', inputs:current};",
    "    source:currentSource(current), inputs:current};"
)
replace_once(
    'public/weather-fusion/weather-display.js',
    "<small>${sample.now ? 'Station estimate' : finite(sample.pop) ? `${Math.round(sample.pop)}%` : '—'}</small>",
    "<small>${sample.now ? (sample.source === 'Station observation + current-hour forecast' ? 'Station + forecast fill' : sample.source === 'Station observation' ? 'Station estimate' : 'Current estimate') : finite(sample.pop) ? `${Math.round(sample.pop)}%` : '—'}</small>"
)
replace_once(
    'public/weather-fusion/weather-display.js',
    "  const site=station?` · ${station}${finite(km)?` · ${Math.round(km/1.609344)} mi away`:''}`:'';\n  return sample.now ? `Current conditions · ${sample.source === 'Station observation' ? 'station estimate' : 'forecast estimate'}${site} at ${time}`",
    "  const site=station?` · ${station}${finite(km)?` · ${Math.round(km/1.609344)} mi away`:''}`:'';\n  const currentLabel=sample.source === 'Station observation + current-hour forecast' ? 'station temperature + current-hour forecast fill' : sample.source === 'Station observation' ? 'station estimate' : 'forecast estimate';\n  return sample.now ? `Current conditions · ${currentLabel}${site} at ${time}`"
)
replace_once(
    'public/weather-fusion/weather-display.js',
    "  const source = sample.source === 'Station observation' ? 'based on the current station reading' : 'estimated from forecast data';",
    "  const source = sample.source === 'Station observation + current-hour forecast' ? 'station temperature with matching NWS current-hour moisture/wind fill' : sample.source === 'Station observation' ? 'based on the current station reading' : 'estimated from forecast data';"
)

# 3) Scientific evidence and explanatory copy must not call forecast-filled
# moisture/wind pure station inputs.
replace_once(
    'public/weather-fusion/app.js',
    "    const n=(v,s='')=>finite(v)?`${Math.round(v*10)/10}${s}`:'Unavailable';\n    root.innerHTML=",
    "    const n=(v,s='')=>finite(v)?`${Math.round(v*10)/10}${s}`:'Unavailable';\n    const fallbackFields=Array.isArray(c.thermalInputFallbackFields)?c.thermalInputFallbackFields:[];\n    const currentInputLabel=fallbackFields.length?'Current station + forecast estimate':'Current station inputs';\n    const fallbackNote=fallbackFields.length?` ${esc(fallbackFields.join(' and '))} filled from the matching NWS current-hour forecast.`:'';\n    root.innerHTML="
)
replace_once('public/weather-fusion/app.js', '<strong>Current station inputs:</strong>', '<strong>${currentInputLabel}:</strong>')
replace_once('public/weather-fusion/app.js', "${esc(c.time||'time unavailable')}. Air", "${esc(c.time||'time unavailable')}.${fallbackNote} Air")
replace_once(
    'public/weather-fusion/experience.js',
    'Current observations and future forecasts are different sources; the Now card uses exactly the same observation as the hero.',
    'Current station observations and current-hour forecast fill-ins are tracked separately; the Now card uses the same current inputs as the hero, and any missing station moisture or wind filled from the matching NWS hour is labeled as an estimate.'
)

# 4) Regression: a station with temperature but missing dew point/wind must no
# longer blank the feels-like when the matching NWS hourly forecast has those
# inputs.  A non-matching future hour must not be borrowed.
marker = "test('valid station condition is never silently replaced by a conflicting forecast',()=>{"
insert = """test('incomplete station thermal inputs use only the matching current-hour NWS forecast instead of blanking feels-like',()=>{
 const input={...readings,dewpoint:null,humidity:null,wind:null,condition:'Partly Cloudy'};
 const hours=[{time:'2026-09-06T15:00:00Z',temperature:82,condition:'Partly Cloudy',dewpoint:68,humidity:60,wind:'5 to 7 mph'}];
 const resolved=resolveCurrentWeather(input,hours,now);
 assert.equal(resolved.temperature,input.temperature);assert.equal(resolved.time,input.time);
 assert.equal(resolved.dewpoint,68);assert.equal(resolved.wind,6);
 assert.deepEqual(resolved.thermalInputFallbackFields,['dew point','wind']);
 assert.equal(resolved.thermalInputFallbackSource,'NWS current-hour forecast');
 assert.ok(Number.isFinite(thermalComfort(resolved,location,now).outdoors));
 const sample=currentSample({location,assembledAt:new Date(now).toISOString(),current:resolved},now);
 assert.ok(Number.isFinite(sample.feels));assert.match(sample.source,/current-hour forecast/);
 const futureOnly=resolveCurrentWeather(input,[{...hours[0],time:'2026-09-06T16:00:00Z'}],now);
 assert.equal(futureOnly.dewpoint,null);assert.equal(futureOnly.wind,null);assert.equal(thermalComfort(futureOnly,location,now).outdoors,null);
});
""" + marker
replace_once('test/weatherFusionSkyConsistency.test.js', marker, insert)

# Restore the workflow file after this temporary branch-trigger is used.  The
# verified branch/PR should contain only the product/test repair, not a permanent
# special-case workflow trigger.
workflow = Path('.github/workflows/weather-reviewed-integrity.yml')
if workflow.exists():
    text = workflow.read_text()
    text = text.replace(
        f"branches: [fix/weather-reviewed-integrity, {BRANCH}, main]",
        "branches: [fix/weather-reviewed-integrity, main]",
    )
    text = text.replace(
        f"if: github.ref == 'refs/heads/fix/weather-reviewed-integrity' || github.ref == 'refs/heads/{BRANCH}'",
        "if: github.ref == 'refs/heads/fix/weather-reviewed-integrity'",
    )
    workflow.write_text(text)

print('Applied current feels-like missing-input repair with explicit provenance.')
