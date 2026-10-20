#!/usr/bin/env python3
"""Check real NVIDIA blend contributions, coverage, and car-wash explanations.

Uses actual backend responses without interception. WEATHER_TEST_BASE defaults
 to localhost:3123. WEATHER_QA_WIDTHS defaults to 320,412,768,1280, and
WEATHER_QA_CITIES can narrow Knightdale,Hazen,Cortland. Requires Python
Playwright and Chromium. The comparison QC remains a separate test.
"""
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright
from weatherComparisonQc import check, finite, epoch, expectations

BASE = os.environ.get('WEATHER_TEST_BASE', 'http://127.0.0.1:3123').rstrip('/')
OUT = Path(os.environ.get('WEATHER_QA_DIR', '/tmp/weather-nvidia-qc'))
WIDTHS = [int(value) for value in os.environ.get('WEATHER_QA_WIDTHS', '320,412,768,1280').split(',')]
CITIES = [('Knightdale', 35.7871, -78.481, True), ('Hazen', 47.2944, -101.6227, True), ('Cortland', 42.6012, -76.1805, False)]
OUT.mkdir(parents=True, exist_ok=True)


def contribution(sources):
    return next((source for source in sources or [] if source.get('id') == 'wn'), None)


def source_check(sources, message):
    source = contribution(sources)
    check(source is not None and finite(source.get('value')) and finite(source.get('weight')) and source['weight'] > 0,
          message, source)
    return source


