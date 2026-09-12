import {inDiscussionPolygon} from './weatherFusionSpecialDiscussions.js';

const HOUR=3600000;
const ENDPOINT='https://aviationweather.gov/api/data/airsigmet?format=json';
const PUBLIC_URL='https://aviationweather.gov/gfa/#sigmet';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const isoSeconds=value=>finite(value)?new Date(value*1000).toISOString():null;

function areaFromText(text){
 const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const validIndex=lines.findIndex(line=>/^VALID UNTIL \d{4}Z$/i.test(line));
 const value=validIndex>=0?lines[validIndex+1]:'';
 return /^[A-Z ]{2,100}$/.test(value||'')?value.replace(/\bAND\b/g,'and').replace(/\bCSTL WTRS\b/g,'coastal waters'):'';
}

export function normalizeConvectiveSigmet(item,location,now=Date.now()){
 if(!item||item.airSigmetType!=='SIGMET'||item.hazard!=='CONVECTIVE'||!/^\d{1,3}[ECW]$/.test(item.seriesId||''))return null;
 const sent=Number(item.validTimeFrom)*1000,expires=Number(item.validTimeTo)*1000;
 if(!finite(sent)||!finite(expires)||sent>now+5*60000||expires<=now||expires<=sent||expires-sent>3*HOUR)return null;
 const ring=(item.coords||[]).map(point=>[point?.lon,point?.lat]);
 if(ring.length<4||!ring.flat().every(finite)||!inDiscussionPolygon(location.longitude,location.latitude,[ring]))return null;
 const wording=String(item.rawAirSigmet||'').trim();
 if(!/^WSUS\d{2} KKCI/m.test(wording)||!new RegExp(`CONVECTIVE SIGMET ${item.seriesId}\\b`).test(wording)||wording.length>26000)return null;
 const area=areaFromText(wording);
 return {
  id:`awc-convective-sigmet-${item.seriesId}-${item.validTimeFrom}`,
  event:`Convective SIGMET ${item.seriesId}`,
  kind:'discussion',
  productType:'AWC-CSIGMET',
  applicable:true,
  sent:isoSeconds(Number(item.validTimeFrom)),
  expires:isoSeconds(Number(item.validTimeTo)),
  areaDesc:`Covers this location${area?` · ${area}`:''}. Aviation thunderstorm advisory; not a public warning.`,
  description:wording,
  instruction:'',
  url:PUBLIC_URL,
  movementDirection:finite(item.movementDir)?item.movementDir:null,
  movementSpeedKnots:finite(item.movementSpd)?item.movementSpd:null,
  topFlightLevel:finite(item.altitudeHi1)?item.altitudeHi1:null
 };
}

export function createConvectiveSigmetService({cached,now=Date.now}){
 return async location=>{
  const meta={id:'convective-sigmets',label:'AWC Convective SIGMETs',status:'unavailable',fetchedAt:null,issuedAt:null,url:PUBLIC_URL};
  try{
   const response=await cached(ENDPOINT,60000,{timeout:12000}),data=response.data;
   if(!Array.isArray(data)||data.length>400)throw new Error('Convective SIGMET source returned incomplete data.');
   const value=[...new Map(data.map(item=>normalizeConvectiveSigmet(item,location,now())).filter(Boolean).map(item=>[item.id,item])).values()];
   return {value,meta:{...meta,status:'ready',fetchedAt:response.fetchedAt,issuedAt:value.reduce((latest,item)=>Date.parse(item.sent)>Date.parse(latest||0)?item.sent:latest,null)}};
  }catch{return {value:null,meta:{...meta,message:'Convective SIGMETs could not be checked. Official public warnings remain independent.'}};}
 };
}
