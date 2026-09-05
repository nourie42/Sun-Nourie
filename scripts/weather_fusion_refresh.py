"""Run direct GRIB collection with per-run ECMWF mirror selection.
Inventory offsets and binary messages stay pinned to the same official mirror.
Unavailable new cycles fall back to an older complete run, retaining its time.
"""
from __future__ import annotations
import datetime as dt
import time
import urllib.request
import weather_fusion_collect as collector

ORIGINAL_URLS = collector.urls
MIRRORS = (
    'https://storage.googleapis.com/ecmwf-open-data/',
    'https://data.ecmwf.int/forecasts/',
    'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/',
)
PINNED: dict[str, str] = {}

def verified_urls(model: str, run: dt.datetime, hour: int) -> tuple[str, str]:
    body, index = ORIGINAL_URLS(model, run, hour)
    if model != 'ecmwf':
        return body, index
    key = run.isoformat()
    if key not in PINNED:
        _, last = ORIGINAL_URLS(model, run, collector.SOURCES[model]['hours'])
        tail = last.split('.amazonaws.com/', 1)[1]
        for base in MIRRORS:
            for attempt in range(2):
                try:
                    request = urllib.request.Request(base + tail, headers={'User-Agent': 'Sun-Nourie-WeatherFusion/2.1 (https://github.com/nourie42/Sun-Nourie)'})
                    with urllib.request.urlopen(request, timeout=15) as response:
                        if response.status != 200:
                            raise ValueError('Index request did not succeed')
                        data = response.read(1000001)
                        if len(data) > 1000000:
                            raise ValueError('Index exceeds safety limit')
                    entries = collector.parse_index(model, data.decode('utf-8'))
                    if not any(e['field'] == 'temperature' for e in entries):
                        raise ValueError('Native temperature inventory missing')
                    PINNED[key] = base
                    print(f'ECMWF mirror verified: {base} run={key}', flush=True)
                    break
                except Exception as error:
                    if getattr(error, 'code', None) in [404, 403]:
                        break
                    if attempt == 0:
                        time.sleep(2)
            if key in PINNED:
                break
        if key not in PINNED:
            # urls() is called before the collector's per-cycle try/except.
            # Return a real URL, allowing its failed fetch to advance discovery.
            PINNED[key] = MIRRORS[0]
            print(f'ECMWF run {key} not fully published; checking earlier cycle.', flush=True)
    base = PINNED[key]
    return base + body.split('.amazonaws.com/', 1)[1], base + index.split('.amazonaws.com/', 1)[1]

collector.urls = verified_urls
if __name__ == '__main__':
    collector.main()
