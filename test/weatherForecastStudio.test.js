import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {isPublicWeatherPath} from '../src/weatherSiteAccess.js';
const root=new URL('../public/weather-fusion/',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const html=read('index.html'),app=read('app.js');
const routes=readFileSync(new URL('../src/weatherFusion.js',import.meta.url),'utf8');

test('the public main page can load each studio module and its complete import closure',()=>{
 const start=['weather-playback.js','forecast-explorer.js','custom-forecast.js'];
 const routed=routes.match(/for \(const name of \[([\s\S]*?)\]\) app\.get\(`\/weather-fusion\/\$\{name\}`/)[1];
 for(const name of start.flatMap(name=>[name,name.replace('.js','.css')])){
  assert.ok(routed.includes(`'${name}'`),`${name} has an explicit route`);
  assert.equal(isPublicWeatherPath('/weather-fusion/'+name),true,`${name} loads without a password on the main page`);
 }
 const pending=[...start],seen=new Set();
 while(pending.length){
  const name=pending.pop();if(seen.has(name))continue;seen.add(name);
  assert.ok(existsSync(new URL(name,root)),`missing module ${name}`);
  for(const match of read(name).matchAll(/(?:from\s*|import\s*)['"]\.\/([^?'"\s]+)(?:\?[^'"]*)?['"]/g))pending.push(match[1]);
 }
 assert.ok(seen.has('experience.js')&&seen.has('atmos-model.js')&&seen.has('atmos-sky.js'));
 assert.equal(isPublicWeatherPath('/weather-fusion/atmos.html'),false,'alternate page access stays private');
});

test('playback, graphs and main page share one experience module instance and new browser cache version',()=>{
 const consumers=['app.js','weather-playback.js','forecast-explorer.js'];
 const imports=consumers.map(name=>[...read(name).matchAll(/from ['"]\.\/(experience\.js[^'"]*)['"]/g)].map(m=>m[1]));
 assert.ok(imports.every(items=>items.length===1));
 assert.deepEqual([...new Set(imports.flat())],['experience.js?v=forecast-studio-v1']);
 assert.match(html,/app\.js\?v=forecast-studio-v1/);
 for(const file of ['weather-playback','forecast-explorer','custom-forecast'])assert.match(html,new RegExp(`${file}\\.css\\?v=forecast-studio-v1`));
 assert.match(html,/id="open-custom-forecast"[^>]*aria-controls="custom-forecast-panel"/);
 assert.match(html,/id="custom-forecast-panel"[^>]*hidden/);
 for(const name of ['installWeatherPlayback','installForecastExplorer','installCustomForecast'])assert.match(app,new RegExp(name+'\\(\\)'));
});
