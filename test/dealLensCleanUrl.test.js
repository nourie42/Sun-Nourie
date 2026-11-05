import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('public/deal-lens/index.html','utf8');
const script=html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
test('Deal Lens has a canonical, provider-neutral website address',()=>{
  assert.ok(script,'Early cleanup script is present');
  assert.match(html,/<link rel="canonical" href="https:\/\/sun-nourie-live\.onrender\.com\/deal-lens\/">/);
});
function visit(input){
  const changes=[];
  const window={location:{href:input},history:{state:{deal:'safe'},replaceState(state,unused,path){changes.push({state,path});}}};
  vm.runInNewContext(script,{window,URL},{timeout:1000});
  return changes;
}
test('removes tracking source from browser address without a reload',()=>{
  const result=visit('https://sun-nourie-live.onrender.com/deal-lens/?utm_source=chatgpt.com');
  assert.equal(result.length,1);
  assert.equal(result[0].path,'/deal-lens/');
  assert.equal(result[0].state.deal,'safe');
});
test('keeps non-tracking query parameters and fragments while removing any UTM parameters',()=>{
  const result=visit('https://sun-nourie-live.onrender.com/deal-lens/?deal=123&utm_source=chatgpt.com&utm_medium=referral#model');
  assert.equal(result[0].path,'/deal-lens/?deal=123#model');
});
test('does not change clean URLs',()=>{
  assert.equal(visit('https://sun-nourie-live.onrender.com/deal-lens/?deal=123').length,0);
});
