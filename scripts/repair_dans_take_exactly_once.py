from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected text not found in {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1))


def replace_all(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected text not found in {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new))

# Bump the contract so cached v3 takes cannot survive the exact-one UI change.
replace_once(
    'public/weather-fusion/dans-take.js',
    "export const DAN_TAKE_VERSION = 'weather-nourie-dans-take-source-v3';",
    "export const DAN_TAKE_VERSION = 'weather-nourie-dans-take-source-v4';",
)

# The body is content only. Strip any AI-added label, with/without apostrophe,
# straight/curly apostrophes, and common label punctuation before grouping.
replace_once(
    'public/weather-fusion/dans-take.js',
    """export function danTakeText(items){
  const groups=new Map();
  for(const item of Array.isArray(items)?items:[]){
    if(!item?.period||!item?.summary)continue;
    if(!groups.has(item.period))groups.set(item.period,[]);
    const list=groups.get(item.period),key=item.summary.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if(!list.some(entry=>entry.key===key))list.push({key,text:item.summary.trim()});
  }
  return [...groups].map(([period,list])=>`${period}: ${list.map(x=>x.text).join(' ')}`).join('\\n\\n');
}""",
    """export function danTakeText(items){
  const groups=new Map();
  const cleanSummary=value=>norm(value).replace(/^(?:dan\\s*['’]?\\s*s\\s+take\\b\\s*[:\\-—–.]?\\s*)+/i,'').trim();
  for(const item of Array.isArray(items)?items:[]){
    if(!item?.period||!item?.summary)continue;
    const summary=cleanSummary(item.summary);if(!summary)continue;
    if(!groups.has(item.period))groups.set(item.period,[]);
    const list=groups.get(item.period),key=summary.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if(!list.some(entry=>entry.key===key))list.push({key,text:summary});
  }
  return [...groups].map(([period,list])=>`${period}: ${list.map(x=>x.text).join(' ')}`).join('\\n\\n');
}""",
)

# Cache-bust the browser module contract.
replace_once(
    'public/weather-fusion/app.js',
    "from './dans-take.js?v=ui-requests-v1';",
    "from './dans-take.js?v=dans-take-once-v1';",
)

# Always render one Today-card heading. Content may be a verified take or a
# neutral status message, but never another heading embedded in the body.
replace_once(
    'public/weather-fusion/app.js',
    "  const uncertainty=danTakeText(takeItems);\n",
    """  const uncertainty=danTakeText(takeItems);
  const takeDisplay=uncertainty||(data.mode==='ai'
    ?'No additional forecast changes to call out right now.'
    :/prepar|updat/i.test(`${data.headline||''} ${data.reason||''}`)
      ?'Checking the latest forecast discussion…'
      :'No additional take is available right now.');
""",
)
replace_once(
    'public/weather-fusion/app.js',
    """  $('briefing-detail').innerHTML = `<div><strong>Tonight & tomorrow</strong><p>${esc(data.nearTerm || 'See the hourly forecast below.')}</p></div><div><strong>The week ahead</strong><p>${esc(data.extended || 'More details will appear with the next update.')}</p></div>${uncertainty?`<div data-dans-take><strong>Dan's take</strong><p style=\"white-space:pre-line\">${esc(uncertainty)}</p></div>`:''}`;
""",
    """  $('briefing-detail').innerHTML = `<div><strong>Tonight & tomorrow</strong><p>${esc(data.nearTerm || 'See the hourly forecast below.')}</p></div><div><strong>The week ahead</strong><p>${esc(data.extended || 'More details will appear with the next update.')}</p></div>`;
""",
)
replace_once(
    'public/weather-fusion/app.js',
    """  // Reuse the same outlook uncertainty below today's graphic, including refresh/reset.
  // Never render legacy free text: only source-bound, unexpired, approved items.
  const todayUncertainty = $('today-uncertainty'), todayUncertaintyText = $('today-uncertainty-text');
  if (todayUncertainty && todayUncertaintyText) {
    todayUncertaintyText.textContent = uncertainty;
    if(todayUncertaintyText.style)todayUncertaintyText.style.whiteSpace='pre-line';
    todayUncertainty.hidden = !uncertainty;
  }
""",
    """  // The Today card owns the single public Dan's take heading. Keep it visible
  // even when there is no approved change, and put only content/status in its body.
  const todayUncertainty = $('today-uncertainty'), todayUncertaintyText = $('today-uncertainty-text');
  if (todayUncertainty && todayUncertaintyText) {
    todayUncertaintyText.textContent = takeDisplay;
    if(todayUncertaintyText.style)todayUncertaintyText.style.whiteSpace='pre-line';
    todayUncertainty.hidden = false;
  }
""",
)
replace_once(
    'public/weather-fusion/app.js',
    "<p>Dan's take: ${takeItems.length?'Only the following explicitly supported, still-upcoming discussion changes are displayed.':'Hidden: '+",
    "<p>Take status: ${takeItems.length?'The following explicitly supported, still-upcoming discussion changes are displayed.':'No displayed change: '+",
)

