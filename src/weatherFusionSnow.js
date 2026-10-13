// Snow outlook: NWS gridpoint snowfall + NWS wording/PoP, Open-Meteo ECMWF/GFS model snowfall,
// WPC WSSI (from riskOutlooks) and WPC probabilistic winter precipitation (days 1-3).
// Never invents numbers: missing sources stay null and are labelled "not available".
export const SNOW_VERSION = 'snow-outlook-v1';
const MM_PER_IN = 25.4, CM_PER_IN = 2.54, HOUR = 3600000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d = 1) => finite(v) ? Number(v.toFixed(d)) : null;
const SNOW_WORDS = /snow|flurr|sleet|wintry|blizzard|ice pellets/i;
const dateKey = (t, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

export function snowModelsUrl(location, zone) {
  return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude),
    daily: 'snowfall_sum', models: 'ecmwf_ifs025,gfs_seamless', timezone: zone || 'auto', forecast_days: '10' })}`;
}
export function normalizeSnowModels(d) {
  const daily = d?.daily; if (!daily?.time) return null;
  const pick = (key) => (daily[key] || []).map((v) => finite(v) ? v / CM_PER_IN : null);
  return { source: 'Open-Meteo', unit: 'in (converted from cm)', time: daily.time, ecmwf: pick('snowfall_sum_ecmwf_ifs025'), gfs: pick('snowfall_sum_gfs_seamless') };
}
const durationHours = (iso) => { const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?/); return m ? (Number(m[1] || 0) * 24 + Number(m[2] || 0)) || 1 : 1; };
/** NWS gridpoint snowfallAmount (mm per interval) split evenly over its hours. */
export function gridSnowHours(grid) {
  const sf = grid?.snowfallAmount, out = [];
  if (!sf?.values) return null;
  const mm = !sf.uom || /mm/.test(sf.uom);
  for (const v of sf.values) {
    const [start, dur] = String(v.validTime || '').split('/'), t = Date.parse(start), n = durationHours(dur);
    if (!finite(t) || !finite(v.value)) continue;
    const inches = (mm ? v.value / MM_PER_IN : v.value) / n;
    for (let i = 0; i < n; i++) out.push({ time: t + i * HOUR, inches });
  }
  return out;
}
const WPC_ROOT = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_prob_winter_precip/MapServer';
const WPC_LAYERS = [[1, 1, 4], [2, 1, 8], [3, 1, 12], [6, 2, 4], [7, 2, 8], [8, 2, 12], [11, 3, 4], [12, 3, 8], [13, 3, 12]];
export function createWpcWinterService({ cached }) {
  return async (location) => {
    const meta = { id: 'wpc-winter', label: 'WPC probabilistic winter precipitation', status: 'unavailable', fetchedAt: null, url: 'https://www.wpc.ncep.noaa.gov/pwpf/wwd_prob_guidance.php' };
    try {
      const rows = await Promise.all(WPC_LAYERS.map(async ([layer, day, inches]) => {
        const q = new URLSearchParams({ f: 'json', where: '1=1', geometry: `${location.longitude},${location.latitude}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'outlook,dn,start_time,end_time,issue_time', returnGeometry: 'false' });
        const r = await cached(`${WPC_ROOT}/${layer}/query?${q}`, 30 * 60000, { timeout: 12000 });
        if (!Array.isArray(r.data?.features) || r.data?.error) throw new Error('WPC winter unavailable');
        const best = r.data.features.map((f) => f.attributes).sort((a, b) => (b.dn || 0) - (a.dn || 0))[0];
        return { day, inches, category: best?.outlook || null, start: best?.start_time ? best.start_time.replace(' ', 'T') + 'Z' : null, end: best?.end_time ? best.end_time.replace(' ', 'T') + 'Z' : null, issued: best?.issue_time || null };
      }));
      return { value: rows, meta: { ...meta, status: 'ready', fetchedAt: new Date().toISOString() } };
    } catch { return { value: null, meta: { ...meta, message: 'WPC winter probabilities could not be checked.' } }; }
  };
}

