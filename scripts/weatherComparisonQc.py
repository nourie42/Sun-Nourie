#!/usr/bin/env python3
"""Verify the comparison chart against independent, exact backend values.

WEATHER_TEST_BASE defaults to the local app on port 3123. Set
WEATHER_SOURCE_BASE to a deployed backend to use unmodified recorded guidance
with a local frontend, or WEATHER_QA_SOURCE_DIR to replay an existing capture.
Otherwise tests read the deployed app's real responses. WEATHER_QA_WIDTHS and
WEATHER_QA_CITIES narrow a run. The report records this distinction explicitly.
Requires Python Playwright and Chromium.
"""
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

BASE = os.environ.get('WEATHER_TEST_BASE', 'http://127.0.0.1:3123').rstrip('/')
SOURCE = os.environ.get('WEATHER_SOURCE_BASE', '').rstrip('/')
SOURCE_DIR = os.environ.get('WEATHER_QA_SOURCE_DIR', '')
OUT = Path(os.environ.get('WEATHER_QA_DIR', '/tmp/weather-comparison-qc'))
WIDTHS = [int(value) for value in os.environ.get('WEATHER_QA_WIDTHS', '320,412,768,1280').split(',')]
CITIES = [('Knightdale', 35.7871, -78.481), ('Cortland', 42.6012, -76.1805)]
VARIABLES = ['temp', 'rain', 'pop', 'wind', 'dewpoint']
OUT.mkdir(parents=True, exist_ok=True)


