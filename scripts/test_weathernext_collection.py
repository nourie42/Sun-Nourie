#!/usr/bin/env python3
"""Collector regressions without credentials, network requests or billed queries."""
import copy
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
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
  original={'status':'ready','sourceTable':TABLE,'runAt':'2026-10-12T00:00:00Z','fetchedAt':'2026-10-12T09:00:00Z','points':[{'id':'knightdale','hourly':[{'time':'2026-10-15T00:00:00Z'}]}]}
  before=copy.deepcopy(original)
  result=collector.collect(NoQueries(),TABLE,datetime(2026,10,12,tzinfo=timezone.utc),'surface',[],original,NOW)
  self.assertEqual(result['fetchedAt'],before['fetchedAt'])
  self.assertEqual(result['checkedAt'],NOW)
  self.assertEqual(result['status'],'stale')
  self.assertEqual(original,before)
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
if __name__=='__main__':unittest.main()
