import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,exampleDeal,validateImport} from '../src/dealDeskModel.js';
import {purchaseRecommendation,synergyRows} from '../deal-desk/lib/screening.js';
import {applyPeriodBasis} from '../src/dealDeskChannels.js';
import {normalizeReview,periodCompatible} from '../src/dealDeskReview.js';
test('existing dealers add supply economics without retail commission or conversion cost',()=>{
 const d=exampleDeal(),base=calculate(d);d.channels=[{name:'Wholesale',sites:100,gallons:100000000,fuelCpg:5,other:100000,opex:1000000,ga:200000,capex:10000,procurement:1,eligible:50,savings:50000}];d.gaSavings=10000;
 const r=calculate(validateImport(d));assert.equal(r.totalSites,110);assert.equal(r.dealer,base.dealer);assert.equal(r.dealerPerSite,base.dealer/10);assert.equal(r.investment,base.investment);assert.equal(r.sun-base.sun,4460000);assert.equal(r.seller-base.seller,3900000);assert.equal(r.cashflows[2]-base.cashflows[2],4450000);
});
test('purchase ceiling solves NPV including price-linked terminal cash',()=>{const d=exampleDeal(),r=calculate(d),p=purchaseRecommendation(d,r);const at={...d,price:p.capacity,terminal:p.capacity*.8};assert.ok(Math.abs(calculate(at).npv)<2);assert.ok(p.value<p.capacity);assert.equal(synergyRows(d).find(x=>x.name==='Separate freight').included,false);});
test('annualization scales flows and preserves counts and margins',()=>{const r={deal:{sites:12,gallons:600000,fuelCpg:35,insideGp:300000,channels:[]},evidence:[{field:'gallons',value:600000,status:'supported'},{field:'insideGp',value:300000,status:'supported'}],company:{},warnings:[]};applyPeriodBasis(r,{basis:'ytd',months:6,year:2026});assert.equal(r.deal.gallons,1200000);assert.equal(r.deal.insideGp,600000);assert.equal(r.deal.fuelCpg,35);assert.equal(r.deal.sites,12);assert.match(r.evidence[0].reason,/÷ 6/);});
test('period aliases accept same year, reject wrong years and mismatched durations',()=>{assert.ok(periodCompatible('Year ended December 31, 2025','FY2025'));assert.ok(periodCompatible('Six months ended June 30, 2026','2026 YTD 6 months'));assert.ok(!periodCompatible('FY2024','FY2025'));assert.ok(!periodCompatible('Nine months ended September 30, 2026','2026 YTD 6 months'));});
