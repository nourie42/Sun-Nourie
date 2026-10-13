import {dailyDisplay,finite} from './weather-math.js?v=full-day-rain-v1';
import {displayedRainChance,rainAwareCondition} from './rain-display.js?v=rain-icon-v2';
import {forecastPeriodSummary} from './forecast-story.js?v=weather-qa-v67';
import {shortForecastCondition} from './today-card.js?v=mobile-repair-v1';
import {weatherIcon,weatherMetricIcon} from './weather-display.js?v=restore-hourly-v7';
import {confidenceMeterPosition} from './forecast-confidence.js?v=category-meter-v1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reading=(value,unit='',digits=0)=>finite(value)?`${value.toFixed(digits)}${unit}`:'\u2014';
const chevron=direction=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction==='left'?'m15 5-7 7 7 7':'m9 5 7 7-7 7'}"/></svg>`;

export function sevenDayForecast(forecast,now=Date.now()) {
  const zone=forecast?.location?.timeZone||'America/New_York';
  return (forecast?.days||[]).slice(0,7).map((day,index)=>{
    const display=dailyDisplay(day,index,now,zone),rain=displayedRainChance(forecast,display.pop,{dayIndex:index,now});
    const story=forecastPeriodSummary(forecast,index,display.phase,now);
    const winds=(forecast.metricForecasts?.series?.wind||[]).filter(point=>{
      const time=Date.parse(point.time);
      return time>=story.window.start&&time<story.window.end&&finite(point.value)&&point.value>=0;
    }).map(point=>point.value);
    const date=Date.parse(`${day.date}T12:00:00Z`);
    const weekday=finite(date)?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(date):day.label;
    const dateLabel=finite(date)?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(date):'';
    const condition=rain.observed?'Rain now':rainAwareCondition(display.condition,rain.value,day,display.tonight);
    return {index,date:day.date,dateLabel,label:index===0?(display.tonight?'Tonight':'Today'):weekday,
      high:display.tonight?null:display.primary,low:display.tonight?display.primary:display.secondary,
      condition,shortCondition:shortForecastCondition(condition),isDay:!display.tonight,
      pop:rain.value,observed:rain.observed,amount:story.amount,
      wind:winds.length?winds.reduce((sum,value)=>sum+value,0)/winds.length:null,
      snowfall:day.snowfall??null,snowRange:day.snowRange||null,snowPossible:!!day.snowPossible,windWindow:story.window,confidence:day.confidence||null,detail:display.detail||story.summary};
  });
}

function artHTML(day) {
  return weatherIcon(day.condition,day.isDay,44);
}

function confidenceHTML(confidence) {
  const score=finite(confidence?.score)?Math.max(0,Math.min(100,confidence.score)):null;
  const position=confidenceMeterPosition(confidence);
  const title=[...(confidence?.factors||[]),confidence?.note].filter(Boolean).join(' \u00b7 ');
  return `<span class="seven-day-confidence" data-confidence="${esc(confidence?.key||'unavailable')}" title="${esc(title)}"><span class="seven-day-confidence-label"><span>Confidence</span><strong>${esc(confidence?.label||'Unavailable')}</strong></span>${position===null?'<span class="seven-day-confidence-missing">\u2014</span>':`<span class="seven-day-meter" role="meter" aria-label="Relative forecast confidence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}" aria-valuetext="${esc(confidence.label)}"><span style="--confidence:${position}%"></span></span>`}</span>`;
}

