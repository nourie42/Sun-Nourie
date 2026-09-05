import test from 'node:test';
import assert from 'node:assert/strict';
import {dewpointGrossLevel} from '../public/weather-fusion/dewpoint-meter.js';

test('dew point Gross Meter uses requested comfort bands',()=>{
  assert.match(dewpointGrossLevel(49,2).label,/ashy/i);
  assert.match(dewpointGrossLevel(55,2).label,/ain’t bad/i);
  assert.match(dewpointGrossLevel(62,2).label,/bit humid/i);
  assert.match(dewpointGrossLevel(67,2).label,/gettin’ a bit gross/i);
  assert.match(dewpointGrossLevel(72,2).label,/not tryin’ to go out/i);
  assert.equal(dewpointGrossLevel(75,2).label,'Nope');
  assert.equal(dewpointGrossLevel(82,2).label,'Nope');
});

test('a breezy 63 degree dew point gets the requested breeze exception',()=>{
  assert.equal(dewpointGrossLevel(63,8).key,'nice-breeze');
  assert.match(dewpointGrossLevel(63,8).label,/ain’t bad/i);
  assert.match(dewpointGrossLevel(63,8).note,/breeze is saving/i);
  assert.equal(dewpointGrossLevel(63,7).key,'humid');
  assert.equal(dewpointGrossLevel(64,15).key,'humid');
});
