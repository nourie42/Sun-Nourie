(() => {
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function patchCell(xml,address,value,input){
    const re=new RegExp('<c\\b(?=[^>]*\\br="'+address+'")([^>]*?)(?:/>|>[\\s\\S]*?</c>)');const old=xml.match(re)?.[0];if(!old)throw Error('Original model cell is missing: '+address);
    const opening=old.match(/^<c\b[^>]*>/)[0].replace(/\s*\/>$/,'>').replace(/\s+t="[^"]*"/,'');
    const formula=!input?(old.match(/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/)?.[0]||''):'';
    let body,type='';if(value==null)body='';else if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite model value at '+address);body='<v>'+value+'</v>';}else if(typeof value==='string'&&value.startsWith('#')){type=' t="e"';body='<v>'+escape(value)+'</v>';}else if(typeof value==='boolean'){type=' t="b"';body='<v>'+(value?1:0)+'</v>';}else {type=formula?' t="str"':' t="inlineStr"';body=formula?'<v>'+escape(value)+'</v>':'<is><t>'+escape(value)+'</t></is>';}
    return xml.replace(re,()=>opening.replace(/>$/,type+'>')+formula+body+'</c>');
  }

  const unxml=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  async function sharedStrings(zip){
    const file=zip.file('xl/sharedStrings.xml');if(!file)return [];
    const xml=await file.async('string');
    return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t=>unxml(t[1])).join(''));
  }
  function cellText(cell,strings){
    const type=cell.match(/\bt="([^"]*)"/)?.[1];
    if(type==='s'){const index=Number(cell.match(/<v>(\d+)<\/v>/)?.[1]);return strings[index]||'';}
    if(type==='inlineStr')return [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>unxml(x[1])).join('');
    if(type==='str')return unxml(cell.match(/<v>([\s\S]*?)<\/v>/)?.[1]||'');
    return '';
  }
  function parseRows(xml,strings){
    return [...xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].map(m=>{
      const cells=[...m[0].matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
      return {n:Number(m[1]),xml:m[0],cells:Object.fromEntries(cells.map(c=>[c[1],{value:cellText(c[0],strings),style:c[0].match(/\bs="(\d+)"/)?.[1]}]))};
    });
  }
  function headerColumns(row){
    const entries=Object.entries(row.cells).map(([col,c])=>[col,c.value.toLowerCase().replace(/\s+/g,' ').trim()]);
    const labels=entries.map(x=>x[1]).join(' ');
    return /(?:address|street)/.test(labels)&&/(?:asset|site|store|location)/.test(labels)?entries:null;
  }
  function rosterCell(label,site){
    if(/(?:asset|site|store)\s*(?:id|#|no\b|number)|^id$/.test(label))return site.id||'';
    if(/(?:asset|site|store|location)\s*name|^name$|^site$|^store$/.test(label))return site.name||'';
    if(/address|street|city|state|zip/.test(label))return /city|state|zip/.test(label)?'':site.address||'';
    if(/division|type/.test(label))return site.division||'';
    if(/brand|channel/.test(label))return site.channel||'';
    if(/control|tenure|owned|leased/.test(label))return site.tenure||'';
    if(/owner/.test(label))return site.owner||'';
    if(/source/.test(label))return site.source||'';
    if(/note/.test(label))return site.notes||'';
    return '';
  }
  function rosterXml(xml,rows,sites){
    const header=rows.find(row=>headerColumns(row));
    if(!header)throw Error('The master asset roster has no recognized asset/site and address headers. Export blocked instead of carrying an old project roster.');
    if(rows.some(row=>row.n>header.n&&/<f(?:\s|>)/.test(row.xml)))throw Error('The old roster has linked formulas in its data rows. A clean approved workbook is required before replacing it safely.');
    if(!sites.length)throw Error('No current-deal asset roster was supplied. Export blocked to prevent carrying Romeo/Tallahassee assets into another deal.');
    const cols=headerColumns(header);
    const after=rows.filter(x=>x.n<=header.n).map(x=>x.xml);
    for(let i=0;i<sites.length;i++){
      const n=header.n+i+1,site=sites[i];
      after.push('<row r="'+n+'">'+cols.map(([col,label])=>{
        const value=rosterCell(label,site),style=header.cells[col]?.style,attr=style?' s="'+style+'"':'';
        return '<c r="'+col+n+'"'+attr+' t="inlineStr"><is><t>'+escape(value)+'</t></is></c>';
      }).join('')+'</row>');
    }
    return xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,
      tag=>tag.replace(/^(<sheetData\b[^>]*>)[\s\S]*?(<\/sheetData>)$/,(_,open,close)=>open+after.join('')+close));
  }
  async function replaceCurrentRoster(zip,deal){
    const paths=Object.entries(OriginalModel.data.sheetPaths||{}),strings=await sharedStrings(zip);
    for(const [name,path] of paths){
      if(!/(?:roster|asset.*(?:list|schedule)|site.*(?:list|schedule))/i.test(name))continue;
      const file=zip.file(path);if(!file)throw Error('Missing original roster sheet: '+name);
      const xml=await file.async('string');
      const rows=parseRows(xml,strings);
      if(rows.some(row=>headerColumns(row))){
        zip.file(path,rosterXml(xml,rows,Array.isArray(deal.sites)?deal.sites.filter(x=>x&&x.name):[]));
      }
    }
    // Check *displayed workbook cells*, not orphaned shared-string entries.
    // Never silently hand the user a model referencing a different acquisition.
    for(const [name,path] of paths){
      const file=zip.file(path);if(!file)continue;
      const xml=await file.async('string');
      const printed=parseRows(xml,strings).flatMap(row=>Object.values(row.cells).map(c=>c.value));
      const stale=printed.find(v=>/\b(?:romeo(?:test)?|tallahassee)\b/i.test(v)&&!String(deal.fields?.name||'').toLowerCase().includes(v.toLowerCase()));
      if(stale)throw Error('Original workbook still contains prior-deal text on '+name+'. No contaminated workbook was exported. Use a clean approved template or replace all prior-deal source data.');
    }
  }
  async function make(d,bytes){
    const model=OriginalModel.calculate(d);if(!model.result)throw Error(model.errors[0]||'Read the deal materials before exporting. No empty model will be downloaded.');
    let template=bytes;
    if(!template){
      let response;try{response=await fetch('./original-model.xlsx');}catch{throw Error('The workbook download could not connect. Check your connection and try again.');}
      if(!response.ok)throw Error('The original workbook is unavailable. Reload the page and try the download again.');
      template=await response.arrayBuffer();
    }
    let zip;try{zip=await JSZip.loadAsync(template);}catch{throw Error('The workbook download was incomplete or invalid. Please try again.');}
    // The downloaded acquisition model must reflect the solved buyer offer,
    // not the seller's asking-price scenario shown in the intake preview.
    const price=model.result.returnCases?.B38?.maxPrice;
    if(!Number.isFinite(price))throw Error('Cannot solve an offer at 13.0% COOP!B38 using these inputs. Correct the assumptions before downloading; no unsolved workbook was created.');
    const engine=OriginalModel.compute({...model.changes,'COOP!B29':-price});
    const buyerIrr=engine.get('COOP','B38');
    if(!Number.isFinite(buyerIrr)||Math.abs(buyerIrr-.13)>1e-7)throw Error('Workbook verification failed: COOP!B38 is not 13.0%. No workbook was downloaded.');
    const values=engine.snapshot(),sheets=new Map();
    for(const [key,value] of Object.entries(values)){const p=key.lastIndexOf('!'),sheet=key.slice(0,p),cell=key.slice(p+1),input=Object.hasOwn(model.changes,key);if(input&&!OriginalModel.data.allowed[sheet]?.includes(cell))throw Error('Blocked non-yellow/orange edit: '+key);if(!sheets.has(sheet))sheets.set(sheet,await zip.file(OriginalModel.data.sheetPaths[sheet]).async('string'));sheets.set(sheet,patchCell(sheets.get(sheet),cell,value,input));}
    for(const [sheet,xml] of sheets)zip.file(OriginalModel.data.sheetPaths[sheet],xml);
    await replaceCurrentRoster(zip,d);
    // Input formulas may have been replaced by values. Excel must rebuild its calculation chain.
    if(zip.file('xl/calcChain.xml')){zip.remove('xl/calcChain.xml');for(const name of ['xl/_rels/workbook.xml.rels','[Content_Types].xml']){const text=await zip.file(name).async('string');zip.file(name,text.replace(/<(?:Relationship|Override)\b[^>]*(?:calcChain|calcchain)[^>]*\/>/g,''));}}
    let workbook=await zip.file('xl/workbook.xml').async('string');workbook=workbook.replace(/<calcPr\b[^>]*\/>/,tag=>tag.replace(/\s+(?:fullCalcOnLoad|forceFullCalc)="[^"]*"/g,'').replace('/>',' fullCalcOnLoad="1" forceFullCalc="1"/>'));zip.file('xl/workbook.xml',workbook);
    return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  globalThis.OriginalModelExport={make,patchCell};
})();
