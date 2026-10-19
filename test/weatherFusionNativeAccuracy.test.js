import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';

const validate=raw=>validateSnapshot(raw,'hrrr',testInputs.location,testInputs.now).value;
const optional={dew_point_2m:['°F',42],relative_humidity_2m:['%',50],wind_gusts_10m:['mp/h',15],wind_direction_10m:['°',270],cloud_cover:['%',0],visibility:['mi',10],pressure_msl:['inHg',30],reflectivity:['dBZ',-10],nearby_reflectivity:['dBZ',35]};
function native(){
 const raw=snapshot('hrrr'),point=raw.points[0];
 for(const [field,[unit,value]] of Object.entries(optional)){
  point.hourly[field]=point.hourly.time.map(()=>value);point.hourly_units[field]=unit;
 }
 return raw;
}

test('native snapshots reject impossible core wind, rain and temperature measurements',()=>{
 for(const [field,value] of [['wind_speed_10m',-1],['wind_speed_10m',301],['precipitation',-1],['temperature_2m',500]]){
  const raw=native();raw.points[0].hourly[field][1]=value;
  assert.throws(()=>validate(raw),/Invalid model range/);
 }
});

test('conflicting native optional units remain missing without losing healthy core guidance',()=>{
 const raw=native();raw.points[0].hourly_units.pressure_msl='hPa';raw.points[0].hourly.pressure_msl.fill(1013);
 raw.points[0].hourly_units.visibility='m';raw.points[0].hourly.visibility.fill(16000);
 raw.points[0].hourly_units.dew_point_2m='°C';
 const out=validate(raw);
 for(const field of ['pressure_msl','visibility','dew_point_2m'])assert.ok(out.hourly[field].every(value=>value===null),field);
 assert.deepEqual(out.hourly.temperature_2m,raw.points[0].hourly.temperature_2m);
 assert.deepEqual(out.precipitationIntervals,raw.points[0].precipitationIntervals);
 assert.equal(raw.points[0].hourly.pressure_msl[0],1013,'validation must not mutate the cached source');
});

test('invalid optional native samples become gaps while valid samples retain their values',()=>{
 const raw=native();
 for(const [field,value] of [['relative_humidity_2m',101],['cloud_cover',-1],['wind_gusts_10m',-1],['wind_direction_10m',361],['visibility',-1],['pressure_msl',1013],['reflectivity',-9999]])raw.points[0].hourly[field][1]=value;
 const out=validate(raw);
 for(const [field,[,value]] of Object.entries(optional)){
  assert.equal(out.hourly[field][0],value,field);
  if(field!=='dew_point_2m'&&field!=='nearby_reflectivity')assert.equal(out.hourly[field][1],null,field);
 }
});

test('a malformed optional native series cannot discard unrelated healthy measurements',()=>{
 const raw=native();raw.points[0].hourly.visibility=[10];raw.points[0].hourly.cloud_cover[1]='unknown';
 const out=validate(raw);
 assert.ok(out.hourly.visibility.every(value=>value===null));
 assert.equal(out.hourly.cloud_cover[1],null);
 assert.equal(out.hourly.cloud_cover[0],0,'real zero cloud cover remains zero');
 assert.equal(out.hourly.wind_speed_10m[0],8);
});

test('valid native collector units and measurements pass through unchanged',()=>{
 const raw=native(),out=validate(raw);
 assert.deepEqual(out.hourly,raw.points[0].hourly);
 assert.deepEqual(out.hourly_units,raw.points[0].hourly_units);
});
