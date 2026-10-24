/** Personal experiments use only the selected location's existing hourly evidence.
 * This module never fetches a model, fills a gap, or writes the published forecast. */
import {calendarDayWindow} from './calendar-day.js?v=calendar-days-v1';
import {dailyForecastReadings} from './seven-day.js?v=low-rain-display-v1';
import {humidityFromDewpoint,tier3FeelsLike,solarElevation} from './weather-math.js?v=current-rain-20261017-v3';
const HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const epoch = value => { const time = Date.parse(value); return finite(time) ? time : null; };
const valid = (value, metric) => finite(value) && (['rain','humidity','cloud'].includes(metric) ? value >= 0 && value <= 100 : ['amount','snow','wind','gust','visibility','uv','aqi'].includes(metric) ? value >= 0 : metric==='pressure'?value>0:true);

export const CUSTOM_FORECAST_METRICS=Object.freeze([
  {id:'high',label:'Daily high temperature',field:'temperature',aggregation:'max',unit:'°F',digits:0},
  {id:'low',label:'Daily low temperature',field:'temperature',aggregation:'min',unit:'°F',digits:0},
  {id:'feels',label:'Highest estimated feels like',field:'feels',aggregation:'max',unit:'°F',digits:0},
  {id:'feelsLow',label:'Lowest estimated feels like',field:'feels',aggregation:'min',unit:'°F',digits:0},
  {id:'feelsShade',label:'Highest estimated shade feels like',field:'feelsShade',aggregation:'max',unit:'°F',digits:0},
  {id:'feelsSun',label:'Highest estimated direct-sun feels like',field:'feelsSun',aggregation:'max',unit:'°F',digits:0,eligible:'daylight'},
  {id:'rain',label:'Peak hourly rain chance',field:'rain',aggregation:'max',unit:'%',digits:0},
  {id:'amount',label:'Total precipitation',field:'amount',aggregation:'sum',unit:'in',digits:2},
  {id:'wind',label:'Mean wind speed',field:'wind',aggregation:'mean',unit:'mph',digits:1},
  {id:'gust',label:'Peak wind gust',field:'gust',aggregation:'max',unit:'mph',digits:0},
  {id:'dewpoint',label:'Mean dew point',field:'dewpoint',aggregation:'mean',unit:'°F',digits:0},
  {id:'humidity',label:'Mean estimated humidity',field:'humidity',aggregation:'mean',unit:'%',digits:0},
  {id:'cloud',label:'Mean cloud cover',field:'cloud',aggregation:'mean',unit:'%',digits:0},
  {id:'uv',label:'Peak UV index',field:'uv',aggregation:'max',unit:'UV index',digits:1},
  {id:'snow',label:'Total snowfall',field:'snow',aggregation:'sum',unit:'in',digits:1},
  {id:'aqi',label:'Peak air quality index',field:'aqi',aggregation:'max',unit:'US AQI',digits:0},
  {id:'visibility',label:'Mean visibility',field:'visibility',aggregation:'mean',unit:'mi',digits:1},
  {id:'pressure',label:'Mean air pressure',field:'pressure',aggregation:'mean',unit:'inHg',digits:3},
]);
const extraFields=['feels','feelsShade','feelsSun','wind','gust','dewpoint','humidity','cloud','uv','aqi','visibility','pressure'];

export const CUSTOM_FORECAST_MODELS = Object.freeze([
  { id: 'nws', label: 'NWS', description: 'Official National Weather Service', color: '#89ddff' },
  { id: 'hrrr', label: 'HRRR', description: 'Short-range high-resolution model', color: '#ffbd8a' },
  { id: 'nam', label: 'NAM', description: 'North American Mesoscale model', color: '#feb2d3' },
  { id: 'nbm', label: 'NBM', description: 'National Blend of Models', color: '#8cefc8' },
  { id: 'ecmwf', label: 'ECMWF', description: 'European forecast model', color: '#c7acff' },
  { id: 'wn', label: 'NVIDIA WeatherNext', description: 'AI weather model', color: '#ffe395' },
  { id: 'gfs', label: 'GFS', description: 'Global Forecast System', color: '#93b3ff' },
]);

const allowed = new Set(CUSTOM_FORECAST_MODELS.map(model => model.id));
const knownMap = (map, metric) => Object.fromEntries(Object.entries(map || {}).filter(([id, value]) => allowed.has(id) && valid(value, metric)));
function sourceMap(evidence, metric) {
  const output = knownMap(evidence?.sourceValues, metric);
  for (const source of evidence?.sources || []) {
    // An explicit null in sourceValues means this interval is incomplete.
    if (!Object.hasOwn(evidence?.sourceValues || {}, source.id) && allowed.has(source.id) && valid(source.value, metric)) output[source.id] = source.value;
  }
  return output;
}

