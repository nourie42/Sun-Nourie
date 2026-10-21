import test from 'node:test';
import assert from 'node:assert/strict';
import {tier3FeelsLike,thermalComfort} from '../public/weather-fusion/weather-math.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
import {utciF} from '../public/weather-fusion/utci.js';
const place={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
const time=Date.parse('2026-10-21T18:00:00Z');
const input={temperature:68,dewpoint:43.7,wind:9.7,skyCover:1.1199,solarRadiation:695.2,condition:'Sunny'};
test('the reported mild sunny conditions share an apparent-temperature baseline and keep the solar difference',()=>{
 const original=structuredClone(input);
 const shade=tier3FeelsLike(input,place,time,'shade'),sun=tier3FeelsLike(input,place,time,'outdoors');
 assert.ok(shade.value>62&&shade.value<63);
 assert.ok(sun.value>76&&sun.value<78);
 // Published Steadman equation, evaluated independently of shadeFeelsLike:
 // vapor pressure from dew point, Celsius and wind in metres per second.
 const td=(43.7-32)/1.8,e=6.112*Math.exp(17.67*td/(td+243.5));
 const apparent=(20+.33*e-.7*(9.7*.44704)-4)*1.8+32;
 assert.ok(Math.abs(shade.shadeApparentBaselineF-apparent)<1e-9);
 assert.equal(shade.mildWeatherAdjustmentF,sun.mildWeatherAdjustmentF);
 const utciShade=utciF(68,shade.tr,9.7,shade.rh),utciSun=utciF(68,sun.tr,9.7,sun.rh);
 assert.ok(Math.abs((sun.value-shade.value)-(utciSun-utciShade))<1e-9);
 assert.deepEqual(input,original);
});
test('night and overcast use the same baseline for both exposures without invented sunlight',()=>{
 for(const [sample,epoch] of [[{...input,skyCover:100,solarRadiation:0},time],[input,Date.parse('2026-10-22T03:00:00Z')]]) {
  const c=thermalComfort(sample,place,epoch);assert.equal(c.rawOutdoors,c.rawShade);
 }
});
test('cold and hot models, missing inputs and smooth boundary joins are preserved',()=>{
 for(const temperature of [30,50,55,85,95]) {
  const r=tier3FeelsLike({...input,temperature,dewpoint:null,humidity:50},place,time,'shade');
  assert.equal(r.mildWeatherWeight,0);assert.equal(r.mildWeatherAdjustmentF,0);
 }
 for(const temperature of [55,65,75,85]) {
  const before=tier3FeelsLike({...input,temperature:temperature-.001},place,time,'outdoors');
  const after=tier3FeelsLike({...input,temperature:temperature+.001},place,time,'outdoors');
  assert.ok(Math.abs(after.value-before.value)<.02);
 }
 for(const missing of [{wind:null},{temperature:null},{dewpoint:null}])assert.equal(tier3FeelsLike({...input,...missing},place,time).value,null);
});
test('both card footers identify feels-like with correct day, night and weather wording',()=>{
 for(const [daylight,weatherKind,condition,label] of [[true,'clear','Sunny','Feels like in sun'],[true,'partly-cloudy','Partly Cloudy','Feels like in sunny breaks'],[true,'cloudy','Overcast','Feels like outdoors'],[false,'clear','Clear','Feels like at night']]) {
  const html=sunShadeHTML({daylight,weatherKind,condition,shade:62,outdoors:77,sun:77},place,time,{compact:true});
  assert.match(html,/<span class="shade-reading-label">Feels like in shade<\/span>/);
  assert.ok(html.includes(`<span class="sun-reading-label">${label}</span>`));
 }
});
