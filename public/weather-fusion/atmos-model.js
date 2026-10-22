/* Atmos — pure builders for the Weather Nourie "Atmos" page.
 * Every number comes from /api/weather-fusion/forecast through the same shared
 * helpers the main page uses: hourly display samples, the canonical metric
 * series, the rain score, the perfect-hour rules, UTCI stress categories and the
 * daily readings. Nothing here creates a forecast value; it arranges and
 * compares published ones so the page can show where they come from. */
import {hourlyDisplaySamples} from './weather-display.js?v=low-rain-display-v1';
import {weatherState} from './weather-state.js?v=current-rain-20261017-v3';
import {finite,thermalHumidity,wetBulb,solarElevation} from './weather-math.js?v=current-rain-20261017-v3';
import {hideLowRainChance} from './rain-display.js?v=low-rain-display-v1';
import {classifyHour} from './whats-up-classify.js?v=current-rain-20261017-v3';
import {buildForecastWindows,PERFECT_WEATHER_RULES} from './forecast-windows.js?v=forecast-windows-v1';
import {thermalRisk} from './thermal-risk.js?v=weather-art-labels-v10';
import {referenceScene,clothingForFeels,comfortSceneState} from './exposure-scene.js?v=current-rain-20261017-v3';
import {calendarDayWindow} from './calendar-day.js?v=calendar-days-v1';
import {dailyForecastReadings} from './seven-day.js?v=low-rain-display-v1';

export const ATMOS_VERSION='atmos-v2';
export const H=3600000;
export const PERFECT_RULES={ideal:72,band:PERFECT_WEATHER_RULES.feels,dewpoint:PERFECT_WEATHER_RULES.dewpointMax,cloud:PERFECT_WEATHER_RULES.cloudMax,rain:PERFECT_WEATHER_RULES.rainMax,precipitation:PERFECT_WEATHER_RULES.precipitationMaxExclusive,horizonDays:PERFECT_WEATHER_RULES.horizonDays};
export const SOURCE_ORDER=['nws','hrrr','ecmwf','nbm','wn'];
export const SOURCES={
 nws:{label:'NWS',name:'National Weather Service forecast'},
 hrrr:{label:'HRRR',name:'NOAA High-Resolution Rapid Refresh model'},
 ecmwf:{label:'ECMWF',name:'ECMWF IFS, the European model'},
 nbm:{label:'NBM',name:'NOAA National Blend of Models'},
 wn:{label:'WeatherNext',name:'WeatherNext AI forecast'},
};
/* Plain-language descriptions for the forecast lab. */
export const SOURCE_ABOUT={
 nws:'The official forecast from your local National Weather Service office.',
 hrrr:'NOAA’s high-resolution model, rerun every hour. Built for the next day or two.',
 ecmwf:'The European global model, widely used for the days ahead.',
 nbm:'NOAA’s National Blend of Models: many computer models combined and bias-corrected.',
 wn:'An AI weather model trained on decades of past weather data.',
};
export const sourceLabel=id=>SOURCES[id]?.label||String(id||'').toUpperCase();
const sourceRank=id=>{const i=SOURCE_ORDER.indexOf(id);return i<0?SOURCE_ORDER.length:i;};
const clamp=(value,low=0,high=1)=>Math.min(high,Math.max(low,value));
const NUMBER_WORDS=['No','One','Two','Three','Four','Five','Six','Seven','Eight'];
export const countWord=n=>NUMBER_WORDS[n]||String(n);

const COMPASS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export function windDegrees(value){
 if(finite(value))return ((value%360)+360)%360;
 const index=COMPASS.indexOf(String(value||'').trim().toUpperCase());
 return index<0?null:index*22.5;
}
export function compass(degrees){return finite(degrees)?COMPASS[Math.round((((degrees%360)+360)%360)/22.5)%16]:'';}

