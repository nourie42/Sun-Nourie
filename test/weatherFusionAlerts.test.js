import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Cache,createWeatherService} from '../src/weatherFusion.js';
import {createAlertService,mergeOfficialAlerts} from '../src/weatherFusionAlerts.js';
import {bulletinFacts} from '../public/weather-fusion/bulletin-facts.js';
import {withLiveAlerts,alertHealth,alertLocationKey} from '../public/weather-fusion/live-alerts.js';
import {danCard} from '../public/weather-fusion/dans-summary.js';
const now=Date.parse('2026-10-11T17:38:00Z');
const location={latitude:35.787,longitude:-78.4806};
const point={county:'https://api.weather.gov/zones/county/NCC183',timeZone:'America/New_York'};
const feature=(id='tornado',extra={})=>({id:`https://api.weather.gov/alerts/${id}`,geometry:null,properties:{id:`urn:${id}`,status:'Actual',messageType:'Alert',event:'Tornado Warning',sent:'2026-10-11T17:29:00Z',expires:'2026-10-11T18:00:00Z',areaDesc:'Johnston, NC; Wake, NC',instruction:'TAKE COVER NOW! Move to an interior room on the lowest floor.',parameters:{tornadoDetection:['OBSERVED']},...extra}});
const county={id:'NCC183'};
const service=(request,t=()=>now)=>createAlertService({request,cache:new Cache(20,t),now:t});
test('Knightdale point-only omission still surfaces the observed Wake County tornado warning',async()=>{
 const calls=[],load=service(async(url,options)=>{calls.push({url,options});return {features:url.includes('zone=')?[feature()]:[feature('watch',{event:'Tornado Watch'})]};});
 const data=await load(location,point),facts=bulletinFacts(data,now);
 assert.equal(data.feeds[0].status,'ready');assert.equal(facts[0].title,'Tornado Warning');assert.equal(facts[0].scope,'county');assert.equal(facts[0].detection,'OBSERVED');
 assert.equal(facts[0].url,'https://api.weather.gov/alerts/tornado');assert.equal(facts[1].title,'Tornado Watch');
 assert.ok(calls.some(c=>c.url.endsWith('zone=NCC183')));assert.ok(calls.every(c=>c.options.revalidate===true));
 assert.match(danCard({},data,now).text,/Tornado Warning in your county/);
});
test('point/county copies deduplicate, with point coverage preserved',()=>{
 const alerts=mergeOfficialAlerts([feature()],[feature()],county,now);assert.equal(alerts.length,1);assert.equal(alerts[0].scope,'point');
});
test('county advisories and watches do not inflate the point alert list',()=>{
 assert.deepEqual(mergeOfficialAlerts([],[feature('watch',{event:'Tornado Watch'}),feature('advisory',{event:'Flood Advisory'})],county,now),[]);
});
test('expired, ended, canceled, future and non-actual alerts are excluded',()=>{
 for(const extra of [{expires:new Date(now).toISOString()},{ends:new Date(now).toISOString()},{messageType:'Cancel'},{sent:new Date(now+120000).toISOString()},{status:'Test'}])assert.deepEqual(mergeOfficialAlerts([],[feature('x',extra)],county,now),[]);
});
test('updates supersede older versions even across point and county feeds',()=>{
 const old=feature('old'),updated=feature('new',{messageType:'Update',references:[{'@id':old.id}]});
 const alerts=mergeOfficialAlerts([old],[updated],county,now);assert.deepEqual(alerts.map(a=>a.id),[updated.id]);
});
test('cancellation removes the referenced warning, without treating test messages as cancellations',()=>{
 const old=feature('old'),cancel=feature('cancel',{messageType:'Cancel',references:[{'@id':old.id}]});
 assert.deepEqual(mergeOfficialAlerts([old],[cancel],county,now),[]);
 assert.equal(mergeOfficialAlerts([old],[{...cancel,properties:{...cancel.properties,status:'Test'}}],county,now).length,1);
});
test('tornado emergency and observed warnings outrank newer severe warnings and watches',()=>{
 const alerts=mergeOfficialAlerts([],['severe','radar','observed','emergency'].map((id,i)=>feature(id,{event:i?'Tornado Warning':'Severe Thunderstorm Warning',parameters:{tornadoDetection:[i===2?'OBSERVED':'RADAR INDICATED']},headline:i===3?'TORNADO EMERGENCY FOR TOWN':'',sent:new Date(now-i*60000).toISOString()})),county,now);
 assert.deepEqual(bulletinFacts({alerts},now).map(a=>a.id.split('/').at(-1)),['emergency','observed','radar','severe']);
});
test('partial source failure retains available warnings but never reports verified coverage',async()=>{
 for(const failure of ['point','county']){
  const data=await service(async url=>{if(url.includes('zone=')===(failure==='county'))throw Error('HTTP 503');return {features:[feature()]};})(location,point);
  assert.equal(data.alerts.length,1);assert.equal(data.feeds[0].status,'unavailable');assert.equal(alertHealth(data,now).verified,false);
 }
});
test('missing county metadata still queries the point and explicitly reports incomplete coverage',async()=>{
 const calls=[],data=await service(async url=>{calls.push(url);return {features:[feature()]};})(location,null);
 assert.equal(calls.length,1);assert.equal(data.alerts.length,1);assert.equal(data.feeds[0].countyStatus,'unavailable');assert.equal(data.feeds[0].status,'unavailable');
});
test('malformed and paginated alert responses fail visibly instead of claiming zero warnings',async()=>{
 for(const payload of [{},{features:[],pagination:{next:'https://api.weather.gov/alerts/active?cursor=x'}}]){
  const data=await service(async()=>payload)(location,point);assert.equal(data.feeds[0].status,'unavailable');
 }
});
test('alert source requests coalesce and refresh after 30 seconds, including failures',async()=>{
 let time=now,calls=0;const load=service(async()=>{calls++;throw Error('HTTP 503');},()=>time);
 await Promise.all([load(location,point),load(location,point)]);assert.equal(calls,2);
 time+=29999;await load(location,point);assert.equal(calls,2);
 time++;await load(location,point);assert.equal(calls,4);
});
test('freshness is measured from source fetch, not from later assembly or browser receipt',()=>{
 const data={feeds:[{id:'alerts',status:'ready',fetchedAt:new Date(now-90001).toISOString()}],assembledAt:new Date(now).toISOString()};
 assert.equal(alertHealth(data,now).verified,false);assert.match(alertHealth(data,now).message,/stale/);
 data.feeds[0].fetchedAt=new Date(now).toISOString();assert.equal(alertHealth(data,now).verified,true);
 delete data.feeds[0].fetchedAt;assert.equal(alertHealth(data,now).verified,false);
});
test('a slower forecast cannot overwrite newer independent warnings or import another location',()=>{
 const forecast={location,alerts:[],feeds:[{id:'alerts',status:'ready',fetchedAt:new Date(now-60000).toISOString()}],hours:[{temperature:78}]};
 const live={location,alerts:[feature().properties],feeds:[{id:'alerts',status:'ready',fetchedAt:new Date(now).toISOString()}]};
 const merged=withLiveAlerts(forecast,live);assert.equal(merged.alerts.length,1);assert.equal(merged.hours,forecast.hours);assert.equal(forecast.alerts.length,0);
 assert.equal(withLiveAlerts(forecast,{...live,location:{latitude:35,longitude:-77}}),forecast);
 assert.equal(withLiveAlerts(merged,forecast),merged);
});
test('alert endpoint operates without invoking any slow model or forecast provider',async()=>{
 const calls=[],s=createWeatherService({now:()=>now,env:{},fetchImpl:async url=>{
  calls.push(url);if(url.includes('/points/'))return new Response(JSON.stringify({properties:point}));
  if(url.includes('/alerts/active'))return new Response(JSON.stringify({features:url.includes('zone=')?[feature()]:[]}));
  throw Error('Forecast/model fetch must not run');
 }});
 const data=await s.getAlerts(location);assert.equal(data.alerts.length,1);assert.equal(calls.length,3);
});
test('searched coordinates match the NWS four-decimal normalization without losing warnings',()=>{
 const searched={latitude:35.787123,longitude:-78.480645},normalized={latitude:35.7871,longitude:-78.4806};
 assert.equal(alertLocationKey(searched),alertLocationKey(normalized));assert.equal(alertLocationKey({}),null);
 const f={location:searched,alerts:[],feeds:[]},live={location:normalized,alerts:[feature().properties],feeds:[{id:'alerts',status:'ready',fetchedAt:new Date(now).toISOString()}]};
 assert.equal(withLiveAlerts(f,live).alerts.length,1);
});
test('warnings remain available during a cached full-forecast interval',async()=>{
 let time=now,warn=false;const s=createWeatherService({now:()=>time,env:{},fetchImpl:async url=>{
  if(url.includes('/points/'))return new Response(JSON.stringify({properties:point}));
  if(url.includes('/alerts/active'))return new Response(JSON.stringify({features:warn&&url.includes('zone=')?[feature()]:[]}));
  throw Error('Unrelated source unavailable');
 }});
 const first=await s.getForecast(location);assert.equal(first.alerts.length,0);
 time+=31000;warn=true;const next=await s.getForecast(location);
 assert.equal(next.assembledAt,first.assembledAt);assert.equal(next.alerts.length,1);assert.notEqual(next.signature,first.signature);
});
test('urgent alerts are above routine navigation and forecasts, with a separate refresh clock',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),html=read('public/weather-fusion/index.html'),app=read('public/weather-fusion/app.js');
 assert.ok(html.indexOf('id="urgent-alerts"')<html.indexOf('class="weather-jump-nav"'));assert.match(html,/role="alert" aria-live="assertive"/);
 assert.match(app,/async function refreshAlerts\(/);assert.match(app,/api\('alerts'/);assert.match(app,/\},ALERT_REFRESH_MS\)/);
 assert.match(read('src/weatherFusion.js'),/\/api\/weather-fusion\/alerts/);
});
