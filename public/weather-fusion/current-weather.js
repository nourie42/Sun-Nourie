import {weatherState} from './weather-state.js?v=current-rain-20261017-v1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const liquid=condition=>['rain','storm'].includes(weatherState(condition).kind);

/** Radar describes detected precipitation, not the probability for the current
 * forecast hour. A radar gap must not erase a supported forecast at this point. */
export function currentWeatherDisplay(forecast,now=Date.now()){
 const current=forecast?.current||{},kind=weatherState(current.condition).kind;
 const currentHour=forecast?.hours?.find(h=>{const t=Date.parse(h.time);return t<=now&&now<t+3600000;});
 const assembled=Date.parse(forecast?.assembledAt),fresh=finite(assembled)&&now-assembled<=90*60000&&now>=assembled-5*60000;
 const stationCondition=(current.type==='observation'||(/observation/i.test(current.conditionSource||'')&&!/forecast \(sky only\)/i.test(current.conditionSource||'')))&&kind!=='unknown';
 const activePrecipitation=stationCondition&&['rain','storm','snow'].includes(kind);
 const radar=current.radarPrecipitation,radarReady=radar?.status==='ready';
 const radarHere=radarReady&&radar.atLocation===true;
 const radarClose=radarReady&&(radar.close===true||(finite(radar.nearestRainMiles)&&radar.nearestRainMiles<=5));
 const radarThreat=radarHere||radarClose||(radarReady&&radar.approaching===true);
 const radarNearby=radarReady&&radar.nearby===true,radarArea=radarReady&&radar.inArea===true;
 const hourlyChance=currentHour?.rainLikelihood&&Object.hasOwn(currentHour.rainLikelihood,'value')?currentHour.rainLikelihood.value:currentHour?.pop;
 const chance=finite(hourlyChance)&&hourlyChance>=0&&hourlyChance<=100?hourlyChance:null;
 const precipitation=currentHour?.precipitation;
 const pointRainForecast=!stationCondition&&fresh&&liquid(currentHour?.condition)&&finite(precipitation)&&precipitation>=.01;
 // Open umbrellas indicate preparation for meaningful rain in this hour. The
 // caption still says forecast; this never fabricates an observed 100% chance.
 const rainExpected=pointRainForecast&&(!weatherState(currentHour.condition).chance||(chance!==null&&chance>=50));
 const direction={N:'north',NE:'northeast',E:'east',SE:'southeast',S:'south',SW:'southwest',W:'west',NW:'northwest'}[radar?.nearestRainDirection];
 const areaDistance=finite(radar?.nearestRainMiles)?` about ${Math.round(radar.nearestRainMiles)} miles${direction?` ${direction}`:''}`:'';
 const currentPrecipitation=activePrecipitation
  ? {active:true,label:kind==='snow'?'Snow now':'Rain now',source:'Current station reports precipitation.'}
  : radarHere
   ? {active:true,nearby:false,label:'Rain now',source:'NOAA observed radar shows precipitation over the selected location.'}
   : radarThreat
    ? {active:true,nearby:true,label:'Rain Around',source:radarClose?'NOAA observed radar shows rain within 5 miles of the selected location.':'NOAA observed radar shows rain moving toward the selected location.'}
    : pointRainForecast
     ? {active:false,forecast:true,label:chance===null?'Rain forecast':`${Math.round(chance)}% this hour`,source:'Selected-location rain forecast for the current hour. Radar has not confirmed rain over this location.'}
     : radarNearby
      ? {active:false,nearby:true,label:'Rain nearby',source:'NOAA observed radar shows precipitation near the selected location.'}
      : radarArea
       ? {active:false,inArea:true,label:'Rain in area',source:`NOAA observed radar shows precipitation${areaDistance} of the selected location.`}
       : radarReady
        ? {active:false,label:'Dry now',source:'NOAA observed radar shows no precipitation at or near the selected location.'}
        : stationCondition
         ? {active:false,label:'Dry at station',source:'The nearby station reports no precipitation; radar is checked separately.'}
         : radar
          ? {active:false,label:'Radar unavailable',source:'Current precipitation could not be confirmed.'}
          : {active:false,label:'Checking radar',source:'Waiting for the latest NOAA observed radar.'};
 const currentLikelihood=activePrecipitation||radarThreat?{value:100,source:activePrecipitation?'Current station observation':'NOAA observed radar'}
  :pointRainForecast?{value:chance,source:'Selected-location current-hour forecast'}
  :stationCondition?{value:0,source:'Current station observation'}
  :radarReady?{value:0,source:'NOAA observed radar'}:{value:null,source:'Current precipitation not yet confirmed'};
 const dryRadarSky=radarReady&&!radarThreat&&!stationCondition&&['rain','storm','snow'].includes(kind)?weatherState('',currentHour?.skyCover).label:current.condition;
 const condition=activePrecipitation?current.condition:radarHere?'Rain':radarThreat?'Rain Around':pointRainForecast?currentHour.condition:dryRadarSky;
 return {currentHour,condition,currentLikelihood,currentPrecipitation,rainExpected,radarThreat,rainAround:radarThreat,pointRainForecast,precipitation};
}
