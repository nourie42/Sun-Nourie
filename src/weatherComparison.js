import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildForecast,dateKey,nextDate,Cache} from './weatherFusion.js';
import {solarTimes} from './weatherFusionDirect.js';
import {rebuildHourlyFeels} from './weatherFusionHourlyFeels.js';
import {humidityFromDewpoint,solarElevation} from '../public/weather-fusion/weather-math.js';
import {timeAt} from '../public/weather-fusion/hourly-feels.js';
import {GOOGLE_FEED,HOUR,finite,googlePoints,selectGoogleForecast,skyDescription} from './weatherComparisonData.js';
import {ensembleConfidence,fetchComparisonCompanions,addComparisonCompanions} from './weatherComparisonCompanions.js';
import express from 'express';
import {createWeatherNextAccess} from './weatherNextAccess.js';
import {createWeatherNextLocationProvider,locationPoint} from './weatherNextLocation.js';
const root=fileURLToPath(new URL('../public/weather-fusion/',import.meta.url));
const version='sun-exposure-v1';
const mean=a=>{const v=a.filter(finite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
const extreme=(a,fn)=>{const v=a.filter(finite);return v.length?fn(...v):null;};
const round=v=>finite(v)?Math.round(v*10)/10:null;
const compass=d=>finite(d)?['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]:null;
const iso=t=>new Date(t).toISOString();
const pointDistanceMiles=(a,b)=>{
 const lat=(a.latitude+b.latitude)*Math.PI/360;
 return Math.hypot((a.latitude-b.latitude)*69,(a.longitude-b.longitude)*69*Math.cos(lat));
};
const nearbyPublishedPoint=(points,latitude,longitude,maxMiles=10)=>{
 const requested={latitude:Number(latitude),longitude:Number(longitude)};
 if(!finite(requested.latitude)||!finite(requested.longitude))return null;
 return points.map(point=>({point,miles:pointDistanceMiles(point,requested)})).sort((a,b)=>a.miles-b.miles).find(x=>x.miles<=maxMiles)?.point||null;
};
export function buildGoogleComparison(feed,pointId,now=Date.now()){
 const selected=selectGoogleForecast(feed,pointId,now),p=selected.point,zone=p.timeZone,start=Math.floor(now/HOUR)*HOUR;
 // Empty structural template only. No non-Google forecast is supplied to this builder.
 const out=buildForecast({location:p,point:{timeZone:zone},models:{},feeds:[],grid:{},forecast:{periods:[]},hourly:{periods:[]},now});
 const all=selected.rows.map(r=>({...r,humidity:humidityFromDewpoint(r.temperature,r.dewpoint)}));
 const future=all.filter(r=>r.epoch>=start),map=new Map(all.map(r=>[r.epoch,r]));
 const hour=r=>({...r,windMph:r.wind,wind:finite(r.wind)?`${round(r.wind)} mph`:null,windDirectionDegrees:r.windDirection,windDirection:compass(r.windDirection),isDay:solarElevation(r.epoch,p.latitude,p.longitude)>0,precipitationSource:'Google WeatherNext model-native ensemble mean',rainLikelihood:{value:null,source:'Not published by this Google feed'},temperatureBlend:{value:r.temperature,sources:[{id:'google',weight:1,value:r.temperature}]}});
 out.hours=future.slice(0,49).map(hour);out.rainTimeline=future.map(hour);
 const current=map.get(start);
 out.current=current?{...current,type:'guidance',station:null,stationName:null,wind:current.wind,humidity:current.humidity,apparent:null,skySource:'Google WeatherNext',precipitationSource:'Google WeatherNext',radarPrecipitation:null}:{type:'unavailable',time:iso(start),temperature:null,dewpoint:null,humidity:null,wind:null,gust:null,skyCover:null,condition:'Google forecast unavailable for this hour',radarPrecipitation:null};
 out.current.pressure=null;
 out.current.apparentSource='Weather Nourie calculation using Google-only inputs';
 const keys=['temperature','dewpoint','wind','humidity','pressure','cloud','precipitation','pop','gust','visibility'];
 const series=Object.fromEntries(keys.map(key=>[key,future.map(r=>({time:r.time,value:key==='cloud'?r.skyCover:r[key]??null,source:key==='temperature'?r.temperatureSource:key==='dewpoint'?r.dewpointSource:'Google WeatherNext',runAt:r.provenance.runAt,...(key==='precipitation'?{end:r.precipitationEnd,runAt:r.precipitationRunAt}: {})}))]));
 out.metricForecasts={series,notes:{},solar:[],version:out.experienceVersion};
 const aggregate=(a,b)=>{const rows=all.filter(r=>r.epoch>=a&&r.epoch<b);return {rows,complete:rows.length===Math.round((b-a)/HOUR)};};
 const total=(a,b)=>{const q=aggregate(a,b);return q.complete&&q.rows.every(r=>finite(r.precipitation))?q.rows.reduce((s,r)=>s+r.precipitation,0):null;};
 out.days=out.days.map((day,index)=>{
  const date=day.date,next=nextDate(date),a=timeAt(date,7,zone),b=timeAt(date,19,zone),end=timeAt(next,7,zone);
  const daytime=aggregate(a,b),night=aggregate(b,end),allDay=aggregate(a,end),cloud=mean(daytime.rows.map(r=>r.skyCover)),nCloud=mean(night.rows.map(r=>r.skyCover));
  const high=extreme(daytime.rows.map(r=>r.temperature),Math.max),low=extreme(night.rows.map(r=>r.temperature),Math.min);
  const condition=skyDescription(cloud,extreme(daytime.rows.map(r=>r.precipitation),Math.max)),nightCondition=skyDescription(nCloud,extreme(night.rows.map(r=>r.precipitation),Math.max));
  const coverageNote=`High/low are extrema of available Google hourly means in 7am–7pm / 7pm–7am windows. ${daytime.complete&&night.complete?'Full':'Partial'} period coverage. Rain amount is a mean, not a probability.`;
  return {...day,high:round(high),low:round(low),condition,nightCondition,detail:coverageNote,nightDetail:coverageNote,pop:null,popDay:null,popNight:null,popLabel:'Not published by this Google feed',rainLikelihood:{value:null},popDayLikelihood:{value:null},popNightLikelihood:{value:null},qpf:total(a,end),remainingQpf:index===0?total(Math.max(a,Math.ceil(now/HOUR)*HOUR),end):null,qpfWindow:{start:iso(a),end:iso(end)},qpfSource:'Google native hourly ensemble means',temperatureSource:'Google WeatherNext; station-trained when a matching run is published',lowLabel:'Overnight low',highWindow:{start:iso(a),end:iso(b)},lowWindow:{start:iso(b),end:iso(end)},confidence:ensembleConfidence(allDay.rows,now,index),guidance:{},illustrativeBlend:null,agreement:'One Google ensemble',highSpread:null,qpfSpread:null,uvMax:null,wind:finite(mean(allDay.rows.map(r=>r.wind)))?`${round(mean(allDay.rows.map(r=>r.wind)))} mph`:null,windDirection:null,googleCoverage:{dayHours:daytime.rows.length,nightHours:night.rows.length,complete:daytime.complete&&night.complete}};
 });
 out.solar=solarTimes(dateKey(now,zone),p.latitude,p.longitude);
 out.metricForecasts.solar=out.days.map(d=>({date:d.date,...solarTimes(d.date,p.latitude,p.longitude)}));
 out.exposureWeather={source:'Google WeatherNext',url:'https://developers.google.com/weathernext',timezone:zone,rows:all.map(r=>({...r,rain:finite(r.precipitation)?r.precipitation*25.4:null,uvIndex:null})),uv:[],historyBasis:'Published Google model trajectories, not measured historical weather',radiationBasis:'Google hourly-average solar irradiance; not instantaneous radiation or UV index'};
 out.uv={source:'Not published by this Google feed',today:null,hourly:[]};
 out.airQuality=null;out.discussion=null;out.alerts=[];out.specialDiscussions=[];out.precipitationDiscussions=[];out.riskOutlooks=[];out.danTake=null;out.aiConfigured=false;out.modelContributions=[];
 out.feeds=selected.runs.map(r=>({id:`google-${r.id}`,label:`Google WeatherNext ${r.id==='interimSurface'?'short-range hourly run':'main run'}`,status:r.status==='last-verified'||now-Date.parse(r.runAt)>36*HOUR?'stale':'ready',contributes:true,issuedAt:r.runAt,fetchedAt:r.fetchedAt,url:'https://developers.google.com/weathernext',message:'Newest published applicable initialization, not a claim of proven local superiority.'}));
 out.methodology='Google WeatherNext only. For each valid time, use the newest published applicable surface initialization; within 48 hours this may be the interim hourly run. A matching station-trained run supplies temperature/dew point where available; otherwise the same Google surface run is used. No NWS, HRRR, ECMWF or Open-Meteo values enter this forecast. Feels-like, humidity, clothing and pavement are Weather Nourie-derived estimates, not Google-issued products. Missing data remain missing. Sunrise/sunset are astronomical calculations. Precipitation intervals are aligned to the following hour for comparison.';
 rebuildHourlyFeels(out,{now,temperatureAt:t=>({value:map.get(t)?.temperature??null,source:'Google WeatherNext'}),humidityAt:t=>map.get(t)?.humidity??null,skyAt:t=>({value:map.get(t)?.skyCover??null,source:'Google WeatherNext'})});
 out.metricForecasts.notes={...out.metricForecasts.notes,humidity:'Derived from Google temperature and dew point.',feels:'Weather Nourie outdoor/shade calculation applied only to same-hour Google forecast inputs. Not a Google-issued feels-like product.',precipitation:'Mean amount during [hour, hour+1); Google ending-hour accumulations are shifted to their actual interval.',solar:'Astronomical sunrise/sunset, not a Google model variable.'};
 out.comparison={source:'google',point:p,runs:selected.runs,policy:'Freshest applicable published run; matching station-trained temperature/dew point when available',missing:['Rain probability','UV index','Air quality','Wind gusts','Live radar','Official warnings'],history:'No observations used',currentValidTime:out.current.time};
 out.signature=createHash('sha256').update(JSON.stringify({point:p,runs:selected.runs,hours:out.hours,now:start})).digest('hex').slice(0,24);
 return out;
}
function replaceOnce(text,needle,value){if(!text.includes(needle))throw Error('Shared weather layout changed; comparison adapter requires review.');return text.replace(needle,value);}
export function comparisonApp(original,config){
 // Repository browser assets are currently CRLF. Normalize before applying
 // exact adapter edits so the generated Google dashboard script cannot fail
 // just because of line-ending differences.
 let s=original.replace(/\r\n?/g,'\n').replaceAll("from './","from '/weather-fusion/");
 s=`import {installComparisonPane} from '/weather-fusion/compare-bridge.js?v=${version}';\nconst COMPARE=${JSON.stringify(config)};\n`+s;
 s=replaceOnce(s,"async function api(path, params = '', signal) {","async function api(path, params = '', signal) {\n  if(COMPARE.source==='google'&&path==='forecast')return compareBridge.requestForecast(params,signal);");
 s=replaceOnce(s,"async function api(path, params = '', signal) {","async function api(path, params = '', signal) {\n  if(COMPARE.source==='google'&&!['forecast','search'].includes(path))throw Object.assign(new Error('Not supplied by Google WeatherNext.'),{status:503});");
 s=replaceOnce(s,'`/api/weather-fusion/${path}${params ?',"`${COMPARE.source==='google'&&path==='forecast'?'/api/weather-fusion/compare/google':'/api/weather-fusion/'+path}${params ?");
 s=replaceOnce(s,'data.rainTrend=updateRainTrend(data,Date.now());',"data.rainTrend=COMPARE.source==='google'?null:updateRainTrend(data,Date.now());");
 s=replaceOnce(s,"$('status').classList.add('error');","if(COMPARE.source==='google'&&e.status===404)$('status').textContent='WeatherNext is not yet connected for this location. Use the main weather page for your local forecast.';\n    $('status').classList.add('error');");
 s=replaceOnce(s,"$('status').classList.toggle('error', unavailable.length > 0 || failedPanels.length > 0);","$('status').classList.toggle('error', unavailable.length > 0 || failedPanels.length > 0);\n  compareBridge.rendered(data);");
 s=replaceOnce(s,'installExperience();\nstartDeviceLocation();',"const compareBridge=installComparisonPane(COMPARE,{selectHour:selectComfortHour,showDay,refresh:()=>load(),getForecast:()=>forecast});\ninstallExperience();\nif(COMPARE.explicitLocation)chooseLocation({...COMPARE.point,source:'comparison'});else startDeviceLocation();");
 return s;
}
export function registerWeatherComparisonRoutes(app,{fetchImpl=globalThis.fetch,now=Date.now,feedProvider,companionProvider,accessOptions={},locationProvider}={}){
 const cache=new Cache(12,now);
 const access=createWeatherNextAccess(app,{now,...accessOptions});
 const provider=locationProvider||createWeatherNextLocationProvider({fetchImpl,now});
 const localFeeds=new Map(),pending=new Map();
 const localFeed=point=>{const saved=localFeeds.get(point.id);if(saved&&saved.expires>now())return saved.feed;localFeeds.delete(point.id);return null;};
 const getFeed=()=>cache.get('feed',120000,async()=>{
  if(feedProvider)return feedProvider();
  const r=await fetchImpl(GOOGLE_FEED,{signal:AbortSignal.timeout(25000),redirect:'error',headers:{Accept:'application/json'}});
  if(!r.ok)throw Object.assign(Error('The Google feed could not be refreshed.'),{status:503});
  const data=await r.json();googlePoints(data);return data;
 });
 const fail=(res,e)=>res.set('Cache-Control','no-store').status(e.status||503).json({error:e.message||'Comparison data unavailable.',code:e.code});
 const config=async q=>{const source=q.source==='google'?'google':q.source==='fusion'?'fusion':null;if(!source)throw Object.assign(Error('Choose Fusion or Google.'),{status:400});const coords=q.latitude!==undefined&&q.longitude!==undefined&&Number.isFinite(Number(q.latitude))&&Number.isFinite(Number(q.longitude))&&Math.abs(Number(q.latitude))<=90&&Math.abs(Number(q.longitude))<=180;const point=coords?{id:'selected',name:'Selected location',latitude:Number(q.latitude),longitude:Number(q.longitude)}:googlePoints(await getFeed()).find(p=>p.id===q.location);if(!point)throw Object.assign(Error('Choose a published comparison location.'),{status:404});return {source,point,explicitLocation:coords||q.explicit==='1'};};
 app.get(['/weather-fusion','/weather-fusion/'],async(_req,res,next)=>{
  try{const html=await readFile(root+'index.html','utf8');res.set('Cache-Control','no-cache').type('html').send(html);
  }catch(e){next(e);}
 });
 app.get(['/weathernext','/weathernext/','/weather-fusion/weathernext-site.html'],async(req,res)=>{try{
  // Do not let a stale pre-repair WeatherNext dashboard survive a mobile
  // conditional GET. This is the first /weathernext route registered by server.js.
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  const points=googlePoints(await getFeed());
  const coordinatePoint=req.query.latitude!==undefined&&req.query.longitude!==undefined?nearbyPublishedPoint(points,req.query.latitude,req.query.longitude):null;
  const point=points.find(p=>p.id===req.query.location)||coordinatePoint||points[0];
  const useExactCoordinates=req.query.latitude!==undefined&&req.query.longitude!==undefined&&!coordinatePoint;
  let html=await readFile(root+'index.html','utf8');
  html=html.replace(/<script type="module" src="\/weather-fusion\/app\.js[^"]*"><\/script>/, '<script type="module" src="/weather-fusion/compare/app.js?source=google&amp;location='+encodeURIComponent(point.id)+((req.query.location||coordinatePoint)?'&amp;explicit=1':'')+(useExactCoordinates?'&amp;latitude='+encodeURIComponent(req.query.latitude)+'&amp;longitude='+encodeURIComponent(req.query.longitude):'')+'"></script>');
  html=html.replace('Because Apple, Google and Samsung weather suck','Your local weather, clearly explained').replace('<title>Weather Nourie</title>','<title>Experimental NVIDIA AI Weather</title>');
  html=html.replace('</head>','<link rel="stylesheet" href="/weather-fusion/compare.css?v=mobile-repair-v1"></head>').replace('<body data-sky="day">','<body data-sky="day" class="google-pane weathernext-dashboard">');
  html=html.replace('<main id="forecast">','<h1 class="weathernext-heading">Experimental NVIDIA AI Weather</h1><main id="forecast">');
  html=html.replace('<a class="forecast-compare-banner" href="/weathernext/" aria-label="Compare to Nvidia AI Forecast">Compare to Nvidia AI Forecast</a>','<a class="forecast-compare-banner" href="/weather-fusion/">Back to Dan&#39;s Weather</a>');
  res.set('Cache-Control','no-store, no-cache, max-age=0, must-revalidate').set('Pragma','no-cache').set('Expires','0').set('X-Weather-Nourie-Page','google-dashboard-crlf-fix-20260925').type('html').send(html);
 }catch(e){fail(res,e);}});
 app.get(['/weather-fusion/compare','/weather-fusion/compare/','/weather-fusion/compare.html'],(req,res)=>res.set('Cache-Control','no-cache').redirect(302,'/weathernext/'+(typeof req.query.location==='string'?'?location='+encodeURIComponent(req.query.location):'')));
 for(const name of ['compare.css','compare.js','compare-bridge.js','weathernext-access.js'])app.get('/weather-fusion/'+name,(_req,res)=>res.set('Cache-Control','no-cache').sendFile(root+name));
 app.get('/api/weather-fusion/compare/locations',async(_req,res)=>{try{res.set('Cache-Control','no-store').json({points:googlePoints(await getFeed())});}catch(e){fail(res,e);}});
 async function resolveForecast(query){
  const requested=query.latitude!==undefined||query.longitude!==undefined?locationPoint(query):null;
  const feed=await getFeed();
  const point=googlePoints(feed).find(p=>requested?Math.abs(p.latitude-requested.latitude)<.00011&&Math.abs(p.longitude-requested.longitude)<.00011:p.id===query.location);
  if(point)return {feed,point};
  if(!requested)throw Object.assign(Error(query.location?'Google has no published forecast for that location.':'Choose a city or use your device location.'),{status:query.location?404:400});
  const saved=localFeed(requested);
  return {feed:saved,point:saved?.points[0]||requested};
 }
 async function forecastFor({feed,point}){
  return cache.get('forecast:'+point.id,45000,async()=>addComparisonCompanions(buildGoogleComparison(feed,point.id,now()),await (companionProvider?companionProvider(point):fetchComparisonCompanions(point,fetchImpl))));
 }
 app.get('/api/weather-fusion/compare/google',async(req,res)=>{try{
  const resolved=await resolveForecast(req.query);
  if(!resolved.feed)return res.set('Cache-Control','no-store').status(409).json({error:'Load a forecast for your selected location.',code:'LOCATION_REQUIRED'});
  res.set('Cache-Control','no-store').json(await forecastFor(resolved));
 }catch(e){fail(res,e);}});
 app.post('/api/weather-fusion/compare/location',access.sameOrigin,express.json({limit:'2kb'}),async(req,res)=>{try{
  const point=locationPoint(req.body),resolved=await resolveForecast(point);
  if(resolved.feed)return res.set('Cache-Control','no-store').json(await forecastFor(resolved));
  if(!provider.configured)throw Object.assign(Error('Private location lookups are awaiting Google Cloud setup by the site owner.'),{status:503,code:'SETUP_REQUIRED'});
  if(!pending.has(point.id)){
   if(pending.size>=2)throw Object.assign(Error('Location queries are busy. Please try again shortly.'),{status:429});
   const job=provider.lookup(point).then(feed=>{
    const selected=googlePoints(feed).find(p=>p.id===point.id&&p.latitude===point.latitude&&p.longitude===point.longitude);
    if(!selected)throw Error('The forecast did not match the requested location.');
    buildGoogleComparison(feed,point.id,now());
    if(localFeeds.size>=32)localFeeds.delete(localFeeds.keys().next().value);
    localFeeds.set(point.id,{feed,expires:now()+6*3600000});return {feed,point:selected};
   }).finally(()=>pending.delete(point.id));
   pending.set(point.id,job);
  }
  res.set('Cache-Control','no-store').json(await forecastFor(await pending.get(point.id)));
 }catch(e){fail(res,e);}});
 app.get('/weather-fusion/compare/pane',async(req,res)=>{try{const c=await config(req.query);let html=await readFile(root+'index.html','utf8');html=html.replace(/<script type="module" src="\/weather-fusion\/app\.js[^\"]*"><\/script>/,`<script type="module" src="/weather-fusion/compare/app.js?source=${c.source}&amp;location=${encodeURIComponent(c.point.id)}"></script>`);html=html.replace('</head>',`<link rel="stylesheet" href="/weather-fusion/compare.css?v=${version}"></head>`).replace('<body data-sky="day">',`<body data-sky="day" class="comparison-pane ${c.source==='google'?'google-pane':'fusion-pane'}">`);if(c.source==='google')html=html.replace(/<script defer src="https:\/\/unpkg.com\/leaflet[^>]*><\/script>/,'');res.set('Cache-Control','no-cache').type('html').send(html);}catch(e){fail(res,e);}});
 app.get('/weather-fusion/compare/app.js',async(req,res)=>{try{
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  const c=await config(req.query);
  res.set('Cache-Control','no-store, no-cache, max-age=0, must-revalidate').set('Pragma','no-cache').set('Expires','0').type('application/javascript').send(comparisonApp(await readFile(root+'app.js','utf8'),c));
 }catch(e){
  console.error('WeatherNext comparison app generation failed:',e?.message||e);
  res.set('Cache-Control','no-store').status(503).type('application/javascript').send("throw new Error('The Google weather page could not be prepared. Refresh or return to Dan\'s Weather.');");
 }});
}