# One heading exists in the HTML from first paint, not only after an AI response.
replace_once(
    'public/weather-fusion/index.html',
    '<script type="module" src="/weather-fusion/app.js?v=ui-requests-v1"></script>',
    '<script type="module" src="/weather-fusion/app.js?v=dans-take-once-v1"></script>',
)
replace_once(
    'public/weather-fusion/index.html',
    '<div id="today-uncertainty" class="today-uncertainty" hidden>\n            <strong class="today-uncertainty-label">Dan\'s take</strong>\n            <p id="today-uncertainty-text"></p>',
    '<div id="today-uncertainty" class="today-uncertainty">\n            <strong class="today-uncertainty-label">Dan\'s take</strong>\n            <p id="today-uncertainty-text">Checking the latest forecast discussion…</p>',
)

# Unit renderer expectations: exactly one visible heading; no duplicate full-outlook section.
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    """test('optional take remains below daily graphic and ahead of hourly forecast',()=>{
 const panel=html.match(/<section class=\"glass today-panel\"[^>]*>([\\s\\S]*?)<\\/section>/)?.[1];
 assert.ok(panel);assert.ok(panel.indexOf('id=\"today-forecast\"')<panel.indexOf('id=\"today-uncertainty\"'));
 assert.match(panel,/id=\"today-uncertainty\"[^>]*hidden/);
 assert.match(panel,/<strong class=\"today-uncertainty-label\">Dan's take<\\/strong>/);
 assert.match(html,/<\\/section>\\s*<section class=\"glass hourly-panel\"/);
 for(const id of ['today-forecast','today-uncertainty','today-uncertainty-text','hourly'])assert.equal(html.split(`id=\"${id}\"`).length-1,1);
});""",
    """test('exactly one Dan take heading stays below daily graphic and ahead of hourly forecast',()=>{
 const panel=html.match(/<section class=\"glass today-panel\"[^>]*>([\\s\\S]*?)<\\/section>/)?.[1];
 assert.ok(panel);assert.ok(panel.indexOf('id=\"today-forecast\"')<panel.indexOf('id=\"today-uncertainty\"'));
 assert.doesNotMatch(panel,/id=\"today-uncertainty\"[^>]*hidden/);
 assert.match(panel,/<strong class=\"today-uncertainty-label\">Dan's take<\\/strong>/);
 assert.equal((panel.match(/Dan's take/g)||[]).length,1);
 assert.match(panel,/Checking the latest forecast discussion/);
 assert.match(html,/<\\/section>\\s*<section class=\"glass hourly-panel\"/);
 for(const id of ['today-forecast','today-uncertainty','today-uncertainty-text','hourly'])assert.equal(html.split(`id=\"${id}\"`).length-1,1);
});""",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    """test('NWS fallback keeps the normal forecast but never manufactures Dan take',()=>{
 const {elements,render}=harness();
 render({mode:'nws-summary',summary:'Warm with a chance of rain.',uncertainty:'Forecasts can change, especially the timing of showers.'});
 assert.equal(elements['today-uncertainty-text'].textContent,'');assert.equal(elements['today-uncertainty'].hidden,true);
 assert.ok(!elements['briefing-detail'].innerHTML.includes('Dan\\'s take'));
 assert.equal(elements['briefing-summary'].textContent,'Warm with a chance of rain.');
});""",
    """test('NWS fallback keeps one Dan take heading with a neutral status message',()=>{
 const {elements,render}=harness();
 render({mode:'nws-summary',summary:'Warm with a chance of rain.',uncertainty:'Forecasts can change, especially the timing of showers.'});
 assert.equal(elements['today-uncertainty-text'].textContent,'No additional take is available right now.');assert.equal(elements['today-uncertainty'].hidden,false);
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
 assert.equal(elements['briefing-summary'].textContent,'Warm with a chance of rain.');
});""",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    """ render(supported());assert.equal(note.hidden,false);assert.match(elements['today-uncertainty-text'].textContent,/Thursday, Sep 10/);
 assert.ok(elements['briefing-detail'].innerHTML.includes('The front could arrive earlier or later than expected.'));
 render(supported('The front may arrive later than expected.'));
 assert.equal(elements['today-uncertainty'],note);assert.ok(!elements['briefing-detail'].innerHTML.includes('earlier or later'));
 assert.equal(elements['briefing-detail'].innerHTML.split('data-dans-take').length-1,1);
""",
    """ render(supported());assert.equal(note.hidden,false);assert.match(elements['today-uncertainty-text'].textContent,/Thursday, Sep 10/);
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
 render(supported('The front may arrive later than expected.'));
 assert.equal(elements['today-uncertainty'],note);assert.ok(!elements['briefing-detail'].innerHTML.includes('earlier or later'));
 assert.equal(elements['briefing-detail'].innerHTML.split('data-dans-take').length-1,0);
""",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    """for(const uncertainty of [undefined,null,'',' \\n\\t ',42,{},'Yesterday\\'s front might change the forecast.'])test('unverified legacy uncertainty is always hidden: '+JSON.stringify(uncertainty),()=>{
 const {elements,render}=harness();render(supported());render({mode:'ai',signature:source.signature,uncertainty});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
});""",
    """for(const uncertainty of [undefined,null,'',' \\n\\t ',42,{},'Yesterday\\'s front might change the forecast.'])test('unverified legacy uncertainty never becomes take content: '+JSON.stringify(uncertainty),()=>{
 const {elements,render}=harness();render(supported());render({mode:'ai',signature:source.signature,uncertainty});
 assert.equal(elements['today-uncertainty'].hidden,false);assert.equal(elements['today-uncertainty-text'].textContent,'No additional forecast changes to call out right now.');
 assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
});""",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    """ const {elements,render}=harness();render(supported());render({headline:'Preparing your local outlook.',sources:[]});
 assert.equal(elements['today-uncertainty'].hidden,true);assert.equal(elements['today-uncertainty-text'].textContent,'');
""",
    """ const {elements,render}=harness();render(supported());render({headline:'Preparing your local outlook.',sources:[]});
 assert.equal(elements['today-uncertainty'].hidden,false);assert.equal(elements['today-uncertainty-text'].textContent,'Checking the latest forecast discussion…');
""",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    "assert.equal(elements['today-uncertainty'].hidden,true);\n});\ntest('source expiry removes the card and duplicated full-outlook section',",
    "assert.equal(elements['today-uncertainty'].hidden,false);assert.equal(elements['today-uncertainty-text'].textContent,'No additional forecast changes to call out right now.');\n});\ntest('source expiry removes expired content without removing the single heading',",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    """ const {elements,render,setTime}=harness(),b=supported();render(b);setTime(now+12*3600000);render(b);
 assert.equal(elements['today-uncertainty'].hidden,true);assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
""",
    """ const {elements,render,setTime}=harness(),b=supported();render(b);setTime(now+12*3600000);render(b);
 assert.equal(elements['today-uncertainty'].hidden,false);assert.equal(elements['today-uncertainty-text'].textContent,'No additional forecast changes to call out right now.');assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));
""",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    "const b=supported();b.forecastChanges[0].summary='<img src=x onerror=alert(1)>';render(b);assert.equal(elements['today-uncertainty'].hidden,true);",
    "const b=supported();b.forecastChanges[0].summary='<img src=x onerror=alert(1)>';render(b);assert.equal(elements['today-uncertainty'].hidden,false);assert.equal(elements['today-uncertainty-text'].textContent,'No additional forecast changes to call out right now.');",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    " assert.ok(elements['briefing-detail'].innerHTML.includes('data-dans-take'));",
    " assert.ok(!elements['briefing-detail'].innerHTML.includes('data-dans-take'));",
)
replace_once(
    'test/weatherFusionForecastDetails.test.js',
    "assert.match(html,/app\\.js\\?v=ui-requests-v1/);",
    "assert.match(html,/app\\.js\\?v=dans-take-once-v1/);",
)

