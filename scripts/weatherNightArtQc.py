#!/usr/bin/env python3
"""Inspect selected-hour nighttime artwork using actual forecast interactions.

Real-hour cases use unmodified current backend data and real hourly buttons.
The separate, explicitly labeled component gallery supplies synthetic scene
inputs only to exercise weather/clothing combinations absent from the weather.
It never changes the forecast payload, forecast calculations, or live site.
WEATHER_TEST_BASE defaults to localhost:3123; WEATHER_QA_WIDTHS defaults to
412,1280. WEATHER_QA_CITIES defaults to Cortland,Knightdale.
"""
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

BASE = os.environ.get('WEATHER_TEST_BASE', 'http://127.0.0.1:3123').rstrip('/')
OUT = Path(os.environ.get('WEATHER_QA_DIR', '/tmp/weather-night-art-qc'))
WIDTHS = [int(value) for value in os.environ.get('WEATHER_QA_WIDTHS', '412,1280').split(',')]
CITIES = [('Cortland', 42.6012, -76.1805), ('Knightdale', 35.7871, -78.481)]
OUT.mkdir(parents=True, exist_ok=True)


def check(value, message, detail=None):
    if not value:
        raise AssertionError(message + (': ' + json.dumps(detail) if detail is not None else ''))


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def epoch(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000


def daylight(forecast, time):
    zone = ZoneInfo(forecast['location']['timeZone'])
    date = datetime.fromtimestamp(epoch(time) / 1000, zone).strftime('%Y-%m-%d')
    solar = next((row for row in forecast.get('metricForecasts', {}).get('solar', []) if row.get('date') == date), None)
    check(solar and solar.get('sunrise') and solar.get('sunset'), 'Independent backend astronomical times must cover the selected hour', time)
    return epoch(solar['sunrise']) <= epoch(time) < epoch(solar['sunset'])


def clothing(feels, snow=False):
    if snow or feels < 42:
        return 'cold'
    return 'cool' if feels < 65 else 'mild' if feels < 74 else 'warm' if feels < 88 else 'hot'


def inspect_panels(page, selector, expected_daylight, expected_outfit, key, save=True):
    root = page.locator(selector)
    root.evaluate('''async element=>{
      await Promise.all([...element.querySelectorAll('svg.reference-scene image')].map(element=>new Promise((resolve,reject)=>{
        const image=new Image();image.onload=()=>image.decode().then(resolve,reject);image.onerror=()=>reject(new Error('Failed artwork '+element.getAttribute('href')));image.src=element.getAttribute('href');
      })));
    }''')
    panels = root.locator('svg.reference-scene').evaluate_all('''elements=>elements.map(element=>({
      daylight:element.dataset.daylight,outfit:element.dataset.outfit,visibleOutfit:element.dataset.visibleOutfit,
      scene:element.dataset.scene,asset:element.querySelector('image')?.getAttribute('href'),label:element.getAttribute('aria-label'),
      images:element.querySelectorAll('image').length,transforms:element.querySelectorAll('image')[0]?.getAttribute('transform'),
      bounds:{width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}
    }))''')
    check(len(panels) == 3, 'Every selected hour must show all three complete panels', panels)
    check(all(panel['daylight'] == str(expected_daylight).lower() for panel in panels), 'All three panels must use the selected hour daylight state', panels)
    outfits = expected_outfit if isinstance(expected_outfit, list) else [expected_outfit] * 3
    check(all(panel['outfit'] == outfit and panel['visibleOutfit'] == outfit for panel, outfit in zip(panels, outfits)),
          'Every figure must retain selected-hour clothing', {'expected': outfits, 'panels': panels})
    check(all(panel['images'] == 1 and panel['bounds']['width'] > 0 and panel['bounds']['height'] > 0 for panel in panels),
          'Scenes must render one complete image rather than clothes pasted over another image', panels)
    if not expected_daylight:
        check(all(re.search(r'night|dawn', panel['asset']) for panel in panels),
              'Night labels must actually select nighttime artwork for every panel', panels)
    if save:
        root.screenshot(path=str(OUT / f'{key}.png'))
        for index in range(3):
            root.locator('svg.reference-scene').nth(index).screenshot(path=str(OUT / f'{key}-panel-{index+1}.png'))
    return panels


def real_cases(page, forecast, city, width):
    zone = ZoneInfo(forecast['location']['timeZone'])
    rows = [row for row in forecast['hours'] if finite(row.get('feelsLike')) and page.locator('#hourly .forecast-hour[data-time="' + row['time'] + '"]').count()]
    candidates = []
    # Cover every currently available 3 AM forecast, including the exact cold
    # 14% chance-rain case from SaturdayOct17 when it remains in the horizon.
    for row in rows:
        local = datetime.fromtimestamp(epoch(row['time']) / 1000, zone)
        if local.hour == 3:
            candidates.append(('3am-' + local.strftime('%Y%m%d'), row))
    # Add the hours immediately before/after sunrise for each covered date.
    for solar in forecast.get('metricForecasts', {}).get('solar', [])[:2]:
        rise = epoch(solar['sunrise'])
        before = [row for row in rows if epoch(row['time']) < rise]
        after = [row for row in rows if epoch(row['time']) >= rise]
        if before and after:
            candidates.extend([('before-sunrise-' + solar['date'], max(before, key=lambda row: epoch(row['time']))),
                               ('after-sunrise-' + solar['date'], min(after, key=lambda row: epoch(row['time'])))])
    seen, report = set(), []
    for kind, row in candidates:
        if row['time'] in seen:
            continue
        seen.add(row['time'])
        button = page.locator('#hourly .forecast-hour[data-time="' + row['time'] + '"]')
        hourly_feels = button.locator('.hour-feels b').inner_text()
        button.click()
        check(page.locator('#skin-exposure .sun-person figcaption>strong').inner_text() == hourly_feels,
              'Selected artwork must retain the same thermal reading as the clicked hour', row['time'])
        expected_daylight = daylight(forecast, row['time'])
        snow = bool(re.search(r'snow|flurr|blizzard', row.get('condition', ''), re.I))
        shade_feels = row.get('feelsLikeShade', row['feelsLike'])
        expected_outfit = [clothing(shade_feels, snow), clothing(row['feelsLike'], snow), clothing(row['feelsLike'], snow)]
        key = city.lower() + '-' + kind + '-' + str(width)
        panels = inspect_panels(page, '#skin-exposure', expected_daylight, expected_outfit, key)
        report.append({'kind': kind, 'time': row['time'], 'condition': row.get('condition'), 'temperature': row.get('temperature'),
                       'feelsLike': row.get('feelsLike'), 'rainChance': row.get('rainLikelihood', {}).get('value'), 'panels': panels})
    check(any(case['kind'].startswith('3am-') for case in report), 'Live forecast needs an actual3AM hour for this regression')
    check(any(case['kind'].startswith('before-sunrise-') for case in report) and any(case['kind'].startswith('after-sunrise-') for case in report),
          'Actual forecast must exercise a sunrise crossover')
    page.locator('[data-comfort-reset]').click()
    return report


def component_gallery(page, width):
    scenarios = []
    for outfit, feels in [('cold', 13), ('cool', 48), ('mild', 69), ('warm', 80), ('hot', 94)]:
        for weather, condition, pop in [('chance-rain', 'Chance Rain Showers', 14), ('active-rain', 'Rain Showers', 96), ('fog', 'Fog', 0), ('clear', 'Clear', 0)]:
            scenarios.append({'id': outfit + '-' + weather, 'feels': feels, 'condition': condition, 'pop': pop, 'snow': False, 'outfit': outfit})
    scenarios.append({'id': 'cold-snow', 'feels': 13, 'condition': 'Snow', 'pop': 90, 'snow': True, 'outfit': 'cold'})
    report = []
    for case in scenarios:
        page.evaluate('''async scene=>{
          const {referenceScene}=await import('/weather-fusion/exposure-scene.js?night-art-qc');
          let root=document.getElementById('night-art-qc-gallery');if(!root){root=document.createElement('section');root.id='night-art-qc-gallery';document.body.append(root);}
          root.style.cssText='position:relative;z-index:1;margin:20px auto;padding:12px;width:min(100% - 24px,900px);box-sizing:border-box;background:#17304c;color:white';
          const context={forecast:true,snowScope:'hour',airTemperature:scene.feels+10,clothingFeels:scene.feels,snowExpected:scene.snow,pop:scene.pop};
          root.innerHTML='<h2 style="font:14px sans-serif">Synthetic nighttime artwork component check: '+scene.id+'</h2><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr))">'+[0,1,2].map(index=>referenceScene(index,false,scene.condition,scene.feels,context)).join('')+'</div>';
          root.querySelectorAll('svg').forEach(svg=>{svg.style.width='100%';svg.style.height='auto';});
        }''', case)
        panels = inspect_panels(page, '#night-art-qc-gallery', False, case['outfit'], 'synthetic-' + case['id'] + '-' + str(width))
        report.append({'synthetic': True, **case, 'panels': panels})
    page.locator('#night-art-qc-gallery').evaluate('element=>element.remove()')
    return report


def main():
    reports, failures = [], []
    city_filter = os.environ.get('WEATHER_QA_CITIES', '').lower().split(',')
    scenarios = [city for city in CITIES if city_filter == [''] or city[0].lower() in city_filter]
    with sync_playwright() as playwright:
        launch = {'headless': True, 'executable_path': os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), 'args': ['--no-sandbox']}
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        if proxy:
            launch['proxy'] = {'server': proxy, 'bypass': '127.0.0.1,localhost'}
        browser = playwright.chromium.launch(**launch)
        for city, latitude, longitude in scenarios:
            for width in WIDTHS:
                report = {'base': BASE, 'city': city, 'width': width, 'mode': 'direct-live-backend'}
                context = browser.new_context(viewport={'width': width, 'height': 915}, geolocation={'latitude': latitude, 'longitude': longitude}, permissions=['geolocation'],
                                              reduced_motion='reduce', is_mobile=width <= 412, has_touch=width <= 412)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    page.goto(BASE + '/weather-fusion/', wait_until='domcontentloaded', timeout=60000)
                    page.wait_for_function('''coordinates=>{const f=window.__weatherNourieForecast;return f?.hours?.length>=48&&Math.abs(f.location.latitude-coordinates[0])<.001&&Math.abs(f.location.longitude-coordinates[1])<.001;}''',
                                           arg=[latitude, longitude], timeout=120000)
                    forecast = page.evaluate('window.__weatherNourieForecast')
                    report['assembledAt'] = forecast['assembledAt']
                    (OUT / f'{city.lower()}-backend-{width}.json').write_text(json.dumps(forecast, indent=2))
                    report['realHours'] = real_cases(page, forecast, city, width)
                    if city == scenarios[0][0] and os.environ.get('WEATHER_QA_SKIP_GALLERY', '0') != '1':
                        report['syntheticComponentGallery'] = component_gallery(page, width)
                    after = page.evaluate('window.__weatherNourieForecast')
                    (OUT / f'{city.lower()}-after-backend-{width}.json').write_text(json.dumps(after, indent=2))
                    comparable = json.loads(json.dumps(after))
                    radar_added = 'radarPrecipitation' not in forecast.get('current', {}) and 'radarPrecipitation' in comparable.get('current', {})
                    if radar_added:
                        # The separate NOAA radar request legitimately appends
                        # this observation after the forecast has rendered.
                        # Preserve strict equality for every original field.
                        report['asynchronousRadarAddition'] = comparable['current'].pop('radarPrecipitation')
                    check(comparable == forecast,
                          'Artwork changes must preserve every original forecast numeric, source and time field')
                    check(not errors, 'Night scenes must render without JavaScript errors', errors)
                    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Night artwork must not overflow the page')
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
