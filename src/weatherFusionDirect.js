import {temperatureV2,officialRainV2} from './weatherFusionBlendV2.js';
import {createHrrrMapSource} from './weatherFusionHrrrMap.js';
import {createPointModels} from './weatherFusionPointModels.js';
/** Direct, decoded NOAA/ECMWF model snapshots. No provider key and no webpage scraping. */
import {SAME_DAY_WEIGHTS,EXTENDED_RAIN_WEIGHTS,EXTENDED_QPF_WEIGHTS,WEATHERNEXT_WEIGHT,weatherNextPolicy,temperaturePolicy as tempPolicy,precipitationPolicy,precipitationAmountPolicy,forecastDayIndex,eveningPeriod,REPAIR_VERSION} from './weatherFusionPolicy.js';
import {shadeFeelsLike} from '../public/weather-fusion/weather-math.js';
import {forecastConfidence} from '../public/weather-fusion/forecast-confidence.js';
import {calendarDayWindow} from '../public/weather-fusion/calendar-day.js';
import {adjustTemperaturePolicy,TEMPERATURE_OUTLIER_VERSION} from './weatherFusionTemperatureOutliers.js';
import {addConditionConfidence} from './weatherFusionConditionConfidence.js';
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
// Native collector contract: temperatures in Fahrenheit, speeds in mph,
// visibility in miles and pressure in inHg. Optional invalid measurements are
// missing; they must not discard otherwise valid temperature/rain guidance.
const NATIVE_CORE_RANGES={temperature_2m:[-160,160],precipitation:[0,100],wind_speed_10m:[0,300]};
const NATIVE_OPTIONAL_FIELDS={dew_point_2m:['°F',-160,160],relative_humidity_2m:['%',0,100],wind_gusts_10m:['mp/h',0,350],wind_direction_10m:['°',0,360],cloud_cover:['%',0,100],visibility:['mi',0,200],pressure_msl:['inHg',20,35],apparent_temperature:['°F',-250,250],reflectivity:['dBZ',-100,100],nearby_reflectivity:['dBZ',-100,100],weather_code:['wmo code',0,99]};
export function modelStatus(model, runAt, validUntil, now = Date.now()) {
  const run = Date.parse(runAt), end = Date.parse(validUntil);
  if (!LABELS[model] || !finite(run) || !finite(end) || run > now + 15 * 60000 || end <= now) return 'unavailable';
  return now - run > (model === 'ecmwf' ? 30 : 12) * H ? 'stale' : 'ready';
}
export function validateSnapshot(data, id, location, now) {
  if (data?.schema !== DIRECT_SCHEMA || data.model !== id || data.complete !== true || !Array.isArray(data.points)) throw new Error('Model snapshot schema/identity is invalid.');
  const status = modelStatus(id, data.runAt, data.validUntil, now);
  if (status !== 'ready') return { value: null, status, message: 'The model run is too old or has expired; it is excluded from the forecast.' };
  // GPS rounding must not reject the same neighborhood's native grid sample.
  // Keep the published sample coordinates and reject points beyond 100 metres.
  const distance=p=>Math.hypot((p.latitude-location.latitude)*111.2,(p.longitude-location.longitude)*111.2*Math.cos(location.latitude*Math.PI/180));
  const point = data.points.filter(p=>finite(p.latitude)&&finite(p.longitude)&&distance(p)<=.1).sort((a,b)=>distance(a)-distance(b))[0];
  if (!point) return { value: null, status: 'not-covered', message: 'Direct model collection currently covers the two saved locations. No saved native grid sample is within 100 metres of this location.' };
  const h = point.hourly, u = point.hourly_units, run = Date.parse(data.runAt)/1000;
  if (!Array.isArray(h?.time) || h.time.length < 12 || h.time.length > 500 || u?.temperature_2m !== '°F' || u.precipitation !== 'inch' || u.wind_speed_10m !== 'mp/h') throw new Error('Invalid model units or time axis.');
  if (h.time.some((t,i) => !finite(t) || t < run || (i > 0 && t-h.time[i-1] !== 3600))) throw new Error('The model time axis is not a continuous hourly axis.');
  const hourly={...h,time:[...h.time]};
  for (const [field, values] of Object.entries(h)) {
    const optional=NATIVE_OPTIONAL_FIELDS[field];
    if(optional){
      const [unit,min,max]=optional,validUnit=u[field]===undefined||u[field]===unit;
      hourly[field]=h.time.map((_,index)=>{
        const value=values?.[index];
        return validUnit&&Array.isArray(values)&&values.length===h.time.length&&finite(value)&&value>=min&&value<=max&&(field!=='weather_code'||Number.isInteger(value))?value:null;
      });
      continue;
    }
    if (!Array.isArray(values) || values.length !== h.time.length || values.some((v) => v !== null && !finite(v))) throw new Error(`Invalid model series: ${field}`);
    const range=NATIVE_CORE_RANGES[field];
    if(range&&values.some(value=>finite(value)&&(value<range[0]||value>range[1])))throw new Error(`Invalid model range: ${field}`);
  }
  if (!h.temperature_2m?.some((v,i) => finite(v) && h.time[i]*1000 > now)) throw new Error('No future native model temperatures.');
  const intervals = point.precipitationIntervals;
  if (!Array.isArray(intervals) || intervals.some((r,i) => !finite(r.start) || !finite(r.end) || !finite(r.value) || r.end <= r.start || r.value < 0 || r.value > 100 || r.start < run || (i>0 && r.start < intervals[i-1].end))) throw new Error('Invalid model precipitation intervals.');
  return { status, value: { ...point, hourly, hourly_units:{...u}, direct: true, runAt: data.runAt, validUntil: data.validUntil, resolution: data.resolution, sourceUrl: SOURCE[id], interpolation: data.interpolation, timezone: 'America/New_York' }, message: `${data.resolution}; native grid extraction; initialized ${data.runAt}.` };
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
    // The named point feed covers ALL supported search locations and all-weather
    // variables. Native extracts remain a verified fallback, never a city proxy.
    let pointFailure;
    try {
      const point=await pointModel(id,location),value={...point,hourly:{...point.hourly}};
      // Preserve the independently decoded simulated reflectivity used by the
      // local outlook. It is not supplied by the point API; never invent it.
      if(id==='hrrr')try{
        const native=validateSnapshot(await resource('models/hrrr.json'),id,location,now()).value;
        if(native){for(const field of ['reflectivity','nearby_reflectivity'])if(native.hourly[field])value.hourly[field]=value.hourly.time.map(t=>{const i=native.hourly.time.indexOf(t);return i>=0?native.hourly[field][i]:null;});value.reflectivityRunAt=native.runAt;}
      }catch{/* Optional native reflectivity must not discard verified point weather. */}
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
/** Integrate a complete native QPF interval window; gaps and overlaps never become zero. */
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
/** Temperature-only policy; moisture, wind and rain retain their own weights. */
export function weightedTemperature(values,index,context=null){
 if(context?.enabled){
  const result=temperatureV2(values,index,context.validTime,context.issuedAt);
  const {policy,temperatureAdjustment}=adjustTemperaturePolicy(values,result.policy,index);
  const blend=weighted(values,policy);
  if(temperatureAdjustment)blend.sources=blend.sources.map(source=>source.id===temperatureAdjustment.sourceId?{...source,temperatureOutlier:true,baseWeight:temperatureAdjustment.baseWeight}:source.id==='ecmwf'?{...source,receivedTemperatureWeight:temperatureAdjustment.transferredWeight}:source);
  return {...blend,comparisonSources:Object.entries(values).filter(([,value])=>finite(value)).map(([id,value])=>({id,value,weight:policy[id]||0,comparisonOnly:!(policy[id]>0)})),version:result.version,band:result.band,leadHours:result.leadHours,requestedWeights:result.requestedWeights,excluded:result.excluded,temperatureAdjustment};
 }
 const {policy,temperatureAdjustment}=adjustTemperaturePolicy(values,tempPolicy(index,finite(values.wn)),index);
 const blend=weighted(values,policy);
 if(temperatureAdjustment)blend.sources=blend.sources.map(source=>source.id===temperatureAdjustment.sourceId
  ?{...source,temperatureOutlier:true,baseWeight:temperatureAdjustment.baseWeight}
  :source.id==='ecmwf'?{...source,receivedTemperatureWeight:temperatureAdjustment.transferredWeight}:source);
 return {...blend,temperatureAdjustment};
}
export const TRACE_QPF_THRESHOLD_INCHES = .010;
export const TRACE_QPF_POINT_FRACTION = 1/3;
// Compatibility field retained in the API. The rain-signal floor is zero:
// every positive deterministic QPF through .010 inch receives one-third credit.
export const MIN_RAIN_SIGNAL_INCHES = 0;
/** Zero contributes zero; positive amounts through .010 inch contribute one-third. */
export function deterministicRainSignal(amount) {
  if (!finite(amount)) return null;
  if (amount <= 0) return 0;
  return amount <= TRACE_QPF_THRESHOLD_INCHES ? 100*TRACE_QPF_POINT_FRACTION : 100;
}
/**
 * Fill the policy's NWS share in proportion to its official probability, then
 * add one-third of a deterministic model's fixed weight for any positive QPF
 * through .010 inch. A larger amount gets full points. Rainfall inches stay
 * separate from the score.
 */
export function precipitationLikelihood(nwsProbability, precipitationBlend, policy = SAME_DAY_WEIGHTS) {
  const amounts = precipitationBlend?.sourceValues || {};
  const nws=finite(nwsProbability)?Math.max(0,Math.min(100,nwsProbability)):null;
  const values = {
    nws,
    hrrr:deterministicRainSignal(amounts.hrrr),
    ecmwf:deterministicRainSignal(amounts.ecmwf),
    nbm:deterministicRainSignal(amounts.nbm)
  };
  const ids=['nws','hrrr','ecmwf','nbm',...(policy.wn>0?['wn']:[])];
  if(policy.wn>0)values.wn=deterministicRainSignal(amounts.wn);
  const models=ids.filter(id=>id!=='nws'&&finite(policy[id])&&policy[id]>0);
  const reductionReasons={};
  for(const id of models) {
    if(values[id]>0&&values[id]<100)reductionReasons[id]='trace';
  }
  const points=(id,value)=>finite(value)&&finite(policy[id])&&policy[id]>0?round(value*policy[id],8):null;
  const sourcePoints=Object.fromEntries(ids.map(id=>[id,points(id,values[id])]));
  const included=ids.filter(id=>finite(sourcePoints[id]));
  const rawTotal=included.length?round(included.reduce((sum,id)=>sum+sourcePoints[id],0),8):null;
  const value=finite(rawTotal)?Math.min(100,Math.round(rawTotal)):null;
  const sourceAmounts=Object.fromEntries(ids.map(id=>[id,finite(amounts[id])?amounts[id]:null]));
  const drySources=models.filter(id=>finite(amounts[id])&&amounts[id]<=0);
  const negligibleSources=[];
  const wetSources=models.filter(id=>finite(values[id])&&values[id]>0);
  const reducedSources=Object.keys(reductionReasons);
  const sources=included.map(id=>({id,value:values[id],weight:policy[id],points:sourcePoints[id],reductionReason:reductionReasons[id]||null}));
  return {value,rawValue:value,weightedValue:rawTotal,rawTotal,sourceValues:values,sourcePoints,
    sourceAmounts,officialProbability:nws,drySources,wetSources,negligibleSources,reducedSources,reductionReasons,sources,
    minimumRainSignalInches:MIN_RAIN_SIGNAL_INCHES,
    reducedQpfThresholdInches:TRACE_QPF_THRESHOLD_INCHES,reducedPointFraction:TRACE_QPF_POINT_FRACTION,
    source:'Weighted NWS probability plus tiered wet-model points',calibrated:false};
}

/** Publish the official probability when required model inputs are missing.
 * The incomplete weighted score is retained for inspection, never presented
 * as a lower chance of rain caused by missing model data.
 */
export function publishedPrecipitationLikelihood(nwsProbability,precipitationBlend,policy=SAME_DAY_WEIGHTS){
 const blend=precipitationLikelihood(nwsProbability,precipitationBlend,policy);
 const missingModels=Object.entries(policy).filter(([id,weight])=>id!=='nws'&&weight>0&&!finite(precipitationBlend?.sourceValues?.[id])).map(([id])=>id);
 if(!missingModels.length)return blend;
 const value=finite(nwsProbability)&&nwsProbability>=0&&nwsProbability<=100?nwsProbability:null;
 return {...blend,value,rawValue:value,rawTotal:value,weightedValue:value,mode:'nws-fallback',missingModels,partialBlend:blend,
  sourcePoints:Object.fromEntries(Object.keys(blend.sourcePoints).map(id=>[id,id==='nws'?value:null])),
  sources:finite(value)?[{id:'nws',value,weight:1,points:value,reductionReason:null}]:[],
  source:'Official NWS hourly probability · model blend unavailable'};
}
/** A period card is the highest of its actual hourly scores, never a new vote on accumulated rain. */
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
/** Backward-compatible API helper using the same all-weather Steadman equation as Weather Nourie. */
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
/** Rebuild confidence after the final hourly temperature series exists.
 * Daily cards use calendar-date extrema, so their confidence must compare
 * those same hours, including the current partial hour, never tomorrow's low.
 * Count partial sources for disclosure, but only complete sources establish
 * period agreement. The score is a relative index, not a calibrated chance.
 */
export function refreshCalendarConfidence(out,{now=Date.now()}={}) {
  const temperatures=new Map((out.metricForecasts?.series?.temperature||[]).map(row=>[Date.parse(row.time),row]));
  for(const [index,day] of (out.days||[]).entries()) {
    const calendarWindow=calendarDayWindow(day,index,now,out.location?.timeZone),currentRow=temperatures.get(calendarWindow.start);
    const currentSources=(currentRow?.sources||[]).filter(source=>source.weight>0&&finite(source.value));
    // Hourly temperatures are point forecasts at the top of the hour. Once that
    // timestamp has passed, an absent/incomparable current point is not missing
    // future evidence. Start at the next forecast timestamp instead of letting
    // one partially elapsed interval cap all of today's confidence as Low.
    const currentPartialExcluded=index===0&&now>calendarWindow.start&&now<calendarWindow.start+H&&(!finite(currentRow?.value)||currentSources.length<2);
    const window={start:currentPartialExcluded?Math.min(calendarWindow.start+H,calendarWindow.end):calendarWindow.start,end:calendarWindow.end},expectedHours=(window.end-window.start)/H;
    if(!(expectedHours>0))continue;
    const localDayIndex=forecastDayIndex(window.start,now,out.location?.timeZone);
    const samples={},weights={},counts={},runs={};let availableHours=0,maximumHourlySpread=null,worstHour=null,maximumConfidenceSpread=null,confidenceHour=null,hourlySpreadTotal=0,hourlySpreadCount=0,excludedTotal=0,excludedCount=0,excludedMax=null;const temperatureAdjustments=[];
    for(let time=window.start;time<window.end;time+=H) {
      const row=temperatures.get(time);
      if(finite(row?.value))availableHours++;
      const sources=(row?.sources||[]).filter(source=>source.weight>0&&finite(source.value));
      for(const source of sources) {
        (samples[source.id]||=[]).push(source.value);
        weights[source.id]=(weights[source.id]||0)+source.weight;
        counts[source.id]=(counts[source.id]||0)+1;
        if(source.runAt)(runs[source.id]||=new Set()).add(source.runAt);
      }
      // Equal daily highs cannot hide different cold-front arrival times.
      const values=sources.map(source=>source.value);
      if(values.length>1){
        const spread=Math.max(...values)-Math.min(...values);
        if(maximumHourlySpread===null||spread>maximumHourlySpread){
          maximumHourlySpread=spread;
          const low=sources.reduce((a,b)=>a.value<=b.value?a:b),high=sources.reduce((a,b)=>a.value>=b.value?a:b);
          worstHour={time:iso(time),spread:round(spread,1),low:{id:low.id,value:low.value},high:{id:high.id,value:high.value},
            sources:sources.map(source=>({...source,runAt:source.runAt||null})),...(row?.temperatureAdjustment?{temperatureAdjustment:row.temperatureAdjustment}:{})};
        }
      }
      // Only the exact isolated source identified by the temperature policy is
      // omitted from the confidence gap. Its raw forecast remains in evidence
      // and retains its reduced share of the actual temperature blend.
      const adjustment=row?.temperatureAdjustment;
      const verified=adjustment?.applied===true&&adjustment.version===TEMPERATURE_OUTLIER_VERSION&&adjustment.recipientId==='ecmwf'
        ?adjustTemperaturePolicy(Object.fromEntries(sources.map(source=>[source.id,source.value])),Object.fromEntries(sources.map(source=>[source.id,source.weight])),localDayIndex).temperatureAdjustment:null;
      const isolated=verified&&verified.sourceId===adjustment.sourceId
        ?sources.find(source=>source.id===adjustment.sourceId&&source.temperatureOutlier===true&&finite(source.baseWeight)&&source.baseWeight>0&&source.baseWeight<=1
          &&Math.abs(source.weight-source.baseWeight*.1)<=0.000001&&Math.abs(adjustment.baseWeight-source.baseWeight)<=0.000001
          &&Math.abs(adjustment.transferredWeight-source.baseWeight*.9)<=0.000001):null;
      const peers=isolated?sources.filter(source=>source.id!==isolated.id):sources;
      const usePeers=!!isolated&&peers.length>=3&&peers.some(source=>source.id==='ecmwf');
      const confidenceSources=usePeers?peers:sources;
      if(usePeers)temperatureAdjustments.push({time:iso(time),...adjustment});
      if(confidenceSources.length>1){
        const lo=confidenceSources.reduce((a,b)=>a.value<=b.value?a:b),hi=confidenceSources.reduce((a,b)=>a.value>=b.value?a:b),gap=hi.value-lo.value;
        hourlySpreadTotal+=gap;hourlySpreadCount++;
        if(maximumConfidenceSpread===null||gap>maximumConfidenceSpread){
          maximumConfidenceSpread=gap;
          confidenceHour={time:iso(time),spread:round(gap,1),low:{id:lo.id,value:lo.value},high:{id:hi.id,value:hi.value},
            sources:confidenceSources.map(source=>({...source,runAt:source.runAt||null})),allSources:sources.map(source=>({...source,runAt:source.runAt||null})),
            temperatureAdjustment:usePeers?adjustment:null};
        }
      }
      // The GEFS mean is one number, not the ensemble's uncertainty. Keep it in
      // the disclosed full gap, and remember the gap without it for fallback
      // scoring when member spread is unavailable.
      const excludedPool=(usePeers?peers:sources).filter(source=>source.id!=='gefs');
      if(excludedPool.length>1){
        const excludedGap=Math.max(...excludedPool.map(source=>source.value))-Math.min(...excludedPool.map(source=>source.value));
        excludedTotal+=excludedGap;excludedCount++;
        if(excludedMax===null||excludedGap>excludedMax)excludedMax=excludedGap;
      }
    }
    const sourceOrder=['nws','hrrr','ecmwf','nbm','wn','weathernext3','gefs'];
    const contributors=kind=>sourceOrder.filter(id=>samples[id]?.length).map(id=>({id,value:round(kind==='high'?Math.max(...samples[id]):Math.min(...samples[id]),1),weight:round(weights[id]/expectedHours,6),coverageHours:counts[id],complete:counts[id]===expectedHours,
      runAt:runs[id]?.size===1?[...runs[id]][0]:runs[id]?.size?null:(out.feeds?.find(feed=>feed.id===(id==='nws'?'hourly':id))?.issuedAt||null),...(runs[id]?.size>1?{runAts:[...runs[id]]}:{})}));
    const high=contributors('high'),low=contributors('low');
    const completeTemperature=high.filter(source=>source.complete);
    const spread=values=>values.length>1?Math.max(...values)-Math.min(...values):null;
    const completeHigh=completeTemperature.map(source=>({...source,value:Math.max(...samples[source.id])}));
    const dailyHigh=completeHigh.length?(()=>{
      const low=completeHigh.reduce((a,b)=>a.value<=b.value?a:b),high=completeHigh.reduce((a,b)=>a.value>=b.value?a:b);
      return {spread:completeHigh.length>1?round(high.value-low.value,1):null,low:{id:low.id,value:low.value},high:{id:high.id,value:high.value},sources:completeHigh};
    })():null;
    day.highSpread=dailyHigh?.spread??null;
    day.lowSpread=round(spread(low.filter(source=>source.complete).map(source=>source.value)),1);
    const rawTemperatureSpread=round(maximumHourlySpread,1);
    // A current-day card describes the whole remaining day. Rating that entire
    // period by the single widest model gap made one pre-dawn/overnight hour
    // override otherwise close same-day guidance. Keep the maximum in evidence,
    // but use the average of the timestamp-matched gaps for today's rating.
    const averageHourlySpread=hourlySpreadCount?round(hourlySpreadTotal/hourlySpreadCount,1):null;
    const sameDayAverage=index===0&&finite(averageHourlySpread);
    const temperatureSpread=sameDayAverage?averageHourlySpread:round(maximumConfidenceSpread,1);
    const excludedAverage=excludedCount?round(excludedTotal/excludedCount,1):null;
    const temperatureSpreadExcludingGefs=index===0&&finite(excludedAverage)?excludedAverage:round(excludedMax,1);
    const temperatureSpreadBasis=sameDayAverage?'same-day-average':temperatureAdjustments.length?'peer-consensus':'same-hour';
    const rain=(day.qpfBlend?.sources||[]).filter(source=>source.weight>0&&finite(source.value)).map(source=>({...source,complete:finite(day.qpfBlend?.sourceValues?.[source.id])}));
    const completeRain=rain.filter(source=>source.complete);
    day.qpfSpread=round(spread(completeRain.map(source=>day.qpfBlend.sourceValues[source.id])),2);
    day.agreement=temperatureSpread===null?'Limited guidance':temperatureSpread<=3?'Close agreement':temperatureSpread<=6?'Some disagreement':'Wide disagreement';
    const sourceIds=sourceOrder.filter(id=>high.some(source=>source.id===id)||rain.some(source=>source.id===id));
    const rainRows=(out.rainTimeline||[]).filter(row=>Date.parse(row.time)<window.end&&Date.parse(row.end)>window.start);
    const rainFallback=rainRows.some(row=>row.rainLikelihood?.mode==='nws-fallback'&&row.rainLikelihood.fallbackReason!=='calibrated-probability-not-supplied');
    const temperatureCoverage=availableHours===expectedHours;
    const effectiveRain=summarizeRainTimeline(out.rainTimeline||[],window.start,window.end);
    const rainCoverage=(currentPartialExcluded?effectiveRain.coverage.complete:day.rainLikelihood?.coverage?.complete===true)&&finite(day.qpf);
    day.confidence=forecastConfidence({dayIndex:index,highSpread:temperatureSpread,temperatureSpreadBasis,temperatureOutlierHours:temperatureAdjustments.length,qpfSpread:day.qpfSpread,
      guidanceCount:Math.min(completeTemperature.length,completeRain.length),sourceIds,
      officialCoverage:(counts.nws||0)/expectedHours,temperatureCoverage,rainCoverage,
      temperatureSourceCount:completeTemperature.length,rainSourceCount:completeRain.length,rainFallback});
    day.confidence.window={start:iso(window.start),end:iso(window.end)};
    if(currentPartialExcluded)day.confidence.factors.push('The partially elapsed current hour had no comparable temperature forecast and is excluded from the remaining-day rating.');
    day.confidence.temperatureSpread=temperatureSpread;
    day.confidence.temperatureSpreadExcludingGefs=temperatureSpreadExcludingGefs;
    day.confidence.rawTemperatureSpread=rawTemperatureSpread;
    day.confidence.temperatureComparison={basis:'maximum-same-hour-spread',worstHour,dailyHigh,confidenceHour,averageHourlySpread,confidenceSpread:temperatureSpread,
      confidenceBasis:sameDayAverage?(temperatureAdjustments.length?'same-day-average-peer-consensus':'same-day-average-same-hour'):temperatureAdjustments.length?'isolated-outlier-peers':'all-contributing-sources',
      adjustments:temperatureAdjustments,window:{start:iso(window.start),end:iso(window.end)}};
    day.confidence.coverage={temperature:{expectedHours,availableHours,complete:temperatureCoverage,completeSources:completeTemperature.map(source=>source.id),currentPartialExcluded},rain:{...day.rainLikelihood?.coverage,...(currentPartialExcluded?effectiveRain.coverage:{}),complete:rainCoverage,completeSources:completeRain.map(source=>source.id),officialFallback:rainFallback,currentPartialExcluded}};
    day.confidence.contributions={high,low,rain};
  }
  addConditionConfidence(out,{now});
  return out;
}
/** Astronomical sunrise/sunset, independent of model availability. */
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
    // Blend each time segment first. An 18-hour HRRR run must contribute where
    // covered rather than being discarded for not covering an entire 24h window.
    const totals={}, durations={}, sourceTotals={}, sourceCoverage={};
    let total=0, covered=0;
    for(let cursor=start; cursor<end; ) {
      const stop=Math.min(end,(Math.floor(cursor/H)+1)*H),span=stop-cursor;
      const values={nws:gridQpf(grid,cursor,stop,8)};
      for(const [id,m] of Object.entries(sourceModels))values[id]=intervalTotal(m.precipitationIntervals,cursor,stop,8);
      const policy=out.blendV2?.enabled?{nws:1}:precipitationAmountPolicy(forecastDayIndex(cursor,now,out.location.timeZone),finite(values.wn));
      let result=weighted(values,policy);
      if(result.value===null)result=weighted(values,{nbm:1});
      for(const [id,v] of Object.entries(values))if(finite(v)){sourceTotals[id]=(sourceTotals[id]||0)+v;sourceCoverage[id]=(sourceCoverage[id]||0)+span;}
      if(result.value===null){cursor=stop;continue;} // Keep raw model comparisons even when published QPF is missing.
      total+=result.sources.reduce((n,s)=>n+s.value*s.weight,0);covered+=span;
      for(const src of result.sources){totals[src.id]=(totals[src.id]||0)+src.value*src.weight;durations[src.id]=(durations[src.id]||0)+src.weight*span;}
      cursor=stop;
    }
    const sources=Object.keys(totals).map(id=>({id,weight:round(durations[id]/covered,6),value:round(sourceTotals[id],8),coverageHours:round(sourceCoverage[id]/H,1)}));
    const comparisonSources=out.blendV2?.enabled?Object.entries(sourceTotals).filter(([id])=>sourceCoverage[id]>=end-start).map(([id,value])=>({id,value:round(value,8),weight:precipitationAmountPolicy(forecastDayIndex(start,now,out.location.timeZone),finite(sourceTotals.wn))[id]||1,runAt:sourceRun(id,end)})):undefined;
    const complete=end>start&&covered===end-start;
    return {value:complete?round(total,8):null,sources:complete?sources:[],...(comparisonSources?{comparisonSources}:{}),calibrated:false,start:iso(start),end:iso(end),
      sourceValues:Object.fromEntries(['nws',...active].map(id=>[id,sourceCoverage[id]>=end-start?round(sourceTotals[id],8):null])),
      source:!complete?'Incomplete forecast coverage':sources.length?sources.map(s=>`${s.id.toUpperCase()} ${Math.round(s.weight*100)}%`).join(' / '):'Unavailable',
      weighting:'Per-hour blend; displayed weights are window-average contributions. HRRR contributes only during the selected location\'s current local calendar day.'};
  }
  // Score every forecast hour once, including the days beyond the 48-hour strip.
  // NWS hourly probability is independent of NWS's longer day/night period PoP.
  const normalizedHoursFallback=!hourlyPeriods.length;
  const officialHours=new Map([...out.hours,...hourlyPeriods].map(row=>[
    Date.parse(row.startTime||row.time),row
  ]));
  const sourceRun=(id,time)=>{
    if(id==='nws')return out.feeds?.find(f=>f.id==='hourly')?.issuedAt||null;
    const model=sourceModels[id], index=model?.hourly?.time?.indexOf(time/1000);
    return model?.hourlyProvenance?.[index]?.runAt||model?.runAt||null;
  };
  const timelineStart=Math.floor(now/H)*H;
  const timelineEnd=Math.max(...out.days.map(day=>Date.parse(day.qpfWindow?.end)).filter(finite),timelineStart+48*H);
  out.rainTimeline=[];
  for(let time=timelineStart;time<timelineEnd;time+=H) {
    const official=officialHours.get(time),raw=official?.probabilityOfPrecipitation?.value??official?.pop;
    const officialPop=finite(raw)&&raw>=0&&raw<=100?raw:null;
    // Only an actual one-hour source can establish thunder timing. Longer
    // forecast periods must not be projected onto individual timeline hours.
    const conditionEnd=official?.endTime??official?.end;
    const hasHourlyCondition=!!official&&(conditionEnd!=null
      ?Date.parse(conditionEnd)-time===H:normalizedHoursFallback);
    const sourceCondition=official?.shortForecast||official?.condition;
    const condition=hasHourlyCondition&&typeof sourceCondition==='string'&&sourceCondition.trim()
      ?sourceCondition.trim():null;
    const precipitationBlend=sourceQpf(time,time+H);
    const policy=precipitationPolicy(forecastDayIndex(time,now,out.location.timeZone),finite(precipitationBlend.sourceValues?.wn));
    const rainLikelihood=out.blendV2?.enabled?officialRainV2(officialPop):publishedPrecipitationLikelihood(officialPop,precipitationBlend,policy);
    rainLikelihood.sources=rainLikelihood.sources.map(source=>({...source,runAt:sourceRun(source.id,time+H)}));
    precipitationBlend.sources=precipitationBlend.sources.map(source=>({...source,runAt:sourceRun(source.id,time+H)}));
    out.rainTimeline.push({time:iso(time),end:iso(time+H),officialPop,rainLikelihood,
      condition,conditionSource:condition?(/model guidance/i.test(official?.conditionSource||'')?official.conditionSource:(normalizedHoursFallback?'Hourly forecast condition':'NWS hourly forecast')):null,
      precipitation:precipitationBlend.value,precipitationBlend});
  }
  const timelineByTime=new Map(out.rainTimeline.map(row=>[Date.parse(row.time),row]));
  // Amounts use the same hourly row as the graph; partial boundary hours are prorated.
  function qpf(start,end) {
    const totals={},durations={},sourceTotals={},sourceCoverage={},runs={};
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
        if(source.runAt)(runs[source.id]||=new Set()).add(source.runAt);
      }
      cursor=stop;
    }
    const sources=Object.keys(totals).map(id=>({id,weight:round(durations[id]/covered,6),value:round(sourceTotals[id],4),
      coverageHours:round(sourceCoverage[id]/H,1),runAt:runs[id]?.size===1?[...runs[id]][0]:id==='wn'?null:sourceRun(id),...(id==='wn'?{runAts:[...(runs[id]||[])]}:{})}));
    return {value:covered?round(total,4):null,sources,calibrated:false,start:iso(start),end:iso(end),
      sourceValues:Object.fromEntries(['nws',...active].map(id=>[id,sourceCoverage[id]>=end-start?round(sourceTotals[id],4):null])),
      source:sources.map(s=>`${s.id.toUpperCase()} ${Math.round(s.weight*100)}%`).join(' / ')||'Unavailable',
      weighting:'Sum of the same canonical hourly precipitation amounts used by the graph; partial hours are prorated.'};
  }
  // For direct model forecasts align temperature samples to NWS day/night periods.
  for (const [index,d] of out.days.entries()) {
    const day = periods.find((p)=>p.isDaytime && Date.parse(p.endTime)>now && dateKey(Date.parse(p.startTime),out.location.timeZone)===d.date);
    const night = eveningPeriod(periods,d.date,out.location.timeZone,now);
    const officialTemperature=period=>finite(period?.temperature)?(period.temperatureUnit==='C'?period.temperature*1.8+32:period.temperature):null;
    d.official = { high:round(officialTemperature(day),0),low:round(officialTemperature(night),0),condition:day?.shortForecast||night?.shortForecast||null,pop:d.pop,detail:d.detail,nightDetail:d.nightDetail };
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
        const blend=weightedTemperature(values,index,out.blendV2?.enabled?{enabled:true,issuedAt:Date.parse(out.blendV2.issuedAt),validTime:start}:null);
        d[kind]=round(blend.value,0); d[`${kind}Blend`]=blend;
        d[`${kind}Window`]={start:iso(start),end:iso(end)};
      }
      d.temperatureSource='Weather Fusion blend · NWS + verified named-model values';
      d.lowLabel='Overnight low';
    }
    // Day labels use the location's calendar date. Rain after midnight belongs
    // to the next day; Tonight retains its separately labeled NWS night window.
    const fullStart=localTime(d.date,0,out.location.timeZone),end=localTime(nextDate(d.date),0,out.location.timeZone);
    const start=index===0?Math.max(fullStart,now):fullStart;
    const rain=qpf(start,end);
    d.fullWindowQpf=qpf(fullStart,end);
    d.qpf=rain.value;d.qpfSource=rain.source;d.qpfBlend=rain;
    d.qpfWindow={start:iso(start),end:iso(end)};
    d.qpfWindowLabel=start>fullStart?'Remaining forecast today':'Local calendar day';
    d.rainPeriodVersion='local-calendar-v1';
    const periodWindow=(period,nighttime)=>{
      const fallbackStart=localTime(d.date,nighttime?19:7,out.location.timeZone);
      const fallbackEnd=localTime(nighttime?nextDate(d.date):d.date,nighttime?7:19,out.location.timeZone);
      const a=finite(Date.parse(period?.startTime))?Date.parse(period.startTime):fallbackStart;
      const b=finite(Date.parse(period?.endTime))?Date.parse(period.endTime):fallbackEnd;
      return {start:Math.max(a,index===0?now:a),end:b};
    };
    const dayWindow=periodWindow(day,false),nightWindow=periodWindow(night,true);
    d.officialPop=d.pop;d.officialPopDay=d.popDay;d.officialPopNight=d.popNight;
    d.rainLikelihood=summarizeRainTimeline(out.rainTimeline,start,end);
    d.popDayLikelihood=summarizeRainTimeline(out.rainTimeline,dayWindow.start,dayWindow.end);
    d.popNightLikelihood=summarizeRainTimeline(out.rainTimeline,nightWindow.start,nightWindow.end);
    for(const [id,value] of Object.entries(rain.sourceValues)) if(id!=='nws') {d.guidance[id] ||= {};d.guidance[id].qpf=value;}
    // Keep period-specific blend evidence. Calendar-card confidence is rebuilt
    // after addExperience constructs the final hourly source series.
    for(const [kind,period] of [['high',day],['low',night]])if(!d[`${kind}Blend`]&&finite(period?.temperature))d[`${kind}Blend`]={value:d[kind],sources:[{id:'nws',weight:1,value:d[kind]}]};
  }
  const from=now;
  out.precipitation=qpf(from,from+24*H);
  out.precipitation.label='Next 24 hours';
  for (const hour of out.hours) {
    const time=Date.parse(hour.time),values={nws:hour.forecastSource==='model-guidance'?null:hour.temperature};
    for(const [id,m] of Object.entries(sourceModels)) values[id]=sample(m,time,'temperature_2m');
    hour.officialTemperature=values.nws;
    hour.temperatureBlend=weightedTemperature(values,forecastDayIndex(time,now,out.location.timeZone),out.blendV2?.enabled?{enabled:true,issuedAt:Date.parse(out.blendV2.issuedAt),validTime:time}:null);
    hour.temperatureBlend.sources=hour.temperatureBlend.sources.map(source=>({...source,runAt:sourceRun(source.id,time)}));
    hour.temperature=round(hour.temperatureBlend.value,0);
    hour.temperatureSource=hour.temperatureBlend.sources.length?hour.temperatureBlend.sources.map(source=>`${source.id==='wn'?'Google WeatherNext':source.id.toUpperCase()} ${Math.round(source.weight*100)}%`).join(' / '):'Temperature forecast unavailable';
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
  const nvidia=sourceModels.wn, nvidiaFeed=out.feeds?.find(feed=>feed.id==='wn');
  out.google={status:nvidia?'ready':'unavailable',contributes:!!nvidia,label:'Google WeatherNext',requestedWeight:WEATHERNEXT_WEIGHT,runAt:nvidia?.runAt||null,
    message:nvidia?'Google WeatherNext has a 10% starting share where fresh, matching forecast inputs are available.':nvidiaFeed?.message||'No verified Google WeatherNext forecast is available for this location.',url:'https://developers.google.com/weathernext/guides/models'};
  out.repairVersion=REPAIR_VERSION;
  out.rainPeriodVersion='local-calendar-v1';
  out.blendPolicy={sameDay:SAME_DAY_WEIGHTS,extendedRain:EXTENDED_RAIN_WEIGHTS,extendedAmount:EXTENDED_QPF_WEIGHTS,precipitation:'Rainfall amount is calculated separately in inches from the hourly source amounts. HRRR contributes only on the selected location\'s current local calendar day.',probability:'The NWS hourly probability always fills its 40-point share proportionally. On the current local day, HRRR is worth 30 points, ECMWF 10 and NBM 20. After the current local day, HRRR is excluded and the remaining 60 model points retain the established ECMWF-to-NBM ratio. Deterministic QPF of zero adds zero points; any positive amount through 0.010 inch/hour adds one-third of that model\'s points; and an amount above 0.010 inch/hour adds all of that model\'s points. Original rainfall amounts remain unchanged.',periodProbability:'Highest canonical hourly score within the explicit period window, not an independently estimated all-day event probability',partialCoverage:'When a required model is unavailable, show the official NWS hourly probability with an explicit fallback label. Preserve the incomplete model score separately; missing data is not dry weather.'};
  out.blendPolicy.temperatureOutliers={version:TEMPERATURE_OUTLIER_VERSION,days:[1,2],retainedWeightFraction:.1,recipient:'ecmwf',minimumSources:4,maximumPeerSpreadF:3,minimumMedianDeviationF:4,minimumOutsidePeerRangeF:3};
  out.methodology='Numeric Weather Nourie blend: The official NWS hourly probability always fills its 40-point share proportionally. On the selected location\'s current local calendar day, HRRR is worth 30 points, ECMWF 10 points and NBM 20 points. After that local date ends, HRRR does not contribute and the remaining 60 model points retain the established ECMWF-to-NBM ratio. Deterministic QPF of zero contributes zero rain-signal points. Any positive amount through 0.010 inch/hour contributes exactly one-third of that model\'s points. Above 0.010 inch/hour it contributes all of that model\'s points. The total is capped at 100%. Rainfall amount is calculated separately in inches. Unavailable deterministic inputs remain missing. If a required model is unavailable, the published rain chance uses the official NWS hourly probability and is explicitly labeled as a fallback; the incomplete weighted score is retained separately. This is a transparent, uncalibrated estimate, not a proven accuracy ranking. Official warnings are never altered. Explicit HRRR, ECMWF IFS 0.25° and NBM point feeds cover the selected coordinates through Open-Meteo, with native extracts as a fallback. Point feeds can combine successive runs of the same named model; their initialization metadata refers to the latest published run. Temperature, dew point, wind, gust and cloud cover use their separate requested weighted-average policy; humidity and feels-like are derived consistently. Pressure and visibility include only published fields. Station observations, UV and official text retain separate provenance. Coarser precipitation intervals are prorated at boundaries; interpolated hourly amounts do not establish storm arrival times. Daily rain chance and amount cover the labeled local calendar date, excluding elapsed hours today; Tonight is a separately labeled overnight period; the main precipitation metric covers the next 24 hours.';
  if(nvidia) {
    out.blendPolicy.sameDay=precipitationPolicy(0,true);
    out.blendPolicy.extendedRain=precipitationPolicy(1,true);
    out.blendPolicy.extendedAmount=weatherNextPolicy(EXTENDED_QPF_WEIGHTS,true);
    out.blendPolicy.weatherNext={requestedWeight:WEATHERNEXT_WEIGHT,runAt:nvidia.runAt,missingInputs:'Only verified matching inputs contribute. Missing Google WeatherNext fields or hours retain the existing available-model policy.'};
    out.blendPolicy.probability='With matching Google WeatherNext input, NWS keeps its fixed 40-point share and Google WeatherNext receives 10 points. The remaining deterministic-model shares total 50 points while preserving their established relative proportions; HRRR is excluded after the current local day. NWS probability fills its 40-point share proportionally. Deterministic QPF of zero adds zero points, any positive amount through 0.010 inch/hour adds one-third of that model’s points, and an amount above 0.010 inch/hour adds all of that model’s points.';
    out.methodology='Weather Nourie includes verified Google WeatherNext at the established 10% starting share. Temperature and other matching numeric weather inputs retain their separate requested blend. For rain chance, NWS always keeps 40 points, Google WeatherNext receives 10 points, and the other deterministic models share the remaining 50 points in their established relative proportions; HRRR is excluded after the current local date. Each field and hour must have a fresh, matching Google WeatherNext input; otherwise the existing available-model policy applies. Google WeatherNext initialization age is checked independently of collection time, with a 36-hour maximum; only the selected location’s published grid is used. Rainfall amount is calculated separately in inches from timestamp-matched intervals. NWS supplies official probabilities; deterministic models supply uncalibrated rain signals, never invented model probabilities. QPF of zero adds zero points. Any positive amount through 0.010 inch/hour contributes one-third of that model’s points, and a larger amount contributes all of its points. Daily chance is the highest canonical hourly score in the same period. The daily tiles, hour-by-hour views and comparison graph share these published calculations. Station observations, UV, air quality, official conditions and warnings retain their own sources. Google WeatherNext does not supply gusts, visibility, snowfall depth or winter precipitation-type probabilities; those fields keep their available sources. Today covers the remaining local calendar date; future days cover midnight to midnight. Tonight is a separately labeled overnight period, and the main rain metric covers the next 24 hours. When required rain-model inputs are missing, the published hourly chance is the explicitly identified official NWS fallback.';
  }
  out.methodology=out.methodology.replace('The hourly rain likelihood','Each hourly rain likelihood')+' Daily, daytime and overnight rain percentages are the highest canonical hourly score inside their stated windows, not independently calculated full-period probabilities. The same complete hourly timeline supplies daily cards, forecast details, the hourly display, car-wash decisions and experimental source evidence. A missing hourly score leaves its period unavailable. Expected rainfall amounts are summed from that same timeline.';
  out.methodology+=' For tomorrow and the following local calendar day, one isolated temperature source retains one tenth of its normalized share and transfers the remainder to ECMWF only when at least three other sources, including ECMWF, agree within 3°F, the isolated value differs from their median by at least 4°F, and it lies at least 3°F beyond their range. Raw model temperatures remain visible. This selected policy does not change wind, moisture or rainfall weighting.';
  return out;
}
