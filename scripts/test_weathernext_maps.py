#!/usr/bin/env python3
"""WeatherNext map generator regressions: no credentials, network or billed queries."""
import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image

import weather_weathernext_maps as maps

TABLE = 'test-project.weather.weathernext_3_0_0_0p1deg'
RUN = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
NOW = datetime(2026, 10, 25, 21, tzinfo=timezone.utc)
(SOUTH, WEST), (NORTH, EAST) = maps.BOUNDS


def sample_cells():
    ny, nx = maps.grid_shape()
    return [(round(SOUTH + iy * maps.STEP, 1), round(WEST + ix * maps.STEP, 1)) for iy in range(ny) for ix in range(nx)]


def fake_rows(hours, hot=None, layers=('temperature_2m', 'total_cloud_cover')):
    """One row per sampled cell and lead hour; `hot` is a (lat, lon) block that is much warmer."""
    rows = []
    for lat, lon in sample_cells():
        for hour in hours:
            kelvin = 293.15
            if hot and abs(lat - hot[0]) <= .6 and abs(lon - hot[1]) <= .6:
                kelvin = 313.15
            values = {'temperature_2m': kelvin, 'total_cloud_cover': 0.5, 'wind_speed_10m': 5.0,
                      'total_precipitation_1hr': 0.0, 'dewpoint_temperature_2m': 283.15,
                      'mean_sea_level_pressure': 101325.0, 'surface_solar_radiation_downwards_1hr': 0.0}
            rows.append(SimpleNamespace(lat=lat, lon=lon, lead_hours=hour, **{k: values[k] for k in layers}))
    return rows


class FakeJob:
    def __init__(self, rows, estimate, billed):
        self.rows, self.total_bytes_processed, self.total_bytes_billed, self.job_id = rows, estimate, billed, 'job-1'
    def result(self, timeout=None): return self.rows


class FakeClient:
    def __init__(self, rows, estimate=2_000_000_000, billed=2_000_000_000, columns=None):
        self.rows, self.estimate, self.billed, self.queries, self.columns = rows, estimate, billed, [], columns
    def query(self, sql, job_config=None, location=None):
        dry = bool(job_config and job_config.get('dry_run'))
        self.queries.append({'sql': sql, 'dry_run': dry})
        if 'main_run' in sql:
            return FakeJob([SimpleNamespace(main_run=RUN)], 0, 0)
        return FakeJob([] if dry else self.rows, self.estimate, 0 if dry else self.billed)
    def get_table(self, table):
        names = self.columns or ['temperature_2m_mean', 'total_cloud_cover_mean', 'wind_speed_10m_mean']
        return SimpleNamespace(schema=[SimpleNamespace(name='forecast', fields=[SimpleNamespace(name=n) for n in names])])


def config(params=(), dry_run=False, max_bytes=None):
    return {'dry_run': dry_run, 'max_bytes': max_bytes}


def make_queries(client, out, estimate_ceiling=700_000_000_000, hard_cap=12_000_000_000, review=6_000_000_000):
    return maps.Queries(client, Path(out) / maps.STOP_FILE, estimate_ceiling, hard_cap, review, make_config=config)


class Palette(unittest.TestCase):
    def test_every_layer_has_one_more_color_than_threshold(self):
        for name, spec in maps.LAYERS.items():
            self.assertEqual(len(spec['colors']), len(spec['thresholds']) + 1, name)
            self.assertEqual(spec['thresholds'], sorted(spec['thresholds']), name)
            legend = maps.legend(spec)
            self.assertEqual(len(legend['colors']), len(legend['thresholds']) + 1)

    def test_unit_conversions_match_the_site_converters(self):
        self.assertAlmostEqual(maps.kelvin_to_f(273.15), 32)
        self.assertAlmostEqual(maps.ms_to_mph(10), 22.369, places=2)
        self.assertAlmostEqual(maps.m_to_in(0.0254), 1.0, places=5)
        self.assertEqual(maps.fraction_to_percent(.25), 25)
        self.assertEqual(maps.pa_to_hpa(101300), 1013)
        self.assertEqual(maps.joules_to_watts(3600), 1)


