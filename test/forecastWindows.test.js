import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecastWindows} from '../public/weather-fusion/forecast-windows.js';

const HOUR = 3600000;
const base = Date.parse('2026-09-26T12:00:00Z');
const at = (hour, start=base) => new Date(start+hour*HOUR).toISOString();

function fixture(count=4, start=base) {
  const hours = Array.from({length:count},(_,index) => ({time:at(index,start),isDay:true,
    temperature:90,skyCover:20,dewpoint:50,condition:'Mostly sunny',windMph:40,gust:60,
    precipitation:0,rainLikelihood:{value:10},pop:99}));
  return {location:{timeZone:'UTC'},hours,
    rainTimeline:hours.map(hour => ({time:hour.time,end:at(1,Date.parse(hour.time)),precipitation:0,rainLikelihood:{value:10},officialPop:99})),
    metricForecasts:{series:{
      feels:hours.map(hour => ({time:hour.time,value:72,daylight:true,condition:hour.condition,inputs:{skyCover:20,wind:40}})),
      dewpoint:hours.map(hour => ({time:hour.time,value:50})),
      gust:hours.map(hour => ({time:hour.time,value:60})),
    }},
  };
}

test('perfect uses displayed hourly feels, sunny sky and dry blend values with no wind restriction',()=>{
  const data = fixture();
  const result = buildForecastWindows(data,base);
  assert.equal(result.perfect.length,1);
  assert.equal(result.rain.length,0,'Conflicting raw NWS probabilities cannot override the blend.');
  assert.equal(result.perfect[0].start,base);
  assert.equal(result.perfect[0].end,base+4*HOUR);
  assert.equal(result.perfect[0].hours.length,4);
  assert.equal(result.perfect[0].hours[0].feels,72);
  data.metricForecasts.series.feels.forEach(row => row.value=76);
  data.hours.forEach(row => row.temperature=72);
  assert.deepEqual(buildForecastWindows(data,base).perfect,[],'Comfort uses feels-like rather than air temperature.');
});

test('inclusive perfect boundaries work, and every individual limiting field is required',()=>{
  const accepted = fixture(2);
  accepted.metricForecasts.series.feels[0].value=70;
  accepted.metricForecasts.series.feels[1].value=75;
  accepted.metricForecasts.series.feels.forEach(row => row.inputs.skyCover=25);
  accepted.metricForecasts.series.dewpoint.forEach(row => row.value=55);
  accepted.rainTimeline.forEach(row => {row.rainLikelihood.value=20;row.precipitation=.009;});
  assert.equal(buildForecastWindows(accepted,base).perfect.length,1);
  const cases = [
    data => data.metricForecasts.series.feels[0].value=69.9,
    data => data.metricForecasts.series.feels[0].value=75.1,
    data => data.metricForecasts.series.feels[0].inputs.skyCover=25.1,
    data => data.metricForecasts.series.dewpoint[0].value=55.1,
    data => data.rainTimeline[0].rainLikelihood.value=20.1,
    data => data.rainTimeline[0].precipitation=.01,
    data => data.metricForecasts.series.feels[0].daylight=false,
  ];
  for (const change of cases) {
    const data = structuredClone(accepted);change(data);
    assert.deepEqual(buildForecastWindows(data,base).perfect,[]);
  }
});

test('missing required same-hour values never borrow a nearby value or raw probability',()=>{
  const changes = [
    data => data.metricForecasts.series.feels[0].value=null,
    data => data.metricForecasts.series.feels[0].time=at(-1),
    data => data.metricForecasts.series.feels[0].inputs.skyCover=null,
    data => data.metricForecasts.series.dewpoint[0].value=null,
    data => data.rainTimeline[0].rainLikelihood=null,
    data => data.rainTimeline[0].precipitation=null,
    data => data.rainTimeline.shift(),
    data => data.rainTimeline=[],
    data => {delete data.metricForecasts.series.feels[0].daylight;delete data.hours[0].isDay;},
  ];
  for (const change of changes) {
    const data=fixture(2);change(data);
    assert.deepEqual(buildForecastWindows(data,base).perfect,[]);
  }
});

test('explicit precipitation and obscured-sky wording prevent perfect even when numeric values are dry',()=>{
  for (const condition of ['Rain','Chance showers','Drizzle','Thunderstorms possible','Snow','Sleet','Fog','Mist']) {
    const data=fixture(2);data.hours[0].condition=condition;
    assert.deepEqual(buildForecastWindows(data,base).perfect,[],condition);
  }
});

test('wind wording does not add a separate perfect-weather limit or imply thunderstorms',()=>{
  for (const condition of ['Windy','Windstorm','Wind storm','Wind-storm']) {
    const data=fixture(2);data.hours.forEach(row => row.condition=condition);
    const result=buildForecastWindows(data,base);
    assert.equal(result.perfect.length,1,condition);
    assert.deepEqual(result.rain,[],condition);
  }
});

test('perfect includes every future date and breaks on missing hours or failed conditions',()=>{
  const data=fixture(55);
  data.metricForecasts.series.feels[2].value=80;
  data.metricForecasts.series.feels[4].value=null;
  data.hours=data.hours.slice(0,5);
  const windows=buildForecastWindows(data,base).perfect;
  assert.deepEqual(windows.map(window => [window.date,window.hours.length]),[
    ['2026-09-26',2],['2026-09-26',7],['2026-09-27',24],['2026-09-28',19],
  ]);
  assert.equal(windows[1].start,base+5*HOUR,'Isolated valid hours do not span failed or missing hours.');
});