const formatters=new Map();
function formatter(zone,options){
 const key=zone+JSON.stringify(options);
 if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat('en-US',{timeZone:zone,...options}));
 return formatters.get(key);
}
export function localParts(epoch,zone='America/New_York'){
 const parts=formatter(zone,{year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(epoch));
 const get=type=>parts.find(part=>part.type===type)?.value;
 return {date:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour'))%24,weekday:get('weekday')};
}
export const hourLabel=(epoch,zone='America/New_York')=>formatter(zone,{hour:'numeric'}).format(new Date(epoch));
export const clockLabel=(epoch,zone='America/New_York')=>formatter(zone,{hour:'numeric',minute:'2-digit'}).format(new Date(epoch));
export const weekdayLabel=(epoch,zone='America/New_York')=>formatter(zone,{weekday:'short'}).format(new Date(epoch));
export const longDayLabel=(epoch,zone='America/New_York')=>formatter(zone,{weekday:'long'}).format(new Date(epoch));

/** Index each canonical metric series by instant; the main page matches instants, never array positions. */
export function seriesIndex(forecast){
 const out={};
 for(const [key,rows] of Object.entries(forecast?.metricForecasts?.series||{})){
  const map=new Map();
  for(const row of rows||[]){const time=Date.parse(row?.time);if(finite(time)&&!map.has(time))map.set(time,row);}
  out[key]=map;
 }
 for(const key of ['temperature','feels','dewpoint','wind','humidity','pop'])out[key]||=new Map();
 return out;
}

/** The 48-hour clock: the exact samples behind the main page's hourly strip,
 * starting with the station-based Now card. */
export function buildTimeline(forecast,now=Date.now()){
 if(!forecast?.location||!Array.isArray(forecast.hours))return [];
 const zone=forecast.location.timeZone||'America/New_York';
 const {latitude,longitude}=forecast.location;
 const index=seriesIndex(forecast);
 const rows=new Map(forecast.hours.map(row=>[Date.parse(row.time),row]));
 const currentRow=forecast.hours.find(row=>{const time=Date.parse(row.time);return time<=now&&now<time+H;});
 const steps=[];
 for(const sample of hourlyDisplaySamples(forecast,now)){
  if(!sample)continue;
  const isNow=sample.now===true,time=isNow?now:Date.parse(sample.time);
  if(!finite(time))continue;
  const row=isNow?currentRow:rows.get(time);
  const hourStart=isNow?(currentRow?Date.parse(currentRow.time):Math.floor(now/H)*H):time;
  const inputs=sample.inputs||{};
  const humidity=thermalHumidity(inputs)??(finite(inputs.humidity)?inputs.humidity:null);
  const skyCover=finite(inputs.skyCover)?inputs.skyCover:finite(row?.skyCover)?row.skyCover:null;
  const condition=sample.condition||'Sky conditions unavailable';
  const state=weatherState(condition,skyCover);
  const rain=finite(sample.pop)&&sample.pop>=0&&sample.pop<=100?sample.pop:null;
  const elevation=solarElevation(time,latitude,longitude);
  const temperature=finite(sample.temperature)?sample.temperature:null;
  steps.push({
   id:isNow?'now':new Date(time).toISOString(),isNow,time,hourStart,
   label:isNow?'Now':hourLabel(time,zone),
   temperature,feels:finite(sample.feels)?sample.feels:null,
   shade:finite(sample.comfort?.shade)?sample.comfort.shade:null,
   condition,kind:state.kind,chance:state.chance||/\b(?:around|nearby|vicinity|in area)\b/i.test(condition),
   isDay:finite(elevation)?elevation>0:sample.isDay!==false,
   rain,rainShown:rain===null||hideLowRainChance(rain)?null:Math.round(rain),
   rainNow:isNow&&sample.currentPrecipitation?.active===true&&sample.currentPrecipitation?.nearby!==true,
   rainNote:isNow?sample.currentPrecipitation?.label||'':'',
   precip:finite(row?.precipitation)?row.precipitation:null,
   wind:finite(inputs.wind)?inputs.wind:null,gust:finite(inputs.gust)?inputs.gust:null,
   windDir:windDegrees(sample.windDirection),
   dewpoint:finite(inputs.dewpoint)?inputs.dewpoint:null,humidity,skyCover,
   uv:finite(sample.uvIndex)?sample.uvIndex:null,
   wetBulb:finite(temperature)&&finite(humidity)?wetBulb(temperature,humidity):null,
   temperaturePoint:index.temperature.get(hourStart)||null,
   rainLikelihood:row?.rainLikelihood||null,
   risk:thermalRisk(sample.feels),
  });
 }
 return steps;
}

/* NWS sky-condition terms (sky cover in eighths): clear/sunny 0, mostly clear or
 * sunny 1–2, partly cloudy or sunny 3–5, mostly cloudy 6–7, cloudy 8. Used only
 * when the forecast hour has no numeric sky cover. */
const COVER_TERMS=[[/overcast/,1],[/mostly cloudy|considerable cloud|broken/,.8],[/partly (?:sunny|cloudy)|scattered clouds/,.5],[/mostly (?:sunny|clear)|few clouds|\bfair\b/,.2],[/\b(?:sunny|clear)\b/,.03],[/cloudy/,.95]];
export function cloudCover(step){
 if(finite(step?.skyCover))return clamp(step.skyCover/100);
 const text=String(step?.condition||'').toLowerCase();
 for(const [pattern,value] of COVER_TERMS)if(pattern.test(text))return value;
 return ({rain:.9,storm:.92,snow:.92,fog:.6,cloudy:.9,'partly-cloudy':.5,clear:.04})[step?.kind]??.4;
}

/** What the sky renderer draws for an hour. Precipitation and thunder come only
 * from the displayed condition; a chance or nearby wording draws a lighter,
 * scattered version rather than rain falling on the viewer. */
export function skyScene(step){
 if(!step)return null;
 const kind=step.kind,wet=kind==='rain'||kind==='storm';
 let cover=cloudCover(step),rain=0,snow=0,fog=0;
 if(wet||kind==='snow'){
  const amount=finite(step.precip)?clamp(Math.sqrt(Math.max(0,step.precip)/.25),.18,1):.4;
  const scattered=step.chance&&!(finite(step.rain)&&step.rain>=50)&&!step.rainNow;
  const level=scattered?amount*.45:amount;
  if(kind==='snow')snow=level;else rain=level;
  cover=Math.max(cover,scattered?.62:.86);
 }
 if(kind==='fog')fog=/dense/i.test(step.condition)?.92:/patchy|areas of|isolated/i.test(step.condition)?.5:.75;
 const haze=finite(step.dewpoint)?clamp((step.dewpoint-58)/14)*.8:0;
 return {time:step.time,cover,rain,snow,fog,haze,storm:kind==='storm',dark:kind==='storm'?.82:wet?.5:kind==='snow'?.3:0,
  wind:finite(step.wind)?step.wind:4,windDir:finite(step.windDir)?step.windDir:270};
}
export function mixScene(a,b,fraction){
 if(!a||!b)return a||b||null;
 const f=clamp(fraction),mix=key=>a[key]+(b[key]-a[key])*f;
 let turn=((b.windDir-a.windDir+540)%360)-180;
 return {time:mix('time'),cover:mix('cover'),rain:mix('rain'),snow:mix('snow'),fog:mix('fog'),haze:mix('haze'),dark:mix('dark'),wind:mix('wind'),
  windDir:(a.windDir+turn*f+360)%360,storm:f<.5?a.storm:b.storm};
}

/** Per-hour spread of the published temperature sources around the canonical blend. */
export function consensus(steps){
 return steps.map(step=>{
  const point=step.temperaturePoint;
  const sources=(point?.sources||[]).filter(source=>source?.id&&finite(source.value))
   .map(source=>({id:source.id,value:source.value,weight:finite(source.weight)?source.weight:null}))
   .sort((a,b)=>sourceRank(a.id)-sourceRank(b.id));
  const values=sources.map(source=>source.value);
  return {time:step.time,hourStart:step.hourStart,isNow:step.isNow,blend:finite(point?.value)?point.value:null,
   min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,sources};
 });
}
export function agreementLabel(spread){
 if(!finite(spread))return 'Not enough forecasts to compare';
 if(spread<=2)return 'They agree closely';
 if(spread<=5)return 'They mostly agree';
 if(spread<=9)return 'Some disagreement';
 return 'Wide disagreement';
}
/** Sources present anywhere in the window, in a fixed order so colors follow the source. */
export function presentSources(rows){
 const ids=new Set();for(const row of rows)for(const source of row.sources||[])ids.add(source.id);
 return [...ids].sort((a,b)=>sourceRank(a)-sourceRank(b));
}

/* Rain score: NWS fills its share in proportion to its official chance; each
 * model adds points from its own rainfall, a third for a trace or for
 * unconfirmed rain. Plain-language notes describe what the server computed. */
export function rainNote(source,amount,likelihood){
 const max=finite(source?.weight)?Math.round(source.weight*100):null;
 if(source?.id==='nws'){
  const chance=finite(likelihood?.officialProbability)?likelihood.officialProbability:source.value;
  return finite(chance)&&finite(max)?`Official ${Math.round(chance)}% chance, counted at ${max}%`:'Official chance unavailable';
 }
 if(source?.reductionReason==='trace')return `A trace of rain, so a third of its ${max} points`;
 if(finite(source?.value)&&source.value>=100)return `Over 0.01 in, so all ${max} points`;
 if(finite(amount)&&amount<=0)return 'Dry, so no points';
 if(source?.value===0)return 'No rain signal, so no points';
 return finite(source?.points)?'Partial points':'No data for this hour';
}
export function rainBreakdown(likelihood){
 if(!likelihood||!Array.isArray(likelihood.sources)||!likelihood.sources.length)return null;
 const amounts=likelihood.sourceAmounts||{};
 const rows=likelihood.sources.filter(source=>source?.id&&finite(source.points)).map(source=>({
  id:source.id,points:source.points,max:finite(source.weight)?source.weight*100:null,weight:source.weight,
  signal:finite(source.value)?source.value:null,amount:finite(amounts[source.id])?amounts[source.id]:null,
  reason:source.reductionReason||null,note:rainNote(source,amounts[source.id],likelihood),
 })).sort((a,b)=>sourceRank(a.id)-sourceRank(b.id));
 return {rows,total:finite(likelihood.value)?likelihood.value:null,raw:finite(likelihood.rawTotal)?likelihood.rawTotal:null};
}

/* Comfort classes centred on the 72° ideal used by the perfect-hour rules. The
 * warm side applies UTCI-derived heat-stress thresholds (78.8°, 89.6°, 100.4°F)
 * to the site's custom feels-like estimate; the cold side mirrors the
 * comfortable band, then uses the 48.2°F UTCI slight-cold threshold and
 * freezing. */
export const COMFORT_BINS=[
 {key:'c3',label:'Freezing',range:'Under 32°',min:-Infinity},
 {key:'c2',label:'Cold',range:'32–48°',min:32},
 {key:'c1',label:'Cool',range:'48–65°',min:48.2},
 {key:'n',label:'Comfortable',range:'65–79°',min:65.2},
 {key:'w1',label:'Warm',range:'79–90°',min:78.8},
 {key:'w2',label:'Hot',range:'90–100°',min:89.6},
 {key:'w3',label:'Very hot',range:'100° and up',min:100.4},
];
export function comfortBin(feels){
 if(!finite(feels))return null;
 let match=COMFORT_BINS[0];
 for(const bin of COMFORT_BINS)if(feels>=bin.min)match=bin;
 return match;
}

/** Seven local days × 24 hours, each hour judged by the shared perfect-hour rules. */
export function comfortGrid(forecast,now=Date.now(),dayCount=7){
 const zone=forecast?.location?.timeZone||'America/New_York';
 const index=seriesIndex(forecast);
 const rainRows=new Map((forecast?.rainTimeline||[]).map(row=>[Date.parse(row.time),row]));
 const hourRows=new Map((forecast?.hours||[]).map(row=>[Date.parse(row.time),row]));
 const current=Math.floor(now/H)*H;
 const perfectHours=new Map(buildForecastWindows(forecast,now).perfect.flatMap(window=>window.hours.map(hour=>[Date.parse(hour.forecastTime),hour])));
 const days=(forecast?.days||[]).filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day?.date||'')).slice(0,dayCount);
 const grid=days.map((day,i)=>{
  const noon=Date.parse(`${day.date}T12:00:00Z`);
  return {date:day.date,label:i===0?'Today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(noon),
   dateLabel:new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(noon),cells:Array(24).fill(null)};
 });
 const byDate=new Map(grid.map(row=>[row.date,row]));
 for(const [time,point] of index.feels){
  const {date,hour}=localParts(time,zone),row=byDate.get(date);
  if(!row||row.cells[hour])continue;
  const rainRow=rainRows.get(time),hourRow=hourRows.get(time);
  const temperature=index.temperature.get(time)?.value,dewpoint=index.dewpoint.get(time)?.value,wind=index.wind.get(time)?.value;
  const condition=rainRow?.condition||hourRow?.condition||point.condition||'';
  const skyCover=finite(hourRow?.skyCover)?hourRow.skyCover:finite(point.inputs?.skyCover)?point.inputs.skyCover:null;
  const verdict=classifyHour({temperature,dewpoint,wind,condition,skyCover,rainLikelihood:rainRow?.rainLikelihood||hourRow?.rainLikelihood||null,officialPop:rainRow?.officialPop??hourRow?.officialPop??null});
  const past=time<current,perfectHour=perfectHours.get(time);
  row.cells[hour]={time,hour,past,feels:finite(point.value)?point.value:null,temperature:finite(temperature)?temperature:null,
   dewpoint:finite(dewpoint)?dewpoint:null,wind:finite(wind)?wind:null,condition,kind:verdict.sky.kind,
   date,rain:finite(verdict.rainChance)?verdict.rainChance:null,storm:verdict.storm,perfect:!past&&perfectHour?'outdoor':null,
   perfectStart:perfectHour?Date.parse(perfectHour.time):null,bin:comfortBin(point.value)};
 }
 return grid;
}
/** Consecutive perfect hours merged into windows, earliest first. */
export function perfectWindows(grid){
 const cells=grid.flatMap(row=>row.cells.filter(Boolean)).filter(cell=>!cell.past).sort((a,b)=>a.time-b.time);
 const windows=[];let open=null;
 for(const cell of cells){
  if(!cell.perfect){open=null;continue;}
  if(open&&cell.time===open.end&&cell.date===open.date){open.end+=H;open.cells.push(cell);continue;}
  open={date:cell.date,start:finite(cell.perfectStart)?Math.max(cell.time,cell.perfectStart):cell.time,end:cell.time+H,cells:[cell]};windows.push(open);
 }
 return windows.map(({start,end,cells:list})=>{
  const temps=list.map(c=>c.feels).filter(finite),dews=list.map(c=>c.dewpoint).filter(finite),winds=list.map(c=>c.wind).filter(finite);
  return {start,end,hours:list.length,rules:[...new Set(list.map(c=>c.perfect))].sort(),
   low:temps.length?Math.min(...temps):null,high:temps.length?Math.max(...temps):null,
   dewpoint:dews.length?Math.max(...dews):null,wind:winds.length?winds.reduce((a,b)=>a+b,0)/winds.length:null};
 });
}

