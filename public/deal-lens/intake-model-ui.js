(() => {

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let active=null,timer=null,lastId=null,inputId=0,exporting=false,approvedTemplate=null;const dollars=OriginalModel.money;

  const display=(n,s)=>n==null?'':n.toLocaleString('en-US',{maximumFractionDigits:s.unit.startsWith('$')||s.unit==='gallons'||s.unit==='sites'?0:2});

  function input(key,m){const s=OriginalModel.byKey[key],item=m.items[key],raw=active.originalInputs?.[key]??(key==='price'?active.modelInputs?.price:null),id='original-input-'+(++inputId);return `<div class="assumption-row ${item.status==='estimated'?'estimated':''}" data-original-wrap="${key}"><label class="assumption-label" for="${id}">${esc(s.label)} <small>${esc(s.unit)}</small></label><span class="assumption-status">${item.status==='estimated'?'ESTIMATE':item.status==='manual'?'YOUR ENTRY':item.status==='confirmed'?'CONFIRMED':'FROM DOCUMENT'}</span><input id="${id}" data-original-input="${key}" inputmode="decimal" autocomplete="off" type="text" value="${esc(raw??display(item.value,s))}"><small class="input-hint">${s.unit.startsWith('$')?dollars(item.value):display(item.value,s)+' '+s.unit}</small><details class="input-source"><summary>Source / basis</summary><p>${esc(item.basis)}</p><small>Original model: ${s.sheet}!${s.cell}</small></details></div>`;}

  function shell(){

    const main=document.createElement('section');main.id='modelPreview';main.className='deal-result';main.hidden=true;main.innerHTML='<div class="result-title"><div><span class="eyebrow">YOUR DEAL MODEL</span><h2 id="modelDealTitle"></h2><p id="modelCoverage"></p></div><button class="button primary" data-original-export>Download original COOP Excel · 13% IRR ↓</button></div><div id="intakeModelResults" aria-live="polite"></div><div id="intakeModelInputs"><div id="mainAskingPrice"></div><div class="estimate-heading"><h3>Estimates to review</h3><span id="estimateCount"></span></div><p class="estimate-intro">Your documents fill the model. Edit the red estimates below. Changes save automatically.</p><div id="mainEstimates" class="assumption-grid"></div><details class="secondary-estimates"><summary>Other model assumptions</summary><div id="otherEstimates" class="assumption-grid"></div></details><p class="original-caption">Download returns your original 22-tab COOP workbook, not a separate report. COOP!B29 is solved to a 13.0% buyer IRR at COOP!B38; other yellow/orange inputs use the reviewed deal data. Formatting and non-input formulas are preserved.</p></div>';

    document.querySelector('#dealNumbersCard').before(main);

    const evidenceSections={dealNumbersCard:'Figures read from your documents',materialsRegister:'Files in this deal',dealHistory:'Reading history and limits',prelimOutput:'Preliminary read and source tables',needsCard:'Evidence received and still needed',siteCluesCard:'Individual site facts',extractedCard:'Review and correct extracted facts',tableReviewCard:'Review seller financial tables'};
    for(const [id,title] of Object.entries(evidenceSections)){const node=document.getElementById(id);const card=node.matches('.card')?node:node.closest('article,section,.card');if(!card)continue;const detail=document.createElement('details');detail.className=card.className+' intake-evidence';detail.hidden=card.hidden;if(id==='dealNumbersCard')detail.open=true;const summary=document.createElement('summary');summary.textContent=title;detail.append(summary);while(card.firstChild)detail.append(card.firstChild);if(card.id){detail.id=card.id;card.id='';}card.replaceWith(detail);}

    document.getElementById('tableReviewCard').hidden=true;

    document.querySelector('#numbers').innerHTML='<div class="page-title"><div><div class="eyebrow">ORIGINAL WORKBOOK</div><h1>Your original model.</h1><p>All 22 tabs are preserved. The website and download use the workbook’s own formulas.</p></div><button class="button primary" data-original-export>Download original COOP Excel · 13% IRR ↓</button></div><label class="full-label">Optional clean approved COOP template (.xlsx): <input id="approvedCoopTemplate" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><small>Only the original COOP model format is accepted. Export stops when old project roster entries or identifiers remain.</small></label><p id="modelExportNotice" class="warning" role="status"></p><div id="fullModelResults"></div><details id="originalInputsCard" class="card" open><summary>Original yellow/orange inputs</summary><div id="allOriginalInputs" class="assumption-grid"></div></details><div id="originalCashflowsCard" class="card"><h2>Original model cash flows</h2><div class="site-scroll" id="originalCashflows"></div></div><details class="card"><summary>Source evidence</summary><div id="evidenceList"></div></details>';

    document.querySelector('#intakeAssumptions').hidden=true;

    document.querySelector('.intake-card .section-head h2').textContent='Use your AI chat';

  }

  function offerCase(m){
    const price=m.result?.returnCases?.B38?.maxPrice;
    if(!Number.isFinite(price))return null;
    try{
      const engine=OriginalModel.compute({...m.changes,'COOP!B29':-price});
      const irr=engine.get('COOP','B38');
      if(!Number.isFinite(irr)||Math.abs(irr-.13)>1e-7)return null;
      return {price,irr,engine};
    }catch{return null;}
  }
  function output(m){
    if(m.available===false)return '<div class="model-incomplete" role="status"><strong>Original workbook unavailable.</strong><p>'+esc(m.errors.join(' · '))+'</p></div>';
    if(!m.result)return '<div class="model-incomplete"><strong>More data needed.</strong><p>'+esc(m.errors.join(' · ')||'Import deal figures or enter model inputs first.')+'</p></div>';
    const v=offerCase(m),r=m.result,seller=m.items.price.status==='estimated'?null:m.inputs.price;
    const year= v?.engine.get('COOP','C22'),closing=v?.engine.get('COOP','B37');
    return '<p class="case-note"><strong>One authoritative COOP return: original workbook cell COOP!B38.</strong> This is the buyer IRR, not the operator return. The offer is calculated independently of the seller ask. All output below is from the same approved model engine.</p>'+
      '<div class="result-metrics parity-results">'+
      '<div class="primary-return"><span>OUR MAX COOP OFFER · COOP!B29</span><strong>'+dollars(v?.price)+'</strong><small>Offer solved at 13.0% buyer IRR</small></div>'+
      '<div class="primary-return"><span>BUYER IRR AT OUR OFFER · COOP!B38</span><strong>'+(v?(v.irr*100).toFixed(4)+'%':'Cannot verify')+'</strong><small>With capitalized lease</small></div>'+
      '<div><span>SELLER ASK (NOT OUR OFFER)</span><strong>'+dollars(seller)+'</strong><small>Ask scenario COOP!B38: '+(Number.isFinite(r.returnCases?.B38?.irr)?(r.returnCases.B38.irr*100).toFixed(4)+'%':'—')+'</small></div>'+
      '<div><span>YEAR 1 BUYER EBITDA · AT OFFER</span><strong>'+dollars(year)+'</strong><small>Original COOP!C22, same offer scenario</small></div>'+
      '<div><span>CLOSING CASH OUTFLOW · B38 BASIS</span><strong>'+dollars(Number.isFinite(closing)?-closing:null)+'</strong><small>Original COOP!B37</small></div>'+
      '<div><span>ESTIMATES TO VERIFY</span><strong>'+m.estimated+'</strong><small>Red estimates are not confirmed facts</small></div></div>';
  }

  function render(d,rebuild=true){active=d;const m=OriginalModel.calculate(d),newDeal=lastId!==d.id;if(newDeal)rebuild=true;lastId=d.id;

    document.getElementById('modelPreview').hidden=m.available!==false&&!m.hasSource&&!Object.keys(d.originalInputs||{}).length;document.getElementById('modelDealTitle').textContent=d.fields.name||'New deal';

    const facts=DealIntake.facts(d).length;document.getElementById('modelCoverage').textContent=m.available===false?facts+' source figures saved · Workbook unavailable':(m.hasSource?m.inputs.sites+' sites · '+facts+' source figures · ':'')+'Original 15-year model';
    for(const id of ['intakeModelInputs','originalInputsCard','originalCashflowsCard'])document.getElementById(id).hidden=m.available===false;

    document.getElementById('intakeModelResults').innerHTML=output(m);document.getElementById('fullModelResults').innerHTML=output(m);document.getElementById('estimateCount').textContent=m.estimated+' estimated inputs';

    document.querySelectorAll('[data-original-export]').forEach(b=>{b.disabled=exporting||!m.result;b.title=m.available===false?'The workbook must finish loading before you can download it':m.result?'Download original 22-tab COOP workbook with B29 solved for 13.0% at B38':'Read documents before downloading a populated model';});

    if(rebuild){document.getElementById('mainAskingPrice').innerHTML=input('price',m);const critical=['sites','gallons','fuelMargin','inside','insideMargin','otherIncome','opex','rent'];document.getElementById('mainEstimates').innerHTML=critical.filter(k=>m.items[k].status==='estimated'||d.originalInputs?.[k]!=null).map(k=>input(k,m)).join('')||'<p class="no-estimates">Operating figures were read from the documents.</p>';document.getElementById('otherEstimates').innerHTML=OriginalModel.definitions.filter(s=>!critical.includes(s.key)&&s.key!=='price').map(s=>input(s.key,m)).join('');document.getElementById('allOriginalInputs').innerHTML=OriginalModel.definitions.map(s=>input(s.key,m)).join('');}

    else for(const row of document.querySelectorAll('[data-original-wrap]')){const key=row.dataset.originalWrap,item=m.items[key],s=OriginalModel.byKey[key],el=row.querySelector('input');if(el!==document.activeElement)el.value=d.originalInputs?.[key]??display(item.value,s);row.classList.toggle('estimated',item.status==='estimated');row.querySelector('.assumption-status').textContent=item.status==='estimated'?'ESTIMATE':item.status==='manual'?'YOUR ENTRY':item.status==='confirmed'?'CONFIRMED':'FROM DOCUMENT';row.querySelector('.input-hint').textContent=s.unit.startsWith('$')?dollars(item.value):display(item.value,s)+' '+s.unit;row.querySelector('.input-source p').textContent=item.basis;}

    const v=offerCase(m);
    let cashRows='';
    if(v)for(let year=0;year<=15;year++){
      const col=String.fromCharCode(66+year),sum=v.engine.get('COOP',col+'37');
      cashRows+='<tr><td>'+(year||'Closing')+'</td><td>'+dollars(v.engine.get('COOP',col+'22'))+
        '</td><td>'+dollars(v.engine.get('COOP',col+'29'))+'</td><td>'+dollars(sum)+'</td></tr>';
    }
    document.getElementById('originalCashflows').innerHTML=v?
      '<p>Original COOP!B37:Q37 funds flow at the solved acquisition offer; this supports COOP!B38 = 13%. Cash out at closing is a negative number. No separate web calculator is used.</p>'+
      '<table class="model-flow"><thead><tr><th>Year</th><th>EBITDA</th><th>Contribution / exit</th><th>Cash flow (B38 basis)</th></tr></thead><tbody>'+cashRows+'</tbody></table>':
      '<p>Cannot verify a 13.0% COOP offer from the current inputs. The original workbook will not be exported as a solved deal.</p>';

    return m;

  }

  function commit(){clearTimeout(timer);if(!active)return;render(active,false);document.dispatchEvent(new CustomEvent('deal-model-change'));}

  document.addEventListener('input',e=>{const key=e.target.dataset.originalInput;if(!key||!active)return;(active.originalInputs||={})[key]=e.target.value;delete (active.originalConfirmed||={})[key];const spec=OriginalModel.byKey[key],n=DealModel.parse(e.target.value);e.target.closest('.assumption-row').querySelector('.input-hint').textContent=n==null?'Enter a number':spec.unit.startsWith('$')?dollars(n):n.toLocaleString('en-US')+' '+spec.unit;clearTimeout(timer);timer=setTimeout(commit,450);});

  document.addEventListener('focusout',e=>{if(e.target.dataset.originalInput)commit();});
  document.addEventListener('change',e=>{if(e.target.id==='approvedCoopTemplate'){approvedTemplate=e.target.files?.[0]||null;const notice=document.getElementById('modelExportNotice');if(notice)notice.textContent=approvedTemplate?'Using uploaded approved model template: '+approvedTemplate.name:'Using the mounted model template. Export will check for leftover project data.';}});

  document.addEventListener('click',async e=>{const button=e.target.closest('[data-original-export]');if(!button||button.disabled||exporting)return;commit();if(!active||!OriginalModel.calculate(active).result)return;const exportingDeal=JSON.parse(JSON.stringify(active)),label=button.textContent;exporting=true;document.querySelectorAll('[data-original-export]').forEach(b=>b.disabled=true);button.textContent='Preparing your model…';try{const blob=await OriginalModelExport.make(exportingDeal,approvedTemplate?await approvedTemplate.arrayBuffer():undefined);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(exportingDeal.fields.name||'deal').replace(/[^a-z0-9-]+/gi,'-')+'-COOP_13pct_B38.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);button.textContent='COOP workbook downloaded ✓';}catch(error){const message=String(error?.message||'Try again');button.textContent='Download blocked';const notice=document.getElementById('modelExportNotice');if(notice)notice.textContent=message;console.error(error);}finally{exporting=false;const canExport=!!(active&&OriginalModel.calculate(active).result);document.querySelectorAll('[data-original-export]').forEach(b=>b.disabled=!canExport);setTimeout(()=>button.textContent=label,5000);}});

  globalThis.DealModelUI={shell,render,commit};

})();

