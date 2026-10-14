import test from 'node:test';
import assert from 'node:assert/strict';
import {snowDetailHTML,snowBannerSummary,snowForecastPresent,winterOutlookState,safeWinterMapUrl,winterMapDescriptors,winterPointAmount,winterPointInBounds,winterPointPopupHTML} from '../public/weather-fusion/snow-outlook.js';

test('automatic winter tile requires snow while the Snow tab can still inspect ice guidance',()=>{
 const ice={status:'ready',snowExpected:false,possible:true,days:[{index:0,snowExpected:false,freezingRainPossible:true,freezingRainChance:60}]};
 assert.equal(snowForecastPresent(ice),false);
 assert.equal(winterOutlookState(ice),'active');
 const snow={...ice,snowExpected:true,days:[...ice.days,{index:1,label:'Thu',snowExpected:true},{index:2,label:'Fri',snowExpected:true}]};
 assert.equal(snowForecastPresent(snow),true);
 assert.match(snowBannerSummary(snow),/^Thu · \+1 more days/);
});
import {addSnowOutlook} from '../src/weatherFusionSnow.js';

test('winter UI distinguishes checked no-snow guidance from absent or failed sources',()=>{
 const clear={status:'ready',possible:false,days:[]};
 assert.equal(winterOutlookState(clear),'clear');
 assert.match(snowDetailHTML(clear,'Test town'),/No snow in the forecast\./);
 for(const unknown of [null,{possible:false,days:[]},{status:'unavailable',possible:false,days:[]},{error:'Provider failed',possible:false,days:[]}]){
  assert.equal(winterOutlookState(unknown),'unavailable');
  assert.doesNotMatch(snowDetailHTML(unknown,'Test town'),/No snow in the forecast\./);
 }
 assert.match(snowDetailHTML({status:'partial',possible:false,days:[]},'Test town'),/Coverage is limited/);
 assert.match(snowDetailHTML(null),/Choose a location first/);
 assert.match(snowDetailHTML(null,'Test town'),/Winter forecast unavailable/);
});

test('ice-only and sleet-only forecasts open winter details without inventing percentages',()=>{
 for(const kind of ['freezingRain','sleet']){
  const data={status:'partial',possible:false,days:[{index:1,date:'2026-10-15',label:'Thursday',possible:false,[kind+'Possible']:true,best:null}]};
  assert.equal(winterOutlookState(data),'active');
  const html=snowDetailHTML(data,'Test town');
  assert.match(html,/Possible · percentage unavailable/);
  assert.doesNotMatch(html,/No snow in the forecast\./);
  assert.match(html,/Snow amount <strong>Unavailable/);
  assert.match(snowBannerSummary(data),/Thursday/);
 }
});

