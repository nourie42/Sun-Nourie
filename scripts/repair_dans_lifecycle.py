from pathlib import Path
root=Path('.')
def edit(p,a,b):
 p=root/p;s=p.read_text();assert s.count(a)==1,(p,a[:70],s.count(a));p.write_text(s.replace(a,b))
p='src/weatherFusion.js'
edit(p,"import {DAN_TAKE_VERSION,collectDanTakeEvidence,approveDanTake,visibleDanTakeItems,danTakeText}","import {createDiscussionSource,DISCUSSION_SOURCE_VERSION} from './weatherFusionDiscussionSource.js';\nimport {DAN_TAKE_VERSION,collectDanTakeEvidence,approveDanTake,visibleDanTakeItems,danTakeText,rebindDanTake}")
edit(p,"  const failureCooldown = new Map();","  const failureCooldown = new Map();\n  const approvedTakes = new Map();\n  const takeKey=data=>`${data?.location?.latitude},${data?.location?.longitude}`;\n  function retainedTake(data){return rebindDanTake(approvedTakes.get(takeKey(data)),data,now());}\n  function rememberTake(data,briefing){\n    const take=rebindDanTake(briefing,data,now());\n    if(take){if(approvedTakes.size>=100&&!approvedTakes.has(takeKey(data)))approvedTakes.delete(approvedTakes.keys().next().value);approvedTakes.set(takeKey(data),take);}\n  }")
edit(p,"async function request(url, { text = false, body = null, timeout = 12000 } = {})", "async function request(url, { text = false, body = null, timeout = 12000, revalidate = false } = {})")
edit(p,"    if (body) { headers['Content-Type']", "    if(revalidate)headers['Cache-Control']='no-cache';\n    if (body) { headers['Content-Type']")
edit(p,"  const loadSpecialDiscussions=createSpecialDiscussionService({cached,now});", "  const loadSpecialDiscussions=createSpecialDiscussionService({cached,now});\n  const loadDiscussion=createDiscussionSource({request,now});")
edit(p,"    return forecastCache.get(key, MINUTE, async () => {", "    const snapshot=await forecastCache.get(key, MINUTE, async () => {")
f=root/p;s=f.read_text();a=s.index("        discussion: point?.cwa ? feed('afd',");b=s.index("        observation:",a);s=s[:a]+"        discussion: loadDiscussion(point?.cwa),\n"+s[b:];f.write_text(s)
edit(p,"      result.integrityVersion='weather-nourie-integrity-v1';", "      result.integrityVersion='weather-nourie-integrity-v1';\n      result.discussionSourceVersion=DISCUSSION_SOURCE_VERSION;")
edit(p,"      return result;\n    });\n  }\n  function fallback", "      return result;\n    });\n    return {...snapshot,danTake:retainedTake(snapshot)};\n  }\n  function fallback")
edit(p,"uncertainty: '', ...approveDanTake([],data,now()), sources:", "uncertainty: '', ...approveDanTake([],data,now()), danTake:retainedTake(data), sources:")
edit(p,"        const take=approveDanTake(content.forecastChanges,data,now());", "        const take=approveDanTake(content.forecastChanges,data,now());\n        rememberTake(data,{...take,mode:'ai',signature:data.signature,generatedAt:iso(now()),model:env.WEATHER_FUSION_AI_MODEL||'gpt-5-mini'});")
edit(p,"    return {...briefing,forecastChanges:activeChanges,uncertainty:danTakeText(activeChanges)};", "    return {...briefing,danTake:activeChanges.length?null:retainedTake(data),forecastChanges:activeChanges,uncertainty:danTakeText(activeChanges)};")
p='public/weather-fusion/dans-take.js'
edit(p,"export const DAN_TAKE_VERSION = 'weather-nourie-dans-take-integrity-v2';","export const DAN_TAKE_VERSION = 'weather-nourie-dans-take-source-v3';")
with (root/p).open('a') as f:f.write('''\n/** Reuse ONLY a previously approved take from the same exact discussion and
 * location. A changed numeric forecast signature is not a changed AFD. Full
 * outlook prose is intentionally excluded from this small source-bound object. */
export function rebindDanTake(previous,forecast,now=Date.now()){
  if(!previous||!forecast?.signature)return null;
  const rebound={...previous,signature:forecast.signature};
  const items=visibleDanTakeItems(rebound,forecast,now);
  if(!items.length)return null;
  return {mode:'ai',signature:forecast.signature,danTakeVersion:DAN_TAKE_VERSION,
    danTakeSource:rebound.danTakeSource,danTakeStatus:'supported',forecastChanges:items,
    generatedAt:previous.generatedAt||null,model:previous.model||null,reused:true};
}
''')
p='public/weather-fusion/app.js'
edit(p,"DAN_TAKE_VERSION,visibleDanTakeItems,danTakeText", "DAN_TAKE_VERSION,visibleDanTakeItems,danTakeText,rebindDanTake")
edit(p,"uncertainty: '', reason: data.aiConfigured", "uncertainty: '', danTake:data.danTake||rebindDanTake(currentBriefing?.danTake||currentBriefing,data), reason: data.aiConfigured")
edit(p,"const takeItems=visibleDanTakeItems(data,forecast,Date.now());", "const takeItems=visibleDanTakeItems(data.danTake||data,forecast,Date.now());")
edit(p,"async function load({ moveMap = false, refreshModels = false } = {})", "async function load({ moveMap = false, refreshModels = false, briefingRetry = 0 } = {})")
edit(p,"        $('briefing-stamp').textContent = error.status === 409", "        if(error.status===409&&briefingRetry<2){void load({briefingRetry:briefingRetry+1});return;}\n        $('briefing-stamp').textContent = error.status === 409")
edit(p,"' · model run/issuance not supplied'}</span></div>`;", "' · model run/issuance not supplied'}${f.message?` · ${esc(f.message)}`:''}</span></div>`;")
edit(p,"'Hidden: no approved, dated, still-upcoming change is available from the current local discussion.'", "'Hidden: '+(data.danTakeStatus==='discussion-not-current'?'the local discussion is missing or stale.':data.danTakeStatus==='no-explicit-future-change'?'the current discussion identifies no dated upcoming uncertainty.':data.reason||'the current discussion has not produced an approved explanation yet.')")
edit(p,"./dans-take.js?v=integrity-v2","./dans-take.js?v=source-v3")
edit('public/weather-fusion/index.html','app.js?v=integrity-v2','app.js?v=source-v3')
edit('test/weatherFusionForecastDetails.test.js',r'app\.js\?v=integrity-v2',r'app\.js\?v=source-v3')
# Regress the actual production DOM during refresh, failure, reload and source change.
p=root/'scripts/weatherFusionPersonalBrowser.js';s=p.read_text();anchor=" const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();"
assert s.count(anchor)==1
s=s.replace(anchor,r''' // The card must survive ordinary numerical refreshes and a failed or late
 // general briefing while the exact same current source remains valid.
 for(const width of [390,1365]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  await page.addInitScript(time=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};},epoch);
  await page.route('https://unpkg.com/**',r=>r.fulfill({body:'',contentType:r.request().url().includes('.css')?'text/css':'application/javascript'}));
  let version=0,mode='success',forecastRequests=0,briefingRequests=0,held=null;
  const sample=()=>{
   const f=fixture('knightdale');f.signature='lifecycle-'+version;
   if(mode==='new-source'||mode==='quiet')f.discussion={...f.discussion,id:'different-discussion',text:mode==='quiet'?'.DISCUSSION...\nDry weather is expected today.':f.discussion.text};
   const c=collectDanTakeEvidence(f,epoch).candidates;
   const b={mode:'ai',signature:f.signature,generatedAt:f.assembledAt,headline:'Local outlook',summary:'The regular forecast is available.',nearTerm:'The hourly forecast remains available.',extended:'See the week ahead.',sources:['nws','afd'],...approveDanTake(c.map(c=>({evidenceId:c.id,summary:'Rain could arrive earlier or later than expected.'})),f,epoch)};
   if(mode==='cached')f.danTake={...b,reused:true};
   return {f,b};
  };
  await page.route('**/api/weather-fusion/forecast?**',r=>{forecastRequests++;return r.fulfill({json:sample().f});});
  await page.route('**/api/weather-fusion/briefing?**',async r=>{
   briefingRequests++;
   if(mode==='slow'){held=r;return;}
   if(mode==='cached')return r.fulfill({status:503,json:{error:'Simulated full-outlook outage'}});
   if(mode==='conflict'&&briefingRequests===1)return r.fulfill({status:409,json:{error:'Forecast changed'}});
   return r.fulfill({json:sample().b});
  });
  page.on('pageerror',e=>report.browserErrors.push(e.message));
  await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!document.querySelector('#today-uncertainty').hidden);
  const expected=await page.locator('#today-uncertainty-text').textContent();assert.ok(expected);
  mode='slow';version++;await page.locator('#refresh').click();
  while(!held)await page.waitForTimeout(20);
  assert.equal(await page.locator('#today-uncertainty').isVisible(),true,'A numerical refresh must not erase a current-source take while AI is pending');
  assert.equal(await page.locator('#today-uncertainty-text').textContent(),expected);
  await held.fulfill({status:503,json:{error:'Simulated outage'}});held=null;
  await page.waitForTimeout(100);assert.equal(await page.locator('#today-uncertainty').isVisible(),true);
  mode='cached';version++;await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#today-uncertainty').isVisible(),true,'Reload immediately renders the cached, revalidated source take without a successful full outlook');
  mode='quiet';version++;await page.locator('#refresh').click();await page.waitForTimeout(500);
  assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'A different quiet discussion invalidates the prior card');
  mode='conflict';version++;forecastRequests=0;briefingRequests=0;await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>!document.querySelector('#today-uncertainty').hidden);
  assert.equal(briefingRequests,2,'A forecast-signature conflict is retried once, not silently ignored until manual refresh');
  assert.equal(forecastRequests,2);
  (report.danTakeLifecycleChecks??=[]).push({width,pendingRefreshRetained:true,failedBriefingRetained:true,reloadRetained:true,newQuietSourceCleared:true,signatureConflictRecovered:true});
  await context.close();
 }
'''+anchor);p.write_text(s)
print('Applied source freshness and card lifecycle repair; temperature, maps and physical calculations unchanged.')
