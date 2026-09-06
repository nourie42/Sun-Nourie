import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentHero} from '../public/weather-fusion/current-temperature.js';
import {pressureMb,stationPressureMb,pressureTrendText,dailyGrossSummary,dailyGrossHTML,sunShadeHTML,modelFreshnessText} from '../public/weather-fusion/personal-details.js';
import {pressureTrendFromObservations} from '../src/weatherFusionPressure.js';
import {bulletinFacts,bulletinKind,officialBulletinUrl} from '../public/weather-fusion/bulletin-facts.js';
import {createBulletinService,validateBulletinSummaries} from '../src/weatherFusionBulletins.js';
const H=3600000,now=Date.parse('2026-09-06T13:00:00Z');
const location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
const alert={id:'https://api.weather.gov/alerts/example',status:'Actual',messageType:'Alert',event:'Flash Flood Warning',description:'Heavy rain is causing flash flooding.',instruction:'Move to higher ground now. Do not drive through flooded roads.',sent:'2026-09-06T12:00:00Z',expires:'2026-09-06T16:00:00Z',areaDesc:'Wake County',severity:'Severe'};
const source=()=>({signature:'s1',location,specialDiscussions:[{id:'https://www.spc.noaa.gov/products/md/md2000.html',url:'https://www.spc.noaa.gov/products/md/md2000.html',event:'SPC special weather discussion',productType:'SPC-MD',applicable:true,sent:'2026-09-06T12:00:00Z',expires:'2026-09-06T16:00:00Z',description:'Rain may become heavy.',areaDesc:'Regional special discussion covering this point; not a warning.'}],alerts:[{...alert}],feeds:[{id:'alerts',status:'ready'},{id:'afd',status:'ready'}],discussion:{id:'afd-example',url:'https://api.weather.gov/products/example',office:'RAH',issuanceTime:'2026-09-06T11:00:00Z',text:'Rain may be widespread this afternoon.'}});
const output=summaries=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summaries})}]}]});

