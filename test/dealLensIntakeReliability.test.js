import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=name=>fs.readFileSync(new URL('../public/deal-lens/'+name,import.meta.url),'utf8');
const load=(context,names)=>{for(const name of names)vm.runInContext(source(name),context);return context;};

function clipboardContext({writeText,legacy=true}={}){
  const calls=[],focused={focus:()=>calls.push('restore focus')};
  const field={style:{},focus:()=>calls.push('focus'),select:()=>calls.push('select'),setSelectionRange:(a,b)=>calls.push(['range',a,b]),remove:()=>calls.push('remove')};
  const document={activeElement:focused,body:{appendChild:el=>calls.push(['append',el])},createElement:()=>field,execCommand:command=>{calls.push(command);return legacy;}};
  const c=load(vm.createContext({navigator:writeText?{clipboard:{writeText}}:{},document}),['paste-intake.js']);
  return {c,calls,field};
}

test('copy uses the Clipboard API when permitted',async()=>{
  let copied;const {c,calls}=clipboardContext({writeText:async value=>{copied=value;}});
  assert.equal(await c.DealPaste.copyText('Exact prompt\nwith context'),true);
  assert.equal(copied,'Exact prompt\nwith context');assert.equal(calls.length,0);
});

test('copy falls back when Clipboard API is missing or denied and removes temporary fields',async()=>{
  for(const writeText of [undefined,async()=>{throw Error('Permission denied');}]){
    const {c,calls,field}=clipboardContext({writeText});
    assert.equal(await c.DealPaste.copyText('Financial summary'),true);
    assert.equal(field.value,'Financial summary');assert.equal(field.readOnly,true);
    assert.ok(calls.includes('select'));assert.ok(calls.includes('copy'));
    assert.deepEqual(calls.slice(-2),['remove','restore focus']);
  }
});

test('copy reports failure truthfully when both browser copy paths are blocked',async()=>{
  const {c,calls}=clipboardContext({writeText:async()=>{throw Error('Denied');},legacy:false});
  assert.equal(await c.DealPaste.copyText('Prompt to select manually'),false);
  assert.ok(calls.includes('remove'));assert.equal(await c.DealPaste.copyText(''),false);
});

test('prompt is available even when the workbook script failed to load',()=>{
  const c=load(vm.createContext({}),['plain-intake.js','paste-intake.js']);
  const prompt=c.DealPaste.prompt({files:[{name:'Example.xlsx'}],context:'Review the annual figures',dealName:'Example deal'});
  assert.match(prompt,/Example\.xlsx/);assert.match(prompt,/Review the annual figures/);assert.match(prompt,/DEAL NAME: Example deal/);
  assert.match(prompt,/FINANCIAL FIGURES/);assert.match(prompt,/List the assumption name, explicit units/);
});

test('fact cards distinguish dollars, counts, percentages, cents and gallons',()=>{
  const c=load(vm.createContext({Intl}),['paste-intake.js']);
  const examples=[['ask',9.5,'$9,500,000'],['sellerEbitdaUsd',1200000,'$1,200,000'],['assetCount',12,'12 assets'],['sites',10,'10 sites'],['fuelMarginCpg',12.5,'12.5 cents/gallon'],['insideMarginPct',30,'30%'],['gallons',11,'11,000,000 gallons'],['siteMonthlyGallons',100000,'100,000 gallons/month']];
  for(const [key,value,expected] of examples)assert.equal(c.DealPaste.formatFact({key,value}),expected);
});

function appContext(saved){
  const elements=new Map(),documentEvents=new Map(),storage=new Map(saved?[['deal-lens-v1',JSON.stringify(saved)]]:[]);
  const make=()=>({value:'',textContent:'',innerHTML:'',innerText:'Synthetic brief',hidden:false,open:false,disabled:false,dataset:{},style:{},listeners:new Map(),classList:{add(){},remove(){},toggle(){}},addEventListener(type,fn){this.listeners.set(type,fn);},setAttribute(){},focus(){},select(){},setSelectionRange(){},scrollIntoView(){},querySelector(){return make();},insertAdjacentHTML(){}});
  const get=selector=>{if(!elements.has(selector))elements.set(selector,make());return elements.get(selector);};
  const document={querySelector:get,querySelectorAll:()=>[],addEventListener(type,fn){if(!documentEvents.has(type))documentEvents.set(type,[]);documentEvents.get(type).push(fn);}};
  const inputs={base:null,price:null,addedRent:null,fieldCost:null,operatorCost:null};
  const c=vm.createContext({document,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},crypto:{randomUUID:()=>String(Math.random())},Intl,console,setTimeout:()=>0,clearTimeout(){},OriginalModel:{definitions:[],byKey:{},calculate:()=>({inputs,result:null,errors:[],available:false})},DealModelUI:{shell(){},render(){}},DealEvidence:{assess:()=>['roster','actuals','fuel','inside','opex','leases','capex','liabilities','model'].map(id=>({id,label:'Missing',detail:'Missing',state:'missing'})),questions:()=>[]},scrollTo(){},confirm:()=>true});
  c.window=c;get('[name="uploadIntent"]:checked').value='new';
  load(c,['intake-state.js','model.js','roster.js','plain-intake.js','paste-intake.js','app.js']);
  const snapshot=()=>JSON.parse(storage.get('deal-lens-v1'));
  return {c,get,storage,snapshot,documentEvents};
}

