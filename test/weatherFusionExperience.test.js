import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dailyDisplay,temperatureBar,shadeFeelsLike,thermalComfort,wetBulb,vaporPressureFromDewpoint,radiationFeelsLike,estimatedAbsorbedRadiation} from '../public/weather-fusion/weather-math.js';
import {gridSample,parseWind,PLAIN_OUTLOOK_INSTRUCTIONS} from '../src/weatherFusionExperience.js';
import {buildForecast} from '../src/weatherFusion.js';
import {testInputs} from './weatherFusion.fixtures.js';
const day={label:'Today',high:86,low:68,pop:60,popNight:30,condition:'Sunny',nightCondition:'Chance Showers',nightDetail:'A few showers overnight.'};
test('first row changes at 3 PM in the LOCATION timezone, not browser timezone',()=>{
 assert.equal(dailyDisplay(day,0,Date.parse('2026-09-05T18:59:59Z'),'America/New_York').label,'Today');
 const p=dailyDisplay(day,0,Date.parse('2026-09-05T19:00:00Z'),'America/New_York');
 assert.equal(p.label,'Tonight');assert.equal(p.primary,68);assert.equal(p.secondary,null);assert.equal(p.pop,30);assert.equal(p.condition,'Chance Showers');
 assert.equal(dailyDisplay(day,0,Date.parse('2026-09-05T19:00:00Z'),'America/Los_Angeles').label,'Today');
 assert.equal(dailyDisplay(day,1,Date.parse('2026-09-05T23:00:00Z'),'America/New_York').primary,86);
});
test('Tonight never invents or relabels a missing high',()=>{
 const p=dailyDisplay({...day,high:null},0,Date.parse('2026-09-05T23:00:00Z'),'America/New_York');assert.equal(p.primary,68);assert.equal(p.primaryLabel,'Low');
});
test('day temperature bars end at the high, increase with the high and preserve zero',()=>{
 assert.equal(temperatureBar(80,60,100),50);assert.ok(temperatureBar(95,60,100)>temperatureBar(80,60,100));assert.equal(temperatureBar(0,-10,10),50);assert.equal(temperatureBar(null,60,100),null);
});
test('NWS grid intervals are start-inclusive, end-exclusive, and units are checked',()=>{
 const grid={relativeHumidity:{uom:'wmoUnit:percent',values:[{validTime:'2026-09-05T16:00:00Z/PT2H',value:84}]},windSpeed:{uom:'wmoUnit:km_h-1',values:[{validTime:'2026-09-05T16:00:00Z/PT2H',value:16.09344}]}};
 assert.equal(gridSample(grid,'relativeHumidity',Date.parse('2026-09-05T16:00:00Z'),'percent'),84);
 assert.equal(gridSample(grid,'relativeHumidity',Date.parse('2026-09-05T18:00:00Z'),'percent'),null);
 assert.ok(Math.abs(gridSample(grid,'windSpeed',Date.parse('2026-09-05T17:00Z'),'wind')-10)<.001);
 grid.relativeHumidity.uom='wrong';assert.equal(gridSample(grid,'relativeHumidity',Date.parse('2026-09-05T16:00Z'),'percent'),null);
 assert.equal(parseWind('5 to 10 mph'),10);assert.equal(parseWind('Calm'),0);assert.equal(parseWind('10 km/h'),null);
});
test('extended paired graph data comes from forecasts and does not hold current pressure or visibility flat',()=>{
 const output=buildForecast({...testInputs,models:{}});
 assert.equal(output.metricForecasts.series.temperature.length,241);
 assert.equal(output.metricForecasts.series.feels.length,241);
 assert.deepEqual(output.metricForecasts.series.temperature.map(p=>p.time),output.metricForecasts.series.feels.map(p=>p.time));
 assert.equal(output.metricForecasts.series.pressure.every(p=>p.value===null),true);
 assert.equal(output.metricForecasts.series.visibility.every(p=>p.value===null),true);
 assert.ok(Math.abs(output.metricForecasts.series.humidity[0].value-58.2)<.1);
 assert.equal(output.metricForecasts.series.wind[0].value,10);
 assert.ok(output.metricForecasts.series.feels.some(p=>Number.isFinite(p.value)));
 assert.equal(output.metricForecasts.solar.length,7);
});
test('lower dew point makes the same mild weather feel cooler',()=>{
 const humid=shadeFeelsLike(78,null,5,70),dry=shadeFeelsLike(78,null,5,45);
 assert.ok(Number.isFinite(humid.value)&&Number.isFinite(dry.value));
 assert.ok(dry.value<humid.value,`dry=${dry.value} humid=${humid.value}`);
 assert.ok(vaporPressureFromDewpoint(78,45,null)<vaporPressureFromDewpoint(78,70,null));
 assert.match(dry.method,/Steadman apparent temperature/);
});
test('one Steadman equation family is used in cold mild and hot weather',()=>{
 for(const sample of [shadeFeelsLike(30,95,15,29),shadeFeelsLike(70,50,8,50),shadeFeelsLike(95,47,5,72)])assert.match(sample.method,/Steadman apparent temperature/);
 const coldWindy=shadeFeelsLike(30,70,20,20),coldCalm=shadeFeelsLike(30,70,2,20);
 assert.ok(coldWindy.value<coldCalm.value);
 const coldDry=shadeFeelsLike(30,null,15,-5),coldDamp=shadeFeelsLike(30,null,15,29);
 assert.ok(coldDry.value<coldDamp.value);
});
test('hot humidity raises all-weather apparent temperature without switching to heat index',()=>{
 const humid=shadeFeelsLike(95,null,5,72),dry=shadeFeelsLike(95,null,5,45);
 assert.ok(humid.value>dry.value);assert.match(humid.method,/all-weather shade/);
 assert.equal(Math.round(humid.value),101);
});
test('direct sun uses the radiation-inclusive Steadman equation and bounded absorbed radiation',()=>{
 const q=estimatedAbsorbedRadiation('Sunny',Math.PI/2);assert.equal(Math.round(q),130);
 const shade=shadeFeelsLike(90,null,5,65),sun=radiationFeelsLike(90,null,5,65,q);
 assert.ok(sun.value>shade.value);assert.match(sun.method,/with radiation/);
 const c=thermalComfort({temperature:95,humidity:47,dewpoint:72,wind:5,condition:'Sunny',type:'observation'},{latitude:35.787,longitude:-78.4806},Date.parse('2026-09-05T17:00:00Z'));
 assert.ok(c.absorbedRadiation>=0&&c.absorbedRadiation<=130);assert.ok(c.sun>=c.shade);
 assert.match(c.note,/does not add a fake urban bonus or penalty|hot sidewalk/);
});
test('wet bulb stays diagnostic and is not double-counted into the final real-feel value',()=>{
 assert.equal(wetBulb(20,50),null);
 const c=thermalComfort({temperature:79,humidity:84,dewpoint:73,wind:5,condition:'Clear'},{latitude:35.787,longitude:-78.4806},Date.parse('2026-09-06T05:00:00Z'));
 assert.equal(c.daylight,false);assert.equal(c.sun,null);assert.ok(c.shade>79);
 assert.match(c.note,/not added again/);
});
test('plain-language outlook prompt prioritizes local discussion and keeps required attribution',()=>{
 assert.match(PLAIN_OUTLOOK_INSTRUCTIONS,/latest local NWS Area Forecast Discussion/);
 assert.match(PLAIN_OUTLOOK_INSTRUCTIONS,/middle-school/);assert.match(PLAIN_OUTLOOK_INSTRUCTIONS,/current local time/);
 assert.match(PLAIN_OUTLOOK_INSTRUCTIONS,/sources array/);assert.match(PLAIN_OUTLOOK_INSTRUCTIONS,/Never promise safety/);
});
test('all cards have dialog graphs and science is below the main experience',()=>{
 const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
 const client=fs.readFileSync(new URL('../public/weather-fusion/experience.js',import.meta.url),'utf8');
 assert.match(html,/id="metric-dialog"/);assert.match(html,/id="chart-scrubber"/);
 assert.ok(html.indexOf('SCIENTIFIC STUFF')>html.indexOf('id="metrics"'));
 assert.ok(!html.includes('Back to Sun-Nourie'));assert.ok(!html.includes('Weather Fusion'));
 assert.ok(!html.includes('Uses NWS heat index'));assert.ok(!html.includes('NWS Wind Chill'));
 assert.match(html,/One formula in every season/);assert.match(html,/radiation-inclusive/);
 assert.match(client,/data-metric/);assert.match(client,/showModal/);assert.match(client,/made-up line/);
});
