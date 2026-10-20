import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherChangeMessages} from '../public/weather-fusion/weather-changes.js';
const now=Date.parse('2026-10-20T06:00Z');
function fixture(key,weather){
 const days=[20,21,22].map(day=>({date:`2026-10-${day}`,pop:0,qpf:0,confidence:{key,...(weather?{weather:{scope:'sky-and-rain',...weather}}:{})}}));
 Object.assign(days[2],{pop:85,qpf:.4});
 return {location:{timeZone:'UTC'},days};
}
test('a temperature disagreement cannot suppress a well-supported rain-return announcement',()=>{
 const messages=weatherChangeMessages(fixture('low',{key:'high',label:'High'}),now);
 assert.equal(messages.length,1);assert.match(messages[0],/85% chance.*0\.4 inches.*high sky\/rain agreement/);
});
test('temperature agreement cannot validate a poorly supported rain-return announcement',()=>{
 assert.deepEqual(weatherChangeMessages(fixture('high',{key:'low',label:'Low'}),now),[]);
});
test('unavailable condition guidance does not announce a confident rain return',()=>{
 assert.deepEqual(weatherChangeMessages(fixture('high',{key:'unavailable',label:'Unavailable'}),now),[]);
});
test('older forecast payloads retain their existing confidence wording',()=>{
 assert.match(weatherChangeMessages(fixture('moderate'),now)[0],/moderate confidence/);
});
