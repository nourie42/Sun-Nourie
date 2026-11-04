import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script=name=>fs.readFileSync('public/deal-lens/'+name,'utf8');
function harness(){
  const ctx=vm.createContext({Intl,Date,Blob,Uint8Array,console,setTimeout:()=>0});
  ctx.window=ctx;
  ctx.DealIntake={facts:d=>d.reportedFacts||[],materials:d=>d.materials||[]};
  ctx.OriginalModel={compute:changes=>({get:(sheet,cell)=>cell==='B38'?.13:cell==='B37'?-59000000:cell==='C22'?7000000:0})};
  vm.runInContext(script('leadership-report.js'),ctx);
  const deal={
    fields:{name:'Example ten sites',thesis:'Acquire fuel locations in the region.',recommendation:'Pursue',fuelDistributor:'Multiple',fuelUnams:'',whyUs:'Better supply economics'},
    sites:[{name:'Market A',address:'100 Main St'},{name:'Market B',address:'200 Main St'}],
    fuelContracts:[
      {site:'Market A',distributor:'Distributor One',expiration:'2028-12-31',gallons:'1.2m',unams:'50000',rights:'Assignment subject to consent'},
      {site:'Market A',distributor:'Distributor Two',expiration:'2030-08-15',gallons:'200k',unams:'10000'},
      {site:'Market B',distributor:'Distributor Two',expiration:'',gallons:'750k',unams:''}
    ],
    reportedFacts:[{key:'sellerGrossProfitUsd',value:1800000,source:'FY2025 P&L',period:'FY2025',scope:'portfolio'}],
    aiReview:{
      industryFlags:[{metric:'Fuel margin',dealValue:'50 cpg',benchmark:'39.7 cpg',source:'https://www.convenience.org/topics/fuels-and-energy/the-us-petroleum-industry-statistics-definitions',year:'2025',flag:'Outside norm - high',comparable:'Retail to retail'}],
      diligence:[{category:'Fuel',issue:'Need signed contract',needed:'Full contract',priority:'High',status:'Open',source:'Seller'}],
      concerns:['Margin allocation unclear'],missing:['Tank environmental reports outstanding']
    },
    evidence:{fuel:{status:'open'}},gates:{},tasks:{},materials:[{name:'FY2025 statement',state:'Extracted'}]
  };
  const model={result:{returnCases:{B38:{maxPrice:56227662}},years:[{fuel:230000,insideBenefit:88000,savings:120000,ebitda:7780958}]},changes:{'COOP!B29':-55000000},items:{price:{status:'document'},fuelBenefit:{value:2,status:'estimated',basis:'Unverified uplift'}},inputs:{price:55000000,sites:2,base:7200000},estimated:1};
  return {ctx,deal,model};
}
test('complete leadership report has buyer offer before seller ask, source figures, multiple distributors and separate expiration dates',()=>{
  const {ctx,deal,model}=harness(),r=ctx.DealLeadershipReport.collect(deal,model,{evidence:[{id:'fuel',title:'Fuel rights',hint:'Signed contract'}],gates:[],phases:[]});
  assert.match(r.kpis[0].label,/our coop offer/i);
  assert.match(r.kpis[0].value,/56,227,662/);
  assert.equal(r.kpis[1].value,'13.0%');
  const text=r.sections.flatMap(x=>x.rows.map(v=>v.label+' '+v.value)).join('\n');
  assert.match(text,/Distributor One/);assert.match(text,/Distributor Two/);
  assert.match(text,/2028-12-31/);assert.match(text,/2030-08-15/);
  assert.match(text,/FY2025 P&L/);assert.match(text,/Need signed contract/);
  assert.match(text,/Tank environmental reports outstanding/);assert.match(text,/Fuel rights/);
  assert.match(text,/Fuel margin/);assert.match(text,/Unverified uplift/);
  assert.match(ctx.DealLeadershipReport.html(r),/LEADERSHIP SUMMARY/);
});
test('download creates one multipage PDF from the same full leadership sections',async()=>{
  const {ctx,deal,model}=harness();
  let saved=false,clicked=false,drawn=[],pages=0;
  const font={widthOfTextAtSize:(s,size)=>s.length*size*.49};
  ctx.PDFLib={StandardFonts:{Helvetica:'regular',HelveticaBold:'bold'},rgb:()=>({}),
    PDFDocument:{create:async()=>({embedFont:async()=>font,
      addPage:()=>{pages++;return {drawText:(s)=>drawn.push(s),drawLine:()=>{}};},
      save:async()=>{saved=true;return Uint8Array.from([37,80,68,70,45,49,46,55]);}
    })}};
  ctx.URL={createObjectURL:()=> 'blob:pdf',revokeObjectURL:()=>{}};
  ctx.document={createElement:()=>({click(){clicked=true;}})};
  await ctx.DealLeadershipReport.downloadPdf(ctx.DealLeadershipReport.collect(deal,model,{evidence:[],gates:[],phases:[]}));
  assert.ok(saved&&clicked&&pages>=1);
  assert.ok(drawn.some(s=>s.includes('Distributor One')));
  assert.ok(drawn.some(s=>s.includes('13.0%')));
});
test('pasted AI Markdown reads contract, benchmark and diligence tables independently',()=>{
  const ctx=vm.createContext({OriginalModel:{definitions:[]},DealRoster:{read:()=>[],counts:()=>({sites:0,assets:0})},DealPaste:{number:Number}});ctx.window=ctx;
  vm.runInContext(script('plain-intake.js'),ctx);
  const data=[
    'Deal name: Sample fuel acquisition',
    'SITE SUPPLY CONTRACTS',
    '| Site | Distributor | Supplier | Brand | Terminal | Expiration | Remaining | Gallons | UNAMs | Pricing | Rights | Source | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| Site A | Distributor 1 | Supplier X | BP | Terminal A | 2028-09-15 | 22 months | 1200000 | $50000 | Rack plus | Consent | Contract p2 | |',
    '| Site A | Distributor 2 | Supplier Y | Shell | Terminal B | 2030-01-01 | 38 months | 250000 | Not provided | Rebate | ROFR | Contract p3 | |',
    '',
    'INDUSTRY BENCHMARKS AND OUTLIERS',
    '| Metric | Deal value | Benchmark | Comparison | Year | Source | Flag | Basis |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| Retail gross margin | 55 cpg | 39.7 cpg | 15.3 cpg above | 2025 | https://example.org/nacs | Outside norm - high | Comparable fuel retail |',
    '',
    'DUE DILIGENCE AND MISSING INFORMATION',
    '| Category | Issue | Needed | Owner | Status | Priority | Source |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Fuel | Missing consent | Executed agreement | Seller | Open | High | Contract |'
  ].join('\n');
  const out=ctx.DealPlain.parse(data);
  assert.equal(out.contractRows.length,2);
  assert.equal(out.contractRows[0].expiration,'2028-09-15');
  assert.equal(out.contractRows[1].distributor,'Distributor 2');
  assert.equal(out.industryFlags.length,1);
  assert.equal(out.diligence.length,1);
});
