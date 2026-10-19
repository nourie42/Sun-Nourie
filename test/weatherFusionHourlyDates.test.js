import test from 'node:test';
import assert from 'node:assert/strict';
import {currentSample,renderHourlyWeather} from '../public/weather-fusion/weather-display.js';

const now=Date.parse('2026-10-17T04:05:00Z'); // Saturday 12:05 AM in Knightdale
function forecast(time){
 return {assembledAt:new Date(now).toISOString(),location:{latitude:35.7871,longitude:-78.481,timeZone:'America/New_York'},
  current:{type:'observation',temperature:65,dewpoint:45,wind:5,condition:'Clear',time},hours:[],metricForecasts:{series:{}},uv:{hourly:[]}};
}
function render(f){
 const previous=globalThis.document,root={innerHTML:'',scrollLeft:0};
 globalThis.document={getElementById:id=>id==='hourly'?root:null};
 try{renderHourlyWeather(f,now);return root.innerHTML;}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
}
test('Now renders the current local weekday even when its observation time is unavailable',()=>{
 for(const time of [undefined,null,'invalid timestamp']){
  const f=forecast(time),html=render(f);
  assert.match(html,/<span>Now<\/span><small class="hour-date">Sat<\/small>/);
  assert.match(html,/<strong>—<\/strong>/,'An observation with no usable timestamp is not a verified current temperature');
  assert.equal(currentSample(f,now).time,time,'Rendering must not fabricate a source observation time');
  assert.equal(f.current.time,time);
 }
});
test('Now changes weekday at local midnight while preserving the previous-day observation timestamp',()=>{
 const observedAt='2026-10-17T03:53:00Z'; // Friday 11:53 PM EDT
 const f=forecast(observedAt),html=render(f);
 assert.match(html,/<span>Now<\/span><small class="hour-date">Sat<\/small>/);
 assert.match(html,/data-time="2026-10-17T03:53:00Z"/);
 assert.equal(currentSample(f,now).time,observedAt);
});