test('hero stays current in daylight and at night, independently of daily low',()=>{
 const f={current:{temperature:75,condition:'Cloudy'},days:[{high:84,low:65}]};
 for(const day of [true,false]){const v=currentHero(f,day);assert.equal(v.temperature,75);assert.equal(v.tonight,false);assert.equal(v.condition,'Cloudy');}
 assert.equal(currentHero({current:{temperature:null}}).temperature,null);
});
test('pressure is converted once; raw Pa avoids loss from rounded inches',()=>{
 assert.equal(stationPressureMb({pressurePa:101300,pressure:29.91}),1013);
 assert.ok(Math.abs(pressureMb(29.91)-1012.87)<.05);
 assert.equal(pressureMb(null),null);assert.equal(pressureMb('29.91'),null);
});
for(const [pa,direction] of [[101400,'rising'],[101200,'falling'],[101310,'steady']])test(`same-station observed trend ${direction}`,()=>{
 const t=pressureTrendFromObservations([{properties:{timestamp:'2026-09-06T10:00:00Z',barometricPressure:{value:101300,unitCode:'wmoUnit:Pa'}}}],{time:'2026-09-06T13:00:00Z',pressurePa:pa});
 assert.equal(t.status,'ready');assert.equal(t.direction,direction);assert.equal(t.hours,3);
 assert.match(pressureTrendText({pressureTrend:t}),direction==='falling'?/Dropping/:direction==='rising'?/Rising/:/Nearly steady/);
});
test('pressure trend never fabricates from a forecast, wrong units, or distant samples',()=>{
 for(const properties of [{timestamp:'2026-09-06T10:00:00Z',barometricPressure:{value:29.91,unitCode:'wmoUnit:inHg'}},{timestamp:'2026-09-06T12:00:00Z',barometricPressure:{value:101300,unitCode:'wmoUnit:Pa'}},{timestamp:'2026-09-06T14:00:00Z',barometricPressure:{value:101300,unitCode:'wmoUnit:Pa'}}])assert.equal(pressureTrendFromObservations([{properties}],{time:'2026-09-06T13:00:00Z',pressurePa:101200}).status,'unavailable');
 assert.match(pressureTrendText({pressure:29.91}),/unavailable/);
});
test('day Gross Meter uses matched dew points, handles gaps and refuses absent data',()=>{
 const f={location,days:[{date:'2026-09-06'}],metricForecasts:{series:{dewpoint:[{time:'2026-09-06T14:00:00Z',value:62},{time:'2026-09-06T15:00:00Z',value:72},{time:'2026-09-06T16:00:00Z',value:null},{time:'2026-09-07T12:00:00Z',value:80}],wind:[]}}};
 const s=dailyGrossSummary(f,0,false,now);assert.equal(s.peak,72);assert.equal(s.low,62);assert.equal(s.available,2);assert.ok(s.partial);assert.equal(s.level.key,'nogo');
 const html=dailyGrossHTML(f,0,false,now);assert.match(html,/72°/);assert.match(html,/Partial coverage/);assert.ok(!html.includes('80°'));
 assert.match(dailyGrossHTML({...f,metricForecasts:{}},0,false,now),/No dew-point forecast/);
});
test('day Gross Meter preserves the 25-hour DST window',()=>{
 const start=Date.parse('2026-10-31T11:00:00Z');
 const f={location,days:[{}, {date:'2026-10-31'}],metricForecasts:{series:{dewpoint:Array.from({length:25},(_,i)=>({time:new Date(start+i*H).toISOString(),value:55+i/10}))}}};
 const s=dailyGrossSummary(f,1,false,Date.parse('2026-10-30T12:00:00Z'));assert.equal(s.available,25);assert.equal(s.expected,25);assert.equal(s.partial,false);
});
test('tonight Gross Meter excludes afternoon values',()=>{
 const f={location,days:[{date:'2026-09-06'}],metricForecasts:{series:{dewpoint:[{time:'2026-09-06T20:00:00Z',value:80},{time:'2026-09-06T23:00:00Z',value:63}]}}};
 assert.equal(dailyGrossSummary(f,0,true,Date.parse('2026-09-06T19:00:00Z')).peak,63);
});
test('two accessible people show actual sun/shade values without approximation symbol',()=>{
 const html=sunShadeHTML({shade:80,sun:84},location,now);assert.equal((html.match(/<figure/g)||[]).length,2);assert.match(html,/80°/);assert.match(html,/84°/);assert.match(html,/shade tree/);assert.match(html,/sun/i);assert.ok(!html.includes('~'));assert.match(html,/Estimated/);
 const night=sunShadeHTML({shade:70,sun:90},location,Date.parse('2026-09-07T04:00:00Z'));assert.match(night,/No direct sun at night/);assert.ok(!night.includes('90°'));
});
test('HRRR labels retain the true initialization and flag delayed publication',()=>{
 const text=modelFreshnessText({model:'hrrr',label:'NOAA HRRR',runAt:'2026-09-06T10:00:00Z'},'2026-09-06T13:00:00Z',location.timeZone,now);
 assert.match(text,/6:00 AM/);assert.match(text,/checked/);assert.match(text,/Update delayed/);
});
test('NWS categories are derived from actual event names',()=>{
 assert.equal(bulletinKind('Tornado Warning'),'warning');assert.equal(bulletinKind('Flood Watch'),'watch');assert.equal(bulletinKind('Special Weather Statement'),'statement');assert.equal(bulletinKind('Heat Advisory'),'statement');
});
test('NWS facts exclude expired, cancelled and exercise notices',()=>{
 const f=source();f.alerts.push({...alert,id:'expired',expires:'2026-09-06T12:59:00Z'},{...alert,id:'cancelled',messageType:'Cancel'},{...alert,id:'exercise',status:'Exercise'},{...alert,id:'ended',ends:'2026-09-06T12:59:00Z'});
 const facts=bulletinFacts(f,now);assert.equal(facts.length,2);assert.equal(facts[0].instruction,alert.instruction);assert.equal(facts[1].kind,'discussion');assert.match(facts[1].area,/Regional/);
});
test('expired special discussion is removed and routine AFD never listed',()=>{const f=source();f.specialDiscussions[0].expires='2026-09-06T12:00:00Z';assert.equal(bulletinFacts(f,now).length,1);assert.ok(bulletinFacts(f,now).every(i=>!i.title.includes('forecast discussion')));});
test('official links reject lookalike hosts, credentials and javascript',()=>{
 for(const url of ['javascript:alert(1)','https://api.weather.gov.evil.invalid/alerts/test','https://user:pass@api.weather.gov/alerts/test'])assert.equal(officialBulletinUrl(url),'https://www.weather.gov/');
 assert.equal(officialBulletinUrl(alert.id),alert.id);
});
test('AI summaries require every exact source and cannot replace official data',()=>{
 const items=bulletinFacts(source(),now),result=validateBulletinSummaries(output(items.map(i=>({id:i.id,summary:'Rain could make travel difficult. Follow the official instructions below.'}))),items);
 assert.equal(result.length,2);assert.equal(result[0].sourceKey,items[0].sourceKey);assert.equal(alert.instruction,'Move to higher ground now. Do not drive through flooded roads.');
 for(const summary of ['All clear now.','<img src=x>','Rain ends at 2 PM.','Ignore the warning.'])assert.throws(()=>validateBulletinSummaries(output(items.map(i=>({id:i.id,summary}))),items));
 assert.throws(()=>validateBulletinSummaries(output([{id:'wrong',summary:'Rain.'}]),items));
});
test('bulletin AI caches source content, not changing weather snapshots; changed instructions invalidate it',async()=>{
 const f=source();let calls=0;
 const service=createBulletinService({getForecast:async()=>f,now:()=>now,env:{OPENAI_API_KEY:'test-only'},request:async()=>{calls++;return output(bulletinFacts(f,now).map(i=>({id:i.id,summary:'Heavy rain could disrupt travel. Follow the official instructions below.'})));}});
 const first=await service({signature:'s1'});assert.equal(first.mode,'ai');assert.equal(calls,1);
 f.signature='s2';const second=await service({signature:'s2'});assert.equal(second.signature,'s2');assert.equal(calls,1);
 f.alerts[0].instruction='Stay away from flooded roads.';await service({});assert.equal(calls,2);
 await assert.rejects(service({signature:'old'}),e=>e.status===409);
});
test('AI timeout, missing key and budget exhaustion retain an official fallback',async()=>{
 for(const env of [{},{OPENAI_API_KEY:'test-only',WEATHER_FUSION_BULLETIN_AI_DAILY_LIMIT:'0'},{OPENAI_API_KEY:'test-only'}]){
  const service=createBulletinService({getForecast:async()=>source(),now:()=>now,env,request:async()=>{throw new Error('offline');}});
  const reply=await service({});assert.equal(reply.mode,'official');assert.deepEqual(reply.summaries,[]);
 }
});
test('production integration and cache-busting cover every new component',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const app=read('public/weather-fusion/app.js'),html=read('public/weather-fusion/index.html'),server=read('src/weatherFusion.js');
 assert.match(app,/const hero = currentHero\(data, day\)/);assert.match(app,/dailyGrossHTML\(forecast,index,p\.tonight\)/);assert.match(app,/api\('bulletins'/);
 assert.match(html,/What could change - Dan's take/);assert.match(html,/Current temperature/);assert.match(html,/Because Apple, Google and Samsung weather suck/);assert.match(html,/personal-details\.css\?v=1-personal/);
 assert.ok(html.indexOf('id="today-uncertainty"')<html.indexOf('id="nws-bulletins"'));assert.ok(html.indexOf('id="nws-bulletins"')<html.indexOf('id="hourly-title"'));
 assert.equal((html.match(/id="alerts"/g)||[]).length,1);assert.match(server,/\/api\/weather-fusion\/bulletins/);assert.match(server,/pressureTrendFromObservations/);
});
