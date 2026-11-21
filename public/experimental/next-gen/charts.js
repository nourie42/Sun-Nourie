/** Native SVG, as used by Weather Nourie's existing charts. Curves pass through
 * every published point; missing values break the path. No data is resampled. */
import {finite,esc,formatTime,valueText,VARIABLES,MODELS,sourceRange} from './model.js';
export const COLORS={temperature:'#ffb52d',feels:'#42ddef',low:'#32d7f0',rain:'#43d7f3',precipitation:'#55badf',wind:'#edc88c',gust:'#93d2c8',humidity:'#a4d3cc',dewpoint:'#8ad7b3'};
const number=n=>Number(n.toFixed(3));
export function splitSegments(points,maxGap=Infinity){
  const groups=[];let group=[];
  for(const point of points){
    if(!finite(point?.x)||!finite(point?.y)){if(group.length)groups.push(group);group=[];continue;}
    if(group.length&&point.x-group.at(-1).x>maxGap){groups.push(group);group=[];}
    group.push(point);
  }
  if(group.length)groups.push(group);
  return groups;
}
/** Monotone cubic Hermite interpolation. Zero slopes at sign changes retain
 * temperature/rainfall extrema; the slope limiter prevents overshooting. */
export function monotonePath(points){
  if(!points.length)return '';
  if(points.length===1)return `M${number(points[0].x)},${number(points[0].y)}`;
  const slopes=points.slice(1).map((p,i)=>(p.y-points[i].y)/(p.x-points[i].x));
  const tangent=points.map((_,i)=>i===0?slopes[0]:i===points.length-1?slopes.at(-1):slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]));
  for(let i=0;i<slopes.length;i++){
    const d=slopes[i];
    if(d===0){tangent[i]=0;tangent[i+1]=0;continue;}
    const a=tangent[i]/d,b=tangent[i+1]/d,length=a*a+b*b;
    if(length>9){const scale=3/Math.sqrt(length);tangent[i]=scale*a*d;tangent[i+1]=scale*b*d;}
  }
  let path=`M${number(points[0].x)},${number(points[0].y)}`;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],third=(b.x-a.x)/3;
    path+=`C${number(a.x+third)},${number(a.y+third*tangent[i-1])} ${number(b.x-third)},${number(b.y-third*tangent[i])} ${number(b.x)},${number(b.y)}`;
  }
  return path;
}
export function niceDomain(values,{zero=false,percent=false}={}){
  if(percent)return [0,100];
  const present=values.filter(finite);
  if(!present.length)return [0,1];
  const lo=zero?0:Math.min(...present),hi=Math.max(...present),span=Math.max(hi-lo,hi<1?.02:5);
  const pad=zero?span*.12:span*.15;
  const step=10**Math.floor(Math.log10(Math.max((span+2*pad)/4,.0001)));
  return [zero?0:Math.floor((lo-pad)/step)*step,Math.ceil((hi+pad)/step)*step];
}
export function graphSpec(kind,variable,models=[]){
  if(kind==='week')return {unit:'°F',series:[{key:'high',label:'High',color:'#ff9465'},{key:'low',label:'Low',color:COLORS.low}],range:['high','low']};
  if(kind==='compare')return {unit:VARIABLES[variable]?.unit||'',zero:['precipitation','wind','gust'].includes(variable),percent:['humidity','cloud'].includes(variable),series:models.map(id=>({key:id,label:MODELS[id]?.label||id.toUpperCase(),color:MODELS[id]?.color||'#d0d6d5'}))};
  if(variable==='rain')return {unit:'%',percent:true,secondary:'in',series:[{key:'pop',label:'Rain chance',color:COLORS.rain},{key:'precipitation',label:'Hourly amount',color:COLORS.precipitation,secondary:true,bars:true}]};
  if(variable==='wind')return {unit:'mph',zero:true,series:[{key:'wind',label:'Wind',color:COLORS.wind},{key:'gust',label:'Gusts',color:COLORS.gust}]};
  if(variable==='humidity')return {unit:'%',percent:true,series:[{key:'humidity',label:'Relative humidity',color:COLORS.humidity}]};
  if(variable==='dewpoint')return {unit:'°F',series:[{key:'temperature',label:'Temperature',color:COLORS.temperature},{key:'dewpoint',label:'Dew point',color:COLORS.dewpoint}]};
  return {unit:'°F',series:variable==='feels'?[{key:'feels',label:'Feels like',color:COLORS.feels},{key:'temperature',label:'Temperature',color:COLORS.temperature,dash:true}]:[{key:'temperature',label:'Temperature',color:COLORS.temperature},{key:'feels',label:'Feels like',color:COLORS.feels,dash:true}]};
}
const axisText=(value,unit)=>unit==='in'?value.toFixed(value<.1?3:2):String(Math.round(value));
const exactText=(value,unit)=>finite(value)?`${new Intl.NumberFormat('en-US',{maximumFractionDigits:unit==='in'?4:2}).format(value)}${unit==='°F'?'°':unit?' '+unit:''}`:'Unavailable';
function nightRects(rows,solar,x,T,B){
  const pairs=solar.map(s=>({rise:Date.parse(s.sunrise),set:Date.parse(s.sunset)})).filter(s=>finite(s.rise)&&finite(s.set));
  if(!pairs.length||!rows.length)return '';
  const start=rows[0].time,end=rows.at(-1).time;
  const boundaries=[start,end,...pairs.flatMap(s=>[s.rise,s.set]).filter(t=>t>start&&t<end)].sort((a,b)=>a-b);
  return boundaries.slice(1).map((b,i)=>{const a=boundaries[i],mid=(a+b)/2;return pairs.some(p=>p.rise<=mid&&mid<p.set)?'':`<rect x="${x(a)}" y="${T}" width="${Math.max(0,x(b)-x(a))}" height="${B-T}" fill="#06151e" opacity=".24"/>`;}).join('');
}
let nextId=0;
export class MeteorChart{
  constructor(host,options={}){
    this.host=host;this.options=options;this.id='ng-graph-'+(++nextId);this.index=0;this.width=0;this.controller=null;
    this.resize=new ResizeObserver(entries=>{const width=Math.floor(entries[0].contentRect.width);if(width>0&&Math.abs(width-this.width)>8){this.width=width;cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.render());}});
    this.resize.observe(host);
  }
  set(options){this.options={...this.options,...options};this.index=Math.min(this.index,Math.max(0,(this.options.rows?.length||1)-1));this.render();}
  render(){
    const {rows=[],kind='hourly',variable='temperature',zone='America/New_York',models=[],solar=[],expanded=false,compact=false}=this.options;
    this.host.classList.toggle('ng-chart-compact',compact);
    this.controller?.abort();this.controller=new AbortController();
    const spec=graphSpec(kind,variable,models);this.spec=spec;this.rows=rows;
    const available=rows.some(row=>spec.series.some(s=>finite(row[s.key])));
    if(!available||rows.length<2){this.host.innerHTML='<div class="ng-chart-empty">No matching forecast readings are available for this view.</div>';return;}
    const W=Math.max(300,Math.floor(this.host.clientWidth||this.width||360)),H=expanded?Math.min(450,Math.max(270,innerHeight*.48)):compact?(kind==='week'?104:92)*(W>550?1.35:1):kind==='week'?205:220;
    const L=compact?25:kind==='week'?28:34,R=spec.secondary?43:compact?15:13,T=compact?24:29,B=H-(compact?15:33);
    const start=rows[0].time,end=rows.at(-1).time||start+1;
    const maxGap=(W-L-R)/Math.max(1,(end-start)/(kind==='week'?86400000:3600000))*1.6;
    // Day/hour captions sit in seven equal columns. Leave half a column at
    // either edge so the plotted readings align with those captions.
    const inset=kind==='week'||compact?(W-L-R)/14:0;
    const x=t=>L+inset+(t-start)/Math.max(1,end-start)*(W-L-R-2*inset);
    const primaryValues=rows.flatMap(row=>spec.series.filter(s=>!s.secondary).map(s=>row[s.key]));
    const [lo,hi]=niceDomain(primaryValues,spec),[lo2,hi2]=niceDomain(rows.map(r=>r.precipitation),{zero:true});
    const y=(value,second=false)=>B-(value-(second?lo2:lo))/Math.max(.00001,second?hi2-lo2:hi-lo)*(B-T);
    this.geometry={W,H,L,R,T,B,x,y,start,end};
    const rough=(hi-lo)/5,magnitude=10**Math.floor(Math.log10(Math.max(.00001,rough))),tickStep=[1,2,2.5,5,10].find(n=>n>=rough/magnitude)*magnitude;
    const tickValues=Array.from({length:Math.floor((hi-lo)/tickStep)+2},(_,i)=>Math.ceil(lo/tickStep)*tickStep+i*tickStep).filter(v=>v<=hi+.000001);
    const ticks=tickValues.map(value=>{const Y=y(value);return `<path d="M${L} ${Y}H${W-R}" stroke="#c5d7d1" opacity=".12"/><text x="${L-7}" y="${Y+4}" text-anchor="end">${axisText(value,spec.unit)}</text>${spec.secondary?`<text x="${W-R+7}" y="${Y+4}">${axisText(lo2+(hi2-lo2)*(value-lo)/(hi-lo),spec.secondary)}</text>`:''}`;}).join('');
    let fill='';
    if(kind==='compare'&&this.options.spread){
      const ranges=rows.map(row=>{const range=sourceRange(row,models);return range?{x:x(row.time),y:y(range.max),low:y(range.min)}:null;});
      for(const group of splitSegments(ranges,maxGap))if(group.length>1)fill+=`<path data-source-range d="${monotonePath(group)}L${monotonePath(group.slice().reverse().map(p=>({x:p.x,y:p.low}))).slice(1)}Z" fill="#d1dedc" opacity=".09"/>`;
    }
    if(spec.range){
      const pairs=rows.map(row=>finite(row.high)&&finite(row.low)?{x:x(row.time),y:y(row.high),low:y(row.low)}:null);
      for(const group of splitSegments(pairs,maxGap))if(group.length>1)fill+=`<path d="${monotonePath(group)}L${monotonePath(group.slice().reverse().map(p=>({x:p.x,y:p.low}))).slice(1)}Z" fill="url(#${this.id}-fill)"/>`;
    }else if(kind!=='compare'&&['temperature','feels'].includes(variable)){
      const groupKey=spec.series[0].key;
      for(const group of splitSegments(rows.map(row=>finite(row[groupKey])?{x:x(row.time),y:y(row[groupKey])}:null),maxGap)){if(group.length>1)fill+=`<path d="${monotonePath(group)}L${group.at(-1).x},${B}L${group[0].x},${B}Z" fill="url(#${this.id}-fill)"/>`;}
    }
    const paths=spec.series.map(s=>{
      if(s.bars){const width=Math.max(2,Math.min(13,(W-L-R)/rows.length*.66));return rows.filter(r=>finite(r[s.key])).map(row=>`<rect data-value="${row[s.key]}" x="${x(row.time)-width/2}" y="${y(row[s.key],true)}" width="${width}" height="${Math.max(0,B-y(row[s.key],true))}" rx="1.2" fill="${s.color}" opacity=".6"/>`).join('');}
      return splitSegments(rows.map(row=>finite(row[s.key])?{x:x(row.time),y:y(row[s.key],s.secondary)}:null),maxGap).map(group=>`<path data-series="${esc(s.key)}" d="${monotonePath(group)}" fill="none" stroke="${s.color}" stroke-width="${kind==='compare'&&s.key==='nourie'?3:compact?2.5:2}" ${s.dash?'stroke-dasharray="4 4" opacity=".65"':''} stroke-linejoin="round" stroke-linecap="round"/>${group.length===1?`<circle cx="${group[0].x}" cy="${group[0].y}" r="3" fill="${s.color}"/>`:''}`).join('');
    }).join('');
    const solarMarkers=kind==='week'?'':solar.flatMap(day=>[['Sunrise',Date.parse(day.sunrise)],['Sunset',Date.parse(day.sunset)]]).filter(([,t])=>finite(t)&&t>start&&t<end).map(([label,time])=>`<path d="M${x(time)} ${T}V${B}" stroke="#f0dbb0" opacity=".23" stroke-dasharray="2 4"/><text x="${Math.min(W-R-30,Math.max(L+30,x(time)))}" y="${T-10}" text-anchor="middle" style="font-size:9px;fill:#dac9a5">${label}</text>`).join('');
    const timeTicks=kind==='week'?rows.map((row,index)=>index):[0,.25,.5,.75,1].map(f=>Math.round((rows.length-1)*f));
    const timeLabels=compact?'':[...new Set(timeTicks)].map(index=>{const row=rows[index];return `<text x="${x(row.time)}" y="${H-8}" text-anchor="${index===0?'start':index===rows.length-1?'end':'middle'}">${kind==='week'?'':row.isNow?'Now':formatTime(row.time,zone).replace(' ','')}</text>`;}).join('');
    let extremeLabels='';
    if(kind==='week'){
      extremeLabels=rows.flatMap(row=>['high','low'].filter(key=>finite(row[key])).map(key=>`<circle cx="${x(row.time)}" cy="${y(row[key])}" r="2.8" fill="#fffced" stroke="${key==='high'?'#ff9465':COLORS.low}" stroke-width="1.3"/><text class="ng-value-label" x="${x(row.time)}" y="${y(row[key])+(key==='high'?-10:18)}" text-anchor="middle" style="${key==='low'?'fill:#a2e5ee':''}">${valueText(row[key],'°')}</text>`)).join('');
    }else if(compact&&kind!=='compare'&&['temperature','feels'].includes(variable)){
      const key=spec.series[0].key,indices=[0,1/6,2/6,3/6,4/6,5/6,1].map(f=>Math.round((rows.length-1)*f));
      extremeLabels=[...new Set(indices)].filter(i=>finite(rows[i][key])).map(i=>{const row=rows[i];return `<circle cx="${x(row.time)}" cy="${y(row[key])}" r="2.8" fill="#fffce8" stroke="${spec.series[0].color}" stroke-width="1.2"/><text class="ng-value-label" x="${x(row.time)}" y="${y(row[key])-9}" text-anchor="middle">${valueText(row[key],'°')}</text>`;}).join('');
    }else if(kind!=='compare'&&['temperature','feels'].includes(variable)){
      const key=spec.series[0].key,present=rows.filter(r=>finite(r[key]));
      if(present.length)for(const [label,row]of [['High',present.reduce((a,b)=>a[key]>=b[key]?a:b)],['Low',present.reduce((a,b)=>a[key]<=b[key]?a:b)]])extremeLabels+=`<circle cx="${x(row.time)}" cy="${y(row[key])}" r="2.5" fill="${spec.series[0].color}"/><text x="${Math.max(L+25,Math.min(W-R-25,x(row.time)))}" y="${y(row[key])-10}" text-anchor="middle" style="font-size:9px;fill:#eee2c8">${label} ${valueText(row[key],'°')}</text>`;
    }
    const arrows=variable==='wind'&&kind!=='compare'?rows.filter((_,i)=>i%Math.max(1,Math.floor(rows.length/8))===0).filter(r=>finite(r.windDir)).map(row=>`<g transform="translate(${x(row.time)},${B+15}) rotate(${row.windDir+180})"><path d="M0 -4L-2 3L0 1L2 3Z" fill="#c2d5d2" opacity=".8"/></g>`).join(''):'';
    const label=kind==='week'?'Seven-day high and low temperatures':kind==='compare'?`${VARIABLES[variable]?.label||variable} model comparison`:`${VARIABLES[variable]?.label||variable} forecast`;
    this.host.innerHTML=`<div class="ng-chart-readout" aria-live="polite"></div><svg class="ng-chart-svg" tabindex="0" role="img" aria-label="${esc(label)}. Drag or use the slider for exact values." viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${this.id}-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${spec.series[0]?.color||'#ffb52d'}" stop-opacity="${compact?'.48':'.2'}"/><stop offset=".5" stop-color="${kind==='week'?'#f18b67':'#c48e40'}" stop-opacity="${compact?'.17':'.06'}"/><stop offset="1" stop-color="#25cde5" stop-opacity=".035"/></linearGradient></defs>${kind==='week'?'':nightRects(rows,solar,x,T,B)}${ticks}<text x="${L}" y="13" style="font-size:10px">${esc(spec.unit)}</text>${spec.secondary?`<text x="${W-R}" y="13" text-anchor="end" style="font-size:10px">Hourly ${spec.secondary}</text>`:''}${fill}${solarMarkers}${paths}${extremeLabels}${timeLabels}${arrows}<g class="ng-cursor"><path class="ng-cursor-line" d="M0 ${T}V${B}" stroke="#eaf1e7" stroke-width="1" opacity=".4" stroke-dasharray="3 3"/><g class="ng-cursor-dots"></g></g></svg><input class="ng-chart-slider" type="range" min="0" max="${rows.length-1}" value="${this.index}" step="1" aria-label="Selected ${kind==='week'?'forecast day':'forecast hour'}"><div class="ng-chart-legend">${spec.series.map(s=>`<span><i style="--series:${s.color}"></i>${esc(s.label)}${s.secondary?' · right axis':''}</span>`).join('')}${kind==='week'?'':'<span>Shaded: night</span>'}</div>`;
    const signal=this.controller.signal,svg=this.host.querySelector('svg'),slider=this.host.querySelector('input');
    let down=null;
    const at=clientX=>{const rect=svg.getBoundingClientRect(),pixel=(clientX-rect.left)/rect.width*W;return rows.reduce((best,row,index)=>Math.abs(x(row.time)-pixel)<Math.abs(x(rows[best].time)-pixel)?index:best,0);};
    svg.addEventListener('pointerdown',event=>{clearTimeout(this.tooltipTimer);this.host.classList.add('ng-chart-active');down={x:event.clientX,y:event.clientY};svg.setPointerCapture?.(event.pointerId);this.select(at(event.clientX));},{signal});
    svg.addEventListener('pointermove',event=>{if(down||event.pointerType==='mouse')this.select(at(event.clientX));},{signal});
    svg.addEventListener('pointerup',event=>{const tap=down&&Math.abs(event.clientX-down.x)<8&&Math.abs(event.clientY-down.y)<8;down=null;this.tooltipTimer=setTimeout(()=>this.host.classList.remove('ng-chart-active'),2400);if(tap)this.options.onCommit?.(rows[this.index],this.index);},{signal});
    svg.addEventListener('pointercancel',()=>{down=null;},{signal});
    svg.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();this.select(event.key==='Home'?0:event.key==='End'?rows.length-1:this.index+(event.key==='ArrowRight'?1:-1));}if(event.key==='Enter')this.options.onCommit?.(rows[this.index],this.index);},{signal});
    slider.addEventListener('input',()=>this.select(Number(slider.value)),{signal});
    this.select(this.index,false);
  }
  select(index,notify=true){
    if(!this.rows?.length||!this.geometry)return;
    this.index=Math.max(0,Math.min(this.rows.length-1,index));
    const row=this.rows[this.index],{x,y,T,B}=this.geometry,spec=this.spec,kind=this.options.kind||'hourly';
    const cursor=this.host.querySelector('.ng-cursor-line'),dots=this.host.querySelector('.ng-cursor-dots');
    if(!cursor)return;
    cursor.setAttribute('d',`M${x(row.time)} ${T}V${B}`);
    dots.innerHTML=spec.series.filter(s=>!s.bars&&finite(row[s.key])).map(s=>`<circle cx="${x(row.time)}" cy="${y(row[s.key],s.secondary)}" r="3.7" fill="${s.color}" stroke="#142b35" stroke-width="2"/>`).join('');
    const time=kind==='week'?row.dateLabel||row.date:row.isNow?'Now · current reading':formatTime(row.time,this.options.zone,{weekday:'short',hour:'numeric',minute:'2-digit'});
    const shown=spec.series.filter(s=>finite(row[s.key]));
    this.host.querySelector('.ng-chart-readout').innerHTML=`<div>${(kind==='compare'?shown:shown.slice(0,3)).map(s=>`<span style="display:inline-block;margin-right:12px"><strong style="color:${s.color}">${exactText(row[s.key],s.secondary?spec.secondary:spec.unit)}</strong><small>${esc(s.label)}</small></span>`).join('')||'<strong>Unavailable</strong>'}</div><div class="ng-reading-time">${esc(time)}${kind==='compare'&&shown.length>3?`<br><small>${shown.length} traces at this hour</small>`:''}</div>`;
    if(kind==='compare')this.host.querySelector('.ng-chart-readout').title=spec.series.map(s=>`${s.label}: ${exactText(row[s.key],spec.unit)}`).join('\n');
    const slider=this.host.querySelector('input');slider.value=String(this.index);slider.setAttribute('aria-valuetext',`${time}. ${spec.series.map(s=>s.label+' '+exactText(row[s.key],s.secondary?spec.secondary:spec.unit)).join('. ')}`);
    if(notify)this.options.onSelect?.(row,this.index);
  }
  destroy(){clearTimeout(this.tooltipTimer);this.controller?.abort();this.resize.disconnect();cancelAnimationFrame(this.frame);this.host.replaceChildren();}
}
