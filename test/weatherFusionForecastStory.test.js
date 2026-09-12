import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastPeriodSummary} from '../public/weather-fusion/forecast-story.js';
import {dailyDisplay,dailyRainPeriod,rainChanceValue} from '../public/weather-fusion/weather-math.js';
import {summarizeRainTimeline} from '../src/weatherFusionDirect.js';

const HOUR = 3600000;
const base = Date.parse('2026-09-12T12:00:00Z');
const at = hour => new Date(base + hour * HOUR).toISOString();

function fixture() {
  const dayChance = [5,5,42,55,12,8];
  const nightChance = [9,8,7,6,5,4];
  return {
    location:{timeZone:'UTC'},
    days:[{
      date:'2026-09-12',condition:'Storms possible',detail:'Raw NWS says rain from 1 PM to 3 PM and a 70% chance.',
      nightDetail:'Raw NWS says storms until 11 PM and a 60% chance.',pop:70,popDay:70,popNight:60,
      rainLikelihood:{value:31},popDayLikelihood:{value:42},popNightLikelihood:{value:9},
      highWindow:{start:at(0),end:at(6)},lowWindow:{start:at(6),end:at(12)},qpfWindow:{start:at(0),end:at(12)},
    }],
    hours:[...dayChance,...nightChance].map((chance,index) => ({
      time:at(index),temperature:index<6?80+index:78-index,
      pop:index<6?0:95,
      rainLikelihood:{value:chance},precipitation:.01,
    })),
  };
}

test('day detail timing and percentage come from the same blended hourly forecast shown elsewhere',()=>{
  const story = forecastPeriodSummary(fixture(),0,'daytime',base-HOUR);
  assert.equal(story.chance,42);
  assert.equal(story.rows.length,6);
  assert.match(story.summary,/Weather Nourie rain chance for this period is 42%/);
  assert.match(story.summary,/2 PM–4 PM/);
  assert.match(story.summary,/peaking near 55%/);
  assert.doesNotMatch(story.summary,/1 PM|3 PM|70%|Raw NWS/);
  assert.equal(Object.hasOwn(story,'sourceNote'),false,'Do not add the rejected explanatory comment to the forecast.');
});

test('overnight gets its own matching percentage and ignores conflicting raw NWS prose and POP',()=>{
  const story = forecastPeriodSummary(fixture(),0,'overnight',base-HOUR);
  assert.equal(story.chance,9);
  assert.equal(story.rows.length,6);
  assert.match(story.summary,/rain chance for this period is 9%/);
  assert.match(story.summary,/Every available hourly rain chance stays below 25%/);
  assert.match(story.summary,/highest is 9% at 6 PM/);
  assert.doesNotMatch(story.summary,/11 PM|60%|95%|Raw NWS/);
});

test('period rain amount is reported only with sufficiently complete matching hourly coverage',()=>{
  const forecast = fixture();
  const complete = forecastPeriodSummary(forecast,0,'daytime',base-HOUR);
  assert.ok(Math.abs(complete.amount-.06)<1e-12);
  forecast.hours[2].precipitation = null;
  assert.equal(forecastPeriodSummary(forecast,0,'daytime',base-HOUR).amount,null);
  forecast.hours.splice(0,2);
  assert.equal(forecastPeriodSummary(forecast,0,'daytime',base-HOUR).amount,null);
});

test('future overall story uses its own all-day blend and exact hourly window',()=>{
  const story = forecastPeriodSummary(fixture(),0,'overall',base-HOUR);
  assert.equal(story.chance,31);
  assert.equal(story.rows.length,12);
  assert.match(story.summary,/rain chance for this period is 31%/);
  assert.match(story.summary,/2 PM–4 PM/);
  assert.ok(Math.abs(story.amount-.12)<1e-12);
});

