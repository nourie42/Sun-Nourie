import {finite,rainChanceValue} from './weather-math.js?v=forecast-trace-v40';
import {weatherIcon} from './weather-display.js?v=rain-consensus-v41';
import {weatherState} from './weather-state.js';
import {forecastGrossLevel} from './dewpoint-meter.js?v=rain-consensus-v41';

export const CAR_WASH_RAIN_LIMIT = 25;
const HOUR = 3600000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const validChance = value => finite(value) && value >= 0 && value <= 100 ? value : null;

export function isExperimentalWeatherPage(pathname = globalThis.location?.pathname || '') {
  return /\/weather-fusion\/experimental-weather\.html\/?$/.test(pathname);
}

export function dailyRainChance(day = {}, phase = 'whole') {
  if (phase === 'overnight' || phase === 'daytime') {
    const field = phase === 'overnight' ? 'popNightLikelihood' : 'popDayLikelihood';
    return Object.hasOwn(day,field) ? rainChanceValue(day[field]) : validChance(day[phase === 'overnight' ? 'popNight' : 'popDay']);
  }
  if (Object.hasOwn(day,'rainLikelihood')) return rainChanceValue(day.rainLikelihood);
  const periods = [rainChanceValue(day.popDayLikelihood),rainChanceValue(day.popNightLikelihood)];
  if (Object.hasOwn(day,'popDayLikelihood') || Object.hasOwn(day,'popNightLikelihood')) {
    return periods.every(value => value !== null) ? Math.max(...periods) : null;
  }
  const official = [validChance(day.popDay),validChance(day.popNight)];
  return official.every(value => value !== null) ? Math.max(...official) : null;
}

export function hourlyRainChance(hour = {}) {
  return Object.hasOwn(hour,'rainLikelihood') ? rainChanceValue(hour.rainLikelihood) : validChance(hour.pop);
}

function localHour(now, zone) {
  return Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(now)));
}

export function carWashDayDecision(days = [], index = 0) {
  const stretch = days.slice(index, index + 3);
  // The canonical whole-day window already excludes elapsed hours. Changing
  // the displayed card to Tonight must not discard rain later this afternoon.
  const chances = stretch.map(day => dailyRainChance(day,'whole'));
  const currentChance = chances[0] ?? null;
  if (stretch.length < 3 || chances.some(value => value === null)) {
    return {index, state:'check', canWash:false, chance:currentChance, chances, reason:'Three complete forecast days are not available yet.'};
  }
  const blocker = chances.findIndex(value => value > CAR_WASH_RAIN_LIMIT);
  if (blocker >= 0) {
    return {index, state:'wait', canWash:false, chance:currentChance, chances, blocker:index + blocker,
      reason:`One of the next three days has a ${Math.round(chances[blocker])}% rain chance.`};
  }
  return {index, state:'wash', canWash:true, chance:currentChance, chances, reason:`Three days at or below ${CAR_WASH_RAIN_LIMIT}% are lined up.`};
}

function dateKey(value, zone) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function clock(value, zone) {
  return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(value)).replace(' ','');
}

function dayName(date, zone, long = false) {
  const epoch = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(epoch) ? new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:long?'long':'short'}).format(new Date(epoch)) : 'Day';
}

function dayStamp(date) {
  const epoch = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(epoch) ? new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(epoch)) : '';
}

function seriesValue(forecast, key, time) {
  const epoch = Date.parse(time);
  return forecast?.metricForecasts?.series?.[key]?.find(point => Date.parse(point.time) === epoch)?.value ?? null;
}

function windowLabel(start, end, zone, targetDate, now) {
  const prefix = dateKey(now,zone) === targetDate ? '' : `${dayName(targetDate,zone,true)} `;
  return `${prefix}${clock(start,zone)}–${clock(end,zone)}`;
}

