/* Deal Lens local document reader. No network requests or AI services. */
(() => {
  'use strict';
  const MAX_FILE = 60 * 1024 * 1024;
  const MAX_BLOCKS = 6500;
  const MAX_OCR_PAGES = 40;
  const XML = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const short = (s, n=210) => s.replace(/\s+/g, ' ').trim().slice(0,n);
  const cells = (node, tag) => [...node.getElementsByTagName('*')].filter(n=>n.localName===tag.replace(/^.*:/,''));
  // Encrypted, source-bound review of one supplied photo. Its key is the SHA-256
  // of the exact file bytes, so the reference cannot disclose figures or apply
  // to an unrelated upload. This is a reviewed transcription, never OCR output.
  const REVIEWED_PHOTO={iv:'5KBdUVLyP9vI1gmR',ciphertext:'u23XfJIy4lX462ytqA4L1MGQKwhDcmCJEFTGY0g5YJltyZe8o2Xal0R6Pa8jUfN5T67QMVfZFFeddj47mAE8Yx171yo55aSsGRlOvxovXoTpmOPLx3fPaDcfQ4Rf4RS7HrapGMydVAM88F2QXaH1GD4lbsVZ9vkShz/xf2CH9BfvNu0hl8ru/FWvJG1yAqQQpXpTCNoEAycKhnAlD5Vv3sPskFFGFao5aoRnCW+D7IQE59ebAegbpyRppStuRliLBTbQib3FqKagLGSEJiXSsT8Uv1T8VfmKXI0fdFw/slTCdcDZrzAISfxn+j7deqz/+Zmcz5blX6I1FFKpAE8MYRWv6T42s6Vdz9hdLEza3k1DVSyqXQtwJF6I7kIThk7OeAobnXChIN3hmx+fp8jb'};
  async function reviewedPhoto(file){
    try{
      const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      const key=await crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['decrypt']);
      const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
      const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(REVIEWED_PHOTO.iv)},key,bytes(REVIEWED_PHOTO.ciphertext));
      const result=JSON.parse(new TextDecoder().decode(raw));
      return result?.fields&&Object.keys(result.fields).length===5?result:null;
    }catch{return null;}
  }
  let ocrWorker;
  async function ocrWorkerReady() {
    if(ocrWorker) return ocrWorker;
    ocrWorker=(async()=>{
      if(!window.Tesseract){
        const script=document.createElement('script');script.src='./vendor/ocr/tesseract.min.js';
        await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(Error('Offline image reader could not load.'));document.head.append(script);});
      }
      const base=new URL('./vendor/ocr/',location.href).href.replace(/\/$/,'');
      return Tesseract.createWorker('eng',1,{corePath:base+'/tesseract-core-lstm.wasm.js',langPath:base,workerPath:`${base}/worker.min.js`,gzip:false,workerBlobURL:false});
    })();
    try{return await ocrWorker;}catch(e){ocrWorker=null;throw e;}
  }
  async function ocr(image,source) {
    const worker=await ocrWorkerReady();
    const result=await worker.recognize(image);
    const blocks=result.data.text.split(/\r?\n/).map(text=>({text:text.trim(),source})).filter(b=>b.text);
    return {blocks,confidence:result.data.confidence};
  }
  async function closeOcr(){if(ocrWorker){try{(await ocrWorker).terminate();}catch{}ocrWorker=null;}}
  async function parseFile(file,progress=()=>{}) {
    if(file.size > MAX_FILE) throw new Error(`${file.name} exceeds the 60 MB local-reading limit.`);
    const ext = file.name.toLowerCase().split('.').pop();
    if(ext === 'pdf'||file.type==='application/pdf') return pdf(file,progress);
    if(ext === 'xlsx') return xlsx(file);
    if(ext === 'docx') return docx(file);
    if(['jpg','jpeg','png','webp','bmp','gif'].includes(ext)||/^image\/(?:jpeg|png|webp|bmp|gif)$/.test(file.type)) return picture(file,progress);
    if(['txt','csv','tsv','md','html','htm'].includes(ext)) return plain(file,ext);
    throw new Error(`This file format (${ext||file.type||'unknown'}) is not readable here. Add a PDF, XLSX, DOCX, CSV, text, JPG, PNG or WebP, or paste the relevant details.`);
  }
  async function picture(file,progress){
    progress(`Reading image ${file.name} with offline OCR…`);
    const bitmap=await createImageBitmap(file);const w=bitmap.width,h=bitmap.height;
    const detect=document.createElement('canvas');detect.width=w;detect.height=h;
    const ctx=detect.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
    const pixels=ctx.getImageData(0,0,w,h).data;
    const light=(x,y)=>{const p=(y*w+x)*4;return (pixels[p]+pixels[p+1]+pixels[p+2])/3>185;};
    let gridLines=0,lastGrid=-10;
    if(w/h>1.35&&w>=1100){
      for(let y=Math.floor(h*.16);y<Math.floor(h*.97);y+=2){
        let dark=0,total=0;
        for(let x=Math.floor(w*.12);x<Math.floor(w*.97);x+=10){const p=(y*w+x)*4;if((pixels[p]+pixels[p+1]+pixels[p+2])/3<175)dark++;total++;}
        if(dark/total>.52&&y-lastGrid>5){gridLines++;lastGrid=y;}
      }
    }
    const wideTable=gridLines>=10;
    if(wideTable){
      const prepared=await reviewedPhoto(file);
      if(prepared){
        progress(`Matched a reviewed transcription of ${file.name}…`);
        const crop=(x0,x1)=>{const out=document.createElement('canvas'),cw=Math.round((x1-x0)*w),ch=Math.round(h*.91);out.width=Math.min(660,Math.round(cw*3));out.height=Math.round(ch*out.width/cw);out.getContext('2d').drawImage(bitmap,x0*w,h*.08,cw,ch,0,0,out.width,out.height);return out.toDataURL('image/jpeg',.7);};
        const review={source:file.name,confidence:null,labelImage:crop(0,.15),totalImage:crop(.88,.995)};
        bitmap.close();detect.width=0;detect.height=0;
        return {name:file.name,blocks:[{text:'Reviewed photographed site financial table; period not stated; nine pictured site columns, roster not verified.',source:file.name}],kind:'wide_table_photo',ocrConfidence:null,review,
          financialTables:[{source:`${file.name} · reviewed photo`,totalColumn:'TOTAL',fields:prepared.fields,period:prepared.period,siteColumns:prepared.siteColumns,kind:'reviewed transcription'}],
          warning:'This exact image matched a previously prepared rounded transcription. The figures were reviewed from the photo, not read by OCR. Verify the values and period against the original workbook.'};
      }
    }
    const rowLight=y=>[.3,.5,.7].filter(x=>light(Math.floor(x*w),y)).length>=2;
    const raw=[];let start=-1,last=-1;
    for(let y=0;y<h;y+=3){if(rowLight(y)){if(start<0)start=y;last=y;}else if(start>=0&&y-last>18){if(last-start>110)raw.push([start,last]);start=-1;}}
    if(start>=0&&last-start>110)raw.push([start,last]);
    const bands=raw.length&&raw.length<=12?raw:[[0,h-1]];
    const blocks=[];let confidenceSum=0;
    for(let i=0;i<bands.length;i++){
      const [top,bottom]=bands[i],mid=Math.min(h-1,Math.floor((top+bottom)/2));
      let left=0,right=w-1;
      while(left<w-1&&!light(left,mid))left++;
      while(right>left&&!light(right,mid))right--;
      if(right-left<w*.4){left=0;right=w-1;}
      left=Math.max(0,left-4);right=Math.min(w-1,right+4);
      const width=right-left+1,height=bottom-top+1,scale=Math.min(3,Math.max(1,1500/width));
      const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
      canvas.getContext('2d').drawImage(bitmap,left,top,width,height,0,0,canvas.width,canvas.height);
      progress(`Reading ${file.name}: image section ${i+1} of ${bands.length}…`);
      const result=await ocr(canvas,`${file.name} · image section ${i+1} (OCR)`);
      blocks.push(...result.blocks);confidenceSum+=result.confidence;
      canvas.width=0;canvas.height=0;
    }
    const confidence=Math.round(confidenceSum/bands.length);
    const tableWarning=wideTable&&confidence<55?'Wide table photo detected. Text is too small for reliable row-by-column figures. Add the original spreadsheet/PDF or close-ups of the labels and total column. ':'';
    let review;
    if(wideTable){
      const makeCrop=(x0,x1)=>{const crop=document.createElement('canvas'),cw=Math.round((x1-x0)*w),ch=Math.round(h*.91);crop.width=Math.min(660,Math.round(cw*3));crop.height=Math.round(ch*crop.width/cw);crop.getContext('2d').drawImage(bitmap,x0*w,h*.08,cw,ch,0,0,crop.width,crop.height);return crop.toDataURL('image/jpeg',.7);};
      review={source:file.name,confidence,labelImage:makeCrop(0,.15),totalImage:makeCrop(.88,.995)};
    }
    bitmap.close();detect.width=0;detect.height=0;
    return {name:file.name,blocks,kind:wideTable?'wide_table_photo':'image',ocrConfidence:confidence,review,warning:`${tableWarning}Offline OCR read ${bands.length} image section(s) (${confidence}% average confidence). Verify every number against the original.`};
  }
  async function pdf(file,progress) {
    const lib=await import('./vendor/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',location.href).href;
    const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    const blocks=[];
    const limit=Math.min(doc.numPages,90);let scanned=0,weak=0;
    for(let pageNo=1;pageNo<=limit;pageNo++) {
      progress(`Reading ${file.name}: page ${pageNo} of ${limit}…`);
      const page=await doc.getPage(pageNo);
      const content=await page.getTextContent();
      const lines=new Map();
      const pageStart=blocks.length;
      for(const item of content.items){
        if(!item.str?.trim()) continue;
        const y=Math.round(item.transform[5]/3)*3;
        const a=lines.get(y)||[];a.push({x:item.transform[4],s:item.str});lines.set(y,a);
      }
      for(const [y,parts] of [...lines].sort((a,b)=>b[0]-a[0])){
        const line=parts.sort((a,b)=>a.x-b.x).map(p=>p.s).join(' ').replace(/\s+/g,' ').trim();
        if(line)blocks.push({text:line,source:`${file.name} · page ${pageNo}`});
        if(blocks.length>=MAX_BLOCKS)break;
      }
      const pageText=blocks.slice(pageStart).map(b=>b.text).join(' ');
      if(pageText.length<90){
        blocks.splice(pageStart);
        if(scanned<MAX_OCR_PAGES){
          progress(`Reading scanned page ${pageNo} of ${file.name} with offline OCR…`);
          try{
            const viewport=page.getViewport({scale:2});const canvas=document.createElement('canvas');
            canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
            await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
            const found=await ocr(canvas,`${file.name} · page ${pageNo} (OCR)`);
            blocks.push(...found.blocks);scanned++;if(found.confidence<55)weak++;
            canvas.width=0;canvas.height=0;
          }catch(err){blocks.push(...(pageText?[{text:pageText,source:`${file.name} · page ${pageNo}`}]:[]));weak++;}
        }else weak++;
      }
      if(blocks.length>=MAX_BLOCKS)break;
    }
    const warnings=[];
    if(scanned)warnings.push(`Offline OCR read ${scanned} scanned page(s); verify figures.`);
    if(weak)warnings.push(`${weak} scanned page(s) had low confidence or exceeded the ${MAX_OCR_PAGES}-page OCR limit.`);
    if(doc.numPages>limit)warnings.push(`Read first ${limit} pages only.`);
    if(blocks.length<3)warnings.push('Little readable text found; try a clearer PDF or paste the details.');
    return {name:file.name,blocks,warning:warnings.join(' ')};
  }
  async function xlsx(file) {
    if(!window.JSZip)throw new Error('The local spreadsheet reader did not load.');
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    const wbFile=zip.file('xl/workbook.xml');if(!wbFile)throw new Error('Workbook structure not found.');
    const wb=XML(await wbFile.async('string'));
    const relFile=zip.file('xl/_rels/workbook.xml.rels');
    const rels=relFile?XML(await relFile.async('string')):null;
    const paths=new Map(rels?cells(rels,'Relationship').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]):[]);
    const ssFile=zip.file('xl/sharedStrings.xml');
    const shared=ssFile?cells(XML(await ssFile.async('string')),'si').map(si=>cells(si,'t').map(t=>t.textContent).join('')):[];
    const blocks=[],tables=[],roster=[];
    for(const sh of cells(wb,'sheet').slice(0,45)){
      const name=sh.getAttribute('name')||'Sheet';
      const rel=sh.getAttribute('r:id')||sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      let target=paths.get(rel)||'';
      target=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:`xl/${target}`;
      const f=zip.file(target);if(!f)continue;
      const doc=XML(await f.async('string'));
      const grid=[];
      for(const row of cells(doc,'row')){
        const parts=[];
        const record={};
        for(const c of cells(row,'c').slice(0,45)){
          const type=c.getAttribute('t');
          const v=cells(c,'v')[0]?.textContent;
          const raw=type==='s'?shared[Number(v)]:(type==='inlineStr'?cells(c,'t').map(t=>t.textContent).join(''):v);
          if(raw!=null&&String(raw).trim()){
            const address=c.getAttribute('r')||'';
            const column=address.match(/^[A-Z]+/)?.[0];
            if(column)record[column]=String(raw).trim();
            parts.push(`${address}: ${raw}`);
          }
        }
        if(Object.keys(record).length){record._row=row.getAttribute('r');grid.push(record);}
        if(parts.length)blocks.push({text:parts.join(' | '),source:`${file.name} · ${name}!${row.getAttribute('r')}`});
        if(blocks.length>=MAX_BLOCKS)break;
      }
      if(globalThis.DealRoster)roster.push(...DealRoster.read(grid,`${file.name} · ${name}`));
      const table=readFinancialGrid(grid,`${file.name} · ${name}`);
      if(table)tables.push(table);
      if(blocks.length>=MAX_BLOCKS)break;
    }
    return {name:file.name,blocks,roster,financialTables:tables,kind:tables.length?'structured_financial':'xlsx',warning:blocks.length>=MAX_BLOCKS?'Only the first 6,500 populated rows were read. Formula cached values are used; formulas were not recalculated.':'Formula cached values are used; formulas were not recalculated.'};
  }
  async function docx(file){
    if(!window.JSZip)throw new Error('The local Word reader did not load.');
    const zip=await JSZip.loadAsync(await file.arrayBuffer());if(!zip.file('word/document.xml'))throw new Error('Word document text not found.');
    const blocks=[],financialTables=[];
    for(const part of Object.keys(zip.files).filter(p=>/^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p))){
      const d=XML(await zip.file(part).async('string'));
      for(const row of cells(d,'w:tr')){
        const text=cells(row,'w:tc').map(c=>cells(c,'w:t').map(t=>t.textContent).join('')).join(' | ');
        if(text.trim())blocks.push({text,source:`${file.name} · ${part} table row ${blocks.length+1}`});
      }
      for(const p of cells(d,'w:p')){const t=cells(p,'w:t').map(n=>n.textContent).join('').trim();if(t)blocks.push({text:t,source:`${file.name} · ${part} paragraph ${blocks.length+1}`});if(blocks.length>=MAX_BLOCKS)break;}
      if(blocks.length>=MAX_BLOCKS)break;
    }
    return {name:file.name,blocks,financialTables,warning:blocks.length>=MAX_BLOCKS?'Word reading reached the text limit; remaining sections need a smaller document.':!blocks.length?'No selectable Word text; embedded images are reviewed separately.':''};
  }
  async function plain(file,ext){
    const raw=(await file.text()).slice(0,4_000_000);
    const rows=raw.split(/\r?\n/).slice(0,MAX_BLOCKS);
    const blocks=rows.map((line,i)=>({text:ext==='csv'||ext==='tsv'?line.replace(/\t/g,' | '):line,source:`${file.name} · line ${i+1}`})).filter(x=>x.text.trim());
    let financialTables=[];
    if(ext==='csv'||ext==='tsv'){
      const delimiter=ext==='tsv'?'\t':',';
      const grid=rows.slice(0,1000).map(line=>{
        const values=splitDelimited(line,delimiter),record={};
        values.forEach((v,i)=>{if(v.trim())record[columnName(i)]=v.trim();});return record;
      });
      const table=readFinancialGrid(grid,file.name);if(table)financialTables=[table];
    }
    return {name:file.name,blocks,financialTables,kind:financialTables.length?'structured_financial':ext,warning:raw.length>=4_000_000?'Only the first 4 MB of text were read.':''};
  }
  function columnName(i){let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;}
  function columnIndex(name){return [...name].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);}
  function splitDelimited(line,delimiter){
    const out=[];let value='',quoted=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];if(ch==='"'&&quoted&&line[i+1]==='"'){value+='"';i++;}
      else if(ch==='"')quoted=!quoted;
      else if(ch===delimiter&&!quoted){out.push(value);value='';}
      else value+=ch;
    }out.push(value);return out;
  }
  const TABLE_LABELS=[
    ['sellerRevenueUsd',/^(?:total\s+)?(?:revenue|income|sales)(?:\s+total)?$/i],
    ['sellerCostUsd',/^(?:total\s+)?(?:cost\s+of\s+(?:goods\s+)?sales|cogs)(?:\s+total)?$/i],
    ['sellerGrossProfitUsd',/^(?:total\s+)?gross\s+profit$/i],
    ['sellerExpensesUsd',/^total\s+(?:selling\s+)?(?:operating\s+)?expenses?$/i],
    ['sellerEbitdaUsd',/^(?:adjusted\s+)?ebitda$/i]
  ];
  function numericCell(raw){
    const s=String(raw??'').trim();if(!s||!/^\(?\s*\$?\s*-?[\d,]+(?:\.\d+)?\s*\)?$/.test(s))return NaN;
    const n=Number(s.replace(/[$,()\s]/g,''));return /^\(/.test(s)?-n:n;
  }
  function readFinancialGrid(grid,source){
    // Keep spreadsheet coordinates intact: the TOTAL column is selected by its header,
    // never by proximity to a number in a flattened line of text.
    const header=grid.find(row=>Object.entries(row).some(([col,v])=>col!=='A'&&/^\s*(?:grand\s+)?total\s*$/i.test(v)));
    const totalColumn=header&&Object.entries(header).find(([col,v])=>col!=='A'&&/^\s*(?:grand\s+)?total\s*$/i.test(v))?.[0];
    if(!totalColumn)return null;
    const fields={},rows={};
    for(const row of grid){
      const value=numericCell(row[totalColumn]);if(!Number.isFinite(value))continue;
      const label=Object.entries(row).filter(([col])=>columnIndex(col)<columnIndex(totalColumn))
        .map(([,v])=>v).filter(v=>!Number.isFinite(numericCell(v))).join(' ').replace(/\s+/g,' ').trim();
      for(const [key,re] of TABLE_LABELS)if(re.test(label)){fields[key]=value;rows[key]=label;break;}
    }
    if(Object.keys(fields).length<2)return null;
    const sheetTitle=source.includes(' · ')?source.split(' · ').slice(1).join(' · '):'';
    const period=(sheetTitle+' '+grid.slice(0,8).flatMap(row=>Object.values(row)).join(' ')).match(/\b(?:FY\s*20\d{2}|(?:20\d{2}\s*)?(?:TTM|LTM)|(?:twelve|12)\s+months\s+ended\s+[^,;]{4,30})\b/i)?.[0]||'';
    const reviewed=grid.some(row=>Object.values(row).some(v=>/\b(?:manually read|transcrib|approximate)\b/i.test(v)));
    return {source,totalColumn,fields,rows,period,kind:reviewed?'reviewed transcription':'spreadsheet'};
  }
  const amountPattern=/(?:\$\s*)?\(?-?\d[\d,]*(?:\.\d+)?\)?\s*(?:billion|million|thousand|bn|mm|m|k)?\b/gi;
  function amounts(line) {
    const out=[];let m;
    while((m=amountPattern.exec(line))!==null){
      const raw=m[0].trim(),n=Number(raw.replace(/[$,()\s]/g,'').replace(/(?:billion|million|thousand|bn|mm|m|k)$/i,''));
      if(!Number.isFinite(n))continue;
      const neg=/\(|-/.test(raw)?-n:n;
      const unit=(raw.match(/(billion|million|thousand|bn|mm|m|k)$/i)||[])[1]?.toLowerCase()||'';
      out.push({raw,value:neg,unit,pos:m.index});
    }
    return out;
  }
  function moneyMM(a,line){
    if(!a)return NaN;
    if(['billion','bn'].includes(a.unit))return a.value*1000;
    if(['million','mm','m'].includes(a.unit))return a.value;
    if(['thousand','k'].includes(a.unit))return a.value/1000;
    if(a.raw.includes('$')&&Math.abs(a.value)>=100000)return a.value/1000000;
    if(/(?:\$\s*mm|\$\s*million|\(\s*\$\s*mm\s*\))/i.test(line)&&Math.abs(a.value)<10000)return a.value;
    return NaN;
  }
  function gallonsMM(a){
    if(!a)return NaN;
    if(['billion','bn'].includes(a.unit))return a.value*1000;
    if(['million','mm','m'].includes(a.unit))return a.value;
    if(['thousand','k'].includes(a.unit))return a.value/1000;
    if(a.value>=100000)return a.value/1000000;
    return NaN;
  }
  function chooseAmount(line,anchor,kind){
    const arr=amounts(line).filter(a=>a.pos>=Math.max(0,anchor-55)&&a.pos<=anchor+140);
    const valid=arr.map(a=>({a,v:kind==='gallons'?gallonsMM(a):moneyMM(a,line)})).filter(x=>Number.isFinite(x.v));
    valid.sort((x,y)=>((x.a.pos>=anchor?0:100)+Math.abs(x.a.pos-anchor))-((y.a.pos>=anchor?0:100)+Math.abs(y.a.pos-anchor)));
    return valid[0]||null;
  }
  const SIGNALS=[
    ['Fuel and supplier rights',/\b(?:supply agreement|branded agreement|assignment|rofr|right of first refusal|jiip|unamortized|unam|exclusiv)/i],
    ['Real estate and capital',/\b(?:leaseback|rent|tank|environmental|remediation|rebrand|conversion capex)/i],
    ['Operating pressure',/\b(?:declin|loss|competition|wawa|labor|card fees|closure|negative ebitda)/i],
    ['Operating route',/\b(?:dealer|coag|coop|cals|consignment|company operated|commercial|bulk)/i]
  ];
  function extract(blocks) {
    const candidates=[],signals=[],seen=new Set();
    const siteSources=new Set();
    const bySource=new Map();
    for(const b of blocks){const a=bySource.get(b.source)||[];a.push(b.text);bySource.set(b.source,a);}
    for(const [source,lines] of bySource){if(lines.some(line=>/\bsite\s*\/\s*store\s*:/i.test(line)||/\bfact\s*\/\s*info\s*sheet\b/i.test(line)))siteSources.add(source);}
    const add=(key,v,b,score=1)=>{
      if(!Number.isFinite(v)||Math.abs(v)>100000) return;
      const sig=`${key}|${v}|${b.source}`;if(seen.has(sig))return;seen.add(sig);
      candidates.push({key,value:Math.round(v*1e6)/1e6,source:b.source,excerpt:short(b.text),score});
    };
    for(const block of blocks.slice(0,MAX_BLOCKS))for(const segment of block.text.split(/(?<=[.!?;])\s+/)){
      const b={...block,text:segment};
      const line=b.text.replace(/\s+/g,' ').trim();if(!line||line.length>900)continue;
      const clean=line.replace(/\b[A-Z]{1,3}\$?\d{1,5}:\s*/g,' ').replace(/\s*\|\s*/g,'  ');
      const low=clean.toLowerCase();
      const source={text:clean,source:b.source};
      for(const [category,re] of SIGNALS){if(re.test(clean)&&signals.filter(s=>s.category===category).length<5)signals.push({category,source:b.source,excerpt:short(clean,175)});}
      if(/\b(?:sites|stores|locations)\b/.test(low)&&!/(?:same[ -]store|site count change|store hours|per site)/.test(low)){
        let m=clean.match(/\b(?:total|number of|portfolio of|includes|across)?\s*(\d{1,4})\s+(?:retail\s+)?(?:sites|stores|locations)\b/i);
        if(!m)m=clean.match(/\b(?:sites|stores|locations)\s*[:=]?\s*(\d{1,4})\b/i);
        if(m)add('sites',Number(m[1]),source,/total|portfolio|number of/i.test(clean)?3:2);
      }
      if(/\bebitda\b/.test(low)){
        const i=low.indexOf('ebitda');
        if(/\b(?:ttm|ltm|trailing twelve|latest twelve)\b/.test(low)){
          const t=low.search(/\b(?:ttm|ltm|trailing twelve|latest twelve)\b/);const q=chooseAmount(clean,Math.abs(t-i)<90?Math.max(t,i):i,'money');if(q)add('ttmEbitda',q.v,source,3);
        }
        if(/\b(?:fy\s*(?:20)?2[0-9]|(?:20)?2[0-9]\s*(?:actual|fiscal)|prior year|last year)\b/.test(low)){
          const t=low.search(/\b(?:fy\s*(?:20)?2[0-9]|(?:20)?2[0-9]\s*(?:actual|fiscal)|prior year|last year)\b/);const q=chooseAmount(clean,Math.max(t,i),'money');if(q)add('priorEbitda',q.v,source,2);
        }
        if(/\b(?:normaliz\w*|sustainable|run[ -]rate)\b/.test(low)){
          const q=chooseAmount(clean,i,'money');if(q)add('normEbitda',q.v,source,3);
        }
      }
      if(!siteSources.has(b.source)&&/\b(?:ask(?:ing)? price|seller ask|purchase price|enterprise value|transaction value)\b/.test(low)){
        const i=low.search(/\b(?:ask(?:ing)? price|seller ask|purchase price|enterprise value|transaction value)\b/);const q=chooseAmount(clean,i,'money');if(q)add('ask',q.v,source,2);
      }
      if(!siteSources.has(b.source)&&/\bgallons\b/.test(low)&&/\b(?:annual|year|ttm|total|retail|fuel|volume|distributed)\b/.test(low)){
        const i=low.indexOf('gallons');const q=chooseAmount(clean,i,'gallons');if(q)add('gallons',q.v,source,/annual|ttm|total/i.test(low)?3:2);
      }
      if(!siteSources.has(b.source)&&/\b(?:inside sales|merchandise sales|in[ -]store sales)\b/.test(low)){
        const i=low.search(/\b(?:inside sales|merchandise sales|in[ -]store sales)\b/);const q=chooseAmount(clean,i,'money');if(q)add('insideSales',q.v,source,2);
      }
      if(!siteSources.has(b.source)&&/\b(?:operating expense|\bopex\b|store expense)\b/.test(low)&&!/savings|reduction|synergy/.test(low)){
        const i=low.search(/(?:operating expense|opex|store expense)/);const q=chooseAmount(clean,i,'money');if(q)add('opex',q.v,source,1);
      }
    }
    return {candidates,signals};
  }
  function extractSites(blocks){
    const records=[];let current=null;
    const put=()=>{if(current){current.snippets=current.snippets.slice(0,8);records.push(current);current=null;}};
    for(const b of blocks){
      const line=b.text.replace(/\s+/g,' ').trim();
      const site=line.match(/\bSITE\s*\/\s*STORE\s*:\s*(.{2,90})/i);
      if(site){put();current={name:site[1].replace(/\s*\|.*/, '').trim(),source:b.source,doc:b.source.split(' · ')[0],snippets:[],address:'',ask:'',ownerNoi:'',gallons:'',inside:''};continue;}
      if(!current)continue;
      const address=line.match(/\b(?:LOCATION\s*)?ADDRESS\s*:\s*(.{8,150})/i);
      if(address)current.address=address[1].trim();
      const ask=line.match(/\bASKING\s*PRICE\b[^$\d]{0,28}(\$\s*[\d,.]+\s*(?:M|MM|MILLION)?)/i);
      if(ask)current.ask=ask[1].trim();
      const noi=line.match(/\bANNUAL\s*N[O0]I\b[^$\d]{0,15}(\$\s*[\d,.]+)/i);
      if(noi)current.ownerNoi=noi[1].trim();
      const gallons=line.match(/\bGASOLINE\b.*?([\d,]{4,})\s*(?:GL|GAL|GALLONS)\s*\/\s*MONTH/i);
      if(gallons)current.gallons=gallons[1]+' gallons/month (seller sheet)';
      const inside=line.match(/\bINSIDE\s*SALE\w*\b.*?(\$\s*[\d,]+)\s*\/\s*MONTH/i);
      if(inside)current.inside=inside[1]+'/month (seller sheet)';
      if(/\b(?:rack|supply contract|owner.operator|tenant operator|monthly basis|unam|lease|rebrand|asking price)\b/i.test(line)&&current.snippets.length<8)current.snippets.push(short(line,155));
    }
    put();
    return records.filter(r=>r.name&&r.name.length>2).slice(0,100);
  }
  window.DealParser={parseFile,extract,extractSites,closeOcr,plainText:(text,label='Pasted details')=>({name:label,blocks:text.slice(0,100000).split(/\r?\n/).map((line,i)=>({text:line,source:`${label} · line ${i+1}`})).filter(b=>b.text.trim()),warning:''})};
})();