export function addSnowOutlook(output, { grid, periods = [], snowModels, wpcWinter, now = Date.now() }) {
  const zone = output.location?.timeZone || 'America/New_York';
  const days = (output.days || []).slice(0, 7).filter((d) => d.date);
  const gridHours = gridSnowHours(grid);
  const gridEnd = gridHours?.length ? Math.max(...gridHours.map((h) => h.time)) + HOUR : null;
  // hourly snowfall on hour rows (NWS grid only)
  if (gridHours) for (const h of output.hours || []) {
    const t = Date.parse(h.time), m = gridHours.find((g) => g.time === t);
    h.snowfall = m ? round(m.inches, 2) : null;
  }
  const wssi = (output.riskOutlooks || []).find((r) => r.kind === 'wssi') || null;
  const rows = days.map((d, i) => {
    const ps = periods.filter((p) => dateKey(Date.parse(p.startTime), zone) === d.date);
    const per = ps.map((p) => ({ name: p.name, isDaytime: p.isDaytime, wording: p.shortForecast || '', snowWording: SNOW_WORDS.test(`${p.shortForecast} ${p.detailedForecast}`),
      pop: finite(p.probabilityOfPrecipitation?.value) ? p.probabilityOfPrecipitation.value : null }));
    const inDay = (t) => dateKey(t, zone) === d.date;
    const gh = gridHours ? gridHours.filter((g) => inDay(g.time)) : [];
    const nws = gh.length ? gh.reduce((a, g) => a + g.inches, 0) : null;
    const mi = snowModels?.time ? snowModels.time.indexOf(d.date) : -1;
    const ecmwf = mi >= 0 ? snowModels.ecmwf[mi] : null, gfs = mi >= 0 ? snowModels.gfs[mi] : null;
    const vals = [nws, ecmwf, gfs].filter(finite), lo = vals.length ? Math.min(...vals) : null, hi = vals.length ? Math.max(...vals) : null;
    const wpc = (wpcWinter || []).filter((w) => w.category && finite(Date.parse(w.start)) && dateKey(Date.parse(w.start) + 12 * HOUR, zone) === d.date);
    const snowPop = per.filter((p) => p.snowWording && finite(p.pop)).reduce((m, p) => Math.max(m, p.pop), null);
    const possible = per.some((p) => p.snowWording) || (finite(hi) && hi >= 0.1) || wpc.length > 0;
    const far = i >= 3;
    return { date: d.date, label: d.label, index: i, periods: per.filter((p) => p.snowWording),
      nwsSnowPop: snowPop, nwsSnowfall: round(nws, 1), nwsCovered: finite(nws),
      models: { ecmwf: round(ecmwf, 1), gfs: round(gfs, 1) },
      range: vals.length > 1 && hi - lo >= 0.5 ? [round(lo, 1), round(hi, 1)] : null,
      best: finite(nws) ? round(nws, 1) : vals.length ? round((lo + hi) / 2, 1) : null,
      wpc: wpc.map((w) => ({ inches: w.inches, category: w.category })),
      possible, confidence: far ? (possible ? 'Low chance, far out' : 'Low confidence, far out') : 'Near term' };
  });
  const any = rows.some((r) => r.possible) || !!wssi;
  const sum = (key) => { const v = rows.map((r) => key(r)).filter(finite); return v.length ? round(v.reduce((a, b) => a + b, 0), 1) : null; };
  output.snow = { version: SNOW_VERSION, possible: any, days: rows, wssi,
    stormTotal: { nws: sum((r) => r.nwsSnowfall), ecmwf: sum((r) => r.models.ecmwf), gfs: sum((r) => r.models.gfs) },
    sources: { nwsGrid: !!gridHours, nwsGridThrough: gridEnd ? new Date(gridEnd).toISOString() : null, models: !!snowModels, wpcWinter: !!wpcWinter, nbm: false },
    notes: 'NWS gridpoint snowfall (mm→in); Open-Meteo ECMWF IFS / GFS daily snowfall (cm→in, model snow:liquid ratio); NWS precipitation chance shown only where NWS wording mentions snow. NBM snow probabilities are not available from this feed.' };
  for (const r of rows) {
    const d = output.days.find((x) => x.date === r.date); if (!d) continue;
    d.snowfall = r.best; d.snowRange = r.range; d.snowPossible = r.possible;
  }
  return output;
}
