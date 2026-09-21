import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {registerDealDeskRoutes} from '../src/dealDeskRoutes.js';
import {calculate,emptyDeal,exampleDeal,validateImport} from '../src/dealDeskModel.js';
import {normalizeReview,restoreSourceQuotes} from '../src/dealDeskReview.js';
import {sitesFromRows,mergeSites,aggregateSites,consolidateWorkbookSites} from '../src/dealDeskSites.js';
import {fields} from '../src/dealDeskModel.js';
import {extractSitePages} from '../src/dealDeskProcessing.js';
const env={ANTHROPIC_API_KEY:'test-not-real',AI_COUNCIL_ACCESS_CODE:'test-code'};
const headers={'content-type':'application/json','x-deal-desk-passcode':'test-code'};
const source={id:'f1',name:'Fictional seller.txt',kind:'text',text:'Fictional Fuel operates 10 sites. FY2025 annual gallons 15 million. Fuel margin USD/gallon 0.35.',warnings:[]};
const proposal={channels:[],company:{name:'Fictional Fuel',overview:'Fictional Fuel operates 10 sites.',period:'FY2025',sourceIds:['f1']},summary:'Fictional Fuel operates 10 sites.',deal:{name:'Fictional Fuel',sites:10,gallons:15000000,fuelCpg:35},evidence:[
 {field:'sites',value:10,sourceId:'f1',locator:'line 1',quote:'10 sites',period:'FY2025',sourceUnit:'count',status:'sourced',confidence:'high'},
 {field:'gallons',value:15000000,sourceId:'f1',locator:'line 1',quote:'15 million',period:'FY2025',sourceUnit:'gallons millions',status:'sourced',confidence:'high'},
 {field:'fuelCpg',value:35,sourceId:'f1',locator:'line 1',quote:'0.35',period:'FY2025',sourceUnit:'USD/gallon',status:'sourced',confidence:'high'}
]};
const verification={channels:[],approvedFields:['sites','gallons','fuelCpg'],companySupported:true,summarySupported:true};
test('accounting currency spaces do not reject an independently verified source value',()=>{
 const raw={company:{name:'Test',period:'FY2025',sourceIds:['w']},summary:'Test',deal:{insideGp:1795974},evidence:[{field:'insideGp',value:1795974,sourceId:'w',quote:'$1,795,974',period:'FY2025',sourceUnit:'USD',status:'sourced',confidence:'high'}]};
 const sources=[{id:'w',kind:'text',text:'B52: $ 1,795,974 [cached formula: B25-B46]'}];
 const check={approvedFields:['insideGp'],companySupported:true,summarySupported:true};
 assert.equal(normalizeReview(raw,sources,emptyDeal(),check,'FY2025').deal.insideGp,1795974);
 assert.equal(normalizeReview({...raw,deal:{insideGp:1795975}},sources,emptyDeal(),check,'FY2025').deal.insideGp,null);
});
const ai=x=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(x)}]});
const packet=()=>({deal:emptyDeal(),files:[source],notes:'',period:'FY2025'});
test('shortened quotes restore only a unique complete uploaded source line',()=>{
 const line='Seller fuel margin before dealer commission and card fees: 35 cents/gallon.';
 const proposal={evidence:[{sourceId:'q',quote:'Seller fuel margin ... 35 cents/gallon.'}]};
 assert.equal(restoreSourceQuotes(structuredClone(proposal),[{id:'q',kind:'text',text:line}]).evidence[0].quote,line);
 for(const source of [{id:'q',kind:'web',text:line},{id:'q',kind:'text',text:line+'\n'+line},{id:'q',kind:'text',text:line.replace('35','45')}])assert.equal(restoreSourceQuotes(structuredClone(proposal),[source]).evidence[0].quote,proposal.evidence[0].quote);
});
async function fixture(t,opts={}){
 const app=express();registerDealDeskRoutes(app,{env,...opts});const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,body,extra={})=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 return {request,post:(body,extra)=>request('/api/deal-desk/analyze',body,extra),async job(response){assert.equal(response.status,202);const {jobId}=await response.json();for(let i=0;i<200;i++){const j=await (await request('/api/deal-desk/jobs/'+jobId)).json();if(j.state!=='running')return j;await new Promise(r=>setTimeout(r,5));}throw Error('Test job did not finish');}};
}
test("restored operating bridge matches the original example", () => {
  const r = calculate(exampleDeal());
  assert.equal(r.ready, true);
  assert.equal(r.seller, 3000000);
  assert.equal(r.sun, 4240000);
  assert.equal(r.dealer, 950000);
  assert.equal(r.combined, 5190000);
  assert.equal(r.lift, 1240000);
  assert.equal(r.systemCostReduction, 1950000);
  assert.equal(r.investment, 23400000);
  assert.ok(r.irr > 0.1 && r.irr < 0.2);
  assert.equal(r.bridge.reduce((sum, item) => sum + item.value, 0), r.sun);
});
test("commission and rent cancel in combined economics", () => {
  const d = exampleDeal(), before = calculate(d);
  d.commission += 2; d.rent += 60000;
  const after = calculate(d);
  assert.equal(after.combined, before.combined);
  assert.equal(after.sun + after.dealer, before.combined);
});
test("missing inputs stay unknown, and capital is excluded from EBITDA", () => {
  assert.equal(calculate(emptyDeal()).sun, null);
  assert.equal(calculate(emptyDeal()).investReady, false);
  const d = exampleDeal(), before = calculate(d);
  d.oneTime += 1000000;
  assert.equal(calculate(d).sun, before.sun);
  assert.equal(calculate(d).investment, before.investment + 1000000);
  assert.throws(() => validateImport({ gallons: "15,000" }));
});

