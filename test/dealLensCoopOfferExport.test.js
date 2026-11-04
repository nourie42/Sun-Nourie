import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness({offer=9089579,irr=.13}={}) {
  const files=new Map([
    ['xl/worksheets/sheet1.xml','<worksheet><c r="B29" s="1"><v>-9500000</v></c><c r="B38" s="2"><f>IRR(B37:Q37)</f><v>0.12</v></c></worksheet>'],
    ['xl/worksheets/sheet2.xml','<worksheet><c r="A1"><v>123</v></c></worksheet>'],
    ['xl/workbook.xml','<workbook><sheets><sheet name="COOP" r:id="rId1"/></sheets><calcPr calcId="42"/></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>']
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


test('export replaces an old master asset roster with current deal site details',async()=>{
  const h=harness();
  h.ctx.OriginalModel.data.sheetPaths['Master Asset Roster']='xl/worksheets/sheet2.xml';
  h.files.set('xl/workbook.xml',h.files.get('xl/workbook.xml').replace('</sheets>','<sheet name="Master Asset Roster" r:id="rId2"/></sheets>'));
  h.files.set('xl/_rels/workbook.xml.rels',h.files.get('xl/_rels/workbook.xml.rels').replace('</Relationships>','<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'));
  h.files.set('xl/worksheets/sheet2.xml','<worksheet><sheetData>'+
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Asset Name</t></is></c>'+
    '<c r="B1" t="inlineStr"><is><t>Address</t></is></c></row>'+
    '<row r="2"><c r="A2" t="inlineStr"><is><t>Romeo old site</t></is></c>'+
    '<c r="B2" t="inlineStr"><is><t>Tallahassee old address</t></is></c></row>'+
    '</sheetData></worksheet>');
  await h.ctx.OriginalModelExport.make({fields:{name:'New deal'},sites:[{name:'New Site',address:'100 Market St, Orlando, FL, 32801'}]},new Uint8Array([1]));
  const xml=h.files.get('xl/worksheets/sheet2.xml');
  assert.match(xml,/New Site/);
  assert.match(xml,/100 Market St/);
  assert.doesNotMatch(xml,/Romeo|Tallahassee/);
});

test('an export with old Romeo project cells elsewhere is blocked rather than misrepresented',async()=>{
  const h=harness();
  h.files.set('xl/worksheets/sheet1.xml',h.files.get('xl/worksheets/sheet1.xml').replace('</worksheet>','<sheetData><row r="99"><c r="A99" t="inlineStr"><is><t>Romeo legacy project</t></is></c></row></sheetData></worksheet>'));
  await assert.rejects(h.ctx.OriginalModelExport.make({fields:{name:'Other Deal'},sites:[]},new Uint8Array([1])),/prior-deal text/i);
});