/** Each source's own high and low over the same calendar hours the blend uses.
 * A source counts only when it covers every one of those hours. */
export function sourceSpread(temperatureIndex,window){
 if(!finite(window?.start)||!finite(window?.end)||window.end<=window.start)return null;
 const values={};let expected=0;
 for(let time=window.start;time<window.end;time+=H){
  expected+=1;
  for(const source of temperatureIndex.get(time)?.sources||[])if(source?.id&&finite(source.value))(values[source.id]||=[]).push(source.value);
 }
 const complete=Object.entries(values).filter(([,list])=>list.length===expected).sort(([a],[b])=>sourceRank(a)-sourceRank(b));
 if(complete.length<2)return null;
 const highs=complete.map(([id,list])=>({id,value:Math.max(...list)})),lows=complete.map(([id,list])=>({id,value:Math.min(...list)}));
 return {highs,lows,high:[Math.min(...highs.map(s=>s.value)),Math.max(...highs.map(s=>s.value))],low:[Math.min(...lows.map(s=>s.value)),Math.max(...lows.map(s=>s.value))],sources:complete.length};
}
/** The main page's daily readings, plus how far the individual forecasts reach. */
export function dailyOutlook(forecast,now=Date.now(),count=10){
 const zone=forecast?.location?.timeZone||'America/New_York',index=seriesIndex(forecast);
 return dailyForecastReadings(forecast,now,count).map(reading=>{
  const day=forecast.days[reading.index];
  const spread=sourceSpread(index.temperature,calendarDayWindow(day,reading.index,now,zone));
  const rain=finite(reading.pop)&&!hideLowRainChance(reading.pop)?Math.round(reading.pop):null;
  return {...reading,kind:weatherState(reading.condition).kind,rainShown:rain,spread,official:day.official||null,
   qpfLabel:day.qpfWindowLabel||'',nightDetail:day.nightDetail||'',uvMax:finite(day.uvMax)?day.uvMax:null};
 });
}

