import test from 'node:test';
import assert from 'node:assert/strict';
import {DAN_TAKE_VERSION,discussionPeriod,explicitForecastUncertainty,collectDanTakeEvidence,approveDanTake,visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
const now=Date.parse('2026-09-07T16:00:00Z'),H=3600000;
function forecast(text,issued='2026-09-07T14:00:00Z',patch={}){
 return {signature:'test-current-source',location:{latitude:35.787,longitude:-78.4806,timeZone:'America/New_York',office:'RAH'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd-test',office:'RAH',issuanceTime:issued,text},...patch};
}
const upcoming='.LONG TERM /THURSDAY THROUGH FRIDAY/...\nThursday into Friday, model differences leave the front arrival timing uncertain.\n';
const paraphrase='The front could arrive earlier or later than expected.';
function briefing(f,time=now){const c=collectDanTakeEvidence(f,time);const take=approveDanTake(c.candidates.map(c=>({evidenceId:c.id,summary:paraphrase})),f,time);return {mode:'ai',signature:f.signature,...take,uncertainty:danTakeText(take.forecastChanges)};}

test('the reported yesterday-front-and-storms case produces no card',()=>{
 const f=forecast('.DISCUSSION...\nThe front passed through yesterday. Rain and storms were widespread yesterday and timing was uncertain.\nHigh confidence in dry weather today.');
 assert.deepEqual(collectDanTakeEvidence(f,now).candidates,[]);
 assert.equal(briefing(f).uncertainty,'');
 assert.deepEqual(visibleDanTakeItems({mode:'ai',signature:f.signature,uncertainty:'Timing of the front and exactly how widespread rain and storms will be are the main sources of forecast uncertainty.'},f,now),[]);
});
for(const text of ['Scattered showers are possible today.','A front will move through tomorrow with rain and storms.','High confidence in the temperature forecast today.','There is little uncertainty in the forecast today.','The weather pattern changes on Wednesday.']){
 test('ordinary predictions do not manufacture forecast uncertainty: '+text,()=>{
  assert.deepEqual(collectDanTakeEvidence(forecast('.DISCUSSION...\n'+text),now).candidates,[]);
 });
}
test('an explicit later-week uncertainty is kept and dated, not limited to today',()=>{
 const f=forecast(upcoming),b=briefing(f);
 assert.equal(b.danTakeVersion,DAN_TAKE_VERSION);assert.equal(b.forecastChanges.length,1);
 assert.match(b.uncertainty,/Thursday, Sep 10.*Friday, Sep 11/s);
 assert.equal(b.forecastChanges[0].sourceQuote,'Thursday into Friday, model differences leave the front arrival timing uncertain.');
 assert.equal(visibleDanTakeItems(b,f,now).length,1);
});
test('expired retained near-term section is removed while the later week remains',()=>{
 const f=forecast('.NEAR TERM /THROUGH SUNDAY/...\nAs of 200 PM EDT Sunday...\nThe timing of the front and storm coverage is uncertain today.\n\n'+upcoming);
 const c=collectDanTakeEvidence(f,now).candidates;
 assert.equal(c.length,1);assert.equal(c[0].section,'LONG TERM');assert.ok(!c[0].quote.includes('today'));
});
test('a fresh product does not redatestamp the section retained from yesterday',()=>{
 const f=forecast('.DISCUSSION...\nAs of 1100 PM EDT Sunday...\nThe timing of rain is uncertain today.');
 assert.deepEqual(collectDanTakeEvidence(f,now).candidates,[]);
});
test('tomorrow is anchored to the section issuance, not the current retrieval date',()=>{
 const f=forecast('.SHORT TERM /MONDAY/...\nAs of 1100 PM EDT Sunday...\nThe timing of the front is uncertain tomorrow.');
 const c=collectDanTakeEvidence(f,now).candidates;
 assert.equal(c.length,1);assert.match(c[0].period,/Monday, Sep 7/);assert.ok(!c[0].period.includes('Tuesday'));
});
test('earlier morning uncertainty expires before afternoon even in a fresh AFD',()=>{
 const f=forecast('.NEAR TERM /TODAY/...\nFog clearing time is uncertain this morning.');
 assert.deepEqual(collectDanTakeEvidence(f,now).candidates,[]);
});
test('ambiguous undated uncertainty is omitted rather than assigned to today',()=>{
 const f=forecast('.DISCUSSION...\nThe timing of the front is uncertain.');
 assert.deepEqual(collectDanTakeEvidence(f,now).candidates,[]);
});
test('multiple actual changes are dated chronologically across the week',()=>{
 const f=forecast('.SHORT TERM /TUESDAY/...\nThe timing of the front remains uncertain Tuesday.\n\n'+upcoming);
 const b=briefing(f);assert.equal(b.forecastChanges.length,2);
 assert.match(b.forecastChanges[0].period,/Tuesday, Sep 8/);assert.match(b.forecastChanges[1].period,/Thursday, Sep 10/);
});
test('conditional forecast revisions qualify but ordinary may-rain wording does not',()=>{
 assert.equal(explicitForecastUncertainty('If clouds clear sooner Tuesday, temperatures could be warmer than forecast.'),true);
 assert.equal(explicitForecastUncertainty('There may be rain Tuesday.'),false);
});
test('AI cannot invent a front or storms from fog or temperature evidence',()=>{
 const f=forecast('.SHORT TERM /TUESDAY/...\nFog clearing time is uncertain Tuesday morning.');
 const id=collectDanTakeEvidence(f,now).candidates[0].id;
 assert.equal(approveDanTake([{evidenceId:id,summary:paraphrase}],f,now).forecastChanges.length,0);
 assert.equal(approveDanTake([{evidenceId:id,summary:'Fog may clear earlier or later than expected.'}],f,now).forecastChanges.length,1);
});
for(const invalid of ['no-such-excerpt','__proto__'])test('unrecognized evidence ID stays hidden: '+invalid,()=>{
 assert.equal(approveDanTake([{evidenceId:invalid,summary:paraphrase}],forecast(upcoming),now).forecastChanges.length,0);
});
for(const bad of ['Forecasts can change, especially the timing of showers.','No major forecast uncertainty stands out.','A front will arrive at 4pm.','<img src=x onerror=alert(1)>','Tomorrow the front could arrive later.'])test('reject unsupported, generic, relative-time or executable paraphrase: '+bad,()=>{
 const f=forecast(upcoming),id=collectDanTakeEvidence(f,now).candidates[0].id;
 assert.equal(approveDanTake([{evidenceId:id,summary:bad}],f,now).forecastChanges.length,0);
});
test('missing/stale/foreign-office discussions fail closed',()=>{
 for(const f of [forecast(upcoming,'2026-09-06T12:00:00Z'),forecast(upcoming,'2026-09-07T17:00:00Z'),forecast(upcoming,undefined,{discussion:null}),forecast(upcoming,undefined,{feeds:[{id:'afd',status:'stale'}]}),forecast(upcoming,undefined,{location:{latitude:39,longitude:-104,timeZone:'America/Denver',office:'BOU'}})])assert.deepEqual(collectDanTakeEvidence(f,now).candidates,[]);
});
test('browser rejects old quote, changed source, changed location and unverified legacy prose',()=>{
 const f=forecast(upcoming),b=briefing(f);
 assert.deepEqual(visibleDanTakeItems({...b,signature:'another-forecast'},f,now),[]);
 assert.deepEqual(visibleDanTakeItems(b,{...f,discussion:{...f.discussion,id:'new-afd'}},now),[]);
 assert.deepEqual(visibleDanTakeItems(b,{...f,discussion:{...f.discussion,text:upcoming.replace('uncertain','certain')}},now),[]);
 assert.deepEqual(visibleDanTakeItems(b,{...f,location:{...f.location,latitude:34.6385}},now),[]);
 assert.deepEqual(visibleDanTakeItems({...b,danTakeVersion:undefined},f,now),[]);
 assert.deepEqual(visibleDanTakeItems({...b,mode:'nws-summary'},f,now),[]);
});
test('open-page and cached takes expire at the event end without waiting for a new forecast',()=>{
 const before=Date.parse('2026-09-07T15:59:00Z'),f=forecast('.NEAR TERM /TODAY/...\nThe front arrival timing is uncertain this morning.');
 const b=briefing(f,before);assert.equal(b.forecastChanges.length,1);
 assert.equal(visibleDanTakeItems(b,f,before).length,1);
 assert.equal(visibleDanTakeItems(b,f,Date.parse('2026-09-07T16:00:00Z')).length,0);
});
test('twelve-hour source-age ceiling applies even to later-week concerns',()=>{
 const f=forecast(upcoming),b=briefing(f);assert.equal(visibleDanTakeItems(b,f,Date.parse(f.discussion.issuanceTime)+12*H).length,0);
});
test('location timezone, midnight, DST and year rollover preserve the source day',()=>{
 const t=Date.parse('2026-09-08T05:30:00Z');
 const r=discussionPeriod('today',t,'America/Denver');assert.equal(r.end,Date.parse('2026-09-08T06:00:00Z'));
 const dst=discussionPeriod('today',Date.parse('2026-11-01T04:30:00Z'),'America/New_York');assert.equal(dst.end-dst.start,25*H);
 const year=discussionPeriod('tomorrow',Date.parse('2026-12-31T20:00:00Z'),'America/New_York');assert.equal(year.start,Date.parse('2027-01-01T05:00:00Z'));
});
test('explicit until-six-am period ends at six, not the following midnight',()=>{
 const r=discussionPeriod('THROUGH 6 AM TUESDAY',now,'America/New_York');assert.equal(r.end,Date.parse('2026-09-08T10:00:00Z'));
});

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
