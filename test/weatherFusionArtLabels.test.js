import test from 'node:test';
import assert from 'node:assert/strict';
import {exposureTitle,sunShadeHTML} from '../public/weather-fusion/personal-details.js';
test('outdoor title follows weather without collapsing mostly and partly cloudy',()=>{
 for(const [condition,label] of [['Sunny','Sun'],['Mostly Sunny','Mostly sunny'],['Partly Cloudy','Partly cloudy'],['Mostly Cloudy','Mostly cloudy'],['Overcast','Cloudy'],['Cloudy','Cloudy'],['Rain','Rain'],['Thunderstorms','Thunderstorms'],['Fog','Foggy'],['Snow','Snow or ice']])assert.equal(exposureTitle(condition),label);
 assert.equal(exposureTitle('Clear',false),'Clear');assert.equal(exposureTitle(''), 'Outdoors');
});
test('shade has no banner even at extreme UTCI; outdoor warning remains',()=>{
 const html=sunShadeHTML({shade:120,outdoors:121,daylight:true,weatherKind:'cloudy',radiantCondition:'Mostly Cloudy',inputEvidence:{temperature:105}},{latitude:35,longitude:-78},Date.now(),{compact:true});
 const shade=html.slice(html.indexOf('shade-person'),html.indexOf('sun-person'));
 assert.doesNotMatch(shade,/thermal-risk|Heat stress/);
 assert.match(html,/Mostly cloudy/);assert.match(html,/Extreme heat/);
});
test('compact outdoor card is always titled Night after dark',()=>{
 const html=sunShadeHTML({shade:83,outdoors:83,daylight:false,weatherKind:'storm',radiantCondition:'Chance Showers And Thunderstorms',inputEvidence:{temperature:83}},{latitude:35,longitude:-78},Date.parse('2026-09-12T00:00:00Z'),{compact:true,pop:20});
 const outdoor=html.slice(html.indexOf('sun-person'),html.indexOf('</figure>',html.indexOf('sun-person')));
 assert.match(outdoor,/<span class="exposure-label">Night<\/span>/);
 assert.doesNotMatch(outdoor,/Storms possible/);
});
