import {weatherState} from './weather-state.js';
/** The hero is always the current observation/estimate, never tonight's low. */
export function currentHero(forecast,isDay=true){
 const c=forecast?.current||{};
 const radar=c.radarPrecipitation,radarReady=radar?.status==='ready',radarHere=radarReady&&radar.atLocation===true;
 const radarThreat=radarHere||(radarReady&&(radar.close===true||(typeof radar.nearestRainMiles==='number'&&radar.nearestRainMiles<=5)||radar.approaching===true));
 const kind=weatherState(c.condition).kind,observed=c.type==='observation'&&!/forecast/i.test(c.conditionSource||'');
 const sky=forecast?.hours?.[0]?.skyCover;
 const dryRadarSky=radarReady&&!radarThreat&&!observed&&['rain','storm','snow'].includes(kind)?weatherState('',sky).label:c.condition;
 return {temperature:typeof c.temperature==='number'&&Number.isFinite(c.temperature)?c.temperature:null,condition:radarHere?'Rain now':radarThreat?'Rain Around':dryRadarSky||'Current conditions unavailable',isDay,tonight:false,range:''};
}
