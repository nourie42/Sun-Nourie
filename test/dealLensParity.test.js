import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(data){
  const ctx=vm.createContext({Intl});ctx.window=ctx;
  for(const name of ['intake-state.js','model.js','original-engine.js'])vm.runInContext(fs.readFileSync('public/deal-lens/'+name,'utf8'),ctx);
  if(data){ctx.OriginalModelData=data;vm.runInContext(fs.readFileSync('public/deal-lens/original-model.js','utf8'),ctx);}
  return ctx;
}
const close=(actual,expected,tolerance=.0001)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const nativeDeal=overrides=>({fields:{},modelInputs:{sites:10,price:9500000,base:1200000,...overrides}});

test('native add-back scales with site count, preserves zero and occurs only in year 1',()=>{
  const {DealModel:m}=load();
  const baseline=m.calculate(nativeDeal()),zero=m.calculate(nativeDeal({operatorContribution:0}));
  assert.equal(baseline.inputs.operatorContribution,500000);
  assert.equal(m.calculate(nativeDeal({sites:4})).inputs.operatorContribution,200000);
  assert.equal(m.calculate(nativeDeal({operatorContribution:'125k'})).inputs.operatorContribution,125000);
  assert.equal(zero.inputs.operatorContribution,0);
  assert.equal(baseline.result.flows[0],zero.result.flows[0]);
  close(baseline.result.flows[1]-zero.result.flows[1],500000);
  for(let i=2;i<=15;i++)close(baseline.result.flows[i],zero.result.flows[i]);
  assert.equal(baseline.result.years[0].contribution,500000);
  assert.ok(baseline.result.years.slice(1).every(y=>y.contribution===0));
  close(baseline.result.npv-zero.result.npv,500000/1.13);
  assert.ok(baseline.result.irr>zero.result.irr);
  assert.ok(baseline.result.maxPrice>zero.result.maxPrice);
  assert.equal(baseline.result.irrBasis,'COOP!B34');
  close(m.forecast({...baseline.inputs,price:baseline.result.maxPrice}).npv,0,.01);
});

// Small synthetic workbook. No private workbook data or key is needed to test
// the adapter's period mapping, editable S18, separate IRR bases and solvers.
function syntheticWorkbook(){
  const defaults={B29:-9500000,C2:10,C3:11000000,C4:37,C9:8000000,C10:.3,C14:500000,C16:-6800000,C21:-100000,S6:10,S12:.02,S17:.15,S18:-50000,S19:-10000,S23:-7000,S24:-25000,B30:0,C25:0,S26:0,S3:.99,S21:.02};
  const cells=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,{v}]));
  const formula=(cell,f)=>cells[cell]={f,v:0};
  formula('C5','=C3*C4/100');formula('C11','=C9*C10');formula('B41','=C5+C11+C14+C16+C21');
  formula('B32','=B29*1.015-C2*50000+B30');
  formula('B36','=NPV(0.065,C21:Q21)');formula('B37','=B32+B36');
  for(let year=1;year<=15;year++){
    const col=String.fromCharCode(66+year);
    formula(col+'18','=$S$18*$C$2');formula(col+'20',`=1500000+${col}18`);
    if(year>1)formula(col+'21','=$C$21');
    formula(col+'22',`=${col}20+${col}21`);
    formula(col+'23',year===1?'=$S$23*$C$2':'=0');
    formula(col+'24','=$S$24*$C$2');
    formula(col+'27',`=-MAX(0,${col}22+$B$29/15)*0.25`);
    formula(col+'29',year===1?'=-C18':year===15?'=Q20*7':'=0');
    formula(col+'32',`=SUM(${col}22:${col}31)`);
    formula(col+'37',`=${col}20+SUM(${col}23:${col}31)`);
  }
  formula('B34','=IRR(B32:Q32)');formula('B38','=IRR(B37:Q37)');
  return {allowed:{COOP:Object.keys(defaults)},sheets:{COOP:cells,COCM:{C2:{v:0}},CODO:{C2:{v:0}},DODO:{C2:{v:0}}}};
}
const workbookDeal=overrides=>({fields:{},originalInputs:{price:9500000,sites:10,rent:100000,...overrides}});

test('workbook adapter distinguishes contribution from exit and keeps both cash-flow bases',()=>{
  const {OriginalModel:m,DealModel:n}=load(syntheticWorkbook()),d=workbookDeal(),r=m.calculate(d).result;
  assert.equal(r.years[0].contribution,500000);assert.equal(r.years[0].exit,0);
  assert.ok(r.years.slice(1).every(y=>y.contribution===0));
  assert.ok(r.years.slice(0,14).every(y=>y.exit===0));assert.equal(r.years[14].exit,7000000);
  for(const [cell,b] of Object.entries(r.returnCases)){
    close(b.irr,r.engine.get('COOP',cell));close(b.irr,n.irr(b.flows));
    close(b.npv,n.npv(.13,b.flows));
    const solved=m.compute({...m.resolve(d).changes,'COOP!B29':-b.maxPrice});
    close(solved.get('COOP',cell),.13,.00000001);
  }
  assert.notEqual(r.returnCases.B34.maxPrice,r.returnCases.B38.maxPrice);
  assert.equal(r.irrBasis,'COOP!B34');assert.equal(r.maxPrice,r.returnCases.B34.maxPrice);
  assert.equal(m.calculate(workbookDeal({sites:4})).result.years[0].contribution,200000);
  assert.equal(m.calculate(workbookDeal({operatorPerSite:0})).result.years[0].contribution,0);
  assert.equal(m.calculate(workbookDeal({operatorPerSite:25000})).result.years[0].contribution,250000);
  assert.equal(m.calculate(d).result,r,'Unchanged inputs reuse the cached calculation');
  d.originalInputs.operatorPerSite=10000;
  assert.equal(m.calculate(d).result.years[0].contribution,100000,'Editing S18 invalidates the cache');
});

test('workbook display reads the actual C29 and does not conceal an older missing add-back',()=>{
  const data=syntheticWorkbook();data.sheets.COOP.C29={v:0};
  const r=load(data).OriginalModel.calculate(workbookDeal()).result;
  assert.equal(r.years[0].contribution,0);
  assert.equal(r.years[0].exit,0);
});
