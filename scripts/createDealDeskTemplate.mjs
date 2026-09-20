// Run with the Codex artifact-tool runtime. This authors a reusable, empty public template.
import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
import {fields} from '../src/dealDeskModel.js';
const wb=Workbook.create();
for(const name of ['Company Summary','Model','Sites','Source Evidence','Opportunities'])wb.worksheets.add(name);
const money='#,##0;(#,##0);"–"';
for(const sheet of ['Company Summary','Model','Sites','Source Evidence','Opportunities'].map(n=>wb.worksheets.getItem(n))){sheet.showGridLines=false;sheet.freezePanes.freezeRows(5);sheet.getRange('A1:L60').format.font.name='Arial';sheet.getRange('A1:L60').format.font.size=10;sheet.getRange('A1:L60').format.rowHeight=22;sheet.getRange('A1:F1').merge();sheet.getRange('A1').values=[[sheet.name.toUpperCase()]];sheet.getRange('A1:F1').format={fill:'#10243D',font:{color:'#FFFFFF',bold:true,size:18},rowHeight:36};sheet.getRange('A:L').format.columnWidth=19;sheet.getRange('A:A').format.columnWidth=43;sheet.getRange('A5:L5').format={fill:'#E7EFF9',font:{bold:true,color:'#174477'}};}
const m=wb.worksheets.getItem('Model');m.getRange('A2:F2').merge();m.getRange('A2').values=[['Company-controlled assets • commission dealer operations • USD']];
m.getRange('A3:F3').merge();m.getRange('A3').values=[['Blue inputs are editable. Blank means unknown; confirmed zero is entered as 0.']];
m.getRange('A5:F5').values=[['Input','Value','Unit','Evidence status','Source / locator','Reporting period']];
m.getRange('A6:F34').values=fields.map(f=>[f.label,null,f.unit,'Missing','','']);m.getRange('B6:B34').format.font.color='#205AC6';m.getRange('B6:B34').setNumberFormat(money);m.getRange('A6:F34').format.wrapText=true;m.getRange('A6:F34').format.rowHeight=36;m.getRange('E:E').format.columnWidth=45;
const c=Object.fromEntries(fields.map((f,i)=>[f.key,`B${i+6}`]));
const nonnegative=fields.filter(f=>!['procurement','freight','insideUplift','fuelCpg'].includes(f.key)).map(f=>`${c[f.key]}>=0`).join(',');
const valid=`AND(${nonnegative},B15<=100,B32<=100,B33<=100,OR(COUNT(B6)=0,AND(B6>0,MOD(B6,1)=0)),OR(COUNT(B28)=0,AND(MOD(B28,1)=0,OR(COUNT(B6)=0,B28<=B6))))`;
m.getRange('A36').values=[['Input validation']];m.getRange('B36').formulas=[[`=IF(${valid},"Valid","Correct invalid inputs")`]];
const op='AND(COUNT(B6:B26)=21,B36="Valid")',inv='AND(COUNT(B6:B34)=29,B36="Valid")';
const defs=[
 ['Seller normalized EBITDA',`${c.gallons}*${c.fuelCpg}/100+${c.insideGp}+${c.transferredOther}+${c.other}-${c.sellerOpex}-${c.sellerGa}`],
 ['Procurement and freight improvement',`${c.gallons}*${c.eligible}/100*(${c.procurement}+${c.freight})/100`],
 ['Dealer commission',`${c.gallons}*${c.commission}/100`],
 ['Retained Sunoco costs',`SUM(${c.card}:${c.retainedGa})`],
 ['Sunoco run-rate EBITDA',`${c.gallons}*${c.fuelCpg}/100+B39+${c.other}+${c.rent}-B40-B41`],
 ['Dealer EBITDA',`${c.insideGp}+${c.transferredOther}+${c.insideUplift}+B40-${c.rent}-${c.dealerOpex}`],
 ['Combined Sunoco + dealer EBITDA','B42+B43'],
 ['Change in Sunoco vs seller EBITDA','B42-B38'],
 ['Combined operating-cost reduction',`${c.sellerOpex}+${c.sellerGa}-B41-${c.dealerOpex}`],
 ['Initial investment',`${c.price}+${c.convertSites}*${c.conversion}+${c.oneTime}`],
 ['NPV at entered hurdle','NPV(B33/100,C54:L54)+B54'],
 ['Pretax screening IRR','IF(AND(B47>0,MIN(C54:L54)>=0,MAX(C54:L54)>0),IFERROR(IRR(B54:L54),""),"")'],
 ];
