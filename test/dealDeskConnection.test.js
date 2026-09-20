import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJson,runAnalysisJob} from '../deal-desk/lib/connection.js';
const ok=x=>Response.json(x),wait=async()=>{};
test('a lost poll reconnects to the same job without another analysis',async()=>{
 const urls=[],messages=[];let polls=0;
 const result=await runAnalysisJob('analyze',{files:[]},{},{wait,onReconnect:m=>messages.push(m),fetchImpl:async url=>{
  urls.push(url);if(url.endsWith('/analyze'))return ok({jobId:'same-job'});
  if(++polls===1)throw new TypeError('Failed to fetch');return ok({state:'complete',result:{sites:99}});
 }});
 assert.deepEqual(result,{sites:99});assert.equal(urls.filter(x=>x.endsWith('/analyze')).length,1);assert.equal(urls.filter(x=>x.endsWith('/same-job')).length,2);assert.equal(messages.length,1);
});
test('lost submission responses retry the identical idempotent payload',async()=>{
 const bodies=[];
 await runAnalysisJob('analyze',{files:[]},{},{wait,fetchImpl:async(url,options)=>{
  if(url.endsWith('/analyze')){bodies.push(options.body);if(bodies.length===1)throw new TypeError('Failed to fetch');return ok({jobId:'one'});}
  return ok({state:'complete',result:{}});
 }});
 assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.ok(JSON.parse(bodies[0]).requestId);
});
test('service restart resubmits retained sources once then completes',async()=>{
 let submits=0;
 const result=await runAnalysisJob('analyze',{files:[{id:'retained'}]},{},{wait,fetchImpl:async(url,options)=>{
  if(url.endsWith('/analyze')){assert.equal(JSON.parse(options.body).files[0].id,'retained');return ok({jobId:String(++submits)});}
  return url.endsWith('/1')?Response.json({error:'Restarted'},{status:404}):ok({state:'complete',result:{done:true}});
 }});
 assert.equal(submits,2);assert.equal(result.done,true);
});
test('authentication failures are not retried or bypassed',async()=>{
 let calls=0;await assert.rejects(requestJson('/test',{}, {wait,fetchImpl:async()=>{calls++;return Response.json({error:'Access denied'},{status:401});}}),/Access denied/);assert.equal(calls,1);
});
test('temporary gateway failure recovers, persistent outage stops after bounded retries',async()=>{
 let calls=0;assert.deepEqual(await requestJson('/test',{}, {wait,fetchImpl:async()=>++calls===1?new Response('Bad gateway',{status:502}):ok({ready:true})}),{ready:true});
 calls=0;await assert.rejects(requestJson('/test',{}, {wait,fetchImpl:async()=>{calls++;throw new TypeError('Failed to fetch');}}),/Your files are retained/);assert.equal(calls,6);
});
