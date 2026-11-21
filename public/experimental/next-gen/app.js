import {buildNextGenModel,selectedSample,stepForSample,hourlyRows,weeklyRows,comparisonRows,availableModels,modelCoverage,portraitForSample,exposureReading,warmestSunText,meterReading,confidenceOf,finite,formatTime,valueText,esc,VARIABLES,MODELS} from './model.js';
import {MeteorChart} from './charts.js';
import {createSky} from '../../weather-fusion/atmos-sky.js?v=atmos-v5';
import {weatherIcon} from '../../weather-fusion/weather-display.js?v=low-rain-display-v1';
import {dogWalkerScene} from '../../weather-fusion/exposure-scene.js?v=current-rain-20261017-v3';
import {pressureTrendText} from '../../weather-fusion/personal-details.js?v=current-rain-20261017-v3';

const $=id=>document.getElementById(id),ORIGIN='https://sun-nourie-live.onrender.com';
const PRESETS=[{name:'Knightdale, NC',latitude:35.787,longitude:-78.4806},{name:'Greenville, NC',latitude:35.6127,longitude:-77.3664},{name:'Hazen, ND',latitude:47.2944,longitude:-101.6227}];
const VIEWS=['today','hourly','week','map','compare','more'];
const TOOLS=[['best-times','Best Times','Find your best hours outside'],['car-wash','Car Wash','Plan a longer-lasting wash'],['meter','Feel Meter','Dew point & comfort outlook'],['snow','Snow & ice','Amounts, timing & winter maps'],['air-quality','Air quality','Pollutants & the AQI forecast'],['alerts','Alerts & outlooks','Official notices for this location'],['skin-exposure','How It Feels science','Shade, sun, clothing & paws'],['science','Science & sources','All calculations and source status'],['hourly-panel','Full hourly forecast','The original 48-hour detail view'],['compare','All model comparisons','Daily rain, snow, UV, AQI & more']];
const CHART_VARIABLES=['temperature','feels','rain','wind','humidity','dewpoint'];
let model=null,selectedId='now',view='today',variable='temperature',compareVariable='temperature',horizon=48,feelMode='sun',feelTouched=false,activeModels=new Set(),modelChoiceTouched=false,fullKind=null,restoring=false,legacyRestore=null,activeLegacyKey=null,activeDayDate=null,activeMetricKey=null,portraitGeneration=0,visiblePortrait=null,deferredInstall=null,originalReady=false;
const charts={home:new MeteorChart($('ng-home-chart')),hourly:new MeteorChart($('ng-hourly-chart')),weekHome:new MeteorChart($('ng-home-week')),week:new MeteorChart($('ng-week-chart')),compare:new MeteorChart($('ng-compare-chart')),full:new MeteorChart($('ng-fullscreen-chart'))};
const motionQuery=matchMedia('(prefers-reduced-motion: reduce)'),connection=navigator.connection;
let userReduced=false;try{userReduced=localStorage.getItem('ng-reduced-motion')==='true';}catch{}
let lowBattery=false;
const reduced=()=>motionQuery.matches||userReduced||connection?.saveData===true||lowBattery;
const sky=createSky($('ng-sky'),{reducedMotion:reduced()});
function syncMotion(){document.body.classList.toggle('ng-reduce-motion',reduced());$('ng-motion').checked=userReduced;sky.reducedMotion=reduced();if(document.hidden)sky.stop();else sky.start();}
function resizeSky(){sky.resize();}
window.addEventListener('resize',resizeSky,{passive:true});motionQuery.addEventListener('change',syncMotion);connection?.addEventListener?.('change',syncMotion);
document.addEventListener('visibilitychange',()=>{syncMotion();if(!document.hidden&&model&&selectedId==='now')onForecast(model.forecast);});
navigator.getBattery?.().then(battery=>{const changed=()=>{lowBattery=!battery.charging&&battery.level<=.2;syncMotion();};changed();battery.addEventListener('levelchange',changed);battery.addEventListener('chargingchange',changed);}).catch(()=>{});
$('ng-motion').addEventListener('change',()=>{userReduced=$('ng-motion').checked;try{localStorage.setItem('ng-reduced-motion',String(userReduced));}catch{}syncMotion();});
resizeSky();syncMotion();

