import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecast} from '../src/weatherFusion.js';
import {alignGuidanceCurrentWithHourly} from '../src/weatherFusionCurrent.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {testInputs,snapshot} from './weatherFusion.fixtures.js';

const H=3600000;
function fixture(){
 const input=structuredClone(testInputs);
 input.now+=45*60000;
 input.hourly.periods.forEach(hour=>Object.assign(hour,{temperature:44,windSpeed:'6 mph',shortForecast:'Sunny',dewpoint:{unitCode:'wmoUnit:degF',value:35}}));
 input.grid={};
 for(const [field,uom,value] of [['temperature','wmoUnit:degF',44],['windSpeed','wmoUnit:mi_h-1',6],['dewpoint','wmoUnit:degF',35],['skyCover','wmoUnit:percent',0]]){
  input.grid[field]={uom,values:[{validTime:new Date(testInputs.now).toISOString()+'/P10D',value}]};
 }
 input.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{
  const raw=snapshot(id),point=raw.points[0],hourly=point.hourly;
  hourly.temperature_2m.fill({hrrr:44,ecmwf:48,nbm:52}[id]);
  hourly.dew_point_2m=hourly.time.map(()=>({hrrr:36,ecmwf:40,nbm:44}[id]));
  hourly.wind_speed_10m.fill({hrrr:5,ecmwf:8,nbm:10}[id]);
  hourly.cloud_cover=hourly.time.map(()=>0);
  Object.assign(point.hourly_units,{dew_point_2m:'°F',cloud_cover:'%'});
  return [id,{...point,direct:true,verifiedModel:true,model:id,runAt:raw.runAt,validUntil:raw.validUntil}];
 }));
 input.observation={...input.observation,temperature:52,wind:20,dewpoint:44,station:'FAR',stationDistanceKm:30};
 return input;
}
function currentRows(out,now){
 const epoch=Math.floor(now/H)*H;
 return {temperature:out.metricForecasts.series.temperature.find(row=>Date.parse(row.time)===epoch),
  feels:out.metricForecasts.series.feels.find(row=>Date.parse(row.time)===epoch),hour:out.hours.find(row=>Date.parse(row.time)===epoch)};
}

test('rejected 52 degree single-model current uses the 46 degree displayed hourly blend and provenance',()=>{
 const input=fixture(),out=buildForecast(input),{temperature,feels,hour}=currentRows(out,input.now);
 assert.equal(out.current.type,'guidance');assert.equal(out.current.temperature,46);assert.equal(temperature.value,46);
 for(const key of ['temperature','dewpoint','wind','humidity','skyCover'])assert.equal(out.current[key],feels.inputs[key],key);
 assert.equal(out.current.wind,6.7);assert.equal(out.current.dewpoint,37.6);
 assert.equal(out.current.temperatureSource,hour.temperatureSource);assert.equal(out.current.temperatureSource,temperature.source);
 assert.match(temperature.source,/NWS 40% \/ HRRR 30% \/ ECMWF 10% \/ NBM 20%/);
 assert.deepEqual(out.current.fieldSources.temperature.sources,temperature.sources);
 assert.equal(out.current.station,null);assert.equal(out.current.sourceValidation.accepted,false);
 assert.equal(out.current.localEstimate.referenceStation.station,'FAR');
 assert.equal(out.current.localEstimate.basis,'canonical-hourly-blend');
 assert.match(out.metricForecasts.notes.dewpoint,/modeled current conditions use the matching hourly forecast blend/);
 assert.doesNotMatch(out.metricForecasts.notes.dewpoint,/Current dew point is a station observation/);
});

test('no-observation guidance uses the same canonical fields, not the first available model',()=>{
 const input=fixture();input.observation=null;
 const out=buildForecast(input),{feels}=currentRows(out,input.now);
 assert.equal(out.current.temperature,46);
 assert.equal(out.current.type,'guidance');assert.equal(out.current.sourceValidation,undefined);
 for(const key of ['dewpoint','wind','humidity','skyCover'])assert.equal(out.current[key],feels.inputs[key]);
 assert.equal(out.current.localEstimate.validAt,feels.time);
});

