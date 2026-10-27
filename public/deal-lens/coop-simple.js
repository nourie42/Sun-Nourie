/* Simple COOP model: one COOP tab laid out like the original workbook (same rows,
   so B34/B38 mean the same thing), written with live Excel formulas, plus a
   one-page visual deal summary PDF. Values are calculated by evaluating the
   formulas written to the file with OriginalFormulaEngine, so the download and
   the page cannot drift apart. Signs follow the workbook: costs are negative. */
(() => {
  const YEARS=15,COLS=Array.from({length:YEARS},(_,i)=>String.fromCharCode(67+i)); // C..Q
  const prev=c=>String.fromCharCode(c.charCodeAt(0)-1);
  const finite=x=>typeof x==='number'&&Number.isFinite(x);

  /* p: sites, gallons, volumeRate (multiplier, 0.985 = −1.5%/yr), cpg, cpgGrowth (¢ added per year), fuelSynergyCpg,
     inside, insideGrowth, insideMargin, insideSynergy, other, otherGrowth, opex (<0), opexGrowth, opexSynergy,
     drawPerSite (<0), addBackDraw (bool), fieldPerSite (<0), rent (<0), rentGrowth, itPerSite (<0),
     maintYear1PerSite (<0), maintPerSite (<0), tank [15 totals, <0], laterGrowthCapital [14 totals, years 2-15],
     growthSites, taxRate, wcPerSite (>0), price (>0), unams (>0), closingRate, exitMultiple, target (fraction). */
  function layout(p){
    const cells={},notes=[];
    const put=(a,f,s,v)=>{cells[a]=f==null?{v,s}:{f:'='+f,v:null,s};};
    const input=(a,v,s)=>{if(!finite(v))throw Error('Simple COOP model input '+a+' is not a number');cells[a]={v,s,input:true};};
    const label=(a,t,s='label')=>cells[a]={v:t,s};
    const row=(r,t,note,s)=>{label('A'+r,t,s);if(note)label('T'+r,note,'note');};
    label('A1',p.name||'Simple COOP model','title');label('B1','Close','head');COLS.forEach((c,i)=>cells[c+'1']={v:i+1,s:'head'});label('S1','Assumption','head');label('T1','What it means','head');
    row(2,'# of COOP sites');input('C2',p.sites,'inInt');COLS.slice(1).forEach(c=>put(c+'2',prev(c)+'2','int'));
    row(3,'Fuel volume (gallons)','Annual volume rate: 0.985 keeps 98.5% of the prior year');input('C3',p.gallons,'inInt');COLS.slice(1).forEach(c=>put(c+'3',prev(c)+'3*$S$3','int'));input('S3',p.volumeRate,'inRate');
    row(4,'Fuel CPG (¢/gal)','Annual CPG change, cents per gallon');input('C4',p.cpg,'inDec');COLS.slice(1).forEach(c=>put(c+'4',prev(c)+'4+$S$4','dec'));input('S4',p.cpgGrowth,'inDec');
    row(5,'Fuel margin');COLS.forEach(c=>put(c+'5',`${c}3*${c}4/100`,'usd'));
    row(6,'Fuel synergy CPG (¢/gal)','Fuel synergy, cents per gallon');COLS.forEach(c=>put(c+'6','$S$6','dec'));input('S6',p.fuelSynergyCpg,'inDec');
    row(7,'Fuel synergy margin');COLS.forEach(c=>put(c+'7',`${c}3*${c}6/100`,'usd'));
    row(8,'Total fuel margin','','bold');COLS.forEach(c=>put(c+'8',`${c}5+${c}7`,'usdBold'));
    row(9,'Inside sales','Annual growth rate');input('C9',p.inside,'inUsd');COLS.slice(1).forEach(c=>put(c+'9',`${prev(c)}9*(1+$S$9)`,'usd'));input('S9',p.insideGrowth,'inPct');
    row(10,'Inside margin %');input('C10',p.insideMargin,'inPct');COLS.slice(1).forEach(c=>put(c+'10',prev(c)+'10','pct'));
    row(11,'Inside margin');COLS.forEach(c=>put(c+'11',`${c}9*${c}10`,'usd'));
    row(12,'Inside synergy %','Inside synergy, share of inside sales');put('C12','$S$12','pct');COLS.slice(1).forEach(c=>put(c+'12',prev(c)+'12','pct'));input('S12',p.insideSynergy,'inPct');
    row(13,'Inside synergy $');COLS.forEach(c=>put(c+'13',`${c}9*${c}12`,'usd'));
    row(14,'Other margin (incl. rental income)','Annual growth rate');input('C14',p.other,'inUsd');COLS.slice(1).forEach(c=>put(c+'14',`${prev(c)}14*(1+$S$14)`,'usd'));input('S14',p.otherGrowth,'inPct');
    row(15,'Total margin','','bold');COLS.forEach(c=>put(c+'15',`${c}8+${c}11+${c}13+${c}14`,'usdBold'));
    row(16,'Opex incl. CC fees, RE tax, rental exp.','Annual growth rate (also grows field support)');input('C16',p.opex,'inUsd');COLS.slice(1).forEach(c=>put(c+'16',`${prev(c)}16*(1+$S$16)`,'usd'));input('S16',p.opexGrowth,'inPct');
    row(17,'Opex synergy','Assumed savings versus the existing operator');COLS.forEach(c=>put(c+'17',`${c}16*-$S$17`,'usd'));input('S17',p.opexSynergy,'inPct');
    row(18,'Operator draw','Per site per year (negative = paid to the operator)');COLS.forEach(c=>put(c+'18',`$S$18*${c}2`,'usd'));input('S18',p.drawPerSite,'inUsd');
    row(19,'Field support / G&A','Per site, year 1');put('C19','$S$19*C2','usd');COLS.slice(1).forEach(c=>put(c+'19',`${prev(c)}19*(1+$S$16)`,'usd'));input('S19',p.fieldPerSite,'inUsd');
    row(20,'EBITDAR','','bold');COLS.forEach(c=>put(c+'20',`SUM(${c}15:${c}19)`,'usdBold'));
    row(21,'Rent expense','Annual rent growth');input('C21',p.rent,'inUsd');COLS.slice(1).forEach(c=>put(c+'21',`${prev(c)}21*(1+$S$21)`,'usd'));input('S21',p.rentGrowth,'inPct');
    row(22,'EBITDA','','bold');COLS.forEach(c=>put(c+'22',`${c}20+${c}21`,'usdBold'));
    row(23,'IT capital','Per site, year 1 only');put('C23','$S$23*C2','usd');input('S23',p.itPerSite,'inUsd');
    row(24,'Maintenance capital',`Year 1: ${Math.round(p.maintYear1PerSite).toLocaleString('en-US')} per site. Year 2 on: S24 per site, +3% a year`);put('C24',`${p.maintYear1PerSite}*C2`,'usd');put('D24','$S$24*D2*1.03','usd');COLS.slice(2).forEach(c=>put(c+'24',prev(c)+'24*1.03','usd'));input('S24',p.maintPerSite,'inUsd');
    row(25,'Tank capital','Enter by year (total dollars, negative)');COLS.forEach((c,i)=>input(c+'25',p.tank?.[i]||0,'inUsd'));
    row(26,'Growth capital','Sites rebranded × $90,000 in year 1');put('C26','S26*-90000','usd');COLS.slice(1).forEach((c,i)=>input(c+'26',p.laterGrowthCapital?.[i]||0,'inUsd'));input('S26',p.growthSites,'inInt');
    row(27,'1031 / tax','Tax rate. Taxable = EBITDA − 12¢ × gallons − price ÷ 15; never a credit');COLS.forEach(c=>{const x=`(${c}22-${c}3*0.12+$B$29/15)*-$S$27`;put(c+'27',`IF(${x}>0,0,${x})`,'usd');});input('S27',p.taxRate,'inPct');
    row(28,'Working capital','Per site at close; returned in year 15');put('B28','-S28*C2','usd');put('Q28','-SUM(B28:C28)','usd');input('S28',p.wcPerSite,'inUsd');
    row(29,'Purchase price / year-1 add-back / exit','Exit multiple on year-15 EBITDAR');input('B29',-p.price,'inUsd');if(p.addBackDraw)put('C29','-C18','usd');else input('C29',0,'inUsd');put('Q29','Q20*$S$29','usd');input('S29',p.exitMultiple,'inMult');
    row(30,'UNAMs');input('B30',-p.unams,'inUsd');
    row(31,'Closing cost','Share of purchase price');put('B31','B29*$S$31','usd');input('S31',p.closingRate,'inPct');
    row(32,'Funds flow','','bold');put('B32','SUM(B20:B31)','usdBold');COLS.forEach(c=>put(c+'32',`SUM(${c}22:${c}31)`,'usdBold'));
    row(33,'NPV at 15%');put('B33','NPV(0.15,C32:Q32)+B32','usd');
    row(34,'IRR · without capitalized lease','Same cell as the original COOP!B34','bold');put('B34','IRR(B32:Q32)','pctBold');
    row(36,'Capitalized lease','Rent discounted at 6.5%');put('B36','NPV(0.065,C21:Q21)','usd');
    row(37,'Funds flow · with capitalized lease','','bold');put('B37','B32+B36','usdBold');COLS.forEach(c=>put(c+'37',`${c}20+SUM(${c}23:${c}31)`,'usdBold'));
    row(38,'IRR · with capitalized lease','Same cell as the original COOP!B38','bold');put('B38','IRR(B37:Q37)','pctBold');
    row(41,'Non-synergized EBITDA');put('B41','C5+C11+C14+C16+C21','usd');
    row(42,'Multiple on seller EBITDA');put('B42','IFERROR(-B29/B41,0)','mult');
    row(43,'Multiple on our year-1 EBITDAR');put('B43','IFERROR(-B29/C20,0)','mult');
    row(45,'Non-synergized EBITDAR');put('B45','C5+C11+C14+C16','usd');
    row(46,'Multiple on seller EBITDAR');put('B46','IFERROR(-B29/B45,0)','mult');
    row(49,'Target IRR');input('B49',p.target,'inPct');
    row(50,'Price at target IRR · without capitalized lease','Solved when exported. To re-solve in Excel: What-If › Goal Seek, set B34 to B49 by changing B29','bold');
    row(51,'Price at target IRR · with capitalized lease','Goal Seek: set B38 to B49 by changing B29','bold');
    return {cells,notes};
  }

  function calculate(p){
    if(typeof OriginalFormulaEngine==='undefined')throw Error('The model calculator did not load. Reload the page and try again.');
    const {cells}=layout(p),data={sheets:{COOP:{}}};
    for(const [a,c] of Object.entries(cells))data.sheets.COOP[a]={v:c.f?null:c.v,f:c.f||null};
    const run=OriginalFormulaEngine.create(data),inputs={};
    for(const [a,c] of Object.entries(cells))if(c.input)inputs['COOP!'+a]=c.v;
    const flows=(calc,r)=>['B',...COLS].map(c=>calc.get('COOP',c+r));
    const npv=(rate,f)=>f.reduce((s,x,i)=>s+x/(1+rate)**i,0);
    const calc=run(inputs),values=calc.snapshot();
    for(const [a,c] of Object.entries(cells))if(c.f){const v=values['COOP!'+a];c.v=v;}
    // Price changes cash tax, so each trial price is a full recalculation of the sheet.
    const solve=row=>{
      const at=price=>{const f=flows(run({...inputs,'COOP!B29':-price}),row);return f.every(finite)?npv(p.target,f):NaN;};
      let lo=0,hi=Math.max(p.price*2,1e6),fl=at(lo),fh=at(hi);
      if(!finite(fl)||fl<0)return null;
      while(fh>0&&hi<1e12){hi*=2;fh=at(hi);}
      if(!finite(fh)||fh>0)return null;
      for(let i=0;i<80&&hi-lo>.005;i++){const m=(lo+hi)/2,fm=at(m);if(!finite(fm))return null;if(fm>0)lo=m;else hi=m;}
      return (lo+hi)/2;
    };
    const get=a=>cells[a]?.v,num=a=>finite(get(a))?get(a):null;
    const priceB34=solve(32),priceB38=solve(37);
    cells.B50={v:priceB34??'Not solvable',s:priceB34==null?'label':'usdBold'};cells.B51={v:priceB38??'Not solvable',s:priceB38==null?'label':'usdBold'};
    const year=c=>({fuel:get(c+'5'),fuelSynergy:get(c+'7'),inside:get(c+'11'),insideSynergy:get(c+'13'),other:get(c+'14'),opex:get(c+'16'),opexSynergy:get(c+'17'),draw:get(c+'18'),field:get(c+'19'),ebitdar:get(c+'20'),rent:get(c+'21'),ebitda:get(c+'22'),gallons:get(c+'3')});
    return {params:p,cells,flows:flows(calc,32),leaseFlows:flows(calc,37),irr:num('B34'),leaseIrr:num('B38'),npv15:num('B33'),priceAtTarget:priceB34,leasePriceAtTarget:priceB38,
      year1:year('C'),ebitda:COLS.map(c=>get(c+'22')),ebitdar:COLS.map(c=>get(c+'20')),exit:get('Q29'),addBack:get('C29'),
      close:{price:-get('B29'),workingCapital:-get('B28'),unams:-get('B30'),closing:-get('B31'),total:-get('B32')},
      sellerEbitda:num('B41'),sellerMultiple:get('B41')>0?num('B42'):null,ourMultiple:get('C20')>0?num('B43'):null};
  }

  /* ---------- XLSX ---------- */
  const xml=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
  const STYLES=['default','title','head','label','bold','note','usd','usdBold','int','dec','pct','pctBold','mult','inUsd','inInt','inDec','inPct','inRate','inMult'];
  const STYLE_XML=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0;(#,##0)"/><numFmt numFmtId="165" formatCode="0.0&quot;x&quot;"/><numFmt numFmtId="166" formatCode="0.000"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF566882"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF1649B5"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2B3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E1F37"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${STYLES.length}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="4" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="4" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="2" fontId="4" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="10" fontId="4" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="166" fontId="4" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="4" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  function cellXml(a,c){
    const s=Math.max(0,STYLES.indexOf(c.s)),attr=`r="${a}"${s?` s="${s}"`:''}`;
    if(c.f){const v=c.v;const value=finite(v)?`<v>${v}</v>`:typeof v==='boolean'?`<v>${v?1:0}</v>`:'';return `<c ${attr}${typeof v==='string'?' t="str"':typeof v==='boolean'?' t="b"':''}><f>${xml(c.f.slice(1))}</f>${typeof v==='string'?`<v>${xml(v)}</v>`:value}</c>`;}
    if(finite(c.v))return `<c ${attr}><v>${c.v}</v></c>`;
    if(c.v==null||c.v==='')return '';
    return `<c ${attr} t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
  }
  function sheetXml(cells,{widths,freeze}){
    const rows=new Map();
    for(const [a,c] of Object.entries(cells)){const m=a.match(/^([A-Z]+)(\d+)$/),r=+m[2];if(!rows.has(r))rows.set(r,[]);rows.get(r).push([m[1],a,c]);}
    const colIndex=s=>s.split('').reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
    const body=[...rows.keys()].sort((x,y)=>x-y).map(r=>`<row r="${r}">${rows.get(r).sort((x,y)=>colIndex(x[0])-colIndex(y[0])).map(([,a,c])=>cellXml(a,c)).join('')}</row>`).join('');
    const pane=freeze?`<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews>`:'<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="15"/><cols>${widths.map(([a,b,w])=>`<col min="${a}" max="${b}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
  }
  function workbookFiles(model,meta={}){
    const coop=sheetXml(model.cells,{freeze:true,widths:[[1,1,42],[2,17,14],[18,18,2],[19,19,12],[20,20,70]]});
    const about={},line=(r,a,b,s)=>{about['A'+r]={v:a,s:s||'bold'};if(b!=null)about['B'+r]={v:b,s:'label'};};
    line(1,meta.title||'Simple COOP model','title');
    line(3,'Deal',meta.name||'');line(4,'Prepared',meta.date||new Date().toLocaleDateString('en-US'));line(5,'Source',meta.source||'');
    line(7,'How to use','The COOP tab keeps the original COOP row layout. Yellow cells with blue text are inputs; every other number is a live formula.');
    line(8,'',"Change an input and Excel recalculates the cash flows, NPV and both IRRs (B34 without, B38 with capitalized lease).");
    line(9,'','Prices at the target IRR (B50, B51) are solved when exported. Use Goal Seek on B29 to re-solve after edits.');
    (meta.notes||[]).forEach((n,i)=>line(11+i,n[0],n[1]));
    const readme=sheetXml(about,{widths:[[1,1,22],[2,2,120]]});
    const sheetName='COOP';
    return {
      '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/><sheet name="About" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
      'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml':STYLE_XML,'xl/worksheets/sheet1.xml':coop,'xl/worksheets/sheet2.xml':readme
    };
  }
  async function workbook(model,meta){
    if(typeof JSZip==='undefined')throw Error('The spreadsheet writer did not load. Reload the page and try again.');
    const zip=new JSZip();for(const [name,text] of Object.entries(workbookFiles(model,meta)))zip.file(name,text);
    return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  /* ---------- PDF ---------- */
  const money=v=>!finite(v)?'—':(v<0?'-$':'$')+Math.abs(Math.round(v)).toLocaleString('en-US');
  const short=v=>{if(!finite(v))return '—';const a=Math.abs(v),s=v<0?'-':'';return a>=1e6?s+'$'+(a/1e6).toFixed(a>=1e8?0:2)+'M':a>=1e3?s+'$'+Math.round(a/1e3)+'K':s+'$'+Math.round(a);};
  const pct=(v,d=1)=>finite(v)?(v*100).toFixed(d)+'%':'n/a';
  // Standard PDF fonts only cover WinAnsi; map the few symbols this page uses.
  const ansi=s=>String(s??'').replace(/[−–—]/g,'-').replace(/[→›]/g,'>').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/×/g,'x').replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/…/g,'...').replace(/[^\x20-\x7e\xa0-\xff]/g,'');

  async function pdf(model,meta={}){
    if(typeof PDFLib==='undefined')throw Error('The PDF writer did not load. Reload the page and try again.');
    const {PDFDocument,StandardFonts,rgb}=PDFLib,hex=h=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
    const C={ink:hex('#0E1F37'),muted:hex('#566882'),line:hex('#D0D8E3'),soft:hex('#F2F5F9'),blue:hex('#1649B5'),red:hex('#B42318'),green:hex('#17794A'),amber:hex('#FFC20E'),white:hex('#FFFFFF')};
    const doc=await PDFDocument.create();doc.setTitle(ansi((meta.name||'Deal')+' - deal summary'));doc.setCreator('Deal Lens');doc.setProducer('Deal Lens');
    const page=doc.addPage([792,612]),W=792,H=612,M=32;
    const reg=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
    const width=(t,s,f=reg)=>f.widthOfTextAtSize(ansi(t),s);
    const text=(t,x,y,{size=9,font=reg,color=C.ink,align='left',max}={})=>{let s=ansi(t);if(max&&font.widthOfTextAtSize(s,size)>max){while(s.length>1&&font.widthOfTextAtSize(s+'...',size)>max)s=s.slice(0,-1);s=s.trimEnd()+'...';}const w=font.widthOfTextAtSize(s,size);page.drawText(s,{x:align==='right'?x-w:align==='center'?x-w/2:x,y,size,font,color});};
    const wrap=(t,max,size,font=reg)=>{const out=[];let line='';for(const word of ansi(t).split(/\s+/).filter(Boolean)){const next=line?line+' '+word:word;if(font.widthOfTextAtSize(next,size)>max&&line){out.push(line);line=word;}else line=next;}if(line)out.push(line);return out;};
    const box=(x,y,w,h,color,border)=>page.drawRectangle(border?{x,y,width:w,height:h,color,borderColor:border,borderWidth:.75}:{x,y,width:w,height:h,color});
    const heading=(t,x,y)=>{text(t.toUpperCase(),x,y,{size:7.5,font:bold,color:C.muted});};

    // Header band
    box(0,H-74,W,74,C.ink);
    text(meta.kicker||'DEAL SUMMARY · SIMPLE COOP MODEL',M,H-24,{size:8,font:bold,color:C.amber});
    text(meta.name||'Untitled deal',M,H-50,{size:22,font:bold,color:C.white,max:470});
    text([meta.subtitle,meta.date||new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})].filter(Boolean).join('  ·  '),M,H-66,{size:8.5,color:hex('#A3B1C6'),max:520});
    if(meta.recommendation){const t=ansi(meta.recommendation.toUpperCase()),w=width(t,9,bold)+20;box(W-M-w,H-56,w,22,C.amber);text(t,W-M-w/2,H-48.5,{size:9,font:bold,align:'center'});}

    // KPI tiles
    const p=model.params,target=pct(p.target,1),kpis=[
      ['Asking price',money(p.price),`${p.sites} site${p.sites===1?'':'s'}`],
      ['IRR at asking price',pct(model.irr,2),'Without capitalized lease (B34)'],
      ['IRR with lease',pct(model.leaseIrr,2),'With capitalized lease (B38)'],
      [`Price at ${target} IRR`,money(model.priceAtTarget),finite(model.priceAtTarget)?`${model.priceAtTarget>=p.price?'Above':'Below'} ask by ${money(Math.abs(model.priceAtTarget-p.price))}`:'Target not reachable'],
      ['NPV at 15%',money(model.npv15),'Funds flow, years 0-15']];
    const tileW=(W-2*M-4*8)/5;let ty=H-74-16-58;
    kpis.forEach(([l,v,s],i)=>{const x=M+i*(tileW+8),hl=i===3;box(x,ty,tileW,58,hl?hex('#FFF6D6'):C.soft,hl?C.amber:null);text(l.toUpperCase(),x+10,ty+44,{size:7,font:bold,color:C.muted,max:tileW-20});
      const neg=(i===4&&model.npv15<0)||((i===1||i===2)&&finite(i===1?model.irr:model.leaseIrr)&&(i===1?model.irr:model.leaseIrr)<p.target);
      text(v,x+10,ty+22,{size:17,font:bold,color:neg?C.red:C.ink,max:tileW-20});text(s,x+10,ty+9,{size:7,color:C.muted,max:tileW-20});});

    // Cash-flow chart
    const cx=M,cw=440,ch=200,cyTop=ty-22;heading('Net cash flow by year · without capitalized lease',cx,cyTop);
    const flows=model.flows,lo=Math.min(0,...flows),hi=Math.max(0,...flows),span=(hi-lo)||1;
    const raw=span/6,mag=10**Math.floor(Math.log10(raw)),step=[1,2,2.5,5,10].find(n=>n*mag>=raw)*mag,tmin=Math.floor(lo/step)*step,tmax=Math.ceil(hi/step)*step;
    const plotL=cx+46,plotR=cx+cw,plotB=cyTop-ch+4,plotT=cyTop-14,y=v=>plotB+(v-tmin)/(tmax-tmin||1)*(plotT-plotB);
    for(let v=tmin;v<=tmax+step/2;v+=step){page.drawLine({start:{x:plotL,y:y(v)},end:{x:plotR,y:y(v)},thickness:v===0?0.9:0.4,color:v===0?C.muted:C.line});text(short(v),plotL-4,y(v)-3,{size:6.5,color:C.muted,align:'right'});}
    const bw=(plotR-plotL)/flows.length;
    flows.forEach((v,i)=>{const x=plotL+i*bw+bw*.18,top=y(Math.max(v,0)),bottom=y(Math.min(v,0));box(x,bottom,bw*.64,Math.max(.8,top-bottom),v<0?C.red:C.blue);text(i===0?'Close':String(i),plotL+i*bw+bw/2,plotB-11,{size:6.5,color:C.muted,align:'center'});});
    const last=flows.length-1;text('Incl. exit '+short(model.exit),plotL+last*bw+bw/2,Math.min(plotT+2,y(flows[last])+4),{size:6.5,font:bold,color:C.blue,align:'right'});
    text('Year 0 is cash paid at close. Year 15 includes the exit at '+p.exitMultiple.toFixed(1)+'x year-15 EBITDAR and working capital returned.',cx,plotB-24,{size:6.5,color:C.muted});

    // Right column: cash at close and year-1 earnings
    const rx=M+cw+28,rw=W-M-rx;let ry=cyTop;heading('Cash at closing',rx,ry);ry-=14;
    const closeRows=[['Purchase price',model.close.price],['Working capital',model.close.workingCapital],['UNAMs',model.close.unams],['Closing costs',model.close.closing]];
    closeRows.forEach(([l,v])=>{text(l,rx,ry,{size:8});text(money(v),rx+rw,ry,{size:8,align:'right'});ry-=12;});
    page.drawLine({start:{x:rx,y:ry+8},end:{x:rx+rw,y:ry+8},thickness:.6,color:C.ink});text('Total cash at close',rx,ry-1,{size:8,font:bold});text(money(model.close.total),rx+rw,ry-1,{size:8,font:bold,align:'right'});
    ry-=24;heading('Year-1 earnings build',rx,ry);ry-=6;
    const y1=model.year1,parts=[['Fuel margin',y1.fuel],['Fuel synergy',y1.fuelSynergy],['Inside margin',y1.inside],['Inside synergy',y1.insideSynergy],['Other income',y1.other],['Operating expenses',y1.opex],['Expense synergy',y1.opexSynergy],['Operator draw',y1.draw],['Field support',y1.field],['Rent',y1.rent]].filter(([,v])=>finite(v)&&Math.abs(v)>=.5);
    const maxAbs=Math.max(1,...parts.map(([,v])=>Math.abs(v))),labelW=82,valW=56,barMax=rw-labelW-valW-6;
    parts.forEach(([l,v])=>{ry-=11.5;text(l,rx,ry,{size:7.5,max:labelW-4});box(rx+labelW,ry-1,Math.max(.8,Math.abs(v)/maxAbs*barMax),7.5,v<0?C.red:C.green);text(money(v),rx+rw,ry,{size:7.5,align:'right'});});
    ry-=14;page.drawLine({start:{x:rx,y:ry+9},end:{x:rx+rw,y:ry+9},thickness:.6,color:C.ink});text('Year-1 EBITDA',rx,ry,{size:8,font:bold});text(money(y1.ebitda),rx+rw,ry,{size:8,font:bold,align:'right'});
    ry-=11;text('Year-1 EBITDAR',rx,ry,{size:7.5,color:C.muted});text(money(y1.ebitdar),rx+rw,ry,{size:7.5,color:C.muted,align:'right'});
    ry-=11;text('Multiple on seller EBITDA / our EBITDAR',rx,ry,{size:7.5,color:C.muted,max:rw-60});text(`${finite(model.sellerMultiple)?model.sellerMultiple.toFixed(1)+'x':'n/a'} / ${finite(model.ourMultiple)?model.ourMultiple.toFixed(1)+'x':'n/a'}`,rx+rw,ry,{size:7.5,color:C.muted,align:'right'});

    // Bottom: assumptions and deal notes
    let by=Math.min(plotB-42,ry-20);heading('Key assumptions',M,by);
    const assumptions=[['Gallons, year 1',Math.round(p.gallons).toLocaleString('en-US')],['Volume change / yr',pct(p.volumeRate-1,1)],['Fuel margin',p.cpg.toFixed(1)+'¢/gal'],['Fuel synergy',p.fuelSynergyCpg.toFixed(1)+'¢/gal'],['Inside sales',money(p.inside)],['Inside margin',pct(p.insideMargin,1)],['Opex synergy',pct(p.opexSynergy,1)],['Rent, year 1',money(-p.rent)],['Tax rate',pct(p.taxRate,0)],['Exit multiple',p.exitMultiple.toFixed(1)+'x EBITDAR'],['Closing costs',pct(p.closingRate,1)+' of price'],['Target IRR',target]];
    const colW=(W-2*M)/4;assumptions.forEach(([l,v],i)=>{const x=M+(i%4)*colW,yy=by-13-Math.floor(i/4)*11;text(l,x,yy,{size:7.5,color:C.muted});text(v,x+colW-12,yy,{size:7.5,font:bold,align:'right'});});
    by-=13+Math.ceil(assumptions.length/4)*11+6;
    if(meta.table){heading(meta.table.title,M,by);by-=12;const cols=meta.table.head.length,tw=(W-2*M)/cols;meta.table.head.forEach((h,i)=>text(h,i?M+tw*(i+1)-8:M,by,{size:7,font:bold,color:C.muted,align:i?'right':'left'}));by-=10;meta.table.rows.forEach(r=>{r.forEach((c,i)=>text(c,i?M+tw*(i+1)-8:M,by,{size:7.5,font:i?reg:bold,align:i?'right':'left'}));by-=10;});by-=4;}
    for(const [l,v] of meta.notes||[]){if(!v||by<44)continue;const lines=wrap(v,W-2*M-90,7.5).slice(0,2);text(l,M,by,{size:7.5,font:bold,max:86});lines.forEach((t,i)=>text(t,M+90,by-i*9.5,{size:7.5}));by-=lines.length*9.5+3;}

    // Footer
    page.drawLine({start:{x:M,y:30},end:{x:W-M,y:30},thickness:.4,color:C.line});
    text(meta.footer||'Simple COOP model, 15-year funds flow. Returns use the inputs shown; review estimates before relying on them. Not an approved offer.',M,19,{size:6.5,color:C.muted,max:W-2*M-90});
    text('Deal Lens',W-M,19,{size:6.5,font:bold,color:C.muted,align:'right'});
    return new Blob([await doc.save()],{type:'application/pdf'});
  }

  function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),10000);}
  const fileName=(name,suffix)=>(String(name||'deal').replace(/[^a-z0-9-]+/gi,'-').replace(/^-+|-+$/g,'')||'deal')+suffix;

  globalThis.CoopSimple={layout,calculate,workbook,workbookFiles,pdf,download,fileName,money,pct};
})();
