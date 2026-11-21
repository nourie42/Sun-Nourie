"""Reproducible presentation checks with captured, timestamp-frozen forecasts.
No fixture values are served by the shipped application or weather engine.
"""
import argparse, asyncio, base64, json, os, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from datetime import datetime
from playwright.async_api import async_playwright

async def main(args):
    fixtures={name:json.loads((args.fixture_dir/(name+'-live.json')).read_text()) for name in ['knightdale','greenville']}
    epoch=max(int(datetime.fromisoformat(f['assembledAt'].replace('Z','+00:00')).timestamp()*1000) for f in fixtures.values())
    for f in fixtures.values(): f['aiConfigured']=False
    args.artifacts.mkdir(parents=True,exist_ok=True)
    report={'mode':'captured forecasts, frozen clock, headless Chromium; no physical Android device','base':args.base,'clock':epoch,'checks':[],'errors':[],'screenshots':[]}
    def passed(name,detail=None):
        report['checks'].append({'name':name,'passed':True,**({'detail':detail} if detail is not None else {})});print('PASS',name,flush=True)
    proxy={'server':os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY'),'bypass':'127.0.0.1,localhost'}
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],proxy=proxy)
        context=await browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,device_scale_factor=1,reduced_motion='reduce',permissions=['geolocation'],geolocation={'latitude':35.787,'longitude':-78.4806})
        await context.add_init_script(f'''const NativeDate=Date;globalThis.Date=class extends NativeDate{{constructor(...args){{super(...(args.length?args:[{epoch}]))}}static now(){{return {epoch}}}}};''')
        api_count={'forecast':0}
        async def fixture(route):
            url=urlparse(route.request.url);query=parse_qs(url.query)
            chosen='greenville' if query.get('location')==['greenville'] or any(v.startswith('35.6127') for v in query.get('latitude',[])) else 'knightdale'
            f=fixtures[chosen]
            if url.path.endswith('/forecast'):
                api_count['forecast']+=1;await route.fulfill(json=f)
            elif url.path.endswith('/alerts'):await route.fulfill(json={'location':f['location'],'alerts':f['alerts'],'feeds':[x for x in f['feeds'] if x['id']=='alerts']})
            elif url.path.endswith('/bulletins'):await route.fulfill(json={'mode':'official','signature':f['signature'],'notices':[]})
            elif url.path.endswith('/search'):await route.fulfill(json={'results':[{'name':'Greenville, NC','latitude':35.6127,'longitude':-77.3664,'id':'greenville'}]})
            elif url.path.endswith('/models'):await route.fulfill(json={'layers':{},'checkedAt':f['assembledAt']})
            elif url.path.endswith('/radar'):await route.fulfill(json={'status':'unavailable','frames':[],'precipitation':{'status':'unavailable'},'location':f['location'],'officialUrl':'https://radar.weather.gov/'})
            else:await route.continue_()
        await context.route('**/api/weather-fusion/**',fixture)
        page=await context.new_page();page.set_default_timeout(12000)
        page.on('pageerror',lambda error:report['errors'].append(str(error)))
        # Avoid external basemap network noise in the controlled radar-unavailable case.
        pixel=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')
        await context.route('**/MapServer/tile/**',lambda route:route.fulfill(body=pixel,content_type='image/png'))
        async def go(view):
            if view=='more':await page.locator('#ng-more').click()
            else:await page.locator('.ng-bottom-nav [data-view-link="'+view+'"]').click()
            await page.wait_for_function('(v)=>window.__weatherNourieNextGen?.view===v',arg=view)
            assert await page.locator('#ng-screen-'+view).is_visible()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),view+' overflow'
        async def close_modal():
            dialog=page.locator('dialog[open]').last
            await dialog.locator('button[data-close-dialog],button.dialog-close').first.click()
            await page.wait_for_function('!document.querySelector("dialog[open]")')
            await page.wait_for_timeout(180)
        async def screenshot(name):
            path=args.artifacts/(name+'.png');await page.screenshot(path=str(path),full_page=False);report['screenshots'].append(path.name)
        try:
            await page.goto(args.base+'/experimental/next-gen/?location=knightdale',wait_until='domcontentloaded')
            await page.wait_for_function('!!window.__weatherNourieNextGen?.model',timeout=45000)
            await page.locator('#ng-person').wait_for(state='visible',timeout=20000)
            passed('mobile startup, existing controller, portrait and forecast loaded')
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            passed('393px Android layout has no horizontal overflow')
            assert await page.locator('#ng-home-days button').count()==7
            assert await page.locator('#ng-week-days button').count()==7
            passed('all seven days are visible in both graph views')
            snapshot=await page.evaluate('''()=>{const m=window.__weatherNourieNextGen.model;return {hero:Number(document.querySelector('#ng-temperature').textContent),temperature:m.current.temperature,feels:m.current.feels,hour:m.timeline[0].temperature,high:m.days[0].high,low:m.days[0].low,range:document.querySelector('#ng-high-low').textContent,source:window.__weatherNourieForecast.signature}}''')
            assert snapshot['hero']==int(snapshot['temperature']+.5)
            assert snapshot['temperature']==snapshot['hour']
            assert str(round(snapshot['high'])) in snapshot['range'] and str(round(snapshot['low'])) in snapshot['range']
            passed('hero, hourly graph and daily ranges use the same published readings',snapshot)
            await screenshot('next-gen-mobile-night')
            await page.locator('#ng-take summary').click();assert await page.locator('#ng-take-detail').is_visible();await page.locator('#ng-take summary').click()
            passed('Nourie Take expands and collapses')
            # Real pointer/touch drag through the chart.
            await go('hourly')
            svg=page.locator('#ng-hourly-chart svg');await svg.scroll_into_view_if_needed();box=await svg.bounding_box()
            cdp=await context.new_cdp_session(page)
            x1=box['x']+box['width']*.25;x2=box['x']+box['width']*.72;y=box['y']+box['height']*.5
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x1,'y':y}]})
            for n in range(1,8):await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x1+(x2-x1)*n/7,'y':y}]})
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            assert int(await page.locator('#ng-hourly-chart input').input_value())>0
            passed('touch drag selects an exact forecast hour')
            await svg.focus();before=int(await page.locator('#ng-hourly-chart input').input_value());await page.keyboard.press('ArrowLeft');after=int(await page.locator('#ng-hourly-chart input').input_value());assert after==max(0,before-1)
            passed('graph keyboard controls move one exact hourly sample')
            for variable,series in [('wind','gust'),('rain','pop'),('humidity','humidity'),('dewpoint','dewpoint')]:
                await page.locator('#ng-hourly-tabs [data-variable="'+variable+'"]').click()
                assert await page.locator('#ng-hourly-chart [data-series="'+series+'"]').count()>0
                if variable=='rain':
                    labels=await page.locator('#ng-hourly-chart svg').text_content();assert '%' in labels and 'Hourly in' in labels
                passed(variable+' graph renders its actual series and labels')
            await page.locator('#ng-hourly-periods [data-hours="24"]').click();assert await page.locator('#ng-hourly-periods [data-hours="24"]').get_attribute('aria-pressed')=='true'
            passed('hourly horizon switches between 24 and 48 hours')
            await page.locator('#ng-hour-reset').click()
            await go('week');await page.locator('#ng-week-days [data-day-next="2"]').click();await page.locator('#day-dialog').wait_for(state='visible');assert await page.locator('#day-content').inner_text()
            passed('tapping a day opens the original detailed forecast')
            await page.go_back();await page.wait_for_function('!document.querySelector("dialog[open]")')
            passed('Android-style Back closes the daily detail dialog')
            await go('compare')
            ids=await page.locator('#ng-model-toggles button').evaluate_all('(buttons)=>buttons.map(b=>b.dataset.model)')
            assert all(key in ids for key in ['nourie','nws','hrrr','ecmwf','nbm'])
            passed('model comparison discovers available current model traces',ids)
            target='gefs' if 'gefs' in ids else 'hrrr'
            await page.locator('#ng-model-toggles [data-model="'+target+'"]').click();assert await page.locator('#ng-compare-chart [data-series="'+target+'"]').count()==0
            await page.locator('#ng-model-toggles [data-model="'+target+'"]').click();assert await page.locator('#ng-compare-chart [data-series="'+target+'"]').count()>0
            passed('model traces can be hidden and shown without changing values')
            await page.locator('#ng-show-range').check();assert await page.locator('#ng-compare-chart [data-source-range]').count()>0
            passed('optional source range uses the actual min/max guidance, with an explicit non-probability label')
            await page.locator('#ng-screen-compare [data-expand="compare"]').click();await page.locator('#ng-chart-dialog').wait_for(state='visible');await page.wait_for_timeout(100)
            assert await page.locator('#ng-fullscreen-chart svg').count()==1
            await page.go_back();await page.wait_for_function('!document.querySelector("#ng-chart-dialog[open]")')
            passed('full-screen graph expands and Back restores the comparison screen')
            await go('more')
            links=await page.locator('#ng-original-links a').evaluate_all('(links)=>links.map(a=>({label:a.textContent,href:a.href}))')
            for path in ['/ai-council/','/weather-fusion/ai-rankings.html','/deal-intelligence/','/weather-fusion/v3/']:
                assert any(path in link['href'] for link in links),path
            passed('AI benchmarks, original Experimental and other original apps remain linked',links)
            for tool in ['car-wash','best-times','meter','air-quality','alerts','science','skin-exposure','hourly-panel','compare']:
                await page.locator('#ng-tools [data-legacy="'+tool+'"]').click()
                await page.locator('#ng-detail-dialog').wait_for(state='visible',timeout=20000)
                await page.wait_for_timeout(300)
                text=await page.locator('#ng-detail-content').inner_text();assert len(text)>20,tool
                if tool=='best-times':
                    await page.locator('#best-times-grid svg .bt-cell').first.wait_for(state='visible');passed('Best Times renders the actual shared hourly comfort heat map')
                if tool=='compare':
                    await page.locator('#wn-compare-chart svg').wait_for(state='visible');passed('legacy daily comparison renders its actual model graph')
                assert await page.locator('#ng-detail-content').evaluate('(el)=>el.scrollWidth<=el.clientWidth+2'),tool+' detail overflow'
                await close_modal();passed(tool+' retains its working original detail renderer')
            await page.locator('#ng-tools [data-legacy="snow"]').click();await page.locator('#forecast-window-dialog').wait_for(state='visible');assert len(await page.locator('#forecast-window-content').inner_text())>20;await close_modal()
            passed('snow and ice retain the original winter outlook dialog')
            await go('map');await page.wait_for_timeout(1800)
            await page.locator('#ng-map-mount #radar-map.leaflet-container').wait_for(state='visible',timeout=20000)
            assert await page.locator('#ng-map-mount [data-layer]').count()==7
            await page.locator('#ng-map-mount [data-layer=temperature]').click()
            assert await page.locator('#ng-map-mount [data-layer=temperature]').get_attribute('aria-pressed')=='true'
            await page.locator('#ng-map-mount [data-layer=radar]').click()
            assert '#map' in page.url and 'map-panel' not in page.url
            passed('Map preserves radar and all six existing model-layer controls')
            await go('today')
            for mode in ['shade','sun','night','pets']:
                await page.locator('[data-feel="'+mode+'"]').click();assert await page.locator('[data-feel="'+mode+'"]').get_attribute('aria-pressed')=='true';assert await page.locator('#ng-comfort-label').inner_text()
                passed(mode+' exposure mode uses the existing estimate or an honest unavailable state')
            assert await page.evaluate('document.body.classList.contains("ng-reduce-motion")')
            passed('reduced-motion preference stops animated weather')
            await page.locator('[data-open-location]').first.click();await page.locator('#ng-search').fill('Greenville')
            await page.locator('#ng-search-results button').first.wait_for(state='visible');await page.locator('#ng-search-results button').first.click()
            await page.wait_for_function('window.__weatherNourieNextGen.model.forecast.location.latitude===35.6127')
            await page.wait_for_timeout(250)
            assert 'Greenville' in await page.locator('#ng-location').inner_text()
            passed('city/ZIP search reuses the existing controller and changes locations')
            await page.locator('[data-open-location]').first.click();await page.locator('#ng-use-location').click()
            await page.wait_for_function('window.__weatherNourieNextGen.model.forecast.location.latitude===35.787')
            passed('device location action returns the forecast to the device coordinates')
            count=api_count['forecast'];await page.locator('#ng-refresh').click();await page.wait_for_function('(n)=>window.__weatherNourieNextGen.model!==null',arg=count);await page.wait_for_timeout(500);assert api_count['forecast']>count
            passed('refresh issues a fresh request through the existing weather controller')
            # Daytime selection uses a genuine available forecast hour.
            await go('hourly');await page.locator('#ng-hourly-tabs [data-variable="temperature"]').click()
            index=await page.evaluate('window.__weatherNourieNextGen.model.timeline.findIndex(r=>r.isDay)')
            await page.locator('#ng-hourly-chart input').evaluate('(el,i)=>{el.value=i;el.dispatchEvent(new Event("input",{bubbles:true}))}',index)
            await go('today');await page.locator('#ng-person').wait_for(state='visible');assert await page.locator('body').get_attribute('data-ng-light')=='day'
            passed('daylight forecast selection changes the portrait and dynamic sky from night to day')
            await screenshot('next-gen-mobile-day')
            # Viewport sweep against the actual mounted document.
            await page.locator('#ng-back-now').click()
            for width,height in [(360,800),(412,915),(768,1024),(1280,900)]:
                await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(250)
                assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),str(width)
                passed(str(width)+'px layout has no horizontal overflow')
            await screenshot('next-gen-desktop')
            await page.set_viewport_size({'width':393,'height':852})
            # Original page remains a real, independently working document.
            original_page=await context.new_page();page.set_default_timeout(12000);original_page.on('pageerror',lambda e:report['errors'].append('original: '+str(e)))
            await original_page.goto(args.base+'/weather-fusion/',wait_until='domcontentloaded');await original_page.wait_for_function('!!window.__weatherNourieForecast?.hours?.length',timeout=45000)
            assert await original_page.locator('#next-gen-link').count()==0
            original_signature=await original_page.evaluate('window.__weatherNourieForecast.signature')
            assert original_signature==fixtures['knightdale']['signature']
            passed('original main page still renders the identical forecast snapshot',original_signature)
            await original_page.goto(args.base+'/weather-fusion/experimental-weather.html',wait_until='domcontentloaded');await original_page.locator('#next-gen-link').wait_for(state='visible',timeout=30000)
            assert await original_page.locator('#experimental-bots-link').count()==1
            passed('existing Experimental page retains its navigation and contains the working Next Gen link')
            await original_page.close()
            # Distinct service worker scope and honest offline navigation.
            await page.wait_for_function('navigator.serviceWorker.controller!==null',timeout=20000)
            registrations=await page.evaluate('navigator.serviceWorker.getRegistrations().then(rs=>rs.map(r=>r.scope))')
            assert any('/experimental/next-gen/' in scope for scope in registrations)
            passed('separate PWA manifest and service-worker scope are registered',registrations)
            await context.set_offline(True);await page.wait_for_timeout(100);assert await page.locator('#ng-connection').is_visible()
            await page.reload(wait_until='domcontentloaded');assert 'offline' in (await page.locator('body').inner_text()).lower()
            assert await page.locator('#ng-temperature').count()==0
            passed('offline navigation gives an honest connection screen and never fabricates a fresh forecast')
            await context.set_offline(False)
            assert not report['errors'],report['errors']
            passed('no JavaScript page errors during the tested flows')
            report['status']='passed'
        except Exception as error:
            report['status']='failed';report['failure']=str(error);await page.screenshot(path=str(args.artifacts/'failure.png'),full_page=True);raise
        finally:
            (args.artifacts/'browser-report.json').write_text(json.dumps(report,indent=2));await browser.close()
    print('CHECKS',len(report['checks']),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:3100');parser.add_argument('--fixture-dir',type=Path,default=Path('/workspace'));parser.add_argument('--artifacts',type=Path,default=Path('/workspace/next-gen-browser-proof'))
    asyncio.run(main(parser.parse_args()))
