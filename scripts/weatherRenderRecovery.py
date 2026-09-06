from pathlib import Path

def replace(path, old, new):
    p=Path(path); s=p.read_text()
    assert s.count(old)==1, f'{path}: replacement anchor not unique'
    p.write_text(s.replace(old,new,1))

replace('public/weather-fusion/dewpoint-meter.js',
        'graph(pts,horizon,Math.max(280,panel.clientWidth-40))',
        'graph(pts,horizon,zone,Math.max(280,panel.clientWidth-40))')
replace('public/weather-fusion/experience.js',
        "import {renderDewpointMeter,resetDewpointMeter} from './dewpoint-meter.js';",
        "import {resetDewpointMeter} from './dewpoint-meter.js';")
replace('public/weather-fusion/experience.js',' renderDewpointMeter(forecast,now);\n','')
replace('public/weather-fusion/app.js',
        "import {heroWeather} from './hero-mode.js';",
        "import {heroWeather} from './hero-mode.js';\nimport {renderDewpointMeter} from './dewpoint-meter.js';\nimport {renderWeatherPanel} from './render-safety.js';")
replace('public/weather-fusion/app.js',
        'function render(data) {\n  forecast = data;',
        """function render(data) {
  forecast = data;
  const failedPanels = [];
  const draw = (id, label, renderer) => renderWeatherPanel(id, label, renderer, (error) => {
    failedPanels.push(label);
    console.error(`Weather Nourie panel failed: ${label}`, error);
  });""")
for fn,dom,label in [('renderAlerts','alerts','Official alerts'),('renderHours','hourly','Hourly forecast'),('renderDays','daily','Daily forecast'),('renderComfort','skin-exposure','Feels-like outlook'),('renderMetrics','metrics','Weather details'),('renderEvidence','scientific-stuff','Source details')]:
    replace('public/weather-fusion/app.js',f'  {fn}(data);',f"  draw('{dom}', '{label}', () => {fn}(data));")
replace('public/weather-fusion/app.js',
        "  draw('skin-exposure', 'Feels-like outlook', () => renderComfort(data));",
        "  draw('skin-exposure', 'Feels-like outlook', () => renderComfort(data));\n  draw('dewpoint-gross-meter', 'Dew Point Gross Meter', () => renderDewpointMeter(data));")
replace('public/weather-fusion/app.js',
        "    renderBriefing({ mode: 'nws-summary',",
        "    draw('briefing-summary', 'Local outlook', () => renderBriefing({ mode: 'nws-summary',")
replace('public/weather-fusion/app.js',
        "reason: data.aiConfigured ? 'Updating your local outlook…' : 'National Weather Service forecast', sources: ['nws'] });",
        "reason: data.aiConfigured ? 'Updating your local outlook…' : 'National Weather Service forecast', sources: ['nws'] }));")
replace('public/weather-fusion/app.js',
        "  $('status').textContent = `Updated ${clock(data.assembledAt)}${unavailable.length ? ' · Some details are unavailable' : ''}`;\n  $('status').classList.toggle('error', unavailable.length > 0);",
        """  $('status').textContent = `Updated ${clock(data.assembledAt)}${unavailable.length ? ' · Some source details are unavailable' : ''}${failedPanels.length ? ` · Display issue: ${failedPanels.join(', ')}. Other forecasts remain available; use Refresh to retry.` : ''}`;
  $('status').classList.toggle('error', unavailable.length > 0 || failedPanels.length > 0);""")
replace('public/weather-fusion/app.js',
        'async function load({ moveMap = false } = {}) {\n  const id = ++generation;',
        'async function load({ moveMap = false } = {}) {\n  const id = ++generation;\n  let receivedForecast = false;')
replace('public/weather-fusion/app.js',
        '    if (id !== generation) return;\n    render(data);',
        '    if (id !== generation) return;\n    receivedForecast = true;\n    render(data);')
replace('public/weather-fusion/app.js',
        "    $('status').textContent = `Weather update failed. ${forecast ? `The displayed snapshot was checked at ${clock(forecast.assembledAt)} and may be stale.` : 'Please retry or check weather.gov.'}`;\n    $('status').classList.add('error');\n    $('alerts').innerHTML = '<p class=\"alert-note warning\">Live alert status could not be checked. Consult the official NWS forecast and warnings.</p>';",
        """    console.error(receivedForecast ? 'Weather Nourie display failed' : 'Weather Nourie request failed', e);
    $('status').textContent = receivedForecast
      ? 'The forecast arrived, but a display component failed. Use Refresh to retry.'
      : `Weather update failed. ${forecast ? `The displayed snapshot was checked at ${clock(forecast.assembledAt)} and may be stale.` : 'Please retry or check weather.gov.'}`;
    $('status').classList.add('error');
    if (!receivedForecast) $('alerts').innerHTML = '<p class="alert-note warning">Live alert status could not be checked. Consult the official NWS forecast and warnings.</p>';""")
replace('public/weather-fusion/index.html',
        '/weather-fusion/app.js?v=4-friendly','/weather-fusion/app.js?v=5-render-recovery')
