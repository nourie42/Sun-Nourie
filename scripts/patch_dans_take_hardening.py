from pathlib import Path

def change(path,old,new):
 p=Path(path);s=p.read_text()
 if s.count(old)!=1:raise RuntimeError(f'{path}: expected one anchor, found {s.count(old)}: {old[:100]}')
 p.write_text(s.replace(old,new))

p='public/weather-fusion/dans-take.js'
change(p,"weather-nourie-dans-take-v2","weather-nourie-dans-take-v3")
change(p,"  let first=found[0],last=found.at(-1);\n  if(last.start<first.start&&found.length>1){\n    const p=localParts(last.start,zone);last=partRange(addDays(p.date,7),last.part,zone);\n  }", "  // Alternatives can be stated out of order: Friday vs Thursday night is\n  // Thursday–Friday, not Friday alone or an invented extra week.\n  const first=found.reduce((a,b)=>a.start<=b.start?a:b);\n  const last=found.reduce((a,b)=>a.end>=b.end?a:b);")
change(p,"    || /\\bif\\b[^.!?]{8,180}", "    || /\\b(?:GFS|ECMWF|HRRR|NAM|NBM|GEFS|EPS)\\b[^.!?]{0,110}\\b(?:faster|slower|earlier|later|warmer|cooler|wetter|drier|farther|further)\\b[^.!?]{0,110}\\b(?:while|than|but|whereas)\\b/i.test(s)\n    || /\\b(?:remains to be seen|not yet clear|not clear yet|still unclear|adjustments? may be needed)\\b/i.test(s)\n    || /\\bif\\b[^.!?]{8,180}")
change(p,"  if(/\\b(yesterday|last night|earlier today|today|tonight|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\b/i.test(text))return false; // server supplies the dated period", "  if(/\\b(yesterday|last night|earlier today|today|tonight|tomorrow)\\b/i.test(text))return false; // never ambiguous relative dates\n  const mentioned=[...text.matchAll(/\\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\b/gi)].map(m=>m[1].toLowerCase());\n  if(mentioned.some(day=>!candidate.period.toLowerCase().includes(day)))return false;")
change(p,"  const evidence=/front|boundary|rain|storm|thunder|convec|cloud|fog|temp|wind|snow|warm|cool|highs|lows/i.test(candidate.quote)?candidate.quote:candidate.context;", "  // Context is part of the exact excerpt, but yesterday's recap cannot\n  // supply a weather phenomenon absent from the actual upcoming concern.\n  const evidence=norm([candidate.quote,...candidate.context.split(/(?<=[.!?])\\s+/).filter(s=>!past(s))].join(' '));")
change(p,"/rain|precip|shower|convec/i", "/rain|precip|shower|convec|PoPs|QPF/i")
change(p,"  const context=collectDanTakeEvidence(data,now),seen=new Set(),items=[];", "  const context=collectDanTakeEvidence(data,now),seen=new Set(),items=[],rejected=[];")
change(p,"    if(!c||seen.has(c.id)||!acceptableParaphrase(proposal.summary,c))continue;", "    if(!c||seen.has(c.id)||!acceptableParaphrase(proposal.summary,c)){rejected.push({evidenceId:String(proposal?.evidenceId||'').slice(0,60),reason:!c?'unrecognized-evidence':seen.has(c.id)?'duplicate':'paraphrase-validation'});continue;}")
change(p,"return {danTakeVersion:DAN_TAKE_VERSION,danTakeSource:context.source,", "return {danTakeVersion:DAN_TAKE_VERSION,danTakeReview:{candidateCount:context.candidates.length,proposedCount:Array.isArray(proposals)?proposals.length:0,approvedCount:items.length,rejected},danTakeSource:context.source,")

