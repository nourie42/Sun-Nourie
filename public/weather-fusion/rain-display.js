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

// Daily icon/condition must agree with the displayed rain chance. NWS daytime wording
// ("Sunny") can sit beside a blended daily PoP driven by the night period; when the shown
// chance is >= 35% and the wording is dry, say when the rain is expected (NWS day/night text).
export const RAIN_ICON_CHANCE = 35;
export function rainAwareCondition(condition = '', pop = null, day = {}, tonight = false) {
  const text = String(condition || '');
  if (!(typeof pop === 'number' && Number.isFinite(pop) && pop >= RAIN_ICON_CHANCE)) return text;
  if (/thunder|\btstm\b|storm|rain|shower|drizzle|snow|sleet|flurr|ice|freezing/i.test(text)) return text;
  const words = `${day?.detail || ''} ${day?.nightDetail || ''} ${day?.nightCondition || ''}`;
  const kind = /thunder|storm/i.test(words) ? 'storms' : /snow/i.test(words) ? 'snow' : 'showers';
  const nightWet = /thunder|storm|rain|shower|drizzle|snow/i.test(`${day?.nightDetail || ''} ${day?.nightCondition || ''}`);
  const dayWet = /thunder|storm|rain|shower|drizzle|snow/i.test(day?.detail || '');
  const base = text.replace(/\s+then\s+.*$/i, '') || 'Mixed';
  if (tonight) return `Chance of ${kind}`;
  if (nightWet && !dayWet) return `${base}, then ${kind} tonight`;
  return `${base}, chance of ${kind}`;
}
