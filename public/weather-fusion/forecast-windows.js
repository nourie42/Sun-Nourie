import {displayedFeelsAt} from './hourly-feels.js?v=dewpoint-floor-v1';
import {finite,rainChanceValue,solarElevation} from './weather-math.js?v=full-day-rain-v1';

const HOUR = 3600000;
const TITLES = {perfect:'Perfect weather',rain:'Rain likely',high:'High rain likelihood',thunder:'Thunderstorms possible'};
const percentage = value => finite(value) && value >= 0 && value <= 100 ? value : null;
const nonnegative = value => finite(value) && value >= 0 ? value : null;
const epoch = value => typeof value === 'string' ? Date.parse(value) : NaN;

function timeMap(rows = []) {
  const result = new Map();
  for (const row of rows) {
    const time = epoch(row?.time);
    if (finite(time)) result.set(time,row);
  }
  return result;
}

function dateFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  } catch {
    return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
  }
}

function dateKey(time, formatter) {
  const parts = formatter.formatToParts(new Date(time));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function hourlyInterval(row, time) {
  if (!row) return true;
  if (row.end === undefined || row.end === null) return true;
  return epoch(row.end) === time + HOUR;
}

function daylightFor(forecast, hour, feels, time, end) {
  const known = typeof feels?.daylight === 'boolean' ? feels.daylight : hour?.isDay;
  if (known !== true) return false;
  const location = forecast.location || {};
  if (finite(location.latitude) && finite(location.longitude)) {
    // Do not extend an otherwise sunny hourly window past sunset.
    return solarElevation(time,location.latitude,location.longitude) > 0
      && solarElevation(end-1,location.latitude,location.longitude) > 0;
  }
  return true;
}

function groups(rows, key, formatter, now) {
  const windows = [];
  for (const row of rows) {
    const level = row[key];
    if (!level) continue;
    const start = Math.max(row.epoch,now), end = row.epoch + HOUR;
    const date = dateKey(start,formatter), last = windows.at(-1);
    const hour = {
      time:new Date(start).toISOString(),end:new Date(end).toISOString(),
      forecastTime:new Date(row.epoch).toISOString(),
      feels:row.feels,dewpoint:row.dewpoint,cloud:row.cloud,
      rainChance:row.rainChance,precipitation:row.precipitation,thunder:row.thunder,
    };
    if (last && last.date === date && last.level === level && last.end === row.epoch) {
      last.end = end;
      last.hours.push(hour);
    } else {
      windows.push({date,start,end,hours:[hour],level,title:TITLES[level]});
    }
  }
  return key === 'perfect' ? windows.filter(window => window.end-window.start >= 2*HOUR) : windows;
}

/** Classify the existing blend's exact hourly values without fetching another
 * forecast, expanding coarse intervals, or substituting raw NWS probabilities.
 * Windows use UTC instants for adjacency and the location's date for grouping.
 */
export function buildForecastWindows(forecast = {}, now = Date.now()) {
  const formatter = dateFormatter(forecast.location?.timeZone || 'America/New_York');
  const timeZone = formatter.resolvedOptions().timeZone;
  if (!finite(now)) return {perfect:[],rain:[],timeZone};
  const hours = timeMap(forecast.hours);
  const series = forecast.metricForecasts?.series || {};
  const feels = timeMap(series.feels), dewpoints = timeMap(series.dewpoint);
  const canonical = Array.isArray(forecast.rainTimeline);
  const rain = canonical ? timeMap(forecast.rainTimeline) : hours;
  const times = [...new Set([...hours.keys(),...feels.keys(),...rain.keys()])].sort((a,b) => a-b);
  const rows = [];
  for (const time of times) {
    if (time+HOUR <= now) continue;
    const hour = hours.get(time), feel = feels.get(time), wet = rain.get(time);
    // Explicit multi-hour intervals are not hourly evidence, including for
    // thunder timing. Never fill gaps using a day/night forecast or nearby row.
    if (!hourlyInterval(hour,time) || !hourlyInterval(feel,time) || !hourlyInterval(wet,time)) continue;
    const value = displayedFeelsAt(forecast,new Date(time).toISOString());
    const dewpoint = dewpoints.has(time) ? dewpoints.get(time).value : hour?.dewpoint;
    const cloud = percentage(feel?.inputs && Object.hasOwn(feel.inputs,'skyCover') ? feel.inputs.skyCover : hour?.skyCover);
    const rainChance = rainChanceValue(wet?.rainLikelihood);
    const precipitation = nonnegative(wet?.precipitation);
    const hourlyCondition = [hour?.condition,wet?.condition].filter(Boolean).join(' ');
    // Rain percentages are not thunder probabilities. Require explicit thunder
    // wording; windstorms and snowstorms do not establish a lightning signal.
    // The feels series may inherit coarse day/night wording upstream. It cannot
    // identify thunder timing or veto an otherwise qualifying blended hour.
    const thunder = /thunder|\btstms?\b|\bt-?storms?\b/i.test(hourlyCondition);
    const adverseCondition = hourlyCondition.replace(/\bwind[ -]?storms?\b/gi,'');
    const adverse = /rain|shower|drizzle|thunder|\bstorms?\b|\btstms?\b|snow|sleet|flurr|ice pellets|fog|mist|haze|smoke|obscured/i.test(adverseCondition);
    const perfect = finite(value) && value >= 70 && value <= 75
      && finite(dewpoint) && dewpoint <= 55 && cloud !== null && cloud <= 25
      && rainChance !== null && rainChance <= 20
      && precipitation !== null && precipitation < .01 && !adverse
      && daylightFor(forecast,hour,feel,Math.max(time,now),time+HOUR);
    rows.push({epoch:time,feels:value,dewpoint:finite(dewpoint)?dewpoint:null,cloud,rainChance,precipitation,thunder,
      perfect:perfect?'perfect':null,
      rain:thunder?'thunder':rainChance !== null && rainChance >= 80?'high':rainChance !== null && rainChance >= 60?'rain':null});
  }
  return {perfect:groups(rows,'perfect',formatter,now),rain:groups(rows,'rain',formatter,now),timeZone};
}
