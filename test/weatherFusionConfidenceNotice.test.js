import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confidenceNotice} from '../public/weather-fusion/today-card.js';
import {dailyConfidenceNoticeHTML,renderDailyRows} from '../public/weather-fusion/experience.js';

const confidence=(key,label,factors=[])=>({key,label,score:key==='very-low'?45:60,sourceCount:2,factors,note:'Relative confidence index, not a probability.'});

test('plain-language confidence notices cover low and very-low forecasts only',()=>{
 const low=confidenceNotice(confidence('low','Low',['limited temperature comparison']));
 assert.equal(low.title,'Lower confidence forecast');
 assert.match(low.text,/usual forecast inputs are missing or limited/i);
 assert.match(low.text,/Click for details\.$/);
 const veryLow=confidenceNotice(confidence('very-low','Very low',['0.40 in rainfall-guidance spread']));
 assert.equal(veryLow.title,'Very low confidence forecast');
 assert.match(veryLow.text,/sources do not line up cleanly/i);
 for(const [key,label] of [['moderate','Moderate'],['high','High'],['unavailable','Unavailable']]){
  assert.equal(confidenceNotice(confidence(key,label)),null);
 }
});

test('daily rows give every low-confidence future period a visible click-for-details notice',()=>{
 const days=[
  ['Today','high','High'],
  ['Monday','low','Low'],
  ['Tuesday','very-low','Very low'],
  ['Wednesday','moderate','Moderate'],
 ].map(([label,key,confidenceLabel],index)=>({
  date:`2030-01-${String(index+1).padStart(2,'0')}`,label,high:70+index,low:50+index,
  condition:'Mostly Sunny',nightCondition:'Mostly Clear',pop:index?100:23,uvMax:3,
  confidence:confidence(key,confidenceLabel,key==='low'?['limited rainfall comparison']:['0.30 in rainfall-guidance spread']),
 }));
 const forecast={location:{timeZone:'America/New_York'},days,metricForecasts:{series:{feels:[]}}};
 const daily={innerHTML:''},originalDocument=globalThis.document;
 globalThis.document={getElementById:id=>id==='daily'?daily:null};
 try{renderDailyRows(forecast,condition=>`<svg data-condition="${condition}" aria-hidden="true"></svg>`);}
 finally{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
 const rows=[...daily.innerHTML.matchAll(/<button class="day-row[\s\S]*?<\/button>/g)].map(match=>match[0]);
 assert.equal(rows.length,4);
 assert.doesNotMatch(rows[0],/forecast-confidence-notice|Click for details/);
 assert.match(rows[1],/class="forecast-confidence-notice"[\s\S]*Lower confidence forecast[\s\S]*Click for details\./);
 assert.match(rows[1],/aria-label="[^"]*Lower confidence forecast\.[^"]*Click for details\.[^"]*Open details\./,'the visible notice is included in the button accessible name');
 assert.match(rows[1],/aria-label="[^"]*Rain\. Rain chance 100 percent\./,'the displayed condition and rain percentage are included in the accessible name');
 assert.match(rows[1],/data-condition="Rain"/,'dominant rain replaces sunny-only icon artwork');
 assert.match(rows[2],/class="forecast-confidence-notice"[\s\S]*Very low confidence forecast[\s\S]*Click for details\./);
 assert.doesNotMatch(rows[3],/forecast-confidence-notice|Click for details/);
});

test('the open-day dialog uses a distinct, styled lower-confidence notice',()=>{
 const low=confidence('low','Low',['limited rainfall comparison']);
 assert.match(dailyConfidenceNoticeHTML(low,true),/^<div class="dialog-confidence-notice"[\s\S]*Confidence details are below\.<\/span><\/div>$/);
 assert.doesNotMatch(dailyConfidenceNoticeHTML(low,true),/Click for details/);
 assert.match(dailyConfidenceNoticeHTML(low),/^<span class="forecast-confidence-notice"/);
 assert.equal(dailyConfidenceNoticeHTML(confidence('high','High'),true),'');
 const app=readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
 assert.match(app,/dailyConfidenceNoticeHTML\(d\.confidence,true\)/);
});

test('daily-row and dialog notices have responsive visual treatment',()=>{
 const scenario=readFileSync(new URL('../public/weather-fusion/scenario-layout.css',import.meta.url),'utf8');
 const layout=readFileSync(new URL('../public/weather-fusion/forecast-layout.css',import.meta.url),'utf8');
 assert.match(scenario,/\.daily-panel \.forecast-confidence-notice\{[^}]*grid-column:1\/-1;[^}]*width:100%;[^}]*border:/);
 assert.match(scenario,/@media\(max-width:760px\)[\s\S]*\.daily-panel \.forecast-confidence-notice\{[^}]*flex-wrap:wrap/);
 assert.match(layout,/\.dialog-confidence-notice\{[^}]*border:[^}]*background:/);
 assert.match(layout,/@media\(max-width:600px\)[^\n]*\.dialog-confidence-notice\{/);
});
