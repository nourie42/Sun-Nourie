import test from 'node:test';
import assert from 'node:assert/strict';
import {customForecastInput,normalizeCustomWeights,changeCustomWeight,toggleCustomModel,customPresetWeights,blendCustomForecast,publishedForecastPreview,customForecastSummary,customCalendarComparison,customForecastNarrative,singleModelComparison,CUSTOM_FORECAST_METRICS,formatModelMetric} from '../public/weather-fusion/custom-forecast-model.js';
import {modelComparisonPath,modelComparisonScale} from '../public/weather-fusion/custom-forecast.js';
import {calendarDayWindow} from '../public/weather-fusion/calendar-day.js';
import {humidityFromDewpoint,tier3FeelsLike,solarElevation} from '../public/weather-fusion/weather-math.js';

const HOUR = 3600000;
const NOW = Date.parse('2026-10-18T03:30:00Z'); // Saturday 11:30 PM in Knightdale.
const at = offset => new Date(Math.floor(NOW/HOUR)*HOUR+offset*HOUR).toISOString();
const row = (index, overrides = {}) => ({
  time:at(index),end:at(index+1),temperature:70+index,officialTemperature:68+index,
  temperatureBlend:{sources:[{id:'nws',value:68+index},{id:'hrrr',value:76+index},{id:'ecmwf',value:64+index}]},
  officialPop:index ? 80 : 10,rainLikelihood:{value:index ? 87 : 17,officialProbability:index ? 80 : 10},
  precipitation:index ? .08 : .01,
  precipitationBlend:{sourceValues:{nws:.02,hrrr:.20,ecmwf:0}},...overrides,
});
const fixture = () => ({
  location:{name:'Knightdale, NC',latitude:35.79,longitude:-78.48,timeZone:'America/New_York'},
  assembledAt:new Date(NOW).toISOString(),blendPolicy:{sameDay:{nws:.4,hrrr:.3,ecmwf:.1,nbm:.2}},
  hours:[row(0),row(1),row(2)],rainTimeline:[row(0),row(1),row(2)],
  modelContributions:[{id:'hrrr',runAt:at(-2)},{id:'ecmwf',runAt:at(-4)}],
});
const almost = (value, expected) => assert.ok(Math.abs(value-expected)<1e-8,`${value} != ${expected}`);

test('custom forecast uses timestamp-matched hourly evidence and never modifies the official snapshot',()=>{
  const source = fixture(), before = JSON.stringify(source);
  const input = customForecastInput(source,NOW), result = blendCustomForecast(input,{nws:25,hrrr:75});
  almost(result.hours[0].custom.temperature.value,74);
  almost(result.hours[1].custom.temperature.value,75);
  assert.equal(result.hours[0].baseline.temperature,70);
  assert.equal(result.hours[0].baseline.rain,17);
  assert.equal(result.location.name,'Knightdale, NC');
  assert.equal(JSON.stringify(source),before);
});

test('same-instant offsets align, with explicit missing clock-hour gaps',()=>{
  const source = fixture();
  source.hours = [row(0,{time:'2026-10-17T23:00:00-04:00'}),row(2)];
  source.rainTimeline = [row(0),row(2)];
  const input = customForecastInput(source,NOW), result = blendCustomForecast(input,{nws:100});
  assert.equal(input.hours.length,3);
  assert.equal(result.hours[0].custom.temperature.value,68);
  assert.equal(result.hours[1].custom.temperature.value,null);
  assert.equal(result.hours[1].custom.rain.value,null);
  assert.equal(result.hours[2].custom.temperature.value,70);
});

test('metric temperature evidence extends the custom timeline without repeating a daily high',()=>{
  const source = fixture();
  source.metricForecasts = {series:{temperature:[{time:at(4),value:71.4,sources:[{id:'nws',value:70},{id:'wn',value:74}]}]}};
  source.days = [{date:'2026-10-18',high:90,highBlend:{sources:[{id:'nws',value:90}]}}];
  const result = blendCustomForecast(customForecastInput(source,NOW),{nws:50,wn:50});
  assert.equal(result.hours[3].custom.temperature.value,null);
  assert.equal(result.hours[4].custom.temperature.value,72);
  assert.equal(result.hours[4].baseline.temperature,71.4);
  assert.equal(result.hours[4].custom.rain.value,null,'temperature cannot invent rain inputs');
});

