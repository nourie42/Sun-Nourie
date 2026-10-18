import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {comparisonApp} from '../src/weatherComparison.js';

test('comparison adapter preserves native startup extensions between experience and location',()=>{
  const original=readFileSync('public/weather-fusion/app.js','utf8');
  const extension="\ninstallComparisonStartupProbe();";
  const source=original.replace('\ninstallExperience();','\ninstallExperience();'+extension);
  assert.notEqual(source,original);
  const result=comparisonApp(source,{source:'google',point:{id:'knightdale'},explicitLocation:true});
  assert.match(result,/const compareBridge=installComparisonPane/);
  assert.match(result,/installExperience\(\);\ninstallComparisonStartupProbe\(\);/);
  assert.match(result,/if\(COMPARE.explicitLocation\)chooseLocation\(\{\.\.\.COMPARE.point/);
  if(original.includes('installNativePlayer('))assert.match(result,/installNativePlayer\(\{selectComfortHour\}\);/);
  const file=join(mkdtempSync(join(tmpdir(),'compare-startup-')),'app.mjs');
  writeFileSync(file,result);execFileSync(process.execPath,['--check',file]);
  assert.equal(readFileSync('public/weather-fusion/app.js','utf8'),original);
});