export function bestWashWindow(forecast, targetIndex = 0, now = Date.now()) {
  const day = forecast?.days?.[targetIndex], zone = forecast?.location?.timeZone || 'America/New_York';
  if (!day?.date || !carWashDayDecision(forecast.days,targetIndex).canWash) return null;
  const candidates = (forecast.hours || []).filter(hour => {
    const epoch = Date.parse(hour.time), chance = hourlyRainChance(hour);
    return Number.isFinite(epoch) && epoch >= now && dateKey(epoch,zone) === day.date && hour.isDay !== false && chance !== null && chance <= CAR_WASH_RAIN_LIMIT;
  }).sort((a,b) => Date.parse(a.time) - Date.parse(b.time));
  const groups = [];
  for (const hour of candidates) {
    const epoch = Date.parse(hour.time), last = groups.at(-1);
    if (!last || epoch - Date.parse(last.at(-1).time) !== HOUR) groups.push([hour]);
    else last.push(hour);
  }
  const eligible = groups.filter(group => group.length >= 2).sort((a,b) => b.length-a.length || averageChance(a)-averageChance(b) || Date.parse(a[0].time)-Date.parse(b[0].time));
  const group = eligible[0];
  if (!group) return null;
  const start = Date.parse(group[0].time), end = Date.parse(group.at(-1).time) + HOUR;
  const winds = group.map(hour => seriesValue(forecast,'wind',hour.time)).filter(finite);
  const temperatures = group.map(hour => seriesValue(forecast,'temperature',hour.time) ?? hour.temperature).filter(finite);
  const chances = group.map(hourlyRainChance).filter(value => value !== null);
  return {start, end, label:windowLabel(start,end,zone,day.date,now), hours:group.length,
    rainChance:chances.length?Math.max(...chances):null,
    windMin:winds.length?Math.min(...winds):null, windMax:winds.length?Math.max(...winds):null,
    temperatureMin:temperatures.length?Math.min(...temperatures):null, temperatureMax:temperatures.length?Math.max(...temperatures):null};
}

function averageChance(hours) {
  const values = hours.map(hourlyRainChance).filter(value => value !== null);
  return values.length ? values.reduce((total,value) => total+value,0)/values.length : Infinity;
}

function range(values, unit = '') {
  const finiteValues = values.filter(finite);
  if (!finiteValues.length) return 'Unavailable';
  const low = Math.round(Math.min(...finiteValues)), high = Math.round(Math.max(...finiteValues));
  return `${low}${unit}${high === low ? '' : `–${high}${unit}`}`;
}

function supportingFacts(forecast, targetIndex, window) {
  const day = forecast.days[targetIndex] || {}, zone = forecast.location?.timeZone || 'America/New_York';
  const hours = (forecast.hours || []).filter(hour => dateKey(hour.time,zone) === day.date && hour.isDay !== false);
  const winds = window ? [window.windMin,window.windMax] : hours.map(hour => seriesValue(forecast,'wind',hour.time));
  const temperatures = window ? [window.temperatureMin,window.temperatureMax] : [day.low,day.high];
  return {wind:range(winds,' mph'), temperature:range(temperatures,'°')};
}

function grossMeterFact(forecast, targetIndex, window) {
  const day=forecast.days?.[targetIndex]||{},zone=forecast.location?.timeZone||'America/New_York';
  const points=(forecast.metricForecasts?.series?.dewpoint||[]).filter(point=>{
    const epoch=Date.parse(point.time);if(!finite(epoch)||!finite(point.value))return false;
    if(window)return epoch>=window.start&&epoch<window.end;
    return dateKey(epoch,zone)===day.date&&localHour(epoch,zone)>=7&&localHour(epoch,zone)<19;
  });
  const peak=points.reduce((best,point)=>!best||point.value>best.value?point:best,null);
  if(!peak)return {title:'Unavailable',detail:'Gross Meter'};
  const wind=seriesValue(forecast,'wind',peak.time),level=forecastGrossLevel(peak.value,wind);
  const score={dry:'DRY',nice:'NOT BAD','nice-breeze':'NOT BAD',humid:'HUMID',gross:'GROSS',nogo:'NO-GO',nope:'NOPE'}[level.key]||'UNAVAILABLE';
  return {title:`${Math.round(peak.value)}° · ${score}`,detail:'Gross Meter at wash time',value:peak.value,level:level.key};
}

