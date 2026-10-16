#!/usr/bin/env python3
"""Audit real deployed forecast values across all main weather sections.
No fixtures, response overrides, or frontend helpers produce expected values.
"""
import json,math,os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
BASE=os.getenv('WEATHER_TEST_BASE','http://127.0.0.1:3123').rstrip('/')
OUT=Path(os.getenv('WEATHER_QA_DIR','/tmp/weather-consistency-qc'));OUT.mkdir(parents=True,exist_ok=True)
WIDTHS=[int(w) for w in os.getenv('WEATHER_QA_WIDTHS','412,1280').split(',')]
CITIES=[('Knightdale',35.787,-78.4806),('Cortland',42.6012,-76.1805),('Hazen',47.2944,-101.6227)]
def epoch(s):return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000
def finite(v):return isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v)
def shown(v,suffix='°'):return str(math.floor(v+.5))+suffix if finite(v) else '—'
def check(v,message,detail=None):
 if not v:raise AssertionError(message+(': '+json.dumps(detail) if detail is not None else ''))
def rain_rows(f,start,end):return [r for r in f['rainTimeline'] if epoch(r['time'])<end and epoch(r['end'])>start]
def total(rows,start,end):
 cursor=start;amount=0
 for r in rows:
  a,b=epoch(r['time']),epoch(r['end']);left,right=max(start,a),min(end,b)
  if left>cursor or not finite(r.get('precipitation')):return None
  span=max(0,right-max(cursor,left));amount+=r['precipitation']*span/(b-a);cursor=max(cursor,right)
 return amount if cursor>=end else None
