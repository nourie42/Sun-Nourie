#!/usr/bin/env python3
"""Google WeatherNext 3 forecast map overlays for the contiguous United States.

Reads the ensemble-mean surface fields of the linked WeatherNext BigQuery table
for ONE main initialization (00/06/12/18 UTC), resamples them to the same
Web Mercator overlay frame used by the other Weather Nourie model maps, and
publishes small palette PNG frames plus a catalog.  Nothing is invented: a
layer or frame that cannot be built from published WeatherNext values is left
out and named in the catalog.

Cost safety, in the same spirit as weather_weathernext_site_collect.py:
  * --dry-run only asks BigQuery for a (free) byte estimate and exits.
  * Every real query sends maximumBytesBilled and is checked against an
    estimate ceiling first.
  * Actual billed bytes are printed. If a run bills more than --review-billed-bytes
    it still publishes (the bytes are already spent) and then writes a cost-stop
    file that blocks further runs until a person has looked and deleted it.
  * This job has its own stop file and never touches the point-feed collector.

Docs: https://developers.google.com/weathernext/guides/bigquery
"""
from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = 'weather-nourie-weathernext-maps-v1'
MODEL = 'Google WeatherNext 3'
# [[south, west], [north, east]] in the same frame as the NOAA/ECMWF model maps.
BOUNDS = [[20.0, -130.0], [55.0, -60.0]]
WIDTH, HEIGHT = 840, 420
STEP_TENTHS = 2            # query every second 0.1 degree cell -> 0.2 degree sample
STEP = STEP_TENTHS / 10
MAP_DIR = 'weathernext-maps'
CATALOG = 'models/weathernext-maps.json'
STOP_FILE = 'models/weathernext-maps-cost-stop.json'
FRAME_RE = re.compile(r'^weathernext-maps/wn3-\d{10}-(temperature|dewpoint|wind|precipitation|clouds|pressure|solar)-\d{3}\.png$')
TABLE_RE = re.compile(r'^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.weathernext_3_0_0_0p1deg$')
DEFAULT_MAX_HOURS = 120


class CostStop(RuntimeError):
    pass


class EstimateCeiling(RuntimeError):
    pass


# Raw WeatherNext units: K, m/s, m per preceding hour, fraction, Pa, J/m2 per preceding hour.
def kelvin_to_f(v): return (v - 273.15) * 1.8 + 32
def ms_to_mph(v): return v * 2.2369362920544
def m_to_in(v): return v * 39.37007874015748
def fraction_to_percent(v): return v * 100
def pa_to_hpa(v): return v / 100
def joules_to_watts(v): return v / 3600