test('winter details honor blend coverage, escaping and official-map fallbacks',()=>{
 const injection='<img src=x onerror=alert(1)>';
 const data={status:'partial',possible:true,days:[{possible:true,date:'2026-10-15',label:injection,best:2,range:[injection,4],typeSignals:{snow:{label:injection}},periods:[{name:injection,wording:injection}]}],
  blendWindows:[{label:injection,start:'2026-10-15T00:00:00Z',end:'2026-10-16T00:00:00Z',snowfall:{value:2,weights:{wpc:60,hrrr:25,nam:15},coverage:40,status:'partial',actualWeights:{wpc:0,hrrr:62.5,nam:37.5},sources:[{id:'hrrr',value:2,message:injection}]}}],
  maps:[{id:injection,label:injection,sourceUrl:'javascript:alert(1)'}],notes:injection};
 const html=snowDetailHTML(data,injection,'Invalid/timezone');
 assert.doesNotMatch(html,/<img|onerror="|href="javascript:/);
 assert.match(html,/&lt;img/);
 assert.match(html,/Snow amount <strong>2\.0″/);
 assert.match(html,/40% of requested weight/);
 assert.match(html,/Contributing weights/);
 assert.match(html,/href="https:\/\/www\.wpc\.ncep\.noaa\.gov/);
 assert.match(html,/role="region" aria-label="Winter precipitation forecast map"/);
 const complete=snowDetailHTML({...data,blendWindows:[{snowfall:{value:0,coverage:100,status:'ready',weights:{wpc:60,hrrr:25,nam:15}}}]},'Test town');
 assert.match(complete,/All requested sources available\./);
 const unavailable=snowDetailHTML({...data,blendWindows:[{snowfall:{value:null,coverage:0,status:'unavailable'}}]},'Test town');
 assert.match(unavailable,/No requested source has compatible accumulation data/);
});

test('map URLs reject active content while allowing official HTTP and HTTPS links',()=>{
 assert.equal(safeWinterMapUrl('javascript:alert(1)'),null);
 assert.equal(safeWinterMapUrl('data:text/html,test'),null);
 assert.equal(safeWinterMapUrl(undefined),null);
 assert.equal(safeWinterMapUrl('https://www.wpc.ncep.noaa.gov/'),'https://www.wpc.ncep.noaa.gov/');
});

test('type probabilities identify peak hourly NBM values and keep missing percentages unknown',()=>{
 const row={index:1,date:'2026-10-15',possible:true,snowChance:40,freezingRainPossible:false,freezingRainChance:null,sleetPossible:false,sleetChance:0,probabilitySource:'NWS NBM precipitation type probabilities',probabilityMethod:'A separate probability product; not snowfall amount weights.'};
 const html=snowDetailHTML({status:'partial',possible:true,days:[row]},'Test town');
 assert.match(html,/40% peak hourly/);
 assert.match(html,/0% peak hourly/);
 assert.match(html,/No signal · percentage unavailable/);
 assert.match(html,/NWS NBM precipitation type probabilities/);
 assert.match(html,/not the chance over the full day/);
 assert.match(html,/not snowfall amount weights/);
 assert.equal(winterOutlookState({status:'partial',possible:false,days:[{snowChance:15}]}),'active');
 assert.equal(winterOutlookState({status:'partial',possible:false,days:[{snowChance:null,freezingRainChance:0,sleetChance:0}]}),'clear');
});

test('point maps preserve each forecast interval without adding overlapping totals',()=>{
 const start='2026-10-14T13:00:00Z',end='2026-10-15T13:00:00Z';
 const snow={blendWindows:[{start,end,mode:'nearTerm',snowfall:{value:2,coverage:40,status:'partial'}},{start:'2026-10-15T00:00:00Z',end:'2026-10-16T00:00:00Z',mode:'extended',snowfall:{value:5,coverage:30,status:'partial'}}],maps:[{id:'wpc',kind:'arcgis',label:'WPC threshold probability'}]};
 const descriptors=winterMapDescriptors(snow);
 assert.equal(descriptors[0].kind,'point-totals');
 assert.equal(descriptors[0].label,'Snow totals · forecast points');
 assert.equal(descriptors.at(-1).id,'wpc');
 assert.equal(winterPointAmount(snow,descriptors[0]).value,2);
 assert.equal(winterPointAmount(snow,descriptors[1]).value,5);
 const changed={blendWindows:[{start:'2026-10-14T14:00:00Z',end:'2026-10-15T14:00:00Z',snowfall:{value:3,coverage:15,status:'partial'}}]};
 const amount=winterPointAmount(changed,descriptors[0]);
 assert.equal(amount.aligned,false);assert.equal(amount.start,changed.blendWindows[0].start);assert.equal(amount.value,3);
 assert.match(winterPointPopupHTML(amount,'<script>bad</script>','UTC'),/15% of requested amount weight available/);
 assert.match(winterPointPopupHTML(amount,'Test town','UTC'),/not a continuous snow grid/);
 assert.doesNotMatch(winterPointPopupHTML(amount,'<script>bad</script>','UTC'),/<script>/);
 assert.equal(winterPointAmount({stormTotal:{nws:99}},{}).value,null);
 assert.equal(winterPointInBounds(39,-100),true);assert.equal(winterPointInBounds(50,5),false);assert.equal(winterPointInBounds(null,-100),false);
 assert.match(winterPointPopupHTML({value:.02,status:'partial',coverage:40},'Test town'),/&lt;0\.1″ snowfall/);
 assert.match(winterPointPopupHTML({value:0,status:'partial',coverage:40},'Test town'),/0\.0″ snowfall/);
});

test('backend winter output renders probabilities, real model coverage and matching point totals',()=>{
 const hour=3600000,now=Date.parse('2026-10-14T12:34:00Z'),axis=Date.parse('2026-10-14T12:00:00Z');
 const model=(id,value)=>({id,label:id.toUpperCase(),intervals:Array.from({length:80},(_,i)=>({start:axis+i*hour,end:axis+(i+1)*hour,value}))});
 const probabilities={method:'Native NBM hourly type probabilities.',rows:Array.from({length:80},(_,i)=>({time:axis+(i+1)*hour,snow:i===3?70:20,freezingRain:0,sleet:0}))};
 const output={location:{name:'Test town',timeZone:'UTC'},days:[{date:'2026-10-14',label:'Wednesday'},{date:'2026-10-15',label:'Thursday'}],hours:[],riskOutlooks:[]};
 addSnowOutlook(output,{now,winterModels:{hrrr:model('hrrr',.1),nam:model('nam',.2),ecmwf:model('ecmwf',.3),gfs:model('gfs',.4),probabilities},wpcWinter:{probabilities:[],amounts:[],maps:[{id:'wpc-portal',kind:'official-link',label:'Official WPC snow totals',url:'https://www.wpc.ncep.noaa.gov/Prob_Precip/'}]}});
 const snow=output.snow,html=snowDetailHTML(snow,'Test town','UTC');
 assert.equal(winterOutlookState(snow),'active');assert.match(html,/70% peak hourly/);assert.match(html,/NWS NBM/);
 assert.match(html,/Next 24 forecast hours/);assert.doesNotMatch(html,/>nearTerm/);
 const descriptor=winterMapDescriptors(snow)[0],amount=winterPointAmount(snow,descriptor);
 assert.equal(amount.value,3.3);assert.equal(amount.coverage,40);assert.equal(amount.aligned,true);
 assert.equal(amount.start,'2026-10-14T13:00:00.000Z');
 assert.match(html,/40% of requested weight/);
 assert.match(html,/Probability period/);
 const clear=snowDetailHTML({status:'ready',possible:false,days:[],maps:winterMapDescriptors(snow)},'Test town');
 assert.match(clear,/No snow in the forecast\./);assert.doesNotMatch(clear,/id="winter-map"/);
});
