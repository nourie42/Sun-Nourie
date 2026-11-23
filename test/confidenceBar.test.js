import test from 'node:test';
import assert from 'node:assert/strict';
import {confidenceWarningHTML,lowConfidenceWarning} from '../public/weather-fusion/confidence-bar.js';

const day=(date,score,components)=>({date,confidence:{overall:{scope:'overall',key:score<70?'low':score<85?'moderate':'high',label:score<70?'Low':score<85?'Moderate':'High',score,components}}});

test('confidence bar stays hidden when important details are not low',()=>{
  assert.equal(lowConfidenceWarning([day('2026-11-23',82,{rain:80,temperature:75,sky:78})]),null);
});

test('confidence bar explains the first weak forecast day in plain language',()=>{
  const warning=lowConfidenceWarning([
    day('2026-11-23',88,{rain:90,temperature:87,sky:86}),
    day('2026-11-24',52,{rain:45,temperature:62,sky:78})
  ]);
  assert.equal(warning.dayLabel,'Tomorrow');
  assert.equal(warning.score,45);
  assert.match(warning.text,/don’t agree yet about rain and temperatures/i);
  assert.doesNotMatch(`${warning.title} ${warning.text}`,/NWS|ECMWF|HRRR|NBM|model/i);
});

test('confidence bar renders an accessible relative meter without a percentage claim',()=>{
  const html=confidenceWarningHTML(lowConfidenceWarning([day('2026-11-25',48,{rain:48,temperature:76,sky:82})]));
  assert.match(html,/role="meter"/);
  assert.match(html,/aria-valuetext="Low"/);
  assert.doesNotMatch(html,/>\s*48%\s*</);
});
