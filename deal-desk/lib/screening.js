// Shared by the browser, exports and server. All monetary flows are annual USD.
export const synergyOptions=[
 ['procurement','Fuel purchasing','cents/gallon','Retail'],['freight','Freight','cents/gallon','Retail'],
 ['insideUplift','Inside gross profit','USD/year','Retail dealer'],
 ['gaSavings','Additional G&A savings','USD/year','Corporate'],['cardSavings','Additional card-fee savings','USD/year','Retail'],
 ['maintenanceSavings','Additional maintenance savings','USD/year','Retail'],['otherSavings','Other recurring savings','USD/year','Corporate']
];
export function customSavings(d,beneficiary='sunoco'){return (d.customSynergies||[]).filter(s=>s.enabled&&s.beneficiary===beneficiary).reduce((n,s)=>n+s.amount,0);}
export function extraSavings(d){return ['gaSavings','cardSavings','maintenanceSavings','otherSavings'].reduce((n,k)=>n+Number(d[k]||0),0)+customSavings(d);}
export function screeningErrors(d){
 const errors=[];
 for(const key of ['gaSavings','cardSavings','maintenanceSavings','otherSavings','exitRecovery'])if(d[key]!==undefined&&(!Number.isFinite(d[key])||(key==='exitRecovery'&&(d[key]<0||d[key]>100))))errors.push(`${key} must be ${key==='exitRecovery'?'between 0 and 100':'a finite number'}.`);
 for(const c of d.channels||[]){for(const key of ['sites','gallons','fuelCpg','other','opex','ga','procurement','eligible','savings','capex'])if(!Number.isFinite(c[key])||(!['fuelCpg','procurement','savings'].includes(key)&&c[key]<0))errors.push(`${c.name}: invalid ${key}.`);if(!Number.isInteger(c.sites)||c.eligible>100)errors.push(`${c.name}: locations must be whole numbers and eligibility cannot exceed 100%.`);}
 for(const s of d.customSynergies||[])if(!s.name?.trim()||!Number.isFinite(s.amount)||!['sunoco','dealer'].includes(s.beneficiary)||typeof s.enabled!=='boolean')errors.push('Each custom synergy needs a name, finite annual amount, beneficiary and inclusion choice.');
 return errors;
}
export function channelResults(d){return (d.channels||[]).map(c=>{const supply=c.gallons*c.procurement/100*c.eligible/100;const baseline=c.gallons*c.fuelCpg/100+c.other-c.opex-c.ga;return {...c,baseline,supply,savings:c.savings||0,ebitda:baseline+supply+(c.savings||0),cash:baseline+supply+(c.savings||0)-c.capex};});}
export function synergyRows(d){return [
 {name:'Fuel purchasing',amount:d.gallons*d.eligible/100*d.procurement/100,scope:'Company-operated retail',basis:'Retail gallons × eligible % × procurement cents ÷ 100',key:'procurement'},
 {name:'Separate freight',amount:d.gallons*d.eligible/100*d.freight/100,scope:'Company-operated retail',basis:'Retail gallons × eligible % × separate freight cents ÷ 100',key:'freight'},
 {name:'Seller vs retained G&A',amount:d.sellerGa-d.retainedGa,scope:'Retail / corporate allocation',basis:'Seller G&A − retained G&A; already in conversion bridge, never added twice',key:'retainedGa'},
 {name:'Store/owner cost change',amount:d.sellerOpex-d.card-d.property-d.lease-d.maintenanceOpex-d.retainedOther-d.dealerOpex,scope:'Retail + dealer combined',basis:'Seller Opex − retained owner Opex − dealer Opex; transferred costs are not savings',key:'dealerOpex'},
 {name:'Dealer inside GP uplift',amount:d.insideUplift,scope:'Retail dealer only',basis:'Benefits dealer; excluded from Sunoco purchase capacity',key:'insideUplift'},
 ...synergyOptions.slice(3).map(([key,name,,scope])=>({key,name,scope,amount:Number(d[key]||0),basis:'Additional net recurring saving; exclude any amount already reflected in retained costs'})),
 ...channelResults(d).flatMap(c=>[{name:c.name+' purchasing',amount:c.supply,scope:c.name,basis:'Channel gallons × eligible % × procurement cents ÷ 100'},{name:c.name+' additional savings',amount:c.savings,scope:c.name,basis:'Channel-specific net cost savings; no retail conversion assumptions'}]),
 ...(d.customSynergies||[]).map(s=>({name:s.name,amount:s.enabled?s.amount:0,proposed:s.amount,scope:s.scope||'User-defined',basis:s.basis||'User-entered assumption; evidence required',beneficiary:s.beneficiary,enabled:s.enabled}))
 ].map(x=>{const required={procurement:['gallons','eligible','procurement'],freight:['gallons','eligible','freight'],retainedGa:['sellerGa','retainedGa'],dealerOpex:['sellerOpex','card','property','lease','maintenanceOpex','retainedOther','dealerOpex'],insideUplift:['insideUplift']}[x.key];const available=!required||required.every(k=>Number.isFinite(d[k]));return {...x,available,amount:available?x.amount:null,included:available&&Number.isFinite(x.amount)&&x.amount!==0};});}
export function purchaseRecommendation(d,r){
 if(!r.ready)return {value:null,low:null,high:null,capacity:null,basis:'Complete the operating inputs to estimate purchase price.'};
 const rate=Number.isFinite(d.hurdle)?d.hurdle/100:.15;
 const channels=channelResults(d),annual=r.sun-Number(d.maintenanceCapex||0)-channels.reduce((n,c)=>n+c.capex,0);
 const seller=r.seller;
 const first=seller+(r.sun-seller)*Number(d.yearOne??50)/100-Number(d.maintenanceCapex||0)-channels.reduce((n,c)=>n+c.capex,0);
 const pv=Array.from({length:10},(_,i)=>(i===0?first:annual)/(1+rate)**(i+1)).reduce((a,b)=>a+b,0);
 const conversion=Number(d.convertSites||0)*Number(d.conversion||0),oneTime=Number(d.oneTime||0);
 // Residual proceeds track the recommended price instead of circularly using the entered price.
 const residual=Number(d.exitRecovery??80)/100;
 const denominator=1-residual/(1+rate)**10;
 if(denominator<=0||!Number.isFinite(denominator))return {value:null,low:null,high:null,capacity:null,basis:'A 0% return with 100% terminal recovery produces no finite price ceiling. Increase the return hurdle or reduce terminal recovery.'};
 const capacity=Math.max(0,(pv-conversion-oneTime)/denominator);
 return {value:Math.round(capacity*.9),low:Math.round(capacity*.8),high:Math.round(capacity),capacity:Math.round(capacity),basis:`Estimated opening price = 90% of return-supported ceiling; range 80–100%. Ten-year pretax cash flows discounted at ${rate*100}%, less conversion and initial costs; terminal recovery ${residual*100}% of proposed price. No financing or tax benefit. ${capacity===0?'Current economics support no positive purchase consideration.':''}`};
}