test('invalid imported backup cannot replace the active deal',async()=>{
  const {get,snapshot}=appContext(),before=snapshot();
  const input=get('#importFile'),run=input.listeners.get('change');
  for(const fields of [null,[],42]){
    input.files=[{text:async()=>JSON.stringify({format:'deal-lens-v1',deal:{fields,sites:[]}})}];
    await run({target:input});assert.deepEqual(snapshot(),before);
    assert.match(get('#toast').textContent,/Could not import/);
  }
});

test('older backups receive missing collections and valid field values before rendering',async()=>{
  const {get,snapshot}=appContext();const input=get('#importFile');
  input.files=[{text:async()=>JSON.stringify({format:'deal-lens-v1',deal:{fields:{name:'Older backup',sites:10},sites:[{name:'Example'}],gates:null,evidence:[],history:null}})}];
  await input.listeners.get('change')({target:input});
  const d=snapshot().deals.at(-1);assert.equal(d.fields.name,'Older backup (imported)');assert.equal(d.fields.sites,'10');assert.deepEqual(d.history,[]);assert.equal(get('#toast').textContent,'Deal imported');
});

test('damaged saved entries do not discard valid deals and the original data remains recoverable',()=>{
  const saved={active:'good',deals:[{id:'bad',fields:null,sites:[]},{id:'good',fields:{name:'Kept deal'},sites:[]}]};
  const {get,snapshot,storage}=appContext(saved);
  assert.equal(snapshot().deals.length,1);assert.equal(snapshot().deals[0].fields.name,'Kept deal');
  assert.deepEqual(JSON.parse(storage.get('deal-lens-v1-recovery')),saved);
  assert.equal(get('#exportRecovery').hidden,false);assert.match(get('#toast').textContent,/Valid deals were restored/);
});

test('malformed optional backup details cannot crash intake rendering',async()=>{
  const {get,snapshot}=appContext(),input=get('#importFile');
  input.files=[{text:async()=>JSON.stringify({format:'deal-lens-v1',deal:{fields:{name:'Safe import'},sites:[],tableReviews:[{labelImage:123,totalImage:{}}],facts:{gallons:{candidates:[{value:'bad'}]}},pastedEstimates:{price:null,sites:{value:5}},financialSources:[{fields:null}],aiReview:{facts:[],tables:[{columns:null,rows:[{cells:null}]}]}}})}];
  await input.listeners.get('change')({target:input});
  const d=snapshot().deals.at(-1);assert.equal(d.fields.name,'Safe import (imported)');assert.equal(d.tableReviews[0].labelImage,'');assert.deepEqual(d.facts.gallons.candidates,[]);assert.deepEqual(d.pastedEstimates,{sites:{value:5}});
});

test('intake is saved when the model is unavailable instead of discarding pasted results',()=>{
  const {get,snapshot}=appContext();get('#pastedAiResponse').value='Deal name: Source-only test\nSite count: 10 count\nAsking price: $9.5m\nAnnual EBITDA: $1.2m';
  get('#applyAiPaste').listeners.get('click')();
  const d=snapshot().deals.at(-1);assert.equal(d.fields.name,'Source-only test');assert.equal(d.fields.ask,'9.5');assert.equal(d.fields.sites,'10');
  assert.match(get('#pasteStatus').textContent,/source figures are saved/);assert.equal(get('#applyAiPaste').disabled,false);
  assert.match(get('#briefPaper').innerHTML,/Seller ask \$9,500,000; entered earnings \$1,200,000/);
});

test('correcting a source figure clears an older model override for the same input',()=>{
  const saved={active:'a',deals:[{id:'a',fields:{name:'Example',ask:'9.5'},sites:[],originalInputs:{price:'8m'},originalConfirmed:{price:true}}]};
  const {documentEvents,snapshot}=appContext(saved),target={dataset:{factEdit:'ask'},value:'9'};
  for(const handler of documentEvents.get('change'))handler({target});
  const d=snapshot().deals[0];assert.equal(d.fields.ask,'9');assert.equal(d.originalInputs.price,undefined);assert.equal(d.originalConfirmed.price,undefined);
});
