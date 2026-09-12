import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {modelExplanationView,modelExplanationHTML,renderModelExplanation,resetModelExplanation} from '../public/weather-fusion/model-explanation.js';

const HOUR = 3600000;
const now = Date.parse('2026-09-12T11:00:00Z');
const at = offset => new Date(now+offset*HOUR).toISOString();

function likelihood(value, options = {}) {
  const hrrrWet=value===42,sourceValues={nws:30,hrrr:hrrrWet?100:0,ecmwf:0,nbm:0};
  const sourcePoints={nws:12,hrrr:hrrrWet?30:0,ecmwf:0,nbm:0};
  return {value,rawValue:value,weightedValue:value,rawTotal:value,
    officialProbability:30,sourceValues,sourcePoints,sourceAmounts:{nws:.01,hrrr:hrrrWet?.02:0,ecmwf:0,nbm:0},drySources:['hrrr','ecmwf','nbm'],wetSources:hrrrWet?['hrrr']:[],
    sources:[{id:'nws',value:30,weight:.4,points:12,runAt:at(-1)},{id:'hrrr',value:sourceValues.hrrr,weight:.3,points:sourcePoints.hrrr,runAt:at(-2)},{id:'ecmwf',value:0,weight:.1,points:0,runAt:at(-5)},{id:'nbm',value:0,weight:.2,points:0,runAt:at(-3)}],...options};
}

function fixture() {
  const rainTimeline = Array.from({length:72},(_,index)=>({time:at(index),end:at(index+1),rainLikelihood:likelihood(index===58?42:12),officialPop:30,precipitation:0}));
  function period(start,end) {
    const rows=rainTimeline.slice(start,end),peak=rows.reduce((a,b)=>a.rainLikelihood.value>=b.rainLikelihood.value?a:b);
    return {value:peak.rainLikelihood.value,aggregation:'maximum-hourly',window:{start:at(start),end:at(end)},coverage:{expectedHours:end-start,availableHours:end-start,complete:true},peakTime:peak.time,peakEnd:peak.end,peak:peak.rainLikelihood,sources:peak.rainLikelihood.sources};
  }
  return {location:{timeZone:'America/New_York'},rainTimeline,hours:rainTimeline.slice(0,48),
    days:[0,1,2].map(index=>({date:`2026-09-${12+index}`,rainLikelihood:period(index*24,index*24+24),popDayLikelihood:period(index*24,index*24+12),popNightLikelihood:period(index*24+12,index*24+24),
      high:86,highBlend:{value:85.6,sources:[{id:'nws',value:86,weight:.4},{id:'hrrr',value:88,weight:.3},{id:'ecmwf',value:80,weight:.1},{id:'nbm',value:84,weight:.2}]},
      low:70,lowBlend:{value:70.2,sources:[{id:'nws',value:71,weight:.6},{id:'ecmwf',value:69,weight:.4}]}})),
    modelContributions:[{id:'hrrr',runAt:at(-2),runScope:'Successive runs of HRRR'},{id:'ecmwf',runAt:at(-5)},{id:'nbm',runAt:at(-3)}],
    feeds:[{id:'nws',status:'ready',issuedAt:at(-1),fetchedAt:at(0)},{id:'hrrr',status:'ready'},{id:'ecmwf',status:'ready'},{id:'nbm',status:'ready'}]};
}

test('model explanation defaults to the same Today/ Tonight period as the main card',()=>{
  const forecast=fixture();
  assert.equal(modelExplanationView(forecast,{now}).phase,'daytime');
  assert.equal(modelExplanationView(forecast,{now:Date.parse('2026-09-12T19:00:00Z')}).phase,'overnight');
  assert.equal(modelExplanationView(forecast,{index:1,now}).phase,'overall');
  assert.equal(modelExplanationView(forecast,{index:0,phase:'overall',now}).phase,'overall');
});

