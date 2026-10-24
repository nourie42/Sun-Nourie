/* Annual unlevered funds-flow model. USD internally; original precision retained. */
(() => {
  'use strict';
  function parse(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let s=String(value??'').trim().toLowerCase(); if(!s)return null;
    const negative=/^\(.*\)$/.test(s); if(negative)s=s.slice(1,-1);
    s=s.replace(/[$,\s%]/g,'');
    const m=s.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(mm|m|million|k|thousand|b|billion)?$/);
    if(!m)return null;const n=Number(m[1])*({mm:1e6,m:1e6,million:1e6,k:1e3,thousand:1e3,b:1e9,billion:1e9}[m[2]]||1)*(negative?-1:1);
    return Number.isFinite(n)&&Math.abs(n)<=1e15?n:null;
  }
  const money=n=>n==null||!Number.isFinite(n)?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
  const root=s=>String(s||'').replace(/ · (?:page \d+(?:\.pdf)?|section \d+).*$/i,'');
  const def=(key,label,unit,group,value,basis,min,max)=>({key,label,unit,group,value,basis,min,max});
  const defs=[
    def('price','Purchase price','USD','deal',null,'Seller ask, or estimated at 7× the earnings base',0),
    def('base','Annual earnings base','USD','deal',null,'Document EBITDA; NOI is an estimated proxy'),
    def('sites','Number of sites','count','deal',1,'One site until a site count is supplied',1,100000),
    def('target','Minimum IRR','%','deal',13,'Your 13% minimum',0,100),
    def('gallons','Annual fuel gallons','gallons','drivers',0,'Not supplied. Fuel benefit excluded until gallons are known',0),
    def('fuelMargin','Existing fuel margin','¢/gal','drivers',0,'Not supplied. Required for the detailed operating forecast'),
    def('inside','Annual inside sales','USD','drivers',0,'Not supplied. Inside benefit excluded until known',0),
    def('insideMargin','Existing inside gross margin','%','drivers',30.70962389388091,'ModelExample COOP!C10. Estimate for this deal',0,100),
    def('otherIncome','Annual other income','USD','drivers',0,'Not supplied. Excluded until known'),
    def('opex','Annual operating expenses, before separate rent','USD','drivers',0,'Not supplied. Expense savings excluded until known',0),
    def('rent','Annual rent already in the earnings base','USD','drivers',0,'Not supplied. No rent addback to terminal EBITDAR',0),
    def('fuelBenefit','Fuel supply improvement','¢/gal','upside',10,'ModelExample COOP!S6. Unconfirmed benefit; contract rights must support it'),
    def('insideLift','Inside margin improvement','points','upside',2,'ModelExample COOP!S12. Unconfirmed improvement'),
    def('savings','Operating expense savings','%','upside',15,'ModelExample COOP!S17. Unconfirmed savings',0,100),
    def('otherBenefit','Other annual net benefit','USD','upside',0,'No additional benefit assumed'),
    def('addedRent','Additional annual rent','USD','upside',0,'No added rent assumed',0),
    def('fieldCost','Additional annual field support / G&A','USD','upside',0,'Current plan retained. Managed conversion uses COOP!S19: $10,000/site',0),
    def('operatorCost','Annual operator retained earnings','USD','upside',0,'Current plan retained. Managed conversion uses COOP!S18: $50,000/site',0),
    def('workingCapital','Initial working capital','USD','cash',null,'ModelExample COOP!S28: $50,000/site',0),
    def('wcRecovery','Working capital recovered at exit','%','cash',100,'ModelExample COOP!Q28: recover initial working capital. Confirm recoverability',0,100),
    def('unams','Buyer-paid UNAM / assumed liabilities','USD','cash',0,'Not supplied. Zero is an estimate; confirm payoff',0),
    def('initialCapex','Initial conversion / growth capital','USD','cash',0,'Not supplied. Zero is an estimate',0),
    def('environmental','Initial tank / environmental capital','USD','cash',0,'Not supplied. Zero is an estimate',0),
    def('closingPct','Closing costs','% of price','cash',1.5,'ModelExample COOP!B31',0,100),
    def('itCapex','Year 1 IT capital','USD','cash',null,'ModelExample COOP!S23: $7,000/site',0),
    def('maintFirst','Year 1 maintenance capital','USD','cash',null,'ModelExample COOP!C24: $20,000/site',0),
    def('maintAnnual','Annual maintenance base, from year 2','USD','cash',null,'ModelExample COOP!S24: $25,000/site, escalated from year 2',0),
    def('operatorContribution','Year 1 operator add-back','USD','cash',null,'COOP!C29 = -C18: $50,000/site in year 1. Editable portfolio total',0),
    def('years','Forecast / hold period','years','forecast',15,'ModelExample COOP!C1:Q1: 15 annual periods',1,30),
    def('earningsGrowth','Annual earnings growth (earnings forecast)','%','forecast',2,'Estimate using COOP!S14 / S16 2% growth convention',-99,100),
    def('volumeGrowth','Annual fuel volume change','%','forecast',-1,'ModelExample COOP!S3: 99% retention',-99,100),
    def('cpgGrowth','Annual fuel margin increase','¢/gal','forecast',0.5,'ModelExample COOP!S4'),
    def('insideGrowth','Annual inside sales growth','%','forecast',3,'ModelExample COOP!S9',-99,100),
    def('otherGrowth','Annual other income growth','%','forecast',2,'ModelExample COOP!S14',-99,100),
    def('opexGrowth','Annual operating cost growth','%','forecast',2,'ModelExample COOP!S16',-99,100),
    def('rentGrowth','Annual rent growth','%','forecast',2,'ModelExample COOP!S21',-99,100),
    def('capexGrowth','Annual maintenance capital growth','%','forecast',3,'ModelExample COOP!D24:Q24',-99,100),
    def('taxRate','Cash tax rate','%','forecast',25,'ModelExample COOP!S27. Template treatment; confirm for this deal',0,100),
    def('wholesaleExclusion','Wholesale margin excluded from tax base','¢/gal','forecast',12,'ModelExample COOP!C27: 12¢/gal exclusion; confirm tax treatment',0),
    def('depreciationYears','Purchase-price depreciation period','years','forecast',15,'ModelExample COOP!C27: purchase price / 15',1,100),
    def('exitMultiple','Net exit value / final-year EBITDAR','×','forecast',7,'ModelExample COOP!Q29 / S29: net-of-tax EBITDAR multiple',0,50)
  ];
  const byKey=Object.fromEntries(defs.map(d=>[d.key,d]));
  function rawFacts(d){return typeof DealIntake!=='undefined'?DealIntake.facts(d):[...(d.aiReview?.facts||[]),...(d.reportedFacts||[])];}
  function groups(d){const list=[...new Set(rawFacts(d).map(f=>root(f.source)).filter(Boolean))];return list.length>1?['All deal documents',...list]:list;}
  function resolve(d){
    const inputs={},meta={},errors=[],all=rawFacts(d),gs=groups(d),selected=gs.includes(d.modelSource)?d.modelSource:gs[0]||'';
    const rows=all.filter(f=>!selected||selected==='All deal documents'||root(f.source)===selected);
    function metric(keys,scale=1){
      for(const key of keys){const matches=rows.filter(f=>f.key===key&&Number.isFinite(f.value));if(!matches.length)continue;
        const latest=(a,b)=>Math.max(0,...(String(b.period||'').match(/20\d{2}/g)||[]).map(Number))-Math.max(0,...(String(a.period||'').match(/20\d{2}/g)||[]).map(Number));
        const portfolio=matches.filter(f=>f.scope!=='site').sort(latest);let chosen=portfolio.length?[portfolio[0]]:matches.slice().sort(latest);
        const seen=new Set();chosen=chosen.filter(f=>{const id=f.siteName||'site';if(seen.has(id))return false;seen.add(id);return true;});
        // Separate periods cannot be added. Latest period within each source/site is chosen by the intake's most recent candidate order.
        const conflict=chosen.some(f=>matches.some(other=>(other.siteName||'site')===(f.siteName||'site')&&other.period===f.period&&Math.abs((other.value-f.value)*scale)>0.01)),mixed=new Set(chosen.map(f=>f.period).filter(Boolean)).size>1;
        return {value:chosen.reduce((s,f)=>s+f.value*scale,0),basis:(conflict?'Conflicting source figures; latest candidate selected. ':mixed?'Mixed reporting periods; estimated combined case. ':'')+chosen.map(f=>[f.siteName,f.period,f.source].filter(Boolean).join(' · ')).join('; '),key,count:chosen.length,estimated:conflict||mixed||chosen.some(f=>/reviewed transcription/i.test(f.source)||f.confidence==='low')};
      }return null;
    }
    function set(k,value,basis,status='estimated'){inputs[k]=value;meta[k]={basis,status};}
    function from(k,keys,scale=1){const m=metric(keys,scale);if(m)set(k,m.value,m.basis+' · '+m.key,m.estimated?'estimated':'document');return m;}
    const f=d.fields||{},oldMoney=(k)=>{const n=parse(f[k]);return n==null?null:Math.abs(n)>=100000?n:n*1e6;};
    for(const spec of defs)set(spec.key,spec.value,spec.basis,spec.key==='target'?'rule':'estimated');
    const site=metric(['sites']);if(site)set('sites',site.value,site.basis,'document');
    else {const names=[...new Set(rows.filter(f=>f.scope==='site'&&f.siteName).map(f=>f.siteName))];if(names.length)set('sites',names.length,'Distinct sites in '+selected,'derived');}
    const sourceSites=parse(f.sites);if(sourceSites!=null&&sourceSites>0)set('sites',sourceSites,'Entered site count',d.fieldOrigin?.sites==='manual'?'manual':'document');
    from('price',['ask'],1e6);const oldAsk=oldMoney('ask');if(oldAsk!=null&&(inputs.price==null||d.fieldOrigin?.ask==='manual'))set('price',oldAsk,Math.abs(parse(f.ask))>=100000||d.unitMigrationBackup?.ask?'Existing full-dollar entry corrected from the previous millions label':'Entered purchase price',d.fieldOrigin?.ask==='manual'?'manual':'document');
    let base=from('base',['normEbitda','ttmEbitda'],1e6)||from('base',['sellerEbitdaUsd']);
    if(!base){base=from('base',['projectedEbitdaUsd','siteNoiUsd']);if(base)meta.base={status:'estimated',basis:(base.key==='siteNoiUsd'?'Site NOI used as an earnings proxy; confirm EBITDA. ':'Projected earnings; confirm actuals. ')+base.basis};}
    if(!base){const gp=metric(['sellerGrossProfitUsd']),op=metric(['sellerExpensesUsd']);if(gp&&op)set('base',gp.value-op.value,'Gross profit less operating expenses; EBITDA reconciliation needed','estimated');}
    for(const k of ['normEbitda','ttmEbitda'])if(parse(f[k])!=null&&(!base||d.fieldOrigin?.[k]==='manual')){set('base',oldMoney(k),'Entered '+k,d.fieldOrigin?.[k]==='manual'?'manual':'document');break;}
    from('gallons',['gallons'],1e6)||from('gallons',['siteMonthlyGallons'],12);
    from('inside',['insideSales'],1e6)||from('inside',['siteInsideSalesUsd']);
    from('opex',['opex'],1e6)||from('opex',['sellerExpensesUsd']);
    const map={fuelMargin:'existingFuelCpg',fuelBenefit:'fuelCpg',insideLift:'insidePts',savings:'opexPct',otherBenefit:'otherBenefit',addedRent:'rentCost',fieldCost:'fieldCost',operatorCost:'dealerCost',unams:'liabilities',workingCapital:'workingCapital',initialCapex:'conversion',environmental:'tanks'};
    for(const [k,legacy] of Object.entries(map)){const n=parse(f[legacy]);if(n!=null)set(k,byKey[k].unit==='USD'?oldMoney(legacy):n,'Entered '+legacy,d.fieldOrigin?.[legacy]==='manual'?'manual':'document');}
    for(const [k,legacy] of [['gallons','gallons'],['inside','insideSales'],['opex','opex']])if(parse(f[legacy])!=null&&(inputs[k]===0||d.fieldOrigin?.[legacy]==='manual'))set(k,oldMoney(legacy),'Entered '+legacy,d.fieldOrigin?.[legacy]==='manual'?'manual':'document');
    const target=parse(f.targetIrr);if(target!=null)set('target',target,'Your minimum return','rule');
    const overrides=d.modelInputs||{};
    // Apply count before dependent per-site estimates.
    if(Object.hasOwn(overrides,'sites')){const n=parse(overrides.sites);if(n!=null)set('sites',n,'Your model input','manual');}
    const n=inputs.sites;
    for(const [k,rate] of [['workingCapital',50000],['itCapex',7000],['maintFirst',20000],['maintAnnual',25000],['operatorContribution',50000]])if(inputs[k]==null)set(k,n*rate,byKey[k].basis);
    if(d.modelRoute==='managed'){if(meta.fieldCost.status==='estimated')set('fieldCost',n*10000,'Managed operator case. ModelExample COOP!S19');if(meta.operatorCost.status==='estimated')set('operatorCost',n*50000,'Managed operator case. ModelExample COOP!S18');}
    if(inputs.price==null&&inputs.base>0)set('price',inputs.base*7,'Estimated entry price: 7× earnings, using workbook exit multiple. Replace with seller ask');
    for(const [k,raw] of Object.entries(overrides)){if(!byKey[k])continue;const v=parse(raw);if(v==null){errors.push(byKey[k].label+': enter a valid number');set(k,null,'Invalid entry','invalid');}else set(k,v,'Your model input',d.modelConfirmed?.[k]?'confirmed':'manual');}
    for(const s of defs){const v=inputs[s.key];if(v!=null&&((s.min!=null&&v<s.min)||(s.max!=null&&v>s.max)||(['years','sites','depreciationYears'].includes(s.key)&&!Number.isInteger(v))))errors.push(s.label+': outside the allowed range');}
    let method=d.modelMethod||'auto';if(method==='auto')method=['gallons','fuelMargin','inside','opex'].every(k=>inputs[k]>0)&&meta.fuelMargin.status!=='estimated'?'operations':'earnings';
    return {inputs,meta,errors,method,selected,groups:gs};
  }
  function npv(rate,flows){return flows.reduce((s,c,i)=>s+c/Math.pow(1+rate,i),0);}
  function irr(flows){
    if(flows.some(n=>!Number.isFinite(n))||!flows.some(n=>n>0)||!flows.some(n=>n<0))return null;
    const signs=flows.filter(n=>Math.abs(n)>1e-9).map(n=>Math.sign(n));if(signs.filter((s,i)=>i&&s!==signs[i-1]).length!==1)return null;
    let lo=-0.999999,hi=1;const sign=npv(lo,flows);while(npv(hi,flows)*sign>0&&hi<1e6)hi=hi*2+1;
    if(npv(hi,flows)*sign>0)return null;for(let i=0;i<150;i++){const m=(lo+hi)/2;if(npv(m,flows)*sign>0)lo=m;else hi=m;}return (lo+hi)/2;
  }
  function forecast(p,method='earnings',capitalSchedule={}){
    const years=[],flows=[],closing=p.price*p.closingPct/100,initial=p.price+p.workingCapital+p.unams+p.initialCapex+p.environmental+closing;
    flows.push(-initial);
    for(let y=1;y<=p.years;y++){
      const t=y-1,gallons=p.gallons*(1+p.volumeGrowth/100)**t,cpg=p.fuelMargin+t*p.cpgGrowth,inside=p.inside*(1+p.insideGrowth/100)**t,opex=p.opex*(1+p.opexGrowth/100)**t,rent=p.rent*(1+p.rentGrowth/100)**t;
      const fuel=gallons*p.fuelBenefit/100,insideBenefit=inside*p.insideLift/100,savings=opex*p.savings/100,other=p.otherBenefit*(1+p.otherGrowth/100)**t,field=p.fieldCost*(1+p.opexGrowth/100)**t,operator=p.operatorCost,addedRent=p.addedRent*(1+p.rentGrowth/100)**t;
      const base=method==='operations'?gallons*cpg/100+inside*p.insideMargin/100+p.otherIncome*(1+p.otherGrowth/100)**t-opex-rent:p.base*(1+p.earningsGrowth/100)**t;
      const ebitda=base+fuel+insideBenefit+savings+other-field-operator-addedRent,ebitdar=ebitda+rent+addedRent;
      const maintenance=y===1?p.maintFirst:p.maintAnnual*(1+p.capexGrowth/100)**t,it=y===1?p.itCapex:0,capital=Number(capitalSchedule[y]||0),taxable=ebitda-gallons*p.wholesaleExclusion/100-p.price/p.depreciationYears,tax=Math.max(0,taxable)*p.taxRate/100,contribution=y===1?p.operatorContribution:0,exit=y===p.years?ebitdar*p.exitMultiple:0;
      const wc=y===p.years?p.workingCapital*(p.wcRecovery??100)/100:0,cash=ebitda-maintenance-it-capital-tax+contribution+exit+wc;
      years.push({year:y,gallons,cpg,inside,opex,rent,base,fuel,insideBenefit,savings,other,field,operator,addedRent,ebitda,ebitdar,maintenance,it,capital,taxable,tax,contribution,exit,wc,cash});flows.push(cash);
    }
    return {years,flows,initial,closing,irrBasis:'COOP!B34',irrBasisLabel:'Without capitalized lease',irr:irr(flows),npv:npv(p.target/100,flows),multiple:p.base>0?p.price/p.base:null};
  }
  function calculate(d){const r=resolve(d),p=r.inputs;if(p.price==null)r.errors.push('Add a purchase price or annual earnings to start the model');if(p.base==null&&r.method==='earnings')r.errors.push('Add annual EBITDA or site NOI to start the earnings forecast');
    if(r.method==='operations'&&p.gallons<=0&&p.inside<=0&&p.otherIncome<=0)r.errors.push('The detailed operating forecast needs fuel gallons, inside sales or other income');
    if(r.errors.length)return {...r,result:null};const result=forecast(p,r.method,d.modelCapital||{});
    // Price affects depreciation and cash taxes, so solve the full forecast at each price.
    let lo=0,hi=Math.max(p.price*2,Math.abs(p.base||result.years[0].base)*30,1),at=n=>forecast({...p,price:n},r.method,d.modelCapital||{}).npv;
    let maxPrice=null;if(at(0)>=0){while(at(hi)>0&&hi<1e13)hi*=2;if(at(hi)<=0){for(let i=0;i<75;i++){const mid=(lo+hi)/2;if(at(mid)>0)lo=mid;else hi=mid;}maxPrice=(lo+hi)/2;}}
    return {...r,result:{...result,maxPrice}};
  }
  function excel(p,method='earnings',capitalSchedule={}){
    // Shared workbook specification: formulas are independently recalculated in Excel.
    const inputRows=Object.fromEntries(defs.map((d,i)=>[d.key,i+5])),cells={};const ref=k=>`'Inputs'!$B$${inputRows[k]}`;
    const rows={gallons:5,cpg:6,inside:7,opex:8,rent:9,base:11,fuel:12,insideBenefit:13,savings:14,other:15,field:16,operator:17,addedRent:18,ebitda:20,ebitdar:21,maintenance:23,it:24,capital:25,taxable:27,tax:28,contribution:29,exit:30,wc:31,cash:32};
    const col=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
    const initial=`-(${ref('price')}+${ref('workingCapital')}+${ref('unams')}+${ref('initialCapex')}+${ref('environmental')}+${ref('price')}*${ref('closingPct')}/100)`;
    cells.B32={formula:initial};
    for(let y=1;y<=30;y++){const c=col(y+1),t=y-1,a=n=>c+rows[n];cells[c+'3']={value:y};
      const f={gallons:`${ref('gallons')}*(1+${ref('volumeGrowth')}/100)^${t}`,cpg:`${ref('fuelMargin')}+${t}*${ref('cpgGrowth')}`,inside:`${ref('inside')}*(1+${ref('insideGrowth')}/100)^${t}`,opex:`${ref('opex')}*(1+${ref('opexGrowth')}/100)^${t}`,rent:`${ref('rent')}*(1+${ref('rentGrowth')}/100)^${t}`,
        base:method==='operations'?`${a('gallons')}*${a('cpg')}/100+${a('inside')}*${ref('insideMargin')}/100+${ref('otherIncome')}*(1+${ref('otherGrowth')}/100)^${t}-${a('opex')}-${a('rent')}`:`${ref('base')}*(1+${ref('earningsGrowth')}/100)^${t}`,
        fuel:`${a('gallons')}*${ref('fuelBenefit')}/100`,insideBenefit:`${a('inside')}*${ref('insideLift')}/100`,savings:`${a('opex')}*${ref('savings')}/100`,other:`${ref('otherBenefit')}*(1+${ref('otherGrowth')}/100)^${t}`,field:`-${ref('fieldCost')}*(1+${ref('opexGrowth')}/100)^${t}`,operator:`-${ref('operatorCost')}`,addedRent:`-${ref('addedRent')}*(1+${ref('rentGrowth')}/100)^${t}`,ebitda:`SUM(${c}11:${c}18)`,ebitdar:`${a('ebitda')}+${a('rent')}-${a('addedRent')}`,
        maintenance:y===1?`-${ref('maintFirst')}`:`-${ref('maintAnnual')}*(1+${ref('capexGrowth')}/100)^${t}`,it:y===1?`-${ref('itCapex')}`:'0',taxable:`${a('ebitda')}-${a('gallons')}*${ref('wholesaleExclusion')}/100-${ref('price')}/${ref('depreciationYears')}`,tax:`-MAX(0,${a('taxable')})*${ref('taxRate')}/100`,contribution:y===1?ref('operatorContribution'):'0',exit:y===p.years?`${a('ebitdar')}*${ref('exitMultiple')}`:'0',wc:y===p.years?`${ref('workingCapital')}*${ref('wcRecovery')}/100`:'0',cash:`SUM(${a('ebitda')},${c}23:${c}25,${c}28:${c}31)`};
      f.exit=`IF(${y}=${ref('years')},${a('ebitdar')}*${ref('exitMultiple')},0)`;
      f.wc=`IF(${y}=${ref('years')},${ref('workingCapital')}*${ref('wcRecovery')}/100,0)`;
      for(const [k,formula] of Object.entries(f))cells[a(k)]={formula:`IF(${y}<=${ref('years')},${formula},${k==='cash'?'0':'""'})`};cells[a('capital')]={value:-Number(capitalSchedule[y]||0)};
      const prior=col(y);cells[c+'34']={formula:`IF(${c}32=0,${prior}34,SIGN(${c}32))`};cells[c+'35']={formula:`IF(AND(${c}32<>0,${prior}34<>0,SIGN(${c}32)<>${prior}34),1,0)`};
    }
    cells.B34={formula:'SIGN(B32)'};
    return {inputRows,rows,cells,lastCol:col(p.years+1)};
  }
  globalThis.DealModel={parse,money,defs,byKey,groups,resolve,calculate,forecast,irr,npv,excel};
})();
