import {finite,dailyRainPeriod} from './weather-math.js?v=forecast-trace-v40';
import {timeAt} from './hourly-feels.js?v=forecast-story-v39';

const HOUR = 3600000;
const RAIN_TIMING_THRESHOLD = 25;
const validChance = value => finite(value) && value >= 0 && value <= 100 ? value : null;

function nextDate(date) {
  const epoch = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(epoch) ? new Date(epoch + 24 * HOUR).toISOString().slice(0,10) : null;
}

function periodWindow(day, phase, now, zone, rain) {
  if(rain.canonical){
    const start=Date.parse(rain.window?.start),end=Date.parse(rain.window?.end);
    return Number.isFinite(start)&&Number.isFinite(end)&&end>start?{start,end}:{start:null,end:null};
  }
  const source = phase === 'daytime' ? day?.highWindow : phase === 'overnight' ? day?.lowWindow : day?.qpfWindow;
  const following = nextDate(day?.date);
  const fallbackStart = phase === 'overnight' ? timeAt(day?.date,19,zone) : timeAt(day?.date,7,zone);
  const fallbackEnd = phase === 'daytime' ? timeAt(day?.date,19,zone) : timeAt(following,7,zone);
  let start = Date.parse(source?.start), end = Date.parse(source?.end);
  if (!Number.isFinite(start)) start = fallbackStart;
  if (!Number.isFinite(end)) end = fallbackEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {start:null,end:null};
  if (start < now) start = Math.min(end,now);
  return {start,end};
}

function timeLabel(value, zone) {
  return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(value)).replace(':00','');
}

function rangeLabel(group, zone) {
  const start = Date.parse(group[0].time), end = Date.parse(group.at(-1).time) + HOUR;
  return group.length === 1 ? timeLabel(start,zone) : `${timeLabel(start,zone)}–${timeLabel(end,zone)}`;
}

function hourlyChance(hour) {
  if(hour.canonicalRain)return validChance(hour?.rainLikelihood?.value);
  return validChance(hour?.rainLikelihood?.value) ?? validChance(hour?.pop);
}

function rowsFor(forecast, window) {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end)) return [];
  const hourlyByTime=new Map((forecast?.hours||[]).map(hour=>[Date.parse(hour.time),hour]));
  const series=Array.isArray(forecast?.rainTimeline)?forecast.rainTimeline.map(row=>({...hourlyByTime.get(Date.parse(row.time)),...row,rainLikelihood:row.rainLikelihood,precipitation:row.precipitation,canonicalRain:true})):(forecast?.hours||[]);
  return [...new Map(series.filter(hour => {
    const time = Date.parse(hour.time);
    const end=Number.isFinite(Date.parse(hour.end))?Date.parse(hour.end):time+HOUR;
    return Number.isFinite(time) && time < window.end && end > window.start;
  }).map(hour=>[Date.parse(hour.time),hour])).values()].sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
}

function rainGroups(rows) {
  const groups = [];
  for (const row of rows) {
    const chance = hourlyChance(row);
    if (chance === null || chance < RAIN_TIMING_THRESHOLD) continue;
    const last = groups.at(-1), time = Date.parse(row.time);
    if (!last || time-Date.parse(last.at(-1).time)!==HOUR) groups.push([row]);
    else last.push(row);
  }
  return groups;
}

function amountFor(rows, window, canonical = false) {
  if (!rows.length || !Number.isFinite(window.start) || !Number.isFinite(window.end)) return null;
  if(canonical){
    let cursor=window.start,total=0;
    for(const row of rows){
      const a=Date.parse(row.time),b=Number.isFinite(Date.parse(row.end))?Date.parse(row.end):a+HOUR;
      const left=Math.max(window.start,a),right=Math.min(window.end,b);
      if(left>cursor||!finite(row.precipitation)||row.precipitation<0)return null;
      const overlap=Math.max(0,right-Math.max(cursor,left));
      total+=row.precipitation*overlap/(b-a);cursor=Math.max(cursor,right);
    }
    return cursor>=window.end?total:null;
  }
  const covered = rows.reduce((total,row) => {
    const start = Math.max(window.start,Date.parse(row.time)), end = Math.min(window.end,Date.parse(row.time)+HOUR);
    return total+Math.max(0,end-start);
  },0);
  if (covered < (window.end-window.start)*.9) return null;
  if (rows.some(row => !finite(row.precipitation) || row.precipitation < 0)) return null;
  return rows.reduce((total,row) => {
    const start = Math.max(window.start,Date.parse(row.time)), end = Math.min(window.end,Date.parse(row.time)+HOUR);
    return total + row.precipitation * Math.max(0,end-start) / HOUR;
  },0);
}

function temperatureSentence(rows) {
  const values = rows.map(row => row.temperature).filter(finite);
  if (!values.length) return '';
  const low = Math.round(Math.min(...values)), high = Math.round(Math.max(...values));
  return low === high ? `Air temperature stays near ${low}°.` : `Air temperatures run from about ${low}° to ${high}°.`;
}

function timingSentence(chance, rows, groups, zone) {
  const available = rows.map(row => ({row,chance:hourlyChance(row)})).filter(item => item.chance !== null);
  if (!available.length) return 'Hourly rain timing is not available for this period yet.';
  const peak = available.reduce((best,item) => !best || item.chance > best.chance ? item : best,null);
  if (!groups.length) {
    if (chance !== null && chance >= RAIN_TIMING_THRESHOLD) return `The period chance is ${Math.round(chance)}%, but no available hourly reading reaches ${RAIN_TIMING_THRESHOLD}%. The highest available hour is ${Math.round(peak.chance)}% at ${timeLabel(peak.row.time,zone)}.`;
    return `Every available hourly rain chance stays below ${RAIN_TIMING_THRESHOLD}%; the highest is ${Math.round(peak.chance)}% at ${timeLabel(peak.row.time,zone)}.`;
  }
  const ranked = [...groups].sort((a,b) => Math.max(...b.map(hourlyChance))-Math.max(...a.map(hourlyChance)) || b.length-a.length || Date.parse(a[0].time)-Date.parse(b[0].time));
  const focus = ranked[0], groupPeak = Math.max(...focus.map(hourlyChance));
  return `The hourly forecast shows the best chance for rain from ${rangeLabel(focus,zone)}, peaking near ${Math.round(groupPeak)}%.`;
}

export function forecastPeriodSummary(forecast, index = 0, phase = 'overall', now = Date.now()) {
  const day = forecast?.days?.[index] || {}, zone = forecast?.location?.timeZone || 'America/New_York';
  const rain=dailyRainPeriod(day,phase),window = periodWindow(day,phase,now,zone,rain), rows = rowsFor(forecast,window), chance = rain.value, groups = rainGroups(rows);
  const timing = timingSentence(chance,rows,groups,zone), temperatures = rain.canonical&&rows.some(row=>!finite(row.temperature))?'':temperatureSentence(rows);
  const intro = chance === null ? 'The rain chance is not available yet.' : rain.canonical?`Rain chance peaks at ${Math.round(chance)}%.`:`The Weather Nourie rain chance for this period is ${Math.round(chance)}%.`;
  const hourlyAmount = amountFor(rows,window,rain.canonical);
  const amount = hourlyAmount ?? (!rain.canonical && phase === 'overall' && finite(day.qpf) && day.qpf >= 0 ? day.qpf : null);
  return {phase,chance,amount,window,rows,groups,
    summary:[intro,timing,temperatures].filter(Boolean).join(' ')};
}
