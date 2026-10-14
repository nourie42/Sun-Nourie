import test from 'node:test';
import assert from 'node:assert/strict';
import {modelSnowMapRequest,modelSnowMapDescriptor,modelSnowMapSamples,modelSnowRegionalUrl,regionalSnowCollection,createModelSnowMapService} from '../src/weatherFusionModelSnowMap.js';

const HOUR=3600000,now=Date.parse('2026-10-14T12:00:00Z'),start='2026-10-17T04:00:00Z',end='2026-10-18T04:00:00Z';
const segment={start,end,models:['ecmwf','gfs']};
const query={lat:'42.60118',lon:'-76.18048',start,end,segments:JSON.stringify([segment])};
const metadata={ecmwf:{last_run_initialisation_time:now/1000},gfs:{last_run_initialisation_time:now/1000}};
function forecast(sample,ecmwf,gfs){
  const from=Date.parse('2026-10-17T00:00:00Z'),time=Array.from({length:48},(_,index)=>(from+index*HOUR)/1000);
  const values=amount=>time.map(t=>t*1000>Date.parse(start)&&t*1000<=Date.parse(end)?amount:null);
  return {...sample,hourly_units:{time:'unixtime',snowfall_ecmwf_ifs025:'cm',snowfall_ncep_gfs_global:'cm'},hourly:{time,snowfall_ecmwf_ifs025:values(ecmwf),snowfall_ncep_gfs_global:values(gfs)}};
}

test('map request preserves a New York calendar day and rejects gaps and arbitrary sources',()=>{
  const request=modelSnowMapRequest(query,now);
  assert.equal(request.start,Date.parse(start));assert.equal(request.end,Date.parse(end));
  assert.deepEqual(request.segments[0].weights,{ecmwf:20,gfs:10});
  for(const bad of [{segments:JSON.stringify([{...segment,start:'2026-10-17T05:00:00Z'}])},{segments:JSON.stringify([{...segment,models:['ecmwf','hrrr']}])},{segments:JSON.stringify([{...segment,models:['weathernext']}])},{end:'2026-10-19T04:00:00Z'},{lat:'-1'},{lon:'Infinity'}])assert.throws(()=>modelSnowMapRequest({...query,...bad},now),error=>error.status===400);
});

test('descriptor derives its sources from usable contributors in the actual day blend',()=>{
  const descriptor=modelSnowMapDescriptor({date:'2026-10-17',amountWindow:{start,end},blend:{window:{start,end},sources:[{id:'wpc',value:null,requestedWeight:60},{id:'ecmwf',value:0,requestedWeight:20},{id:'gfs',value:.2,requestedWeight:10},{id:'weathernext',value:null,requestedWeight:10}]}},{latitude:42.60118,longitude:-76.18048});
  assert.equal(descriptor.source,'model-grid');assert.equal(Date.parse(descriptor.start),Date.parse(start));assert.equal(Date.parse(descriptor.end),Date.parse(end));
  const params=new URL(descriptor.url,'https://weather.invalid').searchParams;
  assert.deepEqual(JSON.parse(params.get('segments')),[segment]);
  assert.equal(modelSnowMapDescriptor({date:'2026-10-17',amountWindow:{start,end},blend:{window:{start,end},sources:[{id:'gfs',value:null,requestedWeight:10}]}},{latitude:42.6,longitude:-76.18}),null);
});

test('near-term and extended windows retain different model weights',()=>{
  const middle='2026-10-15T12:00:00Z',a='2026-10-15T04:00:00Z',b='2026-10-16T04:00:00Z';
  const request=modelSnowMapRequest({...query,start:a,end:b,segments:JSON.stringify([{start:a,end:middle,models:['hrrr','nam']},{start:middle,end:b,models:['ecmwf','gfs']}])},now);
  assert.deepEqual(request.segments.map(s=>s.weights),[{hrrr:25,nam:15},{ecmwf:20,gfs:10}]);
});

