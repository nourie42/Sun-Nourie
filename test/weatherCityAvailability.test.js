import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGefs} from '../src/weatherFusionGefs.js';
import {createWeatherTransport,createWeatherRequestBudget} from '../src/weatherFusionTransport.js';
import {buildForecast} from '../src/weatherFusion.js';
import {inputs,now} from './weatherFusion.fixtures.js';
import {danTakeDisplay,danOverview,weatherOnlyProse} from '../public/weather-fusion/dans-summary.js';
const H=3600000;
function ensemble(){
 const time=[0,1,2].map(h=>(now+h*H)/1000),hourly={time},hourly_units={time:'unixtime'};
 for(let i=0;i<31;i++)for(const [field,unit,v] of [['temperature_2m','°F',60],['cloud_cover','%',i],['precipitation','inch',0]]){
  const key=field+(i?'_member'+String(i).padStart(2,'0'):'');hourly[key]=[v,v,v];hourly_units[key]=unit;
 }
 return {latitude:35.787,longitude:-78.4806,hourly,hourly_units};
}
const place={latitude:35.787,longitude:-78.4806},meta={last_run_initialisation_time:now/1000,data_end_time:(now+3*H)/1000};
test('GEFS cloud comparison requires all 31 genuine members with percent units',()=>{
 const d=ensemble(),m=validateGefs(d,meta,place,now);
 assert.equal(m.hourly.cloud_cover[1],15);assert.equal(m.hourly_units.cloud_cover,'%');
 d.hourly.cloud_cover_member01[1]=null;
 assert.equal(validateGefs(d,meta,place,now).hourly.cloud_cover[1],null);
 assert.equal(validateGefs(d,meta,place,now).hourly.temperature_2m[1],60);
 d.hourly_units.cloud_cover='fraction';assert.equal(validateGefs(d,meta,place,now).hourly.cloud_cover,undefined);
});
test('all-location comparison can use GEFS clouds when named point models are offline',()=>{
 const x=structuredClone(inputs),base=x.models.ecmwf;
 x.grid.skyCover={uom:'wmoUnit:percent',values:[{validTime:'2026-09-04T04:00:00Z/P10D',value:20}]};
 const gefs={...base,model:'gefs',verifiedModel:true,runAt:new Date(now).toISOString(),hourly:{...base.hourly,cloud_cover:base.hourly.time.map(()=>20)},hourly_units:{...base.hourly_units,cloud_cover:'%'}};
 const f=buildForecast({...x,models:{gefs},blendV2:true});
 const first=f.metricForecasts.series.feels.find(p=>p.inputs?.skyComparisonSources?.some(s=>s.id==='gefs'));
 assert.ok(first,'Real GEFS cloud values reach canonical hourly inputs');
 assert.equal(first.inputs.skyComparisonSources.find(s=>s.id==='gefs').weight,0,'Comparison does not secretly change the published cloud blend');
 assert.ok(f.days[0].confidence.weather.evidence.sky.hours.some(h=>h.sources.some(s=>s.id==='gefs')));
 assert.ok(f.days[0].confidence.weather.evidence.sky.comparedHours>0);
 assert.ok(f.days[0].confidence.weather.evidence.sky.hours.every(h=>h.sources.filter(s=>s.id==='gefs').length<=1),'31 members remain one named model source');
});
test('a forecast rate limit is shared by point and winter requests but not unrelated products',async()=>{
 let clock=now,calls=[];
 const fetch=createWeatherTransport(async url=>{calls.push(url);return new Response('{}',{status:url.includes('/v1/forecast')?429:200,headers:{'Retry-After':'120'}});},()=>clock);
 await fetch('https://api.open-meteo.com/v1/forecast?models=gfs_hrrr');
 assert.equal((await fetch('https://api.open-meteo.com/v1/forecast?hourly=snowfall')).status,429);assert.equal(calls.length,1);
 await fetch('https://api.open-meteo.com/data/ncep_gefs025/static/meta.json');await fetch('https://ensemble-api.open-meteo.com/v1/ensemble');assert.equal(calls.length,3);
 clock+=121000;await fetch('https://api.open-meteo.com/v1/forecast?models=gfs_hrrr');assert.equal(calls.length,4);
});
test('discussion referrals are removed before URL punctuation becomes fake weather sentences',()=>{
 const source='For the latest NE FL and SE GA Daily Key Messages please visit:\nhttps:/www.weather.gov/media/jax/briefings/nws-jax-briefing.pdf\n\nRain may develop tonight.';
 assert.equal(weatherOnlyProse(source),'Rain may develop tonight.');
 const x=structuredClone(inputs),f=buildForecast(x);f.discussion={...f.discussion,issuedAt:new Date(now).toISOString(),text:'.KEY MESSAGES...\n'+source+'\n&&\n.NEAR TERM /TODAY/...\nShowers may develop tonight.\n&&'};
 const summary=danOverview(null,f,now).text;assert.doesNotMatch(summary,/https|www|please visit|latest.*messages/i);assert.match(summary,/rain|showers/i);
 const bad=danTakeDisplay({signature:f.signature,danSummary:'Please visit the National Weather Service for more information.'},f,now);assert.doesNotMatch(bad,/please visit|weather\.gov|https:/i);
});

test('supplemental requests cannot consume reserved forecast capacity; total ceiling remains bounded',()=>{
 let clock=now;const use=createWeatherRequestBudget(()=>clock);
 for(let i=0;i<200;i++)use('https://api.open-meteo.com/v1/forecast');
 assert.throws(()=>use('https://api.open-meteo.com/v1/forecast'),/preserve core/);
 for(let i=0;i<200;i++)use('https://api.weather.gov/gridpoints/RAH/1,1/forecast');
 assert.throws(()=>use('https://api.weather.gov/points/35,-78'),/budget reached/);
 clock+=60000;assert.doesNotThrow(()=>use('https://api.weather.gov/points/35,-78'));
 assert.doesNotThrow(()=>use('https://api.open-meteo.com/v1/forecast'));
});

test('missing official rainfall amount averages the available model amounts instead of hiding them',()=>{
 const x=structuredClone(inputs);x.grid.quantitativePrecipitation.values=[];
 const base=x.models.ecmwf;x.models={ecmwf:{...base,verifiedModel:true,runAt:new Date(now).toISOString(),precipitationIntervals:base.hourly.time.slice(1).map(t=>({start:t-3600,end:t,value:.02}))}};
 const f=buildForecast({...x,blendV2:true}),row=f.rainTimeline.find(r=>r.precipitationBlend.comparisonSources?.some(s=>s.id==='ecmwf'));
 assert.ok(row);assert.equal(row.precipitationBlend.value,.02);assert.deepEqual(row.precipitationBlend.sources.map(s=>s.id),['ecmwf']);
 assert.equal(row.precipitationBlend.comparisonSources.find(s=>s.id==='ecmwf').value,.02);
});
