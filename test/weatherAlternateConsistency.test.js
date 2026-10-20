import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTodayModel} from '../public/weather-fusion/today.js';
import {buildGlanceModel} from '../public/weather-fusion/glance.js';
import {buildBlendModel,completeTemperatureRange,CHART_VARS} from '../public/weather-fusion/blend.js';
import {buildModel as buildHaloModel,buildSeries as buildHaloSeries,dailySummary as haloDailySummary} from '../public/weather-fusion/halo.js';
import {buildUltimateCurrent} from '../public/weather-fusion/ultimate.js';
import {calendarDayTemperatures,calendarDayWindow} from '../public/weather-fusion/calendar-day.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';
const H=3600000,now=Date.parse('2026-10-20T09:28:00Z'),iso=t=>new Date(t).toISOString();
function fixture(){
 const start=Date.parse('2026-10-20T04:00:00Z');
 const hours=Array.from({length:72},(_,i)=>({time:iso(start+i*H),end:iso(start+(i+1)*H),temperature:40+i%24,dewpoint:30,wind:5,condition:'Clear',isDay:i%24>=8&&i%24<19,pop:99,rainLikelihood:{value:17},temperatureBlend:{value:40+i%24,sources:[{id:'nws',value:39+i%24},{id:'ecmwf',value:41+i%24}]}}));
 const days=[20,21,22].map((date,i)=>({date:`2026-10-${date}`,label:i?'Later':'Today',high:999,low:-999,condition:'Sunny',pop:99,rainLikelihood:{aggregation:'maximum-hourly',value:17}}));
 return {assembledAt:iso(now),location:{id:'knightdale',latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},current:{type:'guidance',time:iso(Math.floor(now/H)*H),temperature:50,dewpoint:30,wind:5,humidity:45,condition:'Clear',visibility:10},days,hours,rainTimeline:hours,
  metricForecasts:{series:{temperature:hours.map(h=>({time:h.time,value:h.temperature,sources:h.temperatureBlend.sources})),feels:[]}},solar:{sunrise:'2026-10-20T11:26:00Z',sunset:'2026-10-20T22:34:00Z'},uv:{today:5.15,hourly:[{time:iso(Math.floor(now/H)*H),value:0}]},airQuality:{time:iso(Math.floor(now/H)*H),aqi:30},riskOutlooks:[]};
}
function allModels(f,n=now){return {today:buildTodayModel(f,n),glance:buildGlanceModel(f,n),blend:buildBlendModel(f,null,'knightdale',n),ultimate:buildUltimateCurrent(f,n)};}
test('all alternate daily cards use the main calendar windows and keep the custom rain value',()=>{
 const f=fixture(),m=allModels(f),expected=f.days.map((_,i)=>calendarDayTemperatures(f,i,now));
 for(let i=0;i<3;i++)for(const day of [m.today.days7[i],m.glance.days[i],m.ultimate.days[i]])assert.deepEqual([day.high,day.low],[expected[i].high,expected[i].low]);
 for(let i=0;i<3;i++)assert.deepEqual([m.blend.week[i].blendHigh,m.blend.week[i].blendLow],[expected[i].high,expected[i].low]);
 assert.equal(m.today.days7[0].pop,17);assert.equal(m.glance.days[0].pop,17);assert.equal(m.blend.week[0].pop,17);
});
test('comparison highs and lows require every model hour in the same calendar date',()=>{
 const f=fixture();f.metricForecasts.series.temperature[27].sources=f.metricForecasts.series.temperature[27].sources.filter(s=>s.id!=='ecmwf');
 const m=buildBlendModel(f,null,'knightdale',now);
 assert.equal(m.week[0].modelHighs.nws,62);assert.equal(m.week[0].modelLows.nws,44);
 assert.equal(m.week[1].modelHighs.ecmwf,null);assert.equal(m.week[1].modelLows.ecmwf,null);
 assert.equal(m.week[1].modelHighs.nws,62);
});
test('partial or duplicate comparison hours cannot manufacture a daily high',()=>{
 const window={start:now,end:now+2*H},rows=[{time:iso(now),v:60},{time:iso(now+H),v:70}];
 assert.deepEqual(completeTemperatureRange(rows,window,r=>r.v),{high:70,low:60});
 assert.deepEqual(completeTemperatureRange(rows.slice(0,1),window,r=>r.v),{high:null,low:null});
 assert.deepEqual(completeTemperatureRange([...rows,rows[0]],window,r=>r.v),{high:null,low:null});
});
test('calendar comparison handles the 25-hour fall-back date',()=>{
 const window=calendarDayWindow({date:'2026-11-01'},1,now,'America/New_York');assert.equal((window.end-window.start)/H,25);
 const rows=Array.from({length:25},(_,i)=>({time:iso(window.start+i*H),v:i}));
 assert.deepEqual(completeTemperatureRange(rows,window,r=>r.v),{high:24,low:0});
 assert.deepEqual(completeTemperatureRange(rows.slice(0,24),window,r=>r.v),{high:null,low:null});
});
test('missing calendar coverage stays unavailable on every layout',()=>{
 const f=fixture();f.metricForecasts.series.temperature.splice(30,1);const m=allModels(f);
 for(const d of [m.today.days7[1],m.glance.days[1],m.ultimate.days[1]])assert.equal(d.high,null);
 assert.equal(m.blend.week[1].blendHigh,null);
});
test('Ultimate shows hourly UV zero separately from daily peak and uses current modeled AQI',()=>{
 const v=buildUltimateCurrent(fixture(),now);assert.equal(v.uvNow,0);assert.equal(v.uvPeak,5.15);assert.equal(v.aqi,30);
});
test('current values expire and independent AQI expires on its own clock',()=>{
 const f=fixture(),n=now+3*H,m=allModels(f,n);
 for(const v of [m.today.hero,m.glance.hero,m.blend.hero])assert.equal(v.temp,null);
 assert.equal(m.ultimate.inputs.temperature,null);assert.equal(m.ultimate.feels,null);assert.equal(m.ultimate.aqi,null);
 assert.match(m.today.rainNote,/unavailable/);assert.match(m.glance.rain.text,/unavailable/);
 for(const v of [m.today,m.glance,m.blend])assert.equal(v.updatedAt,f.assembledAt,'rendering cannot rejuvenate source time');
});
test('Ultimate preserves valid zero readings and missing readings never become zero',()=>{
 const f=fixture();Object.assign(f.current,{wind:0,humidity:0,dewpoint:null,visibility:0});
 let v=buildUltimateCurrent(f,now);assert.equal(v.inputs.wind,0);assert.equal(v.inputs.humidity,0);assert.equal(v.inputs.visibility,0);
 Object.assign(f.current,{temperature:null,wind:null,humidity:null,dewpoint:null,visibility:null});v=buildUltimateCurrent(f,now);
 assert.equal(v.inputs.temperature,null);assert.equal(v.inputs.wind,null);assert.equal(v.inputs.humidity,null);assert.equal(v.inputs.visibility,null);assert.equal(v.feels,null);
});
test('alternate layouts keep exactly the canonical custom feels-like computation',()=>{
 const f=fixture();for(const temp of [-5,0,35,59,85,100]){f.current.temperature=temp;f.current.dewpoint=Math.min(temp,30);const expected=currentSample(f,now).feels,m=allModels(f);assert.equal(m.ultimate.feels,expected);assert.equal(m.today.hero.feels,Number.isFinite(expected)?Math.round(expected):null);assert.equal(m.glance.hero.feels,Number.isFinite(expected)?Math.round(expected):null);}
});
test('explicit missing blended rain stays missing and individual signals are labeled honestly',()=>{
 const f=fixture();f.days[0].rainLikelihood.value=null;for(const h of f.hours)h.rainLikelihood.value=null;
 const m=allModels(f);assert.equal(m.today.days7[0].pop,null);assert.equal(m.glance.days[0].pop,null);assert.equal(m.blend.week[0].pop,null);assert.match(m.today.rainNote,/unavailable/);assert.match(m.glance.rain.text,/unavailable/);assert.match(CHART_VARS.find(c=>c.id==='rain').sub,/uncalibrated rain signals/);
});

