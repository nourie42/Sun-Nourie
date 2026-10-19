import test from 'node:test';
import assert from 'node:assert/strict';
import {currentAirQuality,airQualityAtTime,airQualityWeek,aqiBand,airQualityHTML} from '../public/weather-fusion/air-quality.js';
import {pavementEstimate,pavementHTML} from '../public/weather-fusion/pavement.js';
import {todayForecastHTML} from '../public/weather-fusion/today-card.js';
import {comfortGrid,perfectWindows} from '../public/weather-fusion/atmos-model.js';
import {buildForecastWindows} from '../public/weather-fusion/forecast-windows.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {buildTodayModel} from '../public/weather-fusion/today.js';
import {buildGlanceModel} from '../public/weather-fusion/glance.js';
import {buildModel as buildHaloModel} from '../public/weather-fusion/halo.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';

const H=3600000,now=Date.parse('2026-10-19T16:10:00Z'),start=Math.floor(now/H)*H;
const iso=t=>new Date(t).toISOString();
const location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
function forecast(temperatures=[74,76,72]){
 const hours=temperatures.map((temperature,i)=>({time:iso(start+i*H),end:iso(start+(i+1)*H),temperature,dewpoint:42,wind:11,skyCover:0,condition:'Sunny',isDay:true,precipitation:0,rainLikelihood:{value:0}}));
 const feels=hours.map(row=>{
  const inputs={temperature:row.temperature,dewpoint:row.dewpoint,wind:row.wind,skyCover:row.skyCover,condition:row.condition};
  const comfort=thermalComfort(inputs,location,Date.parse(row.time));
  return {time:row.time,value:Number(comfort.rawOutdoors.toFixed(1)),inputs,shadeValue:Number(comfort.rawShade.toFixed(1)),daylight:comfort.daylight};
 });
 return {assembledAt:iso(now),location,days:[{date:'2026-10-19',label:'Today',condition:'Sunny',high:76,low:72,pop:0,uvMax:5}],current:{},hours,rainTimeline:hours,
  metricForecasts:{series:{feels,...Object.fromEntries(['temperature','dewpoint','wind'].map(key=>[key,hours.map(row=>({time:row.time,value:row[key]}))]))}}};
}

test('the Today summary names a forecast peak and time instead of a conflicting current feels-like',()=>{
 const data=forecast(),html=todayForecastHTML(data,now),peak=data.metricForecasts.series.feels[1].value;
 assert.match(html,/Peak forecast feels like <b>/);
 assert.ok(html.includes(`${Math.round(peak)}°`));
 assert.match(html,/1:00 PM · outdoors · partial data/);
 assert.match(html,/>Avg wind</);
 assert.match(html,/>AQI now</);
});

test('a fresh assembled forecast cannot rejuvenate old pavement source data',()=>{
 const data=forecast();
 data.exposureWeather={fetchedAt:iso(now-3*H),rows:Array.from({length:51},(_,i)=>({time:iso(start-48*H+i*H),temperature:59,dewpoint:42,wind:11,skyCover:0,solar:0,rain:0}))};
 const result=pavementEstimate(data,{temperature:59,dewpoint:42,wind:11,skyCover:0},now);
 assert.equal(result.status,'unavailable');
 assert.match(result.reason,/surface-weather update is too old/);
 data.exposureWeather.fetchedAt=iso(now);
 assert.equal(pavementEstimate(data,{temperature:59,dewpoint:42,wind:11,skyCover:0},now).status,'estimated');
});

test('the pet number explicitly names the surface instead of implying a third feels-like',()=>{
 const html=pavementHTML({status:'estimated',daylight:true,concrete:{value:70,low:60,high:80},asphalt:{value:78,low:65,high:90}},54,{condition:'Sunny'});
 assert.match(html,/<strong>70°<\/strong><small class="pavement-secondary">Concrete surface<\/small>/);
 assert.match(html,/Asphalt 78°/);
 assert.match(html,/Est\. surface temp/);
});