test('rain uses canonical hourly scores, groups by risk, and allows a single-hour event',()=>{
  const data=fixture(8);
  [59,60,79,80,100,59,null,75].forEach((value,index) => data.rainTimeline[index].rainLikelihood={value});
  data.hours.forEach(row => row.rainLikelihood.value=99);
  const rain=buildForecastWindows(data,base).rain;
  assert.deepEqual(rain.map(window => [window.level,window.hours.length]),[['rain',2],['high',2],['rain',1]]);
  assert.deepEqual(rain.map(window => window.title),['Rain likely','High rain likelihood','Rain likely']);
  assert.equal(rain[0].hours[0].rainChance,60);
});

test('only explicit thunder evidence labels thunderstorms, independently of rain percentage',()=>{
  const data=fixture(5);
  data.hours[0].condition='Thunderstorms possible';
  data.hours[1].condition='Isolated T-storms';
  data.hours[2].condition='Windstorm';
  data.hours[3].condition='Snowstorm';
  data.rainTimeline[4].rainLikelihood.value=100;
  const rain=buildForecastWindows(data,base).rain;
  assert.deepEqual(rain.map(window => [window.level,window.hours.length]),[['thunder',2],['high',1]]);
  assert.equal(rain[0].title,'Thunderstorms possible');
  assert.equal(rain[0].hours[0].rainChance,10);
  assert.equal(Object.hasOwn(rain[0].hours[0],'stormChance'),false);
});

test('coarse condition wording attached to the feels series neither invents thunder hours nor vetoes the blend',()=>{
  const data=fixture(3);
  data.hours=[];
  data.metricForecasts.series.feels.forEach(row => row.condition='Thunderstorms possible');
  assert.deepEqual(buildForecastWindows(data,base).rain,[]);
  assert.equal(buildForecastWindows(data,base).perfect[0].hours.length,3);
  data.rainTimeline[1].condition='Thunderstorms possible';
  const rain=buildForecastWindows(data,base).rain;
  assert.equal(rain.length,1);
  assert.equal(rain[0].start,base+HOUR);
  assert.equal(rain[0].hours.length,1);
  assert.deepEqual(buildForecastWindows(data,base).perfect,[],'Actual hourly adverse wording still splits otherwise qualifying hours.');
});

test('broad later-day rain prose cannot override qualifying numeric blended hours',()=>{
  const start=base+72*HOUR,data=fixture(3,start);
  data.hours=[];
  data.metricForecasts.series.feels.forEach(row => row.condition='Slight chance of rain during the day');
  const perfect=buildForecastWindows(data,base).perfect;
  assert.equal(perfect.length,1);
  assert.equal(perfect[0].start,start);
  assert.equal(perfect[0].hours.length,3);
});

test('elapsed hours disappear and current hour is clipped without promising two full hours',()=>{
  const data=fixture(4);
  const now=base+2.5*HOUR;
  assert.deepEqual(buildForecastWindows(data,now).perfect,[]);
  const ongoing=buildForecastWindows(data,base+.5*HOUR).perfect[0];
  assert.equal(ongoing.start,base+.5*HOUR);
  assert.equal(ongoing.hours[0].time,at(.5));
  assert.equal(ongoing.hours[0].forecastTime,at(0));
  data.rainTimeline.forEach(row => row.rainLikelihood.value=75);
  const rain=buildForecastWindows(data,now).rain[0];
  assert.equal(rain.start,now);
  assert.equal(rain.hours.length,2);
  assert.deepEqual(buildForecastWindows(data,base+4*HOUR).rain,[]);
});

test('exact instants join across offset strings, repeated DST hours, and local-date boundaries',()=>{
  const start=Date.parse('2026-11-01T03:00:00Z'),data=fixture(6,start);
  data.location.timeZone='America/New_York';
  data.rainTimeline.forEach(row => row.rainLikelihood.value=70);
  data.metricForecasts.series.feels[0].time='2026-10-31T23:00:00-04:00';
  const rain=buildForecastWindows(data,start).rain;
  assert.deepEqual(rain.map(window => [window.date,window.hours.length]),[['2026-10-31',1],['2026-11-01',5]]);
  assert.equal(rain[0].hours[0].feels,72);
  assert.equal(rain[1].end-rain[1].start,5*HOUR,'The two 1 AM hours remain separate real hours.');
});

test('coarse intervals are never expanded into hourly opportunities',()=>{
  const data=fixture(5);
  data.rainTimeline.forEach(row => row.rainLikelihood.value=85);
  data.rainTimeline[1].end=at(4);
  const rain=buildForecastWindows(data,base).rain;
  assert.deepEqual(rain.map(window => window.hours.length),[1,3]);
  assert.equal(rain[1].start,base+2*HOUR);
  const coarse=fixture(2);
  coarse.hours[0].end=at(3);
  assert.deepEqual(buildForecastWindows(coarse,base).perfect,[]);
});

test('without a canonical timeline, blend hourly scores work and raw NWS values never substitute',()=>{
  const data=fixture(2);delete data.rainTimeline;
  assert.equal(buildForecastWindows(data,base).perfect.length,1);
  data.hours.forEach(row => {delete row.rainLikelihood;row.pop=100;});
  assert.deepEqual(buildForecastWindows(data,base).rain,[]);
  assert.deepEqual(buildForecastWindows(data,base).perfect,[]);
});

test('sunset prevents an hourly perfect window from extending into darkness',()=>{
  const data=fixture(3,Date.parse('2026-09-26T22:00:00Z'));
  data.location={timeZone:'America/New_York',latitude:35.7931,longitude:-78.481};
  assert.deepEqual(buildForecastWindows(data,Date.parse(data.hours[0].time)).perfect,[]);
});