test('missing models are excluded separately for each metric and hour; real zero rainfall stays zero',()=>{
  const source = fixture();
  source.hours[0].temperatureBlend.sources = [{id:'nws',value:68},{id:'hrrr',value:76}];
  source.rainTimeline[0].precipitationBlend.sourceValues = {ecmwf:0};
  const result = blendCustomForecast(customForecastInput(source,NOW),{nws:25,hrrr:25,ecmwf:50}), first = result.hours[0];
  assert.equal(first.custom.temperature.value,72);
  assert.deepEqual(first.custom.temperature.weights,{nws:50,hrrr:50});
  assert.deepEqual(first.custom.temperature.missing,['ecmwf']);
  assert.equal(first.custom.amount.value,0);
  assert.deepEqual(first.custom.amount.weights,{ecmwf:100});
  assert.deepEqual(first.custom.amount.missing,['nws','hrrr']);
  assert.equal(first.custom.rain.value,10);
  assert.deepEqual(first.custom.rain.weights,{nws:100});
});

test('explicit incomplete rainfall is not rescued by window-average sources',()=>{
  const source = fixture();
  source.rainTimeline[0].precipitationBlend = {sourceValues:{hrrr:null},sources:[{id:'hrrr',value:.5}]};
  const result = blendCustomForecast(customForecastInput(source,NOW),{hrrr:100});
  assert.equal(result.hours[0].custom.amount.value,null);
  assert.equal(result.hours[0].custom.rain.value,null);
});

test('rain chance uses genuine NWS probabilities only, independently of deterministic rainfall',()=>{
  const input = customForecastInput(fixture(),NOW);
  const lone = blendCustomForecast(input,{hrrr:100});
  assert.equal(lone.hours[0].custom.rain.value,null);
  const withLowNws = blendCustomForecast(input,{nws:50,hrrr:50});
  assert.equal(withLowNws.hours[0].custom.rain.value,10);
  assert.equal(withLowNws.hours[1].custom.rain.value,80);
  const nwsOnly = blendCustomForecast(input,{nws:100});
  assert.equal(nwsOnly.hours[0].custom.rain.value,10);
  assert.equal(nwsOnly.hours[1].custom.rain.value,80);
  almost(lone.hours[0].custom.amount.value,.2);
});

test('even heavy rainfall from multiple deterministic models never invents a probability',()=>{
  const source = fixture();
  source.rainTimeline = [row(0,{precipitationBlend:{sourceValues:{hrrr:.0009,ecmwf:.010,wn:.08,nbm:.1}}})];
  source.hours = [];
  const input = customForecastInput(source,NOW);
  assert.equal(blendCustomForecast(input,{hrrr:100}).hours[0].custom.rain.value,null);
  assert.equal(blendCustomForecast(input,{ecmwf:100}).hours[0].custom.rain.value,null);
  assert.equal(blendCustomForecast(input,{wn:50,nbm:50}).hours[0].custom.rain.value,null);
  almost(blendCustomForecast(input,{wn:50,nbm:50}).hours[0].custom.amount.value,.09);
});

test('longer rainfall intervals never become hourly amounts',()=>{
  const source = fixture();
  source.hours = [];
  source.rainTimeline = [row(0,{end:at(6)})];
  const input = customForecastInput(source,NOW);
  assert.equal(input.hours.length,0);
  assert.equal(input.models.some(model=>model.available),false);
});

test('missing total rainfall remains unavailable and the current partial hour is prorated',()=>{
  const input = customForecastInput(fixture(),NOW), complete = blendCustomForecast(input,{nws:100});
  const summary = customForecastSummary(complete.hours,'amount');
  almost(summary.custom,.05); // half of .02 plus two complete .02 hours
  assert.equal(summary.completeCustom,true);
  delete input.hours[1].sources.amount.nws;
  const incomplete = customForecastSummary(blendCustomForecast(input,{nws:100}).hours,'amount');
  assert.equal(incomplete.custom,null);
  assert.equal(incomplete.customHours,2);
  assert.equal(incomplete.completeCustom,false);
});

