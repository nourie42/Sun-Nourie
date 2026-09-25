import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {airQualityWeek,airQualityHTML} from '../public/weather-fusion/air-quality.js';
test('standalone comparison bridge cannot post to or scroll itself',()=>{
 const handlers={},clicks={};let posts=0,scrolls=0;
 const window={addEventListener:(name,fn)=>handlers[name]=fn,postMessage:()=>posts++};window.parent=window;
 const document={getElementById:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>clicks[name]=fn};
 const context={window,parent:window,document,installWeatherNextAccess:()=>({}),location:{origin:'http://localhost'},performance:{now:()=>1000},MutationObserver:class{observe(){}},scrollTo:()=>scrolls++,setTimeout,clearTimeout};
 const source=readFileSync('public/weather-fusion/compare-bridge.js','utf8').replace(/^import .*\r?\n/gm,'').replace('export function','function');
 vm.runInNewContext(source+"\ninstallComparisonPane({source:'google',point:{id:'test'}},{});",context);
 handlers.message({origin:'http://localhost',source:window,data:{type:'compare:scroll',section:'daily-panel',progress:1}});
 clicks.click({target:{closest:s=>s==='[data-comfort-time]'?{dataset:{comfortTime:'now'}}:null}});
 assert.equal(posts,0);assert.equal(scrolls,0);
});
test('AQI expands into a local-date week, retaining zero and unavailable days',()=>{
 const f={location:{timeZone:'America/New_York'},days:[{date:'2026-09-25'},{date:'2026-09-26'},{date:'2026-09-27'}],airQuality:{aqi:0,hours:[{time:'2026-09-26T02:00Z',aqi:42},{time:'2026-09-26T14:00Z',aqi:0}]}};
 assert.deepEqual(airQualityWeek(f).map(d=>d.value),[42,0,null]);
 const html=airQualityHTML(f);assert.match(html,/<details class="aqi-details">/);assert.match(html,/Seven-day air-quality outlook/);assert.match(html,/Not published/);
});
