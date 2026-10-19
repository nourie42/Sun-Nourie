const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function aqiBand(value){
 if(!finite(value)||value<0)return {key:'unavailable',label:'Unavailable',summary:'Current air-quality data is unavailable.'};
 if(value<=50)return {key:'good',label:'Good',summary:'Air quality is good.'};
 if(value<=100)return {key:'moderate',label:'Moderate',summary:'Air quality is generally acceptable.'};
 if(value<=150)return {key:'sensitive',label:'Unhealthy for sensitive groups',summary:'Sensitive groups may want to reduce prolonged outdoor exertion.'};
 if(value<=200)return {key:'unhealthy',label:'Unhealthy',summary:'Consider reducing prolonged outdoor exertion.'};
 if(value<=300)return {key:'very-unhealthy',label:'Very unhealthy',summary:'Avoid prolonged outdoor exertion and check local air-quality guidance.'};
 return {key:'hazardous',label:'Hazardous',summary:'Avoid outdoor exertion and follow local air-quality alerts.'};
}

const reading=(value,digits=0)=>finite(value)?Number(value).toFixed(digits):'—';

/** A loaded snapshot can age while a page stays open. Preserve the model's
 * original timestamp instead of treating the last render as a fresh reading. */
export function currentAirQuality(forecast,now=Date.now()){
 const aq=forecast?.airQuality,time=Date.parse(aq?.time);
 if(!finite(aq?.aqi)||aq.aqi<0||!finite(time)||!finite(now)||now-time>2*3600000||time-now>5*60000)return null;
 return aq;
}

/** AQI for a selected forecast hour never borrows today's current pollutants. */
export function airQualityAtTime(forecast,time,now=false){
 const epoch=typeof time==='number'?time:Date.parse(time);
 if(!finite(epoch))return null;
 if(now)return currentAirQuality(forecast,epoch);
 const hour=Math.floor(epoch/3600000)*3600000;
 const row=forecast?.airQuality?.hours?.find(r=>Date.parse(r.time)===hour);
 return finite(row?.aqi)&&row.aqi>=0?{aqi:row.aqi,time:row.time,source:forecast.airQuality.source}:null;
}

export function airQualityWeek(forecast){
 const zone=forecast.location?.timeZone||'America/New_York';
 const date=t=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
 const days=forecast.days?.slice(0,7)||[];
 return days.map(day=>{const rows=(forecast.airQuality?.hours||[]).filter(r=>finite(r.aqi)&&r.aqi>=0&&finite(Date.parse(r.time))&&date(r.time)===day.date);return {date:day.date,value:rows.length?Math.max(...rows.map(r=>r.aqi)):null,hours:rows.length};});
}

export function airQualityHTML(forecast){
 const aq=forecast?.airQuality,location=forecast?.location?.name||'this location';
 if(!aq||!finite(aq.aqi)||aq.aqi<0){
  return `<p class="aqi-unavailable">Current local air-quality data is unavailable for ${esc(location)}. Other weather data is unaffected.</p>`;
 }
 const band=aqiBand(aq.aqi),peak=finite(aq.next24HourPeak)?Math.round(aq.next24HourPeak):null;
 const week=airQualityWeek(forecast),timestamp=Date.parse(aq.time);
 const timeNote=finite(timestamp)?new Intl.DateTimeFormat('en-US',{timeZone:forecast.location?.timeZone||'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(timestamp)):null;
 return `<details class="aqi-details"><summary class="aqi-expand"><div class="aqi-summary" data-aqi="${esc(band.key)}">
   <div class="aqi-reading"><span>LOCAL AQI</span><strong>${Math.round(aq.aqi)}</strong><b>${esc(band.label)}</b></div>
   <div class="aqi-copy"><p><strong>${esc(location)}</strong> · ${esc(band.summary)}</p><span>${peak===null?'24-hour forecast peak unavailable':`Available 24-hour forecast peak: <strong>${peak}</strong>`}</span></div>
  </div><span class="aqi-expand-hint">Tap for air-quality details and the week ahead</span></summary>
  <div class="aqi-week" aria-label="Seven-day air-quality outlook">${week.map(d=>`<div data-aqi="${aqiBand(d.value).key}"><b>${esc(new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(new Date(d.date+'T12:00Z')))}</b><strong>${reading(d.value)}</strong><small>${finite(d.value)?esc(aqiBand(d.value).label):'Not published'}</small></div>`).join('')}</div>
  <p class="aqi-source">Each day shows the highest available hourly AQI. Forecast coverage may end before seven days; missing days are not zero. ${esc(band.summary)}</p>
  <div class="aqi-pollutants" aria-label="Current air pollutants">
   <span><b>PM2.5</b><strong>${reading(aq.pm25,1)}</strong><small>µg/m³</small></span>
   <span><b>PM10</b><strong>${reading(aq.pm10,1)}</strong><small>µg/m³</small></span>
  </div>
  <p class="aqi-source">Air-quality model data for the selected coordinates from Open-Meteo / CAMS.${timeNote?` Current model time: ${esc(timeNote)}.`:''} <a href="https://www.airnow.gov/aqi/aqi-basics/" target="_blank" rel="noopener noreferrer">AQI category guidance ↗</a></p></details>`;
}

export function renderAirQuality(forecast,now=Date.now()){
 const current=currentAirQuality(forecast,now),view={...forecast,airQuality:current};
 const root=document.getElementById('air-quality-content');
 if(root){const open=root.querySelector('details')?.open;root.innerHTML=airQualityHTML(view);if(open&&root.querySelector('details'))root.querySelector('details').open=true;}
 const panel=document.getElementById('air-quality');if(panel)panel.dataset.aqi=aqiBand(current?.aqi).key;
}
