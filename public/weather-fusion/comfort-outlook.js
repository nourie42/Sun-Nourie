import {outdoorExposure} from './outdoor-feels.js?v=weather-qa-v67';
import {finite,isTonightPeriod,localHour} from './weather-math.js?v=weather-qa-v67';
import {timeAt,summarizeFeels} from './hourly-feels.js?v=dewpoint-floor-v1';
import {forecastSample} from './weather-display.js?v=warmest-sun-explain-v1';
import {sunExposureTemperature} from './outdoor-feels.js?v=sun-exposure-v1';
export function comfortMode(time,zone='America/New_York'){
 const hour=localHour(time,zone);return isTonightPeriod(time,zone)?'overnight':hour<5?'predawn':'day';
}
const dateAt=(t,z)=>new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
/** The requested warmest card remains a same-day high after the daily row has
 * switched to Tonight. Keep the overnight narrative separate from this card. */
export function warmestTodayWindow(forecast,now=Date.now()){
 const zone=forecast?.location?.timeZone||'America/New_York',today=dateAt(now,zone);
 const tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const start=Math.max(timeAt(today,0,zone),Math.ceil(now/3600000)*3600000),end=timeAt(tomorrow,0,zone),points=[];
 let available=0,expected=0;
 for(const hour of forecast?.hours||[]){
  const epoch=Date.parse(hour.time);if(!finite(epoch)||epoch<start||epoch>=end)continue;expected++;
  const sample=forecastSample(forecast,hour.time);if(!sample)continue;available++;
  const sun=sunExposureTemperature(sample);if(sun.active&&finite(sun.value))points.push({time:hour.time,epoch,value:sun.value,source:'Sun-exposure estimate'});
 }
 if(!points.length)return null;
 const high=points.reduce((a,b)=>a.value>=b.value?a:b);
 return {mode:'day',chosen:high,high,points,available,expected,partial:available<expected,label:'Warmest feels like in the sun today'};
}
export function comfortWindow(forecast,now=Date.now()){
 const zone=forecast?.location?.timeZone||'America/New_York',mode=comfortMode(now,zone),today=dateAt(now,zone),tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const start=mode==='overnight'?timeAt(today,18,zone):timeAt(today,0,zone),end=mode==='day'?timeAt(today,19,zone):mode==='predawn'?timeAt(today,8,zone):timeAt(tomorrow,8,zone);
 const summary=summarizeFeels(forecast,start,end,now+1);if(!summary)return null;
 const chosen=mode==='day'?summary.high:summary.low;
 return {...summary,mode,chosen,low:summary.low.value,high:summary.high.value,lowTime:summary.low.time,highTime:summary.high.time,
  label:mode==='day'?'Forecast feels-like peak ahead':mode==='predawn'?'Forecast feels-like low before morning':'Forecast feels-like low tonight',end:summary.points.at(-1).time};
}
export function comfortNarrative(current,comfort,summary,zone='America/New_York'){
 const t=current?.temperature,dp=current?.dewpoint,wind=current?.wind,sentences=[],outdoor=outdoorExposure(comfort).value;
 if(!finite(outdoor))return 'A feels-like estimate needs temperature, moisture and wind readings. Some of those readings are missing.';
 if(finite(dp))sentences.push(dp>=68?`The ${Math.round(dp)}° dew point is keeping the air muggy.`:dp<50?`The ${Math.round(dp)}° dew point means dry air.`:`The ${Math.round(dp)}° dew point ${dp>=60?'adds some stickiness':'is fairly comfortable'}.`);
 if(finite(wind)&&wind>=8)sentences.push(`The ${Math.round(wind)} mph breeze is helping it feel ${finite(t)&&t<55?'colder':'cooler'}.`);
 if(summary){
  const clock=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(summary.chosen.time));
  const p=summary.chosen,inputs=p.inputs||{},period=summary.mode==='day'?'The highest remaining hourly outdoor estimate':summary.mode==='predawn'?'The lowest hourly outdoor estimate before morning':'The lowest hourly outdoor estimate tonight';
  if(summary.mode==='day'&&finite(outdoor)&&Math.round(outdoor)>=Math.round(p.value)) sentences.push(`Right now is the warmest outdoor estimate from now on at ${Math.round(outdoor)}°. The highest later hourly forecast is ${Math.round(p.value)}° at ${clock}${finite(inputs.temperature)?`, with an air temperature of ${Math.round(inputs.temperature)}°`:''}.`);
  else sentences.push(`${period} is ${Math.round(p.value)}° at ${clock}${finite(inputs.temperature)?`, with an air temperature of ${Math.round(inputs.temperature)}°`:''}.`);
  if(p.value<outdoor&&summary.mode==='day')sentences.push('Changing humidity, wind and sky conditions can make later hours feel cooler even if the air temperature rises.');
  if(summary.partial)sentences.push('Some forecast hours are unavailable, so this is the peak of the available readings only.');
 }
 return sentences.join(' ');
}
