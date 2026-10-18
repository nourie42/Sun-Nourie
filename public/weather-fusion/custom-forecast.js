import {CUSTOM_FORECAST_MODELS,customForecastInput,customPresetWeights,blendCustomForecast,changeCustomWeight,toggleCustomModel,customForecastSummary} from './custom-forecast-model.js?v=pick-weather-v1';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const percent = value => finite(value) ? `${Math.round(value)}%` : 'Unavailable';
export const customRainChanceLabel = value => finite(value) ? value < 5 ? 'Low' : percent(value) : 'Unavailable';
const metrics = {
  temperature: { label: 'Temperature', unit: '°F', summary: 'Peak temperature in shown hours', format: value => finite(value) ? `${Math.round(value)}°` : 'Unavailable' },
  rain: { label: 'Rain chance', unit: '%', summary: 'Peak hourly rain chance', format: customRainChanceLabel },
  amount: { label: 'Rainfall', unit: 'in', summary: 'Rainfall in shown hours', format: value => finite(value) ? `${value.toFixed(2)} in` : 'Unavailable' },
};

export function customForecastPath(values, x, y) {
  let path = '', previous = false;
  values.forEach((value, index) => {
    if (!finite(value)) { previous = false; return; }
    path += `${previous ? 'L' : 'M'}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    previous = true;
  });
  return path;
}

export function customForecastScale(values, metric) {
  if (metric === 'rain') return { min: 0, max: 100 };
  const known = values.filter(finite);
  if (!known.length) return { min: 0, max: metric === 'amount' ? .1 : 100 };
  if (metric === 'amount') return { min: 0, max: Math.max(.04, Math.max(...known) * 1.18) };
  const low = Math.min(...known), high = Math.max(...known), padding = Math.max(2, (high - low) * .12);
  return { min: Math.floor(low - padding), max: Math.ceil(high + padding) };
}

function panelHTML() {
  return `<div class="cf-heading"><div><p class="cf-eyebrow">PICK YOUR WEATHER</p><h2>Make your own forecast</h2></div><span class="cf-experiment">Your personal blend</span></div>
    <p class="cf-intro">Choose the models and their shares. See how your forecast compares with Weather Nourie, hour by hour.</p>
    <p class="cf-location muted"></p>
    <div class="cf-loading" role="status">Choose a location to load its available model forecasts.</div>
    <div class="cf-content" hidden>
      <fieldset class="cf-presets"><legend>Start from</legend><div><button type="button" class="cf-preset" data-preset="nourie">Nourie starting shares</button><button type="button" class="cf-preset" data-preset="nws">Just NWS</button><button type="button" class="cf-preset" data-preset="models">Models only</button><button type="button" class="cf-preset" data-preset="equal">Equal shares</button></div></fieldset>
      <div class="cf-model-head"><h3>Model shares</h3><span class="cf-weight-total">100% total</span></div>
      <div class="cf-models"></div>
      <p class="cf-selection-note" role="status"></p>
      <div class="cf-chart-panel">
        <div class="cf-chart-options"><label for="cf-metric">Compare<select id="cf-metric"><option value="temperature">Temperature</option><option value="rain">Rain chance</option><option value="amount">Rainfall</option></select></label><label for="cf-range">Show<select id="cf-range"><option value="24">24 forecast hours</option><option value="48">48 forecast hours</option><option value="168">7 days</option></select></label></div>
        <div class="cf-legend"><span><i class="cf-key cf-key-custom"></i>Your forecast</span><span><i class="cf-key cf-key-nourie"></i>Weather Nourie</span></div>
        <div class="cf-chart"></div>
        <div class="cf-hour-controls"><button type="button" class="cf-hour-step" data-step="-1" aria-label="Previous forecast hour">‹</button><label for="cf-hour"><span class="cf-selected-time"></span><input id="cf-hour" type="range" min="0" max="0" value="0" step="1" aria-label="Explore each forecast hour"></label><button type="button" class="cf-hour-step" data-step="1" aria-label="Next forecast hour">›</button></div>
        <div class="cf-readings" aria-live="polite" aria-atomic="true"></div>
        <p class="cf-hour-note"></p>
      </div>
      <div class="cf-summary"></div>
      <p class="cf-difference" aria-live="polite"></p>
      <details class="cf-method"><summary>Inputs and shares for this hour</summary><div class="cf-evidence"></div><p>Missing inputs are excluded separately for each field and hour; the remaining chosen shares add up to 100%. Gaps stay blank. Rainfall uses the models’ published amounts in inches.</p><p>Rain chance uses genuine published probabilities only. In these feeds, NWS supplies that probability; the other models supply rainfall amounts. Changing those model shares affects temperature and rainfall, not the NWS probability. If NWS is unselected or missing for an hour, your rain chance stays unavailable.</p><p>The starting preset copies Nourie’s starting shares. It does not reproduce every date-specific rule or official fallback in the published forecast. Your experiment changes only this section.</p></details>
    </div>`;
}

/** A single controller receives the same validated snapshot as the rest of the page. */
export function createCustomForecast({ root, now = Date.now } = {}) {
  if (!root) return { render() {}, reset() {}, destroy() {} };
  let input = null, built = null, weights = {}, metric = 'temperature', limit = 24, selected = 0, locationKey = '', preset = 'nourie', dragging = false;
  root.innerHTML = panelHTML();
  const $ = selector => root.querySelector(selector);
  const labelTime = (time, compact = false) => new Intl.DateTimeFormat('en-US', { timeZone: input?.timeZone || 'America/New_York', weekday: compact ? undefined : 'short', month: compact ? undefined : 'short', day: compact ? undefined : 'numeric', hour: 'numeric', ...(compact ? {} : { minute: '2-digit' }) }).format(new Date(time));
  const rows = () => (built?.hours || []).slice(0, limit);
  const effective = value => `${Math.round(value * 10) / 10}%`;

  function renderModels() {
    $('.cf-models').innerHTML = input.models.map(model => {
      const share = weights[model.id] || 0, on = share > 0;
      const hours = Math.max(...Object.values(model.coverage));
      const coverage = model.available ? `${hours} hourly inputs${model.runAt ? ` · run ${labelTime(model.runAt)}` : ''}` : 'No matching hourly inputs';
      return `<div class="cf-model${model.available ? '' : ' cf-model-unavailable'}" style="--cf-model-color:${model.color}" data-model-row="${model.id}"><label class="cf-model-name"><input type="checkbox" class="cf-model-toggle" data-model="${model.id}" ${on ? 'checked' : ''} ${model.available || on ? '' : 'disabled'}><span><strong>${esc(model.label)}</strong><small>${esc(coverage)}</small></span></label><div class="cf-weight-controls"><input class="cf-weight-range" data-model="${model.id}" type="range" min="0" max="100" step="1" value="${share}" aria-label="${esc(model.label)} percentage" ${on ? '' : 'disabled'}><label class="cf-weight-number-label"><input class="cf-weight-number" data-model="${model.id}" type="number" inputmode="numeric" min="0" max="100" step="1" value="${Math.round(share)}" aria-label="${esc(model.label)} percentage, numeric" ${on ? '' : 'disabled'}><span>%</span></label></div></div>`;
    }).join('');
    $('.cf-preset[data-preset="nws"]').disabled = !input.models.some(model => model.id === 'nws' && model.available);
    $('.cf-preset[data-preset="models"]').disabled = !input.models.some(model => model.id !== 'nws' && model.available);
    syncControls();
  }

  function syncControls(except = null) {
    for (const model of input.models) {
      const value = weights[model.id] || 0;
      for (const control of root.querySelectorAll(`[data-model="${model.id}"]`)) {
        if (control.classList.contains('cf-model-toggle')) { control.checked = value > 0; control.disabled = !model.available && value <= 0; }
        else { control.disabled = !model.available || value <= 0; if (control !== except) control.value = control.type === 'number' ? Math.round(value) : value; }
      }
    }
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    $('.cf-weight-total').textContent = total ? `${Math.round(total)}% total` : 'No models selected';
    $('.cf-selection-note').textContent = total ? 'Shares adjust together to total 100%. Missing inputs are excluded for each hour and field.' : 'Select at least one available model to build your forecast.';
    for (const button of root.querySelectorAll('.cf-preset')) button.setAttribute('aria-pressed', String(button.dataset.preset === preset));
  }

  function chartHTML(points) {
    const W = Math.max(260,Math.min(680,$('.cf-chart')?.clientWidth || root.clientWidth-40 || 680)), H = 260, left = 43, right = 10, top = 18, bottom = 42;
    const yours = points.map(row => row.custom[metric].value), nourie = points.map(row => row.baseline[metric]);
    const scale = customForecastScale([...yours, ...nourie], metric);
    const x = index => left + (W - left - right) * index / Math.max(1, points.length - 1);
    const y = value => H - bottom - (H - top - bottom) * (value - scale.min) / (scale.max - scale.min);
    const unit = metric === 'amount' ? 'in/hour' : metrics[metric].unit;
    const tick = value => metric === 'amount' ? value.toFixed(2) : Math.round(value);
    let content = `<title>Your forecast and Weather Nourie: ${esc(metrics[metric].label)}</title><desc>Move the forecast hour slider for exact values and the models used. Missing hours appear as gaps.</desc>`;
    for (let index = 0; index <= 4; index++) {
      const value = scale.min + (scale.max - scale.min) * index / 4;
      content += `<line x1="${left}" y1="${y(value)}" x2="${W-right}" y2="${y(value)}" class="cf-grid"/><text x="${left-9}" y="${y(value)+4}" text-anchor="end">${tick(value)}</text>`;
    }
    content += `<text x="${left}" y="11">${unit}</text>`;
    const ticks = [...new Set([0, Math.round((points.length - 1) / 3), Math.round(2 * (points.length - 1) / 3), points.length - 1])];
    for (const index of ticks) if (points[index]) {
      const time = points[index].time;
      const day = new Intl.DateTimeFormat('en-US', {timeZone: input.timeZone, weekday:'short'}).format(new Date(time));
      const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
      content += `<text x="${x(index)}" y="${H-20}" text-anchor="${anchor}">${esc(day)}</text><text x="${x(index)}" y="${H-4}" text-anchor="${anchor}">${esc(labelTime(time,true))}</text>`;
    }
    content += `<path d="${customForecastPath(nourie,x,y)}" class="cf-line cf-line-nourie"/><path d="${customForecastPath(yours,x,y)}" class="cf-line cf-line-custom"/>`;
    for (const [values, kind] of [[nourie,'nourie'],[yours,'custom']]) values.forEach((value,index) => {
      if (finite(value) && !finite(values[index-1]) && !finite(values[index+1])) content += `<circle cx="${x(index)}" cy="${y(value)}" r="3.5" class="cf-dot cf-dot-${kind}"/>`;
    });
    if (points[selected]) {
      content += `<line x1="${x(selected)}" y1="${top}" x2="${x(selected)}" y2="${H-bottom}" class="cf-cursor"/>`;
      for (const [values,kind] of [[nourie,'nourie'],[yours,'custom']]) if (finite(values[selected])) content += `<circle cx="${x(selected)}" cy="${y(values[selected])}" r="5" class="cf-dot cf-dot-${kind}"/>`;
    }
    return `<svg class="cf-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metrics[metric].label)} comparison graph">${content}</svg>${[...yours,...nourie].some(finite) ? '' : '<p class="cf-empty-chart">No matching data for this selection. Choose another model or time range.</p>'}`;
  }

  function renderEvidence(row) {
    const chosen = CUSTOM_FORECAST_MODELS.filter(model => weights[model.id] > 0);
    $('.cf-evidence').innerHTML = `<div class="cf-table-wrap"><table><caption>${esc(labelTime(row.time))} · source value and effective share</caption><thead><tr><th scope="col">Model</th><th scope="col">Temperature</th><th scope="col">Rain input</th><th scope="col">Rainfall</th></tr></thead><tbody>${chosen.map(model => `<tr><th scope="row">${esc(model.label)}</th>${['temperature','rain','amount'].map(key => {
      const evidence = row.custom[key], value = evidence.values[model.id];
      const formatted = key==='rain' ? percent(value) : metrics[key].format(value);
      return `<td>${finite(value) ? esc(formatted) : 'Unavailable'}<small>${finite(evidence.weights[model.id]) ? `${effective(evidence.weights[model.id])} used` : 'Excluded this hour'}</small></td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderOutputs() {
    const points = rows();
    selected = Math.max(0, Math.min(selected, points.length - 1));
    $('.cf-chart').innerHTML = chartHTML(points);
    const slider = $('#cf-hour'); slider.max = Math.max(0, points.length - 1); slider.value = selected; slider.disabled = points.length < 2;
    const row = points[selected];
    for (const button of root.querySelectorAll('.cf-hour-step')) button.disabled = !row || (button.dataset.step === '-1' ? selected <= 0 : selected >= points.length - 1);
    if (!row) {
      $('.cf-selected-time').textContent = 'No forecast hours available';
      $('.cf-readings').innerHTML = '';
      $('.cf-hour-note').textContent = 'Fresh hourly model inputs are not available for this location yet.';
      $('.cf-summary').innerHTML = '';
      $('.cf-difference').textContent = '';
      $('.cf-evidence').textContent = 'No matching inputs.';
      return;
    }
    const metricInfo = metrics[metric], ours = row.custom[metric].value, base = row.baseline[metric];
    $('.cf-selected-time').textContent = labelTime(row.time);
    slider.setAttribute('aria-valuetext', `${labelTime(row.time)}. Your forecast ${metricInfo.format(ours)}, Weather Nourie ${metricInfo.format(base)}.`);
    $('.cf-readings').innerHTML = `<div class="cf-reading cf-reading-custom"><small>Your ${metricInfo.label.toLowerCase()}</small><strong>${esc(metricInfo.format(ours))}</strong></div><div class="cf-reading"><small>Weather Nourie ${metricInfo.label.toLowerCase()}</small><strong>${esc(metricInfo.format(base))}</strong></div>`;
    const missing = row.custom[metric].missing.map(id => CUSTOM_FORECAST_MODELS.find(model=>model.id===id)?.label || id);
    const available = Object.entries(row.custom[metric].weights).map(([id,share]) => `${CUSTOM_FORECAST_MODELS.find(model=>model.id===id)?.label || id} ${effective(share)}`);
    $('.cf-hour-note').textContent = available.length ? `This hour: ${available.join(' · ')}.${missing.length && metric!=='rain' ? ` Missing ${missing.join(', ')}; other chosen shares adjust for this field.` : ''}${metric==='rain' ? ' NWS supplies the available probability; other model shares affect rainfall amounts, not this probability.' : ''}` : metric==='rain' ? 'Choose NWS to see its published rain chance. The other feeds supply rainfall amounts, not probabilities.' : 'None of your chosen models supplies this field for this hour. It stays unavailable.';
    $('.cf-summary').innerHTML = Object.entries(metrics).map(([key,config]) => {
      const summary = customForecastSummary(points,key);
      return `<div class="cf-stat" data-metric="${key}"><h3>${config.summary}</h3><strong>${esc(config.format(summary.custom))}</strong><span>Weather Nourie ${esc(config.format(summary.baseline))}</span><small>${summary.customHours}/${summary.hours} hours available${summary.completeCustom ? '' : key==='amount' ? ' · Total unavailable with missing hours' : ' · Peak of available hours only'}</small></div>`;
    }).join('');
    const summary = customForecastSummary(points,metric), biggest = summary.biggest;
    if (biggest && metricInfo.format(biggest.custom[metric].value)!==metricInfo.format(biggest.baseline[metric])) $('.cf-difference').textContent = `Biggest ${metricInfo.label.toLowerCase()} change: ${labelTime(biggest.time)}, ${metricInfo.format(biggest.custom[metric].value)} instead of ${metricInfo.format(biggest.baseline[metric])}.`;
    else $('.cf-difference').textContent = biggest ? 'Your forecast matches Weather Nourie to the displayed precision for the paired hours in this view.' : 'No paired values are available for this view yet.';
    renderEvidence(row);
  }

  function rebuild() { built = blendCustomForecast(input, weights); renderOutputs(); }
  function onInput(event) {
    const target = event.target;
    if (target.matches('.cf-weight-range,.cf-weight-number')) {
      if (target.value === '' || !finite(target.valueAsNumber)) return;
      weights = changeCustomWeight(weights,target.dataset.model,target.valueAsNumber);
      if (target.valueAsNumber !== (weights[target.dataset.model] || 0)) target.value = weights[target.dataset.model] || 0;
      preset = ''; syncControls(target); rebuild();
    } else if (target.id === 'cf-hour') { selected = Number(target.value); renderOutputs(); }
  }
  function onChange(event) {
    const target = event.target;
    if (target.matches('.cf-model-toggle')) { weights = toggleCustomModel(weights,target.dataset.model,target.checked); preset = ''; syncControls(); rebuild(); }
    else if (target.id === 'cf-metric') { metric = Object.hasOwn(metrics,target.value) ? target.value : 'temperature'; renderOutputs(); }
    else if (target.id === 'cf-range') { limit = [24,48,168].includes(Number(target.value)) ? Number(target.value) : 24; renderOutputs(); }
    else if (target.matches('.cf-weight-number')) syncControls();
  }
  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button) || !input) return;
    if (button.matches('.cf-preset')) { preset = button.dataset.preset; weights = customPresetWeights(input,preset); syncControls(); rebuild(); }
    else if (button.matches('.cf-hour-step')) { selected += Number(button.dataset.step); renderOutputs(); }
  }
  function selectPointer(event) {
    const plot = $('.cf-plot'), points = rows();
    if (!plot || !points.length) return;
    const bounds = plot.getBoundingClientRect(), width = Number(plot.getAttribute('viewBox').split(' ')[2]);
    const x = (event.clientX - bounds.left) / bounds.width * width;
    selected = Math.round(Math.max(0,Math.min(1,(x-43)/(width-43-10))) * (points.length-1)); renderOutputs();
  }
  function onPointerDown(event) {
    if (!event.target.closest('.cf-plot')) return;
    dragging = true; root.setPointerCapture?.(event.pointerId); selectPointer(event);
  }
  const onPointerMove = event => { if (dragging) selectPointer(event); };
  const onPointerUp = () => { dragging = false; };
  root.addEventListener('input',onInput); root.addEventListener('change',onChange); root.addEventListener('click',onClick);
  root.addEventListener('pointerdown',onPointerDown); root.addEventListener('pointermove',onPointerMove); root.addEventListener('pointerup',onPointerUp); root.addEventListener('pointercancel',onPointerUp);
  const onResize = () => { if (built && !$('.cf-content').hidden) renderOutputs(); };
  globalThis.addEventListener?.('resize',onResize);

  function reset() {
    input = null; built = null; weights = {}; locationKey = ''; selected = 0; dragging = false;
    $('.cf-content').hidden = true; $('.cf-loading').hidden = false; $('.cf-loading').textContent = 'Loading the selected location’s hourly model inputs…'; $('.cf-location').textContent = '';
  }
  function render(forecast) {
    const next = customForecastInput(forecast,now()), sameLocation = !!locationKey && locationKey === next.locationKey;
    const selectedTime = rows()[selected]?.timestamp;
    input = next;
    if (!sameLocation) { weights = customPresetWeights(next,'nourie'); preset = 'nourie'; selected = 0; }
    locationKey = next.locationKey;
    built = blendCustomForecast(input,weights);
    if (sameLocation && finite(selectedTime)) { const index = built.hours.findIndex(row=>row.timestamp===selectedTime); selected = Math.max(0,index); }
    $('.cf-loading').hidden = true; $('.cf-content').hidden = false;
    $('.cf-location').textContent = `${next.location.name || 'Selected location'} · All times ${next.timeZone}${next.assembledAt ? ` · updated ${labelTime(next.assembledAt)}` : ''}`;
    renderModels(); renderOutputs();
  }
  function destroy() {
    root.removeEventListener('input',onInput); root.removeEventListener('change',onChange); root.removeEventListener('click',onClick);
    root.removeEventListener('pointerdown',onPointerDown); root.removeEventListener('pointermove',onPointerMove); root.removeEventListener('pointerup',onPointerUp); root.removeEventListener('pointercancel',onPointerUp);
    globalThis.removeEventListener?.('resize',onResize);
  }
  return { render, reset, destroy, get state() { return { weights: {...weights}, metric, limit, selected, built }; } };
}
