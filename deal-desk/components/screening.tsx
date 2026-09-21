import {Button} from './ui/button';
import {Input} from './ui/input';
import {money,fields} from '../lib/deal';
import {synergyRows,synergyOptions,channelResults,purchaseRecommendation} from '../lib/screening.js';

export function PurchaseScreen({deal,result,update,rerun,period,stale,busy}:any){
 const p=purchaseRecommendation(deal,result);
 return <section className="panel purchase-screen" aria-label="Estimated purchase price">
  <p className="eyebrow">ESTIMATED PURCHASE PRICE · {deal.name}</p>
  <h2>{p.value===null?(result.ready?'Review valuation assumptions':'Upload files or search a company'):money(p.value)}</h2>
  <p>Estimated opening recommendation · asset / enterprise consideration</p>
  <p>Calculated using: <strong>{period||'Choose reporting basis in Deal inputs'}</strong></p>
  {stale&&<p className="notice danger" role="status">Reporting selection changed. This result still uses {period}. Run the company search or file analysis again to obtain the selected period.</p>}
  {p.value===null&&<p>{p.basis}</p>}
  {p.value!==null&&<><div className="double-kpi"><div><strong>{money(p.low)} – {money(p.high)}</strong><p>Screening range</p></div><div><strong>{money(p.capacity)}</strong><p>Ceiling at {deal.hurdle??15}% pretax return</p></div></div>
   <p>{p.basis}</p><p>Current modeled consideration: <strong>{money(deal.price)}</strong>. Screening estimate, not an appraisal or seller quote.</p>
   <fieldset disabled={busy}><label>Terminal recovery (% of recommended consideration)<Input type="number" min="0" max="100" value={deal.exitRecovery??80} onChange={e=>update('exitRecovery',Number(e.target.value))}/></label>
    <div className="actions"><Button disabled={stale} onClick={()=>{update('price',p.value);update('terminal',p.value*(deal.exitRecovery??80)/100);}}>Use recommended price</Button><Button variant="outline" onClick={rerun}>Rerun economics</Button></div>
   </fieldset></>}
  {result.errors.length>0&&<div className="notice danger" role="alert">{result.errors.map((x:string)=><p key={x}>{x}</p>)}</div>}
 </section>;
}

export function SynergyScreen({deal,update,rerun,review,busy}:any){
 const rows=synergyRows(deal),custom=deal.customSynergies||[];
 const change=(id:string,key:string,value:any)=>update('customSynergies',custom.map((s:any)=>s.id===id?{...s,[key]:value}:s));
 return <><section className="panel"><h2>Synergies included and excluded</h2>
  <p>Amounts below reconcile to the combined change in Sunoco and dealer EBITDA. Dealer benefits are excluded from Sunoco purchase capacity. Rent and commission are transfers, not combined synergies.</p>
  <div className="synergy-list">{rows.map((x:any,i:number)=>{const e=review?.evidence?.find((e:any)=>e.field===x.key);return <article key={i} className="notice"><h3>{x.name}</h3><strong>{!x.available?'Needs inputs':x.included?'Included':'Not included'} · {money(x.amount)}</strong><p>{x.scope} · {x.basis}</p>{x.proposed!==undefined&&<p>Entered amount: {money(x.proposed)} · Benefits {x.beneficiary==='dealer'?'retail dealers':'Sunoco'}</p>}{e&&<p>{e.value===deal[x.key]?e.status:'User-edited'} · {e.value===deal[x.key]?e.reason:'Confirm the revised assumption.'}</p>}</article>;})}</div>
  <fieldset disabled={busy}>
   {review?.opportunities?.length>0&&<><h3>Identified opportunities not included</h3>{review.opportunities.map((o:any,i:number)=><article className="notice" key={i}><h3>{o.idea}</h3><strong>Not included · unquantified</strong><p>{o.formula}</p><p>Evidence needed: {o.evidenceNeeded}</p><Button variant="outline" onClick={()=>update('customSynergies',[...custom,{id:crypto.randomUUID(),name:o.idea,scope:o.owner||'Confirm applicable channel',basis:o.formula+' Evidence needed: '+o.evidenceNeeded,beneficiary:'sunoco',amount:0,enabled:false}])}>Add opportunity {i+1} to synergy inputs</Button></article>)}</>}
   <h3>Add or edit a named synergy</h3><p>Enter annual recurring dollars after implementation costs. Use a negative amount for a recurring cost increase. Avoid savings already reflected in operating costs or another row.</p>
   {custom.map((s:any,i:number)=><article className="notice" key={s.id}>
    <div className="field-grid"><label className="field">Synergy name<Input aria-label={'Custom synergy name '+(i+1)} value={s.name} onChange={e=>change(s.id,'name',e.target.value)}/></label>
     <label className="field">Annual amount ($)<Input aria-label={'Custom synergy amount '+(i+1)} type="number" step="any" value={s.amount} onChange={e=>change(s.id,'amount',Number(e.target.value))}/></label>
     <label className="field">Applies to<Input aria-label={'Custom synergy scope '+(i+1)} value={s.scope} placeholder="e.g. Existing wholesale channel" onChange={e=>change(s.id,'scope',e.target.value)}/></label>
     <label className="field">Benefits<select aria-label={'Custom synergy beneficiary '+(i+1)} value={s.beneficiary} onChange={e=>change(s.id,'beneficiary',e.target.value)}><option value="sunoco">Sunoco</option><option value="dealer">Converted retail dealers</option></select></label>
     <label className="field">Calculation and evidence<Input aria-label={'Custom synergy basis '+(i+1)} value={s.basis} placeholder="e.g. 20 contracts × $5,000 net savings" onChange={e=>change(s.id,'basis',e.target.value)}/></label>
     <label className="check-line"><input type="checkbox" aria-label={'Include custom synergy '+(i+1)} checked={s.enabled} onChange={e=>change(s.id,'enabled',e.target.checked)}/> Include in economics</label>
    </div><Button variant="ghost" onClick={()=>update('customSynergies',custom.filter((x:any)=>x.id!==s.id))}>Remove synergy {i+1}</Button>
   </article>)}
   <Button variant="outline" onClick={()=>update('customSynergies',[...custom,{id:crypto.randomUUID(),name:'Additional synergy '+(custom.length+1),scope:'Corporate',basis:'User-entered assumption; confirm supporting evidence.',beneficiary:'sunoco',amount:0,enabled:true}])}>Add synergy</Button>
   <h3>Edit recurring assumptions</h3>
   <div className="field-grid">{synergyOptions.map(([key,label,unit,scope]:string[])=><label className="field" key={key}>{label}<small>{scope} · {unit}</small><Input aria-label={label} type="number" step="any" value={deal[key]??''} placeholder="Unknown" onChange={e=>update(key,e.target.value===''?null:Number(e.target.value))}/></label>)}<label className="field">Eligible retail gallons (%)<Input aria-label="Eligible retail gallons percent" type="number" min="0" max="100" value={deal.eligible??''} onChange={e=>update('eligible',e.target.value===''?null:Number(e.target.value))}/></label></div>
   <h3>Costs and dealer terms already in the conversion bridge</h3><div className="field-grid">{fields.filter(f=>['sellerGa','retainedGa','card','property','lease','maintenanceOpex','retainedOther','dealerOpex','rent','commission'].includes(f.key)).map(f=><label className="field" key={f.key}>{f.label}<small>{f.unit}</small><Input aria-label={'Synergy basis '+f.label} type="number" step="any" value={deal[f.key]??''} placeholder="Unknown" onChange={e=>update(f.key,e.target.value===''?null:Number(e.target.value))}/><small>{f.note}</small></label>)}</div>
   <Button onClick={rerun}>Rerun economics</Button>
  </fieldset>
 </section><ChannelScreen deal={deal} update={update} busy={busy}/></>;
}

