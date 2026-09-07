import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {collectDanTakeEvidence,approveDanTake,visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const app=read('app.js'),html=read('index.html'),css=read('forecast-layout.css');
const start=app.indexOf('function renderBriefing(data) {'),end=app.indexOf('\nasync function load(',start);
assert.ok(start>=0&&end>start,'Exercise the actual production briefing renderer');
const renderer=app.slice(start,end),now=Date.parse('2026-09-07T16:00:00Z');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const source={signature:'current-source',location:{latitude:35.787,longitude:-78.4806,office:'RAH',timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd-current',office:'RAH',issuanceTime:'2026-09-07T14:00:00Z',text:'.LONG TERM /THURSDAY THROUGH FRIDAY/...\nThe front timing remains uncertain Thursday into Friday.'}};
const evidenceId=collectDanTakeEvidence(source,now).candidates[0]?.id;
function supported(summary='The front could arrive earlier or later than expected.'){
 return {mode:'ai',signature:source.signature,summary:'The local outlook is unchanged.',...approveDanTake([{evidenceId,summary}],source,now)};
}
function harness({missingNote=false}={}){
 const ids=['briefing-title','briefing-summary','ai-label','briefing-detail','briefing-stamp','outlook-science','today-uncertainty','today-uncertainty-text'];
 const elements=Object.fromEntries(ids.map(id=>[id,{textContent:'',innerHTML:'',hidden:true}]));
 if(missingNote){delete elements['today-uncertainty'];delete elements['today-uncertainty-text'];}
 let time=now;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 const context={$:id=>elements[id]??null,forecast:structuredClone(source),currentBriefing:null,esc:escape,clock:()=>'12:00 PM',visibleDanTakeItems,danTakeText,Date:Clock};
 runInNewContext(`${renderer}\nthis.renderBriefing=renderBriefing;`,context);
 return {elements,context,render:context.renderBriefing,setTime:t=>{time=t;}};
}
test('optional take remains below daily graphic and ahead of hourly forecast',()=>{
 const panel=html.match(/<section class="glass today-panel"[^>]*>([\s\S]*?)<\/section>/)?.[1];
 assert.ok(panel);assert.ok(panel.indexOf('id="today-forecast"')<panel.indexOf('id="today-uncertainty"'));
 assert.match(panel,/id="today-uncertainty"[^>]*hidden/);
 assert.match(panel,/<strong class="today-uncertainty-label">Dan's take<\/strong>/);
 assert.match(html,/<\/section>\s*<section class="glass hourly-panel"/);
 for(const id of ['today-forecast','today-uncertainty','today-uncertainty-text','hourly'])assert.equal(html.split(`id="${id}"`).length-1,1);
});
test('NWS fallback keeps the normal forecast but never manufactures Dan take',()=>{
 const {elements,render}=harness();
 render({mode:'nws-summary',summary:'Warm with a chance of rain.',uncertainty:'Forecasts can change, especially the timing of showers.'});
 assert.equal(elements['today-uncertainty-text'].textContent,'');assert.equal(elements['today-uncertainty'].hidden,true);
 assert.ok(!elements['briefing-detail'].innerHTML.includes('Dan\'s take'));
 assert.equal(elements['briefing-summary'].textContent,'Warm with a chance of rain.');
});
test('only approved dated AI changes appear in both places, without duplicates',()=>{
 const {elements,render}=harness(),note=elements['today-uncertainty'];
 render(supported());assert.equal(note.hidden,false);assert.match(elements['today-uncertainty-text'].textContent,/Thursday, Sep 10/);
 assert.ok(elements['briefing-detail'].innerHTML.includes('The front could arrive earlier or later than expected.'));
 render(supported('The front may arrive later than expected.'));
 assert.equal(elements['today-uncertainty'],note);assert.ok(!elements['briefing-detail'].innerHTML.includes('earlier or later'));
 assert.equal(elements['briefing-detail'].innerHTML.split('data-dans-take').length-1,1);
});
for(const uncertainty of [undefined,null,'',' \n\t ',42,{},'Yesterday\'s front might change the forecast.'])test('unverified legacy uncertainty is always hidden: '+JSON.stringify(uncertainty),()=>{
 const {elements,render}=harness();render(supported());render({mode:'ai',signature:source.signature,uncertainty});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
});
test('location reset clears the old take immediately',()=>{
 const choose=app.slice(app.indexOf('function chooseLocation(value)'),app.indexOf('\nfunction showDay('));
 assert.match(choose,/renderBriefing\(\{ headline: 'Preparing your local outlook\.'/);
 const {elements,render}=harness();render(supported());render({headline:'Preparing your local outlook.',sources:[]});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
});
test('source replacement removes previously valid take, even under the old signature',()=>{
 const {elements,context,render}=harness(),b=supported();render(b);
 context.forecast.discussion.text='.DISCUSSION...\nDry weather is expected this week.';render(b);
 assert.equal(elements['today-uncertainty'].hidden,true);
});
test('source expiry removes the card and duplicated full-outlook section',()=>{
 const {elements,render,setTime}=harness(),b=supported();render(b);setTime(now+12*3600000);render(b);
 assert.equal(elements['today-uncertainty'].hidden,true);assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
 assert.match(app,/setInterval\(.*renderBriefing\(currentBriefing\).*30000/);
 assert.match(app,/visibilitychange/);
});
test('untrusted text cannot execute HTML',()=>{
 const {elements,render}=harness();render({...supported(),uncertainty:'<img src=x onerror=alert(1)>',nearTerm:'<img src=x onerror=alert(1)>'});
 assert.ok(!elements['briefing-detail'].innerHTML.includes('<img'));assert.ok(elements['briefing-detail'].innerHTML.includes('&lt;img'));
 const b=supported();b.forecastChanges[0].summary='<img src=x onerror=alert(1)>';render(b);assert.equal(elements['today-uncertainty'].hidden,true);
});
test('an older cached document without the optional note cannot break the outlook',()=>{
 const {elements,render}=harness({missingNote:true});assert.doesNotThrow(()=>render(supported()));
 assert.ok(elements['briefing-detail'].innerHTML.includes('data-dans-take'));
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
 assert.match(html,/forecast-layout\.css\?v=3-personal/);assert.match(html,/app\.js\?v=integrity-v2/);
 assert.match(app,/if \(id === generation && briefing\.signature === forecast\?\.signature\) renderBriefing\(briefing\)/);
});
