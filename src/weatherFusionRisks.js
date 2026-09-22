const SPC_ROOT='https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query';
const WPC_URL='https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day1_Latest.geojson';
const WPC_DISCUSSION_URL='https://www.wpc.ncep.noaa.gov/discussions/hpcdiscussions.php?disc=qpferd&fmt=reg';
const SPC_DISCUSSION_URL='https://www.spc.noaa.gov/products/outlook/day1otlk.txt';
const WPC_PAGE='https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php';
const SPC_PAGE='https://www.spc.noaa.gov/products/outlook/day1otlk.html';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const stamp=value=>{
 const text=String(value||'');
 if(/^\d{12}$/.test(text))return Date.UTC(+text.slice(0,4),+text.slice(4,6)-1,+text.slice(6,8),+text.slice(8,10),+text.slice(10,12));
 const parsed=Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(text)?text:text.replace(' ','T')+'Z');
 return Number.isFinite(parsed)?parsed:NaN;
};
function inRing(longitude,latitude,ring){
 if(!Array.isArray(ring)||ring.length<4)return false;
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [ax,ay]=ring[j]||[],[bx,by]=ring[i]||[];
  if(![ax,ay,bx,by].every(finite))return false;
  const cross=(longitude-ax)*(by-ay)-(latitude-ay)*(bx-ax);
  if(Math.abs(cross)<1e-9&&longitude>=Math.min(ax,bx)&&longitude<=Math.max(ax,bx)&&latitude>=Math.min(ay,by)&&latitude<=Math.max(ay,by))return true;
  if((ay>latitude)!==(by>latitude)&&longitude<(bx-ax)*(latitude-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside;
}
export function inGeoJson(longitude,latitude,geometry){
 if(!finite(longitude)||!finite(latitude)||!geometry)return false;
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 return polygons.some(polygon=>Array.isArray(polygon)&&inRing(longitude,latitude,polygon[0])&&!polygon.slice(1).some(ring=>inRing(longitude,latitude,ring)));
}
const spcLabel={3:'Marginal',4:'Slight',5:'Enhanced',6:'Moderate',8:'High'};
const wpcRank={marginal:1,slight:2,moderate:3,high:4};
const DAY=86400000;
function availableDayOneRisk(issue,start,end,now){
 return [issue,start,end,now].every(finite)&&issue<=now&&start<=now+DAY&&end>now;
}
export function normalizeSpcRisk(attributes,now=Date.now()){
 const level=spcLabel[Number(attributes?.dn)],issue=stamp(attributes?.issue),start=stamp(attributes?.valid),end=stamp(attributes?.expire);
 if(!level||!availableDayOneRisk(issue,start,end,now))return null;
 return {id:`spc-day1-${level.toLowerCase()}`,kind:'spc',level,rank:Number(attributes.dn),title:`${level} risk of severe storms today`,summary:level==='Marginal'?'A few storms could become strong.':'Severe storms are possible. Stay weather-aware.',issuedAt:new Date(issue).toISOString(),validFrom:new Date(start).toISOString(),expires:new Date(end).toISOString(),url:'https://www.spc.noaa.gov/products/outlook/day1otlk.html'};
}
export function normalizeWpcRisk(feature,longitude,latitude,now=Date.now()){
 const p=feature?.properties||{},level=String(p.OUTLOOK||'').match(/Marginal|Slight|Moderate|High/i)?.[0],issue=stamp(p.ISSUE_TIME),start=stamp(p.START_TIME),end=stamp(p.END_TIME);
 if(!level||!inGeoJson(longitude,latitude,feature.geometry)||!availableDayOneRisk(issue,start,end,now))return null;
 return {id:`wpc-day1-${level.toLowerCase()}`,kind:'wpc',level,rank:wpcRank[level.toLowerCase()]||0,title:`${level} risk of flooding rain today`,summary:level==='Marginal'?'Heavy rain could cause flooding in a few spots.':'Heavy rain could cause flooding. Keep away from flooded roads.',issuedAt:new Date(issue).toISOString(),validFrom:new Date(start).toISOString(),expires:new Date(end).toISOString(),url:'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php'};
}
export function createRiskOutlookService({cached,now=Date.now}){
 return async location=>{
  const spcMeta={id:'spc-outlook',label:'SPC severe-weather outlook',status:'unavailable',fetchedAt:null,issuedAt:null,url:'https://www.spc.noaa.gov/products/outlook/day1otlk.html'};
  const wpcMeta={id:'wpc-outlook',label:'WPC excessive-rainfall outlook',status:'unavailable',fetchedAt:null,issuedAt:null,url:'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php'};
  const spc=(async()=>{try{
   const q=new URLSearchParams({f:'json',where:'1=1',geometry:`${location.longitude},${location.latitude}`,geometryType:'esriGeometryPoint',inSR:'4326',outSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'dn,valid,expire,issue,label,label2',returnGeometry:'false'});
   const response=await cached(`${SPC_ROOT}?${q}`,120000,{timeout:12000}),features=response.data?.features;
   if(!Array.isArray(features)||response.data?.error)throw new Error('SPC outlook unavailable.');
   const value=features.map(f=>normalizeSpcRisk(f.attributes,now())).filter(Boolean).sort((a,b)=>b.rank-a.rank)[0]||null;
   return {value,meta:{...spcMeta,status:'ready',fetchedAt:response.fetchedAt,issuedAt:value?.issuedAt||null}};
  }catch{return {value:null,meta:{...spcMeta,message:'SPC outlook could not be checked.'}};}})();
  const wpc=(async()=>{try{
   const response=await cached(WPC_URL,120000,{timeout:12000}),features=response.data?.features;
   if(!Array.isArray(features))throw new Error('WPC outlook unavailable.');
   const value=features.map(f=>normalizeWpcRisk(f,location.longitude,location.latitude,now())).filter(Boolean).sort((a,b)=>b.rank-a.rank)[0]||null;
   return {value,meta:{...wpcMeta,status:'ready',fetchedAt:response.fetchedAt,issuedAt:value?.issuedAt||null}};
  }catch{return {value:null,meta:{...wpcMeta,message:'WPC outlook could not be checked.'}};}})();
  const results=await Promise.all([spc,wpc]);
  return {value:results.map(r=>r.value).filter(Boolean),meta:results.map(r=>r.meta)};
 };
}

const decodeEntities=value=>String(value||'').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,match=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[match]));
export const OUTLOOK_LEGEND={
 wpc:[{id:'MRGL',level:'Marginal',color:'#74d36a'},{id:'SLGT',level:'Slight',color:'#f4e14a'},{id:'MDT',level:'Moderate',color:'#e03b3b'},{id:'HIGH',level:'High',color:'#d34cff'}],
 spc:[{id:'MRGL',level:'Marginal',color:'#74d36a'},{id:'SLGT',level:'Slight',color:'#f4e14a'},{id:'ENH',level:'Enhanced',color:'#e67a22'},{id:'MDT',level:'Moderate',color:'#e03b3b'},{id:'HIGH',level:'High',color:'#d34cff'}],
};
export function outlookLevelFromText(value){
 return String(value||'').match(/Marginal|Slight|Enhanced|Moderate|High/i)?.[0]||null;
}
export function parseWpcDiscussion(html){
 const raw=String(html||'');
 const pre=raw.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1]||raw;
 const text=decodeEntities(pre).replace(/<[^>]+>/g,'').replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').trim();
 if(!/Excessive Rainfall Discussion/i.test(text))return null;
 const office=text.match(/NWS Weather Prediction Center[^\n]+/i)?.[0]?.trim()||'NWS Weather Prediction Center College Park MD';
 const issued=text.match(/(?:\d{1,2}:\d{2}|\d{3,4})\s*[AP]M\s+[A-Z]{3,4}\s+\w{3}\s+\w+\s+\d{1,2}\s+\d{4}/i)?.[0]||null;
 const valid=text.match(/Day 1\s*(?:\n\s*)?Valid\s+([^\n]+)/i)?.[1]?.trim()||null;
 const discussion=text.match(/Day 1\b[\s\S]*?(?=\nDay 2\b|\nDay 4\b|\n\$\$|$)/i)?.[0]?.trim()||null;
 if(!discussion)return null;
 return {product:'Excessive Rainfall Discussion',office,issued,validLabel:valid?`Day 1 Valid ${valid}`:'Day 1',discussion};
}
export function parseSpcDiscussion(text){
 const clean=String(text||'').replace(/\r/g,'').trim();
 if(!/Day 1 Convective Outlook|Storm Prediction Center/i.test(clean))return null;
 return {product:'Day 1 Convective Outlook',office:'NWS Storm Prediction Center Norman OK',issued:null,validLabel:'Day 1 convective outlook',discussion:clean.slice(0,20000)};
}
export function outlookMapFeatures(features){
 return (features||[]).flatMap(feature=>{
  const level=outlookLevelFromText(feature?.properties?.OUTLOOK||feature?.properties?.LABEL||feature?.level);
  if(!level||!feature?.geometry)return [];
  return [{level,geometry:feature.geometry}];
 });
}
function esriGeometryToGeoJson(geometry){
 if(Array.isArray(geometry?.rings)&&geometry.rings.length)return {type:geometry.rings.length>1?'Polygon':'Polygon',coordinates:geometry.rings};
 if(Array.isArray(geometry?.paths)&&geometry.paths.length)return {type:'MultiLineString',coordinates:geometry.paths};
 return null;
}
export function outlookSpcMapFeatures(features){
 return (features||[]).flatMap(feature=>{
  const level=spcLabel[Number(feature?.attributes?.dn)]||outlookLevelFromText(feature?.attributes?.label);
  const geometry=esriGeometryToGeoJson(feature?.geometry);
  if(!level||!geometry)return [];
  return [{level,geometry}];
 });
}
function detailBase(kind,location){
 return {
  kind,title:'Outlooks',
  product:kind==='wpc'?'Excessive Rainfall Discussion':'Day 1 Convective Outlook',
  office:kind==='wpc'?'NWS Weather Prediction Center College Park MD':'NWS Storm Prediction Center Norman OK',
  issued:null,validLabel:null,discussion:null,features:[],legend:OUTLOOK_LEGEND[kind],
  location:location&&finite(location.latitude)&&finite(location.longitude)?{latitude:location.latitude,longitude:location.longitude}:null,
  sourceUrl:kind==='wpc'?WPC_PAGE:SPC_PAGE,
 };
}
export function createOutlookDetailService({cached,now=Date.now}){
 return async ({kind,location}={})=>{
  if(kind!=='wpc'&&kind!=='spc'){const error=new Error('Choose a WPC or SPC outlook.');error.status=400;throw error;}
  const detail=detailBase(kind,location);
  if(kind==='wpc'){
   const [geo,disc]=await Promise.allSettled([
    cached(WPC_URL,120000,{timeout:12000}),
    cached(WPC_DISCUSSION_URL,120000,{text:true,timeout:12000}),
   ]);
   if(geo.status==='fulfilled'&&Array.isArray(geo.value.data?.features))detail.features=outlookMapFeatures(geo.value.data.features);
   if(disc.status==='fulfilled')Object.assign(detail,parseWpcDiscussion(disc.value.data)||{});
   if(!detail.features.length&&!detail.discussion){const error=new Error('The excessive rainfall outlook could not be loaded.');error.status=503;throw error;}
   return detail;
  }
  const q=new URLSearchParams({f:'json',where:'1=1',outSR:'4326',outFields:'dn,valid,expire,issue,label,label2',returnGeometry:'true'});
  const [geo,disc]=await Promise.allSettled([
   cached(`${SPC_ROOT}?${q}`,120000,{timeout:12000}),
   cached(SPC_DISCUSSION_URL,120000,{text:true,timeout:12000}),
  ]);
  if(geo.status==='fulfilled'&&Array.isArray(geo.value.data?.features))detail.features=outlookSpcMapFeatures(geo.value.data.features);
  if(disc.status==='fulfilled')Object.assign(detail,parseSpcDiscussion(disc.value.data)||{});
  if(!detail.features.length&&!detail.discussion){const error=new Error('The severe-weather outlook could not be loaded.');error.status=503;throw error;}
  return detail;
 };
}
