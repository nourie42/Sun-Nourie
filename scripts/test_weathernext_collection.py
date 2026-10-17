#!/usr/bin/env python3
"""Collector regressions without credentials, network requests or billed queries."""
import copy
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import weather_weathernext_site_collect as collector

TABLE='test-project.weather.weathernext_3_0_0_0p1deg'
NOW='2026-10-14T10:00:00Z'
class CollectorTests(unittest.TestCase):
 def test_collection_timestamp_does_not_refresh_old_model_initialization(self):
  source={'status':'ready','runAt':'2026-10-12T00:00:00Z','fetchedAt':NOW,'checkedAt':NOW}
  result=collector.mark_freshness(source,NOW)
  self.assertEqual(result['status'],'stale')
  self.assertEqual(result['freshnessStatus'],'stale')
  self.assertEqual(result['runAgeHours'],58)
  self.assertEqual(result['runAt'],'2026-10-12T00:00:00Z')
 def test_unchanged_initialization_reuses_data_without_billed_point_queries(self):
  class NoQueries:
   def run(self,*args,**kwargs):raise AssertionError('Unchanged model must not be queried again')
  original={'status':'ready','sourceTable':TABLE,'runAt':'2026-10-12T00:00:00Z','fetchedAt':'2026-10-12T09:00:00Z','points':[{**point,'hourly':[{'time':'2026-10-15T00:00:00Z'}]} for point in collector.POINTS]}
  before=copy.deepcopy(original)
  result=collector.collect(NoQueries(),TABLE,datetime(2026,10,12,tzinfo=timezone.utc),'surface',[],original,NOW)
  self.assertEqual(result['fetchedAt'],before['fetchedAt'])
  self.assertEqual(result['checkedAt'],NOW)
  self.assertEqual(result['status'],'stale')
  self.assertEqual(original,before)
 def test_new_location_forces_real_same_run_collection(self):
  run=datetime(2026,10,14,tzinfo=timezone.utc)
  previous={'status':'ready','sourceTable':TABLE,'runAt':collector.iso(run),'points':[{**point,'hourly':[{'time':'2026-10-14T01:00:00Z'}]} for point in collector.POINTS[:-1]]}
  schema=[SimpleNamespace(name='forecast',fields=[SimpleNamespace(name='temperature_2m_mean')])]
  q=SimpleNamespace(client=SimpleNamespace(get_table=lambda table:SimpleNamespace(schema=schema)))
  calls=[]
  def query_point(query,table,initialization,point,columns):
   calls.append(point['id'])
   return {**point,'hourly':[{'time':'2026-10-14T01:00:00Z','forecastHour':1,'values':{'temperature_2m':{'mean':290}}}]}
  with patch.object(collector,'query_point',query_point):
   result=collector.collect(q,TABLE,run,'surface',[{'id':'temperature_2m','grid':'surface'}],previous,NOW)
  self.assertEqual(calls,[point['id'] for point in collector.POINTS])
  self.assertEqual([point['id'] for point in result['points']],calls)
  self.assertTrue(all(point['hourly'][0]['values']['temperature_2m']['mean']==290 for point in result['points']))
  self.assertEqual(len(previous['points']),len(collector.POINTS)-1)
 def test_reuse_requires_identical_coordinates_and_real_hourly_coverage(self):
  source={'points':[{**point,'hourly':[{'time':'2026-10-14T01:00:00Z'}]} for point in collector.POINTS]}
  self.assertTrue(collector.covers_current_points(source))
  moved=copy.deepcopy(source);moved['points'][-1]['longitude']+=0.01
  self.assertFalse(collector.covers_current_points(moved))
  empty=copy.deepcopy(source);empty['points'][-1]['hourly']=[]
  self.assertFalse(collector.covers_current_points(empty))
 def test_latest_lookup_keeps_main_and_newer_interim_runs_separate(self):
  main=datetime(2026,10,14,tzinfo=timezone.utc);newest=datetime(2026,10,14,2,tzinfo=timezone.utc)
  class Query:
   def run(self,sql,discovery=False):
    self.sql=sql;self.discovery=discovery
    return [SimpleNamespace(main_run=main,newest_run=newest)]
  q=Query();self.assertEqual(collector.latest_runs(q,TABLE),(main,newest))
  self.assertTrue(q.discovery);self.assertIn('INTERVAL 12 HOUR',q.sql)
  self.assertNotIn('geography',q.sql)
 def test_invalid_source_table_is_rejected_before_querying(self):
  with self.assertRaises(ValueError):collector.validate_table('bad` injectedSQL')
 def test_saved_cost_stop_still_blocks_automatic_collection(self):
  import tempfile
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'stop.json';path.write_text('{}')
   with self.assertRaises(collector.CostStop):collector.Queries(None,path,700000000000)
 def test_smaller_point_batches_preserve_every_requested_statistic(self):
  import sys,types
  fields=['temperature_2m_'+stat for stat in collector.STATS]+['dewpoint_temperature_2m_mean']
  queries=[]
  class Row(dict):
   __getattr__=dict.__getitem__
  class Query:
   def run(self,sql,params):
    columns=collector.re.findall(r'f\.`([^`]+)` AS',sql);queries.append(columns)
    self_params=dict((p[0],p[2]) for p in params)
    if self_params['cell_half_width']!=.05 or self_params['radius_meters']!=8000:raise AssertionError('Wrong native surface cell geometry')
    if 'geography_polygon' in sql:raise AssertionError('Point collection must not scan the large polygon column')
    if 'ST_X(t.geography) BETWEEN' not in sql or 'ST_Y(t.geography) BETWEEN' not in sql:raise AssertionError('The selected point must stay within its native grid cell')
    return [Row(valid_time=datetime(2026,10,14,1,tzinfo=timezone.utc),lead_hours=1,grid_lat=35.8,grid_lon=-78.5,**{c:290 for c in columns})]
  fake=types.SimpleNamespace(ScalarQueryParameter=lambda *args:args)
  with patch.dict(sys.modules,{'google.cloud.bigquery':fake,'google.cloud':types.SimpleNamespace(bigquery=fake)}):
   point=collector.query_point(Query(),TABLE,datetime(2026,10,14,tzinfo=timezone.utc),collector.POINTS[0],fields)
  self.assertTrue(all(len(batch)<=3 for batch in queries));self.assertEqual(sum(queries,[]),fields)
  self.assertEqual(set(point['hourly'][0]['values']['temperature_2m']),set(collector.STATS))
  self.assertEqual(point['hourly'][0]['values']['dewpoint_temperature_2m']['mean'],290)
 def test_verified_main_run_survives_optional_collection_cost_stop(self):
  run=datetime(2026,10,14,tzinfo=timezone.utc);published=[];calls=[]
  surface={'runAt':collector.iso(run),'status':'ready','points':[{'id':'knightdale','hourly':[{'time':NOW}]}]}
  def collect(query,table,initialization,grid,*args):
   calls.append(grid)
   if grid=='station':raise collector.CostStop('budget')
   return copy.deepcopy(surface)
  with patch.object(collector,'collect',collect):
   with self.assertRaises(collector.CostStop):
    collector.refresh_sources(None,TABLE,run,run,{'fields':[]},{},NOW,lambda s,w:published.append(copy.deepcopy(s)))
  self.assertEqual(calls,['surface','station']);self.assertGreaterEqual(len(published),1)
  self.assertEqual(published[-1]['surface'],surface)
 def test_surface_phase_does_not_wait_for_optional_grids(self):
  run=datetime(2026,10,14,tzinfo=timezone.utc);calls=[]
  def collect(*args):calls.append(args[3]);return {'runAt':collector.iso(run),'status':'ready'}
  with patch.object(collector,'collect',collect):
   collector.refresh_sources(None,TABLE,run,run,{'fields':[]},{},NOW,lambda *args:None,profile='surface')
  self.assertEqual(calls,['surface'])
 def test_billing_ledger_carries_actual_usage_across_both_workflow_phases(self):
  import tempfile,sys,types,json
  class Client:
   def query(self,sql,job_config,location):
    return types.SimpleNamespace(total_bytes_processed=100,total_bytes_billed=150_000_000,job_id='test',cache_hit=False,result=lambda **kw:[])
  fake=types.SimpleNamespace(QueryJobConfig=lambda **kw:types.SimpleNamespace(**kw))
  with tempfile.TemporaryDirectory() as folder,patch.dict(sys.modules,{'google.cloud.bigquery':fake,'google.cloud':types.SimpleNamespace(bigquery=fake)}):
   stop=Path(folder)/'stop.json';ledger=Path(folder)/'billing.json'
   collector.Queries(Client(),stop,700000000000,ledger).run('test')
   second=collector.Queries(Client(),stop,700000000000,ledger);second.run('test')
   self.assertEqual(second.billed,300_000_000);self.assertEqual(json.loads(ledger.read_text())['runBilledBytes'],300_000_000)
   self.assertFalse(stop.exists(),'the original per-query cap still applies separately to each small query')
 def test_original_actual_billing_stop_limits_remain_enforced(self):
  import tempfile,sys,types,json
  class Client:
   def query(self,sql,job_config,location):
    return types.SimpleNamespace(total_bytes_processed=100,total_bytes_billed=256_901_120,job_id='test',cache_hit=False,result=lambda **kw:[])
  fake=types.SimpleNamespace(QueryJobConfig=lambda **kw:types.SimpleNamespace(**kw))
  with tempfile.TemporaryDirectory() as folder,patch.dict(sys.modules,{'google.cloud.bigquery':fake,'google.cloud':types.SimpleNamespace(bigquery=fake)}):
   stop=Path(folder)/'stop.json';ledger=Path(folder)/'billing.json'
   with self.assertRaises(collector.CostStop):collector.Queries(Client(),stop,700000000000,ledger).run('test')
   self.assertEqual(json.loads(stop.read_text())['billedBytes'],256_901_120)
   with self.assertRaises(collector.CostStop):collector.Queries(None,stop,700000000000,ledger)
if __name__=='__main__':unittest.main()
