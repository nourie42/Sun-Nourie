import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherState,stationWeather,resolveCurrentWeather,weatherTransmission} from '../public/weather-fusion/weather-state.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {weatherShapes,weatherIcon,forecastSample,hourlyDisplaySamples,peakComparison,peakComparisonHTML,renderHourlyWeather} from '../public/weather-fusion/weather-display.js';
const now=Date.parse('2026-09-06T15:14:00Z'),H=3600000,location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
const readings={type:'observation',temperature:79,dewpoint:72,wind:4,condition:'Sunny',time:'2026-09-06T14:35:00Z'};
for(const [condition,kind] of [['Fair','clear'],['Fair and Breezy','clear'],['Sunny','clear'],['Mostly Sunny','clear'],['A Few Clouds','clear'],['Partly Cloudy','partly-cloudy'],['Mostly Cloudy','cloudy'],['Overcast','cloudy'],['Cloudy','cloudy'],['Light Rain','rain'],['Chance Showers','rain'],['Thunderstorms','storm'],['Snow','snow'],['Fog','fog'],['','unknown']]){
 test(`one consistent sky classification: ${condition||'missing'}`,()=>{
  assert.equal(weatherState(condition).kind,kind);assert.ok(weatherIcon(condition).includes(`data-weather-kind="${kind}"`));
  assert.ok(!weatherIcon(condition).includes('M12 29h25'),'The missing icon must not be rendered as a dash.');
 });
}
test('blank observation uses actual cloud layers; known precipitation takes precedence',()=>{
 assert.equal(stationWeather({textDescription:'',cloudLayers:[{amount:'FEW'},{amount:'OVC'}]}).condition,'Overcast');
 assert.equal(stationWeather({textDescription:'Rain',cloudLayers:[{amount:'FEW'}]}).condition,'Rain');assert.equal(stationWeather({textDescription:'',cloudLayers:[]}).condition,'');
});
test('missing station sky uses matching forecast only, retaining observed measurements',()=>{
 const input={...readings,condition:''},hours=[{time:'2026-09-06T15:00:00Z',condition:'Partly Cloudy'},{time:'2026-09-06T16:00:00Z',condition:'Rain'}];
 const resolved=resolveCurrentWeather(input,hours,now);assert.equal(resolved.condition,'Partly Cloudy');assert.match(resolved.conditionSource,/forecast \(sky only\)/);
 for(const key of ['temperature','dewpoint','wind','time'])assert.equal(resolved[key],input[key]);
 assert.equal(resolveCurrentWeather(input,hours,now+3*H).weather.kind,'unknown');assert.equal(resolveCurrentWeather(input,[],now,99).condition,'Cloudy');
});
test('valid station condition is never replaced by a conflicting forecast',()=>{
 const value=resolveCurrentWeather({...readings,condition:'Overcast'},[{time:'2026-09-06T15:00:00Z',condition:'Sunny'}],now);assert.equal(value.condition,'Overcast');assert.equal(value.weather.kind,'cloudy');
});
for(const condition of ['Overcast','Cloudy','Rain','Thunderstorms','Fog','Snow'])test(`outdoor ${condition} retains radiation without claiming direct sun`,()=>{
 const comfort=thermalComfort({...readings,condition},location,now);assert.equal(comfort.sun,null);assert.equal(comfort.outdoors,comfort.shade);assert.ok(Number.isFinite(comfort.outdoors));
 assert.equal(comfort.radiation.directNormal,0);assert.ok(comfort.radiation.diffuseHorizontal>0);assert.ok(!weatherShapes(condition).includes('sky-sun'));
});
test('clear and partly cloudy calculations and pictures use matching weather',()=>{
 const clear=thermalComfort(readings,location,now),partial=thermalComfort({...readings,condition:'Partly Cloudy'},location,now);
 assert.ok(clear.outdoors>=partial.outdoors);assert.ok(partial.outdoors>=partial.shade);assert.ok(partial.absorbedRadiation<clear.absorbedRadiation);
 assert.match(weatherShapes('Partly Cloudy'),/sky-sun/);assert.match(weatherShapes('Partly Cloudy'),/sky-cloud/);
});
test('night uses a numeric outdoor value and moon or clouds',()=>{
 const comfort=thermalComfort(readings,location,Date.parse('2026-09-07T03:00:00Z'));assert.equal(comfort.daylight,false);assert.equal(comfort.sun,null);assert.equal(comfort.outdoors,comfort.shade);
 assert.match(weatherShapes('Clear',false),/sky-moon/);assert.ok(!weatherShapes('Clear',false).includes('sky-sun'));
});
test('unknown sky does not invent a solar effect',()=>{
 const comfort=thermalComfort({...readings,condition:''},location,now);assert.equal(comfort.weatherKind,'unknown');assert.equal(comfort.sun,null);assert.equal(comfort.outdoors,comfort.shade);assert.equal(weatherTransmission(''),null);
});
test('missing moisture/wind remains unavailable',()=>{
 for(const patch of [{wind:null},{dewpoint:null,humidity:null},{temperature:null}]){const comfort=thermalComfort({...readings,...patch},location,now);assert.equal(comfort.outdoors,null);assert.equal(comfort.shade,null);}
});
function fixture(){
 const current={...readings},times=[15,16,17].map(hour=>`2026-09-06T${hour}:00:00Z`),values=[79,80,82];
 const feels=values.map((temperature,index)=>{const inputs={temperature,dewpoint:68+index,wind:6,condition:index===2?'Rain':'Sunny'};return {time:times[index],inputs,value:thermalComfort(inputs,location,Date.parse(times[index])).outdoors};});
 return {location,assembledAt:new Date(now).toISOString(),current,comfort:thermalComfort(current,location,now),hours:times.map((time,index)=>({time,temperature:values[index],condition:index===2?'Rain':'Sunny',pop:20})),metricForecasts:{series:{temperature:times.map((time,index)=>({time,value:values[index]})),feels}}};
}
test('Now equals the hero and excludes older forecast hours',()=>{
 const f=fixture(),samples=hourlyDisplaySamples(f,now);assert.equal(samples[0].id,'now');assert.equal(samples[0].temperature,f.current.temperature);assert.equal(samples[0].feels,f.comfort.outdoors);
 assert.equal(samples[1].time,'2026-09-06T16:00:00Z');assert.equal(samples.length,3);assert.equal(samples.filter(p=>!p.now&&Date.parse(p.time)<=now).length,0);
});
test('future preview reads the canonical pair at the selected instant',()=>{
 const f=fixture(),p=forecastSample(f,'2026-09-06T13:00:00-04:00');assert.equal(p.temperature,82);assert.equal(p.feels,f.metricForecasts.series.feels[2].value);assert.equal(p.condition,'Rain');assert.equal(p.comfort.outdoors,p.feels);assert.equal(p.comfort.weatherKind,'rain');assert.ok(!p.now);assert.equal(forecastSample(f,'2026-09-06T18:00:00Z'),null);
});
test('the highest from now includes current but never changes the future forecast',()=>{
 for(const [peak,kind] of [[85,'now'],[83,'now'],[89,'forecast']]){const summary={mode:'day',label:'Forecast feels-like peak ahead',chosen:{time:'2026-09-06T17:00:00Z',value:peak}};const comparison=peakComparison(summary,85);assert.equal(comparison.kind,kind);assert.equal(comparison.value,Math.max(peak,85));assert.equal(summary.chosen.value,peak);assert.match(peakComparisonHTML(summary,85),new RegExp(`${Math.max(peak,85)}°`));}
});
test('hourly renderer preserves scroll and escapes provider text',()=>{
 const f=fixture();f.current.condition='<img src=x onerror=alert(1)>';const root={innerHTML:'',scrollLeft:92};globalThis.document={getElementById:id=>id==='hourly'?root:null};
 try{renderHourlyWeather(f,now);assert.equal(root.scrollLeft,92);assert.ok(!root.innerHTML.includes('<img'));assert.match(root.innerHTML,/data-comfort-time="now"/);assert.match(root.innerHTML,/&lt;img/);}finally{delete globalThis.document;}
});
