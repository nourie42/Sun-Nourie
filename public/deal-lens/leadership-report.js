/* One source of truth for the complete leadership view and downloaded PDF. */
(() => {
  'use strict';
  const tidy=v=>String(v??'').trim();
  const filled=v=>v!=null&&tidy(v)!=='';
  const money=v=>Number.isFinite(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v):'Not verified';
  const percent=v=>Number.isFinite(v)?(v*100).toFixed(1)+'%':'Not verified';
  const number=v=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:1}):'Not provided';
  const label=k=>String(k).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const row=(label,value)=>({label:tidy(label),value:filled(value)?tidy(value):'Not provided'});
  const section=(title,rows)=>({title,rows});
  const sourceValue=(fact)=>[fact.source,fact.period,fact.scope,fact.siteName].filter(Boolean).join(' | ');
  const fuelLabels=[
    ['fuelDistributor','Distributor(s)'],['fuelBrand','Fuel brand / supplier'],['purchaseMethod','How fuel is purchased'],
    ['fuelTerminal','Terminal / loading point'],['terminalOperator','Terminal operator / supplying company'],
    ['fuelPriceTerms','Pricing / rack terms'],['fuelContractEnd','Portfolio contract end'],
    ['fuelTimeRemaining','Time remaining'],['contractGallons','Annual contracted gallons'],
    ['fuelUnams','UNAM payoff / exposure'],['unamTerms','UNAM clause / rate'],
    ['fuelTransfer','Assignment / ROFR / termination'],['fuelNotes','Other fuel terms'],
    ['rentTreatment','Rent expense confirmation']
  ];
  const contractLabels=[
    ['site','Site / group'],['distributor','Distributor'],['supplier','Supplier / brand company'],
    ['brand','Fuel brand'],['terminal','Terminal'],['expiration','Contract expiration'],
    ['remaining','Term remaining'],['gallons','Annual gallons'],['unams','UNAM payoff / exposure'],
    ['pricing','Fuel pricing / rebates'],['rights','Assignment / ROFR / termination'],
    ['source','Contract source'],['notes','Other terms']
  ];
  function collect(deal,model,options={}){
    const f=deal.fields||{},result=model?.result,siteRows=deal.sites||[];
    const sites=Number.isFinite(model?.inputs?.sites)?model.inputs.sites:siteRows.length;
    const ask=model?.items?.price?.status==='estimated'?null:model?.inputs?.price;
    const price=result?.returnCases?.B38?.maxPrice;
    let buyerIrr=null,buyerEngine=null;
    if(Number.isFinite(price)){
      try{const engine=OriginalModel.compute({...model.changes,'COOP!B29':-price});const irr=engine.get('COOP','B38');if(Number.isFinite(irr)&&Math.abs(irr-.13)<1e-7){buyerIrr=irr;buyerEngine=engine;}}catch{}
    }
    const valid=buyerIrr!==null;
    const offer=valid?price:null;
    const report={
      title:f.name||'Untitled deal',
      date:new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}),
      kpis:[
        row('Our COOP offer at 13% buyer IRR',money(offer)),
        row('Buyer IRR | COOP!B38',percent(buyerIrr)),
        row('Retail sites',sites),
        row('Seller asking price',Number.isFinite(ask)?money(ask):'Not confirmed'),
        row('Annual earnings base',money(model?.inputs?.base)),
        row('Year 1 buyer EBITDA',money(buyerEngine?.get('COOP','C22'))),
        row('Closing cash outlay | B37',money(Number.isFinite(buyerEngine?.get('COOP','B37'))?-buyerEngine.get('COOP','B37'):null)),
        row('Estimated inputs to review',model?.estimated??'Not available')
      ],
      sections:[]
    };
    const add=(name,rows)=>report.sections.push(section(name,rows));
    const red=[];
    const contracts=Array.isArray(deal.fuelContracts)?deal.fuelContracts.filter(c=>Object.values(c||{}).some(filled)):[];
    const flagged=Array.isArray(deal.aiReview?.industryFlags)?deal.aiReview.industryFlags:[];
    const due=Array.isArray(deal.aiReview?.diligence)?deal.aiReview.diligence:[];
    const anomalies=flagged.filter(x=>/outlier|high|low|outside|flag|unusual/i.test(tidy(x.status)+' '+tidy(x.flag)));
    if(!valid)red.push('No verified COOP!B38 offer is available; check model inputs and workbook.');
    if(model?.estimated)red.push(model.estimated+' modeled inputs are estimates, not confirmed source facts.');
    if(!contracts.length)red.push('No site-by-site fuel supply contract schedule has been entered.');
    for(const c of contracts){
      const which=[c.site,c.distributor].filter(Boolean).join(' / ')||'Unknown contract';
      if(!filled(c.expiration)&&!filled(c.remaining))red.push('Supply contract expiry is missing for '+which+'.');
      if(filled(c.expiration)){
        const exp=Date.parse(c.expiration);
        if(Number.isFinite(exp)){
          const days=(exp-Date.now())/86400000;
          if(days<0)red.push(which+' fuel supply agreement appears expired ('+c.expiration+'). Verify renewal.');
          else if(days<365)red.push(which+' fuel supply agreement expires within 12 months ('+c.expiration+'). Confirm options, ROFR and renewal.');
        }
      }
    }
    if(!filled(f.fuelDistributor)&&!contracts.some(c=>filled(c.distributor)))red.push('Current fuel distributor is not confirmed.');
    if(!filled(f.fuelUnams)&&!contracts.some(c=>filled(c.unams)))red.push('UNAM exposure has not been documented.');
    if(!filled(f.fuelTransfer)&&!contracts.some(c=>filled(c.rights)))red.push('Fuel supply assignment, termination and ROFR rights are unconfirmed.');
    if(!filled(f.rentTreatment))red.push('Confirm whether there is any rent expense; do not assume one.');
    if(siteRows.length&&sites!==siteRows.length)red.push('Retail site count ('+sites+') differs from '+siteRows.length+' site/asset roster rows. Reconcile included non-retail assets.');
    for(const item of deal.aiReview?.concerns||[])red.push(tidy(item));
    for(const x of anomalies)red.push('Industry comparison: '+[x.metric,x.dealValue,x.benchmark,x.flag||x.status].filter(Boolean).join(' | '));
    for(const g of options.gates||[])if(deal.gates?.[g.id]?.status==='no')red.push('Strategic issue: '+g.title+' | '+(deal.gates[g.id].note||'No mitigation recorded'));
    const uniq=arr=>[...new Set(arr.filter(Boolean))];
    add('Main answers for the leadership call',[
      row('Recommendation',f.recommendation||'Clarify before pricing'),
      row('Quick overview',f.thesis||[f.scope||'Acquisition opportunity',f.market||'market not entered'].join(' | ')),
      row('Why this is attractive',f.whyUs),row('What could break the deal',f.downside),
      row('Decision requested',f.chipAsk),row('Next action',f.nextAction),
      row('Next action owner / due date',[f.actionOwner,f.actionDue].filter(Boolean).join(' / ')),
      row('Three next answers / owners',f.nextAnswers)
    ]);
    add('Biggest red flags and issues',uniq(red).map((value,i)=>row('Risk '+(i+1),value)));
    const missing=[];
    for(const e of options.evidence||[]){
      const entry=deal.evidence?.[e.id]||{};
      if(entry.status!=='verified')missing.push(row(e.title,'NEEDS VERIFICATION | '+(entry.status||'Open')+' | '+(entry.source||e.hint||'Source missing')));
    }
    for(const g of options.gates||[])if(deal.gates?.[g.id]?.status!=='yes')missing.push(row(g.title,deal.gates?.[g.id]?.note||'Unresolved'));
    for(const issue of deal.aiReview?.missing||[])missing.push(row('AI identified missing information',issue));
    for(const issue of deal.aiReview?.limitations||[])missing.push(row('AI reading limitation / uncertainty',issue));
    for(const item of due)missing.push(row(item.priority?item.priority+' | '+(item.category||'Due diligence'):'Due diligence', [item.issue,item.needed,item.owner,item.status,item.source].filter(Boolean).join(' | ')));
    for(const c of contracts){
      const key=[c.site||'Site not entered',c.distributor||'Distributor not entered'].join(' / ');
      for(const [keyName,labelName] of [['expiration','contract end date'],['distributor','distributor'],['unams','UNAM exposure'],['rights','assignment / termination / ROFR']])
        if(!filled(c[keyName]))missing.push(row(key,labelName+' needs confirmation'));
    }
    add('All due diligence and missing information',missing.length?missing:[row('Status','No open items recorded; independent verification is still required')]);
    const yr=result?.years?.[0],econ=[
      row('Seller ask (not our offer)',money(ask)),row('Our maximum buyer COOP offer | B29',money(offer)),
      row('COOP buyer IRR with capitalized lease | B38',percent(buyerIrr)),
      row('Annual earnings before modeled synergies',money(model?.inputs?.base)),
      row('Fuel supply synergy | Year 1',money(yr?.fuel)),
      row('Inside margin synergy | Year 1',money(yr?.insideBenefit)),
      row('Operating cost savings | Year 1',money(yr?.savings)),
      row('Buyer year 1 modeled EBITDA',money(yr?.ebitda)),
      row('Rent',f.rentTreatment==='none'?'Confirmed no rent':f.rentTreatment==='paid'?money(model?.items?.rent?.value):'Not confirmed'),
      row('Transaction type',f.scope),row('Model return source','COOP!B38, original approved workbook | 13% target'),
      row('DODO return rule','DODO supply agreement separately modeled at 20% buyer IRR; not calculated by this COOP page')
    ];
    add('Economics, purchase price and annual synergies',econ);
    add('How fuel is purchased today - portfolio terms',fuelLabels.map(([k,l])=>row(l,f[k])));
    if(contracts.length)for(const [i,c] of contracts.entries())
      add('Fuel supply contract '+(i+1)+' - '+(c.site||c.distributor||'Unassigned'),contractLabels.map(([k,l])=>row(l,c[k])));
    else add('Fuel supply agreements by site',[row('Status','No contract-level records entered; add each distributor and expiration date in DODO fuel supply')]);
    if(siteRows.length)for(const [i,s] of siteRows.entries()){
      const vals=Object.entries(s).filter(([k,v])=>k!=='id'&&filled(v)).map(([k,v])=>row(label(k),v));
      add('Site / asset '+(i+1)+' - '+(s.name||'Unnamed'),vals.length?vals:[row('Status','No site details entered')]);
    }
    else add('Site / asset roster',[row('Status','No current-deal asset roster has been entered')]);
    if(flagged.length)add('Industry benchmarks, outliers and comparability',flagged.flatMap((x,i)=>[
      row('Comparison '+(i+1),[x.metric,x.dealValue,x.benchmark,x.year,x.status||x.flag].filter(Boolean).join(' | ')),
      row('Source / applicability',[x.source,x.comparable,x.basis].filter(Boolean).join(' | '))
    ]));
    add('Industry benchmark reference and limitations',[
      row('NACS 2025 State of the Industry','Use a comparable year, geography, store size, operating model and definition before comparing figures. Full report may require licensed access.'),
      row('NACS public reference','https://www.convenience.org/stay-current/press-releases/2026-press-releases/u-s-convenience-in-store-sales-top-%24340-billion'),
      row('NACS fuel reference','https://www.convenience.org/topics/fuels-and-energy/the-us-petroleum-industry-statistics-definitions'),
      row('Important','Retail gross fuel margin is not directly comparable with wholesale fuel distributor margin. An unsupported benchmark must not be attributed to NACS.')
    ]);
    const facts=typeof DealIntake!=='undefined'?DealIntake.facts(deal):[];
    if(facts.length)add('Source-backed extracted and manually corrected figures',facts.map((x,i)=>row(
      (i+1)+'. '+label(x.key)+(x.manuallyCorrected?' | manually corrected':''),
      number(x.value)+' | '+sourceValue(x)+(x.verification?' | '+x.verification:'')
    )));
    const inputs=model?.items||{};
    add('All original COOP input assumptions and status',Object.entries(inputs).map(([k,v])=>row(label(k),[
      Number.isFinite(v.value)?number(v.value):v.value,v.status,v.basis
    ].filter(filled).join(' | '))));
    const extras=Object.entries(f).filter(([k,v])=>filled(v)&&!['thesis','whyUs','downside','chipAsk','nextAnswers'].includes(k));
    add('Other entered deal details',extras.map(([k,v])=>row(label(k),v)));
    const registered=DealIntake?.materials?.(deal)||deal.materials||[];
    add('Document register and audit trail',registered.length?registered.map(m=>row(m.name,[m.state,m.detail].filter(Boolean).join(' | '))):[row('Documents','Not listed')]);
    add('Strategic and diligence gates',(options.gates||[]).map(g=>row(g.title,[
      deal.gates?.[g.id]?.status||'Open',deal.gates?.[g.id]?.note
    ].filter(Boolean).join(' | '))));
    add('Open and completed diligence tasks',(options.phases||[]).flatMap(phase=>phase.tasks.map((task,i)=>row(phase.name+' / '+task,deal.tasks?.[phase.id+'-'+i]?'Completed':'Open'))));
    return report;
  }
  function html(report){
    const cards=report.kpis.map(x=>'<div><span>'+escape(x.label)+'</span><strong>'+escape(x.value)+'</strong></div>').join('');
    const blocks=report.sections.map(s=>'<section class="report-section"><h3>'+escape(s.title)+'</h3><table class="brief-fuel"><tbody>'+
      s.rows.map(x=>'<tr><th>'+escape(x.label)+'</th><td>'+escape(x.value)+'</td></tr>').join('')+
      '</tbody></table></section>').join('');
    return '<div class="paper-top"><span class="paper-kicker">LEADERSHIP SUMMARY | ALL DEAL INFORMATION</span><span class="paper-date">'+escape(report.date)+'</span></div>'+
      '<h2>'+escape(report.title)+'</h2><p class="subhead">COOP acquisition offer is the buyer price at 13.0% IRR, not the seller ask. Dollar values and estimates need source verification.</p>'+
      '<div class="brief-kpis report-kpis">'+cards+'</div>'+blocks;
  }
  async function downloadPdf(report){
    if(!globalThis.PDFLib?.PDFDocument)throw Error('The PDF library did not load. Reload the page and try again.');
    const pdf=await PDFLib.PDFDocument.create();
    const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const size=[612,792],left=43,contentWidth=size[0]-2*left;
    const ascii=s=>String(s??'').replace(/[—–→]/g,'-').replace(/×/g,'x').replace(/¢/g,' cents').replace(/°/g,' degrees ').replace(/[^\x20-\x7e]/g,' ').replace(/\s+/g,' ').trim();
    const linesFor=(text,face,pt,limit=contentWidth)=>{
      const tokens=ascii(text).split(/\s+/).filter(Boolean),out=[];let line='';
      for(const token of tokens){
        const attempt=line?line+' '+token:token;
        if(face.widthOfTextAtSize(attempt,pt)<=limit){line=attempt;continue;}
        if(line)out.push(line);
        line=token;
        while(face.widthOfTextAtSize(line,pt)>limit&&line.length>1){
          let stop=line.length-1;while(stop>1&&face.widthOfTextAtSize(line.slice(0,stop),pt)>limit)stop--;
          out.push(line.slice(0,stop));line=line.slice(stop);
        }
      }
      if(line)out.push(line);
      return out.length?out:['-'];
    };
    let page,y,pages=[];
    function nextPage(){
      page=pdf.addPage(size);pages.push(page);y=748;
      page.drawText('DEAL LENS  /  LEADERSHIP SUMMARY',{x:left,y:765,font:bold,size:9,color:PDFLib.rgb(0.12,0.37,0.35)});
      page.drawLine({start:{x:left,y:759},end:{x:612-left,y:759},thickness:1,color:PDFLib.rgb(.75,.81,.81)});
    }
    function ensure(n){if(y<n+50)nextPage();}
    function write(text,pt=9,face=font,space=3,indent=0){
      const ls=linesFor(text,face,pt,contentWidth-indent);
      for(const l of ls){ensure(pt+5);page.drawText(l,{x:left+indent,y,font:face,size:pt,color:PDFLib.rgb(.13,.2,.25)});y-=pt+3;}
      y-=space;
    }
    nextPage();
    write(report.title,17,bold,9);
    write('Prepared '+report.date+'  |  Decision use: assumptions and missing items must be confirmed',9,font,12);
    for(const k of report.kpis)write(k.label+':  '+k.value,11,bold,5);
    y-=14;
    for(const block of report.sections){
      ensure(35);y-=7;
      write(block.title.toUpperCase(),11,bold,7);
      for(const item of block.rows){
        write(item.label,8.2,bold,0,0);
        write(item.value,8.7,font,5,10);
      }
    }
    for(let i=0;i<pages.length;i++){
      pages[i].drawText('Page '+(i+1)+' of '+pages.length+' | Internal working draft - verify source and assumptions',{
        x:left,y:26,font,size:8,color:PDFLib.rgb(.45,.5,.52)
      });
    }
    const bytes=await pdf.save();const blob=new Blob([bytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=(report.title||'deal').replace(/[^a-z0-9-]+/gi,'-').replace(/^-|-$/g,'')+'-Leadership-Summary.pdf';
    a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  globalThis.DealLeadershipReport={collect,html,downloadPdf};
})();
