(() => {

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let active=null,timer=null,lastId=null,inputId=0,exporting=false;const dollars=OriginalModel.money;

  const display=(n,s)=>n==null?'':n.toLocaleString('en-US',{maximumFractionDigits:s.unit.startsWith('$')||s.unit==='gallons'||s.unit==='sites'?0:2});

  function input(key,m){const s=OriginalModel.byKey[key],item=m.items[key],raw=active.originalInputs?.[key]??(key==='price'?active.modelInputs?.price:null),id='original-input-'+(++inputId);return `<div class="assumption-row ${item.status==='estimated'?'estimated':''}" data-original-wrap="${key}"><label class="assumption-label" for="${id}">${esc(s.label)} <small>${esc(s.unit)}</small></label><span class="assumption-status">${item.status==='estimated'?'ESTIMATE':item.status==='manual'?'YOUR ENTRY':item.status==='confirmed'?'CONFIRMED':'FROM DOCUMENT'}</span><input id="${id}" data-original-input="${key}" inputmode="decimal" autocomplete="off" type="text" value="${esc(raw??display(item.value,s))}"><small class="input-hint">${s.unit.startsWith('$')?dollars(item.value):display(item.value,s)+' '+s.unit}</small><details class="input-source"><summary>Source / basis</summary><p>${esc(item.basis)}</p><small>Original model: ${s.sheet}!${s.cell}</small></details></div>`;}

  function shell(){

    const main=document.createElement('section');main.id='modelPreview';main.className='deal-result';main.hidden=true;main.innerHTML='<div class="result-title"><div><span class="eyebrow">YOUR DEAL MODEL</span><h2 id="modelDealTitle"></h2><p id="modelCoverage"></p></div><button class="button primary" data-original-export>Download your model ↓</button></div><div id="intakeModelResults" aria-live="polite"></div><div id="intakeModelInputs"><div id="mainAskingPrice"></div><div class="estimate-heading"><h3>Estimates to review</h3><span id="estimateCount"></span></div><p class="estimate-intro">Your documents fill the model. Edit the red estimates below. Changes save automatically.</p><div id="mainEstimates" class="assumption-grid"></div><details class="secondary-estimates"><summary>Other model assumptions</summary><div id="otherEstimates" class="assumption-grid"></div></details><p class="original-caption">Download returns the original workbook with all 22 tabs, formatting and non-input formulas preserved. Only yellow/orange input cells are updated; calculated results refresh.</p></div>';

    document.querySelector('#dealNumbersCard').before(main);

    const evidenceSections={dealNumbersCard:'Figures read from your documents',materialsRegister:'Files in this deal',dealHistory:'Reading history and limits',prelimOutput:'Preliminary read and source tables',needsCard:'Evidence received and still needed',siteCluesCard:'Individual site facts',extractedCard:'Review and correct extracted facts',tableReviewCard:'Review seller financial tables'};
    for(const [id,title] of Object.entries(evidenceSections)){const node=document.getElementById(id);const card=node.matches('.card')?node:node.closest('article,section,.card');if(!card)continue;const detail=document.createElement('details');detail.className=card.className+' intake-evidence';detail.hidden=card.hidden;const summary=document.createElement('summary');summary.textContent=title;detail.append(summary);while(card.firstChild)detail.append(card.firstChild);if(card.id){detail.id=card.id;card.id='';}card.replaceWith(detail);}

    document.getElementById('tableReviewCard').hidden=true;

    document.querySelector('#numbers').innerHTML='<div class="page-title"><div><div class="eyebrow">ORIGINAL WORKBOOK</div><h1>Your original model.</h1><p>All 22 tabs are preserved. The website and download use the workbook’s own formulas.</p></div><button class="button primary" data-original-export>Download your model ↓</button></div><div id="fullModelResults"></div><details id="originalInputsCard" class="card" open><summary>Original yellow/orange inputs</summary><div id="allOriginalInputs" class="assumption-grid"></div></details><div id="originalCashflowsCard" class="card"><h2>Original model cash flows</h2><div class="site-scroll" id="originalCashflows"></div></div><details class="card"><summary>Source evidence</summary><div id="evidenceList"></div></details>';

    document.querySelector('#intakeAssumptions').hidden=true;

    document.querySelector('.intake-card .section-head h2').textContent='Use your AI chat';

  }

  function output(m){
    if(m.available===false)return `<div class="model-incomplete" role="status"><strong>Workbook temporarily unavailable.</strong><p>${esc(m.errors.join(' · ')||'Reload the page to try again. Your saved deals and intake tools are still available.')}</p></div>`;
    if(!m.result)return `<div class="model-incomplete"><strong>${m.errors.length?'Finish the number you’re editing.':'Upload deal materials to fill your original model.'}</strong><p>${esc(m.errors.join(' · ')||'The model will appear here after the documents are read.')}</p></div>`;
    const r=m.result,returns=Object.values(r.returnCases).map(b=>`<div class="primary-return"><span>IRR · ${esc(b.cell)}</span><strong>${b.irr==null?'—':(b.irr*100).toFixed(4)+'%'}</strong><small>${esc(b.label)}</small><small>Price at ${m.inputs.target}%: ${dollars(b.maxPrice)}</small><small>NPV at ${m.inputs.target}%: ${dollars(b.npv)}</small></div>`).join('');
    return `<p class="case-note">Estimated case · ${m.estimated} inputs to review. Source digits and missing operating terms remain assumptions.</p><div class="result-metrics parity-results">${returns}<div><span>Seller earnings base</span><strong>${dollars(m.inputs.base)}</strong><small>From documents / estimated composition</small></div><div><span>Buyer year 1 EBITDA</span><strong>${dollars(r.years[0].ebitda)}</strong><small>Original COOP model</small></div><div><span>Cash at closing · B34</span><strong>${dollars(r.initial)}</strong><small>Price, working capital, UNAM and fees</small></div><div><span>Year 1 operator add-back</span><strong>${dollars(r.years[0].contribution)}</strong><small>COOP!C29; controlled by operator retained earnings per site</small></div></div>`;
  }

  function render(d,rebuild=true){active=d;const m=OriginalModel.calculate(d),newDeal=lastId!==d.id;if(newDeal)rebuild=true;lastId=d.id;

    document.getElementById('modelPreview').hidden=m.available!==false&&!m.hasSource&&!Object.keys(d.originalInputs||{}).length;document.getElementById('modelDealTitle').textContent=d.fields.name||'New deal';

    const facts=DealIntake.facts(d).length;document.getElementById('modelCoverage').textContent=m.available===false?facts+' source figures saved · Workbook unavailable':(m.hasSource?m.inputs.sites+' sites · '+facts+' source figures · ':'')+'Original 15-year model';
    for(const id of ['intakeModelInputs','originalInputsCard','originalCashflowsCard'])document.getElementById(id).hidden=m.available===false;

    document.getElementById('intakeModelResults').innerHTML=output(m);document.getElementById('fullModelResults').innerHTML=output(m);document.getElementById('estimateCount').textContent=m.estimated+' estimated inputs';

    document.querySelectorAll('[data-original-export]').forEach(b=>{b.disabled=exporting||!m.result;b.title=m.available===false?'The workbook must finish loading before you can download it':m.result?'Download the original filled workbook':'Read documents before downloading a populated model';});

    if(rebuild){document.getElementById('mainAskingPrice').innerHTML=input('price',m);const critical=['sites','gallons','fuelMargin','inside','insideMargin','otherIncome','opex','rent'];document.getElementById('mainEstimates').innerHTML=critical.filter(k=>m.items[k].status==='estimated'||d.originalInputs?.[k]!=null).map(k=>input(k,m)).join('')||'<p class="no-estimates">Operating figures were read from the documents.</p>';document.getElementById('otherEstimates').innerHTML=OriginalModel.definitions.filter(s=>!critical.includes(s.key)&&s.key!=='price').map(s=>input(s.key,m)).join('');document.getElementById('allOriginalInputs').innerHTML=OriginalModel.definitions.map(s=>input(s.key,m)).join('');}

    else for(const row of document.querySelectorAll('[data-original-wrap]')){const key=row.dataset.originalWrap,item=m.items[key],s=OriginalModel.byKey[key],el=row.querySelector('input');if(el!==document.activeElement)el.value=d.originalInputs?.[key]??display(item.value,s);row.classList.toggle('estimated',item.status==='estimated');row.querySelector('.assumption-status').textContent=item.status==='estimated'?'ESTIMATE':item.status==='manual'?'YOUR ENTRY':item.status==='confirmed'?'CONFIRMED':'FROM DOCUMENT';row.querySelector('.input-hint').textContent=s.unit.startsWith('$')?dollars(item.value):display(item.value,s)+' '+s.unit;row.querySelector('.input-source p').textContent=item.basis;}

    const r=m.result;document.getElementById('originalCashflows').innerHTML=r?'<p>COOP!B34 · Without capitalized lease. The year 1 add-back follows the editable operator retained earnings per site in COOP!S18.</p><table class="model-flow"><thead><tr><th>Year</th><th>EBITDA</th><th>Operator add-back</th><th>Exit value</th><th>Funds flow · B34</th></tr></thead><tbody><tr><td>Closing</td><td>—</td><td>—</td><td>—</td><td>'+dollars(-r.initial)+'</td></tr>'+r.years.map(y=>'<tr><td>'+y.year+'</td><td>'+dollars(y.ebitda)+'</td><td>'+dollars(y.contribution)+'</td><td>'+dollars(y.exit)+'</td><td>'+dollars(y.cash)+'</td></tr>').join('')+'</tbody></table>':'';

    return m;

  }

  function commit(){clearTimeout(timer);if(!active)return;render(active,false);document.dispatchEvent(new CustomEvent('deal-model-change'));}

  document.addEventListener('input',e=>{const key=e.target.dataset.originalInput;if(!key||!active)return;(active.originalInputs||={})[key]=e.target.value;delete (active.originalConfirmed||={})[key];const spec=OriginalModel.byKey[key],n=DealModel.parse(e.target.value);e.target.closest('.assumption-row').querySelector('.input-hint').textContent=n==null?'Enter a number':spec.unit.startsWith('$')?dollars(n):n.toLocaleString('en-US')+' '+spec.unit;clearTimeout(timer);timer=setTimeout(commit,450);});

  document.addEventListener('focusout',e=>{if(e.target.dataset.originalInput)commit();});

  document.addEventListener('click',async e=>{const button=e.target.closest('[data-original-export]');if(!button||button.disabled||exporting)return;commit();if(!active||!OriginalModel.calculate(active).result)return;const exportingDeal=JSON.parse(JSON.stringify(active)),label=button.textContent;exporting=true;document.querySelectorAll('[data-original-export]').forEach(b=>b.disabled=true);button.textContent='Preparing your model…';try{const blob=await OriginalModelExport.make(exportingDeal);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(exportingDeal.fields.name||'deal').replace(/[^a-z0-9-]+/gi,'-')+'-original-model.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);button.textContent='Original model downloaded ✓';}catch(error){button.textContent='Download failed — try again';console.error(error);}finally{exporting=false;const canExport=!!(active&&OriginalModel.calculate(active).result);document.querySelectorAll('[data-original-export]').forEach(b=>b.disabled=!canExport);setTimeout(()=>button.textContent=label,5000);}});

  globalThis.DealModelUI={shell,render,commit};

})();

