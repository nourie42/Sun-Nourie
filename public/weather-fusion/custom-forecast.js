import {customForecastInput,singleModelComparison,CUSTOM_FORECAST_METRICS,formatModelMetric} from './custom-forecast-model.js?v=ui-simple-v5';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

// Keep the complete model API available to other consumers, while this view
// offers only the everyday measurements people can compare between models.
export const CUSTOM_FORECAST_TABS=Object.freeze([
  {id:'high',label:'Temperature',title:'Daily high temperature'},
  {id:'feels',label:'Feels like',title:'Warmest feels like'},
  {id:'rain',label:'Rain chance',title:'Highest hourly rain chance'},
  {id:'amount',label:'Rainfall',title:'Total precipitation'},
  {id:'wind',label:'Wind',title:'Daily wind',note:'Wind is the average for this period.'},
  {id:'snow',label:'Snow',title:'Total snowfall'},
]);

/** The graph contains daily aggregates, so its timestamp is the actual period,
 * never a made-up hour for a high, low or total. Offset changes remain explicit. */
export function modelComparisonPoint(comparison,index=0,timeZone='America/New_York'){
  const day=comparison?.days?.[index];
  if(!day)return null;
  const dateLabel=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric',year:'numeric'}).format(new Date(`${day.date}T12:00:00Z`));
  const window=day.metric?.window;
  const stamp=value=>new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
  const periodLabel=finite(window?.start)&&finite(window?.end)&&window.end>window.start?`${stamp(window.start)} – ${stamp(window.end)}`:'Daily period not supplied.';
  return {index,date:day.date,dateLabel,periodLabel,baseline:formatModelMetric(comparison.baseline[index],comparison.metricId),selected:formatModelMetric(comparison.selected[index],comparison.metricId),modelLabel:comparison.selectedId?comparison.label:null};
}

export function modelComparisonPath(values,x,y){
  let result='',pen=false;
  values.forEach((value,index)=>{if(!finite(value)){pen=false;return;}result+=`${pen?'L':'M'}${x(index).toFixed(2)},${y(value).toFixed(2)}`;pen=true;});
  return result;
}

export function modelComparisonScale(values,metricId='high'){
  const metric=CUSTOM_FORECAST_METRICS.find(item=>item.id===metricId)||CUSTOM_FORECAST_METRICS[0];
  if(metric.unit==='%')return {min:0,max:100};
  const known=values.filter(finite);
  if(!known.length)return {min:0,max:metric.unit==='in'?.1:metric.unit==='inHg'?1:100};
  const low=Math.min(...known),high=Math.max(...known);
  if(metric.unit==='in')return {min:0,max:Math.max(metric.id==='snow'?.4:.04,high*1.15)};
  if(metric.unit==='inHg'){const pad=Math.max(.003,(high-low)*.12);return {min:low-pad,max:high+pad};}
  if(metric.unit!=='°F')return {min:0,max:Math.max(metric.id==='uv'?2:4,Math.ceil(high*1.15))};
  const pad=Math.max(3,(high-low)*.12);
  return {min:Math.floor(low-pad),max:Math.ceil(high+pad)};
}

function panelHTML(){
  return `<div class="cf-heading"><h2>Make your own weather</h2><p>Pick a model to compare its next seven days with Weather Nourie.</p></div>
    <p class="cf-location"></p><p class="cf-loading" role="status">Choose a location to load its available models.</p>
    <div class="cf-content" hidden>
      <div class="cf-model-buttons" role="group" aria-label="Choose a forecast model"></div>
      <div class="cf-metric-tabs" role="tablist" aria-label="Forecast measurement">${CUSTOM_FORECAST_TABS.map((metric,index)=>`<button type="button" class="cf-metric-tab" id="cf-tab-${metric.id}" role="tab" aria-selected="${index===0}" aria-controls="cf-measurement-panel" tabindex="${index===0?'0':'-1'}" data-metric="${metric.id}">${esc(metric.label)}</button>`).join('')}</div>
      <div class="cf-chart-panel" id="cf-measurement-panel" role="tabpanel" aria-labelledby="cf-tab-high"><h3 class="cf-chart-title">Daily high temperature</h3><div class="cf-legend"></div><div class="cf-chart"></div><p class="cf-graph-hint" id="cf-graph-hint">Tap a day or use the arrow keys to see its dates and values.</p><div class="cf-point-readout" id="cf-point-readout" role="status" aria-live="polite" aria-atomic="true"></div></div>
      <div class="cf-result" aria-live="polite" aria-atomic="true"><p class="cf-result-summary"></p><ul class="cf-highlights"></ul><p class="cf-coverage-note"></p></div>
      <p class="cf-source-note"></p><p class="cf-method">Today ends at midnight. Hourly statistics need complete coverage; a missing model value stays blank.</p>
    </div>`;
}

