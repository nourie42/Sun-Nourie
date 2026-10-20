import test from 'node:test';
import assert from 'node:assert/strict';
import {bestWashWindow,carWashSummary,carWashHTML} from '../public/weather-fusion/car-wash.js';
import {weatherChangeMessages} from '../public/weather-fusion/weather-changes.js';

const H=3600000,start=Date.parse('2026-10-20T00:00:00Z'),iso=time=>new Date(time).toISOString();
function washFixture(){
  const hours=Array.from({length:96},(_,index)=>({time:iso(start+index*H),isDay:index%24>=7&&index%24<19,
    temperature:65,condition:'Clear',precipitation:index===9?.2:0,rainLikelihood:{value:index===9?80:0}}));
  const days=Array.from({length:4},(_,index)=>({date:iso(start+index*24*H).slice(0,10),condition:'Clear',high:65,low:65,qpf:index===0?.2:0,
    rainLikelihood:{aggregation:'maximum-hourly',value:index===0?80:0,coverage:{complete:true},
      window:{start:iso(start+(index===0?9.5:index*24)*H),end:iso(start+(index+1)*24*H)}}}));
  return {assembledAt:iso(start+9.5*H),location:{timeZone:'UTC'},current:{type:'guidance',time:iso(start+9*H),condition:'Clear',dewpoint:50,wind:5},days,hours,
    rainTimeline:hours.map(row=>({...row,end:iso(Date.parse(row.time)+H)})),metricForecasts:{series:{
      temperature:hours.map(row=>({time:row.time,value:65})),wind:hours.map(row=>({time:row.time,value:5})),dewpoint:hours.map(row=>({time:row.time,value:50})),
    }}};
}

test('a passed rain peak cannot send a YES-today wash window to tomorrow',()=>{
  const f=washFixture(),now=start+10.5*H,original=JSON.stringify(f);
  const summary=carWashSummary(f,now),window=bestWashWindow(f,0,now);
  assert.equal(summary.canWash,true);
  assert.equal(summary.decisions[0].chance,0);
  assert.ok(window);
  assert.equal(window.start,start+11*H);
  assert.equal(summary.window.start,window.start);
  assert.equal(summary.best.title,'11AM–7PM');
  assert.equal(JSON.stringify(f),original,'Recalculating recommendations must not rewrite source rain values.');
});

test('stale car-wash recommendations retain the rule and show a local update warning',()=>{
  const f=washFixture(),freshNow=start+10.5*H,staleNow=Date.parse(f.assembledAt)+2*H;
  f.location.timeZone='America/New_York';
  const fresh=carWashSummary(f,freshNow),stale=carWashSummary(f,staleNow);
  assert.equal(fresh.canWash,true);
  assert.equal(stale.canWash,true);
  assert.equal(stale.freshness.status,'stale');
  assert.match(stale.updateNote,/Stale forecast/);
  assert.match(stale.updateNote,/Oct 20, 5:30 AM EDT/);
  assert.match(carWashHTML(stale),/data-forecast-freshness="stale"/);
  assert.match(carWashHTML(stale),/last updated Oct 20, 5:30 AM EDT/);
  assert.doesNotMatch(fresh.updateNote,/Stale forecast/);
});

test('missing and invalid update timestamps stay explicit without changing the rain rule',()=>{
  for(const time of [undefined,null,'not-a-clock',iso(start+15*H)]){
    const f=washFixture();if(time===undefined)delete f.assembledAt;else f.assembledAt=time;
    const summary=carWashSummary(f,start+10.5*H);
    assert.equal(summary.canWash,true);
    assert.match(summary.updateNote,/update time is (?:unavailable|invalid)/);
    assert.doesNotMatch(summary.updateNote,/Forecast updated null|Invalid Date/);
  }
});

