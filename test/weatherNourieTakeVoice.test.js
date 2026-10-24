import test from 'node:test';
import assert from 'node:assert/strict';
import {directTakeWording,danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
test('Nourie take states cached discussion summary directly and retains uncertainty',()=>{
 const text='The NWS discussion says dry weather will stick around. Temperatures likely warm next week, but the timing may shift.';
 const expected='Dry weather will stick around. Temperatures likely warm next week, but the timing may shift.';
 assert.equal(directTakeWording(text),expected);
 assert.equal(danTakeDisplay({signature:'a',danSummary:text},{signature:'a',days:[],hours:[]}),expected);
 assert.equal(directTakeWording('According to the NWS, showers may arrive. The weather service says storms are possible.'),'Showers may arrive. Storms are possible.');
 assert.equal(directTakeWording('Rain is likely. Follow official warnings.'),'Rain is likely. Follow official warnings.');
});
