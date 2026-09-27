import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecastWindows} from '../public/weather-fusion/forecast-windows.js';
import {forecastWindowBannerHTML,forecastWindowDetailHTML} from '../public/weather-fusion/forecast-window-banners.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';

const HOUR = 3600000;
const base = Date.parse('2026-09-26T12:00:00Z');
const at = (hour, start=base) => new Date(start+hour*HOUR).toISOString();
const location={timeZone:'America/New_York',latitude:35.79,longitude:-78.48};

test('perfect and rain outlook controls stay hidden without matching forecast hours',()=>{
  const view=buildForecastWindows({},base);
  const perfect=forecastWindowBannerHTML(view,'perfect',base),rain=forecastWindowBannerHTML(view,'rain',base);
  assert.equal(perfect,'');assert.equal(rain,'');
  assert.match(forecastWindowDetailHTML(view,'perfect','Knightdale',base),/No matching hours in the next 5 days/);
  assert.match(forecastWindowDetailHTML(view,'rain','Knightdale',base),/No matching hours in the next 5 days/);
});

function refreshHour(data,index){
  const hour=data.hours.find(row=>Date.parse(row.time)===Date.parse(data.metricForecasts.series.feels[index].time));
  const point=data.metricForecasts.series.feels[index],inputs=point.inputs,time=Date.parse(point.time);
  hour.temperature=inputs.temperature;hour.dewpoint=inputs.dewpoint;hour.skyCover=inputs.skyCover;hour.condition=inputs.condition;
  const temperature=data.metricForecasts.series.temperature?.find(row=>Date.parse(row.time)===time);if(temperature)temperature.value=inputs.temperature;
  const comfort=thermalComfort(inputs,data.location,time);
  point.value=Number(comfort.rawOutdoors.toFixed(1));point.daylight=comfort.daylight;point.condition=inputs.condition;
}
function setSunTemperature(data,index,target){
  const point=data.metricForecasts.series.feels[index],inputs=point.inputs,time=Date.parse(point.time);
  let air=target;
  for(let n=0;n<8;n++){
    inputs.temperature=air;refreshHour(data,index);
    const comfort=thermalComfort(inputs,data.location,time),sun=air+comfort.rawOutdoors-comfort.rawShade;
    air+=target-sun;
  }
  inputs.temperature=air;refreshHour(data,index);
}

function fixture(count=4, start=base) {
  const hours = Array.from({length:count},(_,index) => ({time:at(index,start),isDay:true,
    temperature:70,skyCover:20,dewpoint:50,condition:'Clear',windMph:0,gust:5,
    precipitation:0,rainLikelihood:{value:10},pop:99}));
  const data={location:{...location},hours,
    rainTimeline:hours.map(hour => ({time:hour.time,end:at(1,Date.parse(hour.time)),precipitation:0,rainLikelihood:{value:10},officialPop:99})),
    metricForecasts:{series:{
      temperature:hours.map(hour=>({time:hour.time,value:70})),
      feels:hours.map(hour => ({time:hour.time,value:72,daylight:true,condition:hour.condition,inputs:{temperature:70,dewpoint:50,wind:0,skyCover:20,condition:hour.condition,type:'guidance'}})),
      dewpoint:hours.map(hour => ({time:hour.time,value:50})),
      gust:hours.map(hour => ({time:hour.time,value:5})),
    }},
  };
  for(let i=0;i<count;i++)setSunTemperature(data,i,72);
  return data;
}

test('perfect uses modeled feels in direct sun, same-hour sky and dry blend values',()=>{
  const data = fixture();
  const result = buildForecastWindows(data,base);
  assert.equal(result.perfect.length,1);
  assert.equal(result.rain.length,0,'Conflicting raw NWS probabilities cannot override the blend.');
  assert.equal(result.perfect[0].start,base);
  assert.equal(result.perfect[0].end,base+4*HOUR);
  assert.equal(result.perfect[0].hours.length,4);
  assert.equal(Math.round(result.perfect[0].hours[0].feels),72);
  data.metricForecasts.series.feels.forEach((_,index)=>setSunTemperature(data,index,81));
  assert.deepEqual(buildForecastWindows(data,base).perfect,[],'Comfort uses air plus the matching sun exposure lift, not air or shade temperature alone.');
});

