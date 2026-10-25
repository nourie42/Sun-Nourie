import {test as nodeTest} from 'node:test';import {readModelFile,isModelConfigured} from '../src/dealLensModelAssets.js';
const modelAvailable=isModelConfigured(),test=modelAvailable?nodeTest:nodeTest.skip;import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
const zipContext=vm.createContext({module:{exports:{}},exports:{},Blob,Buffer,Uint8Array,setImmediate,clearImmediate,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync('public/deal-lens/vendor/jszip.min.js','utf8'),zipContext);const JSZip=zipContext.module.exports;
const ctx=vm.createContext({JSZip,Blob,Intl,console});ctx.window=ctx;
if(modelAvailable)for(const name of ['intake-state.js','model.js','original-model-data.js','original-engine.js','original-model.js','original-export.js'])vm.runInContext(name==='original-model-data.js'?readModelFile(name).toString('utf8'):fs.readFileSync('public/deal-lens/'+name,'utf8'),ctx);
const template=modelAvailable?readModelFile('original-model.xlsx'):null,data=ctx.OriginalModelData;
const fixture={id:'original-export',fields:{name:'Original workbook test'},originalInputs:{price:'8m'},aiReview:{facts:[{key:'sites',value:3,scope:'portfolio',source:'photo.jpg'},{key:'gallons',value:6,scope:'portfolio',source:'photo.jpg',confidence:'low'},{key:'sellerGrossProfitUsd',value:4500000,scope:'portfolio',source:'photo.jpg',confidence:'low'},{key:'sellerExpensesUsd',value:3000000,scope:'portfolio',source:'photo.jpg',confidence:'low'}]}};
const cells=xml=>new Map([...xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(m=>[m[1].match(/\br="([^"]+)"/)[1],{attrs:m[1],body:m[2]||'',formula:m[2]?.match(/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/)?.[0]||''}]));
test('original model baseline reproduces all affected cached calculations',()=>{
 const changes={};for(const s of ctx.OriginalModel.definitions)changes['COOP!'+s.cell]=data.sheets.COOP[s.cell]?.v??0;
 const snap=ctx.OriginalModel.compute(changes).snapshot();let count=0;
 for(const [key,value] of Object.entries(snap)){const p=key.lastIndexOf('!'),old=data.sheets[key.slice(0,p)]?.[key.slice(p+1)]?.v;if(typeof old==='number'&&typeof value==='number'){assert.ok(Math.abs(value-old)<.0001,key+' differs');count++;}}
 assert.ok(count>1300);
});
test('download preserves original 22 tabs, every non-input formula, styles and unrelated cells',async()=>{
 const model=ctx.OriginalModel.calculate(fixture);assert.ok(model.result);assert.equal(model.result.engine.get('DODO','B31'),'#VALUE!');const blob=await ctx.OriginalModelExport.make(fixture,template),zip=await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer())),original=await JSZip.loadAsync(template);
 const changedPaths=new Set(Object.keys(model.result.engine.snapshot()).map(k=>data.sheetPaths[k.slice(0,k.lastIndexOf('!'))]));let formulas=0,unchanged=0;
 for(const name of Object.keys(original.files).filter(n=>!original.files[n].dir)){
  if(name==='xl/calcChain.xml')continue;assert.ok(zip.file(name),'Missing original part '+name);
  const old=await original.file(name).async('string'),next=await zip.file(name).async('string');
  if(changedPaths.has(name)){
   const sheet=Object.keys(data.sheetPaths).find(s=>data.sheetPaths[s]===name),a=cells(old),b=cells(next);assert.deepEqual([...b.keys()],[...a.keys()],'Cell removed or inserted');
   for(const [cell,item] of a){const after=b.get(cell),input=Object.hasOwn(model.changes,sheet+'!'+cell);if(input){assert.ok(data.allowed[sheet].includes(cell));continue;}
    assert.equal(after.formula,item.formula,sheet+'!'+cell+' formula changed');if(item.formula)formulas++;
    assert.equal(after.attrs.replace(/\s+t="[^"]*"/,''),item.attrs.replace(/\s+t="[^"]*"/,''),sheet+'!'+cell+' style changed');
    if(!item.formula){assert.equal(after.body,item.body,sheet+'!'+cell+' value changed');unchanged++;}
   }
  }else if(!['xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml'].includes(name))assert.equal(next,old,'Original part changed: '+name);
 }
 const workbook=await zip.file('xl/workbook.xml').async('string');assert.equal([...workbook.matchAll(/<sheet\s/g)].length,22);assert.ok(formulas>1500);assert.ok(unchanged>200);
 const coop=await zip.file(data.sheetPaths.COOP).async('string'),originalCoop=await original.file(data.sheetPaths.COOP).async('string');assert.match(cells(coop).get('B29').body,/<v>-8000000<\/v>/);assert.equal(cells(coop).get('M25').body,cells(originalCoop).get('M25').body);assert.match(coop,/\$S\$14/);
});
test('empty models cannot download; uncertain source asks retain exact units and visible estimates',async()=>{
 await assert.rejects(()=>ctx.OriginalModelExport.make({fields:{}},template),/No empty model/);
 const d={fields:{},aiReview:{facts:[{key:'ask',value:73,confidence:'low',scope:'portfolio',source:'x.jpg'},{key:'sellerEbitdaUsd',value:10000000,scope:'portfolio',source:'x.jpg'}]}};
 const m=ctx.OriginalModel.calculate(d);assert.equal(m.items.price.value,73000000);assert.equal(m.items.price.status,'estimated');assert.ok(m.result);
 assert.equal(ctx.OriginalModel.calculate({...fixture,originalInputs:{price:'350k'}}).changes['COOP!B29'],-350000);
});
