import test from 'node:test';
import assert from 'node:assert/strict';
import {shadeFeelsLike,thermalComfort} from '../public/weather-fusion/weather-math.js';
import {renderBulletins} from '../public/weather-fusion/bulletins.js';

const now=Date.parse('2026-09-06T19:00:00Z');
const location={latitude:34.64,longitude:-78.48,timeZone:'America/New_York'};

test('high dew point remains a hot signal even under clouds',()=>{
 const current={temperature:88,dewpoint:72,humidity:null,wind:5,condition:'Cloudy',type:'observation'};
 const moisture=shadeFeelsLike(current.temperature,current.humidity,current.wind,current.dewpoint).value;
 const comfort=thermalComfort(current,location,now);
 assert.ok(moisture>current.temperature);
 assert.ok(comfort.shade>=Math.round(moisture));
 assert.ok(comfort.shade>current.temperature);
 assert.equal(comfort.sun,null);
 assert.equal(comfort.outdoors,comfort.shade);
 assert.match(comfort.note,/cloud cover can reduce radiant heating without wiping out the dew-point effect/i);
});

test('bulletin card stays hidden when there is no actual message, even if a source is stale',()=>{
 const root={innerHTML:'',querySelectorAll:()=>[]},panel={hidden:false};
 const previous=globalThis.document;
 globalThis.document={getElementById:id=>id==='alerts'?root:id==='nws-bulletins'?panel:null};
 try{
  const forecast={signature:'test',location,assembledAt:new Date(now).toISOString(),alerts:[],specialDiscussions:[],feeds:[
   {id:'alerts',status:'unavailable'},{id:'special-discussions',status:'stale'}
  ]};
  renderBulletins(forecast,null,now);
  assert.equal(panel.hidden,true);
  forecast.alerts=[{id:'https://api.weather.gov/alerts/urn:oid:test',status:'Actual',event:'Special Weather Statement',
   sent:new Date(now-60000).toISOString(),expires:new Date(now+3600000).toISOString(),areaDesc:'White Lake, NC',description:'A local statement is active.'}];
  renderBulletins(forecast,null,now);
  assert.equal(panel.hidden,false);
  assert.match(root.innerHTML,/Special Weather Statement/);
 }finally{
  if(previous===undefined)delete globalThis.document;
  else globalThis.document=previous;
 }
});