/** Snow is already a dated accumulation product. Never reinterpret a WPC
 * threshold/12Z map, elapsed diagnostic, or full-day fallback as remaining snow. */
function snowCalendarProduct(forecast,day,now,zone){
  const row=forecast?.snow?.days?.find(item=>item.date===day.date),empty={baseline:null,sources:{},window:null};
  if(!row)return empty;
  const product=row.displaySnowfall,period=row.amountWindow||product;
  const start=epoch(period?.start),end=epoch(period?.end),midnight=calendarDayWindow({date:day.date},1,now,zone).start;
  if(start===null||end!==day.temperatureWindow.end||end<=start||start<midnight||(!day.today&&start!==midnight)||(day.today&&(start<now||start>Math.ceil(now/HOUR)*HOUR)))return empty;
  const window={start,end},sources={};
  const sameProduct=epoch(product?.start)===start&&epoch(product?.end)===end;
  const baseline=sameProduct&&valid(product?.value,'snow')?product.value:null;
  if(row.nwsCovered===true&&product?.source==='NWS point forecast'&&product?.status==='ready'&&finite(baseline))sources.nws=baseline;
  for(const id of ['hrrr','nam'])if(valid(row.nearTermModels?.[id],'snow'))sources[id]=row.nearTermModels[id];
  const coveredBlendSource=id=>{
    const parts=row.blend?.mode==='split'?row.blend.windows||[]:[{...window,snowfall:row.blend}];
    let cursor=start,total=0;
    for(const part of parts){
      const a=typeof part.start==='number'?part.start:epoch(part.start),b=typeof part.end==='number'?part.end:epoch(part.end);
      const source=(part.snowfall?.sources||[]).find(item=>item.id===id);
      if(a!==cursor||!finite(b)||b<=a||!valid(source?.value,'snow')||source.status!=='ready'||!finite(source.coveredHours)||!finite(source.expectedHours)||source.expectedHours<=0||source.coveredHours<source.expectedHours||source.coveredHours*HOUR<b-a)return null;
      total+=source.value;cursor=b;
    }
    return cursor===end?total:null;
  };
  for(const id of ['ecmwf','gfs']){
    if(start===midnight&&valid(row.models?.[id],'snow'))sources[id]=row.models[id];
    else{const verified=coveredBlendSource(id);if(verified!==null)sources[id]=verified;}
  }
  return {baseline,sources,window};
}

export function normalizeCustomWeights(weights = {}) {
  const chosen = Object.entries(weights).filter(([id, weight]) => allowed.has(id) && finite(weight) && weight > 0);
  const sum = chosen.reduce((total, [, weight]) => total + weight, 0);
  if (!sum) return {};
  return allocate(chosen,100);
}

/** Largest remainders keep the actual calculation and the displayed sliders identical. */
function allocate(entries,total) {
  const sum = entries.reduce((result,[,value])=>result+value,0);
  if (!sum || !total) return {};
  const rows = entries.map(([id,value],index)=>({id,index,exact:value/sum*total,value:Math.floor(value/sum*total)}));
  let remaining = total-rows.reduce((result,row)=>result+row.value,0);
  const ranked = [...rows].sort((a,b)=>(b.exact-b.value)-(a.exact-a.value)||a.index-b.index);
  for (let index=0;index<remaining;index++) ranked[index].value++;
  return Object.fromEntries(rows.filter(row=>row.value>0).map(row=>[row.id,row.value]));
}

/** Keep the edited percentage, sharing the remaining percentage among enabled models. */
export function changeCustomWeight(weights, id, value) {
  if (!allowed.has(id) || !finite(value)) return normalizeCustomWeights(weights);
  const next = normalizeCustomWeights(weights);
  const others = Object.keys(next).filter(key => key !== id);
  if (!others.length) return { [id]: 100 };
  const requested = Math.round(Math.max(0, Math.min(100, value)));
  return { ...(requested ? {[id]:requested} : {}), ...allocate(others.map(key=>[key,next[key]]),100-requested) };
}

export function toggleCustomModel(weights, id, enabled) {
  if (!allowed.has(id)) return normalizeCustomWeights(weights);
  const next = { ...weights };
  if (!enabled) { delete next[id]; return normalizeCustomWeights(next); }
  if (finite(next[id]) && next[id] > 0) return normalizeCustomWeights(next);
  const normalized = normalizeCustomWeights(next);
  return Object.keys(normalized).length ? changeCustomWeight({ ...normalized, [id]: 0 }, id, 20) : { [id]: 100 };
}

