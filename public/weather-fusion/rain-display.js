const finite=value=>typeof value==='number'&&Number.isFinite(value);

export function rainObservedNow(forecast,now=Date.now(),maxAgeMs=15*60*1000){
 const radar=forecast?.current?.radarPrecipitation;
 if(radar?.status!=='ready'||radar.atLocation!==true)return false;
 const observed=Date.parse(radar.observedAt);
 if(Number.isFinite(observed)){
  const age=now-observed;
  if(age< -5*60*1000||age>maxAgeMs)return false;
 }
 return true;
}

export function displayedRainChance(forecast,forecastChance,{dayIndex=0,now=Date.now()}={}){
 const value=finite(forecastChance)&&forecastChance>=0&&forecastChance<=100?forecastChance:null;
 const observed=dayIndex===0&&rainObservedNow(forecast,now);
 return {value:observed?100:value,forecastValue:value,observed};
}

export function observedRainLabel(display){
 if(!display?.observed)return '';
 return finite(display.forecastValue)
  ? `Rain now · remaining forecast peak ${Math.round(display.forecastValue)}%`
  : 'Rain now · observed radar';
}
