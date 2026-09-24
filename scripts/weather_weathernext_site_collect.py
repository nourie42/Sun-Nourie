#!/usr/bin/env python3
"""Publish all available WeatherNext BigQuery surface statistics, without blending.

Source schema is inspected. Main and interim cycles remain separate. Every query
has a billing cap, initialization filter, and clustered geographic predicate.
Docs: https://developers.google.com/weathernext/guides/bigquery
"""
from __future__ import annotations
import argparse
import copy
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

STATS = ('mean', 'p10', 'p25', 'p50', 'p75', 'p90')
SCHEMA = 'weather-nourie-weathernext-site-v1'
POINTS = [
 {'id':'knightdale','name':'Knightdale / Raleigh, NC','latitude':35.787,'longitude':-78.4806,'timeZone':'America/New_York'},
 {'id':'greenville','name':'Greenville, NC','latitude':35.6127,'longitude':-77.3664,'timeZone':'America/New_York'},
]

def iso(v):
 if v is None: return None
 if isinstance(v,str): v=datetime.fromisoformat(v.replace('Z','+00:00'))
 if v.tzinfo is None: v=v.replace(tzinfo=timezone.utc)
 return v.astimezone(timezone.utc).isoformat().replace('+00:00','Z')

def numeric(v):
 if v is None: return None
 f=float(v)
 return f if math.isfinite(f) else None

def validate_table(table):
 if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.weathernext_3_0_0_0p(?:1|05)deg',table):
  raise ValueError('Invalid WeatherNext linked-table identifier.')
 return table

def available_columns(table_schema):
 forecast=next((x for x in table_schema if x.name=='forecast'),None)
 if forecast is None: raise RuntimeError('Source table has no forecast record.')
 return {x.name for x in forecast.fields}

def query_config(parameters=None, maximum_bytes=2_000_000_000):
 from google.cloud import bigquery
 return bigquery.QueryJobConfig(query_parameters=parameters or [], maximum_bytes_billed=maximum_bytes)

def execute(client,sql,config):
 job=client.query(sql,job_config=config,location='US')
 rows=list(job.result(timeout=180))
 print(json.dumps({'queryJob':job.job_id,'bytesBilled':job.total_bytes_billed,'cacheHit':job.cache_hit,'rows':len(rows)}))
 return rows

def point_params(point):
 from google.cloud import bigquery
 return [bigquery.ScalarQueryParameter('longitude','FLOAT64',point['longitude']),bigquery.ScalarQueryParameter('latitude','FLOAT64',point['latitude'])]

def latest_run(client, table, main, cap):
 mod='AND MOD(EXTRACT(HOUR FROM init_time), 6) = 0' if main else ''
 sql=f'''SELECT MAX(init_time) AS init_time FROM `{validate_table(table)}`
 WHERE init_time BETWEEN TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY) AND CURRENT_TIMESTAMP()
 AND ST_DWITHIN(geography, ST_GEOGPOINT(@longitude,@latitude), 15000)
 AND ST_INTERSECTS(geography_polygon, ST_GEOGPOINT(@longitude,@latitude)) {mod}'''
 rows=execute(client,sql,query_config(point_params(POINTS[0]),cap))
 if not rows or rows[0].init_time is None: raise RuntimeError('No published initialization at the saved location in the last two days.')
 return rows[0].init_time

def query_point(client,table,run,point,columns,cap):
 from google.cloud import bigquery
 selected=',\n'.join(f'f.`{col}` AS `{col}`' for col in columns)
 sql=f'''SELECT f.time AS valid_time, f.hours AS lead_hours,
 ST_X(t.geography) AS grid_lon, ST_Y(t.geography) AS grid_lat, {selected}
 FROM `{validate_table(table)}` AS t, UNNEST(t.forecast) AS f
 WHERE t.init_time = @init_time
 AND ST_DWITHIN(t.geography, ST_GEOGPOINT(@longitude,@latitude), 15000)
 AND ST_INTERSECTS(t.geography_polygon, ST_GEOGPOINT(@longitude,@latitude))
 AND f.hours BETWEEN 1 AND 360
 QUALIFY ROW_NUMBER() OVER(PARTITION BY f.time ORDER BY ST_DISTANCE(t.geography,ST_GEOGPOINT(@longitude,@latitude))) = 1
 ORDER BY f.time'''
 params=[bigquery.ScalarQueryParameter('init_time','TIMESTAMP',run)]+point_params(point)
 rows=execute(client,sql,query_config(params,cap))
 if not rows: raise RuntimeError('No point forecast for '+point['id'])
 hourly=[]
 for r in rows:
  vals={}
  for col in columns:
   field,stat=col.rsplit('_',1)
   vals.setdefault(field,{})[stat]=numeric(r[col])
  hourly.append({'time':iso(r.valid_time),'forecastHour':int(r.lead_hours),'values':vals})
 return {**point,'gridLatitude':numeric(rows[0].grid_lat),'gridLongitude':numeric(rows[0].grid_lon),'hourly':hourly}