test('date boundaries do not pull tomorrow rain into today; both instants remain explicit',()=>{
  const result = blendCustomForecast(customForecastInput(fixture(),NOW),{nws:100});
  const day = time => new Intl.DateTimeFormat('en-US',{timeZone:result.timeZone,day:'numeric'}).format(new Date(time));
  assert.equal(day(result.hours[0].time),'17');
  assert.equal(day(result.hours[1].time),'18');
  assert.equal(result.hours[0].custom.rain.value,10);
  assert.equal(result.hours[1].custom.rain.value,80);
});

test('percentages normalize only chosen known models and sliders keep total at 100',()=>{
  assert.deepEqual(normalizeCustomWeights({nws:3,hrrr:1,unknown:90,ecmwf:null,wn:-3}),{nws:75,hrrr:25});
  assert.deepEqual(normalizeCustomWeights({nws:0,hrrr:null}),{});
  const changed = changeCustomWeight({nws:40,hrrr:30,ecmwf:30},'nws',70);
  almost(changed.nws,70); almost(changed.hrrr,15); almost(changed.ecmwf,15);
  const added = toggleCustomModel(changed,'wn',true);
  almost(added.wn,20);
  almost(Object.values(added).reduce((sum,value)=>sum+value,0),100);
  const removed = toggleCustomModel({nws:50,hrrr:50},'hrrr',false);
  assert.deepEqual(removed,{nws:100});
  assert.deepEqual(toggleCustomModel({nws:100},'nws',false),{});
  const thirds = normalizeCustomWeights({nws:1,hrrr:1,ecmwf:1});
  assert.deepEqual(Object.values(thirds).sort((a,b)=>a-b),[33,33,34]);
  assert.equal(Object.values(thirds).reduce((sum,value)=>sum+value,0),100);
  for(const share of Object.values(toggleCustomModel(thirds,'nbm',true))) assert.ok(Number.isInteger(share));
});

test('presets expose actual available feeds including NVIDIA without fabricating NBM',()=>{
  const source = fixture();
  source.metricForecasts = {series:{temperature:[{time:at(0),value:72,sources:[{id:'wn',value:75}]}]}};
  const input = customForecastInput(source,NOW);
  assert.equal(input.models.find(model=>model.id==='wn').available,true);
  assert.equal(input.models.find(model=>model.id==='nbm').available,false);
  assert.equal(Object.hasOwn(customPresetWeights(input,'equal'),'wn'),true);
  assert.equal(Object.hasOwn(customPresetWeights(input,'equal'),'nbm'),false);
  assert.deepEqual(customPresetWeights(input,'nws'),{nws:100});
  assert.equal(Object.hasOwn(customPresetWeights(input,'models'),'nws'),false);
  assert.equal(Object.hasOwn(customPresetWeights(input,'nourie'),'nbm'),false);
});

test('empty selection leaves custom values unavailable while retaining the Nourie comparison',()=>{
  const result = blendCustomForecast(customForecastInput(fixture(),NOW),{});
  assert.equal(result.hours[0].custom.temperature.value,null);
  assert.equal(result.hours[0].custom.rain.value,null);
  assert.equal(result.hours[0].custom.amount.value,null);
  assert.equal(result.hours[0].baseline.temperature,70);
});

