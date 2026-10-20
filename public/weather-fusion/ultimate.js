/** Ultimate Weather — the best of every page, together. */
import {calendarDayTemperatures,rainWindowPeak} from './calendar-day.js?v=calendar-days-v1';
import {currentSample,sampleCaption,windDirectionLabel} from './weather-display.js?v=low-rain-display-v1';
import {currentAirQuality} from './air-quality.js?v=mobile-repair-v1';
import {hourlyUvValue,uvCategory} from './daily-uv.js?v=weather-art-labels-v10';
import {forecastSnapshotFreshness} from './weather-freshness.js?v=accuracy-20261019-v1';
import {forecastRows,matchingForecastRows,installForecastRefresh} from './weathernext-data.js';
const el = (id) => document.getElementById(id);
const opt = (id) => document.getElementById(id);
function setText(id, txt) { const n = opt(id); if (n) n.textContent = txt; }
function setHTML(id, html) { const n = opt(id); if (n) n.innerHTML = html; }
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const WN_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';

let forecast = null, wnFeed = null, wnCatalog = null;
let loc = ['knightdale','greenville','hazen'].includes(new URLSearchParams(typeof location==='undefined'?'':location.search).get('location'))?new URLSearchParams(typeof location==='undefined'?'':location.search).get('location'):'knightdale';
let wnField = 'temperature_2m';
let skyFlip = false;

const reading=value=>finite(value)?Math.round(value):'—';
const rainValue=row=>row?.rainLikelihood&&Object.hasOwn(row.rainLikelihood,'value')?row.rainLikelihood.value:row?.pop;
export function buildUltimateCurrent(data,now=Date.now()){
  data={...data,location:data?.location||{}};
  const sample=currentSample(data,now),c=sample.inputs,zone=data.location?.timeZone||'America/New_York';
  const time=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(value)):'—';
  const rainHours=(data.hours||[]).filter(row=>Date.parse(row.time)+3600000>now&&Date.parse(row.time)<now+12*3600000);
  const rainPeak=rainWindowPeak(rainHours.map(row=>({...row,rainLikelihood:{value:rainValue(row)}})),{start:now,end:now+12*3600000});
  return {sample,inputs:c,feels:sample.feels,condition:sample.condition,caption:sampleCaption(sample,zone),
    uvNow:hourlyUvValue(data,now),uvPeak:finite(data.uv?.today)?data.uv.today:null,aqi:currentAirQuality(data,now)?.aqi??null,
    sunrise:time(data.solar?.sunrise),sunset:time(data.solar?.sunset),timeZone:zone,
    days:(data.days||[]).slice(0,7).map((day,index)=>({...day,...calendarDayTemperatures(data,index,now)})),
    hours:(data.hours||[]).filter(row=>Date.parse(row.time)+3600000>now).slice(0,12),
    rainHours,rainPeak:rainPeak.value,
    stale:forecastSnapshotFreshness(data,now).expired};
}
let currentView=null;

const WN_UNITS = { temperature_2m: '°F', dewpoint_temperature_2m: '°F', wind_speed_10m: 'mph', total_precipitation_1hr: 'in', total_cloud_cover: '%' };
const WN_LABELS = { temperature_2m: 'Air temp', dewpoint_temperature_2m: 'Dew point', wind_speed_10m: 'Wind', total_precipitation_1hr: 'Precip', total_cloud_cover: 'Clouds' };
const WN_VARS = ['temperature_2m', 'dewpoint_temperature_2m', 'wind_speed_10m', 'total_precipitation_1hr', 'total_cloud_cover'];

function setSky(img) {
  const url = `/weather-fusion/${img}`;
  const show = skyFlip ? opt('sky-a') : opt('sky-b');
  const hide = skyFlip ? opt('sky-b') : opt('sky-a');
  if (!show || !hide) return;
  if (show.dataset.img === img) return;
  const pre = new Image();
  pre.onload = () => {
    show.style.backgroundImage = `url("${url}")`;
    show.dataset.img = img;
    show.classList.add('on');
    hide.classList.remove('on');
    skyFlip = !skyFlip;
  };
  pre.src = url;
}

function pickSky() {
  if (currentView?.sample.isDay===false) return 'today-sky-night-v2.webp';
  const cond = (currentView?.condition || '').toLowerCase();
  if (/thunder|storm|tornado/.test(cond)) return 'today-sky-storm.webp';
  if (/rain|shower|drizzle/.test(cond)) return 'today-sky-rain.webp';
  if (/cloud|overcast|fog/.test(cond)) return 'today-sky-clouds.webp';
  return 'today-sky-clear.webp';
}