function tabs(host,values,current,handler){host.innerHTML=values.map(key=>`<button type="button" data-variable="${key}" aria-pressed="${key===current}">${esc(VARIABLES[key].short)}</button>`).join('');host.onclick=event=>{const b=event.target.closest('[data-variable]');if(b)handler(b.dataset.variable);};}
function setVariable(key){if(!VARIABLES[key])return;variable=key;renderCharts();}
function setCompareVariable(key){compareVariable=key;modelChoiceTouched=false;renderCompare();if(fullKind==='compare')renderFull();}
function updateTabs(){for(const id of ['ng-home-tabs','ng-hourly-tabs'])tabs($(id),CHART_VARIABLES,variable,setVariable);tabs($('ng-compare-tabs'),['temperature','precipitation','wind','dewpoint','humidity','cloud'],compareVariable,setCompareVariable);$('ng-hourly-title').textContent=VARIABLES[variable].label;}
function selectRow(row){if(!row||!model)return;const id=row.isNow?'now':new Date(row.time).toISOString();if(id===selectedId)return;if(!selectedSample(model,id))return;selectedId=id;renderPerson();renderComfort();document.querySelectorAll('.ng-hour-row').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.hour===id)));}
function resetNow(){selectedId='now';renderPerson();renderComfort();}
function allSolar(){return model?.forecast.metricForecasts?.solar||[model?.forecast.solar].filter(Boolean);}
function renderCharts(){
  updateTabs();if(!model)return;
  const common={kind:'hourly',variable,zone:model.zone,solar:allSolar(),onSelect:selectRow};
  charts.home.set({...common,rows:hourlyRows(model,24)});charts.hourly.set({...common,rows:hourlyRows(model,horizon)});
  const week={kind:'week',rows:weeklyRows(model),zone:model.zone,onSelect:null,onCommit:row=>openDay(row.index)};
  charts.weekHome.set(week);charts.week.set(week);
  renderCompare();if(fullKind)renderFull();
}
function renderCompare(){
  if(!model)return;
  const rows=comparisonRows(model.forecast,compareVariable,model.now,48),ids=availableModels(rows);
  if(!modelChoiceTouched)activeModels=new Set(ids);
  $('ng-model-toggles').innerHTML=ids.map(id=>`<button type="button" data-model="${esc(id)}" aria-pressed="${activeModels.has(id)}"><i style="--model-color:${MODELS[id]?.color||'#d0d6d5'}"></i>${esc(MODELS[id]?.label||id.toUpperCase())}</button>`).join('');
  $('ng-model-coverage').innerHTML=ids.map(id=>{const c=modelCoverage(rows,id);return `<span>${esc(MODELS[id]?.label||id.toUpperCase())}: ${c.available}/${c.expected} hours${c.available<c.expected?' · gaps':''}</span>`;}).join('');
  charts.compare.set({kind:'compare',variable:compareVariable,rows,models:ids.filter(id=>activeModels.has(id)),spread:$('ng-show-range').checked,zone:model.zone,solar:allSolar(),onSelect:null,onCommit:null});
}
$('ng-show-range').addEventListener('change',()=>{renderCompare();if(fullKind==='compare')renderFull();});
$('ng-model-toggles').addEventListener('click',event=>{const b=event.target.closest('[data-model]');if(!b)return;modelChoiceTouched=true;const id=b.dataset.model;activeModels.has(id)?activeModels.delete(id):activeModels.add(id);renderCompare();if(fullKind==='compare')renderFull();});
function renderFull(){
  if(!model||!fullKind)return;
  const kind=fullKind==='week'?'week':fullKind==='compare'?'compare':'hourly';
  const rows=kind==='week'?weeklyRows(model):kind==='compare'?comparisonRows(model.forecast,compareVariable,model.now,48):hourlyRows(model,horizon);
  const currentVariable=kind==='compare'?compareVariable:variable;
  $('ng-fullscreen-title').textContent=kind==='week'?'7-day outlook':kind==='compare'?'Model comparison':VARIABLES[currentVariable].label;
  $('ng-fullscreen-tabs').hidden=kind==='week';
  if(kind!=='week')tabs($('ng-fullscreen-tabs'),kind==='compare'?['temperature','precipitation','wind','dewpoint','humidity','cloud']:CHART_VARIABLES,currentVariable,key=>{if(kind==='compare')setCompareVariable(key);else setVariable(key);});
  charts.full.set({kind,variable:currentVariable,rows,zone:model.zone,solar:allSolar(),models:availableModels(rows).filter(id=>activeModels.has(id)),spread:$('ng-show-range').checked,expanded:true,onSelect:kind==='hourly'?selectRow:null,onCommit:kind==='week'?row=>{closeDialog($('ng-chart-dialog'));openDay(row.index);}:null});
  $('ng-fullscreen-context').textContent=kind==='compare'?'Each trace is the same-hour published guidance. Missing model fields and horizons remain gaps. See the comparison screen to show or hide models.':kind==='week'?'Daily highs and lows from the same forecast as the original application. A missing remaining-day high stays blank.':'Drag the graph or use the slider. Exact hourly readings, not values interpolated from the drawn curve.';
}
function openChart(kind){if(!model)return;fullKind=kind;renderFull();openDialog($('ng-chart-dialog'));requestAnimationFrame(()=>charts.full.render());}

