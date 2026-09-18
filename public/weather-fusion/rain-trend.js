import {dailyDisplay,finite} from './weather-math.js?v=weather-qa-v67';

const STORAGE_KEY='weather-nourie-rain-history-v1';
const MAX_SAMPLES=12;

function locationKey(forecast) {
  const location=forecast?.location||{};
  return `${Number(location.latitude).toFixed(3)},${Number(location.longitude).toFixed(3)}`;
}

export function rainTrendSample(forecast,now=Date.now()) {
  const day=forecast?.days?.[0];if(!day)return null;
  const display=dailyDisplay(day,0,now,forecast.location?.timeZone||'America/New_York');
  if(!finite(display.pop))return null;
  const runAt=forecast.assembledAt;
  if(!Number.isFinite(Date.parse(runAt)))return null;
  return {key:`${locationKey(forecast)}|${day.date}|${display.tonight?'night':'day'}`,runAt,chance:Math.round(display.pop)};
}

export function updateRainTrend(forecast,now=Date.now(),storage=globalThis.localStorage) {
  const sample=rainTrendSample(forecast,now);if(!sample||!storage)return null;
  try {
    const saved=JSON.parse(storage.getItem(STORAGE_KEY)||'{}'),history=Array.isArray(saved[sample.key])?saved[sample.key].filter(row=>Number.isFinite(Date.parse(row.runAt))&&finite(row.chance)):[];
    const existing=history.findIndex(row=>row.runAt===sample.runAt);
    if(existing>=0)history[existing]=sample;else history.push(sample);
    history.sort((a,b)=>Date.parse(a.runAt)-Date.parse(b.runAt));
    const recent=history.slice(-MAX_SAMPLES);saved[sample.key]=recent;storage.setItem(STORAGE_KEY,JSON.stringify(saved));
    const current=recent.at(-1);
    if(recent.length<2)return {direction:'first',change:null,delta:null,from:null,to:current.chance,previousRunAt:null,currentRunAt:current.runAt};
    const previous=recent.at(-2),delta=current.chance-previous.chance,change=Math.abs(delta);
    return {direction:delta>0?'up':delta<0?'down':'same',change,delta,from:previous.chance,to:current.chance,previousRunAt:previous.runAt,currentRunAt:current.runAt};
  } catch { return null; }
}