test('static app retains hidden route and status does not expose secrets',async t=>{
 const f=await fixture(t);for(const route of ['/deal-desk','/deal-desk/','/deal-desk/index.html']){const r=await f.request(route);assert.equal(r.status,200);assert.match(await r.text(),/\/deal-desk\/assets\/index-/);assert.match(r.headers.get('content-security-policy'),/worker-src 'self' blob:/);assert.match(r.headers.get('x-robots-tag'),/noindex/);}
 const status=await(await f.request('/api/deal-desk/status')).json();assert.equal(status.version,'deal-intake-v8-synergy-audit');assert.equal(status.ready,true);assert.doesNotMatch(JSON.stringify(status),/test-code|test-not-real/);assert.equal((await f.request('/')).status,404);
});
test('authentication protects analysis, research, jobs and summary',async t=>{
 const f=await fixture(t);for(const [route,body]of [['/analyze',packet()],['/research',{deal:emptyDeal(),company:'X'}],['/jobs/invalid',undefined],['/summary',{deal:emptyDeal()}]])assert.equal((await f.request('/api/deal-desk'+route,body,{'x-deal-desk-passcode':'bad'})).status,401);
 const closed=await fixture(t,{env:{ANTHROPIC_API_KEY:'test'}});assert.equal((await closed.post(packet())).status,503);
 const override=await fixture(t,{env:{...env,DEAL_DESK_PASSWORD:'other'}});assert.equal((await override.post(packet())).status,401);
});
test('replayed submissions reuse one job and reject changed payloads',async t=>{
 let calls=0;const f=await fixture(t,{fetchImpl:async()=>ai(++calls===1?proposal:verification)});
 const p={...packet(),requestId:'safe-repeat-request-12345'};
 const first=await(await f.post(p)).json(),second=await(await f.post(p)).json();assert.equal(first.jobId,second.jobId);
 const job=await f.job(await f.post(p));assert.equal(job.state,'complete');assert.equal(calls,4);assert.equal(job.requestHash,undefined);
 assert.equal((await f.post({...p,notes:'different packet'})).status,409);
});
test('two passes fill supported facts, normalize millions/cents and keep unknowns blank',async t=>{
 const sent=[];const f=await fixture(t,{fetchImpl:async(_u,o)=>{sent.push(JSON.parse(o.body));return ai(sent.length===1?proposal:verification);}});
 const j=await f.job(await f.post(packet()));assert.equal(j.state,'complete');assert.equal(sent.length,4);assert.equal(j.result.deal.sites,10);assert.equal(j.result.deal.gallons,15000000);assert.equal(j.result.deal.fuelCpg,35);assert.equal(j.result.deal.commission,null);assert.equal(j.result.summary,proposal.summary);assert.match(sent[0].messages[0].content[0].text,/CPG inputs are CENTS/);assert.doesNotMatch(JSON.stringify(j.result.sources),/annual gallons/);
});
test('mismatched periods, unsupported quotes, conflicts and verifier rejection cannot autofill',()=>{
 const variants=[
  {proposal:{...proposal,evidence:proposal.evidence.map(e=>({...e,period:'FY2024'}))},verification},
  {proposal:{...proposal,evidence:proposal.evidence.map(e=>({...e,quote:'invented 99 million'}))},verification},
  {proposal,verification:{...verification,approvedFields:[]}},
  {proposal:{...proposal,evidence:[...proposal.evidence,{...proposal.evidence[1],value:16000000}]},verification},
 ];
 for(const v of variants){const r=normalizeReview(v.proposal,[source],emptyDeal(),v.verification,'FY2025');assert.equal(r.deal.gallons,null);}
 const current={...emptyDeal(),gallons:42};const r=normalizeReview(proposal,[source],current,verification,'FY2025');assert.equal(r.deal.gallons,42);assert.equal(r.conflicts[0].field,'gallons');
 const otherCurrency={...proposal,evidence:proposal.evidence.map(e=>({...e,sourceUnit:'CAD/gallon'}))};assert.equal(normalizeReview(otherCurrency,[source],emptyDeal(),verification,'FY2025').deal.fuelCpg,null);
});
test('verification failure retains proposed values for review without autofill',async t=>{
 let n=0;const f=await fixture(t,{fetchImpl:async()=>++n===1?ai(proposal):Response.json({},{status:503})});
 const j=await f.job(await f.post(packet()));assert.equal(j.state,'complete');assert.equal(j.result.verified,false);assert.equal(j.result.deal.gallons,null);assert.equal(j.result.evidence.find(e=>e.field==='gallons').value,15000000);assert.match(j.result.warnings.join(' '),/verification/);
});
test('provider errors and persistently incomplete responses remain visible job failures',async t=>{
 for(const response of [()=>Response.json({},{status:401}),()=>Response.json({stop_reason:'max_tokens'}),()=>Response.json({content:[{type:'text',text:'invalid JSON'}]})]){
  const f=await fixture(t,{fetchImpl:async()=>response()});const j=await f.job(await f.post(packet()));assert.equal(j.state,'failed');assert.equal(typeof j.error,'string');assert.doesNotMatch(j.error,/Split the packet|Try a smaller packet/);
 }
});
test('179k-character workbook with 99 retained rows recovers from output limit automatically',async t=>{
 const sent=[];
 const f=await fixture(t,{fetchImpl:async(_u,o)=>{
  const body=JSON.parse(o.body);sent.push(body);
  if(sent.length===1)return Response.json({stop_reason:'max_tokens',content:[{type:'text',text:'{"sites":['}]});
  return ai(JSON.stringify(body).includes('Independently verify')?verification:{...proposal,sites:Array.from({length:99},(_,i)=>({id:String(i),sourceId:'f1',address:'Unwanted duplicate'})),siteSourceIds:['f1']});
 }});
 const large={...source,name:'99-site seller.xlsx',structuredSiteCount:99,text:source.text+'\n'+Array.from({length:3000},(_,i)=>`A${i+1}=record | B${i+1}=other attributes retained from original workbook`).join('\n')};
 assert.ok(large.text.length>179835);
 const j=await f.job(await f.post({...packet(),deal:{...emptyDeal(),sites:99},files:[large]}));
 assert.equal(j.state,'complete');assert.equal(j.result.deal.sites,99);assert.equal(j.result.deal.gallons,15000000);assert.equal(j.result.deal.fuelCpg,35);assert.equal(j.result.deal.commission,null);
 assert.equal(j.result.sites.length,0);assert.equal(j.result.summary,proposal.summary);assert.equal(sent.length,9);
 for(const call of sent){const body=JSON.stringify(call);assert.match(body,/STRUCTURED SITE ROWS ALREADY RETAINED: 99/);assert.ok(body.includes('record | B3000=other attributes'));}
 assert.match(sent[0].messages[0].content[0].text,/NEVER reproduce individual site rows/);
 const batchPrompts=sent.slice(2,6).map(c=>c.messages[0].content[0].text);
 for(const field of fields)assert.equal(batchPrompts.filter(p=>p.includes(field.key+': '+field.label)).length,1);
});
test('malformed full extraction retries bounded batches, but unverified figures stay blank',async t=>{
 let n=0;const f=await fixture(t,{fetchImpl:async(_u,o)=>{
  const b=JSON.parse(o.body);n++;
  if(n===1)return Response.json({content:[{type:'text',text:'{"deal":'}]});
  return ai(JSON.stringify(b).includes('Independently verify')?{...verification,approvedFields:[]}:proposal);
 }});
 const j=await f.job(await f.post(packet()));assert.equal(j.state,'complete');assert.equal(j.result.deal.gallons,null);assert.equal(j.result.evidence.find(e=>e.field==='gallons').value,15000000);assert.equal(n,9);
});
test('verification output limit is automatically retried without bypassing approval',async t=>{
 let n=0;const f=await fixture(t,{fetchImpl:async()=>{
  n++;if(n===2)return Response.json({stop_reason:'max_tokens'});return ai(n===1?proposal:verification);
 }});
 const j=await f.job(await f.post(packet()));assert.equal(j.state,'complete');assert.equal(n,8);assert.equal(j.result.deal.gallons,15000000);assert.equal(j.result.verified,true);
});
test('standalone Deal Desk credentials work without any AI Council configuration',async t=>{
 let n=0;const f=await fixture(t,{env:{DEAL_DESK_PASSWORD:'test-code',DEAL_DESK_API_KEY:'desk-test-key',DEAL_DESK_MODEL:'desk-model'},fetchImpl:async(_u,o)=>{
  assert.equal(o.headers['x-api-key'],'desk-test-key');assert.equal(JSON.parse(o.body).model,'desk-model');return ai(++n===1?proposal:verification);
 }});
 assert.equal((await(await f.request('/api/deal-desk/status')).json()).ready,true);
 const j=await f.job(await f.post(packet()));assert.equal(j.state,'complete');assert.equal(j.result.deal.gallons,15000000);
});
test('unstructured site extraction reduces overflowing batches and retains every returned attribute',async()=>{
 const requests=[];const rows=Array.from({length:9},(_,i)=>({id:String(i+1),address:`${i+1} Main St`,sourceId:'f1',locator:`row ${i+1}`,raw:{'Original custom column':'value-'+(i+1)}}));
 const result=await extractSitePages({sources:[source],sourceIds:['f1'],sourceContent:()=>[],phase:()=>{},ask:async(messages)=>{
  const text=messages[0].content[0].text;requests.push(text);
  if(requests.length===1)return {stop_reason:'max_tokens'};
  const second=requests.length===2;return {content:[{type:'text',text:JSON.stringify({sites:second?rows.slice(0,7):rows.slice(7),hasMore:second,nextCursor:second?'row 7':''})}]};
 }});
 assert.equal(result.sites.length,9);assert.equal(result.sites[8].raw['Original custom column'],'value-9');assert.deepEqual(result.warnings,[]);assert.match(requests[1],/at most 7 records/);assert.match(requests[2],/AFTER locator "row 7"/);
});
test('site extraction stalls are visible, never claimed as a complete perimeter',async()=>{
 const result=await extractSitePages({sources:[source],sourceIds:['f1'],sourceContent:()=>[],phase:()=>{},ask:async()=>({content:[{type:'text',text:JSON.stringify({sites:[],hasMore:true,nextCursor:''})}]})});
 assert.match(result.warnings.join(' '),/incomplete/);
});
test('PDFs sent as native documents in both passes, images cannot be text-verified',async t=>{
 const calls=[];const f=await fixture(t,{fetchImpl:async(_u,o)=>{calls.push(JSON.parse(o.body));return ai(calls.length===1?proposal:verification);}});
 const pdf={...source,kind:'pdf',data:Buffer.from('%PDF-1.4 fixture').toString('base64'),pages:2};
 const j=await f.job(await f.post({...packet(),files:[pdf]}));assert.equal(j.state,'complete');
 for(const call of calls)assert.equal(call.messages[0].content.find(x=>x.type==='document').source.media_type,'application/pdf');
 const image={...source,kind:'image',text:''};assert.equal(normalizeReview(proposal,[image],emptyDeal(),verification,'FY2025').deal.gallons,null);
});
test('legacy RTF is converted to text and flagged for layout review',async t=>{
 let sent;let n=0;const f=await fixture(t,{fetchImpl:async(_u,o)=>{sent=sent||JSON.parse(o.body);return ai(++n===1?proposal:verification);}});
 const doc={id:'f1',name:'seller.rtf',kind:'rtf',text:'',data:Buffer.from('{\\rtf1\\ansi Fictional Fuel operates 10 sites.}').toString('base64')};
 const j=await f.job(await f.post({...packet(),files:[doc]}));assert.equal(j.state,'complete');assert.match(JSON.stringify(sent),/Fictional Fuel operates 10 sites/);assert.match(j.result.warnings.join(' '),/RTF/);
});
test('search uses native citations and never sends uploaded private context into search',async t=>{
 const calls=[];const webProposal=JSON.parse(JSON.stringify(proposal).replaceAll('f1','web-1'));
 const f=await fixture(t,{fetchImpl:async(_u,o)=>{const b=JSON.parse(o.body);calls.push(b);if(b.tools)return Response.json({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search',id:'search'},{type:'web_search_tool_result',content:[]},{type:'text',text:'Fictional Fuel operates 10 sites.',citations:[{type:'web_search_result_location',url:'https://example.com/filing',title:'Official filing',cited_text:source.text}]}]});return ai(calls.length===2?webProposal:verification);}});
 const j=await f.job(await f.request('/api/deal-desk/research',{deal:emptyDeal(),company:'Fictional Fuel',hint:'USA',period:'FY2025',notes:'PRIVATE-SELLER-TERM',files:[source]}));
 assert.equal(j.state,'complete');assert.equal(j.result.searchUsed,true);assert.equal(j.result.deal.gallons,15000000);assert.equal(j.result.sources[0].url,'https://example.com/filing');assert.doesNotMatch(JSON.stringify(calls[0]),/PRIVATE-SELLER-TERM|15 million/);
});
test('search without actual tool use or with tool error cannot claim success',async t=>{
 for(const content of [[{type:'text',text:'I searched'}],[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'unavailable'}}]]){
  const f=await fixture(t,{fetchImpl:async()=>Response.json({content})});const j=await f.job(await f.request('/api/deal-desk/research',{deal:emptyDeal(),company:'Fictional Fuel'}));assert.equal(j.state,'failed');
 }
});
test('researching a different company cannot reuse the previous company financials',async t=>{
 const f=await fixture(t,{fetchImpl:async(_u,o)=>{const b=JSON.parse(o.body);if(b.tools)return Response.json({content:[{type:'server_tool_use',name:'web_search'},{type:'text',text:'Fictional Fuel operates 10 sites.',citations:[{url:'https://example.com/filing',title:'Company',cited_text:source.text}]}]});return ai(JSON.stringify(b).includes('Independently verify')?verification:JSON.parse(JSON.stringify(proposal).replaceAll('f1','web-1')));}});
 const j=await f.job(await f.request('/api/deal-desk/research',{deal:exampleDeal(),company:'Fictional Fuel',period:'FY2025'}));assert.equal(j.state,'complete');assert.equal(j.result.deal.price,null);assert.equal(j.result.deal.commission,null);assert.equal(j.result.deal.sites,10);
});
test('invalid inputs, too many sources, oversized text and wrong origin are blocked',async t=>{
 let calls=0;const f=await fixture(t,{fetchImpl:async()=>{calls++;return ai(proposal);}});
 for(const p of [{...packet(),deal:{gallons:'bad'}},{...packet(),files:Array(101).fill(source)},{...packet(),notes:'x'.repeat(31000)}])assert.equal((await f.post(p)).status,400);
 assert.equal((await f.post(packet(),{origin:'https://example.invalid'})).status,403);
 const j=await f.job(await f.post({...packet(),files:[{...source,text:'x'.repeat(650001)}]}));assert.equal(j.state,'failed');assert.equal(calls,0);
});
test('PDF summary exports company analysis without workbook audit directions',async t=>{
 const f=await fixture(t);const response=await f.request('/api/deal-desk/summary',{deal:exampleDeal(),review:proposal,period:'FY2025'});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/pdf/);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
});
test('partial conversion count is valid before total site count is known',()=>{assert.equal(validateImport({convertSites:3}).convertSites,3);assert.throws(()=>validateImport({sites:2,convertSites:3}));});
test('site totals require complete perimeter, consistent period, no duplicates and preserve extra columns',()=>{
 const header=['Site ID','Address','City','Period','Annual Gallons','Fuel Margin CPG','Annual Inside Gross Profit','Custom'];
 const rows=[header,['1','1 Main St','A','FY2025',100,20,1000,'retain-a'],['2','2 Main St','A','FY2025',300,40,2000,'retain-b']];
 const sites=mergeSites([sitesFromRows(rows,'file1','Sheet1')]);assert.equal(sites.length,2);assert.equal(sites[1].raw.Custom,'retain-b');
 assert.deepEqual(aggregateSites(sites,'FY2025',false),{});assert.deepEqual(aggregateSites(sites,'FY2024',true),{sites:2});
 assert.deepEqual(aggregateSites(sites,'FY2025',true),{sites:2,gallons:400,insideGp:3000,fuelCpg:35});
 const duplicate=mergeSites([sites,[{...sites[0],id:'copy'}]]);assert.equal(duplicate.length,3);assert.equal(duplicate.filter(s=>s.duplicate).length,2);assert.deepEqual(aggregateSites(duplicate,'FY2025',true),{});
 assert.deepEqual(aggregateSites([{...sites[0],reviewRequired:true}],'FY2025',true),{});
});
test('workbook schedules join explicit store identities and exclude totals without losing source columns',()=>{
 const header=['Store #','Address','City','State','ZIP','Custom'];
 const rows=[header,['1301','7209 E Grand Ave','Lonsdale','AR','72087','roster'],[32,'Total Stores'],[32,'Totals']];
 const roster=sitesFromRows(rows,'workbook','Roster');
 const performance=sitesFromRows([header,['1301','7209 E Grand Ave','Lonsdale','AR','72087','performance']],'workbook','Performance');
 assert.equal(roster.length,1);
 const joined=consolidateWorkbookSites([...roster,...performance]);
 assert.equal(joined.length,1);assert.equal(joined[0].id,'1301');
 assert.equal(joined[0].raw['Roster / Custom'],'roster');
 assert.equal(joined[0].raw['Performance / Custom'],'performance');
 assert.equal(consolidateWorkbookSites([...roster,...roster]).length,2);
 assert.equal(consolidateWorkbookSites([...roster,{...performance[0],id:'1302'}]).length,2);
 assert.equal(consolidateWorkbookSites([...roster,{...performance[0],sourceId:'another-file'}]).length,2);
});
