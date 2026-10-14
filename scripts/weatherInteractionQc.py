#!/usr/bin/env python3
"""Browser regression checks for forecast interactions and responsive Feel Meter.

Requires Python Playwright and Chromium. WEATHER_TEST_BASE defaults to the
local app on port 3123; WEATHER_QA_DIR defaults to /tmp/weather-interaction-qc.
Set WEATHER_SOURCE_BASE to a deployed backend to exercise a local frontend
with unmodified, newly recorded backend responses. Such runs are explicitly
marked recorded-backend-guidance, and the original payloads are saved.
The default tests the deployed/browser app's real responses directly.
WEATHER_QA_WIDTHS and WEATHER_QA_CITIES can narrow a troubleshooting run.
"""
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


BASE = os.environ.get('WEATHER_TEST_BASE', 'http://127.0.0.1:3123').rstrip('/')
SOURCE = os.environ.get('WEATHER_SOURCE_BASE', '').rstrip('/')
OUT = Path(os.environ.get('WEATHER_QA_DIR', '/tmp/weather-interaction-qc'))
WIDTHS = [int(value) for value in os.environ.get('WEATHER_QA_WIDTHS', '320,412,768,1280').split(',')]
CITIES = [('Cortland', 42.6012, -76.1805), ('Knightdale', 35.7871, -78.481)]
REQUIRE_STORM = os.environ.get('WEATHER_QA_REQUIRE_STORM', '1') != '0'
OUT.mkdir(parents=True, exist_ok=True)


def check(value, message, detail=None):
    if not value:
        raise AssertionError(message + (': ' + json.dumps(detail) if detail is not None else ''))


def source_for(city, latitude, longitude):
    if not SOURCE:
        return None
    url = SOURCE + '/api/weather-fusion/forecast?' + urlencode({'latitude': latitude, 'longitude': longitude})
    with urlopen(url, timeout=120) as response:
        forecast = json.load(response)
    check(abs(forecast['location']['latitude'] - latitude) < .001 and abs(forecast['location']['longitude'] - longitude) < .001,
          'Recorded source must match the tested location', forecast.get('location'))
    check(len(forecast.get('hours', [])) >= 48, 'Recorded backend needs a complete hourly forecast')
    (OUT / f'{city.lower()}-recorded-backend.json').write_text(json.dumps(forecast, indent=2))
    return forecast


def screenshot(page, selector, name):
    path = OUT / name
    page.locator(selector).evaluate('''async element=>{
      const urls=[...element.querySelectorAll('image')].map(image=>image.getAttribute('href'));
      await Promise.all(urls.map(url=>new Promise((resolve,reject)=>{
        const image=new Image();image.onload=()=>image.decode().then(resolve,reject);
        image.onerror=()=>reject(new Error('Illustration failed to load: '+url));image.src=url;
      })));
    }''')
    page.locator(selector).screenshot(path=str(path), timeout=30000)
    return str(path)


def navigation_check(page):
    data = page.locator('.weather-jump-card').evaluate_all('''elements => elements.map(element => {
      const r=element.getBoundingClientRect(),s=getComputedStyle(element);
      const label=element.querySelector('.jump-label'),range=document.createRange();range.selectNodeContents(label);
      const text=range.getBoundingClientRect();
      return {label:element.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontSize,
        background:s.backgroundColor,blur:s.backdropFilter,fits:text.left>=r.left&&text.right<=r.right&&text.top>=r.top&&text.bottom<=r.bottom};
    })''')
    check(len(data) == 8, 'All eight navigation tabs must be present', data)
    check(max(item['width'] for item in data) - min(item['width'] for item in data) < 1, 'Tabs must have equal widths', data)
    check(all(abs(item['height'] - 30) < .5 for item in data), 'Tabs must be compact, 30 pixels high', data)
    check(len(set(item['font'] for item in data)) == 1, 'Tab fonts must match', data)
    check(all(item['fits'] for item in data), 'Navigation text must fit inside each tab', data)
    check(all(item['background'].startswith('rgba(255, 255, 255, ') and
              abs(float(item['background'].rsplit(', ', 1)[1].rstrip(')'))-.025) < .003 and 'blur(6px)' == item['blur'] for item in data),
          'Navigation must use transparent glass', data)
    nav_width = page.locator('.weather-jump-nav').bounding_box()['width']
    viewport = page.evaluate('innerWidth')
    check(nav_width <= (320 if viewport <= 600 else 680) + .01,
          'Navigation must retain the smaller 320px mobile/680px desktop footprint', {'viewport': viewport, 'navWidth': nav_width})
    return data


