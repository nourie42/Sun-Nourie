import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {weatherPresentationFile,registerWeatherFusionRoutes} from '../src/weatherFusion.js';
import {isPublicWeatherPath,isProtectedWeatherPath} from '../src/weatherSiteAccess.js';
const root=new URL('../public/weather-fusion/',import.meta.url),read=name=>readFileSync(new URL(name,root),'utf8');

test('main presentation stays unchanged unless the staging-only setting is enabled',()=>{
 for(const path of ['/weather','/weather-fusion','/weather-fusion/','/weather-fusion/index.html']){
  assert.equal(weatherPresentationFile(path,{}),'index.html');
  assert.equal(weatherPresentationFile(path,{WEATHER_FUSION_PRESENTATION:'prerelease'}),'prerelease.html');
 }
 for(const path of ['/weather-fusion/experimental-weather.html','/weather-fusion/outlooks'])assert.equal(weatherPresentationFile(path,{WEATHER_FUSION_PRESENTATION:'prerelease'}),'index.html');
 assert.equal(weatherPresentationFile('/weather-fusion/',{WEATHER_FUSION_PRESENTATION:'anything-else'}),'index.html');
});
test('prerelease copy retains every main ID without duplicates and loads only isolated changed modules',()=>{
 const main=read('index.html'),copy=read('prerelease.html'),ids=s=>[...s.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 for(const id of ids(main))assert.ok(ids(copy).includes(id),id);
 assert.equal(ids(copy).length,new Set(ids(copy)).size);
 assert.match(copy,/class="prerelease-page"/);assert.match(copy,/prerelease-app\.js/);assert.doesNotMatch(copy,/src="\/weather-fusion\/app\.js/);
 assert.match(copy,/id="open-snow"/);assert.match(copy,/Feel Meter/);
 assert.equal((copy.match(/data-layer=/g)||[]).length,7);
 assert.doesNotMatch(main,/prerelease-app|prerelease\.css|prerelease-winter/);
});
test('every new prerelease browser asset has an explicit route, without changing page access policy',()=>{
 const routes=[];registerWeatherFusionRoutes({get:(path,handler)=>routes.push(path)}, {env:{}});
 for(const name of readdirSync(root).filter(name=>name.startsWith('prerelease')))assert.ok(routes.includes('/weather-fusion/'+name),name);
 assert.equal(isProtectedWeatherPath('/weather-fusion/prerelease.html'),true);assert.equal(isPublicWeatherPath('/weather-fusion/prerelease.html'),false);
 assert.equal(isPublicWeatherPath('/weather-fusion/'),true);assert.equal(isPublicWeatherPath('/weather-fusion/prerelease-app.js'),true);
});
test('only prerelease opts into extra winter source work and exact unavailable quantities are not substituted',()=>{
 assert.doesNotMatch(read('app.js'),/prereleaseWinter/);assert.match(read('prerelease-app.js'),/prereleaseWinter/);
 assert.match(read('prerelease-winter.js'),/No weights have been redistributed/);
 assert.match(read('prerelease.css'),/max-width:\s*480px/);
});