m.getRange('A38:A49').values=defs.map(x=>[x[0]]);m.getRange('B38:B49').formulas=defs.map((x,i)=>[`=IF(${i>=9?inv:op},${x[1]},"")`]);m.getRange('B38:B48').setNumberFormat(money);m.getRange('B49').setNumberFormat('0.0%');
m.getRange('A42:B42').format.fill='#E7EFF9';m.getRange('A42:B42').format.font.bold=true;
m.getRange('A53:L53').values=[['Cash flow year',...Array.from({length:11},(_,i)=>i)]];
m.getRange('B54:L54').formulas=[Array.from({length:11},(_,i)=>`=IF(${inv},${i===0?'-B47':i===1?'B38+(B42-B38)*B32/100-B31':i===10?'B42-B31+B34':'B42-B31'},"")`)];m.getRange('B54:L54').setNumberFormat(money);
m.getRange('A56:L57').merge();m.getRange('A56').values=[['Screening assumptions: company-operated seller converted to commission dealers. Flat operations for 10 years; Year 1 conversion timing; explicit Year 10 proceeds. Excludes taxes, financing and growth. Rent and commission cancel in combined economics. Capital savings are not EBITDA.']];m.getRange('A56:L57').format.wrapText=true;
const s=wb.worksheets.getItem('Company Summary');s.getRange('A3:F3').merge();s.getRange('A3').values=[['Company name']];s.getRange('A5:F5').merge();s.getRange('A5').values=[['Company and acquisition overview']];s.getRange('A6:F12').merge();s.getRange('A6').values=[['Upload seller documents or search a company to prepare the company-specific summary.']];s.getRange('A6:F12').format.wrapText=true;s.getRange('A6:F12').format.verticalAlignment='top';
s.getRange('A14').values=[['Reporting period']];s.getRange('A15').values=[['Prepared at']];
const summaryMetrics=[['Sunoco run-rate EBITDA',42],['Dealer EBITDA',43],['Combined EBITDA',44],['Change vs seller EBITDA',45],['Initial investment',47],['NPV',48],['Pretax screening IRR',49]];
s.getRange('A18:A24').values=summaryMetrics.map(x=>[x[0]]);s.getRange('B18:B24').formulas=summaryMetrics.map(x=>[`=IF(COUNT(Model!B${x[1]})=0,"",Model!B${x[1]})`]);s.getRange('B18:B23').setNumberFormat(money);s.getRange('B24').setNumberFormat('0.0%');s.getRange('B18:B24').format.font.color='#008044';
s.getRange('A27:F29').merge();s.getRange('A27').values=[['Company control does not imply fee ownership. Confirm retained lease obligations, conversion terms and site-level dealer viability. Unknown inputs remain blank; results are screening estimates.']];s.getRange('A27:F29').format.wrapText=true;
wb.worksheets.getItem('Sites').getRange('A5:L5').values=[['Record ID','Site name','Address','City','State','ZIP','Ownership','Brand','Period','Source','Locator','Review status']];
wb.worksheets.getItem('Source Evidence').getRange('A5:L5').values=[['Field','Model value','Proposed value','Status','Source','Locator','Quote','Period','Original unit','Reason','Source URL','Reviewed at']];
wb.worksheets.getItem('Source Evidence').getRange('G:G').format.columnWidth=60;
wb.worksheets.getItem('Opportunities').getRange('A5:F5').values=[['Opportunity','Calculation','Evidence needed','Owner','Status','Sources']];
wb.recalculate();
console.log((await wb.inspect({kind:'region',sheetId:'Model',range:'A36:B49',maxChars:2400})).ndjson);
const output=await SpreadsheetFile.exportXlsx(wb);const dir=new URL('../deal-desk/lib/',import.meta.url);await output.save('/tmp/deal-template.xlsx');const bytes=await fs.readFile('/tmp/deal-template.xlsx');await fs.writeFile(new URL('model-template.json',dir),JSON.stringify({base64:bytes.toString('base64')}));
const png=await wb.render({sheetName:'Company Summary',range:'A1:F29',scale:1,format:'png'});await fs.writeFile('/tmp/deal-template-preview.png',new Uint8Array(await png.arrayBuffer()));
console.log(`Template authored: ${bytes.length} bytes`);
