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
  focus(){} blur(){} click(){} remove(){this.removed=true;} showModal(){this.open=true;} close(){this.open=false;}
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
  const tick=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
  await tick();
  const click=async(dataset)=>{const target={dataset,closest(selector){return selector==='[data-nav]'&&dataset.nav||selector==='[data-action]'&&dataset.action||selector==='[data-analysis]'&&dataset.analysis?this:null;}};events.get('click')({target});await tick();};
  const runTimer=async(delay)=>{const next=[...timers].find(([,timer])=>timer.delay===delay);assert.ok(next,`Expected a pending ${delay}ms timer`);timers.delete(next[0]);next[1].fn();await tick();};
  return {nodes,storage,events,timers,tick,click,document,runTimer};
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


function researchService(pollResults) {
  let remote=initialState();remote.updatedAt='2026-01-01T00:00:00.000Z';let version=0;const requests=[];
  const fetch=async(path,options={})=>{
    requests.push({path,method:options.method,body:options.body?JSON.parse(options.body):undefined});
    if(path==='/api/deal-intelligence/finance')return Response.json({defaults:finance.defaultInputs,fields:finance.inputFields});
    if(path==='/api/deal-intelligence/state'){
      if(options.method==='POST'){
        const saved=JSON.parse(options.body);assert.equal(saved.expectedUpdatedAt,remote.updatedAt);
        remote={...saved.state,updatedAt:`2026-01-01T00:00:00.${String(++version).padStart(3,'0')}Z`};
      }
      return Response.json({state:remote,ai:{connected:true,model:'research'},storage:'browser'});
    }
    if(path==='/api/deal-intelligence/ai/jobs'){
      assert.equal(options.method,'POST');
      return Response.json({jobId:'job-1',status:'queued'},{status:202});
    }
    assert.equal(path,'/api/deal-intelligence/ai/jobs/job-1');
    assert.equal(options.method,'GET');
    const result=pollResults.shift();assert.ok(result,'Unexpected extra poll');
    return result instanceof Response?result:Response.json({jobId:'job-1',...result});
  };
  return {fetch,requests,getRemote:()=>remote};
}

const researchForm=(id='hunter-form')=>({id,dataset:{},values:{prompt:'Verify ownership and cite public sources.',targetId:''}});

test('research uses short background-job requests, shows progress and finishes after polling without duplicate starts',async()=>{
  const service=researchService([{status:'running'},{status:'completed',result:{text:'Verified operating footprint from public evidence.',sources:[{url:'https://example.com/company',title:'Company website'}],data:{targets:[]}}}]);
  const app=await workspace(undefined,service.fetch);await app.click({nav:'hunter'});
  const submission=app.events.get('submit')({target:researchForm(),preventDefault(){}});
  await app.tick();
  assert.match(app.nodes.get('#main').innerHTML,/Research in progress/);
  assert.match(app.nodes.get('#main').innerHTML,/role="status" aria-live="polite"/);
  assert.match(app.nodes.get('[data-ai-message]').textContent,/Research queued/);
  assert.match(app.nodes.get('[data-ai-elapsed]').textContent,/\d+s elapsed/);
  assert.equal(service.requests.filter(r=>r.path.endsWith('/ai/jobs')).length,1);
  assert.equal(service.requests.some(r=>r.path.endsWith('/state')&&r.method==='POST'),false,'An unchanged workspace does not need another save');
  await app.events.get('submit')({target:researchForm(),preventDefault(){}});
  assert.equal(service.requests.filter(r=>r.path.endsWith('/ai/jobs')).length,1);
  await app.click({nav:'targets'});
  assert.match(app.nodes.get('#main').innerHTML,/Targets & owners/);
  assert.match(app.nodes.get('#main').innerHTML,/Research in progress/);
  await app.runTimer(1800);
  assert.match(app.nodes.get('[data-ai-message]').textContent,/Waiting for research/);
  await app.runTimer(1800);await submission;await app.click({nav:'hunter'});
  assert.match(app.nodes.get('#main').innerHTML,/Research results/);
  assert.match(app.nodes.get('#main').innerHTML,/Verified operating footprint/);
  assert.match(app.nodes.get('#main').innerHTML,/https:\/\/example.com\/company/);
  assert.doesNotMatch(app.nodes.get('#main').innerHTML,/Research in progress/);
  assert.equal(service.getRemote().targets.length,initialState().targets.length,'Research never adds records automatically');
  assert.ok(service.requests.every(r=>!r.path.endsWith('/ai')),'Research does not use the long synchronous endpoint');
  assert.equal([...app.timers.values()].some(timer=>timer.delay===1800),false);
});