/* Sun timing from the shared solar-elevation formula: sunrise/sunset at the
 * standard -0.833° horizon, golden hour while the sun is below 6°. */
const DEG=Math.PI/180;
export function solarCrossings(location,dayStart,dayEnd,threshold=-0.833){
 const crossings=[];
 if(![location?.latitude,location?.longitude,dayStart,dayEnd].every(finite))return crossings;
 const step=5*60000;
 const height=time=>solarElevation(time,location.latitude,location.longitude)/DEG-threshold;
 let previous=height(dayStart);
 for(let time=dayStart+step;time<=dayEnd;time+=step){
  const value=height(time);
  if(Math.sign(value)!==Math.sign(previous)&&finite(value)&&finite(previous)){
   let low=time-step,high=time;
   for(let i=0;i<20;i++){const mid=(low+high)/2;if(Math.sign(height(mid))===Math.sign(height(low)))low=mid;else high=mid;}
   crossings.push({time:(low+high)/2,rising:value>previous});
  }
  previous=value;
 }
 return crossings;
}
export function sunDay(location,dayStart,dayEnd,published=null){
 const horizon=solarCrossings(location,dayStart,dayEnd);
 const golden=solarCrossings(location,dayStart,dayEnd,6);
 // The site's published astronomical sunrise and sunset win when present.
 const listed=time=>{const value=Date.parse(time);return finite(value)&&value>=dayStart&&value<dayEnd?value:null;};
 const sunrise=listed(published?.sunrise)??horizon.find(c=>c.rising)?.time??null,sunset=listed(published?.sunset)??horizon.find(c=>!c.rising)?.time??null;
 let noon=null,peak=-Infinity;
 if(finite(sunrise)&&finite(sunset))for(let time=sunrise;time<=sunset;time+=5*60000){const e=solarElevation(time,location.latitude,location.longitude)/DEG;if(e>peak){peak=e;noon=time;}}
 return {sunrise,sunset,noon,peakElevation:finite(peak)?peak:null,dayLength:finite(sunrise)&&finite(sunset)?sunset-sunrise:null,
  goldenMorningEnd:golden.find(c=>c.rising)?.time??null,goldenEveningStart:golden.find(c=>!c.rising)?.time??null};
}