let latestRequest=0;
async function load() {
  const request=++latestRequest;
  try {
    const [fRes, wnRes, catRes] = await Promise.all([
      fetch(`/api/weather-fusion/forecast?location=${loc}`).then((r) => {if(!r.ok)throw new Error(`Weather service responded ${r.status}`);return r.json();}),
      fetch(WN_FEED, { cache:'no-store', signal: AbortSignal.timeout(30000) }).then((r) => r.json()).catch(() => null),
      fetch('/weather-fusion/weathernext-catalog.json').then((r) => r.json()).catch(() => null),
    ]);
    if(request!==latestRequest)return;
    if(!fRes?.location||!fRes.current||!Array.isArray(fRes.hours))throw new Error('Weather service returned an incomplete forecast');
    forecast = fRes;
    wnFeed = wnRes;
    wnCatalog = catRes;
    el('updated').textContent=Number.isFinite(Date.parse(forecast.assembledAt))?`Forecast updated ${new Date(forecast.assembledAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:forecast.location.timeZone||'America/New_York'})}`:'Forecast update time unavailable';
    renderAll();
  } catch (e) {
    if(request!==latestRequest)return;
    const err = opt('error');
    err.hidden = false;
    err.textContent = `Couldn't load: ${e.message}`;
    if(forecast)renderAll();
  }
}

function renderAll() {
  currentView=buildUltimateCurrent(forecast);
  setSky(pickSky());
  renderHero();
  renderOverview();
  renderModels();
  renderAILab();
  renderDetails();
  const alerts = forecast.alerts || [];
  el('alert-strip').hidden=!alerts.length;
  if (alerts.length) {
    const strip = el('alert-strip');
    strip.hidden = false;
    strip.textContent = `⚠ ${alerts[0].event} — ${alerts[0].headline || ''}`.slice(0, 160);
  }
}

function renderHero() {
  const v=currentView,c=v.inputs,d0=v.days[0];
  el('now-temp').textContent=reading(c.temperature);el('now-cond').textContent=v.condition;
  setText('now-feels',finite(v.feels)?`Feels ${reading(v.feels)}°`:'Feels unavailable');if(opt('now-feels'))el('now-feels').title=v.caption;
  el('hero-loc').textContent=forecast.location?.name||'Knightdale';
  el('now-hilo').textContent=d0?`H ${reading(d0.high)}° / L ${reading(d0.low)}°`:'';
  const insights=[],hrs=v.hours,rainHr=v.rainHours.find(h=>finite(rainValue(h))&&rainValue(h)>=40);
  const clock=t=>new Intl.DateTimeFormat('en-US',{timeZone:v.timeZone,hour:'numeric'}).format(new Date(t));
  if(v.stale||!finite(v.rainPeak))insights.push('Rain outlook unavailable until the forecast refreshes.');
  else if(rainHr)insights.push(`🌧 Rain possible by ${clock(rainHr.time)} (${reading(rainValue(rainHr))}% blended likelihood)`);
  else insights.push('No significant rain expected next 12h');
  const warm=hrs.filter(h=>finite(h.temperature)).reduce((a,b)=>!a||b.temperature>a.temperature?b:a,null);
  if(warm&&!v.stale)insights.push(`🌡 Warmest at ${clock(warm.time)} (${reading(warm.temperature)}°)`);
  if(finite(v.feels))insights.push(`Feels ${reading(v.feels)}° outside`);
  setHTML('insight-row',insights.map(i=>`<span class="insight-chip">${i}</span>`).join(''));
}

