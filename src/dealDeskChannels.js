import {parseAnalysis} from './dealDeskProcessing.js';
import {numberSupported,periodCompatible,derivedSupported,restoreSourceQuotes} from './dealDeskReview.js';
const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
export async function extractChannels({ask,content,sources,review,period,phase=()=>{}}){
 const prompt=`Extract ALL non-retail operating channels for this company and ${period}. Company-operated retail is already modeled separately. Do not count company-operated locations again. Existing dealers may be part of wholesale: create a single channel for overlapping dealer/wholesale locations, not two. Separate fleet/cardlock only if disclosed separately. Do not add intercompany supply profits already included in the retail/wholesale margins. In particular, when segment fuel costs exclude GPMP internal fixed fees, adding GPMP fee profit again double-counts it: include only independently supported external net GPMP earnings, or omit that internal transfer channel. Explain exclusions in basis. Corporate G&A belongs once: return corporateGa not repeated segment G&A. Return JSON {channels:[{name,basis,type:"dealer|wholesale|fleet|other",metrics:{sites,gallons,fuelCpg,other,opex,ga,capex}}],corporateGa:null}. EACH metric is null or {value,quote,sourceId,sourceUnit,period,locator}; use exact short numeric passages from source tables. For TTM derive only full prior year + current YTD − comparable prior YTD, with operation:"ttm" and components:[{value,quote,sourceId,sourceUnit,period}], otherwise null. Values in USD, gallons, cents/gallon or counts, fully scaled. Include reported channel other GP/rental income. Operating costs exclude D&A, interest and corporate G&A; if combined with D&A leave unavailable. If weighted fuel margin is not reported but fuel gross profit and gallons are reported, calculate fuelCpg = fuel gross profit USD / gallons * 100 with operation:"ratioCpg" and two exact source components in that order. Prefer this reported calculation to a generic margin. Do not apply the cost-plus margin to consignment volume. No inventing addresses. Do not exclude channels just because financial values are missing. JSON only, compact. Limit each quote to the numeric row and each basis to 60 words.`;
 const request=async instruction=>parseAnalysis(await ask([{role:'user',content:[{type:'text',text:prompt+instruction},...content]}],{max_tokens:9000}));
 let raw;
 try{raw=await request('');}catch(error){
  if(error.code!=='OUTPUT_LIMIT'&&!(error instanceof SyntaxError))throw error;
  phase('Large channel schedule detected. Processing one operating channel at a time…');
  const roster=parseAnalysis(await ask([{role:'user',content:[{type:'text',text:`List non-overlapping non-retail channel names only for ${period}. Return compact JSON {names:[]}. Combine overlapping dealer/wholesale, include fleet separately, omit intercompany transfers. No metrics.`},...content]}],{max_tokens:800}));
  raw={channels:[],corporateGa:null};
  for(const name of (Array.isArray(roster.names)?roster.names:[]).slice(0,8)){phase(`Reading ${name} channel financials…`);const part=await request(` ONLY extract channel ${JSON.stringify(name)} in this response. Return at most one channel. Omit all others. Return corporateGa only if independently reported.`);raw.channels.push(...(Array.isArray(part.channels)?part.channels:[]));if(part.corporateGa)raw.corporateGa=part.corporateGa;}
 }
 if(!Array.isArray(raw.channels))throw new SyntaxError('Channel response has no channel list.');
 for(const c of raw.channels||[])for(const [field,m] of Object.entries(c.metrics||{})){if(m&&typeof m==='object'){m.field=({opex:'sellerOpex',ga:'sellerGa',capex:'maintenanceCapex'})[field]||field;restoreSourceQuotes({evidence:[m]},sources);}}if(raw.corporateGa&&typeof raw.corporateGa==='object'){raw.corporateGa.field='sellerGa';restoreSourceQuotes({evidence:[raw.corporateGa]},sources);}
 const evidence=[];
 const checked=(m,key)=>m&&Number.isFinite(m.value)&&((sources.some(s=>s.id===m.sourceId&&norm(s.text).includes(norm(m.quote))&&String(m.quote||'').length>=2)&&numberSupported(m.value,m.quote,m.sourceUnit||'',key))||derivedSupported(m,m.value,sources,key))&&(key==='sites'||periodCompatible(m.period,period));
 // A second pass checks table columns and channel definitions before accepting numbers.
 phase('Checking dealer, wholesale and fleet figures against their source tables…');
 const check=parseAnalysis(await ask([{role:'user',content:[{type:'text',text:`Independently verify each channel metric and corporateGa against exact source tables, requested period ${period}, USD units, scale, and non-overlapping perimeter. Return JSON {approved:["0.sites","0.gallons",...,"corporateGa"],reasons:[]}. Approve transparent fuel margin arithmetic (fuel GP USD / gallons * 100) or TTM arithmetic only when all component sources, units and periods match. Reject financial figures for wrong years, total-company figures assigned to a segment, overlapping dealer/wholesale counts, D&A included in cash Opex, and assumptions. Proposal: ${JSON.stringify(raw)}`},...content]}],{max_tokens:3000}));
 const approved=new Set(check.approved||[]);
 const channels=(raw.channels||[]).slice(0,8).map((c,i)=>{
  const result={name:String(c.name||'Existing dealers'),type:c.type,procurement:0,eligible:0,savings:0,status:'Mixed reported / estimated',basis:'',sourceId:'',metricEvidence:{}};
  for(const k of ['sites','gallons','fuelCpg','other','opex','ga','capex']){
   const m=c.metrics?.[k],ok=approved.has(`${i}.${k}`)&&checked(m,k);
   result[k]=ok?m.value:null;result.metricEvidence[k]={...(ok?m:{}),status:ok?(m.operation?'Calculated from reported figures':'Reported'):'Estimated',reason:ok?(m.operation?(m.operation==='ratioCpg'?'Fuel gross profit USD ÷ gallons × 100; verified reported components.':'Calculated TTM = prior full year + current YTD − comparable prior YTD; verified component sources.'):'Verified source table and channel perimeter.'):'Not available in verified source tables; channel assumption shown.'};
  }
  if(result.sites===null)result.sites=0; // unknown count is not invented as a factual footprint
  if(result.gallons===null)result.gallons=result.sites*1000000;
  if(result.fuelCpg===null)result.fuelCpg=c.type==='fleet'?20:5;
  if(result.other===null)result.other=0;
  if(result.opex===null)result.opex=result.gallons*result.fuelCpg/100*.35;
  if(result.ga===null)result.ga=0;
  if(result.capex===null)result.capex=result.sites*2000;
  result.basis=String(c.basis||'')+' Only this channel: gallons × supply margin + other income − channel Opex − allocated G&A. Missing values assume 1m gallons/known location, 5¢ supply margin (fleet 20¢), 35% of fuel GP Opex, $2,000/location capex. Unknown site count shown as 0, not a complete address roster. No commission, store labor, inside profit or retail conversion costs applied.';
  return result;
 });
 if(approved.has('corporateGa')&&checked(raw.corporateGa,'sellerGa')){
  // Keep centrally reported corporate cost out of every segment allocation.
  channels.push({name:'Corporate overhead',type:'other',sites:0,gallons:0,fuelCpg:0,other:0,opex:0,ga:raw.corporateGa.value,capex:0,procurement:0,eligible:0,savings:0,status:'Reported',basis:'Reported corporate G&A, retained once; edit additional corporate savings separately.',metricEvidence:{ga:{...raw.corporateGa,status:'Reported'}}});
  review.deal.sellerGa=0;review.deal.retainedGa=0;
  review.evidence=review.evidence.filter(e=>!['sellerGa','retainedGa'].includes(e.field));
  for(const field of ['sellerGa','retainedGa'])review.evidence.push({field,value:0,status:'Calculated from reported figures',sourceId:raw.corporateGa.sourceId,quote:raw.corporateGa.quote,period,sourceUnit:'USD',locator:raw.corporateGa.locator,reason:'Corporate G&A modeled once in Corporate overhead channel, not duplicated in retail.'});
 }
 review.deal.channels=channels;review.channels=channels;return review;
}
export function applyPeriodBasis(review,{basis,months,year}){
 if(basis!=='ytd'){review.periodSelection={basis,year};return review;}
 if(!Number.isInteger(months)||months<1||months>12)throw Error('Choose 1–12 reporting months.');
 const keys=['gallons','insideGp','transferredOther','other','sellerOpex','sellerGa'];
 for(const k of keys){const e=review.evidence.find(e=>e.field===k);if(review.deal[k]===null||!e||!['supported','Calculated from reported figures'].includes(e.status))continue;const reported=review.deal[k];review.deal[k]=reported/months*12;e.value=review.deal[k];e.status='Annualized from reported figures';e.reason=`Reported ${reported} ÷ ${months} reporting months × 12 = ${e.value}. Simple run rate; no seasonality adjustment.`;}
 for(const c of review.deal.channels||[])for(const k of ['gallons','other','opex','ga','capex']){if(['Reported','supported','Calculated from reported figures'].includes(c.metricEvidence?.[k]?.status)){const reported=c[k];c[k]=reported/months*12;c.metricEvidence[k].reportedValue=reported;c.metricEvidence[k].value=c[k];c.metricEvidence[k].status='Annualized from reported figures';c.metricEvidence[k].reason=`${reported} ÷ ${months} × 12 = ${c[k]}; source period ${c.metricEvidence[k].period||'reported YTD'}.`;}}
 review.periodSelection={basis,months,year};review.company.period=`${year} YTD ${months} months annualized`;review.warnings.push(`Annualized reported YTD flows by ÷ ${months} × 12; counts and rates unchanged. This is a run-rate estimate, not a seasonal forecast.`);return review;
}
