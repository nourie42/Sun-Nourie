import test from 'node:test';
import assert from 'node:assert/strict';
import {customForecastInput,normalizeCustomWeights,changeCustomWeight,toggleCustomModel,customPresetWeights,blendCustomForecast,customForecastSummary} from '../public/weather-fusion/custom-forecast-model.js';
import {customForecastPath,customForecastScale,customRainChanceLabel} from '../public/weather-fusion/custom-forecast.js';

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
  assert.equal(customForecastPath([68,null,70],index=>index*10,value=>value),'M0.00,68.00M20.00,70.00');
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

test('probability chart scale is fixed and temperature scale handles constant values',()=>{
  assert.deepEqual(customForecastScale([3,4,5],'rain'),{min:0,max:100});
  const temperature = customForecastScale([67,67],'temperature');
  assert.ok(temperature.min<67 && temperature.max>67);
  assert.equal(customForecastScale([0,0],'amount').max,.04);
});

test('rain chance follows the existing low-chance presentation without altering the source number',()=>{
  assert.equal(customRainChanceLabel(0),'Low');
  assert.equal(customRainChanceLabel(4.9),'Low');
  assert.equal(customRainChanceLabel(5),'5%');
  assert.equal(customRainChanceLabel(null),'Unavailable');
  const source = fixture(); source.rainTimeline[0].officialPop=3;
  const result = blendCustomForecast(customForecastInput(source,NOW),{nws:100});
  assert.equal(result.hours[0].custom.rain.value,3);
  assert.equal(customRainChanceLabel(result.hours[0].custom.rain.value),'Low');
});