test('a failed research job reports the server error and releases the research controls',async()=>{
  const service=researchService([{status:'failed',code:'AI_TIMEOUT',httpStatus:504,error:'Public-source research exceeded its time budget. Please narrow the search.'}]);
  const app=await workspace(undefined,service.fetch);await app.click({nav:'hunter'});
  const submission=app.events.get('submit')({target:researchForm(),preventDefault(){}});await app.tick();
  await app.runTimer(1800);await submission;
  const html=app.nodes.get('#main').innerHTML;
  assert.match(html,/Public-source research exceeded its time budget/);
  assert.doesNotMatch(html,/Research in progress/);
  assert.doesNotMatch(html,/type="submit" disabled/);
  assert.equal(service.requests.filter(r=>r.path.endsWith('/jobs/job-1')).length,1);
});

test('an expired research job explains restart recovery without changing workspace records',async()=>{
  const service=researchService([Response.json({code:'JOB_NOT_FOUND',error:'Job expired'},{status:404})]);
  const app=await workspace(undefined,service.fetch);await app.click({nav:'hunter'});
  const submission=app.events.get('submit')({target:researchForm(),preventDefault(){}});await app.tick();
  await app.runTimer(1800);await submission;
  assert.match(app.nodes.get('#main').innerHTML,/service restarted or this job expired/);
  assert.match(app.nodes.get('#main').innerHTML,/saved workspace is preserved/);
  assert.doesNotMatch(app.nodes.get('#main').innerHTML,/Research in progress/);
  assert.equal(service.getRemote().targets.length,initialState().targets.length);
  assert.equal(service.requests.filter(r=>r.path.endsWith('/jobs/job-1')).length,1);
});


test('a temporary polling connection failure retries the same research job without creating another request',async()=>{
  const service=researchService([Response.json({error:'Temporary gateway error'},{status:503}),{status:'completed',result:{text:'Research recovered with public sources.',sources:[]}}]);
  const app=await workspace(undefined,service.fetch);await app.click({nav:'hunter'});
  const submission=app.events.get('submit')({target:researchForm(),preventDefault(){}});await app.tick();
  await app.runTimer(1800);
  assert.match(app.nodes.get('[data-ai-message]').textContent,/Reconnecting to the research service/);
  await app.runTimer(1800);await submission;
  assert.match(app.nodes.get('#main').innerHTML,/Research recovered/);
  assert.equal(service.requests.filter(r=>r.path.endsWith('/ai/jobs')).length,1);
  assert.equal(service.requests.filter(r=>r.path.endsWith('/jobs/job-1')).length,2);
});


test('queued local edits are synchronized before a context-based research job starts',async()=>{
  const service=researchService([{status:'completed',result:{text:'Research with the latest target context.',sources:[]}}]);
  const app=await workspace(undefined,service.fetch);
  const form={id:'target-form',dataset:{},values:{name:'New personal target',legalName:'',type:'Fuel marketer',states:'NC',siteCount:'',stage:'Research',ownerName:'',ownerTitle:'',contactEmail:'',contactPhone:'',score:'',confidence:'Low',sellerSignal:'Unknown',sellerSignalReason:'',nextAction:'',dueDate:'',sourceUrls:'',notes:''}};
  await app.events.get('submit')({target:form,preventDefault(){}});
  await app.click({nav:'analyst'});
  const submission=app.events.get('submit')({target:researchForm('analyst-form'),preventDefault(){}});await app.tick();
  const saveIndex=service.requests.findIndex(r=>r.path.endsWith('/state')&&r.method==='POST');
  const jobIndex=service.requests.findIndex(r=>r.path.endsWith('/ai/jobs'));
  assert.ok(saveIndex>=0&&saveIndex<jobIndex);
  assert.equal(service.getRemote().targets.at(-1).name,'New personal target');
  await app.runTimer(1800);await submission;
  assert.match(app.nodes.get('#main').innerHTML,/latest target context/);
});