R = lambda r, g, b, a: (r, g, b, a)
CLEAR = (0, 0, 0, 0)
LAYERS = {
    'temperature': {
        'column': 'temperature_2m', 'convert': kelvin_to_f, 'valid': (-90, 140), 'units': '°F',
        'label': 'Air temperature', 'description': 'Ensemble-mean air temperature about 6.6 feet above the ground.',
        'thresholds': [20, 32, 45, 60, 75, 85, 95, 105],
        'colors': [R(122, 139, 222, 165), R(97, 171, 227, 155), R(97, 196, 217, 150), R(89, 184, 166, 140), R(177, 200, 113, 140),
                   R(235, 206, 98, 160), R(239, 163, 88, 165), R(238, 112, 83, 175), R(215, 78, 102, 185)],
    },
    'dewpoint': {
        'column': 'dewpoint_temperature_2m', 'convert': kelvin_to_f, 'valid': (-90, 100), 'units': '°F',
        'label': 'Dew point', 'description': 'Ensemble-mean dew point. Higher values feel muggier.',
        'thresholds': [20, 32, 40, 50, 55, 60, 65, 70, 75],
        'colors': [R(196, 169, 125, 150), R(206, 190, 140, 145), R(190, 205, 150, 140), R(150, 200, 150, 140), R(100, 190, 150, 145),
                   R(70, 180, 160, 155), R(55, 160, 175, 165), R(70, 130, 190, 175), R(110, 100, 200, 185), R(160, 80, 190, 195)],
    },
    'wind': {
        'column': 'wind_speed_10m', 'convert': ms_to_mph, 'valid': (0, 200), 'units': 'mph',
        'label': 'Surface wind speed', 'description': 'Ensemble-mean sustained wind speed at 10 metres. Not gusts.',
        'thresholds': [5, 10, 15, 20, 30, 40, 60],
        'colors': [R(127, 175, 215, 65), R(76, 180, 195, 95), R(65, 174, 160, 125), R(138, 187, 106, 155), R(224, 192, 91, 175),
                   R(229, 142, 81, 195), R(212, 97, 119, 205), R(167, 104, 210, 220)],
    },
    'precipitation': {
        'column': 'total_precipitation_1hr', 'convert': m_to_in, 'valid': (-0.0005, 10), 'clip_low': 0, 'units': 'in per hour',
        'label': 'Rain and melted snow', 'description': 'Ensemble-mean liquid-equivalent precipitation during the hour ending at the valid time. A mean amount, not a probability of rain.',
        'thresholds': [0.005, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0],
        'colors': [CLEAR, R(88, 181, 235, 100), R(73, 162, 231, 130), R(55, 181, 161, 150), R(90, 193, 85, 170),
                   R(231, 215, 75, 185), R(237, 145, 74, 200), R(211, 84, 127, 215)],
    },
    'clouds': {
        'column': 'total_cloud_cover', 'convert': fraction_to_percent, 'valid': (-0.001, 100.001), 'clip': (0, 100), 'units': '%',
        'label': 'Cloud cover', 'description': 'Ensemble-mean total cloud fraction. Cloud layers are not additive.',
        'thresholds': [10, 25, 50, 75, 90],
        'colors': [CLEAR, R(202, 216, 235, 45), R(204, 216, 233, 80), R(207, 220, 239, 120), R(216, 226, 242, 160), R(228, 237, 249, 195)],
    },
    'pressure': {
        'column': 'mean_sea_level_pressure', 'convert': pa_to_hpa, 'valid': (850, 1090), 'units': 'hPa',
        'label': 'Sea-level pressure', 'description': 'Ensemble-mean pressure reduced to sea level. Not station pressure.',
        'thresholds': [990, 1000, 1005, 1010, 1015, 1020, 1025, 1030],
        'colors': [R(150, 90, 200, 170), R(110, 110, 210, 160), R(80, 150, 215, 150), R(80, 190, 210, 140), R(150, 205, 170, 135),
                   R(215, 210, 130, 140), R(235, 180, 95, 150), R(232, 135, 85, 160), R(215, 90, 90, 170)],
    },
    'solar': {
        'column': 'surface_solar_radiation_downwards_1hr', 'convert': joules_to_watts, 'valid': (-1, 1500), 'clip_low': 0, 'units': 'W/m²',
        'label': 'Sunlight reaching the ground', 'description': 'Ensemble-mean hourly average downward solar irradiance. Not UV index.',
        'thresholds': [10, 100, 200, 300, 400, 500, 600, 700, 800],
        'colors': [CLEAR, R(70, 90, 160, 110), R(90, 120, 180, 125), R(110, 150, 190, 135), R(140, 180, 190, 140), R(180, 205, 170, 150),
                   R(220, 220, 130, 160), R(240, 205, 95, 170), R(244, 170, 80, 180), R(240, 130, 70, 190)],
    },
}


