/* Received source material is distinct from independent verification. */
(() => {
  const titles={roster:'Asset roster and ownership',actuals:'EBITDA and site actuals',fuel:'Fuel rights and net margin',inside:'Inside sales and margin',opex:'Operating savings',leases:'Leases and occupancy',capex:'Tank, rebrand and environment',liabilities:'UNAMs and seller obligations',model:'Return / offer calculation'};
  function assess(d,model){
    const facts=DealIntake.facts(d),has=keys=>facts.some(f=>keys.includes(f.key)&&f.confidence!=='low'),sites=(d.sites||[]).filter(s=>s.name),clues=d.siteClues||[];
    const addressed=sites.filter(s=>s.address||clues.find(c=>c.name===s.name)?.address).length,assetCount=facts.find(f=>f.key==='assetCount'&&f.scope==='portfolio')?.value,siteCount=facts.find(f=>f.key==='sites'&&f.scope!=='site'&&f.scope!=='segment')?.value||Number(d.fields?.sites)||0,count=Math.max(assetCount||0,(siteCount||0)+(sites.length?DealRoster.counts(sites).nonRetail:0));
    const states=Object.fromEntries(Object.keys(titles).map(k=>[k,{id:k,title:titles[k],state:'missing',label:'Missing',detail:'No supporting source recorded.'}]));
    const put=(key,state,detail)=>Object.assign(states[key],{state,label:state==='received'?'Received · verify':state==='partial'?'Partly received':'Missing',detail});
    if(sites.length){const complete=addressed===sites.length&&(!count||count===sites.length);put('roster',complete?'received':'partial',`${sites.length} asset rows received; ${addressed} addresses recorded${count&&count!==sites.length?'; source reports '+count+' assets':''}. Legal ownership and included entities still require verification.`);}
    else if(count)put('roster','partial',`Asset count (${count}) received; the named roster and addresses are still needed.`);
    if(has(['sellerEbitdaUsd','sellerEbitdarUsd','ttmEbitda','priorEbitda','normEbitda','siteNoiUsd','sellerRevenueUsd','sellerGrossProfitUsd','sellerExpensesUsd']))put('actuals','received','Financial figures and source references received. Verify period, scope and adjustments against underlying actuals.');
    if(has(['gallons','fuelGrossProfitUsd','fuelMarginCpg','siteMonthlyGallons']))put('fuel','partial','Fuel volume / margin figures received. Signed supply rights, transfer consent and incremental net benefit still need verification.');
    if(has(['insideSales','siteInsideSalesUsd','insideGrossProfitUsd','insideMarginPct']))put('inside','received','Inside sales / margin figures received; reconcile the period and source totals.');
    if(has(['sellerExpensesUsd','opex']))put('opex','partial','Expense figures received. Incremental achievable savings still need support.');
    if(has(['rentUsd','suggestedRentUsd'])||sites.some(s=>s.tenure||s.owner))put('leases','partial','Rent / property-control information received. Executed leases, title and assignment terms still need verification.');
    if((model||OriginalModel.calculate(d)).result)put('model','received','Original workbook return calculated. Review red estimates and transaction terms before relying on the result.');
    for(const [key,v] of Object.entries(d.evidence||{})){
      if(!states[key])continue;
      if(v.status==='verified')Object.assign(states[key],{state:'verified',label:'Marked verified',detail:v.source||'Marked verified by you; source not recorded.'});
      else if(v.status==='estimated'&&states[key].state==='missing')Object.assign(states[key],{state:'partial',label:'Estimate · verify',detail:v.source||'Estimate recorded; supporting evidence still needed.'});
    }
    return Object.values(states);
  }
  function questions(d,model){
    const m=model||OriginalModel.calculate(d),items=m.items||{},questions=[];
    if(!m.hasSource)questions.push('Financial source figures are still needed to support the return model.');
    const estimated=['price','gallons','fuelMargin','fuelBenefit','unams','tankCapital'].filter(k=>items[k]?.status==='estimated').map(k=>OriginalModel.byKey[k].label.toLowerCase());
    if(estimated.length)questions.push('Review estimated model inputs: '+estimated.join(', ')+'.');
    return questions;
  }
  globalThis.DealEvidence={assess,questions};
})();