/** Validated U.S. location for the page; presets match the server's saved points. */
export const PRESETS=[
 {id:'knightdale',name:'Knightdale / Raleigh',latitude:35.787,longitude:-78.4806},
 {id:'greenville',name:'Greenville, NC',latitude:35.6127,longitude:-77.3664},
 {id:'hazen',name:'Hazen, ND',latitude:47.2944,longitude:-101.6227},
];
export const validPlace=place=>place&&finite(place.latitude)&&finite(place.longitude)&&place.latitude>=24&&place.latitude<=50&&place.longitude>=-125&&place.longitude<=-66;
export function placeFromQuery(search){
 const params=new URLSearchParams(search||'');
 const preset=PRESETS.find(p=>p.id===params.get('location'));
 if(preset)return {...preset};
 const latitude=Number(params.get('lat')),longitude=Number(params.get('lon'));
 const place={id:'query',name:String(params.get('name')||'').slice(0,80)||'Selected location',latitude,longitude};
 return params.has('lat')&&params.has('lon')&&validPlace(place)?place:null;
}

/* ---------- Make your own forecast ----------
 * The lab never invents a forecast value. Each hour it re-weights the source
 * values the server already published for that hour. A slider multiplies a
 * source's Weather Nourie share (Off, a fraction, Normal, or up to 4×); the
 * shares are then rescaled to add up to 100% over the sources that cover that
 * hour, exactly as the server does when a source is missing. With every slider
 * at Normal the lab shows the canonical values themselves. */
