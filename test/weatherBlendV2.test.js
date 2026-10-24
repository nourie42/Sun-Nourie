import test from 'node:test';import assert from 'node:assert/strict';
import {BLEND_V2_CONFIG,blendBand,blendV2,calibratedProbabilityV2,officialRainV2} from '../src/weatherFusionBlendV2.js';
import {validateWeatherNext3} from '../src/weatherFusionWeatherNext3.js';
const H=3600000,issuedAt=Date.parse('2026-10-24T00:00:00Z');
const values={nws:60,hrrr:62,nbm:64,ecmwf:66,gefs:68,weathernext3:70};const eligible=Object.fromEntries(Object.keys(values).map(id=>[id,true]));
test('all sixteen exact requested tables retain 100 points, contiguous ranges and reserved future settings',()=>{
 for(const variable of ['temperature','rain_probability','rain_amount']){
  const bands=BLEND_V2_CONFIG.variables[variable].bands;
  for(const [i,b] of bands.entries()){assert.equal(Object.values(b.weights_percent).reduce((a,b)=>a+b),100);if(i)assert.equal(b.start_hour_inclusive,bands[i-1].end_hour_exclusive);assert.equal(blendBand(variable,b.start_hour_inclusive),b);}
 }
 assert.equal(blendBand('temperature',360),null);assert.equal(blendBand('temperature',-1),null);
});
test('12h, 60h and 190h temperatures use exact requested shares and never extend HRRR or NWS horizons',()=>{
 const at=h=>blendV2(values,{validTime:issuedAt+h*H,issuedAt,eligible});
 assert.deepEqual(at(12).policy,{nws:.2,hrrr:.25,nbm:.25,ecmwf:.15,weathernext3:.15});
 assert.deepEqual(at(60).policy,{nws:.15,nbm:.25,ecmwf:.25,gefs:.1,weathernext3:.25});
 assert.deepEqual(at(190).policy,{nbm:.1,ecmwf:.3,gefs:.2,weathernext3:.4});
 assert.equal(at(300).policy.nbm,undefined);assert.ok(at(12).value>60&&at(12).value<70);
});
test('wrong/stale/unconfigured inputs have zero weight and are explained, never renamed',()=>{
 const b=blendV2({...values,wn:100},{validTime:issuedAt+60*H,issuedAt,eligible:{...eligible,gefs:'GEFS not configured',weathernext3:'WeatherNext 3 stale'}});
 assert.equal(b.policy.gefs,undefined);assert.equal(b.policy.weathernext3,undefined);assert.equal(b.policy.wn,undefined);assert.equal(b.excluded.gefs,'GEFS not configured');
 assert.ok(Math.abs(b.sources.reduce((a,s)=>a+s.weight,0)-1)<1e-10);
 const missing=blendV2({},{validTime:issuedAt,issuedAt,eligible});assert.equal(missing.value,null);
});
test('a valid calibrated rain blend retains exactly 40 NWS points when HRRR is absent',()=>{
 const start=issuedAt+12*H,end=start+H;
 const input=(id,value)=>({kind:id==='nws'?'official-probability':'calibrated-probability',calibrationVersion:'validated-test-v1',verified:true,fresh:true,start,end,thresholdInches:.01,value});
 const inputs=Object.fromEntries(['nws','nbm','ecmwf','weathernext3'].map(id=>[id,input(id,50)]));
 const b=calibratedProbabilityV2(inputs,{start,end,issuedAt});
 assert.equal(b.policy.nws,.4);assert.equal(b.policy.nbm,.3);assert.equal(b.policy.ecmwf,.15);assert.equal(b.policy.weathernext3,.15);assert.equal(b.value,50);
 inputs.nbm.kind='deterministic-wet-signal';inputs.ecmwf.start-=H;inputs.weathernext3.thresholdInches=.1;
 const official=calibratedProbabilityV2(inputs,{start,end,issuedAt});assert.deepEqual(official.policy,{nws:1});assert.equal(official.mode,'nws-fallback');
 delete inputs.nws;assert.equal(calibratedProbabilityV2(inputs,{start,end,issuedAt}).value,null);
 assert.equal(officialRainV2(20).value,20);assert.equal(officialRainV2(null).value,null);assert.equal(officialRainV2(0).value,0);
});
function feed(){return {schema:'weather-nourie-weathernext3-v1',model:'Google WeatherNext 3',source:'Google BigQuery Analytics Hub',sourceTable:'project.dataset.weathernext_3_0_0_0p1deg',status:'ready',runAt:new Date(issuedAt).toISOString(),generatedAt:new Date(issuedAt+H).toISOString(),units:{temperature:'degF'},ensembleMembers:64,timeStepHours:1,horizonHours:168,comparisonOnly:true,points:[{latitude:35.787,longitude:-78.4806,hourly:[1,2,3].map(h=>({time:new Date(issuedAt+h*H).toISOString(),temperatureF:60+h}))}]};}
test('native WeatherNext 3 adapter verifies provenance, point, units, run and horizon before approval',()=>{
 const location={latitude:35.787,longitude:-78.4806},now=issuedAt+H,f=feed(),model=validateWeatherNext3(f,location,now);
 assert.equal(model.publicBlendApproved,true);assert.equal(model.previouslyComparisonOnly,true);assert.equal(model.hourly.temperature_2m[0],61);assert.equal(model.model,'weathernext3');
 for(const alter of [f=>f.model='Legacy WeatherNext',f=>f.runAt='2026-01-01',f=>f.units.temperature='K',f=>f.points[0].latitude=40,f=>f.points[0].hourly.push(f.points[0].hourly[0]),f=>f.points[0].hourly[0].time=new Date(issuedAt+169*H).toISOString()]){const bad=feed();alter(bad);assert.throws(()=>validateWeatherNext3(bad,location,now));}
});

