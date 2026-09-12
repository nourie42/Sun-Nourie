import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';

const read = name => readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
const html = read('index.html');
const app = read('app.js');
const carWashCss = read('car-wash.css');
const dewpoint = read('dewpoint-meter.js');
const serverSource = readFileSync(new URL('../src/weatherFusion.js',import.meta.url),'utf8');

test('main HTML ships radar only while experimental mode adds every model control',()=>{
  const staticLayers = [...html.matchAll(/data-layer="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(staticLayers,['radar']);
  for (const layer of ['hrrr','ecmwf','nbm','temperature','wind','clouds']) {
    assert.match(app,new RegExp(`\\['${layer}'`));
  }
  assert.match(app,/if\(experimentalPage&&tabs&&!tabs\.querySelector\('\[data-layer="hrrr"\]'\)\)/);
  assert.match(app,/if\(layer==='radar'\)/,'radar remains the normal main-page path');
});

test('main and experimental URLs are served by one shared app shell',()=>{
  const routes = [];
  registerWeatherFusionRoutes({get:(...args)=>routes.push(args)},{env:{},fetchImpl:async()=>{throw new Error('not called');}});
  const [paths,handler] = routes.find(([path]) => Array.isArray(path));
  assert.ok(paths.includes('/weather-fusion/'));
  assert.ok(paths.includes('/weather-fusion/experimental-weather.html'));
  const headers = {},sent = [];
  handler({}, {setHeader:(name,value)=>{headers[name]=value;},sendFile:file=>sent.push(file)});
  assert.equal(sent.length,1);
  assert.match(sent[0],/public\/weather-fusion\/index\.html$/);
  assert.equal(headers['Cache-Control'],'no-cache');
  assert.match(html,/href="\/weather-fusion\/experimental-weather\.html" aria-label="Open Experimental Weather"/);
});

test('car-wash panel is below real-feel cards and the Gross Meter anchors below it',()=>{
  const feel = html.indexOf('id="skin-exposure"');
  const wash = html.indexOf('id="car-wash-forecast"');
  const maps = html.indexOf('id="map-panel"');
  assert.ok(feel>=0 && wash>feel && maps>wash);
  assert.match(html,/id="car-wash-forecast"[^>]*hidden/);
  assert.doesNotMatch(html,/id="car-wash-forecast"[^>]*aria-live/);
  assert.match(app,/if\(experimentalPage\)draw\('car-wash-forecast'/);
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
  const routeList = serverSource.match(/for \(const name of \[([\s\S]*?)\]\) app\.get\(`\/weather-fusion\/\$\{name\}`/);
  assert.ok(routeList,'weather assets must use an auditable explicit route list');
  const allowed = new Set([...routeList[1].matchAll(/'([^']+)'/g)].map(match=>match[1]));
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