function calendarFixture(now=Date.parse('2026-10-19T02:30:00Z'),date='2026-10-18'){
  const days=Array.from({length:7},(_,index)=>{
    const key=new Date(Date.parse(`${date}T12:00:00Z`)+index*24*HOUR).toISOString().slice(0,10);
    const window=calendarDayWindow({date:key},index,now,'America/New_York');
    return {date:key,label:key,high:99,low:40,condition:'Partly cloudy',rainLikelihood:{aggregation:'maximum-hourly',value:10,coverage:{complete:true},window:{start:new Date(index===0?now:window.start).toISOString(),end:new Date(window.end).toISOString()}},qpfWindow:{start:new Date(index===0?now:window.start).toISOString(),end:new Date(window.end).toISOString()}};
  });
  const start=Math.floor(now/HOUR)*HOUR,end=calendarDayWindow(days[6],6,now,'America/New_York').end;
  const hourly=[];
  for(let time=start;time<end;time+=HOUR){
    const localHour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date(time)));
    const value=localHour===14?70:52;
    const hrrr=time<Date.parse(days[2].date+'T07:00:00Z')?(localHour===14?68:45):null;
    hourly.push({time:new Date(time).toISOString(),end:new Date(time+HOUR).toISOString(),temperature:value,officialTemperature:value,temperatureBlend:{sources:[{id:'nws',value},{id:'ecmwf',value:value+2},...(hrrr===null?[]:[{id:'hrrr',value:hrrr}])]},officialPop:10,rainLikelihood:{value:10,officialProbability:10},precipitation:0,precipitationBlend:{sourceValues:{nws:0,ecmwf:0,...(hrrr===null?{}:{hrrr:0})}}});
  }
  return {now,forecast:{location:{name:'Knightdale',latitude:35.787,longitude:-78.48,timeZone:'America/New_York'},assembledAt:new Date(now).toISOString(),days,hours:hourly,rainTimeline:hourly,blendPolicy:{sameDay:{nws:40,hrrr:30,ecmwf:30}}}};
}

test('calendar narrative uses the published displayed high, not the raw period high',()=>{
  const {forecast,now}=calendarFixture();
  const narrative=customForecastNarrative(blendCustomForecast(customForecastInput(forecast,now),{hrrr:100}));
  assert.equal(narrative.days[1].high.baseline,70);
  assert.equal(forecast.days[1].high,99,'raw daytime period high differs from the calendar card');
  assert.equal(narrative.days[1].high.value,68);
  assert.match(narrative.highlights.map(item=>item.text).join(' '),/Monday, the high becomes 68° instead of 70°/);
  assert.equal(narrative.days.length,7);
  assert.equal(narrative.days.at(-1).date,'2026-10-24');
});

test('today ends at local midnight and cannot borrow Monday morning rain',()=>{
  const {forecast,now}=calendarFixture();
  const wet=forecast.rainTimeline.find(row=>row.time==='2026-10-19T05:00:00.000Z');
  wet.precipitation=1;wet.precipitationBlend.sourceValues.nws=1;
  const result=customCalendarComparison(blendCustomForecast(customForecastInput(forecast,now),{nws:100}));
  assert.equal(result[0].label,'Remaining today');
  assert.equal(result[0].amount.value,0);
  assert.equal(result[0].temperatureWindow.end,Date.parse('2026-10-19T04:00:00Z'));
  assert.equal(result[1].amount.value,1);
});

test('an older midnight rain window is narrowed to the remaining day with a matching hourly baseline',()=>{
  const {forecast,now}=calendarFixture();
  const midnight=calendarDayWindow(forecast.days[0],1,now,'America/New_York').start;
  forecast.days[0].rainLikelihood.window.start=new Date(midnight).toISOString();
  forecast.hours[0].precipitation=.02;
  forecast.hours[0].precipitationBlend.sourceValues.nws=.04;
  const result=customCalendarComparison(blendCustomForecast(customForecastInput(forecast,now),{nws:100}));
  assert.equal(result[0].rainWindow.start,now);
  almost(result[0].amount.value,.02);
  almost(result[0].amount.baseline,.01);
});

test('a model overnight tail cannot become Tuesday’s daily high',()=>{
  const {forecast,now}=calendarFixture();
  const input=customForecastInput(forecast,now),narrative=customForecastNarrative(blendCustomForecast(input,{hrrr:100}));
  assert.equal(narrative.days[2].high.value,null);
  assert.equal(narrative.days[2].high.availableHours,3);
  assert.equal(narrative.days[2].high.expectedHours,24);
  assert.doesNotMatch(narrative.days[2].sentences.join(' '),/45°/);
  const mixed=customCalendarComparison(blendCustomForecast(input,{hrrr:50,ecmwf:50}));
  assert.equal(mixed[2].high.value,72,'other selected models cover the missing afternoon hours');
});

