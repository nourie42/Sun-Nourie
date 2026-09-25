import test from 'node:test';import assert from 'node:assert/strict';
import {fetchJsonWithDeadline} from '../public/weather-fusion/request-deadline.js';
import {danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
import {readFileSync} from 'node:fs';
test('a stalled request terminates, even when the transport ignores cancellation',async()=>{
 await assert.rejects(fetchJsonWithDeadline('/test',{timeoutMs:15,fetchImpl:()=>new Promise(()=>{})}),e=>e.name==='TimeoutError'&&/Refresh/.test(e.message));
});
test('deadline includes a stalled JSON body',async()=>{
 await assert.rejects(fetchJsonWithDeadline('/test',{timeoutMs:15,fetchImpl:async()=>({ok:true,json:()=>new Promise(()=>{})})}),e=>e.name==='TimeoutError');
});
test('location-change abort stays separate from timeout and successful responses are unchanged',async()=>{
 const controller=new AbortController();const pending=fetchJsonWithDeadline('/test',{signal:controller.signal,fetchImpl:()=>new Promise(()=>{})});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');
 assert.deepEqual(await fetchJsonWithDeadline('/test',{fetchImpl:async()=>({ok:true,json:async()=>({temperature:70})})}),{temperature:70});
});
test('HTTP errors retain status for signature refresh and access checks',async()=>{
 await assert.rejects(fetchJsonWithDeadline('/test',{fetchImpl:async()=>({ok:false,status:409,json:async()=>({error:'Changed'})})}),e=>e.status===409);
});
test('Dan summary remains visible with no approved uncertainty, and fallback is not called AI',()=>{
 const forecast={signature:'current',location:{timeZone:'America/New_York'},days:[{detail:'Clouds will clear this afternoon.'}],feeds:[],aiConfigured:true};
 const text=danTakeDisplay({signature:'current',mode:'ai',danSummary:'Clouds will clear. Tomorrow looks dry.'},forecast);
 assert.match(text,/Tomorrow looks dry/);
 const fallback=danTakeDisplay({signature:'current',mode:'nws-summary'},forecast);assert.match(fallback,/AI summary is temporarily unavailable/);assert.match(fallback,/Clouds will clear/);
 assert.doesNotMatch(danTakeDisplay({signature:'other',mode:'ai',danSummary:'Stale text'},forecast),/Stale text/);
});
test('main markup never hides Dan Take and Refresh is not blocked by busy state',()=>{
 const html=readFileSync('public/weather-fusion/index.html','utf8'),app=readFileSync('public/weather-fusion/app.js','utf8');
 assert.match(html,/<div id="today-uncertainty" class="today-uncertainty">/);
 assert.match(app,/todayUncertainty.hidden = false/);
 assert.doesNotMatch(app,/\$\('refresh'\)\.addEventListener[^\n]+if \(!busy\)/);
 assert.match(app,/if\(request===locationRequest\)chooseLocation/);
});
