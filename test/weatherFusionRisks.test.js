import test from 'node:test';
import assert from 'node:assert/strict';
import {inGeoJson,normalizeSpcRisk,normalizeWpcRisk,parseWpcDiscussion,outlookMapFeatures,createOutlookDetailService} from '../src/weatherFusionRisks.js';
import {danCard} from '../public/weather-fusion/dans-summary.js';
import {activeRiskOutlooks,riskOutlookButtonHTML,outlookDetailHTML} from '../public/weather-fusion/risk-outlooks.js';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';
const now=Date.parse('2026-09-11T22:00:00Z');
const location={latitude:35.7,longitude:-78.5,timeZone:'America/New_York',office:'RAH'};
const base={signature:'risk-test',location,alerts:[],riskOutlooks:[],feeds:[],discussion:null};
test('risk polygons cover only the selected point and honor holes',()=>{
 const geometry={type:'Polygon',coordinates:[[[-80,34],[-77,34],[-77,37],[-80,37],[-80,34]],[[-79,35],[-78,35],[-78,36],[-79,36],[-79,35]]]};
 assert.equal(inGeoJson(-77.5,35.5,geometry),true);assert.equal(inGeoJson(-78.5,35.5,geometry),false);assert.equal(inGeoJson(-90,35,geometry),false);
});
test('SPC and WPC include issued Day 1 risks before their valid period begins',()=>{
 const spc=normalizeSpcRisk({dn:3,valid:'202609112000',expire:'202609121200',issue:'202609112000'},now);
 assert.equal(spc.level,'Marginal');assert.match(spc.title,/severe storms/);
 assert.equal(normalizeSpcRisk({dn:2,valid:'202609112000',expire:'202609121200',issue:'202609112000'},now),null,'general thunder is not a severe risk');
 const feature={properties:{OUTLOOK:'Slight (At Least 15%)',START_TIME:'2026-09-11 20:00:00',END_TIME:'2026-09-12 12:00:00',ISSUE_TIME:'2026-09-11 20:00:00'},geometry:{type:'Polygon',coordinates:[[[-80,34],[-77,34],[-77,37],[-80,37],[-80,34]]]}};
 assert.equal(normalizeWpcRisk(feature,-78.5,35.7,now).level,'Slight');assert.equal(normalizeWpcRisk(feature,-90,35.7,now),null);
 const raleigh={...feature,properties:{...feature.properties,OUTLOOK:'Marginal (At Least 5%)',ISSUE_TIME:'2026-09-12 07:37:00',START_TIME:'2026-09-12 12:00:00',END_TIME:'2026-09-13 12:00:00'}};
 const early=Date.parse('2026-09-12T09:00:00Z');
 assert.equal(normalizeWpcRisk(raleigh,-78.5,35.7,early).level,'Marginal','the issued Raleigh outlook is visible before its 12Z start');
 assert.equal(normalizeWpcRisk(raleigh,-78.5,35.7,Date.parse('2026-09-13T12:00:00Z')),null,'expired outlook stays hidden');
 const farFuture={...raleigh,properties:{...raleigh.properties,START_TIME:'2026-09-14 12:00:00',END_TIME:'2026-09-15 12:00:00'}};
 assert.equal(normalizeWpcRisk(farFuture,-78.5,35.7,early),null,'far-future outlook stays hidden');
});
test('Dan prioritizes local alerts, then point outlooks, then discussion',()=>{
 const risk={...base,riskOutlooks:[{kind:'spc',level:'Marginal',rank:3,title:'Marginal risk of severe storms today',summary:'A few storms could become strong.',expires:'2026-09-12T12:00:00Z'},{kind:'wpc',level:'Marginal',rank:1,title:'Marginal risk of flooding rain today',summary:'Heavy rain could cause flooding in a few spots.',expires:'2026-09-12T12:00:00Z'}]};
 const outlook=danCard({},risk,now).text;assert.match(outlook,/Severe storms: Marginal risk/);assert.match(outlook,/Flooding rain: Marginal risk/);assert.equal(outlook.split('\n').length,2);
 const alert={...risk,alerts:[{id:'https://api.weather.gov/alerts/1',status:'Actual',messageType:'Alert',event:'Severe Thunderstorm Watch',sent:'2026-09-11T21:00:00Z',expires:'2026-09-12T01:00:00Z'}]};
 const text=danCard({},alert,now).text;assert.match(text,/Severe Thunderstorm Watch/);assert.doesNotMatch(text,/Marginal risk/);assert.ok(text.length<120);
});
test('WPC discussion parser keeps Day 1 excessive rainfall text and map levels',()=>{
 const html='<html><pre>Excessive Rainfall Discussion\nNWS Weather Prediction Center College Park MD\n418 AM EDT Tue Sep 22 2026\n\nDay 1\nValid 12Z Tue Sep 22 2026 - 12Z Wed Sep 23 2026\n\n..THERE IS A SLIGHT RISK OF EXCESSIVE RAINFALL ACROSS PORTIONS\nOF THE MID-ATLANTIC...\n\nDay 2\nValid 12Z Wed Sep 23 2026 - 12Z Thu Sep 24 2026\n\n..THERE IS A MODERATE RISK...</pre></html>';
 const parsed=parseWpcDiscussion(html);
 assert.equal(parsed.product,'Excessive Rainfall Discussion');
 assert.match(parsed.office,/College Park/);
 assert.match(parsed.validLabel,/Day 1 Valid 12Z Tue Sep 22/);
 assert.match(parsed.discussion,/SLIGHT RISK OF EXCESSIVE RAINFALL/);
 assert.doesNotMatch(parsed.discussion,/Day 2/);
 const features=outlookMapFeatures([{properties:{OUTLOOK:'Slight (At Least 15%)'},geometry:{type:'Polygon',coordinates:[[[-80,34],[-77,34],[-77,37],[-80,37],[-80,34]]]}}]);
 assert.equal(features[0].level,'Slight');
});
test('the location risk list uses the API level and opens an in-app outlook',()=>{
 const forecast={riskOutlooks:[{id:'wpc-day1-slight',kind:'wpc',level:'Slight',rank:2,title:'Slight risk of flooding rain today',summary:'Heavy rain could cause flooding. Keep away from flooded roads.',expires:'2026-09-23T12:00:00Z',url:'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php'}]};
 const risks=activeRiskOutlooks(forecast,now);
 assert.equal(risks[0].level,'Slight');
 assert.doesNotMatch(risks[0].title,/Marginal/);
 const html=riskOutlookButtonHTML(risks[0],0);
 assert.match(html,/data-risk-kind="wpc"/);
 assert.match(html,/Slight risk of flooding rain today/);
 assert.match(html,/View/);
 const detail=outlookDetailHTML(risks[0],{product:'Excessive Rainfall Discussion',office:'NWS Weather Prediction Center College Park MD',issued:'418 AM EDT Tue Sep 22 2026',validLabel:'Day 1 Valid 12Z Tue Sep 22 2026 - 12Z Wed Sep 23 2026',discussion:'THERE IS A SLIGHT RISK OF EXCESSIVE RAINFALL',sourceUrl:risks[0].url});
 assert.match(detail,/id="outlook-map"/);
 assert.match(detail,/Excessive Rainfall Discussion/);
 assert.match(detail,/THERE IS A SLIGHT RISK OF EXCESSIVE RAINFALL/);
 assert.match(detail,/MRGL|SLGT|MDT|HIGH/);
});
test('outlook detail API uses cached WPC map and discussion',async()=>{
 const cached=async url=>({data:String(url).includes('qpferd')?'<pre>Excessive Rainfall Discussion\nNWS Weather Prediction Center College Park MD\n418 AM EDT Tue Sep 22 2026\nDay 1\nValid 12Z Tue Sep 22 2026 - 12Z Wed Sep 23 2026\n..THERE IS A SLIGHT RISK...\nDay 2\nValid later</pre>':{features:[{properties:{OUTLOOK:'Slight (At Least 15%)'},geometry:{type:'Polygon',coordinates:[[[-80,34],[-77,34],[-77,37],[-80,37],[-80,34]]]}}]},fetchedAt:'2026-09-22T08:00:00Z'});
 const detail=await createOutlookDetailService({cached,now:()=>now})({kind:'wpc',location:{latitude:35.787,longitude:-78.4806}});
 assert.equal(detail.kind,'wpc');
 assert.equal(detail.title,'Outlooks');
 assert.equal(detail.features[0].level,'Slight');
 assert.match(detail.discussion,/SLIGHT RISK/);
 assert.equal(detail.location.latitude,35.787);
});
test('weather fusion registers the outlooks page and outlook API',()=>{
 const routes=[];
 registerWeatherFusionRoutes({get:(...args)=>routes.push(args)},{env:{},fetchImpl:async()=>{throw new Error('not called');}});
 const pages=routes.find(([path])=>Array.isArray(path))?.[0]||[];
 assert.ok(pages.includes('/weather-fusion/outlooks'));
 assert.ok(routes.some(([path])=>path==='/api/weather-fusion/outlook'));
});