function renderPerson(){
  if(!model)return;
  const sample=selectedSample(model,selectedId)||model.current,step=stepForSample(model,sample),portrait=portraitForSample(model,sample);
  $('ng-location').textContent=model.forecast.location.name||'Selected location';
  $('ng-date').textContent=sample.now?formatTime(model.now,model.zone,{weekday:'long',month:'long',day:'numeric'}).toUpperCase():formatTime(Date.parse(sample.time),model.zone,{weekday:'long',hour:'numeric',minute:'2-digit'}).toUpperCase()+' · FORECAST';
  $('ng-temperature').textContent=valueText(sample.temperature);
  $('ng-condition').textContent=sample.condition||'Sky conditions unavailable';
  $('ng-feels').textContent=`Feels like ${valueText(sample.feels,'°')}`;
  const date=formatTime(sample.now?model.now:Date.parse(sample.time),model.zone,{year:'numeric',month:'2-digit',day:'2-digit'});
  const day=model.days.find(d=>formatTime(Date.parse(d.date+'T12:00:00Z'),model.zone,{year:'numeric',month:'2-digit',day:'2-digit'})===date)||model.days[0];
  $('ng-high-low').textContent=`High ${valueText(day?.high,'°')} · Low ${valueText(day?.low,'°')}`;
  $('ng-clothing-chip').textContent=portrait.clothing||'Clothing guidance unavailable';
  $('ng-back-now').hidden=sample.now;
  document.body.dataset.ngLight=sample.isDay?'day':'night';document.body.dataset.ngWeather=portrait.weather||'unknown';
  sky.setLocation(model.forecast.location.latitude,model.forecast.location.longitude);
  if(portrait.scene)sky.setState({time:step.time,scene:portrait.scene});
  const img=$('ng-person'),token=++portraitGeneration;
  if(!portrait.available){img.hidden=true;visiblePortrait=null;$('ng-landscape').style.backgroundImage='none';return;}
  if(visiblePortrait===portrait.file)return;
  img.hidden=true;$('ng-landscape').style.backgroundImage='none';visiblePortrait=null;
  const picture=new Image(),background=new Image();picture.decoding='async';background.decoding='async';
  const load=(node,file)=>new Promise((resolve,reject)=>{node.onload=resolve;node.onerror=reject;node.src='/weather-fusion/'+file;});
  Promise.all([load(picture,portrait.file),load(background,portrait.background)]).then(()=>{
    if(token!==portraitGeneration)return;
    img.src=picture.src;img.alt=`Weather-appropriate clothing: ${portrait.clothing}. ${portrait.condition}, ${portrait.light}.`;img.hidden=false;
    $('ng-landscape').style.backgroundImage=`url("${background.src}")`;visiblePortrait=portrait.file;
  }).catch(()=>{if(token===portraitGeneration){img.hidden=true;visiblePortrait=null;}});
}
function renderComfort(){
  if(!model)return;
  const sample=selectedSample(model,selectedId)||model.current,result=exposureReading(model,sample,feelMode);
  $('ng-comfort-time').textContent=sample.now?'OUTSIDE RIGHT NOW':formatTime(Date.parse(sample.time),model.zone,{weekday:'short',hour:'numeric'})+' · FORECAST';
  $('ng-comfort-value').textContent=valueText(result.value,'°');$('ng-comfort-label').textContent=result.label;
  $('ng-comfort-clothes').textContent=result.clothing||'';$('ng-comfort-note').textContent=result.note||'';
  document.querySelectorAll('[data-feel]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.feel===feelMode)));
  if(feelMode==='pets')$('ng-comfort-art').innerHTML=dogWalkerScene(sample.isDay,sample.condition,sample.feels,{...result.portrait.context,pop:sample.pop,rainExpected:sample.rainExpected,rainAround:sample.rainAround,radarThreat:sample.radarThreat});
  else if(result.portrait.available)$('ng-comfort-art').innerHTML=`<img src="/weather-fusion/${result.portrait.file}" width="1200" height="675" alt="${esc(result.portrait.clothing)}" loading="lazy" decoding="async">`;
  else $('ng-comfort-art').innerHTML='<span class="ng-chart-empty">Weather scene unavailable</span>';
  $('ng-warmest').textContent=warmestSunText(model);
}
function renderQuick(){
  if(!model)return;
  const first=model.days[0],meter=meterReading(model);
  $('ng-rain').textContent=valueText(first?.pop,'%');$('ng-precipitation').textContent=valueText(model.precipitation,'″',2);
  $('ng-aqi').textContent=valueText(model.airQuality?.aqi);$('ng-aqi-label').textContent=model.airQualityBand.label;
  $('ng-meter').textContent=valueText(meter.value,'°');$('ng-meter-label').textContent=meter.level?.label?.split('—')[0].replace(/\s+ahead\s*$/,'').trim()||'Dew point unavailable';
}
function dayLabels(){
  if(!model)return;
  const html=model.days.map(day=>{const c=confidenceOf(day);return `<button type="button" data-day-next="${day.index}" aria-label="${esc(day.dateLabel+' '+day.condition+'. '+c.label+' agreement. Open forecast details.')}">${weatherIcon(day.condition,day.isDay,25)}<span>${esc(day.label)}</span><span class="ng-day-rain">${valueText(day.pop,'%')}</span><small class="ng-confidence" data-confidence="${c.key}" title="Sky/rain agreement: ${esc(c.label)}">${esc(c.label==='Moderate'?'Mod':c.label)}</small></button>`;}).join('');
  $('ng-home-days').innerHTML=html;$('ng-week-days').innerHTML=html;
}
function renderLists(){
  if(!model)return;
  $('ng-hourly-list').innerHTML=hourlyRows(model,48).map(row=>`<button type="button" class="ng-hour-row" data-hour="${esc(row.id)}" aria-pressed="${row.id===selectedId}"><span>${row.isNow?'Now':formatTime(row.time,model.zone).replace(' ','')}<small>${formatTime(row.time,model.zone,{weekday:'short'})}</small></span>${weatherIcon(row.condition,row.isDay,27)}<span><strong>${valueText(row.temperature,'°')}</strong><small>Temp</small></span><span>${valueText(row.feels,'°')}<small>Feels</small></span><span>${valueText(row.rain,'%')}<small>${valueText(row.precipitation,' in',3)}</small></span><span>${valueText(row.wind)}<small>mph</small></span></button>`).join('');
  $('ng-week-list').innerHTML=model.days.map(day=>{const c=confidenceOf(day);return `<button type="button" class="ng-week-row" data-day-next="${day.index}"><span>${esc(day.label)}<small>${esc(day.dateLabel)}</small></span>${weatherIcon(day.condition,day.isDay,27)}<span class="ng-week-temperatures"><b>${valueText(day.high,'°')}</b><em>${valueText(day.low,'°')}</em><small>${esc(day.shortCondition)}</small></span><span>${valueText(day.pop,'%')}<small>${valueText(day.amount,' in',2)}</small></span><span class="ng-confidence" data-confidence="${c.key}">${esc(c.label)}</span></button>`;}).join('');
  const slots=hourlyRows(model,24),indices=[0,.2,.4,.6,.8,1].map(r=>Math.round((slots.length-1)*r));
  $('ng-home-conditions').innerHTML=[...new Set(indices)].filter(i=>slots[i]).map(i=>{const r=slots[i];return `<button type="button" data-hour="${esc(r.id)}" aria-label="${esc(r.label+' '+r.condition)}"><span>${esc(r.isNow?'Now':formatTime(r.time,model.zone).replace(' ',''))}</span>${weatherIcon(r.condition,r.isDay,25)}<small>${valueText(r.rain,'%')}</small></button>`;}).join('');
}
function renderConditions(){
  if(!model)return;
  const c=model.current.inputs||{},sun=model.forecast.solar||{},wind=c.wind;
  const fields=[['wind','Wind',valueText(wind,' mph'),finite(c.gust)?'Gusts '+valueText(c.gust,' mph'):'Gusts unavailable'],['humidity','Humidity',valueText(c.humidity,'%'),'Relative humidity'],['dewpoint','Dew point',valueText(c.dewpoint,'°'),'Moisture in the air'],['visibility','Visibility',valueText(c.visibility,' mi',1),'Current visibility'],['pressure','Pressure',valueText(finite(c.pressurePa)?c.pressurePa/100:finite(c.pressure)?c.pressure*33.86389:null,' mb'),'Trend in details'],['solar','Sunset',formatTime(Date.parse(sun.sunset),model.zone,{hour:'numeric',minute:'2-digit'}),'Sunrise '+formatTime(Date.parse(sun.sunrise),model.zone,{hour:'numeric',minute:'2-digit'})],['uv','Peak UV',valueText(model.forecast.days[0]?.uvMax),'Today’s forecast maximum'],['air-quality','Air quality',valueText(model.airQuality?.aqi),model.airQualityBand.label],['snow','Snow & ice',model.forecast.snow?.possible?'Possible':'Outlook','Amounts & winter maps']];
  $('ng-condition-grid').innerHTML=fields.map(([key,label,value,note])=>`<button type="button" class="ng-condition-tile" data-condition="${key}" aria-label="${esc(label+' '+value+'. Open details')}"><span>${label}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></button>`).join('');
}
function renderTake(){
  const take=$('today-uncertainty-text')?.textContent?.trim(),summary=$('briefing-summary')?.textContent?.trim();
  if(take&&!/preparing|loading|gathering/i.test(take))$('ng-take-preview').textContent=take;
  else if(summary&&!/what to expect/i.test(summary))$('ng-take-preview').textContent=summary;
  const detail=$('briefing-detail');$('ng-take-detail').innerHTML=`${summary?`<p>${esc(summary)}</p>`:''}${detail?.innerHTML||''}<button type="button" class="ng-text-button" data-legacy="alerts">Official alerts & outlooks →</button>`;
}
function renderStatus(){
  const status=$('status');if(status)$('ng-updated').textContent=status.textContent;
  $('ng-refresh').classList.toggle('is-loading',$('refresh')?.classList.contains('loading'));
  if(status?.classList.contains('error')&&!model)$('ng-condition').textContent='Forecast unavailable · tap refresh to retry';
}
function renderAlertBanner(){
  const urgent=$('urgent-alerts'),text=urgent?.textContent?.trim();
  const hasUrgent=urgent&&!urgent.hidden&&text&&!/checking|no active/i.test(text);
  const active=(model?.forecast.alerts||[]).filter(a=>!a.expires||Date.parse(a.expires)>Date.now());
  $('ng-alert-banner').hidden=!hasUrgent&&!active.length;
  $('ng-alert-banner').dataset.status=active.length?'alert':'availability';
  if(hasUrgent||active.length)$('ng-alert-banner').innerHTML=`<button type="button" data-legacy="alerts"><strong>${esc(active[0]?.event||'Alert update delayed')}</strong>${esc((hasUrgent?text:active[0]?.headline||'Open the complete notice').slice(0,250))} →</button>`;
}
function onForecast(data){
  if(!data?.location||!Array.isArray(data.hours))return;
  const previous=model?.forecast.location,changed=previous&&(previous.latitude!==data.location.latitude||previous.longitude!==data.location.longitude);
  if(changed)selectedId='now';
  model=buildNextGenModel(data,Date.now());
  if(!selectedSample(model,selectedId))selectedId='now';
  if(!feelTouched)feelMode=model.current.isDay?'sun':'night';
  if(changed)modelChoiceTouched=false;
  renderPerson();renderComfort();renderQuick();renderCharts();renderLists();dayLabels();renderConditions();renderAlertBanner();
  requestAnimationFrame(()=>{renderTake();renderStatus();});
  try{localStorage.setItem('ng-place',JSON.stringify({name:data.location.name,latitude:data.location.latitude,longitude:data.location.longitude}));}catch{}
  window.__weatherNourieNextGen={get model(){return model;},get selectedId(){return selectedId;},get view(){return view;}};
}
document.addEventListener('weather-nourie:forecast',event=>onForecast(event.detail));

function routeTo(next,{push=true,scroll=true}={}){
  if(!VIEWS.includes(next))next='today';
  if(view==='map'&&next!=='map'&&$('radar-play')?.getAttribute('aria-label')==='Pause radar animation')$('radar-play').click();
  view=next;
  document.querySelectorAll('.ng-screen').forEach(screen=>screen.hidden=screen.dataset.view!==next);
  document.querySelectorAll('.ng-bottom-nav button').forEach(button=>{if(button.dataset.viewLink===next)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('ng-more').setAttribute('aria-pressed',String(next==='more'));
  if(push)history.pushState({ngView:next},'','#'+next);
  if(scroll)window.scrollTo({top:0,behavior:'instant'});
  if(next==='map'&&originalReady){document.querySelector('#ng-legacy .jump-map')?.click();requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));}
}
function openDialog(dialog){if(!dialog.open)dialog.showModal();}
function closeDialog(dialog){if(dialog.open)dialog.close();}
function watchDialog(dialog){
  new MutationObserver(()=>{if(dialog.open&&!restoring&&history.state?.ngDialog!==dialog.id)history.pushState({ngView:view,ngDialog:dialog.id,ngLegacyKey:activeLegacyKey,ngChartKind:fullKind,ngDayDate:activeDayDate,ngMetricKey:activeMetricKey},'','#'+view+'/'+dialog.id);}).observe(dialog,{attributes:true,attributeFilter:['open']});
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    if(dialog.id==='ng-detail-dialog'&&legacyRestore){legacyRestore();legacyRestore=null;}
    if(dialog.id==='ng-chart-dialog')fullKind=null;
    if(!restoring&&history.state?.ngDialog===dialog.id)history.back();
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
}
window.addEventListener('popstate',event=>{
  restoring=true;const state=event.state||{};
  document.querySelectorAll('dialog[open]').forEach(dialog=>{if(dialog.id!==state.ngDialog)dialog.close();});
  routeTo(state.ngView||location.hash.slice(1).split('/')[0]||'today',{push:false,scroll:false});
  const target=state.ngDialog&&$(state.ngDialog);
  if(target&&!target.open){
    if(target.id==='ng-detail-dialog'&&state.ngLegacyKey)void openLegacy(state.ngLegacyKey);
    else if(target.id==='ng-chart-dialog'&&state.ngChartKind)openChart(state.ngChartKind);
    else if(target.id==='day-dialog'&&state.ngDayDate){const index=model?.days.findIndex(day=>day.date===state.ngDayDate);if(index>=0)openDay(index);}
    else if(target.id==='metric-dialog'&&state.ngMetricKey)document.querySelector(`#metrics [data-metric="${state.ngMetricKey}"]`)?.click();
    else if(target.id==='forecast-window-dialog'&&state.ngLegacyKey==='snow')void openLegacy('snow');
    else target.showModal();
  }
  restoring=false;
});
async function openLegacy(key){
  if(!originalReady||!model)return;
  activeLegacyKey=key;
  if(key==='snow'){$('open-snow').click();return;}
  if(key==='skin-exposure'){
    const button=[...document.querySelectorAll('#hourly [data-comfort-time]')].find(b=>b.dataset.comfortTime===selectedId);button?.click();
  }
  const lookup={'best-times':['best-times','Best Times','open-best-times'],'car-wash':['car-wash-forecast','Car Wash','open-car-wash'],meter:['dewpoint-gross-meter','Feel Meter','open-gross'],'air-quality':['air-quality','Air quality'],alerts:['nws-bulletins','Official alerts & outlooks'],science:['scientific-stuff','Science & sources'],'skin-exposure':['skin-exposure','How It Feels · science'],'hourly-panel':['hourly-panel','Full hourly forecast'],compare:['wn-compare-section','All model comparisons','open-compare']};
  const item=lookup[key];if(!item)return;
  if(item[2])$(item[2])?.click();
  if(key==='compare'){
    const start=performance.now();while(!$(item[0])&&performance.now()-start<12000)await new Promise(resolve=>setTimeout(resolve,60));
  }
  const panel=$(item[0]);if(!panel){$('ng-updated').textContent='That view is still preparing. Please try again.';return;}
  if(legacyRestore){legacyRestore();legacyRestore=null;}
  const placeholder=document.createComment('Next Gen detail return point');panel.before(placeholder);panel.hidden=false;panel.classList.add('is-open');
  $('ng-detail-title').textContent=item[1];$('ng-detail-content').replaceChildren(panel);
  const extras=[];
  if(key==='alerts'&&$('risk-outlooks')){const p=$('risk-outlooks'),mark=document.createComment('outlooks return');p.before(mark);$('ng-detail-content').append(p);extras.push([p,mark]);}
  legacyRestore=()=>{
    placeholder.replaceWith(panel);for(const[p,mark]of extras)mark.replaceWith(p);
    if(['best-times','car-wash','compare'].includes(key)){panel.hidden=true;if(item[2])$(item[2])?.setAttribute('aria-expanded','false');}
  };
  openDialog($('ng-detail-dialog'));requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
}
function openDay(index){if(!originalReady||!model)return;activeDayDate=model.days[index]?.date;const day=[...document.querySelectorAll('#daily [data-day]')].find(b=>Number(b.dataset.day)===index);day?.click();}
function showCondition(key){
  if(['wind','humidity','dewpoint'].includes(key)){variable=key;routeTo('hourly');renderCharts();return;}
  if(key==='air-quality'||key==='snow'){void openLegacy(key);return;}
  const metric=[...document.querySelectorAll('#metrics [data-metric]')].find(button=>button.dataset.metric===key);if(metric)metric.click();else void openLegacy('science');
}
function choosePlace(place){
  if(!finite(place?.latitude)||!finite(place?.longitude))return;
  selectedId='now';window.dispatchEvent(new CustomEvent('weather-nourie:select-location',{detail:place}));
  closeDialog($('ng-location-dialog'));
}
$('ng-search').addEventListener('input',()=>{const input=$('city-search');input.value=$('ng-search').value;input.dispatchEvent(new Event('input',{bubbles:true}));$('ng-search-results').textContent='Searching…';});
$('ng-search').addEventListener('keydown',event=>{if(event.key==='Enter')$('ng-search-results button')?.click();if(event.key==='ArrowDown')$('ng-search-results button')?.focus();});
$('ng-use-location').addEventListener('click',()=>{closeDialog($('ng-location-dialog'));$('locate').click();});
$('ng-presets').innerHTML=PRESETS.map((place,i)=>`<button type="button" data-preset="${i}">${place.name}</button>`).join('');
$('ng-tools').innerHTML=TOOLS.map(([key,label,note])=>`<button type="button" data-legacy="${key}"><strong>${label} <span aria-hidden="true">↗</span></strong><small>${note}</small></button>`).join('');
function originalLinks(){
  const links=[{href:'/weather-fusion/',label:'Original Weather Nourie'},{href:'/weather-fusion/experimental-weather.html',label:'Existing Experimental page'},{href:'/weather-fusion/atmos.html',label:'Atmos · living sky & forecast lab'},{href:'/weather-fusion/compare/',label:'Side-by-side forecast comparison'},{href:'/weather-fusion/weathernext-site.html',label:'WeatherNext data explorer'},{href:'/weather-fusion/v3/experimental-weather.html',label:'Fusion V3 experimental'},{href:'/weather-fusion/experimental-weather.html#experimental-accuracy-section',label:'Model accuracy'},{href:'/whats-up/',label:'What’s Up · weather outlook'}];
  for(const a of document.querySelectorAll('#ng-legacy a[class^="experimental-"]'))if(a.getAttribute('href')&&!a.getAttribute('href').startsWith('#'))links.push({href:a.getAttribute('href'),label:a.textContent.trim().replace(/^[^a-z0-9]+/i,'')});
  const unique=[...new Map(links.map(link=>[link.href,link])).values()];
  $('ng-original-links').innerHTML=unique.map(link=>`<a href="${esc(link.href==='/weather-fusion/experimental-weather.html'?link.href:new URL(link.href,ORIGIN).href)}">${esc(link.label)}<span aria-hidden="true">↗</span></a>`).join('');
}
document.addEventListener('click',event=>{
  const metric=event.target.closest('#metrics [data-metric]');if(metric)activeMetricKey=metric.dataset.metric;
  const link=event.target.closest('[data-view-link]');if(link){event.preventDefault();routeTo(link.dataset.viewLink);return;}
  if(event.target.closest('[data-open-location]')){openDialog($('ng-location-dialog'));return;}
  const close=event.target.closest('[data-close-dialog]');if(close){closeDialog(close.closest('dialog'));return;}
  const legacy=event.target.closest('[data-legacy]');if(legacy){void openLegacy(legacy.dataset.legacy);return;}
  if(event.target.closest('a[href="#scientific-stuff"]')){event.preventDefault();void openLegacy('science');return;}
  const expand=event.target.closest('[data-expand]');if(expand){openChart(expand.dataset.expand);return;}
  const day=event.target.closest('[data-day-next]');if(day){openDay(Number(day.dataset.dayNext));return;}
  const hour=event.target.closest('[data-hour]');if(hour){const row=model?.timeline.find(r=>r.id===hour.dataset.hour);if(row)selectRow(row);return;}
  const preset=event.target.closest('[data-preset]');if(preset){choosePlace(PRESETS[Number(preset.dataset.preset)]);return;}
  const feel=event.target.closest('[data-feel]');if(feel){feelTouched=true;feelMode=feel.dataset.feel;renderComfort();return;}
  const condition=event.target.closest('[data-condition]');if(condition){showCondition(condition.dataset.condition);return;}
  const quick=event.target.closest('[data-quick]');if(quick){if(['rain','precipitation'].includes(quick.dataset.quick)){variable='rain';routeTo('hourly');renderCharts();}else void openLegacy(quick.dataset.quick);}
});
$('ng-more').addEventListener('click',()=>routeTo(view==='more'?'today':'more'));
$('ng-refresh').addEventListener('click',()=>{if(originalReady)$('refresh').click();});
$('ng-back-now').addEventListener('click',resetNow);$('ng-hour-reset').addEventListener('click',resetNow);
$('ng-hourly-periods').addEventListener('click',event=>{const button=event.target.closest('[data-hours]');if(button){horizon=Number(button.dataset.hours);$('ng-hourly-periods').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderCharts();}});
// A horizontal gesture away from a graph or control advances forecast views;
// vertical page scrolling and graph dragging retain their normal behavior.
let swipe=null;
$('ng-main').addEventListener('touchstart',event=>{if(event.target.closest('button,a,input,select,svg,canvas,dialog,.ng-tabs,.ng-legacy-mount'))return;const touch=event.touches[0];swipe={x:touch.clientX,y:touch.clientY};},{passive:true});
$('ng-main').addEventListener('touchend',event=>{if(!swipe)return;const touch=event.changedTouches[0],dx=touch.clientX-swipe.x,dy=touch.clientY-swipe.y;swipe=null;const order=['today','hourly','week'];const index=order.indexOf(view);if(index>=0&&Math.abs(dx)>90&&Math.abs(dx)>Math.abs(dy)*2){const next=order[index+(dx<0?1:-1)];if(next)routeTo(next);}},{passive:true});
let pull=null;
$('ng-main').addEventListener('touchstart',event=>{if(scrollY>0||event.target.closest('svg,input,button,a,.ng-legacy-mount'))return;pull={y:event.touches[0].clientY,x:event.touches[0].clientX};},{passive:true});
$('ng-main').addEventListener('touchend',event=>{if(!pull)return;const t=event.changedTouches[0];if(scrollY===0&&t.clientY-pull.y>120&&Math.abs(t.clientX-pull.x)<50)$('ng-refresh').click();pull=null;},{passive:true});
function connectivity(){const offline=navigator.onLine===false;$('ng-connection').hidden=!offline;}
window.addEventListener('offline',connectivity);window.addEventListener('online',connectivity);connectivity();
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;});
$('ng-install').addEventListener('click',async()=>{if(deferredInstall){await deferredInstall.prompt();deferredInstall=null;}else $('ng-install-help').hidden=false;});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/experimental/next-gen/sw.js',{scope:'/experimental/next-gen/'}).catch(()=>{}));