def collect(client,table,run,grid,fields,previous,cap,now):
 expected=[f['id'] for f in fields if f['grid']==grid]
 if previous and previous.get('runAt')==iso(run) and previous.get('status')=='ready' and previous.get('sourceTable')==table:
  result=copy.deepcopy(previous);result['checkedAt']=now;return result
 schema=available_columns(client.get_table(table).schema)
 cols=[f'{name}_{stat}' for name in expected for stat in STATS if f'{name}_{stat}' in schema]
 present=[name for name in expected if f'{name}_mean' in cols]
 if not present: raise RuntimeError('No documented statistical fields found in source schema.')
 points=[query_point(client,table,run,p,cols,cap) for p in POINTS]
 return {'status':'ready','runAt':iso(run),'fetchedAt':now,'checkedAt':now,'sourceTable':table,
         'gridResolutionDegrees':.05 if grid=='station' else .1,'fields':present,
         'missingFields':[n for n in expected if n not in present],
         'statisticColumns':cols,'horizonHours':max(r['forecastHour'] for p in points for r in p['hourly']),
         'points':points}

def main():
 from google.cloud import bigquery
 ap=argparse.ArgumentParser()
 ap.add_argument('--table',required=True)
 ap.add_argument('--output',required=True)
 ap.add_argument('--max-bytes-per-query',type=int,default=2_000_000_000)
 args=ap.parse_args()
 table=validate_table(args.table)
 station=table.replace('_0p1deg','_0p05deg')
 catalog=json.loads((Path(__file__).resolve().parents[1]/'public/weather-fusion/weathernext-catalog.json').read_text())
 out=Path(args.output);previous={}
 if out.exists():
  try: previous=json.loads(out.read_text())
  except (ValueError,OSError): pass
 prev=previous.get('sources',{})
 client=bigquery.Client()
 now=iso(datetime.now(timezone.utc));cap=args.max_bytes_per_query
 run=latest_run(client,table,True,cap)
 sources={'surface':collect(client,table,run,'surface',catalog['fields'],prev.get('surface'),cap,now)}
 if prev.get('surface',{}).get('runAt') and prev['surface']['runAt']!=iso(run):
  sources['previousSurface']=prev['surface']
 elif prev.get('previousSurface'): sources['previousSurface']=prev['previousSurface']
 warnings=[]
 for id,t,grid,is_main in [('station',station,'station',True),('interimSurface',table,'surface',False),('interimStation',station,'station',False)]:
  try:
   r=latest_run(client,t,is_main,cap)
   primary=sources.get('station' if grid=='station' else 'surface')
   if not is_main and primary and iso(r)<=primary['runAt']:
    sources[id]={'status':'not-newer','message':'The main run is also the newest available initialization.'};continue
   sources[id]=collect(client,t,r,grid,catalog['fields'],prev.get(id),cap,now)
  except Exception as e:
   message=type(e).__name__+': '+str(e)[:300]
   warnings.append(id+': '+message)
   if prev.get(id,{}).get('points'):
    sources[id]={**prev[id],'status':'last-verified','refreshWarning':message,'checkedAt':now}
   else:sources[id]={'status':'unavailable','message':message,'checkedAt':now}
 payload={'schema':SCHEMA,'model':'Google WeatherNext 3','generatedAt':now,
          'ensembleMembers':64,'comparisonOnly':True,'timeStepHours':1,
          'points':POINTS,'sources':sources,'warnings':warnings,
          'sourceDocumentation':catalog['source'],
          'scope':'All available BigQuery surface statistics for the published locations. Raw member trajectories, upper-air and six-hour native products require the separate Google Cloud Storage feed.',
          'rawUnits':{'temperature':'K','wind':'m/s','precipitation':'m per preceding hour','cloud':'fraction','pressure':'Pa','solar':'J/m² per preceding hour'}}
 out.parent.mkdir(parents=True,exist_ok=True)
 tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False)+'\n');tmp.replace(out)
 print(json.dumps({'published':str(out),'sources':{k:{'status':v['status'],'runAt':v.get('runAt'),'fields':len(v.get('fields',[])),'horizonHours':v.get('horizonHours')} for k,v in sources.items()},'warnings':warnings}))
if __name__=='__main__':main()
