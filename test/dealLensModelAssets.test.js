import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {readModelFile,isModelConfigured} from '../src/dealLensModelAssets.js';

test('mounted workbook loads byte-for-byte without any model key',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deal-lens-package-')),previous=process.env.DEAL_LENS_MODEL_FILE;
 t.after(()=>{if(previous===undefined)delete process.env.DEAL_LENS_MODEL_FILE;else process.env.DEAL_LENS_MODEL_FILE=previous;fs.rmSync(dir,{recursive:true,force:true});});
 const workbook=Buffer.from('PK synthetic workbook bytes'),manifest='globalThis.OriginalModelData={synthetic:true};';
 process.env.DEAL_LENS_MODEL_FILE=path.join(dir,'model.bundle');
 fs.writeFileSync(process.env.DEAL_LENS_MODEL_FILE,gzipSync(JSON.stringify({version:1,workbookBase64:workbook.toString('base64'),manifest})).toString('base64'));
 assert.equal(isModelConfigured(),true);assert.deepEqual(readModelFile('original-model.xlsx'),workbook);assert.equal(readModelFile('original-model-data.js').toString(),manifest);
 assert.throws(()=>readModelFile('../unrelated-file'),/Unknown model asset/);
 process.env.DEAL_LENS_MODEL_FILE=path.join(dir,'missing.bundle');assert.equal(isModelConfigured(),false);
 process.env.DEAL_LENS_MODEL_FILE=path.join(dir,'invalid.bundle');fs.writeFileSync(process.env.DEAL_LENS_MODEL_FILE,'invalid');assert.equal(isModelConfigured(),false);
});