def backend_check(forecast, available, now):
    google = forecast.get('google', {})
    feeds = [feed for feed in forecast.get('feeds', []) if feed.get('id') == 'wn']
    check(len(feeds) == 1, 'Backend must disclose exactly one NVIDIA feed status', feeds)
    feed = feeds[0]
    models = [source for source in forecast.get('modelContributions', []) if source.get('id') == 'wn']
    check(google.get('contributes') is available, 'NVIDIA contribution flag must match actual point coverage', google)
    check(abs(google.get('requestedWeight', -1) - .1) < 1e-9, 'Established NVIDIA starting share must remain ten percent', google)
    check(google.get('label') == 'Google WeatherNext', 'Backend must name the contributing model clearly', google)
    series = forecast.get('metricForecasts', {}).get('series', {})
    report = {'google': google, 'feed': feed, 'model': models, 'fields': {}, 'hourlyRain': []}
    if available:
        check(feed.get('status') == 'ready' and feed.get('contributes') is True and google.get('status') == 'ready',
              'Covered location must have a ready, contributing NVIDIA feed', feed)
        check(len(models) == 1 and models[0].get('runAt') == google.get('runAt') == feed.get('issuedAt'),
              'Model, feed, and displayed NVIDIA provenance must agree on initialization', report)
        run = epoch(google.get('runAt'))
        check(finite(run) and 0 <= now - run <= 36 * 3600000,
              'A collection timestamp must not disguise stale NVIDIA initialization', {'runAt': google.get('runAt'), 'now': now})
        check(feed.get('publishedPoint', {}).get('distanceKm', math.inf) <= 15,
              'NVIDIA must use a verified published point within fifteen kilometers', feed.get('publishedPoint'))
        for field in ['temperature', 'dewpoint', 'wind', 'cloud', 'pressure']:
            points = [point for point in series.get(field, []) if contribution(point.get('sources'))]
            check(points, 'Available NVIDIA guidance must genuinely contribute to ' + field)
            for point in points:
                source_check(point['sources'], 'Matching NVIDIA field needs a finite, positive-weight contribution')
                weights = sum(source['weight'] for source in point['sources'])
                check(abs(weights - 1) < 3e-6, 'Numeric blend weights must normalize over available sources', {'field': field, 'time': point['time'], 'weights': weights})
                raw = sum(source['value'] * source['weight'] for source in point['sources'])
                check(abs(point['value'] - raw) <= (.5001 if field == 'temperature' else .0501), 'Canonical metric must include the attributed NVIDIA numeric value',
                      {'field': field, 'time': point['time'], 'canonical': point['value'], 'weighted': raw})
            report['fields'][field] = {'contributingHours': len(points), 'first': points[0], 'lastTime': points[-1]['time']}
        highs = [day for day in forecast.get('days', []) if contribution(day.get('highBlend', {}).get('sources'))]
        lows = [day for day in forecast.get('days', []) if contribution(day.get('lowBlend', {}).get('sources'))]
        temperatures = [hour for hour in forecast.get('hours', []) if contribution(hour.get('temperatureBlend', {}).get('sources'))]
        check(highs and lows and temperatures, 'NVIDIA must contribute to actual published daily and hourly temperatures')
        report['dailyTemperatureDates'] = [day['date'] for day in highs]
        report['hourlyTemperatureCount'] = len(temperatures)
        for item in highs + lows:
            for key in ['highBlend', 'lowBlend']:
                blend = item.get(key, {})
                if contribution(blend.get('sources')):
                    source_check(blend['sources'], 'Published daily extrema need actual NVIDIA numeric contribution')
                    raw = sum(source['value'] * source['weight'] for source in blend['sources'])
                    check(abs(blend['value'] - raw) <= .0002, 'Published temperature blend must include NVIDIA in its arithmetic', {'date': item['date'], 'kind': key, 'canonical': blend['value'], 'weighted': raw})
    else:
        check(feed.get('status') == 'unavailable' and feed.get('contributes') is False and google.get('status') == 'unavailable',
              'Uncovered location must explicitly report NVIDIA as unavailable', feed)
        check(not models and google.get('runAt') is None and feed.get('message'),
              'Uncovered point must not claim an initialized NVIDIA model', report)
        for field, points in series.items():
            check(not any(contribution(point.get('sources')) for point in points), 'Uncovered point must not invent NVIDIA ' + field + ' contributors')
        for item in forecast.get('days', []) + forecast.get('hours', []):
            for key in ['highBlend', 'lowBlend', 'qpfBlend', 'temperatureBlend', 'windDirectionBlend']:
                check(not contribution(item.get(key, {}).get('sources')), 'Uncovered point must not invent an NVIDIA blend', {'time': item.get('time'), 'date': item.get('date'), 'kind': key})
    known_rain = 0
    for row in forecast.get('rainTimeline', []):
        blend, chance = row.get('precipitationBlend', {}), row.get('rainLikelihood', {})
        value = blend.get('sourceValues', {}).get('wn')
        amount_source = contribution(blend.get('sources'))
        chance_source = contribution(chance.get('sources'))
        if finite(value):
            check(available, 'Uncovered point must not invent NVIDIA precipitation', row['time'])
            source_check(blend.get('sources'), 'Known NVIDIA interval, including zero, must contribute to canonical rain amount')
            source_check(chance.get('sources'), 'Known NVIDIA interval must contribute to the disclosed hourly rain score')
            check(abs(chance.get('sourceAmounts', {}).get('wn', math.inf) - value) < 1e-7,
                  'Rain score must use the identical matched NVIDIA rain amount', row['time'])
            raw = sum(source['value'] * source['weight'] for source in blend['sources'])
            check(abs(row['precipitation'] - raw) < 2e-6, 'Canonical hourly rainfall arithmetic must include NVIDIA',
                  {'time': row['time'], 'canonical': row['precipitation'], 'weighted': raw})
            if value == 0:
                check('wn' in chance.get('drySources', []) and chance.get('sourcePoints', {}).get('wn') == 0,
                      'Published zero NVIDIA rain must remain a known dry signal', row['time'])
            known_rain += 1
            if len(report['hourlyRain']) < 3:
                report['hourlyRain'].append({'time': row['time'], 'nvidiaAmount': value, 'nvidiaAmountWeight': amount_source['weight'],
                                            'nvidiaRainPoints': chance.get('sourcePoints', {}).get('wn'), 'canonicalAmount': row['precipitation']})
        else:
            check(amount_source is None and chance_source is None and 'wn' not in chance.get('drySources', []),
                  'Missing NVIDIA rain must stay missing, never become zero or a contributor', row['time'])
    check(bool(known_rain) is available, 'Published NVIDIA precipitation coverage must match availability', known_rain)
    report['knownNvidiaRainHours'] = known_rain
    for field in ['gust', 'visibility']:
        check(not any(contribution(point.get('sources')) for point in series.get(field, [])),
              'NVIDIA must not fabricate unpublished ' + field + ' inputs')
    # Independent period sums and peak-hour checks, shared only with the QA
    # script rather than any application helper.
    report['canonicalDaily'] = expectations(forecast, now)
    return report


