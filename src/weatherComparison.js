import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildForecast,dateKey,nextDate,Cache} from './weatherFusion.js';
import {solarTimes} from './weatherFusionDirect.js';
import {rebuildHourlyFeels} from './weatherFusionHourlyFeels.js';
import {humidityFromDewpoint,solarElevation} from '../public/weather-fusion/weather-math.js';
import {timeAt} from '../public/weather-fusion/hourly-feels.js';
import {GOOGLE_FEED,HOUR,finite,googlePoints,selectGoogleForecast,skyDescription} from './weatherComparisonData.js';
import {ensembleConfidence,fetchComparisonCompanions,addComparisonCompanions} from './weatherComparisonCompanions.js';
import express from 'express';
import {createWeatherNextAccess} from './weatherNextAccess.js';
import {createWeatherNextLocationProvider,locationPoint} from './weatherNextLocation.js';
const root=fileURLToPath(new URL('../public/weather-fusion/',import.meta.url));
const version='air-hero-v1';
const mean=a=>{const v=a.filter(finite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
const extreme=(a,fn)=>{const v=a.filter(finite);return v.length?fn(...v):null;};
const round=v=>finite(v)?Math.round(v*10)/10:null;
const compass=d=>finite(d)?['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]:null;
const iso=t=>new Date(t).toISOString();
const pointDistanceMiles=(a,b)=>{const lat=(a.latitude+b.latitude)*Math.PI/360;return Math.hypot((a.latitude-b.latitude)*69,(a.longitude-b.longitude)*69*Math.cos(lat));};
export function buildGoogleComparison(feed,pointId,now=Date.now()){
 const selected=selectGoogleForecast(feed,pointId,now),p=selected.point,zone=p.timeZone,start=Math.floor(now/HOUR)*HOUR;
 // Empty structural template only. No non-Google forecast is supplied to this builder.
 const out=buildForecast({location:p,point:{timeZone:zone},models:{},feeds:[],grid:{},forecast:{periods:[]},hourly:{periods:[]},now});
 const all=selected.rows.map(r=>({...r,humidity:humidityFromDewpoint(r.temperature,r.dewpoint)}));
 const future=all.filter(r=>r.epoch>=start),map=new Map(all.map(r=>[r.epoch,r]));
 const hour=r=>({...r,windMph:r.wind,wind:finite(r.wind)?`${round(r.wind)} mph`:null,windDirectionDegrees:r.windDirection,windDirection:compass(r.windDirection),isDay:solarElevation(r.epoch,p.latitude,p.longitude)>0,precipitationSource:'Google WeatherNext model-native ensemble mean',rainLikelihood:{value:null,source:'Not