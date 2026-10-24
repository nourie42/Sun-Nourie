import {test as nodeTest} from 'node:test';import {readProtectedModelFile} from '../src/dealLensRoutes.js';
const modelKey=process.env.DEAL_LENS_MODEL_KEY,test=modelKey?nodeTest:nodeTest.skip;import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const c=vm.createContext({Intl,console,fetch:()=>assert.fail('Local intake must not call a model')});c.window=c;
if(modelKey)for(const f of ['intake-state.js','model.js','original-model-data.js','original-engine.js','original-model.js','roster.js','plain-intake.js','paste-intake.js','evidence-state.js'])vm.runInContext(f==='original-model-data.js'?readProtectedModelFile(f,modelKey).toString('utf8'):fs.readFileSync('public/deal-lens/'+f,'utf8'),c);
const parse=s=>c.DealPaste.parse(s),apply=s=>{const d={fields:{},sites:[],evidence:{}};c.DealPaste.apply(d,parse(s));return d;};
const roster=`| Asset ID | Asset name | Address | City | State | Zip | Division | RE control | RE owner | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1001 | One Shell | 100 Test Road | Test City | FL | 32311 | Retail | Fee | RCD | Test.xlsx Roster!13 |
| 1095 | Bulk Plant | 200 Test Road | Test City | FL | 32305 | Commercial | Fee | RCD | Test.xlsx Roster!23 |`;
test('ordinary sentences and bullets fill financial model without JSON',()=>{
 const d=apply('Deal name: Plain test\nThe asking price is $8 million and annual EBITDA is $2,000,000.\n- Annual fuel gallons: 10m gallons\n- Site count: 2 count');
 const m=c.OriginalModel.calculate(d);assert.equal(d.fields.name,'Plain test');assert.equal(m.inputs.price,8e6);assert.equal(m.inputs.base,2e6);assert.equal(m.inputs.gallons,10e6);assert.equal(m.inputs.sites,2);assert.ok(m.result);
});
test('readable table retains financial periods, negatives, full precision and segment scope',()=>{
 const p=parse(`| Metric | Value | Period | Scope | Source | Status |
| --- | --- | --- | --- | --- | --- |
| Annual fuel gallons | 11,234,567.89 gallons | TTM 7/31/2026 | Portfolio | Model P&L!I25 | Source figure |
| EBITDA | $175,321.4567 | TTM 7/31/2026 | Portfolio | Model P&L!I137 | Source figure |
| EBITDAR | $275,321.4567 | TTM 7/31/2026 | Portfolio | Model P&L!I133 | Source figure |
| EBITDA | ($43,210.98765) | TTM 7/31/2026 | Segment Commercial | Model P&L!N137 | Source figure |
| EBITDA | $700,000 | FY2025 | Portfolio | Model Prior!I137 | Source figure |
| Asking price | Not provided | | Portfolio | | |`);
 assert.equal(p.facts.length,5);assert.ok(Math.abs(p.facts[0].value-11.23456789)<1e-12);assert.equal(p.facts[1].value,175321.4567);assert.equal(p.facts[2].key,'sellerEbitdarUsd');assert.equal(p.facts[3].scope,'segment');assert.equal(p.facts[3].value,-43210.98765);
 const d={fields:{}};c.DealPaste.apply(d,p);assert.ok(Math.abs(c.OriginalModel.calculate(d).inputs.base-175321.4567)<1e-6);
});
test('complete readable roster preserves bulk plant, ownership and source, and is received not verified',()=>{
 const d=apply(roster);assert.equal(d.sites.length,2);assert.equal(d.fields.sites,'1');assert.equal(d.fields.assetCount,'2');assert.equal(d.sites[1].id,'1095');assert.equal(d.sites[1].division,'Commercial');assert.equal(d.sites[0].tenure,'Fee');assert.equal(d.sites[0].owner,'RCD');assert.match(d.sites[0].address,/Test City/);assert.equal(d.siteClues.length,2);
 const e=c.DealEvidence.assess(d).find(r=>r.id==='roster');assert.equal(e.state,'received');assert.match(e.detail,/Legal ownership/);assert.equal(c.OriginalModel.calculate(d).result,null,'Roster alone must not fabricate a financial case');
});
test('site count alone or an incomplete roster stays partial',()=>{
 let d=apply('Site count: 11 count');assert.equal(c.DealEvidence.assess(d)[0].state,'partial');
 d=apply('Asset count: 11 count\n'+roster);assert.equal(c.DealEvidence.assess(d)[0].state,'partial');assert.match(c.DealEvidence.assess(d)[0].detail,/source reports 11/);
});
test('estimated assumptions stay red; missing observed values are not turned into zero',()=>{
 const d=apply(`Annual EBITDA: $2m\nAsking price: Not provided\nModel estimates\n| Assumption | Value | Basis |
| --- | --- | --- |
| Asking price | $8m | Illustrative estimate for review |
| Fuel supply improvement | 5 cents/gallon | Needs signed contract |`);
 const m=c.OriginalModel.calculate(d);assert.equal(m.inputs.price,8e6);assert.equal(m.items.price.status,'estimated');assert.equal(m.inputs.fuelBenefit,5);assert.equal(m.items.fuelBenefit.status,'estimated');assert.ok(!c.DealIntake.facts(d).some(r=>r.key==='ask'));
});
test('NOI and EBITDAR never silently become observed EBITDA',()=>{
 const p=parse('EBITDAR: $250,000\nSite name: Store One\nNet operating income: $150,000');assert.equal(p.facts.length,2);assert.ok(!p.facts.some(f=>f.key==='sellerEbitdaUsd'));assert.equal(p.facts[1].siteName,'Store One');
});
test('wide fiscal year tables retain separate years',()=>{
 const p=parse('| Metric | FY2025 | FY2026 |\n| --- | --- | --- |\n| EBITDA | $100,000 | $200,000 |');assert.equal(p.facts.length,2);assert.equal(p.facts[1].period,'FY2026');
});
test('unknown prose and malformed JSON fail without changing a deal',()=>{
 assert.throws(()=>parse('This deal is interesting.'),/No usable labelled/);assert.throws(()=>parse('{"facts":['),/incomplete|No usable/);
});
test('manual verification remains independent of automatic evidence receipt',()=>{
 const d=apply('Annual EBITDA: $2m\nAnnual fuel gallons: 10m gallons\nInside sales: $5m\nOperating expenses: $1m\n'+roster);
 const e=c.DealEvidence.assess(d);assert.equal(e.find(r=>r.id==='actuals').state,'received');assert.equal(e.find(r=>r.id==='fuel').state,'partial');assert.equal(e.find(r=>r.id==='model').state,'received');assert.equal(e.find(r=>r.id==='capex').state,'missing');
 d.evidence.roster={status:'verified',source:'Title reviewed'};assert.equal(c.DealEvidence.assess(d)[0].state,'verified');assert.ok(c.DealEvidence.questions(d).every(s=>!s.includes('normEbitda')));
});
test('multirow spreadsheet headers read full roster without treating a rolling-stock table as assets',()=>{
 const rows=[{B:'CCA',M:'RE',L:'RE'},{B:'ID #',C:'Asset Name',D:'Address',E:'City',F:'State',G:'Zip',L:'Control',M:'Owner',O:'Division',_row:'12'},{B:'1001',C:'One Shell',D:'100 Test Road',E:'City',F:'FL',G:'32311',L:'Fee',M:'RCD',O:'Retail',_row:'13'},{B:'1095',C:'Bulk Plant',D:'200 Test Road',E:'City',F:'FL',G:'32305',L:'Fee',M:'RCD',O:'Commercial',_row:'23'}];
 const r=c.DealRoster.read(rows,'Test.xlsx Master Asset Roster');assert.equal(r.length,2);assert.equal(r[0].id,'1001');assert.equal(r[1].division,'Commercial');assert.match(r[1].source,/!23$/);assert.equal(c.DealRoster.read([{A:'Truck ID',B:'Vehicle'},{A:'RCD1',B:'Truck'}]).length,0);
});

test('repeated panel renders reuse calculations and every input edit invalidates them',()=>{
 const d=apply('Annual EBITDA: $2m\nAsking price: $8m');const first=c.OriginalModel.calculate(d);assert.equal(c.OriginalModel.calculate(d),first);d.originalInputs={price:'9m'};const updated=c.OriginalModel.calculate(d);assert.notEqual(updated,first);assert.equal(updated.inputs.price,9e6);d.originalInputs.price='invalid';assert.ok(c.OriginalModel.calculate(d).errors.length);
});