export function ChannelScreen({deal,update,busy}:any){
 const channels=channelResults(deal);
 const change=(i:number,key:string,value:any)=>update('channels',(deal.channels||[]).map((c:any,j:number)=>i===j?{...c,[key]:value,metricEvidence:{...c.metricEvidence,[key]:{status:'User-entered',reason:'Edited by user'}}}:c));
 return <section className="panel"><h2>Operating channels and footprint</h2>
  <p><strong>{(Number(deal.sites||0)+channels.reduce((n:number,c:any)=>n+c.sites,0)).toLocaleString()} total modeled locations</strong> · Company-operated retail: <strong>{deal.sites??'Unknown'} sites</strong>. Retail dealer EBITDA is divided by these applicable retail sites. Existing supply-only dealers have separate wholesale economics.</p>
  <p>Reported footprint counts are separate from address records. Company-operated does not mean the real estate is owned.</p><fieldset disabled={busy}>
  {channels.map((c:any,i:number)=><details key={i} open><summary>{c.name} · {c.sites.toLocaleString()} locations · {money(c.ebitda)} annual EBITDA</summary><p>{c.basis}</p>
   <div className="field-grid"><label className="field">Channel name<Input aria-label={'Channel name '+(i+1)} value={c.name} onChange={e=>change(i,'name',e.target.value)}/></label><label className="field">Operating model<select aria-label={'Channel type '+(i+1)} value={c.type||'dealer'} onChange={e=>change(i,'type',e.target.value)}><option value="dealer">Existing dealers</option><option value="wholesale">Wholesale supply</option><option value="fleet">Fleet / cardlock</option><option value="other">Other / corporate</option></select></label>
    {[['sites','Locations'],['gallons','Annual gallons'],['fuelCpg','Supply margin (cents/gallon)'],['other','Other gross profit / rent'],['opex','Annual cash operating costs'],['ga','Annual allocated G&A'],['capex','Annual maintenance capex'],['procurement','Purchasing improvement (cents/gallon)'],['eligible','Eligible volume (%)'],['savings','Additional recurring savings']].map(([key,label])=><label className="field" key={key}>{label}<Input aria-label={c.name+' '+label} type="number" step="any" value={c[key]} onChange={e=>change(i,key,Number(e.target.value))}/><small>{c.metricEvidence?.[key]?.status||'Estimated / user assumption'}{c.metricEvidence?.[key]?.quote?' · '+c.metricEvidence[key].quote:''}</small><small>{c.metricEvidence?.[key]?.reason}</small></label>)}</div>
   <p>Baseline EBITDA {money(c.baseline)} + purchasing {money(c.supply)} + additional savings {money(c.savings)} = {money(c.ebitda)}. Maintenance capital {money(c.capex)} is deducted from cash flow.</p>
   <Button variant="outline" onClick={()=>update('channels',deal.channels.filter((_:any,j:number)=>j!==i))}>Remove {c.name}</Button>
  </details>)}
  <Button variant="outline" onClick={()=>update('channels',[...(deal.channels||[]),{name:'Additional dealer / wholesale '+(channels.length+1),type:'dealer',sites:0,gallons:0,fuelCpg:0,other:0,opex:0,ga:0,capex:0,procurement:0,eligible:0,savings:0,basis:'User-added channel. Enter only this channel’s figures; avoid overlap with existing channels.',status:'User-entered'}])}>Add dealer / wholesale channel</Button>
 </fieldset></section>;
}
