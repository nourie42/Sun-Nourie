import test from 'node:test';
import assert from 'node:assert/strict';
import {addSnowOutlook,gridSnowHours,normalizeSnowModels} from '../src/weatherFusionSnow.js';
const z='America/Denver',now=Date.parse('2026-10-14T06:00:00Z');
test('snow outlook converts units, keeps missing data null, and flags far-out days',()=>{
 const out={location:{timeZone:z},days:['2026-10-14','2026-10-15','2026-10-16','2026-10-17'].map((date,i)=>({date,label:['Wed','Thu','Fri','Sat'][i]})),hours:[{time:'2026-10-14T12:00:00Z'}],riskOutlooks:[]};
 addSnowOutlook(out,{grid:{snowfallAmount:{uom:'wmoUnit:mm',values:[{validTime:'2026-10-14T12:00:00+00:00/PT6H',value:60.96}]}},
  periods:[{name:'Wednesday',startTime:'2026-10-14T06:00:00-06:00',shortForecast:'Snow',detailedForecast:'',probabilityOfPrecipitation:{value:90}},{name:'Saturday',startTime:'2026-10-17T06:00:00-06:00',shortForecast:'Chance Snow Showers',detailedForecast:''}],
  snowModels:normalizeSnowModels({daily:{time:['2026-10-14','2026-10-17'],snowfall_sum_ecmwf_ifs025:[3.048,null],snowfall_sum_gfs_seamless:[9.906,2.54]}}),wpcWinter:[],now});
 const [wed,thu,fri,sat]=out.snow.days;
 assert.equal(out.snow.possible,true);
 assert.equal(wed.nwsSnowfall,2.4); assert.deepEqual(wed.models,{ecmwf:1.2,gfs:3.9}); assert.deepEqual(wed.range,[1.2,3.9]);
 assert.equal(fri.nwsSnowfall,null); assert.equal(fri.models.ecmwf,null);
 assert.equal(sat.models.ecmwf,null); assert.equal(sat.confidence,'Low chance, far out');
 assert.equal(out.hours[0].snowfall,0.4);
});
test('warm locations get no snow outlook',()=>{
 const out={location:{timeZone:z},days:[{date:'2026-10-14',label:'Wed'}],hours:[],riskOutlooks:[]};
 addSnowOutlook(out,{grid:{snowfallAmount:{values:[]}},periods:[{name:'Wed',startTime:'2026-10-14T06:00:00-06:00',shortForecast:'Sunny',detailedForecast:'Sunny'}],snowModels:{time:['2026-10-14'],ecmwf:[0],gfs:[0]},wpcWinter:[],now});
 assert.equal(out.snow.possible,false);
});
test('grid snowfall without interval data is not invented',()=>{ assert.equal(gridSnowHours({}),null); });

test('NWS simple daily amount excludes elapsed hours and keeps incomplete coverage unknown',()=>{
 const remaining=Date.parse('2026-10-14T12:00:00Z');
 const output=()=>({location:{timeZone:'UTC'},days:[{date:'2026-10-14',label:'Wed'}],hours:[],riskOutlooks:[]});
 const full=output();addSnowOutlook(full,{now:remaining,grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-14T00:00:00Z/PT24H',value:1}]}}});
 const r=full.snow.days[0];assert.equal(r.nwsSnowfall,1);assert.equal(r.displaySnowfall.value,.5);assert.equal(r.displaySnowfall.source,'NWS point forecast');assert.equal(r.displaySnowfall.remainingDay,true);assert.equal(r.displaySnowfall.start,'2026-10-14T12:00:00.000Z');assert.equal(r.displaySnowfall.expectedHours,12);
 const elapsed=output();addSnowOutlook(elapsed,{now:remaining,grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-14T00:00:00Z/PT6H',value:1}]}}});
 assert.equal(elapsed.snow.days[0].displaySnowfall.value,null);assert.equal(elapsed.snow.days[0].snowExpected,false);assert.equal(elapsed.snow.possible,false);
 const zero=output();addSnowOutlook(zero,{now:remaining,grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-14T12:00:00Z/PT12H',value:0}]}}});
 assert.equal(zero.snow.days[0].displaySnowfall.value,0);assert.equal(zero.snow.days[0].displaySnowfall.status,'ready');
});

test('snow event timing clips overnight NWS periods and rejects rain-only hours from coarse snowfall intervals',()=>{
 const output={location:{timeZone:'UTC'},days:[{date:'2026-10-14',label:'Wed'},{date:'2026-10-15',label:'Thu'}],hours:[{time:'2026-10-14T23:00:00Z',condition:'Rain'},{time:'2026-10-15T00:00:00Z',condition:'Snow'},{time:'2026-10-15T01:00:00Z',condition:'Snow'}],riskOutlooks:[]};
 addSnowOutlook(output,{now:Date.parse('2026-10-14T12:00:00Z'),grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-14T23:00:00Z/PT3H',value:3}]}},periods:[{name:'Wednesday Night',startTime:'2026-10-14T23:00:00Z',endTime:'2026-10-15T06:00:00Z',shortForecast:'Snow',detailedForecast:'Snow overnight.'}]});
 assert.equal(output.snow.days[1].snowExpected,true);assert.equal(output.snow.days[1].periods[0].name,'Wednesday Night');
 assert.deepEqual(output.snow.days[1].snowEventWindows,[{start:'2026-10-15T00:00:00.000Z',end:'2026-10-15T02:00:00.000Z',source:'NWS snow hours'}]);
 assert.equal(output.snow.days[0].snowEventWindows[0].source,'NWS snow forecast period');
});