export const TRUST_STOPS=[0,.25,.5,.75,1,1.5,2,3,4];
export const TRUST_LABELS=['Off','¼×','½×','¾×','Normal','1½×','2×','3×','4×'];
export const NORMAL_STOP=TRUST_STOPS.indexOf(1);
export const LAB_PRESETS=[
 {id:'nourie',label:'Weather Nourie',trust:{nws:1,hrrr:1,ecmwf:1,nbm:1,wn:1}},
 {id:'nws',label:'Just the NWS',trust:{nws:1,hrrr:0,ecmwf:0,nbm:0,wn:0}},
 {id:'models',label:'Models only',trust:{nws:0,hrrr:1,ecmwf:1,nbm:1,wn:1}},
 {id:'hrrr',label:'Lean on HRRR',trust:{nws:1,hrrr:4,ecmwf:1,nbm:1,wn:1}},
 {id:'ecmwf',label:'Lean on the European',trust:{nws:1,hrrr:1,ecmwf:4,nbm:1,wn:1}},
 {id:'wn',label:'Lean on the AI',trust:{nws:1,hrrr:1,ecmwf:1,nbm:1,wn:4}},
];
/** Only the listed stops are accepted; anything else reads as Normal. */
export function normalTrust(trust){
 const out={};
 for(const id of SOURCE_ORDER){const value=trust?.[id];out[id]=typeof value==='number'&&TRUST_STOPS.includes(value)?value:1;}
 return out;
}
export const isNourieTrust=trust=>{const t=normalTrust(trust);return SOURCE_ORDER.every(id=>t[id]===1);};
export function matchingPreset(trust){
 const t=normalTrust(trust);
 return LAB_PRESETS.find(preset=>SOURCE_ORDER.every(id=>t[id]===preset.trust[id]))?.id||null;
}
/** Weighted mean of one hour's published source values with the user's multipliers. */
export function mixValue(sources,trust){
 const t=normalTrust(trust);let sum=0,total=0;
 for(const source of sources||[]){
  if(!source?.id||!finite(source.value)||!finite(source.weight)||source.weight<=0)continue;
  const weight=source.weight*(t[source.id]??1);
  if(!(weight>0))continue;
  sum+=weight*source.value;total+=weight;
 }
 return total>0?sum/total:null;
}
/** The rain score is a sum of points, not an average. Each listed source keeps
 * its points; a share the user turns off drops out. Past the end of the NWS
 * hourly forecast its share adds no points, as on the main page. When the
 * server fell back to the NWS chance because a model was missing, the models
 * that are present split the score instead, so missing data never reads as dry. */
