#!/usr/bin/env python3
"""Generate the compact GraphCast feed used only by Experimental Weather.

Run this on a CUDA host with enough VRAM for GraphCast Operational. The output
contains 6-hour windows for selected Weather Nourie points. It intentionally
does not convert GraphCast precipitation into hourly PoP; the browser presents
it as comparison-only guidance.

Example:
  pip install 'earth2studio[graphcast]'
  python scripts/weather_graphcast_collect.py --output outputs/graphcast.json

Publish the resulting JSON as weather-fusion-data/models/graphcast.json.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from earth2studio.data import GFS
from earth2studio.io import ZarrBackend
from earth2studio.models.px import GraphCastOperational
from earth2studio.run import deterministic as run

STEPS = 28  # 7 days at GraphCast's 6-hour time step.
VARIABLES = np.array(["t2m", "u10m", "v10m", "tp06"])
DEFAULT_POINTS = [
    ("Knightdale / Raleigh", 35.7870, -78.4806),
    ("Greenville, NC", 35.6127, -77.3664),
]


def latest_safe_cycle(now: datetime | None = None) -> datetime:
    """Choose a recent 00/06/12/18Z cycle with a buffer for GFS availability."""
    now = (now or datetime.now(timezone.utc)) - timedelta(hours=6)
    hour = (now.hour // 6) * 6
    return now.replace(hour=hour, minute=0, second=0, microsecond=0)


def parse_cycle(value: str | None) -> datetime:
    if not value:
        return latest_safe_cycle()
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_point(value: str) -> tuple[str, float, float]:
    try:
        name, lat, lon = value.rsplit(",", 2)
        latitude, longitude = float(lat), float(lon)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("point must be NAME,LAT,LON") from exc
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise argparse.ArgumentTypeError("point coordinates are out of range")
    return name.strip(), latitude, longitude


def nearest_index(values: np.ndarray, target: float) -> int:
    return int(np.abs(np.asarray(values, dtype=float) - target).argmin())


def lead_hours(value: np.timedelta64) -> int:
    return int(value / np.timedelta64(1, "h"))


def scalar(array, step: int, lat_index: int, lon_index: int) -> float | None:
    value = float(np.asarray(array[0, step, lat_index, lon_index]))
    return value if math.isfinite(value) else None


def f_from_k(value: float | None) -> float | None:
    return None if value is None else (value - 273.15) * 9 / 5 + 32


def mph_from_ms(u: float | None, v: float | None) -> float | None:
    return None if u is None or v is None else math.hypot(u, v) * 2.2369362921


def inches_from_meters(value: float | None) -> float | None:
    return None if value is None else max(0.0, value) * 39.3700787402


def rounded(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def build_feed(io: ZarrBackend, cycle: datetime, points: list[tuple[str, float, float]]) -> dict:
    latitudes = np.asarray(io["lat"][:], dtype=float)
    longitudes = np.asarray(io["lon"][:], dtype=float)
    leads = np.asarray(io["lead_time"][:])

    output_points = []
    for name, latitude, longitude in points:
        model_lon = longitude % 360
        lat_i = nearest_index(latitudes, latitude)
        lon_i = nearest_index(longitudes, model_lon)
        windows = []
        for step, lead in enumerate(leads):
            hours = lead_hours(lead)
            if hours <= 0:
                continue
            t2m = scalar(io["t2m"], step, lat_i, lon_i)
            u10m = scalar(io["u10m"], step, lat_i, lon_i)
            v10m = scalar(io["v10m"], step, lat_i, lon_i)
            tp06 = scalar(io["tp06"], step, lat_i, lon_i)
            end = cycle + timedelta(hours=hours)
            start = end - timedelta(hours=6)
            windows.append(
                {
                    "start": start.isoformat().replace("+00:00", "Z"),
                    "end": end.isoformat().replace("+00:00", "Z"),
                    "precipitationInches": rounded(inches_from_meters(tp06), 4),
                    "temperatureF": rounded(f_from_k(t2m), 1),
                    "windMph": rounded(mph_from_ms(u10m, v10m), 1),
                }
            )
        output_points.append(
            {
                "name": name,
                "latitude": latitude,
                "longitude": longitude,
                "gridLatitude": float(latitudes[lat_i]),
                "gridLongitude": float(longitudes[lon_i]),
                "windows": windows,
            }
        )

    valid_until = cycle + timedelta(hours=STEPS * 6)
    return {
        "schema": "weather-nourie-graphcast-v1",
        "model": "graphcast-operational",
        "displayName": "GraphCast Operational / WeatherNext 1-Graph",
        "runAt": cycle.isoformat().replace("+00:00", "Z"),
        "validUntil": valid_until.isoformat().replace("+00:00", "Z"),
        "resolution": "0.25 degree",
        "timeStepHours": 6,
        "comparisonOnly": True,
        "precipitationUnits": "inch per 6-hour window",
        "temperatureUnits": "degF",
        "windUnits": "mph",
        "points": output_points,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cycle", help="UTC initial time, for example 2026-09-13T00:00:00Z")
    parser.add_argument("--steps", type=int, default=STEPS, help="6-hour forecast steps; default 28 = 7 days")
    parser.add_argument("--zarr", default="outputs/graphcast.zarr")
    parser.add_argument("--output", default="outputs/graphcast.json")
    parser.add_argument("--point", action="append", type=parse_point, help="NAME,LAT,LON; may be repeated")
    args = parser.parse_args()

    if args.steps < 1 or args.steps > 40:
        parser.error("--steps must be between 1 and 40")

    cycle = parse_cycle(args.cycle)
    points = args.point or DEFAULT_POINTS
    zarr_path = Path(args.zarr)
    output_path = Path(args.output)
    zarr_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    package = GraphCastOperational.load_default_package()
    model = GraphCastOperational.load_model(package)
    data = GFS()
    io = ZarrBackend(str(zarr_path), backend_kwargs={"overwrite": True})
    output_coords = OrderedDict({"variable": VARIABLES})
    run(
        [cycle.isoformat().replace("+00:00", "Z")],
        args.steps,
        model,
        data,
        io,
        output_coords=output_coords,
    )

    feed = build_feed(io, cycle, points)
    feed["validUntil"] = (cycle + timedelta(hours=args.steps * 6)).isoformat().replace("+00:00", "Z")
    output_path.write_text(json.dumps(feed, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {output_path} with {len(feed['points'])} locations and {args.steps} GraphCast steps")


if __name__ == "__main__":
    main()