function renderOverview() {
  const v=currentView,hrs=v.hours,c=v.inputs,days=v.days;
  const maxPop=v.rainPeak;
  el('hourly-desc').textContent=v.stale||maxPop===null?'Rain outlook unavailable until the forecast refreshes.':maxPop<20?'No significant rain expected over the next 12 hours.':`Peak blended rain likelihood ${reading(maxPop)}% over the next 12 hours.`;
  el('hourly-strip').innerHTML=hrs.map(h=>{
    const label=new Intl.DateTimeFormat('en-US',{timeZone:v.timeZone,hour:'numeric'}).format(new Date(h.time)).replace(' ',''),pop=rainValue(h);
    const wind=h.windMph??h.wind,direction=windDirectionLabel(h.windDirectionDegrees??h.windDirection);
    return `<div class="hour"><div class="t">${label}</div><div class="ic">${iconFor(h.condition,h.isDay)}</div><div class="tp">${reading(h.temperature)}°</div><div class="pp">${finite(pop)&&pop>=15?reading(pop)+'%':''}</div><div class="wd">${direction} ${reading(wind)}</div></div>`;
  }).join('');
  const gHi=Math.max(...days.map(d=>d.high).filter(finite)),gLo=Math.min(...days.map(d=>d.low).filter(finite));
  el('daily-desc').textContent='Today shows the remaining calendar date; later days run midnight to midnight.';
  el('day-list').innerHTML=days.map((d,i)=>{
    const name=i===0?'Today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(new Date(d.date+'T12:00:00Z'));
    const valid=finite(d.high)&&finite(d.low),left=valid?(d.low-gLo)/Math.max(1,gHi-gLo)*100:0,width=valid?Math.max(10,(d.high-d.low)/Math.max(1,gHi-gLo)*100):0,pop=rainValue(d);
    return `<div><div class="day-row"><div class="d">${name}</div><div class="ic">${iconFor(d.condition,true)}</div><div class="lo">${reading(d.low)}°</div><div class="bar"><i style="left:${left.toFixed(0)}%;width:${width.toFixed(0)}%"></i></div><div class="hi">${reading(d.high)}°</div></div>${finite(pop)&&pop>=20?`<div class="pp">💧 ${reading(pop)}%</div>`:''}</div>`;
  }).join('');
  const metrics=[
    ['💨 Wind',`${reading(c.wind)}<small> mph</small>`,finite(c.gust)?`Gusts ${reading(c.gust)}`:windDirectionLabel(c.windDirection)],
    ['💧 Humidity',`${reading(c.humidity)}<small>%</small>`,`Dew ${reading(c.dewpoint)}°`],
    ['🌡 Feels like',`${reading(v.feels)}<small>°</small>`,`Air ${reading(c.temperature)}°`],
    ['👁 Visibility',`${reading(c.visibility)}<small> mi</small>`,''],
    ['☀ UV now',String(reading(v.uvNow)),`Peak today ${reading(v.uvPeak)} · ${uvCategory(v.uvNow).label}`],
    ['Air quality',String(reading(v.aqi)),'Modeled U.S. AQI'],
    ['🌅 Sunrise',v.sunrise,''],['🌇 Sunset',v.sunset,'']
  ];
  el('metric-grid').innerHTML=metrics.map(([k,value,sub])=>`<div class="tile"><div class="k">${k}</div><div class="v">${value}</div>${sub?`<div class="s">${sub}</div>`:''}</div>`).join('');
}

