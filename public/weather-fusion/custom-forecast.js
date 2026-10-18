import {customForecastInput,customPresetWeights,blendCustomForecast,publishedForecastPreview,changeCustomWeight,toggleCustomModel,normalizeCustomWeights,customForecastNarrative} from './custom-forecast-model.js?v=pick-weather-simple-v2';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

function panelHTML(){
  return `<div class="cf-heading"><h2>Make your own forecast</h2><span>Your weights, your forecast</span></div>
    <p class="cf-intro">Choose how much each model counts. We’ll explain what changes over the next seven days compared with Weather Nourie.</p>
    <p class="cf-location"></p>
    <p class="cf-loading" role="status">Choose a location to load its available models.</p>
    <div class="cf-content" hidden>
      <fieldset class="cf-presets"><legend>Start from</legend><div>
        <button type="button" class="cf-preset" data-preset="nourie">Weather Nourie</button>
        <button type="button" class="cf-preset" data-preset="nws">Just the NWS</button>
        <button type="button" class="cf-preset" data-preset="models">Models only</button>
        <button type="button" class="cf-preset" data-preset="european">Lean on the European</button>
        <button type="button" class="cf-preset" data-preset="ai">Lean on the AI</button>
      </div></fieldset>
      <div class="cf-model-head"><h3>Your model shares</h3><span class="cf-weight-total">100% total</span></div>
      <div class="cf-models"></div>
      <p class="cf-selection-note">Changing one share adjusts the others to total 100%.</p>
      <div class="cf-result" aria-live="polite" aria-atomic="true"><p class="cf-result-summary"></p><ul class="cf-highlights"></ul></div>
      <details class="cf-days"><summary>See all seven days</summary><div class="cf-day-results"></div></details>
      <p class="cf-method">If a model runs out, its share moves to your other selected models. A daily high or rainfall total needs every hour of that period. Today ends at midnight.</p>
      <p class="cf-probability-note">Rain chance comes from NWS when selected; the other models change temperature and rainfall amounts.</p>
    </div>`;
}

