import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {tier3FeelsLike} from '../public/weather-fusion/weather-math.js';
import {feelsAt,dailyFeels,forecastValue,timeAt,dayFeelsHTML} from '../public/weather-fusion/hourly-feels.js';
import {comfortWindow} from '../public/weather-fusion/comfort-outlook.js';
import {dewpointGrossLevel,forecastGrossLevel} from '../public/weather-fusion/dewpoint-meter.js';
import {bulletinFacts} from '../public/weather-fusion/bulletin-facts.js';
import {inDiscussionPolygon,parseSpecialDiscussion,discussionUrl,createSpecialDiscussionService} from '../src/weatherFusionSpecialDiscussions.js';
import {buildForecast} from '../src/weatherFusion.js';
import {testInputs} from './weatherFusion.fixtures.js';
const H=3600000,now=Date.parse('2026-09-06T14:00:00Z'),location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
function series(values,start=now){return values.map((value,i)=>({time:new Date(start+i*H).toISOString(),value}));}
function data(temp,dp=70,wind=3){
 const temperatures=series(temp),dewpoint=series(temp.map(()=>dp)),winds=series(temp.map(()=>wind));
 return {location,current:{temperature:80,dewpoint:70,wind:3},hours:temperatures.map(p=>({time:p.time,temperature:p.value,condition:'Sunny'})),days:[{date:'2026-09-06'}],metricForecasts:{series:{temperature:temperatures,dewpoint,wind:winds},notes:{}}};
}
const rebuild=f=>rebuildHourlyFeels(f,{now,temperatureAt:()=>({value:null}),humidityAt:()=>null});
test('every displayed hourly temperature is paired with the same canonical feels-like inputs',()=>{
 const f=rebuild(data([80,83,86,90,92]));
 for(const h of f.hours){const p=f.metricForecasts.series.feels.find(p=>Date.parse(p.time)===Date.parse(h.time));assert.equal(p.inputs.temperature,h.temperature);assert.equal(h.feelsLike,p.value);assert.equal(feelsAt(f,h.time),h.feelsLike);assert.ok(Math.abs(p.value-tier3FeelsLike({...p.inputs,condition:h.condition,type:'guidance'},f.location,Date.parse(h.time),'shade').value)<=.051);}
 assert.equal(f.thermalVersion,'weather-nourie-hourly-feels-v2');
});
test('warmth later in the day produces a later, higher peak when wind and moisture stay equal',()=>{
 const f=rebuild(data([80,83,86,90,92,91]));
 const peak=comfortWindow(f,now+30*60000);
 assert.equal(peak.chosen.time,new Date(now+4*H).toISOString());
 assert.equal(peak.chosen.value,feelsAt(f,new Date(now+4*H).toISOString()));
 assert.ok(peak.chosen.value>feelsAt(f,new Date(now).toISOString()));
 assert.match(peak.label,/Forecast feels-like peak/);
});
test('higher air temperature does not justify inventing a higher feels-like peak',()=>{
 const f=data([80,86]);f.metricForecasts.series.dewpoint=series([74,48]);f.metricForecasts.series.wind=series([0,18]);rebuild(f);
 assert.ok(f.hours[1].temperature>f.hours[0].temperature);assert.ok(f.hours[1].feelsLike<f.hours[0].feelsLike);
 assert.equal(comfortWindow(f,now+1).chosen.value,f.hours[1].feelsLike);
});
test('missing hour stays missing and never borrows current conditions or the previous hour',()=>{
 const f=data([80,82,84]);f.metricForecasts.series.wind[1].value=null;rebuild(f);
 assert.equal(f.hours[1].feelsLike,null);assert.equal(feelsAt(f,new Date(now+24*H).toISOString()),null);
 assert.equal(feelsAt(f,new Date(now+H/2).toISOString()),null);
 const s=comfortWindow(f,now);assert.equal(s.partial,true);
});
test('future-day calculations use future temperature, dew point and wind, beyond the old two-day horizon',()=>{
 const f=data([80]);f.metricForecasts.series.dewpoint=series(Array(241).fill(50));f.metricForecasts.series.wind=series(Array(241).fill(5));
 rebuildHourlyFeels(f,{now,temperatureAt:t=>({value:75+(t-now)/H%10,source:'Test forecast'}),humidityAt:()=>null});
 f.days=[{date:'2026-09-06'},{date:'2026-09-09'}];
 const s=dailyFeels(f,1,now);assert.ok(s.high&&s.low);assert.equal(s.high.partial,false);assert.equal(s.high.high.inputs.dewpoint,50);
 assert.ok(!dayFeelsHTML(f,1,false,now).includes('Unavailable'));
 assert.ok(f.metricForecasts.series.feels.filter(p=>p.value!==null).length>48);
});
test('UTC offset aliases match one instant; no index-based temperature pairing',()=>{
 const f=rebuild(data([80,85]));assert.equal(feelsAt(f,'2026-09-06T10:00:00-04:00'),feelsAt(f,'2026-09-06T14:00:00Z'));
 f.metricForecasts.series.feels.reverse();assert.equal(feelsAt(f,f.hours[0].time),f.hours[0].feelsLike);
 assert.equal(forecastValue(f,'temperature',f.hours[1].time),85);
 assert.equal(new Set(f.metricForecasts.series.feels.map(p=>Date.parse(p.time))).size,241);
});
test('future-day and overnight ranges honor local time and the autumn DST change',()=>{
 const start=timeAt('2026-10-31',19,location.timeZone),end=timeAt('2026-11-01',7,location.timeZone);assert.equal((end-start)/H,13);
 const f={location,days:[{}, {date:'2026-10-31'}],metricForecasts:{series:{feels:series(Array(13).fill(60),start)}}};
 const s=dailyFeels(f,1,now).low;assert.equal(s.available,13);assert.equal(s.expected,13);assert.equal(s.partial,false);
});
test('the production forecast builder serves the new hourly contract without altering raw air-temperature weights',()=>{
 const f=buildForecast({...testInputs,models:{}});assert.equal(f.thermalVersion,'weather-nourie-hourly-feels-v2');
 for(const h of f.hours){const p=f.metricForecasts.series.feels.find(p=>Date.parse(p.time)===Date.parse(h.time));assert.equal(p.inputs.temperature,h.temperature);assert.equal(p.value,h.feelsLike);}
});
for(const dp of [40,55,62,66,72,78])test(`Gross Meter ${dp} uses future grammar only in forecast readings`,()=>{
 assert.match(forecastGrossLevel(dp,8).label,/will|should/);assert.ok(!/gettin|it’s|I’m/.test(forecastGrossLevel(dp,8).label));
 if(dp===66)assert.match(dewpointGrossLevel(dp).label,/gettin/);
});
test('routine forecast discussion is never listed as a special discussion',()=>{
 const f={alerts:[],feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd',office:'RAH',text:'Routine daily forecast.',issuanceTime:new Date(now).toISOString()}};
 assert.deepEqual(bulletinFacts(f,now),[]);
});
test('special statement and verified special discussion remain separate and expire correctly',()=>{
 const f={alerts:[{id:'statement',status:'Actual',event:'Special Weather Statement',sent:new Date(now-H).toISOString(),expires:new Date(now+H).toISOString(),description:'Strong winds.'}],specialDiscussions:[{id:'special',event:'SPC special weather discussion',productType:'SPC-MD',applicable:true,sent:new Date(now-H).toISOString(),expires:new Date(now+H).toISOString(),description:'Storms may strengthen.'}]};
 assert.deepEqual(bulletinFacts(f,now).map(x=>x.kind),['statement','discussion']);f.specialDiscussions[0].applicable=false;assert.equal(bulletinFacts(f,now).length,1);assert.equal(bulletinFacts(f,now+2*H).length,0);
});
test('special-discussion polygons include the selected point, exclude distant areas and holes',()=>{
 const ring=[[-80,34],[-77,34],[-77,37],[-80,37],[-80,34]];
 assert.equal(inDiscussionPolygon(-78.5,35.8,[ring]),true);assert.equal(inDiscussionPolygon(-70,40,[ring]),false);
 const hole=[[-79,35],[-78,35],[-78,36],[-79,36],[-79,35]];assert.equal(inDiscussionPolygon(-78.5,35.8,[ring,hole]),false);
 assert.equal(inDiscussionPolygon(-78.5,35.8,[]),false);
});
test('special discussion requires a verified official link and an active parsed validity period',()=>{
 const url='https://www.spc.noaa.gov/products/md/md2000.html',text='<pre>Mesoscale Discussion 2000\nValid 061300Z - 061600Z\nStorms could develop.</pre>';
 const d=parseSpecialDiscussion(text,url,now);assert.ok(d);assert.equal(d.expires,'2026-09-06T16:00:00.000Z');
 assert.equal(parseSpecialDiscussion(text,url,now+3*H),null);assert.equal(parseSpecialDiscussion('<pre>Routine AFD</pre>',url,now),null);
 assert.equal(discussionUrl('https://www.spc.noaa.gov.evil.invalid/products/md/md2000.html'),null);
 assert.equal(discussionUrl('https://user:pass@www.spc.noaa.gov/products/md/md2000.html'),null);
});
test('special-discussion validity crosses a month boundary without retaining an expired bulletin',()=>{
 const time=Date.parse('2026-12-31T23:30Z'),text='Mesoscale Discussion 2345\nValid 312300Z - 010130Z\nStorms may develop.';
 assert.equal(parseSpecialDiscussion(text,'https://www.spc.noaa.gov/products/md/md2345.html',time).expires,'2027-01-01T01:30:00.000Z');
});
test('empty verified special-discussion response differs from a failed feed',async()=>{
 const success=createSpecialDiscussionService({now:()=>now,cached:async()=>({data:{features:[]},fetchedAt:new Date(now).toISOString()})});
 assert.equal((await success(location)).meta.status,'ready');assert.deepEqual((await success(location)).value,[]);
 const failure=createSpecialDiscussionService({now:()=>now,cached:async()=>{throw new Error('offline');}});assert.equal((await failure(location)).meta.status,'unavailable');
});
test('waving figures have faces and honor reduced-motion preferences',()=>{
 const read=p=>readFileSync(new URL('../public/weather-fusion/'+p,import.meta.url),'utf8');
 const scene=read('exposure-scene.js'),css=read('hourly-feels.css');
 assert.match(scene,/person-eyes/);assert.match(scene,/person-smile/);assert.match(scene,/friendly-raised-arm/);assert.match(scene,/friendly-wave/);assert.ok(scene.indexOf('friendly-raised-arm')<scene.indexOf('<g class=\"friendly-wave\">'));
 assert.match(css,/transform-box:fill-box/);assert.match(css,/prefers-reduced-motion:reduce/);
});