function windArrow(deg) {
  const dirs = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
function iconFor(cond,isDay=currentView?.sample.isDay) {
  const c = (cond || '').toLowerCase();
  if (/thunder|storm/.test(c)) return '⛈';
  if (/rain|shower|drizzle/.test(c)) return '🌧';
  if (/snow|sleet|flurr/.test(c)) return '🌨';
  if (/cloud|overcast/.test(c)) return '☁';
  if (/fog|mist|haze/.test(c)) return '🌫';
  if (/clear|sun/.test(c)) return isDay===false?'🌙':'☀';
  return '⛅';
}

function renderModels() {
  // Chart: blended line + per-model + WN band (best of Blend)
  const hrs = forecastRows(forecast.hours).slice(0, 48);
  const sources=hrs[0]?.temperatureBlend?.sources||[];
  const bp=Object.fromEntries(sources.filter(s=>finite(s.weight)).map(s=>[s.id,s.weight]));
  const modelName=id=>id==='wn'?'Google WeatherNext':id.toUpperCase();
  el('blend-weights').innerHTML=Object.entries(bp).map(([id,v])=>`<span><b>${modelName(id)}</b> ${Math.round(v*1000)/10}%</span>`).join('')||'Matching-hour weights unavailable';
  if (!hrs.length){setHTML('blend-chart','<p class="fine">Upcoming model comparison unavailable.</p>');setHTML('model-legend','');setHTML('model-cards','');return;}
  const W = 900, H = 280, PL = 44, PR = 12, PT = 16, PB = 30;
  const allV = hrs.flatMap((h) => [h.temperature, h.temperatureBlend?.value,...(h.temperatureBlend?.sources||[]).map(source=>source.value)]).filter(finite);
  let lo = Math.min(...allV), hi = Math.max(...allV);
  const pad = (hi - lo) * 0.15 || 2;
  lo -= pad; hi += pad;
  const X = (i) => PL + (i / Math.max(1, hrs.length - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);

  const models=sources.map(source=>({...forecast.modelContributions?.find(model=>model.id===source.id),...source,temperature:source.value}));
  const colors = { nws: '#7fd4ff', hrrr: '#b48cff', nbm: '#6aa8ff', ecmwf: '#ffd479',wn:'#9ef0c2' };
  let paths = '';
  let legend = '';
  for (const m of models) {
    // Each line uses the published model values for these exact forecast hours.
    let started=false,d='';for(const [i,h]of hrs.entries()){const value=h.temperatureBlend?.sources?.find(source=>source.id===m.id)?.value;if(!finite(value)){started=false;continue;}d+=`${started?'L':'M'}${X(i).toFixed(1)},${Y(value).toFixed(1)}`;started=true;}if(d)paths+=`<path d="${d}" fill="none" stroke="${colors[m.id]||'#b48cff'}" stroke-width="1.5"/>`;
    legend += `<span><i class="sw" style="background:${colors[m.id] || '#fff'};height:3px"></i>${modelName(m.id)}</span>`;
  }
  const line = hrs.map((h, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(h.temperature).toFixed(1)}`).join('');
  // WN band if available
  let wnBand = '';
  if (wnFeed?.sources?.surface) {
    const pts = wnFeed.sources.surface.points.find((p) => p.id === loc);
    const wh = matchingForecastRows(pts?.hourly,hrs.map(h=>h.time));
    const segments=[];let segment=[];
    for(const [i,r] of wh.entries()){
      const low=r?.values?.temperature_2m?.p10,high=r?.values?.temperature_2m?.p90;
      if(finite(low)&&finite(high)&&(!segment.length||Date.parse(hrs[i].time)-Date.parse(hrs[segment.at(-1).i].time)===3600000))segment.push({i,low,high});
      else {if(segment.length)segments.push(segment);segment=finite(low)&&finite(high)?[{i,low,high}]:[];}
    }
    if(segment.length)segments.push(segment);
    wnBand=segments.filter(s=>s.length>1).map(wh=>{
      const conv = (v) => (v - 273.15) * 1.8 + 32;
      const top = wh.map(r => `${X(r.i).toFixed(1)},${Y(conv(r.high)).toFixed(1)}`).join(' ');
      const bot = wh.map(r => `${X(r.i).toFixed(1)},${Y(conv(r.low)).toFixed(1)}`).reverse().join(' ');
      return `<polygon points="${top} ${bot}" fill="rgba(180,140,255,.16)"/>`;
    }).join('');
  }

  el('blend-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Model blend chart">
    ${wnBand}${paths}
    <path d="${line}" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
  setHTML('model-legend', legend);

  // Model cards
  el('model-cards').innerHTML = models.map((m) => `
    <div class="model-card"><div class="n">${modelName(m.id)}</div><div class="w">${finite(m.weight)?`${Math.round(m.weight*1000)/10}% temperature weight`:'Weight unavailable'}</div>
    <div class="t">${finite(m.temperature) ? Math.round(m.temperature) + '°' : '—'}</div><div class="r">${m.runAt ? 'Run ' + new Date(m.runAt).toLocaleTimeString('en-US', { hour: 'numeric' }) : ''}</div></div>
  `).join('');
}

function renderAILab() {
  // Variable picker (simplified from WN page)
  el('wn-var-grid').innerHTML = WN_VARS.map((id) =>
    `<button class="var-btn ${id === wnField ? 'on' : ''}" data-var="${id}">${WN_LABELS[id]}<small>${WN_UNITS[id]}</small></button>`
  ).join('');
  el('wn-var-grid').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    wnField = b.dataset.var;
    renderAILab();
  };

  if (!wnFeed?.sources?.surface) {
    el('wn-chart2').innerHTML = '<p class="fine">WeatherNext feed unavailable.</p>';
    setText('wn-age','No published forecast is available.');
    return;
  }
  const pts = wnFeed.sources.surface.points.find((p) => p.id === loc);
  const rows = forecastRows(pts?.hourly).slice(0, 168);
  if (!rows.length) {
    el('wn-chart2').innerHTML = '<p class="fine">No current or upcoming WeatherNext forecast hours in this run.</p>';
    setText('wn-age','The published forecast has ended. A newer run is needed.');
    return;
  }

  const conv = { temperature_2m: (v) => (v - 273.15) * 1.8 + 32, dewpoint_temperature_2m: (v) => (v - 273.15) * 1.8 + 32, wind_speed_10m: (v) => v * 2.237, total_precipitation_1hr: (v) => v * 39.37, total_cloud_cover: (v) => v * 100 }[wnField];
  const data = rows.map((r) => ({
    t: Date.parse(r.time),
    mean: conv(r.values?.[wnField]?.mean),
    p10: conv(r.values?.[wnField]?.p10),
    p90: conv(r.values?.[wnField]?.p90),
  })).filter((d) => finite(d.mean));

  const W = 900, H = 260, PL = 44, PR = 12, PT = 16, PB = 30;
  const allV = data.flatMap((d) => [d.p10, d.p90]).filter(finite);
  let lo = Math.min(...allV), hi = Math.max(...allV);
  const pad = (hi - lo) * 0.15 || 1;
  lo -= pad; hi += pad;
  const X = (i) => PL + (i / Math.max(1, data.length - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);

  const band = data.map((d, i) => `${X(i).toFixed(1)},${Y(d.p90).toFixed(1)}`).join(' ') + ' ' +
    data.map((d, i) => `${X(i).toFixed(1)},${Y(d.p10).toFixed(1)}`).reverse().join(' ');
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.mean).toFixed(1)}`).join('');

  setText('wn-chart-title', `${WN_LABELS[wnField]} · next ${rows.length} available model hours`);
  el('wn-chart2').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="WeatherNext ${wnField}">
    <defs><linearGradient id="uw-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b48cff" stop-opacity=".3"/><stop offset="100%" stop-color="#b48cff" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${band}" fill="rgba(180,140,255,.18)"/>
    <polygon points="${data.map((d, i) => `${X(i).toFixed(1)},${Y(d.mean).toFixed(1)}`).join(' ')} ${X(data.length - 1).toFixed(1)},${(H - PB).toFixed(1)} ${X(0).toFixed(1)},${(H - PB).toFixed(1)}" fill="url(#uw-fill)"/>
    <path d="${line}" fill="none" stroke="#b48cff" stroke-width="2.5" stroke-linejoin="round"/>
  </svg>`;

  const age = (Date.now() - Date.parse(wnFeed.sources.surface.runAt)) / 86400000;
  setText('wn-age', age > 1 ? `⚠ Model run ${Math.round(age)} days ago — data may be stale.` : 'Fresh model run.');
}

function renderDetails() {
  const v=currentView,c=v.inputs;
  const details=[['Feels like',`${reading(v.feels)}°`],['Dew point',`${reading(c.dewpoint)}°`],['Humidity',`${reading(c.humidity)}%`],
    ['Wind',`${reading(c.wind)} mph ${windDirectionLabel(c.windDirection)}`],['Gusts',`${reading(c.gust)} mph`],
    ['Pressure',finite(c.pressureInHg??c.pressure)?`${(c.pressureInHg??c.pressure).toFixed(2)} in`:'—'],
    ['Visibility',`${reading(c.visibility)} mi`],['UV now',reading(v.uvNow)],['Peak UV today',reading(v.uvPeak)],
    ['Sunrise',v.sunrise],['Sunset',v.sunset],['Air quality',reading(v.aqi)]];
  el('detail-list').innerHTML=details.map(([key,value])=>`<div><dt>${key}</dt><dd>${value}</dd></div>`).join('');
  const comfort=v.sample.comfort;
  el('comfort-box').innerHTML=finite(v.feels)?`It feels like <b>${reading(v.feels)}°</b> outside${finite(comfort.shade)?` and <b>${reading(comfort.shade)}°</b> in the shade`:''}. ${v.caption}`:'Current comfort estimate unavailable.';
  el('discussion').textContent=forecast.discussion?.text||'No forecaster discussion available.';
}

// Tabs
if(typeof document!=='undefined'){
document.querySelector('.tab-bar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('.tab-bar button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
});

el('loc-select').addEventListener('change', (e) => {
  loc = e.target.value;
  load();
});

el('loc-select').value=loc;
load();
if(typeof window!=='undefined'){installForecastRefresh(load);setInterval(()=>{if(forecast)renderAll();},60000);}
}
