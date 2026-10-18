import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';

const now=Date.parse('2026-10-17T17:30:00Z');
function fixture(){
 const dates=['2026-10-17','2026-10-18','2026-10-19'];
 return {location:{timeZone:'America/New_York'},hours:[],rainTimeline:[],
  days:dates.map(date=>({date,condition:'Snow',high:30,low:20})),
  snow:{days:dates.map((date,index)=>({date,nwsCovered:true,nwsSnowfall:9,
   displaySnowfall:{value:index+1,source:'NWS point forecast',status:'ready'},
   models:{ecmwf:index+2,gfs:index+3},nearTermModels:{hrrr:index<2?index+4:null,nam:index<2?index+5:null}}))}};
}

test('snow comparison includes verified HRRR and NAM amounts alongside ECMWF and GFS',()=>{
 const f=fixture(),before=structuredClone(f),built=buildSeries(f,null,'snow',now);
 assert.deepEqual(built.modelMaps[0],{nws:1,hrrr:4,nam:5,ecmwf:2,gfs:3});
 assert.deepEqual(built.modelMaps[1],{nws:2,hrrr:5,nam:6,ecmwf:3,gfs:4});
 assert.deepEqual(built.forecastValues,[1,2,3]);
 assert.deepEqual(f,before);
});

test('short-range snow models stop at missing coverage and published zero forecasts remain zero',()=>{
 const f=fixture();f.snow.days[0].nearTermModels={hrrr:0,nam:0};
 const built=buildSeries(f,null,'snow',now);
 assert.equal(built.modelMaps[0].hrrr,0);assert.equal(built.modelMaps[0].nam,0);
 assert.ok(!Object.hasOwn(built.modelMaps[2],'hrrr'));
 assert.ok(!Object.hasOwn(built.modelMaps[2],'nam'));
 assert.ok(!Object.hasOwn(built.modelMaps[0],'wn'),'WeatherNext precipitation is not snowfall depth');
});

test('NWS snow comparison uses the matching remaining-day amount and excludes incomplete diagnostics',()=>{
 const f=fixture();f.snow.days[1].nwsCovered=false;
 const built=buildSeries(f,null,'snow',now);
 assert.equal(built.modelMaps[0].nws,1,'historical full-day diagnostic 9 is not the remaining-day amount');
 assert.ok(!Object.hasOwn(built.modelMaps[1],'nws'));
 f.snow.days[0].displaySnowfall={value:2,source:'Available model guidance'};
 assert.ok(!Object.hasOwn(buildSeries(f,null,'snow',now).modelMaps[0],'nws'));
});
