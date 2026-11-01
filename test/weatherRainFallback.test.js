import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedPrecipitationLikelihood,precipitationLikelihood,validateSnapshot,createDirectModels} from '../src/weatherFusionDirect.js';
import {precipitationPolicy} from '../src/weatherFusionPolicy.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';

test('a missing model no longer erases the models that did report',()=>{
 // Owner decision 2026-11-01: every available model contributes to the
 // published chance. ECMWF, NBM, GEFS and WeatherNext 3 are missing here,
 // but WeatherNext reports a full wet signal, so the published value is
 // the partial blend (NWS 22.8 points + WeatherNext 5 points), not NWS alone.
 const policy=precipitationPolicy(1,true),amount={sourceValues:{hrrr:null,ecmwf:null,nbm:null,wn:.05}};
 const published=publishedPrecipitationLikelihood(57,amount,policy);
 assert.equal(published.value,28);assert.equal(published.mode,'partial-blend');assert.equal(published.partialBlend.value,28);
 assert.deepEqual([...published.missingModels].sort(),['ecmwf','gefs','nbm','weathernext3']);
 assert.ok(published.sources.some(s=>s.id==='wn'));
 assert.match(published.source,/partial/);
});
test('when no model input is available at all, the official probability is the labeled fallback',()=>{
 const policy=precipitationPolicy(1,true),amount={sourceValues:{hrrr:null,ecmwf:null,nbm:null,wn:null}};
 const published=publishedPrecipitationLikelihood(57,amount,policy);
 assert.equal(published.value,57);assert.equal(published.mode,'nws-fallback');
 assert.deepEqual(published.sources.map(s=>[s.id,s.weight]),[['nws',1]]);
 assert.deepEqual([...published.missingModels].sort(),['ecmwf','gefs','nbm','weathernext3','wn']);
});
test('complete model data retains the requested blend exactly',()=>{
 const amount={sourceValues:{hrrr:0,ecmwf:.02,nbm:.02}};
 assert.deepEqual(publishedPrecipitationLikelihood(57,amount),precipitationLikelihood(57,amount));
});
test('missing model and NWS data remain unavailable, never a dry zero',()=>{
 assert.equal(publishedPrecipitationLikelihood(null,{sourceValues:{hrrr:null,ecmwf:null,nbm:null}}).value,null);
});
test('a GPS rounding difference of 40 metres can use the verified native sample without relabeling its coordinates',()=>{
 const raw=snapshot(),location={...testInputs.location,latitude:35.7871,longitude:-78.481};
 const result=validateSnapshot(raw,'hrrr',location,testInputs.now);
 assert.equal(result.status,'ready');assert.equal(result.value.latitude,35.787);assert.equal(result.value.longitude,-78.4806);
 assert.equal(validateSnapshot(raw,'hrrr',{...location,longitude:location.longitude+.01},testInputs.now).status,'not-covered');
});

test('rate-limited model requests recover the fresh native grid sample for the selected GPS location',async()=>{
 const raw=snapshot(),location={...testInputs.location,latitude:35.7871,longitude:-78.481};
 const service=createDirectModels({now:()=>testInputs.now,fetchImpl:async url=>String(url).includes('/models/hrrr.json')?Response.json(raw):new Response('rate limit',{status:429})});
 const loaded=await service.load('hrrr',location);
 assert.ok(loaded.value);assert.equal(loaded.meta.status,'ready');assert.equal(loaded.meta.contributes,true);
 assert.equal(loaded.value.longitude,-78.4806);
});
test('a GPS location inside the saved sample\'s native grid cell uses that cell; one outside it does not',()=>{
 const raw=snapshot();for(const p of raw.points)p.gridPoint={latitude:35.773103,longitude:-78.471221};
 // About 1 km from the HRRR grid point, so inside the same 3 km cell.
 const inside=validateSnapshot(raw,'hrrr',{latitude:35.7731,longitude:-78.482},testInputs.now);
 assert.equal(inside.status,'ready');assert.equal(inside.value.latitude,35.787);
 // About 3 km from the grid point, so in a neighbouring cell.
 assert.equal(validateSnapshot(raw,'hrrr',{latitude:35.80,longitude:-78.471221},testInputs.now).status,'not-covered');
});