test('a missing internal hour prevents a false daily high or rainfall total',()=>{
  const {forecast,now}=calendarFixture();
  forecast.hours=forecast.hours.filter(row=>row.time!=='2026-10-19T18:00:00.000Z');
  forecast.rainTimeline=forecast.rainTimeline.filter(row=>row.time!=='2026-10-19T18:00:00.000Z');
  const result=customCalendarComparison(blendCustomForecast(customForecastInput(forecast,now),{nws:100}));
  assert.equal(result[1].high.value,null);assert.equal(result[1].amount.value,null);
});

test('the fall DST day needs all 25 distinct clock hours',()=>{
  const {forecast,now}=calendarFixture(Date.parse('2026-11-01T02:30:00Z'),'2026-10-31');
  const result=customCalendarComparison(blendCustomForecast(customForecastInput(forecast,now),{nws:100}));
  assert.equal(result[1].date,'2026-11-01');
  assert.equal(result[1].high.expectedHours,25);
  assert.equal(result[1].high.complete,true);
});

test('missing published comparison values cannot be described as a match',()=>{
  const {forecast,now}=calendarFixture();
  forecast.days=[];
  const narrative=customForecastNarrative(blendCustomForecast(customForecastInput(forecast,now),{nws:100}));
  assert.equal(narrative.completeDays,7);assert.equal(narrative.comparedDays,0);
  assert.doesNotMatch(narrative.summary,/match Weather Nourie/);
  assert.match(narrative.summary,/can’t compare/);
});

test('European and AI presets emphasize available models without inventing feeds',()=>{
  const input=customForecastInput(fixture(),NOW);
  const european=customPresetWeights(input,'european');
  assert.equal(european.ecmwf,60);
  assert.equal(Object.values(european).reduce((sum,value)=>sum+value,0),100);
  assert.equal(Object.hasOwn(customPresetWeights(input,'ai'),'wn'),false);
});

test('Weather Nourie mode preserves actual published days even when static model shares produce changes',()=>{
  const {forecast,now}=calendarFixture();
  forecast.blendPolicy.sameDay={hrrr:1}; // An obsolete policy is not the current published mix.
  const current=forecast.hours[0];
  current.temperatureBlend.sources=[{id:'nws',value:52,weight:.5},{id:'hrrr',value:45,weight:.2},{id:'ecmwf',value:54,weight:.2},{id:'wn',value:62,weight:.1}];
  for(const row of forecast.rainTimeline){row.precipitation=.01;row.precipitationBlend.sourceValues.ecmwf=.1;}
  const before=JSON.stringify(forecast),input=customForecastInput(forecast,now);
  assert.deepEqual(input.defaultWeights,{nws:50,hrrr:20,ecmwf:20,wn:10},'editing starts from actual current temperature source shares, including NVIDIA');
  const edited=customForecastNarrative(blendCustomForecast(input,input.defaultWeights));
  assert.ok(edited.highlights.length>0,'the static custom mix differs from adaptive published rainfall');
  const published=publishedForecastPreview(input),narrative=customForecastNarrative(published);
  assert.equal(narrative.highlights.length,0);
  assert.match(narrative.summary,/shown unchanged/);
  for(const day of narrative.days){assert.equal(day.high.value,day.high.baseline);assert.equal(day.amount.value,day.amount.baseline);}
  assert.equal(published.hours[0].custom.amount.value,published.hours[0].baseline.amount);
  assert.equal(JSON.stringify(forecast),before,'the canonical page data remains untouched');
});

test('single-model selection compares one real source with exact published seven-calendar-day highs',()=>{
  const {forecast,now}=calendarFixture();
  const before=JSON.stringify(forecast),input=customForecastInput(forecast,now);
  const initial=singleModelComparison(input);
  assert.equal(initial.selectedId,null);
  assert.equal(initial.selected.length,0);
  assert.deepEqual(initial.baseline,input.calendarDays.map(day=>day.baseline.high));
  const hrrr=singleModelComparison(input,'hrrr');
  assert.deepEqual(hrrr.built.weights,{hrrr:100});
  assert.equal(hrrr.baseline[1],70);
  assert.equal(hrrr.selected[1],68);
  assert.equal(hrrr.selected[2],null,'three cold overnight hours are not a daily high');
  assert.equal(hrrr.days.length,7);
  assert.match(hrrr.coverageNote,/Tuesday/);
  assert.deepEqual(singleModelComparison(input,'gfs').selected,[],'an unavailable model does not invent a line');
  assert.equal(JSON.stringify(forecast),before);
});

