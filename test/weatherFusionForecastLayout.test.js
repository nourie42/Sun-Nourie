import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {graphGeometry,dewpointPoints} from '../public/weather-fusion/dewpoint-meter.js';
const H=3600000,start=Date.parse('2026-09-06T11:00:00Z');
const source=name=>readFileSync(new URL('../public/weather-fusion/'+name,import.meta.url),'utf8');
for(const width of [240,280,310,375,600,768,1184]){
 for(const hours of [24,48,168,240]){
  test(`${hours}-hour gross meter fits ${width}px without dropping hourly points`,()=>{
   const points=Array.from({length:hours},(_,i)=>({epoch:start+i*H,value:65+Math.sin(i/9)*5}));
   const g=graphGeometry(points,hours,width,start);
   assert.equal(g.W,width);assert.equal(g.height,300);
   assert.equal(g.x(start),g.L);assert.equal(g.x(start+(hours-1)*H),g.W-g.R);
   for(const p of points)assert.ok(g.x(p.epoch)>=g.L&&g.x(p.epoch)<=g.W-g.R);
  });
 }
}
test('partial coverage leaves the uncovered end of the full ten-day window blank',()=>{
 const points=[3,4,10,120].map(i=>({epoch:start+i*H,value:65}));
 const g=graphGeometry(points,240,310,start);
 assert.equal(g.first,start);assert.equal(g.last,start+239*H);
 assert.ok(g.x(points[0].epoch)>g.L);assert.ok(g.x(points.at(-1).epoch)<g.W-g.R);
 assert.ok(Math.abs((g.x(points[2].epoch)-g.x(points[0].epoch))/(g.x(points[1].epoch)-g.x(points[0].epoch))-7)<1e-10);
});
test('empty and missing dew-point values stay unavailable, not invented',()=>{
 const g=graphGeometry([],240,280,start);assert.ok(Number.isFinite(g.x(start)));assert.ok(g.max>g.min);
 const forecast={metricForecasts:{series:{dewpoint:[{time:new Date(start).toISOString(),value:null},{time:new Date(start+H).toISOString(),value:65}]}}};
 const points=dewpointPoints(forecast,start,240);assert.equal(points.length,2);assert.equal(points[0].value,null);
});
test('temperature, first daily graphic and hourly forecast precede comfort panels',()=>{
 const html=source('index.html'),ids=['id="temperature"','id="today-forecast"','id="hourly"','id="skin-exposure"'];
 const positions=ids.map(id=>html.indexOf(id));assert.ok(positions.every(i=>i>=0));
 for(let i=1;i<positions.length;i++)assert.ok(positions[i]>positions[i-1]);
 for(const id of ['today-forecast','hourly','daily','skin-exposure','map-panel','scientific-stuff'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
 const between=html.slice(html.indexOf('id="today-forecast"'),html.indexOf('id="hourly"'));
 assert.doesNotMatch(between,/skin-exposure|briefing-summary|id="alerts"/);
});
test('gross meter uses a fitted SVG and never instructs or forces horizontal scrolling',()=>{
 const js=source('dewpoint-meter.js'),css=source('dewpoint-meter.css');
 assert.match(js,/width="100%"/);assert.doesNotMatch(js,/scrollLeft|Swipe the timeline|max-width:none/);
 assert.match(js,/rect\.width\)\*built\.g\.W/);
 assert.match(css,/\.gross-scroll\{[^}]*overflow:hidden/);
 assert.match(css,/\.gross-chart\{[^}]*width:100%/);
});
test('today summary reuses the daily rows and existing detail handler',()=>{
 const js=source('experience.js');
 assert.match(js,/today\.innerHTML=rows\[0\]/);
 assert.match(js,/button\.removeAttribute\('data-day'\)/);
 assert.match(js,/\$\('daily'\)\?\.querySelector\('\[data-day="0"\]'\)\?\.click\(\)/);
 assert.match(js,/\$\('daily'\)\.innerHTML=rows\.join\(''\)/);
});
