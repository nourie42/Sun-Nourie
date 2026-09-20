import JSZip from 'jszip';
import template from './model-template.json';
import {fields,calculate,validateImport} from './deal';
import type {Deal} from './deal';
import type {Review,Site} from './types';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const parse=(s:string)=>new DOMParser().parseFromString(s,'application/xml');
const serialize=(d:Document)=>new XMLSerializer().serializeToString(d);
const col=(n:number):string=>n>=26?col(Math.floor(n/26)-1)+String.fromCharCode(65+n%26):String.fromCharCode(65+n);
function cell(doc:Document,address:string){
 let c=doc.querySelector(`c[r="${address}"]`);if(c)return c;
 const rowNum=Number(address.match(/\d+/)![0]);let row=doc.querySelector(`row[r="${rowNum}"]`);
 if(!row){row=doc.createElementNS(ns,'row');row.setAttribute('r',String(rowNum));const data=doc.getElementsByTagNameNS('*','sheetData')[0];const next=Array.from(data.children).find(x=>Number(x.getAttribute('r'))>rowNum);data.insertBefore(row,next||null);}
 c=doc.createElementNS(ns,'c');c.setAttribute('r',address);
 const idx=(s:string)=>s.match(/[A-Z]+/)![0].split('').reduce((n,l)=>n*26+l.charCodeAt(0)-64,0);
 const next=Array.from(row.children).find(x=>idx(x.getAttribute('r')!)>idx(address));row.insertBefore(c,next||null);return c;
}
function put(doc:Document,address:string,value:any,formulaCache=false){
 if(typeof value==='string'&&value.length>32767)throw Error(`Cell ${address} exceeds Excel's 32,767-character limit. Shorten that source attribute before exporting.`);
 const c=cell(doc,address);const formula=c.querySelector('f');
 if(formula&&!formulaCache)throw Error(`Refusing to overwrite formula ${address}.`);
 for(const child of Array.from(c.children))if(child.localName!=='f')c.removeChild(child);
 c.removeAttribute('t');if(value===null||value===undefined||value===''){if(formula)c.setAttribute('t','str');return;}
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error(`Invalid numeric value at ${address}.`);const v=doc.createElementNS(ns,'v');v.textContent=String(value);c.appendChild(v);}
 else if(formula){c.setAttribute('t','str');const v=doc.createElementNS(ns,'v');v.textContent=String(value);c.appendChild(v);}
 else{c.setAttribute('t','inlineStr');const i=doc.createElementNS(ns,'is'),t=doc.createElementNS(ns,'t');t.setAttribute('xml:space','preserve');t.textContent=String(value);i.appendChild(t);c.appendChild(i);}
}
function rows(doc:Document,items:any[][],start=6){items.forEach((row,r)=>row.forEach((v,c)=>put(doc,`${col(c)}${r+start}`,v)));const d=doc.getElementsByTagNameNS('*','dimension')[0];if(d)d.setAttribute('ref',`A1:${col(Math.max(11,...items.map(r=>r.length-1)))}${Math.max(60,items.length+start-1)}`);}
function readableRows(doc:Document,styles:Document,start:number,end:number,widths:number[]){
 const cols=doc.getElementsByTagNameNS('*','cols')[0];
 if(cols){const previous=Array.from(cols.children);cols.replaceChildren();widths.forEach((width,i)=>{const original=previous.find(c=>Number(c.getAttribute('min'))<=i+1&&Number(c.getAttribute('max'))>=i+1);const c=original?.cloneNode(true) as Element||doc.createElementNS(ns,'col');c.setAttribute('min',String(i+1));c.setAttribute('max',String(i+1));c.setAttribute('width',String(width));c.setAttribute('customWidth','1');cols.appendChild(c);});}
 const xfs=styles.getElementsByTagNameNS('*','cellXfs')[0],wrapped=new Map<string,string>();
 for(let r=start;r<=end;r++){
  const row=doc.querySelector(`row[r="${r}"]`);if(!row)continue;let height=28;
  for(const c of Array.from(row.children)){
   const letters=c.getAttribute('r')?.match(/[A-Z]+/)?.[0]||'A',index=letters.split('').reduce((n,l)=>n*26+l.charCodeAt(0)-64,0)-1;
   const text=c.querySelector('is')?.textContent||c.querySelector('v')?.textContent||'';
   height=Math.max(height,Math.ceil(text.length/Math.max(10,(widths[index]||19)*.85))*14+12);
   const old=c.getAttribute('s')||'0';let style=wrapped.get(old);
   if(!style){const xf=xfs.children[Number(old)].cloneNode(true) as Element;let a=xf.querySelector('alignment');if(!a){a=styles.createElementNS(ns,'alignment');xf.appendChild(a);}a.setAttribute('wrapText','1');a.setAttribute('vertical','top');xf.setAttribute('applyAlignment','1');style=String(xfs.children.length);xfs.appendChild(xf);wrapped.set(old,style);}
   c.setAttribute('s',style);
  }
  row.setAttribute('ht',String(Math.min(409,height)));row.setAttribute('customHeight','1');
 }
 xfs.setAttribute('count',String(xfs.children.length));
}
async function calculationMode(zip:JSZip){const file='xl/workbook.xml',doc=parse(await zip.file(file)!.async('string'));let calc=doc.querySelector('calcPr');if(!calc){calc=doc.createElementNS(ns,'calcPr');doc.documentElement.appendChild(calc);}calc.setAttribute('calcMode','auto');calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');zip.file(file,serialize(doc));}
export async function exportModel(deal:Deal,review:Review|null,sites:Site[],period:string,files:any[]=[]){
 const sources=[...(review?.sources||[]),...files.filter(f=>!review?.sources.some(s=>s.id===f.id)).map(f=>({id:f.id,name:f.name,kind:f.kind}))];
 validateImport(deal);const result=calculate(deal);const zip=await JSZip.loadAsync(template.base64,{base64:true});
 const docs=await Promise.all([1,2,3,4,5].map(async n=>parse(await zip.file(`xl/worksheets/sheet${n}.xml`)!.async('string'))));
 const [summary,model,siteSheet,evidenceSheet,opps]=docs;
 const estimated=review?.evidence.filter(e=>e.status==='Estimated'&&e.value===deal[e.field])||[];put(summary,'A3',deal.name);put(summary,'A4',estimated.length?`ESTIMATED SCREENING CASE — ${estimated.length} inputs estimated. See Model status and Source Evidence for every basis.`:'Source-based screening case');put(summary,'A6',review?.summary||`Company background has not yet been researched for ${deal.name}.`);put(summary,'B14',period||review?.company?.period||'Not confirmed');put(summary,'B15',new Date().toISOString());
 fields.forEach((f,i)=>{const e=review?.evidence.find(e=>e.field===f.key),matches=e?.value===deal[f.key];put(model,`B${i+6}`,deal[f.key]);put(model,`D${i+6}`,deal[f.key]===null?'Missing':matches?e!.status:'User-entered / confirm source');put(model,`E${i+6}`,matches?`${sources.find(s=>s.id===e!.sourceId)?.name||e!.sourceId} ${e!.locator}${e!.status==='Estimated'?' — '+e!.reason:''}`:'');put(model,`F${i+6}`,matches?e!.period:period);});
 put(model,'B36',result.errors.length?'Correct invalid inputs':'Valid',true);
 [result.seller,result.supply,result.commission,result.costs,result.sun,result.dealer,result.combined,result.lift,result.systemCostReduction,result.investment,result.npv,result.irr].forEach((v,i)=>put(model,`B${38+i}`,v,true));
 for(let i=0;i<11;i++)put(model,`${col(i+1)}54`,result.cashflows[i]??null,true);
 [result.sun,result.dealer,result.combined,result.lift,result.investment,result.npv,result.irr].forEach((v,i)=>put(summary,`B${18+i}`,v,true));
 const rawKeys=[...new Set(sites.flatMap(s=>Object.keys(s.raw||{})))];
 rows(siteSheet,[['Record ID','Site name','Address','City','State','ZIP','Ownership','Brand','Period','Source','Locator','Review status',...rawKeys.map(k=>'Source: '+k)],...sites.map(s=>[s.id,s.name,s.address,s.city,s.state,s.zip,s.ownership,s.brand,s.period,sources.find(x=>x.id===s.sourceId)?.name||s.sourceId,s.locator,s.duplicate?'Possible duplicate':s.reviewRequired?'Confirm original':'Parsed record',...rawKeys.map(k=>s.raw?.[k])])],5);
 rows(evidenceSheet,fields.map(f=>{const e=review?.evidence.find(x=>x.field===f.key);const source=sources.find(s=>s.id===e?.sourceId);return [f.label,deal[f.key],e?.value,e?.value===deal[f.key]?e?.status:deal[f.key]===null?'Missing':'User-entered / confirm source',source?.name,e?.locator,e?.quote,e?.period,e?.sourceUnit,e?.reason,source?.url,review?.generatedAt];}));
 const sourceRows=sources.map(s=>[s.name,s.url||s.kind,s.id]);rows(evidenceSheet,[['Source register','URL / type','Source ID'],...sourceRows],38);
 rows(opps,(review?.opportunities||[]).map(o=>[o.idea,o.formula,o.evidenceNeeded,o.owner,'Unquantified',o.sourceIds?.join(', ')]));
 const missing=fields.filter(f=>deal[f.key]===null).map(f=>f.label);rows(summary,[['Outstanding information',missing.join('; ')||'All fields filled — review estimates in Source Evidence and confirm commercial terms.'],...(review?.warnings||[]).map(w=>['Review item',w])],32);
 const styles=parse(await zip.file('xl/styles.xml')!.async('string'));
 readableRows(model,styles,6,34,[43,19,19,22,60,28]);
 readableRows(evidenceSheet,styles,6,34,[38,19,19,22,45,38,60,32,22,85,50,28]);
 docs.forEach((doc,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,serialize(doc)));zip.file('xl/styles.xml',serialize(styles));await calculationMode(zip);
 return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export type CellMapping={field:string;sheet:string;cell:string;scale:number};
export async function exportOriginal(file:File,deal:Deal,mappings:CellMapping[]){
 const zip=await JSZip.loadAsync(await file.arrayBuffer());const workbook=parse(await zip.file('xl/workbook.xml')!.async('string'));const rels=parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'));const used=new Set();
 for(const mapping of mappings){
  if(!fields.some(f=>f.key===mapping.field)||!/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/.test(mapping.cell)||!Number.isFinite(mapping.scale))throw Error('Invalid model input mapping.');
  const sheet=Array.from(workbook.getElementsByTagNameNS('*','sheet')).find(s=>s.getAttribute('name')===mapping.sheet);if(!sheet)throw Error('Select a valid worksheet.');
  const relation=Array.from(rels.documentElement.children).find(r=>r.getAttribute('Id')===sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
  const target=relation?.getAttribute('Target')||'';const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');const entry=zip.file(path);if(!entry)throw Error('Unsupported worksheet relationship.');
  const address=mapping.cell.replaceAll('$',''),key=path+':'+address;if(used.has(key))throw Error('Two inputs map to the same cell.');used.add(key);
  const doc=parse(await entry.async('string'));put(doc,address,deal[mapping.field]===null?null:deal[mapping.field]*mapping.scale);zip.file(path,serialize(doc));
 }
 // Excel must refresh all original formula caches, including unmapped dependent worksheets.
 for(const name of Object.keys(zip.files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n))){const doc=parse(await zip.file(name)!.async('string'));for(const f of Array.from(doc.getElementsByTagNameNS('*','f'))){const c=f.parentElement!;c.querySelector('v')?.remove();c.removeAttribute('t');}zip.file(name,serialize(doc));}
 await calculationMode(zip);return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function downloadBlob(name:string,data:Blob){const url=URL.createObjectURL(data);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
