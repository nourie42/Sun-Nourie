import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastOutlookDetails} from '../public/weather-fusion/outlook-details.js';

const HOUR=3600000;
const dayStart=Date.parse('2026-09-17T00:00:00Z');
const iso=value=>new Date(value).toISOString();

function fixture(){
  const names=['Thursday','Friday','Saturday','Sunday','Monday','Tuesday','Wednesday'];
  const days=names.map((label,index)=>{
    const start=dayStart+index*24*HOUR;
    return {
      date:iso(start).slice(0,10),label,
      high:[91,94,87,84,82,85,88][index],
      low:[71,72,68,64,61,63,66][index],
      condition:index===0?'Sunny':index===1?'Partly Sunny':'Mostly Sunny',
      nightCondition:index===1?'Chance Showers':'Mostly Clear',
      pop:index===1?55:index===3?30:0,
      popDay:index===1?20:index===3?30:0,
      popNight:index===0?4:index===1?55:0,
      highWindow:{start:iso(start+7*HOUR),end:iso(start+19*HOUR)},
      lowWindow:{start:iso(start+19*HOUR),end:iso(start+31*HOUR)},
      qpfWindow:{start:iso(start+7*HOUR),end:iso(start+31*HOUR)},
    };
  });
  const hours=Array.from({length:8*24},(_,index)=>{
    const time=dayStart+index*HOUR;
    const fridayRain=time>=Date.parse('2026-09-18T20:00:00Z')&&time<Date.parse('2026-09-19T04:00:00Z');
    const sundayRain=time>=Date.parse('2026-09-20T15:00:00Z')&&time<Date.parse('2026-09-20T18:00:00Z');
    const chance=fridayRain?55:sundayRain?30:(time>=Date.parse('2026-09-17T19:00:00Z')&&time<Date.parse('2026-09-18T07:00:00Z')?4:0);
    return {time:iso(time),temperature:75,pop:chance,rainLikelihood:{value:chance},precipitation:chance>=25?.01:0};
  });
  return {location:{timeZone:'UTC'},days,hours};
}

test('local outlook explains today in plain language instead of only reporting peak rain math',()=>{
  const details=forecastOutlookDetails(fixture(),Date.parse('2026-09-17T12:00:00Z'));
  assert.match(details.summary,/Sunny/i);
  assert.match(details.summary,/High near 91°/);
  assert.match(details.summary,/No rain is expected/);
  assert.doesNotMatch(details.summary,/Every available hourly rain chance|Air temperatures run/);
});

test('Tonight & tomorrow names tomorrow and gives the overnight rain window with day names',()=>{
  const details=forecastOutlookDetails(fixture(),Date.parse('2026-09-17T12:00:00Z'));
  assert.match(details.nearTerm,/Tonight:/);
  assert.match(details.nearTerm,/Friday:/);
  assert.match(details.nearTerm,/Rain chance: 55%/);
  assert.match(details.nearTerm,/Friday 8 PM to Saturday 4 AM/);
});

test('week ahead is truly multi-day and says which day each forecast belongs to',()=>{
  const details=forecastOutlookDetails(fixture(),Date.parse('2026-09-17T12:00:00Z'));
  const lines=details.extended.split('\n');
  assert.equal(lines.length,6);
  for(const day of ['Friday','Saturday','Sunday','Monday','Tuesday','Wednesday']) {
    assert.ok(lines.some(line=>line.startsWith(`${day}:`)),`missing named ${day} forecast`);
  }
  assert.match(details.extended,/Sunday:.*Rain chance: 30%.*Best window: 3 PM to 6 PM/s);
});
