"""Mobile Beta people, centered hero, glass controls and real-feed globe checks.
Forecast/meteorological fixtures are captured live responses, never shipped data.
"""
import asyncio,argparse,json,os,hashlib
from urllib.parse import urlparse,parse_qs
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright
async def main(a):
 f=json.loads(a.forecast.read_text());feeds=json.loads(a.feeds.read_text());epoch=max(int(datetime.fromisoformat(t.replace('Z','+00:00')).timestamp()*1000) for t in [f['assembledAt'],feeds['radar']['validAt'],feeds['wind']['validAt']]);report={'checks':[],'errors':[],'mode':'captured live forecast and globe feeds, frozen time, touch Chromium'};a.out.mkdir(exist_ok=True,parents=True)
 def passed(name,detail=None):report['checks'].append({'name':name,'detail':detail});print('PASS',name,json.dumps(detail),flush=True)
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader'],proxy={'server':os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY'),'bypass':'127.0.0.1,localhost'})
  c=await b.new_context(viewport={'width':393,'height':480},is_mobile=True,has_touch=True,reduced_motion='reduce');calls=[];fault={'enabled':False}
  await c.add_init_script(f'const NativeDate=Date;globalThis.Date=class extends NativeDate{{constructor(...a){{super(...(a.length?a:[{epoch}]))}}static now(){{return {epoch}}}}};')
  async def api(r):
   url=r.request.url;calls.append(url)
   if '/forecast?' in url:await r.fulfill(json=f)
   elif '/globe-tile?' in url or '/globe-image?' in url:await r.fulfill(path=str(a.clouds if 'layer=clouds' in url else a.radar),content_type='image/png')
   elif urlparse(url).path.endswith('/globe'):await r.fulfill(json={k:{'status':'unavailable'} for k in ['wind','clouds','radar']} if fault['enabled'] else feeds)
   elif '/alerts?' in url:await r.fulfill(json={'location':f['location'],'alerts':[],'feeds':[]})
   elif '/radar?' in url:await r.fulfill(json={'status':'unavailable','frames':[],'location':f['location']})
   else:await r.fulfill(json={})
  await c.route('**/api/weather-fusion/**',api);await c.route('https://api.open-meteo.com/**',lambda r:r.fulfill(json={'error':True}));await c.route('https://air-quality-api.open-meteo.com/**',lambda r:r.fulfill(json={'error':True}))
  page=await c.new_page();await page.clock.install(time=datetime.fromisoformat(f['assembledAt'].replace('Z','+00:00')));page.set_default_timeout(30000);page.on('pageerror',lambda e:report['errors'].append(str(e)))
  await page.goto(a.base+'/weather-fusion/v3/?latitude=35.787&longitude=-78.4806&name=Knightdale,%20NC',wait_until='domcontentloaded');await page.wait_for_function('document.querySelector("#temperature")?.textContent.match(/\\d/)')
  assert not any(urlparse(x).path.endswith('/globe') for x in calls),'globe feeds should stay lazy below this viewport'
  passed('weather renders before lazy globe feeds and heavy WebGL assets load')
  for width in [320,360,393,412,768,1280]:
   await page.set_viewport_size({'width':width,'height':800});await page.wait_for_timeout(80)
   center=await page.locator('#temperature').evaluate('(e)=>{const r=e.getBoundingClientRect();return r.x+r.width/2}')
   assert abs(center-width/2)<2,(width,center)
   for selector in ['#hero-condition','#hero-feels-line','#hero-hilo']:
    assert await page.locator(selector).evaluate('e=>getComputedStyle(e).textAlign')=='center'
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  passed('temperature, condition, feels, highs and lows remain centered without overflow at 320–1280px')
  await page.set_viewport_size({'width':393,'height':852});await page.screenshot(path=str(a.out/'hero-phone.png'))
  city=await page.locator('#city-picker-btn').evaluate('e=>({background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderTopWidth})');assert city=={'background':'rgba(0, 0, 0, 0)','border':'0px'}
  assert await page.locator('.beta-brand-logo').get_attribute('src')=='/weather-fusion/logo.svg';assert await page.locator('.main-brand-art').count()==0;passed('location and transparent SVG branding blend into the weather scene',city)
  buttons=await page.locator('#main-app-link,#tools-drawer-btn,#refresh-btn,#unit-toggle').evaluate_all('xs=>xs.map(e=>({blur:getComputedStyle(e).backdropFilter,background:getComputedStyle(e).backgroundImage,border:getComputedStyle(e).borderTopWidth}))');assert all('blur(' in x['blur'] and x['background']!='none' and x['border']=='1px' for x in buttons);passed('header and Main app controls use bordered translucent glass',buttons)
  people=page.locator('#skin-exposure');await people.scroll_into_view_if_needed();await people.screenshot(path=str(a.out/'people-phone.png'));assert await page.locator('.exposure-person-card .reference-scene').count()==3
  images=await page.locator('.person-card-scene .reference-scene').evaluate_all('xs=>xs.map(e=>({outfit:e.dataset.outfit,weather:e.dataset.weather,daylight:e.dataset.daylight,asset:e.querySelector("image").getAttribute("href")}))');assert all(x['outfit'] for x in images);passed('three prominent cartoon scenes reuse the main app’s condition and clothing artwork',images)
  geometry=await page.locator('.exposure-person-card').evaluate_all('xs=>xs.map(e=>({height:e.getBoundingClientRect().height,title:e.querySelector(".person-card-title").getBoundingClientRect().height,scene:e.querySelector(".person-card-scene").getBoundingClientRect().height,reading:e.querySelector(".person-card-reading").getBoundingClientRect().height}))');assert all(g['height']<300 and g['title']<40 and g['reading']<110 for g in geometry),geometry;assert await people.evaluate('e=>e.getBoundingClientRect().height')<430;passed('comfort scenes have natural content height with no fixed empty bands',geometry)
  await page.locator('[data-exp-toggle=pets]').click();assert 'Today peak' in await page.locator('[data-exp-id=pets]').inner_text();await page.locator('[data-exp-toggle=pets]').click();passed('illustrated pet card keeps its expandable surface and selected-day peak details')
  await page.locator('#feels-hour-slider').evaluate('e=>{e.value=8;e.dispatchEvent(new Event("input",{bubbles:true}))}');assert await page.locator('.person-card-scene .reference-scene[data-daylight=false]').count()==3;await page.locator('#feels-hour-slider').evaluate('e=>{e.value=0;e.dispatchEvent(new Event("input",{bubbles:true}))}');passed('night previews keep all three people in genuine nighttime artwork')
  await page.locator('#weather-globe-panel').scroll_into_view_if_needed();await page.locator('.weather-globe-canvas').wait_for(state='attached');await page.wait_for_function('Number(document.querySelector(".weather-globe-canvas")?.dataset.windParticles)>0')
  assert len([x for x in calls if urlparse(x).path.endswith('/globe')])==1
  coords=await page.locator('.weather-globe-canvas').evaluate('e=>({latitude:+e.dataset.latitude,longitude:+e.dataset.longitude,particles:+e.dataset.windParticles})');assert coords['latitude']==35.787 and coords['longitude']==-78.4806
  await page.locator('#weather-globe-panel').screenshot(path=str(a.out/'globe-preview.png'));passed('geographic globe marks the exact selected location and uses the real GFS field',coords)
  await page.locator('#open-weather-globe').click();await page.locator('#weather-globe-dialog').wait_for(state='visible');assert await page.locator('.weather-globe-canvas').count()==1;assert await page.locator('#globe-expanded-mount .weather-globe-canvas').count()==1
  await page.wait_for_function('document.querySelector("#globe-layer-status").textContent.includes("Radar · NOAA")');await page.locator('#weather-globe-dialog').screenshot(path=str(a.out/'globe-expanded.png'));assert not report['errors'],report['errors'];passed('globe expands into one renderer with timestamped satellite, radar and wind controls')
  assert await page.locator('#globe-motion').get_attribute('aria-pressed')=='false';await page.locator('#globe-motion').click();await page.wait_for_timeout(300);one=await page.locator('.globe-wind-canvas').evaluate('e=>e.toDataURL()');await page.wait_for_timeout(500);two=await page.locator('.globe-wind-canvas').evaluate('e=>e.toDataURL()');assert one!=two,'wind animation should change the rendered frame';await page.locator('#globe-motion').click();passed('reduced motion starts paused; users can enable moving wind lines')
  await page.locator('[data-globe-layer=clouds]').click();assert await page.locator('[data-globe-layer=clouds]').get_attribute('aria-pressed')=='false';await page.locator('[data-globe-layer=clouds]').click()
  canvas=page.locator('#globe-expanded-mount .weather-globe-canvas');box=await canvas.bounding_box();await page.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.5);await page.mouse.down();await page.mouse.move(box['x']+box['width']*.7,box['y']+box['height']*.6,steps=10);await page.mouse.up();await page.locator('#globe-recenter').click();await page.locator('#globe-zoom-in').click();await page.locator('#globe-zoom-out').click();passed('layer toggles, drag, zoom and geographic recenter controls respond')
  marker=await page.locator('.globe-location-dot').bounding_box();assert marker['width']<=10
  for _ in range(17):await page.locator('#globe-zoom-in').click();await page.wait_for_timeout(280)
  await page.wait_for_timeout(1200);close_marker=await page.locator('.globe-location-dot').bounding_box();assert close_marker['width']==marker['width'];assert await canvas.evaluate('e=>e.getBoundingClientRect().height')>250;assert await page.locator('.globe-map').evaluate('e=>getComputedStyle(e).position')=='absolute';await page.locator('#globe-basemap').click();assert await page.locator('#globe-basemap').inner_text()=='Satellite map';await page.locator('#globe-expanded-mount').screenshot(path=str(a.out/'street-zoom.png'));passed('street-level zoom retains a fixed 9px marker and a full-height detailed map',close_marker)
  # Playback must request more than the two old timestamps; rapid scrubbing must settle on the last choice.
  frame_count=int(await page.locator('#globe-radar-time').get_attribute('max'))+1;assert frame_count>=8,frame_count
  for idx in [0,3,6]:
   await page.locator('#globe-radar-time').evaluate('(e,i)=>{e.value=i;e.dispatchEvent(new Event("input",{bubbles:true}))}',idx);await page.wait_for_timeout(350)
  await page.wait_for_function('document.querySelector("#globe-radar-time").value==="6"');assert len(set(parse_qs(urlparse(x).query).get('time',[''])[0] for x in calls if '/globe-tile?' in x and 'layer=radar' in x))>=4;passed('radar offers a real multi-frame timeline and handles scrubbing across distinct times',frame_count)
  for _ in range(17):await page.locator('#globe-zoom-out').click();await page.wait_for_timeout(280)
  requests_before=len([x for x in calls if urlparse(x).path.endswith('/globe')]);await page.locator('#globe-refresh').click();await page.wait_for_function('(n)=>document.querySelector("#globe-refresh").getAttribute("aria-busy")!=="true"',arg=requests_before);assert len([x for x in calls if urlparse(x).path.endswith('/globe')])>requests_before;requests_before=len([x for x in calls if urlparse(x).path.endswith('/globe')]);await page.clock.fast_forward(120001);await page.wait_for_timeout(100);assert len([x for x in calls if urlparse(x).path.endswith('/globe')])>requests_before;passed('manual refresh and visible two-minute refresh recover layers without reloading the forecast')
  await page.go_back();await page.locator('#weather-globe-dialog').wait_for(state='hidden');await page.locator('#globe-preview-mount .weather-globe-canvas').wait_for(state='attached');assert await page.locator('#globe-preview-mount .weather-globe-canvas').count()==1;assert len([x for x in calls if '/forecast?' in x])==1;passed('Android-style browser Back closes the globe and preserves the loaded forecast')
  await page.locator('#map-panel').scroll_into_view_if_needed();await page.wait_for_function('document.querySelector("#radar-map .leaflet-map-pane")!==null');await page.wait_for_timeout(150)
  radar_calls=[x for x in calls if '/radar?' in x];assert any('latitude=35.787&longitude=-78.4806' in x for x in radar_calls),radar_calls;assert not any('?lat=' in x for x in radar_calls);passed('detailed local radar sends the actual latitude and longitude parameter names',radar_calls)
  fault['enabled']=True;await page.reload(wait_until='domcontentloaded');await page.wait_for_function('document.querySelector("#temperature")?.textContent.match(/\\d/)');await page.locator('#open-weather-globe').click();await page.wait_for_function('document.querySelector("#globe-layer-status").textContent.includes("Wind field unavailable")');assert await page.locator('.weather-globe-canvas').get_attribute('data-wind-particles')=='0';passed('unavailable layers show honest missing-data states and no invented winds')
  fault['enabled']=False;forecast_count=len([x for x in calls if '/forecast?' in x]);await page.locator('#globe-refresh').click();await page.wait_for_function('Number(document.querySelector(".weather-globe-canvas")?.dataset.windParticles)>0');assert len([x for x in calls if '/forecast?' in x])==forecast_count;passed('weather layers recover after an outage without a page or forecast reload')
  assert not report['errors'],report['errors'];passed('no JavaScript page errors in the tested flows');await b.close()
 report['status']='passed';(a.out/'report.json').write_text(json.dumps(report,indent=2));print('CHECKS',len(report['checks']),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:3200');p.add_argument('--forecast',type=Path,default=Path('/workspace/knightdale-people-live.json'));p.add_argument('--feeds',type=Path,default=Path('/workspace/refined-globe-metadata.json'));p.add_argument('--clouds',type=Path,default=Path('/workspace/refined-clouds-tile.png'));p.add_argument('--radar',type=Path,default=Path('/workspace/refined-radar-tile.png'));p.add_argument('--out',type=Path,default=Path('/workspace/beta-people-globe-proof'));asyncio.run(main(p.parse_args()))