test('the car-wash Feel Meter never calls an expired current dew point now',()=>{
  const f=washFixture();f.metricForecasts.series.dewpoint=[];f.current.dewpoint=70;
  const stale=carWashSummary(f,Date.parse(f.assembledAt)+2*H);
  assert.equal(stale.facts.gross.title,'Unavailable');
  assert.notEqual(stale.facts.gross.detail,'Feel Meter now');
});

test('retained precipitation warnings distinguish last-known readings from rain happening now',()=>{
  const f=washFixture(),now=Date.parse(f.assembledAt)+2*H;
  f.current.type='observation';f.current.condition='Rain';
  let summary=carWashSummary(f,now);
  assert.equal(summary.canWash,false,'The retained recommendation stays conservative.');
  assert.equal(summary.reason,'Last available readings reported rain or wintry weather.');
  f.current.condition='Clear';f.current.radarPrecipitation={status:'ready',atLocation:true,observedAt:f.assembledAt};
  summary=carWashSummary(f,now);
  assert.equal(summary.canWash,false);
  assert.equal(summary.reason,'Last available radar showed precipitation at this location.');
  assert.doesNotMatch(summary.reason,/happening now|radar shows/);
});

function changesFixture(){
  const days=['2026-10-20','2026-10-21','2026-10-22','2026-10-23'].map(date=>({date,pop:0,qpf:0,confidence:{key:'high'}}));
  const series={temperature:[],dewpoint:[]};
  for(const day of days)for(let hour=7;hour<19;hour++)for(const key of Object.keys(series))series[key].push({time:`${day.date}T${String(hour).padStart(2,'0')}:00:00Z`,value:hour<13?50:80});
  return {location:{timeZone:'UTC'},days,metricForecasts:{series}};
}
const changesNow=start+6*H;
test('different incomplete dayparts cannot invent a large temperature or dewpoint change',()=>{
  const f=changesFixture();
  assert.deepEqual(weatherChangeMessages(f,changesNow),[]);
  f.days=f.days.slice(0,2);
  for(const key of ['temperature','dewpoint'])f.metricForecasts.series[key]=f.metricForecasts.series[key].filter(row=>row.time.startsWith('2026-10-20')?row.value===50:row.time.startsWith('2026-10-21')&&row.value===80);
  assert.deepEqual(weatherChangeMessages(f,changesNow),[]);
});

test('a missing, null or duplicated daytime hour cannot establish a full-day average',()=>{
  for(const change of [rows=>rows.splice(0,1),rows=>{rows[0].value=null;},rows=>rows.push({...rows[0]})]){
    const f=changesFixture();f.days=f.days.slice(0,2);
    for(const key of ['temperature','dewpoint']){
      const rows=f.metricForecasts.series[key].filter(row=>row.time.slice(0,10)<='2026-10-21');
      rows.forEach(row=>{row.value=row.time.startsWith('2026-10-20')?50:90;});change(rows);
      f.metricForecasts.series[key]=rows;
    }
    assert.deepEqual(weatherChangeMessages(f,changesNow),[]);
  }
});

test('rain-return text cannot turn the unverified elapsed part of today into a dry day',()=>{
  const f=changesFixture();Object.assign(f.days[2],{pop:85,qpf:.4});
  f.days[0].qpfWindow={start:iso(changesNow),end:iso(start+24*H)};
  f.rainTimeline=[{time:iso(start+H),end:iso(start+2*H),precipitation:.3}];
  const text=weatherChangeMessages(f,changesNow).find(text=>text.startsWith('Rain returns'));
  assert.match(text,/after two low-rain forecast periods from now/);
  assert.doesNotMatch(text,/after two dry days/);
  assert.match(text,/85% chance, with 0\.4 inches expected/);
});

test('two future dry dates are labeled as forecast days without changing rain-return thresholds',()=>{
  const f=changesFixture();f.days[0].qpf=.1;Object.assign(f.days[3],{pop:85,qpf:.4});
  const text=weatherChangeMessages(f,changesNow).find(text=>text.startsWith('Rain returns'));
  assert.match(text,/after two dry forecast days/);
  assert.doesNotMatch(text,/from now/);
});