test('sun feels-like must be 70–75°F inclusive, and every individual limiting field is required',()=>{
  const accepted = fixture(1);
  accepted.metricForecasts.series.feels.forEach((row,index)=>{row.inputs.skyCover=40;refreshHour(accepted,index);});
  setSunTemperature(accepted,0,70);
  accepted.metricForecasts.series.dewpoint.forEach(row => row.value=60);
  accepted.rainTimeline.forEach(row => {row.rainLikelihood.value=20;row.precipitation=.009;});
  assert.equal(buildForecastWindows(accepted,base).perfect.length,1);
  const upper=structuredClone(accepted);setSunTemperature(upper,0,75);
  assert.equal(buildForecastWindows(upper,base).perfect.length,1);
  const cases = [
    data => setSunTemperature(data,0,69.9),
    data => setSunTemperature(data,0,75.01),
    data => setSunTemperature(data,0,75.1),
    data => {data.metricForecasts.series.feels[0].inputs.skyCover=40.1;refreshHour(data,0);},
    data => data.metricForecasts.series.dewpoint[0].value=60.1,
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
    const data=fixture(1);change(data);
    assert.deepEqual(buildForecastWindows(data,base).perfect,[]);
  }
});

test('explicit precipitation and obscured-sky wording prevent perfect even when numeric values are dry',()=>{
  for (const condition of ['Rain','Chance showers','Drizzle','Thunderstorms possible','Snow','Sleet','Fog','Mist']) {
    const data=fixture(1);data.hours[0].condition=condition;
    assert.deepEqual(buildForecastWindows(data,base).perfect,[],condition);
  }
});

test('wind speed itself does not veto otherwise qualifying sun hours',()=>{
  const data=fixture(2);
  data.metricForecasts.series.feels.forEach((row,index)=>{row.inputs.wind=20;refreshHour(data,index);setSunTemperature(data,index,72);});
  data.hours.forEach(row=>{row.windMph=20;row.gust=30;});
  assert.equal(buildForecastWindows(data,base).perfect.length,1);
  assert.deepEqual(buildForecastWindows(data,base).rain,[]);
});

test('perfect includes every future date and breaks on missing hours or failed conditions',()=>{
  const data=fixture(55);
  data.metricForecasts.series.feels[2].value=80;
  data.metricForecasts.series.feels[4].value=null;
  data.hours=data.hours.slice(0,5);
  const windows=buildForecastWindows(data,base).perfect;
  assert.deepEqual(windows.map(window => [window.date,window.hours.length]),[['2026-09-26',2],['2026-09-26',1]]);
  assert.equal(windows[0].end,base+2*HOUR,'An invalid/missing hour splits the sunny window.');
  assert.ok(windows.every(window=>window.start<base+5*24*HOUR),'No window extends past the five-day horizon.');
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

test('coarse condition wording attached to feels data cannot replace missing hourly sun inputs',()=>{
  const data=fixture(3);
  data.hours=[];
  data.metricForecasts.series.feels.forEach(row => row.condition='Thunderstorms possible');
  assert.deepEqual(buildForecastWindows(data,base).rain,[]);
  assert.deepEqual(buildForecastWindows(data,base).perfect,[],'No hourly sample means no sun-exposure estimate.');
  data.rainTimeline[1].condition='Thunderstorms possible';
  const rain=buildForecastWindows(data,base).rain;
  assert.equal(rain.length,1);
  assert.equal(rain[0].start,base+HOUR);
  assert.equal(rain[0].hours.length,1);
  assert.deepEqual(buildForecastWindows(data,base).perfect,[],'Actual hourly adverse wording still splits otherwise qualifying hours.');
});

test('broad later-day rain prose cannot override qualifying numeric blended hours',()=>{
  const start=base+72*HOUR,data=fixture(3,start);
  data.metricForecasts.series.feels.forEach(row => row.condition='Slight chance of rain during the day');
  const perfect=buildForecastWindows(data,base).perfect;
  assert.equal(perfect.length,1);
  assert.equal(perfect[0].start,start);
  assert.equal(perfect[0].hours.length,3);
});

test('elapsed hours disappear and a qualifying current hour is shown clipped',()=>{
  const data=fixture(4);
  const now=base+2.5*HOUR;
  const perfect=buildForecastWindows(data,now).perfect;
  assert.equal(perfect.length,1);assert.equal(perfect[0].start,now);
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
  assert.equal(rain[0].hours[0].feels,null,'Sun feels-like is not reported after sunset.');
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
  const perfect=buildForecastWindows(coarse,base).perfect;
  assert.equal(perfect.length,1);assert.equal(perfect[0].hours.length,1);
});

test('without a canonical timeline, blend hourly scores work and raw NWS values never substitute',()=>{
  const data=fixture(2);delete data.rainTimeline;
  assert.equal(buildForecastWindows(data,base).perfect.length,1);
  data.hours.forEach(row => {delete row.rainLikelihood;row.pop=100;});
  assert.deepEqual(buildForecastWindows(data,base).rain,[]);
  assert.deepEqual(buildForecastWindows(data,base).perfect,[]);
});

test('sunset prevents an hourly perfect window from extending into darkness',()=>{
  const data=fixture(3,Date.parse('2026-09-26T23:00:00Z'));
  data.location={timeZone:'America/New_York',latitude:35.7931,longitude:-78.481};
  assert.deepEqual(buildForecastWindows(data,Date.parse(data.hours[0].time)).perfect,[]);
});