export function sevenDayCardHTML(day,selected=false) {
  const description=`${day.label}, ${day.dateLabel}, ${day.condition}. High ${reading(day.high)} degrees, low ${reading(day.low)} degrees. Rain chance ${reading(day.pop,'%')}. Total precipitation ${reading(day.amount,' inches',2)}. Wind ${reading(day.wind,' mph')}. Forecast confidence ${day.confidence?.label||'unavailable'}.`;
  const metric=(kind,label,value,compact=false)=>`<span class="seven-day-metric" title="${esc(label)}: ${esc(value)}">${weatherMetricIcon(kind)}<span>${label}</span><strong${compact?' style="font-size:10px"':''}>${value}</strong></span>`;
  const temp=value=>`<strong style="--narrow-temp-size:${finite(value)&&(value<0||value>=100)?14:17}px">${reading(value,'\u00b0')}</strong>`;
  return `<button type="button" class="seven-day-card" data-week-day="${day.index}" data-date="${esc(day.date)}" aria-pressed="${selected}" aria-controls="day-dialog" aria-haspopup="dialog" aria-label="${esc(description)}"><span class="seven-day-card-heading"><span class="seven-day-name">${esc(day.label)}</span><span class="seven-day-date">${esc(day.dateLabel)}</span></span><span class="seven-day-weather" title="${esc(day.condition)}">${artHTML(day)}<span class="seven-day-condition">${esc(day.shortCondition)}</span></span><span class="seven-day-temperatures"><span>${temp(day.high)}<span class="seven-day-temperature-label">High</span></span><span>${temp(day.low)}<span class="seven-day-temperature-label">Low</span></span></span><span class="seven-day-metrics">${metric('drop',day.observed?'Rain now':'Rain chance',reading(day.pop,'%'))}${metric('drop','Total precip',reading(day.amount,' in',2),day.amount>=10)}${metric('wind','Wind',reading(day.wind,' mph'),day.wind>=100)}${day.snowPossible?`<span class="seven-day-metric seven-day-snow" title="Snowfall forecast (NWS gridpoint; model range when they disagree)">❄ ${day.snowRange?`${day.snowRange[0]}–${day.snowRange[1]}"`:finite(day.snowfall)&&day.snowfall>=0.05?`${day.snowfall.toFixed(1)}"`:'Snow possible'}</span>`:''}</span>${confidenceHTML(day.confidence)}</button>`;
}