test('model graph keeps the published line visible independently of model coverage gaps',()=>{
  const {forecast,now}=calendarFixture();
  const input=customForecastInput(forecast,now),hrrr=singleModelComparison(input,'hrrr');
  assert.equal(hrrr.baseline.at(-1),70);
  assert.equal(hrrr.selected.at(-1),null);
  assert.equal(modelComparisonPath([68,null,70],index=>index*10,value=>value),'M0.00,68.00M20.00,70.00');
  const scale=modelComparisonScale([0,-4,0]);
  assert.ok(scale.min< -4&&scale.max>0,'zero and negative high temperatures remain visible');
});

test('NVIDIA selection uses its own published source values and rainfall without inventing probabilities',()=>{
  const {forecast,now}=calendarFixture();
  for(const row of forecast.hours){row.temperatureBlend.sources.push({id:'wn',value:row.temperature+4});row.precipitationBlend.sourceValues.wn=.01;}
  const result=singleModelComparison(customForecastInput(forecast,now),'wn');
  assert.equal(result.label,'NVIDIA WeatherNext');
  assert.equal(result.selected[1],74);
  almost(result.days[1].amount.value,.24);
  assert.equal(result.days[1].rain.value,null);
  assert.match(result.narrative.highlights.map(change=>change.text).join(' '),/rainfall/);
});

function allMetricsFixture(now=Date.parse('2026-10-19T02:30:00Z'),date='2026-10-18'){
  const source=calendarFixture(now,date),forecast=source.forecast;
  const definitions={wind:[10,5,15],gust:[30,25,35],dewpoint:[45,40,50],cloud:[30,20,40],pressure:[30.1,30,30.2],visibility:[8,7,9]};
  const series={};
  for(const [field,[baseline,nws,hrrr]]of Object.entries(definitions))series[field]=forecast.hours.map(row=>({time:row.time,value:baseline,sources:[{id:'nws',value:nws},{id:'hrrr',value:hrrr}]}));
  series.humidity=forecast.hours.map(row=>({time:row.time,value:60}));
  series.feels=forecast.hours.map(row=>({time:row.time,value:80,inputs:{skyCover:30}}));
  series.feelsShade=forecast.hours.map(row=>({time:row.time,value:70}));
  series.feelsSun=forecast.hours.map(row=>{
    const daylight=solarElevation(Date.parse(row.time),forecast.location.latitude,forecast.location.longitude)>0;
    return {time:row.time,value:daylight?90:null,daylight};
  });
  forecast.metricForecasts={series};
  forecast.uv={hourly:forecast.hours.map(row=>({time:row.time,value:row.temperature===70?8:0}))};
  forecast.airQuality={hours:forecast.hours.map(row=>({time:row.time,aqi:row.temperature===70?50:25}))};
  forecast.snow={days:forecast.days.map((day,index)=>{
    const calendar=calendarDayWindow(day,index,now,forecast.location.timeZone),start=index===0?Math.ceil(now/HOUR)*HOUR:calendar.start,end=calendar.end;
    return {date:day.date,amountWindow:{start:new Date(start).toISOString(),end:new Date(end).toISOString()},displaySnowfall:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),value:.2,source:'NWS point forecast',status:'ready',unit:'in'},nwsCovered:true,nearTermModels:{hrrr:0,nam:0},models:{ecmwf:.3,gfs:.4}};
  })};
  return source;
}

test('every offered metric has a stated unit and aggregation; model selection stays a single real source',()=>{
  const {forecast,now}=allMetricsFixture(),input=customForecastInput(forecast,now);
  assert.equal(CUSTOM_FORECAST_METRICS.length,18);
  for(const metric of CUSTOM_FORECAST_METRICS){
    assert.ok(metric.unit&&['min','max','mean','sum'].includes(metric.aggregation));
    const result=singleModelComparison(input,'nws',metric.id);
    assert.equal(result.selectedId,'nws');assert.equal(result.metricId,metric.id);
    assert.equal(result.baseline.length,7);assert.equal(result.selected.length,7);
    assert.deepEqual(result.built.weights,{nws:100});
  }
});

