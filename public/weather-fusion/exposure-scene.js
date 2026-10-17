import {weatherState} from './weather-state.js?v=current-rain-20261017-v2';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const COMFORT_ART_VERSION='true-night-art-v6';

/** A precise NWS clock clause can rule out a coarse snow allocation before
 * the stated transition. Null means no timed phase evidence is available.
 * Daily flags and untimed wording never establish an hour's phase here. */
export function selectedHourSnowPhase(forecast,time){
 const epoch=typeof time==='number'?time:Date.parse(time);
 if(!finite(epoch))return null;
 const contains=(start,end)=>{const a=Date.parse(start),b=Date.parse(end);return finite(a)&&finite(b)&&a<=epoch&&epoch<b;};
 let date=null;
 try{date=new Intl.DateTimeFormat('en-CA',{timeZone:forecast?.location?.timeZone||'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(epoch));}catch{}
 const periods=(forecast?.snow?.days||[]).filter(row=>{
  const window=row.amountWindow||row.displaySnowfall;
  return window?.start&&window?.end?contains(window.start,window.end):!row.date||row.date===date;
 }).flatMap(row=>row.periods||[]).filter(period=>period.snowTimed===true&&Array.isArray(period.snowPhaseWindows)&&contains(period.start||period.startTime,period.end||period.endTime));
 if(!periods.length)return null;
 return periods.some(period=>period.snowPhaseWindows.some(window=>contains(window.start,window.end)));
}

/** Snow is distinct from sleet/freezing rain. Only snow evidence selects
 * snow-covered scenes; a low feels-like alone never paints snow. */
export function winterSceneExpected(condition='',context={}){
 if(/snow|flurr|blizzard/i.test(String(condition)))return true;
 if(context.snowExpected===false)return false;
 if(context.hourSnowPhaseAllowed===false)return false;
 // A liquid-rain, thunder, dry-sky or ice-only hour cannot become a snow scene
 // because a daily total or coarse snow interval extends across that hour.
 const kind=weatherState(condition).kind;
 if(['rain','storm','clear','partly-cloudy','snow'].includes(kind))return false;
 // Current scenes follow current reported conditions, not future snowfall.
 // Numeric fallback is limited to a plausible, explicitly selected hour.
 if(context.snowScope!=='hour'||context.now===true||context.forecast===false)return false;
 if(!finite(context.airTemperature)||context.airTemperature>40)return false;
 return context.snowExpected===true||(finite(context.snowfall)&&context.snowfall>0)||(finite(context.snowChance)&&context.snowChance>0);
}
export function clothingForFeels(value,context={}){
 if(context.snowExpected===true)return 'cold';
 if(!finite(value)&&finite(context.clothingFeels))value=context.clothingFeels;
 if(!finite(value))return 'mild';
 if(value>=88)return 'hot';
 if(value>=74)return 'warm';
 if(value>=65)return 'mild';
 if(value>=42)return 'cool';
 return 'cold';
}
export function precipitationActivity(condition='',context={}){
 const weather=weatherState(condition),pop=context.pop;
 if(context.rainAround===true||context.radarThreat===true||context.rainExpected===true)return 'active';
 // Rain probability expresses how likely the stated phase is, not whether
 // its illustration can be replaced with clear skies. In particular, an
 // ensemble probability below 50% must not erase an official hourly storm.
 const liquidWeather=['rain','storm'].includes(weather.kind)||/freezing (?:rain|drizzle)/i.test(condition);
 if(liquidWeather){
  if(!weather.chance)return 'active';
  return finite(pop)&&pop>=61?'active':'possible';
 }
 if(finite(pop))return pop>=61?'active':pop>=50?'possible':'none';
 return 'none';
}
const baseAssets={normal:'comfort-reference-scenes.webp',hot:'comfort-reference-scenes-hot.webp',rain:'comfort-reference-scenes-rain.webp','carry-umbrella':'comfort-reference-scenes-carry-umbrella.svg',fog:'comfort-reference-scenes-fog.webp',watch:'comfort-reference-scenes-watch.webp',dawn:'comfort-reference-scenes-dawn.webp'};
const integratedKeys=['normal','watch','fog','dawn','rain','carry-umbrella'];
const integratedAsset=(outfit,key)=>`comfort-integrated-${outfit}-${key}.webp`;
const nightAsset=(outfit,group)=>`comfort-night-${outfit}-${group}.webp`;
const nightAssets=['cold','cool','mild','warm'].flatMap(outfit=>['dry-chance','rain-fog'].map(group=>nightAsset(outfit,group)));
export const COMFORT_SCENE_ASSETS=[...Object.values(baseAssets),...['cold','cool'].flatMap(outfit=>integratedKeys.map(key=>integratedAsset(outfit,key))),...integratedKeys.filter(key=>key!=='rain').map(key=>integratedAsset('mild',key)),'comfort-integrated-snow-play.webp','comfort-integrated-snow-play-dawn.webp','comfort-integrated-rain-night.webp',...nightAssets];

/** Each selected asset is a complete image with garments rendered into the
 * characters. The renderer never adds separate clothing geometry. */
export function comfortSceneState(daylight=true,condition='Clear',feels=null,context={}){
 const weather=weatherState(condition),snow=winterSceneExpected(condition,context);
 if(snow)return {key:'snow',asset:daylight?'comfort-integrated-snow-play.webp':'comfort-integrated-snow-play-dawn.webp'};
 const precipitation=precipitationActivity(condition,context);
 const outfit=clothingForFeels(feels,{...context,snowExpected:weather.kind==='snow'});
 if(!daylight){
  // Every weather category needs its own actual night artwork. Rain chances
  // must not bypass darkness or borrow active-rain scenes with open umbrellas.
  const key=precipitation==='active'?'rain':precipitation==='possible'?'carry-umbrella':weather.kind==='fog'?'fog':'night';
  const profile=['warm','hot'].includes(outfit)?'warm':outfit;
  const group=['rain','fog'].includes(key)?'rain-fog':'dry-chance';
  return {key,asset:nightAsset(profile,group),rows:2,row:['carry-umbrella','fog'].includes(key)?1:0};
 }
 const key=precipitation==='active'?'rain':precipitation==='possible'?'carry-umbrella':weather.kind==='fog'?'fog':['cloudy','snow'].includes(weather.kind)?'watch':outfit==='hot'&&['clear','partly-cloudy'].includes(weather.kind)?'hot':'normal';
 let asset=baseAssets[key];
 if(['cold','cool','mild'].includes(outfit)&&finite(finite(context.clothingFeels)?context.clothingFeels:feels)){
  // The integrated rain version includes full trousers as well as raincoats.
  asset=integratedAsset(outfit==='mild'&&key==='rain'?'cool':outfit,key==='hot'?'normal':key);
 }
 return {key,asset};
}
const comfortSceneUrl=asset=>`/weather-fusion/${asset}?v=${COMFORT_ART_VERSION}`;
/** Preload only requested scenes; fetching every clothing/sky combination
 * would download several megabytes this visit might never display. */
export function preloadComfortScenes(assets=[baseAssets.normal]){
 if(typeof Image==='undefined')return false;
 for(const asset of new Set(assets)){
  if(!COMFORT_SCENE_ASSETS.includes(asset))continue;
  const image=new Image();image.decoding='async';image.src=comfortSceneUrl(asset);
 }
 return true;
}
export function referenceScene(panel,daylight=true,condition='Clear',feels=null,context={}){
 if(!Number.isInteger(panel)||panel<0||panel>2)return '';
 const weather=weatherState(condition),scene=comfortSceneState(daylight,condition,feels,context);
 const outfit=clothingForFeels(feels,{...context,snowExpected:scene.key==='snow'||weather.kind==='snow'});
 const knownClothing=finite(feels)||finite(context.clothingFeels)||scene.key==='snow'||weather.kind==='snow';
 const clothing=knownClothing?{hot:'light hot-weather clothing',warm:'light warm-weather clothing',mild:'a top and long pants',cool:'a light jacket and long pants',cold:'a heavy coat, scarf, warm hat, gloves and boots'}[outfit]:'everyday clothing';
 const subject=panel===0?'A boy sitting beneath a shade tree':panel===1?'A boy outdoors':'A woman walking a light brown toy poodle';
 const rainAction=panel===0?'sheltering beneath a leafy tree as steady rain falls nearby':'using rain gear and an umbrella in steady rain';
 const action={hot:'visibly reacting to extreme heat in light hot-weather clothing',rain:rainAction,'carry-umbrella':'carrying a closed umbrella under a cloudy sky because rain is possible but not likely enough to open it',fog:'clearly visible in diffuse fog with no direct sunlight',watch:'looking at a cloudy sky with no rain gear needed',night:'outdoors at night under a dark sky',normal:`outdoors in ${clothing}`}[scene.key];
 let label=panel===2&&scene.key==='rain'?'A woman in rain gear walking a light brown toy poodle as the dog shakes rainwater from its fur':`${subject}, ${action}; clothing: ${clothing}`;
 if(scene.key==='snow')label=(panel===0?'A child in a heavy coat, warm hat, scarf, mittens and boots building a snowman beneath a snowy tree':panel===1?'A person in a heavy coat, warm hat, scarf, mittens and boots playing with snowballs':'A woman in a heavy coat, warm hat, scarf, mittens and boots playing in the snow with a light brown poodle')+'; illustration of forecast snow';
 if(!daylight)label+='; nighttime illustration with no daylight';
 const garment=outfit==='cold'?'heavy-coat-and-trousers':outfit==='cool'?'jacket-and-trousers':scene.key==='rain'?'rainwear-and-trousers':outfit==='mild'?'long-trousers':'light-clothing';
 return `<svg class="reference-scene${scene.key==='snow'?' snow-play-scene':''}${panel===2?' poodle-scene':''}" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label}" data-scene="${scene.key}" data-outfit="${outfit}" data-visible-outfit="${outfit}" data-garment="${garment}" data-artwork="complete-image" data-daylight="${daylight}" data-weather="${scene.key==='snow'?'snow':weather.kind}"><image class="reference-art" href="${comfortSceneUrl(scene.asset)}" x="${-300*panel}" y="${-300*(scene.row||0)}" width="900" height="${300*(scene.rows||1)}" preserveAspectRatio="none"/></svg>`;
}
export function exposureScene(sun,daylight=true,condition='Clear',feels=null,context={}){
 return referenceScene(sun?1:0,daylight,condition,feels,context);
}
