import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sevenDayForecast,sevenDayCardHTML,createSevenDayCarousel} from '../public/weather-fusion/seven-day.js';
import {dailyDisplay} from '../public/weather-fusion/weather-math.js';
import {displayedRainChance} from '../public/weather-fusion/rain-display.js';
import {forecastPeriodSummary} from '../public/weather-fusion/forecast-story.js';
import {preview,now,H} from './weatherFusion.fixtures.js';
import {confidenceMeterPosition} from '../public/weather-fusion/forecast-confidence.js';

test('seven day cards share the existing daily timing, rain, totals and confidence',()=>{
  const days=sevenDayForecast(preview,now);
  assert.equal(days.length,7);
  days.forEach((day,index)=>{
    const display=dailyDisplay(preview.days[index],index,now,preview.location.timeZone,preview);
    assert.equal(day.high,display.tonight?null:display.primary);
    assert.equal(day.low,display.tonight?display.primary:display.secondary);
    assert.equal(day.pop,displayedRainChance(preview,display.pop,{dayIndex:index,now}).value);
    assert.equal(day.amount,forecastPeriodSummary(preview,index,display.phase,now).amount);
    assert.equal(day.confidence,preview.days[index].confidence);
  });
});

test('evening changes the artwork without switching the card to tomorrow’s forecast',()=>{
  const evening=now+8*H,first=sevenDayForecast(preview,evening)[0];
  const display=dailyDisplay(preview.days[0],0,evening,preview.location.timeZone,preview);
  assert.equal(first.label,'Today');assert.equal(first.high,display.primary);assert.equal(first.low,display.secondary);
  assert.equal(first.isDay,false);
  assert.equal(first.amount,forecastPeriodSummary(preview,0,'overall',evening).amount);
  assert.equal(first.pop,forecastPeriodSummary(preview,0,'overall',evening).chance);
});

test('real zeros remain zero and missing inputs are never fabricated',()=>{
  const forecast=structuredClone(preview);
  forecast.days[0].qpf=0;forecast.days[0].pop=0;
  forecast.days[0].rainLikelihood=null;forecast.days[0].popDayLikelihood=null;forecast.days[0].popNightLikelihood=null;
  forecast.hours=[];delete forecast.rainTimeline;forecast.metricForecasts={series:{wind:[]}};
  const day=sevenDayForecast(forecast,now)[0];
  assert.equal(day.amount,0);assert.equal(day.wind,null);
  const html=sevenDayCardHTML(day);
  assert.match(html,/0\.00 in/);assert.doesNotMatch(html,/NaN|undefined/);
  forecast.days[0].qpf=null;forecast.days[0].confidence=null;
  const missing=sevenDayForecast(forecast,now)[0];
  assert.equal(missing.amount,null);assert.equal(missing.confidence,null);
  assert.doesNotMatch(sevenDayCardHTML(missing),/aria-valuenow=/);
});

test('observed rain follows the current-day policy and never spreads to later cards',()=>{
  const forecast=structuredClone(preview);
  forecast.current.radarPrecipitation={status:'ready',atLocation:true,time:new Date(now).toISOString()};
  const days=sevenDayForecast(forecast,now);
  assert.equal(days[0].observed,displayedRainChance(forecast,days[0].pop,{now}).observed);
  assert.ok(days.slice(1).every(day=>!day.observed));
});

test('the shared carousel is safe to import without a browser document',()=>{
  assert.equal(createSevenDayCarousel(),null);
  assert.equal(createSevenDayCarousel({onOpenDay:()=>{}}),null);
});

test('main and experimental pages share an ungated carousel below the weather take',()=>{
  const app=readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
  assert.match(app,/const sevenDayCarousel=createSevenDayCarousel\(\{onOpenDay:index=>showDay\(index\)\}\)/);
  const anchors=[];
  globalThis.document={querySelector:selector=>{anchors.push(selector);return null;}};
  try {
    assert.equal(createSevenDayCarousel(),null);
    assert.equal(createSevenDayCarousel({onOpenDay:()=>{}}),null);
    assert.deepEqual(anchors,['.hero .today-panel','.hero .today-panel']);
  }finally{delete globalThis.document;}
});