def car_wash_check(page, forecast, now):
    page.locator('#open-car-wash').click()
    page.wait_for_selector('#car-wash-forecast .car-wash-answer p')
    reason = page.locator('#car-wash-forecast .car-wash-answer p').inner_text()
    subtitle = page.locator('.car-wash-header p').inner_text()
    check(subtitle == 'Plan for three days of low rain risk', 'Car-wash header must explain its actual three-day decision', subtitle)
    days = forecast.get('days', [])
    chances = [day.get('rainLikelihood', {}).get('value') for day in days[:3]]
    blocker = next((index for index, chance in enumerate(chances) if finite(chance) and chance > 25), None)
    current = forecast.get('current', {})
    radar = current.get('radarPrecipitation', {})
    station_precip = bool(re.search(r'rain|shower|storm|thunder|snow|sleet|drizzle', current.get('condition', ''), re.I)) and (
        current.get('type') == 'observation' or 'observation' in current.get('conditionSource', '').lower())
    active = station_precip or radar.get('status') == 'ready' and (radar.get('atLocation') is True or radar.get('nearby') is True)
    verified_future = False
    if not active and len(chances) == 3 and all(finite(chance) for chance in chances) and blocker is not None:
        peak = days[blocker].get('rainLikelihood', {})
        peak_time = epoch(peak.get('peakTime'))
        zone = ZoneInfo(forecast['location']['timeZone'])
        if finite(peak_time):
            peak_local = datetime.fromtimestamp(peak_time / 1000, zone)
            now_local = datetime.fromtimestamp(now / 1000, zone)
            if peak_local.date() != now_local.date():
                weekday, clock = peak_local.strftime('%A'), peak_local.strftime('%I %p').lstrip('0')
                expected = f'Rain within the next three days: {math.floor(peak["value"] + .5)}% chance {weekday} at {clock}.'
                check(reason == expected, 'A future rain peak must name its actual weekday/time and three-day outlook', {'reason': reason, 'expected': expected, 'todayChance': chances[0], 'blocker': blocker})
                check(not re.search(r'rain.*\btoday\b|happening now', reason, re.I), 'Future rain must not be described as happening today', reason)
                verified_future = True
    text_geometry = page.locator('.car-wash-answer p').evaluate('''p=>{
      const r=p.closest('.car-wash-answer').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(p);
      const t=range.getBoundingClientRect();return {fits:t.left>=r.left-1&&t.right<=r.right+1,textWidth:t.width,availableWidth:r.width};
    }''')
    check(text_geometry['fits'], 'Car-wash explanation must wrap within its tile', text_geometry)
    page.locator('.car-wash-art').evaluate('image=>image.decode()')
    return {'reason': reason, 'todayChance': chances[0] if chances else None, 'blockerDayIndex': blocker, 'verifiedFutureExplanation': verified_future,
            'activeObservedWeather': active, 'geometry': text_geometry}


