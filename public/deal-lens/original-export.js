(() => {
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function patchCell(xml,address,value,input){
    const re=new RegExp('<c\\b(?=[^>]*\\br="'+address+'")([^>]*?)(?:/>|>[\\s\\S]*?</c>)');const old=xml.match(re)?.[0];if(!old)throw Error('Original model cell is missing: '+address);
    const opening=old.match(/^<c\b[^>]*>/)[0].replace(/\s*\/>$/,'>').replace(/\s+t="[^"]*"/,'');
    const formula=!input?(old.match(/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/)?.[0]||''):'';
    let body,type='';if(value==null)body='';else if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite model value at '+address);body='<v>'+value+'</v>';}else if(typeof value==='string'&&value.startsWith('#')){type=' t="e"';body='<v>'+escape(value)+'</v>';}else if(typeof value==='boolean'){type=' t="b"';body='<v>'+(value?1:0)+'</v>';}else {type=formula?' t="str"':' t="inlineStr"';body=formula?'<v>'+escape(value)+'</v>':'<is><t>'+escape(value)+'</t></is>';}
    return xml.replace(re,()=>opening.replace(/>$/,type+'>')+formula+body+'</c>');
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
    const values=model.result.engine.snapshot(),sheets=new Map();
    for(const [key,value] of Object.entries(values)){const p=key.lastIndexOf('!'),sheet=key.slice(0,p),cell=key.slice(p+1),input=Object.hasOwn(model.changes,key);if(input&&!OriginalModel.data.allowed[sheet]?.includes(cell))throw Error('Blocked non-yellow/orange edit: '+key);if(!sheets.has(sheet))sheets.set(sheet,await zip.file(OriginalModel.data.sheetPaths[sheet]).async('string'));sheets.set(sheet,patchCell(sheets.get(sheet),cell,value,input));}
    for(const [sheet,xml] of sheets)zip.file(OriginalModel.data.sheetPaths[sheet],xml);
    // Input formulas may have been replaced by values. Excel must rebuild its calculation chain.
    if(zip.file('xl/calcChain.xml')){zip.remove('xl/calcChain.xml');for(const name of ['xl/_rels/workbook.xml.rels','[Content_Types].xml']){const text=await zip.file(name).async('string');zip.file(name,text.replace(/<(?:Relationship|Override)\b[^>]*(?:calcChain|calcchain)[^>]*\/>/g,''));}}
    let workbook=await zip.file('xl/workbook.xml').async('string');workbook=workbook.replace(/<calcPr\b[^>]*\/>/,tag=>tag.replace(/\s+(?:fullCalcOnLoad|forceFullCalc)="[^"]*"/g,'').replace('/>',' fullCalcOnLoad="1" forceFullCalc="1"/>'));zip.file('xl/workbook.xml',workbook);
    return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  globalThis.OriginalModelExport={make,patchCell};
})();
