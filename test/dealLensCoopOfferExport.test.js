import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness({offer=9089579,irr=.13}={}) {
  const files=new Map([
    ['xl/worksheets/sheet1.xml','<worksheet><c r="B29" s="1"><v>-9500000</v></c><c r="B38" s="2"><f>IRR(B37:Q37)</f><v>0.12</v></c></worksheet>'],
    ['xl/worksheets/sheet2.xml','<worksheet><c r="A1"><v>123</v></c></worksheet>'],
    ['xl/workbook.xml','<workbook><calcPr calcId="42"/></workbook>']
  ]);
  const zip={
    file(name,value) {
      if(value!==undefined){files.set(name,value);return this;}
      return files.has(name)?{async:async()=>files.get(name)}:null;
    },
    remove(name){files.delete(name);},
    generateAsync:async()=>({files})
  };
  const changes={'COOP!B29':-9500000};
  let computePrice;
  const ctx=vm.createContext({
    JSZip:{loadAsync:async()=>zip},
    OriginalModel:{
      calculate:()=>({changes,result:{engine:{snapshot:()=>({'COOP!B29':-9500000,'COOP!B38':.12})},returnCases:{B38:{maxPrice:offer}}}}),
      compute:overrides=>{
        computePrice=-overrides['COOP!B29'];
        return {get:(sheet,cell)=>cell==='B38'?irr:null,snapshot:()=>({'COOP!B29':-computePrice,'COOP!B38':irr})};
      },
      data:{allowed:{COOP:['B29']},sheetPaths:{COOP:'xl/worksheets/sheet1.xml'}}
    }
  });
  vm.runInContext(fs.readFileSync('public/deal-lens/original-export.js','utf8'),ctx);
  return {ctx,files,get price(){return computePrice;}};
}

test('download retains original workbook and solves COOP!B29 for 13.0% buyer B38, not seller ask',async()=>{
  const h=harness();
  await h.ctx.OriginalModelExport.make({},new Uint8Array([1]));
  assert.equal(h.price,9089579);
  const xml=h.files.get('xl/worksheets/sheet1.xml');
  assert.match(xml,/<c r="B29"[^>]*><v>-9089579<\/v><\/c>/);
  assert.match(xml,/<c r="B38"[^>]*><f>IRR\(B37:Q37\)<\/f><v>0.13<\/v><\/c>/);
  assert.match(h.files.get('xl/worksheets/sheet2.xml'),/<v>123<\/v>/);
  assert.match(h.files.get('xl/workbook.xml'),/fullCalcOnLoad="1" forceFullCalc="1"/);
});

test('download refuses unsolved or unverified 13% COOP workbook instead of a misleading file',async()=>{
  for(const params of [{offer:null},{offer:9089579,irr:.11}]) {
    const h=harness(params);
    await assert.rejects(h.ctx.OriginalModelExport.make({},new Uint8Array([1])),/Cannot solve an offer|verification failed/i);
    assert.equal(h.files.get('xl/worksheets/sheet1.xml').includes('-9500000'),true);
  }
});
