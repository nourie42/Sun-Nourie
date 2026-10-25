import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function exporter(fetch,JSZip={loadAsync:async()=>{throw Error('zip parser detail');}}){
  const ctx=vm.createContext({fetch,JSZip,OriginalModel:{calculate:()=>({result:{engine:{snapshot:()=>({})}},errors:[]})}});
  vm.runInContext(fs.readFileSync('public/deal-lens/original-export.js','utf8'),ctx);
  return ctx.OriginalModelExport;
}

test('workbook download gives an actionable error for unavailable and interrupted downloads',async()=>{
  await assert.rejects(()=>exporter(async()=>({ok:false,status:503})).make({}),/original workbook is unavailable/);
  await assert.rejects(()=>exporter(async()=>{throw Error('connection detail');}).make({}),/Check your connection/);
  await assert.rejects(()=>exporter(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)})).make({}),/incomplete or invalid/);
});

test('workbook patch preserves non-input formulas and escapes text safely',()=>{
  const {patchCell}=exporter(),xml='<worksheet><c r="A1" s="4"><f>SUM(B1:C1)</f><v>3</v></c><c r="B1" s="2"/></worksheet>';
  assert.match(patchCell(xml,'A1',5,false),/<c r="A1" s="4"><f>SUM\(B1:C1\)<\/f><v>5<\/v><\/c>/);
  assert.match(patchCell(xml,'A1',5,true),/<c r="A1" s="4"><v>5<\/v><\/c>/);
  assert.match(patchCell(xml,'B1','A&B <x>',true),/<t>A&amp;B &lt;x&gt;<\/t>/);
  assert.throws(()=>patchCell(xml,'A1',Infinity,false),/Nonfinite model value/);
});