test('current AQI expires by model timestamp and a selected forecast hour cannot borrow current pollutants',()=>{
 const data={airQuality:{time:iso(start),aqi:28,pm25:5,next24HourPeak:80,hours:[{time:iso(start+H),aqi:80}]}};
 assert.equal(currentAirQuality(data,now)?.aqi,28);
 assert.equal(currentAirQuality(data,start+2*H+1),null);
 assert.equal(airQualityAtTime(data,start+H+5*60000)?.aqi,80);
 assert.equal(airQualityAtTime(data,start+H)?.pm25,undefined);
 assert.equal(airQualityAtTime(data,start+H)?.next24HourPeak,undefined);
 assert.equal(airQualityAtTime(data,start+2*H),null);
 assert.equal(airQualityAtTime(data,now,true)?.aqi,28);
 assert.equal(aqiBand(-1).key,'unavailable');
});

test('invalid AQI times cannot break the local-date week or turn missing into zero',()=>{
 const data={location,days:[{date:'2026-10-19'},{date:'2026-10-20'}],airQuality:{time:iso(start),aqi:28,next24HourPeak:28,hours:[{time:'bad',aqi:100},{time:iso(start),aqi:-1},{time:iso(start+H),aqi:0}]}};
 assert.deepEqual(airQualityWeek(data).map(day=>day.value),[0,null]);
 assert.match(airQualityHTML(data),/Available 24-hour forecast peak/);
});

test('Atmos perfect hours and intervals equal the main page canonical outdoor windows',()=>{
 const data=forecast(),main=buildForecastWindows(data,now).perfect;
 assert.ok(main.length);
 const windows=perfectWindows(comfortGrid(data,now));
 assert.deepEqual(windows.map(w=>[w.start,w.end]),main.map(w=>[w.start,w.end]));
 assert.equal(windows[0].start,now,'the current forecast hour starts at Now, not an elapsed ten minutes');
 const cool=forecast([72,72,72]);
 assert.ok(cool.metricForecasts.series.feels.every(row=>row.value<70));
 assert.equal(perfectWindows(comfortGrid(cool,now)).length,0,'pleasant air-temperature bands cannot override a cool canonical outdoor reading');
 cool.metricForecasts.series.feels[0].value=null;
 assert.equal(perfectWindows(comfortGrid(cool,now)).length,0,'missing canonical feels-like cannot qualify');
});

test('Today and Glance display the same current outdoor estimate as the main page, including missing values',()=>{
 const data=forecast([59,65,66]);
 data.current={type:'observation',time:iso(now-5*60000),temperature:59,dewpoint:42,wind:11,skyCover:0,condition:'Sunny',humidity:52};
 const canonical=currentSample(data,now),expected=Math.round(canonical.feels);
 assert.notEqual(expected,59,'the reported cool breeze changes how59°F feels');
 for(const build of [buildTodayModel,buildGlanceModel]){
  const model=build(data,now);
  assert.equal(model.hero.feels,expected);
  assert.match(model.hero.feelsSource,/Current conditions/);
  const missing=structuredClone(data);missing.current.dewpoint=null;missing.current.humidity=null;missing.metricForecasts.series.feels=[];
  assert.equal(build(missing,now).hero.feels,null,'missing moisture cannot fall back to the air temperature');
 }
});

test('alternate pages show the current-hour UV and current AQI, never an arbitrary earlier reading',()=>{
 const data=forecast();
 data.current={time:iso(now),temperature:59,dewpoint:42,wind:11,skyCover:0,condition:'Sunny'};
 data.uv={today:8,hourly:[{time:iso(start-H),value:6},{time:iso(start),value:null}]};
 data.airQuality={time:iso(start-3*H),aqi:28,hours:[]};
 assert.equal(buildGlanceModel(data,now).details.find(d=>d[0]==='UV index')[1],'—');
 assert.equal(buildGlanceModel(data,now).details.find(d=>d[0]==='Air quality')[1],'—');
 assert.equal(buildTodayModel(data,now).details.find(d=>d.k==='UV index now').v,'--');
 assert.equal(buildTodayModel(data,now).details.find(d=>d.k==='Air quality').v,'--');
 const halo=buildHaloModel(data,now);
 assert.equal(halo.tiles.find(t=>t.id==='uv').value,'—');
 assert.equal(halo.tiles.some(t=>t.id==='aqi'),false);
 data.uv.hourly[1].value=0;data.airQuality.time=iso(start);
 assert.equal(buildGlanceModel(data,now).details.find(d=>d[0]==='UV index')[1],'0');
 assert.equal(buildHaloModel(data,now).tiles.find(t=>t.id==='uv').value,'0');
});
