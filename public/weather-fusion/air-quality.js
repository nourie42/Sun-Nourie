const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function aqiBand(value){
 if(!finite(value))return {key:'unavailable',label:'Unavailable',summary:'Current air-quality data is unavailable.'};
 if(value<=50)return {key:'good',label:'Good',summary:'Air quality is good.'};
 if(value<=100)return {key:'moderate',label:'Moderate',summary:'Air quality is generally acceptable.'};
 if(value<=150)return {key:'sensitive',label:'Unhealthy for sensitive groups',summary:'Sensitive groups may want to reduce prolonged outdoor exertion.'};
 if(value<=200)return {key:'unhealthy',label:'Unhealthy',summary:'Consider reducing prolonged outdoor exertion.'};
 if(value<=300)return {key:'very-unhealthy',label:'Very unhealthy',summary:'Avoid prolonged outdoor exertion and check local air-quality guidance.'};
 return {key:'hazardous',label:'Hazardous',summary:'Avoid outdoor exertion and follow local air-quality alerts.'};
}

const reading=(value,digits=0)=>finite(value)?Number(value).toFixed(digits):'—';

export function airQualityHTML(forecast){
 const aq=forecast?.airQuality,location=forecast?.location?.name||'this location';
 if(!aq||!finite(aq.aqi)){
  return `<p class="aqi-unavailable">Current local air-quality data is unavailable for ${esc(location)}. Other weather data is unaffected.</p>`;
 }
 const band=aqiBand(aq.aqi),peak=finite(aq.next24HourPeak)?Math.round(aq.next24HourPeak):null;
 return `<div class="aqi-summary" data-aqi="${esc(band.key)}">
   <div class="aqi-reading"><span>LOCAL AQI</span><strong>${Math.round(aq.aqi)}</strong><b>${esc(band.label)}</b></div>
   <div class="aqi-copy"><p><strong>${esc(location)}</strong> · ${esc(band.summary)}</p><span>${peak===null?'Next 24-hour peak unavailable':`Next 24-hour peak: <strong>${peak}</strong>`}</span></div>
  </div>
  <div class="aqi-pollutants" aria-label="Current air pollutants">
   <span><b>PM2.5</b><strong>${reading(aq.pm25,1)}</strong><small>µg/m³</small></span>
   <span><b>PM10</b><strong>${reading(aq.pm10,1)}</strong><small>µg/m³</small></span>
  </div>
  <p class="aqi-source">Air-quality model data for the selected coordinates from Open-Meteo / CAMS. <a href="https://www.airnow.gov/aqi/aqi-basics/" target="_blank" rel="noopener noreferrer">AQI category guidance ↗</a></p>`;
}

export function renderAirQuality(forecast){
 const root=document.getElementById('air-quality-content');
 if(root)root.innerHTML=airQualityHTML(forecast);
}
