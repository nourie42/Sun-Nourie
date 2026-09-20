import {unzipSync, strFromU8} from 'fflate';
import {sitesFromRows,consolidateWorkbookSites} from './sites';
import type {SourceFile} from './types';

const MAX_FILE=20*1024*1024;
const MAX_TEXT=650000;
const decode=(b:ArrayBuffer)=>new TextDecoder('utf-8',{fatal:false}).decode(b);
function b64(buffer:ArrayBuffer){let text='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
function xml(text:string){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Document XML is damaged.');return doc;}
function unzip(buffer:ArrayBuffer){let total=0,count=0;return unzipSync(new Uint8Array(buffer),{filter:entry=>{if(++count>5000||(total+=entry.originalSize)>64*1024*1024)throw Error('Document expands beyond 64 MB. Split it into smaller files.');return true;}});}
function finish(source:SourceFile){if(source.text.length>MAX_TEXT)throw Error('File contains more than 650,000 text characters. Split the file; no content was silently discarded.');return source;}

export async function readSourceFile(file:File):Promise<SourceFile>{
 if(file.size>MAX_FILE)throw Error('20 MB per file maximum. Split large packets before uploading.');
 const buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer),ext=file.name.split('.').pop()?.toLowerCase()||'';
 const source:SourceFile={id:crypto.randomUUID(),name:file.name,kind:'text',text:'',warnings:[]};
 const head=new TextDecoder().decode(bytes.slice(0,8));
 if(head.startsWith('%PDF-')||ext==='pdf'){
  if(!head.startsWith('%PDF-'))throw Error('This file is not a valid PDF.');
  source.kind='pdf';source.mediaType='application/pdf';source.data=b64(buffer);
  const pdfjs=await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const pdf=await pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true}).promise;
  try{
   source.pages=pdf.numPages;
   if(pdf.numPages>100)throw Error('PDFs support up to 100 pages per file. Split this PDF so every page can be checked.');
   let scans=0;
   for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n);const content=await page.getTextContent();
    let text='';for(const item of content.items as any[]){if('str' in item)text+=item.str+(item.hasEOL?'\n':' ');}
    if(text.trim().length<40)scans++;
    source.text+=`\nPAGE ${n}\n${text}\n`;
   }
   if(scans)source.warnings.push(`${scans} page(s) have little embedded text. Visual extraction requires confirmation against the PDF.`);
  }finally{await pdf.destroy();}
  return finish(source);
 }
 const imageTypes:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
 if(imageTypes[ext]){
  if(file.size>5*1024*1024)throw Error('Images must be 5 MB or smaller.');
  return {...source,kind:'image',mediaType:imageTypes[ext],data:b64(buffer),warnings:['Image-derived numbers require visual confirmation.']};
 }
 if(ext==='doc'||ext==='rtf')return {...source,kind:ext,mediaType:ext==='doc'?'application/msword':'application/rtf',data:b64(buffer)};
 if(['xlsx','xls','xlsb','xlsm','ods','csv','tsv'].includes(ext)){
  if(bytes[0]===0x50&&bytes[1]===0x4b)unzip(buffer);
  const XLSX=await import('xlsx');
  const wb=XLSX.read(ext==='csv'||ext==='tsv'?decode(buffer):buffer,{type:ext==='csv'||ext==='tsv'?'string':'array',cellFormula:true,cellText:true,cellDates:false,raw:ext==='csv'||ext==='tsv'});
  source.sites=[];source.workbook=[];
  let count=0;
  for(const name of wb.SheetNames){
   const sheet=wb.Sheets[name];if(!sheet['!ref'])continue;
   const range=XLSX.utils.decode_range(sheet['!ref']);
   if((range.e.r-range.s.r+1)*(range.e.c-range.s.c+1)>250000)throw Error('Sheet is too large. Upload the relevant populated range as a separate file.');
   const rows:any[][]=[];const cells:Record<string,any>={};
   source.text+=`\nSHEET ${name}\n`;
   for(let r=0;r<=range.e.r;r++){
    const row:any[]=[],parts:string[]=[];
    for(let c=0;c<=range.e.c;c++){
     const addr=XLSX.utils.encode_cell({r,c}),cell=sheet[addr];row.push(cell?.v??null);
     if(cell&&(cell.v!==undefined||cell.f)){
      if(++count>50000)throw Error('More than 50,000 populated cells. Split the workbook; no rows were omitted.');
      const value=cell.v??null;cells[addr]={value,formula:cell.f};
      parts.push(`${addr}: ${String(value??'')}${cell.w&&String(cell.w)!==String(value)?` (display ${cell.w})`:''}${cell.f?` [cached formula: ${cell.f}]`:''}`);
     }
    }
    rows.push(row);if(parts.length)source.text+=parts.join(' | ')+'\n';
   }
   source.sites.push(...sitesFromRows(rows,source.id,name));source.workbook.push({name,cells});
  }
  source.sites=consolidateWorkbookSites(source.sites);
  if(source.workbook.some(s=>Object.values(s.cells).some(c=>c.formula)))source.warnings.push('Workbook formula values are cached; source formulas have not been recalculated.');
  return finish(source);
 }
 if(['docx','pptx','odt'].includes(ext)){
  const z=unzip(buffer);
  if(ext==='docx'){
   const document=z['word/document.xml'];if(!document)throw Error('Word document is damaged or encrypted.');
   const body=xml(strFromU8(document)).getElementsByTagNameNS('*','body')[0];let p=0,t=0;
   for(const node of Array.from(body?.children||[])){
    if(node.localName==='p')source.text+=`Paragraph ${++p}: ${Array.from(node.getElementsByTagNameNS('*','t')).map(n=>n.textContent).join('')}\n`;
    if(node.localName==='tbl'){
     ++t;const rows=Array.from(node.getElementsByTagNameNS('*','tr')).map(row=>Array.from(row.getElementsByTagNameNS('*','tc')).map(cell=>Array.from(cell.getElementsByTagNameNS('*','t')).map(n=>n.textContent).join(' ')));
     rows.forEach((row,i)=>{source.text+=`Table ${t}, row ${i+1}: `+row.join(' | ')+'\n';});source.sites=[...(source.sites||[]),...sitesFromRows(rows,source.id,`Table ${t}`)];
    }
   }
   const media=Object.keys(z).filter(k=>k.startsWith('word/media/'));
   for(const path of Object.keys(z).filter(k=>/^word\/(header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(k)))source.text+=`\n${path}\n`+Array.from(xml(strFromU8(z[path])).getElementsByTagNameNS('*','t')).map(n=>n.textContent).join(' ')+'\n';
   if(media.length){source.children=[];for(const path of media){const ext=path.split('.').pop()!.toLowerCase();if(imageTypes[ext]&&z[path].byteLength<=5*1024*1024)source.children.push({id:crypto.randomUUID(),name:`${file.name} / ${path}`,kind:'image',mediaType:imageTypes[ext],data:b64(z[path].buffer.slice(z[path].byteOffset,z[path].byteOffset+z[path].byteLength) as ArrayBuffer),text:'',warnings:['Embedded-image extraction requires confirmation.']});else source.warnings.push(`${path} cannot be read visually; include a PDF copy.`);}source.warnings.push(`${source.children.length} embedded image(s) will also be analyzed. Image-derived values require confirmation.`);}
  }else if(ext==='pptx'){
   for(const path of Object.keys(z).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a,b)=>Number(a.match(/slide(\d+)\.xml/)![1])-Number(b.match(/slide(\d+)\.xml/)![1]))){
    source.text+=`\nSLIDE ${path.match(/slide(\d+)\.xml/)![1]}\n`+Array.from(xml(strFromU8(z[path])).getElementsByTagNameNS('*','t')).map(n=>n.textContent).join('\n');
   }
   source.warnings.push('Embedded slide charts/images require a PDF copy or image upload for visual extraction.');
  }else{
   if(!z['content.xml'])throw Error('Invalid OpenDocument file.');
   source.text=Array.from(xml(strFromU8(z['content.xml'])).getElementsByTagNameNS('*','p')).map((p,i)=>`Paragraph ${i+1}: ${p.textContent}`).join('\n');
  }
  if(!source.text.trim())throw Error('No readable text. Upload a PDF or images of the document.');
  return finish(source);
 }
 if(['txt','md','json','html','htm','xml','eml','log'].includes(ext)||file.type.startsWith('text/')){
  source.text=decode(buffer);
  if(ext==='html'||ext==='htm'){const doc=new DOMParser().parseFromString(source.text,'text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());source.text=doc.body.textContent||'';}
  return finish(source);
 }
 throw Error('This format cannot be read safely. Upload a PDF, Word, Excel, CSV, PowerPoint, OpenDocument, image, or text version.');
}
export async function readDealFile(file:File){return (await readSourceFile(file)).text;}
export function requestSources(files:SourceFile[]){return files.flatMap(({workbook,sites,children,...source})=>[{...source,structuredSiteCount:sites?.length||0},...(children||[])]);}
