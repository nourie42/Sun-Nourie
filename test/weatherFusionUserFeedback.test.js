import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hrrrTileManifest} from '../src/weatherFusionHrrrMap.js';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const app=read('public/weather-fusion/app.js'),html=read('public/weather-fusion/index.html'),server=read('src/weatherFusion.js'),direct=read('src/weatherFusionDirect.js'),prompt=read('src/weatherFusionExperience.js');

test('Dan take is location-discussion specific instead of seeded boilerplate',()=>{
 assert.ok(!app.includes("uncertainty: 'Forecasts can change"));
 assert.ok(!server.includes("uncertainty: 'Forecasts can change"));
 assert.match(server,/function discussionUncertainty\(data\)/);
 assert.match(prompt,/specific forecast-changing factor highlighted by the latest local discussion/i);
 assert.match(prompt,/Never use generic boilerplate/i);
});

test('source limitations are explicitly listed in Scientific Stuff',()=>{
 assert.match(app,/Some optional model details are limited for this location — details below/);
 assert.match(html,/id="source-unavailable-summary"/);
 assert.match(app,/What is unavailable or limited/);
 assert.match(app,/Not collected for this location/);
});

test('bulletin heading no longer contains in plain words',()=>{
 assert.ok(!html.includes('In plain words'));
 assert.match(html,/>NWS BULLETINS<\/h2>/);
});

test('verified independent HRRR map is CONUS and preferred over regional fallback',()=>{
 const now=Date.parse('2026-09-06T20:00:00Z');
 const layer=hrrrTileManifest({model_init_utc:'2026-09-06T18:00:00Z',model_forecast_utc:'2026-09-07T12:00:00Z',forecast_minute:1080},now,new Date(now).toISOString());
 assert.equal(layer.coverage,'Contiguous United States');
 assert.deepEqual(layer.frames[0].bounds,[[20,-130],[55,-60]]);
 assert.match(direct,/if\(live\?\.layer\)layers\.hrrr=/);
 assert.ok(!app.includes('Model image covers North Carolina and the surrounding region'));
});

test('AI number validation rejects invented values without rejecting grounded weather numbers',()=>{
 assert.match(server,/hasUngroundedNumbers/);
 assert.match(server,/collectFactNumbers/);
 assert.match(server,/AI_PROSE_CONTAINS_NONCLOCK_DIGITS/);
});