# Regression for the exact duplicated-prefix screenshot, including missing apostrophe.
replace_once(
    'test/weatherFusionUiRequests.test.js',
    """test('Dan take groups multiple concerns under one period instead of repeating the date heading',()=>{
 const period='This coming week — Thursday, Sep 10 – Friday, Sep 11';
 const text=danTakeText([{period,summary:'The front could arrive earlier or later.'},{period,summary:'The amount of rain is still uncertain.'},{period,summary:'The amount of rain is still uncertain.'}]);
 assert.equal(text.split(period).length-1,1);assert.match(text,/front could arrive/);assert.match(text,/amount of rain/);
});""",
    """test('Dan take groups one period and strips every repeated Dan take label from body text',()=>{
 const period='This coming week — Thursday, Sep 10 – Friday, Sep 11';
 const text=danTakeText([{period,summary:\"Dan's take: The front could arrive earlier or later.\"},{period,summary:'DAN’S TAKE — Dans take: The amount of rain is still uncertain.'},{period,summary:'The amount of rain is still uncertain.'}]);
 assert.equal(text.split(period).length-1,1);assert.match(text,/front could arrive/);assert.match(text,/amount of rain/);
 assert.equal((text.match(/dan\\s*['’]?\\s*s\\s+take/gi)||[]).length,0);
});""",
)

