/** Selected-location recovery when an official text/hourly endpoint is unavailable.
 * Only verified, timestamp-matched model values are used. A model condition is
 * labelled as guidance and never becomes an official NWS value in the blend.
 */
import {solarTimes} from './weatherFusionDirect.js';
import { weatherDateTimeFormat } from './weatherDateTimeFormat.js';

const H = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = value => finite(value) ? Number(value.toFixed(1)) : null;
const MODEL_ORDER = ['nbm', 'ecmwf', 'hrrr'];
const LABELS = {nbm:'NOAA National Blend', ecmwf:'ECMWF IFS', hrrr:'NOAA HRRR'};
const CODES = {
  0:['Sunny','Clear'], 1:['Mostly Sunny','Mostly Clear'], 2:['Partly Cloudy','Partly Cloudy'], 3:['Cloudy','Cloudy'],
  45:['Fog','Fog'], 48:['Freezing Fog','Freezing Fog'],
  51:['Light Drizzle','Light Drizzle'], 53:['Drizzle','Drizzle'], 55:['Heavy Drizzle','Heavy Drizzle'],
  56:['Freezing Drizzle','Freezing Drizzle'], 57:['Freezing Drizzle','Freezing Drizzle'],
  61:['Light Rain','Light Rain'], 63:['Rain','Rain'], 65:['Heavy Rain','Heavy Rain'],
  66:['Freezing Rain','Freezing Rain'], 67:['Freezing Rain','Freezing Rain'],
  71:['Light Snow','Light Snow'], 73:['Snow','Snow'], 75:['Heavy Snow','Heavy Snow'], 77:['Snow Grains','Snow Grains'],
  80:['Rain Showers','Rain Showers'], 81:['Rain Showers','Rain Showers'], 82:['Heavy Rain Showers','Heavy Rain Showers'],
  85:['Snow Showers','Snow Showers'], 86:['Heavy Snow Showers','Heavy Snow Showers'],
  95:['Thunderstorms','Thunderstorms'], 96:['Thunderstorms With Hail','Thunderstorms With Hail'], 99:['Thunderstorms With Hail','Thunderstorms With Hail'],
};
export function modelWeatherCondition(code, isDay = true) {
  return Number.isInteger(code) && Object.hasOwn(CODES, code) ? CODES[code][isDay ? 0 : 1] : null;
}
function modelsAt(models, rows, time) {
  return MODEL_ORDER.flatMap(id => (models[id]?.verifiedModel || models[id]?.direct)
    ? (rows[id] || []).filter(row => row.time === time).map(row => ({id, row})) : []);
}
function localDate(time, zone) {
  const parts = weatherDateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(time));
  const part = type => parts.find(value => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function daylight(time, location) {
  const sun = solarTimes(localDate(time, location.timeZone), location.latitude, location.longitude);
  return Date.parse(sun.sunrise) <= time && time < Date.parse(sun.sunset);
}
export function conditionGuidanceAt({models = {}, rows = {}, exposureWeather, location, time}) {
  const isDay = daylight(time, location), candidates = modelsAt(models, rows, time);
  for (const {id, row} of candidates) {
    const condition = modelWeatherCondition(row.weather_code, isDay);
    if (condition) return {condition, conditionSource:`${LABELS[id]} selected-location weather code (model guidance)`, weatherCode:row.weather_code, isDay};
  }
  const exposure = exposureWeather?.rows?.find(row => Date.parse(row.time) === time);
  const condition = modelWeatherCondition(exposure?.weatherCode, isDay);
  if (condition) return {condition, conditionSource:'Open-Meteo selected-location weather code (model guidance)', weatherCode:exposure.weatherCode, isDay};
  // Cloud cover alone cannot establish rain, snow, thunder, or dry weather.
  // Precipitation is end-labelled, so the following row covers this hour.
  for (const {id, row} of candidates) {
    const amount = rows[id]?.find(value => value.time === time + H)?.precipitation;
    if (amount !== 0 || !finite(row.cloud_cover) || row.cloud_cover < 0 || row.cloud_cover > 100) continue;
    const cloudCode = row.cloud_cover <= 12 ? 0 : row.cloud_cover <= 30 ? 1 : row.cloud_cover <= 62 ? 2 : 3;
    return {condition:modelWeatherCondition(cloudCode, isDay), conditionSource:`${LABELS[id]} same-hour cloud cover and zero precipitation (model guidance)`, isDay};
  }
  return {condition:null, conditionSource:null, isDay};
}
export function recoverForecastHours({hours = [], models = {}, rows = {}, exposureWeather, location, now}) {
  const existing = new Map(hours.map(hour => [Date.parse(hour.time), hour]));
  const recovered = [];
  for (let time = Math.floor(now / H) * H; time < Math.floor(now / H) * H + 48 * H; time += H) {
    const official = existing.get(time);
    if (official) {
      if (String(official.condition || '').trim()) { recovered.push(official); continue; }
      const guidance = conditionGuidanceAt({models, rows, exposureWeather, location, time});
      recovered.push({...official, ...(guidance.condition ? guidance : {})});
      continue;
    }
    const candidate = modelsAt(models, rows, time).find(({row}) => finite(row.temperature_2m));
    if (!candidate) continue;
    const {id, row} = candidate, guidance = conditionGuidanceAt({models, rows, exposureWeather, location, time});
    recovered.push({
      time:new Date(time).toISOString(), end:new Date(time+H).toISOString(), temperature:round(row.temperature_2m), officialTemperature:null,
      temperatureSource:`${LABELS[id]} selected-location model guidance`, forecastSource:'model-guidance',
      condition:guidance.condition || 'Forecast conditions unavailable', conditionSource:guidance.conditionSource,
      weatherCode:guidance.weatherCode ?? null, isDay:guidance.isDay,
      pop:null, officialPop:null, wind:finite(row.wind_speed_10m) ? `${round(row.wind_speed_10m)} mph` : null,
      windDirection:null, humidity:round(row.relative_humidity_2m), dewpoint:round(row.dew_point_2m),
      precipitation:null, precipitationSource:null, apparent:round(row.apparent_temperature), gust:round(row.wind_gusts_10m),
    });
  }
  return recovered;
}
const priority = condition => /thunder/i.test(condition) ? 6 : /freezing|snow/i.test(condition) ? 5 : /rain|drizzle/i.test(condition) ? 4 : /fog/i.test(condition) ? 3 : /cloud/i.test(condition) ? 2 : 1;
/** Keep official wording; recover each calendar day's remaining daytime only. */
export function recoverDailyConditions(days, {hours = [], models = {}, rows = {}, exposureWeather, location, now}) {
  const times = [...new Set(MODEL_ORDER.flatMap(id => (models[id]?.verifiedModel || models[id]?.direct) ? (rows[id] || []).map(row => row.time) : []))].sort((a,b) => a-b);
  for (const day of days) {
    if (day.condition && day.condition !== 'Forecast unavailable') continue;
    const official = hours.filter(hour => hour.forecastSource !== 'model-guidance' && hour.condition && hour.condition !== 'Forecast conditions unavailable')
      .map(hour => ({time:Date.parse(hour.time),condition:hour.condition,conditionSource:hour.conditionSource || 'NWS hourly forecast',isDay:hour.isDay}))
      .filter(sample => finite(sample.time) && sample.time + H > now && localDate(sample.time, location.timeZone) === day.date);
    const guidance = times.filter(time => time + H > now && localDate(time, location.timeZone) === day.date)
      .map(time => ({time, ...conditionGuidanceAt({models, rows, exposureWeather, location, time})})).filter(sample => sample.condition);
    const samples = official.length ? official : guidance;
    const daytime = samples.filter(sample => sample.isDay), eligible = daytime.length ? daytime : samples;
    const chosen = eligible.sort((a,b) => priority(b.condition) - priority(a.condition) || a.time-b.time)[0];
    if (!chosen) continue;
    day.condition = chosen.condition;
    day.conditionSource = chosen.conditionSource;
    day.conditionTime = new Date(chosen.time).toISOString();
  }
  return days;
}