export function customForecastInput(forecast, now = Date.now()) {
  const location = forecast?.location || {};
  const timeZone = location.timeZone || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const get = key => parts.find(part=>part.type===key).value;
  const today = `${get('year')}-${get('month')}-${get('day')}`;
  const publishedDays = dailyForecastReadings(forecast || {},now,14);
  const calendarDays = Array.from({length:7},(_,index)=>{
    const date = new Date(Date.parse(`${today}T12:00:00Z`)+index*24*HOUR).toISOString().slice(0,10);
    const temperatureWindow = calendarDayWindow({date},index,now,timeZone);
    const published = publishedDays.find(day=>day.date===date);
    const sourceDay = (forecast?.days || []).find(day=>day.date===date);
    const sourceIndex = (forecast?.days || []).indexOf(sourceDay);
    const publishedTemperatureWindow = sourceDay ? calendarDayWindow(sourceDay,sourceIndex,now,timeZone) : null;
    const sameTemperatureWindow = publishedTemperatureWindow?.start===temperatureWindow.start && publishedTemperatureWindow?.end===temperatureWindow.end;
    const rainWindow = published?.windWindow && published.windWindow.start>=calendarDayWindow({date},1,now,timeZone).start && published.windWindow.end===temperatureWindow.end
      ? {...published.windWindow} : {...temperatureWindow,start:index===0?Math.max(temperatureWindow.start,now):temperatureWindow.start};
    if(index===0)rainWindow.start=Math.max(now,rainWindow.start);
    const sameRainWindow=!!published?.windWindow&&published.windWindow.start===rainWindow.start&&published.windWindow.end===rainWindow.end;
    const label = index===0 ? 'Remaining today' : new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(`${date}T12:00:00Z`));
    return {date,label,today:index===0,temperatureWindow,rainWindow,pairedRemainingAmount:!!published&&!sameRainWindow,
      observed:published?.observed===true,
      baseline:{high:sameTemperatureWindow&&finite(published?.high)?published.high:null,low:sameTemperatureWindow&&finite(published?.low)?published.low:null,amount:finite(published?.amount)?published.amount:null,rain:valid(published?.pop,'rain')?published.pop:null},
    };
  });
  const earliest = Math.min(now,...calendarDays.map(day=>day.rainWindow.start).filter(finite));
  const horizon = calendarDays.at(-1).temperatureWindow.end;
  const rows = new Map();
  const accept = row => {
    const time = epoch(row?.time);
    return time !== null && time + HOUR > earliest && time < horizon ? time : null;
  };
  for (const row of forecast?.rainTimeline || []) {
    const time = accept(row);
    // A multi-hour total must not be presented as a single hour's rainfall.
    if (time !== null && epoch(row.end) === time + HOUR) rows.set(time, { rain: row });
  }
  for (const row of forecast?.hours || []) {
    const time = accept(row);
    if (time !== null) {
      const previous = rows.get(time) || {};
      rows.set(time, { ...previous, hour: row, rain: previous.rain || ((row.end == null || epoch(row.end) === time + HOUR) ? row : null) });
    }
  }
  for (const row of forecast?.metricForecasts?.series?.temperature || []) {
    const time = accept(row);
    if (time !== null) rows.set(time, { ...(rows.get(time) || {}), temperature: row });
  }
  for(const field of extraFields)for(const row of forecast?.metricForecasts?.series?.[field]||[]){
    const time=accept(row);if(time===null)continue;
    const previous=rows.get(time)||{};
    rows.set(time,{...previous,fields:{...previous.fields,[field]:row}});
  }
  for(const [field,series] of [['uv',forecast?.uv?.hourly],['aqi',forecast?.airQuality?.hours]])for(const point of series||[]){
    const time=accept(point);if(time===null)continue;
    const previous=rows.get(time)||{},row=field==='aqi'?{...point,value:point.aqi}:point;
    if(previous.fields?.[field])continue;
    rows.set(time,{...previous,fields:{...previous.fields,[field]:row}});
  }
  const times = [...rows.keys()].sort((a, b) => a - b);
  const hours = [];
  // Insert missing clock hours so charts and totals cannot conceal a gap.
  for (let time = times[0]; finite(time) && time <= times.at(-1); time += HOUR) {
    const { hour, rain, temperature: temperatureRow,fields={} } = rows.get(time) || {};
    const temperature = { ...sourceMap(temperatureRow, 'temperature'), ...sourceMap(hour?.temperatureBlend, 'temperature') };
    if (!Object.hasOwn(temperature, 'nws') && valid(hour?.officialTemperature, 'temperature')) temperature.nws = hour.officialTemperature;
    const amount = sourceMap(rain?.precipitationBlend, 'amount');
    const official = rain?.officialPop ?? rain?.rainLikelihood?.officialProbability ?? hour?.officialPop;
    const rainProbability = valid(official, 'rain') ? official : null;
    const publishedRain = rain?.rainLikelihood?.value ?? rain?.pop;
    const sourceFields=Object.fromEntries(extraFields.map(field=>[field,sourceMap(fields[field],field)]));
    const baselineFields=Object.fromEntries(extraFields.map(field=>[field,valid(fields[field]?.value,field)?fields[field].value:null]));
    // The thermal series retains timestamp-matched cloud-source evidence beyond
    // the short cloud display strip. It is still each model's own value.
    for(const source of fields.feels?.inputs?.skySources||[])if(allowed.has(source.id)&&valid(source.value,'cloud')&&!Object.hasOwn(sourceFields.cloud,source.id))sourceFields.cloud[source.id]=source.value;
    if(!finite(baselineFields.cloud)&&valid(fields.feels?.inputs?.skyCover,'cloud'))baselineFields.cloud=fields.feels.inputs.skyCover;
    const elevation=finite(location.latitude)&&finite(location.longitude)?solarElevation(time,location.latitude,location.longitude):null;
    const daylight=finite(elevation)?elevation>0:typeof fields.feelsSun?.daylight==='boolean'?fields.feelsSun.daylight:null;
    const radiantCloud=valid(fields.feels?.inputs?.skyCover,'cloud')?fields.feels.inputs.skyCover:baselineFields.cloud;
    const baselineSunApplicable=daylight===false?false:daylight===true&&finite(radiantCloud)?radiantCloud<=62:daylight===true&&finite(baselineFields.feelsSun)?true:null;
    const modelSunApplicable={};
    for(const id of CUSTOM_FORECAST_MODELS.map(model=>model.id)){
      const t=temperature[id],dew=sourceFields.dewpoint[id],wind=sourceFields.wind[id],cloud=sourceFields.cloud[id];
      const humidity=valid(t,'temperature')&&valid(dew,'dewpoint')?humidityFromDewpoint(t,dew):null;
      if(!Object.hasOwn(sourceFields.humidity,id)&&valid(humidity,'humidity'))sourceFields.humidity[id]=humidity;
      modelSunApplicable[id]=daylight===false?false:daylight===true&&valid(cloud,'cloud')?cloud<=62:null;
      if(!finite(humidity)||!valid(wind,'wind')||!valid(cloud,'cloud')||!finite(location.latitude)||!finite(location.longitude))continue;
      const own={temperature:t,dewpoint:dew,humidity,wind,skyCover:cloud,time:new Date(time).toISOString(),type:'guidance'};
      const outdoor=tier3FeelsLike(own,location,time,'outdoors').value,shade=tier3FeelsLike(own,location,time,'shade').value;
      if(!Object.hasOwn(sourceFields.feels,id)&&finite(outdoor))sourceFields.feels[id]=Number(outdoor.toFixed(1));
      if(!Object.hasOwn(sourceFields.feelsShade,id)&&finite(shade))sourceFields.feelsShade[id]=Number(shade.toFixed(1));
      if(!Object.hasOwn(sourceFields.feelsSun,id)&&modelSunApplicable[id]===true&&finite(outdoor))sourceFields.feelsSun[id]=Number(outdoor.toFixed(1));
    }
    hours.push({
      time: new Date(time).toISOString(), timestamp: time, end: new Date(time + HOUR).toISOString(),
      fraction: Math.min(1, Math.max(0, (time + HOUR - Math.max(time, now)) / HOUR)),
      applicability:{feelsSun:baselineSunApplicable},modelApplicability:{feelsSun:modelSunApplicable},
      sources: { temperature, amount, rain: rainProbability === null ? {} : { nws: rainProbability },...sourceFields },
      baseline: {
        temperature: valid(temperatureRow?.value, 'temperature') ? temperatureRow.value : valid(hour?.temperature, 'temperature') ? hour.temperature : null,
        rain: valid(publishedRain, 'rain') ? publishedRain : null,
        amount: valid(rain?.precipitation, 'amount') ? rain.precipitation : null,
        ...baselineFields,
      },
    });
  }
  const snowProducts=calendarDays.map(day=>snowCalendarProduct(forecast,day,now,timeZone));
  const models = CUSTOM_FORECAST_MODELS.map(model => {
    const coverage = Object.fromEntries(['temperature', 'rain', 'amount',...extraFields].map(metric => [metric, hours.filter(row => Object.hasOwn(row.sources[metric], model.id)).length]));
    coverage.snow=snowProducts.filter(product=>finite(product.sources[model.id])).length;
    const run = (forecast?.modelContributions || []).find(item => item.id === model.id);
    return { ...model, coverage, available: Object.values(coverage).some(Boolean), runAt: run?.runAt || (model.id === 'nws' ? (forecast?.feeds || []).find(feed => feed.id === 'hourly')?.issuedAt : null) || null };
  });
  const available = new Set(models.filter(model => model.available).map(model => model.id));
  const currentEvidence=rows.get(Math.floor(now/HOUR)*HOUR);
  const actualShares=Object.fromEntries([...(currentEvidence?.hour?.temperatureBlend?.sources||[]),...(currentEvidence?.temperature?.sources||[])]
    .filter(source=>allowed.has(source.id)&&valid(source.value,'temperature')&&finite(source.weight)&&source.weight>0).map(source=>[source.id,source.weight]));
  const requested = Object.keys(actualShares).length?actualShares:forecast?.blendPolicy?.sameDay || { nws: 21, hrrr: 26, ecmwf: 11, nbm: 26, wn: 16 };
  let defaultWeights = normalizeCustomWeights(Object.fromEntries(Object.entries(requested).filter(([id]) => available.has(id))));
  if (!Object.keys(defaultWeights).length) defaultWeights = normalizeCustomWeights(Object.fromEntries([...available].map(id => [id, 1])));
  return { locationKey: `${location.latitude}|${location.longitude}|${location.timeZone || ''}`, location: { ...location }, timeZone, assembledAt: forecast?.assembledAt || null, now, calendarDays, hours, models, defaultWeights,snowProducts };
}