export function rainScoreMix(likelihood,trust){
 const t=normalTrust(trust),fallback=likelihood?.mode==='nws-fallback';
 const list=(fallback?likelihood?.partialBlend?.sources:likelihood?.sources)||[];
 let points=0,total=0,listed=0,official=false;
 for(const source of list){
  if(!source?.id||!finite(source.value)||!finite(source.weight)||source.weight<=0)continue;
  listed+=source.weight;if(source.id==='nws')official=true;
  const weight=source.weight*(t[source.id]??1);
  if(!(weight>0))continue;
  points+=weight*source.value;total+=weight;
 }
 if(!(total>0))return null;
 const missing=!fallback&&!official?Math.max(0,1-listed)*t.nws:0;
 return Math.min(100,Math.max(0,points/(total+missing)));
}
const FALLBACK_POLICY={sameDay:{nws:.36,hrrr:.27,ecmwf:.09,nbm:.18,wn:.1},extendedRain:{nws:.135,ecmwf:.54,nbm:.225,wn:.1}};
/** Each source's share of the two Weather Nourie recipes after the user's multipliers. */
export function recipeShares(forecast,trust){
 const t=normalTrust(trust),policy=forecast?.blendPolicy||{};
 const shares=weights=>{
  const rows=SOURCE_ORDER.filter(id=>finite(weights?.[id])&&weights[id]>0).map(id=>({id,base:weights[id],weight:weights[id]*t[id]}));
  const base=rows.reduce((n,r)=>n+r.base,0),total=rows.reduce((n,r)=>n+r.weight,0);
  return rows.map(r=>({id:r.id,base:base>0?r.base/base:0,share:total>0?r.weight/total:0}));
 };
 return {today:shares(policy.sameDay||FALLBACK_POLICY.sameDay),later:shares(policy.extendedRain||FALLBACK_POLICY.extendedRain)};
}
/** The first and last forecast hour each source publishes a temperature for. */
export function sourceCoverage(forecast,now=Date.now()){
 const out={},current=Math.floor(now/H)*H;
 for(const [time,row] of seriesIndex(forecast).temperature){
  if(time<current)continue;
  for(const source of row.sources||[]){
   if(!source?.id||!finite(source.value))continue;
   const entry=out[source.id]||={first:time,last:time,hours:0};
   entry.first=Math.min(entry.first,time);entry.last=Math.max(entry.last,time);entry.hours+=1;
  }
 }
 return out;
}
/** Hour-by-hour and day-by-day forecast for a set of multipliers, next to Weather Nourie's own. */
export function customForecast(forecast,trust,now=Date.now(),dayCount=10){
 const t=normalTrust(trust),exact=isNourieTrust(t),zone=forecast?.location?.timeZone||'America/New_York';
 const current=Math.floor(now/H)*H,index=seriesIndex(forecast);
 const temperature=[...index.temperature].filter(([time])=>time>=current).sort((a,b)=>a[0]-b[0]).map(([time,row])=>{
  const base=finite(row.value)?row.value:null;
  return {time,base,mine:exact?base:mixValue(row.sources,t)};
 });
 const rainRows=new Map();
 for(const row of forecast?.rainTimeline||[]){
  const time=Date.parse(row?.time);if(!finite(time)||time<current||rainRows.has(time))continue;
  const likelihood=row.rainLikelihood||{};
  const base=finite(likelihood.value)&&likelihood.value>=0&&likelihood.value<=100?likelihood.value:null;
  const raw=exact?base:rainScoreMix(likelihood,t);
  const amountBase=finite(row.precipitation)&&row.precipitation>=0?row.precipitation:null;
  const amount=exact?amountBase:mixValue(row.precipitationBlend?.sources,t);
  rainRows.set(time,{time,base,mine:finite(raw)?Math.min(100,Math.max(0,Math.round(raw))):null,amountBase,amountMine:finite(amount)?Math.max(0,amount):null});
 }
 const rain=[...rainRows.values()].sort((a,b)=>a.time-b.time);
 const temps=new Map(temperature.map(row=>[row.time,row]));
 const days=(forecast?.days||[]).filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day?.date||'')).slice(0,dayCount).map((day,i)=>{
  const window=calendarDayWindow(day,i,now,zone),noon=Date.parse(`${day.date}T12:00:00Z`);
  const pick=(map,key)=>{
   const values=[];
   if(!(window.end>window.start))return null;
   for(let time=window.start;time<window.end;time+=H){const value=map.get(time)?.[key];if(!finite(value))return null;values.push(value);}
   return values;
  };
  const side=(tempKey,rainKey,amountKey)=>{
   const tv=pick(temps,tempKey),rv=pick(rainRows,rainKey),av=pick(rainRows,amountKey);
   return {high:tv?Math.round(Math.max(...tv)):null,low:tv?Math.round(Math.min(...tv)):null,
    rain:rv?Math.max(...rv):null,amount:av?av.reduce((n,v)=>n+v,0):null};
  };
  return {date:day.date,index:i,label:i===0?'Today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(noon),
   longLabel:i===0?'today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(noon),
   dateLabel:new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(noon),
   window,base:side('base','base','amountBase'),mine:side('mine','mine','amountMine')};
 });
 return {exact,trust:t,temperature,rain,days};
}
/** The largest changes a recipe makes, for the plain-language summary. */
export function labDifferences(result){
 let temperature=null,rain=null,amount=null;const highs=[];
 for(const day of result?.days||[]){
  for(const kind of ['high','low']){
   const base=day.base[kind],mine=day.mine[kind];
   if(!finite(base)||!finite(mine))continue;
   if(kind==='high')highs.push(mine-base);
   if(!temperature||Math.abs(mine-base)>Math.abs(temperature.delta))temperature={day,kind,base,mine,delta:mine-base};
  }
  if(finite(day.base.rain)&&finite(day.mine.rain)&&(!rain||Math.abs(day.mine.rain-day.base.rain)>Math.abs(rain.delta)))rain={day,base:day.base.rain,mine:day.mine.rain,delta:day.mine.rain-day.base.rain};
  if(finite(day.base.amount)&&finite(day.mine.amount)&&(!amount||Math.abs(day.mine.amount-day.base.amount)>Math.abs(amount.delta)))amount={day,base:day.base.amount,mine:day.mine.amount,delta:day.mine.amount-day.base.amount};
 }
 return {temperature,rain,amount,meanHigh:highs.length?highs.reduce((n,v)=>n+v,0)/highs.length:null,days:highs.length};
}

/* ---------- Plain-language outlook for the top of the page ---------- */
/** When rain shows up in the next 48 hours, from the same hourly chances the clock shows. */
export function rainOutlook(steps){
 if(!steps?.length)return {kind:'unknown'};
 if(steps[0].rainNow)return {kind:'now'};
 const future=steps.filter(step=>!step.isNow),shown=step=>step.rainShown??0;
 const storm=future.find(step=>step.kind==='storm'&&shown(step)>=30);
 const likely=future.find(step=>shown(step)>=50);
 const chance=future.find(step=>shown(step)>=30);
 const values=future.map(step=>step.rain).filter(finite);
 if(storm&&(!likely||storm.time<=likely.time))return {kind:'storm',step:storm};
 if(likely)return {kind:'likely',step:likely};
 if(chance)return {kind:'chance',step:chance};
 if(values.length<future.length*.8)return {kind:'unknown'};
 const peak=Math.max(0,...values);
 return {kind:peak<10?'dry':'slight',peak};
}
/** "around 9 PM", "tomorrow around 3 PM", "overnight, around 2 AM", "Monday around 3 PM". */
export function relativeHour(time,now,zone='America/New_York'){
 const a=localParts(now,zone),b=localParts(time,zone),hour=hourLabel(time,zone);
 const days=Math.round((Date.parse(`${b.date}T12:00:00Z`)-Date.parse(`${a.date}T12:00:00Z`))/86400000);
 if(days<=0)return `around ${hour}`;
 if(days===1&&b.hour<6)return `overnight, around ${hour}`;
 if(days===1)return `tomorrow around ${hour}`;
 return `${longDayLabel(time,zone)} around ${hour}`;
}