test('every shaded cell has its own provider query and zero/missing cells stay unshaded',()=>{
  const samples=[{latitude:42.5,longitude:-76,bounds:[-76.25,42.25,-75.75,42.75]},{latitude:43,longitude:-76,bounds:[-76.25,42.75,-75.75,43.25]},{latitude:42,longitude:-76,bounds:[-76.25,41.75,-75.75,42.25]},{latitude:42.60118,longitude:-76.18048}];
  const request=modelSnowMapRequest(query,now),rows=[forecast(samples[0],0,.01),forecast(samples[1],0,0),forecast(samples[2],null,null),forecast(samples[3],0,.02)];
  const geo=regionalSnowCollection(rows,samples,metadata,request,now);
  assert.equal(geo.features.length,1);assert.equal(geo.metadata.availableCells,2);assert.equal(geo.metadata.zeroCells,1);
  assert.ok(Math.abs(geo.features[0].properties.value-(24*.01/2.54/3))<1e-12);
  assert.ok(Math.abs(geo.metadata.point.value-(24*.02/2.54/3))<1e-12);
  assert.notEqual(geo.features[0].properties.value,geo.metadata.point.value);
  assert.equal(geo.metadata.point.coverage,30);assert.equal(geo.metadata.unit,'in');
  assert.match(geo.metadata.legend[0].label,/Trace/);assert.equal(geo.features[0].geometry.type,'Polygon');
});

test('missing and stale model values are excluded rather than substituted with zero',()=>{
  const samples=[{latitude:42.5,longitude:-76,bounds:[-76.25,42.25,-75.75,42.75]},{latitude:42.60118,longitude:-76.18048}],request=modelSnowMapRequest(query,now);
  const geo=regionalSnowCollection(samples.map(s=>forecast(s,null,.01)),samples,metadata,request,now);
  assert.ok(Math.abs(geo.features[0].properties.value-(24*.01/2.54))<1e-12);assert.equal(geo.features[0].properties.coverage,10);
  assert.throws(()=>regionalSnowCollection(samples.map(s=>forecast(s,.01,.01)),samples,{ecmwf:{last_run_initialisation_time:(now-40*HOUR)/1000},gfs:null},request,now),/unavailable/);
});

test('regional sampling is bounded and URLs request only the selected snowfall dates',()=>{
  const cells=modelSnowMapSamples(42.60118,-76.18048);assert.equal(cells.length,81);
  assert.equal(new Set(cells.map(s=>`${s.latitude},${s.longitude}`)).size,81);
  const url=new URL(modelSnowRegionalUrl(cells,['ecmwf','gfs'],Date.parse(start),Date.parse(end)));
  assert.equal(url.hostname,'api.open-meteo.com');assert.equal(url.searchParams.get('models'),'ecmwf_ifs025,ncep_gfs_global');
  assert.equal(url.searchParams.get('start_date'),'2026-10-17');assert.equal(url.searchParams.get('end_date'),'2026-10-18');
  assert.equal(url.searchParams.get('latitude').split(',').length,81);
});

test('concurrent requests share one cached regional provider query',async()=>{
  let regionalCalls=0;
  const service=createModelSnowMapService({now:()=>now,cached:async url=>{
    const u=new URL(url);if(u.pathname.includes('meta.json'))return {data:{last_run_initialisation_time:now/1000}};
    regionalCalls++;
    const lats=u.searchParams.get('latitude').split(',').map(Number),lons=u.searchParams.get('longitude').split(',').map(Number);
    return {data:lats.map((latitude,index)=>forecast({latitude,longitude:lons[index]},0,.01))};
  }});
  const [a,b]=await Promise.all([service(query),service(query)]);assert.strictEqual(a,b);assert.equal(regionalCalls,1);
  await service(query);assert.equal(regionalCalls,1);assert.equal(a.metadata.sampledCells,81);
});
