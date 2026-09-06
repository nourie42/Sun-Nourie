import {finite,localHour} from './weather-math.js';
import {timeAt,summarizeFeels} from './hourly-feels.js';
export function comfortMode(time,zone='America/New_York'){
 const hour=localHour(time,zone);return hour>=15?'overnight':hour<5?'predawn':'day';
}
const dateAt=(t,z)=>new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export function comfortWindow(forecast,now=Date.now()){
 const zone=forecast?.location?.timeZone||'America/New_York',mode=comfortMode(now,zone),today=dateAt(now,zone),tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const start=mode==='overnight'?timeAt(today,18,zone):timeAt(today,0,zone),end=mode==='day'?timeAt(today,19,zone):mode==='predawn'?timeAt(today,8,zone):timeAt(tomorrow,8,zone);
 const summary=summarizeFeels(forecast,start,end,now);if(!summary)return null;
 const chosen=mode==='day'?summary.high:summary.low;
 return {...summary,mode,chosen,low:summary.low.value,high:summary.high.value,lowTime:summary.low.time,highTime:summary.high.time,
  label:mode==='day'?'Forecast feels-like peak ahead':mode==='predawn'?'Forecast feels-like low before morning':'Forecast feels-like low tonight',end:summary.points.at(-1).time};
}
export function comfortNarrative(current,comfort,summary,zone='America/New_York'){
 const t=current?.temperature,dp=current?.dewpoint,wind=current?.wind,sentences=[];
 if(!finite(comfort?.shade))return 'A feels-like estimate needs temperature, moisture and wind readings. Some of those readings are missing.';
 if(finite(dp))sentences.push(dp>=68?`The ${Math.round(dp)}° dew point is keeping the air muggy.`:dp<50?`The ${Math.round(dp)}° dew point means dry air.`:`The ${Math.round(dp)}° dew point ${dp>=60?'adds some stickiness':'is fairly comfortable'}.`);
 if(finite(wind)&&wind>=8)sentences.push(`The ${Math.round(wind)} mph breeze is helping it feel ${finite(t)&&t<55?'colder':'cooler'}.`);
 if(summary){
  const clock=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(summary.chosen.time));
  const p=summary.chosen,inputs=p.inputs||{},period=summary.mode==='day'?'The highest remaining hourly shade estimate':summary.mode==='predawn'?'The lowest hourly shade estimate before morning':'The lowest hourly shade estimate tonight';
  sentences.push(`${period} is ${Math.round(p.value)}° at ${clock}${finite(inputs.temperature)?`, with an air temperature of ${Math.round(inputs.temperature)}°`:''}.`);
  if(p.value<=comfort.shade&&summary.mode==='day')sentences.push('That forecast is not being forced above the current reading; changing humidity and wind can offset warmer air.');
  if(summary.partial)sentences.push('Some forecast hours are unavailable, so this is the peak of the available readings only.');
 }
 return sentences.join(' ');
}
