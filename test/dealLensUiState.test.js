import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=name=>fs.readFileSync('public/deal-lens/'+name,'utf8');
const blank=()=>({id:'one',fields:{name:'Untitled deal',stage:'Screening',targetIrr:'13',recommendation:'Clarify before pricing'},facts:{},sites:[],gates:{},tasks:{},evidence:{}});

test('new-deal intake preserves manually entered deals, including explicit zero values',()=>{
  const ctx=vm.createContext({});ctx.window=ctx;vm.runInContext(source('intake-state.js'),ctx);
  assert.equal(ctx.DealIntake.hasData(blank()),false);
  for(const change of [d=>d.fields.ask='0',d=>d.fields.market='Detroit',d=>d.fields.name='Romeo',d=>d.fields.nextAction='Review lease',d=>d.originalInputs={rent:0},d=>d.modelInputs={base:1200000},d=>d.sites=[{name:'Store 1'}],d=>d.tasks={screen0:true},d=>d.gates={rights:{status:'no'}}]){
    const d=blank();change(d);assert.equal(ctx.DealIntake.hasData(d),true);
  }
  const empty=blank();empty.fields.market=' ';empty.originalInputs={rent:''};empty.sites=[{name:'',route:'Unassigned'}];
  assert.equal(ctx.DealIntake.hasData(empty),false);
});

function uiHarness({available=true}={}){
  const nodes=new Map(),handlers={},downloads=[],buttons=[{disabled:false,textContent:'Download your model'},{disabled:false,textContent:'Download your model'}];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:false});return nodes.get(id);};
  const keys=['price','sites','gallons','fuelMargin','inside','insideMargin','otherIncome','opex','rent','operatorPerSite'];
  const definitions=keys.map(key=>({key,label:key,unit:key==='sites'?'sites':'$',sheet:'COOP',cell:'C2'})),byKey=Object.fromEntries(definitions.map(s=>[s.key,s]));
  const calculate=d=>({available,hasSource:available,estimated:keys.length,errors:available?[]:['Reload to retry the workbook download.'],inputs:{sites:10,target:13,base:1200000},items:Object.fromEntries(keys.map(key=>[key,{value:available?100:null,status:'estimated',basis:'Source basis'}])),result:available?{initial:9500000,returnCases:{B34:{cell:'COOP!B34',label:'Without capitalized lease',irr:.13,maxPrice:9500000,npv:0}},years:Array.from({length:15},(_,i)=>({year:i+1,ebitda:1200000,contribution:i?0:500000,exit:i===14?5000000:0,cash:1000000}))}:null});
  let finishExport,exportedDeal;
  const document={activeElement:null,getElementById:node,querySelectorAll:selector=>selector==='[data-original-export]'?buttons:[],addEventListener:(name,handler)=>handlers[name]=handler,dispatchEvent:()=>{},createElement:tag=>tag==='a'?{click(){downloads.push(this.download);}}:{}};
  const ctx=vm.createContext({document,console,Intl,setTimeout:()=>0,clearTimeout:()=>{},CustomEvent:class{},URL:{createObjectURL:()=> 'blob:model',revokeObjectURL:()=>{}},OriginalModel:{calculate,definitions,byKey,money:n=>n==null?'—':'$'+n},DealIntake:{facts:()=>[]},DealModel:{parse:Number},OriginalModelExport:{make:deal=>{exportedDeal=deal;return new Promise(resolve=>finishExport=resolve);}}});
  vm.runInContext(source('intake-model-ui.js'),ctx);
  return {ctx,nodes,buttons,downloads,handlers,finish:()=>finishExport({}),exported:()=>exportedDeal};
}

test('workbook failure leaves a visible recovery state and disables model downloads',()=>{
  const h=uiHarness({available:false});h.ctx.DealModelUI.render(blank());
  assert.equal(h.nodes.get('modelPreview').hidden,false);
  assert.match(h.nodes.get('intakeModelResults').innerHTML,/Workbook temporarily unavailable/);
  assert.match(h.nodes.get('fullModelResults').innerHTML,/Reload to retry/);
  assert.doesNotMatch(h.nodes.get('modelCoverage').textContent,/null sites/);
  assert.ok(['intakeModelInputs','originalInputsCard','originalCashflowsCard'].every(id=>h.nodes.get(id).hidden));
  assert.ok(h.buttons.every(b=>b.disabled));
  assert.equal(h.nodes.get('originalCashflows').innerHTML,'');
});

test('download keeps the selected deal and filename when the user switches deals while it is preparing',async()=>{
  const h=uiHarness(),first=blank();first.fields.name='Deal One';h.ctx.DealModelUI.render(first);
  const pending=h.handlers.click({target:{closest:()=>h.buttons[0]}});
  assert.ok(h.buttons.every(b=>b.disabled));
  first.fields.name='Edited later';const second=blank();second.id='two';second.fields.name='Deal Two';h.ctx.DealModelUI.render(second);
  assert.ok(h.buttons.every(b=>b.disabled));
  assert.equal(h.exported().fields.name,'Deal One');
  h.finish();await pending;
  assert.deepEqual(h.downloads,['Deal-One-original-model.xlsx']);
  assert.ok(h.buttons.every(b=>!b.disabled));
});
