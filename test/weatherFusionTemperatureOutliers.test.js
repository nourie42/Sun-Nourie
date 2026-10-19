import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustTemperaturePolicy,TEMPERATURE_OUTLIER_VERSION} from '../src/weatherFusionTemperatureOutliers.js';
import {weighted,weightedTemperature} from '../src/weatherFusionDirect.js';
import {temperaturePolicy,forecastDayIndex} from '../src/weatherFusionPolicy.js';
import {buildForecast} from '../src/weatherFusion.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';

const policy={nws:.36,hrrr:.27,ecmwf:.09,nbm:.18,wn:.1};
const warm={nws:67,hrrr:66,ecmwf:66.3,nbm:65.2,wn:70.6};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} should equal ${b}`);

test('an isolated warm source retains one tenth of its share and gives the rest to ECMWF',()=>{
 const {policy:out,temperatureAdjustment:a}=adjustTemperaturePolicy(warm,policy,1);
 assert.equal(a.version,TEMPERATURE_OUTLIER_VERSION);assert.equal(a.applied,true);assert.equal(a.sourceId,'wn');assert.equal(a.recipientId,'ecmwf');
 close(out.wn,.01);close(out.ecmwf,.18);close(a.baseWeight,.1);close(a.weight,.01);close(a.transferredWeight,.09);
 assert.deepEqual(a.peerIds,['nws','hrrr','ecmwf','nbm']);close(a.peerMedian,66.15);close(a.peerMin,65.2);close(a.peerMax,67);close(a.deviation,4.45);
});

test('an isolated cold source uses the same rule',()=>{
 const result=adjustTemperaturePolicy({...warm,wn:60},policy,2);
 assert.equal(result.temperatureAdjustment.sourceId,'wn');close(result.policy.wn,.01);close(result.policy.ecmwf,.18);
});

test('only tomorrow and the following local calendar day receive the adjustment',()=>{
 for(const index of [0,3,6,-1,undefined])assert.equal(adjustTemperaturePolicy(warm,policy,index).temperatureAdjustment,null);
 for(const index of [1,2])assert.equal(adjustTemperaturePolicy(warm,policy,index).temperatureAdjustment.applied,true);
});

test('available weights normalize before transfer and conserve the complete share',()=>{
 const values={...warm,hrrr:null},{policy:out,temperatureAdjustment:a}=adjustTemperaturePolicy(values,policy,2);
 close(a.baseWeight,.1/.73);close(out.wn,.01/.73);close(out.ecmwf,.18/.73);
 close(Object.values(out).reduce((sum,value)=>sum+value,0),1);assert.equal(Object.hasOwn(out,'hrrr'),false);
 close(out.nws,.36/.73);close(out.nbm,.18/.73);
});

test('three sources cannot establish an isolated forecast',()=>{
 assert.equal(adjustTemperaturePolicy({nws:67,ecmwf:66,wn:74},policy,1).temperatureAdjustment,null);
});

test('ECMWF must be present and belong to the coherent peer cluster',()=>{
 assert.equal(adjustTemperaturePolicy({...warm,ecmwf:null},policy,1).temperatureAdjustment,null);
 assert.equal(adjustTemperaturePolicy({nws:66,hrrr:66,ecmwf:74,nbm:66,wn:66},policy,1).temperatureAdjustment,null);
});

test('a split between multiple warm and cold sources is left unchanged',()=>{
 const values={nws:66,hrrr:74,ecmwf:66,nbm:66,wn:74};
 assert.equal(adjustTemperaturePolicy(values,policy,1).temperatureAdjustment,null);
});

test('median deviation and distance outside the peer range must both meet their thresholds',()=>{
 const p={nws:.4,ecmwf:.1,nbm:.2,wn:.1};
 assert.equal(adjustTemperaturePolicy({nws:67,ecmwf:66,nbm:65,wn:70},p,1).temperatureAdjustment.applied,true);
 assert.equal(adjustTemperaturePolicy({nws:67,ecmwf:66,nbm:65,wn:69.999},p,1).temperatureAdjustment,null);
 assert.equal(adjustTemperaturePolicy({nws:68,ecmwf:65,nbm:65,wn:70},p,1).temperatureAdjustment,null,'a source only two degrees beyond the cluster is retained');
 assert.equal(adjustTemperaturePolicy({nws:68.1,ecmwf:65,nbm:65,wn:74},p,1).temperatureAdjustment,null,'a peer spread over three degrees is unresolved');
});

test('invalid values and nonpositive weights do not establish extra peers',()=>{
 for(const value of [null,NaN,Infinity,'66'])assert.equal(adjustTemperaturePolicy({...warm,hrrr:value,nbm:null},policy,1).temperatureAdjustment,null);
 for(const weight of [0,-1,NaN,Infinity])assert.equal(adjustTemperaturePolicy({...warm,nbm:null},{...policy,hrrr:weight},1).temperatureAdjustment,null);
});

test('raw model values and caller policy remain unchanged while weighting evidence identifies the transfer',()=>{
 const values=structuredClone(warm),weights=structuredClone(policy),out=weightedTemperature(values,1);
 assert.deepEqual(values,warm);assert.deepEqual(weights,policy);
 assert.equal(out.sources.find(source=>source.id==='wn').value,70.6);assert.equal(out.sources.find(source=>source.id==='wn').temperatureOutlier,true);
 close(out.sources.find(source=>source.id==='wn').baseWeight,.1);close(out.sources.find(source=>source.id==='ecmwf').receivedTemperatureWeight,.09);
 assert.ok(out.value<weighted(values,temperaturePolicy(1,true)).value);
 assert.deepEqual(weightedTemperature(values,0).sources,weighted(values,temperaturePolicy(0,true)).sources);
});

test('calendar boundaries use the selected location rather than a fixed 48-hour duration',()=>{
 const zone='America/New_York',now=Date.parse('2026-10-20T03:50Z');
 assert.equal(forecastDayIndex(Date.parse('2026-10-20T03:59Z'),now,zone),0);
 assert.equal(forecastDayIndex(Date.parse('2026-10-20T04:00Z'),now,zone),1);
 assert.equal(forecastDayIndex(Date.parse('2026-10-22T03:59Z'),now,zone),2);
 assert.equal(forecastDayIndex(Date.parse('2026-10-22T04:00Z'),now,zone),3);
});

function integrationFixture(){
 const input=structuredClone(testInputs),H=3600000;
 input.hourly.periods.forEach(hour=>{hour.temperature=70;hour.windSpeed='6 mph';hour.dewpoint={unitCode:'wmoUnit:degF',value:50};});
 input.forecast.periods.forEach(period=>{if(period.isDaytime)period.temperature=70;});
 for(const [field,uom,value] of [['temperature','wmoUnit:degF',70],['windSpeed','wmoUnit:mi_h-1',6],['dewpoint','wmoUnit:degF',50],['skyCover','wmoUnit:percent',0]])input.grid[field]={uom,values:[{validTime:new Date(input.now).toISOString()+'/P10D',value}]};
 input.models=Object.fromEntries(['hrrr','ecmwf','nbm','wn'].map(id=>{
  const raw=snapshot(id==='wn'?'nbm':id),point=raw.points[0],t={hrrr:69,ecmwf:70,nbm:71,wn:78}[id];
  point.hourly.temperature_2m.fill(t);point.hourly.dew_point_2m=point.hourly.time.map(()=>50);point.hourly.wind_speed_10m.fill(6);
  point.hourly_units.dew_point_2m='°F';
  return [id,{...point,direct:id!=='wn',verifiedModel:true,model:id,runAt:raw.runAt,validUntil:raw.validUntil,resolution:'Synthetic test model'}];
 }));
 return {input,H};
}

test('period hourly and canonical tail temperature share the rule while wind and dewpoint retain their weights',()=>{
 const {input,H}=integrationFixture(),out=buildForecast(input);
 const tomorrow=out.hours.find(hour=>Date.parse(hour.time)===input.now+24*H);
 assert.equal(tomorrow.temperatureBlend.temperatureAdjustment.sourceId,'wn');
 assert.equal(out.days[1].highBlend.temperatureAdjustment.sourceId,'wn');
 const first=out.metricForecasts.series.temperature.find(point=>Date.parse(point.time)===input.now+24*H);
 assert.equal(first.temperatureAdjustment.sourceId,'wn');assert.equal(first.sources.find(source=>source.id==='wn').temperatureOutlier,true);
 const tail=out.metricForecasts.series.temperature.find(point=>Date.parse(point.time)===input.now+53*H);
 assert.equal(forecastDayIndex(Date.parse(tail.time),input.now,out.location.timeZone),2);assert.equal(tail.temperatureAdjustment.sourceId,'wn');
 close(tail.sources.find(source=>source.id==='wn').weight,Number((.01/.73).toFixed(6)));
 const wind=out.metricForecasts.series.wind.find(point=>point.time===tail.time),dew=out.metricForecasts.series.dewpoint.find(point=>point.time===tail.time);
 for(const point of [wind,dew]){close(point.sources.find(source=>source.id==='wn').weight,Number((.1/.73).toFixed(6)));assert.equal(point.temperatureAdjustment,undefined);}
 const today=out.metricForecasts.series.temperature.find(point=>Date.parse(point.time)===input.now);assert.equal(today.temperatureAdjustment,null);
 assert.equal(input.models.wn.hourly.temperature_2m[0],78);
});
