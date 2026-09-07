from pathlib import Path

def change(path,old,new):
 p=Path(path);s=p.read_text()
 if s.count(old)!=1:raise RuntimeError(f'{path}: expected one anchor, found {s.count(old)}: {old[:90]}')
 p.write_text(s.replace(old,new))

path='public/weather-fusion/dans-take.js'
change(path,"if(/\\b(yesterday|last night|earlier today|today|tonight|tomorrow)\\b/i.test(text))return false;", "if(/\\b(yesterday|last night|earlier today|today|tonight|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\b/i.test(text))return false;")
path='public/weather-fusion/app.js'
change(path,"Sources used: ${refs.join(' · ') || 'Waiting for the local outlook'}</p>`;", "Sources used: ${refs.join(' · ') || 'Waiting for the local outlook'}</p><p>Dan's take: ${takeItems.length?'Only the following explicitly supported, still-upcoming discussion changes are displayed.':'Hidden: no approved, dated, still-upcoming change is available from the current local discussion.'}</p>${takeItems.map(item=>`<details><summary>${esc(item.period)} · source evidence</summary><p>${esc(item.sourceQuote)}</p><p>Original section: ${esc(item.section)} · issued ${esc(clock(item.sectionIssuedAt,{month:'short',day:'numeric'}))}. Applies through ${esc(clock(item.eventEnd,{month:'short',day:'numeric'}))}.</p></details>`).join('')}`;")

path='scripts/weatherFusionPersonalBrowser.js'
change(path,"import {rebuildHourlyFeels}","import {collectDanTakeEvidence,approveDanTake,danTakeText} from '../public/weather-fusion/dans-take.js';\nimport {rebuildHourlyFeels}")
change(path,"text:'Rain may be widespread in the region this afternoon.'", "text:'.NEAR TERM /TODAY/...\\nThe timing of afternoon rain is uncertain this afternoon.'")
change(path," if(req.params.kind==='briefing')return res.json({signature:f.signature,mode:'ai',generatedAt:f.assembledAt,headline:'Local outlook',summary:'Warm with rain possible.',uncertainty:`Rain timing could change around ${f.location.name}.`,nearTerm:'Clouds tonight.',extended:'A warmer week.',sources:['nws','afd']});", " if(req.params.kind==='briefing'){const candidates=collectDanTakeEvidence(f,epoch).candidates;const take=approveDanTake(candidates.map(c=>({evidenceId:c.id,summary:`Rain could arrive earlier or later around ${f.location.name}.`})),f,epoch);return res.json({signature:f.signature,mode:'ai',generatedAt:f.assembledAt,headline:'Local outlook',summary:'Warm with rain possible.',...take,uncertainty:danTakeText(take.forecastChanges),nearTerm:'Clouds tonight.',extended:'A warmer week.',sources:['nws','afd']});}")
anchor=" const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();"
new=r''' // Render the actual entire production page, not a screenshot-only mock.
 for(const width of [320,390,1365]){
  const takeNow=Date.parse('2026-09-07T16:00:00Z');
  for(const [name,text,expected,at] of [
   ['yesterday-front','.DISCUSSION...\nThe front passed through yesterday. Storm timing was uncertain yesterday.\nDry weather is expected today.',0,takeNow],
   ['routine-chance','.DISCUSSION...\nScattered rain and storms are possible Tuesday.',0,takeNow],
   ['undated','.DISCUSSION...\nThe timing of the front is uncertain.',0,takeNow],
   ['later-week','.LONG TERM /THURSDAY THROUGH FRIDAY/...\nThe timing of the front remains uncertain Thursday into Friday.',1,takeNow],
   ['retained-yesterday','.NEAR TERM /THROUGH SUNDAY/...\nAs of 200 PM EDT Sunday...\nThe timing of the front is uncertain today.\n\n.LONG TERM /THURSDAY THROUGH FRIDAY/...\nThe front timing remains uncertain Thursday into Friday.',1,takeNow],
   ['cloud-temperature','.LONG TERM /THURSDAY/...\nIf clouds clear sooner Thursday, temperatures could be warmer than forecast.',1,takeNow],
   ['expires-on-open-page','.NEAR TERM /TODAY/...\nThe timing of the front remains uncertain this morning.',1,takeNow-60000]
  ]){
   const make=(place='knightdale')=>{
    const f=fixture(place);f.signature='dated-'+name+'-'+place;f.assembledAt=new Date(at).toISOString();
    f.discussion={...f.discussion,issuanceTime:'2026-09-07T14:00:00Z',text:place==='greenville'?'.DISCUSSION...\nDry weather is expected this week.':text};
    const candidates=collectDanTakeEvidence(f,at).candidates;
    const take=approveDanTake(candidates.map(c=>({evidenceId:c.id,summary:name==='cloud-temperature'?'Earlier cloud clearing could make temperatures warmer than expected.':'The front could arrive earlier or later than expected.'})),f,at);
    const b={mode:'ai',signature:f.signature,generatedAt:new Date(at).toISOString(),headline:'Local outlook',summary:'The main forecast remains available.',nearTerm:'Check the hourly forecast.',extended:'Check the week ahead.',sources:['nws','afd'],...take,uncertainty:'Timing of the front and storms are the main sources of forecast uncertainty.'};
    return {f,b};
   };
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   await page.addInitScript(time=>{window.__takeNow=time;const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__takeNow]));}static now(){return window.__takeNow;}};},at);
   await page.route('https://unpkg.com/**',r=>r.fulfill({body:'',contentType:r.request().url().includes('.css')?'text/css':'application/javascript'}));
   await page.route('**/api/weather-fusion/forecast?**',r=>r.fulfill({json:make(new URL(r.request().url()).searchParams.get('location')||'knightdale').f}));
   await page.route('**/api/weather-fusion/briefing?**',r=>r.fulfill({json:make(new URL(r.request().url()).searchParams.get('location')||'knightdale').b}));
   page.on('pageerror',e=>report.browserErrors.push(e.message));
   await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.querySelector('#briefing-title').textContent==='Local outlook');
   assert.equal(await page.locator('#today-uncertainty').isVisible(),expected>0,name+' conditional visibility');
   assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),expected?1:0);
   const shown=(await page.locator('#today-uncertainty-text').textContent()).trim();
   assert.equal(shown,danTakeText(make().b.forecastChanges));
   assert.ok(!/yesterday|main sources of forecast uncertainty|Forecasts can change/i.test(shown));
   if(expected){
    assert.match(shown,/(?:Monday|Thursday), Sep (?:7|10)/);
    assert.ok(await page.locator('#today-uncertainty').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }
   if(name==='expires-on-open-page'){
    await page.evaluate(time=>{window.__takeNow=time;document.dispatchEvent(new Event('visibilitychange'));},takeNow);
    assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'Passed morning auto-expires on return to page');
    assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0);
   }
   if(width===390&&name==='later-week')await page.locator('.today-panel').screenshot({path:dir+'/dans-take-dated-390.png'});
   await page.locator('[data-place="greenville"]').click();
   assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'Old location take clears immediately');
   await page.waitForFunction(()=>document.querySelector('#briefing-title').textContent==='Local outlook');
   assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'Quiet new location does not inherit prior concern');
   (report.danTakeChecks??=[]).push({name,width,expectedItems:expected,datedSourceOnly:true,legacyTextIgnored:true,locationReset:true,expiry:name==='expires-on-open-page'});
   await context.close();
  }
 }
'''+anchor
change(path,anchor,new)
print('Added full-page dated-take browser scenarios and source evidence details.')
