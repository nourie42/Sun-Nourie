import test from 'node:test';
import assert from 'node:assert/strict';
import {nwsSnowPhaseWindows} from '../src/weatherFusionNwsSnowTiming.js';
import {addSnowOutlook} from '../src/weatherFusionSnow.js';
import {winterSnowDays,winterSnowMapForDay} from '../public/weather-fusion/snow-outlook.js';
const zone='America/New_York';
const night={name:'Friday Night',startTime:'2026-10-16T18:00:00-04:00',endTime:'2026-10-17T06:00:00-04:00',shortForecast:'Rain Showers then Chance Rain And Snow Showers',detailedForecast:'Rain showers before 2am, then a chance of rain and snow showers. Mostly cloudy, with a low around 27.'};
const saturday={name:'Saturday',startTime:'2026-10-17T06:00:00-04:00',endTime:'2026-10-17T18:00:00-04:00',shortForecast:'Chance Snow Showers',detailedForecast:'A chance of snow showers before 8am, then a slight chance of rain and snow showers between 8am and 2pm. Mostly sunny.'};
const stamps=result=>result.windows.map(w=>({start:new Date(w.start).toISOString(),end:new Date(w.end).toISOString()}));
test('actual Cortland rain-before-2am clause puts snow only on Saturday and preserves the mixed phase',()=>{
 assert.deepEqual(stamps(nwsSnowPhaseWindows(night,zone)),[{start:'2026-10-17T06:00:00.000Z',end:'2026-10-17T10:00:00.000Z'}]);
 assert.deepEqual(stamps(nwsSnowPhaseWindows(saturday,zone)),[{start:'2026-10-17T10:00:00.000Z',end:'2026-10-17T18:00:00.000Z'}]);
 const out={location:{timeZone:zone},days:[{date:'2026-10-16',label:'Fri'},{date:'2026-10-17',label:'Sat'}],hours:[],riskOutlooks:[]};
 addSnowOutlook(out,{now:Date.parse('2026-10-14T12:00:00Z'),periods:[night,saturday],grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-16T00:00:00Z/PT72H',value:0}]}},wpcWinter:{amounts:[],probabilities:[],maps:[{id:'friday-evening',kind:'geojson',quantity:'snowfall',start:'2026-10-16T00:00:00Z',end:'2026-10-17T00:00:00Z'}]}});
 assert.equal(out.snow.days[0].snowExpected,false);assert.equal(out.snow.days[0].periods[0].snowWording,false);
 assert.deepEqual(winterSnowDays(out.snow).map(r=>r.date),['2026-10-17']);
 assert.deepEqual(out.snow.days[1].snowEventWindows,[{start:'2026-10-17T06:00:00.000Z',end:'2026-10-17T18:00:00.000Z',source:'NWS timed snow forecast'}]);
 assert.equal(winterSnowMapForDay(out.snow,out.snow.days[1]),null);
});
test('clock clauses preserve overnight dates, midnight endpoints and separated snow phases',()=>{
 const parse=text=>nwsSnowPhaseWindows({...night,detailedForecast:text},zone);
 assert.deepEqual(stamps(parse('Snow showers between 10pm and 2am.')),[{start:'2026-10-17T02:00:00.000Z',end:'2026-10-17T06:00:00.000Z'}]);
 assert.deepEqual(stamps(parse('Snow before midnight, then rain.')),[{start:'2026-10-16T22:00:00.000Z',end:'2026-10-17T04:00:00.000Z'}]);
 assert.deepEqual(stamps(parse('Snow until 12am, then rain between 12am and 2am, then snow after 3am.')),[{start:'2026-10-16T22:00:00.000Z',end:'2026-10-17T04:00:00.000Z'},{start:'2026-10-17T07:00:00.000Z',end:'2026-10-17T10:00:00.000Z'}]);
 assert.deepEqual(stamps(nwsSnowPhaseWindows({...saturday,detailedForecast:'Snow after noon.'},zone)),[{start:'2026-10-17T16:00:00.000Z',end:'2026-10-17T22:00:00.000Z'}]);
 const unparsed=parse('Snow showers sometime overnight.');assert.equal(unparsed.timed,false);assert.deepEqual(stamps(unparsed),[{start:'2026-10-16T22:00:00.000Z',end:'2026-10-17T10:00:00.000Z'}]);
});
test('NWS clocks use the forecast date timezone and fall back conservatively at DST gaps',()=>{
 const spring={startTime:'2026-03-07T18:00:00-05:00',endTime:'2026-03-08T06:00:00-04:00',shortForecast:'Rain then Snow',detailedForecast:'Rain before 2am, then snow.'};
 const gap=nwsSnowPhaseWindows(spring,zone);assert.equal(gap.timed,false);assert.deepEqual(stamps(gap),[{start:'2026-03-07T23:00:00.000Z',end:'2026-03-08T10:00:00.000Z'}]);
 const fall={startTime:'2026-10-31T18:00:00-04:00',endTime:'2026-11-01T06:00:00-05:00',shortForecast:'Rain then Snow',detailedForecast:'Rain before 1am, then snow.'};
 assert.deepEqual(stamps(nwsSnowPhaseWindows(fall,zone)),[{start:'2026-11-01T05:00:00.000Z',end:'2026-11-01T11:00:00.000Z'}]);
 assert.deepEqual(stamps(nwsSnowPhaseWindows({...night,startTime:'2026-01-16T18:00:00-05:00',endTime:'2026-01-17T06:00:00-05:00'},zone)),[{start:'2026-01-17T07:00:00.000Z',end:'2026-01-17T11:00:00.000Z'}]);
});

test('positive coarse snowfall total belongs to the actual snow day and does not activate earlier cloudy hours',()=>{
 const start=Date.parse('2026-10-16T22:00:00Z'),hour=3600000;
 const out={location:{timeZone:zone},days:[{date:'2026-10-16',label:'Fri'},{date:'2026-10-17',label:'Sat'}],hours:Array.from({length:12},(_,i)=>({time:new Date(start+i*hour).toISOString(),condition:i<7?'Rain':i===7?'Cloudy':'Snow',temperature:i<7?51:i===7?32:28})),riskOutlooks:[]};
 addSnowOutlook(out,{now:Date.parse('2026-10-14T12:00:00Z'),periods:[night],grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-16T22:00:00Z/PT12H',value:1.2}]}}});
 const [fri,sat]=out.snow.days;
 assert.equal(fri.snowExpected,false);assert.deepEqual(fri.snowEventWindows,[]);
 assert.deepEqual(winterSnowDays(out.snow).map(r=>r.date),['2026-10-17']);
 assert.equal(sat.snowExpected,true);assert.equal(sat.displaySnowfall.value,1.2);assert.deepEqual(sat.displaySnowfall.range,[1.2,null]);
 assert.deepEqual(sat.snowEventWindows,[{start:'2026-10-17T06:00:00.000Z',end:'2026-10-17T10:00:00.000Z',source:'NWS snow hours'}]);
 assert.equal(out.hours[7].snowfall,0);assert.equal(out.hours[7].snowfallRaw,.1);assert.equal(out.hours[8].snowfall,null);
 assert.equal(sat.nwsRawIntervals[0].value,1.2); // Preserve the source's total.
 // With complete daily source coverage the exact same 1.2 belongs to Saturday.
 const complete={location:{timeZone:zone},days:out.days.map(({date,label})=>({date,label})),hours:[],riskOutlooks:[]};
 addSnowOutlook(complete,{now:Date.parse('2026-10-14T12:00:00Z'),periods:[night],grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-16T04:00:00Z/PT18H',value:0},{validTime:'2026-10-16T22:00:00Z/PT12H',value:1.2},{validTime:'2026-10-17T10:00:00Z/PT18H',value:0}]}}});
 assert.equal(complete.snow.days[0].displaySnowfall.value,0);assert.equal(complete.snow.days[1].displaySnowfall.value,1.2);assert.equal(complete.snow.days[1].displaySnowfall.status,'ready');
});

test('a coarse positive interval with snow on both local dates keeps its daily split unknown',()=>{
 const split={...night,detailedForecast:'Rain before 11pm, then snow.'};
 const out={location:{timeZone:zone},days:[{date:'2026-10-16',label:'Fri'},{date:'2026-10-17',label:'Sat'}],hours:[],riskOutlooks:[]};
 addSnowOutlook(out,{now:Date.parse('2026-10-14T12:00:00Z'),periods:[split],grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-16T22:00:00Z/PT12H',value:1.2}]}}});
 for(const day of out.snow.days){assert.equal(day.snowExpected,true);assert.equal(day.nwsAmountUncertain,true);assert.equal(day.displaySnowfall.value,null);assert.equal(day.nwsRawIntervals[0].value,1.2);}
});

test('an unknown NWS daily split can still show an explicitly labeled same-day model estimate',()=>{
 const split={...night,detailedForecast:'Rain before 11pm, then snow.'};
 const start=Date.parse('2026-10-16T04:00:00Z'),end=Date.parse('2026-10-17T04:00:00Z');
 const out={location:{timeZone:zone},days:[{date:'2026-10-16',label:'Fri'},{date:'2026-10-17',label:'Sat'}],hours:[],riskOutlooks:[]};
 addSnowOutlook(out,{now:Date.parse('2026-10-14T12:00:00Z'),periods:[split],grid:{snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-16T22:00:00Z/PT12H',value:1.2}]}},winterModels:{ecmwf:{intervals:[{start,end,value:.4}]},gfs:{intervals:[{start,end,value:.4}]}}});
 const friday=out.snow.days[0];
 assert.equal(friday.nwsAmountUncertain,true);assert.equal(friday.nwsRawIntervals[0].value,1.2);
 assert.equal(friday.displaySnowfall.value,.4);assert.equal(friday.displaySnowfall.source,'Available model guidance');assert.equal(friday.displaySnowfall.status,'partial');
 assert.equal(out.snow.days[1].displaySnowfall.value,null,'a day without model coverage remains unknown');
});

test('a 24-hour source interval is constrained by the fully covered union of rain and timed snow periods',()=>{
 const friday={name:'Friday',startTime:'2026-10-16T06:00:00-04:00',endTime:'2026-10-16T18:00:00-04:00',shortForecast:'Rain Showers',detailedForecast:'Rain showers.'};
 const output=()=>({location:{timeZone:zone},days:[{date:'2026-10-16',label:'Fri'},{date:'2026-10-17',label:'Sat'}],hours:[{time:'2026-10-16T17:00:00Z',condition:'Cloudy',temperature:32}],riskOutlooks:[]});
 const grid={snowfallAmount:{uom:'wmoUnit:in',values:[{validTime:'2026-10-16T16:00:00Z/PT24H',value:1.2}]}};
 const out=output();addSnowOutlook(out,{now:Date.parse('2026-10-14T12:00:00Z'),periods:[friday,night,saturday],grid});
 assert.equal(out.snow.days[0].snowExpected,false);assert.equal(out.hours[0].snowfall,0);
 assert.deepEqual(winterSnowDays(out.snow).map(r=>r.date),['2026-10-17']);
 assert.equal(out.snow.days[1].displaySnowfall.value,1.2);assert.equal(out.snow.days[1].nwsRawIntervals[0].value,1.2);
 const partial=output();addSnowOutlook(partial,{now:Date.parse('2026-10-14T12:00:00Z'),periods:[night,saturday],grid});
 assert.equal(partial.snow.days[0].displaySnowfall.value,null);assert.equal(partial.snow.days[1].displaySnowfall.value,null);
 assert.equal(partial.snow.days[0].nwsAmountUncertain,true);assert.equal(partial.snow.days[1].nwsAmountUncertain,true);
});
