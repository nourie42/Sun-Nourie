import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCustomWeights,normalizeCustomWeights,blendCustomSources,buildCustomForecast,customModelAvailability} from '../public/weather-fusion/custom-forecast.js';
import {calendarDayWindow} from '../public/weather-fusion/calendar-day.js';

const H=3600000;
const now=Date.parse('2026-10-17T22:30:00Z'); // 6:30pm in Knightdale
const weights={nws:50,hrrr:50,ecmwf:0,nbm:0,wn:0};
function fixture(dates=['2026-10-17','2026-10-18'],zone='America/New_York',clock=now) {
  const days=dates.map(date=>({date}));
  const windows=days.map((day,i)=>calendarDayWindow(day,i,clock,zone));
  const series={temperature:[],wind:[],dewpoint:[],pop:[]},rainTimeline=[];
  for(let time=windows[0].start;time<windows.at(-1).end;time+=H) {
    const iso=new Date(time).toISOString();
    series.temperature.push({time:iso,value:64,sources:[{id:'nws',value:60},{id:'hrrr',value:80},{id:'ecmwf',value:70},{id:'nbm',value:68},{id:'wn',value:72}]});
    series.wind.push({time:iso,value:8,sources:[{id:'nws',value:10},{id:'hrrr',value:20},{id:'wn',value:12}]});
    series.dewpoint.push({time:iso,value:40,sources:[{id:'nws',value:40},{id:'hrrr',value:50},{id:'wn',value:42}]});
    // Canonical displayed PoP is deliberately different from the official
    // probability and from liquid totals. The preview must keep them separate.
    series.pop.push({time:iso,value:99});
    rainTimeline.push({time:iso,end:new Date(time+H).toISOString(),officialPop:33,precipitation:.04,
      precipitationBlend:{sourceValues:{nws:0,hrrr:.1,wn:.2}},rainLikelihood:{value:99,sourceValues:{nws:33,hrrr:100,wn:100}}});
  }
  return {location:{name:'Knightdale, NC',timeZone:zone},days,metricForecasts:{series},rainTimeline};
}

test('shares must be explicit numeric percentages totaling 100',()=>{
  assert.equal(validateCustomWeights(weights).valid,true);
  for(const bad of [{nws:99},{nws:101},{nws:-1,hrrr:101},{nws:'100'},{nws:NaN},{nws:Infinity},{}]) assert.equal(validateCustomWeights(bad).valid,false);
  const result=buildCustomForecast(fixture(),{nws:45},now);
  assert.equal(result.valid,false);assert.deepEqual(result.hours,[],'invalid edits never leave a stale forecast on screen');
});

test('Balance to 100 preserves proportions and sums exactly to 100 at tenth precision',()=>{
  const equal=normalizeCustomWeights({nws:1,hrrr:1,wn:1},['nws','hrrr','wn']);
  assert.deepEqual(equal,{nws:33.4,hrrr:33.3,ecmwf:0,nbm:0,wn:33.3});
  assert.equal(Math.round(Object.values(equal).reduce((a,b)=>a+b,0)*10),1000);
  assert.deepEqual(normalizeCustomWeights({},['wn']),{nws:0,hrrr:0,ecmwf:0,nbm:0,wn:100});
  assert.equal(normalizeCustomWeights({nws:40,hrrr:20},['nws','hrrr']).nws,66.7);
});

test('the preview blends only requested models, preserving real zero values',()=>{
  assert.deepEqual(blendCustomSources({nws:0,hrrr:20,wn:100},weights),{value:10,availableWeight:100,effectiveWeights:{nws:50,hrrr:50},missing:[],renormalized:false});
  assert.equal(blendCustomSources({nws:10,wn:25},{wn:100}).value,25);
});

test('missing model shares are explicitly rescaled per metric/hour and never set to zero',()=>{
  const result=blendCustomSources({nws:60,hrrr:null,wn:0},weights);
  assert.equal(result.value,60);assert.deepEqual(result.effectiveWeights,{nws:100});assert.deepEqual(result.missing,['hrrr']);assert.equal(result.renormalized,true);
  const empty=blendCustomSources({wn:22},weights);
  assert.equal(empty.value,null);assert.deepEqual(empty.effectiveWeights,{});assert.deepEqual(empty.missing,['nws','hrrr']);assert.equal(empty.renormalized,false);
});

test('matching hourly temperatures, wind and liquid amounts use requested shares without mutating main data',()=>{
  const forecast=fixture(),before=structuredClone(forecast),result=buildCustomForecast(forecast,weights,now);
  assert.equal(result.valid,true);
  assert.equal(result.hours[0].temperature.value,70);assert.equal(result.hours[0].temperature.main,64);
  assert.equal(result.hours[0].wind.value,15);assert.equal(result.hours[0].wind.main,8);
  assert.equal(result.hours[0].dewpoint.value,45);
  assert.equal(result.hours[0].precipitation.value,.05);assert.equal(result.hours[0].precipitation.main,.04);
  assert.equal(result.hours[0].officialPop,33,'official NWS probability is not blended with rainfall signals');
  assert.equal(result.days[0].officialPop,33);
  assert.deepEqual(forecast,before,'the main forecast object is never written');
});