test('modeled current custom feels uses the same canonical solar time and exposure outputs',()=>{
 const input=fixture(),out=buildForecast(input),{feels}=currentRows(out,input.now);
 const canonical=thermalComfort({...feels.inputs,condition:feels.condition,type:'guidance'},out.location,Date.parse(feels.time));
 const actualClock=thermalComfort({...feels.inputs,condition:feels.condition,type:'guidance'},out.location,input.now);
 assert.notEqual(canonical.rawOutdoors,actualClock.rawOutdoors,'fixture must exercise changing solar exposure');
 assert.equal(out.current.thermalTime,feels.time);assert.equal(out.current.thermalCondition,feels.condition);
 assert.equal(out.comfort.rawOutdoors,canonical.rawOutdoors);
 assert.equal(out.current.feelsLike,feels.value);assert.equal(out.comfort.outdoors,feels.value);
 assert.equal(out.current.feelsLikeShade,feels.shadeValue);assert.equal(out.current.feelsLikeSun,feels.sunValue);
});

test('an accepted observation keeps its measurement, provenance and actual-time custom comfort',()=>{
 const input=fixture();input.observation.stationDistanceKm=4;
 const out=buildForecast(input),expected=thermalComfort({...input.observation,type:'observation'},out.location,input.now);
 assert.equal(out.current.type,'observation');assert.equal(out.current.temperature,52);
 assert.equal(out.current.wind,20);assert.equal(out.current.dewpoint,44);assert.equal(out.current.station,'FAR');
 assert.equal(out.current.sourceValidation.accepted,true);assert.equal(out.current.thermalTime,undefined);
 assert.equal(out.comfort.rawOutdoors,expected.rawOutdoors);
});

test('a genuine zero temperature and calm wind remain canonical values',()=>{
 const input=fixture();input.observation=null;
 for(const hour of input.hourly.periods){hour.temperature=0;hour.windSpeed='Calm';hour.dewpoint.value=-5;}
 for(const model of Object.values(input.models)){
  model.hourly.temperature_2m.fill(0);model.hourly.wind_speed_10m.fill(0);model.hourly.dew_point_2m.fill(-5);
 }
 input.grid.temperature.values[0].value=0;input.grid.windSpeed.values[0].value=0;input.grid.dewpoint.values[0].value=-5;
 const out=buildForecast(input);
 assert.equal(out.current.type,'guidance');assert.equal(out.current.temperature,0);assert.equal(out.current.wind,0);assert.equal(out.current.dewpoint,-5);
 assert.ok(Number.isFinite(out.current.humidity));
});

test('missing canonical companion fields stay null rather than retaining a rejected station or old model',()=>{
 const input=fixture();
 delete input.grid.windSpeed;delete input.grid.dewpoint;
 for(const hour of input.hourly.periods){hour.windSpeed='Unavailable';hour.dewpoint={value:null};hour.relativeHumidity={value:null};}
 for(const model of Object.values(input.models)){
  model.hourly.wind_speed_10m.fill(null);model.hourly.dew_point_2m.fill(null);
 }
 const out=buildForecast(input);
 assert.equal(out.current.temperature,46);assert.equal(out.current.wind,null);assert.equal(out.current.dewpoint,null);assert.equal(out.current.humidity,null);
 assert.equal(out.current.feelsLike,null);assert.equal(out.current.feelsLikeShade,null);assert.equal(out.current.feelsLikeSun,null);
});

test('no matching canonical hour cannot borrow an expired or future temperature or feel',()=>{
 for(const offset of [-H,H]){
  const time=new Date(testInputs.now+offset).toISOString(),out={current:{type:'guidance',temperature:52,dewpoint:44,wind:10,humidity:80,apparent:60},hours:[],metricForecasts:{series:{
   temperature:[{time,value:46,source:'old/future'}],feels:[{time,value:44,inputs:{temperature:46,dewpoint:37,wind:7,humidity:70,skyCover:0}}]}}};
  alignGuidanceCurrentWithHourly(out,testInputs.now+45*60000);
  assert.equal(out.current.type,'unavailable');
  for(const key of ['temperature','dewpoint','wind','humidity','skyCover','apparent','feelsLike','feelsLikeShade','feelsLikeSun'])assert.equal(out.current[key],null,key);
 }
});

