/** Approved single-person weather photographs. This presentation layer never
 * changes a forecast number or infers precipitation type from temperature. */
export const WEATHER_PORTRAITS_VERSION='weather-portraits-cold-v2';
// Match the native comfort cards: the 30s require winter layers. Image names
// are legacy artwork identifiers, not the thresholds for clothing advice.
export const WINTER_CLOTHING_BELOW_F=42;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const stamp=v=>typeof v==='number'?v:Date.parse(v);
const four=['below-32f','32-59f','60-74f','75f-plus'];
const three=['below-32f','32-59f','60f-plus'];
const wet=['below-42f','below-60f','60f-plus'];
const winter=['below-32f','32-49f'];
export const PORTRAIT_BANDS=Object.freeze({clear:four,cloudy:four,'partly-cloudy':four,drizzle:wet,rain:wet,'heavy-rain':wet,storm:wet,hail:wet,fog:three,haze:three,dust:three,wind:three,snow:winter,'heavy-snow':winter,sleet:winter,'freezing-rain':winter,dawn:three,dusk:three});
export const PORTRAIT_FILES=Object.entries(PORTRAIT_BANDS).flatMap(([condition,bands])=>['dawn','dusk'].includes(condition)?bands.map(b=>`weather-her-${condition}-feels-${b}.webp`):['day','night'].flatMap(light=>bands.map(b=>`weather-her-${condition}-${light}-feels-${b}.webp`)));
const allowed=new Set(PORTRAIT_FILES);
export function portraitWeather(row={}){
 const text=String(row.condition||'').toLowerCase();
 // Keep phase priority explicit: freezing rain and sleet are not snow.
 if(/freezing (?:rain|drizzle)|ice storm|glaze/.test(text))return 'freezing-rain';
 if(/sleet|ice pellets|wintry mix|rain.*snow|snow.*rain/.test(text))return 'sleet';
 if(/hail/.test(text))return 'hail';
 if(/blizzard|heavy snow|snow squall/.test(text))return 'heavy-snow';
 if(/snow|flurr/.test(text))return 'snow';
 if(/thunder|\btstm\b|\bstorm/.test(text))return 'storm';
 if(/heavy rain|downpour|torrential/.test(text))return 'heavy-rain';
 if(/drizzle/.test(text))return 'drizzle';
 if(/rain|shower/.test(text)||row.rainNow===true)return 'rain';
 if(/fog|mist/.test(text))return 'fog';
 if(/smoke|haze|hazy/.test(text))return 'haze';
 if(/dust|sandstorm/.test(text))return 'dust';
 if(/windy|blowing|gale/.test(text))return 'wind';
 if(/partly|scattered clouds/.test(text))return 'partly-cloudy';
 if(/mostly (?:sunny|clear)|\bclear\b|\bsunny\b|\bfair\b/.test(text))return 'clear';
 if(/cloud|overcast|broken/.test(text))return 'cloudy';
 if(finite(row.skyCover)&&row.skyCover>=0&&row.skyCover<=100)return row.skyCover<20?'clear':row.skyCover<70?'partly-cloudy':'cloudy';
 return null;
}
export function selectWeatherPortrait(row={},options={}){
 const weather=portraitWeather(row),air=finite(row.temperature)?row.temperature:null,feels=finite(row.feels)?row.feels:null;
 const mode=options.mode==='air'?'air':'feels';
 const value=mode==='air'?air:feels??air;
 const basis=mode==='air'?'Air temperature':feels!==null?'Feels like':air!==null?'Air temperature (feels like unavailable)':'Temperature unavailable';
 if(!weather||value===null||typeof row.isDay!=='boolean')return {available:false,reason:!weather?'Weather condition unavailable':value===null?'Temperature unavailable':'Day/night information unavailable',air,feels,basis};
 let family=weather,light=row.isDay?'day':'night';
 const time=stamp(row.time);
 if(['clear','partly-cloudy'].includes(weather)&&finite(time)){
  for(const solar of options.solar||[]){
   const rise=stamp(solar?.sunrise),set=stamp(solar?.sunset);
   if(finite(rise)&&Math.abs(time-rise)<=30*60000){family='dawn';light='dawn';break;}
   if(finite(set)&&Math.abs(time-set)<=30*60000){family='dusk';light='dusk';break;}
  }
 }
 const bands=PORTRAIT_BANDS[family];
 const cold=value<WINTER_CLOTHING_BELOW_F;
 const band=bands===wet?(cold?'below-42f':value<60?'below-60f':'60f-plus'):bands===winter?(cold?'below-32f':'32-49f'):cold?'below-32f':value<60?'32-59f':bands===four?(value<75?'60-74f':'75f-plus'):'60f-plus';
 const file=`weather-her-${family}${['dawn','dusk'].includes(family)?'':'-'+light}-feels-${band}.webp`;
 if(!allowed.has(file))throw new Error('Unrecognized approved weather portrait');
 // Cold rain edits retain their matching liquid-rain park background. Never
 // substitute freezing rain or snow artwork because the person needs a coat.
 const background=file.replace('weather-her-','weather-her-bg-').replace('feels-below-42f','feels-below-60f');
 return {available:true,file,background,weather,light,band,value,basis,air,feels,cold,condition:String(row.condition||weather),illustrative:true};
}