test('NWS-only forecasts get deterministic 7 AM–7 PM day and 7 PM–7 AM night windows',()=>{
  const date='2026-09-12';
  const start=Date.parse(`${date}T00:00:00Z`);
  const forecast={
    location:{timeZone:'UTC'},
    days:[{date,popDay:35,popNight:15}],
    hours:Array.from({length:31},(_,hour)=>({
      time:new Date(start+hour*HOUR).toISOString(),
      temperature:70,pop:hour===10?45:hour===21?20:5,rainLikelihood:null,precipitation:0,
    })),
  };
  const day=forecastPeriodSummary(forecast,0,'daytime',start);
  assert.equal(day.chance,35);
  assert.deepEqual(day.window,{start:start+7*HOUR,end:start+19*HOUR});
  assert.equal(day.rows.length,12);
  assert.match(day.summary,/from 10 AM, peaking near 45%/);
  const night=forecastPeriodSummary(forecast,0,'overnight',start);
  assert.equal(night.chance,15);
  assert.deepEqual(night.window,{start:start+19*HOUR,end:start+31*HOUR});
  assert.equal(night.rows.length,12);
  assert.match(night.summary,/highest is 20% at 9 PM/);
});

test('future all-day details retain day QPF when the hourly horizon cannot cover that day',()=>{
  const forecast={
    location:{timeZone:'UTC'},
    days:[{date:'2026-09-16',pop:40,qpf:.37,qpfWindow:{start:'2026-09-16T07:00:00Z',end:'2026-09-17T07:00:00Z'}}],
    hours:[{time:'2026-09-16T07:00:00Z',temperature:75,pop:40,rainLikelihood:{value:40},precipitation:.02}],
  };
  const story=forecastPeriodSummary(forecast,0,'overall',Date.parse('2026-09-12T12:00:00Z'));
  assert.equal(story.rows.length,1);
  assert.equal(story.amount,.37);
});

test('partial boundary hours contribute only their overlapping fraction of precipitation',()=>{
  const start=Date.parse('2026-09-12T12:00:00Z');
  const forecast={
    location:{timeZone:'UTC'},
    days:[{date:'2026-09-12',popDay:20,highWindow:{start:new Date(start+30*60000).toISOString(),end:new Date(start+2.5*HOUR).toISOString()}}],
    hours:[0,1,2].map(hour=>({time:new Date(start+hour*HOUR).toISOString(),temperature:80,pop:10,precipitation:.1})),
  };
  const story=forecastPeriodSummary(forecast,0,'daytime',start);
  assert.equal(story.rows.length,3);
  assert.ok(Math.abs(story.amount-.2)<1e-12,`expected 0.05 + 0.10 + 0.05, got ${story.amount}`);
});

function canonicalFixture() {
  const forecast=fixture();
  forecast.rainTimeline=forecast.hours.map(hour=>({
    time:hour.time,end:new Date(Date.parse(hour.time)+HOUR).toISOString(),
    rainLikelihood:hour.rainLikelihood,precipitation:hour.precipitation,
  }));
  const day=forecast.days[0];
  day.popDayLikelihood=summarizeRainTimeline(forecast.rainTimeline,base,base+6*HOUR);
  day.popNightLikelihood=summarizeRainTimeline(forecast.rainTimeline,base+6*HOUR,base+12*HOUR);
  day.rainLikelihood=summarizeRainTimeline(forecast.rainTimeline,base,base+12*HOUR);
  return forecast;
}

test('canonical day and overnight text, card values and peaks use the identical time window',()=>{
  const f=canonicalFixture(),now=base+30*60000;
  for(const [phase,field] of [['daytime','popDayLikelihood'],['overnight','popNightLikelihood'],['overall','rainLikelihood']]){
    const story=forecastPeriodSummary(f,0,phase,now),period=f.days[0][field];
    assert.equal(story.chance,period.value);
    assert.equal(story.chance,Math.max(...story.rows.map(row=>row.rainLikelihood.value)));
    assert.deepEqual(story.window,{start:Date.parse(period.window.start),end:Date.parse(period.window.end)});
    assert.match(story.summary,new RegExp(`Rain chance peaks at ${period.value}%`));
    assert.doesNotMatch(story.summary,/but no available hourly reading|70%|60%|Raw NWS/);
  }
  assert.equal(dailyDisplay(f.days[0],0,now,'UTC').pop,55);
  assert.equal(dailyDisplay(f.days[0],0,base+4*HOUR,'UTC').pop,9);
  assert.equal(dailyDisplay(f.days[0],1,now,'UTC').pop,55);
});

