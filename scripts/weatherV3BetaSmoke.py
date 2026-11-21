"""Selected-day pet peaks, uniform card spacing and main-app Beta entry.
Uses captured canonical forecasts; supplementary APIs are explicitly unavailable.
"""
import argparse,asyncio,json,os
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse,parse_qs
from playwright.async_api import async_playwright

async def main(args):
 fixtures={city:json.loads((args.fixture_dir/(city+'-live.json')).read_text()) for city in ['knightdale','greenville']}
 epoch=max(int(datetime.fromisoformat(f['assembledAt'].replace('Z','+00:00')).timestamp()*1000) for f in fixtures.values())
 args.artifacts.mkdir(parents=True,exist_ok=True)
 report={'mode':'captured canonical forecasts, frozen clock; headless mobile Chromium','checks':[],'errors':[]}
 def passed(name,detail=None):
  report['checks'].append({'name':name,'passed':True,**({'detail':detail} if detail is not None else {})});print('PASS',name,flush=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],proxy={'server':os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY'),'bypass':'127.0.0.1,localhost'})
  context=await browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,reduced_motion='reduce',permissions=['geolocation'],geolocation={'latitude':35.787,'longitude':-78.4806})
  await context.add_init_script(f'const NativeDate=Date;globalThis.Date=class extends NativeDate{{constructor(...a){{super(...(a.length?a:[{epoch}]))}}static now(){{return {epoch}}}}};')
  async def route_api(route):
   u=urlparse(route.request.url);q=parse_qs(u.query);city='greenville' if any(v.startswith('35.6127') for v in q.get('latitude',[])) else 'knightdale';f=fixtures[city]
   if u.path.endswith('/forecast'):await route.fulfill(json=f)
   elif u.path.endswith('/alerts'):await route.fulfill(json={'location':f['location'],'alerts':[],'feeds':[]})
   elif u.path.endswith('/briefing'):await route.fulfill(json={})
   elif u.path.endswith('/radar'):await route.fulfill(json={'status':'unavailable','frames':[],'precipitation':{'status':'unavailable'},'location':f['location']})
   else:await route.fulfill(json={})
  await context.route('**/api/weather-fusion/**',route_api)
  await context.route('https://api.open-meteo.com/**',lambda r:r.fulfill(status=503,json={'error':True}))
  await context.route('https://air-quality-api.open-meteo.com/**',lambda r:r.fulfill(status=503,json={'error':True}))
  page=await context.new_page();page.set_default_timeout(20000);page.on('pageerror',lambda e:(report['errors'].append(str(e)),print('PAGEERROR',str(e),flush=True)))
  async def set_hour(i):
   await page.locator('#feels-hour-slider').evaluate('(el,i)=>{el.value=i;el.dispatchEvent(new Event("input",{bubbles:true}))}',i)
  for city,lat,lon in [('knightdale',35.787,-78.4806),('greenville',35.6127,-77.3664)]:
   await page.goto(f'{args.base}/weather-fusion/v3/?latitude={lat}&longitude={lon}&name={city}',wait_until='domcontentloaded')
   expected_info=await page.evaluate('''async ({fixture,loc})=>{
    const {buildUnifiedFusionPayload}=await import('/weather-fusion/v3/js/fusion-engine.js?v=v3-accuracy-5');
    const {computePavementProfile}=await import('/weather-fusion/v3/js/physics.js?v=v3-pet-day-6');
    const f=buildUnifiedFusionPayload(loc,null,null,null,{wfo:fixture.location?.office||'NWS',alerts:[],afdText:null,nwsHourlyMap:new Map(),available:true},fixture);
    const p=computePavementProfile(f.hoursAll,0,loc.latitude,loc.longitude,f.hoursAll.length);
    const day=new Intl.DateTimeFormat('en-US',{timeZone:f.timeZone,weekday:'short'});
    const key=new Intl.DateTimeFormat('en-CA',{timeZone:f.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
    const selections=['Sat','Sun','Mon'].map(label=>{
     const indices=f.hours48.map((h,i)=>day.format(new Date(h.time))===label?i:-1).filter(i=>i>=0);const idx=indices.at(-1);if(idx===undefined)return null;
     const target=key.format(new Date(f.hours48[idx].time));const readings=p.series.filter(s=>key.format(new Date(s.time))===target);
     return {idx,label,hours:readings.length,concrete:Math.max(...readings.map(s=>s.concreteF)),asphalt:Math.max(...readings.map(s=>s.asphaltF)),current:p.series[idx]};
    }).filter(Boolean);return {selections,temperature:Math.round(f.current.tempF),rain:f.days[0].rainChance};
   }''',{'fixture':fixtures[city],'loc':{'latitude':lat,'longitude':lon,'name':city}})
   await page.wait_for_function('(e)=>document.querySelector("#temperature")?.textContent===e.temperature+"°"&&document.querySelector("#qs-rain-val")?.textContent===e.rain+"%"',arg=expected_info)
   expected=expected_info['selections']
   assert any(e['label']=='Mon' for e in expected),'Monday preview must be available'
   await page.locator('[data-exp-toggle=pets]').click()
   for e in expected:
    await set_hour(e['idx']);texts=await page.locator('[data-exp-id=pets] .pave-row-head strong').all_text_contents()
    label='Today peak' if e['label']=='Sat' else e['label']+' peak'
    assert f"({label} {e['concrete']}°)" in texts[0],(e,texts)
    assert f"({label} {e['asphalt']}°)" in texts[1],(e,texts)
    assert f"{e['hours']} available forecast hours" in await page.locator('.pavement-peak-note').inner_text()
    if e['label']!='Sat':assert all('Today peak' not in t for t in texts)
    passed(city+' '+e['label']+' preview uses that local day’s actual concrete and asphalt peaks',e)
   monday=next(e for e in expected if e['label']=='Mon')
   if not await page.locator('#unit-toggle').is_visible():await page.locator('#tools-drawer-btn').click()
   await page.locator('#unit-toggle').click()
   text=' '.join(await page.locator('[data-exp-id=pets] .pave-row-head strong').all_text_contents())
   c=lambda f:int((f-32)*5/9+.5)
   assert f"Mon peak {c(monday['asphalt'])}°" in text
   await page.locator('#unit-toggle').click();await page.locator('#tools-drawer-btn').click();passed(city+' selected-day peaks retain Celsius conversion')
   await page.locator('[data-exp-id=pets]').screenshot(path=str(args.artifacts/(city+'-monday-pets.png')))
   await page.locator('[data-exp-toggle=pets]').click();await set_hour(0)
   # Controlled warning markup exercises the otherwise-empty alert stack.
   await page.locator('#urgent-alerts-container').evaluate("(el)=>{el.replaceChildren(...['Test warning one','Test warning two'].map(text=>{const card=document.createElement('div');card.className='urgent-alert-banner';card.textContent=text;return card}))}")
   for width,height in [(360,800),(393,852),(412,915),(768,1024),(1280,900)]:
    await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(100)
    gaps=await page.evaluate('''()=>{
     const rects=s=>[...document.querySelector(s).children].filter(e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom}});
     const values=[];
     for(const s of ['.v3-main-stack','#urgent-alerts-container','.exposure-teaser-stack','.top-compact-pills','.comfort-trio-grid','.apple-tiles-grid']){
      const rows=[];for(const r of rects(s)){let row=rows.find(row=>Math.abs(row[0].y-r.y)<1);if(!row){row=[];rows.push(row)}row.push(r)}
      for(let i=0;i<rows.length;i++){const row=rows[i].sort((a,b)=>a.x-b.x);for(let j=1;j<row.length;j++)values.push({pair:s+' horizontal',gap:row[j].x-row[j-1].right});if(i)values.push({pair:s+' vertical',gap:row[0].y-Math.max(...rows[i-1].map(r=>r.bottom))});}
     }
     return {values,overflow:document.documentElement.scrollWidth>innerWidth};
    }''')
    assert not gaps['overflow'],(width,gaps)
    assert all(abs(g['gap']-16)<.6 for g in gaps['values']),(width,gaps)
    passed(city+' '+str(width)+'px cards use equal 16px gaps without overflow')
   passed(city+' populated warning stack keeps the same spacing as all other cards')
   await page.locator('#urgent-alerts-container').evaluate('(el)=>el.replaceChildren()')
   await page.set_viewport_size({'width':393,'height':852});await page.evaluate('scrollTo({top:0,behavior:"instant"})')
   await page.screenshot(path=str(args.artifacts/(city+'-v3-top.png')))
  await page.goto(args.base+'/weather-fusion/',wait_until='domcontentloaded')
  beta=page.locator('#try-beta-link');await beta.wait_for(state='visible');box=await beta.bounding_box()
  assert await beta.inner_text()=='Try Beta';assert box['y']<350 and box['height']<=46 and box['width']<125,box
  assert await beta.get_attribute('href')=='/weather-fusion/v3/'
  await page.screenshot(path=str(args.artifacts/'main-try-beta.png'))
  await beta.click();await page.wait_for_url('**/weather-fusion/v3/')
  assert await page.locator('#feels-hour-slider').count()==1
  passed('main app shows a small Try Beta box near the top that opens V3',box)
  assert not report['errors'],report['errors'];passed('no JavaScript page errors in the exercised flows')
  await browser.close()
 report['status']='passed';(args.artifacts/'report.json').write_text(json.dumps(report,indent=2));print('CHECKS',len(report['checks']),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:3200');p.add_argument('--fixture-dir',type=Path,default=Path('/workspace'));p.add_argument('--artifacts',type=Path,default=Path('/workspace/v3-beta-proof'))
 asyncio.run(main(p.parse_args()))
