import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastProseConflict} from '../public/weather-fusion/forecast-consistency.js';
import {danOverview,danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
import {forecastPeriodSummary} from '../public/weather-fusion/forecast-story.js';

const H=3600000,now=Date.parse('2026-10-18T12:00:00Z'),iso=time=>new Date(time).toISOString();
function forecast(){
 const rows=Array.from({length:36},(_,i)=>({time:iso(now+i*H),end:iso(now+(i+1)*H),condition:'Sunny',temperature:62,precipitation:0,rainLikelihood:{value:0}}));
 const period={value:0,aggregation:'maximum-hourly',window:{start:iso(now),end:'2026-10-19T00:00:00Z'}};
 return {signature:'dry-current',location:{latitude:35.8,longitude:-78.5,timeZone:'UTC',office:'RAH'},feeds:[],rainTimeline:rows,hours:rows,
  days:[{date:'2026-10-18',condition:'Sunny',detail:'Sunny and dry through this afternoon.',nightDetail:'Clear tonight.',rainLikelihood:period,popDayLikelihood:{...period,window:{start:iso(now),end:'2026-10-18T19:00:00Z'}},popNightLikelihood:{...period,window:{start:'2026-10-18T19:00:00Z',end:'2026-10-19T07:00:00Z'}}}]};
}
function discussion(f,text){
 f.feeds=[{id:'afd',status:'ready'}];
 f.discussion={id:'dry-source',office:'RAH',issuanceTime:'2026-10-18T11:00:00Z',text};
 return f;
}

test('ordinary rain prose cannot overrule a completely dry remaining point forecast',()=>{
 const f=forecast();
 for(const text of ['Rain develops this afternoon.','Showers are expected today.','Thunderstorms arrive today.'])assert.equal(forecastProseConflict(text,f,now)?.kind,'rain-during-dry-forecast',text);
 const take=danTakeDisplay({signature:f.signature,mode:'ai',danSummary:'Rain develops this afternoon.'},f,now);
 assert.match(take,/sunny|dry/i);assert.doesNotMatch(take,/rain|shower|storm/i);
});

test('provider-failure synopsis and daily-detail fallbacks obey the same dry point forecast',()=>{
 const f=discussion(forecast(),'.SYNOPSIS...\nRain develops this afternoon.\n&&');
 assert.doesNotMatch(danOverview(null,f,now).text,/rain|shower|storm/i);
 f.discussion=null;f.feeds=[];f.days[0].detail='Showers are expected this afternoon.';
 const take=danTakeDisplay(null,f,now);
 assert.match(take,/temperature/i);assert.doesNotMatch(take,/rain|shower|storm/i);
});

test('dated later rain remains visible while today stays dry',()=>{
 const f=forecast();
 for(const row of f.rainTimeline)if(Date.parse(row.time)>=Date.parse('2026-10-19T00:00:00Z')){row.precipitation=.08;row.rainLikelihood.value=85;row.condition='Rain';}
 const text='Dry today. Rain arrives tomorrow.';
 assert.equal(forecastProseConflict(text,f,now),null);
 assert.equal(danTakeDisplay({signature:f.signature,mode:'ai',danSummary:text},f,now),text);
});

test('missing measurements, gaps, positive chances, and explicit wet conditions are not proof of dryness',()=>{
 for(const alter of [f=>{f.rainTimeline[2].rainLikelihood.value=null;},f=>{f.rainTimeline[2].precipitation=null;},f=>{f.rainTimeline.splice(2,1);},f=>{f.rainTimeline[2].rainLikelihood.value=12;},f=>{f.rainTimeline[2].condition='Rain';}]){
  const f=forecast();alter(f);assert.equal(forecastProseConflict('Rain develops today.',f,now),null);
 }
 assert.equal(forecastProseConflict('Rain fell yesterday. Dry weather returns today.',forecast(),now),null);
 assert.equal(forecastProseConflict('Rain is unlikely today.',forecast(),now),null);
});

test('snow-only hourly guidance is described as snow, without inventing a rain event',()=>{
 const f=forecast();
 for(const row of f.rainTimeline){row.condition='Snow';row.precipitation=.02;row.temperature=27;row.rainLikelihood.value=75;}
 for(const key of ['rainLikelihood','popDayLikelihood','popNightLikelihood'])f.days[0][key].value=75;
 const story=forecastPeriodSummary(f,0,'daytime',now);
 assert.equal(story.chance,75);assert.match(story.summary,/Snow chance peaks at 75%/);assert.match(story.summary,/best chance for snow/i);assert.doesNotMatch(story.summary,/\brain\b/i);
 assert.ok(Math.abs(story.amount-.14)<1e-9,'snow liquid-equivalent amount retains the existing hourly calculation');
});

test('a mixed rain-and-snow period uses precipitation wording and preserves both exact source hours',()=>{
 const f=forecast();
 for(const [i,row] of f.rainTimeline.entries()){row.condition=i%2?'Rain':'Snow';row.precipitation=.02;row.rainLikelihood.value=75;}
 f.days[0].popDayLikelihood.value=75;
 const story=forecastPeriodSummary(f,0,'daytime',now);
 assert.match(story.summary,/Precipitation chance peaks at 75%/);assert.equal(story.rows[0].condition,'Snow');assert.equal(story.rows[1].condition,'Rain');
});
