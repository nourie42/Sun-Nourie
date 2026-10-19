import {currentWeatherDisplay} from './current-weather.js?v=current-rain-20261017-v3';
import {currentComfortInputs} from './current-inputs.js?v=accuracy-20261019-v1';
/** The hero is always the current observation/estimate, never tonight's low. */
export function currentHero(forecast,isDay=true,now=Date.now()){
 const c=currentComfortInputs(forecast,now),state=currentWeatherDisplay(forecast,now);
 return {temperature:typeof c.temperature==='number'&&Number.isFinite(c.temperature)?c.temperature:null,condition:state.currentPrecipitation.label==='Rain now'?'Rain now':state.condition||'Current conditions unavailable',isDay,tonight:false,range:''};
}