export function customPresetWeights(input, preset = 'nourie') {
  const available = input.models.filter(model => model.available).map(model => model.id);
  if (preset === 'nws') return available.includes('nws') ? { nws: 100 } : {};
  if (preset === 'equal') return normalizeCustomWeights(Object.fromEntries(available.map(id => [id, 1])));
  if (preset === 'models') return normalizeCustomWeights(Object.fromEntries(available.filter(id => id !== 'nws').map(id => [id, 1])));
  if(preset==='european'||preset==='ai'){
    const preferred=preset==='european'?'ecmwf':'wn';
    if(!available.includes(preferred))return {...input.defaultWeights};
    const others=available.filter(id=>id!==preferred);
    return others.length?{[preferred]:60,...allocate(others.map(id=>[id,input.defaultWeights[id]||1]),40)}:{[preferred]:100};
  }
  return { ...input.defaultWeights };
}

function weightedMetric(values, weights, metric) {
  const selected = Object.keys(weights).filter(id => weights[id] > 0);
  const ids = selected.filter(id => valid(values[id], metric));
  const total = ids.reduce((sum, id) => sum + weights[id], 0);
  return {
    value: total ? ids.reduce((sum, id) => sum + values[id] * weights[id] / total, 0) : null,
    weights: total ? Object.fromEntries(ids.map(id => [id, weights[id] / total * 100])) : {},
    values: Object.fromEntries(ids.map(id => [id, values[id]])),
    missing: selected.filter(id => !ids.includes(id)),
  };
}

