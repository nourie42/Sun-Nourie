/* Maps source figures to the ORIGINAL workbook's yellow/orange inputs only. */

(() => {

  const data=typeof OriginalModelData==='undefined'?null:OriginalModelData,available=!!data;
  const unavailableMessage='The original workbook could not load. You can still add and save deal materials. Reload the page to retry; returns and workbook downloads are unavailable until it loads.';
  const compute=available?OriginalFormulaEngine.create(data):()=>{throw Error(unavailableMessage);},parse=DealModel.parse,money=DealModel.money;

  const defaults=(sheet,cell)=>data?.sheets[sheet]?.[cell]?.v;

  const definitions=[

    ['price','Asking price','$','B29',-1],['sites','Sites','sites','C2',1],['gallons','Annual fuel gallons','gallons','C3',1],['fuelMargin','Existing fuel gross margin','¢ / gallon','C4',1],['inside','Annual inside sales','$','C9',1],['insideMargin','Inside gross margin','%','C10',.01],['otherIncome','Other annual income','$','C14',1],['opex','Operating expenses excluding separate rent','$','C16',-1],['rent','Annual rent','$','C21',-1],['fuelBenefit','Fuel supply improvement','¢ / gallon','S6',1],['insideLift','Inside margin improvement','points','S12',.01],['savings','Operating expense savings','%','S17',.01],['operatorPerSite','Operator retained earnings per site','$ / site','S18',-1],['itPerSite','IT capital per site','$ / site','S23',-1],['maintenancePerSite','Annual maintenance capital per site','$ / site','S24',-1],['unams','Buyer-paid UNAM payoff','$','B30',-1],['tankCapital','Year 1 tank / environmental capital','$','C25',-1],['rebrandSites','Sites to rebrand','sites','S26',1],['volumeRetention','Annual fuel volume retention','%','S3',.01],['rentGrowth','Annual rent growth','%','S21',.01]

  ].map(([key,label,unit,cell,factor])=>({key,label,unit,cell,factor,sheet:'COOP'}));

  const byKey=Object.fromEntries(definitions.map(s=>[s.key,s]));

  byKey.operatorPerSite.label='Operator retained earnings / year 1 add-back per site';
  const returnBases={
    B34:{cell:'COOP!B34',label:'Without capitalized lease',row:32},
    B38:{cell:'COOP!B38',label:'With capitalized lease',row:37}
  };
  const cashflows=(engine,row)=>Array.from({length:16},(_,i)=>engine.get('COOP',String.fromCharCode(66+i)+row));
  function solvePrices(changes,target=13){
    // Price changes depreciation and cash tax. Recalculate the workbook at each
    // trial price, using the cash-flow row belonging to each IRR basis.
    const cache=new Map(),at=price=>{
      if(!cache.has(price)){
        const engine=compute({...changes,'COOP!B29':-price});
        cache.set(price,Object.fromEntries(Object.entries(returnBases).map(([key,basis])=>{
          const flows=cashflows(engine,basis.row);
          return [key,flows.every(Number.isFinite)?DealModel.npv(target/100,flows):NaN];
        })));
      }
      return cache.get(price);
    };
    return Object.fromEntries(Object.keys(returnBases).map(key=>{
      let lo=0,hi=Math.max(Math.abs(changes['COOP!B29']||0)*2,1e6),low=at(lo)[key],high=at(hi)[key];
      if(!Number.isFinite(low)||low<0)return [key,null];
      if(Math.abs(low)<.0001)return [key,0];
      while(high>0&&hi<1e13){hi*=2;high=at(hi)[key];}
      if(!Number.isFinite(high)||high>0)return [key,null];
      for(let i=0;i<60;i++){
        // Bracketed interpolation converges quickly across the tax thresholds;
        // periodically bisect so an endpoint cannot stall convergence.
        const trial=i%8===7?(lo+hi)/2:lo+(hi-lo)*low/(low-high),value=at(trial)[key];
        if(!Number.isFinite(value))return [key,null];
        if(Math.abs(value)<.0001||hi-lo<.001)return [key,trial];
        if(value>0){lo=trial;low=value;}else{hi=trial;high=value;}
      }
      return [key,null];
    }));
  }

  function resolve(d){

    if(!available)return {available:false,items:Object.fromEntries(definitions.map(s=>[s.key,{value:null,status:'unavailable',basis:unavailableMessage}])),changes:{},errors:[unavailableMessage],hasSource:DealIntake.facts(d).length>0||Object.keys(d.originalInputs||{}).length>0,earnings:null,baseBasis:unavailableMessage,estimated:0};

    const facts=DealIntake.facts(d),f=d.fields||{},items={},errors=[];

    const put=(k,value,status,basis)=>items[k]={value,status,basis};

    const corrected=key=>['manual','selected source'].includes(d.fieldOrigin?.[key])&&parse(f[key])!=null;
    const correctedKeys=new Set();
    const metric=(keys,scale=1)=>{
      for(const key of keys)if(corrected(key)){
        const value=parse(f[key]),source=d.fieldSources?.[key];correctedKeys.add(key);
        return {value:scale===1e6&&Math.abs(value)>=100000?value:value*scale,status:'manual',corrected:true,basis:[d.fieldOrigin[key]==='selected source'?'Your selected source figure':'Your corrected source figure',key,source?.source,source?.period].filter(Boolean).join(' · ')};
      }
      for(const key of keys){let rows=facts.filter(x=>x.key===key&&x.scope!=='segment'&&Number.isFinite(x.value)&&(key!=='ask'||x.scope!=='site'));if(!rows.length)continue;rows.sort((a,b)=>Math.max(0,...(String(b.period).match(/20\d\d/g)||[]).map(Number))-Math.max(0,...(String(a.period).match(/20\d\d/g)||[]).map(Number)));const portfolio=rows.filter(x=>x.scope!=='site');if(portfolio.length)rows=[portfolio[0]];const seen=new Set();rows=rows.filter(x=>{const id=x.siteName||'portfolio';if(seen.has(id))return false;seen.add(id);return true;});return {value:rows.reduce((n,x)=>n+x.value*scale,0),status:rows.some(x=>x.confidence==='low'||/estimate|disagree|reviewed transcription/i.test(x.verification||x.source||''))?'estimated':'document',basis:rows.map(x=>[x.source,x.period,x.excerpt].filter(Boolean).join(' · ')).join('; ')};}return null;
    };

    const use=(k,keys,scale=1)=>{const m=metric(keys,scale);if(m)put(k,m.value,m.status,m.basis);return m;};

    const base=metric(['normEbitda','ttmEbitda'],1e6)||metric(['sellerEbitdaUsd','siteNoiUsd','projectedEbitdaUsd']);

    const gp=metric(['sellerGrossProfitUsd']),expenses=metric(['sellerExpensesUsd']),fuelGp=metric(['fuelGrossProfitUsd']),insideGp=metric(['insideGrossProfitUsd']);

    const totalsConflict=base&&gp&&expenses&&Math.abs(gp.value-expenses.value-base.value)>1;let earnings=base?.corrected?base.value:gp&&expenses?gp.value-expenses.value:base?.value??null;

    const oldBase=parse(d.modelInputs?.base);if(oldBase!=null)earnings=oldBase;

    use('sites',['sites']);if(!items.sites){const names=[...new Set(facts.filter(x=>x.scope==='site'&&x.siteName).map(x=>x.siteName))];put('sites',names.length||parse(f.sites)||1,names.length?'derived':'estimated',names.length?'Distinct sites identified in the documents':'Site count not stated; one site estimated');}

    const os=parse(d.originalInputs?.sites??d.modelInputs?.sites);if(os!=null)put('sites',os,'manual','Your site count');const sites=items.sites.value;

    for(const spec of definitions)if(!items[spec.key])put(spec.key,Math.abs(Number(defaults('COOP',spec.cell)||0))/Math.abs(spec.factor),'estimated','Original model default · COOP!'+spec.cell);

    const gallonsFact=use('gallons',['gallons'],1e6)||use('gallons',['siteMonthlyGallons'],12);

    if(!gallonsFact)items.gallons.value=defaults('COOP','C3')/defaults('COOP','C2')*sites;

    const insideFact=use('inside',['insideSales'],1e6)||use('inside',['siteInsideSalesUsd']);if(!insideFact)items.inside.value=defaults('COOP','C9')/defaults('COOP','C2')*sites;

    const otherFact=use('otherIncome',['otherIncomeUsd']);if(!otherFact)items.otherIncome.value=defaults('COOP','C14')/defaults('COOP','C2')*sites;

    if(!use('rent',['rentUsd']))put('rent',0,'estimated','Rent not separately supplied; assume included in total operating expenses');

    const fuelMarginFact=use('fuelMargin',['fuelMarginCpg']),insideMarginFact=use('insideMargin',['insideMarginPct']);
    if(fuelGp&&items.gallons.value>0&&!fuelMarginFact?.corrected)put('fuelMargin',fuelGp.value/items.gallons.value*100,fuelGp.status==='document'&&items.gallons.status==='document'?'derived':'estimated','Fuel gross profit ÷ annual gallons · '+fuelGp.basis);

    if(insideGp&&items.inside.value>0&&!insideMarginFact?.corrected)put('insideMargin',insideGp.value/items.inside.value*100,insideGp.status==='document'&&items.inside.status==='document'?'derived':'estimated','Inside gross profit ÷ inside sales · '+insideGp.basis);

    if(gp&&fuelGp&&insideGp&&!otherFact?.corrected)put('otherIncome',gp.value-fuelGp.value-insideGp.value,[gp,fuelGp,insideGp].every(x=>x.status==='document')?'derived':'estimated','Remaining gross profit after fuel and inside; includes other operating profit · '+gp.basis);

    // When a statement supplies only its earnings totals, estimate the missing composition visibly.

    if(gp&&!fuelGp&&!insideGp){
      if(!otherFact)put('otherIncome',0,'estimated','Gross-profit total supplied; no separate other-income amount. Included in estimated split');
      const total=gp.value-items.otherIncome.value,benchmarkFuel=Number(defaults('COOP','C5')),benchmarkTotal=benchmarkFuel+Number(defaults('COOP','C11')),share=benchmarkTotal>0?benchmarkFuel/benchmarkTotal:.5;
      const fuelKnown=gallonsFact&&fuelMarginFact,insideKnown=insideFact&&insideMarginFact;
      let fuelProfit=fuelKnown?items.gallons.value*items.fuelMargin.value/100:insideKnown?total-items.inside.value*items.insideMargin.value/100:total*share;
      if(gallonsFact&&items.gallons.value===0)fuelProfit=0;
      if(insideFact&&items.inside.value===0&&!fuelKnown)fuelProfit=total;
      const insideProfit=total-fuelProfit;
      if(!fuelKnown){
        if(gallonsFact){if(items.gallons.value>0)put('fuelMargin',fuelProfit/items.gallons.value*100,'estimated','Estimated fuel share of source gross profit ÷ supplied gallons');else if(fuelProfit!==0)errors.push('Gross profit cannot be reconciled with zero supplied fuel gallons');}
        else put('gallons',fuelProfit/(items.fuelMargin.value/100),'estimated','Estimated fuel share of source gross profit using original model mix');
      }
      if(!insideKnown){
        if(insideFact){if(items.inside.value>0)put('insideMargin',insideProfit/items.inside.value*100,'estimated','Estimated inside share of source gross profit ÷ supplied inside sales');else if(insideProfit!==0)errors.push('Gross profit cannot be reconciled with zero supplied inside sales');}
        else put('inside',insideProfit/(items.insideMargin.value/100),'estimated','Estimated inside share of source gross profit using original model mix');
      }
    }

    const manualOpex=corrected('opex')?metric(['opex'],1e6):null;
    if(manualOpex)put('opex',manualOpex.value,'manual',manualOpex.basis);
    else if(expenses&&!base?.corrected&&oldBase==null)put('opex',Math.max(0,expenses.value-items.rent.value),items.rent.value===0?expenses.status:'estimated','Source total expenses less separately modeled rent · '+expenses.basis);

    else if(!use('opex',['opex'],1e6)){
      let fuel=items.gallons.value*items.fuelMargin.value/100,inside=items.inside.value*items.insideMargin.value/100,gross=fuel+inside+items.otherIncome.value;
      if(earnings!=null){
        if(gross<earnings+items.rent.value){
          const adjustable=(!gallonsFact||!fuelMarginFact?fuel:0)+(!insideFact||!insideMarginFact?inside:0)+(!otherFact?items.otherIncome.value:0);
          if(gp||adjustable<=0)errors.push('Supplied earnings exceed gross profit less rent. Review the source figures or enter operating assumptions.');
          else{
            const target=earnings*1.5+items.rent.value,lift=1+(target-gross)/adjustable;
            if(!gallonsFact)items.gallons.value*=lift;else if(!fuelMarginFact)items.fuelMargin.value*=lift;
            if(!insideFact)items.inside.value*=lift;else if(!insideMarginFact)items.insideMargin.value*=lift;
            if(!otherFact)items.otherIncome.value*=lift;
            gross=target;
          }
        }
        put('opex',gross-items.rent.value-earnings,'estimated','Estimated operating cost reconciles modeled gross profit to supplied earnings');
      }else put('opex',Math.abs(defaults('COOP','C16'))/defaults('COOP','C2')*sites,'estimated','Original model operating expenses per site · COOP!C16');
    }

    if(earnings==null)earnings=items.gallons.value*items.fuelMargin.value/100+items.inside.value*items.insideMargin.value/100+items.otherIncome.value-items.opex.value-items.rent.value;

    if(totalsConflict&&!manualOpex){items.opex.status='estimated';items.opex.basis+=base?.corrected||oldBase!=null?' · Earnings override takes precedence over the source expense total; reconcile this adjustment':' · Printed earnings disagree with gross profit less expenses; source arithmetic used, review digits';}

    const priceFact=use('price',['ask'],1e6),price=parse(d.modelInputs?.price),legacy=parse(f.ask);if(price!=null)put('price',price,'manual','Your asking price');else if(legacy!=null&&(!priceFact||d.fieldOrigin?.ask==='manual'))put('price',Math.abs(legacy)>=100000?legacy:legacy*1e6,f.ask&&d.fieldOrigin?.ask==='manual'?'manual':'document','Saved asking price');else if(!priceFact)put('price',Math.max(0,earnings)*7,'estimated','Asking price missing. Estimated at 7× earnings using the original model exit-multiple benchmark');

    put('unams',parse(d.modelInputs?.unams)??0,'estimated','UNAM payoff not supplied; zero estimated');put('tankCapital',0,'estimated','Year 1 tank capital not supplied; zero estimated. Original later-year capital schedule is preserved');put('rebrandSites',0,'estimated','No rebrand project supplied; zero sites estimated');

    for(const [key,estimate] of Object.entries(d.pastedEstimates||{})){if(Object.hasOwn(byKey,key)&&items[key].status==='estimated')put(key,estimate.value,'estimated','Pasted AI estimate: '+estimate.basis);}
    for(const [key,raw] of Object.entries(d.originalInputs||{})){if(!byKey[key])continue;const n=parse(raw);if(n==null){errors.push(byKey[key].label+': enter a valid number');continue;}put(key,n,d.originalConfirmed?.[key]?'confirmed':'manual','Your model input · COOP!'+byKey[key].cell);}

    for(const s of definitions){const n=items[s.key].value;if(!Number.isFinite(n)||n<0)errors.push(s.label+' must be zero or greater');}

    if(!Number.isInteger(items.sites.value)||items.sites.value<1)errors.push('Enter at least one whole site');
    if(!Number.isInteger(items.rebrandSites.value)||items.rebrandSites.value>items.sites.value)errors.push('Sites to rebrand must be a whole number no greater than the site count');
    if(items.insideMargin.value>100||items.savings.value>100)errors.push('Gross margin and savings cannot exceed 100%');

    const changes={};for(const s of definitions){if(!data.allowed[s.sheet].includes(s.cell))throw Error('Input is not yellow/orange: '+s.cell);changes[s.sheet+'!'+s.cell]=items[s.key].value*s.factor;}

    // Inactive example routes do not belong in this deal's combined result.

    for(const sheet of ['COCM','CODO','DODO'])changes[sheet+'!C2']=0;

    const hasSource=facts.some(f=>!['sites','assetCount'].includes(f.key)&&f.scope!=='segment')||[...correctedKeys].some(k=>!['sites','assetCount','ask'].includes(k))||oldBase!=null||Object.keys(d.originalInputs||{}).some(k=>k!=='price');

    return {available:true,items,changes,errors,hasSource,earnings,baseBasis:base?.corrected?base.basis:oldBase!=null?'Your annual earnings input':totalsConflict?'Gross profit less expenses; printed earnings disagree and need review':base?.basis||gp?.basis||'Estimated from original model operating inputs',estimated:Object.values(items).filter(x=>x.status==='estimated').length};

  }

  const resultCache=new Map();
  function calculateFresh(d){const r=resolve(d),p=Object.fromEntries(Object.entries(r.items).map(([k,v])=>[k,v.value]));p.base=r.earnings;p.target=13;p.years=15;p.fieldCost=available?Math.abs(defaults('COOP','S19'))*p.sites:null;p.operatorCost=available?p.operatorPerSite*p.sites:null;p.addedRent=0;p.otherBenefit=0;

    if(r.errors.length||!r.hasSource)return {...r,inputs:p,meta:{...r.items,base:{basis:r.baseBasis,status:'estimated'}},result:null};

    // Intake previews and the saved deal are separate objects with identical
    // workbook inputs. Keep a small cache of numeric results, while resolving
    // source labels afresh so evidence and confirmation status stay current.
    const resultKey=JSON.stringify(r.changes),finish=entry=>{
      p.base=entry.base;p.operatorContribution=entry.result.years[0].contribution;
      return {...r,inputs:p,meta:{...r.items,base:{basis:r.baseBasis,status:'estimated'}},result:entry.result,method:'original workbook'};
    };
    if(resultCache.has(resultKey)){const entry=resultCache.get(resultKey);resultCache.delete(resultKey);resultCache.set(resultKey,entry);return finish(entry);}

    const engine=compute(r.changes),flows=cashflows(engine,32);

    const years=flows.slice(1).map((cash,i)=>{const c=String.fromCharCode(67+i),v=row=>engine.get('COOP',c+row);return {year:i+1,cash,ebitda:v(22),ebitdar:v(20),fuel:v(7),insideBenefit:v(13),savings:v(17),maintenance:-v(24),it:-Number(v(23)||0),capital:-Number(v(25)||0)-Number(v(26)||0),tax:-Number(v(27)||0),exit:i===14?Number(v(29)||0):0,wc:Number(v(28)||0),contribution:i===0?Number(v(29)||0):0};});

    const irr=engine.get('COOP','B34'),base=engine.get('COOP','B41');p.base=base;p.operatorContribution=years[0].contribution;
    const prices=solvePrices(r.changes,p.target),returnCases=Object.fromEntries(Object.entries(returnBases).map(([key,basis])=>{
      const basisFlows=cashflows(engine,basis.row),rate=engine.get('COOP',key);
      return [key,{...basis,irr:Number.isFinite(rate)?rate:null,flows:basisFlows,initial:-basisFlows[0],npv:DealModel.npv(p.target/100,basisFlows),maxPrice:prices[key]}];
    }));

    const result={irr:Number.isFinite(irr)?irr:null,irrBasis:'COOP!B34',irrBasisLabel:returnBases.B34.label,returnCases,flows,years,initial:-flows[0],npv:returnCases.B34.npv,multiple:base>0?p.price/base:null,maxPrice:prices.B34,engine,agentIrr:engine.get('COAG Dealer vs Sun P&L','B30'),dealerEbitda:engine.get('COAG Dealer vs Sun P&L','C49')};

    const entry={base,result};resultCache.set(resultKey,entry);if(resultCache.size>8)resultCache.delete(resultCache.keys().next().value);
    return finish(entry);

  }

  // A single edit renders several panels. Reuse its calculation until a model input changes.
  const calculationCache=new WeakMap();
  function calculate(d){
    const key=JSON.stringify([d.fields,d.fieldOrigin,d.fieldSources,d.facts,d.aiReview?.facts,d.reportedFacts,d.financialSources,d.modelInputs,d.originalInputs,d.originalConfirmed,d.pastedEstimates]);
    const cached=calculationCache.get(d);if(cached?.key===key)return cached.value;
    const value=calculateFresh(d);calculationCache.set(d,{key,value});return value;
  }

  globalThis.OriginalModel={available,data,definitions,byKey,resolve,calculate,compute,money,returnBases,solvePrices};

})();

