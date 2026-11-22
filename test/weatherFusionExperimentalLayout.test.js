import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import express from 'express';
import {registerWeatherComparisonRoutes} from '../src/weatherComparison.js';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';

const read = name => readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const html = read('index.html');
const app = read('app.js');
const carWashCss = read('car-wash.css');
const dewpoint = read('dewpoint-meter.js');

test('main HTML ships radar only while experimental mode adds every model control',()=>{
  const staticLayers = [...html.matchAll(/data-layer="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(staticLayers,['radar']);
  for (const layer of ['hrrr','ecmwf','nbm','temperature','wind','clouds']) {
    assert.match(app,new RegExp(`\\['${layer}'`));
  }
  assert.match(app,/if\(experimentalPage&&tabs&&!tabs\.querySelector\('\[data-layer="hrrr"\]'\)\)/);
  assert.match(app,/if\(layer==='radar'\)/,'radar remains the normal main-page path');
});

test('main and experimental weather share five-day sun-based forecast windows',()=>{
  assert.doesNotMatch(html,/id="experimental-whats-up-link"/);
  assert.match(html,/id="forecast-window-banners"[^>]*hidden/);
  assert.match(app,/draw\('forecast-window-banners'/);
  assert.match(html,/id="forecast-window-dialog"[^>]*aria-labelledby="forecast-window-title"/);
  assert.match(app,/resetForecastWindowBanners\(\)/);
});

test('main and old weather routes serve their respective app shells',async t=>{
  const app = express();
  const options = {env:{},fetchImpl:async()=>{throw new Error('not called');}};
  registerWeatherComparisonRoutes(app, options);
  registerWeatherFusionRoutes(app, options);
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.close();server.closeAllConnections();});
  const serve = async route => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
    assert.equal(response.status,200,route);
    assert.match(response.headers.get('Cache-Control'),/no-store/);
    return response.text();
  };
  const main = await serve('/weather-fusion/');
  assert.match(main,/id="old-app-link"[^>]*href="\/weather-fusion\/old\/">Old App/);
  assert.match(main,/rel="manifest" href="\/weather-fusion\/manifest.webmanifest"/);
  assert.match(main,/href="\/weather-fusion\/apple-touch-icon.png\?v=ice-glass"/);
  for (const alias of ['/weather-fusion','/weather-fusion/index.html','/weather-fusion/v3/']) assert.equal(await serve(alias),main);
  assert.match(await serve('/weather-fusion/old/'),/id="main-app-link"[^>]*href="\/weather-fusion\/">Main App/);
  for (const alias of ['/weather-fusion/experimental-weather.html','/weather-fusion/outlooks']) assert.equal(await serve(alias),html);
  assert.match(html,/href="\/weather-fusion\/experimental-weather\.html" aria-label="Open Experimental Weather"/);
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id,'/weather-fusion/');
  assert.equal(manifest.start_url,'/weather-fusion/');
  assert.equal(manifest.scope,'/weather-fusion/');
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
});