/** Receives the page's existing snapshot. Your selection changes only this preview. */
export function createCustomForecast({root,now=Date.now}={}){
  if(!root)return {render(){},reset(){},destroy(){}};
  let input=null,built=null,weights={},locationKey='',preset='nourie';
  root.innerHTML=panelHTML();
  const $=selector=>root.querySelector(selector);

  function renderModels(){
    $('.cf-models').innerHTML=input.models.filter(model=>model.available).map(model=>{
      const value=weights[model.id]||0,on=value>0;
      return `<div class="cf-model" data-model-row="${model.id}"><label class="cf-model-name" title="${esc(model.description)}"><input type="checkbox" class="cf-model-toggle" data-model="${model.id}" ${on?'checked':''}><span>${esc(model.label)}</span></label><input class="cf-weight-range" data-model="${model.id}" type="range" min="0" max="100" step="1" value="${value}" aria-label="${esc(model.label)} percentage" ${on?'':'disabled'}><label class="cf-weight-number-label"><input class="cf-weight-number" data-model="${model.id}" type="number" inputmode="numeric" min="0" max="100" step="1" value="${value}" aria-label="${esc(model.label)} percentage, numeric" ${on?'':'disabled'}><span>%</span></label></div>`;
    }).join('');
    const available=new Set(input.models.filter(model=>model.available).map(model=>model.id));
    $('.cf-preset[data-preset="nws"]').hidden=!available.has('nws');
    $('.cf-preset[data-preset="models"]').hidden=![...available].some(id=>id!=='nws');
    $('.cf-preset[data-preset="european"]').hidden=!available.has('ecmwf');
    $('.cf-preset[data-preset="ai"]').hidden=!available.has('wn');
    syncControls();
  }

  function syncControls(except=null){
    for(const model of input.models.filter(model=>model.available)){
      const value=weights[model.id]||0;
      for(const control of root.querySelectorAll(`[data-model="${model.id}"]`)){
        if(control.classList.contains('cf-model-toggle'))control.checked=value>0;
        else{control.disabled=value<=0;if(control!==except)control.value=value;}
      }
    }
    const total=Object.values(weights).reduce((sum,value)=>sum+value,0);
    $('.cf-weight-total').textContent=total?`${total}% total`:'Choose a model';
    $('.cf-selection-note').textContent=total?'Changing one share adjusts the others to total 100%.':'Select at least one available model.';
    for(const button of root.querySelectorAll('.cf-preset'))button.setAttribute('aria-pressed',String(button.dataset.preset===preset));
  }

  function renderResults(){
    built=preset==='nourie'?publishedForecastPreview(input,weights):blendCustomForecast(input,weights);
    const narrative=customForecastNarrative(built);
    $('.cf-result-summary').textContent=narrative.summary;
    $('.cf-highlights').innerHTML=narrative.highlights.map(change=>`<li>${esc(change.text)}</li>`).join('');
    $('.cf-highlights').hidden=!narrative.highlights.length;
    $('.cf-days').hidden=!Object.keys(weights).length;
    $('.cf-day-results').innerHTML=narrative.days.map(day=>{
      const date=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(`${day.date}T12:00:00Z`));
      const body=day.sentences.map(sentence=>{
        if(sentence.startsWith(`On ${day.label}, `))return sentence.replace(`On ${day.label}, the `,'The ');
        if(sentence.startsWith('For the rest of today, '))return sentence.replace('For the rest of today, the ','The ');
        return sentence;
      }).join(' ');
      return `<div class="cf-day" data-date="${esc(day.date)}"><h4>${esc(day.label)} <span>${esc(date)}</span></h4><p>${esc(body)}</p></div>`;
    }).join('');
    $('.cf-method').hidden=!Object.keys(weights).length;
    $('.cf-probability-note').hidden=!Object.keys(weights).length;
  }

  function onInput(event){
    const target=event.target;
    if(!input||!target.matches('.cf-weight-range,.cf-weight-number'))return;
    if(target.value===''||!finite(target.valueAsNumber))return;
    weights=changeCustomWeight(weights,target.dataset.model,target.valueAsNumber);
    if(target.valueAsNumber!==(weights[target.dataset.model]||0))target.value=weights[target.dataset.model]||0;
    preset='';syncControls(target);renderResults();
  }
  function onChange(event){
    if(!input)return;
    const target=event.target;
    if(target.matches('.cf-model-toggle')){weights=toggleCustomModel(weights,target.dataset.model,target.checked);preset='';syncControls();renderResults();}
    else if(target.matches('.cf-weight-number'))syncControls();
  }
  function onClick(event){
    const button=event.target.closest('.cf-preset');
    if(!button||!root.contains(button)||!input)return;
    preset=button.dataset.preset;weights=customPresetWeights(input,preset);syncControls();renderResults();
  }
  root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('click',onClick);

  function reset(){
    input=null;built=null;weights={};locationKey='';
    $('.cf-content').hidden=true;$('.cf-loading').hidden=false;$('.cf-loading').textContent='Loading the selected location’s models…';$('.cf-location').textContent='';
  }
  function render(forecast){
    const next=customForecastInput(forecast,now()),sameLocation=!!locationKey&&locationKey===next.locationKey;
    input=next;
    const available=new Set(input.models.filter(model=>model.available).map(model=>model.id));
    if(!sameLocation||preset==='nourie'){weights=customPresetWeights(input,'nourie');preset='nourie';}
    else weights=normalizeCustomWeights(Object.fromEntries(Object.entries(weights).filter(([id])=>available.has(id))));
    locationKey=next.locationKey;
    $('.cf-location').textContent=next.location.name||'Selected location';
    $('.cf-loading').hidden=available.size>0;
    if(!available.size)$('.cf-loading').textContent='No matching model forecasts are available for this location yet. Refresh to retry.';
    $('.cf-content').hidden=!available.size;
    renderModels();renderResults();
  }
  function destroy(){root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('click',onClick);}
  return {render,reset,destroy,get state(){return {weights:{...weights},built,narrative:built?customForecastNarrative(built):null};}};
}
