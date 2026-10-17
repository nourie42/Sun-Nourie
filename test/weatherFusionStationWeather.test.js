import test from 'node:test';
import assert from 'node:assert/strict';
import {stationWeather,weatherState} from '../public/weather-fusion/weather-state.js';
import {comfortSceneState} from '../public/weather-fusion/exposure-scene.js';

const timestamp='2026-10-17T09:15:00+00:00';
const cloudy={timestamp,textDescription:'Cloudy',cloudLayers:[{amount:'OVC'}]};
const metar=weather=>`METAR KRDU 170915Z AUTO 01013KT 6SM ${weather} OVC008 14/13 A2998`;

test('current structured rain takes precedence over a generic cloudy station description',()=>{
 const observation={...cloudy,presentWeather:[{weather:'rain',intensity:'light',inVicinity:false}]};
 const result=stationWeather(observation);
 assert.deepEqual(result,{condition:'Light Rain',conditionSource:'Station present-weather report',conditionTime:timestamp});
 assert.equal(weatherState(result.condition).kind,'rain');
 const night=comfortSceneState(false,result.condition,44,{now:true,pop:0});
 assert.equal(night.key,'rain','a current rain report opens umbrellas even without a forecast chance');
 assert.match(night.asset,/^comfort-night-/,'a rain report before sunrise keeps actual night artwork');
 assert.deepEqual(observation.presentWeather,[{weather:'rain',intensity:'light',inVicinity:false}]);
});

test('structured freezing rain, showers and mixed precipitation retain the reported phases',()=>{
 const cases=[
  [{weather:'rain',modifier:'freezing',intensity:'light'},'Light Freezing rain'],
  [{weather:'drizzle',modifier:'freezing'},'Freezing drizzle'],
  [{weather:'rain',modifier:'showers',intensity:'heavy'},'Heavy Rain showers'],
  [{weather:'snow',intensity:'light'},'Light Snow'],
  [{weather:'ice_pellets'},'Sleet'],
  [{weather:'rain',modifier:'thunderstorm'},'Thunderstorms with rain']
 ];
 for(const [report,expected] of cases)assert.equal(stationWeather({...cloudy,presentWeather:[report]}).condition,expected);
 assert.equal(stationWeather({...cloudy,presentWeather:[{weather:'rain'},{weather:'snow'},{weather:'mist'}]}).condition,'Rain and Snow');
});

test('structured raw weather codes supply missing decoded fields',()=>{
 for(const [rawString,expected] of [['-RA','Light Rain'],['+TSRA','Heavy Thunderstorms with rain'],['-RASN','Light Rain and Snow']]){
  const result=stationWeather({...cloudy,presentWeather:[{rawString,inVicinity:false}]});
  assert.equal(result.condition,expected);
  assert.equal(result.conditionSource,'Station present-weather report');
 }
});

test('ongoing METAR rain overrides cloudy text without requiring decoded presentWeather',()=>{
 const result=stationWeather({...cloudy,rawMessage:metar('-RA BR')});
 assert.deepEqual(result,{condition:'Light Rain',conditionSource:'Station METAR weather report',conditionTime:timestamp});
 assert.equal(stationWeather({...cloudy,rawMessage:metar('+SHRA')}).condition,'Heavy Rain showers');
 assert.equal(stationWeather({...cloudy,rawMessage:metar('-FZRA')}).condition,'Light Freezing rain');
});

test('vicinity precipitation does not become an active station rain report',()=>{
 for(const presentWeather of [
  [{weather:'rain',inVicinity:true}],
  [{weather:'rain',rawString:'VCRA'}],
  [{weather:'rain',rawString:'VCSH'}],
  [{weather:'rain',rawString:'-VCRA'}]
 ])assert.equal(stationWeather({...cloudy,presentWeather}).condition,'Cloudy');
 for(const group of ['VCSH','VCRA','VCTS','VCTSRA'])assert.equal(stationWeather({...cloudy,rawMessage:metar(group)}).condition,'Cloudy');
});

test('recent weather, remarks and trend forecasts cannot report rain now',()=>{
 for(const weather of [
  'RERA', 'RESN', 'RETSRA', '-RERA',
  'RMK -RA', 'RMK RAB12E15', 'RMK RA',
  'TEMPO 3000 RA', 'BECMG -RA', 'NOSIG RMK RA', 'PROB30 RA', 'FM171000 RA',
  '= METAR KJNX 170915Z -RA'
 ])assert.equal(stationWeather({...cloudy,rawMessage:metar(weather)}).condition,'Cloudy',weather);
 for(const rawString of ['RERA','RESN','RMK RA','TEMPO RA']){
  assert.equal(stationWeather({...cloudy,presentWeather:[{weather:'rain',rawString}]}).condition,'Cloudy',rawString);
 }
 assert.equal(stationWeather({...cloudy,rawMessage:metar('-RA RMK RAE15')}).condition,'Light Rain','ongoing main-body rain is retained');
});

test('blowing and drifting particles do not invent falling precipitation',()=>{
 for(const rawMessage of [metar('BLSN'),metar('DRSN')])assert.equal(stationWeather({...cloudy,rawMessage}).condition,'Cloudy');
 for(const modifier of ['blowing','drifting'])assert.equal(stationWeather({...cloudy,presentWeather:[{weather:'snow',modifier}]}).condition,'Cloudy');
});

test('known current precipitation and existing dry/cloud-layer fallbacks are preserved',()=>{
 assert.equal(stationWeather({...cloudy,textDescription:'Light Rain and Fog',presentWeather:[{weather:'rain'}]}).condition,'Light Rain and Fog');
 assert.equal(stationWeather({...cloudy,textDescription:'Fair',rawMessage:metar('10SM'),presentWeather:[]}).condition,'Fair');
 assert.equal(stationWeather({timestamp,textDescription:'',cloudLayers:[{amount:'FEW'},{amount:'OVC'}]}).condition,'Overcast');
 assert.deepEqual(stationWeather({timestamp,textDescription:'',cloudLayers:[]}),{condition:'',conditionSource:'Station sky unavailable',conditionTime:timestamp});
 assert.equal(stationWeather({...cloudy,presentWeather:'rain'}).condition,'Cloudy','malformed structured data does not invent precipitation');
 assert.equal(stationWeather({...cloudy,rawMessage:metar('KRAI OVC008 14/13')}).condition,'Cloudy','only complete weather groups are parsed');
});
