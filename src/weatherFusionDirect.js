import {createHrrrMapSource} from './weatherFusionHrrrMap.js';
import {createPointModels} from './weatherFusionPointModels.js';
/** Direct, decoded NOAA/ECMWF model snapshots. No provider key and no webpage scraping. */
import {SAME_DAY_WEIGHTS,temperaturePolicy as tempPolicy,precipitationPolicy,forecastDayIndex,eveningPeriod,REPAIR_VERSION} from './weatherFusionPolicy.js';
import {shadeFeelsLike} from '../public/weather-fusion/weather-math.js';
import {forecastConfidence} from '../public/weather-fusion/forecast-confidence.js';
export const DATA_ROOT = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/';
export const DIRECT_SCHEMA = 'weather-fusion-direct-v2';
const H = 3600000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n, d = 2) => finite(n) ? Number(n.toFixed(d)) : null;
const iso = (t) => new Date(t).toISOString();
const LABELS = { hrrr: 'NOAA HRRR · 3 km', ecmwf: 'ECMWF IFS · 0.25° Open Data', nbm: 'NOAA National Blend · 2.5 km' };
const SOURCE = { hrrr: 'https://www.nco.ncep.noaa.gov/pmb/products/hrrr/', nbm: 'https://www.nco.ncep.noaa.gov/pmb/products/blend/', ecmwf: 'https://www.ecmwf.int/en/forecasts/datasets/open-data' };
const CONUS_MAP_BOUNDS = '[[20,-130],[55,-60]]';
const LEGACY_REGIONAL_MAP_BOUNDS = '[[32.5,-85],[38,-74]]';
export function modelStatus(model, runAt, validUntil, now = Date.now()) {
  const run = Date.parse(runAt), end = Date.parse(validUntil);
  if (!LABELS[model] || !finite(run) || !finite(end) || run > now + 15 * 60000 || end <= now) return 'unavailable';
  return now - run > (model === 'ecmwf' ? 30 : 12) * H ? 'stale' : 'ready';
}
export function validateSnapshot(data, id, location, now) {
  if (data?.schema !== DIRECT_SCHEMA || data.model !== id || data.complete !== true || !Array.isArray(data.points)) throw new Error('Model snapshot schema/identity is invalid.');
  const status = modelStatus(id, data.runAt, data.validUntil, now);
  if (status !== 'ready') return { value: null, status, message: 'The model run is too old or has expired; it is excluded from the forecast.' };
  const point = data.points.find((p) => Math.abs(p.latitude-location.latitude) < 0.0002 && Math.abs(p.longitude-location.longitude) < 0.0002);
  if (!point) return { status: 'not-covered', value: null, message: 'Direct model collection currently covers the two saved locations. This location uses NWS only.' };
  const h = point.hourly, u = point.hourly_units, run = Date.parse(data.runAt)/1000;
  if (!Array.isArray(h?.time) || h.time.length < 12 || h.time.length > 500 || u?.temperature_2m !== '°F' || u.precipitation !== 'inch' || u.wind_speed_10m !== 'mp/h') throw new Error('Invalid model units or time axis.');
  if (h.time.some((t,i) => !finite(t) || t < run || (i > 0 && t-h.time[i-1] !== 3600))) throw new Error('The model time axis is not a continuous hourly axis.');
  for (const [field, values] of Object.entries(h)) {
    if (!Array.isArray(values) || values.length !== h.time.length || values.some((v) => v !== null && !finite(v))) throw new Error(`Invalid model series: ${field}`);
  }
  if (!h.temperature_2m?.some((v,i) => finite(v) && h.time[i]*1000 > now)) throw new Error('No future native model temperatures.');
  const intervals = point.precipitationIntervals;
  if (!Array.isArray(intervals) || intervals.some((r,i) => !finite(r.start) || !finite(r.end) || !finite(r.value) || r.end <= r.start || r.value < 0 || r.value > 100 || r.start < run || (i>0 && r.start < intervals[i-1].end))) throw new Error('Invalid model precipitation intervals.');
  return { status, value: { ...point, direct: true, runAt: data.runAt, validUntil: data.validUntil, resolution: data.resolution, sourceUrl: SOURCE[id], interpolation: data.interpolation, timezone: 'America/New_York' }, message: `${data.resolution}; native grid extraction; initialized ${data.runAt}.` };
}
export function createDirectModels({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  const hourlyMap = createHrrrMapSource({fetchImpl,now});
  const pointModel = createPointModels({fetchImpl,now});
  async function resource(file) {
    if (!/^(manifest\.json|models\/(hrrr|ecmwf|nbm)\.json)$/.test(file)) throw new Error('Invalid weather data resource.');
    const hit = cache.get(file);
    if (hit?.until > now()) return hit.data;
    if (pending.has(file)) return pending.get(file);
    const task = (async () => {
      const response = await fetchImpl(DATA_ROOT + file, { headers: { Accept: 'application/json', 'User-Agent': 'Sun-Nourie-WeatherFusion/2.1', 'Cache-Control':'no-cache' }, cache:'no-store', redirect: 'error', signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw new Error(`Direct data request returned HTTP ${response.status}.`);
      if (Number(response.headers.get('content-length')) > 2500000) throw new Error('Model snapshot exceeds size limit.');
      const text = await response.text();
      if (Buffer.byteLength(text) > 2500000) throw new Error('Model snapshot exceeds size limit.');
      const data = JSON.parse(text);
      cache.set(file, { until: now()+60000, data });
      return data;
    })().finally(() => pending.delete(file));
    pending.set(file, task);
    return task;
  }
  async function load(id, location) {
    const meta = { id, label: LABELS[id], url: SOURCE[id], issuedAt: null, fetchedAt: iso(now()), transport: 'Native GRIB2 → verified snapshot', contributes: false };
    let pointFailure;
    try {
      const point=await pointModel(id,location),value={...point,hourly:{...point.hourly}};
      if(id==='hrrr')try{
        const native=validateSnapshot(await resource('models/hrrr.json'),id,location,now()).value;
        if(native){for(const field of ['reflectivity','nearby_reflectivity'])if(native.hourly[field])value.hourly[field]=value.hourly.time.map(t=>{const i=native.hourly.time.indexOf(t);return i>=0?native.hourly[field][i]:null;});value.reflectivityRunAt=native.runAt;}
      }catch{}
      return {value,meta:{...meta,status:'ready',label:`${id.toUpperCase()} · ${value.resolution}`,transport:value.transport,url:value.sourceUrl,issuedAt:value.runAt,fetchedAt:value.fetchedAt||null,checkedAt:value.checkedAt||null,retrievalStatus:value.retrievalStatus,validUntil:value.validUntil,resolution:value.resolution,contributes:true,message:value.refreshWarning||value.runScope,modelGrid:value.modelGrid}};
    }catch(error){pointFailure=String(error.message);}
    let nativeFailure;
    try {
      const data = await resource(`models/${id}.json`);
      const result = validateSnapshot(data, id, location, now());
      if(result.value)return { value: result.value, meta: { ...meta, status: result.status, issuedAt: data.runAt, validUntil: data.validUntil, resolution: data.resolution, message: result.message, contributes: true, snapshotUrl: DATA_ROOT+`models/${id}.json` } };
      nativeFailure=result.message;
    } catch (error) { nativeFailure=String(error.message); }
    return {value:null,meta:{...meta,status:'unavailable',message:`Location-specific model unavailable: ${pointFailure.slice(0,150)}`,nativeFailure}};
  }
  async function maps() {
    const [manifestResult,independent]=await Promise.allSettled([resource('manifest.json'),hourlyMap()]);
    const manifest=manifestResult.status==='fulfilled'?manifestResult.value:{schema:DIRECT_SCHEMA,models:[],generatedAt:null};
    if (manifest.schema !== DIRECT_SCHEMA || !Array.isArray(manifest.models)) throw new Error('Invalid model map manifest.');
    const layers = {};
    for (const model of manifest.models) {
      const status = modelStatus(model.model, model.runAt, model.validUntil, now());
      for (const [name, rawFrames] of Object.entries(model.maps || {})) {
        if (!['hrrr','ecmwf','nbm','temperature','wind','clouds'].includes(name) || !Array.isArray(rawFrames)) continue;
        const frames = status === 'ready' ? rawFrames.filter((f) => /^maps\/(hrrr|nbm|ecmwf)-\d{10}-(reflectivity|precipitation|temperature|wind|clouds)-\d{3}\.png$/.test(f.file) && f.file.startsWith(`maps/${model.model}-`) && finite(Date.parse(f.time)) && Date.parse(f.time) >= now()-3*H && Date.parse(f.time) <= Date.parse(model.validUntil) && [CONUS_MAP_BOUNDS,LEGACY_REGIONAL_MAP_BOUNDS].includes(JSON.stringify(f.bounds))).map((f) => ({ ...f, url: DATA_ROOT+f.file })) : [];
        const coverage=frames.some(f=>JSON.stringify(f.bounds)===CONUS_MAP_BOUNDS)?'Contiguous United States':'North Carolina and surrounding region';
        layers[name] = { model: model.model, label: model.label, resolution: model.resolution, coverage, runAt: model.runAt, status: frames.length ? status : 'unavailable', frames: frames.sort((a,b) => Date.parse(a.time)-Date.parse(b.time)), sourceUrl: SOURCE[model.model] };
      }
    }
    const live=independent.status==='fulfilled'?independent.value:null;
    if(live?.layer)layers.hrrr={...live.layer,sourceCheck:live.status};
    return { schema: DIRECT_SCHEMA, hrrrHourlySource:live?.status||'unavailable', checkedAt:iso(now()), generatedAt: manifest.generatedAt, layers, coverage: 'Contiguous United States on newly generated model maps', note: 'Model maps are not observed radar. HRRR uses independently refreshed, timestamp-pinned Iowa State low-level REFD tiles. ECMWF and NBM layers use decoded native CONUS snapshots; an older regional snapshot remains accepted only until its replacement finishes.' };
  }
  return { load, maps };
}
export function intervalTotal(intervals, start, end, precision = 4) {
  if (!(finite(start) && finite(end) && end > start)) return null;
  let cursor = start/1000, total = 0;
  const finish = end/1000;
  for (const r of intervals || []) {
    if (!(finite(r.start) && finite(r.end) && finite(r.value)) || r.end <= r.start || r.value < 0) return null;
    if (r.end <= cursor) continue;
    if (r.start > cursor + 0.001) return null;
    const b = Math.min(r.end, finish);
    total += r.value * (b-cursor)/(r.end-r.start);
    cursor = b;
    if (cursor >= finish-0.001) return round(total, precision);
  }
  return null;
}
export function weighted(values, policy) {
  const sources = Object.entries(policy).filter(([id,w]) => finite(values[id]) && w > 0).map(([id,weight]) => ({ id, weight, value: values[id] }));
  const sum = sources.reduce((n,s) => n+s.weight,0);
  return { value: sum ? round(sources.reduce((n,s) => n+s.value*s.weight,0)/sum,4) : null,
    sources: sources.map((s) => ({ ...s, weight: round(s.weight/sum,6) })), calibrated: false };
}
export const MEASURABLE_QPF_THRESHOLD_INCHES = .01;
export const ROLLING_QPF_FULL_SUPPORT_INCHES = .1;
export const TRACE_QPF_THRESHOLD_INCHES = MEASURABLE_QPF_THRESHOLD_INCHES;
export const TRACE_QPF_POINT_FRACTION = .3;
export function deterministicRainSignal(amount, windows = {}) {
  if (!finite(amount)) return null;
  if (amount <= 0) return 0;
  if (amount >= MEASURABLE_QPF_THRESHOLD_INCHES) return 100;
  if ((finite(windows.threeHour)&&windows.threeHour>=ROLLING_QPF_FULL_SUPPORT_INCHES)||
      (finite(windows.sixHour)&&windows.sixHour>=ROLLING_QPF_FULL_SUPPORT_INCHES)) return 100;
  return 100*TRACE_QPF_POINT_FRACTION;
}
export function precipitationLikelihood(nwsProbability, precipitationBlend, policy = SAME_DAY_WEIGHTS, sourceWindows = {}) {
  const amounts = precipitationBlend?.sourceValues || {};
  const nws=finite(nwsProbability)?Math.max(0,Math.min(100,nwsProbability)):null;
  const values = {
    nws,
    hrrr:deterministicRainSignal(amounts.hrrr,sourceWindows.hrrr),
    ecmwf:deterministicRainSignal(amounts.ecmwf,sourceWindows.ecmwf),
    nbm:deterministicRainSignal(amounts.nbm,sourceWindows.nbm)
  };
  const sourcePoints={
    nws:finite(nws)?round(nws*policy.nws,8):null,
    hrrr:finite(values.hrrr)?round(values.hrrr*policy.hrrr,8):null,
    ecmwf:finite(values.ecmwf)?round(values.ecmwf*policy.ecmwf,8):null,
    nbm:finite(values.nbm)?round(values.nbm*policy.nbm,8):null
  };
  const included=['nws','hrrr','ecmwf','nbm'].filter(id=>finite(sourcePoints[id]));
  const rawTotal=included.length?round(included.reduce((sum,id)=>sum+sourcePoints[id],0),8):null;
  const value=finite(rawTotal)?Math.min(100,Math.round(rawTotal)):null;
  const sourceAmounts=Object.fromEntries(['nws','hrrr','ecmwf','nbm'].map(id=>[id,finite(amounts[id])?amounts[id]:null]));
  const drySources=['hrrr','ecmwf','nbm'].filter(id=>values[id]===0);
  const wetSources=['hrrr','ecmwf','nbm'].filter(id=>finite(values[id])&&values[id]>0);
  const reducedSources=['hrrr','ecmwf','nbm'].filter(id=>values[id]===100*TRACE_QPF_POINT_FRACTION);
  const fullSources=['hrrr','ecmwf','nbm'].filter(id=>values[id]===100);
  const rollingFullSources=fullSources.filter(id=>finite(amounts[id])&&amounts[id]>0&&amounts[id]<MEASURABLE_QPF_THRESHOLD_INCHES&&
    ((finite(sourceWindows[id]?.threeHour)&&sourceWindows[id].threeHour>=ROLLING_QPF_FULL_SUPPORT_INCHES)||(finite(sourceWindows[id]?.sixHour)&&sourceWindows[id].sixHour>=ROLLING_QPF_FULL_SUPPORT_INCHES)));
  const sources=included.map(id=>({id,value:values[id],weight:policy[id],points:sourcePoints[id]}));
  return {value,rawValue:value,weightedValue:rawTotal,rawTotal,sourceValues:values,sourcePoints,
    sourceAmounts,sourceWindows,officialProbability:nws,drySources,wetSources,reducedSources,fullSources,rollingFullSources,sources,
    measurableQpfThresholdInches:MEASURABLE_QPF_THRESHOLD_INCHES,rollingQpfThresholdInches:ROLLING_QPF_FULL_SUPPORT_INCHES,
    reducedQpfThresholdInches:MEASURABLE_QPF_THRESHOLD_INCHES,reducedPointFraction:TRACE_QPF_POINT_FRACTION,
    source:'Weighted NWS probability plus measurable-rain model points',calibrated:false};
}
export function summarizeRainTimeline(timeline, start, end) {
  const window={start:finite(start)?iso(start):null,end:finite(end)?iso(end):null};
  const expected=finite(start)&&finite(end)&&end>start?(end-start)/H:0;
  let cursor=start,covered=0,peak=null;
  for(const row of [...(timeline||[])].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time))) {
    const a=Date.parse(row.time),b=Date.parse(row.end);
    if(!finite(a)||!finite(b)||b<=a||b<=start||a>=end)continue;
    const left=Math.max(start,a),right=Math.min(end,b);
    if(!finite(row.rainLikelihood?.value))continue;
    const span=Math.max(0,right-Math.max(cursor,left));
    if(!span)continue;
    covered+=span;cursor=right;
    if(!peak||row.rainLikelihood.value>peak.rainLikelihood.value)peak=row;
  }
  const complete=expected>0&&covered>=end-start;
  return {value:complete&&peak?peak.rainLikelihood.value:null,aggregation:'maximum-hourly',window,
    coverage:{expectedHours:round(expected,3),availableHours:round(covered/H,3),complete},
    peakTime:peak?.time||null,peakEnd:peak?.end||null,peak:peak?.rainLikelihood||null,
    availablePeak:peak?.rainLikelihood?.value??null,sources:peak?.rainLikelihood?.sources||[],calibrated:false,
    source:'Highest hourly Weather Nourie rain chance in this period'};
}
export function summarizePeriodRainTimeline(timeline, start, end, nwsProbability = null, policy = SAME_DAY_WEIGHTS) {
  const window={start:finite(start)?iso(start):null,end:finite(end)?iso(end):null};
  const expected=finite(start)&&finite(end)&&end>start?(end-start)/H:0;
  let cursor=start,covered=0,peak=null;
  const modelTotals={},modelCoverage={};
  const rows=[...(timeline||[])].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  for(const row of rows) {
    const a=Date.parse(row.time),b=Date.parse(row.end);
    if(!finite(a)||!finite(b)||b<=a||b<=start||a>=end)continue;
    const left=Math.max(start,a),right=Math.min(end,b),span=Math.max(0,right-left);
    if(!span)continue;
    if(finite(row.rainLikelihood?.value)) {
      const add=Math.max(0,right-Math.max(cursor,left));
      if(add){covered+=add;cursor=right;}
      if(!peak||row.rainLikelihood.value>peak.rainLikelihood.value)peak=row;
    }
    for(const id of ['hrrr','ecmwf','nbm']) {
      const amount=row.rainLikelihood?.sourceAmounts?.[id] ?? row.precipitationBlend?.sourceValues?.[id];
      if(!finite(amount))continue;
      modelTotals[id]=(modelTotals[id]||0)+amount*span/H;
      modelCoverage[id]=(modelCoverage[id]||0)+span;
    }
  }
  const complete=expected>0&&covered>=end-start;
  const official=finite(nwsProbability)?Math.max(0,Math.min(100,nwsProbability)):
    rows.filter(row=>Date.parse(row.time)<end&&Date.parse(row.end)>start&&finite(row.officialPop)).reduce((best,row)=>best===null?row.officialPop:Math.max(best,row.officialPop),null);
  const sourceValues={};
  for(const id of ['hrrr','ecmwf','nbm']) {
    const total=finite(modelTotals[id])?round(modelTotals[id],8):null,coverage=modelCoverage[id]||0;
    sourceValues[id]=total!==null&&total>0?total:coverage>=end-start?0:null;
  }
  const likelihood=precipitationLikelihood(official,{sourceValues},policy);
  const sourceCoverageHours=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>[id,round((modelCoverage[id]||0)/H,3)]));
  return {...likelihood,value:complete?likelihood.value:null,rawValue:complete?likelihood.rawValue:null,
    aggregation:'period-event',window,coverage:{expectedHours:round(expected,3),availableHours:round(covered/H,3),complete},
    sourceCoverageHours,peakTime:peak?.time||null,peakEnd:peak?.end||null,peak:peak?.rainLikelihood||null,
    availablePeak:peak?.rainLikelihood?.value??null,
    source:'Probability of measurable rain at least once during this period; hourly chances are correlated and not added'};
}
export function feelsLike(t, rh, wind, dewpoint = null) {
  const result=shadeFeelsLike(t,rh,wind,dewpoint);
  return {value:finite(result.value)?round(result.value,0):null,method:result.method};
}
function extrema(payload, start, end, mode) {
  const h = payload?.hourly;
  if (!Array.isArray(h?.time) || !(end > start)) return null;
  const values = [];
  for (let t = Math.ceil(start/H)*H; t < end; t += H) {
    const i = h.time.indexOf(t/1000), value = h.temperature_2m?.[i];
    if (!finite(value)) return null;
    values.push(value);
  }
  return values.length ? (mode === 'high' ? Math.max(...values) : Math.min(...values)) : null;
}
function sample(payload, time, field) {
  const h = payload?.hourly, i = h?.time?.indexOf(time/1000);
  return i >= 0 && finite(h[field]?.[i]) ? h[field][i] : null;
}
export function solarTimes(date, latitude, longitude) {
  if (!finite(latitude) || !finite(longitude)) return { sunrise:null,sunset:null };
  const rad = Math.PI/180, lw=-longitude*rad, phi=latitude*rad;
  const d = Date.parse(`${date}T12:00:00Z`)/86400000-10957.5;
  const n=Math.round(d-.0009-lw/(2*Math.PI));
  const ds=.0009+lw/(2*Math.PI)+n, m=rad*(357.5291+.98560028*ds);
  const l=m+rad*(1.9148*Math.sin(m)+.0200*Math.sin(2*m)+.0003*Math.sin(3*m))+rad*102.9372+Math.PI;
  const dec=Math.asin(Math.sin(l)*Math.sin(rad*23.4397));
  const w=Math.acos((Math.sin(rad*-.833)-Math.sin(phi)*Math.sin(dec))/(Math.cos(phi)*Math.cos(dec)));
  const noon=2451545+ds+.0053*Math.sin(m)-.0069*Math.sin(2*l);
  const rise=noon-w/(2*Math.PI),set=noon+w/(2*Math.PI);
  return finite(rise)&&finite(set)?{sunrise:iso((rise-2440587.5)*86400000),sunset:iso((set-2440587.5)*86400000),source:'Calculated astronomical times'}:{sunrise:null,sunset:null};
}
export function enhanceForecast(out, { models, grid, periods = [], hourlyPeriods = [], now, gridQpf, localTime, nextDate, dateKey }) {
  const sourceModels = Object.fromEntries(Object.entries(models).filter(([,m]) => m?.direct||m?.verifiedModel));
  const active = Object.keys(sourceModels);
  function sourceQpf(start,end) {
    const totals={}, durations={}, sourceTotals={}, sourceCoverage={};
    let total=0, covered=0;
    for(let cursor=start; cursor<end; ) {
      const stop=Math.min(end,(Math.floor(cursor/H)+1)*H),span=stop-cursor;
      const policy=precipitationPolicy(cursor-now<24*H?0:forecastDayIndex(cursor,now,out.location.timeZone));
      const values={nws:gridQpf(grid,cursor,stop,8)};
      for(const [id,m] of Object.entries(sourceModels))values[id]=intervalTotal(m.precipitationIntervals,cursor,stop,8);
      let result=weighted(values,policy);
      if(result.value===null)result=weighted(values,{nbm:1});
      for(const [id,v] of Object.entries(values))if(finite(v)){sourceTotals[id]=(sourceTotals[id]||0)+v;sourceCoverage[id]=(sourceCoverage[id]||0)+span;}
      if(result.value===null)return {value:null,sources:[],calibrated:false,start:iso(start),end:iso(end),sourceValues:values,source:'Incomplete forecast coverage'};
      total+=result.sources.reduce((n,s)=>n+s.value*s.weight,0);covered+=span;
      for(const src of result.sources){totals[src.id]=(totals[src.id]||0)+src.value*src.weight;durations[src.id]=(durations[src.id]||0)+src.weight*span;}
      cursor=stop;
    }
    const sources=Object.keys(totals).map(id=>({id,weight:round(durations[id]/covered,6),value:round(sourceTotals[id],8),coverageHours:round(sourceCoverage[id]/H,1)}));
    return {value:covered?round(total,8):null,sources,calibrated:false,start:iso(start),end:iso(end),
      sourceValues:Object.fromEntries(['nws',...active].map(id=>[id,sourceCoverage[id]>=end-start?round(sourceTotals[id],8):null])),
      source:sources.length?sources.map(s=>`${s.id.toUpperCase()} ${Math.round(s.weight*100)}%`).join(' / '):'Unavailable',
      weighting:'Per-hour blend; displayed weights are window-average contributions. HRRR contributes only within its published horizon.'};
  }
  const officialHours=new Map((hourlyPeriods.length?hourlyPeriods:out.hours).map(row=>[
    Date.parse(row.startTime||row.time),row
  ]));
  const sourceRun=id=>id==='nws'?(out.feeds?.find(f=>f.id==='hourly')?.issuedAt||null):sourceModels[id]?.runAt||null;
  const timelineStart=Math.floor(now/H)*H;
  const timelineEnd=Math.max(...out.days.map(day=>Date.parse(day.qpfWindow?.end)).filter(finite),timelineStart+48*H);
  out.rainTimeline=[];
  for(let time=timelineStart;time<timelineEnd;time+=H) {
    const official=officialHours.get(time),raw=official?.probabilityOfPrecipitation?.value??official?.pop;
    const officialPop=finite(raw)&&raw>=0&&raw<=100?raw:null;
    const precipitationBlend=sourceQpf(time,time+H);
    precipitationBlend.sources=precipitationBlend.sources.map(source=>({...source,runAt:sourceRun(source.id)}));
    out.rainTimeline.push({time:iso(time),end:iso(time+H),officialPop,precipitation:precipitationBlend.value,precipitationBlend});
  }
  const rollingAmount=(index,id,hours)=>{
    let best=null;
    for(let first=Math.max(0,index-hours+1);first<=index&&first+hours<=out.rainTimeline.length;first++) {
      let total=0,complete=true;
      for(let i=first;i<first+hours;i++) {
        const amount=out.rainTimeline[i]?.precipitationBlend?.sourceValues?.[id];
        if(!finite(amount)){complete=false;break;}
        total+=amount;
      }
      if(complete)best=best===null?total:Math.max(best,total);
    }
    return best===null?null:round(best,8);
  };
  for(const [index,row] of out.rainTimeline.entries()) {
    const sourceWindows=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>[id,{threeHour:rollingAmount(index,id,3),sixHour:rollingAmount(index,id,6)}]));
    const rainLikelihood=precipitationLikelihood(row.officialPop,row.precipitationBlend,SAME_DAY_WEIGHTS,sourceWindows);
    rainLikelihood.sources=rainLikelihood.sources.map(source=>({...source,runAt:sourceRun(source.id)}));
    row.rainLikelihood=rainLikelihood;
  }
  const timelineByTime=new Map(out.rainTimeline.map(row=>[Date.parse(row.time),row]));
  function qpf(start,end) {
    const totals={},durations={},sourceTotals={},sourceCoverage={};
    let total=0,covered=0;
    for(let cursor=start;cursor<end;) {
      const time=Math.floor(cursor/H)*H,stop=Math.min(end,time+H),span=stop-cursor;
      const row=timelineByTime.get(time),rain=row?.precipitationBlend;
      if(!finite(row?.precipitation))return {value:null,sources:[],calibrated:false,start:iso(start),end:iso(end),sourceValues:{},source:'Incomplete forecast coverage'};
      total+=row.precipitation*span/H;covered+=span;
      for(const [id,value] of Object.entries(rain.sourceValues||{}))if(finite(value)){
        sourceTotals[id]=(sourceTotals[id]||0)+value*span/H;sourceCoverage[id]=(sourceCoverage[id]||0)+span;
      }
      for(const source of rain.sources||[]){
        totals[source.id]=(totals[source.id]||0)+source.value*source.weight*span/H;
        durations[source.id]=(durations[source.id]||0)+source.weight*span;
      }
      cursor=stop;
    }
    const sources=Object.keys(totals).map(id=>({id,weight:round(durations[id]/covered,6),value:round(sourceTotals[id],4),
      coverageHours:round(sourceCoverage[id]/H,1),runAt:sourceRun(id)}));
    return {value:covered?round(total,4):null,sources,calibrated:false,start:iso(start),end:iso(end),
      sourceValues:Object.fromEntries(['nws',...active].map(id=>[id,sourceCoverage[id]>=end-start?round(sourceTotals[id],4):null])),
      source:sources.map(s=>`${s.id.toUpperCase()} ${Math.round(s.weight*100)}%`).join(' / ')||'Unavailable',
      weighting:'Sum of the same canonical hourly precipitation amounts used by the graph; partial hours are prorated.'};
  }
  for (const [index,d] of out.days.entries()) {
    const day = periods.find((p)=>p.isDaytime && Date.parse(p.endTime)>now && dateKey(Date.parse(p.startTime),out.location.timeZone)===d.date);
    const night = eveningPeriod(periods,d.date,out.location.timeZone,now);
    d.official = { high:d.high,low:d.low,condition:d.condition,pop:d.pop,detail:d.detail,nightDetail:d.nightDetail };
    if (active.length) {
      for (const [kind,period] of [['high',day],['low',night]]) {
        const defaultA = localTime(d.date,kind==='high'?7:19,out.location.timeZone);
        const defaultB = kind==='high'?localTime(d.date,19,out.location.timeZone):localTime(nextDate(d.date),7,out.location.timeZone);
        const start = period ? Math.max(Date.parse(period.startTime),Math.ceil(now/H)*H) : Math.max(Math.ceil(now/H)*H,defaultA), end=period?Date.parse(period.endTime):defaultB;
        const official = period && finite(period.temperature) ? (period.temperatureUnit==='C'?period.temperature*1.8+32:period.temperature) : null;
        const values = { nws:official };
        for (const [id,m] of Object.entries(sourceModels)) {
          values[id]=extrema(m,start,end,kind);
          d.guidance[id] ||= {};
          d.guidance[id][kind]=round(values[id],1);
        }
        const blend=weighted(values,tempPolicy(index));
        d[kind]=round(blend.value,0); d[`${kind}Blend`]=blend;
        d[`${kind}Window`]={start:iso(start),end:iso(end)};
      }
      d.temperatureSource='Weather Fusion blend · NWS + verified named-model values';
      d.lowLabel='Overnight low';
    }
    const fullStart=Date.parse(d.qpfWindow.start),end=Date.parse(d.qpfWindow.end);
    const start=index===0?Math.max(fullStart,now):fullStart;
    const rain=qpf(start,end);
    d.fullWindowQpf=qpf(fullStart,end);
    d.qpf=rain.value;d.qpfSource=rain.source;d.qpfBlend=rain;
    d.qpfWindow={start:iso(start),end:iso(end)};
    d.qpfWindowLabel=start>fullStart?'Remaining forecast through 7 AM':'7 AM–7 AM forecast';
    const periodWindow=(period,nighttime)=>{
      const fallbackStart=localTime(d.date,nighttime?19:7,out.location.timeZone);
      const fallbackEnd=localTime(nighttime?nextDate(d.date):d.date,nighttime?7:19,out.location.timeZone);
      const a=finite(Date.parse(period?.startTime))?Date.parse(period.startTime):fallbackStart;
      const b=finite(Date.parse(period?.endTime))?Date.parse(period.endTime):fallbackEnd;
      return {start:Math.max(a,index===0?now:a),end:b};
    };
    const dayWindow=periodWindow(day,false),nightWindow=periodWindow(night,true);
    d.officialPop=d.pop;d.officialPopDay=d.popDay;d.officialPopNight=d.popNight;
    d.rainLikelihood=summarizePeriodRainTimeline(out.rainTimeline,start,end,d.pop,SAME_DAY_WEIGHTS);
    d.popDayLikelihood=summarizePeriodRainTimeline(out.rainTimeline,dayWindow.start,dayWindow.end,d.popDay,SAME_DAY_WEIGHTS);
    d.popNightLikelihood=summarizePeriodRainTimeline(out.rainTimeline,nightWindow.start,nightWindow.end,d.popNight,SAME_DAY_WEIGHTS);
    for(const [id,value] of Object.entries(rain.sourceValues)) if(id!=='nws') {d.guidance[id] ||= {};d.guidance[id].qpf=value;}
    for(const [kind,period] of [['high',day],['low',night]])if(!d[`${kind}Blend`]&&finite(period?.temperature))d[`${kind}Blend`]={value:d[kind],sources:[{id:'nws',weight:1,value:d[kind]}]};
    const contributors=[...(d.highBlend?.sources||[]),...(d.lowBlend?.sources||[]),...(d.qpfBlend?.sources||[])].filter(s=>s.weight>0&&finite(s.value));
    const sourceIds=['nws','hrrr','ecmwf','nbm'].filter(id=>contributors.some(s=>s.id===id));
    const highs=(d.highBlend?.sources||[]).filter(s=>s.weight>0).map(s=>s.value).filter(finite);
    const spread=highs.length>1?Math.max(...highs)-Math.min(...highs):null;
    d.highSpread=round(spread,1);d.agreement=spread===null?'Limited guidance':spread<=3?'Close agreement':spread<=6?'Some disagreement':'Wide disagreement';
    const rainValues=(d.qpfBlend?.sources||[]).filter(s=>s.weight>0).map(s=>d.qpfBlend.sourceValues[s.id]).filter(finite);
    d.qpfSpread=rainValues.length>1?round(Math.max(...rainValues)-Math.min(...rainValues),2):null;
    d.confidence=forecastConfidence({dayIndex:index,highSpread:d.highSpread,qpfSpread:d.qpfSpread,guidanceCount:sourceIds.length,sourceIds,officialDay:!!day,officialNight:!!night});
    d.confidence.contributions={high:d.highBlend?.sources||[],low:d.lowBlend?.sources||[],rain:d.qpfBlend?.sources||[]};
  }
  const from=now;
  out.precipitation=qpf(from,from+24*H);
  out.precipitation.label='Next 24 hours';
  for (const hour of out.hours) {
    const time=Date.parse(hour.time),values={nws:hour.temperature};
    for(const [id,m] of Object.entries(sourceModels)) values[id]=sample(m,time,'temperature_2m');
    hour.officialTemperature=hour.temperature;
    if(active.length){hour.temperatureBlend=weighted(values,tempPolicy(forecastDayIndex(time,now,out.location.timeZone)));hour.temperature=round(hour.temperatureBlend.value,0);}
    const row=timelineByTime.get(time),rain=row?.precipitationBlend;
    hour.precipitation=row?.precipitation??null;hour.precipitationSource=rain?.source||'Unavailable';hour.precipitationBlend=rain;
    hour.officialPop=row?.officialPop??null;
    hour.rainLikelihood=row?.rainLikelihood||precipitationLikelihood(null,null);
    hour.reflectivity=sample(sourceModels.hrrr,time,'reflectivity');
    hour.nearbyReflectivity=sample(sourceModels.hrrr,time,'nearby_reflectivity');
  }
  const apparent=feelsLike(out.current.temperature,out.current.humidity,out.current.wind,out.current.dewpoint);
  out.current.apparent=apparent.value;
  out.current.apparentSource=`${apparent.method}; ${out.current.type==='observation'?'using nearby station observations':'using forecast guidance'}.`;
  out.solar=solarTimes(out.days[0].date,out.location.latitude,out.location.longitude);
  out.modelContributions=active.map(id=>({id,runAt:sourceModels[id].runAt,resolution:sourceModels[id].resolution,transport:sourceModels[id].transport||'Native GRIB2 snapshot',runScope:sourceModels[id].runScope||'Pinned native initialization'}));
  out.convectiveGuidance=out.hours.filter(h=>finite(h.reflectivity)||finite(h.nearbyReflectivity)).slice(0,30).map(h=>({time:h.time,pointReflectivityDbz:h.reflectivity,nearby25kmMaxReflectivityDbz:h.nearbyReflectivity,runAt:sourceModels.hrrr?.reflectivityRunAt||sourceModels.hrrr?.runAt}));
  out.google={status:'access-required',contributes:false,label:'Google WeatherNext',message:'Not included: approved Google WeatherNext dataset access has not been configured.',url:'https://developers.google.com/weathernext/guides/access-forecast'};
  out.repairVersion=REPAIR_VERSION;
  out.blendPolicy={allForecastHours:SAME_DAY_WEIGHTS,sameDay:SAME_DAY_WEIGHTS,precipitation:'Rainfall amount is calculated separately in inches from the hourly source amounts.',probability:'The NWS hourly probability fills its 40-point share proportionally. A deterministic model gets full points at 0.01 inch or more in an hour. Smaller positive traces get 30% unless a complete rolling 3-hour or 6-hour window containing that hour totals at least 0.10 inch, which restores full model points. Zero rain adds zero. Cap the total at 100%.',periodProbability:'NWS period PoP fills its 40-point share; each deterministic model contributes once if it forecasts measurable rain anywhere in the period. Correlated hourly probabilities are never added.',partialCoverage:'A partial model horizon can supply positive rain evidence, but an incomplete dry horizon is unknown rather than a dry vote. Missing canonical forecast hours leave the period unavailable.'};
  out.methodology='Numeric Weather Nourie blend: The official NWS hourly probability fills its 40-point share proportionally. HRRR is worth 30 points, ECMWF 10 points and NBM 20 points. A deterministic model amount of at least 0.01 inch in an hour contributes its full share. A smaller positive trace contributes 30% of that model share unless a complete rolling 3-hour or 6-hour window containing the trace totals at least 0.10 inch, in which case it contributes its full share. Zero contributes zero. The hourly total is capped at 100%. Daytime, overnight and daily rain percentages are period-event estimates: the official NWS period probability fills its 40-point share and each deterministic model contributes once if it forecasts measurable rain anywhere in that period. Hourly chances are correlated and are never added together. Rainfall amount is calculated separately in inches. A partial deterministic horizon may contribute positive rain evidence, but incomplete dry coverage is never treated as a dry vote. This is a transparent, uncalibrated estimate, not a proven accuracy ranking. Official warnings are never altered. Explicit HRRR, ECMWF IFS 0.25° and NBM point feeds cover the selected coordinates through Open-Meteo, with native extracts as a fallback. Point feeds can combine successive runs of the same named model; their initialization metadata refers to the latest published run. Temperature, dew point, wind, gust and cloud cover use their separate requested weighted-average policy; humidity and feels-like are derived consistently. Pressure and visibility include only published fields. Station observations, UV and official text retain separate provenance. Coarser precipitation intervals are prorated at boundaries; interpolated hourly amounts do not establish storm arrival times. Today’s daily rain card covers only the remaining period when earlier forecast hours have passed; the main precipitation metric covers the next 24 hours.';
  return out;
}