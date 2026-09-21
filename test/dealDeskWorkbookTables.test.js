import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {importWorkbookTables} from '../src/dealDeskWorkbookTables.js';
import {emptyDeal} from '../src/dealDeskModel.js';
import {applyPeriodBasis} from '../src/dealDeskChannels.js';
import {parseAnalysis,extractBoundedAnalysis} from '../src/dealDeskProcessing.js';
import {registerDealDeskRoutes} from '../src/dealDeskIntakeRoutes.js';

// Invented figures and site identifiers; no private seller data is committed.
const source=()=>({id:'w',name:'Seller.xlsx',kind:'text',structuredSiteCount:3,warnings:[],text:`
SHEET Roster
B2: Asset Roster - Example Seller
SHEET Detailed P&L
A1: Store # | B1: Total - 3 Stores | D1: 101 | F1: 102 | H1: 103
A2: P&L Line Item | B2: FY2025 | C2: 2026 YTD (1) | D2: FY2025 | E2: 2026 YTD (1) | F2: FY2025 | G2: 2026 YTD (1) | H2: FY2025 | I2: 2026 YTD (1)
A5: Operating Status | D5: Operating | F5: Commissioned Agent | H5: Not Operating
A50: Fuel Gross Profit | B50: $ 250 | C50: $ 175 | D50: $ 300 | E50: $ 200 | F50: $ (50) | G50: $ (25) | H50: $ - | I50: $ -
A52: Merchandise Gross Profit | B52: $ 220 | C52: $ 110 | D52: $ 200 | E52: $ 100 | F52: $ 20 | G52: $ 10 | H52: $ - | I52: $ -
A54: Total Gross Profit | B54: $ 690 | C54: $ 330 | D54: $ 600 | E54: $ 350 | F54: $ 80 | G54: $ (20) | H54: $ 10 | I54: $ -
A58: Fuel Gallons | B58: 1500 | C58: 1000 | D58: 1000 | E58: 700 | F58: 500 | G58: 300 | H58: 0 | I58: 0
A62: (1) 2026 YTD reflects January - July 2026 actuals
`});
test('direct workbook extraction reconciles distinct channels, negative accounting values and margins',()=>{
 const r=importWorkbookTables([source()],{basis:'lastYear',year:2026,current:{...emptyDeal(),sites:3}});
 assert.equal(r.deal.name,'Example Seller');assert.equal(r.deal.sites,1);assert.equal(r.deal.gallons,1000);assert.equal(r.deal.fuelCpg,30);assert.equal(r.deal.insideGp,200);assert.equal(r.deal.other,100);
 assert.equal(r.deal.channels.length,2);assert.equal(r.deal.channels[0].fuelCpg,-10);assert.equal(r.deal.channels[0].other,130);assert.equal(r.deal.channels[1].sites,1);assert.equal(r.deal.sellerOpex,null);
 assert.match(r.evidence.find(e=>e.field==='fuelCpg').locator,/D50\/D58/);
});
test('YTD reads merged site headers and annualizes only the selected seven-month flows once',()=>{
 const r=applyPeriodBasis(importWorkbookTables([source()],{basis:'ytd',year:2026,months:7}),{basis:'ytd',year:2026,months:7});
 assert.equal(r.deal.sites,1);assert.equal(r.deal.gallons,1200);assert.equal(r.deal.channels[0].gallons,300/7*12);assert.equal(r.deal.channels[0].sites,1);assert.equal(r.deal.channels[0].fuelCpg,-25/300*100);
 assert.throws(()=>importWorkbookTables([source()],{basis:'ytd',year:2026,months:6}),/7 months/);
 assert.throws(()=>importWorkbookTables([source()],{basis:'ttm',year:2026}),/TTM needs/);
});
test('mismatched totals cannot become verified values, and unsupported layouts use the normal pipeline',()=>{
 const bad=source();bad.text=bad.text.replace('B58: 1500','B58: 9999');assert.throws(()=>importWorkbookTables([bad],{basis:'lastYear',year:2026}),/reconcile/);
 const count=source();count.text=count.text.replace('Total - 3 Stores','Total - 4 Stores');assert.throws(()=>importWorkbookTables([count],{basis:'lastYear',year:2026}),/location count/);
 assert.equal(importWorkbookTables([{...source(),text:'Unrecognized workbook'}],{basis:'lastYear',year:2026}),null);
 assert.equal(importWorkbookTables([source(),source()],{basis:'lastYear',year:2026}),null);
});
test('profile-only fallback needs no financial envelope and prose-wrapped complete JSON is accepted',async()=>{
 assert.deepEqual(parseAnalysis({content:[{type:'text',text:'Result:\n```json\n{"deal":{}}\n```'}]}),{deal:{}});
 assert.throws(()=>parseAnalysis({stop_reason:'max_tokens',content:[{type:'text',text:'{"deal":{}}'}]}),/smaller batch/);
 let calls=0;const ask=async()=>({content:[{type:'text',text:JSON.stringify(++calls===1?null:calls===2?{company:{name:'Test'},summary:'Source company'}:{deal:{},evidence:[]})}]});
 const r=await extractBoundedAnalysis({ask,content:[],current:emptyDeal(),notes:'',period:'FY2025',phase:()=>{}});assert.equal(r.company.name,'Test');assert.equal(calls,6);
});
test('authenticated workbook upload completes through the real route without any AI request',async t=>{
 let providerCalls=0;const app=express();registerDealDeskRoutes(app,{env:{DEAL_DESK_PASSWORD:'fixture-code',DEAL_DESK_API_KEY:'fixture-key'},fetchImpl:async()=>{providerCalls++;throw Error('The deterministic workbook path must not call AI.');}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}/api/deal-desk`,headers={'content-type':'application/json','x-deal-desk-passcode':'fixture-code'};
 const response=await fetch(base+'/analyze',{method:'POST',headers,body:JSON.stringify({deal:{...emptyDeal(),sites:3},files:[source()],periodBasis:'lastYear',reportingYear:2026,estimateMissing:true})});assert.equal(response.status,202);
 const {jobId}=await response.json();const job=await(await fetch(base+'/jobs/'+jobId,{headers})).json();assert.equal(job.state,'complete',job.error);assert.equal(providerCalls,0);assert.equal(job.result.deal.sites,1);assert.equal(job.result.deal.channels.reduce((n,c)=>n+c.sites,1),3);assert.equal(job.result.evidence.find(e=>e.field==='price').status,'Estimated');
});
