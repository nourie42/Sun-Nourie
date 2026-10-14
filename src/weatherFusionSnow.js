// Independent winter outlook: amount blends and precipitation-type probabilities
// have separate provenance. Missing guidance never means a zero chance of snow.
import { WINTER_WEIGHTS, winterWeights, winterIntervalAmount, blendWinterAmounts } from './weatherFusionWinterModels.js';
import {createWpcSnowAmountService} from './weatherFusionWpcSnowAmounts.js';
import {nwsSnowPhaseWindows} from './weatherFusionNwsSnowTiming.js';
import {modelSnowMapDescriptor} from './weatherFusionModelSnowMap.js';
export const SNOW_VERSION = 'snow-outlook-v4';
const MM_PER_IN = 25.4, CM_PER_IN = 2.54, HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 1) => finite(value) ? Number(value.toFixed(digits)) : null;
const SNOW_WORDS = /snow|flurr|blizzard/i;
const FREEZING_WORDS = /freezing (?:rain|drizzle)|ice storm|glaze/i;
const SLEET_WORDS = /sleet|ice pellets/i;
const WINTER_WORDS = /snow|flurr|sleet|wintry|blizzard|ice pellets|freezing (?:rain|drizzle)|ice storm/i;
const dateKey = (time, zone) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
};
function localMidnight(date, zone) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  for (let iteration = 0; iteration < 4; iteration++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const get = key => Number(parts.find(part => part.type === key)?.value);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const next = guess + target - wall;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}
const nextDate = date => new Date(Date.parse(`${date}T12:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10);
const stamp = value => {
  const text = String(value || '').trim();
  if (/^\d{12}$/.test(text)) return Date.UTC(+text.slice(0, 4), +text.slice(4, 6) - 1, +text.slice(6, 8), +text.slice(8, 10), +text.slice(10, 12));
  return Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
};
export function snowModelsUrl(location, zone) {
  return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), daily: 'snowfall_sum', models: 'ecmwf_ifs025,gfs_seamless', timezone: zone || 'auto', forecast_days: '10' })}`;
}
export function normalizeSnowModels(data) {
  const daily = data?.daily;
  if (!daily?.time) return null;
  const pick = key => (daily[key] || []).map(value => finite(value) ? value / CM_PER_IN : null);
  return { source: 'Open-Meteo', unit: 'in (converted from cm)', time: daily.time, ecmwf: pick('snowfall_sum_ecmwf_ifs025'), gfs: pick('snowfall_sum_gfs_seamless') };
}
const durationHours = value => {
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value || ''));
  return match ? Number(match[1] || 0) * 24 + Number(match[2] || 0) + Number(match[3] || 0) / 60 + Number(match[4] || 0) / 3600 : null;
};
/** NWS depth intervals are converted according to their declared units. */
function gridDepthIntervals(field) {
  if (!Array.isArray(field?.values)) return null;
  const unit = field.uom || 'wmoUnit:mm';
  const divisor = /(?:^|:)mm$/.test(unit) ? MM_PER_IN : /(?:^|:)cm$/.test(unit) ? CM_PER_IN : /(?:^|:)m$/.test(unit) ? .0254 : /(?:inch|in)$/.test(unit) ? 1 : null;
  if (!finite(divisor)) return null;
  return field.values.flatMap(row => {
    const [start, duration] = String(row.validTime || '').split('/'), time = Date.parse(start), hours = durationHours(duration);
    return finite(time) && finite(hours) && hours > 0 && finite(row.value) && row.value >= 0 ? [{ start: time, end: time + hours * HOUR, value: row.value / divisor }] : [];
  });
}
export function gridSnowHours(grid) {
  const intervals = gridDepthIntervals(grid?.snowfallAmount);
  if (!intervals) return null;
  return intervals.flatMap(row => {
    const hours = (row.end - row.start) / HOUR, result = [];
    for (let index = 0; index < hours; index++) result.push({ time: row.start + index * HOUR, inches: row.value / hours * Math.min(1, hours - index) });
    return result;
  });
}
function phaseAwareNwsIntervals(intervals,periods,phases,zone){
  return (intervals||[]).map(row=>{
    const covering=periods.filter(period=>Date.parse(period.startTime)<row.end&&Date.parse(period.endTime)>row.start).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
    if(row.value===0||!covering.some(period=>phases.get(period)?.timed))return {row,adjusted:false,windows:[{start:row.start,end:row.end}]};
    let through=row.start,gap=false;
    for(const period of covering){const a=Math.max(row.start,Date.parse(period.startTime)),b=Math.min(row.end,Date.parse(period.endTime));if(a>through)gap=true;through=Math.max(through,b);}
    const complete=!gap&&through>=row.end;
    const windows=covering.flatMap(period=>phases.get(period)?.windows||[]).map(window=>({start:Math.max(row.start,window.start),end:Math.min(row.end,window.end)})).filter(window=>window.end>window.start);
    const dates=new Set(windows.flatMap(window=>[dateKey(window.start,zone),dateKey(window.end-1,zone)]));
    return {row,adjusted:true,windows,uncertain:!complete,date:complete&&dates.size===1?[...dates][0]:null};
  });
}
function phaseAwareNwsDay(rows,start,end,date){
  // Coverage belongs to the original NWS intervals. A narrowed phase changes
  // which local day owns the WHOLE accumulation, never its published total.
  const base=rows.map(({row,adjusted})=>({...row,value:adjusted?0:row.value}));
  const integral=winterIntervalAmount(base,start,end);
  let minimum=base.filter(row=>row.end>start&&row.start<end).reduce((sum,row)=>sum+row.value*(Math.min(end,row.end)-Math.max(start,row.start))/(row.end-row.start),0),uncertain=false,phaseSignal=false;
  for(const source of rows.filter(source=>source.adjusted&&source.row.end>start&&source.row.start<end)){
    const {row,windows}=source,inside=windows.filter(window=>window.end>start&&window.start<end);
    if(source.uncertain){uncertain=true;phaseSignal||=inside.length>0;continue;}
    if(!windows.length){uncertain=true;continue;} // Quantity contradicts the phase wording.
    if(!inside.length)continue;
    phaseSignal=true;
    if(source.date===date&&windows.every(window=>window.start>=start&&window.end<=end))minimum+=row.value;
    else uncertain=true; // No published split across dates or elapsed/future snow hours.
  }
  return {...integral,value:!uncertain&&finite(integral.value)?minimum:null,minimum:uncertain?null:minimum,uncertain,phaseSignal};
}
export const WPC_WINTER_ROOT = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_prob_winter_precip/MapServer';
export const WPC_QPF_ROOT = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer';
const WPC_PAGE = 'https://www.wpc.ncep.noaa.gov/pwpf/wwd_prob_guidance.php';
export const WPC_LAYERS = [[1, 1, 4, 'snow'], [2, 1, 8, 'snow'], [3, 1, 12, 'snow'], [4, 1, .25, 'ice'], [6, 2, 4, 'snow'], [7, 2, 8, 'snow'], [8, 2, 12, 'snow'], [9, 2, .25, 'ice'], [11, 3, 4, 'snow'], [12, 3, 8, 'snow'], [13, 3, 12, 'snow'], [14, 3, .25, 'ice']];
export function wpcProbabilityRange(category) {
  const text = String(category || '');
  if (/high|70\s*[-–]\s*100/i.test(text)) return [70, 100];
  if (/moderate|40\s*[-–]\s*69/i.test(text)) return [40, 69];
  if (/slight|10\s*[-–]\s*39/i.test(text)) return [10, 39];
  return null;
}
function validWpcAttributes(attributes, now) {
  if (!attributes) return null;
  const values = Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key.toLowerCase(), value]));
  const start = stamp(values.start_time), end = stamp(values.end_time), issued = stamp(values.issue_time);
  if (![start, end, issued].every(finite) || end <= start || end <= now || issued > now + 15 * 60000 || now - issued > 36 * HOUR) return null;
  return { ...values, start: new Date(start).toISOString(), end: new Date(end).toISOString(), issued: new Date(issued).toISOString() };
}
export function createWpcWinterService({ cached, now = Date.now,fetchImpl }) {
  const expected=createWpcSnowAmountService({fetchImpl:fetchImpl||(()=>Promise.reject(new Error('WPC snow amount transport unavailable.'))),now});
  const load=async location => {
    const expectedTask=expected.load(location);
    const query = (root, layer, local) => {
      const params = new URLSearchParams({ f: 'json', where: '1=1', outFields: '*', returnGeometry: 'false', ...(local ? { geometry: `${location.longitude},${location.latitude}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' } : { resultRecordCount: '1' }) });
      return cached(`${root}/${layer}/query?${params}`, 30 * 60000, { timeout: 12000 });
    };
    const rows = await Promise.all(WPC_LAYERS.map(async ([layer, day, inches, kind]) => {
      try {
        const response = await query(WPC_WINTER_ROOT, layer, true);
        if (!Array.isArray(response.data?.features) || response.data?.error) throw new Error('WPC winter query unavailable.');
        const local = response.data.features.map(feature => validWpcAttributes(feature.attributes, now())).filter(Boolean).sort((a, b) => (Number(b.dn) || 0) - (Number(a.dn) || 0));
        let sample = local[0];
        if (!sample) {
          const global = await query(WPC_WINTER_ROOT, layer, false);
          sample = global.data?.features?.map(feature => validWpcAttributes(feature.attributes, now())).find(Boolean);
        }
        if (!sample) return null; // No current window available: never invent a dry forecast.
        const matched = local[0], probabilityRange = matched ? wpcProbabilityRange(matched.outlook) : null;
        return { day, inches, kind, layer, category: matched?.outlook || null, probabilityRange, start: sample.start, end: sample.end, issued: sample.issued, status: 'ready', belowPublishedCategories: !matched, fetchedAt: response.fetchedAt };
      } catch { return null; }
    }));
    const probabilities = rows.filter(Boolean);
    async function legend(root) {
      try {
        const result = await cached(`${root}/legend?f=json`, 6 * HOUR, { timeout: 12000 });
        return Object.fromEntries((result.data?.layers || []).map(layer => [layer.layerId, (layer.legend || []).map(symbol => ({ label: symbol.label, image: symbol.imageData && /^image\//.test(symbol.contentType || '') ? `data:${symbol.contentType};base64,${symbol.imageData}` : null }))]));
      } catch { return {}; }
    }
    const [winterLegend, qpfLegend] = await Promise.all([legend(WPC_WINTER_ROOT), legend(WPC_QPF_ROOT)]);
    const maps = probabilities.map(row => ({ id: `wpc-${row.kind}-day${row.day}-${row.inches}`, label: `WPC day ${row.day}: ${row.kind === 'snow' ? `${row.inches}+ inches of snow` : 'more than 0.25 inch of ice'}`, kind: 'arcgis', url: WPC_WINTER_ROOT, layers: [row.layer], unit: '%', sourceUrl: WPC_PAGE, start: row.start, end: row.end, legend: winterLegend[row.layer] || [], description: 'Published threshold probability categories: Slight 10–39%, Moderate 40–69%, High 70–100%. This is not an expected snow total.' }));
    const qpfMaps = await Promise.all([1, 2, 3].map(async day => {
      try {
        const response = await query(WPC_QPF_ROOT, day, false);
        const sample = response.data?.features?.map(feature => validWpcAttributes(feature.attributes, now())).find(Boolean);
        if (!sample) return null;
        return { id: `wpc-qpf-day${day}`, label: `WPC day ${day}: expected precipitation`, kind: 'arcgis', url: WPC_QPF_ROOT, layers: [day], unit: 'in', sourceUrl: 'https://www.wpc.ncep.noaa.gov/qpf/day1-3.shtml', start: sample.start, end: sample.end, legend: qpfLegend[day] || [], description: 'WPC precipitation forecast in inches of liquid equivalent, including melted snow and ice; this is not snowfall depth.' };
      } catch { return null; }
    }));
    maps.push(...qpfMaps.filter(Boolean));
    maps.push({ id: 'wpc-snow-totals-portal', label: 'WPC expected snow totals and ice amounts', kind: 'official-link', url: 'https://www.wpc.ncep.noaa.gov/Prob_Precip/', sourceUrl: 'https://www.wpc.ncep.noaa.gov/Prob_Precip/', description: 'Official WPC Probabilistic Precipitation Portal for expected amounts and uncertainty.' });
    const fetchedAt = probabilities.map(row => row.fetchedAt).filter(Boolean).sort().at(-1) || null;
    const amount=await expectedTask;
    return { value: { probabilities, amounts:amount.amounts, maps:[...amount.maps,...maps], amountStatus:amount.status, amountMessage:amount.message }, meta: { id: 'wpc-winter', label: 'WPC winter amounts and probability guidance', status: probabilities.length||amount.amounts.length ? 'ready' : 'unavailable', fetchedAt:fetchedAt||new Date(now()).toISOString(), issuedAt:amount.amounts[0]?.issuedAt||probabilities.map(row => row.issued).sort().at(-1) || null, url: WPC_PAGE, message:amount.status==='unavailable'?amount.message:null } };
  };
  load.map=expected.getMap;return load;
}
function peakProbability(source, kind, start, end) {
  const rows = source?.rows?.filter(row => row.time > start && row.time <= end) || [];
  const values = rows.map(row => row[kind]).filter(finite);
  const peak = values.length ? Math.max(...values) : null;
  return { value: peak, peakAt: finite(peak) ? new Date(rows.find(row => row[kind] === peak).time).toISOString() : null, availableHours: values.length, expectedHours: Math.ceil((end - start) / HOUR), status: values.length ? values.length === Math.ceil((end - start) / HOUR) ? 'ready' : 'partial' : 'unavailable' };
}
function snowfallWindow(start, end, winterModels, wpcAmounts, now) {
  const weights = winterWeights(new Date(start).toISOString(), now), values = {}, evidence = {};
  for (const id of Object.keys(weights)) {
    if (id === 'wpc') {
      const amount = wpcAmounts.find(row => Date.parse(row.start) === start && Date.parse(row.end) === end && finite(row.value));
      values[id] = amount?.value ?? null;
      evidence[id] = { source: 'WPC expected deterministic snowfall', message: amount?.method||'Compatible WPC snowfall depth is unavailable for this valid period; threshold probabilities are not amounts.',range:amount?.range||null,precision:amount?.precision||null,sourceUrl:amount?.sourceUrl||null,runAt:amount?.issuedAt||null };
    } else if (id === 'weathernext') {
      values[id] = null;
      evidence[id] = { source: 'Google WeatherNext', message: 'The available WeatherNext feed publishes total precipitation, without snowfall depth or precipitation-type probabilities. Its winter share is unavailable.' };
    } else {
      const model = winterModels?.[id], integrated = winterIntervalAmount(model?.intervals, start, end);
      values[id] = integrated.value; evidence[id] = { source: model?.label || id.toUpperCase(), runAt: model?.runAt || null, validUntil: model?.validUntil || null, coveredHours: integrated.coveredHours, expectedHours: integrated.expectedHours, message: finite(integrated.value) ? null : 'Model does not cover every hour of this interval.' };
    }
  }
  const amount = blendWinterAmounts(values, weights);
  amount.value = round(amount.value, 2);
  const wpc=evidence.wpc;
  if(wpc?.range&&finite(amount.value)){
    const share=amount.actualWeights.wpc/100;
    amount.range=[round(amount.value,2),finite(wpc.range[1])?round(amount.value+share*(wpc.range[1]-wpc.range[0]),2):null];
    amount.precision='WPC contributes published snowfall contour lower bounds; the range propagates its contour band using the same actual weights. Other model values are same-period point amounts.';
  }
  amount.sources = amount.sources.map(row => ({ ...row, ...evidence[row.id], actualWeight: amount.actualWeights[row.id], status: finite(row.value) ? 'ready' : 'unavailable' }));
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), mode: 'hrrr' in weights ? 'nearTerm' : 'extended', snowfall: amount };
}
export function addSnowOutlook(output, { grid, periods = [], snowModels, winterModels = {}, wpcWinter, now = Date.now() }) {
  const forecastStart = Math.ceil(now / HOUR) * HOUR;
  const zone = output.location?.timeZone || 'America/New_York', gridHours = gridSnowHours(grid), gridIntervals = gridDepthIntervals(grid?.snowfallAmount);
  const snowPhases = new Map(periods.map(period => [period,nwsSnowPhaseWindows(period,zone)]));
  const nwsIntervals=phaseAwareNwsIntervals(gridIntervals,periods,snowPhases,zone);
  const wpcRows = Array.isArray(wpcWinter) ? wpcWinter : wpcWinter?.probabilities || [], wpcAmounts = wpcWinter?.amounts || [];
  const nbm = winterModels?.probabilities, wssi = (output.riskOutlooks || []).find(row => row.kind === 'wssi') || null;
  if (gridHours) for (const hour of output.hours || []) {
    const row = gridHours.find(row => row.time === Date.parse(hour.time));
    const time=Date.parse(hour.time),timed=periods.filter(period=>snowPhases.get(period)?.timed&&Date.parse(period.startTime)<time+HOUR&&Date.parse(period.endTime)>time);
    const narrowed=nwsIntervals.filter(source=>source.adjusted&&source.row.start<time+HOUR&&source.row.end>time);
    const phaseCompatible=narrowed.length?narrowed.some(source=>source.windows.some(window=>window.end>time&&window.start<time+HOUR)):timed.some(period=>snowPhases.get(period).windows.some(window=>window.end>time&&window.start<time+HOUR));
    hour.snowfallRaw = row ? round(row.inches,2) : null;
    // A coarse interval is not an hourly accumulation once its explicit snow
    // phase narrows. Keep its raw diagnostic, and avoid a made-up hourly split.
    hour.snowfall = timed.length||narrowed.length ? (narrowed.some(source=>source.uncertain)?null:!phaseCompatible?0:row?.inches>0?null:row?0:null) : row ? round(row.inches, 2) : null;
  }
  const published=wpcAmounts.filter(row=>finite(row.value)&&Date.parse(row.start)>=forecastStart&&Date.parse(row.end)>Date.parse(row.start)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  const aligned=[];let through=-Infinity;
  for(const row of published){if(Date.parse(row.start)<through)continue;aligned.push(row);through=Date.parse(row.end);}
  const blendWindows=aligned.length?aligned.map(row=>snowfallWindow(Date.parse(row.start),Date.parse(row.end),winterModels,wpcAmounts,forecastStart)):[snowfallWindow(forecastStart, forecastStart + 24 * HOUR, winterModels, wpcAmounts, forecastStart)];
  let blendedThrough=Math.max(...blendWindows.map(window=>Date.parse(window.end)));
  const rows = (output.days || []).slice(0, 7).filter(day => day.date).map((day, index) => {
    const midnight = localMidnight(day.date, zone), end = localMidnight(nextDate(day.date), zone), start = Math.max(forecastStart, midnight);
    const matchingPeriods = periods.filter(period => finite(Date.parse(period.startTime)) && Date.parse(period.endTime || period.startTime) > start && Date.parse(period.startTime) < end);
    const per = matchingPeriods.map(period => {
      const wording = `${period.shortForecast || ''} ${period.detailedForecast || ''}`;
      const phase=snowPhases.get(period),phaseWindows=(phase?.windows||[]).filter(row => row.end>start&&row.start<end).map(row=>({start:new Date(Math.max(start,row.start)).toISOString(),end:new Date(Math.min(end,row.end)).toISOString()}));
      const hasValidPeriod=finite(Date.parse(period.endTime))&&Date.parse(period.endTime)>Date.parse(period.startTime);
      return { name: period.name, isDaytime: period.isDaytime, start: period.startTime, end: period.endTime, wording: period.shortForecast || '', detail: period.detailedForecast || '', snowWording: SNOW_WORDS.test(wording)&&(!hasValidPeriod||phaseWindows.length>0), snowTimed:!!phase?.timed, snowPhaseWindows:phaseWindows, freezingRainWording: FREEZING_WORDS.test(wording), sleetWording: SLEET_WORDS.test(wording), winterWording: WINTER_WORDS.test(wording), pop: finite(period.probabilityOfPrecipitation?.value) ? period.probabilityOfPrecipitation.value : null };
    });
    const inDay = time => dateKey(time, zone) === day.date, gh = gridHours?.filter(row => inDay(row.time)) || [];
    const officialIntegral = phaseAwareNwsDay(nwsIntervals,start,end,day.date);
    // Preserve historical NWS calendar-day diagnostics; complete coverage is
    // separately recorded, so an incomplete accumulation isn't called a full total.
    const nws = gh.length ? gh.reduce((sum, row) => sum + row.inches, 0) : null;
    const modelIndex = snowModels?.time?.indexOf(day.date) ?? -1;
    const alignedValues = [officialIntegral.value].filter(finite);
    const modelValues = Object.fromEntries(['ecmwf', 'gfs', 'hrrr', 'nam'].map(id => {
      const integrated = winterIntervalAmount(winterModels?.[id]?.intervals, start, end);
      if (finite(integrated.value)) alignedValues.push(integrated.value);
      else if (start === midnight && modelIndex >= 0 && finite(snowModels?.[id]?.[modelIndex])) alignedValues.push(snowModels[id][modelIndex]);
      return [id, finite(integrated.value) ? integrated.value : modelIndex >= 0 && (id === 'ecmwf' || id === 'gfs') ? snowModels[id]?.[modelIndex] ?? null : null];
    }));
    const values = [nws, ...Object.values(modelValues)].filter(finite), low = values.length ? Math.min(...values) : null, high = values.length ? Math.max(...values) : null;
    const wpc = wpcRows.filter(row => finite(Date.parse(row.start)) && finite(Date.parse(row.end)) && Date.parse(row.end) > now && inDay((Date.parse(row.start) + Date.parse(row.end)) / 2));
    const probs = Object.fromEntries(['snow', 'freezingRain', 'sleet'].map(kind => [kind, peakProbability(nbm, kind, start, end)]));
    const snowHours = (gridHours || []).filter(row => row.inches > 0 && row.time < end && row.time + HOUR > start).filter(row => {
      const hour = (output.hours || []).find(hour => Date.parse(hour.time) === row.time);
      // Coarse depth intervals can straddle a change from rain to snow. An
      // explicit rain/clear hourly forecast must not move the snow event.
      return !hour?.condition || SNOW_WORDS.test(hour.condition);
    }).flatMap(row=>{
      const timed=per.filter(period=>period.snowTimed&&Date.parse(period.start)<row.time+HOUR&&Date.parse(period.end)>row.time);
      const windows=timed.length?timed.flatMap(period=>period.snowPhaseWindows):[{start:new Date(row.time).toISOString(),end:new Date(row.time+HOUR).toISOString()}];
      return windows.map(window=>({start:Math.max(start,row.time,Date.parse(window.start)),end:Math.min(end,row.time+HOUR,Date.parse(window.end))})).filter(window=>window.end>window.start);
    });
    const eventIntervals = snowHours.length
      ? snowHours.map(row => ({ ...row, source: 'NWS snow hours' }))
      : per.filter(row => row.snowWording).flatMap(row=>row.snowPhaseWindows.map(window=>({start:Date.parse(window.start),end:Date.parse(window.end),source:row.snowTimed?'NWS timed snow forecast':'NWS snow forecast period'})));
    if (!eventIntervals.length && (probs.snow.value ?? 0) >= 10 && probs.snow.peakAt) {
      const peak = Date.parse(probs.snow.peakAt);
      eventIntervals.push({ start: Math.max(start,peak-HOUR), end: Math.min(end,peak), source: 'NWS NBM peak snow hour' });
    }
    const snowEventWindows = eventIntervals.filter(row => row.end > row.start).sort((a,b) => a.start-b.start).reduce((rows,row) => {
      const last=rows.at(-1);
      if(last && last.source===row.source && row.start<=last.end)last.end=Math.max(last.end,row.end);else rows.push({...row});
      return rows;
    }, []).map(row => ({ ...row, start: new Date(row.start).toISOString(), end: new Date(row.end).toISOString() }));
    const modelRows = Object.values(winterModels).filter(model => Array.isArray(model?.intervals)).flatMap(model => model.intervals.filter(row => row.end > start && row.start < end));
    const expectedWpc=wpcAmounts.filter(row=>Date.parse(row.end)>start&&Date.parse(row.start)<end);
    const snowExpected = per.some(row => row.snowWording) || alignedValues.some(value => value >= .1) || (officialIntegral.minimum??0) >= .1 || officialIntegral.phaseSignal || (probs.snow.value ?? 0) >= 10 || expectedWpc.some(row=>row.value>=.1) || wpc.some(row => (row.kind || 'snow') === 'snow' && (row.probabilityRange || wpcProbabilityRange(row.category))?.[0] >= 10);
    const freezingRainPossible = per.some(row => row.freezingRainWording) || (probs.freezingRain.value ?? 0) >= 10 || modelRows.some(row => row.freezingRainSignal === true || [56, 57, 66, 67].includes(row.weatherCode)) || wpc.some(row => row.kind === 'ice' && (row.probabilityRange || wpcProbabilityRange(row.category))?.[0] >= 10);
    const sleetPossible = per.some(row => row.sleetWording) || (probs.sleet.value ?? 0) >= 10;
    const windows = start < end ? (start < forecastStart + 24 * HOUR && end > forecastStart + 24 * HOUR ? [[start, forecastStart + 24 * HOUR], [forecastStart + 24 * HOUR, end]] : [[start, end]]).map(([a, b]) => snowfallWindow(a, b, winterModels, wpcAmounts, forecastStart)) : [];
    for(const window of windows.filter(window=>window.mode==='extended')){
      const from=Math.max(blendedThrough,Date.parse(window.start)),to=Date.parse(window.end);
      if(to<=from)continue;
      blendWindows.push(snowfallWindow(from,to,winterModels,wpcAmounts,forecastStart));blendedThrough=to;
    }
    const blended = windows.length && windows.every(window => finite(window.snowfall.value)) ? windows.reduce((sum, window) => sum + window.snowfall.value, 0) : null;
    const hasEvidence = matchingPeriods.length > 0 || finite(officialIntegral.value) || Object.values(modelValues).some(finite) || Object.values(probs).some(prob => finite(prob.value));
    const coverageStatus = !hasEvidence ? 'unavailable' : Object.values(probs).every(prob => prob.status === 'ready') && windows.every(window => window.snowfall.status === 'ready') ? 'ready' : 'partial';
    const alignedLow = alignedValues.length ? Math.min(...alignedValues) : null, alignedHigh = alignedValues.length ? Math.max(...alignedValues) : null;
    const best = finite(blended) ? round(blended) : finite(officialIntegral.value) ? round(officialIntegral.value) : alignedValues.length ? round((alignedLow + alignedHigh) / 2) : null;
    // The simple Snow view uses the NWS point forecast for this exact local-day
    // interval. Legacy nwsSnowfall includes elapsed hours today and is a
    // diagnostic, not the remaining-day total. Never use a WPC 12Z-to-12Z
    // accumulation as if it were a local calendar-day amount.
    const exactWpcBlend = windows.length === 1 && windows[0].snowfall.sources?.some(source => source.id === 'wpc' && finite(source.value));
    const displaySnowfall = finite(officialIntegral.value)
      ? { value: round(officialIntegral.value, 3), range: null, source: 'NWS point forecast', status: 'ready' }
      : officialIntegral.uncertain && !finite(blended)
        ? { value: null, range: null, source: 'NWS daily snowfall amount uncertain', status: 'unavailable' }
      : (officialIntegral.minimum??0)>0
        ? { value: round(officialIntegral.minimum,3), range: [round(officialIntegral.minimum,3),null], source: 'NWS partial point forecast', status: 'partial' }
      : exactWpcBlend && finite(blended)
        ? { value: round(blended), range: windows[0].snowfall.range || null, source: 'Winter snowfall blend', status: windows[0].snowfall.status }
        : finite(blended)
          ? { value: round(blended), range: null, source: 'Available model guidance', status: 'partial' }
          : { value: null, range: null, source: null, status: 'unavailable' };
    Object.assign(displaySnowfall, { unit: 'in', start: new Date(start).toISOString(), end: new Date(end).toISOString(), remainingDay: start > midnight, nwsCoveredHours: officialIntegral.coveredHours, expectedHours: officialIntegral.expectedHours });
    const probabilityCoverage = Object.fromEntries(Object.entries(probs).map(([kind, probability]) => [kind, { status: probability.status, availableHours: probability.availableHours, expectedHours: probability.expectedHours, peakAt: probability.peakAt }]));
    return { date: day.date, label: day.label, index, periods: per.filter(row => row.winterWording),
      // This PoP is chance of ANY precipitation while snow is mentioned, not snow-only chance.
      nwsSnowPop: per.filter(row => row.snowWording && finite(row.pop)).reduce((value, row) => value == null ? row.pop : Math.max(value, row.pop), null),
      nwsSnowPopLabel: 'NWS chance of precipitation in a period mentioning snow', nwsSnowfall: round(nws), nwsCovered: finite(officialIntegral.value),
      nwsAmountUncertain:officialIntegral.uncertain,
      nwsRawIntervals:(gridIntervals||[]).filter(row=>row.end>start&&row.start<end).map(row=>({start:new Date(row.start).toISOString(),end:new Date(row.end).toISOString(),value:round(row.value,3),unit:'in'})),
      models: { ecmwf: round(modelValues.ecmwf), gfs: round(modelValues.gfs) }, nearTermModels: { hrrr: round(modelValues.hrrr), nam: round(modelValues.nam) },
      range: alignedValues.length > 1 && alignedHigh - alignedLow >= .5 ? [round(alignedLow), round(alignedHigh)] : null,
      calendarRange: values.length > 1 && high - low >= .5 ? [round(low), round(high)] : null, best,
      amountSource: finite(blended) ? 'Experimental requested winter amount blend' : finite(officialIntegral.value) ? 'NWS snowfall guidance' : alignedValues.length ? 'Available same-interval model amount guidance' : 'Unavailable',
      amountWindow: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      displaySnowfall,
      snowEventWindows,
      blend: windows.length === 1 ? { ...windows[0].snowfall, mode: windows[0].mode, window: { start: windows[0].start, end: windows[0].end } } : { mode: 'split', windows, coverage: windows.length ? Math.min(...windows.map(window => window.snowfall.coverage)) : 0, status: windows.some(window => window.snowfall.status !== 'unavailable') ? 'partial' : 'unavailable' },
      wpc: wpc.map(row => ({ ...row, kind: row.kind || 'snow', probabilityRange: row.probabilityRange || wpcProbabilityRange(row.category) })),
      snowChance: round(probs.snow.value, 0), freezingRainChance: round(probs.freezingRain.value, 0), sleetChance: round(probs.sleet.value, 0),
      probabilitySource: nbm ? 'NWS NBM' : null, probabilityMethod: nbm?.method || 'Precipitation-type probabilities are unavailable; generic precipitation chance and deterministic model signals are not substituted.', probabilityWindow: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, probabilityCoverage,
      snowExpected, snowPossible: snowExpected, freezingRainPossible, sleetPossible,
      possible: snowExpected || freezingRainPossible || sleetPossible || per.some(row => row.winterWording), coverageStatus,
      typeSignals: { snow: snowExpected ? 'Snow appears in winter guidance' : coverageStatus === 'unavailable' ? 'Snow guidance unavailable' : 'No snow signal in available guidance', freezingRain: freezingRainPossible ? 'Freezing rain appears in winter guidance' : coverageStatus === 'unavailable' ? 'Freezing rain guidance unavailable' : 'No freezing-rain signal in available guidance', sleet: sleetPossible ? 'Sleet appears in winter guidance' : coverageStatus === 'unavailable' ? 'Sleet guidance unavailable' : 'No sleet signal in available guidance' },
      confidence: index >= 3 ? (snowExpected ? 'Low chance, far out' : 'Low confidence, far out') : 'Near term' };
  });
  const known = rows.filter(row => row.coverageStatus !== 'unavailable').length;
  const status = known === 0 ? 'unavailable' : rows.every(row => row.coverageStatus === 'ready') ? 'ready' : 'partial';
  const sum = key => { const values = rows.map(key).filter(finite); return values.length ? round(values.reduce((total, value) => total + value, 0)) : null; };
  output.snow = { version: SNOW_VERSION, status, coverageStatus: status, possible: rows.some(row => row.possible) || !!wssi, snowExpected: rows.some(row => row.snowExpected), days: rows, wssi, blendWindows,
    weights: WINTER_WEIGHTS, maps: [...rows.map(row=>modelSnowMapDescriptor(row,output.location)).filter(Boolean),...(Array.isArray(wpcWinter?.maps) ? wpcWinter.maps : [])],
    stormTotal: { nws: sum(row => row.nwsSnowfall), ecmwf: sum(row => row.models.ecmwf), gfs: sum(row => row.models.gfs) },
    sources: { nwsGrid: !!gridIntervals?.length, nwsGridThrough: gridIntervals?.length ? new Date(Math.max(...gridIntervals.map(row => row.end))).toISOString() : null, models: Object.values(winterModels).some(model => Array.isArray(model?.intervals)) || !!snowModels, wpcWinter: wpcRows.length > 0, wpcAmounts: wpcAmounts.length > 0, nbm: !!nbm, weathernextWinter: false },
    notes: 'Snow amounts and type probabilities are separate. Within 24 hours: WPC 60%, HRRR 25%, NAM 15%; later: WPC 60%, ECMWF 20%, WeatherNext 10%, GFS 10%. WPC expected deterministic snowfall uses its published 24-hour contour periods and conservative contour lower bounds, with contour uncertainty propagated. HRRR, NAM, ECMWF and GFS are integrated over exactly those periods. No hourly WPC allocation is invented. Calendar-day guidance remains separate when periods differ. Missing shares are shown and available amount weights normalized. WPC threshold probabilities are not snowfall amounts. WeatherNext winter phase may be unavailable. NWS NBM supplies supplemental native type probabilities as peak hourly chance, never a combined daily chance. Forecast amounts can change with snow-to-liquid ratios.' };
  for (const row of rows) {
    const day = output.days.find(day => day.date === row.date);
    if (day) { day.snowfall = row.best; day.snowRange = row.range; day.snowPossible = row.snowExpected; day.freezingRainPossible = row.freezingRainPossible; day.sleetPossible = row.sleetPossible; }
  }
  return output;
}
