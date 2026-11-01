import test from 'node:test';
import assert from 'node:assert/strict';
import {danCard,danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
import {hasDanJargon,discussionPeriod} from '../public/weather-fusion/dans-take.js';

const H=3600000,now=Date.parse('2026-10-17T00:11:00Z');
function forecast(body){
 return {signature:'discussion-plain-language',location:{office:'RAH',latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],discussion:{id:'plain-language-afd',office:'RAH',issuanceTime:new Date(now-H).toISOString(),text:'.SYNOPSIS...\nA cold front will bring rain Saturday. Colder air follows.\n&&\n.LONG TERM /SATURDAY THROUGH MONDAY/...\n'+body+'\n&&'}};
}
test('the screenshot frost excerpt explains the wind uncertainty without implying an issued advisory',()=>{
 const f=forecast('The airmass behind the front will support overnight lows in the 30s across the Piedmont, with potential for radiational cooling into the lower 30s. However, the tighter pressure gradient should maintain at least light stirring overnight Saturday and Sunday night, while high-level moisture wraps back around the upper low across central and eastern NC. Consequently, while temperatures may warrant a Frost Advisory with some temps in the mid-30s, it remains uncertain whether winds will fully decouple to allow for more widespread impacts.');
 const card=danCard(null,f,now);
 assert.equal(card.items.length,1);
 assert.equal(card.items[0].summary,'Some spots may be cold enough for frost, but lingering wind could keep frost from becoming widespread.');
 assert.match(card.items[0].sourceQuote,/Consequently.*Frost Advisory.*uncertain.*fully decouple/);
 assert.match(card.items[0].period,/Saturday, Oct 17 – Monday, Oct 19/);
 assert.doesNotMatch(card.text,/Consequently|decoupl|Advisory|radiational|pressure gradient/);
 assert.match(danTakeDisplay(null,f,now),/^A cold front will bring rain Saturday\. Colder air follows\./);
});
test('overnight qualified by a weekday belongs to that weekday, not the source issuance night',()=>{
 const zone='America/New_York',anchor=Date.parse('2026-10-16T18:07:00Z');
 assert.deepEqual(discussionPeriod('Light wind continues overnight Saturday and Sunday night.',anchor,zone),{start:Date.parse('2026-10-17T22:00:00Z'),end:Date.parse('2026-10-19T10:00:00Z'),part:''});
 assert.deepEqual(discussionPeriod('Rain remains possible overnight.',anchor,zone),{start:Date.parse('2026-10-16T22:00:00Z'),end:Date.parse('2026-10-17T10:00:00Z'),part:'night'});
});
test('a standalone excerpt drops only its initial connective and keeps a complete sentence',()=>{
 for(const transition of ['However','Consequently','Therefore','Nevertheless','Thus','As a result','In addition']){
  const card=danCard(null,forecast(`${transition}, uncertainty remains about the rain arriving Monday.`),now);
  assert.equal(card.items[0]?.summary,'Uncertainty remains about the rain arriving Monday.',transition);
 }
});
test('untranslated decoupling is withheld rather than converted to an unsupported frost forecast',()=>{
 const card=danCard(null,forecast('It remains uncertain whether winds will decouple Monday.'),now);
 assert.equal(card.text,'');
 for(const text of ['Winds will decouple.','Radiational cooling may strengthen.','The pressure gradient could weaken.'])assert.equal(hasDanJargon(text),true,text);
});
test('a valid complete AI discussion summary keeps its wording and internal transition',()=>{
 const f=forecast('The arrival of rain remains uncertain Monday.');
 const summary='Rain arrives Saturday. However, Sunday should be cooler.';
 assert.equal(danTakeDisplay({signature:f.signature,mode:'ai',danSummary:summary},f,now),summary);
});
test('the newer AFD layout summarizes its .DISCUSSION narrative instead of the point forecast',()=>{
 const issued=new Date(now-H),text=`.WHAT HAS CHANGED...\n\n* No major changes.\n\n&&\n\n.KEY MESSAGES...\nAs of 645 PM Friday...\n\n1) Dry weekend ahead.\n\n&&\n\n.DISCUSSION...\nAs of 645 PM Friday...\n\nKEY MESSAGE 1...  Dry weekend ahead.\n\nHigh pressure will keep skies mostly clear through the weekend. Clouds will increase Monday, but rain is not expected.\n\n&&\n\n.AVIATION /00Z SATURDAY THROUGH WEDNESDAY/...\nVFR conditions are expected.\n\n&&`;
 const f={signature:'new-afd-layout',location:{office:'RAH',latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],days:[{detail:'Sunny, with a high near 74.'}],discussion:{id:'new-afd-layout',office:'RAH',issuanceTime:issued.toISOString(),text}};
 const display=danTakeDisplay(null,f,now);
 assert.match(display,/^High pressure will keep skies mostly clear through the weekend\. Clouds will increase Monday, but rain is not expected\./);
 assert.doesNotMatch(display,/KEY MESSAGE|Sunny, with a high near/);
});
test('briefing fallback summarizes fragment-style key messages when AI is rate limited',()=>{
 const clock=Date.parse('2026-11-01T18:30:00Z');
 const f={signature:'key-messages-afd',location:{office:'RAH',latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},feeds:[{id:'afd',status:'ready'}],days:[{detail:'Sunny, with a high near 68.'}],discussion:{id:'key-messages-afd',office:'RAH',issuanceTime:'2026-11-01T17:54:00Z',text:'.KEY MESSAGES...\nAs of 125 AM Sunday...\n\n1) Seasonable temperatures, dry weather and abundant high clouds the rest of this weekend.\n2) Chance of showers from late Wednesday night through Friday night or Saturday. Continued very warm mid through late week.\n&&\n.DISCUSSION...\nThere is a chance of showers starting Wednesday night in the west. However, confidence remains low given the spread in the models and the seemingly endless "kicking the can" down the road on days 5-7.\n&&'}};
 const display=danTakeDisplay({mode:'nws-summary',signature:f.signature},f,clock);
 assert.match(display,/Expect temperatures near normal, dry weather and plenty of high clouds/);
 assert.match(display,/Showers are possible from late Wednesday night through Friday night or Saturday/);
 assert.match(display,/It will stay very warm mid through late week/);
 assert.match(display,/The timing of the showers is uncertain/);
 assert.doesNotMatch(display,/Sunny, with a high near|spread in the models|kicking the can|KEY MESSAGES/);
});
test('a missing or expired discussion is disclosed instead of showing point-forecast prose',()=>{
 const f=forecast('Showers may arrive Monday.');
 f.days=[{detail:'Sunny, with a high near 74.'}];
 for(const clock of [now,now+13*H]){
  const missing=structuredClone(f);
  if(clock===now){missing.discussion=null;missing.feeds=[];}
  const display=danTakeDisplay(null,missing,clock);
  assert.match(display,/forecast discussion is unavailable/);
  assert.doesNotMatch(display,/Sunny, with a high near/);
 }
});
