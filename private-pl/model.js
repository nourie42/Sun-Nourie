// Shared, dependency-free household statement engine. All money is integer cents.
export const VERSION = 1;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const copy = x => JSON.parse(JSON.stringify(x));
const dateOK = s => typeof s==='string' && /^20\d\d-\d\d-\d\d$/.test(s) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
export const monthOK = s => typeof s==='string' && /^20\d\d-(0[1-9]|1[0-2])$/.test(s);
export const moneyOK = v => Number.isSafeInteger(v) && Math.abs(v)<=100000000000;
export const cash = v => v===0 ? '—' : (v<0?'(':'')+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Math.abs(v)/100)+(v<0?')':'');
export function shiftMonth(m,n) { const [y,a]=m.split('-').map(Number); return new Date(Date.UTC(y,a-1+n,1)).toISOString().slice(0,7); }
export const monthDays = m => new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).getUTCDate();
const norm = v => String(v||'').toLowerCase().trim().replace(/\d+/g,'#');
export function effectiveTransactions(s) {
 return s.transactions.map(raw=>{
  const edit=s.transactionEdits[raw.id]||{};
  const t={...raw,...edit,id:raw.id,rawAmount:raw.amount,edited:!!Object.keys(edit).length};
  const line=s.lines.find(r=>r.key===t.key);
  t.modelAmount=(line?.kind==='income' || ['UNKNOWN_IN','NCSTATE','DISPUTE','UNKNOWN_CARD_CREDIT'].includes(t.key))?-t.amount:t.amount;
  return t;
 });
}
export function payrollDates(line,month) {
 if(!dateOK(line.anchor)) return [];
 let at=new Date(line.anchor+'T12:00:00Z'); const start=new Date(month+'-01T00:00:00Z');
 const end=new Date(shiftMonth(month,1)+'-01T00:00:00Z'); const interval=14*86400000;
 at=new Date(at.getTime()+Math.max(0,Math.ceil((start-at)/interval))*interval);
 const result=[]; while(at<end){if(at>=start)result.push(at.toISOString().slice(0,10));at=new Date(at.getTime()+interval);} return result;
}
function lineSum(tx,key,month,pending=false) {
 return tx.filter(t=>!t.excluded&&t.key===key&&t.date.slice(0,7)===month&&t.pending===pending).reduce((a,t)=>a+t.modelAmount,0);
}
export function calculate(s) {
 const tx=effectiveTransactions(s), current=s.source.asOf.slice(0,7), previous=shiftMonth(current,-1);
 const observed=s.source.observedThrough?.slice(0,7)===current?Number(s.source.observedThrough.slice(8)):0;
 const seen=Math.max(0,Math.min(observed,monthDays(current)));
 const columns=[{id:previous+'|actual',month:previous,type:'actual',label:previous+' actual'},
  {id:current+'|actual',month:current,type:'actual',label:current+' posted'},
  {id:current+'|estimate',month:current,type:'estimate',label:current+' estimate'},
  ...Array.from({length:12},(_,i)=>({id:shiftMonth(s.config.forecastStart,i)+'|budget',month:shiftMonth(s.config.forecastStart,i),type:'budget',label:shiftMonth(s.config.forecastStart,i)+' budget'}))];
 const byKey={};
 for(const line of s.lines){
  const prev=lineSum(tx,line.key,previous), posted=lineSum(tx,line.key,current), pending=lineSum(tx,line.key,current,true);
  const sofar=posted+pending;
  let base=line.base;
  let estimate=sofar;
  if(line.method==='variable'||line.method==='variable_new'){
   estimate=sofar+Math.round((prev+sofar)/(monthDays(previous)+seen)*(monthDays(current)-seen));
   base=line.method==='variable_new'&&prev===0?estimate:Math.round((prev+estimate)/2);
  } else if(line.method==='average'){
   const samples=[prev,sofar].filter(v=>v!==0);base=samples.length?Math.round(samples.reduce((a,b)=>a+b,0)/samples.length):line.base;
  }
  if(moneyOK(line.overrideBase))base=line.overrideBase;
  const forecast=month=>{
   const id=line.key+'|'+month;
   if(own(s.overrides,id))return s.overrides[id].amount;
   if(line.method==='none')return 0;
   if(line.method==='annual')return Number(month.slice(5))===line.month?base:0;
   if(line.method==='biweekly')return payrollDates(line,month).length*base;
   return base;
  };
  if(!['variable','variable_new','none'].includes(line.method))estimate=base<0?Math.min(sofar,forecast(current)):Math.max(sofar,forecast(current));
  const values=columns.map(c=>c.type==='actual'?lineSum(tx,line.key,c.month):c.type==='estimate'?estimate:forecast(c.month));
  byKey[line.key]={...line,baseUsed:base,prev,posted,pending,estimate,values,total:values.slice(3).reduce((a,b)=>a+b,0)};
 }
 const rows=s.lines.map(r=>byKey[r.key]);
 const totalKind=kind=>columns.map((c,i)=>rows.filter(r=>!r.hidden&&r.kind===kind).reduce((a,r)=>a+r.values[i],0));
 const income=totalKind('income'),expenses=totalKind('expense'),profit=income.map((n,i)=>n-expenses[i]);
 let bank=s.config.openingBank;
 const bankRows=columns.slice(3).map((c,j)=>{const opening=bank;bank+=profit[j+3];return {month:c.month,opening,change:profit[j+3],closing:bank};});
 return {columns,rows,byKey,income,expenses,profit,bankRows,transactions:tx,previous,current,seen,
  forecastIncome:income.slice(3).reduce((a,b)=>a+b,0),forecastExpenses:expenses.slice(3).reduce((a,b)=>a+b,0),
  forecastProfit:profit.slice(3).reduce((a,b)=>a+b,0)};
}
export function drilldown(s,key,columnId) {
 const c=calculate(s);const col=c.columns.find(x=>x.id===columnId);
 if(!col)throw Error('Choose a statement column.');
 const includeLine=r=>!r.hidden&&(key==='TOTAL_INCOME'?r.kind==='income':key==='TOTAL_EXPENSES'?r.kind==='expense':key==='PROFIT'?['income','expense'].includes(r.kind):r.key===key);
 const lines=c.rows.filter(includeLine),keys=new Set(lines.map(r=>r.key));
 const idx=c.columns.indexOf(col);const contribution=r=>key==='PROFIT'&&r.kind==='expense'?-r.values[idx]:r.values[idx];
 const amount=lines.reduce((a,r)=>a+contribution(r),0);
 const scope=col.type==='actual'?[col.month]:[c.previous,c.current];
 const transactions=c.transactions.filter(t=>!t.excluded&&keys.has(t.key)&&scope.includes(t.date.slice(0,7))&&(col.type!=='actual'||!t.pending));
 const evidenceTotal=transactions.reduce((a,t)=>a+(key==='PROFIT'&&c.byKey[t.key]?.kind==='expense'?-t.modelAmount:t.modelAmount),0);
 const basis=lines.map(r=>({name:r.name,key:r.key,method:r.method,base:r.baseUsed,amount:r.values[idx],note:r.note,
  dates:r.method==='biweekly'?payrollDates(r,col.month):[],override:s.overrides[r.key+'|'+col.month]||null}));
 return {key,column:col,amount,transactions,evidenceTotal,basis,
  explanation:col.type==='actual'?'The included posted transactions sum to this amount.':col.type==='estimate'?'Full-month estimate: posted activity, pending items, and the remaining planned amount. Supporting transactions are not added a second time.':'Budget, not a future transaction. The supporting historical transactions and calculation basis are shown below.'};
}
function validLine(r){
 if(!r||typeof r.key!=='string'||(!/^[A-Za-z0-9_-]{1,80}$/.test(r.key)||['__proto__','constructor','prototype'].includes(r.key))||typeof r.name!=='string'||!r.name.trim()||r.name.length>180)throw Error('Invalid line name or identifier.');
 if(!['income','expense','review'].includes(r.kind)||!['fixed','variable','variable_new','average','annual','biweekly','none'].includes(r.method))throw Error('Invalid line type.');
 if(!moneyOK(r.base)||r.overrideBase!=null&&!moneyOK(r.overrideBase))throw Error('Invalid amount.');
 if(typeof r.group!=='string'||r.group.length>100||typeof r.note!=='string'||r.note.length>6000)throw Error('Invalid line description.');
 if(r.method==='annual'&&(!Number.isInteger(r.month)||r.month<1||r.month>12))throw Error('Choose an annual month.');
 if(r.method==='biweekly'&&!dateOK(r.anchor))throw Error('Choose a valid payroll anchor date.');
}
function validTxn(t){
 if(!t||typeof t.id!=='string'||!/^(?:[a-f0-9]{24}|manual_[A-Za-z0-9_-]{1,80})$/.test(t.id)||!dateOK(t.date)||!moneyOK(t.amount)||typeof t.pending!=='boolean')throw Error('Invalid transaction.');
 for(const k of ['account','merchant','name'])if(typeof t[k]!=='string'||t[k].length>600)throw Error('Invalid transaction text.');
}
export function validateState(s){
 if(s?.version!==1||!Array.isArray(s.lines)||s.lines.length>400||!Array.isArray(s.transactions)||s.transactions.length>30000)throw Error('Invalid or oversized statement.');
 if(!monthOK(s.config?.forecastStart)||!moneyOK(s.config?.openingBank)||!dateOK(s.config?.openingDate))throw Error('Invalid starting balance or forecast period.');
 if(s.config.openingDate!==s.config.forecastStart+'-01')throw Error('Set the opening balance date to the first day of the first budget month.');
 if(!dateOK(s.source?.asOf)||!dateOK(s.source?.postedThrough)||!dateOK(s.source?.observedThrough))throw Error('Invalid coverage dates.');
 s.lines.forEach(validLine);s.transactions.forEach(validTxn);
 const keys=new Set(s.lines.map(r=>r.key));if(keys.size!==s.lines.length||new Set(s.transactions.map(t=>t.id)).size!==s.transactions.length)throw Error('Duplicate identifiers.');
 if(s.transactions.some(t=>!keys.has(t.key)))throw Error('Transaction category missing.');
 if(!s.overrides||!s.transactionEdits||!Array.isArray(s.audit)||!Array.isArray(s.appliedImports))throw Error('Incomplete statement.');
 for(const [id,o]of Object.entries(s.overrides))if(!keys.has(id.split('|')[0])||!monthOK(id.split('|')[1])||!moneyOK(o.amount))throw Error('Invalid budget override.');
 return s;
}
export function mutate(s,op){
 const n=copy(s);const line=n.lines.find(r=>r.key===op.key);
 if(op.type==='budget'){
  if(!line||!monthOK(op.month))throw Error('Choose a valid line and month.');
  const id=op.key+'|'+op.month;
  if(op.amount===null)delete n.overrides[id];else {if(!moneyOK(op.amount))throw Error('Invalid budget amount.');n.overrides[id]={amount:op.amount,note:String(op.note||'').slice(0,1200)};}
 }else if(op.type==='line'){
  const fields=['name','kind','group','method','base','month','anchor','note','overrideBase','hidden'];
  if(!line)throw Error('Line not found.');for(const k of fields)if(own(op,k))line[k]=op[k];validLine(line);
 }else if(op.type==='addLine'){
  if(n.lines.some(r=>r.key===op.line.key))throw Error('This line already exists.');validLine(op.line);n.lines.push({...op.line,hidden:false});
 }else if(op.type==='transaction'){
  if(!n.transactions.some(t=>t.id===op.id))throw Error('Transaction not found.');
  const edit={...n.transactionEdits[op.id]};
  for(const k of ['key','amount','date','name','excluded','note'])if(own(op,k))edit[k]=op[k];
  if(own(edit,'key')&&!n.lines.some(r=>r.key===edit.key)||own(edit,'amount')&&!moneyOK(edit.amount)||own(edit,'date')&&!dateOK(edit.date)||own(edit,'excluded')&&typeof edit.excluded!=='boolean')throw Error('Invalid transaction correction.');
  for(const k of ['name','note'])if(own(edit,k)&&(typeof edit[k]!=='string'||edit[k].length>1200))throw Error('Invalid transaction note.');
  if(op.restore===true)delete n.transactionEdits[op.id];else n.transactionEdits[op.id]=edit;
 }else if(op.type==='addTransaction'){
  validTxn(op.transaction);if(!op.transaction.id.startsWith('manual_')||n.transactions.some(t=>t.id===op.transaction.id)||!n.lines.some(r=>r.key===op.transaction.key))throw Error('Invalid manual transaction.');n.transactions.push({...op.transaction,manual:true});
 }else if(op.type==='config'){
  for(const k of ['openingBank','openingDate','forecastStart'])if(own(op,k))n.config[k]=op[k];
 }else throw Error('Unknown change.');
 n.audit.push({at:new Date().toISOString(),action:op.type,key:op.key||op.id||'',previousRevision:s.revision});n.audit=n.audit.slice(-500);
 return validateState(n);
}
function classify(s,t){
 const category=t.category||'',merchant=norm(t.merchant),raw=String(t.name||'').toLowerCase();
 const has=k=>s.lines.some(r=>r.key===k);
 const expenseCategory=category&&!category.startsWith('transfers_')&&!category.startsWith('income_')&&!category.startsWith('other_');
 if((category.includes('account_transfer')||category.includes('savings_transfer')||category.includes('wire_transfer'))&&has('OTHER_TRANSFERS'))return 'OTHER_TRANSFERS';
 const rules=(s.rules||[]).filter(r=>r.merchant===merchant&&(r.amount===undefined||r.amount===t.amount));
 if(rules.length===1&&has(rules[0].key))return rules[0].key;
 if(category.includes('credit_card_payment')&&has('CARD_TRANSFERS'))return 'CARD_TRANSFERS';
 if(t.link&&!expenseCategory&&has('OTHER_TRANSFERS'))return 'OTHER_TRANSFERS';
 if(category.includes('investment_retirement_transfer')&&has('INVEST_TRANSFER'))return 'INVEST_TRANSFER';
 if(t.amount<0&&(raw==='payment'||raw.includes('dispute'))&&has(raw.includes('dispute')?'DISPUTE':'UNKNOWN_CARD_CREDIT'))return raw.includes('dispute')?'DISPUTE':'UNKNOWN_CARD_CREDIT';
 if(merchant==='walmart'&&t.amount>30000&&has('GROCERIES'))return 'GROCERIES';
 const match=s.categoryRules?.[category];if(match&&has(match)&&expenseCategory)return match;
 if(t.amount<0&&has('UNKNOWN_IN'))return 'UNKNOWN_IN';
 return has('OTHER_REVIEW')?'OTHER_REVIEW':s.lines.find(r=>r.kind==='review').key;
}
export function mergeImport(s,p){
 if(p?.version!==1||p.kind!=='transactions'||typeof p.id!=='string'||!dateOK(p.source?.asOf)||!Array.isArray(p.transactions)||p.transactions.length>30000)throw Error('Invalid import.');
 if(s.appliedImports.includes(p.id))return s;
 if(p.source.asOf<s.source.asOf)throw Error('Older snapshots cannot replace newer actuals.');
 const n=copy(s);const index=new Map(n.transactions.map(t=>[t.id,t]));const retiredPending=new Set();
 for(const raw of p.transactions){
  validTxn(raw);const old=index.get(raw.id);if(old?.manual)throw Error('Import cannot overwrite a manual record.');
  let pendingId=raw.pendingId;
  if(!raw.pending&&!pendingId&&!old){
   const nearby=t=>t.pending&&!t.manual&&t.account===raw.account&&norm(t.merchant)===norm(raw.merchant)&&t.amount===raw.amount&&Math.abs(new Date(t.date)-new Date(raw.date))<=7*86400000;
   const candidates=[...index.values()].filter(nearby);
   const competing=p.transactions.filter(t=>!t.pending&&t.account===raw.account&&norm(t.merchant)===norm(raw.merchant)&&t.amount===raw.amount&&Math.abs(new Date(t.date)-new Date(raw.date))<=7*86400000);
   if(candidates.length===1&&competing.length===1)pendingId=candidates[0].id;
  }
  const priorKey=old?.key;const t={...raw,key:priorKey||classify(n,raw),manual:false};
  t.note=old?.note||'Imported financial record. Automatic category assignment; review the purpose when uncertain.';
  if(pendingId&&index.get(pendingId)?.pending){
   if(n.transactionEdits[pendingId]&&!n.transactionEdits[t.id])n.transactionEdits[t.id]=n.transactionEdits[pendingId];
   t.key=priorKey||index.get(pendingId).key;retiredPending.add(pendingId);index.delete(pendingId);
  }
  index.set(t.id,t);
 }
 for(const id of retiredPending)index.delete(id);
 // Pending deletion is allowed only for an explicit complete account/range snapshot.
 if(p.pendingComplete===true&&Array.isArray(p.coveredAccounts)&&dateOK(p.period?.start)&&dateOK(p.period?.end)){
  const incoming=new Set(p.transactions.map(t=>t.id));
  for(const [id,t]of index)if(t.pending&&!t.manual&&p.coveredAccounts.includes(t.account)&&t.date>=p.period.start&&t.date<=p.period.end&&!incoming.has(id))index.delete(id);
 }
 n.transactions=[...index.values()];n.source={...s.source,...p.source};
 n.appliedImports=[...s.appliedImports,p.id].slice(-200);n.audit.push({at:new Date().toISOString(),action:'weekly import',count:p.transactions.length});n.audit=n.audit.slice(-500);
 return validateState(n);
}