export function createSevenDayCarousel({onOpenDay=()=>{}}={}) {
  if(typeof document==='undefined')return null;
  const anchor=document.querySelector('.hero .today-panel');if(!anchor)return null;
  for(const [id,name] of [['experimental-week-styles','seven-day.css']]) {
    if(document.getElementById(id))continue;
    const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.href=`/weather-fusion/${name}?v=main-week-v10`;document.head.append(link);
  }
  const root=document.createElement('section');root.id='experimental-week';root.className='experimental-week';root.hidden=true;root.setAttribute('aria-labelledby','seven-day-title');
  root.innerHTML=`<div class="seven-day-carousel glass"><div class="seven-day-heading"><h2 id="seven-day-title">7-Day Forecast</h2><div class="seven-day-controls"><button type="button" data-week-step="-1" aria-label="Previous forecast days" title="Previous forecast days" aria-controls="seven-day-rail" disabled>${chevron('left')}</button><button type="button" data-week-step="1" aria-label="Next forecast days" title="Next forecast days" aria-controls="seven-day-rail" disabled>${chevron('right')}</button></div></div><div id="seven-day-rail" class="seven-day-rail" tabindex="0" aria-label="Seven-day forecast"></div><input type="range" class="seven-day-scroll" min="0" max="1000" value="0" aria-label="Scroll seven-day forecast" aria-controls="seven-day-rail" disabled></div>`;
  anchor.after(root);
  const rail=root.querySelector('.seven-day-rail'),slider=root.querySelector('.seven-day-scroll');
  const previous=root.querySelector('[data-week-step="-1"]'),next=root.querySelector('[data-week-step="1"]');
  let days=[],selectedDate=null,locationKey=null,drag=null,suppressClick=false;
  const reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const updateScroll=()=>{
    const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
    previous.disabled=rail.scrollLeft<=1;next.disabled=rail.scrollLeft>=max-1;
    slider.disabled=max<=1;slider.value=String(max?Math.round(rail.scrollLeft/max*1000):0);
  };
  function select(index,{focus=false}={}) {
    const day=days.find(value=>value.index===index);if(!day)return;
    selectedDate=day.date;
    rail.querySelectorAll('[data-week-day]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.date===selectedDate)));
    if(focus){
      const button=rail.querySelector(`[data-week-day="${index}"]`),behavior=reducedMotion()?'auto':'smooth';
      button?.focus({preventScroll:true});
      if(index===0||index===days.length-1)rail.scrollTo({left:index===0?0:rail.scrollWidth-rail.clientWidth,behavior});
      else button?.scrollIntoView({block:'nearest',inline:'nearest',behavior});
    }
  }
  root.querySelectorAll('[data-week-step]').forEach(button=>button.addEventListener('click',()=>{
    const card=rail.querySelector('.seven-day-card');
    const gap=Number.parseFloat(getComputedStyle(rail).columnGap)||0;
    rail.scrollBy({left:Number(button.dataset.weekStep)*((card?.getBoundingClientRect().width||80)+gap),behavior:reducedMotion()?'auto':'smooth'});
  }));
  rail.addEventListener('scroll',updateScroll,{passive:true});
  slider.addEventListener('input',()=>{rail.scrollLeft=Number(slider.value)/1000*(rail.scrollWidth-rail.clientWidth);});
  rail.addEventListener('click',event=>{
    if(suppressClick){event.preventDefault();suppressClick=false;return;}
    const button=event.target.closest('[data-week-day]');
    if(button){const index=Number(button.dataset.weekDay);select(index);onOpenDay(index);}
  });
  rail.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!days.length)return;
    event.preventDefault();
    const index=Number(event.target.closest('[data-week-day]')?.dataset.weekDay??days.find(day=>day.date===selectedDate)?.index??0);
    select(event.key==='Home'?0:event.key==='End'?days.length-1:Math.max(0,Math.min(days.length-1,index+(event.key==='ArrowRight'?1:-1))),{focus:true});
  });
  // Touch keeps native scrolling; mouse dragging shares the same scroll position.
  rail.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button===0){suppressClick=false;drag={id:event.pointerId,x:event.clientX,left:rail.scrollLeft};}});
  rail.addEventListener('pointermove',event=>{
    if(event.buttons===0){endDrag();return;}
    if(!drag||event.pointerId!==drag.id||Math.abs(event.clientX-drag.x)<6)return;
    if(!suppressClick){rail.setPointerCapture(event.pointerId);suppressClick=true;rail.classList.add('is-dragging');}
    rail.scrollLeft=drag.left-(event.clientX-drag.x);
  });
  const endDrag=()=>{drag=null;rail.classList.remove('is-dragging');};
  rail.addEventListener('pointerup',endDrag);rail.addEventListener('pointercancel',endDrag);rail.addEventListener('lostpointercapture',endDrag);
  const hourly=document.querySelector('.hero .hourly-panel');
  const matchHourlyGeometry=()=>{
    const height=hourly?.getBoundingClientRect().height;
    if(height>0)root.style.setProperty('--week-height',`${height}px`);
    const width=hourly?.querySelector('button.hour')?.getBoundingClientRect().width;
    if(width>0)root.style.setProperty('--week-card',`${width}px`);
    const strip=hourly?.querySelector('#hourly');
    if(strip)root.style.setProperty('--week-gap',getComputedStyle(strip).columnGap);
    updateScroll();
  };
  if(typeof ResizeObserver!=='undefined'){
    new ResizeObserver(updateScroll).observe(rail);
    if(hourly)new ResizeObserver(matchHourlyGeometry).observe(hourly);
  }
  return {
    render(forecast,now=Date.now()) {
      const key=`${forecast.location?.latitude},${forecast.location?.longitude}`,left=key===locationKey?rail.scrollLeft:0;
      if(key!==locationKey)selectedDate=null;locationKey=key;
      const focusedDate=rail.contains(document.activeElement)?document.activeElement.dataset.date:null;
      days=sevenDayForecast(forecast,now);root.hidden=!days.length;if(!days.length)return;
      selectedDate=days.some(day=>day.date===selectedDate)?selectedDate:days[0].date;
      rail.innerHTML=days.map(day=>sevenDayCardHTML(day,day.date===selectedDate)).join('');
      rail.scrollLeft=left;select(days.find(day=>day.date===selectedDate).index);
      if(focusedDate){const button=[...rail.children].find(value=>value.dataset.date===focusedDate);button?.focus({preventScroll:true});}
      matchHourlyGeometry();requestAnimationFrame(matchHourlyGeometry);
    },
    reset() {days=[];selectedDate=null;locationKey=null;root.hidden=true;rail.replaceChildren();rail.scrollLeft=0;updateScroll();}
  };
}
