import {emptyDeal,fields} from './dealDeskModel.js';

const normal=value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
const column=address=>address.match(/^[A-Z]+/)[0];
const rowNumber=address=>Number(address.match(/\d+$/)[0]);
function number(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 const text=String(value??'').trim();if(!text)return null;
 if(/^\$?\s*[-–—]\s*$/.test(text))return 0;
 const clean=text.replace(/[$,\s]/g,'');
 if(!/^(?:-?\d+(?:\.\d+)?|\(\d+(?:\.\d+)?\))$/.test(clean))return null;
 const n=Number(clean.replace(/[()]/g,''));return Number.isFinite(n)?(clean.includes('(')?-n:n):null;
}
// The existing browser payload preserves every cell address and raw value. Read
// that representation directly so retained uploads also benefit after a release.
export function workbookSheets(source){
 if(!/\.(xlsx|xls|xlsb|xlsm|ods)$/i.test(source.name))return [];
 return String(source.text).split(/\nSHEET /).slice(1).map(part=>{
  const end=part.indexOf('\n'),name=part.slice(0,end),cells={};
  for(const line of part.slice(end+1).split('\n')){
   const matches=[...line.matchAll(/(?:^| \| )([A-Z]+\d+): /g)];
   matches.forEach((m,i)=>{const text=line.slice(m.index+m[0].length,matches[i+1]?.index??line.length);cells[m[1]]={value:text.replace(/ \(display [\s\S]*$| \[cached formula:[\s\S]*$/,'').trim(),text};});
  }
  return {name,cells};
 });
}
const monthNames=['january','february','march','april','may','june','july','august','september','october','november','december'];
function sheetPeriod(sheet,label){
 const year=String(label).match(/20\d{2}/)?.[0];if(!year)return null;
 if(/\bfy\s*20\d{2}|full.year/i.test(label))return {year:Number(year),basis:'lastYear',label:`FY${year}`};
 if(!/ytd/i.test(label))return null;
 const notes=Object.values(sheet.cells).map(c=>c.value).filter(v=>String(v).includes(year)&&/ytd/i.test(v)).join(' ');
 const match=notes.match(/january\s*[-–—]\s*([a-z]+)/i);
 const months=match?monthNames.indexOf(match[1].toLowerCase())+1:0;
 return {year:Number(year),basis:'ytd',months,label:`${year} YTD ${months||'unknown'} months`};
}

export function importWorkbookTables(sources,{basis,year,months,current=emptyDeal()}){
 // A sole structured seller workbook is a complete extraction boundary. Mixed
// document packets continue through the source-aware analysis pipeline.
 if(sources.length!==1)return null;
 const source=sources[0],sheets=workbookSheets(source);
 const candidates=sheets.filter(s=>Object.values(s.cells).some(c=>normal(c.value)==='p&l line item'));
 if(candidates.length!==1)return null;
 const sheet=candidates[0],cells=sheet.cells;
 const labelEntry=Object.entries(cells).find(([,c])=>normal(c.value)==='p&l line item');
 const labelCol=column(labelEntry[0]),periodRow=rowNumber(labelEntry[0]);
 const labelRow=name=>{const matches=Object.entries(cells).filter(([a,c])=>column(a)===labelCol&&normal(c.value)===name);return matches.length===1?rowNumber(matches[0][0]):null;};
 const rows={fuelGp:labelRow('fuel gross profit'),insideGp:labelRow('merchandise gross profit'),gallons:labelRow('fuel gallons'),totalGp:labelRow('total gross profit'),status:labelRow('operating status'),ids:labelRow('store #')};
 if(Object.values(rows).some(v=>v===null))return null;
 const val=(col,row)=>cells[col+row]?.value;
 const periodEntries=Object.entries(cells).filter(([a])=>rowNumber(a)===periodRow&&column(a)!==labelCol).map(([a,c])=>({col:column(a),period:sheetPeriod(sheet,c.value)})).filter(x=>x.period);
 const wanted=periodEntries.filter(x=>x.period.basis===basis&&x.period.year===(basis==='lastYear'?year-1:year)&&(basis!=='ytd'||x.period.months===months));
 if(!wanted.length){const available=[...new Set(periodEntries.map(x=>x.period.label))].join(', ');throw Error(`This workbook provides ${available}. Select a matching reporting basis${basis==='ttm'?'; TTM needs the comparable prior-year YTD figures, which are not in this workbook':''}. Your file is retained.`);}
 const classify=status=>/^(commissioned agent|commission agent|dealer|dealer operated)$/i.test(status)?'dealer':/^(not operating|closed|inactive)$/i.test(status)?'inactive':/^(operating|company operated|company-operated)$/i.test(status)?'retail':null;
 let previousId='',previousStatus;const allCols=[...new Set(Object.keys(cells).map(column))].sort((a,b)=>a.length-b.length||a.localeCompare(b));const ids={},statuses={};
 for(const col of allCols){if(val(col,rows.ids)!==undefined){previousId=String(val(col,rows.ids)).replace(/\s*\(\d+\)\s*$/,'');previousStatus=val(col,rows.status);}ids[col]=previousId;statuses[col]=previousStatus;}
 const selected=wanted.filter(x=>statuses[x.col]!==undefined);
 if(!selected.length)return null;
 const records=selected.map(({col})=>({col,id:ids[col],group:classify(String(statuses[col]).trim()),values:Object.fromEntries(['fuelGp','insideGp','gallons','totalGp'].map(k=>[k,number(val(col,rows[k]))]))}));
 if(records.some(r=>!r.group||!r.id||Object.values(r.values).some(v=>v===null))||new Set(records.map(r=>r.id)).size!==records.length)return null;
 const totals=wanted.filter(x=>/total/i.test(ids[x.col]));
 if(totals.length!==1)return null;
 const statedCount=ids[totals[0].col].match(/total\s*[-:]?\s*(\d+)\s*(stores?|sites?|locations?)/i);
 if(statedCount&&Number(statedCount[1])!==records.length)throw Error('The workbook’s stated location count does not match its distinct site columns. Check the site roster; your file is retained.');
 const warnings=[],period=wanted[0].period.label;
 for(const key of ['fuelGp','insideGp','gallons','totalGp']){
  const reported=number(val(totals[0].col,rows[key])),sum=records.reduce((n,r)=>n+r.values[key],0);
  if(reported===null||Math.abs(reported-sum)>Math.max(2,records.length*.51))throw Error(`Workbook ${key} total does not reconcile to its site columns. Check ${sheet.name}, row ${rows[key]}; the file is retained.`);
 }
 const groups=Object.fromEntries(['retail','dealer','inactive'].map(k=>[k,records.filter(r=>r.group===k)]));
 if(!groups.retail.length)return null;
 const aggregate=records=>Object.fromEntries(['fuelGp','insideGp','gallons','totalGp'].map(k=>[k,records.reduce((n,r)=>n+r.values[k],0)]));
 const retail=aggregate(groups.retail),deal=emptyDeal(),evidence=[];
 const title=sheets.flatMap(s=>Object.values(s.cells)).map(c=>String(c.value)).find(v=>/^Asset Roster\s*[-–]/i.test(v));
 deal.name=title?title.replace(/^Asset Roster\s*[-–]\s*/i,''):source.name.replace(/\.[^.]+$/,'');
 const evidenceFor=(value,key,records,reason)=>{const sourceRows=key==='sites'?[rows.ids,rows.status]:key==='fuelCpg'?[rows.fuelGp,rows.gallons]:key==='other'?[rows.totalGp,rows.fuelGp,rows.insideGp]:[rows[key]];return {value,sourceId:source.id,period,sourceUnit:key==='sites'?'count':key==='gallons'?'gallons':key==='fuelCpg'?'cents/gallon':'USD',status:'Calculated from reported figures',locator:`${sheet.name}!${records.map(r=>sourceRows.map(row=>r.col+row).join('/')).join(', ')}`,quote:key==='sites'?`${records.length} distinct ${records[0]?.group} store columns`:`${key}: ${value}`,reason};};
 const set=(key,value,reason)=>{deal[key]=value;evidence.push({field:key,...evidenceFor(value,key,groups.retail,reason)});};
 set('sites',groups.retail.length,'Count of distinct company-operated columns; existing agents and inactive locations are separate channels.');
 set('gallons',retail.gallons,'Sum of reported gallons for company-operated stores in the selected period.');
 set('fuelCpg',retail.gallons>0?retail.fuelGp/retail.gallons*100:0,`Reported fuel gross profit ${retail.fuelGp} ÷ reported gallons ${retail.gallons} × 100. The workbook’s currency-formatted CPG row is not assumed to be cents.`);
 set('insideGp',retail.insideGp,'Sum of reported merchandise gross profit for company-operated stores.');
 set('other',retail.totalGp-retail.fuelGp-retail.insideGp,'Residual reported gross profit = total GP − fuel GP − merchandise GP. Assumes retained income for screening; verify recurring nature and ownership before valuation.');
 deal.channels=[];
 for(const key of ['dealer','inactive'])if(groups[key].length){
  const list=groups[key],a=aggregate(list),c={name:key==='dealer'?'Existing commissioned agents':'Inactive locations',type:key==='dealer'?'dealer':'other',sites:list.length,gallons:a.gallons,fuelCpg:a.gallons>0?a.fuelGp/a.gallons*100:0,other:a.totalGp-a.fuelGp,opex:0,ga:0,capex:list.length*2000,procurement:0,eligible:0,savings:0,status:'Mixed reported / estimated',metricEvidence:{}};
  c.opex=Math.max(0,a.totalGp)*.35;
  for(const k of ['sites','gallons','fuelCpg','other'])c.metricEvidence[k]=evidenceFor(c[k],k,list,'Calculated from this group’s source columns; no retail commission or conversion costs added.');
  for(const k of ['opex','ga','capex'])c.metricEvidence[k]={value:c[k],status:'Estimated',reason:k==='opex'?'Cash operating expenses are absent. Screening assumes 35% of positive reported gross profit.':k==='ga'?'Additional allocated G&A unavailable; zero is a screening assumption.':'Maintenance capex unavailable; assume $2,000 per location annually.'};
  c.basis=`${list.length} ${key} locations, selected-period source columns only. Fuel GP / gallons sets the weighted margin; other GP includes the remaining reported income. Costs are separately labeled assumptions. Current operating status may differ from status during the historical period; confirm transition dates. Inactive locations are not assumed reopened.`;
  deal.channels.push(c);
 }
 // Keep explicit user financial edits; the old upload prefilled all roster rows
// as retail, so replace that automatic count with the classified retail count.
 for(const f of fields)if(current[f.key]!==null&&current[f.key]!==undefined&&!(f.key==='sites'&&current.sites===source.structuredSiteCount)){
  if(deal[f.key]!==null&&deal[f.key]!==current[f.key])warnings.push(`${f.label}: preserved your ${current[f.key]} input; extracted source value ${deal[f.key]} is shown in evidence.`);
  deal[f.key]=current[f.key];
 }
 for(const k of ['customSynergies','gaSavings','cardSavings','maintenanceSavings','otherSavings','exitRecovery'])if(current[k]!==undefined)deal[k]=current[k];
 warnings.push('Operating expenses and G&A are absent from this P&L. They require explicit screening assumptions; reported gross profit is not EBITDA.','Other revenue may include one-time income. Its recurring nature and retained/transferred treatment need confirmation. Historical purchase prices and capex spent are not proposed transaction terms.','Stores are grouped by the workbook’s current operating status. Historical periods may include earlier operating models; confirm conversion dates.');
 const otherYtd=sheets.filter(s=>s!==sheet).flatMap(s=>Object.values(s.cells)).some(c=>/YTD.*Jan[–-]Jun/i.test(c.value));
 if(otherYtd&&periodEntries.some(x=>x.period.basis==='ytd'&&x.period.months===7))warnings.push('The performance schedule says January–June, while the detailed P&L footnote says January–July. These schedules were not mixed; the detailed P&L controls this import.');
 const company={name:deal.name,period,sourceIds:[source.id],business:'Fuel and convenience portfolio',overview:`${records.length} locations: ${groups.retail.length} company-operated, ${groups.dealer.length} commissioned agents and ${groups.inactive.length} inactive. Financials were read directly from the workbook’s labeled ${period} columns and reconciled to its portfolio totals.`};
 return {deal,company,summary:company.overview,evidence,sites:[],sources:sources.map(({text,data,...s})=>s),warnings,opportunities:[],conflicts:[],missing:fields.filter(f=>deal[f.key]===null).map(f=>f.label),verified:true,generatedAt:new Date().toISOString(),extractionMethod:'Direct workbook cells; reconciled site and portfolio totals'};
}