# Responsive fixture suite: the heading is permanent, verified content remains conditional.
replace_all(
    'scripts/weatherFusionPersonalBrowser.js',
    "assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),expected?1:0);",
    "assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0);",
)
replace_once(
    'scripts/weatherFusionPersonalBrowser.js',
    """   assert.equal(await page.locator('#today-uncertainty').isVisible(),expected>0,name+' conditional visibility');
   assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0);
   const shown=(await page.locator('#today-uncertainty-text').textContent()).trim();
   assert.equal(shown,danTakeText(make().b.forecastChanges));
""",
    """   assert.equal(await page.locator('#today-uncertainty').isVisible(),true,name+' keeps the one Dan take heading');
   assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0);
   const shown=(await page.locator('#today-uncertainty-text').textContent()).trim();
   const expectedText=danTakeText(make().b.forecastChanges);
   assert.equal(shown,expectedText||'No additional forecast changes to call out right now.');
""",
)
replace_once(
    'scripts/weatherFusionPersonalBrowser.js',
    """    assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'Passed morning auto-expires on return to page');
    assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0);
""",
    """    assert.equal(await page.locator('#today-uncertainty').isVisible(),true,'Passed morning clears content but keeps one heading on return to page');
    assert.equal((await page.locator('#today-uncertainty-text').textContent()).trim(),'No additional forecast changes to call out right now.');
    assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0);
""",
)
replace_once(
    'scripts/weatherFusionPersonalBrowser.js',
    """   assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'Old location take clears immediately');
   await page.waitForFunction(()=>document.querySelector('#briefing-title').textContent==='Local outlook');
   assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'Quiet new location does not inherit prior concern');
""",
    """   assert.equal(await page.locator('#today-uncertainty').isVisible(),true,'Old location content clears but the one heading remains');
   await page.waitForFunction(()=>document.querySelector('#briefing-title').textContent==='Local outlook');
   assert.equal(await page.locator('#today-uncertainty').isVisible(),true,'Quiet new location keeps one heading without inheriting prior concern');
   assert.equal((await page.locator('#today-uncertainty-text').textContent()).trim(),'No additional forecast changes to call out right now.');
""",
)
replace_once(
    'scripts/weatherFusionPersonalBrowser.js',
    "assert.equal(await page.locator('#today-uncertainty').isVisible(),false,'A different quiet discussion invalidates the prior card');",
    "assert.equal(await page.locator('#today-uncertainty').isVisible(),true,'A different quiet discussion clears prior content but keeps one heading');assert.equal((await page.locator('#today-uncertainty-text').textContent()).trim(),'No additional forecast changes to call out right now.');",
)