class Geometry(unittest.TestCase):
    def test_lead_hours_are_published_hours_only(self):
        hours = maps.lead_hours()
        self.assertNotIn(0, hours)
        self.assertEqual(hours[:3], [3, 6, 9])
        self.assertIn(48, hours)
        self.assertEqual(hours[hours.index(48) + 1], 54)
        self.assertEqual(hours[-1], 120)

    def test_area_is_a_closed_densified_ring_inside_the_overlay_bounds(self):
        wkt = maps.conus_polygon_wkt()
        self.assertTrue(wkt.startswith('POLYGON((') and wkt.endswith('))'))
        points = [tuple(map(float, p.split())) for p in wkt[9:-2].split(',')]
        self.assertEqual(points[0], points[-1])
        self.assertGreater(len(points), 40)
        for lon, lat in points:
            self.assertTrue(WEST <= lon <= EAST and SOUTH <= lat <= NORTH)

    def test_query_uses_parameters_and_validates_the_table(self):
        sql = maps.build_query(TABLE, ['temperature_2m', 'wind_speed_10m'], [3, 6])
        for needle in ('@init_time', '@area', '@hours', 'f.`temperature_2m_mean` AS `temperature_2m`', 'ST_INTERSECTS'):
            self.assertIn(needle, sql)
        self.assertNotIn('2026', sql)
        with self.assertRaises(ValueError):
            maps.validate_table('x.y.z; DROP TABLE a')
        with self.assertRaises(ValueError):
            maps.validate_table('proj.ds.weathernext_3_0_0_0p05deg')

    def test_a_known_hot_cell_lands_on_the_matching_web_mercator_pixel(self):
        hot = (35.8, -78.4)
        rows = fake_rows([6], hot=hot, layers=('temperature_2m',))
        cubes = maps.rows_to_cubes(rows, ['temperature'], [6])
        field = maps.resample(cubes['temperature'][0], maps.pixel_sampling())
        rows_hot, cols_hot = np.where(np.nan_to_num(field, nan=0) > 100)
        row, col = rows_hot.mean(), cols_hot.mean()
        # Independent expectation from the Web Mercator formulas.
        expected_col = (hot[1] - WEST) / (EAST - WEST) * maps.WIDTH
        y = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        expected_row = (y(NORTH) - y(hot[0])) / (y(NORTH) - y(SOUTH)) * maps.HEIGHT
        self.assertLessEqual(abs(col - expected_col), 3)
        self.assertLessEqual(abs(row - expected_row), 3)
        self.assertAlmostEqual(float(np.nanmax(field)), maps.kelvin_to_f(313.15), places=1)


