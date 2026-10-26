import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync('public/weather-fusion/index.html','utf8');
const nav=html.match(/<nav class="weather-jump-nav"[\s\S]*?<\/nav>/)[0];

test('Best Times is a button in the top row and its panel starts hidden',()=>{
 assert.match(nav,/<button[^>]*id="open-best-times"[^>]*aria-expanded="false"[^>]*aria-controls="best-times"[^>]*>\s*<span class="jump-label">Best Times<\/span>/);
 assert.match(html,/<section class="glass best-times" id="best-times" hidden><\/section>/,'nothing is shown until the button is tapped');
});

test('the panel reuses the Atmos calculation and loads it only when opened',()=>{
 const js=readFileSync('public/weather-fusion/best-times.js','utf8');
 assert.doesNotMatch(js,/^import /m,'no static import: a problem here cannot stop the forecast');
 assert.match(js,/import\(MODEL_URL\)/);
 assert.match(js,/comfortGrid\(data/);
 assert.match(js,/perfectWindows\(grid\)/);
 const atmos=readFileSync('public/weather-fusion/atmos.js','utf8');
 assert.match(atmos,/atmos-model\.js\?v=atmos-v5/,'same module URL as Atmos, so one copy is shared');
 assert.match(js,/atmos-model\.js\?v=atmos-v5/);
});

test('every id the panel writes is its own, and its styles are scoped to it',()=>{
 const js=readFileSync('public/weather-fusion/best-times.js','utf8');
 const ids=[...js.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 assert.ok(ids.length>=6);
 assert.ok(ids.every(id=>id.startsWith('best-times')),ids.join(','));
 const appIds=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
 assert.deepEqual(ids.filter(id=>appIds.has(id)),[]);
 const css=readFileSync('public/weather-fusion/best-times.css','utf8');
 const rules=css.replace(/\/\*[\s\S]*?\*\//g,'').split('}').map(r=>r.split('{')[0].trim()).filter(r=>r&&!r.startsWith('@'));
 assert.ok(rules.every(r=>/#best-times|jump-best-times|#open-best-times/.test(r)),rules.filter(r=>!/#best-times|jump-best-times|#open-best-times/.test(r)).join(' | '));
});

test('the browser files are on the static allowlist',()=>{
 const server=readFileSync('src/weatherFusion.js','utf8');
 for(const name of ['best-times.js','best-times.css'])assert.match(server,new RegExp(`'${name.replace('.','\\.')}'`),name);
 assert.match(html,/best-times\.css\?v=/);assert.match(html,/best-times\.js\?v=/);
});
