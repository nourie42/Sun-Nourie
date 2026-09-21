import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,registerHooks} from 'node:module';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../deal-desk/package.json',import.meta.url));
const ts=require('typescript'),XLSX=require('xlsx'),JSZip=require('jszip');
const {JSDOM}=await import(pathToFileURL(require.resolve('jsdom')).href);
const window=new JSDOM('').window;
globalThis.DOMParser=window.DOMParser;globalThis.XMLSerializer=window.XMLSerializer;
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.includes('/deal-desk/lib/')&&!/\.[a-z]+$/i.test(specifier)){const url=new URL(specifier+'.ts',context.parentURL);if(fs.existsSync(url))return {url:url.href,shortCircuit:true};}return next(specifier,context);},load(url,context,next){if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText};if(url.endsWith('/model-template.json'))return {format:'module',shortCircuit:true,source:'export default '+fs.readFileSync(fileURLToPath(url),'utf8')};return next(url,context);}});
const {readSourceFile}=await import('../deal-desk/lib/import.ts');
const {exportModel}=await import('../deal-desk/lib/export.ts');
const {exampleDeal,calculate}=await import('../src/dealDeskModel.js');
const file=(name,data,type='')=>new File([data],name,{type});

test('real binary legacy PowerPoint and slide-show files extract Unicode and ANSI text',async()=>{
 function atom(type,data){const b=Buffer.alloc(8);b.writeUInt16LE(type,2);b.writeUInt32LE(data.length,4);return Buffer.concat([b,data]);}
 const cfb=XLSX.CFB.utils.cfb_new();XLSX.CFB.utils.cfb_add(cfb,'PowerPoint Document',Buffer.concat([atom(4008,Buffer.from('Seller operates 12 sites.')),atom(4000,Buffer.from('Annual gallons 18,000,000; EBITDA $2,400,000','utf16le'))]));const bytes=XLSX.CFB.write(cfb,{type:'buffer'});
 for(const ext of ['ppt','pps','pot']){const s=await readSourceFile(file('seller.'+ext,bytes));assert.match(s.text,/12 sites/);assert.match(s.text,/18,000,000/);assert.match(s.text,/2,400,000/);}
});
test('PowerPoint variants retain slide text, speaker notes and chart values',async()=>{
 const zip=new JSZip();zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a"><a:t>Fuel gallons 15 million</a:t></p:sld>');zip.file('ppt/notesSlides/notesSlide1.xml','<a:r xmlns:a="a"><a:t>FY2025 source notes</a:t></a:r>');zip.file('ppt/charts/chart1.xml','<c:chart xmlns:c="c"><c:v>123456</c:v></c:chart>');const bytes=await zip.generateAsync({type:'uint8array'});
 for(const ext of ['pptx','pptm','ppsx','ppsm','potx','potm','ppt']){const s=await readSourceFile(file('seller.'+ext,bytes));assert.match(s.text,/15 million/);assert.match(s.text,/FY2025 source notes/);assert.match(s.text,/123456/);}
});
test('spreadsheet formats preserve source cells and text files accept real contents',async()=>{
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Sites','Gallons'],[12,18000000]]),'Operating facts');
 for(const ext of ['xlsx','xls','xlsb','ods','csv']){const s=await readSourceFile(file('seller.'+ext,XLSX.write(wb,{bookType:ext,type:'buffer'})));assert.match(s.text,/18000000/);}
 for(const ext of ['txt','json','xml','eml','dat'])assert.match((await readSourceFile(file('seller.'+ext,'Reported gallons: 18000000'))).text,/18000000/);
 await assert.rejects(()=>readSourceFile(file('damaged.ppt',new Uint8Array([0,1,2,3]))),/Cannot extract/);
});
test('Word and OpenDocument variants extract source text',async()=>{
 const doc=new JSZip();doc.file('word/document.xml','<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Reported EBITDA 2400000</w:t></w:r></w:p></w:body></w:document>');
 for(const ext of ['docx','docm','dotx','dotm'])assert.match((await readSourceFile(file('seller.'+ext,await doc.generateAsync({type:'uint8array'})))).text,/2400000/);
 const od=new JSZip();od.file('content.xml','<office:document xmlns:office="office" xmlns:text="text"><text:p>Reported EBITDA 2400000</text:p></office:document>');
 for(const ext of ['odt','odp','ott','otp'])assert.match((await readSourceFile(file('seller.'+ext,await od.generateAsync({type:'uint8array'})))).text,/2400000/);
});
test('custom synergy Excel export carries editable inclusion formulas and matching economics',async()=>{
 const d=exampleDeal();d.customSynergies=[{id:'s',name:'Contract saving',amount:100000,beneficiary:'sunoco',enabled:true,scope:'Corporate',basis:'Two contracts'}, {id:'d',name:'Dealer benefit',amount:50000,beneficiary:'dealer',enabled:true}, {id:'off',name:'Excluded benefit',amount:999999,beneficiary:'sunoco',enabled:false}];
 const blob=await exportModel(d,null,[],'FY2025'),zip=await JSZip.loadAsync(await blob.arrayBuffer()),doc=new DOMParser().parseFromString(await zip.file('xl/worksheets/sheet2.xml').async('string'),'application/xml');
 const value=a=>Number(doc.querySelector(`c[r="${a}"] v`)?.textContent),formula=a=>doc.querySelector(`c[r="${a}"] f`)?.textContent;
 assert.equal(value('B42'),calculate(d).sun);assert.equal(value('B43'),calculate(d).dealer);assert.equal(value('B73'),100000);assert.equal(value('B74'),50000);assert.equal(value('G103'),0);
 assert.match(formula('B42'),/B73/);assert.match(formula('B43'),/B74/);assert.equal(formula('B73'),'SUM(G101:G103)');assert.equal(formula('G101'),'IF(AND(C101="sunoco",E101=1),B101,0)');
 assert.match(await zip.file('xl/worksheets/sheet5.xml').async('string'),/Excluded benefit/);
});