export function carWashSummary(forecast, now = Date.now()) {
  const days = forecast?.days || [], zone = forecast?.location?.timeZone || 'America/New_York';
  const tonight = localHour(now,zone) >= 15;
  const decisions = Array.from({length:Math.min(5,days.length)},(_,index) => carWashDayDecision(days,index));
  for(const decision of decisions){
    const blocked=days[decision.blocker],peak=blocked?.rainLikelihood;
    if(decision.state==='wait'&&finite(peak?.value)&&Number.isFinite(Date.parse(peak?.peakTime))){
      const when=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric'}).format(new Date(peak.peakTime));
      decision.reason=`Rain chance reaches ${Math.round(peak.value)}% ${when}.`;
    }
  }
  const activeKind = weatherState(forecast?.current?.condition).kind;
  const rainingNow = ['rain','storm','snow'].includes(activeKind) && forecast?.current?.type === 'observation';
  if (decisions[0] && rainingNow) decisions[0] = {...decisions[0],state:'wait',canWash:false,reason:'Rain or wintry weather is happening now.',activeWeather:true};
  const washOptions = decisions.filter(decision => decision.canWash);
  let firstWash = washOptions[0] || null, window = null;
  for (const decision of washOptions) {
    const candidate = bestWashWindow(forecast,decision.index,now);
    if (candidate) { firstWash = decision; window = candidate; break; }
  }
  const primary = decisions[0] || {state:'check',canWash:false,chance:null,chances:[],reason:'Forecast data is still loading.'};
  // The hero always answers "today", so its supporting wind and temperature
  // must stay on today's forecast even when the next safe wash day is later.
  const facts = supportingFacts(forecast,0,null);
  const lowRainDays = primary.chances.filter(value => value !== null && value <= CAR_WASH_RAIN_LIMIT).length;
  const best = primary.canWash
    ? window ? {title:window.label,note:`${window.hours} forecast hours at or below ${CAR_WASH_RAIN_LIMIT}% rain chance.`} : {title:'No reliable hourly window yet',note:'The three-day outlook is dry enough, but hourly timing is incomplete.'}
    : firstWash ? {title:`Try ${dayName(days[firstWash.index].date,zone,true)}`,note:window?`${window.label} looks best.`:'Hourly timing will appear closer to that day.'}
      : {title:'Wait for a three-day dry stretch',note:primary.reason};
  // Every visible car-wash percentage must be the exact value used by the
  // three-day decision. For Today that includes the coming overnight because
  // rain after a wash still matters; never show a lower daytime-only number.
  const visibleChance = primary.chance;
  facts.gross=grossMeterFact(forecast,firstWash?.index??0,window);
  return {state:primary.state,canWash:primary.canWash,chance:visibleChance,reason:primary.reason,lowRainDays,decisions,window,best,facts,
    days:decisions.map((decision,index) => ({...decision,chance:decision.chance,date:days[index]?.date,label:index===0?(tonight?'Tonight':'Today'):dayName(days[index]?.date,zone),isDay:index!==0||!tonight,stamp:dayStamp(days[index]?.date),low:days[index]?.low,high:days[index]?.high,
      condition:index===0&&tonight?(days[index]?.nightCondition||days[index]?.condition||'Forecast unavailable'):(days[index]?.condition||'Forecast unavailable')}))};
}

function verdictLabel(state) {
  return state === 'wash' ? 'YES' : state === 'check' ? 'CHECK' : 'WAIT!';
}

function fact(icon, title, detail, good = false) {
  return `<span class="car-wash-fact ${good?'good':''}"><i aria-hidden="true">${icon}</i><span><b>${esc(title)}</b><small>${esc(detail)}</small></span></span>`;
}

