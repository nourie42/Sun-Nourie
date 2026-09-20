import test from 'node:test';
import assert from 'node:assert/strict';
import {applyIndustryEstimates} from '../deal-desk/lib/estimates.js';
import {emptyDeal,calculate,validateImport} from '../src/dealDeskModel.js';
test('missing inputs become labeled estimates without overwriting actuals or confirmed zeros',()=>{
 const original={deal:{...emptyDeal(),sites:32,gallons:3932942,fuelCpg:21.1,insideGp:1795974,other:0},company:{period:'FY2025',ownership:'30 fee-simple; 2 leased sites'},evidence:[{field:'gallons',value:3932942,status:'supported'}],sources:[],warnings:[]};
 const result=applyIndustryEstimates(original);
 assert.equal(result.deal.gallons,3932942);assert.equal(result.deal.other,0);
 assert.equal(result.deal.lease,120000);assert.equal(result.estimates.length,24);
 assert.equal(result.evidence.find(e=>e.field==='gallons').status,'supported');
 assert.ok(result.estimates.every(e=>e.status==='Estimated'&&e.reason.startsWith('ESTIMATED')));
 assert.ok(result.estimates.every(e=>result.sources.some(s=>s.id===e.sourceId)));
 assert.equal(calculate(validateImport(result.deal)).investReady,true);
 assert.equal(original.deal.sellerOpex,null);
 const r=calculate(result.deal);assert.ok(Math.abs(r.systemCostReduction-(result.deal.sellerGa-result.deal.retainedGa))<.02);
});
test('unavailable company size is explicitly a one-site scenario, never an invented portfolio',()=>{
 const result=applyIndustryEstimates({deal:emptyDeal(),company:{},evidence:[],sources:[],warnings:[]});
 assert.equal(result.deal.sites,1);assert.match(result.evidence.find(e=>e.field==='sites').reason,/NOT the company/);
 assert.equal(result.estimates.length,29);assert.equal(calculate(validateImport(result.deal)).investReady,true);
});
test('an independently checked target-specific proposal takes priority over generic estimates',()=>{
 const result=applyIndustryEstimates({deal:{...emptyDeal(),sites:32},company:{},evidence:[{field:'fuelCpg',value:21.1,estimateEligible:true,sourceId:'seller',quote:'$ 0.211',sourceUnit:'USD/gallon',locator:'B59',reason:'Unit conversion needs classification review.'}],sources:[{id:'seller'}],warnings:[]});
 assert.equal(result.deal.fuelCpg,21.1);const e=result.evidence.find(e=>e.field==='fuelCpg');assert.equal(e.status,'Estimated');assert.equal(e.sourceId,'seller');assert.equal(e.quote,'$ 0.211');
});