def feel_meter_check(page, forecast, city, width):
    """Open the initially hidden chart, then inspect actual SVG screen geometry.

    Expected values come from the untouched recorded/live backend series,
    independent of the chart module's point-selection helpers.
    """
    panel = page.locator('#dewpoint-gross-meter')
    check(not panel.is_visible(), 'Feel Meter starts closed before its first click')
    page.locator('#open-gross').click()
    panel.wait_for(state='visible')
    page.wait_for_function('''()=>{
      const svg=document.querySelector('#dewpoint-gross-meter .gross-chart');
      return svg&&Math.abs(svg.getBoundingClientRect().width-svg.viewBox.baseVal.width)<3;
    }''')
    initial = screenshot(page, '#dewpoint-gross-meter', f'{city.lower()}-feel-initial-48h-{width}.png')
    facts = page.locator('.gross-facts>span').evaluate_all('''elements=>elements.map(element=>{
      const cell=element.getBoundingClientRect();const texts=[...element.querySelectorAll('b,small')].map(text=>{
        const range=document.createRange();range.selectNodeContents(text);const r=range.getBoundingClientRect();
        return {text:text.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
          fits:r.left>=cell.left&&r.right<=cell.right&&r.top>=cell.top&&r.bottom<=cell.bottom};
      });return {width:cell.width,texts};
    })''')
    check(len(facts) == 4 and all(text['fits'] for cell in facts for text in cell['texts']),
          'Feel Meter facts must stay within their divider columns', facts)
    samples = []
    source = forecast.get('metricForecasts', {}).get('series', {}).get('dewpoint', [])
    def inspect(hours):
        page.wait_for_function('''hours=>{
          const panel=document.querySelector('#dewpoint-gross-meter'),svg=panel?.querySelector('.gross-chart');
          return panel?.dataset.hours===String(hours)&&svg&&Math.abs(svg.getBoundingClientRect().width-svg.viewBox.baseVal.width)<3;
        }''', arg=hours)
        now = page.evaluate('Date.now()')
        start = ((int(now) + 3599999) // 3600000) * 3600000
        by_time = {}
        for point in source:
            epoch = datetime.fromisoformat(point['time'].replace('Z', '+00:00')).timestamp() * 1000
            if start <= epoch < start + hours * 3600000:
                old = by_time.get(epoch)
                if old is None or (not isinstance(old.get('value'), (int, float)) and isinstance(point.get('value'), (int, float))):
                    by_time[epoch] = point
        expected = [by_time[key] for key in sorted(by_time)]
        slider = page.locator('#gross-scrubber')
        maximum = int(slider.get_attribute('max'))
        check(maximum == max(0, len(expected)-1), 'Feel Meter scrubber must include exact source hours',
              {'hours': hours, 'sourcePoints': len(expected), 'sliderMax': maximum})
        values = []
        for index in sorted(set([0, maximum // 2, maximum])):
            if not expected:
                break
            slider.evaluate('(input,index)=>{input.value=String(index);input.dispatchEvent(new Event("input",{bubbles:true}));}', index)
            point = expected[index]
            value = point.get('value')
            expected_text = str(math.floor(value + .5)) + '°' if isinstance(value, (int, float)) else 'Unavailable'
            actual = page.locator('.gross-selected-value').inner_text()
            check(actual == expected_text, 'Feel Meter selection must match its exact backend dew point',
                  {'hours': hours, 'index': index, 'time': point['time'], 'expected': expected_text, 'actual': actual})
            aria = slider.get_attribute('aria-valuetext')
            values.append({'index': index, 'time': point['time'], 'backendValue': value, 'displayedValue': actual, 'aria': aria})
        # Check every hour against canonical source data in one browser call.
        # This also verifies the time label, so repeated values cannot hide
        # an off-by-one selection or a shifted timezone.
        every_readout = slider.evaluate('''(input,args)=>{
          const [points,zone]=args,day=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',month:'numeric',day:'numeric'}),
            hour=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'});
          return points.map((point,index)=>{
            input.value=String(index);input.dispatchEvent(new Event('input',{bubbles:true}));
            return {time:point.time,value:document.querySelector('.gross-selected-value').textContent,
              displayedTime:document.querySelector('.gross-selected-time').textContent,
              expectedTime:`${day.format(new Date(point.time))} · ${hour.format(new Date(point.time))} forecast`};
          });
        }''', [expected, forecast['location']['timeZone']])
        for point, readout in zip(expected, every_readout):
            value = point.get('value')
            expected_text = str(math.floor(value + .5)) + '°' if isinstance(value, (int, float)) else 'Unavailable'
            check(readout['value'] == expected_text and readout['displayedTime'] == readout['expectedTime'],
                  'Every chart hour must show its canonical dew point and local timestamp', readout)
        geometry = page.locator('#dewpoint-gross-meter .gross-chart').evaluate('''svg=>{
          const r=svg.getBoundingClientRect(),matrix=svg.getScreenCTM(),v=svg.viewBox.baseVal;
          const rect=element=>{const b=element.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
          const texts=[...svg.querySelectorAll('.gross-x,.gross-y')].map(element=>({text:element.textContent,axis:element.classList.contains('gross-x')?'x':'y',...rect(element),font:parseFloat(getComputedStyle(element).fontSize)*matrix.a}));
          const selected=svg.querySelector('.gross-selected'),cursor=svg.querySelector('.gross-cursor');
          return {width:r.width,height:r.height,viewBoxWidth:v.width,viewBoxHeight:v.height,scaleX:matrix.a,scaleY:matrix.d,
            bounds:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},texts,selected:{visible:getComputedStyle(selected).display!=='none',...rect(selected)},
            linePath:svg.querySelector('.gross-line').getAttribute('d'),cursorX:cursor.getAttribute('x1'),selectedX:selected.getAttribute('cx')};
        }''')
        check(abs(geometry['scaleX']-1) < .025 and abs(geometry['scaleY']-1) < .025,
              'SVG coordinates must map to screen pixels without stretching', geometry)
        check(abs(geometry['scaleX']-geometry['scaleY']) < .001,
              'Chart must preserve circular markers and undistorted text', geometry)
        check(all(11.5 <= text['font'] <= 12.5 for text in geometry['texts']),
              'Feel Meter axis labels must remain readable 12px text', geometry['texts'])
        bounds = geometry['bounds']
        check(all(text['left'] >= bounds['left']-1 and text['right'] <= bounds['right']+1 and
                  text['top'] >= bounds['top']-1 and text['bottom'] <= bounds['bottom']+1 for text in geometry['texts']),
              'Every axis label must remain inside the chart', geometry['texts'])
        labels = sorted((text for text in geometry['texts'] if text['axis'] == 'x'), key=lambda text: text['left'])
        check(all(a['right']+3 <= b['left'] for a, b in zip(labels, labels[1:])),
              'Feel Meter time labels must not overlap', labels)
        marker = geometry['selected']
        if marker['visible']:
            check(abs(marker['width']-marker['height']) < .1, 'Selected dew-point marker must stay round', marker)
            check(9.5 <= marker['width'] <= 10.5, 'Selected marker must retain its intended 10px diameter', marker)
        drawn = re.findall(r'[ML](-?[\d.]+),(-?[\d.]+)', geometry['linePath'])
        valid = [point for point in expected if isinstance(point.get('value'), (int, float))]
        check(len(drawn) == len(valid), 'Chart must draw each available source value and no missing values',
              {'hours': hours, 'drawnPoints': len(drawn), 'validSourcePoints': len(valid)})
        expected_segments = 0
        previous = None
        for point in expected:
            if not isinstance(point.get('value'), (int, float)):
                previous = None
                continue
            epoch = datetime.fromisoformat(point['time'].replace('Z', '+00:00')).timestamp() * 1000
            if previous is None or epoch-previous > 3600000*1.1:
                expected_segments += 1
            previous = epoch
        check(geometry['linePath'].count('M') == expected_segments,
              'Missing dew-point values must leave gaps in the line', {'hours': hours, 'segments': expected_segments})
        return {'hours': hours, 'sourcePoints': len(expected), 'allHoursVerified': len(every_readout), 'selectedValues': values, 'geometry': geometry}
    samples.append(inspect(48))
    for hours in [24, 48, 168, 240]:
        page.locator(f'[data-gross-hours="{hours}"]').click()
        samples.append(inspect(hours))
        screenshot(page, '#dewpoint-gross-meter', f'{city.lower()}-feel-{hours}h-{width}.png')
    # Closing/opening must preserve the final scrubbed instant and correctly
    # redraw a chart that was hidden with display:none.
    selected = page.locator('#gross-scrubber').input_value()
    selected_text = page.locator('.gross-selected-time').inner_text()
    # This tab is open-only in the existing UX. Exercise the same hidden
    # class state directly, then reopen through the real navigation button.
    page.evaluate("document.documentElement.classList.remove('gross-open')")
    check(not panel.is_visible(), 'Feel Meter becomes hidden when its open class is removed')
    page.locator('#open-gross').click()
    panel.wait_for(state='visible')
    check(page.locator('#gross-scrubber').input_value() == selected and page.locator('.gross-selected-time').inner_text() == selected_text,
          'Closing and opening the Feel Meter must retain the selected hour')
    samples.append(inspect(240))
    resize = []
    for target in [412, 768, 412, width]:
        page.set_viewport_size({'width': target, 'height': 915})
        page.wait_for_timeout(250)
        check(page.locator('.gross-selected-time').inner_text() == selected_text,
              'Resize must preserve the selected forecast instant')
        resize.append({'width': target, 'chart': inspect(240)})
    screenshot(page, '#dewpoint-gross-meter', f'{city.lower()}-feel-resized-{width}.png')
    page.evaluate("document.documentElement.classList.remove('gross-open')")
    return {'initialScreenshot': initial, 'facts': facts, 'horizons': samples, 'resizes': resize}


def car_wash_check(page):
    page.locator('#open-car-wash').click()
    page.wait_for_selector('#car-wash-forecast .car-wash-day')
    data = page.locator('.car-wash-day').evaluate_all('''elements=>elements.map(element=>{
      const r=element.getBoundingClientRect(),label=element.querySelector('strong'),range=document.createRange();
      range.selectNodeContents(label);const text=range.getBoundingClientRect();
      return {label:label.textContent.trim(),period:label.getAttribute('title'),width:r.width,textWidth:text.width,
        fits:text.left>=r.left-1&&text.right<=r.right+1&&text.top>=r.top&&text.bottom<=r.bottom};
    })''')
    check(len(data) == 5, 'Car wash forecast must show five days', data)
    check(all(item['fits'] for item in data), 'Car wash headings must stay within their tiles', data)
    check(data[0]['label'] in ['Today', 'Tonight'], 'First car wash heading must be compact', data)
    if data[0]['period'] == 'Remainder of Today':
        check(data[0]['label'] == 'Today', 'Remainder of Today must have a short visible heading')
    return data


def graph_check(page, forecast):
    # Future day two includes Cortland's storm hours and Knightdale's Friday.
    index = min(2, len(forecast['days']) - 1)
    page.locator(f'#experimental-week [data-week-day="{index}"]').click()
    # Unknown hourly rain legitimately produces an empty SVG path. Wait for
    # the series to exist; requiring painted bounds would reject that valid
    # unavailable-data state before the exact-value checks below can run.
    page.wait_for_selector('#day-dialog[open] [data-series="rainChance"]', state='attached')
    check(page.locator('#day-dialog [data-readout="rainChance"]').count() == 1, 'Daily graph must include its rain readout')
    check(page.locator('#day-dialog [data-series]').count() == 5, 'Daily graph must have all five series')
    check('100%' in page.locator('#day-dialog svg').text_content(), 'Rain graph needs an independent zero to 100 percent scale')
    # Read the point timestamps from the module rather than parsing localized labels.
    # Expected rain values below are independently matched to the canonical payload.
    points = page.evaluate('''async index=>{
      const {dayGraphPoints}=await import('/weather-fusion/day-graph.js');
      return dayGraphPoints(window.__weatherNourieForecast,index,false,Date.now()).map(point=>point.time);
    }''', index)
    check(len(points) > 1, 'Daily graph needs a time series')
    timeline = forecast.get('rainTimeline', forecast.get('hours', []))
    by_time = {datetime.fromisoformat(row['time'].replace('Z', '+00:00')).timestamp(): row for row in timeline}
    strip = page.locator('#hourly .forecast-hour').evaluate_all('''elements=>elements.map(element=>({
      time:element.dataset.time,rain:element.querySelector('.hour-pop').textContent.trim()
    }))''')
    strip_by_time = {datetime.fromisoformat(row['time'].replace('Z', '+00:00')).timestamp(): row['rain'] for row in strip}
    checked = []
    for i, time in enumerate(points):
        epoch = datetime.fromisoformat(time.replace('Z', '+00:00')).timestamp()
        row = by_time.get(epoch)
        probability = None
        if row:
            end = row.get('end', row.get('endTime'))
            valid_hour = end is None or datetime.fromisoformat(end.replace('Z', '+00:00')).timestamp() == epoch + 3600
            if valid_hour:
                probability = row.get('rainLikelihood', {}).get('value') if 'value' in row.get('rainLikelihood', {}) else row.get('pop')
        expected = str(int(probability + .5)) + '%' if isinstance(probability, (int, float)) else '—'
        page.locator('#day-graph-hour').evaluate('(input,index)=>{input.value=String(index);input.dispatchEvent(new Event("input",{bubbles:true}));}', i)
        actual = page.locator('#day-dialog [data-readout="rainChance"] strong').inner_text()
        check(actual == expected, 'Scrubbed rain chance must match the exact hourly backend probability', {'time': time, 'expected': expected, 'actual': actual})
        if epoch in strip_by_time:
            check(actual == strip_by_time[epoch], 'Rain graph and hourly tile must agree for the same instant', {'time': time, 'graph': actual, 'tile': strip_by_time[epoch]})
        checked.append({'time': time, 'rain': actual, 'comparedWithHourlyTile': epoch in strip_by_time})
    bounds = page.locator('#day-dialog .day-graph-readout>div').evaluate_all('''elements=>elements.map(element=>{
      const r=element.getBoundingClientRect();return {field:element.dataset.readout,overflow:element.scrollWidth>element.clientWidth+1,
        x:r.x,y:r.y,width:r.width,height:r.height};
    })''')
    check(not any(row['overflow'] for row in bounds), 'Daily graph values and labels must fit their columns', bounds)
    return {'day': forecast['days'][index]['date'], 'points': checked, 'readoutBounds': bounds}


def storm_check(page, forecast):
    candidates = []
    for row in forecast['hours']:
        if 'thunder' not in row.get('condition', '').lower() or re.search(r'\b(chance|possible|slight)\b', row.get('condition', ''), re.I):
            continue
        if page.locator('#hourly .forecast-hour[data-time="' + row['time'] + '"]').count():
            probability = row.get('rainLikelihood', {}).get('value')
            candidates.append((probability if isinstance(probability, (int, float)) else 100, row))
    if not candidates:
        check(not REQUIRE_STORM, 'Cortland regression requires an actual definite storm forecast hour')
        return {'skipped': 'No currently forecast definite storm; set WEATHER_QA_REQUIRE_STORM=1 to require this case.'}
    # Revisit the user's exact 10 AM / 59°F / 38% storm when still available.
    # Other definite low-probability storm hours retain coverage as dates move.
    candidates.sort(key=lambda item: (0 if item[0] < 50 and 'T10:00:' in item[1]['time'] else 1, item[0]))
    probability, selected = candidates[0]
    button = page.locator('#hourly .forecast-hour[data-time="' + selected['time'] + '"]')
    expected = button.locator('.hour-feels b').inner_text()
    button.click()
    check(page.locator('#skin-exposure .sun-person figcaption>strong').inner_text() == expected,
          'Selected-hour comfort reading must match its hourly card')
    data = page.locator('#skin-exposure svg.reference-scene').evaluate_all('''elements=>elements.map(element=>({
      scene:element.dataset.scene,weather:element.dataset.weather,asset:element.querySelector('image').getAttribute('href'),alt:element.getAttribute('aria-label')
    }))''')
    check(len(data) == 3 and all(item['scene'] == 'rain' and item['weather'] == 'storm' for item in data),
          'All three illustrations must show rainy weather for the selected definite storm', data)
    check(all('rain' in item['asset'] for item in data), 'Storm scenes must use complete rainy artwork', data)
    check(page.locator('#skin-exposure .snow-play-scene').count() == 0, 'A liquid storm hour must not show forecast snow')
    return {'time': selected['time'], 'condition': selected['condition'], 'probability': probability, 'hourlyFeels': expected, 'scenes': data}


def warning_check(page):
    page.locator('#hourly .hour-current').click()
    if not page.locator('#skin-exposure .pavement-warning').count():
        for button in page.locator('#hourly .forecast-hour').all()[:16]:
            button.click()
            if page.locator('#skin-exposure .pavement-warning').count():
                break
    data = page.locator('#skin-exposure .thermal-risk,#skin-exposure .pavement-warning').evaluate_all('''elements=>elements.map(element=>{
      const r=element.getBoundingClientRect(),parent=element.closest('.exposure-person'),art=parent.querySelector('svg.reference-scene').getBoundingClientRect(),p=parent.getBoundingClientRect();
      return {text:element.textContent.trim(),height:r.height,bottom:r.bottom,artTop:art.top,top:r.top,
        fits:r.left>=p.left&&r.right<=p.right&&r.bottom<=art.top,position:getComputedStyle(element).position};
    })''')
    check(any('pavement' in item['text'].lower() for item in data), 'Knightdale regression needs a real pavement warning')
    check(all(item['fits'] and item['height'] <= 32 for item in data), 'Warnings must be compact and fully above their illustrations', data)
    return data


def main():
    reports = []
    failures = []
    city_filter = os.environ.get('WEATHER_QA_CITIES', '')
    scenarios = [city for city in CITIES if not city_filter or city[0].lower() in city_filter.lower().split(',')]
    sources = {city: source_for(city, latitude, longitude) for city, latitude, longitude in scenarios}
    with sync_playwright() as playwright:
        launch = {'executable_path': os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), 'headless': True, 'args': ['--no-sandbox']}
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
        if proxy:
            launch['proxy'] = {'server': proxy, 'bypass': '127.0.0.1,localhost'}
        browser = playwright.chromium.launch(**launch)
        for city, latitude, longitude in scenarios:
            for width in WIDTHS:
                report = {'base': BASE, 'city': city, 'width': width,
                          'mode': 'recorded-backend-guidance' if SOURCE else 'direct-live-backend', 'sourceBase': SOURCE or BASE,
                          'deviceScaleFactor': 1.5, 'touch': width <= 412, 'mobile': width <= 412}
                context = browser.new_context(viewport={'width': width, 'height': 915}, geolocation={'latitude': latitude, 'longitude': longitude}, permissions=['geolocation'],
                                              is_mobile=width <= 412, has_touch=width <= 412, device_scale_factor=1.5)
                page = context.new_page()
                errors, failed_art = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('response', lambda response: failed_art.append({'status': response.status, 'url': response.url}) if response.status >= 400 and '/comfort-' in response.url else None)
                recorded = sources[city]
                if recorded:
                    page.clock.install(time=datetime.fromisoformat(recorded['assembledAt'].replace('Z', '+00:00')))
                    page.route('**/api/weather-fusion/forecast?*', lambda route, request, payload=recorded: route.fulfill(json=payload))
                    page.route('**/api/weather-fusion/briefing?*', lambda route: route.fulfill(json={'mode': 'recorded-model-guidance', 'summary': 'Browser regression with unmodified recorded forecast guidance.'}))
                try:
                    page.goto(BASE + '/weather-fusion/', wait_until='domcontentloaded', timeout=60000)
                    page.wait_for_function('''coordinates=>{
                      const forecast=window.__weatherNourieForecast;return forecast?.hours?.length>=48&&
                        Math.abs(forecast.location.latitude-coordinates[0])<.001&&Math.abs(forecast.location.longitude-coordinates[1])<.001;
                    }''', arg=[latitude, longitude], timeout=120000)
                    page.wait_for_selector('#hourly .forecast-hour .hour-feels b', timeout=30000)
                    page.wait_for_selector('#skin-exposure svg.reference-scene', timeout=30000)
                    page.wait_for_timeout(300)
                    forecast = page.evaluate('window.__weatherNourieForecast')
                    report['assembledAt'] = forecast['assembledAt']
                    report['location'] = forecast['location']
                    (OUT / f'{city.lower()}-tested-backend.json').write_text(json.dumps(forecast, indent=2))
                    (OUT / f'{city.lower()}-tested-backend-{width}.json').write_text(json.dumps(forecast, indent=2))
                    report['navigation'] = navigation_check(page)
                    screenshot(page, '.weather-jump-nav', f'{city.lower()}-navigation-{width}.png')
                    report['feelMeter'] = feel_meter_check(page, forecast, city, width)
                    report['carWash'] = car_wash_check(page)
                    screenshot(page, '#car-wash-forecast', f'{city.lower()}-car-wash-{width}.png')
                    report['graph'] = graph_check(page, forecast)
                    screenshot(page, '#day-dialog', f'{city.lower()}-day-graph-{width}.png')
                    page.locator('#close-day').click()
                    if city == 'Cortland':
                        report['storm'] = storm_check(page, forecast)
                        screenshot(page, '#skin-exposure', f'{city.lower()}-storm-{width}.png')
                    else:
                        report['warnings'] = warning_check(page)
                        screenshot(page, '#skin-exposure', f'{city.lower()}-pavement-warning-{width}.png')
                    check(not errors, 'Browser must not raise JavaScript errors', errors)
                    check(not failed_art, 'Every selected illustration must load', failed_art)
                    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Page must not overflow horizontally')
                    report['result'] = 'passed'
                except Exception as error:
                    report['result'] = 'failed'
                    report['error'] = str(error)
                    failures.append(report)
                    try:
                        page.screenshot(path=str(OUT / f'{city.lower()}-failure-{width}.png'), full_page=True)
                    except Exception:
                        pass
                finally:
                    report['pageErrors'] = errors
                    report['failedIllustrations'] = failed_art
                    reports.append(report)
                    context.close()
        browser.close()
    (OUT / 'report.json').write_text(json.dumps(reports, indent=2))
    print(json.dumps({'cases': len(reports), 'passed': len(reports)-len(failures), 'failed': len(failures), 'report': str(OUT/'report.json'),
                      'failures': [{'city': row['city'], 'width': row['width'], 'error': row['error']} for row in failures]}, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