test('canonical summary uses the full timeline beyond the 48-hour strip',()=>{
  const f=canonicalFixture();
  f.hours=f.hours.slice(0,2);
  const story=forecastPeriodSummary(f,0,'overall',base-HOUR);
  assert.equal(story.rows.length,12);assert.equal(story.chance,55);
  assert.ok(Math.abs(story.amount-.12)<1e-12);
  assert.match(story.summary,/2 PM–4 PM/);
  assert.doesNotMatch(story.summary,/Air temperatures/,'A partial set of temperatures must not describe the whole period.');
  assert.equal(story.rows[0].temperature,80,'matching hourly temperature is retained');
});

test('canonical null or incomplete chance remains unavailable instead of restoring raw NWS percentages',()=>{
  const f=canonicalFixture();
  const likelihood={...f.days[0].rainLikelihood,value:null,coverage:{complete:false}};
  assert.equal(rainChanceValue(likelihood,95),null);
  assert.equal(rainChanceValue({...likelihood,value:55},95),null);
  assert.equal(rainChanceValue({value:null},95),null,'Hourly canonical null also stays unavailable.');
  assert.equal(rainChanceValue(null,15),15,'Older snapshots with no likelihood object retain their official fallback.');
  f.days[0].rainLikelihood=likelihood;
  f.days[0].popDayLikelihood=likelihood;
  f.days[0].popNightLikelihood=likelihood;
  for(const phase of ['daytime','overnight','overall']){
    assert.equal(dailyRainPeriod(f.days[0],phase).value,null);
    const story=forecastPeriodSummary(f,0,phase,base-HOUR);
    assert.equal(story.chance,null);assert.doesNotMatch(story.summary,/70%|60%/);
  }
  assert.equal(dailyDisplay(f.days[0],1,base,'UTC').pop,null);
  assert.equal(dailyDisplay(f.days[0],0,base,'UTC').pop,null);
  assert.equal(dailyDisplay(f.days[0],0,base+4*HOUR,'UTC').pop,null);
});

test('canonical timeline rows override stale hourly chance and amounts, including explicit nulls',()=>{
  const f=canonicalFixture();
  f.hours[0]={...f.hours[0],rainLikelihood:{value:99},pop:99,precipitation:9};
  f.rainTimeline[0]={...f.rainTimeline[0],rainLikelihood:{value:null},precipitation:null};
  f.days[0].popDayLikelihood=summarizeRainTimeline(f.rainTimeline,base,base+6*HOUR);
  const story=forecastPeriodSummary(f,0,'daytime',base-HOUR);
  assert.equal(story.rows[0].rainLikelihood.value,null);
  assert.equal(story.rows[0].precipitation,null);
  assert.equal(story.chance,null);assert.equal(story.amount,null);
  assert.doesNotMatch(story.summary,/99%/);
});

test('canonical amounts require complete data and never restore an unrelated whole-day QPF',()=>{
  const f=canonicalFixture();f.days[0].qpf=9;
  f.rainTimeline.pop();
  assert.equal(forecastPeriodSummary(f,0,'overall',base-HOUR).amount,null);
  f.rainTimeline=[];
  const empty=forecastPeriodSummary(f,0,'overall',base-HOUR);
  assert.equal(empty.rows.length,0);assert.equal(empty.amount,null);
});

test('canonical missing windows do not silently use unrelated temperature windows',()=>{
  const f=canonicalFixture();f.days[0].popDayLikelihood.window=null;
  const story=forecastPeriodSummary(f,0,'daytime',base-HOUR);
  assert.deepEqual(story.window,{start:null,end:null});assert.equal(story.rows.length,0);assert.equal(story.amount,null);
});

test('canonical amounts prorate partial boundary hours consistently with the server window',()=>{
  const f=canonicalFixture(),start=base+30*60000,end=base+2.5*HOUR;
  f.days[0].popDayLikelihood=summarizeRainTimeline(f.rainTimeline,start,end);
  const story=forecastPeriodSummary(f,0,'daytime',base+45*60000);
  assert.deepEqual(story.window,{start,end});assert.equal(story.rows.length,3);
  assert.ok(Math.abs(story.amount-.02)<1e-12);
});