test('NVIDIA WeatherNext is selectable when published and remains unavailable where absent',()=>{
  const forecast=fixture(),available=customModelAvailability(forecast);
  assert.equal(available.wn.available,true);assert.equal(available.wn.metrics.includes('temperature'),true);
  const result=buildCustomForecast(forecast,{wn:100},now);
  assert.equal(result.hours[0].temperature.value,72);assert.equal(result.hours[0].precipitation.value,.2);
  for(const row of forecast.metricForecasts.series.temperature)row.sources=row.sources.filter(s=>s.id!=='wn');
  assert.equal(buildCustomForecast(forecast,{wn:100},now).days[0].high,null);
});

test('today stops at midnight and no tomorrow peak is reported as tonight',()=>{
  const forecast=fixture();
  const tomorrow=calendarDayWindow(forecast.days[1],1,now,forecast.location.timeZone).start;
  for(const row of forecast.metricForecasts.series.temperature) if(Date.parse(row.time)>=tomorrow)row.sources.forEach(source=>{source.value=100;});
  for(const row of forecast.rainTimeline)if(Date.parse(row.time)>=tomorrow){row.officialPop=95;row.precipitationBlend.sourceValues={nws:1,hrrr:1};}
  const result=buildCustomForecast(forecast,weights,now);
  assert.equal(result.days[0].expectedHours,6);assert.equal(result.days[0].high,70);assert.equal(result.days[0].officialPop,33);
  assert.ok(Math.abs(result.days[0].precipitation-.3)<1e-9);
  assert.equal(result.days[1].high,100);assert.equal(result.days[1].officialPop,95);assert.equal(result.days[1].precipitation,24);
});

test('an HRRR overnight range tail is not a complete daily high or daily rain total',()=>{
  const forecast=fixture(),end=calendarDayWindow(forecast.days[1],1,now,forecast.location.timeZone).start+3*H;
  for(const row of forecast.metricForecasts.series.temperature)if(Date.parse(row.time)>=end)row.sources=row.sources.filter(source=>source.id!=='hrrr');
  for(const row of forecast.rainTimeline)if(Date.parse(row.time)>=end)row.precipitationBlend.sourceValues.hrrr=null;
  const result=buildCustomForecast(forecast,{hrrr:100},now);
  assert.equal(result.days[1].temperatureHours,3);assert.equal(result.days[1].precipitationHours,3);
  assert.equal(result.days[1].high,null);assert.equal(result.days[1].low,null);assert.equal(result.days[1].precipitation,null);
  assert.equal(result.hours.find(row=>row.time===end).temperature.value,null);
  assert.ok(result.days[1].incompleteHours>0);
});

test('a remaining complete selected model can cover the day when HRRR ends, with rescaling disclosed',()=>{
  const forecast=fixture(),last=forecast.metricForecasts.series.temperature.at(-1);
  last.sources=last.sources.filter(source=>source.id!=='hrrr');
  const result=buildCustomForecast(forecast,weights,now);
  assert.equal(result.days[1].high,70);assert.equal(result.days[1].low,60);assert.equal(result.days[1].renormalizedHours,1);
  assert.deepEqual(result.hours.at(-1).temperature.effectiveWeights,{nws:100});
});

test('only matching numeric metric source values count; aggregate values and wet signals are never borrowed',()=>{
  const forecast=fixture();
  forecast.metricForecasts.series.temperature[0].sources=[];
  delete forecast.rainTimeline[0].precipitationBlend;
  const result=buildCustomForecast(forecast,weights,now);
  assert.equal(result.hours[0].temperature.value,null);assert.equal(result.days[0].high,null);
  assert.equal(result.hours[0].precipitation.value,null);assert.equal(result.days[0].precipitation,null);
  assert.equal(result.hours[0].temperature.main,64);assert.equal(result.hours[0].precipitation.main,.04);
});

test('daily sums and extrema require interior and boundary coverage, including invalid numeric amounts',()=>{
  for(const index of [0,3,5]) {
    const forecast=fixture();
    forecast.metricForecasts.series.temperature.splice(index,1);
    forecast.rainTimeline[index].precipitationBlend.sourceValues={nws:-1,hrrr:NaN};
    const result=buildCustomForecast(forecast,weights,now);
    assert.equal(result.days[0].high,null);assert.equal(result.days[0].low,null);assert.equal(result.days[0].precipitation,null);
  }
});

test('coarse precipitation intervals are not mislabeled as one-hour amounts',()=>{
  const forecast=fixture();forecast.rainTimeline[0].end=new Date(Date.parse(forecast.rainTimeline[0].time)+6*H).toISOString();
  const result=buildCustomForecast(forecast,weights,now);
  assert.equal(result.hours[0].precipitation.value,null);assert.equal(result.days[0].precipitation,null);
});

test('23-hour and 25-hour local dates retain their actual duration',()=>{
  for(const [date,count] of [['2026-03-08',23],['2026-11-01',25]]) {
    const clock=Date.parse(`${date}T00:00:00Z`),forecast=fixture([date],'America/New_York',clock);
    const result=buildCustomForecast(forecast,{nws:100},clock);
    assert.equal(result.days[0].expectedHours,count);assert.equal(result.hours.length,count);assert.equal(result.days[0].high,60);assert.equal(result.days[0].precipitation,0);
  }
});