test('every daily estimate is tied to its canonical peak hour including beyond the 48-hour strip',()=>{
  const forecast=fixture(),view=modelExplanationView(forecast,{index:2,now});
  assert.equal(view.value,42);
  assert.equal(view.maximum,42);
  assert.equal(view.peakTime,at(58));
  assert.equal(view.rows.length,24);
  assert.equal(view.mismatch,false);
  assert.equal(view.peak,forecast.rainTimeline[58].rainLikelihood);
  assert.ok(!forecast.hours.some(row=>row.time===view.peakTime));
  const html=modelExplanationHTML(forecast,{index:2,now});
  assert.match(html,/All 24 forecast hours in this period/);
  assert.match(html,/Mon, Sep 14, 5 PM/);
  assert.match(html,/data-peak="true"/);
});

test('rain inputs scale the NWS share and use fixed model points',()=>{
  const html=modelExplanationHTML(fixture(),{now});
  assert.match(html,/30% probability/);
  assert.match(html,/<th scope="row">NBM<\/th><td>0 in<small>Rain forecast: No<\/small><\/td><td>20%<\/td><td>0<\/td>/);
  assert.doesNotMatch(html,/QPF support|NWS-anchored input/);
  assert.match(html,/NWS hourly probability fills its 40-point share proportionally/);
  assert.match(html,/40% NWS chance contributes 16 points/);
  assert.match(html,/HRRR adds 30 points when it forecasts any rain, ECMWF adds 10, and NBM adds 20/);
  assert.match(html,/amount of rain does not change these points/);
  assert.match(html,/result is capped at 100%/);
  assert.match(html,/uncalibrated estimate, not a proven model-accuracy ranking/);
  assert.match(html,/not a separate probability of rain at any time/);
  const forecast=fixture(),allWet=likelihood(81,{officialProbability:53,rawTotal:81.2,weightedValue:81.2,rawValue:81,
    sourceValues:{nws:53,hrrr:100,ecmwf:100,nbm:100},sourcePoints:{nws:21.2,hrrr:30,ecmwf:10,nbm:20},sourceAmounts:{nws:.02,hrrr:.157,ecmwf:.016,nbm:.012},
    sources:[{id:'nws',value:53,weight:.4,points:21.2},{id:'hrrr',value:100,weight:.3,points:30},{id:'ecmwf',value:100,weight:.1,points:10},{id:'nbm',value:100,weight:.2,points:20}],drySources:[],wetSources:['hrrr','ecmwf','nbm']});
  forecast.rainTimeline[0].rainLikelihood=allWet;
  Object.assign(forecast.days[0].popDayLikelihood,{value:81,peak:allWet,peakTime:at(0)});
  const unanimous=modelExplanationHTML(forecast,{now});
  assert.match(unanimous,/53% probability<\/td><td>40%<\/td><td>21\.2<\/td>/);
  assert.match(unanimous,/0\.157 in<small>Rain forecast: Yes<\/small><\/td><td>30%<\/td><td>30<\/td>/);
  assert.match(unanimous,/0\.016 in<small>Rain forecast: Yes<\/small><\/td><td>10%<\/td><td>10<\/td>/);
  assert.match(unanimous,/0\.012 in<small>Rain forecast: Yes<\/small><\/td><td>20%<\/td><td>20<\/td>/);
  assert.match(unanimous,/Shown: <b>81%/);
  assert.match(unanimous,/21\.2 \+ 30 \+ 10 \+ 20 = 81\.2/);
});

test('missing models do not renormalize the NWS base or remaining model points',()=>{
  const forecast=fixture();
  const value=likelihood(18,{officialProbability:20,weightedValue:18,rawTotal:18,rawValue:18,sourceValues:{nws:20,hrrr:null,ecmwf:100,nbm:null},sourcePoints:{nws:8,hrrr:null,ecmwf:10,nbm:null},sourceAmounts:{nws:.01,hrrr:null,ecmwf:.02,nbm:null},sources:[{id:'nws',value:20,weight:.4,points:8},{id:'ecmwf',value:100,weight:.1,points:10}],drySources:[]});
  forecast.rainTimeline[0].rainLikelihood=value;
  Object.assign(forecast.days[0].popDayLikelihood,{value:18,peak:value,peakTime:at(0)});
  const html=modelExplanationHTML(forecast,{now});
  assert.match(html,/8 \+ 10 = 18/);
  assert.match(html,/Rounded: <b>18%<\/b>\. Shown: <b>18%/);
  assert.match(html,/<th scope="row">HRRR<\/th><td>Unavailable<\/td><td>Not used<\/td><td>—/);
});

