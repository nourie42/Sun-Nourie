#!/usr/bin/env python3
"""Verify all comparison tooltips against independently calculated local-calendar API values."""
import json,math,os
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

OUT=Path(os.getenv('WEATHER_QA_DIR','/tmp/weather-calendar-comparison-qc'));OUT.mkdir(parents=True,exist_ok=True)
BASE=os.getenv('WEATHER_TEST_BASE','https://sun-nourie-live.onrender.com').rstrip('/')
H=3600000
def ep(t):return datetime.fromisoformat(t.replace('Z','+00:00')).timestamp()*1000
def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def maximum(v):return max(v) if v else None
def total(rows,a,b):
 cursor=a;answer=0
 for r in rows:
  x,y=ep(r['time']),ep(r['end']);left,right=max(a,x),min(b,y)
  if left>cursor or not finite(r.get('precipitation')):return None
  answer+=r['precipitation']*max(0,right-max(cursor,left))/(y-x);cursor=max(cursor,right)
 return answer if cursor>=b else None
def expected(f,now,key):
 out=[];zone=ZoneInfo(f['location']['timeZone']);series=f['metricForecasts']['series']
 for i,d in enumerate(f['days'][:10]):
  local=datetime.fromisoformat(d['date']).replace(tzinfo=zone);midnight=local.timestamp()*1000;end=(local+timedelta(days=1)).timestamp()*1000
  start=max(midnight,math.floor(now/H)*H) if i==0 else midnight
  def values(k,a=start):return [r['value'] for r in series.get(k,[]) if a<=ep(r['time'])<end and finite(r.get('value'))]
  rain_start=max(start,ep(d['rainLikelihood']['window']['start']))
  rows=[r for r in f['rainTimeline'] if ep(r['time'])<end and ep(r['end'])>rain_start]
  if key=='temp':
   points={ep(r['time']):r.get('value') for r in series['temperature'] if start<=ep(r['time'])<end};times=range(int(start),int(end),H)
   out.append(maximum(list(points.values())) if all(finite(points.get(t)) for t in times) else None)
  elif key=='rain':out.append(total(rows,rain_start,end))
  elif key=='pop':
   ps=[r['rainLikelihood'].get('value') for r in rows];v=maximum(ps) if ps and all(finite(p) for p in ps) and d['rainLikelihood'].get('value') is not None else None
   radar=f.get('current',{}).get('radarPrecipitation',{});observed=ep(radar['observedAt']) if radar.get('observedAt') else None
   if i==0 and radar.get('status')=='ready' and radar.get('atLocation') and (observed is None or -300000<=now-observed<=900000):v=100
   out.append(v)
  elif key=='wind':
   vs=values('wind',rain_start);out.append(sum(vs)/len(vs) if vs else None)
  elif key=='dewpoint':out.append(maximum(values('dewpoint',rain_start)))
  elif key=='uv':out.append(d.get('uvMax'))
  elif key=='aqi':
   vs=[r['aqi'] for r in f.get('airQuality',{}).get('hours',[]) if datetime.fromtimestamp(ep(r['time'])/1000,zone).strftime('%Y-%m-%d')==d['date'] and finite(r.get('aqi'))];out.append(maximum(vs))
  elif key=='snow':
   s=next((r for r in f.get('snow',{}).get('days',[]) if r['date']==d['date']),None)
   out.append(s.get('displaySnowfall',{}).get('value',s.get('best')) if s else d.get('snowfall'))
 return out
def fmt(v,key):
 if v is None:return 'Unavailable'
 if key=='rain':return f'{v:.2f}"'
 if key=='snow':return f'{v:.1f}"'
 v=math.floor(v+.5)
 return str(v)+('°' if key in ['temp','dewpoint'] else '%' if key=='pop' else '')

reports=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'],proxy={'server':os.environ['HTTPS_PROXY'],'bypass':'localhost,127.0.0.1'})
 for city,lat,lon,width in [('Knightdale',35.7871,-78.481,412),('Knightdale',35.7871,-78.481,1280),('Cortland',42.6012,-76.1805,412),('Hazen',47.2944,-101.6227,412)]:
  c=b.new_context(viewport={'width':width,'height':960},geolocation={'latitude':lat,'longitude':lon},permissions=['geolocation'],reduced_motion='reduce');q=c.new_page();r={'city':city,'width':width,'base':BASE,'mode':'direct-backend-responses','metrics':{}}
  try:
   q.goto(BASE+'/weather-fusion/',wait_until='domcontentloaded',timeout=60000)
   q.wait_for_function('xy=>window.__weatherNourieForecast?.hours?.length>=48&&Math.abs(window.__weatherNourieForecast.location.latitude-xy[0])<.001',arg=[lat,lon],timeout=120000)
   q.locator('#open-compare').click();q.wait_for_function('!!document.querySelector("#wn-compare-chart")?._wnShow');q.wait_for_timeout(300)
   f=q.evaluate('window.__weatherNourieForecast');now=q.evaluate('Date.now()');r['assembledAt']=f['assembledAt'];(OUT/f'{city.lower()}-{width}-backend.json').write_text(json.dumps(f,indent=2))
   for key in ['temp','rain','pop','wind','dewpoint','snow','uv','aqi']:
    q.locator('#wn-var-picker [data-var="'+key+'"]').click()
    q.wait_for_function('''()=>{const chart=document.querySelector('#wn-compare-chart');return !!chart&&
      ((!!chart.querySelector('svg')&&!!chart._wnShow)||chart.textContent.trim()==='No data for this variable.');}''')
    want=expected(f,now,key)
    # A completely missing series has no graph or tooltip. Verify the visible
    # unavailable state against every expected date instead of invoking a stale
    # tooltip callback left on the chart container by the previous variable.
    if not q.locator('#wn-compare-chart svg').count():
     assert want and all(v is None for v in want),(city,width,key,'Missing chart despite available source data',want)
     unavailable=q.locator('#wn-compare-chart').inner_text().strip()
     assert unavailable=='No data for this variable.',(city,width,key,'Expected a clear unavailable state',unavailable)
     r['metrics'][key]={'dates':len(want),'values':['Unavailable']*len(want),'unavailableDates':len(want),'state':'unavailable','displayText':unavailable,'allMatch':True}
     continue
    actual=q.locator('#wn-compare-chart').evaluate('''(e,count)=>{let out=[];for(let i=0;i<count;i++){let svg=e.querySelector('svg'),r=svg.getBoundingClientRect(),w=svg.viewBox.baseVal.width,pl=w<600?38:52,pr=w<600?10:18,x=pl+i/Math.max(1,count-1)*(w-pl-pr);e._wnShow(r.left+x/w*r.width);let tip=e.querySelector('.wn-tip'),row=tip.querySelector('[data-tip-series="nourie"]')||tip.querySelector('[data-tip-series="single"]');out.push({date:tip.querySelector('b').textContent,value:row?.querySelector('b')?.textContent})}return out;}''',len(want))
    for i,(got,v) in enumerate(zip(actual,want)):
     assert got['value']==fmt(v,key),(city,width,key,f['days'][i]['date'],got,fmt(v,key),v)
    r['metrics'][key]={'dates':len(want),'values':[row['value'] for row in actual],'allMatch':True}
   r['result']='passed'
  except Exception as e:r['result']='failed';r['error']=str(e)
  reports.append(r);(OUT/'report.json').write_text(json.dumps(reports,indent=2));print(json.dumps(r),flush=True);c.close()
 b.close()
assert all(r['result']=='passed' for r in reports),reports
