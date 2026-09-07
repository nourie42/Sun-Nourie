import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const app=read('app.js'),html=read('index.html'),css=read('forecast-layout.css');
const start=app.indexOf('function renderBriefing(data) {'),end=app.indexOf('\nasync function load(',start);
assert.ok(start>=0&&end>start,'Exercise the actual production briefing renderer');
const renderer=app.slice(start,end),now=Date.parse('2026-09-07T16:00:00Z');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const source={signature:'current-source',location:{latitude:35.787,longitude:-78.4806,office:'RAH',timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd-current',office:'RAH',issuanceTime:'2026-09-07T14:00:00Z',text:'.LONG TERM /THURSDAY THROUGH FRIDAY/...\nThe front timing remains uncertain Thursday into Friday.'}};
function harness({missingNote=false}={}){
 const ids=['briefing-title','briefing-summary','ai-label','briefing-detail','briefing-stamp','outlook-science','today-uncertainty','today-uncertainty-text'];
 const elements=Object.fromEntries(ids.map(id=>[id,{textContent:'',innerHTML:'',hidden:true}]));
 if(missingNote){delete elements['today-uncertainty'];delete elements['today-uncertainty-text'];}
 const context={$:id=>elements[id]??null,forecast:structuredClone(source),currentBriefing:null,esc:escape,clock:()=>'12:00 PM',visibleDanTakeItems:(data,forecast)=>visibleDanTakeItems(data,forecast,now),danTakeText,Date};
 runInNewContext(`${renderer}\nthis.renderBriefing=renderBriefing;`,context);
 return {elements,context,render:context.renderBriefing};
}
test('optional take remains below daily graphic and ahead of hourly forecast',()=>{
 const panel=html.match(/<section class="glass today-panel"[^>]*>([\s\S]*?)<\/section>/)?.[1];assert.ok(panel);
 assert.ok(panel.indexOf('id="today-forecast"')<panel.indexOf('id="today-uncertainty"'));
 assert.match(panel,/id="today-uncertainty"[^>]*hidden/);
 assert.match(panel,/<strong class="today-uncertainty-label">Dan's take<\/strong>/);
 assert.match(html,/<\/section>\s*<section class="glass bulletins-panel"/);
 for(const id of ['today-forecast','today-uncertainty','today-uncertainty-text','hourly'])assert.equal(html.split(`id="${id}"`).length-1,1);
});
test('NWS fallback keeps the normal forecast but never manufactures Dan take',()=>{
 const {elements,render}=harness();
 render({mode:'nws-summary',summary:'Warm with a chance of rain.',uncertainty:'Forecasts can change, especially the timing of showers.'});
 assert.equal(elements['today-uncertainty-text'].textContent,'');assert.equal(elements['today-uncertainty'].hidden,true);
 assert.ok(!elements['briefing-detail'].innerHTML.includes("Dan's take"));
 assert.equal(elements['briefing-summary'].textContent,'Warm with a chance of rain.');
});
test('location reset clears the old take immediately',()=>{
 const choose=app.slice(app.indexOf('function chooseLocation(value)'),app.indexOf('\nfunction showDay('));
 assert.match(choose,/renderBriefing\(\{ headline: 'Preparing your local outlook\.'/);
 const {elements,render}=harness();render({headline:'Preparing your local outlook.',sources:[]});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
});
test('untrusted text cannot execute HTML',()=>{
 const {elements,render}=harness();render({mode:'nws-summary',summary:'<img src=x onerror=alert(1)>',nearTerm:'<img src=x onerror=alert(1)>',sources:['nws']});
 assert.ok(!elements['briefing-detail'].innerHTML.includes('<img'));assert.ok(elements['briefing-detail'].innerHTML.includes('&lt;img'));
});
test('an older cached document without the optional note cannot break the outlook',()=>{
 const {render}=harness({missingNote:true});assert.doesNotThrow(()=>render({mode:'nws-summary',summary:'Forecast available.',sources:['nws']}));
});
test('note is smaller and bold, with wrapping rather than clipping',()=>{
 assert.match(css,/\.today-uncertainty\{[^}]*font-size:14px;[^}]*font-weight:700;[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.today-uncertainty-label\{[^}]*font-weight:800/);
 assert.match(css,/\.today-uncertainty p\{[^}]*font-size:inherit;[^}]*font-weight:700/);
 assert.match(css,/@media\(max-width:600px\)\{\.today-uncertainty\{font-size:13px/);
});
test('Gross Meter heading stays centered and bold without changing chart geometry',()=>{
 assert.match(css,/#gross-title\{text-align:center;font-weight:800\}/);assert.ok(!/\.gross-(scroll|chart)\s*\{/.test(css));
});
test('changed assets are cache-busted and late briefing responses stay guarded',()=>{
 assert.match(html,/forecast-layout\.css\?v=4-confidence/);assert.match(html,/app\.js\?v=ui-requests-v1/);
 assert.match(app,/if \(id === generation && briefing\.signature === forecast\?\.signature\) renderBriefing\(briefing\)/);
});