def check(value, message, detail=None):
    if not value:
        raise AssertionError(message + (': ' + json.dumps(detail) if detail is not None else ''))


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def epoch(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
    except (TypeError, ValueError, AttributeError):
        return None


def window(day, tonight=False):
    likelihood = day.get('popNightLikelihood' if tonight else 'rainLikelihood', {})
    period = likelihood.get('window', {}) if likelihood.get('aggregation') == 'maximum-hourly' else day.get('lowWindow' if tonight else 'qpfWindow', {})
    return epoch(period.get('start')), epoch(period.get('end'))


def amount(forecast, start, end):
    """Independently sum the exact published intervals, including partial hours.

    Missing values and coverage gaps remain unavailable instead of becoming 0.
    This does not import any production chart or presentation helper.
    """
    if not finite(start) or not finite(end) or end <= start:
        return None
    rows = sorted(forecast.get('rainTimeline', []), key=lambda row: epoch(row.get('time')) or 0)
    cursor, total = start, 0
    for row in rows:
        a = epoch(row.get('time'))
        b = epoch(row.get('end')) or (a + 3600000 if finite(a) else None)
        if not finite(a) or not finite(b) or a >= end or b <= start:
            continue
        left, right = max(start, a), min(end, b)
        value = row.get('precipitation')
        if left > cursor + .001 or not finite(value) or value < 0:
            return None
        total += value * max(0, right - max(cursor, left)) / (b - a)
        cursor = max(cursor, right)
    return total if cursor >= end - .001 else None


def expectations(forecast, now):
    zone = ZoneInfo(forecast['location']['timeZone'])
    hour = datetime.fromtimestamp(now / 1000, zone).hour
    series = forecast.get('metricForecasts', {}).get('series', {})
    answer = {key: [] for key in VARIABLES}
    for index, day in enumerate(forecast.get('days', [])[:10]):
        tonight = index == 0 and hour >= 18
        start, end = window(day, tonight)
        answer['temp'].append(day.get('low' if tonight else 'high'))
        answer['rain'].append(amount(forecast, start, end))
        likelihood = day.get('popNightLikelihood' if tonight else 'rainLikelihood', {})
        chance = likelihood.get('value')
        if likelihood.get('aggregation') == 'maximum-hourly' and likelihood.get('coverage', {}).get('complete') is False:
            chance = None
        radar = forecast.get('current', {}).get('radarPrecipitation', {})
        observation = epoch(radar.get('observedAt'))
        observed = index == 0 and radar.get('status') == 'ready' and radar.get('atLocation') is True and (not finite(observation) or -300000 <= now - observation <= 900000)
        answer['pop'].append(100 if observed else chance if finite(chance) and 0 <= chance <= 100 else None)
        if not observed and likelihood.get('aggregation') == 'maximum-hourly' and likelihood.get('coverage', {}).get('complete') is True:
            probabilities = [row.get('rainLikelihood', {}).get('value') for row in forecast.get('rainTimeline', [])
                             if finite(epoch(row.get('time'))) and finite(epoch(row.get('end'))) and
                             epoch(row['time']) < end and epoch(row['end']) > start]
            check(probabilities and all(finite(value) and 0 <= value <= 100 for value in probabilities),
                  'Complete daily rain chance requires all published hourly probabilities', {'date': day['date'], 'probabilities': probabilities})
            check(chance == max(probabilities), 'Daily rain chance must equal the peak hour within its precise period',
                  {'date': day['date'], 'daily': chance, 'hourlyPeak': max(probabilities)})
        winds = [point['value'] for point in series.get('wind', []) if
                 finite(epoch(point.get('time'))) and finite(start) and finite(end) and
                 start <= epoch(point['time']) < end and finite(point.get('value')) and point['value'] >= 0]
        answer['wind'].append(sum(winds) / len(winds) if winds else None)
        # Dew point has no daily card. Its daily maximum must come from the
        # already blended metric timeline over the same forecast period, rather
        # than blending each model's maximum at a different hour.
        dew = [point['value'] for point in series.get('dewpoint', []) if finite(point.get('value')) and
               finite(epoch(point.get('time'))) and
               finite(start) and finite(end) and start <= epoch(point['time']) < end]
        answer['dewpoint'].append(max(dew) if dew else None)
    return answer


def formatted(value, variable):
    if value is None:
        return None
    if variable == 'rain':
        return f'{value:.2f}"'
    rounded = math.floor(value + .5)
    if variable in ['temp', 'dewpoint']:
        return f'{rounded}°'
    if variable == 'pop':
        return f'{rounded}%'
    return str(rounded)


def source_for(city, latitude, longitude):
    if SOURCE_DIR:
        data = json.loads((Path(SOURCE_DIR) / f'{city.lower()}-recorded-backend.json').read_text())
    elif SOURCE:
        url = SOURCE + '/api/weather-fusion/forecast?' + urlencode({'latitude': latitude, 'longitude': longitude})
        with urlopen(url, timeout=120) as response:
            data = json.load(response)
    else:
        return None
    check(abs(data['location']['latitude'] - latitude) < .001 and abs(data['location']['longitude'] - longitude) < .001,
          'Recorded forecast must match the tested location', data.get('location'))
    (OUT / f'{city.lower()}-recorded-backend.json').write_text(json.dumps(data, indent=2))
    return data


def select_variable(page, variable):
    page.locator(f'#wn-var-picker [data-var="{variable}"]').click()
    page.wait_for_function('''()=>document.querySelector('#wn-compare-chart')?._wnShow&&
      document.querySelector('#wn-compare-chart svg')''')


def show_day(page, index, count):
    return page.locator('#wn-compare-chart').evaluate('''(element,args)=>{
      const [index,count]=args,svg=element.querySelector('svg'),r=svg.getBoundingClientRect(),width=svg.viewBox.baseVal.width,
        phone=width<600,left=phone?38:52,right=phone?10:18,x=left+index/Math.max(1,count-1)*(width-left-right);
      element._wnShow(r.left+x/width*r.width);
      const tip=element.querySelector('.wn-tip');
      return [...tip.children].filter(child=>child.tagName==='SPAN'&&child.querySelector('b')).map(row=>({
        name:row.querySelector('span')?.textContent.trim(),value:row.querySelector('b')?.textContent.trim()}));
    }''', [index, count])


def tooltip_values(page, index, count):
    # Show and read synchronously: a resize redraw between separate browser
    # calls would erase the tooltip and create a false data inconsistency.
    return show_day(page, index, count)


def chart_values(page):
    return page.locator('#wn-compare-chart').evaluate('''element=>[...element.querySelectorAll('circle[data-series="nourie"][data-date]')].map(point=>({
      date:point.dataset.date,value:Number(point.dataset.value),index:window.__weatherNourieForecast.days.findIndex(day=>day.date===point.dataset.date)}))''')


def validate_chart(page, forecast, expected, variable):
    days = forecast['days'][:10]
    chips = page.locator('#wn-compare-chart .wn-chip').evaluate_all('''elements=>elements.map(element=>({
      id:element.dataset.model,label:element.textContent.trim(),pressed:element.getAttribute('aria-pressed')}))''')
    check(sum(chip['id'] == 'nourie' for chip in chips) == 1, 'Exactly one canonical Weather Nourie blend chip must be shown', chips)
    check(not any(chip['id'] in ['oldBlend', 'fullBlend'] or re.search(r'\bcurrent\b', chip['label'], re.I) for chip in chips),
          'Legacy Current blend must not appear', chips)
    check(not any(re.search(r'\d+%', chip['label']) for chip in chips if chip['id'] != 'nourie'),
          'Model chips must not claim fixed weights that differ by day', chips)
    precise = chart_values(page)
    expected_indices = [index for index, value in enumerate(expected[variable]) if finite(value)]
    check([point['index'] for point in precise] == expected_indices,
          'Every available canonical date must have one exact primary point; unavailable dates need gaps',
          {'variable': variable, 'expected': expected_indices, 'actual': precise})
    for point in precise:
        check(point['date'] == days[point['index']]['date'] and abs(point['value'] - expected[variable][point['index']]) < 1e-8,
              'Canonical graph must use the backend value at full precision', {'variable': variable, 'point': point, 'expected': expected[variable][point['index']]})
    verified = []
    for index, day in enumerate(days):
        rows = tooltip_values(page, index, len(days))
        primary = [row for row in rows if row['name'] in ['Weather Nourie', 'Weather Nourie blend']]
        expected_text = formatted(expected[variable][index], variable)
        check(len(primary) == 1,
              'Tooltip needs exactly the available canonical Weather Nourie forecast', {'variable': variable, 'date': day['date'], 'rows': rows, 'expected': expected_text})
        if expected_text is None:
            check(primary[0]['value'] == 'Unavailable', 'Missing canonical value must remain explicitly unavailable', {'variable': variable, 'date': day['date'], 'rows': rows})
        else:
            check(primary[0]['value'] == expected_text, 'Displayed graph value must match canonical forecast',
                  {'variable': variable, 'date': day['date'], 'rows': rows, 'expected': expected_text})
        check(not any(re.search(r'\bcurrent\b', row['name'] or '', re.I) for row in rows), 'Tooltip must omit legacy Current blend', rows)
        # Existing seven-day cards are an independent user-facing rendering.
        if index < 7 and variable in ['temp', 'rain', 'pop', 'wind']:
            card = page.locator(f'#experimental-week [data-week-day="{index}"]')
            if variable == 'temp':
                card_value = card.locator('.seven-day-temperatures>span>strong').first.inner_text()
                expected_card = expected_text if expected_text is not None else '—°'
            else:
                metric = {'rain': 'Total precip', 'pop': 'Rain chance', 'wind': 'Wind'}[variable]
                cell = card.locator('.seven-day-metric').filter(has=page.locator('span', has_text=re.compile('^' + metric + '$')))
                # The observed-current-rain marker may replace the chance text
                # for day0; skip just that card label, not its canonical chart.
                if variable == 'pop' and cell.count() == 0:
                    continue
                card_value = cell.locator('strong').inner_text()
                expected_card = {'rain': f'{expected[variable][index]:.2f} in' if expected_text is not None else '—',
                                 'wind': expected_text + ' mph' if expected_text is not None else '—',
                                 'pop': expected_text if expected_text is not None else '—'}[variable]
            check(card_value == expected_card, 'Comparison graph and seven-day card must agree for the same forecast period',
                  {'variable': variable, 'date': day['date'], 'chart': expected_text, 'card': card_value, 'expectedCard': expected_card})
        verified.append({'date': day['date'], 'canonicalValue': expected[variable][index], 'displayedValue': expected_text})
    return {'variable': variable, 'allDatesVerified': verified, 'precisePoints': precise, 'chips': chips}


def toggle_check(page, forecast, expected, variable):
    initial = chart_values(page)
    canonical_days = page.evaluate('JSON.stringify(window.__weatherNourieForecast.days)')
    toggled = []
    ids = page.locator('#wn-compare-chart .wn-chip').evaluate_all('elements=>elements.map(element=>element.dataset.model).filter(id=>id!=="nourie")')
    for model in ids:
        page.locator(f'#wn-compare-chart .wn-chip[data-model="{model}"]').click()
        check(page.locator(f'#wn-compare-chart .wn-chip[data-model="{model}"]').get_attribute('aria-pressed') == 'false', 'Model chip must respond to hide click', model)
        check(page.locator(f'#wn-compare-chart path[data-series="{model}"]').count() == 0, 'Hidden model line must actually disappear from the SVG', model)
        check(chart_values(page) == initial, 'Hiding a model line must never recalculate the actual forecast', {'variable': variable, 'model': model})
        rows = tooltip_values(page, min(3, len(forecast['days']) - 1), len(forecast['days'][:10]))
        names = {'wn': 'WeatherNext', 'nws': 'NWS', 'nbm': 'NBM', 'hrrr': 'HRRR', 'ecmwf': 'ECMWF', 'gfs': 'GFS'}
        check(not any(row['name'] == names.get(model) for row in rows), 'Hidden model must disappear from tooltip', {'model': model, 'rows': rows})
        page.locator(f'#wn-compare-chart .wn-chip[data-model="{model}"]').click()
        check(chart_values(page) == initial, 'Restoring model visibility must preserve the actual forecast', model)
        toggled.append(model)
    # Hide every model simultaneously; keep the canonical forecast visible.
    for model in ids:
        page.locator(f'#wn-compare-chart .wn-chip[data-model="{model}"]').click()
    check(chart_values(page) == initial, 'Canonical forecast must stay unchanged when every model line is hidden')
    rows = tooltip_values(page, min(3, len(forecast['days']) - 1), len(forecast['days'][:10]))
    check(all(row['name'] in ['Weather Nourie', 'Weather Nourie blend'] for row in rows), 'Only the canonical forecast remains when models are hidden', rows)
    for model in ids:
        page.locator(f'#wn-compare-chart .wn-chip[data-model="{model}"]').click()
    check(page.evaluate('JSON.stringify(window.__weatherNourieForecast.days)') == canonical_days, 'Comparison controls must never mutate the actual daily forecast')
    return {'variable': variable, 'modelsToggled': toggled, 'canonicalUnchanged': True}


def main():
    reports, failures = [], []
    city_filter = os.environ.get('WEATHER_QA_CITIES', '').lower().split(',')
    scenarios = [city for city in CITIES if city_filter == [''] or city[0].lower() in city_filter]
    sources = {city: source_for(city, latitude, longitude) for city, latitude, longitude in scenarios}
    with sync_playwright() as playwright:
        launch = {'headless': True, 'executable_path': os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), 'args': ['--no-sandbox']}
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        if proxy:
            launch['proxy'] = {'server': proxy, 'bypass': '127.0.0.1,localhost'}
        browser = playwright.chromium.launch(**launch)
        for city, latitude, longitude in scenarios:
            for width in WIDTHS:
                report = {'base': BASE, 'city': city, 'width': width, 'sourceBase': SOURCE or BASE,
                          'mode': 'recorded-backend-guidance' if SOURCE or SOURCE_DIR else 'direct-live-backend',
                          'sourceCaptureDirectory': SOURCE_DIR or None}
                context = browser.new_context(viewport={'width': width, 'height': 915}, geolocation={'latitude': latitude, 'longitude': longitude},
                                              permissions=['geolocation'], reduced_motion='reduce', is_mobile=width <= 412,
                                              has_touch=width <= 412, device_scale_factor=1.5)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                recorded = sources[city]
                if recorded:
                    context.add_init_script("Object.defineProperty(window,'__compareQcRecorded',{value:true});")
                    page.clock.install(time=datetime.fromisoformat(recorded['assembledAt'].replace('Z', '+00:00')))
                    page.route('**/api/weather-fusion/forecast?*', lambda route, request, payload=recorded: route.fulfill(json=payload))
                    page.route('**/api/weather-fusion/briefing?*', lambda route: route.fulfill(json={'mode': 'recorded-model-guidance', 'summary': 'Browser regression with unmodified recorded forecast guidance.'}))
                try:
                    page.goto(BASE + '/weather-fusion/', wait_until='domcontentloaded', timeout=60000)
                    page.wait_for_function('''coordinates=>{
                      const f=window.__weatherNourieForecast;return f?.days?.length>=10&&
                        Math.abs(f.location.latitude-coordinates[0])<.001&&Math.abs(f.location.longitude-coordinates[1])<.001;
                    }''', arg=[latitude, longitude], timeout=120000)
                    page.wait_for_selector('#experimental-week [data-week-day="3"]', timeout=30000)
                    forecast = page.evaluate('window.__weatherNourieForecast')
                    now = page.evaluate('Date.now()')
                    expected = expectations(forecast, now)
                    report['assembledAt'], report['location'] = forecast['assembledAt'], forecast['location']
                    (OUT / f'{city.lower()}-tested-backend-{width}.json').write_text(json.dumps(forecast, indent=2))
                    page.locator('#open-compare').click()
                    page.wait_for_selector('#wn-compare-chart svg')
                    report['variables'], report['toggles'] = [], []
                    for variable in VARIABLES:
                        select_variable(page, variable)
                        report['variables'].append(validate_chart(page, forecast, expected, variable))
                        report['toggles'].append(toggle_check(page, forecast, expected, variable))
                    select_variable(page, 'rain')
                    index = next((i for i, day in enumerate(forecast['days'][:10]) if datetime.fromisoformat(day['date']).weekday() == 5), 3)
                    show_day(page, index, len(forecast['days'][:10]))
                    page.locator('#wn-compare-section').screenshot(path=str(OUT / f'{city.lower()}-comparison-saturday-{width}.png'))
                    page.locator('#experimental-week').screenshot(path=str(OUT / f'{city.lower()}-seven-day-{width}.png'))
                    page.locator('#open-compare').click()
                    check(not page.locator('#wn-compare-section').is_visible(), 'Comparison closes through the real tab')
                    page.locator('#open-compare').click()
                    page.wait_for_selector('#wn-compare-chart svg')
                    validate_chart(page, forecast, expected, 'rain')
                    for target in [412, 1280, width]:
                        page.set_viewport_size({'width': target, 'height': 915})
                        page.wait_for_timeout(300)
                        validate_chart(page, forecast, expected, 'rain')
                    check(not errors, 'Comparison must not raise JavaScript errors', errors)
                    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Comparison must not cause horizontal overflow')
                    report['result'] = 'passed'
                except Exception as error:
                    report['result'], report['error'] = 'failed', str(error)
                    failures.append(report)
                    try:
                        page.screenshot(path=str(OUT / f'{city.lower()}-failure-{width}.png'), full_page=True)
                    except Exception:
                        pass
                finally:
                    report['pageErrors'] = errors
                    reports.append(report)
                    context.close()
        browser.close()
    (OUT / 'report.json').write_text(json.dumps(reports, indent=2))
    print(json.dumps({'cases': len(reports), 'passed': len(reports) - len(failures), 'failed': len(failures), 'report': str(OUT / 'report.json'),
                      'failures': [{'city': row['city'], 'width': row['width'], 'error': row['error']} for row in failures]}, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
