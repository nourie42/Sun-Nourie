// Parse explicit NWS snow-phase clock clauses. Unsupported wording keeps the
// forecast period as a broad window; no unmentioned clock time is invented.
const HOUR=3600000,DAY=24*HOUR;
const SNOW=/snow|flurr|blizzard/i;
const CLOCK='(?:\\d{1,2}(?::\\d{2})?\\s*[ap]m|midnight|noon)';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const overlap=(a,b)=>a.start<b.end&&a.end>b.start;
function clockParts(text){
 const s=text.toLowerCase().replace(/\s/g,'');
 if(s==='midnight')return {hour:0,minute:0};if(s==='noon')return {hour:12,minute:0};
 const m=/^(\d{1,2})(?::(\d{2}))?([ap])m$/.exec(s);if(!m||+m[1]<1||+m[1]>12||+(m[2]||0)>59)return null;
 return {hour:+m[1]%12+(m[3]==='p'?12:0),minute:+(m[2]||0)};
}
function clockResolver(start,end,zone){
 const format=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const parts=time=>Object.fromEntries(format.formatToParts(new Date(time)).filter(p=>p.type!=='literal').map(p=>[p.type,+p.value]));
 const wall=p=>Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
 const offsets=new Set(),dates=new Set();
 for(let time=start-DAY;time<=end+DAY;time+=6*HOUR){const p=parts(time);offsets.add(wall(p)-time);dates.add(`${p.year}-${p.month}-${p.day}`);}
 return (text,after=start,{strict=false}={})=>{
  const clock=clockParts(text);if(!clock)return null;
  const candidates=[];
  for(const date of dates){const [year,month,day]=date.split('-').map(Number),local=Date.UTC(year,month-1,day,clock.hour,clock.minute);
   for(const offset of offsets){const time=local-offset,p=parts(time);if(p.year===year&&p.month===month&&p.day===day&&p.hour===clock.hour&&p.minute===clock.minute)candidates.push(time);}
  }
  const unique=[...new Set(candidates)].sort((a,b)=>a-b),inside=unique.filter(time=>time>=after+(strict?1:0)&&time<=end);
  if(inside.length){const first=inside[0];return {early:first,late:inside.filter(time=>time-first<=2*HOUR).at(-1)};}
  // A skipped spring-DST clock has no matching occurrence on the relevant
  // local date. Falling back is safer than shifting it to a guessed 3am.
  const nearby=unique.filter(time=>time>=after&&time<=end+6*HOUR);
  if(nearby.length)return {early:nearby[0],late:nearby[0]};
  return null;
 };
}
export function nwsSnowPhaseWindows(period,zone='America/New_York'){
 const start=Date.parse(period?.startTime||period?.start),end=Date.parse(period?.endTime||period?.end);
 const text=String(period?.detailedForecast||period?.detail||''),short=String(period?.shortForecast||period?.wording||'');
 if(!finite(start)||!finite(end)||end<=start||end-start>3*DAY)return {windows:[],timed:false};
 const base=[{start,end}];if(!SNOW.test(text+' '+short))return {windows:[],timed:false};
 try{
  const resolve=clockResolver(start,end,zone),normalized=text.replace(/\b([ap])\s*\.\s*m\s*\.?/gi,'$1m');
  const clauses=normalized.split(/(\bthen\b|[.;])/i),windows=[];let boundary=null,inherit=null,timed=false,snowClause=false;
  for(const clause of clauses){
   if(/^then$/i.test(clause)){inherit=boundary;continue;}if(/^[.;]$/.test(clause)){inherit=null;boundary=null;continue;}
   if(!clause.trim())continue;
   const hasSnow=SNOW.test(clause)&&!/(?:snow|flurr\w*)\s+accumulation/i.test(clause),lower=inherit?.early??start;
   let a=lower,b=end,matched=false;
   const between=new RegExp(`\\bbetween\\s+(${CLOCK})\\s+and\\s+(${CLOCK})`,'i').exec(clause);
   const before=new RegExp(`\\b(?:before|until)\\s+(${CLOCK})`,'i').exec(clause);
   const after=new RegExp(`\\bafter\\s+(${CLOCK})`,'i').exec(clause);
   if(between){const from=resolve(between[1],lower),through=from&&resolve(between[2],from.early,{strict:true});if(!from||!through)return {windows:base,timed:false};a=from.early;b=through.late;boundary=through;matched=true;}
   else if(before){const through=resolve(before[1],lower,{strict:true});if(!through)return {windows:base,timed:false};b=through.late;boundary=through;matched=true;}
   else if(after){const from=resolve(after[1],lower);if(!from)return {windows:base,timed:false};a=from.early;boundary=null;matched=true;}
   else boundary=null;
   if(hasSnow){snowClause=true;timed||=matched||!!inherit;const row={start:Math.max(start,a),end:Math.min(end,b)};if(row.end>row.start)windows.push(row);}
   inherit=null;
  }
  if(!snowClause)return {windows:base,timed:false};
  const merged=windows.filter(row=>overlap(row,{start,end})).sort((a,b)=>a.start-b.start).reduce((rows,row)=>{const last=rows.at(-1);if(last&&row.start<=last.end)last.end=Math.max(last.end,row.end);else rows.push({...row});return rows;},[]);
  return {windows:merged,timed};
 }catch{return {windows:base,timed:false};}
}
