import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {changesText,activeChanges,CHANGES_VERSION} from '../public/weather-fusion/forecast-changes.js';
const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const app=read('app.js'),html=read('index.html'),css=read('forecast-layout.css');
const start=app.indexOf('function renderBriefing(data) {'),end=app.indexOf('\nasync function load(',start),renderer=app.slice(start,end);
const now=Date.parse('2026-09-07T09:00Z'),issued='2026-09-07T07:00:00Z';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function briefing(summary='A later arrival could delay the showers.'){
 return {mode:'ai',signature:'test',changesVersion:CHANGES_VERSION,summary:'Your local forecast.',sources:['nws','afd'],forecastChanges:[{validated:true,id:'change-0',discussionId:'afd1',discussionIssuedAt:issued,validFrom:'2026-09-10T22:00Z',validUntil:'2026-09-12T04:00Z',periodLabel:'Thursday night through Friday',summary,sectionIssuedAt:issued,office:'RAH',text:'Front timing Thursday night into Friday is uncertain.'}]};
}
function harness({missingNote=false}={}){
 const ids=['briefing-title','briefing-summary','ai-label','briefing-detail','briefing-stamp','outlook-science','today-uncertainty','today-uncertainty-text'];
 const elements=Object.fromEntries(ids.map(id=>[id,{textContent:'',innerHTML:'',hidden:true}]));
 if(missingNote){delete elements['today-uncertainty'];delete elements['today-uncertainty-text'];}
 const forecast={signature:'test',feeds:[],discussion:{id:'afd1',issuanceTime:issued}};
 const context={$:id=>elements[id]??null,forecast,currentBriefing:null,esc:escape,clock:()=>'5:00 AM',changesText:(b,f)=>changesText(b,f,now),activeChanges:(b,f)=>activeChanges(b,f,now)};
 runInNewContext(`${renderer}\nthis.renderBriefing=renderBriefing;`,context);
 return {elements,render:context.renderBriefing,forecast};
}
test('Dan take remains below the daily graphic, above hourly, and hidden initially',()=>{
 const panel=html.match(/<section class="glass today-panel"[^>]*>([\s\S]*?)<\/section>/)?.[1];assert.ok(panel);
 assert.ok(panel.indexOf('id="today-forecast"')<panel.indexOf('id="today-uncertainty"'));
 assert.match(panel,/id="today-uncertainty"[^>]*hidden/);assert.match(panel,/<strong class="today-uncertainty-label">Dan's take<\/strong>/);
 for(const id of ['today-forecast','today-uncertainty','today-uncertainty-text','hourly'])assert.equal(html.split(`id="${id}"`).length-1,1);
});
test('legacy generic uncertainty and NWS fallback never create a Dan take',()=>{
 const {elements,render}=harness();
 render({mode:'nws-summary',summary:'Warm with a chance of rain.',uncertainty:'Forecasts can change, especially the timing of showers.'});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
 assert.match(elements['briefing-detail'].innerHTML,/data-dans-take-detail hidden/);
 assert.equal(elements['briefing-summary'].textContent,'Warm with a chance of rain.');
});
test('validated AI note includes its period and replaces rather than duplicates old text',()=>{
 const {elements,render}=harness();render(briefing('Old wording.'));const note=elements['today-uncertainty'];render(briefing());
 assert.equal(elements['today-uncertainty'],note);assert.equal(note.hidden,false);
 assert.equal(elements['today-uncertainty-text'].textContent,'Thursday night through Friday: A later arrival could delay the showers.');
 assert.ok(!elements['briefing-detail'].innerHTML.includes('Old wording'));
 assert.match(elements['outlook-science'].innerHTML,/Front timing Thursday night into Friday is uncertain/);
});
for(const value of [undefined,null,[]])test(`missing validated changes hide and clear the card: ${value}`,()=>{
 const {elements,render}=harness();render(briefing());render({...briefing(),forecastChanges:value,uncertainty:'Do not reuse this'});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
});
test('expired events and another location or discussion cannot be displayed',()=>{
 const {elements,render}=harness();const b=briefing();b.forecastChanges[0].validUntil='2026-09-07T08:00Z';render(b);assert.equal(elements['today-uncertainty'].hidden,true);
 render({...briefing(),signature:'other location'});assert.equal(elements['today-uncertainty'].hidden,true);
 const wrong=briefing();wrong.forecastChanges[0].discussionId='old-afd';render(wrong);assert.equal(elements['today-uncertainty'].hidden,true);
});
test('location reset clears the previously visible note',()=>{
 const {elements,render}=harness();render(briefing());render({headline:'Preparing your local outlook.',sources:[]});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
 assert.match(app,/renderBriefing\(\{ headline: 'Preparing your local outlook\.'/);
});
test('untrusted paraphrases and source quotes are text or escaped HTML, never executable',()=>{
 const {elements,render}=harness();const b=briefing('<img src=x onerror=alert(1)>');b.forecastChanges[0].text='<script>bad</script>';render(b);
 assert.ok(elements['today-uncertainty-text'].textContent.includes('<img'));assert.equal(elements['today-uncertainty-text'].innerHTML,'');
 assert.ok(!elements['briefing-detail'].innerHTML.includes('<img'));assert.ok(!elements['outlook-science'].innerHTML.includes('<script>'));
});
test('older document without a note cannot break the main outlook',()=>{const {render}=harness({missingNote:true});assert.doesNotThrow(()=>render(briefing()));});
test('wrapping, typography and Gross Meter remain intact',()=>{
 assert.match(css,/\.today-uncertainty\{[^}]*font-size:14px;[^}]*font-weight:700;[^}]*overflow-wrap:anywhere/);
 assert.match(css,/#gross-title\{text-align:center;font-weight:800\}/);
});
test('cache bust and browser expiry guards prevent stale overnight cards',()=>{
 assert.match(html,/app\.js\?v=14-evidence-thermal/);
 assert.match(app,/if \(id === generation && briefing\.signature === forecast\?\.signature\) renderBriefing\(briefing\)/);
 assert.match(app,/setInterval\(expireDansTake,60000\)/);assert.match(app,/visibilitychange/);
});
