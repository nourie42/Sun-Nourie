import {customForecastInput,singleModelComparison,CUSTOM_FORECAST_METRICS,formatModelMetric} from './custom-forecast-model.js?v=metrics-v4';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const degrees=value=>finite(value)?`${Math.round(value)}°`:'Not covered';

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
      <div class="cf-chart-panel"><label class="cf-metric-label" for="cf-metric">Measurement<select id="cf-metric">${CUSTOM_FORECAST_METRICS.map(metric=>`<option value="${metric.id}">${esc(metric.label)}</option>`).join('')}</select></label><h3 class="cf-chart-title">Daily high temperature</h3><div class="cf-legend"></div><div class="cf-chart"></div></div>
      <div class="cf-result" aria-live="polite" aria-atomic="true"><p class="cf-result-summary"></p><ul class="cf-highlights"></ul><p class="cf-coverage-note"></p></div>
      <p class="cf-source-note"></p><p class="cf-method">Today ends at midnight. Hourly statistics need complete coverage; a missing model value stays blank.</p>
    </div>`;
}

/** This view only reads the existing snapshot; selecting a model never changes it. */
export function createCustomForecast({root,now=Date.now}={}){
  if(!root)return {render(){},reset(){},destroy(){}};
  let input=null,comparison=null,selectedId=null,selectedMetric='high',locationKey='';
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
      content+=`<g class="cf-day-point" data-date="${day.date}" data-baseline="${finite(baseline[index])?baseline[index]:''}" data-model-value="${finite(selected[index])?selected[index]:''}"><title>${esc(descriptions[index])}</title>`;
      if(finite(baseline[index]))content+=`<circle cx="${x(index)}" cy="${y(baseline[index])}" r="3.5" class="cf-dot cf-dot-nourie"/>`;
      if(finite(selected[index]))content+=`<circle cx="${x(index)}" cy="${y(selected[index])}" r="4.5" class="cf-dot cf-dot-model" style="fill:${comparison.color}"/>`;
      content+=`<text x="${x(index)}" y="${H-24}" text-anchor="${anchor}">${weekday}</text><text x="${x(index)}" y="${H-8}" text-anchor="${anchor}">${dateLabel}</text></g>`;
    });
    return `<svg class="cf-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(comparison.selectedId?`${comparison.label} compared with Weather Nourie`:'Published Weather Nourie forecast')}: ${esc(metric.label.toLowerCase())} for seven local dates">${content}</svg>${[...baseline,...selected].some(finite)?'':'<p class="cf-chart-empty">No complete-date values are available for this measurement yet.</p>'}`;
  }

  function renderResults(){
    comparison=singleModelComparison(input,selectedId,selectedMetric);
    selectedId=comparison.selectedId;
    $('.cf-chart-title').textContent=comparison.metric.label;
    $('.cf-legend').innerHTML=`<span><i class="cf-key cf-key-nourie"></i>Weather Nourie</span>${selectedId?`<span><i class="cf-key" style="background:${comparison.color}"></i>${esc(comparison.label)}</span>`:''}`;
    $('.cf-chart').innerHTML=chartHTML();
    $('.cf-result-summary').textContent=comparison.summary;
    $('.cf-highlights').innerHTML=comparison.narrative.highlights.map(change=>`<li>${esc(change.text)}</li>`).join('');
    $('.cf-highlights').hidden=!selectedId||!comparison.narrative.highlights.length;
    $('.cf-coverage-note').textContent=comparison.coverageNote;
    $('.cf-coverage-note').hidden=!comparison.coverageNote;
    const thermalNote='Model feels-like estimates use the site’s existing thermal formula with only that model’s matching temperature, dew point, wind and cloud inputs.';
    const sourceNotes={uv:'Published UV is a separate Open-Meteo forecast; this API does not provide UV for each weather model.',aqi:'Published air quality uses CAMS hourly values; this API does not provide AQI for each weather model.',snow:'Snowfall totals use the published period within each date. Today’s snow period may start at the next full hour.',humidity:'Model humidity is estimated from that model’s own temperature and dew point.',feels:thermalNote,feelsLow:thermalNote,feelsShade:thermalNote,feelsSun:`${thermalNote} Only applicable daylight hours enter the direct-sun peak.`};
    $('.cf-source-note').textContent=sourceNotes[selectedMetric]||'';
    $('.cf-source-note').hidden=!sourceNotes[selectedMetric];
    for(const button of root.querySelectorAll('.cf-model-button'))button.setAttribute('aria-pressed',String((selectedId||'nourie')===button.dataset.model));
  }

  function onClick(event){
    const button=event.target.closest('.cf-model-button');
    if(!button||!root.contains(button)||!input)return;
    const next=button.dataset.model;
    selectedId=next==='nourie'?null:input.models.find(model=>model.id===next&&model.available)?.id||null;
    renderResults();
  }
  root.addEventListener('click',onClick);
  const onMetricChange=event=>{if(event.target.id!=='cf-metric'||!input)return;selectedMetric=CUSTOM_FORECAST_METRICS.some(metric=>metric.id===event.target.value)?event.target.value:'high';renderResults();};
  root.addEventListener('change',onMetricChange);
  const onResize=()=>{if(comparison&&!$('.cf-content').hidden)$('.cf-chart').innerHTML=chartHTML();};
  globalThis.addEventListener?.('resize',onResize);
  function reset(){input=null;comparison=null;selectedId=null;locationKey='';$('.cf-content').hidden=true;$('.cf-loading').hidden=false;$('.cf-loading').textContent='Loading the selected location’s models…';$('.cf-location').textContent='';}
  function render(forecast){
    const next=customForecastInput(forecast,now()),sameLocation=!!locationKey&&locationKey===next.locationKey;
    input=next;
    if(!sameLocation||!input.models.some(model=>model.id===selectedId&&model.available))selectedId=null;
    locationKey=next.locationKey;
    $('.cf-location').textContent=next.location.name||'Selected location';
    $('.cf-loading').hidden=next.models.some(model=>model.available);
    if(!$('.cf-loading').hidden)$('.cf-loading').textContent='Model forecasts are unavailable for this location. Refresh to retry.';
    $('.cf-content').hidden=!next.models.some(model=>model.available)&&!next.calendarDays.some(day=>finite(day.baseline.high));
    renderButtons();renderResults();
  }
  function destroy(){root.removeEventListener('click',onClick);root.removeEventListener('change',onMetricChange);globalThis.removeEventListener?.('resize',onResize);}
  return {render,reset,destroy,get state(){return {selectedModel:selectedId,selectedMetric,comparison,built:comparison?.built,narrative:comparison?.narrative};}};
}
