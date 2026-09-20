import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
import {fields,calculate,exampleDeal} from '../src/dealDeskModel.js';
const path=process.argv[2]||'/tmp/deal-intake-qa/1440-filled.xlsx';
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(path));
const model=wb.worksheets.getItem('Model');
const cells={seller:'B38',supply:'B39',commission:'B40',costs:'B41',sun:'B42',dealer:'B43',combined:'B44',lift:'B45',systemCostReduction:'B46',investment:'B47',npv:'B48',irr:'B49'};
for(const change of [{},{commission:7},{rent:900000},{maintenanceCapex:0},{lease:null},{lease:0},{sites:0}]){
 const deal={...exampleDeal(),...change};model.getRange('B6:B34').clear({applyTo:'contents'});model.getRange('B6:B34').values=fields.map(f=>[deal[f.key]]);wb.recalculate();
 const expected=calculate(deal);
 for(const [key,address]of Object.entries(cells)){
  const actual=model.getRange(address).values[0][0],want=expected[key];
  if(want===null)assert.ok(actual===null||actual==='',`${JSON.stringify(change)} ${key}: expected blank, got ${actual}; lease=${model.getRange('B21').values[0][0]}, validation=${model.getRange('B36').values[0][0]}`);
  else assert.ok(typeof actual==='number'&&Math.abs(actual-want)<Math.max(.001,Math.abs(want)*1e-7),`${JSON.stringify(change)} ${key}: ${actual} vs ${want}`);
 }
}
model.getRange('B6:B34').values=fields.map(f=>[exampleDeal()[f.key]]);wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:20},maxChars:1000});
console.log(errors.ndjson);
const image=await wb.render({sheetName:'Model',range:'A36:C49',scale:1.5,format:'png'});await fs.writeFile('/tmp/deal-intake-qa/recalculated-model.png',new Uint8Array(await image.arrayBuffer()));
console.log('Independent spreadsheet recalculation agrees with all 12 web outputs across 7 scenarios.');