export function blendCustomForecast(input, requestedWeights) {
  const weights = normalizeCustomWeights(requestedWeights);
  const hours = input.hours.map(row => {
    return { ...row, custom: {
      temperature: weightedMetric(row.sources.temperature, weights, 'temperature'),
      // Native probability evidence only. A deterministic rain amount is never a probability.
      rain: weightedMetric(row.sources.rain, weights, 'rain'),
      amount: weightedMetric(row.sources.amount, weights, 'amount'),
    } };
  });
  return { ...input, weights, hours };
}

/** The Nourie preset is the published forecast itself. Its visible shares are
 * only the starting point for edits; date-specific official fallbacks stay intact. */
export function publishedForecastPreview(input,requestedWeights=input.defaultWeights){
  const built=blendCustomForecast(input,requestedWeights);
  return {...built,previewMode:'published',hours:built.hours.map(row=>({...row,custom:Object.fromEntries(['temperature','rain','amount'].map(metric=>[metric,{value:row.baseline[metric],weights:{},values:{},missing:[]}]))}))};
}

export function customForecastSummary(hours, metric) {
  const custom = hours.map(row => row.custom[metric].value), baseline = hours.map(row => row.baseline[metric]);
  const completeCustom = hours.length > 0 && custom.every(finite), completeBaseline = hours.length > 0 && baseline.every(finite);
  const aggregate = (values, complete) => {
    if (!values.some(finite)) return null;
    if (metric === 'amount') return complete ? values.reduce((sum, value, index) => sum + value * hours[index].fraction, 0) : null;
    return Math.max(...values.filter(finite));
  };
  const paired = hours.filter(row => finite(row.custom[metric].value) && finite(row.baseline[metric]));
  const biggest = paired.reduce((result, row) => !result || Math.abs(row.custom[metric].value - row.baseline[metric]) > Math.abs(result.custom[metric].value - result.baseline[metric]) ? row : result, null);
  return { custom: aggregate(custom, completeCustom), baseline: aggregate(baseline, completeBaseline), completeCustom, completeBaseline, customHours: custom.filter(finite).length, baselineHours: baseline.filter(finite).length, hours: hours.length, biggest };
}

