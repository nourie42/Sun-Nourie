import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {readModelFile,isModelConfigured} from '../src/dealLensModelAssets.js';
const modelAvailable=isModelConfigured(),workbookTest=modelAvailable?test:test.skip;

// Simple COOP export and one-page PDF. Synthetic checks run everywhere; the
// RomeoTest baseline runs where the mounted workbook is available.
const vendor=name=>{const exports={},c=vm.createContext({module:{exports},exports,Blob,Buffer,Uint8Array,setImmediate,clearImmediate,setTimeout,clearTimeout,TextEncoder,TextDecoder});vm.runInContext(fs.readFileSync('public/deal-lens/vendor/'+name,'utf8'),c);return c.module.exports;};
const ctx=vm.createContext({JSZip:vendor('jszip.min.js'),Blob,console,TextEncoder,TextDecoder,setTimeout,clearTimeout});ctx.self=ctx;
// pdf-lib checks arrays with instanceof, so it shares the page's realm as in the browser.
vm.runInContext(fs.readFileSync('public/deal-lens/vendor/pdf-lib.min.js','utf8'),ctx);
for(const name of ['model.js','original-engine.js','coop-simple.js'])vm.runInContext(fs.readFileSync('public/deal-lens/'+name,'utf8'),ctx);
const html=fs.readFileSync('public/deal-lens/model-tool.html','utf8');
vm.runInContext(html.slice(html.indexOf('// ===== ENGINE START'),html.indexOf('// ===== ENGINE END'))+';globalThis.runChannel=runChannel;globalThis.priceForIRR=priceForIRR;',ctx);

// Deal Model Tool example inputs, in its engine's sign convention.
const tool={n:10,gallons:12e6,volg:.99,cpg:20,cpgg:0,fsyn:2,inside:9e6,insg:.02,inmar:.3,inssyn:.01,other:3e5,otherg:.02,opex:-3.6e6,opexg:.025,opsyn:.05,draw:-1000,drawRefund:1,field:-15000,rent:-5e5,rentg:.02,rentInc:5e5,rentIncg:.02,it:-15000,maintY1:-10000,maintOn:-20000,tank:-60000,growthSites:1,tax:.25,wc:20000,wcDays:7,price:8.4e6,unams:1e5,closing:.02,exit:6,renewals:Array(15).fill(0)};
const simple=p=>({name:'Synthetic',sites:p.n,gallons:p.gallons,volumeRate:p.volg,cpg:p.cpg,cpgGrowth:p.cpgg,fuelSynergyCpg:p.fsyn,inside:p.inside,insideGrowth:p.insg,insideMargin:p.inmar,insideSynergy:p.inssyn,other:p.other,otherGrowth:p.otherg,opex:p.opex,opexGrowth:p.opexg,opexSynergy:p.opsyn,drawPerSite:p.draw,addBackDraw:!!p.drawRefund,fieldPerSite:p.field,rent:p.rent,rentGrowth:p.rentg,itPerSite:p.it,maintYear1PerSite:p.maintY1,maintPerSite:p.maintOn,tank:Array.from({length:15},(_,i)=>i===10||i===13?p.tank*p.n:0),laterGrowthCapital:[],growthSites:p.growthSites,taxRate:p.tax,wcPerSite:p.wc,price:p.price,unams:p.unams,closingRate:p.closing,exitMultiple:p.exit,target:.13});

test('simple COOP model matches the Deal Model Tool COOP engine, including the price at target',()=>{
  const m=ctx.CoopSimple.calculate(simple(tool)),o=ctx.runChannel('COOP',tool);
  m.flows.forEach((v,i)=>assert.ok(Math.abs(v-o.cf[i])<.01,'year '+i));
  assert.ok(Math.abs(m.irr-o.irr)<1e-9);assert.ok(Math.abs(m.leaseIrr-o.coop.leaseIrr)<1e-9);assert.ok(Math.abs(m.npv15-o.npv)<.01);
  assert.ok(Math.abs(m.priceAtTarget-ctx.priceForIRR('COOP',tool,.13))<1);
  assert.equal(Object.values(m.cells).filter(c=>c.f&&typeof c.v!=='number').length,0,'every formula has a calculated value');
});

test('draw add-back and tank years follow the inputs',()=>{
  const off=ctx.CoopSimple.calculate(simple({...tool,drawRefund:0})),on=ctx.CoopSimple.calculate(simple(tool));
  assert.equal(on.cells.C29.f,'=-C18');assert.equal(off.cells.C29.v,0);assert.ok(Math.abs(on.flows[1]-off.flows[1]-10000)<.01);
  assert.equal(on.cells.M25.v,-600000);assert.equal(on.cells.P25.v,-600000);assert.equal(on.cells.L25.v,0);
  assert.match(html,/Tank work, per site, years 11 and 14/);
});

