import {calculate,drilldown,cash,moneyOK} from './model.js';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,fn,cls)=>{const e=el('button',text,cls);e.type='button';e.addEventListener('click',async()=>{try{await fn();}catch(error){$('dialogMessage').textContent=error.message;}});return e;};
const amountInput=v=>{const e=document.createElement('input');e.type='number';e.step='0.01';e.value=v==null?'':(v/100).toFixed(2);return e;};
const amountValue=input=>{if(input.value.trim()==='')return null;const v=Math.round(Number(input.value)*100);if(!moneyOK(v))throw Error('Enter a valid dollar amount.');return v;};
const monthLabel=m=>new Date(m+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'});
let state,csrf,calc,view='all',busy=false;
async function request(url,method='GET',payload){
 const r=await fetch('/household-pl/api/'+url,{method,credentials:'same-origin',headers:{...(method!=='GET'?{'Content-Type':'application/json','X-CSRF-Token':csrf||''}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 let d;try{d=await r.json();}catch{throw Error('The server did not return the sheet. Your saved data has not been changed.');}
 if(!r.ok){if(r.status===401&&url!=='login')showLogin();throw Error(d.error||'Request failed.');}return d;
}
function showLogin(){state=null;calc=null;csrf=null;$('workspace').hidden=true;$('loginPanel').hidden=false;if($('details').open)$('details').close();$('dialogBody').replaceChildren();for(const id of ['pl','bank'])for(const node of $(id).querySelectorAll('thead,tbody'))node.replaceChildren();$('coverageText').textContent='';$('saveMessage').textContent='';}
function apply(d){state=d.state;csrf=d.csrf;calc=calculate(state);$('workspace').hidden=false;$('loginPanel').hidden=true;render();if(d.syncMessage)$('saveMessage').textContent=d.syncMessage;}
async function save(change){if(busy)return;busy=true;$('dialogMessage').textContent='';try{const d=await request('change','POST',{revision:state.revision,change});apply(d);$('saveMessage').textContent='Saved · '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});$('details').close();}catch(e){$('dialogMessage').textContent=e.message;}finally{busy=false;}}
function dialog(title,kicker='DETAILS'){$('dialogTitle').textContent=title;$('dialogKicker').textContent=kicker;$('dialogBody').replaceChildren();$('dialogMessage').textContent='';if(!$('details').open)$('details').showModal();return $('dialogBody');}
function lineName(key){return state.lines.find(r=>r.key===key)?.name||key;}
function table(headers,rows){const t=el('table',undefined,'detail-table');const head=el('tr');headers.forEach(h=>head.append(el('th',h)));const th=el('thead');th.append(head);t.append(th);const b=el('tbody');for(const row of rows){const tr=el('tr');for(const c of row){const td=el('td');if(c instanceof Node)td.append(c);else td.textContent=String(c??'');tr.append(td);}b.append(tr);}t.append(b);return t;}
function render(){
 $('periodLabel').textContent='Household cash-basis statement · '+monthLabel(state.config.forecastStart)+'–'+monthLabel(calc.bankRows.at(-1).month)+' budget';
 $('coverageText').textContent='Posted through '+state.source.postedThrough+' · Pending through '+state.source.observedThrough+' · '+state.source.coverage;
 $('openingNote').textContent='Starts '+state.config.openingDate+' with '+cash(state.config.openingBank)+' · user-set planning balance';
 const select=$('periodSelect');select.replaceChildren(new Option('All months','all'));
 calc.columns.forEach(c=>select.add(new Option(monthLabel(c.month)+' — '+(c.type==='actual'?(c.month===calc.current?'posted MTD':'actual'):c.type==='estimate'?'full-month estimate':'budget'),c.id)));
 if(view!=='all'&&!calc.columns.some(c=>c.id===view))view=calc.current+'|actual';select.value=view;
 const columns=calc.columns.map((c,i)=>({...c,index:i})).filter(c=>view==='all'||c.id===view);
 const head=$('pl').querySelector('thead');head.replaceChildren();const hr=el('tr');hr.append(el('th','Income / expense','label'));
 for(const c of columns){const h=el('th',monthLabel(c.month));h.append(el('small',c.type==='actual'?(c.month===calc.current?'Posted MTD':'Actual'):c.type==='estimate'?'Full-month estimate':'Budget'));hr.append(h);}
 const totalHead=el('th','12-month total','total-col');totalHead.append(el('small','Budget only'));hr.append(totalHead);head.append(hr);
 const body=$('pl').querySelector('tbody');body.replaceChildren();
 function band(label,cls){const tr=el('tr',undefined,cls);tr.append(el('td',label,'label'));for(let i=0;i<columns.length+1;i++)tr.append(el('td',''));body.append(tr);}
 function numberCell(value,fn,isTotal=false){const td=el('td',undefined,(value<0?'negative ':'')+(isTotal?'total-col':''));const b=button(cash(value),fn,'amount');b.title='Click for transactions or budget basis';td.append(b);return td;}
 function row(label,key,values,total,cls='',line=null){const tr=el('tr',undefined,cls);const td=el('td',undefined,'label');
  if(line){td.append(button(label,()=>editLine(key),'line-name'));if(line.review)td.append(el('span','Review','review-mark'));}else td.textContent=label;
  tr.append(td);for(const c of columns)tr.append(numberCell(values[c.index],()=>showCell(key,c.id)));
  tr.append(numberCell(total,()=>showAnnual(key),true));body.append(tr);
 }
 band('INCOME','section-row');for(const r of calc.rows.filter(r=>r.kind==='income'&&!r.hidden))row(r.name,r.key,r.values,r.total,'',r);
 row('TOTAL INCOME','TOTAL_INCOME',calc.income,calc.forecastIncome,'subtotal');
 band('EXPENSES','section-row');let group='';
 for(const r of calc.rows.filter(r=>r.kind==='expense'&&!r.hidden)){
  if(r.group!==group){group=r.group;band(group,'subsection');}row(r.name,r.key,r.values,r.total,'',r);
 }
 row('TOTAL EXPENSES','TOTAL_EXPENSES',calc.expenses,calc.forecastExpenses,'subtotal');
 row('PROFIT / (LOSS)','PROFIT',calc.profit,calc.forecastProfit,'profit');
 renderBank();
}
function renderBank(){
 const h=$('bank').querySelector('thead'),b=$('bank').querySelector('tbody');h.replaceChildren();b.replaceChildren();
 const columns=view!=='all'&&calc.bankRows.some(c=>c.month===view.split('|')[0])?calc.bankRows.filter(c=>c.month===view.split('|')[0]):calc.bankRows;
 const tr=el('tr');tr.append(el('th','Planning cash'));columns.forEach(c=>tr.append(el('th',monthLabel(c.month))));h.append(tr);
 for(const [label,field]of [['Opening bank balance','opening'],['Profit / (loss)','change'],['Closing bank balance','closing']]){
  const r=el('tr');r.append(el('td',label));for(const c of columns){const td=el('td',undefined,c[field]<0?'negative':'');td.append(button(cash(c[field]),()=>{
   const body=dialog(monthLabel(c.month)+' — '+label,'BANK BALANCE · PLANNING');body.append(el('div',cash(c[field]),'big-amount'),el('p',state.config.openingNote),el('p',cash(c.opening)+' opening cash + '+cash(c.change)+' planned profit / (loss) = '+cash(c.closing)+' closing cash.'));
   body.append(el('p','Internal savings transfers do not reduce this combined bank balance. This is a planning roll-forward, not a forecast of the exact card-payment settlement date.'),button('Edit opening balance',settings));
  },'bank-number'));r.append(td);}b.append(r);
 }
}
function showCell(key,columnId){
 const d=drilldown(state,key,columnId),title=key==='TOTAL_INCOME'?'Total income':key==='TOTAL_EXPENSES'?'Total expenses':key==='PROFIT'?'Profit / (loss)':lineName(key);
 const body=dialog(title,monthLabel(d.column.month)+' · '+d.column.type.toUpperCase());
 body.append(el('div',cash(d.amount),'big-amount'+(d.amount<0?' negative':'')),el('p',d.explanation));
 if(d.column.type==='actual')body.append(el('div',(d.evidenceTotal===d.amount?'Reconciled: ':'CHECK REQUIRED: ')+cash(d.evidenceTotal)+' from '+d.transactions.length+' posted transaction'+(d.transactions.length===1?'':'s')+'.',d.evidenceTotal===d.amount?'reconciled':'negative'));
 else{
  const rows=d.basis.map(r=>[r.name,cash(r.amount),r.override?'Manual month override':r.method==='biweekly'?cash(r.base)+' × '+r.dates.length+' paychecks ('+r.dates.join(', ')+')':r.method==='annual'?'Annual month / event amount':r.method==='variable'||r.method==='variable_new'?'Recent-month spending basis':r.method==='none'?'Not repeated':cash(r.base)+' base',r.note]);
  body.append(el('h3','What makes up this number'),table(['Line','Amount','Calculation','Source / assumption'],rows));
  if(!key.startsWith('TOTAL_')&&key!=='PROFIT')body.append(button('Edit this month’s budget',()=>editBudget(key,d.column.month),'primary'));
 }
 if(d.basis.length===1){body.append(el('p',d.basis[0].note),button('Edit line / recurring amount',()=>editLine(key)));}
 body.append(el('h3',d.column.type==='actual'?'Included transactions':'Supporting recent transactions (not future transactions)'));
 showTransactions(body,d.transactions,key==='PROFIT');
}
function showAnnual(key){
 const kind=key==='TOTAL_INCOME'?'income':key==='TOTAL_EXPENSES'?'expense':null;
 const rows=calc.rows.filter(r=>!r.hidden&&(kind?r.kind===kind:key==='PROFIT'?['income','expense'].includes(r.kind):r.key===key));
 const body=dialog(key==='PROFIT'?'12-month profit / (loss)':kind?'12-month '+kind:lineName(key),'12-MONTH BUDGET');
 const total=rows.reduce((a,r)=>a+(key==='PROFIT'&&r.kind==='expense'?-r.total:r.total),0);body.append(el('div',cash(total),'big-amount'),el('p','This is the sum of the twelve budget months only. Actual months are not added again.'));
 body.append(table(['Month','Budget','Details'],calc.columns.slice(3).map((c,j)=>{
  const n=rows.reduce((a,r)=>a+(key==='PROFIT'&&r.kind==='expense'?-r.values[j+3]:r.values[j+3]),0);
  return [monthLabel(c.month),cash(n),button('Open month',()=>showCell(key,c.id))];
 })));
}
function showTransactions(body,transactions,profit=false){
 if(!transactions.length){body.append(el('div','No posted transactions are tied to this amount. A budget may be based on an explicitly entered plan or an annual event.','empty'));return;}
 const rows=transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(t=>{
  const desc=el('div',t.merchant||t.name);desc.append(el('small',t.name+' · '+lineName(t.key)));if(t.pending)desc.append(el('span','Pending — not in actuals','pill'));if(t.edited)desc.append(el('small','Manual correction applied; source amount '+cash(t.rawAmount)));
  const amount=profit&&calc.byKey[t.key]?.kind==='expense'?-t.modelAmount:t.modelAmount;
  const amountEl=el('span',cash(amount),amount<0?'negative':'');
  const actions=el('div');actions.append(button('Details / edit',()=>editTransaction(t.id)));
  return [t.date,desc,t.account,amountEl,actions];
 });body.append(table(['Date','Merchant / line','Account','Contribution',''],rows));
}
function field(form,label,input,wide=false){const e=el('label',label,wide?'wide':'');e.append(input);form.append(e);return input;}
function textInput(value,type='text'){const i=document.createElement('input');i.type=type;i.value=value??'';return i;}
function selectInput(options,value){const s=document.createElement('select');for(const [v,label]of options)s.add(new Option(label,v));s.value=value;return s;}
function editBudget(key,month){
 const r=calc.byKey[key],saved=state.overrides[key+'|'+month],body=dialog(r.name,monthLabel(month)+' · EDIT BUDGET');
 const form=el('form',undefined,'edit-form');const amount=field(form,'Amount for this month ($)',amountInput(saved?.amount??r.values[calc.columns.findIndex(c=>c.month===month&&c.type==='budget')]??r.baseUsed));
 const note=field(form,'Reason / note',textInput(saved?.note||''));const actions=el('div',undefined,'button-row wide');actions.append(button('Save month override',()=>save({type:'budget',key,month,amount:amountValue(amount),note:note.value}),'primary'),button('Use calculated amount',()=>save({type:'budget',key,month,amount:null})));form.append(actions);form.addEventListener('submit',e=>e.preventDefault());body.append(el('p','Changes this month only. Weekly transaction imports preserve your override.'),form);
}
function editLine(key){
 const r=state.lines.find(r=>r.key===key),body=dialog(r.name,'EDIT STATEMENT LINE');const form=el('form',undefined,'edit-form');
 const name=field(form,'Line name',textInput(r.name));const kind=field(form,'Statement section',selectInput([['income','Income'],['expense','Expenses'],['review','Review only — excluded from P&L']],r.kind));
 const group=field(form,'Expense group',textInput(r.group));const method=field(form,'Budget method',selectInput([['fixed','Monthly fixed amount'],['variable','Recent spending average'],['variable_new','Recent usage (new service)'],['average','Recent bill average'],['annual','Once a year / event'],['biweekly','Every 14 days — payroll'],['none','Actual only — no future budget']],r.method));
 const amount=field(form,'Base / each occurrence ($)',amountInput(r.overrideBase??calc.byKey[key].baseUsed));
 const annual=field(form,'Annual event month',selectInput(Array.from({length:12},(_,i)=>[String(i+1),new Date(2026,i,1).toLocaleDateString('en-US',{month:'long'})]),String(r.month||1)));
 const anchor=field(form,'Biweekly payday anchor',textInput(r.anchor||state.config.openingDate,'date'));
 const noteInput=document.createElement('textarea');noteInput.value=r.note;const note=field(form,'Source / budget notes',noteInput,true);
 const actions=el('div',undefined,'button-row wide');actions.append(button('Save line',()=>save({type:'line',key,name:name.value,kind:kind.value,group:group.value,method:method.value,base:amountValue(amount)??0,overrideBase:amountValue(amount),month:Number(annual.value),anchor:anchor.value,note:note.value}),'primary'),button('Return to automatic baseline',()=>save({type:'line',key,overrideBase:null})));
 actions.append(button(r.hidden?'Restore line':'Delete / exclude line',()=>{if(r.hidden||confirm('Exclude this line from actual and budget totals? Its original transactions will be retained in Review & restore.'))save({type:'line',key,hidden:!r.hidden});},r.hidden?'':'danger'));form.append(actions);form.addEventListener('submit',e=>e.preventDefault());body.append(el('p','Changing the base locks it to your amount. Use “Return to automatic baseline” to restore recent-spending calculations. Deleting is reversible and does not erase source records.'),form);
}
function editTransaction(id){
 const t=calc.transactions.find(t=>t.id===id),raw=state.transactions.find(t=>t.id===id),body=dialog(t.merchant||t.name,'TRANSACTION DETAILS');
 body.append(el('p','Source record: '+t.id),el('p',t.note||'Imported transaction.'),el('p','Original bank-signed amount '+cash(raw.amount)+'; positive means a charge/payment, negative means a deposit/refund. Category confidence: '+(t.confidence||'not supplied')+'.'));
 const form=el('form',undefined,'edit-form');const name=field(form,'Description',textInput(t.name));const date=field(form,'Transaction date',textInput(t.date,'date'));
 const amount=field(form,'Bank-signed amount ($)',amountInput(t.amount));const key=field(form,'Assign to statement line',selectInput(state.lines.map(r=>[r.key,r.kind.toUpperCase()+' · '+r.name]),t.key));
 const note=field(form,'Correction note',textInput(state.transactionEdits[id]?.note||''),true);
 const actions=el('div',undefined,'button-row wide');actions.append(button('Save correction',()=>save({type:'transaction',id,name:name.value,date:date.value,amount:amountValue(amount),key:key.value,note:note.value}),'primary'),button(t.excluded?'Restore transaction':'Exclude from totals',()=>save({type:'transaction',id,excluded:!t.excluded}),t.excluded?'':'danger'),button('Restore original record',()=>save({type:'transaction',id,restore:true})));form.append(actions);form.addEventListener('submit',e=>e.preventDefault());body.append(form);
}
function addLine(){
 const body=dialog('Add a statement line','NEW LINE'),form=el('form',undefined,'edit-form');
 const name=field(form,'Line name',textInput(''));const kind=field(form,'Section',selectInput([['expense','Expenses'],['income','Income'],['review','Review only']], 'expense'));const group=field(form,'Group',textInput('Other expenses'));const amount=field(form,'Monthly amount ($)',amountInput(0));
 form.append(button('Add line',()=>save({type:'addLine',line:{key:'custom_'+crypto.randomUUID(),name:name.value,kind:kind.value,group:group.value,method:'fixed',base:amountValue(amount)??0,month:1,anchor:null,note:'User-entered budget line.',hidden:false}}),'primary'));form.addEventListener('submit',e=>e.preventDefault());body.append(form);
}
function addTransaction(){
 const body=dialog('Add a transaction','MANUAL ACTUAL'),form=el('form',undefined,'edit-form');const name=field(form,'Merchant / description',textInput(''));const date=field(form,'Date',textInput(state.source.asOf,'date'));const account=field(form,'Account label',textInput('Manual entry'));const amount=field(form,'Bank-signed amount ($)',amountInput(0));const key=field(form,'Statement line',selectInput(state.lines.filter(r=>!r.hidden).map(r=>[r.key,r.kind.toUpperCase()+' · '+r.name]),state.lines[0].key),true);
 const note=field(form,'Note',textInput('User-entered transaction.'),true);form.append(button('Add posted transaction',()=>save({type:'addTransaction',transaction:{id:'manual_'+crypto.randomUUID(),date:date.value,account:account.value,name:name.value,merchant:name.value,amount:amountValue(amount),pending:false,key:key.value,note:note.value,category:'manual',confidence:'User entered',link:''}}),'primary'));form.addEventListener('submit',e=>e.preventDefault());body.append(el('p','Use a positive amount for an expense and a negative amount for income or a refund. Manual transactions are retained when connected accounts refresh.'),form);
}
function settings(){
 const body=dialog('Opening bank balance','PLANNING CASH — NOT INCOME'),form=el('form',undefined,'edit-form');const amount=field(form,'Combined starting bank balance ($)',amountInput(state.config.openingBank));const date=field(form,'Opening balance date',textInput(state.config.openingDate,'date'));const start=field(form,'First budget month',textInput(state.config.forecastStart,'month'));start.addEventListener('change',()=>{date.value=start.value+'-01';});
 form.append(button('Save opening balance',()=>save({type:'config',openingBank:amountValue(amount),openingDate:date.value,forecastStart:start.value}),'primary'));form.addEventListener('submit',e=>e.preventDefault());body.append(el('p',state.config.openingNote),el('p','The bank roll-forward starts with this amount in the first budget month. It does not add past receipts or subtract previously paid bills again. Set the date to the beginning of that budget month.'),form);
}
function review(){
 const body=dialog('Review & restore','SOURCE RECORDS ARE RETAINED');body.append(el('p','Review-only transactions and excluded lines do not change the P&L until you assign or restore them. An unverified bill with a zero budget does not mean it was canceled.'));
 const hidden=state.lines.filter(r=>r.hidden);if(hidden.length){body.append(el('h3','Deleted / excluded lines'),table(['Line','Action'],hidden.map(r=>[r.name,button('Edit / restore',()=>editLine(r.key))])));}
 const unverified=state.lines.filter(r=>r.review&&!r.hidden);if(unverified.length){body.append(el('h3','Assumptions needing review'),table(['Line','Assumption',''],unverified.map(r=>[r.name,r.note,button('Edit',()=>editLine(r.key))])));}
 body.append(el('h3','Unclassified receipts, transfers & excluded records'));showTransactions(body,calc.transactions.filter(t=>t.excluded||calc.byKey[t.key]?.hidden||calc.byKey[t.key]?.kind==='review'));
}
function downloadFile(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function exportPL(){
 const headers=['Income / expense',...calc.columns.map(c=>monthLabel(c.month)+' '+c.type),'12-month budget total'];
 const rows=[headers];const push=(name,values,total)=>rows.push([name,...values.map(n=>(n/100).toFixed(2)),(total/100).toFixed(2)]);
 rows.push(['INCOME']);calc.rows.filter(r=>r.kind==='income'&&!r.hidden).forEach(r=>push(r.name,r.values,r.total));push('TOTAL INCOME',calc.income,calc.forecastIncome);rows.push(['EXPENSES']);calc.rows.filter(r=>r.kind==='expense'&&!r.hidden).forEach(r=>push(r.name,r.values,r.total));push('TOTAL EXPENSES',calc.expenses,calc.forecastExpenses);push('PROFIT / (LOSS)',calc.profit,calc.forecastProfit);
 const csv=rows.map(r=>r.map(v=>{let x=String(v??'');if(/^[=+\-@\t\r]/.test(x)&&!/^[-]?\d+(?:\.\d+)?$/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"';}).join(',')).join('\r\n');downloadFile('Household-P-and-L.csv',csv,'text/csv;charset=utf-8');
}
function importActuals(){
 const body=dialog('Import actual transactions','MERGE — KEEPS YOUR EDITS');body.append(el('p','Choose a prepared weekly-import JSON or encrypted import. Records are matched by stable transaction IDs. This does not overwrite your budget overrides or manually excluded transactions.'));
 const input=document.createElement('input');input.type='file';input.accept='.json,application/json';body.append(input,button('Import selected file',async()=>{try{if(!input.files[0])throw Error('Choose an import file.');const payload=JSON.parse(await input.files[0].text());const d=await request('import','POST',{revision:state.revision,payload});apply(d);$('details').close();}catch(e){$('dialogMessage').textContent=e.message;}},'primary'));
}
$('closeDialog').addEventListener('click',()=>$('details').close());$('periodSelect').addEventListener('change',e=>{view=e.target.value;render();});
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('loginMessage').textContent='';try{await request('login','POST',{password:$('password').value});$('password').value='';const d=await request('state');if(innerWidth<850)view=d.state.source.asOf.slice(0,7)+'|actual';apply(d);}catch(e){$('loginMessage').textContent=e.message;}finally{b.disabled=false;}});
$('refresh').addEventListener('click',async()=>{try{$('refresh').disabled=true;apply(await request('refresh','POST',{}));}catch(e){$('saveMessage').textContent=e.message;}finally{$('refresh').disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await request('logout','POST',{});}finally{showLogin();}});
$('settings').addEventListener('click',settings);$('addLine').addEventListener('click',addLine);$('addTransaction').addEventListener('click',addTransaction);$('review').addEventListener('click',review);$('download').addEventListener('click',exportPL);$('import').addEventListener('click',importActuals);
$('backup').addEventListener('click',async()=>{try{const b=await request('backup');downloadFile('Private-Household-Backup.json',JSON.stringify(b),'application/json');$('saveMessage').textContent='Private backup downloaded. Keep it secure.';}catch(e){$('saveMessage').textContent=e.message;}});
try{const status=await request('status');if(status.authenticated){const d=await request('state');if(innerWidth<850)view=d.state.source.asOf.slice(0,7)+'|actual';apply(d);}else if(!status.ready)$('loginMessage').textContent=status.message;}catch(e){$('loginMessage').textContent=e.message;}

// Refresh open sheets without interrupting edits; the server merges imports by stable ID.
setInterval(async()=>{if(!state||busy||document.hidden||$('details').open)return;try{const d=await request('state');if(d.state.revision!==state.revision)apply(d);}catch{}},300000);
