/** Real Leaflet, production lifecycle and CSS. Controlled map imagery provides
 * deterministic registration and radar visibility ground truth. */
import express from 'express';
import {chromium} from 'playwright';
import PNG from 'png-js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=process.env.WEATHER_MAP_REPORT_DIR||'/tmp/weather-map-results';await fs.mkdir(dir,{recursive:true});
const app=express();app.use('/weather-fusion',express.static('public/weather-fusion'));app.use('/leaflet',express.static('node_modules/leaflet/dist'));
app.get('/tile.svg',(req,res)=>res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f5223b"/></svg>'));
app.get('/',(req,res)=>res.send(`<!doctype html><link rel="stylesheet" href="/leaflet/leaflet.css"><link rel="stylesheet" href="/weather-fusion/style.css"><div class="shell"><div class="glass map-panel"><div class="map-stage"><div id="radar-map"></div></div></div></div><script src="/leaflet/leaflet.js"></script><script type="module">
import {createFramePlayer} from '/weather-fusion/frame-player.js';
const map=window.map=L.map('radar-map',{zoomAnimation:true}).setView([35.787,-78.4806],7);
for(const [name,z]of [['weather-base',200],['weather-model',410],['weather-radar',420],['weather-warnings',450]]){map.createPane(name).style.zIndex=z;}
const bounds=window.bounds=L.latLngBounds([[32.5,-85],[38,-74]]);
const image=(color)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280"><rect width="440" height="280" fill="'+color+'"/></svg>');
L.imageOverlay(image('#15304e'),[[-70,-179],[80,179]],{pane:'weather-base'}).addTo(map);
const player=window.player=createFramePlayer({map,makeImage:(url,bounds,options)=>url.includes('{z}')?L.tileLayer(url,{...options,maxNativeZoom:8,maxZoom:16,noWrap:true}):L.imageOverlay(url,bounds,options)});
window.show=async(i,tile=false)=>player.show({time:String(i),url:tile?location.origin+'/tile.svg?frame='+i+'&z={z}&x={x}&y={y}':image(i%2?'#31c574':'#2a81df'),bounds:bounds},{pane:'weather-model'});
window.radar=L.imageOverlay(image('#f5223b'),[[-70,-179],[80,179]],{pane:'weather-radar'}).addTo(map);
await new Promise(r=>setTimeout(r,150));window.ready=true;
</script>`));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))}),browser=await chromium.launch({headless:true});
const report={checks:[],browserErrors:[],controlledWeather:true};
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1365,height:900},isMobile:mobile,hasTouch:mobile}),page=await context.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  const image=await page.locator('#radar-map').screenshot(),png=new PNG(image),pixels=await new Promise(r=>png.decode(r));const idx=((Math.floor(png.height/2)*png.width)+Math.floor(png.width/2))*4;
  assert.ok(pixels[idx]>180&&pixels[idx+1]<100&&pixels[idx+2]<110,'Radar must be visibly above opaque background');report.checks.push({mobile,radarAboveOpaqueBasemap:true,centerPixel:[...pixels.slice(idx,idx+4)]});
  await page.evaluate(()=>map.removeLayer(radar));
  for(let frame=0;frame<4;frame++){
   assert.equal(await page.evaluate(i=>show(i),frame),true);
   for(const zoom of [6,9,5,10,8,7]){
    await page.evaluate(z=>map.setView([35.6+z*.01,-78.7+z*.01],z),zoom);await page.waitForTimeout(320);
    const s=await page.evaluate(()=>{const rect=player.visible.getElement().getBoundingClientRect(),base=map.getContainer().getBoundingClientRect(),nw=map.latLngToContainerPoint(bounds.getNorthWest()),se=map.latLngToContainerPoint(bounds.getSouthEast());return {actual:[rect.x-base.x,rect.y-base.y,rect.width,rect.height],expected:[nw.x,nw.y,se.x-nw.x,se.y-nw.y],layers:player.layerCount,visible:document.querySelectorAll('[data-weather-model-frame="visible"]').length};});
    assert.ok(s.actual.every((v,i)=>Math.abs(v-s.expected[i])<2),'Forecast raster drifts after frame replacement and zoom');assert.equal(s.layers,1);assert.equal(s.visible,1);report.checks.push({mobile,frame,zoom,registrationError:Math.max(...s.actual.map((v,i)=>Math.abs(v-s.expected[i])))});
   }
  }
  for(let i=0;i<4;i++){assert.equal(await page.evaluate(i=>show(i,true),i),true);await page.evaluate(()=>map.setZoom(6));await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>player.layerCount),1);}
  await page.evaluate(()=>player.clear());await page.evaluate(()=>map.setZoom(9));await page.waitForTimeout(300);assert.equal(await page.locator('[data-weather-model-frame="visible"]').count(),0);
  await page.screenshot({path:dir+'/map-'+(mobile?'mobile':'desktop')+'.png'});await context.close();
 }
 assert.deepEqual(report.browserErrors,[]);report.success=true;
}finally{await browser.close();await new Promise(r=>server.close(r));await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
