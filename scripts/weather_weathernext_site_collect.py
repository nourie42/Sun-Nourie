#!/usr/bin/env python3
"""Google-only WeatherNext surface statistics. No synthetic production data.
Partition-key discovery is separate from geometry; point columns are batched.
Docs: https://developers.google.com/weathernext/guides/bigquery
"""
from __future__ import annotations
import argparse,copy,json,math,re
from datetime import datetime,timezone
from pathlib import Path
STATS=('mean','p10','p25','p50','p75','p90')
SCHEMA='weather-nourie-weathernext-site-v1'
POINT_COLUMN_BATCH_SIZE=3
QUERY_BILLING_LIMIT_BYTES=250_000_000
RUN_BILLING_LIMIT_BYTES=50_000_000_000
POINTS=[{'id':'knightdale','name':'Knightdale / Raleigh, NC','latitude':35.787,'longitude':-78.4806,'timeZone':'America/New_York'},{'id':'greenville','name':'Greenville, NC','latitude':35.6127,'longitude':-77.3664,'timeZone':'America/New_York'},{'id':'hazen','name':'Hazen, ND','latitude':47.2944,'longitude':-101.6227,'timeZone':'America/North_Dakota/Beulah'}]
class CostStop(RuntimeError):pass
class EstimateCeiling(RuntimeError):pass

def iso(v):
 if v is None:return None
 if isinstance(v,str):v=datetime.fromisoformat(v.replace('Z','+00:00'))
 if v.tzinfo is None:v=v.replace(tzinfo=timezone.utc)
 return v.astimezone(timezone.utc).isoformat().replace('+00:00','Z')
def numeric(v):
 if v is None:return None
 f=float(v);return f if math.isfinite(f) else None
def validate_table(t):
 if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.weathernext_3_0_0_0p(?:1|05)deg',t):raise ValueError('Invalid linked WeatherNext table')
 return t

def available_columns(schema):
 f=next((x for x in schema if x.name=='forecast'),None)
 if f is None:raise RuntimeError('No forecast record in source schema')
 return {x.name for x in f.fields}

class Queries:
 def __init__(self,client,stop_path,estimate_cap,billing_state=None):
  self.client=client;self.stop_path=stop_path;self.estimate_cap=estimate_cap;self.billing_state=Path(billing_state) if billing_state else None
  self.billed=json.loads(self.billing_state.read_text())['runBilledBytes'] if self.billing_state and self.billing_state.exists() else 0
  if stop_path.exists():raise CostStop('Automatic collection paused by the saved cost-stop record; review it before resuming.')
  if not isinstance(self.billed,int) or self.billed<0 or self.billed>RUN_BILLING_LIMIT_BYTES:raise CostStop('Shared collection billing ledger is invalid or already exceeds the run limit.')
 def run(self,sql,params=(),discovery=False):
  from google.cloud import bigquery
  cfg=bigquery.QueryJobConfig(query_parameters=list(params),dry_run=True,use_query_cache=True)
  probe=self.client.query(sql,job_config=cfg,location='US')
  estimate=probe.total_bytes_processed or 0
  cap=3_000_000_000 if discovery else self.estimate_cap
  if estimate>cap:raise EstimateCeiling(f'Query estimate {estimate} bytes exceeds the configured {cap} byte ceiling; query was not executed.')
  cfg.dry_run=False;cfg.maximum_bytes_billed=cap
  job=self.client.query(sql,job_config=cfg,location='US');rows=list(job.result(timeout=180))
  billed=job.total_bytes_billed or 0;self.billed+=billed
  if self.billing_state:
   self.billing_state.parent.mkdir(parents=True,exist_ok=True)
   tmp=self.billing_state.with_suffix('.tmp');tmp.write_text(json.dumps({'runBilledBytes':self.billed})+'\n');tmp.replace(self.billing_state)
  print(json.dumps({'job':job.job_id,'estimatedBytes':estimate,'billedBytes':billed,'runBilledBytes':self.billed,'rows':len(rows),'cacheHit':job.cache_hit}),flush=True)
  # Spatial clustering's pre-execution estimate is an upper bound. Stop further
  # requests if actual billing disproves the expected small geographic scan.
  if (not discovery and billed>QUERY_BILLING_LIMIT_BYTES) or self.billed>RUN_BILLING_LIMIT_BYTES:
   self.stop_path.parent.mkdir(parents=True,exist_ok=True)
   self.stop_path.write_text(json.dumps({'pausedAt':iso(datetime.now(timezone.utc)),'job':job.job_id,'billedBytes':billed,'runBilledBytes':self.billed,'reason':'Actual query billing exceeded the automatic collection safety threshold.'})+'\n')
   raise CostStop('Actual billing exceeded safety threshold. Further automatic collection has been paused.')
  return rows