test('current alignment leaves rain likelihood, raw source values and future temperature policies unchanged',()=>{
 const input=fixture(),out=buildForecast(input),{hour}=currentRows(out,input.now);
 assert.deepEqual(hour.temperatureBlend.sources.map(row=>[row.id,row.value,row.weight]),[['nws',44,.4],['hrrr',44,.3],['ecmwf',48,.1],['nbm',52,.2]]);
 assert.equal(hour.temperatureBlend.temperatureAdjustment,null);
 assert.equal(hour.pop,input.hourly.periods[0].probabilityOfPrecipitation.value);
 assert.equal(hour.officialPop,0);assert.ok(hour.rainLikelihood.sources.length);
 const accepted=structuredClone(input);accepted.observation.stationDistanceKm=4;
 const other=buildForecast(accepted);
 assert.deepEqual(out.rainTimeline,other.rainTimeline);
 assert.deepEqual(out.hours.map(hour=>hour.temperatureBlend),other.hours.map(hour=>hour.temperatureBlend));
});

test('matching WeatherNext contributions use the Google label without changing their established shares',()=>{
 const input=fixture();
 input.models.wn={...structuredClone(input.models.nbm),model:'wn'};
 const out=buildForecast(input),{hour}=currentRows(out,input.now);
 assert.deepEqual(hour.temperatureBlend.sources.map(row=>[row.id,row.weight]),[['nws',.36],['hrrr',.27],['ecmwf',.09],['nbm',.18],['wn',.1]]);
 assert.match(hour.temperatureSource,/Google WeatherNext 10%/);assert.equal(out.current.temperatureSource,hour.temperatureSource);
 assert.equal(out.google.label,'Google WeatherNext');
 for(const text of [out.google.message,out.methodology,out.metricForecasts.notes.dewpoint,out.metricForecasts.notes.wind])assert.doesNotMatch(text,/NVIDIA/);
});

test('omitted feels sky uses only matching canonical cloud evidence and preserves a real zero',()=>{
 const time=new Date(testInputs.now).toISOString(),sources=[{id:'nws',value:0,weight:1}];
 const out={current:{type:'guidance',skyCover:90},metricForecasts:{series:{temperature:[{time,value:46}],feels:[{time,inputs:{temperature:46}}],cloud:[{time,value:0,source:'NWS 100%',sources}]}}};
 alignGuidanceCurrentWithHourly(out,testInputs.now+45*60000);
 assert.equal(out.current.skyCover,0);assert.equal(out.current.skySource,'NWS 100%');assert.deepEqual(out.current.skySources,sources);
 assert.deepEqual(out.current.fieldSources.skyCover,{source:'NWS 100%',time,sources});
 out.metricForecasts.series.cloud[0].time=new Date(testInputs.now+H).toISOString();
 alignGuidanceCurrentWithHourly(out,testInputs.now+45*60000);
 assert.equal(out.current.skyCover,null);assert.equal(out.current.skySource,null);assert.deepEqual(out.current.skySources,[]);
});

test('explicit missing canonical feels sky cannot be replaced by a separate cloud sample',()=>{
 const time=new Date(testInputs.now).toISOString(),out={current:{type:'guidance',skyCover:90},metricForecasts:{series:{temperature:[{time,value:46}],feels:[{time,inputs:{temperature:46,skyCover:null}}],cloud:[{time,value:0,source:'NWS 100%'}]}}};
 alignGuidanceCurrentWithHourly(out,testInputs.now+45*60000);
 assert.equal(out.current.skyCover,null);assert.equal(out.current.skySource,null);
});