test('high, low, peak, mean and total measurements aggregate matching calendar hours with correct units',()=>{
  const {forecast,now}=allMetricsFixture(),input=customForecastInput(forecast,now);
  const expected={high:70,low:52,wind:5,gust:25,dewpoint:40,cloud:20,pressure:30,visibility:7,uv:null,aqi:null,rain:10,amount:0,snow:.2};
  for(const [metric,value]of Object.entries(expected)){
    const result=singleModelComparison(input,'nws',metric);
    assert.equal(result.selected[1],value,metric);
  }
  assert.equal(singleModelComparison(input,null,'uv').baseline[1],8);
  assert.equal(singleModelComparison(input,null,'aqi').baseline[1],50);
  assert.equal(formatModelMetric(30,'pressure'),'30.000 inHg');
  assert.equal(formatModelMetric(.2,'snow'),'0.2 in');
  assert.equal(formatModelMetric(4,'rain'),'Low');
  assert.equal(formatModelMetric(5,'rain'),'5%');
  assert.deepEqual(modelComparisonScale([3,4],'humidity'),{min:0,max:100});
  assert.ok(modelComparisonScale([0,0],'snow').max>0);
});

test('humidity and feels-like use only the selected model’s exact matching inputs and the existing formula',()=>{
  const {forecast,now}=allMetricsFixture(),input=customForecastInput(forecast,now);
  const monday=input.hours.filter(row=>row.timestamp>=input.calendarDays[1].temperatureWindow.start&&row.timestamp<input.calendarDays[1].temperatureWindow.end);
  const humidity=monday.reduce((sum,row)=>sum+humidityFromDewpoint(row.sources.temperature.nws,40),0)/24;
  almost(singleModelComparison(input,'nws','humidity').selected[1],humidity);
  const feelValues=monday.map(row=>tier3FeelsLike({temperature:row.sources.temperature.nws,dewpoint:40,wind:5,skyCover:20},forecast.location,row.timestamp,'outdoors').value);
  almost(singleModelComparison(input,'nws','feels').selected[1],Math.max(...feelValues.map(value=>Number(value.toFixed(1)))));
  assert.notEqual(singleModelComparison(input,'nws','humidity').selected[1],60,'published blended humidity must not become the NWS estimate');
  forecast.metricForecasts.series.cloud.find(row=>row.time==='2026-10-19T18:00:00.000Z').sources=[];
  const missing=customForecastInput(forecast,now);
  assert.equal(singleModelComparison(missing,'nws','feels').selected[1],null,'missing own cloud cannot borrow the published sky input');
  assert.equal(singleModelComparison(missing,null,'feels').baseline[1],80,'the actual published series stays visible');
});

test('direct-sun peaks exclude physically inapplicable night hours instead of treating them as missing or zero',()=>{
  const {forecast,now}=allMetricsFixture(),input=customForecastInput(forecast,now);
  const result=singleModelComparison(input,'nws','feelsSun');
  assert.ok(result.days[1].metric.expectedHours>0&&result.days[1].metric.expectedHours<24);
  assert.equal(result.days[1].metric.complete,true);
  assert.ok(Number.isFinite(result.selected[1]));
  assert.equal(result.selected[0],null,'all remaining hours today are at night');
});

test('thermal and wind comparisons explain the actual statistic in natural wording',()=>{
  const {forecast,now}=allMetricsFixture(),input=customForecastInput(forecast,now);
  const phrases={feels:['it could feel as warm as','outdoors'],feelsLow:['it could feel as cool as','outdoors'],feelsShade:['it could feel as warm as','in the shade'],feelsSun:['it could feel as warm as','in direct sunlight'],gust:['gusts could reach',''],wind:['wind could average','']};
  for(const [metric,[phrase,setting]]of Object.entries(phrases)){
    const result=singleModelComparison(input,'nws',metric),change=result.narrative.highlights[0];
    assert.ok(change,`${metric} has a real difference to describe`);
    const day=result.days.find(item=>item.date===change.date);
    assert.ok(change.text.includes(`${phrase} ${formatModelMetric(day.metric.value,metric)}${setting?` ${setting}`:''}`),metric);
    assert.ok(change.text.includes(`compared with ${formatModelMetric(day.metric.baseline,metric)} in Weather Nourie’s forecast.`),metric);
    assert.doesNotMatch(change.text,/highest estimated.*feels like is/i);
  }
});

