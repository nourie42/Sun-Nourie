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
<style>body{margin:0;padding:18px;background:#173c62}.shell{max-width:1160px;margin:auto}.skin-exposure{padding:24px 18px;color:white}.skin-kicker{text-align:center}</style>
</head><body><div class="shell"><div class="exposure-cards"><div class="skin-exposure" id="skin-exposure"><h2 class="skin-kicker">How it actually feels right now</h2><div id="skin-values"></div></div></div></div>
<script type="module">
const [{sunShadeHTML},{pavementHTML}]=await Promise.all([
 import('/weather-fusion/personal-details.js?v=cinematic-comfort-card-v14'),
 import('/weather-fusion/pavement.js?v=cinematic-comfort-card-v14')
]);
const pavement={status:'estimated',concrete:{value:94,low:85,high:105},asphalt:{value:97,low:90,high:110}};
const comfort={daylight:true,weatherKind:'clear',radiantCondition:'Sunny',condition:'Sunny',shade:86,outdoors:88,sun:88,inputEvidence:{temperature:87,skyCover:0}};
document.querySelector('#skin-values').innerHTML=sunShadeHTML(comfort,{latitude:35.787,longitude:-78.4806},Date.now(),{compact:true,pavement:pavementHTML(pavement,88)});
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
  const page=await browser.newPage({viewport:{width,height:1200},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/comfort-visual-contract',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__comfortVisualReady===true);
  await page.waitForFunction(()=>[...document.styleSheets].some(s=>s.href?.includes('comfort-cinematic.css')));
  assert.deepEqual(errors,[],'The visual contract page must render without browser errors');
  const m=await page.evaluate(()=>{
   const box=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null;};
   const tree=box('.shade-person .exposure-tree'),person=box('.shade-person .exposure-person-art');
   const shadeSun=box('.shade-person .sky-sun'),directSun=box('.sun-person .sky-sun');
   const shadeSvg=box('.shade-person svg'),sunSvg=box('.sun-person svg');
   const pet=document.querySelector('.pavement-person'),petSun=getComputedStyle(pet,'::after');
   const figures=[...document.querySelectorAll('.exposure-person')].map(el=>({box:el.getBoundingClientRect(),label:el.querySelector('.exposure-label')?.textContent.trim(),subtitle:el.querySelector('.exposure-subtitle')?.textContent.trim()}));
   const temps=[...document.querySelectorAll('.exposure-person figcaption strong')].map(x=>x.textContent.trim());
   const asphalt=document.querySelector('.pavement-secondary')?.textContent.trim();
   const card=box('.sun-shade-comparison');
   return {
    tree,person,shadeSun,directSun,shadeSvg,sunSvg,
    treeRatio:tree.height/person.height,treeClearance:person.top-tree.top,
    shadeSunRatio:shadeSun.height/person.height,directSunRatio:directSun.height/person.height,
    petSun:petSun.content!=='none'&&petSun.content!=='normal',
    petSunBackground:petSun.backgroundImage,
    figures,temps,asphalt,card,
    overflow:document.documentElement.scrollWidth>innerWidth+1
   };
  });
  assert.deepEqual(m.temps,['86°','88°','94°'],'Shade, Sun and pet surface values must render exactly from the supplied model values');
  assert.equal(m.asphalt,'Asphalt 97°','Asphalt secondary value must remain exact');
  assert.deepEqual(m.figures.map(x=>x.label),['Shade','Sun','For Pets'],'The three card titles must match the approved design');
  assert.ok(m.figures.every(x=>x.subtitle),'Every card must have a readable descriptive subtitle');
  assert.equal(m.figures[0].subtitle,'Pleasant & comfortable');
  assert.equal(m.figures[1].subtitle,'Hot in direct sunlight');
  assert.equal(m.figures[2].subtitle,'Hot on pavement');
  assert.ok(m.treeRatio>=1.55,`Shade tree must be clearly taller than the seated person; got ${m.treeRatio.toFixed(2)}x at ${width}px`);
  assert.ok(m.treeClearance>=m.person.height*.25,`Tree crown must rise clearly above the seated person at ${width}px`);
  assert.ok(m.shadeSun&&m.directSun,'Shade and Sun scenes must both contain a visible weather sun');
  assert.ok(m.shadeSunRatio>=.25,`Shade sun is too small at ${width}px`);
  assert.ok(m.directSunRatio>=.38,`Direct-sun symbol is too small at ${width}px`);
  const inset=1.5;
  assert.ok(m.shadeSun.left>=m.shadeSvg.left-inset&&m.shadeSun.right<=m.shadeSvg.right+inset&&m.shadeSun.top>=m.shadeSvg.top-inset&&m.shadeSun.bottom<=m.shadeSvg.bottom+inset,`Shade sun must be fully visible inside its scene at ${width}px`);
  assert.ok(m.directSun.left>=m.sunSvg.left-inset&&m.directSun.right<=m.sunSvg.right+inset&&m.directSun.top>=m.sunSvg.top-inset&&m.directSun.bottom<=m.sunSvg.bottom+inset,`Direct sun must be fully visible inside its scene at ${width}px`);
  assert.ok(m.petSun,'The pet panel must show a visible sun whenever the Sun panel does');
  assert.notEqual(m.petSunBackground,'none','The pet sun must be an actual rendered graphic');
  assert.ok(m.figures.every(x=>x.box.height>0&&x.box.width>0),'All three visual cards must render at non-zero size');
  assert.equal(m.overflow,false,'The three-column card must not cause horizontal overflow');

  const hot=await page.evaluate(async()=>{
   const [{sunShadeHTML},{pavementHTML}]=await Promise.all([
    import('/weather-fusion/personal-details.js?v=cinematic-comfort-card-v14'),
    import('/weather-fusion/pavement.js?v=cinematic-comfort-card-v14')
   ]);
   const node=document.createElement('div');
   node.innerHTML=sunShadeHTML({daylight:true,weatherKind:'clear',radiantCondition:'Sunny',condition:'Sunny',shade:90,outdoors:96,sun:96,inputEvidence:{temperature:91,skyCover:0}},{latitude:35.787,longitude:-78.4806},Date.now(),{compact:true,pavement:pavementHTML({status:'estimated',concrete:{value:112,low:100,high:125},asphalt:{value:118,low:105,high:130}},96)});
   return [...node.querySelectorAll('.sun-person .thermal-risk,.pavement-person .pavement-warning')].map(x=>x.textContent.trim());
  });
  assert.deepEqual(hot,['Heat stress','Heat stress'],'Heat-stress warnings must still appear for both the human and pet cards when the modeled threshold is crossed');

  await page.locator('.exposure-cards').screenshot({path:`${out}/comfort-${width}.png`});
  results.push({width,...m,hotWarnings:hot});
  await page.close();
 }
 await fs.writeFile(`${out}/metrics.json`,JSON.stringify(results,null,2));
 console.log('CINEMATIC_COMFORT_VISUAL_CONTRACT_PASS');
 for(const r of results)console.log(JSON.stringify({width:r.width,values:r.temps,asphalt:r.asphalt,titles:r.figures.map(x=>x.label),subtitles:r.figures.map(x=>x.subtitle),treeToPerson:Number(r.treeRatio.toFixed(2)),shadeSunToPerson:Number(r.shadeSunRatio.toFixed(2)),directSunToPerson:Number(r.directSunRatio.toFixed(2)),shadeSunFullyVisible:r.shadeSun.left>=r.shadeSvg.left-1.5&&r.shadeSun.right<=r.shadeSvg.right+1.5&&r.shadeSun.top>=r.shadeSvg.top-1.5&&r.shadeSun.bottom<=r.shadeSvg.bottom+1.5,directSunFullyVisible:r.directSun.left>=r.sunSvg.left-1.5&&r.directSun.right<=r.sunSvg.right+1.5&&r.directSun.top>=r.sunSvg.top-1.5&&r.directSun.bottom<=r.sunSvg.bottom+1.5,petSun:r.petSun,hotWarnings:r.hotWarnings,overflow:r.overflow}));
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
