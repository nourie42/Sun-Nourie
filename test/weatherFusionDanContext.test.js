import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDanTakeEvidence,approveDanTake,visibleDanTakeItems} from '../public/weather-fusion/dans-take.js';
const now=Date.parse('2026-09-07T10:42:00Z');
function data(text,office='RAH'){
 return {signature:'discussion-context-'+office,location:{latitude:office==='RAH'?35.787:39.7392,longitude:office==='RAH'?-78.4806:-104.9903,office,timeZone:office==='RAH'?'America/New_York':'America/Denver'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'verified-'+office,office,issuanceTime:'2026-09-07T09:00:00Z',text}};
}
const rah='.DISCUSSION...\nAs of 300 AM Monday...\n\nAs such we will see increasing shower and storm chances as early as Thursday afternoon within an increasingly unstable pre-frontal airmass. There is still some uncertainty with respect to when the front/trough will move through NC (most ensemble guidance suggests Friday vs Thursday night), but we will continue to maintain increased PoPs through the day Friday given ensemble support. That said the strongest forcing for ascent associated with the trough should be displaced well north of NC and it remains to be seen just how much QPF is realized with the front when it arrives.';
function approved(f,proposals){return {mode:'ai',signature:f.signature,...approveDanTake(proposals,f,now)};}
test('actual Raleigh context supports front/rain timing and uncertain rainfall amount this coming week',()=>{
 const f=data(rah),c=collectDanTakeEvidence(f,now).candidates;
 assert.equal(c.length,2);
 const b=approved(f,[{evidenceId:c[0].id,summary:'The front could arrive earlier or later, shifting when showers and storms reach the area.'},{evidenceId:c[1].id,summary:'The amount of rain is still uncertain because the strongest push for rain may stay north of the area.'}]);
 assert.equal(b.forecastChanges.length,2);assert.equal(b.danTakeReview.rejected.length,0);
 assert.equal(visibleDanTakeItems(b,f,now).length,2);
 for(const item of b.forecastChanges){assert.match(item.period,/This coming week — Thursday.*Friday/);assert.equal(item.validFrom,'2026-09-10T22:00:00.000Z');}
});
test('PoPs and QPF translate to rain without needing the scientific terms in public prose',()=>{
 const f=data('.DISCUSSION...\nFriday frontal timing and PoPs remain uncertain.');
 const c=collectDanTakeEvidence(f,now).candidates[0];
 assert.equal(approved(f,[{evidenceId:c.id,summary:'When the front arrives could change when rain reaches the area.'}]).forecastChanges.length,1);
});
test('supported weekday may be repeated; a fabricated or relative weekday cannot be supplied by AI',()=>{
 const f=data(rah),c=collectDanTakeEvidence(f,now).candidates[0];
 assert.equal(approved(f,[{evidenceId:c.id,summary:'The front may arrive Thursday night or Friday, shifting when the rain arrives.'}]).forecastChanges.length,1);
 for(const summary of ['The front may arrive Tuesday, shifting rain timing.','The front will arrive tomorrow and bring rain.']){
  const b=approved(f,[{evidenceId:c.id,summary}]);assert.equal(b.forecastChanges.length,0);assert.equal(b.danTakeReview.rejected[0].reason,'unsupported-paraphrase');
 }
});
test('named GFS-vs-ECMWF speed difference is a real future uncertainty, with its paragraph date',()=>{
 const f=data('.DISCUSSION /Through Sunday/...\nIssued at 233 AM MDT Mon Sep 7 2026\n\nOn Sun, the flow aloft becomes more SW as an upper level trough moves into the northern Rockies. The GFS is faster with moving a cold front across the area during the day while the ECMWF is slower. The later front could leave the daytime weather warmer.','BOU');
 const c=collectDanTakeEvidence(f,now).candidates;assert.ok(c.length>=1);
 const item=c.find(p=>p.quote.startsWith('The GFS'));assert.ok(item);assert.match(item.period,/This coming week — Sunday, Sep 13/);
 const b=approved(f,[{evidenceId:item.id,summary:'The front could arrive earlier or later, changing when cooler air reaches the area.'}]);
 assert.equal(b.forecastChanges.length,1);
});
test('a prior-day front recap cannot be borrowed to explain next-day fog uncertainty',()=>{
 const f=data('.SHORT TERM /TUESDAY/...\nThe front passed through yesterday. Fog clearing time is uncertain Tuesday morning.');
 const c=collectDanTakeEvidence(f,now).candidates[0];assert.ok(c);
 const b=approved(f,[{evidenceId:c.id,summary:'The front could arrive earlier or later and bring storms.'}]);
 assert.equal(b.forecastChanges.length,0);
 assert.equal(approved(f,[{evidenceId:c.id,summary:'Fog could clear earlier or later than expected.'}]).forecastChanges.length,1);
});
test('empty or inapplicable proposals remain hidden; diagnostics do not manufacture a note',()=>{
 const f=data(rah),b=approved(f,[]);assert.equal(b.forecastChanges.length,0);assert.equal(b.danTakeReview.candidateCount,2);assert.equal(b.danTakeReview.proposedCount,0);
 assert.deepEqual(visibleDanTakeItems(b,f,now),[]);
 const quiet=data('.DISCUSSION...\nHigh confidence in dry weather this week.');assert.equal(collectDanTakeEvidence(quiet,now).candidates.length,0);
});