test('Halo calendar cards and model comparisons use the same complete date as the main page',()=>{
 const f=fixture(),m=buildHaloModel(f,now);
 for(let i=0;i<3;i++){const expected=calendarDayTemperatures(f,i,now);assert.deepEqual([m.days[i].high,m.days[i].low],[expected.high,expected.low]);}
 assert.equal(m.blend.highs.find(s=>s.id==='nws').value,62);
 f.metricForecasts.series.temperature.splice(10,1);assert.equal(buildHaloModel(f,now).blend.highs.find(s=>s.id==='nws').value,null);
});
test('Halo expires current readings and never calls missing rain data dry',()=>{
 const f=fixture();for(const h of f.hours)h.rainLikelihood.value=null;
 let m=buildHaloModel(f,now);assert.match(m.summary,/Rain outlook is incomplete/);assert.doesNotMatch(m.summary,/Dry conditions/);
 m=buildHaloModel(f,now+3*H);assert.equal(m.hero.temp,null);assert.equal(m.hero.feels,null);assert.match(m.summary,/unavailable/);assert.match(m.tiles.find(t=>t.id==='precip').note,/unavailable/);
});
test('Halo chart and current feels-like retain the canonical custom values',()=>{
 const f=fixture();f.current.apparent=999;f.current.feelsLike=888;f.hours[0].apparent=999;f.hours[0].feelsLike=888;f.metricForecasts.series.feels=[{time:f.hours[0].time,value:0},{time:f.hours[1].time,value:null}];
 assert.deepEqual(buildHaloSeries(f).feels.map(row=>row.v),[0,null]);
 assert.equal(buildHaloModel(f,now).hero.feels,Math.round(currentSample(f,now).feels));
});
test('Halo cannot claim a dry next 24 hours across missing or delayed rain hours',()=>{
 const f=fixture();for(const h of f.hours)h.rainLikelihood.value=0;
 assert.match(buildHaloModel(f,now).summary,/Dry conditions/);
 f.hours.splice(9,1);assert.match(buildHaloModel(f,now).summary,/incomplete/);
 f.hours=f.hours.filter(h=>Date.parse(h.time)>now);assert.match(buildHaloModel(f,now).summary,/incomplete/);
});
test('Halo UV category matches the displayed rounded UV index',()=>{
 assert.match(haloDailySummary('uv',[{t:now,v:2.6}],[],'Today','America/New_York'),/peaks at 3 \(Moderate\)/);
});
test('Today explains matching temperature and rain shares independently, including WeatherNext',()=>{
 const f=fixture();f.blendPolicy={sameDay:{nws:.36,hrrr:.27,nbm:.18,ecmwf:.09,wn:.1},extendedRain:{nws:.135,ecmwf:.54,nbm:.225,wn:.1}};
 for(const h of f.hours){h.temperatureBlend.sources=[{id:'nws',value:40,weight:.2},{id:'ecmwf',value:42,weight:.7},{id:'wn',value:41,weight:.1}];h.rainLikelihood.sources=[{id:'nws',value:0,weight:.36},{id:'hrrr',value:0,weight:.27},{id:'nbm',value:0,weight:.18},{id:'ecmwf',value:0,weight:.09},{id:'wn',value:0,weight:.1}];}
 const m=buildTodayModel(f,now);
 assert.equal(m.calc.models.find(s=>s.id==='ecmwf').weight,.7);
 assert.equal(m.calc.models.find(s=>s.id==='wn').weight,.1);
 assert.ok(Math.abs(m.calc.models.reduce((sum,s)=>sum+(s.weight||0),0)-1)<1e-12);
 assert.match(m.calc.rainNote,/ECMWF 9/);assert.match(m.calc.rainNote,/Google WeatherNext 10/);assert.match(m.calc.rainNote,/NWS 13.5/);assert.match(m.calc.rainNote,/uncalibrated/);
 assert.equal(m.series[0].models.wn,41);assert.equal(m.days7[0].pop,17);
 const blend=buildBlendModel(f,null,'knightdale',now);
 assert.equal(blend.weights.ecmwf,.7);assert.equal(blend.modelCards.find(s=>s.id==='weathernext').weight,.1);
 assert.equal(blend.modelCards.find(s=>s.id==='weathernext').nowTemp,41);assert.equal(blend.series[0].wnMean,41);
 assert.match(blend.weightLabel,/temperature weights/);assert.equal(blend.week[0].pop,17);
});
test('missing source assembly times are not replaced by render time',()=>{
 const f=fixture();delete f.assembledAt;const models=allModels(f);
 for(const m of [models.today,models.glance,models.blend,buildHaloModel(f,now)])assert.equal(m.updatedAt,null);
});
test('next-12-hour dry assurances require every hour including the fractional final hour',()=>{
 const f=fixture();for(const h of f.hours)h.rainLikelihood.value=0;
 let m=allModels(f);assert.match(m.today.rainNote,/No significant rain/);assert.match(m.glance.rain.text,/No rain/);assert.equal(m.ultimate.rainPeak,0);
 f.hours.splice(8,1);m=allModels(f);
 assert.match(m.today.rainNote,/unavailable/);assert.match(m.glance.rain.text,/unavailable/);assert.equal(m.ultimate.rainPeak,null);
 const g=fixture();for(const h of g.hours)h.rainLikelihood.value=0;g.hours=g.hours.filter(h=>Date.parse(h.time)<Math.floor(now/H)*H+12*H);g.rainTimeline=g.hours;
 m=allModels(g);assert.match(m.today.rainNote,/unavailable/);assert.match(m.glance.rain.text,/unavailable/);assert.equal(m.ultimate.rainPeak,null);
 const delayed=fixture();delayed.hours=delayed.hours.filter(h=>Date.parse(h.time)>now);delayed.rainTimeline=delayed.hours;
 m=allModels(delayed);assert.match(m.today.rainNote,/unavailable/);assert.match(m.glance.rain.text,/unavailable/);assert.equal(m.ultimate.rainPeak,null);
});