def latest_runs(q,table):
 # One lookup supplies main and interim timestamps. Do not scan geometry here.
 for lookback in (12,48):
  sql=f'''SELECT MAX(IF(MOD(EXTRACT(HOUR FROM init_time),6)=0,init_time,NULL)) AS main_run,
 MAX(init_time) AS newest_run FROM `{validate_table(table)}`
 WHERE init_time BETWEEN TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL {lookback} HOUR) AND CURRENT_TIMESTAMP()'''
  rows=q.run(sql,discovery=True)
  if rows and rows[0].main_run is not None:return rows[0].main_run,rows[0].newest_run
 raise RuntimeError('No main initialization published in the last 48 hours')

def query_point(q,table,run,point,columns):
 from google.cloud import bigquery
 half_width=.025 if table.endswith('_0p05deg') else .05
 params=[bigquery.ScalarQueryParameter('init_time','TIMESTAMP',run),bigquery.ScalarQueryParameter('longitude','FLOAT64',point['longitude']),bigquery.ScalarQueryParameter('latitude','FLOAT64',point['latitude']),bigquery.ScalarQueryParameter('cell_half_width','FLOAT64',half_width),bigquery.ScalarQueryParameter('radius_meters','FLOAT64',4000 if half_width==.025 else 8000)]
 merged={};grid=None
 batches=[columns[i:i+POINT_COLUMN_BATCH_SIZE] for i in range(0,len(columns),POINT_COLUMN_BATCH_SIZE)]
 while batches:
  batch=batches.pop(0);selected=','.join(f'f.`{c}` AS `{c}`' for c in batch)
  sql=f'''SELECT f.time AS valid_time,f.hours AS lead_hours,ST_X(t.geography) AS grid_lon,ST_Y(t.geography) AS grid_lat,{selected}
 FROM `{validate_table(table)}` AS t,UNNEST(t.forecast) AS f
 WHERE t.init_time=@init_time
 AND ST_DWITHIN(t.geography,ST_GEOGPOINT(@longitude,@latitude),@radius_meters)
 AND ST_X(t.geography) BETWEEN @longitude-@cell_half_width AND @longitude+@cell_half_width
 AND ST_Y(t.geography) BETWEEN @latitude-@cell_half_width AND @latitude+@cell_half_width
 AND f.hours BETWEEN 1 AND 360
 QUALIFY ROW_NUMBER() OVER(PARTITION BY f.time ORDER BY ST_DISTANCE(t.geography,ST_GEOGPOINT(@longitude,@latitude)))=1
 ORDER BY f.time'''
  try:rows=q.run(sql,params)
  except EstimateCeiling:
   if len(batch)==1:raise
   mid=len(batch)//2;batches[0:0]=[batch[:mid],batch[mid:]];continue
  if not rows:raise RuntimeError('No point forecast for '+point['id'])
  if grid is None:grid={'gridLatitude':numeric(rows[0].grid_lat),'gridLongitude':numeric(rows[0].grid_lon)}
  times={iso(r.valid_time) for r in rows}
  if merged and times!=set(merged):raise RuntimeError('Field batches have inconsistent time coverage')
  for r in rows:
   key=iso(r.valid_time);row=merged.setdefault(key,{'time':key,'forecastHour':int(r.lead_hours),'values':{}})
   for c in batch:
    name,stat=c.rsplit('_',1);row['values'].setdefault(name,{})[stat]=numeric(r[c])
 return {**point,**grid,'hourly':[merged[t] for t in sorted(merged)]}

def mark_freshness(source,checked_at):
 # A newly checked/collected artifact does not create a newer model run.
 if not source.get('runAt'):return source
 run=datetime.fromisoformat(source['runAt'].replace('Z','+00:00'))
 checked=datetime.fromisoformat(checked_at.replace('Z','+00:00'))
 age=(checked-run).total_seconds()/3600
 source['runAgeHours']=round(age,1)
 source['freshnessStatus']='stale' if age>36 or source.get('status')=='last-verified' else 'ready'
 if source.get('status','ready')=='ready':source['status']='stale' if age>36 else 'ready'
 return source

def covers_current_points(source):
 # Initialization equality alone is insufficient: changing the configured
 # locations must collect their actual grid cells, not only update the menu.
 raw=source.get('points')
 if not isinstance(raw,list) or len(raw)!=len(POINTS):return False
 points={p.get('id'):p for p in raw if isinstance(p,dict)}
 if set(points)!={p['id'] for p in POINTS}:return False
 for expected in POINTS:
  saved=points[expected['id']]
  if not saved.get('hourly'):return False
  for coordinate in ('latitude','longitude'):
   try:a=numeric(saved.get(coordinate));b=numeric(expected.get(coordinate))
   except (TypeError,ValueError):return False
   if a is None or b is None or abs(a-b)>0.000001:return False
 return True