# Live verification now checks one permanent heading and zero duplicate full-outlook blocks.
replace_once(
    'scripts/verifyWeatherDansTakeLive.js',
    """  await page.waitForFunction(expected=>document.querySelector('#today-uncertainty-text')?.textContent===expected,text,{timeout:15000});
  const displayed=await page.evaluate(()=>({text:document.querySelector('#today-uncertainty-text').textContent,hidden:document.querySelector('#today-uncertainty').hidden,fullOutlookSections:document.querySelectorAll('#briefing-detail [data-dans-take]').length,overflow:document.documentElement.scrollWidth>innerWidth+1}));
  assert.equal(displayed.hidden,!items.length);assert.equal(displayed.fullOutlookSections,items.length?1:0);assert.equal(displayed.overflow,false);
""",
    """  const expectedText=text||(b.mode==='ai'?'No additional forecast changes to call out right now.':'No additional take is available right now.');
  await page.waitForFunction(expected=>document.querySelector('#today-uncertainty-text')?.textContent===expected,expectedText,{timeout:15000});
  const displayed=await page.evaluate(()=>({text:document.querySelector('#today-uncertainty-text').textContent,hidden:document.querySelector('#today-uncertainty').hidden,headingCount:document.querySelectorAll('.today-uncertainty-label').length,bodyHasLabel:/dan\\s*['’]?\\s*s\\s+take/i.test(document.querySelector('#today-uncertainty-text').textContent),fullOutlookSections:document.querySelectorAll('#briefing-detail [data-dans-take]').length,overflow:document.documentElement.scrollWidth>innerWidth+1}));
  assert.equal(displayed.hidden,false);assert.equal(displayed.headingCount,1);assert.equal(displayed.bodyHasLabel,false);assert.equal(displayed.fullOutlookSections,0);assert.equal(displayed.overflow,false);
""",
)

replace_once(
    'scripts/verifyWeatherIntegrityLive.js',
    """  const items=visibleDanTakeItems(b,f,Date.now()),text=danTakeText(items);
  await page.waitForFunction(()=>document.querySelector('#hourly .hour-current .hour-feels b')&&document.querySelector('.sun-person figcaption strong'),null,{timeout:75000});
  await page.waitForFunction(text=>document.querySelector('#today-uncertainty-text').textContent===text,text,{timeout:20000});
  assert.equal(await page.locator('#today-uncertainty').isVisible(),items.length>0);
  assert.equal((await page.locator('.today-uncertainty-label').textContent()).trim(),\"Dan's take\");
""",
    """  const items=visibleDanTakeItems(b,f,Date.now()),text=danTakeText(items);
  const expectedTake=text||(b?.mode==='ai'?'No additional forecast changes to call out right now.':'No additional take is available right now.');
  await page.waitForFunction(()=>document.querySelector('#hourly .hour-current .hour-feels b')&&document.querySelector('.sun-person figcaption strong'),null,{timeout:75000});
  await page.waitForFunction(text=>document.querySelector('#today-uncertainty-text').textContent===text,expectedTake,{timeout:20000});
  assert.equal(await page.locator('#today-uncertainty').isVisible(),true);
  assert.equal((await page.locator('.today-uncertainty-label').textContent()).trim(),\"Dan's take\");
  assert.equal(await page.locator('.today-uncertainty-label').count(),1);
  assert.equal(await page.locator('#briefing-detail [data-dans-take]').count(),0);
  assert.equal(/dan\\s*['’]?\\s*s\\s+take/i.test(await page.locator('#today-uncertainty-text').textContent()),false);
""",
)
replace_once(
    'scripts/verifyWeatherIntegrityLive.js',
    "assert.ok(report.actualAICount>0,'At least one live AI generation must be verified, not only hidden fallback cards');",
    "assert.ok(report.actualAICount>0,'At least one live AI generation must be verified, not only fallback status text');",
)
replace_once(
    'scripts/verifyWeatherIntegrityLive.js',
    "if(report.locations.some(row=>row.candidateCount>0))assert.ok(report.visibleChangeCount>0,'Actual current discussion candidates must yield a verified, meaningful AI take somewhere, not just hidden cards');",
    "if(report.locations.some(row=>row.candidateCount>0))assert.ok(report.visibleChangeCount>0,'Actual current discussion candidates must yield a verified, meaningful AI take somewhere, not just fallback status text');",
)

print('Applied exact-one Dan take display contract.')
