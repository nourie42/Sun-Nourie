#!/usr/bin/env python3
"""Publish a compact Google WeatherNext 3 point feed for Experimental Weather.

Requires WeatherNext BigQuery access and Application Default Credentials.
The source table is the 0.1-degree WeatherNext 3 statistics table linked
through BigQuery Analytics Hub.

This collector deliberately publishes raw hourly ensemble statistics only.
It does not convert WeatherNext precipitation into Weather Nourie's blended
hourly probability; WeatherNext remains comparison-only until calibrated.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import bigquery

SCHEMA = "weather-nourie-weathernext3-v1"
POINTS = [
    {"id": "knightdale", "name": "Knightdale / Raleigh", "latitude": 35.787, "longitude": -78.4806},
    {"id": "greenville", "name": "Greenville, NC", "latitude": 35.6127, "longitude": -77.3664},
]
K_TO_F_SCALE = 9 / 5
MS_TO_MPH = 2.2369362920544
METERS_TO_INCHES = 39.37007874015748


def f_temp(k):
    return None if k is None else round((float(k) - 273.15) * K_TO_F_SCALE + 32, 2)


def mph(ms):
    return None if ms is None else round(max(0.0, float(ms)) * MS_TO_MPH, 2)


def inches(m):
    return None if m is None else round(max(0.0, float(m)) * METERS_TO_INCHES, 4)


def iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def latest_main_run(client: bigquery.Client, table: str):
    sql = f"""
      SELECT MAX(init_time) AS init_time
      FROM `{table}`
      WHERE init_time BETWEEN TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY) AND CURRENT_TIMESTAMP()
        AND MOD(EXTRACT(HOUR FROM init_time), 6) = 0
    """
    row = next(iter(client.query(sql).result()), None)
    if not row or row.init_time is None:
        raise RuntimeError("No published 00/06/12/18 UTC WeatherNext 3 run was found.")
    return row.init_time


def query_point(client: bigquery.Client, table: str, init_time, point):
    sql = f"""
      SELECT
        f.time AS forecast_time,
        f.hours AS forecast_hour,
        f.temperature_2m_mean AS temperature_2m_mean,
        f.temperature_2m_p10 AS temperature_2m_p10,
        f.temperature_2m_p90 AS temperature_2m_p90,
        f.wind_speed_10m_mean AS wind_speed_10m_mean,
        f.total_precipitation_1hr_mean AS total_precipitation_1hr_mean,
        f.total_precipitation_1hr_p90 AS total_precipitation_1hr_p90
      FROM `{table}` AS t, t.forecast AS f
      WHERE t.init_time = @init_time
        AND ST_INTERSECTS(t.geography_polygon, ST_GEOGPOINT(@longitude, @latitude))
        AND f.hours BETWEEN 0 AND 168
      ORDER BY f.time ASC
    """
    config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("init_time", "TIMESTAMP", init_time),
        bigquery.ScalarQueryParameter("longitude", "FLOAT64", point["longitude"]),
        bigquery.ScalarQueryParameter("latitude", "FLOAT64", point["latitude"]),
    ])
    rows = list(client.query(sql, job_config=config).result())
    if not rows:
        raise RuntimeError(f"No WeatherNext 3 rows returned for {point['name']}.")
    hourly = []
    for row in rows:
        hourly.append({
            "time": iso(row.forecast_time),
            "forecastHour": int(row.forecast_hour),
            "temperatureF": f_temp(row.temperature_2m_mean),
            "temperatureP10F": f_temp(row.temperature_2m_p10),
            "temperatureP90F": f_temp(row.temperature_2m_p90),
            "windMph": mph(row.wind_speed_10m_mean),
            "precipitationInches": inches(row.total_precipitation_1hr_mean),
            "precipitationP90Inches": inches(row.total_precipitation_1hr_p90),
        })
    return {**point, "hourly": hourly}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--table", required=True, help="project.dataset.weathernext_3_0_0_0p1deg")
    parser.add_argument("--output", required=True, help="Output models/weathernext3.json path")
    args = parser.parse_args()

    if not args.table.endswith("weathernext_3_0_0_0p1deg"):
        raise SystemExit("--table must point to the WeatherNext 3 0.1-degree statistics table.")

    client = bigquery.Client()
    run = latest_main_run(client, args.table)
    points = [query_point(client, args.table, run, point) for point in POINTS]
    payload = {
        "schema": SCHEMA,
        "model": "Google WeatherNext 3",
        "source": "Google BigQuery Analytics Hub",
        "sourceTable": args.table,
        "runAt": iso(run),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "comparisonOnly": True,
        "ensembleMembers": 64,
        "gridResolutionDegrees": 0.1,
        "timeStepHours": 1,
        "horizonHours": 168,
        "units": {
            "temperature": "degF",
            "wind": "mph",
            "precipitation": "inch per 1-hour window",
        },
        "points": points,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Published {len(points)} WeatherNext 3 points from {iso(run)} to {output}")


if __name__ == "__main__":
    main()
