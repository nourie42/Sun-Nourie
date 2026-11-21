"""Controlled real-forecast checks for sky, startup, shared cards and alert dialogs."""
import argparse,asyncio,copy,json,os,subprocess
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

async def main(args):
 original=json.loads(args.fixture.read_text());epoch=int(datetime.fromisoformat(original['assembledAt'].replace('Z','+00:00')).timestamp()*1000)
 args.artifacts.mkdir(parents=True,exist_ok=True);report={'mode':'captured forecast, frozen clock, 400ms forecast delay; mobile Chromium at 4x CPU slowdown','checks':[],'errors':[],'timings':{}}
 def passed(name,detail=None):report['checks'].append({'name':name,'passed':True,'detail':detail});print('PASS',name,json.dumps(detail),flush=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],proxy={'server':os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY'),'bypass':'127.0.0.1,localhost'})
  async def context(before=False,device=False,delay=.4):
   ctx=await browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,reduced_motion='reduce');data={'forecast':copy.deepcopy(original),'calls':[]}
   await ctx.add_init_script(f'''const NativeDate=Date;globalThis.Date=class extends NativeDate{{constructor(...a){{super(...(a.length?a:[{epoch}]))}}static now(){{return {epoch}}}}};
    localStorage.setItem('{"weather-fusion-device-place" if device else "weather-fusion-selected-city"}',JSON.stringify({{id:'test-point',name:'Knightdale, NC',latitude:35.787,longitude:-78.4806}}));
    navigator.geolocation.getCurrentPosition=(ok)=>setTimeout(()=>{{ok({{coords:{{latitude:35.787,longitude:-78.4806}}}});window.__gpsConfirmed=true;}},{8000 if device else 2500});
    requestAnimationFrame(function check(){{const n=document.querySelector('#temperature');if(n&&/\\d/.test(n.textContent)){{window.__firstWeatherFrame=performance.now();return}}requestAnimationFrame(check)}});
   ''')
   async def route(route):
    url=route.request.url;f=data['forecast']
    if '/forecast?' in url:data['calls'].append(url);await asyncio.sleep(delay);await route.fulfill(json=f)
    elif '/alerts?' in url:await route.fulfill(json={'location':f['location'],'alerts':f.get('alerts',[]),'feeds':[x for x in f.get('feeds',[]) if x['id']=='alerts']})
    elif '/bulletins?' in url:await route.fulfill(json={'mode':'official','signature':f['signature'],'notices':[]})
    elif '/outlook?' in url:await route.fulfill(json={'kind':'wpc','title':'Marginal flood risk','level':'Marginal','features':[],'location':f['location'],'discussion':'Official outlook details for this test location.'})
    elif '/radar?' in url:await route.fulfill(json={'status':'unavailable','frames':[],'precipitation':{'status':'unavailable'},'location':f['location']})
    else:await route.fulfill(json={})
   await ctx.route('**/api/weather-fusion/**',route)
   await ctx.route('https://api.open-meteo.com/**',lambda r:r.fulfill(status=503,json={'error':True}))
   await ctx.route('https://air-quality-api.open-meteo.com/**',lambda r:r.fulfill(status=503,json={'error':True}))
   if before:
    for filename,url in [('index.html','**/weather-fusion/'),('app.js','**/weather-fusion/app.js?*')]:
     source=subprocess.check_output(['git','show',args.before_ref+':public/weather-fusion/'+filename],text=True)
     def responder(body,kind):
      async def handle(route):await route.fulfill(body=body,content_type=kind)
      return handle
     await ctx.route(url,responder(source,'text/html' if filename.endswith('html') else 'text/javascript'))
   page=await ctx.new_page();page.set_default_timeout(20000);page.on('pageerror',lambda e:report['errors'].append(str(e)))
   cdp=await ctx.new_cdp_session(page);await cdp.send('Emulation.setCPUThrottlingRate',{'rate':4})
   return ctx,page,data
  if args.before_ref:
   ctx,page,data=await context(before=True);await page.goto(args.base+'/weather-fusion/',wait_until='domcontentloaded');await page.wait_for_function('!!window.__firstWeatherFrame');report['timings']['beforeMs']=round(await page.evaluate('window.__firstWeatherFrame'));report['timings']['beforeRequests']=len(data['calls']);await ctx.close()
  ctx,page,data=await context();await page.goto(args.base+'/weather-fusion/',wait_until='domcontentloaded');await page.wait_for_function('!!window.__firstWeatherFrame');report['timings']['afterMs']=round(await page.evaluate('window.__firstWeatherFrame'))
  await page.wait_for_function('document.querySelector("#metrics")?.children.length>0');await page.locator('.exp-sky-layer.on').first.wait_for(state='attached')
  state=await page.evaluate('''()=>({sky:document.body.dataset.sky,header:document.documentElement.dataset.hdr,image:document.querySelector('.exp-sky-layer.on')?.dataset.img,condition:document.querySelector('#condition').textContent,temperature:document.querySelector('#temperature').textContent,signature:window.__weatherNourieForecast.signature})''')
  assert state['sky']=='cloudy' and state['header']=='cloudy' and state['image']=='weather-her-bg-cloudy-day-feels-32-59f.webp',state
  assert state['signature']==original['signature'];assert len(data['calls'])==1,data['calls']
  passed('overcast sky uses sun-free art and the same current forecast with one request',state)
  report['timings']['afterRequests']=len(data['calls']);passed('first weather frame performance measurement',report['timings'])
  await page.screenshot(path=str(args.artifacts/'main-overcast-top.png'))
  style=lambda selector:page.locator(selector).evaluate('(el)=>{const c=getComputedStyle(el);return Object.fromEntries(["backgroundImage","backgroundColor","borderRadius","borderColor","backdropFilter","boxShadow","textShadow"].map(k=>[k,c[k]]))}')
  main_style=await style('.hourly-panel.glass')
  panel=page.locator('#weather-outlook-summary');await panel.wait_for(state='visible');kinds=await panel.locator('[data-outlook-item]').evaluate_all('(bs)=>bs.map(b=>b.dataset.outlookItem)');assert kinds
  await panel.screenshot(path=str(args.artifacts/'main-outlook-panel.png'))
  async def dialogs(beta=False):
   host=page.locator('#weather-outlook-summary')
   await host.locator('.outlook-take').click();await page.locator('dialog[open]').last.wait_for(state='visible');await page.keyboard.press('Escape')
   buttons=await host.locator('[data-outlook-item]').evaluate_all('(bs)=>bs.map(b=>b.dataset.outlookItem)')
   for key in buttons:
    await host.locator('[data-outlook-item="'+key+'"]').click();await page.locator('dialog[open]').last.wait_for(state='visible');await page.keyboard.press('Escape');await page.wait_for_timeout(50)
   passed(('Beta' if beta else 'Main')+' Nourie Take and every applicable alert item open a dialog',buttons)
  await dialogs()
  for width in [320,360,393,412,768,1280]:
   await page.set_viewport_size({'width':width,'height':852});await page.wait_for_timeout(50);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  passed('main outlook panel has no horizontal overflow at 320–1280px')
  # Missing/non-qualifying conditions remove buttons, rather than displaying an all-clear alert.
  quiet=copy.deepcopy(original);quiet['signature']='quiet-test';quiet['riskOutlooks']=[];quiet['danTake']=[]
  for d in quiet['days']:d.update(pop=0,qpf=0,rainLikelihood={'value':0})
  for h in quiet['hours']:h.update(condition='Overcast',pop=0,precipitation=0,skyCover=100,rainLikelihood={'value':0})
  for h in quiet.get('rainTimeline',[]):h.update(condition='Overcast',rainLikelihood={'value':0},precipitation=0)
  for key,rows in quiet.get('metricForecasts',{}).get('series',{}).items():
   for r in rows:
    if key=='temperature':r['value']=60
    if key=='dewpoint':r['value']=50
    if key=='feels':r['value']=60;r.setdefault('inputs',{})['skyCover']=100
  data['forecast']=quiet;await page.locator('#refresh').click();await page.wait_for_function('window.__weatherNourieForecast?.signature==="quiet-test"');await page.wait_for_timeout(250)
  assert await panel.locator('[data-outlook-item]').count()==0,await panel.inner_text()
  passed('non-applicable informational alert buttons are absent')
  await ctx.close()
  ctx,page,data=await context(delay=5);await page.goto(args.base+'/weather-fusion/',wait_until='domcontentloaded');await page.locator('#weather-loading').wait_for(state='visible');assert await page.evaluate('document.body.dataset.sky==="unknown"&&document.documentElement.dataset.hdr==="unknown"&&!document.querySelector(".exp-sky-layer.on")');await page.screenshot(path=str(args.artifacts/'main-loading.png'));passed('loading state is visible with no invented sunny sky');await page.wait_for_function('!!window.__firstWeatherFrame');await ctx.close()
  ctx,page,data=await context(device=True);await page.goto(args.base+'/weather-fusion/',wait_until='domcontentloaded');await page.wait_for_function('!!window.__firstWeatherFrame');first=await page.evaluate('window.__firstWeatherFrame');assert first<8000,first
  await page.wait_for_function('window.__gpsConfirmed===true');assert len(data['calls'])==1,data['calls'];passed('cached device point starts before slow GPS and unchanged GPS does not duplicate the request',{'firstFrameMs':round(first),'forecastRequests':len(data['calls'])})
  await ctx.close()
  ctx,page,data=await context();await page.goto(args.base+'/weather-fusion/v3/?latitude=35.787&longitude=-78.4806&name=Knightdale',wait_until='domcontentloaded');await page.wait_for_function('(t)=>document.querySelector("#temperature")?.textContent===t+"°"',arg=round(original['current']['temperature']));await page.locator('#weather-outlook-summary').wait_for(state='visible')
  beta_style=await style('#next-24-panel');assert beta_style==main_style,(main_style,beta_style);passed('Beta outer tile finish exactly matches the main app',beta_style)
  await page.screenshot(path=str(args.artifacts/'beta-top.png'))
  await page.locator('#weather-outlook-summary').screenshot(path=str(args.artifacts/'beta-outlook-panel.png'));await dialogs(True)
  for width in [320,360,393,412,768,1280]:
   await page.set_viewport_size({'width':width,'height':852});await page.wait_for_timeout(100);assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  passed('responsive outlook panels have no overflow at 320–1280px')
  assert not report['errors'],report['errors'];passed('no JavaScript page errors')
  await ctx.close();await browser.close()
 report['status']='passed';(args.artifacts/'report.json').write_text(json.dumps(report,indent=2));print('CHECKS',len(report['checks']),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:3200');p.add_argument('--fixture',type=Path,default=Path('/workspace/main-current-live.json'));p.add_argument('--artifacts',type=Path,default=Path('/workspace/weather-sky-loading-proof'));p.add_argument('--before-ref')
 asyncio.run(main(p.parse_args()))
