import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';
import {dailyForecastReadings,sevenDayForecast} from '../public/weather-fusion/seven-day.js';

const H=3600000;
const iso=time=>new Date(time).toISOString();
const now=Date.parse('2026-10-14T19:00:00Z');
const saturdayStart=Date.parse('2026-10-17T11:00:00Z');
const saturdayEnd=saturdayStart+24*H;
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} should equal ${expected}`);

function likelihood(start,end,value=73) {
  return {value,aggregation:'maximum-hourly',window:{start:iso(start),end:iso(end)},
    coverage:{complete:true},peak:{sourceValues:{nws:30,ecmwf:100,nbm:33.33333333333333}}};
}

function day(date,start,end) {
  return {date,label:'Sat',high:64,low:44,condition:'Rain Showers',nightCondition:'Mostly Clear',
    highWindow:{start:iso(start),end:iso(start+12*H)},
    lowWindow:{start:iso(start+12*H),end:iso(end)},
    highBlend:{value:64,sources:[{id:'nws',value:65},{id:'ecmwf',value:63}]},
    lowBlend:{value:44,sources:[{id:'nws',value:45},{id:'ecmwf',value:43}]},
    qpf:9,qpfWindow:{start:iso(start),end:iso(end)},
    qpfBlend:{value:.19,sources:[{id:'nws',value:.08,coverageHours:19},{id:'ecmwf',value:.20},{id:'nbm',value:.12}],
      sourceValues:{nws:null,ecmwf:.20,nbm:.12}},
    rainLikelihood:likelihood(start,end),popDayLikelihood:likelihood(start,start+12*H),
    popNightLikelihood:likelihood(start+12*H,end),snowfall:0,uvMax:6};
}

function fixture({start=saturdayStart,end=saturdayEnd,date='2026-10-17',today='2026-10-14',rain=.16}={}) {
  const firstStart=Date.parse(`${today}T11:00:00Z`);
  const count=Math.ceil((end-Math.floor(start/H)*H)/H);
  const rows=Array.from({length:count},(_,i)=>{
    const time=Math.floor(start/H)*H+i*H;
    return {time:iso(time),end:iso(time+H),precipitation:rain/((end-start)/H),
      rainLikelihood:{value:i===0?73:20},precipitationBlend:{sourceValues:{nws:.005,ecmwf:.01,nbm:.004}}};
  });
  const wind=rows.map((r,i)=>({time:r.time,value:i<12?8:12,
    sources:[{id:'nws',value:i<12?6:14},{id:'ecmwf',value:20}]}));
  const dewpoint=rows.map((r,i)=>({time:r.time,value:i===rows.length-1?65:40,
    sources:[{id:'nws',value:i===rows.length-1?60:35}]}));
  for(const series of [wind,dewpoint])series.push({time:iso(start-H),value:100,sources:[{id:'nws',value:100}]},
    {time:iso(end),value:100,sources:[{id:'nws',value:100}]});
  return {location:{timeZone:'America/New_York'},days:[day(today,firstStart,firstStart+24*H),day(date,start,end)],
    current:{},hours:[],rainTimeline:rows,metricForecasts:{series:{wind,dewpoint}}};
}

function wnHours(start,end,value=.02) {
  return {hourly:Array.from({length:Math.ceil((end-Math.floor(start/H)*H)/H)},(_,i)=>({
    time:iso(Math.floor(start/H)*H+(i+1)*H),
    values:{total_precipitation_1hr:{mean:value/39.3701}}
  }))};
}

test('Saturday comparison uses the same canonical 0.16-inch amount as the seven-day tile',()=>{
  const fx=fixture(),built=buildSeries(fx,null,'rain',now);
  const tile=sevenDayForecast(fx,now)[1];
  close(built.forecastValues[1],.16);
  assert.equal(built.forecastValues[1],tile.amount);
  assert.equal(built.forecastValues[1].toFixed(2),'0.16');
  assert.notEqual(built.forecastValues[1],fx.days[1].qpfBlend.value);
  assert.notEqual(built.forecastValues[1],fx.days[1].qpf);
  assert.deepEqual(built.windows[1],tile.windWindow);
});

test('a partial NWS amount never appears as a complete daily model accumulation',()=>{
  const fx=fixture(),built=buildSeries(fx,null,'rain',now);
  assert.equal(Object.hasOwn(built.modelMaps[1],'nws'),false);
  assert.deepEqual(built.modelMaps[1],{ecmwf:.20,nbm:.12});
});

test('missing canonical hourly precipitation stays unavailable despite available model totals',()=>{
  const fx=fixture();fx.rainTimeline[5].precipitation=null;
  const built=buildSeries(fx,wnHours(saturdayStart,saturdayEnd),'rain',now);
  assert.equal(built.forecastValues[1],null);
  assert.equal(dailyForecastReadings(fx,now)[1].amount,null);
  assert.ok(built.modelMaps[1].ecmwf>0);
  assert.ok(built.wnVals[1]>0);
});

test('rain chance uses the published canonical peak without averaging model signals',()=>{
  const fx=fixture(),built=buildSeries(fx,null,'pop',now);
  assert.equal(built.forecastValues[1],73);
  assert.equal(built.forecastValues[1],dailyForecastReadings(fx,now)[1].pop);
  assert.deepEqual(built.modelMaps[1],{nws:30,ecmwf:100,nbm:33.33333333333333});
});

test('wind is the shared period mean and dewpoint is the maximum in that same 7 AM window',()=>{
  const fx=fixture(),wind=buildSeries(fx,null,'wind',now),dew=buildSeries(fx,null,'dewpoint',now);
  assert.equal(wind.forecastValues[1],10);
  assert.equal(wind.forecastValues[1],dailyForecastReadings(fx,now)[1].wind);
  assert.deepEqual(wind.modelMaps[1],{nws:10,ecmwf:20});
  assert.equal(dew.forecastValues[1],65);
  assert.deepEqual(dew.modelMaps[1],{nws:60});
  assert.deepEqual(wind.windows[1],{start:saturdayStart,end:saturdayEnd});
  assert.deepEqual(dew.windows[1],wind.windows[1]);
});

test('an unknown future high remains unknown even when its overnight low or model high is available',()=>{
  const fx=fixture();fx.days[1].high=null;
  const built=buildSeries(fx,null,'temp',now);
  assert.equal(built.forecastValues[1],null);
  assert.equal(dailyForecastReadings(fx,now)[1].low,44);
  assert.equal(built.modelMaps[1].nws,65);
});

test('WeatherNext rainfall uses end-labelled intervals and prorates partial boundary hours',()=>{
  const start=Date.parse('2026-10-17T11:30:00Z'),end=Date.parse('2026-10-17T14:15:00Z');
  const fx=fixture({start,end}),wn=wnHours(start,end);
  [.04,.08,.12,.16].forEach((value,i)=>{wn.hourly[i].values.total_precipitation_1hr.mean=value/39.3701;});
  close(buildSeries(fx,wn,'rain',now).wnVals[1],.5*.04+.08+.12+.25*.16);
});

test('WeatherNext rainfall with an interior missing hour does not fabricate a daily sum',()=>{
  const fx=fixture(),wn=wnHours(saturdayStart,saturdayEnd);
  wn.hourly.splice(10,1);
  assert.equal(buildSeries(fx,wn,'rain',now).wnVals[1],null);
});

test('WeatherNext rainfall with missing initial coverage remains unavailable',()=>{
  const start=saturdayStart+H/2,fx=fixture({start}),wn=wnHours(start,saturdayEnd);
  wn.hourly.shift();
  assert.equal(buildSeries(fx,wn,'rain',now).wnVals[1],null);
});

test('a 25-hour daylight-saving 7 AM window retains all canonical and WeatherNext rainfall',()=>{
  const start=Date.parse('2026-10-31T11:00:00Z'),end=Date.parse('2026-11-01T12:00:00Z');
  const fx=fixture({start,end,date:'2026-10-31',today:'2026-10-30',rain:.25});
  const built=buildSeries(fx,wnHours(start,end,.02),'rain',Date.parse('2026-10-30T15:00:00Z'));
  assert.equal((built.windows[1].end-built.windows[1].start)/H,25);
  close(built.forecastValues[1],.25);
  close(built.wnVals[1],.50);
  assert.equal(built.forecastValues[1],dailyForecastReadings(fx,Date.parse('2026-10-30T15:00:00Z'))[1].amount);
});

test('zero rain, chance, temperature, wind, dewpoint and snow remain valid readings',()=>{
  const fx=fixture({rain:0});
  Object.assign(fx.days[1],{high:0,low:0,snowfall:0,rainLikelihood:likelihood(saturdayStart,saturdayEnd,0)});
  for(const key of ['wind','dewpoint'])for(const point of fx.metricForecasts.series[key])point.value=0;
  for(const metric of ['rain','pop','temp','wind','dewpoint','snow'])assert.equal(buildSeries(fx,null,metric,now).forecastValues[1],0,metric);
  assert.equal(buildSeries(fx,wnHours(saturdayStart,saturdayEnd,0),'rain',now).wnVals[1],0);
});

test('Tonight uses the published low and WeatherNext minimum while later days use highs and maxima',()=>{
  const fx=fixture(),evening=Date.parse('2026-10-14T23:00:00Z');
  const nightStart=evening,nightEnd=Date.parse('2026-10-15T11:00:00Z');
  Object.assign(fx.days[0],{low:60,lowWindow:{start:iso(nightStart),end:iso(nightEnd)},
    popNightLikelihood:likelihood(nightStart,nightEnd,0)});
  const samples=(start,end,min,max)=>Array.from({length:(end-start)/H},(_,i)=>({time:iso(start+i*H),
    values:{temperature_2m:{mean:((i===0?min:max)-32)*5/9+273.15}}}));
  const wn={hourly:[...samples(nightStart,nightEnd,59,70),...samples(saturdayStart,saturdayStart+12*H,65,80)]};
  const built=buildSeries(fx,wn,'temp',evening);
  assert.deepEqual(built.forecastValues,[60,64]);
  close(built.wnVals[0],59);close(built.wnVals[1],80);
  assert.equal(built.days[0].tonight,true);assert.equal(built.days[1].tonight,false);
});
