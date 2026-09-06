import {finite,localHour} from './weather-math.js';
export function comfortMode(time,zone='America/New_York') {
  const hour=localHour(time,zone);
  return hour>=15?'overnight':hour<5?'predawn':'day';
}
const dateAt=(t,z)=>new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export function comfortWindow(forecast,now=Date.now()) {
  const zone=forecast?.location?.timeZone||'America/New_York',mode=comfortMode(now,zone),today=dateAt(now,zone);
  const tomorrow=new Date(Date.parse(today)+86400000).toISOString().slice(0,10);
  const rows=(forecast?.metricForecasts?.series?.feels||[]).filter(p=>{
    const t=Date.parse(p.time);if(!finite(t)||t<now||!finite(p.value))return false;
    const date=dateAt(t,zone),hour=localHour(t,zone);
    return mode==='day'?date===today&&hour<19:mode==='predawn'?date===today&&hour<=7:
      (date===today&&hour>=18)||(date===tomorrow&&hour<=7);
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(!rows.length)return null;
  const cool=rows.reduce((a,b)=>a.value<=b.value?a:b),warm=rows.reduce((a,b)=>a.value>=b.value?a:b);
  const chosen=mode==='day'?warm:cool;
  return {mode,low:cool.value,high:warm.value,lowTime:cool.time,highTime:warm.time,chosen,
    label:mode==='day'?'warmest today':mode==='predawn'?'before sunrise':'coolest tonight',end:rows.at(-1).time,points:rows};
}
export function comfortNarrative(current,comfort,summary,zone='America/New_York') {
  const t=current?.temperature,dp=current?.dewpoint,wind=current?.wind,sentences=[];
  if(!finite(comfort?.shade))return 'A feels-like estimate needs temperature, moisture and wind readings. Some of those readings are missing.';
  if(finite(t)&&t<55){
    sentences.push(finite(wind)&&wind>=8?`The ${Math.round(wind)} mph wind is carrying heat away quickly, making the cold feel sharper than the air temperature alone.`:`The air itself is cool; with ${finite(wind)&&wind<3?'almost no wind':'only a light breeze'}, wind is not adding much extra bite.`);
    if(finite(dp)&&dp<40)sentences.push(`The ${Math.round(dp)}° dew point means dry air, so exposed skin may feel dry even though it is not hot.`);
  } else if(finite(dp)&&dp>=68)sentences.push(`The ${Math.round(dp)}° dew point is keeping the air muggy${finite(wind)&&wind<3?', and nearly calm air offers little relief':finite(wind)&&wind>=8?`, although the ${Math.round(wind)} mph breeze is helping take the edge off`:''}.`);
  else if(finite(dp)&&dp<50)sentences.push(`The low ${Math.round(dp)}° dew point lets sweat evaporate more easily${finite(wind)&&wind>=8?`, with the ${Math.round(wind)} mph breeze adding cooling`:''}, so the air feels less sticky.`);
  else if(finite(dp))sentences.push(`The ${Math.round(dp)}° dew point ${dp>=60?'adds a little stickiness':'is fairly comfortable'}${finite(wind)&&wind>=8?`, while the ${Math.round(wind)} mph breeze makes it feel cooler`:''}.`);
  if(summary){
    const when=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(summary.chosen.time));
    const later=summary.chosen.inputs,delta=summary.chosen.value-comfort.shade;
    let cause='';
    if(later&&finite(later.dewpoint)&&finite(dp)&&later.dewpoint<dp-3)cause=' as drier air moves in';
    else if(later&&finite(later.wind)&&finite(wind)&&later.wind>wind+4)cause=' as the breeze picks up';
    else if(later&&finite(later.temperature)&&finite(t)&&later.temperature>t+3)cause=' as the air warms';
    else if(later&&finite(later.temperature)&&finite(t)&&later.temperature<t-3)cause=' as the air cools';
    const lead=summary.mode==='day'?'Later today':summary.mode==='predawn'?'Before sunrise':'Tonight';
    sentences.push(`${lead}, the forecast ${delta>2?'rises to':delta<-2?'eases to':'stays near'} about ${Math.round(summary.chosen.value)}° around ${when}${cause}.`);
  }
  if(finite(comfort.sun)&&finite(comfort.shade)&&comfort.sun-comfort.shade>=2&&summary?.mode==='day')sentences.push(`In direct sun right now, the estimate is about ${Math.round(comfort.sun-comfort.shade)}° warmer than in shade.`);
  return sentences.slice(0,3).join(' ');
}