class Rendering(unittest.TestCase):
    def test_units_validity_and_clipping(self):
        rows = fake_rows([6], layers=('temperature_2m', 'total_cloud_cover'))
        rows[0].temperature_2m = 500.0        # implausible: must be dropped
        rows[1].total_cloud_cover = 1.0000005  # rounding noise: clipped to 100
        rows[2].total_cloud_cover = None
        cubes = maps.rows_to_cubes(rows, ['temperature', 'clouds'], [6])
        ny, nx = maps.grid_shape()
        self.assertTrue(np.isnan(cubes['temperature'][0].flat[0]))
        self.assertAlmostEqual(float(cubes['temperature'][0].flat[3]), 68.0, places=1)
        self.assertEqual(float(cubes['clouds'][0].flat[1]), 100.0)
        self.assertTrue(np.isnan(cubes['clouds'][0].flat[2]))
        self.assertEqual(cubes['temperature'].shape, (1, ny, nx))

    def test_png_is_small_palette_image_with_transparent_missing_cells(self):
        values = np.full((maps.HEIGHT, maps.WIDTH), 70.0, dtype=np.float32)
        values[:, :100] = np.nan
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'frame.png'
            maps.render_png(values, maps.LAYERS['temperature'], path)
            image = Image.open(path)
            self.assertEqual(image.size, (maps.WIDTH, maps.HEIGHT))
            self.assertEqual(image.mode, 'P')
            rgba = np.asarray(image.convert('RGBA'))
            self.assertEqual(int(rgba[10, 10, 3]), 0)
            self.assertGreater(int(rgba[10, 500, 3]), 100)
            self.assertLess(path.stat().st_size, 20_000)

    def test_zero_precipitation_and_clear_sky_are_transparent_not_missing_data(self):
        values = np.zeros((maps.HEIGHT, maps.WIDTH), dtype=np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'rain.png'
            maps.render_png(values, maps.LAYERS['precipitation'], path)
            self.assertEqual(int(np.asarray(Image.open(path).convert('RGBA'))[100, 100, 3]), 0)


class Collection(unittest.TestCase):
    def collect(self, out, client, **kwargs):
        with patch.object(maps, 'query_params', lambda run, hours: []):
            return maps.collect(make_queries(client, out), TABLE, out, NOW, **kwargs)

    def test_publishes_catalog_and_frames_for_published_fields_only(self):
        hours = maps.lead_hours(12)
        client = FakeClient(fake_rows(hours), columns=['temperature_2m_mean', 'total_cloud_cover_mean'])
        with tempfile.TemporaryDirectory() as tmp:
            catalog = self.collect(tmp, client, layers=['temperature', 'clouds', 'wind'], max_hours=12)
            self.assertEqual(catalog['schema'], maps.SCHEMA)
            self.assertEqual(catalog['runAt'], '2026-10-25T12:00:00Z')
            self.assertEqual(set(catalog['layers']), {'temperature', 'clouds'})
            self.assertEqual(catalog['missingLayers'], ['wind'])   # not in the table schema: reported, never invented
            for name, layer in catalog['layers'].items():
                self.assertEqual([f['hour'] for f in layer['frames']], hours)
                for frame in layer['frames']:
                    self.assertRegex(frame['file'], maps.FRAME_RE)
                    self.assertTrue((Path(tmp) / frame['file']).exists())
                    self.assertEqual(frame['bounds'], maps.BOUNDS)
            first = catalog['layers']['temperature']['frames'][0]
            self.assertEqual(first['time'], '2026-10-25T15:00:00Z')
            on_disk = json.loads((Path(tmp) / maps.CATALOG).read_text())
            self.assertEqual(on_disk['layers'].keys(), catalog['layers'].keys())
            self.assertEqual([q['dry_run'] for q in client.queries if 'main_run' not in q['sql']], [True, False])

    def test_a_layer_without_enough_cells_is_reported_not_drawn(self):
        hours = maps.lead_hours(6)
        rows = fake_rows(hours)
        for r in rows:
            r.total_cloud_cover = None
        with tempfile.TemporaryDirectory() as tmp:
            catalog = self.collect(tmp, FakeClient(rows), layers=['temperature', 'clouds'], max_hours=6)
            self.assertEqual(set(catalog['layers']), {'temperature'})
            self.assertIn('clouds', catalog['missingLayers'])

    def test_same_initialization_is_not_queried_again(self):
        hours = maps.lead_hours(6)
        client = FakeClient(fake_rows(hours))
        with tempfile.TemporaryDirectory() as tmp:
            self.collect(tmp, client, layers=['temperature'], max_hours=6)
            before = len(client.queries)
            again = self.collect(tmp, client, layers=['temperature'], max_hours=6)
            self.assertEqual(again['runAt'], '2026-10-25T12:00:00Z')
            new = client.queries[before:]
            self.assertTrue(new and all('main_run' in q['sql'] for q in new))   # only the tiny initialization lookup

    def test_dry_run_estimates_without_billing_or_writing(self):
        client = FakeClient(fake_rows([3]))
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(self.collect(tmp, client, layers=['temperature'], dry_run=True))
            self.assertTrue(all(q['dry_run'] for q in client.queries if 'main_run' not in q['sql']))
            self.assertFalse((Path(tmp) / maps.CATALOG).exists())

    def test_estimate_above_the_ceiling_is_never_executed(self):
        client = FakeClient(fake_rows([3]), estimate=900_000_000_000)
        with tempfile.TemporaryDirectory() as tmp, patch.object(maps, 'query_params', lambda run, hours: []):
            q = make_queries(client, tmp)
            with self.assertRaises(maps.EstimateCeiling):
                maps.collect(q, TABLE, tmp, NOW, layers=['temperature'], max_hours=6)
            self.assertTrue(all(x['dry_run'] for x in client.queries if 'main_run' not in x['sql']))

    def test_unexpectedly_large_bill_publishes_once_then_pauses_future_runs(self):
        hours = maps.lead_hours(6)
        client = FakeClient(fake_rows(hours), billed=8_000_000_000)
        with tempfile.TemporaryDirectory() as tmp:
            self.collect(tmp, client, layers=['temperature'], max_hours=6)
            self.assertTrue((Path(tmp) / maps.CATALOG).exists())
            self.assertTrue((Path(tmp) / maps.STOP_FILE).exists())
            with self.assertRaises(maps.CostStop):
                make_queries(client, tmp)

    def test_old_frames_are_pruned_but_the_previous_run_survives(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / maps.MAP_DIR).mkdir(parents=True)
            names = {n: out / maps.MAP_DIR / f'wn3-{n}-temperature-003.png' for n in ('2026102400', '2026102412', '2026102500')}
            for p in names.values():
                p.write_bytes(b'x')
            def catalog(stamp): return {'layers': {'temperature': {'frames': [{'file': f'{maps.MAP_DIR}/wn3-{stamp}-temperature-003.png'}]}}}
            removed = maps.prune(out, catalog('2026102500'), catalog('2026102412'))
            self.assertEqual(removed, 1)
            self.assertFalse(names['2026102400'].exists())
            self.assertTrue(names['2026102412'].exists() and names['2026102500'].exists())


if __name__ == '__main__':
    unittest.main()
