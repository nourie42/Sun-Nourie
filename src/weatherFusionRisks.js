const SPC_ROOT='https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query';
const WPC_URL='https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day1_Latest.geojson';
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
