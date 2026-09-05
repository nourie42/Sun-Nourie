/* Pure presentation math shared by the weather API, browser and tests. */
export const EXPERIENCE_VERSION = 'weather-nourie-friendly-v1';
export const finite = n => typeof n === 'number' && Number.isFinite(n);
const fToC = f => (f - 32) / 1.8;
const cToF = c => c * 1.8 + 32;
const sat = t => 6.112 * Math.exp(17.67 * t / (t + 243.5));
export function localHour(time, zone = 'America/New_York') {
  return Number(new Intl.DateTimeFormat('en-US', {timeZone:zone, hour:'numeric', hourCycle:'h23'}).format(new Date(time)));
}
export function dailyDisplay(day, index, now, zone) {
  const tonight = index === 0 && localHour(now, zone) >= 15;
  return {tonight, label:tonight?'Tonight':index===0?'Today':day.label,
    primary:tonight?day.low:day.high, secondary:tonight?null:day.low,
    primaryLabel:tonight?'Low':'High', condition:tonight?(day.nightCondition||day.condition):day.condition,
    detail:tonight?(day.nightDetail||day.detail):day.detail,
    pop:tonight?day.popNight:day.pop};
}
export function temperatureBar(value, floor, ceiling) {
  if (![value,floor,ceiling].every(finite)) return null;
  return Math.min(100,Math.max(0,(value-floor)/Math.max(1,ceiling-floor)*100));
}
export function humidityFromDewpoint(temp, dewpoint) {
  return finite(temp)&&finite(dewpoint)&&dewpoint<=temp+1 ? Math.min(100,Math.max(0,100*sat(fToC(dewpoint))/sat(fToC(temp)))) : null;
}
export function shadeFeelsLike(t, rh, wind, dewpoint) {
  if (!finite(t)) return {value:null,method:'Missing air temperature'};
  const humidity=finite(rh)&&rh>=0&&rh<=100?rh:humidityFromDewpoint(t,dewpoint);
  if(t<=50) {
    if(!finite(wind)||wind<0)return {value:null,method:'Missing wind for cold-weather calculation'};
    return wind>3?{value:35.74+.6215*t-35.75*wind**.16+.4275*t*wind**.16,method:'NWS wind chill'}:{value:t,method:'Air temperature; wind chill not applicable'};
  }
  if(!finite(humidity))return {value:null,method:'Humidity unavailable'};
  if(t>=80) {
    const simple=.5*(t+61+1.2*(t-68)+.094*humidity);
    if((simple+t)/2>=80) {
      let hi=-42.379+2.04901523*t+10.14333127*humidity-.22475541*t*humidity-.00683783*t*t-.05481717*humidity**2+.00122874*t*t*humidity+.00085282*t*humidity**2-.00000199*t*t*humidity**2;
      if(humidity<13&&t<=112)hi-=(13-humidity)/4*Math.sqrt((17-Math.abs(t-95))/17);
      else if(humidity>85&&t<=87)hi+=(humidity-85)/10*(87-t)/5;
      return {value:hi,method:'NWS heat index (shade)'};
    }
  }
  if(!finite(wind)||wind<0)return {value:null,method:'Wind unavailable'};
  const c=fToC(t),vapor=sat(c)*humidity/100;
  return {value:cToF(c+.33*vapor-.7*wind*.44704-4),method:'Steadman/BOM apparent temperature (shade)'};
}
export function wetBulb(t, rh) {
  if(!finite(t)||!finite(rh))return null;
  const c=fToC(t);
  if(c<0||c>50||rh<5||rh>99)return null;
  return cToF(c*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(c+rh)-Math.atan(rh-1.676331)+.00391838*rh**1.5*Math.atan(.023101*rh)-4.686035);
}
export function solarElevation(time, latitude, longitude) {
  if(![time,latitude,longitude].every(finite))return null;
  const r=Math.PI/180,d=time/86400000-10957.5,lw=-longitude*r,phi=latitude*r,m=r*(357.5291+.98560028*d);
  const l=m+r*(1.9148*Math.sin(m)+.0200*Math.sin(2*m)+.0003*Math.sin(3*m))+r*102.9372+Math.PI;
  const dec=Math.asin(Math.sin(l)*Math.sin(r*23.4397)),ra=Math.atan2(Math.sin(l)*Math.cos(r*23.4397),Math.cos(l)),h=r*(280.16+360.9856235*d)-lw-ra;
  return Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(h));
}
export function thermalComfort(current, location, now) {
  const rh=finite(current.humidity)?current.humidity:humidityFromDewpoint(current.temperature,current.dewpoint);
  const shade=shadeFeelsLike(current.temperature,rh,current.wind,current.dewpoint);
  const elevation=solarElevation(now,location.latitude,location.longitude);
  const daylight=finite(elevation)?elevation>0:null;
  const text=String(current.condition||'').toLowerCase();
  // This is a disclosed heuristic scenario, NOT measured radiation, WBGT or UTCI.
  let transmission=/thunder|storm|rain|shower|drizzle|fog|mist/.test(text)?.18:/overcast/.test(text)?.12:/mostly cloudy/.test(text)?.32:/partly cloudy|partly sunny/.test(text)?.66:/mostly sunny|few clouds/.test(text)?.86:/cloudy/.test(text)?.42:/sunny|clear/.test(text)?1:null;
  const adjustment=daylight&&finite(transmission)?(current.temperature<=50?18:15)*Math.max(0,Math.sin(elevation))**.65*transmission:null;
  return {shade:finite(shade.value)?Math.round(shade.value):null,sun:finite(shade.value)&&finite(adjustment)?Math.round(shade.value+adjustment):null,
    method:shade.method,humidity:rh,wetBulb:wetBulb(current.temperature,rh),daylight,solarAdjustment:adjustment,
    note:'Feels-like estimate, not measured skin temperature. The sun estimate uses solar height and sky wording, not a radiation sensor.'};
}
