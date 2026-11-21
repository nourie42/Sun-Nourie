import {forecastSky} from './sky-display.js?v=single-sky-v1';
const header=document.querySelector('.topbar.sky-header');
let last=globalThis.__weatherNourieForecast||null;
function apply(){const sky=forecastSky(last);if(header)header.dataset.hdr=sky.header;document.documentElement.dataset.hdr=sky.header;}
document.addEventListener('weather-nourie:forecast',event=>{last=event.detail;apply();});
document.addEventListener('weather-nourie:location-changing',()=>{last=null;apply();});
new MutationObserver(apply).observe(document.body,{attributes:true,attributeFilter:['data-sky']});
apply();