/* ---------- Dressed for the hour ---------- */
/** The main page's three illustrated people, in its order: shade, outdoors and a dog walk. Each is one
 * panel of the same artwork, and the clothes are drawn into it for the feels-like value and the sky of
 * the hour shown, so they change as the time-lapse plays. */
export const DRESSED_PEOPLE=[
 {panel:0,label:'In the shade',feel:step=>step.shade??step.temperature},
 {panel:1,label:'Outdoors',feel:step=>step.feels??step.temperature},
 {panel:2,label:'Walking the dog',feel:step=>step.feels??step.temperature},
];
const WEAR_CLOTHES={hot:'Light, hot-weather clothing',warm:'Light warm-weather clothing',mild:'A top and long pants',cool:'A light jacket and long pants',cold:'A heavy coat, scarf, hat and boots'};
/** What the illustrated person wears, in the words the picture shows. */
export function wearText(sceneKey,outfit){
 const clothes=WEAR_CLOTHES[outfit]||'Everyday clothing';
 if(sceneKey==='snow')return 'A heavy coat, hat, scarf and mittens';
 if(sceneKey==='rain')return 'Rain gear and an umbrella';
 if(sceneKey==='carry-umbrella')return `${clothes}, with an umbrella ready`;
 return clothes;
}
/** The three people for one forecast hour. The sample supplies the radar and rain-chance flags the main
 * page uses, so each picture matches the one the main page draws for the same hour. */
export function dressedPeople(step,sample={}){
 if(!step)return [];
 const context={pop:finite(sample?.pop)?sample.pop:step.rain,rainExpected:sample?.rainExpected===true,rainAround:sample?.rainAround===true,radarThreat:sample?.radarThreat===true,snowExpected:false};
 const daylight=step.isDay!==false;
 return DRESSED_PEOPLE.map(person=>{
  const feel=person.feel(step),scene=comfortSceneState(daylight,step.condition,feel,context);
  const outfit=clothingForFeels(feel,{...context,snowExpected:scene.key==='snow'});
  return {label:person.label,feel,daylight,scene:scene.key,outfit,text:wearText(scene.key,outfit),art:referenceScene(person.panel,daylight,step.condition,feel,context)};
 });
}
/* Clothes settle: a change of clothes shows only after it has lasted four hours, and rain gear after two, so a
 * one-hour blip never changes the picture and a shower is not missed. Hours without data are left alone. */
const WET_SCENES=['rain','snow','carry-umbrella'];
function settleRuns(keys,minRun){
 const runs=[];
 keys.forEach((key,i)=>{const last=runs[runs.length-1];if(last&&last.key===key)last.end=i;else runs.push({key,start:i,end:i,src:i});});
 const needed=run=>WET_SCENES.includes(run.key.split('|')[0])?2:minRun;
 for(let changed=true;changed&&runs.length>1;){
  changed=false;
  for(let r=0;r<runs.length;r++){
   const run=runs[r],prev=runs[r-1];
   if(run.key===''||run.end-run.start+1>=needed(run))continue;
   // Short runs are absorbed backward only, so the current hour always shows its own clothes.
   if(!prev||prev.key==='')continue;
   prev.end=run.end;
   runs.splice(r,1);changed=true;break;
  }
 }
 const merged=[];
 for(const run of runs){const last=merged[merged.length-1];if(last&&last.key===run.key)last.end=run.end;else merged.push({...run});}
 return merged;
}
/** The three people for every forecast hour, with the clothes settled. The feels-like value is the hour's own;
 * the scene, outfit, daylight, words and picture come from the hour the settled run was built on (its src). */
export function dressingTimeline(steps,sampleAt=()=>({})){
 const hours=steps.map(step=>step?dressedPeople(step,sampleAt(step)):[]);
 const timeline=steps.map(()=>DRESSED_PEOPLE.map(()=>null));
 DRESSED_PEOPLE.forEach((_,p)=>{
  const keys=hours.map(people=>people[p]?`${people[p].scene}|${people[p].outfit}|${people[p].daylight}`:'');
  for(const run of settleRuns(keys,4)){
   if(run.key==='')continue;
   const source=hours[run.src][p];
   for(let i=run.start;i<=run.end;i++){
    const live=hours[i][p];
    if(live)timeline[i][p]={label:source.label,feel:live.feel,daylight:source.daylight,scene:source.scene,outfit:source.outfit,text:source.text,art:source.art};
   }
  }
 });
 return timeline;
}
