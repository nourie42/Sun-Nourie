import {coordinates,localTime,nextDate,buildForecast} from '../src/weatherFusion.js';
export const H = 3600000, now = Date.parse('2026-09-05T16:00:00Z');
export const base = Date.parse('2026-09-04T04:00:00Z');
export const times = Array.from({ length: 216 }, (_, i) => base + i * H);
export function model(temperature = 80, precipitation = .01, length = times.length) {
  const ts = times.slice(0, length);
  return { timezone: 'America/New_York', hourly_units: { temperature_2m: '°F', precipitation: 'inch', wind_speed_10m: 'mp/h' },
    hourly: { time: ts.map((t) => t / 1000), temperature_2m: ts.map((_, i) => temperature + Math.round(6 * Math.sin(i / 4))), precipitation: ts.map(() => precipitation),
      wind_speed_10m: ts.map(() => 8), wind_gusts_10m: ts.map(() => 16), wind_direction_10m: ts.map(() => 210), relative_humidity_2m: ts.map(() => 67), dew_point_2m: ts.map(() => 65), apparent_temperature: ts.map(() => 83) },
    daily: { time: [Date.parse('2026-09-04T04:00:00Z') / 1000, Date.parse('2026-09-05T04:00:00Z') / 1000], sunrise: [Date.parse('2026-09-04T10:48:00Z') / 1000, Date.parse('2026-09-05T10:49:00Z') / 1000], sunset: [Date.parse('2026-09-04T23:35:00Z') / 1000, Date.parse('2026-09-05T23:34:00Z') / 1000] } };
}
export const periods = Array.from({ length: 14 }, (_, i) => {
  const date = nextDate('2026-09-05', Math.floor(i / 2)), day = i % 2 === 0;
  const start = localTime(date, day ? 7 : 19, 'America/New_York');
  return { startTime: new Date(start).toISOString(), endTime: new Date(start + 12 * H).toISOString(), isDaytime: day,
    temperature: day ? 84 - Math.floor(i / 2) : 65 - Math.floor(i / 2), temperatureUnit: 'F', shortForecast: day ? (i === 2 ? 'Chance Showers And Thunderstorms' : 'Partly Sunny') : 'Partly Cloudy', detailedForecast: day ? 'Partly sunny, with a high near 84. A light southwest wind.' : 'Partly cloudy overnight, with a low near 65.', probabilityOfPrecipitation: { value: i === 0 ? 0 : 30 }, windSpeed: '5 to 10 mph', windDirection: 'SW' };
});
export const hourlyPeriods = Array.from({ length: 48 }, (_, i) => ({ ...periods[0], startTime: new Date(now + i * H).toISOString(), endTime: new Date(now + (i + 1) * H).toISOString(), temperature: 80 + Math.round(5 * Math.sin(i / 4)), isDaytime: i % 24 < 7, probabilityOfPrecipitation: { value: i < 4 ? 0 : 25 }, relativeHumidity: { value: 65 }, dewpoint: { value: 18, unitCode: 'wmoUnit:degC' } }));
export const grid = { quantitativePrecipitation: { uom: 'wmoUnit:mm', values: [{ validTime: '2026-09-04T04:00:00Z/P10D', value: 25.4 }] } };
export const inputs = { now, location: coordinates({ location: 'knightdale' }), point: { cwa: 'RAH', timeZone: 'America/New_York' }, forecast: { periods }, hourly: { periods: hourlyPeriods }, grid,
  discussion: { office: 'RAH', issuanceTime: '2026-09-05T14:00:00Z', text: 'TEST FIXTURE — not a live forecast. A weak front will bring a chance of showers tomorrow.', url: 'https://api.weather.gov/products/test-afd' },
  observation: { temperature: 82, condition: 'Partly Cloudy', time: '2026-09-05T15:51:00Z', station: 'KRDU', humidity: 65, dewpoint: 68, wind: 8, gust: 14, windDirection: 230, visibility: 10, pressure: 30.02 },
  alerts: [], models: { hrrr: model(81, .02, 72), ecmwf: model(79, .01), nbm: model(80, .015) },
  feeds: ['nws', 'hourly', 'grid', 'afd', 'observation', 'hrrr', 'ecmwf', 'nbm', 'alerts'].map((id) => ({ id, label: id === 'afd' ? 'NWS RAH discussion' : id.toUpperCase(), status: 'ready', fetchedAt: '2026-09-05T16:00:00Z', issuedAt: ['nws', 'afd'].includes(id) ? '2026-09-05T14:00:00Z' : null, url: id === 'hrrr' ? 'https://api.open-meteo.com/v1/forecast' : 'https://api.weather.gov/points/35.787,-78.4806' })) };
export const preview = { ...buildForecast(inputs), aiConfigured: false, modelAccessConfigured: true };
export const testInputs = inputs;

export function snapshot(id='hrrr') {
  const begin=Date.parse('2026-09-05T12:00:00Z')/1000;
  const count=id==='hrrr'?49:193;
  const time=Array.from({length:count},(_,i)=>begin+i*3600);
  return {schema:'weather-fusion-direct-v2',model:id,complete:true,runAt:new Date(begin*1000).toISOString(),validUntil:new Date(time.at(-1)*1000).toISOString(),resolution:'Test native grid',points:[{id:'knightdale',latitude:35.787,longitude:-78.4806,hourly_units:{temperature_2m:'°F',precipitation:'inch',wind_speed_10m:'mp/h'},hourly:{time,temperature_2m:time.map(()=>id==='hrrr'?90:80),precipitation:time.map(()=>.01),wind_speed_10m:time.map(()=>8)},precipitationIntervals:time.slice(1).map(t=>({start:t-3600,end:t,value:.01}))}]};
}