/** Require every real clock hour, including the 23/25-hour DST dates.
 * Today uses the remaining local date. Rainfall prorates the boundary hour. */
function calendarMetric(hourMap,window,metric,side) {
  const readings=[];
  let expectedHours=0,availableHours=0,total=0;
  for(let time=Math.floor(window.start/HOUR)*HOUR;time<window.end;time+=HOUR){
    const left=Math.max(time,window.start),right=Math.min(time+HOUR,window.end);
    if(right<=left)continue;
    expectedHours++;
    const row=hourMap.get(time),value=side==='custom'?row?.custom?.[metric]?.value:row?.baseline?.[metric];
    if(!valid(value,metric))continue;
    availableHours++;readings.push(value);
    if(metric==='amount')total+=value*(right-left)/HOUR;
  }
  const complete=expectedHours>0&&availableHours===expectedHours;
  return {value:complete?(metric==='amount'?total:Math.max(...readings)):null,complete,expectedHours,availableHours};
}

export function customCalendarComparison(built) {
  const hourMap=new Map((built.hours||[]).map(row=>[row.timestamp,row]));
  return (built.calendarDays||[]).map(day=>{
    const high=calendarMetric(hourMap,day.temperatureWindow,'temperature','custom');
    const baselineHigh=calendarMetric(hourMap,day.temperatureWindow,'temperature','baseline');
    const amount=calendarMetric(hourMap,day.rainWindow,'amount','custom');
    const baselineAmount=calendarMetric(hourMap,day.rainWindow,'amount','baseline');
    const rain=calendarMetric(hourMap,day.rainWindow,'rain','custom');
    const baselineRain=calendarMetric(hourMap,day.rainWindow,'rain','baseline');
    if(built.previewMode==='published')return {...day,
      high:{...high,value:day.baseline.high,baseline:day.baseline.high,complete:finite(day.baseline.high)},
      amount:{...amount,value:day.baseline.amount,baseline:day.baseline.amount,complete:finite(day.baseline.amount)},
      rain:{...rain,value:day.baseline.rain,baseline:day.baseline.rain,complete:finite(day.baseline.rain)}};
    return {...day,high:{...high,baseline:built.comparePublishedHigh?day.baseline.high:baselineHigh.complete?day.baseline.high:null},
      amount:{...amount,baseline:baselineAmount.complete?(day.pairedRemainingAmount?baselineAmount.value:day.baseline.amount):null},
      rain:{...rain,baseline:baselineRain.complete?day.baseline.rain:null}};
  });
}

const tempText=value=>`${Math.round(value)}°`;
const rainText=value=>`${value.toFixed(2)} inches`;
const sentenceStart=day=>day.today?'For the rest of today':`On ${day.label}`;

