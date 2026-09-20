import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {mkdir,readFile} from 'node:fs/promises';
import express from 'express';
import PDFDocument from 'pdfkit';
import {registerDealDeskRoutes} from '../src/dealDeskRoutes.js';
const require=createRequire(import.meta.url),frontRequire=createRequire(new URL('../deal-desk/package.json',import.meta.url));
const {chromium}=require('playwright'),JSZip=frontRequire('jszip'),XLSX=frontRequire('xlsx');
const live=process.env.DEAL_DESK_BASE_URL,output=process.env.DEAL_DESK_QA_DIR||'/tmp/deal-intake-qa';
let server,base=live;
if(!live){
 const app=express();registerDealDeskRoutes(app,{env:{ANTHROPIC_API_KEY:'test-not-real',AI_COUNCIL_ACCESS_CODE:'test-code'},fetchImpl:async(_u,o)=>{
  const b=JSON.parse(o.body),text=JSON.stringify(b.messages),checking=text.includes('Independently verify');
  if(b.tools)return Response.json({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search',id:'search1'},{type:'web_search_tool_result',content:[]},{type:'text',text:'Fictional Fuel operates 10 sites.',citations:[{url:'https://example.com/company',title:'Fictional company source',cited_text:'Fictional Fuel operates 10 sites.'}]}]});
  const sourceId=b.messages[0].content.find(x=>x.type==='text'&&x.text.startsWith('SOURCE ID'))?.text.split('\n')[0].replace('SOURCE ID ','')||'web-1';
  return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(checking?{approvedFields:['sites'],companySupported:true,summarySupported:true}:{company:{name:'Fictional Fuel',overview:'Fictional Fuel operates 10 sites.',period:'FY2025',sourceIds:[sourceId]},summary:'Fictional Fuel operates 10 sites. Dealer commission terms and conversion costs remain to be confirmed.',deal:{name:'Fictional Fuel',sites:10},evidence:[{field:'sites',value:10,sourceId,quote:'10 sites',locator:'Page 1',sourceUnit:'count',period:'FY2025',status:'sourced',confidence:'high'}],opportunities:[{idea:'Validate fuel purchasing improvement',formula:'Eligible gallons × quoted net cents / 100',evidenceNeeded:'Sunoco supply quote and current supply contracts',owner:'Supply',sourceIds:[sourceId]}],sites:[],warnings:['Fictional QA data']})}]});
 }});
 server=app.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
}
await mkdir(output,{recursive:true});
const pdf=await new Promise(resolve=>{const d=new PDFDocument(),chunks=[];d.on('data',x=>chunks.push(x));d.on('end',()=>resolve(Buffer.concat(chunks)));d.text('Fictional Fuel operates 10 sites. FY2025 annual gallons 15 million.');d.addPage().text('Page two: retained lease commitments require review.');d.end();});
const csv='Site ID,Site Name,Address,City,State,ZIP,Ownership,Brand,Period,Annual Gallons,Annual Inside Gross Profit,Annual Opex,Special Attribute\n'+Array.from({length:120},(_,i)=>[i+1,'Site '+(i+1),(i+1)+' Main St','Testville','PA','19001','Owned','Fixture','FY2025',100000,50000,40000,'Preserve-'+(i+1)].join(',')).join('\n');
const docx=new JSZip();docx.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Seller contract terms: dealer commission is not yet quoted.</w:t></w:r></w:p><w:tbl>'+[['Site Name','Address','City','Special Note'],['Word Site A','1 Word Ave','Testville','Tank review'],['Word Site B','2 Word Ave','Testville','Lease option']].map(row=>'<w:tr>'+row.map(c=>'<w:tc><w:p><w:r><w:t>'+c+'</w:t></w:r></w:p></w:tc>').join('')+'</w:tr>').join('')+'</w:tbl></w:body></w:document>');
const word=await docx.generateAsync({type:'nodebuffer'});
const blankTemplate=Buffer.from(JSON.parse(await readFile(new URL('../deal-desk/lib/model-template.json',import.meta.url),'utf8')).base64,'base64');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,proxy:process.env.DEAL_DESK_PROXY?{server:process.env.DEAL_DESK_PROXY}:undefined,args:['--no-sandbox']});
try{
 for(const viewport of [{width:1440,height:1050},{width:390,height:844}]){
  const page=await browser.newPage({viewport,ignoreHTTPSErrors:process.env.DEAL_DESK_TEST_IGNORE_HTTPS_ERRORS==='1'});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(base+'/deal-desk',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'From seller files to a defensible deal.'}).waitFor();
  assert.equal(await page.getByRole('tab').count(),5);assert.equal(await page.locator('#source-files').getAttribute('accept'),null);
  await page.screenshot({path:output+'/'+viewport.width+'-intake.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Load example',exact:true}).click();assert.match(await page.locator('.metrics').innerText(),/\$4,240,000/);
  async function download(button,name){const pending=page.waitForEvent('download');await button.click();const d=await pending;await d.saveAs(output+'/'+name);return await readFile(await d.path());}
  const filled=await download(page.getByRole('button',{name:'Download filled Excel',exact:true}).first(),viewport.width+'-filled.xlsx');
  const wb=XLSX.read(filled,{type:'buffer',cellFormula:true});assert.deepEqual(wb.SheetNames,['Company Summary','Model','Sites','Source Evidence','Opportunities']);assert.equal(wb.Sheets.Model.B42.v,4240000);assert.equal(wb.Sheets.Model.B43.v,950000);assert.ok(wb.Sheets.Model.B42.f);assert.ok(wb.Sheets.Model.B49.v>.16);
  await page.getByRole('tab',{name:'02 · Economics'}).click();await page.screenshot({path:output+'/'+viewport.width+'-economics.png',fullPage:true});assert.match(await page.locator('.result-band').innerText(),/\$4,240,000/);
  await page.getByRole('tab',{name:'03 · Company summary'}).click();assert.equal(await page.getByText('What the workbooks actually do').count(),0);assert.equal(await page.locator('a[href*="Global_Input_Map"]').count(),0);
  await page.locator('#model-file').setInputFiles({name:'model.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:blankTemplate});
  await page.getByRole('button',{name:'Add input mapping'}).waitFor();await page.getByRole('button',{name:'Add input mapping'}).click();
  await page.getByLabel('Mapping sheet 1',{exact:true}).selectOption('Model');await page.getByLabel('Mapping cell 1',{exact:true}).fill('B42');
  await page.getByRole('button',{name:'Download mapped original'}).click();await page.getByRole('status').filter({hasText:'Refusing to overwrite formula B42'}).waitFor();
  await page.getByLabel('Mapping cell 1',{exact:true}).fill('B6');const original=await download(page.getByRole('button',{name:'Download mapped original'}),viewport.width+'-original.xlsx');
  const oz=await JSZip.loadAsync(original),mx=await oz.file('xl/worksheets/sheet2.xml').async('string');assert.equal(XLSX.read(original,{type:'buffer'}).Sheets.Model.B6.v,10);assert.ok(!/<(?:x:)?v>/.test(mx.match(/<(?:x:)?c r="B42"[^>]*>([\s\S]*?)<\/(?:x:)?c>/)?.[1]||''));assert.match(mx,/<(?:x:)?f>IF/);
  await page.getByRole('tab',{name:'01 · Deal inputs'}).click();
  const draft=await download(page.getByRole('button',{name:'Save draft',exact:true}),viewport.width+'-draft.json');
  await page.getByRole('button',{name:'Clear inputs',exact:true}).click();const blank=await download(page.getByRole('button',{name:'Download filled Excel',exact:true}).first(),viewport.width+'-blank.xlsx');
  const blankWb=XLSX.read(blank,{type:'buffer'});assert.ok(blankWb.Sheets.Model.B42?.v==null||blankWb.Sheets.Model.B42.v==='');assert.ok(blankWb.Sheets.Model.B6?.v==null);
  await page.locator('#draft-file').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:draft});await page.getByRole('status').filter({hasText:'Draft restored'}).waitFor();assert.match(await page.locator('.metrics').innerText(),/\$4,240,000/);
  await page.getByRole('button',{name:'Clear inputs',exact:true}).click();
  await page.locator('#source-files').setInputFiles([{name:'seller.pdf',mimeType:'application/pdf',buffer:pdf},{name:'sites.csv',mimeType:'text/csv',buffer:Buffer.from(csv)},{name:'terms.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:word}]);
  await page.getByRole('status').filter({hasText:'3 file(s) read. 122 site rows retained.'}).waitFor({timeout:30000});
  assert.equal(await page.locator('.file-row').count(),3);assert.match(await page.locator('.file-row').filter({hasText:'seller.pdf'}).innerText(),/2 pages/);
  await page.getByLabel('Financial period',{exact:true}).fill('FY2025');await page.getByRole('tab',{name:'04 · Sites & sources'}).click();
  assert.equal(await page.locator('tbody tr').count(),50);await page.getByRole('button',{name:'Next 50'}).click();await page.getByRole('button',{name:'Next 50'}).click();assert.equal(await page.locator('tbody tr').count(),22);
  const sitesExport=await download(page.getByRole('button',{name:'Download all site records in Excel'}),viewport.width+'-sites.xlsx');
  const sw=XLSX.read(sitesExport,{type:'buffer'});const rows=XLSX.utils.sheet_to_json(sw.Sheets.Sites,{header:1});assert.equal(rows.filter(row=>row.some(x=>String(x)==='Preserve-120')).length,1);assert.equal(rows.filter(row=>row.some(x=>String(x)==='Tank review')).length,1);
  await page.screenshot({path:output+'/'+viewport.width+'-sites.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(!live){
   await page.getByRole('tab',{name:'01 · Deal inputs'}).click();await page.getByLabel('Workspace access code').fill('test-code');
   await page.getByRole('button',{name:'Analyze files & fill model'}).click();await page.getByText('Fictional Fuel operates 10 sites. Dealer commission terms and conversion costs remain to be confirmed.',{exact:true}).waitFor({timeout:20000});
   assert.equal(await page.getByRole('button',{name:'Confirm value',exact:true}).count(),0);
   await page.screenshot({path:output+'/'+viewport.width+'-summary.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const report=await download(page.getByRole('button',{name:'Download summary PDF'}),viewport.width+'-summary.pdf');assert.equal(report.subarray(0,5).toString(),'%PDF-');
   await page.getByRole('tab',{name:'01 · Deal inputs'}).click();assert.equal(await page.locator('#sites').inputValue(),'10');
   await page.getByLabel('Company name',{exact:true}).fill('Fictional Fuel');await page.getByRole('button',{name:'Search a company',exact:true}).click();await page.locator('a[href="https://example.com/company"]').waitFor({timeout:20000});
   await page.getByRole('tab',{name:'01 · Deal inputs'}).click();await page.getByLabel('Workspace access code').fill('wrong');await page.getByRole('button',{name:'Analyze files & fill model'}).click();await page.getByRole('status').filter({hasText:'Enter your Deal Desk password'}).waitFor();assert.equal(await page.locator('#sites').inputValue(),'10');
  }
  assert.ok(errors.every(e=>/401/.test(e)),errors.join('\n'));console.log(JSON.stringify({viewport:viewport.width,mixedFiles:['PDF','DOCX','CSV'],siteRecords:122,formulas:true,blankNotZero:true,originalFormulaProtection:true,sourceVerifiedAutofill:!live,companySearch:live?'not invoked':'mocked provider passed',noOverflow:true}));
  await page.close();
 }
}finally{await browser.close();if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});}
