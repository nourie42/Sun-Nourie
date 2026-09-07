from pathlib import Path

def edit(path,old,new):
 p=Path(path);s=p.read_text()
 assert s.count(old)==1,(path,s.count(old),old[:100])
 p.write_text(s.replace(old,new))

p='public/weather-fusion/dans-take.js'
edit(p,'weather-nourie-dans-take-integrity-v1','weather-nourie-dans-take-integrity-v2')
edit(p,r'    || /\bif\b[^.!?]{8,180}',r'''    || /\b(?:GFS|ECMWF|HRRR|NAM|NBM|GEFS|EPS)\b[^.!?]{0,110}\b(?:faster|slower|earlier|later|warmer|cooler|wetter|drier|farther|further)\b[^.!?]{0,110}\b(?:while|than|but|whereas)\b/i.test(s)
    || /\b(?:remains to be seen|not yet clear|not clear yet|still unclear)\b[^.!?]{0,130}\b(?:rain|QPF|precip|front|cloud|fog|wind|temp|timing|coverage)\w*/i.test(s)
    || /\bif\b[^.!?]{8,180}''')
edit(p,r"  if(/\b(yesterday|last night|earlier today|today|tonight|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(text))return false; // server supplies the dated period",r'''  if(/\b(yesterday|last night|earlier today|today|tonight|tomorrow)\b/i.test(text))return false;
  // A day explicitly present in the verified period is supported. An unrelated
  // weekday is rejected; ambiguous relative dates still come only from code.
  const mentioned=[...text.matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi)].map(m=>m[1].toLowerCase());
  if(mentioned.some(day=>!candidate.period.toLowerCase().includes(day)))return false;''')
edit(p,"  const evidence=/front|boundary|rain|storm|thunder|convec|cloud|fog|temp|wind|snow|warm|cool|highs|lows/i.test(candidate.quote)?candidate.quote:candidate.context;",r'''  // The adjacent sentences are part of the supplied, exact AFD excerpt. Using
  // only the middle sentence wrongly rejected a plain-English rain paraphrase
  // of 'front timing / PoPs / QPF'. Never borrow a phenomenon from a past recap.
  const evidence=norm([candidate.quote,...candidate.context.split(/(?<=[.!?])\s+/).filter(s=>!past(s))].join(' '));''')
edit(p,'/rain|precip|shower|convec/i','/rain|precip|shower|convec|PoPs|QPF/i')
edit(p,'const context=collectDanTakeEvidence(data,now),seen=new Set(),items=[];','const context=collectDanTakeEvidence(data,now),seen=new Set(),items=[],rejected=[];')
edit(p,"    if(!c||seen.has(c.id)||!acceptableParaphrase(proposal.summary,c))continue;", "    if(!c||seen.has(c.id)||!acceptableParaphrase(proposal.summary,c)){rejected.push({evidenceId:String(proposal?.evidenceId||'').slice(0,60),reason:!c?'unknown-evidence':seen.has(c.id)?'duplicate':'unsupported-paraphrase'});continue;}")
edit(p,'return {danTakeVersion:DAN_TAKE_VERSION,danTakeSource:context.source,','return {danTakeVersion:DAN_TAKE_VERSION,danTakeReview:{candidateCount:context.candidates.length,proposedCount:Array.isArray(proposals)?proposals.length:0,approvedCount:items.length,rejected},danTakeSource:context.source,')
edit('public/weather-fusion/app.js','./dans-take.js?v=integrity-v1','./dans-take.js?v=integrity-v2')
edit('public/weather-fusion/index.html','app.js?v=integrity-v1','app.js?v=integrity-v2')
edit('test/weatherFusionForecastDetails.test.js',r'app\.js\?v=integrity-v1',r'app\.js\?v=integrity-v2')
# A green live run must now prove an actual positive AI card when eligible source
# concerns exist, not merely verify that all cards were safely hidden.
p='scripts/verifyWeatherIntegrityLive.js'
edit(p,'DAN_TAKE_VERSION,visibleDanTakeItems,danTakeText','DAN_TAKE_VERSION,collectDanTakeEvidence,visibleDanTakeItems,danTakeText')
edit(p,"  const items=visibleDanTakeItems(b,f,Date.now()),text=danTakeText(items);", "  const evidence=collectDanTakeEvidence(f,Date.now());\n  const items=visibleDanTakeItems(b,f,Date.now()),text=danTakeText(items);")
edit(p,"aiMode:b?.mode||null,aiReason:b?.reason||null,danTake:text,", "aiMode:b?.mode||null,aiReason:b?.reason||null,danTakeStatus:b?.danTakeStatus||null,danTakeReview:b?.danTakeReview||null,candidateCount:evidence.candidates.length,danTake:text,")
edit(p,' report.success=true;', " report.visibleChangeCount=report.locations.reduce((sum,row)=>sum+row.approvedChanges.length,0);\n if(report.locations.some(row=>row.candidateCount>0))assert.ok(report.visibleChangeCount>0,'Actual current discussion candidates must yield a verified, meaningful AI take somewhere, not just hidden cards');\n report.success=true;")
print('Applied source-context and source-verified date support; thermal/radiation code unchanged.')