test('activated engine changes hourly and calendar values together, official rain stays a probability, alerts stay intact',async()=>{
 const {buildForecast}=await import('../src/weatherFusion.js');const {inputs,now}=await import('./weatherFusion.fixtures.js');
 const make=()=>{const x=structuredClone(inputs);for(const model of Object.values(x.models)){model.verifiedModel=true;model.runAt=new Date(now).toISOString();model.precipitationIntervals=[];}return x;};
 const old=buildForecast(make()),v2=buildForecast({...make(),blendV2:true});assert.equal(old.blendV2,undefined);assert.equal(v2.blendV2.enabled,true);
 assert.deepEqual(v2.alerts,old.alerts);assert.deepEqual(v2.snow,old.snow);
 for(const row of v2.rainTimeline)if(row.officialPop!==null)assert.equal(row.rainLikelihood.value,row.officialPop);
 const point=v2.metricForecasts.series.temperature[0];assert.ok(point.sources.length>1);assert.ok(Math.abs(point.sources.reduce((sum,s)=>sum+s.weight,0)-1)<.00001);
 assert.equal(point.sources.find(s=>s.id==='wn'),undefined,'legacy WN must not become WeatherNext 3');
 assert.ok(v2.hours[0].temperatureBlend.version.includes('blend-v2'));
 for(const field of ['wind','dewpoint','cloud'])assert.deepEqual(v2.metricForecasts.series[field],old.metricForecasts.series[field],field+' retains its own existing policy');
});

test('GEFS adapter requires the real 31-member ensemble and independent initialization metadata',async()=>{
 const {validateGefs}=await import('../src/weatherFusionGefs.js');
 const times=[0,1,2].map(h=>(issuedAt+h*H)/1000),keys=['temperature_2m',...Array.from({length:30},(_,i)=>'temperature_2m_member'+String(i+1).padStart(2,'0'))];
 const data={latitude:35.75,longitude:-78.5,hourly_units:{time:'unixtime',...Object.fromEntries(keys.map(k=>[k,'°F']))},hourly:{time:times,...Object.fromEntries(keys.map((k,i)=>[k,[60+i,60+i,60+i]]))}},meta={last_run_initialisation_time:issuedAt/1000,data_end_time:(issuedAt+10*H)/1000},place={latitude:35.787,longitude:-78.4806};
 const m=validateGefs(data,meta,place,issuedAt+H);assert.equal(m.ensembleMembers,31);assert.equal(m.hourly.temperature_2m[1],75);assert.equal(m.model,'gefs');
 const bad=structuredClone(data);delete bad.hourly.temperature_2m_member30;assert.throws(()=>validateGefs(bad,meta,place,issuedAt+H));
 assert.throws(()=>validateGefs(data,meta,{latitude:40,longitude:-90},issuedAt+H));assert.throws(()=>validateGefs(data,meta,place,issuedAt+30*H));
 const gap=structuredClone(data);gap.hourly.temperature_2m_member01[1]=null;assert.equal(validateGefs(gap,meta,place,issuedAt+H).hourly.temperature_2m[1],null);
});
