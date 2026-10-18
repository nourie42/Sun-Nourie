/** Scene evidence for the selected forecast hour. No current-page sky or clock. */
import {sunPosition,moonPosition,moonIllumination} from '../atmos-sky.js?v=living-weather-v4';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const smooth=(low,high,value)=>{const t=clamp((value-low)/(high-low));return t*t*(3-2*t);};
const compass=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

export function windBearing(value){
  if(finite(value))return ((value%360)+360)%360;
  const index=compass.indexOf(String(value||'').trim().toUpperCase());
  return index<0?null:index*22.5;
}

/** Numeric hourly cloud cover takes priority; wording fills only missing data. */
export function selectedCloudCover(frame={}){
  if(finite(frame.cloudCover))return {cover:clamp(frame.cloudCover/100),basis:'hourly'};
  const text=String(frame.nativeCondition||frame.condition||'').toLowerCase();
  for(const [pattern,cover] of [[/overcast/,1],[/mostly cloudy|considerable cloud|broken/,.8],
    [/partly (?:sunny|cloudy)|scattered clouds/,.5],[/mostly (?:sunny|clear)|few clouds|\bfair\b/,.2],
    [/\b(?:sunny|clear)\b/,0],[/cloudy/,.95]]){
    if(pattern.test(text))return {cover,basis:'condition'};
  }
  const kind=frame.nativeWeatherKind;
  if(kind==='clear')return {cover:0,basis:'condition'};
  if(kind==='partly-cloudy')return {cover:.5,basis:'condition'};
  if(['cloudy','rain','snow','storm'].includes(kind))return {cover:.95,basis:'condition'};
  const code=frame.weatherCode;
  if(finite(code)){
    if(code===0)return {cover:0,basis:'condition'};
    if(code===1)return {cover:.2,basis:'condition'};
    if(code===2)return {cover:.5,basis:'condition'};
    if(code===3||code>=51)return {cover:.95,basis:'condition'};
  }
  return {cover:0,basis:'unavailable'};
}

/** The camera faces south: 75° at left, 285° at right, 78° at the upper edge. */
export function projectSelectedCelestial(position,{width=1,height=1,horizon=.58}={}){
  if(!position||!finite(position.azimuth)||!finite(position.altitude))return null;
  const x=(position.azimuth-75)/210*width;
  const skyBottom=height*horizon;
  const y=skyBottom-clamp(position.altitude/78,-.2,1.08)*(skyBottom-36);
  return {x,y,visible:position.altitude>-.833&&x>=0&&x<=width&&y>=0&&y<=skyBottom};
}

export function selectedHourSkyState(frame={}){
  const parsed=typeof frame.time==='string'?Date.parse(frame.time):frame.time;
  const time=finite(parsed)?parsed:null;
  const latitude=frame.latitude,longitude=frame.longitude;
  const knownLocation=finite(latitude)&&latitude>=-90&&latitude<=90&&finite(longitude)&&longitude>=-180&&longitude<=180;
  const location=knownLocation?{latitude,longitude}:null;
  const astronomy=time!==null&&location?{
    sun:sunPosition(time,latitude,longitude),moon:moonPosition(time,latitude,longitude),moonLight:moonIllumination(time)
  }:null;
  const altitude=astronomy?.sun.altitude??(frame.isDay===false?-18:frame.isDay===true?30:-6);
  const {cover,basis}=selectedCloudCover(frame);
  const code=frame.weatherCode;
  const native=frame.nativePolicy===true;
  const active=native?frame.nativePrecipitationActivity==='active':finite(code)&&([51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99].includes(code))||finite(frame.precipitation)&&frame.precipitation>0;
  const storm=native?frame.nativeWeatherKind==='storm'&&active:active&&[95,96,99].includes(code);
  const snow=native?frame.nativeSnowExpected===true&&active:active&&[71,73,75,77,85,86].includes(code);
  const rain=active&&!snow;
  const amount=finite(frame.precipitation)?Math.max(0,frame.precipitation):null;
  const density=amount===null?.42:clamp(.2+Math.sqrt(amount/.15)*.65,.2,1);
  const fog=native?frame.nativeWeatherKind==='fog':[45,48].includes(code);
  const dewpoint=finite(frame.dewpoint)?frame.dewpoint:null;
  const wind=finite(frame.windSpeed)?Math.max(0,frame.windSpeed):0;
  const bearing=windBearing(frame.windDirection);
  return {
    time,location,astronomy,cloudBasis:basis,
    lighting:altitude<-6?'night':altitude<3?'twilight':'day',
    nightAmount:1-smooth(-6,3,altitude),
    scene:{cover,rain:rain?density:0,snow:snow?density:0,fog:fog?.72:0,
      haze:dewpoint===null?0:clamp((dewpoint-58)/14)*.65,dark:storm?.82:rain?.45:snow?.22:0,
      storm,wind,windDir:bearing??270,sunAltitude:altitude},
    windKnown:finite(frame.windSpeed),windDirectionKnown:bearing!==null
  };
}
