import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';import os from 'node:os';
const fixtureModel=Buffer.from('PK synthetic model test bytes');
import express from 'express';
import { registerDealLensRoutes } from '../src/dealLensRoutes.js';
import { registerWeatherSiteAccess, isProtectedWeatherPath, isPublicWeatherPath } from '../src/weatherSiteAccess.js';

async function fixture(t) {
  const app=express();
  registerWeatherSiteAccess(app,{env:{WEATHER_SITE_PASSWORD:'local-test-password'},secret:'local-test-cookie-secret'});
  const modelKey=crypto.randomBytes(32),modelDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'deal-lens-test-'));
  for(const [name,data] of [['original-model-data.js',Buffer.from('globalThis.OriginalModelData={synthetic:true};')],['original-model.xlsx',fixtureModel]]){
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',modelKey,iv);cipher.setAAD(Buffer.from(name));const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);fs.writeFileSync(path.join(modelDirectory,name+'.enc'),Buffer.concat([Buffer.from('DLME1'),iv,cipher.getAuthTag(),encrypted]));
  }
  t.after(()=>fs.rmSync(modelDirectory,{recursive:true,force:true}));
  registerDealLensRoutes(app,{modelKey:modelKey.toString('base64'),modelDirectory});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  return {base};
}
test('Deal Lens opens without a password while other sites keep their existing gate',async t=>{
  const {base}=await fixture(t);
  for(const p of ['/deal-lens/','/deal-lens/app.js','/deal-lens/original-model.xlsx','/deal-lens/api/status','/deal-lens/vendor/ocr/eng.traineddata']){
    assert.equal(isProtectedWeatherPath(p),false);
    const r=await fetch(base+p);assert.equal(r.status,200,p);assert.equal(r.headers.get('cache-control'),'private, no-store');
  }
  for(const p of ['/weather-fusion/experimental-weather.html','/weathernext/','/whats-up/','/deal-intelligence/']){
    assert.equal(isProtectedWeatherPath(p),true);assert.equal(isPublicWeatherPath(p),false);
    const r=await fetch(base+p);assert.equal(r.status,401,p);assert.match(await r.text(),/Nourie Weather/);
  }
});
test('the mounted page and every initial script/style load from the same host',async t=>{
  const {base}=await fixture(t),headers={};
  const canonical=await fetch(base+'/deal-lens',{headers,redirect:'manual'});assert.equal(canonical.headers.get('location'),'/deal-lens/');
  const page=await fetch(base+'/deal-lens/',{headers});assert.equal(page.status,200);const html=await page.text();assert.match(html,/Copy prompt\. Paste results/);assert.match(html,/href="\/weather-fusion\/experimental-weather.html"/);
  assert.ok(!html.includes('chatgpt.site'));assert.ok(!html.includes('ai-intake.js'));
  const assets=[...html.matchAll(/(?:src|href)="(\.\/[^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]);
  assert.ok(assets.length>12);
  for(const asset of assets){const r=await fetch(new URL(asset,base+'/deal-lens/'),{headers});assert.equal(r.status,200,asset);assert.equal(r.headers.get('cache-control'),'private, no-store');if(asset.endsWith('.js'))assert.match(r.headers.get('content-type'),/javascript/);}
});
test('original XLSX download bytes survive hosting and paid extraction stays disabled',async t=>{
  const {base}=await fixture(t),headers={};
  const r=await fetch(base+'/deal-lens/original-model.xlsx',{headers});assert.equal(r.status,200);const hash=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(fixtureModel));
  const status=await (await fetch(base+'/deal-lens/api/status',{headers})).json();assert.equal(status.paidEnabled,false);
  const disabled=await fetch(base+'/deal-lens/api/analyze',{method:'POST',headers});assert.equal(disabled.status,410);assert.equal((await disabled.json()).code,'DIRECT_API_DISABLED');
  assert.ok([403,404].includes((await fetch(base+'/deal-lens/.env',{headers})).status));
  assert.equal((await fetch(base+'/deal-lens/ai-intake.js',{headers})).status,404);
});
test('experimental weather links directly to its own tracker path and gateway registers it',()=>{
  const html=fs.readFileSync('public/weather-fusion/index.html','utf8'),server=fs.readFileSync('server.js','utf8');assert.match(html,/id="deal-lens-link" href="\/deal-lens\/"/);assert.ok(!html.includes('deal-lens-dan-2026.nourie42.chatgpt.site'));assert.match(server,/registerDealLensRoutes\(app\)/);assert.match(server,/dealLensVersion: "copy-paste-local-v1"/);
});
