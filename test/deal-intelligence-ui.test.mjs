import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as finance from '../src/deal-intelligence/finance.mjs';
import {initialState} from '../src/deal-intelligence/seed.mjs';

class Element {
  constructor(){this.innerHTML='';this.textContent='';this.dataset={};this.value='';this.hidden=false;this.open=false;this.events=new Map();this.attributes=new Map();const names=new Set();this.classList={add:v=>names.add(v),remove:v=>names.delete(v),contains:v=>names.has(v),toggle:(v,force)=>{const on=force===undefined?!names.has(v):force;if(on)names.add(v);else names.delete(v);return on;}};}
  addEventListener(type,fn){this.events.set(type,fn);}
  setAttribute(key,value){this.attributes.set(key,value);}
  querySelector(){return new Element();}
  querySelectorAll(){return [];}
  focus(){} blur(){} click(){} showModal(){this.open=true;} close(){this.open=false;}
  closest(){return null;}
}
async function workspace(cached, remoteFetch){
  const nodes=new Map();const events=new Map();const timers=new Map();let timerId=0;
  const storage=new Map(cached?[['sun-nourie.deal-intelligence.workspace.v1',JSON.stringify(cached)]]:[]);
  const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);},querySelectorAll(){return [];},addEventListener:(type,fn)=>events.set(type,fn),createElement:()=>new Element()};
  const context={document,location:{hash:'#today',protocol:remoteFetch?'https:':'file:'},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},console,Intl,Date,URL,Blob,Response,AbortController,crypto:webcrypto,DealFinance:finance,DealSeed:initialState,
    FormData:class {constructor(form){this.entries=Object.entries(form.values||{});}[Symbol.iterator](){return this.entries[Symbol.iterator]();}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>fn(),scrollTo(){},addEventListener(){},fetch:remoteFetch||(()=>{throw new Error('Network calls are not permitted in this test.');})};
  context.window=context;
  vm.runInNewContext(await readFile(new URL('../src/deal-intelligence/ui/app.js',import.meta.url),'utf8'),context,{timeout:3000});
  const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  await tick();
  const click=async(dataset)=>{const target={dataset,closest(selector){return selector==='[data-nav]'&&dataset.nav||selector==='[data-action]'&&dataset.action||selector==='[data-analysis]'&&dataset.analysis?this:null;}};events.get('click')({target});await tick();};
  return {nodes,storage,events,timers,tick,click,document};
}

test('all nine offline workflows render and underwriting uses the exact IRR engine',async()=>{
  const app=await workspace();
  assert.match(app.nodes.get('#main').innerHTML,/Today’s acquisition desk/);
  assert.equal(app.nodes.get('#sample-banner').hidden,false);
  for(const [nav,heading] of [['hunter','Acquisition hunter'],['targets','Targets & owners'],['underwriting','Underwriting'],['sites','Site intelligence'],['pipeline','Pipeline'],['briefs','Investment briefs'],['watchtower','Watchtower'],['analyst','Your acquisition analyst'],['today','Today’s acquisition desk']]){
    await app.click({nav});
    assert.match(app.nodes.get('#main').innerHTML,new RegExp(heading));
    if(nav==='underwriting'){
      assert.match(app.nodes.get('#finance-metrics').innerHTML,/6\.3%/);
      assert.match(app.nodes.get('#finance-statement').innerHTML,/24,760,689/);
      assert.match(app.nodes.get('#finance-scenarios').innerHTML,/Downside/);
    }
  }
});

test('adding a target persists unknown facts and escapes imported record names and dates',async()=>{
  const app=await workspace();
  const form={id:'target-form',dataset:{},values:{name:'<img src=x onerror=alert(1)>',legalName:'',type:'Fuel marketer',states:'NC',siteCount:'',stage:'Research',ownerName:'',ownerTitle:'',contactEmail:'',contactPhone:'',score:'',confidence:'Low',sellerSignal:'Unknown',sellerSignalReason:'',nextAction:'Verify ownership',dueDate:'<img src=x onerror=alert(2)>',sourceUrls:'https://example.com',notes:'Imported evidence'}};
  await app.events.get('submit')({target:form,preventDefault(){}});await app.tick();
  const saved=JSON.parse(app.storage.get('sun-nourie.deal-intelligence.workspace.v1'));
  assert.equal(saved.targets.length,7);assert.equal(saved.targets.at(-1).siteCount,null);
  await app.click({nav:'targets'});
  const html=app.nodes.get('#main').innerHTML;
  assert.match(html,/&lt;img/);assert.match(html,/Date unknown/);
  assert.doesNotMatch(html,/<img src=x onerror=/);
});

test('clearing sample data keeps personal records and exported state remains usable',async()=>{
  const state=initialState();state.targets.push({id:'real-a',name:'User supplied company',states:['NC'],stage:'Research',siteCount:null,score:null,sourceUrls:[],financials:{},sample:false});
  const app=await workspace(state);await app.click({action:'clear-samples'});
  const saved=JSON.parse(app.storage.get('sun-nourie.deal-intelligence.workspace.v1'));
  assert.equal(saved.targets.length,1);assert.equal(saved.targets[0].id,'real-a');
  assert.equal(saved.sites.length,0);assert.equal(saved.sampleMode,false);
  const reloaded=await workspace(saved);await reloaded.click({nav:'targets'});
  assert.match(reloaded.nodes.get('#main').innerHTML,/User supplied company/);
  assert.equal(reloaded.nodes.get('#sample-banner').hidden,true);
});


test('live branch preserves cached records across temporary server resets and namespaces API calls',async()=>{
  const cached=initialState();cached.targets=[{id:'personal-a',name:'My saved company',states:['NC'],stage:'Research',sourceUrls:[],financials:{},sample:false}];cached.sampleMode=false;
  let remote=initialState();remote.updatedAt='2026-01-01T00:00:00.000Z';let serial=0;const paths=[];
  const fakeFetch=async(path,options={})=>{
    paths.push(path);
    if(path==='/api/deal-intelligence/finance')return new Response(JSON.stringify({defaults:finance.defaultInputs,fields:finance.inputFields}));
    assert.equal(path,'/api/deal-intelligence/state');
    if(options.method==='POST'){
      const body=JSON.parse(options.body);assert.equal(body.expectedUpdatedAt,remote.updatedAt);
      remote={...body.state,updatedAt:'2026-01-01T00:00:00.'+String(++serial).padStart(3,'0')+'Z'};
    }
    return new Response(JSON.stringify({state:remote,ai:{connected:false},storage:'browser'}));
  };
  const app=await workspace(cached,fakeFetch);await app.tick();
  await app.click({nav:'targets'});
  assert.match(app.nodes.get('#main').innerHTML,/My saved company/);
  assert.equal(remote.targets[0].id,'personal-a');
  assert.equal(JSON.parse(app.storage.get('sun-nourie.deal-intelligence.workspace.v1')).updatedAt,remote.updatedAt);
  assert.ok(paths.every(path=>path.startsWith('/api/deal-intelligence/')));
});