def main():
    reports, failures = [], []
    cities = os.environ.get('WEATHER_QA_CITIES', '').lower().split(',')
    scenarios = [city for city in CITIES if cities == [''] or city[0].lower() in cities]
    with sync_playwright() as playwright:
        launch = {'headless': True, 'executable_path': os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), 'args': ['--no-sandbox']}
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        if proxy:
            launch['proxy'] = {'server': proxy, 'bypass': '127.0.0.1,localhost'}
        browser = playwright.chromium.launch(**launch)
        for city, latitude, longitude, available in scenarios:
            for width in WIDTHS:
                context = browser.new_context(viewport={'width': width, 'height': 915}, geolocation={'latitude': latitude, 'longitude': longitude},
                                              permissions=['geolocation'], reduced_motion='reduce', is_mobile=width <= 412,
                                              has_touch=width <= 412, device_scale_factor=1.5)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                report = {'city': city, 'width': width, 'base': BASE, 'mode': 'direct-live-backend', 'nvidiaExpected': available}
                try:
                    page.goto(BASE + '/weather-fusion/', wait_until='domcontentloaded', timeout=60000)
                    page.wait_for_function('''coordinates=>{
                      const f=window.__weatherNourieForecast;return f?.days?.length>=10&&f?.hours?.length>=48&&
                        Math.abs(f.location.latitude-coordinates[0])<.001&&Math.abs(f.location.longitude-coordinates[1])<.001;
                    }''', arg=[latitude, longitude], timeout=120000)
                    forecast = page.evaluate('window.__weatherNourieForecast')
                    now = page.evaluate('Date.now()')
                    report['assembledAt'], report['location'] = forecast['assembledAt'], forecast['location']
                    (OUT / f'{city.lower()}-backend-{width}.json').write_text(json.dumps(forecast, indent=2))
                    report['backend'] = backend_check(forecast, available, now)
                    page.locator('#open-compare').click()
                    page.wait_for_selector('#wn-compare-chart svg')
                    page.locator('#wn-var-picker [data-var="rain"]').click()
                    chips = page.locator('#wn-compare-chart .wn-chip').evaluate_all('elements=>elements.map(element=>({id:element.dataset.model,label:element.textContent.trim()}))')
                    nvidia_chips = [chip for chip in chips if chip['id'] == 'wn']
                    check(len(nvidia_chips) == (1 if available else 0), 'NVIDIA chart line must match actual canonical coverage', chips)
                    if available:
                        check(nvidia_chips[0]['label'] == 'Google WeatherNext', 'Comparison must name Google WeatherNext clearly', nvidia_chips)
                        primary = page.locator('circle[data-series="nourie"][data-value]').evaluate_all('points=>points.map(point=>point.dataset.value)')
                        page.locator('.wn-chip[data-model="wn"]').click()
                        check(page.locator('path[data-series="wn"]').count() == 0, 'NVIDIA model line must disappear when hidden')
                        check(page.locator('circle[data-series="nourie"][data-value]').evaluate_all('points=>points.map(point=>point.dataset.value)') == primary,
                              'Hiding NVIDIA display must not remove it from the actual canonical forecast')
                        page.locator('.wn-chip[data-model="wn"]').click()
                    check(not any(re.search(r'\bcurrent\b', chip['label'], re.I) for chip in chips), 'Legacy Current blend must remain removed', chips)
                    report['chips'] = chips
                    report['carWash'] = car_wash_check(page, forecast, now)
                    page.locator('#car-wash-forecast').screenshot(path=str(OUT / f'{city.lower()}-car-wash-{width}.png'))
                    page.locator('#wn-compare-chart').evaluate('element=>{const s=element.querySelector("svg"),r=s.getBoundingClientRect(),W=s.viewBox.baseVal.width,phone=W<600,L=phone?38:52,R=phone?10:18;element._wnShow(r.left+(L+3/9*(W-L-R))/W*r.width)}')
                    page.locator('#wn-compare-section').screenshot(path=str(OUT / f'{city.lower()}-nvidia-comparison-{width}.png'))
                    check(not errors, 'NVIDIA integration must not raise browser errors', errors)
                    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'NVIDIA integration must not overflow the page')
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
    print(json.dumps({'cases': len(reports), 'passed': len(reports)-len(failures), 'failed': len(failures), 'report': str(OUT/'report.json'),
                      'failures': [{'city': row['city'], 'width': row['width'], 'error': row['error']} for row in failures]}, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