def collect(q,table,run,grid,fields,previous,now):
 if previous and previous.get('runAt')==iso(run) and previous.get('status') in ('ready','stale','last-verified') and previous.get('sourceTable')==table and covers_current_points(previous):
  r=copy.deepcopy(previous);r['checkedAt']=now;return mark_freshness(r,now)
 expected=[f['id'] for f in fields if f['grid']==grid]
 schema=available_columns(q.client.get_table(table).schema)
 cols=[f'{name}_{s}' for name in expected for s in STATS if f'{name}_{s}' in schema]
 present=[name for name in expected if name+'_mean' in cols]
 if not present:raise RuntimeError('No documented statistical fields in linked table')
 points=[query_point(q,table,run,p,cols) for p in POINTS]
 return mark_freshness({'status':'ready','runAt':iso(run),'fetchedAt':now,'checkedAt':now,'sourceTable':table,'gridResolutionDegrees':.05 if grid=='station' else .1,'fields':present,'missingFields':[n for n in expected if n not in present],'statisticColumns':cols,'horizonHours':max(r['forecastHour'] for p in points for r in p['hourly']),'points':points},now)

def refresh_sources(q,table,run,newest,catalog,previous,now,checkpoint,profile='all'):
 prev=previous.get('sources',{});station=table.replace('_0p1deg','_0p05deg')
 sources={key:copy.deepcopy(value) for key,value in prev.items() if key in ('station','interimSurface','interimStation')}
 sources['surface']=collect(q,table,run,'surface',catalog['fields'],prev.get('surface'),now)
 if prev.get('surface',{}).get('runAt') and prev['surface']['runAt']!=iso(run):sources['previousSurface']=copy.deepcopy(prev['surface'])
 elif prev.get('previousSurface'):sources['previousSurface']=copy.deepcopy(prev['previousSurface'])
 warnings=[]
 # Preserve a fully verified main run before optional grids or interim runs.
 checkpoint(sources,warnings)
 if profile=='surface':return sources,warnings
 for id,t,grid,r in [('station',station,'station',run),('interimSurface',table,'surface',newest),('interimStation',station,'station',newest)]:
  try:
   if id.startswith('interim') and newest<=run:sources[id]={'status':'not-newer','message':'Main is also the newest initialization.'}
   else:sources[id]=collect(q,t,r,grid,catalog['fields'],prev.get(id),now)
  except CostStop:
   checkpoint(sources,warnings+['Optional collection paused at the billing safety limit; the verified main forecast is preserved.'])
   raise
  except Exception as e:
   msg=type(e).__name__+': '+str(e)[:300];warnings.append(id+': '+msg)
   sources[id]={**prev[id],'status':'last-verified','refreshWarning':msg,'checkedAt':now} if prev.get(id,{}).get('points') else {'status':'unavailable','message':msg,'checkedAt':now}
  checkpoint(sources,warnings)
 return sources,warnings

def main():
 from google.cloud import bigquery
 ap=argparse.ArgumentParser();ap.add_argument('--table',required=True);ap.add_argument('--output',required=True)
 ap.add_argument('--max-bytes-per-query',type=int,default=400_000_000_000,help='Pessimistic pre-execution ceiling for each small column batch; actual-billing safety stops also apply.')
 ap.add_argument('--profile',choices=('surface','all'),default='all')
 ap.add_argument('--billing-state',help='Shared local billing ledger for all collection phases in this workflow run.')
 a=ap.parse_args();table=validate_table(a.table);station=table.replace('_0p1deg','_0p05deg');out=Path(a.output)
 catalog=json.loads((Path(__file__).resolve().parents[1]/'public/weather-fusion/weathernext-catalog.json').read_text());previous={}
 if out.exists():
  try:previous=json.loads(out.read_text())
  except (ValueError,OSError):pass
 now=iso(datetime.now(timezone.utc));q=Queries(bigquery.Client(),out.with_name('weathernext-full-cost-stop.json'),a.max_bytes_per_query,a.billing_state)
 run,newest=latest_runs(q,table)
 def checkpoint(sources,warnings):
  for source in sources.values():mark_freshness(source,now)
  payload={'schema':SCHEMA,'model':'Google WeatherNext 3','generatedAt':now,'latestPublishedMainRun':iso(run),'latestPublishedRun':iso(newest),'ensembleMembers':64,'comparisonOnly':True,'timeStepHours':1,'points':POINTS,'sources':sources,'warnings':warnings,'sourceDocumentation':catalog['source'],'scope':'All available BigQuery surface statistics for published locations. Raw trajectories, upper-air and native six-hour products require the separate Google Cloud Storage feed.','rawUnits':{'temperature':'K','wind':'m/s','precipitation':'m per preceding hour','cloud':'fraction','pressure':'Pa','solar':'J/m² per preceding hour'},'collectionBytesBilled':q.billed}
  out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False)+'\n');tmp.replace(out)
 sources,warnings=refresh_sources(q,table,run,newest,catalog,previous,now,checkpoint,a.profile)
 print(json.dumps({'published':str(out),'bytesBilled':q.billed,'sources':{k:{'status':v['status'],'fields':len(v.get('fields',[])),'hours':v.get('horizonHours')} for k,v in sources.items()},'warnings':warnings}))
if __name__=='__main__':main()