test('a single wet vote keeps its exact points without low-score suppression',()=>{
  const forecast=fixture(),single=likelihood(20,{officialProbability:0,weightedValue:20,rawTotal:20,rawValue:20,sourceValues:{nws:0,hrrr:0,ecmwf:0,nbm:100},sourcePoints:{nws:0,hrrr:0,ecmwf:0,nbm:20},wetSources:['nbm'],sources:[{id:'nws',value:0,weight:.4,points:0},{id:'hrrr',value:0,weight:.3,points:0},{id:'ecmwf',value:0,weight:.1,points:0},{id:'nbm',value:100,weight:.2,points:20}]});
  for(const row of forecast.rainTimeline)row.rainLikelihood=single;
  Object.assign(forecast.days[0].popDayLikelihood,{value:20,peak:single});
  const html=modelExplanationHTML(forecast,{now});
  assert.match(html,/Rounded: <b>20%<\/b>\. Shown: <b>20%/);
  assert.doesNotMatch(html,/fewer than two available sources|below 25%/);
  assert.doesNotMatch(html,/Data mismatch/);
});

test('missing hourly data remains unavailable instead of becoming a zero or a reassuring match',()=>{
  const forecast=fixture();
  forecast.days[0].popDayLikelihood={value:null,window:{start:at(0),end:at(12)},coverage:{expectedHours:12,availableHours:4,complete:false}};
  forecast.rainTimeline=forecast.rainTimeline.slice(0,4);
  const view=modelExplanationView(forecast,{now}),html=modelExplanationHTML(forecast,{now});
  assert.equal(view.value,null);
  assert.equal(view.maximum,12);
  assert.equal(view.complete,false);
  assert.match(html,/Incomplete coverage: 4 of 12 hours/);
  assert.match(html,/Highest available hour: 12%/);
  assert.match(html,/<div class="model-period"><strong>—<\/strong>/);
});

test('a real period/hour mismatch is flagged rather than hidden by the explanation',()=>{
  const forecast=fixture();
  forecast.days[0].popDayLikelihood.value=59;
  const view=modelExplanationView(forecast,{now});
  assert.equal(view.mismatch,true);
  assert.match(modelExplanationHTML(forecast,{now}),/Data mismatch: the period shows 59%, but the highest supplied hour is 12%/);
});

test('source runs use issuance metadata and preserve supplied run scope',()=>{
  const html=modelExplanationHTML(fixture(),{now});
  assert.match(html,/Latest published run: Sat, Sep 12, 5 AM/);
  assert.match(html,/Issued: Sat, Sep 12, 6 AM/);
  assert.match(html,/Successive runs of HRRR/);
  assert.doesNotMatch(html,/Issued: Sat, Sep 12, 7 AM/);
});

test('source status distinguishes a checked-but-failed refresh from the last data actually fetched',()=>{
  const forecast=fixture();
  Object.assign(forecast.feeds[1],{fetchedAt:at(-2),checkedAt:at(1),retrievalStatus:'last-verified',refreshWarning:'Latest fetch unavailable; retaining the verified run.'});
  const html=modelExplanationHTML(forecast,{now});
  assert.match(html,/Data fetched: Sat, Sep 12, 5 AM/);
  assert.match(html,/Last check: Sat, Sep 12, 8 AM/);
  assert.match(html,/Using last verified data; the latest refresh did not succeed/);
  assert.match(html,/Latest fetch unavailable; retaining the verified run/);
  assert.match(html,/NWS hourly probability fills its 40-point share proportionally/);
});

test('NWS hourly source time never borrows the different daily forecast issuance',()=>{
  const forecast=fixture();
  for(const row of forecast.rainTimeline)row.rainLikelihood.sources[0].runAt=null;
  const missing=modelExplanationHTML(forecast,{now});
  assert.match(missing,/Issued: Not supplied/);
  forecast.feeds.push({id:'hourly',issuedAt:at(-3),status:'ready'});
  const hourly=modelExplanationHTML(forecast,{now});
  assert.match(hourly,/Issued: Sat, Sep 12, 4 AM/);
  assert.doesNotMatch(hourly,/Issued: Sat, Sep 12, 6 AM/);
});

