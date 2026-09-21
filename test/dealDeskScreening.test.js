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
test('nonadjacent financial table quotes recover exact source rows without accepting invented numbers',async()=>{
 const {restoreSourceQuotes}=await import('../src/dealDeskReview.js');
 const sources=[{id:'press',kind:'web',text:'For the year ended 2025 (in thousands)\nFuel gallons sold | 218,739 | 258,856 | 922,726 | 1,080,990\nMerchandise contribution | 116,247 | 134,873 | 499,781 | 579,569'}];
 const raw={evidence:[{field:'gallons',value:922726000,sourceId:'wrong',quote:'Fuel gallons sold 2025 922,726',sourceUnit:'gallons thousands'},{field:'insideGp',value:499781000,sourceId:'press',quote:'Merchandise contribution 2025 $499,781',sourceUnit:'USD thousands'},{field:'sellerOpex',value:123456000,quote:'Invented cost 123,456',sourceUnit:'USD thousands'}]};
 restoreSourceQuotes(raw,sources);assert.equal(raw.evidence[0].sourceId,'press');assert.match(raw.evidence[0].quote,/218,739/);assert.match(raw.evidence[1].quote,/134,873/);assert.equal(raw.evidence[2].quote,'Invented cost 123,456');
});
test('listed synergies reconcile to combined EBITDA change, including existing channels',()=>{const d=exampleDeal();d.gaSavings=100000;d.channels=[{name:'Existing dealer',sites:20,gallons:10000000,fuelCpg:5,other:0,opex:100000,ga:0,capex:20000,procurement:1,eligible:100,savings:20000}];const r=calculate(d);assert.equal(synergyRows(d).reduce((n,x)=>n+x.amount,0),r.combined-r.seller);});
test('reported fuel gross profit and gallons derive a weighted channel margin',async()=>{const {derivedSupported}=await import('../src/dealDeskReview.js');const sources=[{id:'f',text:'Fuel contribution 50,000\nFuel gallons 1,000,000'}];const e={operation:'ratioCpg',components:[{value:50000000,quote:'50,000',sourceId:'f',sourceUnit:'USD thousands'},{value:1000000000,quote:'1,000,000',sourceId:'f',sourceUnit:'gallons thousands'}]};assert.ok(derivedSupported(e,5,sources,'fuelCpg'));assert.ok(!derivedSupported(e,35,sources,'fuelCpg'));});
test('repeated issuer rows and 000s units still reach independent verification',async()=>{
 const {restoreSourceQuotes,numberSupported}=await import('../src/dealDeskReview.js');
 const raw={evidence:[{field:'gallons',value:922726000,quote:'Fuel gallons sold FY2025 922,726',sourceUnit:'gallons (000s)',sourceId:'issuer'}]};
 restoreSourceQuotes(raw,[{id:'issuer',text:'Fuel gallons sold | 922,726 | 1,080,990\nFuel gallons sold | 218,739 | 922,726'}]);
 assert.match(raw.evidence[0].quote,/\|/);assert.ok(numberSupported(922726000,raw.evidence[0].quote,raw.evidence[0].sourceUnit,'gallons'));
});
test('channel output limits retry one channel at a time',async()=>{
 const {extractChannels}=await import('../src/dealDeskChannels.js');let n=0;
 const answers=[{stop_reason:'max_tokens'}, {names:['Wholesale']},{channels:[{name:'Wholesale',type:'wholesale',metrics:{sites:{value:2099,quote:'Sites 2,099',sourceId:'s',sourceUnit:'count',period:'FY2025'},ga:0}}]}, {approved:['0.sites']}];
 const r=await extractChannels({ask:async()=>{const a=answers[n++];return a.stop_reason?a:{content:[{type:'text',text:JSON.stringify(a)}]};},content:[],sources:[{id:'s',text:'Sites 2,099'}],period:'FY2025',review:{deal:{},evidence:[]}});
 assert.equal(r.deal.channels[0].sites,2099);assert.equal(n,4);
});

