import {emptyDeal} from './dealDeskModel.js';
// Issuer-specific table adapter. Values always come from the fetched release;
// no company financial values are embedded in this code. Unknown layouts fail closed.
export function arkoAnnualTables(sources,period){
 const source=sources.find(s=>s.url==='https://www.globenewswire.com/news-release/2026/02/25/3245001/0/en/ARKO-Corp-Reports-Fourth-Quarter-and-Full-Year-2025-Results.html');
 if(!source||!['FY2025','FY2024'].includes(period))return null;
 const year=Number(period.slice(2)),annualColumn=year===2025?2:3;
 try{
  const lines=String(source.text).normalize('NFKC').split(/\r?\n/).map(s=>s.trim());
  const cells=line=>line.split('|').slice(1).map(s=>s.trim()).filter(s=>/^-?\d[\d,]*(?:\.\d+)?$/.test(s)).map(s=>Number(s.replaceAll(',','')));
  function section(label,from=0){const i=lines.findIndex((s,n)=>n>=from&&s===label);if(i<0)throw Error('Missing table '+label);return i;}
  function metric(start,label,unit='USD thousands'){
   const i=lines.findIndex((s,n)=>n>start&&s.split('|')[0].trim()===label);if(i<0||i-start>45)throw Error('Missing row '+label);
   const context=lines.slice(Math.max(0,start-2),i),header=context.find(s=>JSON.stringify(cells(s))==='[2025,2024,2025,2024]');
   if(!header||!context.some(s=>s.includes('For the Year Ended December 31,')))throw Error('Unrecognized period columns');
   if(/thousands/.test(unit)&&!context.some(s=>s.includes('(in thousands)')))throw Error('Unrecognized source scale');
   const values=cells(lines[i]);if(values.length!==4)throw Error('Ambiguous row');
   const value=values[annualColumn]*(unit.includes('thousands')?1000:1);
   return {value,sourceId:source.id,quote:lines[i],sourceUnit:unit,period,locator:`${lines[start]} · year ended December 31, ${year} · ${label}`,status:'supported',reason:'Read directly from the issuer table: validated annual-year column, original unit and row label.'};
  }
  function count(segment){const start=lines.findIndex(s=>s.startsWith(segment+' |')||s.startsWith(segment+' 1 |'));if(start<0)throw Error('Missing footprint table');return metric(start,'Number of sites at end of period','count');}
  const retail=section('Retail'),wholesale=section('Wholesale'),fleet=section('Fleet Fueling'),supplement=section('Supplemental Disclosures of Segment Information');
  const rs=section('Retail Segment',supplement),ws=section('Wholesale Segment',supplement),fs=section('Fleet Fueling Segment',supplement);
  const consolidated=lines.findIndex(s=>s.includes('Consolidated Statements of Operations'));if(consolidated<0)throw Error('Missing consolidated table');
  const add=(a,b)=>({...a,value:a.value+b.value,components:[a,b],operation:'sum',status:'Calculated from reported figures',reason:'Sum of the two separately reported subchannel totals.'});
  const subtract=(a,b)=>({...a,value:a.value-b.value,components:[a,b],operation:'difference',status:'Calculated from reported figures',reason:'Reported revenue less reported cost.'});
  const ratio=(gp,gallons)=>({...gp,value:gp.value/gallons.value*100,components:[gp,gallons],operation:'ratioCpg',status:'Calculated from reported figures',reason:`Reported fuel gross profit $${gp.value.toLocaleString()} ÷ reported ${gallons.value.toLocaleString()} gallons × 100. Uses unrounded margin to reconcile to reported profit.`});
  const retailGallons=metric(retail,'Fuel gallons sold','gallons thousands'),retailGp=metric(retail,'Fuel contribution 2');
  const deal=emptyDeal(),evidence=[];deal.name='ARKO Corp.';
  function put(field,m){deal[field]=m.value;evidence.push({...m,field});}
  put('sites',count('Retail Segment'));put('gallons',retailGallons);put('fuelCpg',ratio(retailGp,retailGallons));put('insideGp',metric(retail,'Merchandise contribution 4'));put('sellerOpex',metric(rs,'Site operating expenses'));
  const retailOther=metric(rs,'Other revenues, net');
  evidence.push({...retailOther,field:'other',status:'needs review',estimateEligible:true,reason:'Reported retail other revenue; the screening allocation assumes it remains with the owner. Retention versus dealer transfer is an estimate and must be confirmed.'});
  const corporate=metric(consolidated,'General and administrative expenses');
  for(const field of ['sellerGa','retainedGa'])put(field,{...corporate,value:0,status:'Calculated from reported figures',reason:'Consolidated corporate G&A is retained once in the Corporate overhead channel, with no duplicate retail allocation.'});
  const channels=[];
  function channel(name,type,segment,highlight,schedule,suffixes){
   const gallons=add(...suffixes.map(s=>metric(highlight,'Fuel gallons sold – '+s,'gallons thousands')));
   const gp=subtract(metric(schedule,'Fuel revenue'),metric(schedule,'Fuel costs 1'));
   const metrics={sites:count(segment),gallons,fuelCpg:ratio(gp,gallons),other:metric(schedule,'Other revenues, net'),opex:metric(schedule,'Site operating expenses')};
   const c={name,type,procurement:0,eligible:0,savings:0,ga:0,capex:metrics.sites.value*2000,status:'Reported financials; estimated maintenance capital',sourceId:source.id,metricEvidence:{},basis:'Existing operating channel. Fuel margin uses reported fuel revenue less fuel costs divided by combined subchannel gallons. No retail commission or conversion costs. Corporate G&A is separate. No duplicate GPMP intercompany profit.'};
   for(const [key,m]of Object.entries(metrics)){c[key]=m.value;c.metricEvidence[key]={...m,status:m.status==='supported'?'Reported':m.status};}
   c.metricEvidence.ga={status:'Calculated from reported figures',reason:'Corporate G&A is modeled once in Corporate overhead.'};
   c.metricEvidence.capex={status:'Estimated',reason:'Maintenance-only capital not disclosed by channel; assume $2,000 per reported location per year.'};
   channels.push(c);return {gp,other:metrics.other,opex:metrics.opex};
  }
  const w=channel('Existing dealers / wholesale','wholesale','Wholesale Segment',wholesale,ws,['fuel supply locations','consignment agent locations']);
  const f=channel('Fleet fueling / cardlock','fleet','Fleet Fueling Segment',fleet,fs,['proprietary cardlock locations','third-party cardlock locations']);
  const consolidatedGp=subtract(metric(consolidated,'Fuel revenue'),metric(consolidated,'Fuel costs'));
  const otherTotal=metric(consolidated,'Other revenues, net'),opexTotal=metric(consolidated,'Site operating expenses');
  const residualIncome=consolidatedGp.value-retailGp.value-w.gp.value-f.gp.value+otherTotal.value-retailOther.value-w.other.value-f.other.value;
  const residualCosts=opexTotal.value-deal.sellerOpex-w.opex.value-f.opex.value;
  if(residualIncome<0||residualCosts<0)throw Error('Unexpected consolidated reconciliation');
  channels.push({name:'Consolidated reconciliation / other operations',type:'other',sites:0,gallons:0,fuelCpg:0,other:residualIncome,opex:residualCosts,ga:0,capex:0,procurement:0,eligible:0,savings:0,status:'Calculated from reported figures',sourceId:source.id,basis:'Consolidated fuel gross profit and other revenue less retail, wholesale and fleet amounts; consolidated site Opex less those same segments. Includes external/other operations and consolidation differences once. Intercompany GPMP profit is not added a second time. No additional location count.',metricEvidence:{other:{status:'Calculated from reported figures',reason:`Consolidated fuel GP ${consolidatedGp.value} − retail ${retailGp.value} − wholesale ${w.gp.value} − fleet ${f.gp.value} + consolidated other ${otherTotal.value} − retail other ${retailOther.value} − wholesale other ${w.other.value} − fleet other ${f.other.value}.`,components:[consolidatedGp,retailGp,w.gp,f.gp,otherTotal,retailOther,w.other,f.other]},opex:{...opexTotal,status:'Calculated from reported figures',reason:`${opexTotal.value} − ${deal.sellerOpex} − ${w.opex.value} − ${f.opex.value} = ${residualCosts}`},capex:{status:'Estimated',reason:'Zero additional maintenance capital assumed for reconciliation-only activity; confirm capital allocation.'}}});
  channels.push({name:'Corporate overhead',type:'other',sites:0,gallons:0,fuelCpg:0,other:0,opex:0,ga:corporate.value,capex:0,procurement:0,eligible:0,savings:0,status:'Reported',sourceId:source.id,basis:'Full consolidated reported G&A, retained once. Enter additional corporate savings explicitly in Synergies.',metricEvidence:{ga:{...corporate,status:'Reported'}}});
  deal.channels=channels;
  const totalSites=deal.sites+channels.reduce((n,c)=>n+c.sites,0);
  const summary=`ARKO's ${period} issuer tables report ${totalSites.toLocaleString()} locations: ${deal.sites.toLocaleString()} company-operated retail, ${channels[0].sites.toLocaleString()} dealer/wholesale, and ${channels[1].sites.toLocaleString()} fleet/cardlock. The model imports each channel's published financial figures separately and reconciles other operations to consolidated totals. Corporate G&A is counted once. Retail dealer conversion applies only to company-operated stores. Purchase price, transaction terms, maintenance capital and proposed synergies are labeled screening estimates. This is a ${period} operating-perimeter screen; the subsequent APC IPO and minority interests must be reflected before determining equity consideration.`;
  return {deal,company:{name:deal.name,period,overview:summary,headquarters:'Richmond, Virginia',ownership:'Public company (Nasdaq: ARKO). Company-operated does not establish fee-simple real estate ownership.',business:'Convenience-store retail, dealer/wholesale fuel supply and fleet/cardlock fueling.',geography:'United States',sourceIds:[source.id]},summary,evidence,channels,sites:[],sources:sources.map(({text,...s})=>s),opportunities:[],warnings:[`${period} figures read directly from the issuer release${year===2024?' (comparative annual columns)':''}; counts are reported footprint totals, not individual address records.`,'Retail other revenue is reported, but its retention after dealer conversion is a labeled allocation estimate.','The model uses unrounded fuel gross profit ÷ gallons; the issuer presents rounded cents-per-gallon margins.','Maintenance-only capital, future deal terms and synergies are not disclosed operating facts.','The post-period APC IPO and minority ownership require transaction-perimeter and equity-value adjustments.'],conflicts:[],missing:[],verified:true,generatedAt:new Date().toISOString()};
 }catch{return null;}
}
