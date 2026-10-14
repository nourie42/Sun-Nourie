import test from 'node:test';
import assert from 'node:assert/strict';
import {snowDetailHTML,snowBannerSummary,snowForecastPresent,winterOutlookState,safeWinterMapUrl,winterMapDescriptors,winterPointAmount,winterPointInBounds,winterPointPopupHTML,winterSnowDays,winterSnowMapForDay,winterDayAmount,winterMapsHTML,winterAreaDataUrl} from '../public/weather-fusion/snow-outlook.js';

test('Cortland model-estimate snow uses its exact daily regional field instead of a partial WPC period',()=>{
 const start='2026-10-17T04:00:00.000Z',end='2026-10-18T04:00:00.000Z';
 const day={date:'2026-10-17',label:'Sat',index:3,snowExpected:true,amountWindow:{start,end},displaySnowfall:{value:.1,source:'Available model guidance',status:'partial',start,end},snowEventWindows:[{start:'2026-10-17T06:00:00Z',end:'2026-10-17T18:00:00Z'}]};
 const model={id:'model-saturday',source:'model-grid',kind:'geojson',quantity:'snowfall',start,end,sourceUrl:'https://open-meteo.com/en/docs'};
 const snow={status:'partial',days:[day],maps:[{id:'wpc-partial',kind:'geojson',quantity:'snowfall',start:'2026-10-16T12:00:00Z',end:'2026-10-17T12:00:00Z'},model]};
 assert.equal(winterSnowMapForDay(snow,day),model);
 const html=snowDetailHTML(snow,'Cortland, NY','America/New_York');
 assert.match(html,/data-map-id="model-saturday"/);assert.match(html,/Forecast snowfall totals map/);assert.match(html,/Model forecast data/);
 assert.doesNotMatch(html,/WPC snowfall map/);
});

test('regional model map URLs preserve exact periods and reject unsupported or unbounded requests',()=>{
 const start='2026-10-17T04:00:00.000Z',end='2026-10-18T04:00:00.000Z';
 const params={kind:'model-grid',lat:'42.60118',lon:'-76.18048',start,end,segments:JSON.stringify([{start,end,models:['ecmwf','gfs']}])};
 const url=changes=>'/api/weather-fusion/winter-map?'+new URLSearchParams({...params,...changes});
 const accepted=winterAreaDataUrl(url({}));assert.ok(accepted);
 assert.equal(new URL(accepted,'https://test.invalid').searchParams.get('segments'),params.segments);
 for(const changes of [{lat:'90'},{end:'2026-10-20T04:00:00Z'},{segments:JSON.stringify([{start,end,models:['unapproved']}])},{segments:JSON.stringify([{start:'2026-10-17T05:00:00Z',end,models:['ecmwf']}])},{segments:'not json'}])assert.equal(winterAreaDataUrl(url(changes)),null);
 assert.equal(winterAreaDataUrl('https://external.invalid'+url({})),null);
});

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

test('ice-only and sleet-only forecasts keep the simple no-snow view and retain collapsed winter details',()=>{
 for(const kind of ['freezingRain','sleet']){
  const data={status:'partial',possible:false,days:[{index:1,date:'2026-10-15',label:'Thursday',possible:false,[kind+'Possible']:true,best:null}]};
  assert.equal(winterOutlookState(data),'active');
  const html=snowDetailHTML(data,'Test town');
  assert.match(html,/Possible · percentage unavailable/);
  assert.match(html,/No snow in the forecast\./);
  assert.match(html,/<details class="winter-more"><summary>More winter details/);
  assert.doesNotMatch(html.split('<details')[0],/winter-type-grid|winter-map|Snow amount/);
  assert.match(html,/Snow amount <strong>Unavailable/);
  assert.match(snowBannerSummary(data),/Thursday/);
 }
});

