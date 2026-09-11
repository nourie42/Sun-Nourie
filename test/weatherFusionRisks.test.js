import test from 'node:test';
import assert from 'node:assert/strict';
import {inGeoJson,normalizeSpcRisk,normalizeWpcRisk} from '../src/weatherFusionRisks.js';
import {danCard} from '../public/weather-fusion/dans-summary.js';
const now=Date.parse('2026-09-11T22:00:00Z');
const location={latitude:35.7,longitude:-78.5,timeZone:'America/New_York',office:'RAH'};
const base={signature:'risk-test',location,alerts:[],riskOutlooks:[],feeds:[],discussion:null};
test('risk polygons cover only the selected point and honor holes',()=>{
 const geometry={type:'Polygon',coordinates:[[[-80,34],[-77,34],[-77,37],[-80,37],[-80,34]],[[-79,35],[-78,35],[-78,36],[-79,36],[-79,35]]]};
 assert.equal(inGeoJson(-77.5,35.5,geometry),true);assert.equal(inGeoJson(-78.5,35.5,geometry),false);assert.equal(inGeoJson(-90,35,geometry),false);
});
test('SPC and WPC normalize only active categorical risks',()=>{
 const spc=normalizeSpcRisk({dn:3,valid:'202609112000',expire:'202609121200',issue:'202609112000'},now);
 assert.equal(spc.level,'Marginal');assert.match(spc.title,/severe storms/);
 assert.equal(normalizeSpcRisk({dn:2,valid:'202609112000',expire:'202609121200',issue:'202609112000'},now),null,'general thunder is not a severe risk');
 const feature={properties:{OUTLOOK:'Slight (At Least 15%)',START_TIME:'2026-09-11 20:00:00',END_TIME:'2026-09-12 12:00:00',ISSUE_TIME:'2026-09-11 20:00:00'},geometry:{type:'Polygon',coordinates:[[[-80,34],[-77,34],[-77,37],[-80,37],[-80,34]]]}};
 assert.equal(normalizeWpcRisk(feature,-78.5,35.7,now).level,'Slight');assert.equal(normalizeWpcRisk(feature,-90,35.7,now),null);
});
test('Dan prioritizes local alerts, then point outlooks, then discussion',()=>{
 const risk={...base,riskOutlooks:[{kind:'spc',level:'Marginal',rank:3,title:'Marginal risk of severe storms today',summary:'A few storms could become strong.',expires:'2026-09-12T12:00:00Z'},{kind:'wpc',level:'Marginal',rank:1,title:'Marginal risk of flooding rain today',summary:'Heavy rain could cause flooding in a few spots.',expires:'2026-09-12T12:00:00Z'}]};
 const outlook=danCard({},risk,now).text;assert.match(outlook,/Severe storms: Marginal risk/);assert.match(outlook,/Flooding rain: Marginal risk/);assert.equal(outlook.split('\n').length,2);
 const alert={...risk,alerts:[{id:'https://api.weather.gov/alerts/1',status:'Actual',messageType:'Alert',event:'Severe Thunderstorm Watch',sent:'2026-09-11T21:00:00Z',expires:'2026-09-12T01:00:00Z'}]};
 const text=danCard({},alert,now).text;assert.match(text,/Severe Thunderstorm Watch/);assert.doesNotMatch(text,/Marginal risk/);assert.ok(text.length<120);
});
