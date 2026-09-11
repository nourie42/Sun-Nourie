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
 import('/weather-fusion/personal-details.js?v=mobile-weather-v19'),
 import('/weather-fusion/pavement.js?v=mobile-weather-v19')
]);
const pavement={status:'estimated',daylight:true,concrete:{value:94,low:85,high:105},asphalt:{value:97,low:90,high:110}};
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
 for(const width of [320,390,430,1024]){
  const page=await browser.newPage({viewport:{width,height:1200},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/comfort-visual-contract',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__comfortVisualReady===true);
  await page.waitForFunction(()=>[...document.styleSheets].some(s=>s.href?.includes('comfort-cinematic.css')));
  assert.deepEqual(errors,[],'The visual contract page must render without browser errors');
  const m=await page.evaluate(()=>{
   const box=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null;};
   const artwork=[...document.querySelectorAll('.reference-scene')].map(el=>({box:el.getBoundingClientRect(),fit:el.getAttribute('preserveAspectRatio'),source:el.querySelector('image')?.getAttribute('href')}));
   const directSun=box('.sun-person .sky-sun'),petSun=box('.pavement-person .sky-sun');
   const shadeSvg=box('.shade-person>svg'),sunSvg=box('.sun-person>svg'),petSvg=box('.pavement-person>svg');
   const figures=[...document.querySelectorAll('.exposure-person')].map(el=>({box:el.getBoundingClientRect(),label:el.querySelector('.exposure-label')?.textContent.trim(),subtitle:el.querySelector('.exposure-subtitle')?.textContent.trim(),caption:el.querySelector('figcaption')?.getBoundingClientRect()}));
   const temps=[...document.querySelectorAll('.exposure-person figcaption strong')].map(x=>x.textContent.trim());
   const asphalt=document.querySelector('.pavement-secondary')?.textContent.trim();
   const comparison=document.querySelector('.sun-shade-comparison');
   return {artwork,directSun,petSun,shadeSvg,sunSvg,petSvg,figures,temps,asphalt,comparison:box('.sun-shade-comparison'),comparisonOverflow:comparison.scrollWidth>comparison.clientWidth+1,overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  assert.deepEqual(m.temps,['86°','88°','94°']);
  assert.equal(m.asphalt,'Asphalt 97°');
  assert.deepEqual(m.figures.map(x=>x.label),['Shade','Sun','For Pets']);
  assert.equal(m.figures[0].subtitle,'Pleasant & comfortable');
  assert.equal(m.figures[1].subtitle,'Hot in direct sunlight');
  assert.equal(m.figures[2].subtitle,'Hot on pavement');
  assert.equal(m.artwork.length,3,'Each reference card must display its illustration');
  for(const [i,art] of m.artwork.entries()){
   assert.ok(art.box.height>=art.box.width*.95,'People must retain a complete, prominent illustration band');
   assert.equal(art.fit,'xMidYMid slice','Artwork must preserve its natural proportions');
   assert.equal(art.source,'/weather-fusion/comfort-reference-scenes.png');
  }
  const loaded=await page.evaluate(async()=>{const img=new Image();img.src='/weather-fusion/comfort-reference-scenes.png';await img.decode();return img.naturalWidth>0&&img.naturalHeight>0;});
  assert.ok(loaded,'Reference artwork must load and decode');
  assert.ok(m.directSun&&m.petSun,'Outdoor and pet cards must show matching daylight symbols');
  const heights=m.figures.map(x=>x.box.height),bottoms=m.figures.map(x=>x.box.bottom),captionTops=m.figures.map(x=>x.caption.top);
  assert.ok(Math.max(...heights)-Math.min(...heights)<=1,`Card heights differ at ${width}px: ${heights.join(', ')}`);
  assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<=1,`Card bottoms differ at ${width}px: ${bottoms.join(', ')}`);
  assert.ok(Math.max(...captionTops)-Math.min(...captionTops)<=1,`Temperature bands do not start evenly at ${width}px: ${captionTops.join(', ')}`);
  for(const fig of m.figures){
   assert.ok(fig.box.left>=m.comparison.left-1&&fig.box.right<=m.comparison.right+1,`Every card must be visible without scrolling at ${width}px`);
   if(width<=540)assert.ok(fig.box.height<310,`Phone cards must stay compact at ${width}px`);
   else {const ratio=fig.box.width/fig.box.height;assert.ok(ratio>=.56&&ratio<=.70,`Card ratio ${ratio.toFixed(2)} is outside the reference-like portrait range at ${width}px`);}
  }
  assert.equal(m.comparisonOverflow,false,`Comparison must not scroll sideways at ${width}px`);
  assert.equal(m.overflow,false);

  const night=await page.evaluate(async()=>{
   const [{sunShadeHTML},{pavementHTML}]=await Promise.all([import('/weather-fusion/personal-details.js?v=mobile-weather-v19'),import('/weather-fusion/pavement.js?v=mobile-weather-v19')]);
   const node=document.createElement('div');
   node.innerHTML=sunShadeHTML({daylight:false,weatherKind:'clear',radiantCondition:'Clear',condition:'Clear',shade:72,outdoors:72,sun:null,inputEvidence:{temperature:73,skyCover:0}},{latitude:35.787,longitude:-78.4806},Date.now(),{compact:true,pavement:pavementHTML({status:'estimated',daylight:false,concrete:{value:76},asphalt:{value:78}},72)});
   return {petMoon:!!node.querySelector('.pavement-person .pet-moon'),petSun:!!node.querySelector('.pavement-person .sky-sun'),humanSun:!!node.querySelector('.sun-person .sky-sun'),petDaylight:node.querySelector('.pavement-person')?.dataset.daylight};
  });
  assert.equal(night.petMoon,true,'Pet scene must switch to moon/night styling with the human cards');
  assert.equal(night.petSun,false,'Pet scene must not show a sun at night');
  assert.equal(night.humanSun,false,'Human Sun scene must not show a sun at night');
  assert.equal(night.petDaylight,'false');

  const hot=await page.evaluate(async()=>{
   const [{sunShadeHTML},{pavementHTML}]=await Promise.all([import('/weather-fusion/personal-details.js?v=mobile-weather-v19'),import('/weather-fusion/pavement.js?v=mobile-weather-v19')]);
   const node=document.createElement('div');
   node.innerHTML=sunShadeHTML({daylight:true,weatherKind:'clear',radiantCondition:'Sunny',condition:'Sunny',shade:90,outdoors:96,sun:96,inputEvidence:{temperature:91,skyCover:0}},{latitude:35.787,longitude:-78.4806},Date.now(),{compact:true,pavement:pavementHTML({status:'estimated',daylight:true,concrete:{value:112,low:100,high:125},asphalt:{value:118,low:105,high:130}},96)});
   return [...node.querySelectorAll('.sun-person .thermal-risk,.pavement-person .pavement-warning')].map(x=>x.textContent.trim());
  });
  assert.deepEqual(hot,['Heat stress','Heat stress']);
  await page.locator('.exposure-cards').screenshot({path:`${out}/comfort-${width}.png`});
  results.push({width,...m,night,hotWarnings:hot});
  await page.close();
 }
 await fs.writeFile(`${out}/metrics.json`,JSON.stringify(results,null,2));
 console.log('REFERENCE_COMFORT_VISUAL_CONTRACT_PASS');
 for(const r of results)console.log(JSON.stringify({width:r.width,values:r.temps,asphalt:r.asphalt,cardHeights:r.figures.map(x=>x.box.height),cardBottoms:r.figures.map(x=>x.box.bottom),captionTops:r.figures.map(x=>x.caption.top),illustratedCards:r.artwork.length,dayPetSun:!!r.petSun,night:r.night,hotWarnings:r.hotWarnings,overflow:r.overflow}));
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