def iso(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def validate_table(table):
    if not TABLE_RE.fullmatch(table or ''):
        raise ValueError('Invalid linked WeatherNext 0.1 degree table')
    return table


def lead_hours(max_hours=DEFAULT_MAX_HOURS):
    """Every 3 hours for two days, then every 6 hours. Hour 0 is not published."""
    return [h for h in range(3, max_hours + 1) if (h <= 48 and h % 3 == 0) or (h > 48 and h % 6 == 0)]


def conus_polygon_wkt():
    """Densified rectangle so geodesic edges stay on the intended parallels."""
    (south, west), (north, east) = BOUNDS
    def edge(a, b, n=14): return [a + (b - a) * i / n for i in range(n)]
    ring = [(lon, south) for lon in edge(west, east)] + [(east, lat) for lat in edge(south, north)] \
        + [(lon, north) for lon in edge(east, west)] + [(west, lat) for lat in edge(north, south)]
    ring.append(ring[0])
    return 'POLYGON((' + ','.join(f'{lon:.4f} {lat:.4f}' for lon, lat in ring) + '))'


def available_columns(schema):
    forecast = next((f for f in schema if f.name == 'forecast'), None)
    if forecast is None:
        raise RuntimeError('No forecast record in source schema')
    return {f.name for f in forecast.fields}


class Queries:
    """Dry-run, ceiling, hard billing cap and ledger for every job in this run."""

    def __init__(self, client, stop_path, max_estimate_bytes, max_billed_bytes, review_billed_bytes=None, make_config=None):
        self.client, self.stop_path = client, Path(stop_path)
        self.max_estimate, self.max_billed = int(max_estimate_bytes), int(max_billed_bytes)
        self.review_bytes = int(review_billed_bytes if review_billed_bytes is not None else max_billed_bytes)
        self.billed = 0
        self.make_config = make_config or self._default_config
        if self.stop_path.exists():
            raise CostStop(f'Map collection is paused by {self.stop_path.name}. Review it, then delete that file to resume.')

    @staticmethod
    def _default_config(params=(), dry_run=False, max_bytes=None):
        from google.cloud import bigquery
        kwargs = {'query_parameters': list(params), 'dry_run': dry_run, 'use_query_cache': True}
        if max_bytes:
            kwargs['maximum_bytes_billed'] = max_bytes
        return bigquery.QueryJobConfig(**kwargs)

    def estimate(self, sql, params=()):
        job = self.client.query(sql, job_config=self.make_config(params, dry_run=True), location='US')
        return int(job.total_bytes_processed or 0)

    def run(self, sql, params=(), discovery=False):
        estimate = self.estimate(sql, params)
        ceiling = 3_000_000_000 if discovery else self.max_estimate
        if estimate > ceiling:
            raise EstimateCeiling(f'Query estimate {estimate} bytes exceeds the {ceiling} byte ceiling; it was not executed.')
        # BigQuery checks this cap against the pre-execution estimate, which for a clustered table is a
        # pessimistic upper bound (it counted ~190 GB for a query that bills a small fraction). A cap below
        # the estimate would reject the query before it runs, so the cap is the estimate that already passed
        # the ceiling above, plus 10% because the estimate BigQuery checks at execution runs a hair above the
        # dry-run figure (190,151,020,800 vs 190,151,917,568 bytes). Actual billing is checked after the run (pause_if_expensive).
        cap = 3_000_000_000 if discovery else max(self.max_billed, int(estimate * 1.1))
        job = self.client.query(sql, job_config=self.make_config(params, max_bytes=cap), location='US')
        rows = list(job.result(timeout=600))
        billed = int(job.total_bytes_billed or 0)
        self.billed += billed
        print(json.dumps({'job': job.job_id, 'estimatedBytes': estimate, 'billedBytes': billed, 'runBilledBytes': self.billed, 'rows': len(rows)}), flush=True)
        return rows

    def pause_if_expensive(self):
        """Called after publishing: an unexpectedly large bill blocks the next run until reviewed."""
        if self.billed <= self.review_bytes:
            return False
        self.stop_path.parent.mkdir(parents=True, exist_ok=True)
        self.stop_path.write_text(json.dumps({'pausedAt': iso(datetime.now(timezone.utc)), 'runBilledBytes': self.billed,
                                              'reviewBytes': self.review_bytes, 'hardCapBytes': self.max_billed,
                                              'reason': 'This run billed more than the review threshold. Check Google Cloud billing, then delete this file to resume.'}, indent=1) + '\n')
        print('WARNING: billing exceeded the review threshold; further map collection is paused.', flush=True)
        return True


def latest_main_run(q, table):
    for lookback in (12, 48):
        sql = f'''SELECT MAX(IF(MOD(EXTRACT(HOUR FROM init_time),6)=0,init_time,NULL)) AS main_run
 FROM `{validate_table(table)}`
 WHERE init_time BETWEEN TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL {lookback} HOUR) AND CURRENT_TIMESTAMP()'''
        rows = q.run(sql, discovery=True)
        if rows and rows[0].main_run is not None:
            return rows[0].main_run
    raise RuntimeError('No main initialization was published in the last 48 hours')


def build_query(table, columns, hours):
    selected = ','.join(f'f.`{c}_mean` AS `{c}`' for c in columns)
    return f'''SELECT ROUND(ST_X(t.geography),1) AS lon, ROUND(ST_Y(t.geography),1) AS lat, f.hours AS lead_hours, {selected}
 FROM `{validate_table(table)}` AS t, UNNEST(t.forecast) AS f
 WHERE t.init_time=@init_time
 AND ST_INTERSECTS(t.geography, ST_GEOGFROMTEXT(@area))
 AND MOD(CAST(ROUND(ST_X(t.geography)*10) AS INT64), {STEP_TENTHS})=0
 AND MOD(CAST(ROUND(ST_Y(t.geography)*10) AS INT64), {STEP_TENTHS})=0
 AND f.hours IN UNNEST(@hours)'''


def query_params(run, hours):
    from google.cloud import bigquery
    return [bigquery.ScalarQueryParameter('init_time', 'TIMESTAMP', run),
            bigquery.ScalarQueryParameter('area', 'STRING', conus_polygon_wkt()),
            bigquery.ArrayQueryParameter('hours', 'INT64', hours)]


# ---------------------------------------------------------------- rasters

def grid_shape():
    (south, west), (north, east) = BOUNDS
    return int(round((north - south) / STEP)) + 1, int(round((east - west) / STEP)) + 1


def rows_to_cubes(rows, layers, hours):
    """Place BigQuery rows on a regular [hour, lat, lon] raster in display units."""
    import numpy as np
    (south, west), _ = BOUNDS
    ny, nx = grid_shape()
    index = {h: i for i, h in enumerate(hours)}
    cubes = {name: np.full((len(hours), ny, nx), np.nan, dtype=np.float32) for name in layers}
    for r in rows:
        hi = index.get(int(r.lead_hours))
        iy, ix = int(round((float(r.lat) - south) / STEP)), int(round((float(r.lon) - west) / STEP))
        if hi is None or not (0 <= iy < ny and 0 <= ix < nx):
            continue
        for name in layers:
            raw = getattr(r, LAYERS[name]['column'])
            if raw is None:
                continue
            spec = LAYERS[name]
            value = spec['convert'](float(raw))
            low, high = spec['valid']
            if not math.isfinite(value) or value < low or value > high:
                continue
            if 'clip' in spec:
                value = min(max(value, spec['clip'][0]), spec['clip'][1])
            if 'clip_low' in spec:
                value = max(value, spec['clip_low'])
            cubes[name][hi, iy, ix] = value
    return cubes


def mercator_y(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def pixel_sampling():
    """Fractional [row, col] grid positions for every output pixel (Web Mercator rows)."""
    import numpy as np
    (south, west), (north, east) = BOUNDS
    ytop, ybottom = mercator_y(north), mercator_y(south)
    cols = (np.arange(WIDTH) + .5) / WIDTH
    rows = (np.arange(HEIGHT) + .5) / HEIGHT
    lon = west + cols * (east - west)
    y = ytop + rows * (ybottom - ytop)
    lat = np.degrees(2 * np.arctan(np.exp(y)) - math.pi / 2)
    fx = (lon - west) / STEP
    fy = (lat - south) / STEP
    return np.meshgrid(fy, fx, indexing='ij')


def resample(field, sampling):
    """NaN-aware bilinear resample so sparse or masked cells never smear into zeros."""
    import numpy as np
    from scipy.ndimage import map_coordinates
    valid = np.isfinite(field)
    if not valid.any():
        return np.full((HEIGHT, WIDTH), np.nan, dtype=np.float32)
    filled = np.where(valid, field, 0).astype(np.float64)
    coords = [sampling[0], sampling[1]]
    values = map_coordinates(filled, coords, order=1, mode='nearest')
    weight = map_coordinates(valid.astype(np.float64), coords, order=1, mode='nearest')
    with np.errstate(invalid='ignore', divide='ignore'):
        out = values / weight
    out[weight < .5] = np.nan
    return out.astype(np.float32)


def render_png(values, spec, path):
    import numpy as np
    from PIL import Image
    thresholds = np.asarray(spec['thresholds'], dtype=np.float64)
    colors = spec['colors']
    nan = ~np.isfinite(values)
    indices = np.digitize(np.nan_to_num(values, nan=-1e9), thresholds).astype(np.uint8)
    transparent = len(colors)
    indices[nan] = transparent
    palette = [c[:3] for c in colors] + [(0, 0, 0)]
    alphas = [c[3] for c in colors] + [0]
    image = Image.frombytes('P', (indices.shape[1], indices.shape[0]), indices.tobytes())
    flat = [channel for rgb in palette for channel in rgb]
    image.putpalette(flat + [0] * (768 - len(flat)))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True, transparency=bytes(alphas))


def legend(spec):
    return {'thresholds': spec['thresholds'], 'colors': [f'rgba({r},{g},{b},{a / 255:.2f})' for r, g, b, a in spec['colors']]}


def frame_file(run, layer, hour):
    return f"{MAP_DIR}/wn3-{run.strftime('%Y%m%d%H')}-{layer}-{hour:03d}.png"


def write_maps(out, run, cubes, hours, layers, now, missing, table):
    """Render every layer/hour that has enough published cells; return the catalog."""
    import numpy as np
    sampling = pixel_sampling()
    catalog_layers = {}
    for name in layers:
        spec = LAYERS[name]
        frames = []
        for hi, hour in enumerate(hours):
            field = cubes[name][hi]
            finite = np.isfinite(field).mean()
            if finite < .4:
                continue
            render_png(resample(field, sampling), spec, out / frame_file(run, name, hour))
            valid = run + timedelta(hours=hour)
            frames.append({'file': frame_file(run, name, hour), 'time': iso(valid), 'hour': hour, 'bounds': BOUNDS,
                           'field': name, 'units': spec['units']})
        if frames:
            catalog_layers[name] = {'label': spec['label'], 'units': spec['units'], 'description': spec['description'],
                                    'legend': legend(spec), 'frames': frames}
        else:
            missing.append(name)
    return {'schema': SCHEMA, 'model': MODEL, 'generatedAt': iso(now), 'runAt': iso(run), 'sourceTable': table,
            'statistic': 'ensemble mean', 'ensembleMembers': 64, 'resolutionDegrees': 0.1, 'sampleDegrees': STEP,
            'bounds': BOUNDS, 'imageSize': [WIDTH, HEIGHT], 'layers': catalog_layers, 'missingLayers': sorted(set(missing)),
            'note': 'Ensemble-mean WeatherNext forecast maps for the contiguous United States. These are model forecasts, not observations. Averaging many ensemble members smooths extremes.'}


def prune(out, current_catalog, previous_catalog):
    """Keep the new run and one earlier run while cached pages finish loading."""
    keep = set()
    for catalog in (current_catalog, previous_catalog):
        for layer in (catalog or {}).get('layers', {}).values():
            keep.update(f['file'] for f in layer.get('frames', []) if FRAME_RE.fullmatch(f.get('file', '')))
    removed = 0
    for path in (out / MAP_DIR).glob('wn3-*.png'):
        if f'{MAP_DIR}/{path.name}' not in keep:
            path.unlink()
            removed += 1
    return removed


def load_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def collect(q, table, out, now, layers=None, max_hours=DEFAULT_MAX_HOURS, force=False, dry_run=False):
    out = Path(out)
    run = latest_main_run(q, table)
    previous = load_json(out / CATALOG)
    hours = lead_hours(max_hours)
    wanted = [n for n in (layers or list(LAYERS)) if n in LAYERS]
    if previous and previous.get('runAt') == iso(run) and not force and not dry_run:
        complete = all((out / f['file']).exists() for layer in previous.get('layers', {}).values() for f in layer['frames'])
        if complete:
            print(json.dumps({'status': 'up-to-date', 'runAt': iso(run)}))
            return previous
    schema = available_columns(q.client.get_table(table).schema)
    present = [n for n in wanted if LAYERS[n]['column'] + '_mean' in schema]
    missing = [n for n in wanted if n not in present]
    if not present:
        raise RuntimeError('None of the map fields exist in the linked table')
    sql = build_query(table, [LAYERS[n]['column'] for n in present], hours)
    params = query_params(run, hours)
    if dry_run:
        estimate = q.estimate(sql, params)
        print(json.dumps({'dryRun': True, 'runAt': iso(run), 'layers': present, 'missingLayers': missing, 'frames': len(hours) * len(present),
                          'estimatedBytes': estimate, 'estimatedGB': round(estimate / 1e9, 2),
                          'note': 'For clustered tables this estimate is an upper bound; actual billing is capped by --max-billed-bytes.'}))
        return None
    rows = q.run(sql, params)
    if not rows:
        raise RuntimeError('WeatherNext returned no grid cells for the contiguous United States')
    cubes = rows_to_cubes(rows, present, hours)
    catalog = write_maps(out, run, cubes, hours, present, now, missing, table)
    if not catalog['layers']:
        raise RuntimeError('No layer had enough published grid cells to draw')
    (out / CATALOG).parent.mkdir(parents=True, exist_ok=True)
    tmp = (out / CATALOG).with_suffix('.tmp')
    tmp.write_text(json.dumps(catalog, separators=(',', ':'), allow_nan=False) + '\n')
    tmp.replace(out / CATALOG)
    removed = prune(out, catalog, previous if previous and previous.get('runAt') != catalog['runAt'] else None)
    print(json.dumps({'published': CATALOG, 'runAt': catalog['runAt'], 'layers': {k: len(v['frames']) for k, v in catalog['layers'].items()},
                      'missingLayers': catalog['missingLayers'], 'removedOldFrames': removed, 'bytesBilled': q.billed}))
    q.pause_if_expensive()
    return catalog


def main():
    from google.cloud import bigquery
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--table', required=True, help='Linked 0.1 degree WeatherNext table, project.dataset.weathernext_3_0_0_0p1deg')
    ap.add_argument('--output', required=True, help='Checked-out weather-fusion-data worktree')
    ap.add_argument('--layers', nargs='*', choices=list(LAYERS), help='Default: every layer')
    ap.add_argument('--max-hours', type=int, default=DEFAULT_MAX_HOURS)
    ap.add_argument('--dry-run', action='store_true', help='Print the BigQuery byte estimate and exit without billing a query')
    ap.add_argument('--force', action='store_true', help='Rebuild even when this initialization is already published')
    ap.add_argument('--max-estimate-bytes', type=int, default=250_000_000_000,
                    help='Pre-execution ceiling and so the most one run can ever bill. Clustered-table estimates are pessimistic upper bounds.')
    ap.add_argument('--max-billed-bytes', type=int, default=12_000_000_000,
                    help='Billing cap sent to BigQuery; raised to the passed estimate because BigQuery checks the cap against the estimate')
    ap.add_argument('--review-billed-bytes', type=int, default=30_000_000_000,
                    help='A run that bills more than this publishes, then pauses automatic runs until a person reviews it')
    a = ap.parse_args()
    out = Path(a.output)
    q = Queries(bigquery.Client(), out / STOP_FILE, a.max_estimate_bytes, a.max_billed_bytes, a.review_billed_bytes)
    collect(q, validate_table(a.table), out, datetime.now(timezone.utc), a.layers, a.max_hours, a.force, a.dry_run)


if __name__ == '__main__':
    main()