test('workbook export is a valid one-tab COOP model with live formulas and cached values',async()=>{
  const m=ctx.CoopSimple.calculate(simple(tool)),files=ctx.CoopSimple.workbookFiles(m,{name:'Synthetic'});
  const sheet=files['xl/worksheets/sheet1.xml'];
  assert.match(files['xl/workbook.xml'],/<sheet name="COOP"[^>]*\/><sheet name="About"/);assert.match(files['xl/workbook.xml'],/fullCalcOnLoad="1"/);
  assert.match(sheet,/<c r="B34" s="\d+"><f>IRR\(B32:Q32\)<\/f><v>0\.\d+<\/v><\/c>/);
  assert.match(sheet,/<c r="C27" s="\d+"><f>IF\(\(C22-C3\*0\.12\+\$B\$29\/15\)\*-\$S\$27&gt;0,0,/);
  assert.ok((sheet.match(/<f>/g)||[]).length>350);
  const blob=await ctx.CoopSimple.workbook(m,{name:'Synthetic'}),bytes=Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.subarray(0,2).toString(),'PK');
});

test('deal summary PDF is a single page and survives symbols the standard fonts lack',async()=>{
  const m=ctx.CoopSimple.calculate(simple(tool));
  const blob=await ctx.CoopSimple.pdf(m,{name:'Deal → “Oak” − test',subtitle:'10 sites · Raleigh',recommendation:'Pursue',notes:[['Thesis','A long thesis '.repeat(40)]],table:{title:'Channels',head:['Channel','IRR'],rows:[['COOP','11.4%']]}});
  const bytes=Buffer.from(await blob.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const doc=await ctx.PDFLib.PDFDocument.load(vm.runInContext('b=>new Uint8Array(b)',ctx)(bytes));assert.equal(doc.getPageCount(),1);
});

test('price at target is reported as unsolvable instead of a wrong number when no price works',()=>{
  const m=ctx.CoopSimple.calculate(simple({...tool,opex:-2e7}));
  assert.equal(m.priceAtTarget,null);assert.equal(m.cells.B50.v,'Not solvable');
});

workbookTest('RomeoTest baseline: the simple COOP model reproduces the original workbook B34/B38 and 13% prices',()=>{
  const c=vm.createContext({console});for(const name of ['model.js','original-engine.js','coop-simple.js'])vm.runInContext(fs.readFileSync('public/deal-lens/'+name,'utf8'),c);
  vm.runInContext(readModelFile('original-model-data.js').toString('utf8'),c);
  const e=c.OriginalFormulaEngine.create(c.OriginalModelData)({}),g=a=>e.get('COOP',a)||0,years='CDEFGHIJKLMNOPQ'.split('');
  const p={sites:g('C2'),gallons:g('C3'),volumeRate:g('S3'),cpg:g('C4'),cpgGrowth:g('S4'),fuelSynergyCpg:g('S6'),inside:g('C9'),insideGrowth:g('S9'),insideMargin:g('C10'),insideSynergy:g('S12'),other:g('C14'),otherGrowth:g('S14'),opex:g('C16'),opexGrowth:g('S16'),opexSynergy:g('S17'),drawPerSite:g('S18'),addBackDraw:true,fieldPerSite:g('S19'),rent:g('C21'),rentGrowth:g('S21'),itPerSite:g('S23'),maintYear1PerSite:g('C24')/g('C2'),maintPerSite:g('S24'),tank:years.map(k=>g(k+'25')),laterGrowthCapital:years.slice(1).map(k=>g(k+'26')),growthSites:g('S26'),taxRate:g('S27'),wcPerSite:g('S28'),price:-g('B29'),unams:-g('B30'),closingRate:g('B31')/g('B29'),exitMultiple:g('S29'),target:.13};
  const m=c.CoopSimple.calculate(p);
  ['B',...years].forEach((k,i)=>{assert.ok(Math.abs(m.flows[i]-g(k+'32'))<.01);assert.ok(Math.abs(m.leaseFlows[i]-g(k+'37'))<.01);});
  assert.ok(Math.abs(m.irr-.12907539318104147)<1e-9);assert.ok(Math.abs(m.leaseIrr-.12385118830143052)<1e-9);
  assert.ok(Math.abs(m.priceAtTarget-9443626.66)<1);assert.ok(Math.abs(m.leasePriceAtTarget-9089578.75)<1);
});
