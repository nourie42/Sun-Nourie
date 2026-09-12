import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {collectDanTakeEvidence,approveDanTake,visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
import {danCard} from '../public/weather-fusion/dans-summary.js';
const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const app=read('app.js'),html=read('index.html'),css=read('forecast-layout.css');
const start=app.indexOf('function renderBriefing(data) {'),end=app.indexOf('\nasync function load(',start);
assert.ok(start>=0&&end>start,'Exercise the actual production briefing renderer');
const renderer=app.slice(start,end),now=Date.parse('2026-09-07T16:00:00Z');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const source={signature:'current-source',days:[{detail:'Warm with a chance of rain.',nightDetail:'Mild tonight.'}],location:{latitude:35.787,longitude:-78.4806,office:'RAH',timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd-current',office:'RAH',issuanceTime:'2026-09-07T14:00:00Z',text:'.LONG TERM /THURSDAY THROUGH FRIDAY/...\nThe front timing remains uncertain Thursday into Friday.'}};
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
 const context={$:id=>elements[id]??null,forecast:structuredClone(source),currentBriefing:null,esc:escape,clock:()=>'12:00 PM',visibleDanTakeItems,danTakeText,danCard,Date:Clock};
 runInNewContext(`${renderer}\nthis.renderBriefing=renderBriefing;`,context);
 return {elements,context,render:context.renderBriefing,setTime:t=>{time=t;}};
}
test('exactly one Dan take heading stays below daily graphic and ahead of hourly forecast',()=>{
 const panel=html.match(/<section class="glass today-panel"[^>]*>([\s\S]*?)<\/section>/)?.[1];
 assert.ok(panel);assert.ok(panel.indexOf('id="today-forecast"')<panel.indexOf('id="today-uncertainty"'));
 assert.match(panel,/id="today-uncertainty"[^>]*hidden/);
 assert.match(panel,/<strong class="today-uncertainty-label">Dan's take<\/strong>/);
 assert.equal((panel.match(/Dan's take/g)||[]).length,1);
 assert.doesNotMatch(panel,/Checking the latest forecast discussion|today-take-source/);
 assert.match(html,/<\/section>\s*<section class="glass hourly-panel"/);
 for(const id of ['today-forecast','today-uncertainty','today-uncertainty-text','hourly'])assert.equal(html.split(`id="${id}"`).length-1,1);
});
test('NWS fallback shows only a short explicit possible change',()=>{
 const {elements,render}=harness();
 render({mode:'nws-summary',summary:'Warm with a chance of rain.',uncertainty:'Forecasts can change, especially the timing of showers.'});
 assert.match(elements['today-uncertainty-text'].textContent,/front timing remains uncertain/);assert.doesNotMatch(elements['today-uncertainty-text'].textContent,/Warm with a chance of rain/);assert.equal(elements['today-uncertainty'].hidden,false);
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
 assert.equal(elements['briefing-summary'].textContent,'Warm with a chance of rain.');
});
test('only approved dated AI changes appear in both places, without duplicates',()=>{
 const {elements,render}=harness(),note=elements['today-uncertainty'];
 render(supported());assert.equal(note.hidden,false);assert.match(elements['today-uncertainty-text'].textContent,/Thursday, Sep 10/);
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
 render(supported('The front may arrive later than expected.'));
 assert.equal(elements['today-uncertainty'],note);assert.ok(!elements['briefing-detail'].innerHTML.includes('earlier or later'));
 assert.equal(elements['briefing-detail'].innerHTML.split('data-dans-take').length-1,0);
});
test('Dan displays at most two concise changes while retaining source evidence',()=>{
 const time=Date.parse('2026-09-10T09:00:00Z');
 const f={...structuredClone(source),signature:'distinct-weekend-dates',discussion:{
  id:'afd-weekend',office:'RAH',issuanceTime:'2026-09-10T07:00:00Z',
  text:'.DISCUSSION...\nFriday shower and storm coverage may be limited because dry air could suppress development.\n\nSaturday may trend cooler than earlier runs, which could reduce thunderstorm coverage.\n\nSunday may have lower storm energy, which could reduce heavy or severe storms while showers remain possible.'
 }};
 const summaries=[
  'Coverage of Friday’s showers and storms may be limited because dry air could suppress development.',
  'Saturday may be cooler than earlier forecasts, so thunderstorms may be less widespread.',
  'Sunday may have lower storm energy, so heavy or severe storms appear less likely though showers remain possible.'
 ];
 const candidates=collectDanTakeEvidence(f,time).candidates;
 assert.equal(candidates.length,3);
 const b={mode:'ai',signature:f.signature,...approveDanTake(candidates.map((c,i)=>({evidenceId:c.id,summary:summaries[i]})),f,time)};
 assert.equal(b.forecastChanges.length,3,'all three forecasts must remain approved');
 assert.equal(b.forecastChanges.filter(i=>i.period.startsWith('This coming week')).length,2,'reproduce separate Saturday and Sunday weekly periods');
 const {elements,context,render,setTime}=harness();context.forecast=f;setTime(time);
 for(let refresh=0;refresh<2;refresh++){
  render(b);
  const text=elements['today-uncertainty-text'].textContent;
  assert.equal((text.match(/This coming week/g)||[]).length,0);assert.ok(text.split(/\s+/).length<=55);assert.ok(text.length<=380);
  assert.equal(text,[`Friday, Sep 11: ${summaries[0]}`,`Saturday, Sep 12: ${summaries[1]}`].join(' '));assert.doesNotMatch(text,/Sunday/);
  assert.equal(elements['today-uncertainty'].hidden,false);
 }
});
for(const uncertainty of [undefined,null,'',' \n\t ',42,{},'Yesterday\'s front might change the forecast.'])test('unverified legacy uncertainty never becomes take content: '+JSON.stringify(uncertainty),()=>{
 const {elements,render}=harness();render(supported());render({mode:'ai',signature:source.signature,uncertainty});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');assert.doesNotMatch(elements['today-uncertainty-text'].textContent,/No additional|Yesterday's front|<img/);
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
});
test('location reset clears the old take immediately',()=>{
 const choose=app.slice(app.indexOf('function chooseLocation(value)'),app.indexOf('\nfunction showDay('));
 assert.match(choose,/renderBriefing\(\{ headline: 'Preparing your local outlook\.'/);
 const {elements,context,render}=harness();render(supported());context.forecast=null;render({headline:'Preparing your local outlook.',sources:[]});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
});
test('source replacement removes previously valid take, even under the old signature',()=>{
 const {elements,context,render}=harness(),b=supported();render(b);
 context.forecast.discussion.text='.DISCUSSION...\nDry weather is expected this week.';render(b);
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');assert.doesNotMatch(elements['today-uncertainty-text'].textContent,/No additional|Yesterday's front|<img/);
});
test('source expiry hides the entire Dan card',()=>{
 const {elements,render,setTime}=harness(),b=supported();render(b);setTime(now+12*3600000);render(b);
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');assert.doesNotMatch(elements['today-uncertainty-text'].textContent,/No additional|Yesterday's front|<img/);assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
 assert.match(app,/setInterval\(.*renderBriefing\(currentBriefing\).*30000/);
 assert.match(app,/visibilitychange/);
});
test('untrusted text cannot execute HTML',()=>{
 const {elements,render}=harness();render({...supported(),uncertainty:'<img src=x onerror=alert(1)>',nearTerm:'<img src=x onerror=alert(1)>'});
 assert.ok(!elements['briefing-detail'].innerHTML.includes('<img'));assert.ok(elements['briefing-detail'].innerHTML.includes('&lt;img'));
 const b=supported();b.forecastChanges[0].summary='<img src=x onerror=alert(1)>';render(b);assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');assert.doesNotMatch(elements['today-uncertainty-text'].textContent,/No additional|Yesterday's front|<img/);
});
test('an older cached document without the optional note cannot break the outlook',()=>{
 const {elements,render}=harness({missingNote:true});assert.doesNotThrow(()=>render(supported()));
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
});
test('note is smaller and bold, with wrapping rather than clipping',()=>{
 assert.match(css,/\.today-uncertainty\{[^}]*font-size:14px;[^}]*font-weight:700;[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.today-uncertainty-label\{[^}]*font-weight:800/);
 assert.match(css,/\.today-uncertainty p\{[^}]*font-size:inherit;[^}]*font-weight:700/);
 assert.match(css,/@media\(max-width:600px\)\{\.today-uncertainty\{font-size:13px/);
});
test('Gross Meter heading stays centered and bold without changing chart geometry',()=>{
 const meterCss=read('dewpoint-meter.css');
 assert.match(css,/#gross-title\{text-align:center;font-weight:800\}/);assert.match(meterCss,/\.gross-eyebrow\{width:calc\(100% \+ 86px\);[^}]*text-align:center/);assert.match(meterCss,/@media\(max-width:760px\)[\s\S]*\.gross-eyebrow\{width:calc\(100% \+ 62px\)\}/);assert.ok(!/\.gross-(scroll|chart)\s*\{/.test(css));
});
test('changed assets are cache-busted and late briefing responses stay guarded',()=>{
 assert.match(html,/style\.css\?v=car-wash-icon-back-v46/);assert.match(html,/forecast-layout\.css\?v=weather-art-labels-v10/);assert.match(html,/personal-details\.css\?v=wpc-mpd-v12/);assert.match(html,/app\.js\?v=wpc-mpd-v55/);assert.match(html,/car-wash\.css\?v=rain-consensus-v41/);assert.match(html,/forecast-cards\.css\?v=remainder-today-v42/);assert.match(html,/scenario-layout\.css\?v=scenario-weather-v29/);
 assert.match(app,/dans-take\.js\?v=weather-art-labels-v10/);
 assert.match(app,/bulletins\.js\?v=wpc-mpd-v1/);
 assert.match(app,/experience\.js\?v=local-current-v49/);
 assert.match(app,/personal-details\.js\?v=pet-static-shake-v37/);
 assert.match(app,/forecast-story\.js\?v=forecast-trace-v40/);
 assert.match(app,/weather-display\.js\?v=radar-now-v47/);assert.match(app,/current-temperature\.js\?v=radar-now-v47/);assert.match(app,/car-wash\.js\?v=radar-now-v47/);
 assert.match(app,/model-explanation\.js\?v=nbm-blend-v45/);
 assert.match(app,/if \(id === generation && briefing\.signature === forecast\?\.signature\) renderBriefing\(briefing\)/);
});
test('Weather Nourie title quietly opens the shared experimental weather app',()=>{
 assert.match(html,/class="brand" href="\/weather-fusion\/experimental-weather\.html"/);
 assert.match(app,/document\.documentElement\.dataset\.weatherPage=experimentalPage\?'experimental':'main'/);
 assert.match(app,/if\(experimentalPage\)document\.title='Experimental Weather · Weather Nourie'/);
 assert.match(app,/if\(experimentalPage\)draw\('car-wash-forecast'/);
});
test('experimental weather has a top back button while the main page keeps it hidden',()=>{
 assert.match(html,/<div class="shell">\s*<a class="experimental-back" id="experimental-back" href="\/weather-fusion\/" hidden>/);
 assert.match(app,/const back=\$\('experimental-back'\);if\(back\)back\.hidden=!experimentalPage/);
 const style=read('style.css');assert.match(style,/\.experimental-back\{[^}]*display:inline-flex/);
});
test('both page modes merge fresh observed radar into Now without changing forecast percentages',()=>{
 assert.match(app,/api\('radar',query\(\)\)/);assert.match(app,/forecast\.current\.radarPrecipitation=data\.precipitation;render\(forecast\)/);
 assert.match(app,/lastRadarFetch=0/);
});
