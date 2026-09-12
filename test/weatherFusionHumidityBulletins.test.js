import test from 'node:test';
import assert from 'node:assert/strict';
import {shadeFeelsLike,thermalComfort} from '../public/weather-fusion/weather-math.js';
import {renderBulletins} from '../public/weather-fusion/bulletins.js';

const H=3600000,now=Date.parse('2026-09-06T19:00:00Z');
const location={latitude:34.64,longitude:-78.48,timeZone:'America/New_York'};

test('humidity raises the same UTCI cloudy estimate without selecting a warmer unrelated index',()=>{
 const current={temperature:88,dewpoint:72,humidity:null,wind:5,condition:'Cloudy',type:'observation'};
 const moist=thermalComfort(current,location,now),dry=thermalComfort({...current,dewpoint:50},location,now);
 assert.ok(moist.rawOutdoors>dry.rawOutdoors);assert.equal(moist.sun,null);assert.equal(moist.outdoors,moist.shade);
 assert.match(moist.note,/No warmer-formula override/);
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
   sent:new Date(now-60000).toISOString(),expires:new Date(now+3600000).toISOString(),areaDesc:'White Lake, NC',description:'FULL OFFICIAL WORDING HIDDEN UNTIL CLICKED',instruction:'OFFICIAL INSTRUCTION HIDDEN UNTIL CLICKED'}];
  renderBulletins(forecast,null,now);
  assert.equal(panel.hidden,false);
  assert.match(root.innerHTML,/Special Weather Statement/);
  assert.match(root.innerHTML,/class="bulletin-banner bulletin-statement"/);assert.match(root.innerHTML,/aria-haspopup="dialog"/);assert.match(root.innerHTML,/>View /);
  assert.doesNotMatch(root.innerHTML,/FULL OFFICIAL WORDING|OFFICIAL INSTRUCTION/);
 }finally{
  if(previous===undefined)delete globalThis.document;
  else globalThis.document=previous;
 }
});

test('clicking a bulletin banner opens the complete official wording in a dialog',()=>{
 let openBanner,closeDialog;
 const button={dataset:{bulletinIndex:'0'},addEventListener:(name,fn)=>{if(name==='click')openBanner=fn;}};
 const root={innerHTML:'',querySelectorAll:()=>[button]},panel={hidden:false},content={innerHTML:''},close={addEventListener:(name,fn)=>{if(name==='click')closeDialog=fn;}};
 const dialog={dataset:{},open:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},getBoundingClientRect:()=>({left:0,right:100,top:0,bottom:100})};
 const previous=globalThis.document;
 globalThis.document={body:{classList:{add(){},remove(){}}},getElementById:id=>({alerts:root,'nws-bulletins':panel,'bulletin-dialog':dialog,'bulletin-dialog-content':content,'close-bulletin':close}[id]||null)};
 try{
  const forecast={signature:'test',location,assembledAt:new Date(now).toISOString(),feeds:[{id:'alerts',status:'ready'},{id:'special-discussions',status:'ready'}],specialDiscussions:[],alerts:[{id:'https://api.weather.gov/alerts/urn:oid:dialog',status:'Actual',event:'Flood Advisory',sent:new Date(now-60000).toISOString(),expires:new Date(now+H).toISOString(),areaDesc:'Wake County',description:'Complete official flood wording.',instruction:'Turn around, do not drown.'}]};
  renderBulletins(forecast,null,now);assert.ok(openBanner);assert.doesNotMatch(root.innerHTML,/Complete official flood wording/);
  openBanner();assert.equal(dialog.open,true);assert.match(content.innerHTML,/Complete official flood wording/);assert.match(content.innerHTML,/Turn around, do not drown/);assert.match(content.innerHTML,/Open original NWS bulletin/);
  closeDialog();assert.equal(dialog.open,false);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