test('direct-sun applicability follows the exact thermal cloud input, not a rounded display threshold',()=>{
  const {forecast,now}=allMetricsFixture(),time='2026-10-19T16:00:00.000Z';
  forecast.metricForecasts.series.cloud.find(row=>row.time===time).value=62;
  forecast.metricForecasts.series.feels.find(row=>row.time===time).inputs.skyCover=62.04;
  forecast.metricForecasts.series.feelsSun.find(row=>row.time===time).value=null;
  const result=singleModelComparison(customForecastInput(forecast,now),'nws','feelsSun');
  assert.equal(result.baseline[1],90,'the cloudy hour is physically inapplicable, not an invented missing sun hour');
});

test('independent UV/AQI products and deterministic rain amounts never become selected-model probabilities',()=>{
  const {forecast,now}=allMetricsFixture();
  for(const row of forecast.rainTimeline){row.rainLikelihood.sourceValues={nws:10,hrrr:100};row.precipitationBlend.sourceValues.hrrr=.2;}
  const input=customForecastInput(forecast,now);
  for(const metric of ['uv','aqi','rain']){
    const result=singleModelComparison(input,'hrrr',metric);
    assert.ok(result.baseline.some(value=>Number.isFinite(value)));
    assert.ok(result.selected.every(value=>value===null));
    assert.match(result.coverageNote,/does not supply/);
  }
});

test('one missing model hour invalidates means, peaks and derived values without hiding the published line',()=>{
  const {forecast,now}=allMetricsFixture();
  for(const field of ['wind','gust','dewpoint','cloud','pressure','visibility'])forecast.metricForecasts.series[field].find(row=>row.time==='2026-10-19T18:00:00.000Z').sources=[];
  const input=customForecastInput(forecast,now);
  for(const metric of ['wind','gust','dewpoint','humidity','cloud','pressure','visibility','feels']){
    const result=singleModelComparison(input,'nws',metric);
    assert.equal(result.selected[1],null,metric);assert.ok(Number.isFinite(result.baseline[1]),metric);
  }
});

test('snow keeps valid calendar zeros while rejecting a full-day fallback for partial today or mismatched periods',()=>{
  const {forecast,now}=allMetricsFixture(),input=customForecastInput(forecast,now);
  const hrrr=singleModelComparison(input,'hrrr','snow');assert.equal(hrrr.selected[1],0);
  const ecmwf=singleModelComparison(input,'ecmwf','snow');assert.equal(ecmwf.selected[0],null);assert.equal(ecmwf.selected[1],.3);
  assert.equal(singleModelComparison(input,'nam','snow').selected[1],0,'a snowfall-only model stays selectable');
  forecast.snow.days[1].amountWindow.end='2026-10-20T12:00:00.000Z';
  const mismatched=singleModelComparison(customForecastInput(forecast,now),'hrrr','snow');
  assert.equal(mismatched.baseline[1],null);assert.equal(mismatched.selected[1],null);
});

test('snow’s next-full-hour policy cannot create a forecast from a zero-length period just before midnight',()=>{
  const {forecast,now}=allMetricsFixture(Date.parse('2026-10-19T03:30:00Z'));
  const result=singleModelComparison(customForecastInput(forecast,now),'nws','snow');
  assert.equal(result.baseline[0],null);assert.equal(result.selected[0],null);
});

test('all hourly metric aggregates require the full 25-hour DST date',()=>{
  const {forecast,now}=allMetricsFixture(Date.parse('2026-11-01T02:30:00Z'),'2026-10-31');
  const complete=singleModelComparison(customForecastInput(forecast,now),'nws','wind');
  assert.equal(complete.days[1].metric.expectedHours,25);assert.equal(complete.selected[1],5);
  forecast.metricForecasts.series.wind.find(row=>row.time==='2026-11-01T06:00:00.000Z').sources=[];
  const missing=singleModelComparison(customForecastInput(forecast,now),'nws','wind');assert.equal(missing.selected[1],null);
});
