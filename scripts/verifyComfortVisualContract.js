import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';

const app=express();
app.use('/weather-fusion',express.static('public/weather-fusion'));
app.get('/comfort-visual-contract',(_req,res)=>res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/weather-fusion/style.css">
<link rel="stylesheet" href="/weather-fusion/personal-details.css?v=weather-art-labels-v10">
<link rel="stylesheet" href="/weather-fusion/weather-repair.css?v=comfort-visual-contract-v13">
<style>body{margin:0;padding:18px;background:#294b6b}.shell{max-width:960px;margin:auto}.skin-exposure{padding:20px 12px;border-radius:24px;background:#365a7b;color:white}.skin-kicker{text-align:center;margin:0 0 14px}</style>
</head><body><div class="shell"><div class="exposure-cards"><div class="skin-exposure"><h2 class="skin-kicker">How it actually feels right now</h2><div id="skin-values"></div></div></div></div>
<script type="module">
const [{sunShadeHTML},{pavementHTML}]=await Promise.all([
 import('/weather-fusion/personal-details.js?v=natural-comfort-art-v12'),
 import('/weather-fusion/pavement.js?v=natural-comfort-art-v12')
]);
const pavement={status:'estimated',concrete:{value:99,low:90,high:110},asphalt:{value:104,low:95,high:115}};
const comfort={daylight:true,weatherKind:'clear',radiantCondition:'Sunny',condition:'Sunny',shade:90,outdoors:90,sun:90,inputEvidence:{temperature:90,skyCover:0}};
document.querySelector('#skin-values').innerHTML=sunShadeHTML(comfort,{latitude:35.787,longitude:-78.4806},Date.now(),{compact:true,pavement:pavementHTML(pavement,90)});
window.__comfortVisualReady=true;
</script></body></html>`));

const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const out='/tmp/comfort-visual-contract';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const width of [390,1024]){
  const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/comfort-visual-contract',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__comfortVisualReady===true);
  assert.deepEqual(errors,[],'The visual contract page must render without browser errors');
  const m=await page.evaluate(()=>{
   const box=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null;};
   const tree=box('.shade-person .exposure-tree'),person=box('.shade-person .exposure-person-art');
   const shadeSun=box('.shade-person .sky-sun'),directSun=box('.sun-person .sky-sun');
   const pet=document.querySelector('.pavement-person .poodle-scene'),petStyle=getComputedStyle(pet);
   const card=box('.sun-shade-comparison'),viewport=document.documentElement.getBoundingClientRect();
   return {tree,person,shadeSun,directSun,treeRatio:tree.height/person.height,treeClearance:person.top-tree.top,
    shadeSunRatio:shadeSun.height/person.height,directSunRatio:directSun.height/person.height,
    petSunBackground:petStyle.backgroundImage,petBackgroundSize:petStyle.backgroundSize,
    heatBanners:[...document.querySelectorAll('.sun-person .thermal-risk,.pavement-person .pavement-warning')].map(x=>x.textContent.trim()),
    overflow:document.documentElement.scrollWidth>innerWidth+1,card,viewportWidth:viewport.width};
  });
  assert.ok(m.treeRatio>=2.0,`Shade tree must be at least twice the person's height; got ${m.treeRatio.toFixed(2)}x at ${width}px`);
  assert.ok(m.treeClearance>=m.person.height*.45,`Tree crown must clearly rise above the person at ${width}px`);
  assert.ok(m.shadeSunRatio>=.60,`Shade sun is too small at ${width}px: ${m.shadeSunRatio.toFixed(2)}x person height`);
  assert.ok(m.directSunRatio>=.60,`Direct-sun symbol is too small at ${width}px: ${m.directSunRatio.toFixed(2)}x person height`);
  assert.ok(Math.abs(m.shadeSun.height-m.directSun.height)<=1,'The first two sun symbols must be the same size');
  assert.notEqual(m.petSunBackground,'none','The pet panel must visibly render a sun whenever the direct-sun panel renders one');
  assert.ok(m.petSunBackground.includes('data:image/svg+xml'),'The pet sun must be a real rendered background graphic');
  assert.deepEqual(m.heatBanners,['Heat stress','Heat stress'],'Human and pet heat-stress banners must both be present');
  assert.equal(m.overflow,false,'The three-column card must not cause horizontal overflow');
  await page.locator('.exposure-cards').screenshot({path:`${out}/comfort-${width}.png`});
  results.push({width,...m});
  await page.close();
 }
 await fs.writeFile(`${out}/metrics.json`,JSON.stringify(results,null,2));
 console.log('COMFORT_VISUAL_CONTRACT_PASS');
 for(const r of results)console.log(JSON.stringify({width:r.width,treeToPerson:Number(r.treeRatio.toFixed(2)),shadeSunToPerson:Number(r.shadeSunRatio.toFixed(2)),directSunToPerson:Number(r.directSunRatio.toFixed(2)),petSun:r.petSunBackground!=='none',heatBanners:r.heatBanners,overflow:r.overflow}));
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
