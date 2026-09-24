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
POINTS=[{'id':'knightdale','name':'Knightdale / Raleigh, NC','latitude':35.787,'longitude':-78.4806,'timeZone':'America/New_York'},{'id':'greenville','name':'Greenville, NC','latitude':35.6127,'longitude':-77.3664,'timeZone':'America/New_York'}]
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
 def __init__(self,client,stop_path,estimate_cap):
  self.client=client;self.stop_path=stop_path;self.estimate_cap=estimate_cap;self.billed=0
  if stop_path.exists():raise CostStop('Automatic collection paused by the saved cost-stop record; review it before resuming.')
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
  print(json.dumps({'job':job.job_id,'estimatedBytes':estimate,'billedBytes':billed,'runBilledBytes':self.billed,'rows':len(rows),'cacheHit':job.cache_hit}),flush=True)
  # Spatial clustering's pre-execution estimate is an upper bound. Stop further
  # requests if actual billing disproves the expected small geographic scan.
  if (not discovery and billed>250_000_000) or self.billed>5_000_000_000:
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
 params=[bigquery.ScalarQueryParameter('init_time','TIMESTAMP',run),bigquery.ScalarQueryParameter('longitude','FLOAT64',point['longitude']),bigquery.ScalarQueryParameter('latitude','FLOAT64',point['latitude'])]
 merged={};grid=None
 batches=[columns[i:i+6] for i in range(0,len(columns),6)]
 while batches:
  batch=batches.pop(0);selected=','.join(f'f.`{c}` AS `{c}`' for c in batch)
  sql=f'''SELECT f.time AS valid_time,f.hours AS lead_hours,ST_X(t.geography) AS grid_lon,ST_Y(t.geography) AS grid_lat,{selected}
 FROM `{validate_table(table)}` AS t,UNNEST(t.forecast) AS f
 WHERE t.init_time=@init_time
 AND ST_DWITHIN(t.geography,ST_GEOGPOINT(@longitude,@latitude),15000)
 AND ST_INTERSECTS(t.geography_polygon,ST_GEOGPOINT(@longitude,@latitude))
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

def collect(q,table,run,grid,fields,previous,now):
 if previous and previous.get('runAt')==iso(run) and previous.get('status')=='ready' and previous.get('sourceTable')==table:
  r=copy.deepcopy(previous);r['checkedAt']=now;return r
 expected=[f['id'] for f in fields if f['grid']==grid]
 schema=available_columns(q.client.get_table(table).schema)
 cols=[f'{name}_{s}' for name in expected for s in STATS if f'{name}_{s}' in schema]
 present=[name for name in expected if name+'_mean' in cols]
 if not present:raise RuntimeError('No documented statistical fields in linked table')
 points=[query_point(q,table,run,p,cols) for p in POINTS]
 return {'status':'ready','runAt':iso(run),'fetchedAt':now,'checkedAt':now,'sourceTable':table,'gridResolutionDegrees':.05 if grid=='station' else .1,'fields':present,'missingFields':[n for n in expected if n not in present],'statisticColumns':cols,'horizonHours':max(r['forecastHour'] for p in points for r in p['hourly']),'points':points}

def main():
 from google.cloud import bigquery
 ap=argparse.ArgumentParser();ap.add_argument('--table',required=True);ap.add_argument('--output',required=True)
 ap.add_argument('--max-bytes-per-query',type=int,default=400_000_000_000,help='Pessimistic pre-execution ceiling for each six-column batch; actual-billing safety stops also apply.')
 a=ap.parse_args();table=validate_table(a.table);station=table.replace('_0p1deg','_0p05deg');out=Path(a.output)
 catalog=json.loads((Path(__file__).resolve().parents[1]/'public/weather-fusion/weathernext-catalog.json').read_text());previous={}
 if out.exists():
  try:previous=json.loads(out.read_text())
  except (ValueError,OSError):pass
 prev=previous.get('sources',{});now=iso(datetime.now(timezone.utc));q=Queries(bigquery.Client(),out.with_name('weathernext-full-cost-stop.json'),a.max_bytes_per_query)
 run,newest=latest_runs(q,table)
 sources={'surface':collect(q,table,run,'surface',catalog['fields'],prev.get('surface'),now)}
 if prev.get('surface',{}).get('runAt') and prev['surface']['runAt']!=iso(run):sources['previousSurface']=prev['surface']
 elif prev.get('previousSurface'):sources['previousSurface']=prev['previousSurface']
 warnings=[]
 for id,t,grid,r in [('station',station,'station',run),('interimSurface',table,'surface',newest),('interimStation',station,'station',newest)]:
  try:
   if id.startswith('interim') and newest<=run:sources[id]={'status':'not-newer','message':'Main is also the newest initialization.'};continue
   sources[id]=collect(q,t,r,grid,catalog['fields'],prev.get(id),now)
  except CostStop:raise
  except Exception as e:
   msg=type(e).__name__+': '+str(e)[:300];warnings.append(id+': '+msg)
   sources[id]={**prev[id],'status':'last-verified','refreshWarning':msg,'checkedAt':now} if prev.get(id,{}).get('points') else {'status':'unavailable','message':msg,'checkedAt':now}
 payload={'schema':SCHEMA,'model':'Google WeatherNext 3','generatedAt':now,'ensembleMembers':64,'comparisonOnly':True,'timeStepHours':1,'points':POINTS,'sources':sources,'warnings':warnings,'sourceDocumentation':catalog['source'],'scope':'All available BigQuery surface statistics for published locations. Raw trajectories, upper-air and native six-hour products require the separate Google Cloud Storage feed.','rawUnits':{'temperature':'K','wind':'m/s','precipitation':'m per preceding hour','cloud':'fraction','pressure':'Pa','solar':'J/m² per preceding hour'},'collectionBytesBilled':q.billed}
 out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False)+'\n');tmp.replace(out)
 print(json.dumps({'published':str(out),'bytesBilled':q.billed,'sources':{k:{'status':v['status'],'fields':len(v.get('fields',[])),'hours':v.get('horizonHours')} for k,v in sources.items()},'warnings':warnings}))
if __name__=='__main__':main()