test('custom synergies affect only their beneficiary, excluded rows remain auditable, and survive a draft reload',()=>{
 const d=exampleDeal(),base=calculate(d);d.customSynergies=[{id:'owner',name:'IT consolidation',amount:120000,beneficiary:'sunoco',scope:'Corporate',basis:'Four contracts',enabled:true},{id:'dealer',name:'Inside assortment',amount:50000,beneficiary:'dealer',enabled:true},{id:'off',name:'Unapproved fee savings',amount:999999,beneficiary:'sunoco',enabled:false},{id:'cost',name:'Recurring integration support',amount:-20000,beneficiary:'sunoco',enabled:true}];
 const restored=validateImport(JSON.parse(JSON.stringify(d))),r=calculate(restored);
 assert.equal(r.sun-base.sun,100000);assert.equal(r.dealer-base.dealer,50000);assert.equal(r.dealerPerSite,100000);assert.equal(r.combined-base.combined,150000);
 assert.equal(synergyRows(restored).reduce((n,x)=>n+x.amount,0),r.combined-r.seller);
 assert.equal(synergyRows(restored).find(x=>x.name==='Unapproved fee savings').proposed,999999);assert.equal(synergyRows(restored).find(x=>x.name==='Unapproved fee savings').included,false);
 const onlyDealer={...d,customSynergies:[d.customSynergies[1]]};assert.equal(purchaseRecommendation(onlyDealer,calculate(onlyDealer)).value,purchaseRecommendation(exampleDeal(),base).value);
});

test('invalid live channel and valuation edits cannot produce an apparently valid recommendation',()=>{
 for(const overrides of [{exitRecovery:101},{exitRecovery:-1},{gaSavings:NaN},{channels:[{name:'Bad channel',sites:2.5,eligible:150}]}]){const d={...exampleDeal(),...overrides};assert.equal(calculate(d).ready,false);assert.equal(purchaseRecommendation(d,calculate(d)).value,null);assert.throws(()=>validateImport(d));}
 const d={...exampleDeal(),hurdle:0,exitRecovery:100};assert.equal(purchaseRecommendation(d,calculate(d)).value,null);assert.match(purchaseRecommendation(d,calculate(d)).basis,/no finite price ceiling/);
});

test('YTD channel annualization includes derived reported flows, preserves rates, and never scales twice',()=>{
 const review={deal:{channels:[{name:'Wholesale',sites:30,gallons:600000,other:20000,opex:10000,ga:1000,capex:2000,fuelCpg:5,metricEvidence:Object.fromEntries(['gallons','other','opex','ga','capex'].map(k=>[k,{status:k==='gallons'?'Calculated from reported figures':'Reported',period:'2026 YTD 6 months'}]))}]},evidence:[],company:{},warnings:[]};
 applyPeriodBasis(review,{basis:'ytd',months:6,year:2026});const c=review.deal.channels[0];assert.equal(c.gallons,1200000);assert.equal(c.sites,30);assert.equal(c.fuelCpg,5);assert.equal(c.metricEvidence.gallons.value,1200000);assert.equal(c.metricEvidence.gallons.reportedValue,600000);assert.equal(c.capex,4000);
 applyPeriodBasis(review,{basis:'ytd',months:6,year:2026});assert.equal(c.gallons,1200000);assert.throws(()=>applyPeriodBasis(review,{basis:'ytd',months:0,year:2026}));
});

test('supply sensitivities remove channel benefits as well as retail benefits',()=>{const d=exampleDeal();d.channels=[{name:'Wholesale',sites:10,gallons:1000000,fuelCpg:5,other:0,opex:0,ga:0,capex:0,procurement:2,eligible:100,savings:0}];const r=calculate(d);assert.equal(r.sun-r.scenarios[0].sun,r.supply+20000);assert.equal(r.sun-r.scenarios[2].sun,(r.supply+20000)/2);});