test('day cards open the existing details dialog without an inline details row',()=>{
  const html=sevenDayCardHTML(sevenDayForecast(preview,now)[0]);
  const module=readFileSync(new URL('../public/weather-fusion/seven-day.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  assert.match(html,/aria-controls="day-dialog" aria-haspopup="dialog"/);
  assert.doesNotMatch(module,/seven-day-detail|seven-day-open|detailHTML/);
  assert.doesNotMatch(css,/seven-day-detail|seven-day-open/);
  assert.match(module,/if\(button\)\{const index=Number\(button\.dataset\.weekDay\);select\(index\);onOpenDay\(index\);\}/);
  assert.match(module,/if\(suppressClick\)\{event\.preventDefault\(\);suppressClick=false;return;\}/);
  assert.match(module,/rail\.addEventListener\('keydown',[\s\S]*?\{focus:true\}/);
});

test('compact cards retain every forecast reading and the absolute confidence score',()=>{
  for(const [key,label,score] of [['high','High',95],['moderate','Moderate',75],['low','Low',60],['very-low','Very low',35]]){
    const day={...sevenDayForecast(preview,now)[0],confidence:{key,label,score,factors:[],note:'Relative index'}};
    const html=sevenDayCardHTML(day);
    assert.match(html,/seven-day-card-heading/);
    assert.match(html,/seven-day-weather/);
    assert.match(html,/Total precip/);
    assert.match(html,/Wind/);
    assert.ok(html.includes(`data-confidence="${key}"`));
    assert.ok(html.includes(`aria-valuenow="${score}"`));
    assert.ok(html.includes(`--confidence:${confidenceMeterPosition(day.confidence)}%`));
  }
});

test('all confidence meters share fading red-yellow-green category segments',()=>{
  const polish=readFileSync(new URL('../public/weather-fusion/weather-polish.css',import.meta.url),'utf8');
  const week=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  assert.match(polish,/--confidence-scale:linear-gradient\(90deg,var\(--confidence-low\).*var\(--confidence-medium\).*var\(--confidence-high\)/);
  assert.match(polish,/--confidence-scale:linear-gradient\(90deg,var\(--confidence-low\) 0%,var\(--confidence-low\) 30%,var\(--confidence-medium\) 40%,var\(--confidence-medium\) 60%,var\(--confidence-high\) 70%,var\(--confidence-high\) 100%\)/);
  assert.doesNotMatch(polish,/var\(--confidence-low\) 55%/);
  assert.match(polish,/\[data-confidence="high"\]\{--confidence-color:var\(--confidence-high\)/);
  assert.match(polish,/\[data-confidence="moderate"\]\{--confidence-color:var\(--confidence-medium\)/);
  assert.match(polish,/\[data-confidence="low"\],\[data-confidence="very-low"\]\{--confidence-color:var\(--confidence-low\)/);
  assert.match(polish,/\.confidence-meter\{background:var\(--confidence-scale\)/);
  assert.match(polish,/\.confidence-meter em\{position:relative;background:transparent/);
  assert.match(week,/\.seven-day-meter\{[^}]*background:var\(--confidence-scale\)/);
  assert.match(week,/height:var\(--week-height,/);
});

test('confidence dots stay in their label color range, including category boundaries',()=>{
  for(const [key,scores,min,max] of [
    ['very-low',[0,35,50],0,30],
    ['low',[55,60,65,69.99],0,30],
    ['moderate',[70,75,80,84.99],40,60],
    ['high',[85,90,95,100],70,100]
  ]){
    let previous=-1;
    for(const score of scores){
      const confidence={key,score};
      const position=confidenceMeterPosition(confidence);
      assert.ok(position>=min&&position<=max,`${key} ${score}: ${position}`);
      assert.ok(position>=previous);previous=position;
      assert.equal(confidence.score,score);
    }
  }
  assert.equal(confidenceMeterPosition({key:'low',score:65}),27.86);
  assert.equal(confidenceMeterPosition({key:'moderate',score:75}),46.67);
  assert.equal(confidenceMeterPosition({key:'high',score:95}),90);
  assert.equal(confidenceMeterPosition({key:'high',score:75}),70,'alternate model labels remain authoritative');
  assert.equal(confidenceMeterPosition({key:'moderate',score:50}),40);
  assert.equal(confidenceMeterPosition({key:'high',score:150}),100);
  assert.equal(confidenceMeterPosition({key:'low',score:-1}),0);
  for(const confidence of [null,{}, {key:'unavailable',score:70},{key:'low',score:null},{key:'high',score:NaN}])assert.equal(confidenceMeterPosition(confidence),null);
});

test('confidence labels use normal weight across daily cards and the day dialog',()=>{
  const polish=readFileSync(new URL('../public/weather-fusion/weather-polish.css',import.meta.url),'utf8');
  const week=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  assert.match(week,/\.seven-day-confidence-label strong\{[^}]*font-weight:400/);
  assert.match(polish,/\.dialog-confidence\[data-confidence\]>summary\{[^}]*font-weight:400/);
  assert.match(polish,/\.forecast-confidence,\.forecast-confidence>span\{font-weight:400\}/);
});

test('card widths follow hourly geometry and confidence dots remain large and outlined',()=>{
  const module=readFileSync(new URL('../public/weather-fusion/seven-day.js',import.meta.url),'utf8');
  const week=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  const polish=readFileSync(new URL('../public/weather-fusion/weather-polish.css',import.meta.url),'utf8');
  assert.match(module,/hourly\?\.querySelector\('button\.hour'\)\?\.getBoundingClientRect\(\)\.width/);
  assert.match(module,/setProperty\('--week-card',/);
  assert.match(week,/\.seven-day-meter>span\{[^}]*width:14px;height:14px;border:2px solid #fff/);
  assert.match(polish,/\.confidence-meter em::after\{[^}]*width:14px;height:14px;border:2px solid #fff/);
  assert.match(polish,/\.confidence-meter\{[^}]*overflow:visible/);
});

test('narrow cards retain large and negative readings with their original units',()=>{
  const day={...sevenDayForecast(preview,now)[0],high:121,low:-45,amount:12.34,wind:150};
  const html=sevenDayCardHTML(day);
  assert.match(html,/121\u00b0/);assert.match(html,/-45\u00b0/);
  assert.match(html,/12\.34 in/);assert.match(html,/150 mph/);
  assert.match(html,/--narrow-temp-size:14px/);
  assert.match(html,/font-size:10px/);
});

test('snow cards use the same daily amount and source as the primary snow forecast',()=>{
  const forecast=structuredClone(preview),date=forecast.days[1].date;
  forecast.days[1].snowPossible=true;forecast.days[1].snowfall=.1;
  forecast.snow={days:[{date,best:.1,displaySnowfall:{value:0,range:null,source:'NWS point forecast',status:'ready'}}]};
  let day=sevenDayForecast(forecast,now)[1];
  assert.equal(day.snowfall,0);assert.equal(day.snowAmountSource,'NWS point forecast');
  let html=sevenDayCardHTML(day);
  assert.match(html,/seven-day-snow" title="NWS point forecast">Snow possible/);
  assert.doesNotMatch(html,/❄ 0\.1|0\.0″/);
  assert.equal(forecast.days[1].snowfall,.1,'the underlying requested blend remains unchanged');
  forecast.snow.days[0].displaySnowfall.value=.02;
  day=sevenDayForecast(forecast,now)[1];html=sevenDayCardHTML(day);
  assert.equal(day.snowfall,.02);assert.match(html,/❄ &lt;0\.1″/);
  forecast.snow.days[0].displaySnowfall.value=null;
  day=sevenDayForecast(forecast,now)[1];assert.equal(day.snowfall,null);
  assert.match(sevenDayCardHTML(day),/Snow possible/);
});
