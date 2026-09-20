// Public benchmark vintage is explicit; numerical scenario choices are never
// presented as published industry averages or approved Sunoco commercial terms.
export const benchmarkSource={id:'industry-nacs-2025',name:'NACS 2025 industry data · published April 15, 2026',kind:'benchmark',url:'https://convenience.org/stay-current/press-releases/2026-press-releases/u-s-convenience-in-store-sales-top-$340-billion'};
const assumptionSource={id:'screening-assumptions-v1',name:'Deal Desk analyst screening assumptions · September 2026',kind:'assumption'};
const round=n=>Math.round(n*100)/100;
export function applyIndustryEstimates(review){
 const deal={...review.deal},evidence=[...(review.evidence||[])],estimates=[];
 const period='Annual screening estimate; benchmark vintage FY2025';
 function fill(field,value,basis,sourceId='screening-assumptions-v1',spread=.25){
  if(deal[field]!==null&&deal[field]!==undefined)return;
  value=round(value);if(!Number.isFinite(value))return;
  const old=evidence.find(e=>e.field===field);
  const reason=`ESTIMATED — ${basis}${old?.value!==null&&old?.value!==undefined?` Original proposal ${old.value} was not verified (${old.reason||old.status}); it was not treated as fact.`:''}`;
  const e={field,value,sourceId,locator:'Screening estimate v1',quote:'',period,sourceUnit:'Model input units',status:'Estimated',confidence:'low',reason,low:round(value*(1-spread)),high:round(value*(1+spread))};
  const i=evidence.findIndex(e=>e.field===field);if(i>=0)evidence[i]=e;else evidence.push(e);
  deal[field]=value;estimates.push(e);
 }
 // A checked numerical proposal may still need assumptions about classification.
 // Prefer that target-specific basis over a generic industry fallback, but retain
 // its Estimated status and original source rather than claiming a verified fact.
 for(const e of [...evidence])if(e.estimateEligible&&Number.isFinite(e.value)&&deal[e.field]===null){
  fill(e.field,e.value,`Source-based screening value: ${e.reason||'Reported value needs classification confirmation.'}`,e.sourceId);
  const applied=evidence.find(x=>x.field===e.field);if(applied){applied.quote=e.quote;applied.locator=e.locator;applied.sourceUnit=e.sourceUnit;}
 }
 fill('sites',1,'Acquired count unavailable: model one illustrative site, NOT the company’s actual portfolio size.',undefined,0);
 const n=deal.sites;
 fill('gallons',n*(476.3e9/3.11/122620),'Sites × (2025 industry fuel sales $476.3bn ÷ $3.11/gallon ÷ 122,620 fuel stores). Derived national-average proxy; not target volume.',benchmarkSource.id);
 fill('fuelCpg',35,'35 cents/gallon planning assumption for retail gross fuel margin; not a published NACS average or a Sunoco quote.');
 fill('insideGp',n*(341.2e9/151975)*.33,'Sites × ($341.2bn industry inside sales ÷ 151,975 stores) × assumed 33% gross margin. NACS supplies sales/store count; 33% is an analyst assumption.',benchmarkSource.id);
 fill('transferredOther',0,'No additional ancillary income beyond inside GP until separately identified; zero is an estimate, not confirmed absence.',undefined,0);
 fill('other',0,'No additional retained non-fuel income without identifiable contracts; zero is an estimate.',undefined,0);
 fill('procurement',1,'Assumed 1 cent/gallon purchasing improvement on eligible gallons; unquoted and not approved Sunoco savings.',undefined,1);
 fill('eligible',75,'Assume 75% of volume eligible for new supply terms; contract eligibility unverified.',undefined,1/3);
 fill('freight',0,'Assume freight benefit is included in procurement; no second freight credit.',undefined,0);
 fill('commission',5,'Assumed 5 cents/gallon dealer commission; commercial placeholder, not a Sunoco contract.');
 fill('card',deal.gallons*3.11*(21.3/817.5),'Gallons × NACS 2025 $3.11 retail price × ($21.3bn card fees ÷ $817.5bn total sales). Blended all-sales fee proxy; fuel merchant terms may differ.',benchmarkSource.id);
 fill('property',n*18000,'Assume $18,000/site/year property tax and insurance retained by owner; local assessment and insurance quotes needed.');
 const ownership=String(review.company?.ownership||'');
 const leasedMatch=ownership.match(/\b(\d+)\s+(?:(?:sites?|stores?)\s+(?:(?:are|were)\s+)?)?(?:ground[- ]?)?leased\b/i);
 const leased=leasedMatch?Math.min(n,Number(leasedMatch[1])):/all\b.*(?:fee.simple|owned)/i.test(ownership)?0:Math.ceil(n*.25);
 fill('lease',leased*60000,`${leased} assumed leased sites × $60,000/year. ${leasedMatch?'Count inferred from extracted ownership narrative.':'Absent an explicit lease count, assume 25% leased (rounded up).'} Lease rate is an analyst assumption.`);
 fill('maintenanceOpex',n*10000,'Assume $10,000/site/year routine owner maintenance; excludes capital replacements.');
 fill('retainedOther',n*5000,'Assume $5,000/site/year environmental administration and other owner support.');
 fill('retainedGa',n*5000,'Assume $5,000/site/year ongoing owner G&A; no blanket elimination of support costs.');
 const payroll=n*18*365*2*15.04*1.25;
 const insideFees=deal.insideGp/.33*(21.3/817.5);
 const storeCosts=payroll+n*48000+insideFees;
 fill('dealerOpex',storeCosts,'Sites × (18 hours/day × 365 × 2 staffed positions × NACS $15.04/hour × assumed 1.25 burden + assumed $48,000 utilities/other store costs) + inside GP ÷ assumed 33% margin × NACS blended fee ratio 21.3/817.5. Excludes owner costs and rent.',benchmarkSource.id);
 fill('sellerOpex',storeCosts+deal.card+deal.property+deal.lease+deal.maintenanceOpex+deal.retainedOther,'Same modeled store cost build as dealer, plus fuel card fees, property, lease, maintenance and other owner costs. Excludes seller G&A; no automatic cost-transfer synergy.');
 fill('sellerGa',n*10000,'Assume $10,000/site/year seller corporate G&A, separate from store costs.');
 fill('insideUplift',0,'No unsubstantiated merchandising synergy in the base case.',undefined,0);
 fill('rent',Math.max(0,(deal.insideGp+deal.transferredOther+deal.insideUplift+deal.gallons*deal.commission/100-deal.dealerOpex)*.25),'Assume owner captures 25% of positive dealer cash before rent; zero rent when dealer cannot cover operating costs. Capacity-based scenario, not a lease quote.');
 fill('price',n*2000000,'Assume $2 million/site blended asset/business consideration. Illustrative valuation anchor, not an asking price or appraisal.',undefined,.5);
 fill('convertSites',n,'Assume all acquired sites need some operating/IT transition, including already branded sites.',undefined,0);
 fill('conversion',75000,'Assume $75,000 per converted site for imaging/IT/transition. Excludes major tank replacement or remediation.',undefined,.5);
 fill('oneTime',deal.price*.02,'Assume transaction/integration/upfront working-capital allowance of 2% of consideration.',undefined,.5);
 fill('maintenanceCapex',n*20000,'Assume $20,000/site/year maintenance capital, separately deducted from cash flow. Major catch-up capital excluded.',undefined,.5);
 fill('yearOne',50,'Assume uniform conversion through Year 1: 50% average realization.',undefined,0);
 fill('hurdle',15,'Assumed 15% pretax screening hurdle; not Sunoco’s approved hurdle.',undefined,0);
 fill('terminal',deal.price*.8,'Assume Year 10 net exit proceeds equal 80% of entry consideration, with no appreciation. Residual-value scenario, not an appraisal.',undefined,.25);
 const sources=[...(review.sources||[])];for(const s of [benchmarkSource,assumptionSource])if(estimates.some(e=>e.sourceId===s.id)&&!sources.some(x=>x.id===s.id))sources.push(s);
 const warning=`Screening case includes ${estimates.length} estimated inputs. NACS 2025 national benchmarks are proxies; staffing, margin, valuation and commercial terms are analyst assumptions. Estimates are editable and are not target facts or approved Sunoco terms.`;
 return {...review,deal,evidence,sources,estimates,missing:Object.keys(deal).filter(k=>deal[k]===null),warnings:[...(review.warnings||[]).map(w=>w.replace(/(?:left null|left blank)/gi,'not source-provided; screening estimate shown separately')),...(estimates.length?[warning]:[])]};
}
