#!/usr/bin/env python3
"""Independently check every model's charted high against its hourly coverage."""
import argparse,json,math,os
from datetime import datetime,timedelta,time,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--base',default='http://127.0.0.1:3123')
parser.add_argument('--snapshot',help='Optional recorded production forecast; freezes the browser at its assembly time.')
parser.add_argument('--out',default='/tmp/weather-model-high-qc')
args=parser.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
recorded=json.loads(Path(args.snapshot).read_text()) if args.snapshot else None
reports=[]
finite=lambda v:isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
epoch=lambda s:datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000

def expected_models(f,now):
 zone=ZoneInfo(f['location']['timeZone']);results=[]
 for i,day in enumerate(f['days'][:10]):
  date=datetime.fromisoformat(day['date']).date()
  start=datetime.combine(date,time.min,zone).timestamp()*1000
  end=datetime.combine(date+timedelta(days=1),time.min,zone).timestamp()*1000
  if i==0:start=max(start,math.floor(now/3600000)*3600000)
  required=set(range(int(start),int(end),3600000));models={}
  for point in f['metricForecasts']['series']['temperature']:
   t=epoch(point['time'])
   if t not in required:continue
   for source in point.get('sources',[]):
    if finite(source.get('value')):models.setdefault(source['id'],{})[t]=source['value']
  results.append({'date':day['date'],'hours':len(required),'models':{
   model:{'hours':len(values),'complete':required.issubset(values),'high':max(values.values()) if required and required.issubset(values) else None}
   for model,values in models.items()}})
 return results

with sync_playwright() as p:
 launch={'headless':True,'executable_path':'/usr/bin/chromium','args':['--no-sandbox']}
 if os.getenv('HTTPS_PROXY'):launch['proxy']={'server':os.environ['HTTPS_PROXY'],'bypass':'localhost,127.0.0.1'}
 browser=p.chromium.launch(**launch)
 for width in [412,1280]:
  location=recorded['location'] if recorded else {'latitude':35.7871,'longitude':-78.481}
  context=browser.new_context(viewport={'width':width,'height':960},geolocation={k:location[k] for k in ['latitude','longitude']},permissions=['geolocation'],reduced_motion='reduce')
  page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  if recorded:
   page.clock.install(time=datetime.fromisoformat(recorded['assembledAt'].replace('Z','+00:00')))
   page.route('**/api/weather-fusion/forecast?*',lambda route:route.fulfill(json=recorded))
  page.goto(args.base+'/weather-fusion/',wait_until='domcontentloaded',timeout=60000)
  page.wait_for_function('!!window.__weatherNourieForecast?.metricForecasts?.series?.temperature?.length',timeout=120000)
  page.locator('#open-compare').click()
  page.wait_for_function('!!document.querySelector("#wn-compare-chart")?._wnShow',timeout=30000)
  f=page.evaluate('window.__weatherNourieForecast');now=page.evaluate('Date.now()')
  expected=expected_models(f,now);chart=page.locator('#wn-compare-chart')
  visible=chart.locator('.wn-chip[data-model]').evaluate_all('els=>els.map(e=>e.dataset.model).filter(id=>id!=="nourie")')
  checked=[]
  for index,day in enumerate(expected):
   actual=chart.evaluate('''(e,i)=>{let svg=e.querySelector('svg'),r=svg.getBoundingClientRect(),w=svg.viewBox.baseVal.width,pl=w<600?38:52,pr=w<600?10:18,n=document.querySelectorAll('#wn-compare-chart svg text').length;
    let count=window.__weatherNourieForecast.days.slice(0,10).length,x=pl+i/Math.max(1,count-1)*(w-pl-pr);e._wnShow(r.left+x/w*r.width);
    return Object.fromEntries([...e.querySelectorAll('.wn-tip [data-tip-series]')].map(row=>[row.dataset.tipSeries,row.querySelector('b').textContent]));}''',index)
   for model in visible:
    source=day['models'].get(model,{ 'hours':0,'complete':False,'high':None})
    want=str(math.floor(source['high']+.5))+'°' if source['high'] is not None else 'Unavailable'
    assert actual.get(model)==want,(width,day['date'],model,'actual',actual.get(model),'expected',want,'source',source)
    checked.append({'date':day['date'],'model':model,'expectedHours':day['hours'],**source,'display':actual.get(model)})
   if index in [0,1,2]:chart.screenshot(path=str(out/f'high-{index}-{width}.png'))
  assert 'Incomplete model days are unavailable' in chart.inner_text()
  assert not errors,errors
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),'page overflow'
  report={'width':width,'base':args.base,'mode':'recorded-production' if recorded else 'direct-live','assembledAt':f['assembledAt'],'checks':checked,'result':'passed','pageErrors':errors}
  reports.append(report);(out/f'forecast-{width}.json').write_text(json.dumps(f));(out/'report.json').write_text(json.dumps(reports,indent=2))
  print(json.dumps({'width':width,'modelHighReadingsChecked':len(checked),'mondayHrrr':next((r for r in checked if r['date']=='2026-10-19' and r['model']=='hrrr'),None),'result':'passed'}),flush=True)
  context.close()
 browser.close()