test('temperatures disclose only the recorded source values and applied weights',()=>{
  const html=modelExplanationHTML(fixture(),{now});
  assert.match(html,/High: 86°F/);
  assert.match(html,/86 × 0\.4 \+ 88 × 0\.3 \+ 80 × 0\.1 \+ 84 × 0\.2 = 85\.6°F → 86°F/);
  assert.match(html,/Low: 70°F/);
  const forecast=fixture();delete forecast.days[0].highBlend;delete forecast.days[0].lowBlend;
  assert.doesNotMatch(modelExplanationHTML(forecast,{now}),/Temperature calculations/);
});

test('provider data is escaped and malformed optional inputs do not crash the section',()=>{
  const forecast=fixture();forecast.modelContributions[0].runScope='<img src=x onerror=alert(1)>';
  const html=modelExplanationHTML(forecast,{now});
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<img src=x/);
  assert.doesNotThrow(()=>modelExplanationHTML({location:{timeZone:'bad'},days:[],rainTimeline:[]},{now}));
});

test('experimental rendering stays off the main page and reset clears previous-location data',()=>{
  const oldDocument=globalThis.document,oldLocation=globalThis.location;
  const panel={hidden:true,innerHTML:'previous location',onchange:null};
  globalThis.document={getElementById:()=>panel};
  globalThis.location={pathname:'/weather-fusion/'};
  try{
    assert.equal(renderModelExplanation(fixture(),now),null);
    assert.equal(panel.hidden,true);
    globalThis.location.pathname='/weather-fusion/experimental-weather.html';
    assert.equal(renderModelExplanation(fixture(),now).value,12);
    assert.equal(panel.hidden,false);
    assert.match(panel.innerHTML,/Why this forecast/);
    resetModelExplanation();
    assert.equal(panel.hidden,true);
    assert.equal(panel.innerHTML,'');
    assert.equal(panel.onchange,null);
  }finally{globalThis.document=oldDocument;globalThis.location=oldLocation;}
});

test('refresh preserves open hourly calculations and focused details while auto phase follows Today/Tonight',()=>{
  const oldDocument=globalThis.document,oldLocation=globalThis.location;
  let details=[],focused=null;
  function makeDetail(key){
    const detail={dataset:{modelDetail:key},open:false};
    detail.summary={parentElement:detail,matches:selector=>selector==='summary',focus:()=>{focused=key;}};
    detail.querySelector=()=>detail.summary;
    return detail;
  }
  const panel={hidden:true,onchange:null,
    get innerHTML(){return this.html||'';},
    set innerHTML(value){this.html=value;details=[...value.matchAll(/data-model-detail="([^"]+)"/g)].map(match=>makeDetail(match[1]));},
    querySelectorAll(selector){return selector.includes('[open]')?details.filter(detail=>detail.open):details;},
    contains(element){return details.some(detail=>detail.summary===element);},
  };
  globalThis.document={getElementById:()=>panel,activeElement:null};
  globalThis.location={pathname:'/weather-fusion/experimental-weather.html'};
  try{
    resetModelExplanation();
    assert.equal(renderModelExplanation(fixture(),now).phase,'daytime');
    const key=`hour-${at(1)}`,hour=details.find(detail=>detail.dataset.modelDetail===key);
    hour.open=true;details.find(detail=>detail.dataset.modelDetail==='hours').open=true;
    globalThis.document.activeElement=hour.summary;
    renderModelExplanation(fixture(),now+60000);
    assert.equal(details.find(detail=>detail.dataset.modelDetail===key).open,true);
    assert.equal(details.find(detail=>detail.dataset.modelDetail==='hours').open,true);
    assert.equal(focused,key);
    assert.equal(renderModelExplanation(fixture(),Date.parse('2026-09-12T19:00:00Z')).phase,'overnight');
    resetModelExplanation();
  }finally{globalThis.document=oldDocument;globalThis.location=oldLocation;}
});

test('mobile styles have bounded tables, readable controls and scoped selectors',async()=>{
  const css=await readFile(new URL('../public/weather-fusion/model-explanation.css',import.meta.url),'utf8');
  assert.match(css,/table-layout:fixed/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/overflow-wrap:anywhere/);
  assert.match(css,/@media\(max-width:400px\)/);
  assert.match(css,/#model-explanation\[hidden\]\{display:none\}/);
});
