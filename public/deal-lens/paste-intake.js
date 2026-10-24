/* Local prompt generation and response import. No network or model requests. */
(() => {
  const mm=new Set(['ask','priorEbitda','ttmEbitda','normEbitda','insideSales','opex']);
  const usd=new Set(['sellerRevenueUsd','sellerCostUsd','sellerGrossProfitUsd','sellerExpensesUsd','sellerEbitdaUsd','siteNoiUsd','siteInsideSalesUsd','projectedEbitdaUsd','landlordNoiUsd','fuelDistributionIncomeUsd','suggestedRentUsd','mortgagePaymentUsd','netIncomeUsd','sellerEbitdarUsd','fuelGrossProfitUsd','insideGrossProfitUsd','otherIncomeUsd','rentUsd']);
  const keys=new Set([...mm,...usd,'sites','assetCount','gallons','siteMonthlyGallons','fuelMarginCpg','insideMarginPct']);
  const clean=(s,max=2000)=>typeof s==='string'?s.trim().slice(0,max):'';
  const number=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string'||!v.trim())return null;let s=v.trim().replace(/[$%\s]/g,'').toLowerCase(),factor=1;if(s.includes(',')&&!/^-?\(?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?(?:million|thousand|mm|m|k)?$/.test(s))return null;s=s.replace(/,/g,'');if(/(?:million|mm|m)$/.test(s)){factor=1e6;s=s.replace(/(?:million|mm|m)$/,'');}else if(/(?:thousand|k)$/.test(s)){factor=1e3;s=s.replace(/(?:thousand|k)$/,'');}if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);return /^-?(?:\d+\.?\d*|\.\d+)$/.test(s)?Number(s)*factor:null;};
  const prompt=options=>DealPlain.prompt(options);
  function parse(raw){
    if(typeof raw!=='string'||!raw.trim())throw Error('Paste the AI response first.');
    if(raw.length>1500000)throw Error('The response is too large. Paste the financial summary and site table only.');
    let text=raw.trim(),obj;const fence=text.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fence)text=fence[1].trim();
    try{obj=JSON.parse(text);}catch{const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start>=0&&end>start){try{obj=JSON.parse(text.slice(start,end+1));}catch{throw Error('The JSON response is incomplete. Paste the full response, or use a readable labelled summary and site table. Your deal has not changed.');}}else obj=DealPlain.parse(raw);}
    if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Paste one deal summary at a time.');
    if(obj.analysis&&typeof obj.analysis==='object')obj=obj.analysis;
    const facts=[],assumptions={},warnings=[],sites=[];
    if(!Array.isArray(obj.facts))obj.facts=[];
    if(obj.facts.length>1000)throw Error('Limit this response to 1,000 facts.');
    for(const row of obj.facts){
      if(!row||!keys.has(row.key)){warnings.push('An unrecognized fact was skipped.');continue;}
      if(row.value==null||row.value===''){warnings.push(row.key+': missing value was left blank.');continue;}
      let value=number(row.value);if(value==null)throw Error('Invalid number for '+row.key+'. Your deal has not changed.');
      const unit=clean(row.unit,50).toLowerCase(),moneyMillion=['usd millions','usd million','$mm','million dollars'].includes(unit),moneyDollar=['usd','$','dollars','usd dollars'].includes(unit);
      if(['sites','assetCount'].includes(row.key)){if(!['count','sites'].includes(unit)||!Number.isInteger(value)||value<1)throw Error('Site count must be a positive whole number with unit count.');}
      else if(['gallons','siteMonthlyGallons'].includes(row.key)){if(!['gallons','million gallons'].includes(unit))throw Error('Provide gallons units for '+row.key+'.');if(row.key==='gallons'&&unit==='gallons')value/=1e6;if(row.key==='siteMonthlyGallons'&&unit==='million gallons')value*=1e6;}
      else if(row.key==='fuelMarginCpg'){if(!['cents/gallon','cpg','cents per gallon'].includes(unit))throw Error('Fuel margin needs cents per gallon units.');}
      else if(row.key==='insideMarginPct'){if(!['percent','%'].includes(unit)||value<0||value>100)throw Error('Inside margin needs a percentage from 0 to 100.');}
      else{if(!moneyDollar&&!moneyMillion)throw Error('Provide USD or USD millions units for '+row.key+'.');if(mm.has(row.key)&&moneyDollar)value/=1e6;if(usd.has(row.key)&&moneyMillion)value*=1e6;}
      if(!Number.isFinite(value))throw Error('Number is outside the supported range for '+row.key+'.');
      const scope=row.scope==='site'?'site':row.scope==='segment'?'segment':'portfolio',siteName=clean(row.siteName,180);
      if(scope==='site'&&!siteName)throw Error('A site fact needs a siteName: '+row.key+'.');
      if(['siteNoiUsd','siteInsideSalesUsd','siteMonthlyGallons'].includes(row.key)&&scope!=='site')throw Error(row.key+' must identify its site.');
      const estimated=row.estimated===true||row.confidence==='low';
      facts.push({key:row.key,value,source:clean(row.source,300)||'Pasted AI response',period:clean(row.period,100),excerpt:clean(row.excerpt,600)||row.key+': '+String(row.value)+' '+row.unit,scope,siteName,confidence:estimated?'low':row.confidence==='high'?'high':'medium',verification:estimated?'AI estimate imported from pasted response; '+clean(row.basis,600):'Imported AI source figure; source not independently verified'});
    }
    if(obj.assumptions!=null&&!Array.isArray(obj.assumptions))throw Error('assumptions must be an array.');
    for(const row of obj.assumptions||[]){const spec=row&&Object.hasOwn(OriginalModel.byKey,row.key)&&OriginalModel.byKey[row.key];if(!spec){warnings.push('An unrecognized model assumption was skipped.');continue;}let value=number(row.value);if(value==null){warnings.push(row.key+': missing estimate was left to the original-model default.');continue;}if(value<0)throw Error('Model assumption '+row.key+' must be zero or greater.');if(spec.unit==='sites'&&(!Number.isInteger(value)||(row.key==='sites'&&value<1)))throw Error('Site assumptions must use whole site counts.');if(['insideMargin','savings'].includes(row.key)&&value>100)throw Error(row.key+' cannot exceed 100%.');if(spec.unit.startsWith('$')&&/million|\$mm/i.test(row.unit||''))value*=1e6;assumptions[row.key]={value,basis:clean(row.basis,1000)||'Estimate in pasted AI response'};}
    for(const row of Array.isArray(obj.sites)?obj.sites:[]){if(row&&clean(row.name,180))sites.push(Object.fromEntries(['id','name','address','division','channel','owner','tenure','source','notes'].map(k=>[k,clean(row[k],k==='address'?400:300)])));}
    if(sites.length){const counts=DealRoster.counts(sites);for(const [key,value] of [['sites',counts.sites],['assetCount',counts.assets]])if(value>0&&!facts.some(f=>f.key===key&&f.scope==='portfolio'))facts.push({key,value,source:sites[0].source||'Pasted roster',scope:'portfolio',confidence:'medium',excerpt:'Counted '+counts.assets+' assets and '+counts.sites+' retail sites'});}
    if(!facts.length)throw Error('No usable labelled figures or site table were found. Paste the readable financial summary and full asset roster from Copy AI prompt. Your deal has not changed.');
    const seen=new Set(),unique=facts.filter(f=>{const id=[f.key,f.source,f.scope,f.siteName,f.period,f.value].join('|');if(seen.has(id))return false;seen.add(id);return true;});
    return {dealName:clean(obj.dealName,200),market:clean(obj.market,200),summary:clean(obj.summary),facts:unique,assumptions,sites,limitations:[...(Array.isArray(obj.limitations)?obj.limitations.filter(x=>typeof x==='string').map(x=>clean(x)):[]),...warnings].slice(0,50)};
  }
  function apply(deal,parsed,{files=[],time=new Date().toISOString()}={}){
    DealIntake.remember(deal,parsed.facts);
    deal.pastedEstimates={...(deal.pastedEstimates||{}),...parsed.assumptions};
    deal.aiReview={...parsed,assumptions:undefined,time,model:'Pasted AI response · no API request',estimatedUsd:0,partial:false,usage:{inputTokens:0,outputTokens:0},coverage:[{files:files.length,figures:parsed.facts.length,sites:parsed.sites.length}]};
    deal.fields||={};deal.fieldOrigin||={};const seenFields=new Set();for(const f of parsed.facts){if(['site','segment'].includes(f.scope)||seenFields.has(f.key)||deal.fieldOrigin[f.key]==='manual')continue;seenFields.add(f.key);deal.fields[f.key]=String(f.value);deal.fieldOrigin[f.key]=f.confidence==='low'?'pasted AI estimate':'pasted AI source';if(f.key.startsWith('seller')&&f.period)deal.fields.sellerTablePeriod=f.period;}if(parsed.dealName&&(!deal.fields.name||/^(?:Untitled deal|New deal)$/.test(deal.fields.name)))deal.fields.name=parsed.dealName;if(parsed.market&&!deal.fields.market)deal.fields.market=parsed.market;
    const sources=[...new Set(parsed.facts.map(f=>f.source))],materials=files.length?files.map(f=>typeof f==='string'?f:f.name):sources;
    deal.materials||=[];for(const name of materials)deal.materials.unshift({name,time,state:'Imported from pasted response',detail:'Read in your AI chat; no Deal Lens API charge.'});deal.materials=DealIntake.materials(deal).slice(0,80);
    deal.history||=[];deal.history.unshift({time,label:'Pasted AI results',detail:parsed.facts.length+' figures · '+Object.keys(parsed.assumptions).length+' imported estimates · no API charge',warnings:parsed.limitations,kinds:['pasted AI response'],clues:parsed.facts.map(f=>f.source+': '+f.excerpt).join('\n').slice(0,22000)});deal.history=deal.history.slice(0,30);
    DealRoster.merge(deal,parsed.sites);
    deal.pasteDraft='';return deal;
  }
  globalThis.DealPaste={prompt,parse,apply,number};
})();
