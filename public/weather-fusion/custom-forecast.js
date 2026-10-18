import {customForecastInput,singleModelComparison} from './custom-forecast-model.js?v=pick-model-v3';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const degrees=value=>finite(value)?`${Math.round(value)}°`:'Not covered';

export function modelComparisonPath(values,x,y){
  let result='',pen=false;
  values.forEach((value,index)=>{if(!finite(value)){pen=false;return;}result+=`${pen?'L':'M'}${x(index).toFixed(2)},${y(value).toFixed(2)}`;pen=true;});
  return result;
}

export function modelComparisonScale(values){
  const known=values.filter(finite);
  if(!known.length)return {min:0,max:100};
  const low=Math.min(...known),high=Math.max(...known),pad=Math.max(3,(high-low)*.12);
  return {min:Math.floor(low-pad),max:Math.ceil(high+pad)};
}

function panelHTML(){
  return `<div class="cf-heading"><h2>Make your own weather</h2><p>Pick a model to compare its next seven days with Weather Nourie.</p></div>
    <p class="cf-location"></p><p class="cf-loading" role="status">Choose a location to load its available models.</p>
    <div class="cf-content" hidden>
      <div class="cf-model-buttons" role="group" aria-label="Choose a forecast model"></div>
      <div class="cf-chart-panel"><h3>Daily high temperature</h3><div class="cf-legend"></div><div class="cf-chart"></div></div>
      <div class="cf-result" aria-live="polite" aria-atomic="true"><p class="cf-result-summary"></p><ul class="cf-highlights"></ul><p class="cf-coverage-note"></p></div>
      <p class="cf-method">Today shows the remaining hours through midnight. A model needs every hour of a date to show a daily high or rainfall total.</p>
    </div>`;
}

/** This view only reads the existing snapshot; selecting a model never changes it. */
export function createCustomForecast({root,now=Date.now}={}){
  if(!root)return {render(){},reset(){},destroy(){}};
  let input=null,comparison=null,selectedId=null,locationKey='';
  root.innerHTML=panelHTML();
  const $=selector=>root.querySelector(selector);

  function renderButtons(){
    const button=(id,label,color)=>`<button type="button" class="cf-model-button" data-model="${id}" aria-pressed="${String((selectedId||'nourie')===id)}" style="--cf-model-color:${color}">${esc(label)}</button>`;
    $('.cf-model-buttons').innerHTML=button('nourie','Weather Nourie','#ffffff')+input.models.filter(model=>model.available).map(model=>button(model.id,model.label,model.color)).join('');
  }

  function chartHTML(){
    const {days,baseline,selected}=comparison;
    const W=Math.max(260,Math.min(680,$('.cf-chart').clientWidth||root.clientWidth-40||680)),H=245,left=35,right=20,top=24,bottom=48;
    const x=index=>left+(W-left-right)*index/Math.max(1,days.length-1);
    const scale=modelComparisonScale([...baseline,...selected]);
    const y=value=>H-bottom-(H-top-bottom)*(value-scale.min)/(scale.max-scale.min);
    const descriptions=days.map((day,index)=>`${day.today?'Remaining today':day.label}: Weather Nourie ${degrees(baseline[index])}${comparison.selectedId?`, ${comparison.label} ${degrees(selected[index])}`:''}.`).join(' ');
    let content=`<title>Seven-day high temperature comparison</title><desc>${esc(descriptions)} Missing full-day model coverage appears as a gap.</desc>`;
    for(let index=0;index<=4;index++){
      const value=scale.min+(scale.max-scale.min)*index/4;
      content+=`<line x1="${left}" y1="${y(value)}" x2="${W-right}" y2="${y(value)}" class="cf-grid"/><text x="${left-7}" y="${y(value)+4}" text-anchor="end">${Math.round(value)}°</text>`;
    }
    content+=`<text x="${left}" y="12">°F</text><path d="${modelComparisonPath(baseline,x,y)}" class="cf-line cf-line-nourie"/>`;
    if(comparison.selectedId)content+=`<path d="${modelComparisonPath(selected,x,y)}" class="cf-line cf-line-model" style="stroke:${comparison.color}"/>`;
    days.forEach((day,index)=>{
      const date=new Date(`${day.date}T12:00:00Z`),weekday=day.today?'Today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(date);
      const dateLabel=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'numeric',day:'numeric'}).format(date);
      const anchor='middle';
      content+=`<g class="cf-day-point" data-date="${day.date}" data-baseline="${finite(baseline[index])?baseline[index]:''}" data-model-value="${finite(selected[index])?selected[index]:''}"><title>${esc(descriptions.split('. ')[index]||`${day.label}: ${degrees(baseline[index])}`)}</title>`;
      if(finite(baseline[index]))content+=`<circle cx="${x(index)}" cy="${y(baseline[index])}" r="3.5" class="cf-dot cf-dot-nourie"/>`;
      if(finite(selected[index]))content+=`<circle cx="${x(index)}" cy="${y(selected[index])}" r="4.5" class="cf-dot cf-dot-model" style="fill:${comparison.color}"/>`;
      content+=`<text x="${x(index)}" y="${H-24}" text-anchor="${anchor}">${weekday}</text><text x="${x(index)}" y="${H-8}" text-anchor="${anchor}">${dateLabel}</text></g>`;
    });
    return `<svg class="cf-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(comparison.selectedId?`${comparison.label} compared with Weather Nourie`:'Published Weather Nourie forecast')}: high temperatures for seven local dates">${content}</svg>${[...baseline,...selected].some(finite)?'':'<p class="cf-chart-empty">No complete-day temperature values are available yet.</p>'}`;
  }

  function renderResults(){
    comparison=singleModelComparison(input,selectedId);
    selectedId=comparison.selectedId;
    $('.cf-legend').innerHTML=`<span><i class="cf-key cf-key-nourie"></i>Weather Nourie</span>${selectedId?`<span><i class="cf-key" style="background:${comparison.color}"></i>${esc(comparison.label)}</span>`:''}`;
    $('.cf-chart').innerHTML=chartHTML();
    $('.cf-result-summary').textContent=comparison.summary;
    $('.cf-highlights').innerHTML=comparison.narrative.highlights.map(change=>`<li>${esc(change.text)}</li>`).join('');
    $('.cf-highlights').hidden=!selectedId||!comparison.narrative.highlights.length;
    $('.cf-coverage-note').textContent=comparison.coverageNote;
    $('.cf-coverage-note').hidden=!comparison.coverageNote;
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
  function destroy(){root.removeEventListener('click',onClick);globalThis.removeEventListener?.('resize',onResize);}
  return {render,reset,destroy,get state(){return {selectedModel:selectedId,comparison,built:comparison?.built,narrative:comparison?.narrative};}};
}
