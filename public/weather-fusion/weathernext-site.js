import {HOUR,finite,escapeHTML as esc,convert,format,value,localDate,timeLabel,rowsFor,validateFeed,direction,daysFrom,csvText} from './weathernext-data.js?v=wn-site-v1';
const FEED='https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
const $=id=>document.getElementById(id);
const SOURCE_NAMES={surface:'Main surface forecast',station:'Station-trained forecast',interimSurface:'Latest short-range surface run',interimStation:'Latest short-range station run',previousSurface:'Previous main surface run'};
let feed=null,catalog=null,pointId=null,sourceId='surface',day=null,hourIndex=0,fieldId='temperature_2m',statistic='mean',busy=false;
const source=()=>feed.sources[sourceId];
const point=()=>feed.points.find(p=>p.id===pointId)||feed.points[0];
const zone=()=>point().timeZone||'America/New_York';
let indexes=new Map();
function indexedRows(id){return indexes.get(`${id}:${pointId}`)?.rows||[];}
const allRows=()=>indexedRows(sourceId);
const visibleRows=()=>allRows().filter(r=>!day||localDate(Date.parse(r.time)-1,zone())===day);
const field=()=>catalog.fields.find(f=>f.id===fieldId)||catalog.fields[0];
const fieldSource=f=>f.grid==='station'?(sourceId==='interimSurface'?'interimStation':sourceId==='previousSurface'?'previousStation':'station'):sourceId;
const fieldRow=(f,t)=>indexes.get(`${fieldSource(f)}:${pointId}`)?.byTime.get(t);
const fieldValue=(id,time,stat='mean')=>{const f=catalog.fields.find(x=>x.id===id);return f?value(fieldRow(f,time),f,stat):null;};
function setStatus(message,warning=false){$('status').textContent=message;$('status').classList.toggle('warning',warning);}
function activate(){
 indexes=new Map();
 for(const [id,src] of Object.entries(feed.sources)){for(const p of src.points||[]){const rows=rowsFor(feed,id,p.id);indexes.set(`${id}:${p.id}`,{rows,byTime:new Map(rows.map(r=>[r.time,r]))});}}
 const requested=new URLSearchParams(location.search).get('location');
 if(!pointId||!feed.points.some(p=>p.id===pointId)) pointId=feed.points.some(p=>p.id===requested)?requested:feed.points[0].id;
 $('location').innerHTML=feed.points.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');$('location').value=pointId;$('location').disabled=false;
 const choices=['surface','interimSurface','previousSurface'].filter(id=>feed.sources[id]?.points?.some(p=>p.hourly?.length));
 if(!choices.includes(sourceId))sourceId='surface';
 $('run').innerHTML=choices.map(id=>`<option value="${id}">${esc(SOURCE_NAMES[id])}</option>`).join('');$('run').value=sourceId;$('run').disabled=false;
 const groups=[...new Set(catalog.fields.map(f=>f.group))];
 $('variable').innerHTML=groups.map(g=>`<optgroup label="${esc(g)}">${catalog.fields.filter(f=>f.group===g).map(f=>`<option value="${esc(f.id)}">${esc(f.label)} (${esc(f.unit)})</option>`).join('')}</optgroup>`).join('');$('variable').value=fieldId;
 $('forecast').hidden=false;day=null;selectFirstFuture();render();
}
function selectFirstFuture(){const rows=visibleRows();const n=rows.findIndex(r=>Date.parse(r.time)>=Date.now());hourIndex=n<0?Math.max(0,rows.length-1):n;}
function render(){
 const rows=visibleRows();hourIndex=Math.max(0,Math.min(hourIndex,rows.length-1));const src=source(),loc=point();
 $('location-title').textContent=loc.name;
 const published=src.points?.find(p=>p.id===pointId);
 $('coverage').textContent=`Published point: ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)} · ${src.gridResolutionDegrees}° surface grid${finite(published?.gridLatitude)&&finite(published?.gridLongitude)?` · grid center ${published.gridLatitude.toFixed(3)}, ${published.gridLongitude.toFixed(3)}`:''}. Choose one of the collected locations above; global maps are linked below.`;
 const ds=daysFrom(allRows(),zone());
 $('outlook-title').textContent=`Daily forecast · ${ds.length} calendar days available`;
 $('days').innerHTML=ds.map(d=>`<button class="day" type="button" data-day="${d.date}" aria-pressed="${day===d.date}"><strong>${esc(new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(d.date+'T12:00:00Z')))}</strong><span class="temps">${format(d.high)}°<i>${format(d.low)}°</i></span><span>${format(d.rain,'rain')} in mean rain</span><span>${format(d.wind)} mph max</span><small>${d.partial?`Partial · ${d.coverage}/${d.expected} hours`:'Full local day'}</small></button>`).join('')||'<p class="muted">This published run has no future daily coverage.</p>';
 $('days').querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>{day=b.dataset.day;selectFirstFuture();render();$('explorer').scrollIntoView({behavior:'smooth',block:'start'});}));
 $('hour').max=String(Math.max(0,rows.length-1));$('hour').value=String(hourIndex);$('hour').disabled=!rows.length;
 $('run-stamp').textContent=`Initialized ${timeLabel(src.runAt,zone())}. Collected ${timeLabel(src.fetchedAt,zone())}. Published lead time: ${src.horizonHours??'—'} hours. Summary uses ensemble means.`;
 const f=field(),fs=feed.sources[fieldSource(f)];
 $('field-description').textContent=f.description;
 $('field-source').textContent=fs?.runAt?`${fs.gridResolutionDegrees}° ${f.grid==='station'?'station-trained':'gridded'} model · initialized ${timeLabel(fs.runAt,zone())}. ${day?'Selected local day':'Full published run'}.`:'No matching source is published for this variable and run.';
 $('download-csv').disabled=!indexedRows(fieldSource(field())).length;
 renderReadout();renderChart();renderTable();renderSources();
 const age=(Date.now()-Date.parse(src.runAt))/HOUR,stale=Date.now()-Date.parse(src.fetchedAt)>6*HOUR||age>36||src.status!=='ready';
 setStatus(stale?'Showing the last published forecast. Check initialization and collection times below; this run may be old.':`Published Google forecast loaded · ${src.fields.length} surface fields · ${feed.ensembleMembers} ensemble members represented by six statistics.`,stale);
}
function renderReadout(){
 const rows=visibleRows(),r=rows[hourIndex];if(!r)return;
 const t=r.time,f=field(),fr=fieldRow(f,t),v=(id,s='mean')=>fieldValue(id,t,s);
 $('valid-time').textContent=timeLabel(t,zone());$('conditions-time').textContent=timeLabel(t,zone());$('hour-label').textContent=timeLabel(t,zone());
 $('hour').setAttribute('aria-valuetext',timeLabel(t,zone()));
 $('temperature').textContent=format(v('temperature_2m'));
 $('temperature-range').textContent=`Hourly P10–P90 range: ${format(v('temperature_2m','p10'))}° to ${format(v('temperature_2m','p90'))}°F`;
 const cards=[['Dew point',v('dewpoint_temperature_2m'),'°F','temperature'],['Surface wind',v('wind_speed_10m'),'mph','speed'],['Precipitation · preceding hour',v('total_precipitation_1hr'),'in','rain'],['Cloud cover',v('total_cloud_cover'),'%','fraction']];
 $('hero-metrics').innerHTML=cards.map(([label,n,unit,kind])=>`<div class="metric"><span>${esc(label)}</span><strong>${format(n,kind)}</strong><small>${unit}</small></div>`).join('');
 $('percentiles').innerHTML=catalog.statistics.map(s=>`<div class="stat${s===statistic?' active':''}"><span>${s==='mean'?'Mean':s==='p50'?'P50 · median':s.toUpperCase()}</span><b>${format(value(fr,f,s),f.kind)}</b></div>`).join('');
 const groups=[...new Set(catalog.fields.map(x=>x.group))];
 $('condition-groups').innerHTML=groups.map(g=>{
  const fields=catalog.fields.filter(f=>f.group===g),extra=g==='Wind'?[10,100].map(h=>{const d=direction(v('u_component_of_wind_'+h+'m'),v('v_component_of_wind_'+h+'m'));return `<div><dt>Direction from · ${h}m</dt><dd>${d?`${d.compass} · ${Math.round(d.degrees)}°`:'—'}</dd></div>`;}).join(''):'';
  const note=g==='Wind'?'Direction is derived from mean U/V components. Gust speed is not supplied.':g==='Precipitation'?'Three different model training targets; not three observations or additive rain amounts.':g==='Solar'?'Hourly average irradiance. Solar radiation is not UV index.':g==='Station-trained'?'May use a different initialization from the gridded surface run; see the source timestamps.':'All values shown here are ensemble means.';
  return `<article class="condition-group"><h3>${esc(g)}</h3><dl>${fields.map(f=>`<div><dt>${esc(f.label)}</dt><dd>${format(v(f.id),f.kind)} <small>${esc(f.unit)}</small></dd></div>`).join('')}${extra}</dl><p>${note}</p></article>`;
 }).join('');
 const selected=$('hourly-table').querySelector('[aria-current=true]');if(selected)selected.removeAttribute('aria-current');$('hourly-table').querySelector(`[data-hour="${hourIndex}"]`)?.setAttribute('aria-current','true');
}
function renderChart(){
 const f=field(),rows=visibleRows(),points=rows.map(r=>{const data=fieldRow(f,r.time);return {t:Date.parse(r.time),low:value(data,f,'p10'),high:value(data,f,'p90'),q1:value(data,f,'p25'),q3:value(data,f,'p75'),center:value(data,f,statistic)};});
 const nums=points.flatMap(p=>[p.low,p.high,p.q1,p.q3,p.center]).filter(finite);
 if(!points.length||!nums.length){$('chart').innerHTML='<p class="no-data">No published values for this variable in the selected period.</p>';return;}
 const w=900,h=275,left=66,right=26,top=24,bottom=50,lo=Math.min(...nums),hi=Math.max(...nums),pad=Math.max((hi-lo)*.1,f.kind==='rain'?.005:1);
 const lower=f.kind!=='temperature'&&f.kind!=='signed-speed'?Math.max(0,lo-pad):lo-pad,upper=hi+pad;
 const start=points[0].t,end=points.at(-1).t;
 const x=t=>left+(t-start)/Math.max(HOUR,end-start)*(w-left-right),y=v=>top+(upper-v)/(upper-lower)*(h-top-bottom);
 function segments(keys){const chunks=[];let current=[];for(const p of points){if(keys.every(k=>finite(p[k]))&&(!current.length||p.t-current.at(-1).t<=HOUR*1.01)){current.push(p);}else{if(current.length)chunks.push(current);current=keys.every(k=>finite(p[k]))?[p]:[];}}if(current.length)chunks.push(current);return chunks;}
 const band=(a,b,cls)=>segments([a,b]).filter(s=>s.length>1).map(s=>`<path class="${cls}" d="M ${s.map(p=>`${x(p.t).toFixed(1)},${y(p[a]).toFixed(1)}`).join(' L ')} L ${[...s].reverse().map(p=>`${x(p.t).toFixed(1)},${y(p[b]).toFixed(1)}`).join(' L ')} Z"/>`).join('');
 const line=segments(['center']).map(s=>`<path class="center-line" d="M ${s.map(p=>`${x(p.t).toFixed(1)},${y(p.center).toFixed(1)}`).join(' L ')}"/>`).join('');
 const grid=Array.from({length:5},(_,i)=>{const v=lower+(upper-lower)*i/4,yy=y(v);return `<line class="grid" x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${format(v,f.kind)}</text>`;}).join('');
 const ticks=[0,.33,.67,1].map(a=>{const p=points[Math.round(a*(points.length-1))];return `<text x="${x(p.t)}" y="${h-18}" text-anchor="${a===0?'start':a===1?'end':'middle'}">${esc(new Intl.DateTimeFormat('en-US',{timeZone:zone(),month:'short',day:'numeric',...(day?{hour:'numeric'}:{})}).format(new Date(p.t)))}</text>`;}).join('');
 const mark=points[hourIndex];
 $('chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(f.label)} ensemble forecast. P10 to P90 and P25 to P75 bands, ${statistic==='mean'?'mean':'median'} line. Exact values in the hourly table."><title>${esc(f.label)} (${esc(f.unit)})</title>${grid}${band('low','high','band-outer')}${band('q1','q3','band-inner')}${line}${mark?`<line class="time-mark" x1="${x(mark.t)}" x2="${x(mark.t)}" y1="${top}" y2="${h-bottom}"/>`:''}${ticks}</svg>`;
}
function renderTable(){
 const f=field();$('hourly-table').innerHTML=`<table><caption>${esc(f.label)} · ${esc(f.unit)} · local valid times</caption><thead><tr><th>Valid time</th>${catalog.statistics.map(s=>`<th>${s==='mean'?'Mean':s.toUpperCase()}</th>`).join('')}</tr></thead><tbody>${visibleRows().map((r,i)=>`<tr data-hour="${i}"${i===hourIndex?' aria-current="true"':''}><td>${esc(timeLabel(r.time,zone()))}</td>${catalog.statistics.map(s=>`<td>${format(value(fieldRow(f,r.time),f,s),f.kind)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderSources(){
 $('source-cards').innerHTML=Object.entries(feed.sources).map(([id,s])=>`<article class="source-card"><strong>${esc(SOURCE_NAMES[id]||id)}</strong><p>Status: ${esc(s.status)}</p>${s.runAt?`<p>Initialized: ${esc(timeLabel(s.runAt,zone()))}</p><p>Collected: ${esc(timeLabel(s.fetchedAt,zone()))}</p><p>${s.gridResolutionDegrees}° · ${s.fields?.length||0} fields · up to ${s.horizonHours??'—'} lead hours</p><p>${esc(s.sourceTable)}</p>`:'<p>No separate usable forecast published.</p>'}${s.missingFields?.length?`<p>Not supplied: ${esc(s.missingFields.join(', '))}</p>`:''}${s.status==='last-verified'?'<p>Refresh failed. Older verified data is retained with its original timestamps.</p>':''}</article>`).join('');
}
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function load(){
 if(busy)return;busy=true;$('refresh').disabled=true;
 try{
  const [a,b]=await Promise.all([fetch(FEED,{cache:'no-store',signal:AbortSignal.timeout(25000)}),catalog?Promise.resolve(null):fetch('/weather-fusion/weathernext-catalog.json?v=wn-site-v1',{signal:AbortSignal.timeout(15000)})]);
  if(!a.ok)throw Error(`The full WeatherNext feed is not available (HTTP ${a.status}).`);
  const next=validateFeed(await a.json());if(b){if(!b.ok)throw Error('The field catalog could not be loaded.');catalog=await b.json();}
  feed=next;activate();
 }catch(error){setStatus((feed?'Refresh failed; the previously loaded forecast remains visible with its original timestamps. ':'No forecast loaded. ')+error.message+' Use Refresh data to retry.',true);}
 finally{busy=false;$('refresh').disabled=false;}
}
document.querySelector('form').addEventListener('submit',e=>e.preventDefault());
$('refresh').addEventListener('click',load);
$('location').addEventListener('change',e=>{pointId=e.target.value;day=null;selectFirstFuture();render();});
$('run').addEventListener('change',e=>{sourceId=e.target.value;day=null;selectFirstFuture();render();});
$('variable').addEventListener('change',e=>{fieldId=e.target.value;render();});
$('statistic').addEventListener('change',e=>{statistic=e.target.value;renderReadout();renderChart();});
$('all-hours').addEventListener('click',()=>{day=null;selectFirstFuture();render();});
$('hour').addEventListener('input',e=>{hourIndex=Number(e.target.value);renderReadout();renderChart();});
$('download-csv').addEventListener('click',()=>{if(feed)download(csvText(feed,fieldSource(field()),pointId,catalog.fields),`weathernext-${pointId}-${sourceId}.csv`,'text/csv;charset=utf-8');});
$('download-json').addEventListener('click',()=>{if(feed)download(JSON.stringify(feed,null,2),'weathernext-source.json','application/json');});
load();
