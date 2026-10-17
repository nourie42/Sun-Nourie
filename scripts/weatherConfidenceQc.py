#!/usr/bin/env python3
"""Verify confidence categories, marker geometry and tap-to-explain against real backend data."""
import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=os.environ.get('WEATHER_TEST_BASE','http://127.0.0.1:3123');OUT=Path(os.environ.get('WEATHER_QA_DIR','/tmp/weather-confidence-qc'));OUT.mkdir(parents=True,exist_ok=True)
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'],proxy={'server':os.environ['HTTPS_PROXY'],'bypass':'127.0.0.1,localhost'})
 for city,lat,lon,width in [('Knightdale',35.7871,-78.481,320),('Knightdale',35.7871,-78.481,412),('Knightdale',35.7871,-78.481,1280),('Cortland',42.6012,-76.1805,412),('Hazen',47.2944,-101.6227,412)]:
  ctx=browser.new_context(viewport={'width':width,'height':960},geolocation={'latitude':lat,'longitude':lon},permissions=['geolocation'],reduced_motion='reduce');page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'/weather-fusion/',wait_until='domcontentloaded');page.wait_for_selector('.seven-day-card',timeout=120000)
  data=page.evaluate('window.__weatherNourieForecast');(OUT/f'{city.lower()}-{width}-forecast.json').write_text(json.dumps(data));assert data['days'][0]['confidence']['version']=='weather-nourie-confidence-calendar-inputs-v3'
  positions=page.locator('.seven-day-confidence').evaluate_all('es=>es.map(e=>{const meter=e.querySelector(".seven-day-meter"),dot=meter?.querySelector("span"),bar=meter?.getBoundingClientRect(),d=dot?.getBoundingClientRect(),card=e.closest("button").getBoundingClientRect();return {key:e.dataset.confidence,label:e.querySelector("strong").textContent,index:Number(meter?.dataset.confidenceScore),position:Number(dot?.style.getPropertyValue("--confidence").replace("%","")),aria:Number(meter?.getAttribute("aria-valuenow")),center:d?(d.left+d.right)/2:null,left:bar?.left,right:bar?.right,cardLeft:card.left,cardRight:card.right,dotLeft:d?.left,dotRight:d?.right};})')
  for i,position in enumerate(positions):
   expected={'high':100,'moderate':50,'low':0,'very-low':0}[position['key']];assert position['position']==expected==position['aria'],position
   assert abs(position['center']-(position['left']+(position['right']-position['left'])*expected/100))<1,position
   assert position['dotLeft']>=position['cardLeft']-1 and position['dotRight']<=position['cardRight']+1,position
   assert position['index']==data['days'][i]['confidence']['score']
  page.locator('#experimental-week').screenshot(path=str(OUT/f'{city.lower()}-{width}-week.png'))
  for i in [0,1]:
   card=page.locator('.seven-day-card').nth(i);card.locator('.seven-day-confidence').click();page.wait_for_selector('#day-dialog[open] .dialog-confidence[open]');details=page.locator('.dialog-confidence');text=details.inner_text();assert data['days'][i]['confidence']['summary'] in text,(i,text)
   assert 'not a probability or a measured accuracy percentage' in text
   visible=details.evaluate('e=>{const a=e.getBoundingClientRect(),b=e.closest("dialog").getBoundingClientRect();return a.top>=b.top-1&&a.top<b.bottom;}');assert visible
   page.locator('#day-dialog').screenshot(path=str(OUT/f'{city.lower()}-{width}-confidence-{i}.png'));page.locator('#close-day').click()
  text=page.locator('#today-uncertainty-text').inner_text();assert 'Consequently' not in text and 'decouple' not in text
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth');assert not errors,errors
  reports.append({'city':city,'width':width,'positions':positions,'reasons':[d['confidence']['summary'] for d in data['days'][:2]],'forecastWindow':[d['confidence']['window'] for d in data['days'][:2]],'weatherTake':text,'passed':True});(OUT/'report.json').write_text(json.dumps(reports,indent=2));print(json.dumps({'city':city,'width':width,'passed':True,'categories':[(x['label'],x['position']) for x in positions],'reason':reports[-1]['reasons']}),flush=True);ctx.close()
 browser.close()