test('winter details honor blend coverage, escaping and official-map fallbacks',()=>{
 const injection='<img src=x onerror=alert(1)>';
 const data={status:'partial',possible:true,days:[{possible:true,snowExpected:true,date:'2026-10-15',label:injection,best:2,amountWindow:{start:'2026-10-15T00:00:00Z',end:'2026-10-16T00:00:00Z'},range:[injection,4],typeSignals:{snow:{label:injection}},periods:[{name:injection,wording:injection}]}],
  blendWindows:[{label:injection,start:'2026-10-15T00:00:00Z',end:'2026-10-16T00:00:00Z',snowfall:{value:2,weights:{wpc:60,hrrr:25,nam:15},coverage:40,status:'partial',actualWeights:{wpc:0,hrrr:62.5,nam:37.5},sources:[{id:'hrrr',value:2,message:injection}]}}],
  maps:[{id:injection,label:injection,kind:'geojson',quantity:'snowfall',start:'2026-10-15T00:00:00Z',end:'2026-10-16T00:00:00Z',sourceUrl:'javascript:alert(1)'}],notes:injection};
 const html=snowDetailHTML(data,injection,'Invalid/timezone');
 assert.doesNotMatch(html,/<img|onerror="|href="javascript:/);
 assert.match(html,/&lt;img/);
 assert.match(html,/Snow amount <strong>2\.0″/);
 assert.match(html,/40% of requested weight/);
 assert.match(html,/Contributing weights/);
 assert.match(html,/href="https:\/\/www\.wpc\.ncep\.noaa\.gov/);
 assert.match(html,/role="region" aria-label="Official snowfall totals map"/);
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

test('simple snow view shows only snowy dates, one matching totals map and a separate advanced flow',()=>{
 const area=(id,start,end)=>({id,kind:'geojson',quantity:'snowfall',start,end,sourceUrl:'https://www.wpc.ncep.noaa.gov/'});
 const maps=[area('today','2026-10-14T12:00:00Z','2026-10-15T12:00:00Z'),area('tomorrow','2026-10-15T12:00:00Z','2026-10-16T12:00:00Z'),area('later','2026-10-16T12:00:00Z','2026-10-17T12:00:00Z'),{id:'qpf',kind:'arcgis',label:'QPF liquid precipitation',start:'2026-10-15T00:00:00Z',end:'2026-10-16T00:00:00Z'}];
 const day=(date,index,snow)=>({date,index,label:['Wed','Thu','Fri','Sat'][index],snowExpected:snow,possible:snow,amountWindow:{start:date+'T00:00:00Z',end:new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString()},displaySnowfall:{value:index===1?1.2:2.3,range:null,source:'NWS point forecast'},range:[0,9],best:8});
 const s={status:'partial',possible:true,maps,days:[day('2026-10-14',0,false),day('2026-10-15',1,true),day('2026-10-16',2,true),{...day('2026-10-17',3,false),freezingRainPossible:true}]};
 assert.deepEqual(winterSnowDays(s).map(r=>r.date),['2026-10-15','2026-10-16']);
 const primary=snowDetailHTML(s,'Test town','UTC').split('<details')[0];
 assert.match(primary,/data-snow-date="2026-10-15" aria-pressed="true"/);
 assert.match(primary,/data-map-id="tomorrow"/);
 assert.match(primary,/<strong>1\.2″<\/strong>/);
 assert.doesNotMatch(primary,/0–9|8\.0″|2026-10-14|2026-10-17|winter-type-grid|winter-map-select|QPF|Requested|probabilit|winter-blends/);
 assert.equal((primary.match(/id="winter-map"/g)||[]).length,1);
 const later=snowDetailHTML(s,'Test town','UTC','2026-10-16').split('<details')[0];
 assert.match(later,/data-map-id="later"/);assert.match(later,/<strong>2\.3″<\/strong>/);assert.doesNotMatch(later,/data-map-id="today"/);
 assert.match(snowDetailHTML(s,'Test town','UTC'),/<details class="winter-more"><summary>More winter details/);
 const advanced=winterMapsHTML(s,'Test town');assert.match(advanced,/winter-map-select/);assert.match(advanced,/QPF liquid precipitation/);assert.match(advanced,/data-winter-back/);
 const noMap=snowDetailHTML({...s,maps:[maps[0]]},'Test town','UTC','2026-10-16').split('<details')[0];
 assert.match(noMap,/not available for this date/);assert.doesNotMatch(noMap,/id="winter-map"/);
 assert.equal(winterDayAmount({best:8,displaySnowfall:{value:null,status:'unavailable'}}).value,null);
});

test('overnight snow selects the map covering the actual event before daily blank hours',()=>{
 const before={id:'overnight',kind:'geojson',quantity:'snowfall',start:'2026-10-14T12:00:00Z',end:'2026-10-15T12:00:00Z'};
 const after={id:'after-snow',kind:'geojson',quantity:'snowfall',start:'2026-10-15T12:00:00Z',end:'2026-10-16T12:00:00Z'};
 const r={amountWindow:{start:'2026-10-15T07:00:00Z',end:'2026-10-16T07:00:00Z'},snowEventWindows:[{start:'2026-10-15T07:00:00Z',end:'2026-10-15T11:00:00Z'}]};
 assert.equal(winterSnowMapForDay({maps:[after,before]},r)?.id,'overnight');
 assert.equal(winterSnowMapForDay({maps:[after]},r),null);
 // Without timing evidence, use the greatest overlap with the local-day interval.
 assert.equal(winterSnowMapForDay({maps:[before,after]},{amountWindow:r.amountWindow})?.id,'after-snow');
 assert.equal(winterSnowMapForDay({maps:[{...before,quantity:'precipitation'}]},r),null);
});

test('known zero NWS accumulation with only a weak NBM signal stays out of primary snow days and the tile',()=>{
 const row={date:'2026-10-20',label:'Tue',snowExpected:true,snowPossible:true,possible:true,snowChance:16,best:0,periods:[],displaySnowfall:{value:0,range:null,source:'NWS point forecast',status:'ready'}};
 const s={status:'partial',possible:true,snowExpected:true,days:[row]};
 assert.deepEqual(winterSnowDays(s),[]);assert.equal(snowForecastPresent(s),false);
 const html=snowDetailHTML(s,'Test town','UTC');assert.match(html.split('<details')[0],/No snow in the forecast/);assert.doesNotMatch(html.split('<details')[0],/2026-10-20|winter-map|0\.0″/);
 assert.match(html.split('<details')[1],/16% peak hourly/);
 const snowWording={...row,periods:[{wording:'Chance Snow Showers',snowWording:true}]};assert.equal(winterSnowDays({...s,days:[snowWording]}).length,1);
 const trace={...row,displaySnowfall:{...row.displaySnowfall,value:.02}};assert.equal(winterSnowDays({...s,days:[trace]}).length,1);assert.match(snowDetailHTML({...s,days:[trace]},'Test town'),/&lt;0\.1″/);
 const unknown={...row,displaySnowfall:{...row.displaySnowfall,value:null,status:'unavailable'}};assert.equal(winterSnowDays({...s,days:[unknown]}).length,1);assert.match(snowDetailHTML({...s,days:[unknown]},'Test town'),/Snowfall amount is not available yet/);
});
