import test from 'node:test';
import assert from 'node:assert/strict';
import {winterWeights,blendWinterInputs,winterSignal,winterDetailHTML} from '../public/weather-fusion/prerelease-winter.js';
import {parseSnowMapTimes,validateWpcMapPeriod,WINTER_MAP_SOURCES} from '../public/weather-fusion/prerelease-winter-maps.js';
const H=3600000,now=Date.parse('2026-10-14T12:00:00Z'),iso=hours=>new Date(now+hours*H).toISOString();
const data=()=>({assembledAt:iso(0),location:{name:'TEST town',timeZone:'UTC'},feeds:[{id:'nws',status:'ready'},{id:'snow-models',status:'ready'}],snow:{days:[{date:'2026-10-14',label:'Today',models:{ecmwf:0,gfs:0},nwsSnowfall:0,periods:[]}]},hours:[],days:[]});
function inputs(weights,options={}){return Object.keys(weights).map((source,i)=>({source,value:i+1,status:'ready',complete:true,issuedAt:iso(-3),start:iso(0),end:iso(12),metric:'snow',unit:'inches',statistic:'expected-amount',...options}));}
const target={start:iso(0),end:iso(12),metric:'snow',unit:'inches',statistic:'expected-amount',now};

test('winter weights are exact and crossing the 24-hour boundary requires splitting',()=>{
  assert.deepEqual(winterWeights(iso(0),iso(24),now).weights,{wpc:.6,hrrr:.25,nam:.15});
  assert.deepEqual(winterWeights(iso(24),iso(48),now).weights,{wpc:.6,ecmwf:.2,weathernext:.1,gfs:.1});
  assert.equal(winterWeights(iso(12),iso(36),now).kind,'split-required');
  assert.equal(winterWeights(iso(-24),iso(-12),now).weights,null);
});
test('winter blend never silently redistributes missing source shares',()=>{
  const all=inputs(winterWeights(target.start,target.end,now).weights),before=JSON.stringify(all);
  assert.equal(blendWinterInputs(all,target).value,1*.6+2*.25+3*.15);
  assert.equal(JSON.stringify(all),before);
  for(let i=0;i<all.length;i++)assert.equal(blendWinterInputs(all.filter((_,j)=>i!==j),target).value,null);
  assert.equal(blendWinterInputs(all.map(row=>({...row,value:0})),target).value,0);
});
test('winter blending rejects stale, partial, duplicated and incompatible products',()=>{
  const all=inputs(winterWeights(target.start,target.end,now).weights);
  for(const change of [{value:null},{value:NaN},{value:-1},{unit:'cm'},{metric:'sleet'},{statistic:'median'},{start:iso(1)},{end:iso(6)},{issuedAt:iso(-48)},{issuedAt:iso(1)},{complete:false},{threshold:4},{status:'stale'}]){
    assert.equal(blendWinterInputs([{...all[0],...change},...all.slice(1)],target).value,null,JSON.stringify(change));
  }
  assert.equal(blendWinterInputs([...all,all[0]],target).value,null);
});
test('threshold chances do not become chances of any snow or ice',()=>{
  const rows=inputs({wpc:.6,hrrr:.25,nam:.15},{value:30,unit:'percent',statistic:'probability',threshold:4});
  const request={...target,unit:'percent',statistic:'probability'};
  assert.equal(blendWinterInputs(rows,request).value,null);
  assert.equal(blendWinterInputs(rows,{...request,threshold:4}).value,30);
  assert.equal(blendWinterInputs(rows.map(row=>({...row,value:110})),{...request,threshold:4}).value,null);
});
test('no-snow wording requires current complete available coverage',()=>{
  assert.equal(winterSignal(data(),now).status,'none');
  for(const changed of [null,{}, {...data(),assembledAt:iso(-8)}, {...data(),feeds:[]}, {...data(),snow:{days:[{models:{ecmwf:null,gfs:0}}]}}])assert.equal(winterSignal(changed,now).status,'unavailable');
  const snow=data();snow.snow.days[0].models.ecmwf=.1;
  assert.equal(winterSignal(snow,now).status,'possible');
  const ice=data();ice.hours=[{time:iso(1),condition:'Chance freezing rain'}];
  assert.equal(winterSignal(ice,now).freezingRain,true);assert.equal(winterSignal(ice,now).snow,false);
  const sleet=data();sleet.hours=[{time:iso(1),condition:'Sleet'}];assert.equal(winterSignal(sleet,now).sleet,true);
});
test('winter details distinguish source amounts and probabilities and escape text',()=>{
  const snow=data();snow.snow.days[0].models.ecmwf=2;snow.snow.days[0].label='<img src=x>';
  const html=winterDetailHTML(snow,now);
  assert.match(html,/2.0 in/);assert.match(html,/Type-specific chance unavailable/);assert.match(html,/Missing shares stay missing/);
  assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img src=x>/);
  assert.match(html,/data-winter-map="snow"/);assert.match(html,/data-winter-map="qpf"/);
});
test('NDFD map times ignore historical default and never omit explicit valid time',()=>{
  const xml=`<Dimension name="time" default="2015-04-10T00:00:00Z">${iso(-6)},${iso(0)},${iso(6)},${iso(12)},${iso(120)}</Dimension>`;
  assert.deepEqual(parseSnowMapTimes(xml,now),[iso(6),iso(12)]);
  assert.deepEqual(parseSnowMapTimes(`<Dimension name="time">${iso(6)}/${iso(18)}/PT6H</Dimension>`,now),[iso(6),iso(12),iso(18)]);
  assert.deepEqual(parseSnowMapTimes('<xml>no usable dimensions</xml>',now),[]);
  assert.match(WINTER_MAP_SOURCES.snow,/mapservices.weather.noaa.gov\/geoserver\/ndfd\/snow\/ows$/);
});
test('WPC map period needs fresh identical issue and valid timestamps; empty contours are unknown',()=>{
  const row={attributes:{start_time:iso(0).replace('T',' ').replace('Z',''),end_time:iso(24),issue_time:iso(-3)}};
  assert.equal(validateWpcMapPeriod([row],now).end,now+24*H);
  assert.equal(validateWpcMapPeriod([],now),null);
  assert.equal(validateWpcMapPeriod([{attributes:{...row.attributes,issue_time:iso(-48)}}],now),null);
  assert.equal(validateWpcMapPeriod([row,{attributes:{...row.attributes,start_time:iso(6)}}],now),null);
  assert.equal(validateWpcMapPeriod([{attributes:{...row.attributes,issue_time:null}}],now),null);
});

test('fresh named-model snowfall triggers winter with honest source coverage and incomplete totals',()=>{
 const forecast=data();forecast.prereleaseWinter={assembledAt:iso(0),sources:{hrrr:{label:'HRRR',status:'ready',coveredHours:18,coverageEnd:iso(18),metadata:{latestRunAt:iso(-2)},intervals:[{start:iso(1),end:iso(2),value:.3}]}},windows:[{start:iso(0),end:iso(24),sourceAmounts:{hrrr:{complete:false,value:null,coveredHours:18,expectedHours:24},ecmwf:{complete:true,value:2,coveredHours:24,expectedHours:24}}}]};
 assert.equal(winterSignal(forecast,now).status,'possible');const html=winterDetailHTML(forecast,now);
 assert.match(html,/18\/24 hours/);assert.match(html,/2.0 in/);assert.match(html,/Latest feed run/);assert.doesNotMatch(html,/not connected/);
 forecast.prereleaseWinter.assembledAt=iso(-2);assert.equal(winterSignal(forecast,now).status,'none');
});