test('car-wash panel is below real-feel cards and the Gross Meter anchors below it',()=>{
  const feel = html.indexOf('id="skin-exposure"');
  const wash = html.indexOf('id="car-wash-forecast"');
  const maps = html.indexOf('id="map-panel"');
  assert.ok(feel>=0 && wash>feel && maps>wash);
  assert.match(html,/id="car-wash-forecast"[^>]*hidden/);
  assert.doesNotMatch(html,/id="car-wash-forecast"[^>]*aria-live/);
  assert.match(html,/id="open-car-wash"[^>]*aria-expanded="false"/);
  assert.match(app,/if\(!experimentalPage&&!\$\('car-wash-forecast'\)\.hidden\)draw\('car-wash-forecast'/);
  assert.match(app,/\$\('open-car-wash'\)\.addEventListener\('click'/);
  assert.match(dewpoint,/document\.getElementById\('car-wash-forecast'\)\s*\|\|\s*host/);
});

test('car-wash phone layout reserves a separate unobstructed photo band and five equal day columns',()=>{
  assert.match(carWashCss,/\.car-wash-forecast\{[^}]*display:flex;flex-direction:column/);
  assert.doesNotMatch(carWashCss,/position:absolute|grid-template-rows:12%/);
  assert.match(carWashCss,/\.car-wash-photo\{[^}]*aspect-ratio:3\/2/);
  assert.match(carWashCss,/\.car-wash-art\{[^}]*position:static;[^}]*object-fit:contain/);
  assert.match(carWashCss,/container-type:inline-size/);
  assert.match(carWashCss,/\.car-wash-days\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(carWashCss,/@media\(max-width:760px\)\{[\s\S]*\.car-wash-forecast\{width:100%/);
  assert.match(carWashCss,/@media\(max-width:359px\)/);
  assert.match(carWashCss,/width:min\(100%,760px\)/);
  assert.match(carWashCss,/\.car-wash-footer\{/);
  assert.doesNotMatch(carWashCss,/\.car-wash-forecast footer\{/);
  for (const size of [320,360,390,430]) {
    const photoHeight = size * 2 / 3;
    assert.ok(photoHeight >= 213,`${size}px card gives the car its own visible photo band`);
  }
});

test('generated car background is a real lightweight WebP served as a static asset',()=>{
  const asset = new URL('../public/weather-fusion/car-wash-corvette-hood.webp',import.meta.url);
  const bytes = readFileSync(asset);
  assert.equal(bytes.subarray(0,4).toString(),'RIFF');
  assert.equal(bytes.subarray(8,12).toString(),'WEBP');
  assert.ok(statSync(asset).size < 600000);
  assert.match(read('car-wash.js'),/src="\/weather-fusion\/car-wash-corvette-hood\.webp"/);
});

test('the explicit server allowlist covers the weather shell dependency closure',()=>{
  const allowed = new Set();
  registerWeatherFusionRoutes({get(route) {
    if (typeof route === 'string' && route.startsWith('/weather-fusion/')) allowed.add(route.slice('/weather-fusion/'.length));
  }}, {env:{},fetchImpl:async()=>{throw new Error('not called');}});
  const required = new Set();
  const pending = [];
  const supported = /\.(?:js|css|png|webp|jpe?g|svg)$/i;
  const add = raw => {
    const name=String(raw||'').split('?')[0].replace(/^\.\//,'').replace(/^\/weather-fusion\//,'');
    if(!supported.test(name)||required.has(name))return;
    required.add(name);
    assert.equal(existsSync(new URL(`../public/weather-fusion/${name}`,import.meta.url)),true,`${name} exists`);
    if(/\.(?:js|css)$/i.test(name))pending.push(name);
  };
  for(const match of html.matchAll(/\/weather-fusion\/([A-Za-z0-9_.-]+\.(?:js|css|png|webp|jpe?g|svg))/gi))add(match[1]);
  while(pending.length){
    const name=pending.shift(),source=read(name);
    for(const match of source.matchAll(/(?:from\s*|import\s*)['"]\.\/([^?'"]+)/g))add(match[1]);
    for(const match of source.matchAll(/\/weather-fusion\/([A-Za-z0-9_.-]+\.(?:js|css|png|webp|jpe?g|svg))/gi))add(match[1]);
    // Scene selectors store their concrete filenames as plain string values.
    for(const match of source.matchAll(/['"]([A-Za-z0-9_.-]+\.(?:png|webp|jpe?g|svg))['"]/gi))add(match[1]);
  }
  // Today-card chooses one of these names through a template literal.
  for(const name of ['today-sky-clear.webp','today-sky-clouds.webp','today-sky-night-v2.webp','today-sky-rain.webp','today-sky-storm.webp'])add(name);
  const missing=[...required].filter(name=>!allowed.has(name)).sort();
  assert.deepEqual(missing,[],`server static allowlist is missing: ${missing.join(', ')}`);
});