p='src/weatherFusion.js'
change(p,"      properties.sources = { type: 'array', items: { type: 'string', enum: ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm'] } };", "      const requiredSources=['nws','afd',...data.modelContributions.map(m=>m.id)];\n      properties.sources = { type: 'array', items: { type: 'string', enum: requiredSources } };")
change(p,"requiredSources: ['nws','afd',...data.modelContributions.map(m=>m.id)],", "requiredSources,")
p='src/weatherFusionExperience.js'
change(p,"Cite nws and afd plus the model IDs in modelContributions in the sources array,", "The sources array must contain EXACTLY the IDs in requiredSources. Never add a model merely because the AFD mentions its name: an AFD reference is attributed to afd, not a separate model-data source. Cite nws and afd plus only the model IDs in modelContributions in the sources array,")

change('public/weather-fusion/app.js','dans-take.js?v=2-dated','dans-take.js?v=3-dated')
change('public/weather-fusion/index.html','app.js?v=14-dated-dans-take','app.js?v=15-dated-dans-take')
change('test/weatherFusionForecastDetails.test.js','v=14-dated-dans-take','v=15-dated-dans-take')

with Path('test/weatherFusionDansTake.test.js').open('a') as f:f.write(r'''
test('actual RAH wording Friday vs Thursday night retains both dates without rolling a week',()=>{
 const text='There is still some uncertainty with respect to when the front/trough will move through NC (most ensemble guidance suggests Friday vs Thursday night), but we will maintain increased PoPs through the day Friday.';
 const f=forecast('.DISCUSSION...\n'+text);
 const candidates=collectDanTakeEvidence(f,now).candidates;assert.equal(candidates.length,1);
 assert.equal(candidates[0].validFrom,'2026-09-10T22:00:00.000Z');
 assert.equal(candidates[0].eventEnd,'2026-09-12T04:00:00.000Z');
 assert.match(candidates[0].period,/Thursday, Sep 10.*Friday, Sep 11/);
 const b=approveDanTake([{evidenceId:candidates[0].id,summary:'The front could arrive Thursday night or Friday, changing when rain reaches the area.'}],f,now);
 assert.equal(b.forecastChanges.length,1);
 assert.equal(approveDanTake([{evidenceId:candidates[0].id,summary:'The front could arrive Tuesday instead.'}],f,now).forecastChanges.length,0);
});
test('actual BOU model-speed disagreement is an explicit uncertainty for Sunday, not ordinary chance wording',()=>{
 const f=forecast('.DISCUSSION /Through Sunday/...\nOn Sun, an upper level trough moves into the northern Rockies. The GFS is faster with moving a cold front across the area during the day while the ECMWF is slower.');
 const candidates=collectDanTakeEvidence(f,now).candidates;
 assert.equal(candidates.length,1);assert.match(candidates[0].period,/Sunday, Sep 13/);
 assert.equal(approveDanTake([{evidenceId:candidates[0].id,summary:'The front could arrive earlier or later than expected.'}],f,now).forecastChanges.length,1);
});
test('RAH rainfall-amount uncertainty retains its upcoming front period',()=>{
 const f=forecast('.DISCUSSION...\nThe front timing remains uncertain Thursday into Friday. It remains to be seen just how much QPF is realized with the front when it arrives.');
 const candidates=collectDanTakeEvidence(f,now).candidates;
 assert.equal(candidates.length,2);assert.match(candidates[1].period,/Thursday, Sep 10/);
 assert.equal(approveDanTake([{evidenceId:candidates[1].id,summary:'How much rain the front brings is still uncertain.'}],f,now).forecastChanges.length,1);
});
''')

p='scripts/verifyWeatherDansTakeLive.js'
change(p,"aiReason:b.reason||null,takeStatus:", "aiReason:b.reason||null,aiDiagnostic:b.diagnostic||null,review:b.danTakeReview||null,takeStatus:")
change(p,"aiMode:b.mode,visible:!displayed.hidden,items,text", "aiMode:b.mode,diagnostic:b.diagnostic||null,review:b.danTakeReview||null,visible:!displayed.hidden,items,text")
change(p," report.success=true;console.log", " report.actualVisibleChanges=report.locations.reduce((n,r)=>n+r.approvedChanges.length,0);\n assert.ok(report.actualVisibleChanges>0,'Live acceptance must demonstrate a real supported future change, not only hidden cards');\n report.success=true;console.log")
print('Fixed live source attribution and tested real AFD alternative-date/model-disagreement wording.')