/** Plain wording is built from complete calendar periods, never a model's overnight tail. */
export function customForecastNarrative(built) {
  const days=customCalendarComparison(built),changes=[];
  for(const day of days){
    day.sentences=[];
    const {high,amount,rain}=day;
    if(finite(high.value)){
      const changed=finite(high.baseline)&&Math.round(high.value)!==Math.round(high.baseline);
      const sentence=changed?`${sentenceStart(day)}, the high becomes ${tempText(high.value)} instead of ${tempText(high.baseline)}.`
        :`${sentenceStart(day)}, the high ${finite(high.baseline)?'stays near':'is around'} ${tempText(high.value)}.`;
      day.sentences.push(sentence);
      if(changed)changes.push({date:day.date,metric:'temperature',score:Math.abs(Math.round(high.value)-Math.round(high.baseline)),text:sentence});
    }
    if(finite(amount.value)){
      const own=Number(amount.value.toFixed(2)),base=finite(amount.baseline)?Number(amount.baseline.toFixed(2)):null;
      if(base!==null&&own!==base){
        const sentence=`${day.today?'Rainfall for the rest of today':`${day.label}’s forecast rainfall`} ${own>base?'increases':'decreases'} to ${rainText(amount.value)} from ${rainText(amount.baseline)}.`;
        day.sentences.push(sentence);changes.push({date:day.date,metric:'amount',score:Math.abs(own-base)*25,text:sentence});
      } else if(own>0)day.sentences.push(`Forecast rainfall is ${finite(amount.baseline)?'unchanged at':'around'} ${rainText(amount.value)}.`);
      else day.sentences.push('Forecast rainfall is below 0.01 inches.');
    }
    if(built.previewMode==='published'&&day.observed)day.sentences.push('Rain is being observed now.');
    else if(finite(rain.value)&&rain.value>=5)day.sentences.push(`${built.previewMode==='published'?'Weather Nourie’s':'The NWS'} peak hourly rain chance is ${Math.round(rain.value)}%.`);
    if(!finite(high.value)&&!finite(amount.value))day.sentences.unshift(built.previewMode==='published'?'A complete published forecast is not available for this day yet.':'No full-day coverage from the chosen models yet.');
  }
  const highlights=changes.sort((a,b)=>b.score-a.score||a.date.localeCompare(b.date)).slice(0,3);
  const selected=Object.keys(built.weights||{}).filter(id=>built.weights[id]>0);
  const completeDays=days.filter(day=>finite(day.high.value)||finite(day.amount.value)).length;
  const comparedDays=days.filter(day=>(finite(day.high.value)&&finite(day.high.baseline))||(finite(day.amount.value)&&finite(day.amount.baseline))).length;
  const summary=built.previewMode==='published'?'Weather Nourie’s forecast is shown unchanged.'
    :!selected.length?'Select a model to see how your forecast changes.'
    :highlights.length?'The biggest changes from Weather Nourie:'
    :comparedDays?'The values we can compare match Weather Nourie to the displayed precision.'
    :completeDays?'Your forecast is ready below. The published forecast is missing matching values, so we can’t compare changes yet.'
    :'The selected models do not cover a whole day yet. Add another available model to extend the forecast.';
  return {days,highlights,summary,completeDays,comparedDays};
}

function metricPeriod(hourMap,window,definition,modelId=null){
  let expectedHours=0,availableHours=0,total=0,duration=0;
  const readings=[];
  for(let time=Math.floor(window.start/HOUR)*HOUR;time<window.end;time+=HOUR){
    const left=Math.max(time,window.start),right=Math.min(time+HOUR,window.end);
    if(right<=left)continue;
    const row=hourMap.get(time);
    const applicable=modelId?row?.modelApplicability?.feelsSun?.[modelId]:row?.applicability?.feelsSun;
    if(definition.eligible==='daylight'&&applicable===false)continue;
    expectedHours++;
    if(definition.eligible==='daylight'&&applicable!==true)continue;
    const value=modelId?row?.sources?.[definition.field]?.[modelId]:row?.baseline?.[definition.field];
    if(!valid(value,definition.field))continue;
    availableHours++;readings.push(value);total+=value*(right-left)/HOUR;duration+=(right-left)/HOUR;
  }
  const complete=expectedHours>0&&availableHours===expectedHours;
  const value=!complete?null:definition.aggregation==='sum'?total:definition.aggregation==='mean'?total/duration:definition.aggregation==='min'?Math.min(...readings):Math.max(...readings);
  return {value,complete,expectedHours,availableHours};
}

export function formatModelMetric(value,metricId='high'){
  if(!finite(value))return 'Not supplied';
  const definition=CUSTOM_FORECAST_METRICS.find(metric=>metric.id===metricId)||CUSTOM_FORECAST_METRICS[0];
  if(metricId==='rain'&&value<5)return 'Low';
  const number=definition.digits?value.toFixed(definition.digits):String(Math.round(value));
  if(definition.unit==='°F')return `${number}°`;
  if(definition.unit==='%')return `${number}%`;
  return `${number} ${definition.unit==='US AQI'?'AQI':definition.unit}`;
}

function metricComparisonText(day,metric){
  const value=formatModelMetric(day.metric.value,metric.id),baseline=formatModelMetric(day.metric.baseline,metric.id);
  const descriptions={
    feels:`it could feel as warm as ${value} outdoors`,
    feelsLow:`it could feel as cool as ${value} outdoors`,
    feelsShade:`it could feel as warm as ${value} in the shade`,
    feelsSun:`it could feel as warm as ${value} in direct sunlight`,
    gust:`gusts could reach ${value}`,
    wind:`wind could average ${value}`
  };
  return descriptions[metric.id]?`${sentenceStart(day)}, ${descriptions[metric.id]}, compared with ${baseline} in Weather Nourie’s forecast.`
    :`${sentenceStart(day)}, ${metric.label.toLowerCase()} is ${value} compared with ${baseline} from Weather Nourie.`;
}

