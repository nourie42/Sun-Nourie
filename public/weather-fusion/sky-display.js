import {weatherState} from './weather-state.js?v=current-rain-20261017-v3';
import {currentWeatherDisplay} from './current-weather.js?v=current-rain-20261017-v3';
import {currentReadingFreshness} from './weather-freshness.js?v=accuracy-20261019-v1';
import {solarElevation} from './weather-math.js?v=current-rain-20261017-v3';
const finite=Number.isFinite;
export function classifySky(condition,cloudCover=null){
 const state=weatherState(condition,cloudCover);
 if(['storm','rain','snow','fog'].includes(state.kind))return state.kind;
 if(typeof cloudCover==='number'&&finite(cloudCover)&&cloudCover>=70&&cloudCover<=100)return 'cloudy';
 return state.kind;
}
/** Presentation only: the same current reading, radar evidence and selected point. */
export function forecastSky(forecast,now=Date.now()){
 if(!forecast)return {kind:'unknown',state:'unknown',header:'unknown',image:null};
 const display=currentWeatherDisplay(forecast,now),c=forecast.current||{};
 const cloud=currentReadingFreshness(forecast,now).expired?null:c.skyCover;
 const kind=classifySky(display.condition,cloud);
 if(kind==='unknown')return {kind,state:'unknown',header:'unknown',image:null};
 const elevation=solarElevation(now,forecast.location?.latitude,forecast.location?.longitude);
 const isDay=finite(elevation)?elevation>0:display.currentHour?.isDay;
 if(typeof isDay!=='boolean')return {kind:'unknown',state:'unknown',header:'unknown',image:null};
 if(!isDay){
  const covered=['cloudy','fog','rain','storm','snow'].includes(kind);
  return {kind,state:'night',header:covered?'night-cloudy':'night',image:covered?'weather-her-bg-cloudy-night-feels-32-59f.webp':'today-sky-night-v2.webp'};
 }
 const image={cloudy:'weather-her-bg-cloudy-day-feels-32-59f.webp',fog:'weather-her-bg-fog-day-feels-32-59f.webp',rain:'today-sky-rain.webp',storm:'today-sky-storm.webp',snow:'weather-her-bg-snow-day-feels-32-49f.webp',clear:'today-sky-clear.webp','partly-cloudy':'today-sky-clouds.webp'}[kind]||null;
 return {kind,state:['rain','storm'].includes(kind)?'rain':kind==='clear'||kind==='partly-cloudy'?'day':kind,header:kind==='clear'?'clear':kind==='partly-cloudy'?'cloudy':kind==='fog'?'cloudy':kind==='storm'?'rain':kind,image};
}
