import {buildForecast} from '../src/weatherFusion.js';
import {testInputs,snapshot} from '../test/weatherFusion.fixtures.js';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
export function fixture(location='knightdale',time=Date.parse('2026-09-05T19:00:00Z')) {
 const input=structuredClone(testInputs);input.now=time;
 input.location=location==='knightdale'?input.location:{id:'greenville',name:'Greenville, NC',latitude:35.6127,longitude:-77.3664};
 input.point.cwa=location==='knightdale'?'RAH':'MHX';input.discussion.office=input.point.cwa;
 input.observation={...input.observation,temperature:79,humidity:84,dewpoint:73,wind:5,time:new Date(time).toISOString()};
 for(const [field,uom,value] of [['visibility','wmoUnit:m',16093.44],['relativeHumidity','wmoUnit:percent',84],['windGust','wmoUnit:km_h-1',20]])input.grid[field]={uom,values:[{validTime:'2026-09-05T12:00:00Z/P8D',value}]};
 input.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{const s=snapshot(id);s.points[0].latitude=input.location.latitude;s.points[0].longitude=input.location.longitude;const m=validateSnapshot(s,id,input.location,time).value;if(id==='ecmwf'){m.hourly.pressure_msl=m.hourly.time.map((_,i)=>29.95+Math.sin(i/8)*.1);m.hourly_units.pressure_msl='inHg';}return [id,m];}));
 return {...buildForecast(input),aiConfigured:false,directModelStatus:'ready'};
}
