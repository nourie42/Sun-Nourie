import {weatherState} from './weather-state.js';
/** The hero is always the current observation/estimate, never tonight's low. */
export function currentHero(forecast,isDay=true){
 const c=forecast?.current||{};
 const radarReady=c.radarPrecipitation?.status==='ready',radarHere=radarReady&&c.radarPrecipitation?.atLocation===true;
 const kind=weatherState(c.condition).kind,observed=c.type==='observation'&&!/forecast/i.test(c.conditionSource||'');
 const sky=forecast?.hours?.[0]?.skyCover;
 const dryRadarSky=radarReady&&!radarHere&&!observed&&['rain','storm','snow'].includes(kind)?weatherState('',sky).label:c.condition;
 return {temperature:typeof c.temperature==='number'&&Number.isFinite(c.temperature)?c.temperature:null,condition:radarHere?'Rain on radar':dryRadarSky||'Current conditions unavailable',isDay,tonight:false,range:''};
}
