/* Main and experimental skies follow the controller's selected-location data.
 * This module never issues its own forecast request. */
import {forecastSky} from './sky-display.js?v=sky-v3';
let last=globalThis.__weatherNourieForecast||null,generation=0;
function apply(){
 const token=++generation,sky=forecastSky(last),layers=[document.getElementById('exp-sky-a'),document.getElementById('exp-sky-b')];
 if(!layers[0]||!layers[1])return;
 document.documentElement.classList.add('sky-active');
 if(!sky.image){for(const layer of layers)layer.classList.remove('on');return;}
 if(layers.some(layer=>layer.classList.contains('on')&&layer.dataset.img===sky.image&&layer.classList.contains('sky-overcast')===Boolean(sky.overcastCrop)))return;
 const pre=new Image();pre.decoding='async';
 pre.onload=()=>{if(token!==generation)return;const show=layers.find(layer=>!layer.classList.contains('on'))||layers[0];show.style.backgroundImage=`url("${pre.src}")`;show.dataset.img=sky.image;show.classList.toggle('sky-overcast',Boolean(sky.overcastCrop));show.classList.add('on');for(const layer of layers)if(layer!==show)layer.classList.remove('on');};
 pre.src='/weather-fusion/'+sky.image;
}
document.addEventListener('weather-nourie:forecast',event=>{last=event.detail;apply();});
document.addEventListener('weather-nourie:location-changing',()=>{last=null;apply();});
new MutationObserver(apply).observe(document.body,{attributes:true,attributeFilter:['data-sky']});
apply();