export function carWashIconCondition(day = {}) {
  const chance = validChance(day.chance), kind = weatherState(day.condition).kind;
  // The icon and the displayed blended percentage must describe the same
  // forecast. A rounded 0% cannot retain rain, lightning, or snow artwork
  // inherited from an unblended source condition.
  return chance !== null && Math.round(chance) === 0 && ['rain','storm','snow'].includes(kind)
    ? 'Partly Cloudy'
    : day.condition;
}

export function carWashHTML(summary) {
  const label = verdictLabel(summary.state), good = summary.canWash;
  const cards = summary.days.map(day => `<article class="car-wash-day" data-car-wash-state="${day.state}">
    <strong>${esc(day.label)}</strong><small>${esc(day.stamp)}</small>${weatherIcon(carWashIconCondition(day),day.isDay!==false,42)}
    <span class="car-wash-temps">${finite(day.low)?Math.round(day.low)+'°':'—'} <i>|</i> ${finite(day.high)?Math.round(day.high)+'°':'—'}</span>
    <span class="car-wash-chance">💧 ${day.chance===null?'—':Math.round(day.chance)+'%'}</span><b class="car-wash-day-verdict">${verdictLabel(day.state)}</b>
  </article>`).join('');
  return `<header class="car-wash-header"><span class="car-wash-logo" aria-hidden="true">💧🚙</span><span><h2 id="car-wash-title">Car Wash Forecast</h2><p>Plan the perfect time for a showroom shine</p></span><em>Clean rides.<br>Brighter days.</em></header>
    <div class="car-wash-hero"><div class="car-wash-answer"><h3>Can I Wash<br>My Car Today?</h3><strong class="car-wash-verdict ${summary.state}" role="status" aria-live="polite" aria-atomic="true">${good?'<span aria-hidden="true">✓</span> ':''}${label}</strong><p>${esc(summary.reason)}</p></div>
      <div class="car-wash-checks">${fact('💧',summary.chance===null?'—':`${Math.round(summary.chance)}%`,'Rain chance',summary.chance!==null&&summary.chance<=CAR_WASH_RAIN_LIMIT)}${fact('☀',`${summary.lowRainDays} of 3 days`,`${CAR_WASH_RAIN_LIMIT}% or less rain`,summary.lowRainDays===3)}${fact('≋',summary.facts.wind,'Wind')}${fact('♨',summary.facts.temperature,'Low / high')}${fact('💦',summary.facts.gross.title,summary.facts.gross.detail)}</div>
    </div>
    <div class="car-wash-photo"><img class="car-wash-art" src="/weather-fusion/car-wash-corvette-hood.webp" alt="Cherry-red Corvette C8 with a black carbon-fiber hood graphic, fully visible on a driveway" loading="lazy" decoding="async"></div>
    <div class="car-wash-days-wrap"><h3>Next 5 Days</h3><div class="car-wash-days">${cards}</div></div>
    <div class="car-wash-window"><span class="car-wash-spark" aria-hidden="true">✦</span><span><small>Best Washing Window</small><strong>${esc(summary.best.title)}</strong><em>${esc(summary.best.note)}</em></span><span class="car-wash-tip">☀ <small>Avoid hot<br>midday sun</small></span><span class="car-wash-tip">≋ <small>Light wind<br>helps drying</small></span><span class="car-wash-tip">🚙 <small>Enjoy that<br>clean shine</small></span></div>
    <div class="car-wash-footer">WEATHER NOURIE · CLEAN RIDES, BRIGHTER DAYS</div>`;
}

export function renderCarWashForecast(forecast, now = Date.now()) {
  const panel = document.getElementById('car-wash-forecast');
  if (!panel || !isExperimentalWeatherPage()) return null;
  const summary = carWashSummary(forecast,now);
  panel.hidden = false;
  panel.dataset.verdict = summary.state;
  panel.innerHTML = carWashHTML(summary);
  return summary;
}

export function resetCarWashForecast() {
  const panel = document.getElementById('car-wash-forecast');
  if (!panel) return;
  panel.hidden = !isExperimentalWeatherPage();
  if (!panel.hidden) panel.innerHTML = '<p class="muted">Checking the next three days for a safe wash window…</p>';
}
