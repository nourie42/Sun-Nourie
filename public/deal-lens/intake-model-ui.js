(() => {

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let active=null,timer=null,lastId=null,inputId=0,exporting=false,simpleExporting=false;const dollars=OriginalModel.money;

  const display=(n,s)=>n==null?'':n.toLocaleString('en-US',{maximumFractionDigits:s.unit.startsWith('$')||s.unit==='gallons'||s.unit==='sites'?0:2});

  function input(key,m){const s=OriginalModel.byKey[key],item=m.items[key],raw=active.originalInputs?.[key]??(key==='price'?active.modelInputs?.price:null),id='original-input-'+(++inputId);return `<div class="assumption-row ${item.status==='estimated'?'estimated':''}" data-original-wrap="${key}"><label class="assumption-label" for="${id}">${esc(s.label)} <small>${esc(s.unit)}</small></label><span class="assumption-status">${item.status==='estimated'?'ESTIMATE':item.status==='manual'?'YOUR ENTRY':item.status==='confirmed'?'CONFIRMED':'FROM DOCUMENT'}</span><input id="${id}" data-original-input="${key}" inputmode="decimal" autocomplete="off" type="text" value="${esc(raw??display(item.value,s))}"><small class="input-hint">${s.unit.startsWith('$')?dollars(item.value):display(item.value,s)+' '+s.unit}</small><details class="input-source"><summary>Source / basis</summary><p>${esc(item.basis)}</p><small>Original model: ${s.sheet}!${s.cell}</small></details></div>`;}


  /* The simple COOP export rebuilds the COOP tab alone from the original
     workbook's calculated inputs, then refuses to download unless its funds
     flows and IRRs agree with the original workbook. */
  function simpleModel(d){
    const m=OriginalModel.calculate(d);if(!m.result)throw Error(m.errors[0]||'Read the deal materials before exporting.');
    const e=m.result.engine,g=a=>{const v=e.get('COOP',a);return typeof v==='number'&&Number.isFinite(v)?v:0;},years='CDEFGHIJKLMNOPQ'.split('');
    const p={name:d.fields.name||'Untitled deal',sites:g('C2'),gallons:g('C3'),volumeRate:g('S3'),cpg:g('C4'),cpgGrowth:g('S4'),fuelSynergyCpg:g('S6'),inside:g('C9'),insideGrowth:g('S9'),insideMargin:g('C10'),insideSynergy:g('S12'),other:g('C14'),otherGrowth:g('S14'),opex:g('C16'),opexGrowth:g('S16'),opexSynergy:g('S17'),drawPerSite:g('S18'),addBackDraw:Math.abs(g('C29')+g('C18'))<.005,fieldPerSite:g('S19'),rent:g('C21'),rentGrowth:g('S21'),itPerSite:g('S23'),maintYear1PerSite:g('C2')?g('C24')/g('C2'):0,maintPerSite:g('S24'),tank:years.map(c=>g(c+'25')),laterGrowthCapital:years.slice(1).map(c=>g(c+'26')),growthSites:g('S26'),taxRate:g('S27'),wcPerSite:g('S28'),price:-g('B29'),unams:-g('B30'),closingRate:g('B29')?g('B31')/g('B29'):0,exitMultiple:g('S29'),target:m.inputs.target/100};
    const simple=CoopSimple.calculate(p),original=[OriginalModel.returnBases.B34.row,OriginalModel.returnBases.B38.row].map(row=>['B',...years].map(c=>g(c+row)));
    const off=(a,b)=>a.some((x,i)=>!(Math.abs(x-b[i])<=.01));
    if(off(simple.flows,original[0])||off(simple.leaseFlows,original[1]))throw Error('The simple COOP model does not reconcile to the original workbook for this deal. Download the full model instead.');
    return {m,simple};
  }
  function summaryMeta(d,m){
    const f=d.fields,gates=Object.values(d.gates||{}),yes=gates.filter(g=>g.status==='yes').length,no=gates.filter(g=>g.status==='no').length;
    return {name:f.name||'Untitled deal',subtitle:[f.market,f.scope,(m.inputs.sites||f.sites)+' sites',f.stage].filter(Boolean).join(' · '),recommendation:f.recommendation,
      notes:[['Thesis',f.thesis],['Why Sunoco',f.whyUs],['Biggest downside',f.downside],['Next action',f.nextAction&&[f.nextAction,f.actionOwner&&'Owner: '+f.actionOwner,f.actionDue&&'Due: '+f.actionDue].filter(Boolean).join(' · ')],['Decision needed',f.chipAsk],
        ['Strategic gates',`${yes} of 7 proven · ${no} concern${no===1?'':'s'} · ${7-yes-no} open`],['Model inputs',`${m.estimated} estimated input${m.estimated===1?'':'s'} still to review. Earnings basis: ${m.meta.base.basis}`]],
      footer:'Simple COOP model reconciled to the original workbook (COOP!B34 / B38). Estimated inputs are assumptions; review before relying on them. Not an approved offer.'};
  }

  function shell(){

    const main=document.createElement('section');main.id='modelPreview';main.className='deal-result';main.hidden=true;main.innerHTML='<div class="result-title"><div><span class="eyebrow">YOUR DEAL MODEL</span><h2 id="modelDealTitle"></h2><p id="modelCoverage"></p></div><div class="title-actions"><button class="button primary" data-original-export>Download your model ↓</button><button class="button subtle" data-simple-export="xlsx" title="One COOP tab with live formulas">Simple COOP model ↓</button><button class="button subtle" data-simple-export="pdf" title="One-page visual summary of the deal">Deal summary PDF ↓</button></div></div><div id="intakeModelResults" aria-live="polite"></div><div id="intakeModelInputs"><div id="mainAskingPrice"></div><div class="estimate-heading"><h3>Estimates to review</h3><span id="estimateCount"></span></div><p class="estimate-intro">Your documents fill the model. Edit the red estimates below. Changes save automatically.</p><div id="mainEstimates" class="assumption-grid"></div><details class="secondary-estimates"><summary>Other model assumptions</summary><div id="otherEstimates" class="assumption-grid"></div></details><p class="original-caption">Download returns the original workbook with all 22 tabs, formatting and non-input formulas preserved. Only yellow/orange input cells are updated; calculated results refresh. Simple COOP model downloads just the COOP tab with live formulas, checked against the original workbook. Deal summary PDF is a one-page visual of the deal.</p></div>';

    document.querySelector('#dealNumbersCard').before(main);

    const evidenceSections={dealNumbersCard:'Figures read from your documents',materialsRegister:'Files in this deal',dealHistory:'Reading history and limits',prelimOutput:'Preliminary read and source tables',needsCard:'Evidence received and still needed',siteCluesCard:'Individual site facts',extractedCard:'Review and correct extracted facts',tableReviewCard:'Review seller financial tables'};
    for(const [id,title] of Object.entries(evidenceSections)){const node=document.getElementById(id);const card=node.matches('.card')?node:node.closest('article,section,.card');if(!card)continue;const detail=document.createElement('details');detail.className=card.className+' intake-evidence';detail.hidden=card.hidden;const summary=document.createElement('summary');summary.textContent=title;detail.append(summary);while(card.firstChild)detail.append(card.firstChild);if(card.id){detail.id=card.id;card.id='';}card.replaceWith(detail);}

    document.getElementById('tableReviewCard').hidden=true;

    document.querySelector('#numbers').innerHTML='<div class="page-title"><div><div class="eyebrow">ORIGINAL WORKBOOK</div><h1>Your original model.</h1><p>All 22 tabs are preserved. The website and download use the workbook’s own formulas.</p></div><div class="title-actions"><button class="button primary" data-original-export>Download your model ↓</button><button class="button subtle" data-simple-export="xlsx" title="One COOP tab with live formulas">Simple COOP model ↓</button><button class="button subtle" data-simple-export="pdf" title="One-page visual summary of the deal">Deal summary PDF ↓</button></div></div><div id="fullModelResults"></div><details id="originalInputsCard" class="card" open><summary>Original yellow/orange inputs</summary><div id="allOriginalInputs" class="assumption-grid"></div></details><div id="originalCashflowsCard" class="card"><h2>Original model cash flows</h2><div class="site-scroll" id="originalCashflows"></div></div><details class="card"><summary>Source evidence</summary><div id="evidenceList"></div></details>';

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

    document.querySelectorAll('[data-simple-export]').forEach(b=>{b.disabled=simpleExporting||!m.result;b.title=m.result?(b.dataset.simpleExport==='pdf'?'Download a one-page visual summary of this deal':'Download the COOP tab alone, with live formulas'):'Read documents before downloading';});
    document.querySelectorAll('[data-original-export]').forEach(b=>{b.disabled=exporting||!m.result;b.title=m.available===false?'The workbook must finish loading before you can download it':m.result?'Download the original filled workbook':'Read documents before downloading a populated model';});

    if(rebuild){document.getElementById('mainAskingPrice').innerHTML=input('price',m);const critical=['sites','gallons','fuelMargin','inside','insideMargin','otherIncome','opex','rent'];document.getElementById('mainEstimates').innerHTML=critical.filter(k=>m.items[k].status==='estimated'||d.originalInputs?.[k]!=null).map(k=>input(k,m)).join('')||'<p class="no-estimates">Operating figures were read from the documents.</p>';document.getElementById('otherEstimates').innerHTML=OriginalModel.definitions.filter(s=>!critical.includes(s.key)&&s.key!=='price').map(s=>input(s.key,m)).join('');document.getElementById('allOriginalInputs').innerHTML=OriginalModel.definitions.map(s=>input(s.key,m)).join('');}

    else for(const row of document.querySelectorAll('[data-original-wrap]')){const key=row.dataset.originalWrap,item=m.items[key],s=OriginalModel.byKey[key],el=row.querySelector('input');if(el!==document.activeElement)el.value=d.originalInputs?.[key]??display(item.value,s);row.classList.toggle('estimated',item.status==='estimated');row.querySelector('.assumption-status').textContent=item.status==='estimated'?'ESTIMATE':item.status==='manual'?'YOUR ENTRY':item.status==='confirmed'?'CONFIRMED':'FROM DOCUMENT';row.querySelector('.input-hint').textContent=s.unit.startsWith('$')?dollars(item.value):display(item.value,s)+' '+s.unit;row.querySelector('.input-source p').textContent=item.basis;}

    const r=m.result;document.getElementById('originalCashflows').innerHTML=r?'<p>COOP!B34 · Without capitalized lease. The year 1 add-back follows the editable operator retained earnings per site in COOP!S18.</p><table class="model-flow"><thead><tr><th>Year</th><th>EBITDA</th><th>Operator add-back</th><th>Exit value</th><th>Funds flow · B34</th></tr></thead><tbody><tr><td>Closing</td><td>—</td><td>—</td><td>—</td><td>'+dollars(-r.initial)+'</td></tr>'+r.years.map(y=>'<tr><td>'+y.year+'</td><td>'+dollars(y.ebitda)+'</td><td>'+dollars(y.contribution)+'</td><td>'+dollars(y.exit)+'</td><td>'+dollars(y.cash)+'</td></tr>').join('')+'</tbody></table>':'';

    return m;

  }

  function commit(){clearTimeout(timer);if(!active)return;render(active,false);document.dispatchEvent(new CustomEvent('deal-model-change'));}

  document.addEventListener('input',e=>{const key=e.target.dataset.originalInput;if(!key||!active)return;(active.originalInputs||={})[key]=e.target.value;delete (active.originalConfirmed||={})[key];const spec=OriginalModel.byKey[key],n=DealModel.parse(e.target.value);e.target.closest('.assumption-row').querySelector('.input-hint').textContent=n==null?'Enter a number':spec.unit.startsWith('$')?dollars(n):n.toLocaleString('en-US')+' '+spec.unit;clearTimeout(timer);timer=setTimeout(commit,450);});

  document.addEventListener('focusout',e=>{if(e.target.dataset.originalInput)commit();});

  document.addEventListener('click',async e=>{const button=e.target.closest('[data-original-export]');if(!button){const simple=e.target.closest('[data-simple-export]');if(simple)await simpleExport(simple);return;}if(button.disabled||exporting)return;commit();if(!active||!OriginalModel.calculate(active).result)return;const exportingDeal=JSON.parse(JSON.stringify(active)),label=button.textContent;exporting=true;document.querySelectorAll('[data-original-export]').forEach(b=>b.disabled=true);button.textContent='Preparing your model…';try{const blob=await OriginalModelExport.make(exportingDeal);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(exportingDeal.fields.name||'deal').replace(/[^a-z0-9-]+/gi,'-')+'-original-model.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);button.textContent='Original model downloaded ✓';}catch(error){button.textContent='Download failed — try again';console.error(error);}finally{exporting=false;const canExport=!!(active&&OriginalModel.calculate(active).result);document.querySelectorAll('[data-original-export]').forEach(b=>b.disabled=!canExport);setTimeout(()=>button.textContent=label,5000);}});


  async function simpleExport(button){if(button.disabled||simpleExporting)return;commit();if(!active)return;const d=JSON.parse(JSON.stringify(active)),kind=button.dataset.simpleExport,label=button.textContent;simpleExporting=true;document.querySelectorAll('[data-simple-export]').forEach(b=>b.disabled=true);button.textContent=kind==='pdf'?'Preparing PDF…':'Preparing model…';
    try{const {m,simple}=simpleModel(d),meta=summaryMeta(d,m);const blob=kind==='pdf'?await CoopSimple.pdf(simple,meta):await CoopSimple.workbook(simple,{name:meta.name,title:'Simple COOP model',source:'Deal Lens · original workbook inputs for this deal',notes:[['Estimates',m.estimated+' inputs are estimates; see Deal Lens for their basis']]});CoopSimple.download(blob,CoopSimple.fileName(d.fields.name,kind==='pdf'?'-deal-summary.pdf':'-simple-coop-model.xlsx'));button.textContent=kind==='pdf'?'Deal summary downloaded ✓':'Simple model downloaded ✓';}
    catch(error){button.textContent='Download failed — try again';button.title=error.message;console.error(error);}
    finally{simpleExporting=false;const ok=!!(active&&OriginalModel.calculate(active).result);document.querySelectorAll('[data-simple-export]').forEach(b=>b.disabled=!ok);setTimeout(()=>button.textContent=label,5000);}}

  globalThis.DealModelUI={shell,render,commit,simpleModel,summaryMeta};

})();

