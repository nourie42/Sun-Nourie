"""Real, unmodified upstream forecast smoke checks for the deployed preview."""
import argparse,asyncio,json,os,time
from pathlib import Path
from playwright.async_api import async_playwright
async def main(args):
 args.artifacts.mkdir(parents=True,exist_ok=True)
 result={'base':args.base,'mode':'real live API, no forecast fixtures or frozen clocks','checks':[],'errors':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],proxy={'server':os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')})
  for city,lat,lon in [('knightdale',35.787,-78.4806),('greenville',35.6127,-77.3664)]:
   context=await browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,device_scale_factor=1,permissions=['geolocation'],geolocation={'latitude':lat,'longitude':lon})
   page=await context.new_page();page.set_default_timeout(20000)
   page.on('pageerror',lambda e:result['errors'].append(str(e)))
   start=time.monotonic()
   await page.goto(result['base']+'/experimental/next-gen/?location='+city,wait_until='domcontentloaded',timeout=60000)
   await page.wait_for_function('!!window.__weatherNourieNextGen?.model',timeout=60000)
   await page.locator('#ng-person').wait_for(state='visible',timeout=30000)
   await page.wait_for_timeout(1500)
   state=await page.evaluate('''()=>{const m=window.__weatherNourieNextGen.model;return {city:m.forecast.location.name,signature:m.forecast.signature,assembledAt:m.forecast.assembledAt,current:m.current.temperature,feels:m.current.feels,hero:document.querySelector('#ng-temperature').textContent,days:m.days.length,hours:m.timeline.length,photo:document.querySelector('#ng-person').getAttribute('src'),light:document.body.dataset.ngLight,overflow:document.documentElement.scrollWidth>innerWidth,feedIssues:m.forecast.feeds.filter(f=>f.status!=='ready').map(f=>({id:f.id,status:f.status})),brokenVisibleImages:[...document.querySelectorAll('img[src]')].filter(img=>img.getClientRects().length&&img.complete&&img.naturalWidth===0).map(img=>img.src)}}''')
   assert city.lower() in state['city'].lower();assert state['days']==7;assert not state['overflow'];assert not state['brokenVisibleImages']
   result['checks'].append({'name':city+' real mobile forecast and portrait','passed':True,'loadSeconds':round(time.monotonic()-start,2),'state':state});print(json.dumps(result['checks'][-1]),flush=True)
   await page.screenshot(path=str(args.artifacts/('live-'+city+'.png')),full_page=False)
   await page.locator('.ng-bottom-nav [data-view-link=compare]').click()
   await page.locator('#ng-compare-chart [data-series=nourie]').first.wait_for(state='visible')
   result['checks'].append({'name':city+' real model comparison','passed':True,'models':await page.locator('#ng-model-toggles button').evaluate_all('(bs)=>bs.map(b=>b.textContent.trim())')})
   print('PASS',city,'real comparison',flush=True)
   if city=='knightdale':
    await page.locator('.ng-bottom-nav [data-view-link=map]').click()
    await page.locator('#radar-map.leaflet-container').wait_for(state='visible',timeout=30000)
    await page.wait_for_timeout(8000)
    result['checks'].append({'name':'real map and radar control mounting','passed':True,'layers':await page.locator('#ng-map-mount [data-layer]').count(),'status':await page.locator('#map-error').text_content(),'radarStamp':await page.locator('#radar-stamp').text_content()})
    print('PASS real map',json.dumps(result['checks'][-1]),flush=True)
    play=page.locator('#radar-play')
    if not await play.is_disabled():
     await play.click()
     if await play.get_attribute('aria-label')=='Pause radar animation':
      await page.locator('.ng-bottom-nav [data-view-link=today]').click()
      assert (await play.get_attribute('aria-label')).startswith('Play')
      result['checks'].append({'name':'map playback pauses after leaving Map','passed':True});print('PASS map playback stops on navigation',flush=True)
   await context.close()
  await browser.close()
 assert not result['errors'],result['errors']
 result['status']='passed'
 (args.artifacts/'live-verification.json').write_text(json.dumps(result,indent=2))
 print('LIVE CHECKS',len(result['checks']),flush=True)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--base',default='https://weather-nourie-next-gen.onrender.com');parser.add_argument('--artifacts',type=Path,default=Path('/workspace/next-gen-live-final'))
 asyncio.run(main(parser.parse_args()))
