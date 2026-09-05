"""Fetch selected GRIB2 messages from NOAA/ECMWF's own public cloud copies.
No Open-Meteo, web-page scraping, service keys, or forecast invented by an LLM.
Point values use native grid cells. Maps are nearest-cell Web Mercator resamples.
Accumulation intervals and actual model run timestamps are retained.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import time
from typing import Any

UTC = dt.timezone.utc
SCHEMA = "weather-fusion-direct-v2"
POINTS = [
    {"id": "knightdale", "name": "Knightdale / Raleigh", "latitude": 35.787, "longitude": -78.4806},
    {"id": "greenville", "name": "Greenville, NC", "latitude": 35.6127, "longitude": -77.3664},
]
BOUNDS = [[32.5, -85.0], [38.0, -74.0]]
WIDTH, HEIGHT = 440, 280
SOURCES = {
    "hrrr": {"label": "NOAA HRRR", "resolution": "3 km native grid", "hours": 48, "url": "https://www.nco.ncep.noaa.gov/pmb/products/hrrr/"},
    "nbm": {"label": "NOAA National Blend", "resolution": "2.5 km native grid", "hours": 192, "url": "https://www.nco.ncep.noaa.gov/pmb/products/blend/"},
    "ecmwf": {"label": "ECMWF IFS", "resolution": "0.25° Open Data grid", "hours": 192, "url": "https://www.ecmwf.int/en/forecasts/datasets/open-data"},
}
NOAA_FIELDS = {
    "hrrr": {("TMP", "2 m above ground"): "temperature", ("DPT", "2 m above ground"): "dewpoint", ("APCP", "surface"): "precipitation", ("REFC", "entire atmosphere"): "reflectivity", ("GUST", "surface"): "gust", ("VIS", "surface"): "visibility"},
    "nbm": {("TMP", "2 m above ground"): "temperature", ("APCP", "surface"): "precipitation"},
}
ECMWF_FIELDS = {"2t": "temperature", "2d": "dewpoint", "10u": "u", "10v": "v", "tp": "precipitation", "tcc": "clouds", "msl": "pressure_msl"}

def iso(value: dt.datetime | float) -> str:
    if isinstance(value, (float, int)):
        value = dt.datetime.fromtimestamp(value, UTC)
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")

def urls(model: str, run: dt.datetime, hour: int) -> tuple[str, str]:
    date, cycle = run.strftime("%Y%m%d"), run.strftime("%H")
    if model == "hrrr":
        url = f"https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.{date}/conus/hrrr.t{cycle}z.wrfsfcf{hour:02d}.grib2"
        return url, url + ".idx"
    if model == "nbm":
        url = f"https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.{date}/{cycle}/core/blend.t{cycle}z.core.f{hour:03d}.co.grib2"
        return url, url + ".idx"
    url = f"https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/{date}/{cycle}z/ifs/0p25/oper/{date}{cycle}0000-{hour}h-oper-fc.grib2"
    return url, url[:-6] + ".index"

def parse_index(model: str, text: str) -> list[dict[str, Any]]:
    if model == "ecmwf":
        rows = [json.loads(line) for line in text.splitlines() if line.startswith("{")]
        return [{"field": ECMWF_FIELDS[r["param"]], "offset": int(r["_offset"]), "length": int(r["_length"]), "inventory": r} for r in rows if r.get("param") in ECMWF_FIELDS and r.get("levtype") == "sfc" and r.get("type") == "fc"]
    rows = [line.split(":") for line in text.splitlines() if re.match(r"^\d+:\d+:", line)]
    selected: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(rows[:-1]):
        if len(row) < 6 or any(part.strip() for part in row[6:]):
            continue
        field = NOAA_FIELDS[model].get((row[3], row[4]))
        if not field:
            continue
        interval = re.search(r"(\d+)-(\d+) hour acc fcst", row[5])
        duration = int(interval[2]) - int(interval[1]) if interval else 10**6
        entry = {"field": field, "offset": int(row[1]), "length": int(rows[i+1][1]) - int(row[1]), "duration": duration, "inventory": ":".join(row)}
        if field not in selected or duration < selected[field]["duration"]:
            selected[field] = entry
    return list(selected.values())

def deaccumulate(records: list[dict[str, Any]], cumulative: bool) -> list[dict[str, Any]]:
    """Convert same-run totals/native amounts to nonoverlapping intervals.
    Gaps remain gaps; cycles are never subtracted from each other.
    """
    records = sorted(records, key=lambda r: (r["end"], r["start"]))
    output: list[dict[str, Any]] = []
    if cumulative:
        previous = None
        for r in records:
            if previous is not None and r["start"] == previous["start"]:
                delta = r["value"] - previous["value"]
                if delta >= -0.0005 and r["end"] > previous["end"]:
                    output.append({"start": previous["end"], "end": r["end"], "value": max(0.0, delta)})
            elif r["end"] > r["start"]:
                output.append(dict(r))
            previous = r
        return output
    cursor = -math.inf
    for r in records:
        if r["end"] <= r["start"] or r["start"] < cursor:
            continue
        output.append(dict(r))
        cursor = r["end"]
    return output

def make_hourly(native: list[dict[str, Any]], intervals: list[dict[str, Any]]) -> dict[str, Any]:
    """Linear interpolation <=6h; QPF uniform inside native intervals only.
    Native intervals are retained separately. Reflectivity is not interpolated.
    """
    rows = sorted(native, key=lambda r: r["time"])
    if not rows:
        raise ValueError("No native model values")
    times = list(range(int(rows[0]["time"]), int(rows[-1]["time"]) + 1, 3600))
    hourly: dict[str, list[Any]] = {"time": times}
    aliases = {"temperature": "temperature_2m", "dewpoint": "dew_point_2m", "gust": "wind_gusts_10m", "wind": "wind_speed_10m", "humidity": "relative_humidity_2m", "clouds": "cloud_cover", "reflectivity": "reflectivity", "nearbyReflectivity": "nearby_reflectivity", "visibility": "visibility", "pressure_msl": "pressure_msl"}
    for key, alias in aliases.items():
        samples = [r for r in rows if isinstance(r.get(key), (float, int)) and math.isfinite(r[key])]
        data = []
        j = 0
        for stamp in times:
            while j + 1 < len(samples) and samples[j + 1]["time"] <= stamp:
                j += 1
            left = samples[j] if samples else None
            right = samples[j + 1] if j + 1 < len(samples) else None
            value = None
            if left and left["time"] == stamp:
                value = left[key]
            elif key not in ["reflectivity", "nearbyReflectivity"] and left and right and left["time"] < stamp < right["time"] and right["time"] - left["time"] <= 6 * 3600:
                f = (stamp - left["time"]) / (right["time"] - left["time"])
                value = left[key] * (1-f) + right[key] * f
            data.append(round(value, 3) if value is not None else None)
        hourly[alias] = data
    hourly["precipitation"] = []
    for stamp in times:
        interval = next((r for r in intervals if r["start"] < stamp <= r["end"] and stamp-3600 >= r["start"]), None)
        hourly["precipitation"].append(round(interval["value"] * 3600/(interval["end"]-interval["start"]), 6) if interval else None)
    return {"hourly": hourly, "hourly_units": {"time": "unixtime", "temperature_2m": "°F", "dew_point_2m": "°F", "precipitation": "inch", "wind_speed_10m": "mp/h", "wind_gusts_10m": "mp/h", "relative_humidity_2m": "%", "cloud_cover": "%", "reflectivity": "dBZ", "nearby_reflectivity": "dBZ", "visibility": "mi", "pressure_msl": "inHg"}}

def collect_model(model: str, output: str) -> dict[str, Any]:
    import requests
    import numpy as np
    import eccodes as ec
    from PIL import Image
    from scipy.spatial import cKDTree
    out = Path(output)
    out.joinpath("models").mkdir(parents=True, exist_ok=True)
    out.joinpath("maps").mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = "Sun-Nourie-WeatherFusion/2.0 (https://github.com/nourie42/Sun-Nourie)"
    def get(url: str, *, byte_range: tuple[int, int] | None = None, retries: int = 2) -> bytes:
        headers = {"Range": f"bytes={byte_range[0]}-{byte_range[1]}"} if byte_range else {}
        for attempt in range(retries + 1):
            try:
                with session.get(url, headers=headers, timeout=(10, 45), stream=True, allow_redirects=False) as response:
                    expected = byte_range[1] - byte_range[0] + 1 if byte_range else None
                    limit = expected or 1_000_000
                    if response.status_code not in ([206] if byte_range else [200]):
                        response.raise_for_status()
                        raise ValueError(f"Unexpected HTTP {response.status_code}")
                    if byte_range and not str(response.headers.get("Content-Range", "")).startswith(f"bytes {byte_range[0]}-{byte_range[1]}/"):
                        raise ValueError("Provider did not return the requested byte range")
                    chunks, size = [], 0
                    for chunk in response.iter_content(65536):
                        size += len(chunk)
                        if size > limit:
                            raise ValueError("Provider response exceeded expected size")
                        chunks.append(chunk)
                    data = b"".join(chunks)
                    if expected and len(data) != expected:
                        raise ValueError("Incomplete GRIB message")
                    return data
            except Exception:
                if attempt == retries:
                    raise
                time.sleep(1 + attempt)
        raise AssertionError("unreachable")
    now = dt.datetime.now(UTC)
    run = None
    for back in range(1, 31):
        candidate = (now-dt.timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
        if model == "hrrr" and candidate.hour % 6:
            continue
        if model == "ecmwf" and candidate.hour not in [0, 12]:
            continue
        _, index = urls(model, candidate, SOURCES[model]["hours"])
        try:
            entries = parse_index(model, get(index, retries=0).decode())
            if any(r["field"] == "temperature" for r in entries):
                run = candidate
                break
        except Exception:
            pass
    if run is None:
        raise RuntimeError(f"No complete recent {model} run found")
    target = out / "models" / f"{model}.json"
    if target.exists():
        old = json.loads(target.read_text())
        if old.get("runAt") == iso(run) and old.get("schema") == SCHEMA and old.get("complete") and old.get("cardFieldsVersion") == 1:
            print(f"REUSE {model} run={iso(run)} (no needless GRIB downloads)", flush=True)
            return {"model": model, "runAt": iso(run), "reused": True}
    print(f"COLLECT {model} run={iso(run)}", flush=True)
    steps = list(range(49)) if model == "hrrr" else list(range(1,37)) + list(range(42,193,6)) if model == "nbm" else list(range(0,145,3)) + list(range(150,193,6))
    run_epoch = int(run.timestamp())
    geometry: dict[str, Any] = {}
    points = {p["id"]: {**p, "native": [], "precipitationIntervals": [], "gridPoint": None} for p in POINTS}
    maps: dict[str, list[Any]] = {}
    provenance = []
    errors = []
    def safe_get(g, key, default=None):
        try:
            return ec.codes_get(g, key)
        except Exception:
            return default
    def grid_info(g):
        key = safe_get(g, "md5GridSection") or str(safe_get(g, "numberOfPoints"))
        if key in geometry:
            return geometry[key]
        lat = ec.codes_get_array(g, "latitudes")
        lon = (ec.codes_get_array(g, "longitudes") + 180) % 360 - 180
        point_indices, neighborhoods, point_meta = {}, {}, {}
        for p in POINTS:
            distance = (lat-p["latitude"])**2 + ((lon-p["longitude"])*math.cos(math.radians(p["latitude"])))**2
            nearest = int(np.argmin(distance))
            point_indices[p["id"]] = nearest
            neighborhoods[p["id"]] = np.where(distance <= (25/111.2)**2)[0]
            point_meta[p["id"]] = {"latitude": round(float(lat[nearest]),6), "longitude": round(float(lon[nearest]),6), "distanceKm": round(float(math.sqrt(distance[nearest])*111.2),2)}
        mask = (lat >= BOUNDS[0][0]-.5) & (lat <= BOUNDS[1][0]+.5) & (lon >= BOUNDS[0][1]-.5) & (lon <= BOUNDS[1][1]+.5)
        regional = np.where(mask)[0]
        if not len(regional):
            raise ValueError("Native grid does not cover the configured map region")
        y0, y1 = [np.arcsinh(np.tan(np.radians(v))) for v in [BOUNDS[1][0], BOUNDS[0][0]]]
        target_lat = np.degrees(np.arctan(np.sinh(np.linspace(y0,y1,HEIGHT))))
        target_lon = np.linspace(BOUNDS[0][1],BOUNDS[1][1],WIDTH)
        xx, yy = np.meshgrid(target_lon, target_lat)
        scale = math.cos(math.radians(35))
        tree = cKDTree(np.column_stack((lon[regional]*scale,lat[regional])))
        _, nearest_map = tree.query(np.column_stack((xx.ravel()*scale,yy.ravel())))
        result = {"point":point_indices,"neighborhood":neighborhoods,"pointMeta":point_meta,"map":regional[nearest_map],"size":len(lat)}
        geometry[key] = result
        return result
    def converted(values, field, units):
        data = np.asarray(values, dtype=float).copy()
        data[~np.isfinite(data) | (np.abs(data) > 1e10)] = np.nan
        if field in ["temperature","dewpoint"]:
            if units != "K": raise ValueError(f"Unexpected temperature units: {units}")
            data = (data - 273.15) * 1.8 + 32
            data[(data < -160) | (data > 160)] = np.nan
        elif field == "visibility":
            if units != "m": raise ValueError(f"Unexpected visibility units: {units}")
            data /= 1609.344
            data[(data < 0) | (data > 200)] = np.nan
        elif field == "pressure_msl":
            if units != "Pa": raise ValueError(f"Unexpected pressure units: {units}")
            data /= 3386.389
            data[(data < 20) | (data > 35)] = np.nan
        elif field == "precipitation":
            if units == "m": data *= 1000/25.4
            elif units in ["kg m**-2", "kg m-2", "mm", "kg m^-2"]: data /= 25.4
            else: raise ValueError(f"Unexpected precipitation units: {units}")
            data[(data < -0.0005) | (data > 200)] = np.nan
            data = np.maximum(0,data)
        elif field in ["gust","u","v"]:
            if units not in ["m s**-1", "m s-1", "m/s", "m s^-1"]: raise ValueError(f"Unexpected wind units: {units}")
            data *= 2.2369362921
        elif field == "clouds":
            if units in ["(0 - 1)", "1", "Proportion"]: data *= 100
            elif units != "%": raise ValueError(f"Unexpected cloud units: {units}")
            data = np.clip(data,0,100)
        elif field == "reflectivity":
            if units.lower() not in ["db", "dbz"]: raise ValueError(f"Unexpected reflectivity units: {units}")
        return data
    def save_map(layer, field, values, ginfo, stamp, start, end, hour):
        if stamp < now.timestamp()-3*3600:
            return
        if model == "hrrr" and hour > 24 and hour % 3:
            return
        if model == "ecmwf" and hour % 6:
            return
        if model == "nbm" and hour % 6:
            return
        palette = {
          "reflectivity": ([5,15,25,35,45,55,65],[(0,0,0,0),(77,184,231,125),(50,190,111,155),(38,156,55,170),(245,226,61,180),(243,143,37,190),(232,55,59,210),(212,86,206,220)]),
          "precipitation": ([.005,.05,.1,.25,.5,1,2,4],[(0,0,0,0),(88,181,235,100),(73,162,231,130),(55,181,161,150),(90,193,85,170),(231,215,75,185),(237,145,74,200),(211,84,127,215),(170,104,222,230)]),
          "temperature": ([20,32,45,60,75,85,95,105],[(122,139,222,165),(97,171,227,155),(97,196,217,150),(89,184,166,140),(177,200,113,140),(235,206,98,160),(239,163,88,165),(238,112,83,175),(215,78,102,185)]),
          "wind": ([5,10,15,20,30,40,60],[(127,175,215,65),(76,180,195,95),(65,174,160,125),(138,187,106,155),(224,192,91,175),(229,142,81,195),(212,97,119,205),(167,104,210,220)]),
          "clouds": ([10,25,50,75,90],[(0,0,0,0),(202,216,235,45),(204,216,233,80),(207,220,239,120),(216,226,242,160),(228,237,249,195)]),
        }
        thresholds, colors = palette[field]
        sample = values[ginfo["map"]].reshape((HEIGHT,WIDTH))
        indices = np.digitize(np.nan_to_num(sample,nan=-999),thresholds)
        rgba = np.asarray(colors,dtype=np.uint8)[indices]
        rgba[~np.isfinite(sample)] = 0
        filename = f"maps/{model}-{run.strftime('%Y%m%d%H')}-{field}-{hour:03d}.png"
        Image.fromarray(rgba).save(out / filename, optimize=True)
        maps.setdefault(layer, []).append({"file":filename,"time":iso(stamp),"start":iso(start),"end":iso(end),"hour":hour,"bounds":BOUNDS,"field":field,"units":"dBZ" if field=="reflectivity" else "in" if field=="precipitation" else "°F" if field=="temperature" else "mph" if field=="wind" else "%"})
    for step in steps:
        url, index = urls(model, run, step)
        try:
            entries = parse_index(model, get(index).decode())
            if not any(e["field"] == "temperature" for e in entries):
                raise ValueError("Temperature message missing from native inventory")
            native = {p["id"]:{"time":run_epoch+step*3600} for p in POINTS}
            components = {}
            for entry in entries:
                field, offset, length = entry["field"],entry["offset"],entry["length"]
                if not 1 <= length <= 20_000_000:
                    raise ValueError("Unexpected GRIB message size")
                body = get(url,byte_range=(offset,offset+length-1))
                if not body.startswith(b"GRIB") or not body.endswith(b"7777"):
                    raise ValueError("Invalid GRIB framing")
                g = ec.codes_new_from_message(body)
                try:
                    if int(ec.codes_get(g,"dataDate")) != int(run.strftime("%Y%m%d")) or int(ec.codes_get(g,"dataTime")) != run.hour*100:
                        raise ValueError("Mixed model initialization times")
                    ec.codes_set(g,"stepUnits",1)
                    a,b = float(ec.codes_get(g,"startStep")),float(ec.codes_get(g,"endStep"))
                    if b != step:
                        raise ValueError("GRIB valid time does not match requested forecast hour")
                    info = grid_info(g)
                    vals = converted(ec.codes_get_values(g),field,ec.codes_get(g,"units"))
                    if int(safe_get(g,"bitmapPresent",0)):
                        bitmap = ec.codes_get_array(g,"bitmap")
                        vals[bitmap == 0] = np.nan
                    for p in POINTS:
                        value = float(vals[info["point"][p["id"]]])
                        if not math.isfinite(value):
                            continue
                        points[p["id"]]["gridPoint"] = info["pointMeta"][p["id"]]
                        if field == "precipitation":
                            points[p["id"]]["precipitationIntervals"].append({"start":run_epoch+a*3600,"end":run_epoch+b*3600,"value":value})
                        else:
                            native[p["id"]][field] = value
                        if field == "reflectivity":
                            nearby = vals[info["neighborhood"][p["id"]]]
                            if np.isfinite(nearby).any(): native[p["id"]]["nearbyReflectivity"] = float(np.nanmax(nearby))
                    start,end = run_epoch+a*3600,run_epoch+b*3600
                    if field == "reflectivity":save_map("hrrr",field,vals,info,end,start,end,step)
                    if field == "precipitation" and model in ["ecmwf","nbm"]:save_map(model,field,vals,info,end,start,end,step)
                    if model == "ecmwf" and field in ["temperature","clouds"]:save_map(field,field,vals,info,end,start,end,step)
                    if field in ["u","v"]:components[field] = vals
                    if all(k in components for k in ["u","v"]):
                        speed = np.hypot(components["u"],components["v"])
                        for p in POINTS:
                            value = float(speed[info["point"][p["id"]]])
                            if math.isfinite(value):native[p["id"]]["wind"] = value
                        save_map("wind","wind",speed,info,end,start,end,step)
                        components.clear()
                    provenance.append({"url":url,"field":field,"hour":step,"startStep":a,"endStep":b,"sha256":hashlib.sha256(body).hexdigest()})
                finally:
                    ec.codes_release(g)
            for p in POINTS:
                row=native[p["id"]]
                if "temperature" in row and "dewpoint" in row:
                    t,d=(row["temperature"]-32)/1.8,(row["dewpoint"]-32)/1.8
                    row["humidity"]=min(100,max(0,100*math.exp(17.625*d/(243.04+d)-17.625*t/(243.04+t))))
                points[p["id"]]["native"].append(row)
            if step%12==0:print(f"{model} FH{step:03d} decoded",flush=True)
        except Exception as error:
            errors.append(f"FH{step:03d}: {type(error).__name__}: {str(error)[:140]}")
            print(f"{model} {errors[-1]}",flush=True)
    if errors:
        raise RuntimeError(f"{model} collection incomplete: {'; '.join(errors[:4])}")
    for p in points.values():
        p["precipitationIntervals"] = deaccumulate(p["precipitationIntervals"],model=="ecmwf")
        p.update(make_hourly(p["native"],p["precipitationIntervals"]))
        future=[r for r in p["native"] if r["time"] > now.timestamp()]
        if len(future)<12 or not any(r["value"]>=0 and r["end"]>now.timestamp() for r in p["precipitationIntervals"]):
            raise ValueError(f"{model} insufficient future numerical coverage")
    data = {"schema":SCHEMA,"model":model,"label":SOURCES[model]["label"],"resolution":SOURCES[model]["resolution"],"runAt":iso(run),"generatedAt":iso(dt.datetime.now(UTC)),"validUntil":iso(run+dt.timedelta(hours=SOURCES[model]["hours"])),"complete":True,"sourceUrl":SOURCES[model]["url"],"transport":"Official provider public-cloud copy; indexed GRIB2 byte-range extraction with ECMWF ecCodes","interpolation":"Native nearest-gridpoint data. Temperature and wind are linearly interpolated only between samples <=6h apart; precipitation is uniformly allocated within its native accumulation interval. Reflectivity is never time-interpolated.","cyclePolicy":"Latest fully published extended run (HRRR 00/06/12/18Z; IFS 00/12Z; NBM hourly).","cardFieldsVersion":1,"points":list(points.values()),"maps":maps,"provenance":provenance}
    target.write_text(json.dumps(data,separators=(",",":"),allow_nan=False))
    print(f"SUCCESS {model} run={data['runAt']} points={len(points)} messages={len(provenance)} frames={sum(map(len,maps.values()))}",flush=True)
    return {"model":model,"runAt":data["runAt"],"messages":len(provenance),"complete":True}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    results=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=3) as executor:
        tasks={executor.submit(collect_model,m,str(out)):m for m in SOURCES}
        for task in concurrent.futures.as_completed(tasks):
            try:results.append(task.result())
            except Exception as e:results.append({"model":tasks[task],"error":str(e)[:600]});print('MODEL ERROR',tasks[task],str(e),flush=True)
    manifest={"schema":SCHEMA,"generatedAt":iso(dt.datetime.now(UTC)),"models":[],"google":{"status":"access-required","label":"Google WeatherNext","message":"Not contributing: Google-approved WeatherNext data access is required. Gemini is not a numerical weather model.","url":"https://developers.google.com/weathernext/guides/access-forecast"}}
    referenced=set()
    for m in SOURCES:
        path=out/"models"/f"{m}.json"
        if not path.exists():continue
        data=json.loads(path.read_text())
        entry={k:data[k] for k in ["model","label","resolution","runAt","generatedAt","validUntil","sourceUrl","maps","cyclePolicy"]}
        manifest["models"].append(entry)
        for frames in data["maps"].values():referenced.update(f["file"] for f in frames)
    for path in (out/"maps").glob('*.png'):
        if str(path.relative_to(out)) not in referenced:path.unlink()
    (out/"manifest.json").write_text(json.dumps(manifest,separators=(",",":"),allow_nan=False))
    (out/"collection-status.json").write_text(json.dumps({"checkedAt":iso(dt.datetime.now(UTC)),"results":results},indent=2))
    print(json.dumps({"collected":results,"manifestModels":len(manifest['models'])},indent=2),flush=True)
    if any("error" in r for r in results):raise SystemExit(1)

if __name__=="__main__":main()