/** This view only reads the existing snapshot; selecting a model never changes it. */
export function createCustomForecast({root,now=Date.now}={}){
  if(!root)return {render(){},reset(){},destroy(){}};
  let input=null,comparison=null,selectedId=null,selectedMetric='high',selectedDay=0,locationKey='';
  root.innerHTML=panelHTML();
  const $=selector=>root.querySelector(selector);

  function renderButtons(){
    const button=(id,label,color)=>`<button type="button" class="cf-model-button" data-model="${id}" aria-pressed="${String((selectedId||'nourie')===id)}" style="--cf-model-color:${color}">${esc(label)}</button>`;
    $('.cf-model-buttons').innerHTML=button('nourie','Weather Nourie','#ffffff')+input.models.filter(model=>model.available).map(model=>button(model.id,model.label,model.color)).join('');
  }

  function chartHTML(){
    const {days,baseline,selected,metric}=comparison;
    const W=Math.max(260,Math.min(680,$('.cf-chart').clientWidth||root.clientWidth-40||680)),H=245,left=metric.unit==='inHg'?50:metric.unit==='in'?40:35,right=20,top=24,bottom=48;
    const x=index=>left+(W-left-right)*index/Math.max(1,days.length-1);
    const scale=modelComparisonScale([...baseline,...selected],metric.id);
    const y=value=>H-bottom-(H-top-bottom)*(value-scale.min)/(scale.max-scale.min);
    const descriptions=days.map((day,index)=>`${day.today?'Remaining today':day.label}: Weather Nourie ${formatModelMetric(baseline[index],metric.id)}${comparison.selectedId?`, ${comparison.label} ${formatModelMetric(selected[index],metric.id)}`:''}.`);
    let content=`<title>Seven-day ${esc(metric.label.toLowerCase())} comparison</title><desc>${esc(descriptions.join(' '))} Missing model coverage appears as a gap.</desc>`;
    for(let index=0;index<=4;index++){
      const value=scale.min+(scale.max-scale.min)*index/4;
      const axis=metric.unit==='°F'?`${Math.round(value)}°`:metric.unit==='inHg'?value.toFixed(3):metric.unit==='in'?value.toFixed(metric.digits):metric.id==='uv'?value.toFixed(1):Math.round(value);
      content+=`<line x1="${left}" y1="${y(value)}" x2="${W-right}" y2="${y(value)}" class="cf-grid"/><text x="${left-7}" y="${y(value)+4}" text-anchor="end">${axis}</text>`;
    }
    content+=`<text x="${left}" y="12">${esc(metric.unit)}</text><path d="${modelComparisonPath(baseline,x,y)}" class="cf-line cf-line-nourie"/>`;
    if(comparison.selectedId)content+=`<path d="${modelComparisonPath(selected,x,y)}" class="cf-line cf-line-model" style="stroke:${comparison.color}"/>`;
    days.forEach((day,index)=>{
      const date=new Date(`${day.date}T12:00:00Z`),weekday=day.today?'Today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(date);
      const dateLabel=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'numeric',day:'numeric'}).format(date);
      const anchor='middle';
      const point=modelComparisonPoint(comparison,index,input.timeZone);
      content+=`<g class="cf-day-point${index===selectedDay?' is-selected':''}" data-index="${index}" data-x="${x(index)}" data-date="${day.date}" data-baseline="${finite(baseline[index])?baseline[index]:''}" data-model-value="${finite(selected[index])?selected[index]:''}" tabindex="${index===selectedDay?'0':'-1'}" role="button" aria-pressed="${index===selectedDay}" aria-label="${esc(`${point.dateLabel}. ${point.periodLabel}. ${descriptions[index]}`)}"><title>${esc(descriptions[index])}</title><rect x="${x(index)-18}" y="${top}" width="36" height="${H-top}" class="cf-day-hit"/>`;
      if(finite(baseline[index]))content+=`<circle cx="${x(index)}" cy="${y(baseline[index])}" r="3.5" class="cf-dot cf-dot-nourie"/>`;
      if(finite(selected[index]))content+=`<circle cx="${x(index)}" cy="${y(selected[index])}" r="4.5" class="cf-dot cf-dot-model" style="fill:${comparison.color}"/>`;
      content+=`<text x="${x(index)}" y="${H-24}" text-anchor="${anchor}">${weekday}</text><text x="${x(index)}" y="${H-8}" text-anchor="${anchor}">${dateLabel}</text></g>`;
    });
    content+=`<line class="cf-crosshair" x1="${x(selectedDay)}" x2="${x(selectedDay)}" y1="${top}" y2="${H-bottom}" aria-hidden="true"/>`;
    return `<svg class="cf-plot" viewBox="0 0 ${W} ${H}" role="group" aria-describedby="cf-graph-hint" aria-label="${esc(comparison.selectedId?`${comparison.label} compared with Weather Nourie`:'Published Weather Nourie forecast')}: ${esc(metric.label.toLowerCase())} for seven local dates">${content}</svg>${[...baseline,...selected].some(finite)?'':'<p class="cf-chart-empty">No complete-date values are available for this measurement yet.</p>'}`;
  }

  function selectDay(index,{focus=false}={}){
    if(!comparison?.days.length)return;
    selectedDay=Math.max(0,Math.min(comparison.days.length-1,index));
    const point=modelComparisonPoint(comparison,selectedDay,input.timeZone);
    for(const group of root.querySelectorAll('.cf-day-point')){
      const selected=Number(group.dataset.index)===selectedDay;
      group.classList.toggle('is-selected',selected);group.setAttribute('aria-pressed',String(selected));group.setAttribute('tabindex',selected?'0':'-1');
      if(selected){
        const crosshair=$('.cf-crosshair');crosshair?.setAttribute('x1',group.dataset.x);crosshair?.setAttribute('x2',group.dataset.x);
        if(focus)group.focus();
      }
    }
    $('.cf-point-readout').innerHTML=`<p class="cf-point-date">${esc(point.dateLabel)}</p><p class="cf-point-period">${esc(point.periodLabel)}</p><div class="cf-point-values"><span>Weather Nourie<strong>${esc(point.baseline)}</strong></span>${point.modelLabel?`<span>${esc(point.modelLabel)}<strong>${esc(point.selected)}</strong></span>`:''}</div>`;
  }

  function renderChart(){
    $('.cf-chart').innerHTML=chartHTML();selectDay(selectedDay);
  }

  function renderResults(){
    comparison=singleModelComparison(input,selectedId,selectedMetric);
    selectedId=comparison.selectedId;
    const tab=CUSTOM_FORECAST_TABS.find(item=>item.id===selectedMetric);
    $('.cf-chart-title').textContent=tab.title;
    $('.cf-chart-panel').setAttribute('aria-labelledby',`cf-tab-${selectedMetric}`);
    for(const button of root.querySelectorAll('.cf-metric-tab')){const selected=button.dataset.metric===selectedMetric;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    $('.cf-legend').innerHTML=`<span><i class="cf-key cf-key-nourie"></i>Weather Nourie</span>${selectedId?`<span><i class="cf-key" style="background:${comparison.color}"></i>${esc(comparison.label)}</span>`:''}`;
    renderChart();
    $('.cf-result-summary').textContent=comparison.summary;
    $('.cf-highlights').innerHTML=comparison.narrative.highlights.map(change=>`<li>${esc(change.text)}</li>`).join('');
    $('.cf-highlights').hidden=!selectedId||!comparison.narrative.highlights.length;
    $('.cf-coverage-note').textContent=comparison.coverageNote;
    $('.cf-coverage-note').hidden=!comparison.coverageNote;
    const thermalNote='Model feels-like estimates use the site’s existing thermal formula with only that model’s matching temperature, dew point, wind and cloud inputs.';
    const sourceNotes={uv:'Published UV is a separate Open-Meteo forecast; this API does not provide UV for each weather model.',aqi:'Published air quality uses CAMS hourly values; this API does not provide AQI for each weather model.',snow:'Snowfall totals use the published period within each date. Today’s snow period may start at the next full hour.',humidity:'Model humidity is estimated from that model’s own temperature and dew point.',feels:thermalNote,feelsLow:thermalNote,feelsShade:thermalNote,feelsSun:`${thermalNote} Only applicable daylight hours enter the direct-sun peak.`};
    $('.cf-source-note').textContent=[tab.note,sourceNotes[selectedMetric]].filter(Boolean).join(' ');
    $('.cf-source-note').hidden=!$('.cf-source-note').textContent;
    for(const button of root.querySelectorAll('.cf-model-button'))button.setAttribute('aria-pressed',String((selectedId||'nourie')===button.dataset.model));
  }

  function onClick(event){
    if(!input)return;
    const tab=event.target.closest('.cf-metric-tab');
    if(tab&&root.contains(tab)){selectedMetric=tab.dataset.metric;renderResults();return;}
    const plot=event.target.closest('.cf-plot');
    if(plot&&root.contains(plot)){
      const group=event.target.closest('.cf-day-point');
      if(group){selectDay(Number(group.dataset.index));return;}
      const rect=plot.getBoundingClientRect(),view=plot.viewBox.baseVal,position=(event.clientX-rect.left)*view.width/rect.width;
      const points=[...root.querySelectorAll('.cf-day-point')];
      const nearest=points.reduce((best,point)=>Math.abs(Number(point.dataset.x)-position)<Math.abs(Number(best.dataset.x)-position)?point:best,points[0]);
      if(nearest)selectDay(Number(nearest.dataset.index));return;
    }
    const button=event.target.closest('.cf-model-button');
    if(!button||!root.contains(button))return;
    const next=button.dataset.model;
    selectedId=next==='nourie'?null:input.models.find(model=>model.id===next&&model.available)?.id||null;
    renderResults();
  }
  root.addEventListener('click',onClick);
  function onKeydown(event){
    if(!input)return;
    const tab=event.target.closest('.cf-metric-tab');
    if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();const index=CUSTOM_FORECAST_TABS.findIndex(item=>item.id===selectedMetric),length=CUSTOM_FORECAST_TABS.length;
      const next=event.key==='Home'?0:event.key==='End'?length-1:(index+(event.key==='ArrowRight'?1:-1)+length)%length;
      selectedMetric=CUSTOM_FORECAST_TABS[next].id;renderResults();$(`#cf-tab-${selectedMetric}`).focus();return;
    }
    if(!event.target.closest('.cf-plot'))return;
    if(['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)){
      event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?comparison.days.length-1:event.key==='ArrowLeft'?selectedDay-1:event.key==='ArrowRight'?selectedDay+1:selectedDay;
      selectDay(index,{focus:true});
    }
  }
  root.addEventListener('keydown',onKeydown);
  const onResize=()=>{if(comparison&&!$('.cf-content').hidden)renderChart();};
  globalThis.addEventListener?.('resize',onResize);
  function reset(){input=null;comparison=null;selectedId=null;selectedDay=0;locationKey='';$('.cf-content').hidden=true;$('.cf-loading').hidden=false;$('.cf-loading').textContent='Loading the selected location’s models…';$('.cf-location').textContent='';}
  function render(forecast){
    const next=customForecastInput(forecast,now()),sameLocation=!!locationKey&&locationKey===next.locationKey;
    input=next;
    if(!sameLocation){selectedId=null;selectedDay=0;}
    else if(!input.models.some(model=>model.id===selectedId&&model.available))selectedId=null;
    locationKey=next.locationKey;
    $('.cf-location').textContent=next.location.name||'Selected location';
    $('.cf-loading').hidden=next.models.some(model=>model.available);
    if(!$('.cf-loading').hidden)$('.cf-loading').textContent='Model forecasts are unavailable for this location. Refresh to retry.';
    $('.cf-content').hidden=!next.models.some(model=>model.available)&&!next.calendarDays.some(day=>finite(day.baseline.high));
    renderButtons();renderResults();
  }
  function destroy(){root.removeEventListener('click',onClick);root.removeEventListener('keydown',onKeydown);globalThis.removeEventListener?.('resize',onResize);}
  return {render,reset,destroy,get state(){return {selectedModel:selectedId,selectedMetric,selectedDay,point:modelComparisonPoint(comparison,selectedDay,input?.timeZone),comparison,built:comparison?.built,narrative:comparison?.narrative};}};
}