reports=[]
with sync_playwright() as p:
 args={'headless':True,'executable_path':os.getenv('CHROMIUM_PATH','/usr/bin/chromium'),'args':['--no-sandbox']}
 if os.getenv('HTTPS_PROXY') or os.getenv('HTTP_PROXY'):args['proxy']={'server':os.getenv('HTTPS_PROXY',os.getenv('HTTP_PROXY')),'bypass':'127.0.0.1,localhost'}
 browser=p.chromium.launch(**args)
 for city,lat,lon in CITIES:
  for width in WIDTHS:
   report={'city':city,'width':width,'base':BASE,'mode':'direct-live-backend'}
   ctx=browser.new_context(viewport={'width':width,'height':960},geolocation={'latitude':lat,'longitude':lon},permissions=['geolocation'],reduced_motion='reduce')
   page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   try:
    page.goto(BASE+'/weather-fusion/',wait_until='domcontentloaded',timeout=60000)
    page.wait_for_function('p=>window.__weatherNourieForecast?.hours?.length>=48&&Math.abs(window.__weatherNourieForecast.location.latitude-p[0])<.001&&Math.abs(window.__weatherNourieForecast.location.longitude-p[1])<.001',arg=[lat,lon],timeout=120000)
    page.wait_for_selector('.seven-day-card');page.wait_for_timeout(700)
    f=page.evaluate('window.__weatherNourieForecast');now=page.evaluate('Date.now()');zone=ZoneInfo(f['location']['timeZone'])
    check(f.get('rainPeriodVersion')=='local-calendar-v1','New calendar contract must be served')
    (OUT/f'{city.lower()}-{width}-backend.json').write_text(json.dumps(f,indent=2))
    calendar=[]
    for i,d in enumerate(f['days']):
     r=d['rainLikelihood'];a,b=epoch(r['window']['start']),epoch(r['window']['end'])
     check(datetime.fromtimestamp(a/1000,zone).strftime('%Y-%m-%d')==d['date'],'Calendar-day chance starts on its labeled local date',d['date'])
     check(datetime.fromtimestamp((b-1)/1000,zone).strftime('%Y-%m-%d')==d['date'],'Tomorrow morning cannot inflate this day',d['date'])
     rows=rain_rows(f,a,b);values=[r['rainLikelihood']['value'] for r in rows if finite(r.get('rainLikelihood',{}).get('value'))]
     if r['coverage']['complete']:
      check(r['value']==max(values),'Daily chance must equal actual hourly maximum',d['date'])
      check(epoch(r['peakEnd'])>a and epoch(r['peakTime'])<b and datetime.fromtimestamp(epoch(r['peakTime'])/1000,zone).strftime('%Y-%m-%d')==d['date'],'Daily peak overlaps the remaining period on the displayed date')
     amount=total(rows,a,b)
     check((amount is None)==(d['qpf'] is None),'Incomplete amounts must remain unavailable',d['date'])
     if amount is not None:check(abs(amount-d['qpf'])<=.000051,'Daily amount must sum its same calendar hours',d['date'])
     calendar.append({'date':d['date'],'peak':r['value'],'peakTime':r['peakTime'],'qpf':d['qpf'],'coverage':r['coverage']})
    report['dailyData']=calendar
    hours=page.locator('#hourly .forecast-hour').evaluate_all('es=>es.map(e=>({time:e.dataset.time,temp:e.querySelector(":scope>strong").textContent,feels:e.querySelector(".hour-feels b").textContent,pop:e.querySelector(".hour-pop").textContent.trim()}))')
    source={epoch(h['time']):h for h in f['hours']}
    for h in hours:
     original=source[epoch(h['time'])]
     check(h['temp']==shown(original['temperature']),'Hourly temperature matches source',h)
     check(h['feels']==shown(original['feelsLike']),'Hourly feels matches source',h)
     check(h['pop']==shown(original['rainLikelihood']['value'],'%'),'Hourly chance matches source',h)
    report['hourlyReadingsChecked']=len(hours)
    cards=page.locator('.seven-day-card').evaluate_all('es=>es.map(e=>({date:e.dataset.date,index:Number(e.dataset.weekDay),pop:e.querySelectorAll(".seven-day-metric strong")[0].textContent,amount:e.querySelectorAll(".seven-day-metric strong")[1].textContent}))')
    graphs=[]
    for card in cards:
     index=card['index'];d=f['days'][index];night=index==0 and datetime.fromtimestamp(now/1000,zone).hour>=18
     r=d['popNightLikelihood' if night else 'rainLikelihood'];a,b=epoch(r['window']['start']),epoch(r['window']['end'])
     rows=rain_rows(f,a,b);amount=total(rows,a,b)
     observed=index==0 and card['pop']=='100%' and 'Rain now' in page.locator('.seven-day-card').nth(index).inner_text()
     if not observed:check(card['pop']==shown(r['value'],'%'),'Seven-day chance matches the displayed period',card)
     expected_amount=f'{amount:.2f} in' if finite(amount) else '—'
     check(card['amount']==expected_amount,'Seven-day amount matches its hourly sum',{'card':card,'expected':expected_amount})
     page.locator('.seven-day-card').nth(index).click()
     page.wait_for_selector('#day-dialog[open]')
     slider=page.locator('#day-graph-hour')
     if slider.count():
      first=math.floor(max(a,now if index==0 else a)/3600000)*3600000
      times=list(range(int(first),int(b),3600000))
      check(int(slider.get_attribute('max'))==len(times)-1,'Graph hours use the same period as the day card',d['date'])
      actual=slider.evaluate('''(input,count)=>Array.from({length:count},(_,i)=>{input.value=String(i);input.dispatchEvent(new Event('input',{bubbles:true}));return Object.fromEntries([...document.querySelectorAll('.day-graph-readout [data-readout]')].map(e=>[e.dataset.readout,e.querySelector('strong').textContent]));})''',len(times))
      series={k:{epoch(p['time']):p.get('value') for p in v} for k,v in f['metricForecasts']['series'].items()}
      rain={epoch(r['time']):r['rainLikelihood']['value'] for r in f['rainTimeline']}
      for t,display in zip(times,actual):
       for field,key in [('temperature','temperature'),('feels','feels'),('dewpoint','dewpoint')]:check(display[field]==shown(series.get(key,{}).get(t)),'Graph thermal value matches exact source hour',{'date':d['date'],'time':t,'field':field})
       check(display['rainChance']==shown(rain.get(t),'%'),'Graph chance matches the identical hourly source',{'date':d['date'],'time':t})
      graphs.append({'date':d['date'],'hours':len(times),'allValuesMatch':True})
     if index in [0,1,2]:page.locator('#day-dialog').screenshot(path=str(OUT/f'{city.lower()}-day-{index}-{width}.png'))
     page.locator('#close-day').click()
    report['dayGraphs']=graphs
    # Selected weather and lighting across the entire 48-hour strip.
    sampled=page.locator('#hourly .forecast-hour').evaluate_all('es=>es.map(e=>({time:e.dataset.time,id:e.dataset.comfortTime}))')
    pet_readings=[];wet_saved=False
    for item in sampled:
     page.locator('#hourly [data-comfort-time="'+item['id']+'"]').click()
     h=source[epoch(item['time'])]
     check(page.locator('.sun-person figcaption>strong').inner_text()==shown(h['feelsLike']),'Comfort scene follows selected hourly thermal value',item)
     scenes=page.locator('#skin-exposure svg.reference-scene').evaluate_all('es=>es.map(e=>({daylight:e.dataset.daylight,asset:e.querySelector("image").getAttribute("href")}))')
     if scenes and scenes[0]['daylight']=='false':check(all('night' in s['asset'] or 'dawn' in s['asset'] for s in scenes),'Night cannot select daylight artwork',item)
     pet=page.locator('#pavement-content').evaluate('e=>({status:e.dataset.status,reading:e.querySelector("figcaption>strong").textContent,caption:e.querySelector("figcaption").textContent,subtitle:e.querySelector(".exposure-subtitle").textContent})')
     if pet['status']=='estimated':
      check(pet['reading'].endswith('°') and pet['reading'][:-1].lstrip('-').isdigit(),'Calculated dog pavement readings must remain visible during rain',pet)
      check('Asphalt ' in pet['caption'],'Both surface estimates stay visible',pet)
      if 'wet' in pet['subtitle'].lower() and not wet_saved:
       page.locator('#skin-exposure').screenshot(path=str(OUT/f'{city.lower()}-wet-pavement-{width}.png'));wet_saved=True
     local_hour=datetime.fromtimestamp(epoch(item['time'])/1000,zone).hour
     if city=='Knightdale' and local_hour==12 and 'sun' in (h.get('condition') or '').lower():
      check(pet['status']=='estimated','Sunny noon must show a calculated pavement estimate',pet)
      check(finite(h.get('uvIndex')),'Sunny noon UV must use published data, not a blank',h.get('time'))
      report.setdefault('sunnyNoon',[]).append({'time':item['time'],'temperature':h['temperature'],'condition':h['condition'],'uvIndex':h['uvIndex'],**pet})
      page.locator('#skin-exposure').screenshot(path=str(OUT/f'{city.lower()}-sunny-noon-{width}.png'))
     pet_readings.append({'time':item['time'],**pet})
    page.locator('[data-comfort-reset]').click()
    report['comfortHoursChecked']=len(sampled)
    report['pavementReadings']=pet_readings
    metrics=[]
    for key,field,unit,digits in [('feels','feels','°',0),('precipitation','precipitation',' in',2),('wind','wind',' mph',0),('humidity','humidity','%',0),('pop','pop','%',0),('visibility','visibility',' mi',1),('pressure','pressure',' mb',1)]:
     page.locator('[data-metric="'+key+'"]').click();page.wait_for_selector('#metric-dialog[open]')
     points=(f.get('metricForecasts',{}).get('series',{}).get(field) or [])[:24]
     slider=page.locator('#chart-scrubber')
     if points:
      check(int(slider.get_attribute('max'))==len(points)-1,'Metric chart retains exact source hours',key)
      actual=slider.evaluate("""(input,arg)=>arg.points.map((point,i)=>{input.value=String(i);input.dispatchEvent(new Event('input',{bubbles:true}));let v=point.value;if(arg.key==='pressure'&&typeof v==='number')v*=33.86389;return {actual:document.querySelector('#chart-value').textContent,expected:typeof v==='number'&&Number.isFinite(v)?v.toFixed(arg.digits)+arg.unit:'Not available'};})""",{'points':points,'key':key,'digits':digits,'unit':unit})
      check(all(p['actual']==p['expected'] for p in actual),'Every metric chart reading matches its own hourly source',{'metric':key,'mismatches':[p for p in actual if p['actual']!=p['expected']][:3]})
     if key=='precipitation':
      labels=page.locator('#forecast-graph text').all_text_contents()[:4]
      check(len(set(labels))==len(labels),'Precipitation axis labels distinguish all four levels even during dry periods',labels)
     metrics.append({'metric':key,'hours':len(points),'allValuesMatch':True})
     page.locator('#close-metric').click()
    page.locator('[data-metric="solar"]').click();page.wait_for_selector('#metric-dialog[open]')
    check('Sunset' in page.locator('#chart-title').inner_text(),'Sunset graph opens')
    solar=page.locator('#forecast-graph').evaluate('''svg=>({labels:[...svg.querySelectorAll('text')].map(e=>{const b=e.getBBox();return {text:e.textContent,left:b.x,right:b.x+b.width};}),width:svg.viewBox.baseVal.width})''')
    check(all(label['left']>=0 and label['right']<=solar['width'] for label in solar['labels']),'Sunset clock labels remain fully visible inside the graph',solar)
    sunsets=f.get('metricForecasts',{}).get('solar',[])
    check(page.locator('#chart-week-label').inner_text()==str(len(sunsets))+(' day' if len(sunsets)==1 else ' days'),'Sunset period label matches the actual plotted days')
    if sunsets:
     expected=datetime.fromtimestamp(epoch(sunsets[0]['sunset'])/1000,zone).strftime('%I:%M %p').lstrip('0')
     check(page.locator('#chart-value').inner_text()==expected,'Sunset graph readout uses the location clock',{'expected':expected})
    report['sunsetGraph']=solar
    page.locator('#close-metric').click();report['metricGraphs']=metrics
    aq=f.get('airQuality') or {}
    if finite(aq.get('aqi')):check(page.locator('.aqi-reading>strong').inner_text()==shown(aq['aqi'],''),'AQI headline matches actual location data')
    report['aqi']={'value':aq.get('aqi'),'coverage':len(aq.get('hours',[]))}
    page.locator('#open-snow').click();page.wait_for_selector('#forecast-window-dialog[open]')
    snowtext=page.locator('#forecast-window-dialog').inner_text()
    check(bool(snowtext.strip()),'Snow tab must explain the real forecast or absence of snow')
    report['snowTab']=snowtext[:600];page.locator('#forecast-window-dialog').screenshot(path=str(OUT/f'{city.lower()}-snow-{width}.png'))
    page.locator('#forecast-window-dialog').evaluate('d=>d.close()')
    report['radar']=page.locator('#radar-controls').evaluate('e=>({stamp:e.querySelector("#radar-stamp").textContent,disabled:e.querySelector("#radar-time").disabled,frames:Number(e.querySelector("#radar-time").max)+1,caption:document.querySelector("#map-caption").textContent,error:document.querySelector("#map-error").hidden?null:document.querySelector("#map-error").textContent})')
    check('past' in report['radar']['caption'].lower() or 'observed' in report['radar']['caption'].lower(),'Radar must be labeled as observations, not forecast precipitation')
    report['weatherTake']=page.locator('#today-uncertainty-text').inner_text()
    page.locator('.today-panel').screenshot(path=str(OUT/f'{city.lower()}-today-{width}.png'))
    page.locator('#experimental-week').screenshot(path=str(OUT/f'{city.lower()}-week-{width}.png'))
    report['modelContributions']=[{'id':m['id'],'runAt':m.get('runAt')} for m in f.get('modelContributions',[])]
    check(not errors,'No JavaScript errors',errors)
    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'No page overflow')
    report['result']='passed'
   except Exception as e:
    report['result']='failed';report['error']=str(e)
    page.screenshot(path=str(OUT/f'{city.lower()}-failure-{width}.png'),full_page=True)
   finally:
    report['pageErrors']=errors;reports.append(report);ctx.close()
   print(json.dumps({'city':city,'width':width,'result':report['result'],'error':report.get('error')}),flush=True)
 browser.close()
(OUT/'report.json').write_text(json.dumps(reports,indent=2))
raise SystemExit(1 if any(r['result']!='passed' for r in reports) else 0)
