from pathlib import Path

def change(path,old,new):
 p=Path(path);s=p.read_text()
 if s.count(old)!=1:raise RuntimeError(f'{path}: expected one anchor, found {s.count(old)}')
 p.write_text(s.replace(old,new))
p='public/weather-fusion/dans-take.js'
change(p,"|was uncertain|were uncertain|moved through|passed through)","|was uncertain|were uncertain|remained uncertain|uncertainty was|moved through|passed through)")
change(p,"  const issued=Date.parse(d.issuanceTime);", "  try{new Intl.DateTimeFormat('en-US',{timeZone:loc.timeZone}).format(new Date(now));}catch{return null;}\n  const issued=Date.parse(d.issuanceTime);")
change(p,"        const range=discussionPeriod(quote,anchor,zone)||(!past(previous)&&discussionPeriod(previous,anchor,zone))||headingRange;", "        const ownRange=discussionPeriod(quote,anchor,zone);\n        if(!ownRange&&past(previous))continue;\n        const range=ownRange||discussionPeriod(previous,anchor,zone)||headingRange;")
change(p,"  const evidence=candidate.context;", "  const evidence=/front|boundary|rain|storm|thunder|convec|cloud|fog|temp|wind|snow|warm|cool|highs|lows/i.test(candidate.quote)?candidate.quote:candidate.context;")
change(p,"  const verified=(briefing.forecastChanges||[]).filter(item=>{", "  const verified=(Array.isArray(briefing.forecastChanges)?briefing.forecastChanges:[]).filter(item=>{")
change(p,"    const c=candidates.find(c=>c.id===item.evidenceId);", "    const c=candidates.find(c=>c.id===item?.evidenceId);")
with Path('test/weatherFusionDansTake.test.js').open('a') as f:f.write(r'''
test('a pronoun sentence after a yesterday recap cannot inherit todays section dates',()=>{
 const f=forecast('.DISCUSSION...\nYesterday the front arrived. Its timing remained uncertain.');
 assert.deepEqual(collectDanTakeEvidence(f,now).candidates,[]);
 const g=forecast('.NEAR TERM /TODAY/...\nYesterday the storms arrived. Their timing is uncertain.');
 assert.deepEqual(collectDanTakeEvidence(g,now).candidates,[]);
});
test('a preceding front recap cannot license a front claim from a future fog excerpt',()=>{
 const f=forecast('.SHORT TERM /TUESDAY/...\nThe front passed through yesterday. Fog clearing time is uncertain Tuesday morning.');
 const c=collectDanTakeEvidence(f,now).candidates;assert.equal(c.length,1);
 assert.equal(approveDanTake([{evidenceId:c[0].id,summary:paraphrase}],f,now).forecastChanges.length,0);
});
test('malformed cached items and invalid timezones hide the take instead of crashing',()=>{
 const f=forecast(upcoming),b=briefing(f);
 assert.deepEqual(visibleDanTakeItems({...b,forecastChanges:{}},f,now),[]);
 assert.deepEqual(visibleDanTakeItems({...b,forecastChanges:[null]},f,now),[]);
 assert.deepEqual(collectDanTakeEvidence({...f,location:{...f.location,timeZone:'invalid'}},now).candidates,[]);
});
''')
print('Hardened historical context, topic support and malformed cache handling.')