/** One real model against canonical values; every metric keeps its own units,
 * aggregation, applicability and missing-hour coverage. */
export function singleModelComparison(input,selectedId=null,metricId='high'){
  const metric=CUSTOM_FORECAST_METRICS.find(item=>item.id===metricId)||CUSTOM_FORECAST_METRICS[0];
  const model=input.models.find(item=>item.id===selectedId&&item.available)||null;
  const built=model?{...blendCustomForecast(input,{[model.id]:100}),comparePublishedHigh:true}:publishedForecastPreview(input);
  let narrative=customForecastNarrative(built);
  const hourMap=new Map(input.hours.map(row=>[row.timestamp,row]));
  const periods=input.calendarDays.map((day,index)=>{
    if(metric.id==='snow'){
      const product=input.snowProducts[index],baseline=product?.baseline??null,value=model?product?.sources?.[model.id]??null:null;
      return {baseline,value,window:product?.window,complete:finite(value),expectedHours:null,availableHours:null};
    }
    const window=['rain','amount'].includes(metric.id)?day.rainWindow:day.temperatureWindow;
    const own=model?metricPeriod(hourMap,window,metric,model.id):{value:null};
    const published=metricPeriod(hourMap,window,metric);
    const baseline=['high','low'].includes(metric.id)?day.baseline[metric.id]:metric.id==='amount'&&!day.pairedRemainingAmount?day.baseline.amount:published.value;
    return {...own,baseline:finite(baseline)?baseline:null,window};
  });
  const baseline=periods.map(period=>period.baseline);
  const selected=model?periods.map(period=>period.value):[];
  const days=narrative.days.map((day,index)=>({...day,metric:{...periods[index]}}));
  if(metric.id!=='high'){
    const changes=model?days.filter(day=>finite(day.metric.value)&&finite(day.metric.baseline)&&formatModelMetric(day.metric.value,metric.id)!==formatModelMetric(day.metric.baseline,metric.id))
      .map(day=>({date:day.date,metric:metric.id,score:Math.abs(day.metric.value-day.metric.baseline),text:metricComparisonText(day,metric)}))
      .sort((a,b)=>b.score-a.score||a.date.localeCompare(b.date)).slice(0,3):[];
    narrative={...narrative,days,highlights:changes};
  }
  const covered=model?selected.filter(finite).length:baseline.filter(finite).length;
  const label=model?.label||'Weather Nourie';
  const hasEvidence=model&&(model.coverage[metric.field]||0)>0;
  const missing=model?days.filter(day=>!finite(day.metric.value)&&!(metric.eligible&&day.metric.expectedHours===0)):[];
  const inapplicable=!!model&&!!metric.eligible&&periods.every(period=>period.expectedHours===0);
  const ownThermalNote='An estimate requires this model’s own temperature, dew point, wind and cloud for the same hour. Missing inputs are not borrowed from Weather Nourie.';
  const unavailableNotes={rain:'These deterministic model feeds supply precipitation amounts, not rain probabilities. Choose NWS for its published probability.',uv:'UV comes from the separate published UV product, not this model.',aqi:'Air quality comes from the separate CAMS forecast, not this weather model.',humidity:'Estimating humidity requires this model’s own temperature and dew point for the same hour.',feels:ownThermalNote,feelsLow:ownThermalNote,feelsShade:ownThermalNote,feelsSun:ownThermalNote};
  const coverageNote=inapplicable?'No applicable direct-sun hours are forecast for this model over these dates.'
    :model&&!hasEvidence?`${label} does not supply ${metric.label.toLowerCase()} in these feeds. ${unavailableNotes[metric.id]||'The published forecast remains visible; missing model values are not zero.'}`
    :missing.length?`${label} is missing complete ${metric.label.toLowerCase()} coverage for ${missing[0].today?'the rest of today':missing[0].label}${missing.length>1?` and ${missing.length-1} other ${missing.length===2?'date':'dates'}`:''}. Those points stay blank.`:'';
  const paired=periods.filter(period=>finite(period.value)&&finite(period.baseline)).length;
  const summary=!model?'Choose a model to see how its forecast differs from Weather Nourie.'
    :narrative.highlights.length?`${label} compared with Weather Nourie:`
    :paired?`${label} matches Weather Nourie to the displayed precision on the days we can compare.`
    :covered?`${label} is shown above. Weather Nourie is missing matching values for a comparison.`
    :`${label} has no complete-date values for this measurement in the current feed.`;
  return {selectedId:model?.id||null,label,color:model?.color||'#ffffff',metric,metricId:metric.id,days,baseline,selected,covered,coverageNote,summary,narrative,built};
}