async function boot(){
  // Move the existing map before its controller binds. Every original ID and
  // detail element remains in this document; only its visual placement changes.
  $('ng-map-mount').append($('map-panel'));
  document.querySelector('#ng-legacy .jump-map')?.addEventListener('click',event=>event.preventDefault());
  originalLinks();updateTabs();
  for(const dialog of document.querySelectorAll('dialog'))watchDialog(dialog);
  routeTo(location.hash.slice(1).split('/')[0]||'today',{push:false});history.replaceState({ngView:view},'','#'+view);
  const summaries=new MutationObserver(()=>{renderTake();renderStatus();renderAlertBanner();});
  for(const id of ['today-uncertainty-text','briefing-detail','briefing-summary','urgent-alerts','alerts','status','refresh'])if($(id))summaries.observe($(id),{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','hidden']});
  new MutationObserver(()=>{
    const buttons=[...$('search-results').querySelectorAll('button')];
    $('ng-search-results').replaceChildren(...buttons.map(button=>{const clone=document.createElement('button');clone.type='button';clone.textContent=button.textContent;clone.onclick=()=>{button.click();closeDialog($('ng-location-dialog'));};return clone;}));
    if(!buttons.length&&$('ng-search').value.length>=2)$('ng-search-results').textContent=$('search-results').textContent||'No matching places.';
    $('ng-search').setAttribute('aria-expanded',String(buttons.length>0));
  }).observe($('search-results'),{childList:true,subtree:true});
  await import(document.body.dataset.controller);originalReady=true;
  // Reuse the original controller's solar clock. Sunrise/sunset and resuming
  // an old tab must refresh the current scene even before another API reply.
  new MutationObserver(()=>{
    if(model&&selectedId==='now'&&Math.abs(Date.now()-model.now)>1000)onForecast(model.forecast);
  }).observe(document.body,{attributes:true,attributeFilter:['data-sky']});
  if(window.__weatherNourieForecast)onForecast(window.__weatherNourieForecast);
  const params=new URLSearchParams(location.search);let place=null;
  if(params.has('latitude')&&params.has('longitude'))place={latitude:Number(params.get('latitude')),longitude:Number(params.get('longitude')),name:params.get('name')||'Selected location'};
  else if(params.get('location'))place=PRESETS.find(p=>p.name.toLowerCase().startsWith(params.get('location').toLowerCase()));
  if(!place)try{place=JSON.parse(localStorage.getItem('ng-place'));}catch{}
  if(!place)place=PRESETS[0];
  if(!finite(place.latitude)||!finite(place.longitude)||place.latitude<24||place.latitude>50||place.longitude<-125||place.longitude>-66)place=PRESETS[0];
  choosePlace(place);
  if(view==='map')routeTo('map',{push:false,scroll:false});
}
boot().catch(error=>{console.error('Next Gen could not initialize',error);$('ng-condition').textContent='The app could not load. Please refresh.';$('ng-updated').textContent='The original Weather Nourie remains available from More.';});
