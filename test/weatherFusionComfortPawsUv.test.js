import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalHumidity,thermalComfort} from '../public/weather-fusion/weather-math.js';
import {currentComfortInputs} from '../public/weather-fusion/current-inputs.js';
import {currentSample,forecastSample} from '../public/weather-fusion/weather-display.js';
import {integrateSurface,solarRadiation,skyLongwave,pavementEstimate} from '../public/weather-fusion/pavement.js';
import {uvCategory} from '../public/weather-fusion/daily-uv.js';
import {danCard,danOverview} from '../public/weather-fusion/dans-summary.js';
import {collectDanTakeEvidence,approveDanTake} from '../public/weather-fusion/dans-take.js';
import {normalizeExposureWeather,addExposureWeather,exposureWeatherUrl} from '../src/weatherFusionExposure.js';
import {fixture} from '../scripts/weatherNourieFixture.js';
const H=3600000,now=Date.parse('2026-09-05T17:00:00Z');
const location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York',office:'RAH'};
export function exposureFixture(time=now){
 const start=Math.floor(time/H)*H-48*H;
 return {source:'Open-Meteo',rows:Array.from({length:51},(_,i)=>{
  const epoch=start+i*H,dayHour=new Date(epoch).getUTCHours()-4;
  const sunlight=Math.max(0,Math.sin((dayHour-6)/12*Math.PI));
  return {time:new Date(epoch).toISOString(),temperature:73+17*sunlight,dewpoint:65,humidity:55,wind:5,skyCover:10,solar:800*sunlight,rain:0};
 }),uv:Array.from({length:9},(_,i)=>({date:new Date(start+i*24*H).toISOString().slice(0,10),value:7-i*.2}))};
}
test('missing station wind and moisture use labelled same-hour inputs without changing observed air',()=>{
 const f=fixture('knightdale',now);f.current.wind=null;f.current.humidity=null;f.current.dewpoint=null;
 const original=structuredClone(f.current),inputs=currentComfortInputs(f,now);
 assert.equal(inputs.temperature,original.temperature);assert.ok(Number.isFinite(inputs.wind));assert.ok(Number.isFinite(thermalHumidity(inputs)));
 assert.deepEqual(f.current,original);assert.deepEqual(inputs.comfortEstimatedFields,['wind','dewpoint']);
 assert.match(inputs.comfortSourceNote,/current forecast hour/);assert.ok(Number.isFinite(currentSample(f,now).feels));
 const next=forecastSample(f,f.hours[1].time);assert.equal(next.temperature,f.hours[1].temperature);
});
test('zero wind is a real observation, and invalid dewpoint can use valid station RH',()=>{
 const f=fixture('knightdale',now);f.current.wind=0;f.current.dewpoint=110;f.current.humidity=45;
 const inputs=currentComfortInputs(f,now);assert.deepEqual(inputs.comfortEstimatedFields,[]);
 assert.equal(thermalHumidity(inputs),45);assert.ok(Number.isFinite(thermalComfort(inputs,location,now).outdoors));
 assert.equal(skyLongwave({...inputs,skyCover:0}),skyLongwave({...inputs,skyCover:0,dewpoint:null}));
});
test('missing current input never borrows a future hour or an old snapshot',()=>{
 const f=fixture('knightdale',now);f.current.wind=null;
 f.metricForecasts.series.feels=f.metricForecasts.series.feels.filter(p=>Date.parse(p.time)>now);
 assert.equal(currentComfortInputs(f,now).wind,null);
 const fresh=fixture('knightdale',now);fresh.current.wind=null;
 assert.equal(currentComfortInputs(fresh,now+2*H).wind,null);
});
test('a missing whole companion feed leaves an honest missing value',()=>{
 const f=fixture('knightdale',now);f.current.wind=null;f.metricForecasts.series.feels=[];
 assert.equal(currentSample(f,now).feels,null);
});
test('a snapshot rendered across the hour uses the same companion inputs as its API',()=>{
 const time=now+59*60000,f=fixture('knightdale',time);f.current.wind=null;
 assert.deepEqual(currentComfortInputs(f,time),currentComfortInputs(f,time+2*60000));
});
test('clouds reduce solar radiation but increase nighttime downwelling thermal radiation',()=>{
 const row={temperature:85,dewpoint:65,wind:5,skyCover:0};
 assert.ok(solarRadiation(row,location,now)>solarRadiation({...row,skyCover:100},location,now));
 assert.equal(solarRadiation(row,location,Date.parse('2026-09-06T06:00:00Z')),0);
 assert.ok(skyLongwave({...row,skyCover:100})>skyLongwave(row));
 assert.equal(solarRadiation({...row,solar:700,skyCover:100},location,now),700,'model radiation already includes clouds');
});
test('dark asphalt is hotter than concrete on a sunny afternoon; both show a range',()=>{
 const f={assembledAt:new Date(now).toISOString(),location,exposureWeather:exposureFixture()};
 const result=pavementEstimate(f,{temperature:90,dewpoint:65,wind:5,skyCover:10},now);
 assert.equal(result.status,'estimated');assert.ok(result.asphalt.value>result.concrete.value);
 for(const material of [result.asphalt,result.concrete]){assert.ok(material.low<material.value);assert.ok(material.high>material.value);assert.ok(material.value>90&&material.value<160);}
 assert.doesNotMatch(result.advice,/safe for paws|burns? at/i);
});
test('thermal inertia survives sudden cloud, sunset and increasing wind',()=>{
 const base=exposureFixture().rows.filter(r=>Date.parse(r.time)<=now).map(r=>({...r,epoch:Date.parse(r.time)}));
 const run=tail=>integrateSurface([...base,...tail],location,{albedo:.1,k:1.5});
 const before=run([]),last=base.at(-1);
 const oneMinute=run([{...last,epoch:now+60000,solar:0}]);
 const hourLater=run([{...last,epoch:now+H,solar:0}]);
 assert.ok(Math.abs(before-oneMinute)<2,'no instantaneous temperature jump');assert.ok(hourLater<oneMinute);
 const windy=integrateSurface(base,location,{albedo:.1,k:1.5,windFactor:2});assert.ok(windy<before);
 const coolHistory=base.map(r=>({...r,solar:0}));
 assert.ok(integrateSurface(coolHistory,location,{albedo:.1,k:1.5})<hourLater,'earlier sunshine leaves stored heat');
});
test('surface integrator converges at a half-sized step and rejects missing hours',()=>{
 const rows=exposureFixture().rows.map(r=>({...r,epoch:Date.parse(r.time)}));
 const a=integrateSurface(rows,location,{stepSeconds:60}),b=integrateSurface(rows,location,{stepSeconds:30});
 assert.ok(Math.abs(a-b)<.15);
 rows.splice(5,2);assert.equal(integrateSurface(rows,location),null);
});
test('wet/frozen context is disclosed and missing history is never assumed dry/zero',()=>{
 const f={assembledAt:new Date(now).toISOString(),location,exposureWeather:exposureFixture()};
 f.exposureWeather.rows.find(r=>Date.parse(r.time)===now).rain=2;
 assert.equal(pavementEstimate(f,{temperature:85,dewpoint:65,wind:5},now).wet,true);
 assert.equal(pavementEstimate(f,{temperature:30,dewpoint:25,wind:5},now).frozen,true);
 f.exposureWeather.rows=f.exposureWeather.rows.slice(-3);
 assert.equal(pavementEstimate(f,{temperature:85},now).status,'unavailable');
});
test('UV daily maxima are matched by local date, never past_days array position',()=>{
 const u={temperature_2m:'°F',wind_speed_10m:'mp/h',shortwave_radiation_instant:'W/m²'};
 const data=normalizeExposureWeather({timezone:'America/Los_Angeles',hourly_units:u,hourly:{time:[now/1000],temperature_2m:[80],wind_speed_10m:[5]},daily:{time:[Date.parse('2026-09-04T07:00Z')/1000,Date.parse('2026-09-05T07:00Z')/1000],uv_index_max:[4,8.4]}});
 const out={days:[{date:'2026-09-05'},{date:'2026-09-06'}]};addExposureWeather(out,data);
 assert.equal(out.uv.today,8.4);assert.equal(out.days[1].uvMax,null);
 assert.match(exposureWeatherUrl(location),/daily=uv_index_max/);
});
test('UV dates correctly match local midnight across DST',()=>{
 const raw={timezone:'America/New_York',hourly_units:{temperature_2m:'°F',wind_speed_10m:'mp/h',shortwave_radiation_instant:'W/m²'},hourly:{time:[]},daily:{time:[Date.parse('2026-11-01T04:00Z')/1000,Date.parse('2026-11-02T05:00Z')/1000],uv_index_max:[2,3]}};
 assert.deepEqual(normalizeExposureWeather(raw).uv.map(x=>x.date),['2026-11-01','2026-11-02']);
});
test('UV categories use displayed whole number; zero, extreme, null and NaN handled',()=>{
 for(const [value,category,index] of [[0,'Low',0],[2.49,'Low',2],[2.5,'Moderate',3],[5.5,'High',6],[7.5,'Very high',8],[10.5,'Extreme',11],[14,'Extreme',14]]){
  const u=uvCategory(value);assert.equal(u.label,category);assert.equal(u.index,index);
 }
 for(const value of [null,undefined,NaN,-1,'3'])assert.equal(uvCategory(value).label,'Unavailable');
});
function discussionForecast(text){return {signature:'s',location,feeds:[{id:'afd',status:'ready'}],days:[{detail:'Warm and humid today.',nightDetail:'Mild tonight.'}],discussion:{id:'afd',office:'RAH',issuanceTime:new Date(now-H).toISOString(),text}};}
test('Dan always has a concise summary, including a wrapped synopsis and no forecast changes',()=>{
 const f=discussionForecast('.SYNOPSIS...\nHot and humid weather continues\ntoday. A cooler, rainy weekend is coming.\n&&\n.LONG TERM...\nDry later.');
 const card=danCard({mode:'nws-summary'},f,now);
 assert.equal(card.text,'Hot and humid weather continues today. A cooler, rainy weekend is coming.');assert.equal(card.changes,'');
});
test('Dan combines verified AFD overview with supported changes, rejects stale AI overview',()=>{
 const f=discussionForecast('.SHORT TERM /SUNDAY/...\nSunday rainfall amounts remain uncertain.');
 const evidence=collectDanTakeEvidence(f,now),approved=approveDanTake([{evidenceId:evidence.candidates[0].id,summary:'Rainfall amounts could be higher or lower.'}],f,now);
 const b={mode:'ai',signature:'s',summary:'Hot and humid today, with rain coming on Sunday.',...approved};
 const card=danCard(b,f,now);assert.match(card.text,/^Hot and humid today/);assert.match(card.changes,/Sunday.*Rainfall amounts/);
 f.discussion.id='replacement';assert.doesNotMatch(danOverview(b,f,now).text,/rain coming on Sunday/);
 assert.doesNotMatch(danOverview(b,f,now+13*H).text,/Hot and humid today/);
});
test('Dan preserves source weather meaning when AI fails and clears on location loading',()=>{
 const f=discussionForecast('.SYNOPSIS...\nSummer precipitation is possible today.\n&&');
 assert.doesNotMatch(danCard({},f,now).text,/snow/);
 assert.match(danCard({},null,now).text,/Checking/);
});
test('NWS key messages and changed-forecast sections support a quick weekend overview',()=>{
 const f=discussionForecast('.WHAT HAS CHANGED...\nLimited cooling this weekend, with heat returning Monday.\n&&\n.KEY MESSAGES...\nAs of 1200 PM Saturday...\n\n1) Hot weather today, with limited cooling\nthis weekend.\n\n2) Rain may return Sunday.\n&&');
 const card=danCard({},f,now);
 assert.match(card.text,/^Hot weather today, with limited cooling this weekend\. Rain may return Sunday\./);
 assert.match(card.changes,/Limited cooling/);assert.ok(card.sourceExcerpt);
});
test('Dan expires old relative AI wording at midnight and anchors source tomorrow to its issuance',()=>{
 const late=Date.parse('2026-09-11T03:00:00Z'),after=Date.parse('2026-09-11T04:10:00Z');
 const f=discussionForecast('.SYNOPSIS...\nRain returns tomorrow.\n&&\n.SHORT TERM /FRIDAY/...\nTomorrow rainfall amounts remain uncertain.\n&&');
 f.discussion.issuanceTime=new Date(late).toISOString();
 const b={mode:'ai',signature:'s',generatedAt:new Date(late+30*60000).toISOString(),summary:'Rain arrives tomorrow.',...approveDanTake([],f,late)};
 const card=danCard(b,f,after);
 assert.doesNotMatch(card.text,/tomorrow/i);assert.match(card.text,/Friday, Sep 11/);
});
test('retained key messages use their own As-of day, not the newer product date',()=>{
 const after=Date.parse('2026-09-11T06:00:00Z');
 const f=discussionForecast('.KEY MESSAGES...\nAs of 1100 PM Thursday...\nRain arrives tomorrow morning.\n&&');
 f.discussion.issuanceTime='2026-09-11T05:50:00Z';
 const card=danCard({},f,after);
 assert.doesNotMatch(card.text,/tomorrow/i);assert.match(card.text,/Friday, Sep 11 morning/);
});
test('a retained overview older than one day is not recycled into a fresh product',()=>{
 const f=discussionForecast('.KEY MESSAGES...\nAs of 1100 PM Wednesday...\nHeavy rain is coming tomorrow.\n&&');
 f.discussion.issuanceTime='2026-09-11T05:50:00Z';
 const card=danCard({},f,Date.parse('2026-09-11T06:00:00Z'));
 assert.doesNotMatch(card.text,/Heavy rain/);assert.match(card.source,/discussion summary unavailable/);
});
