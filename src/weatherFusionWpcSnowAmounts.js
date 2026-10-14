import {inflateRawSync} from 'node:zlib';

const HOUR=3600000,MAX_ARCHIVE=8*1024*1024,MAX_KML=20*1024*1024;
export const WPC_SNOW_GIS_ROOT='https://ftp-wpc.ncep.noaa.gov/prob_precip_portal/co/gis/';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const FILE=/^ppp_co_24hr_expected_sn_in_(\d{10})f(\d{3})\.kmz$/;
const iso=t=>new Date(t).toISOString();
const cycleTime=cycle=>Date.UTC(+cycle.slice(0,4),+cycle.slice(4,6)-1,+cycle.slice(6,8),+cycle.slice(8,10));
const stamp=s=>Date.parse(String(s||'').trim().replace(' ','T')+'Z');
const xmlText=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");

export function wpcSnowFileMetadata(file){
 const match=FILE.exec(file||'');if(!match)throw new Error('Unexpected WPC snow amount filename.');
 const run=cycleTime(match[1]),lead=+match[2];
 if(!finite(run)||iso(run).replace(/[-:TZ.]/g,'').slice(0,10)!==match[1]||lead<1||lead>240)throw new Error('Invalid WPC snow forecast cycle or lead.');
 return {file,cycle:match[1],issuedAt:iso(run),start:iso(run+(lead-24)*HOUR),end:iso(run+lead*HOUR),unit:'in',quantity:'snowfall',parameter:'deterministic',durationHours:24};
}
export function wpcSnowArchiveUrl(file){const meta=wpcSnowFileMetadata(file);return WPC_SNOW_GIS_ROOT+`ppp_gis_co_24hr_${meta.cycle}/`+file;}

/** Only extract a bounded KML member from a ZIP/KMZ archive; no filesystem writes. */
export function kmlFromKmz(input){
 const b=Buffer.isBuffer(input)?input:Buffer.from(input||[]);
 if(b.length<22||b.length>MAX_ARCHIVE)throw new Error('WPC snow archive is empty or oversized.');
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||end+22>b.length)throw new Error('Invalid WPC snow KMZ directory.');
 const count=b.readUInt16LE(end+10),directory=b.readUInt32LE(end+16);if(count<1||count>8||directory>=end)throw new Error('Unexpected WPC snow archive contents.');
 let cursor=directory;
 for(let i=0;i<count;i++){
  if(cursor+46>b.length||b.readUInt32LE(cursor)!==0x02014b50)throw new Error('Malformed WPC snow archive.');
  const flags=b.readUInt16LE(cursor+8),method=b.readUInt16LE(cursor+10),compressed=b.readUInt32LE(cursor+20),size=b.readUInt32LE(cursor+24),nameLength=b.readUInt16LE(cursor+28),extra=b.readUInt16LE(cursor+30),comment=b.readUInt16LE(cursor+32),offset=b.readUInt32LE(cursor+42);
  const name=b.subarray(cursor+46,cursor+46+nameLength).toString('utf8');cursor+=46+nameLength+extra+comment;
  if(!/\.kml$/i.test(name))continue;
  if(flags&1||size>MAX_KML||offset+30>b.length||b.readUInt32LE(offset)!==0x04034b50)throw new Error('Unsupported WPC snow KMZ member.');
  const start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28);
  if(start+compressed>b.length||compressed>MAX_ARCHIVE)throw new Error('Truncated WPC snow KMZ.');
  const raw=method===0?b.subarray(start,start+compressed):method===8?inflateRawSync(b.subarray(start,start+compressed),{maxOutputLength:MAX_KML}):null;
  if(!raw||raw.length!==size)throw new Error('Invalid WPC snow KML size.');
  return raw.toString('utf8');
 }
 throw new Error('WPC snow archive has no KML document.');
}
function ring(text){
 const points=String(text||'').trim().split(/\s+/).filter(Boolean).map(token=>token.split(',').slice(0,2).map(Number));
 if(points.length<4||points.length>100000||points.some(p=>p.length!==2||!p.every(finite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error('Invalid WPC snow contour coordinates.');
 const first=points[0],last=points.at(-1);if(first[0]!==last[0]||first[1]!==last[1])points.push([...first]);
 return points;
}
function bounds(rings){let west=180,south=90,east=-180,north=-90;for(const row of rings)for(const [x,y] of row){west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);}return [west,south,east,north];}
function containsRing(x,y,points){
 let inside=false;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const [xi,yi]=points[i],[xj,yj]=points[j];
  const cross=(x-xi)*(yj-yi)-(y-yi)*(xj-xi);
  if(Math.abs(cross)<1e-10&&x>=Math.min(xi,xj)-1e-10&&x<=Math.max(xi,xj)+1e-10&&y>=Math.min(yi,yj)-1e-10&&y<=Math.max(yi,yj)+1e-10)return true;
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
function containsPolygon(lon,lat,feature){
 const [w,s,e,n]=feature.bbox;if(lon<w||lon>e||lat<s||lat>n)return false;
 const rings=feature.geometry.coordinates;return containsRing(lon,lat,rings[0])&&!rings.slice(1).some(r=>containsRing(lon,lat,r));
}
export function decodeWpcSnowKml(kml,file,now=Date.now()){
 const meta=wpcSnowFileMetadata(file),issued=Date.parse(meta.issuedAt);
 if(typeof kml!=='string'||Buffer.byteLength(kml)>MAX_KML||!/\<kml\b/.test(kml)||/<!DOCTYPE|<!ENTITY/i.test(kml))throw new Error('Invalid WPC snow KML document.');
 if(issued>now+15*60000||now-issued>12*HOUR||Date.parse(meta.end)<=now)throw new Error('WPC snow amount forecast is stale or expired.');
 const styles=new Map();
 for(const match of kml.matchAll(/<Style\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/g)){
  const color=/<PolyStyle\b[^>]*>[\s\S]*?<color>([0-9a-f]{8})<\/color>/i.exec(match[2])?.[1];
  if(color)styles.set(match[1],{color:`#${color.slice(6,8)}${color.slice(4,6)}${color.slice(2,4)}`,opacity:parseInt(color.slice(0,2),16)/255});
 }
 const features=[];let vertices=0;
 for(const match of kml.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g)){
  const pm=match[1],description=xmlText(/<description>([\s\S]*?)<\/description>/.exec(pm)?.[1]);
  const field=name=>new RegExp(`^${name}\\s+([^\\n]+)$`,'m').exec(description)?.[1]?.trim();
  const value=Number(field('value')),start=stamp(field('ValidStart')),end=stamp(field('ValidEnd')),run=stamp(field('InitTime'));
  if(!finite(value)||value<.1||value>144||field('units')!=='Inches'||field('Parameter')!=='deterministic'||field('Wx Element')!=='Snow'||field('Duration')!=='24 HR'||start!==Date.parse(meta.start)||end!==Date.parse(meta.end)||run!==issued)throw new Error('WPC snow contour identity, units or valid period do not match.');
  const style=styles.get(/<styleUrl>#([^<]+)<\/styleUrl>/.exec(pm)?.[1])||{};
  for(const polygon of pm.matchAll(/<Polygon\b[^>]*>([\s\S]*?)<\/Polygon>/g)){
   const outer=/<outerBoundaryIs\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/.exec(polygon[1]);
   if(!outer)throw new Error('WPC snow contour has no exterior ring.');
   const holes=[...polygon[1].matchAll(/<innerBoundaryIs\b[^>]*>([\s\S]*?)<\/innerBoundaryIs>/g)].flatMap(m=>[...m[1].matchAll(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/g)].map(c=>ring(c[1])));
   const rings=[ring(outer[1]),...holes];
   vertices+=rings.reduce((n,r)=>n+r.length,0);if(vertices>350000||features.length>20000)throw new Error('WPC snow contour payload is oversized.');
   features.push({type:'Feature',bbox:bounds(rings),properties:{value,unit:'in',color:style.color||null,opacity:style.opacity??.5},geometry:{type:'Polygon',coordinates:rings}});
  }
 }
 if(!features.length&&!/<Document\b/.test(kml))throw new Error('WPC snow document has no valid forecast coverage.');
 const levels=[...new Set(features.map(f=>f.properties.value))].sort((a,b)=>a-b);
 const legend=levels.map(value=>({label:`${value}″ contour`,color:features.find(f=>f.properties.value===value)?.properties.color}));
 return {type:'FeatureCollection',features,metadata:{...meta,levels,legend,coverage:'Contiguous United States',precision:'Published deterministic snowfall contours in inches. Point values are conservative contour lower bounds; below the first contour is 0–0.1 inch, not a measured exact zero.',sourceUrl:wpcSnowArchiveUrl(file)}};
}
export function wpcSnowPointAmount(collection,location){
 const lat=location?.latitude,lon=location?.longitude;
 if(!finite(lat)||!finite(lon)||lat<24||lat>50||lon< -125||lon> -66)throw new Error('WPC expected snow product does not cover this location.');
 const matched=collection.features.filter(f=>containsPolygon(lon,lat,f)),lower=matched.length?Math.max(...matched.map(f=>f.properties.value)):0;
 const upper=collection.metadata.levels.find(v=>v>lower)??(lower===0?.1:null);
 return {...collection.metadata,value:lower,range:[lower,upper],precision:'contour-lower-bound',belowFirstContour:lower===0,source:'WPC expected deterministic snowfall',method:lower===0?'Below the published 0.1-inch snowfall contour (0–0.1 inch); the blend uses its conservative lower bound.':`Published WPC ${lower}-inch contour lower bound${finite(upper)?`; actual contour band is ${lower}–${upper} inches`:''}.`};
}
export function createWpcSnowAmountService({fetchImpl=globalThis.fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();
 async function resource(url,type='text',ttl=5*60000){
  const key=type+url,hit=cache.get(key);if(hit&&now()-hit.at<ttl)return hit.data;if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   const response=await fetchImpl(url,{headers:{Accept:type==='binary'?'application/vnd.google-earth.kmz,application/zip':'text/plain,text/html','User-Agent':'Sun-Nourie-Winter/3.0'},redirect:'error',signal:AbortSignal.timeout(18000)});
   if(!response.ok)throw new Error(`WPC expected snow returned HTTP ${response.status}.`);
   const advertised=Number(response.headers?.get('content-length')||0);if(advertised>(type==='binary'?MAX_ARCHIVE:3*1024*1024))throw new Error('WPC expected snow resource is oversized.');
   const data=type==='binary'?Buffer.from(await response.arrayBuffer()):await response.text();if((type==='binary'?data.length:Buffer.byteLength(data))>(type==='binary'?MAX_ARCHIVE:3*1024*1024))throw new Error('WPC expected snow resource is oversized.');
   cache.set(key,{data,at:now()});if(cache.size>12)cache.delete(cache.keys().next().value);return data;
  })().finally(()=>pending.delete(key));pending.set(key,task);return task;
 }
 const frames=new Map(),frameTasks=new Map();
 async function frame(file){
  const hit=frames.get(file);if(hit)return hit;if(frameTasks.has(file))return frameTasks.get(file);
  const task=(async()=>{const geo=decodeWpcSnowKml(kmlFromKmz(await resource(wpcSnowArchiveUrl(file),'binary',30*60000)),file,now());frames.set(file,geo);if(frames.size>6)frames.delete(frames.keys().next().value);return geo;})().finally(()=>frameTasks.delete(file));frameTasks.set(file,task);return task;
 }
 async function catalog(){
  const latest=await resource(WPC_SNOW_GIS_ROOT+'latest_cycle.txt'),cycle=/^(\d{10})\b/.exec(latest)?.[1];
  if(!cycle||now()-cycleTime(cycle)>12*HOUR||cycleTime(cycle)>now()+15*60000)throw new Error('Current WPC expected snowfall cycle unavailable.');
  const html=await resource(WPC_SNOW_GIS_ROOT+`ppp_gis_co_24hr_${cycle}/`);
  const files=[...new Set([...html.matchAll(/href="([^"?#]+\.kmz)"/g)].map(m=>m[1]).filter(file=>FILE.test(file)&&file.includes(`_${cycle}f`)))];
  const future=files.map(wpcSnowFileMetadata).filter(m=>Date.parse(m.start)>=Math.ceil(now()/HOUR)*HOUR&&Date.parse(m.end)>now()).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  if(!future.length)throw new Error('WPC has no complete future 24-hour expected snowfall window.');
  return future;
 }
 async function load(location){
  try{
   const available=await catalog(),selected=[];let through=-Infinity;
   for(const meta of available){if(Date.parse(meta.start)<through)continue;selected.push(meta);through=Date.parse(meta.end);if(selected.length===3)break;}
   const rows=await Promise.allSettled(selected.map(async meta=>wpcSnowPointAmount(await frame(meta.file),location)));
   const amounts=rows.filter(r=>r.status==='fulfilled').map(r=>r.value);
   const maps=available.map(meta=>({id:`wpc-expected-snow-${meta.file}`,label:`WPC expected snow totals · ${meta.start.slice(5,16).replace('T',' ')} UTC`,kind:'geojson',quantity:'snowfall',url:'/api/weather-fusion/winter-map?'+new URLSearchParams({file:meta.file}),sourceUrl:wpcSnowArchiveUrl(meta.file),file:meta.file,start:meta.start,end:meta.end,issuedAt:meta.issuedAt,unit:'in',description:'Official WPC deterministic expected snowfall depth contours. Snow totals are inches of snow, not liquid precipitation or threshold probabilities. Point values use the published contour lower bounds.'}));
   return {amounts,maps,status:amounts.length?'ready':'unavailable',message:amounts.length?null:'WPC expected snowfall windows could not be decoded for this point.'};
  }catch(error){return {amounts:[],maps:[],status:'unavailable',message:String(error.message).slice(0,180)};}
 }
 async function getMap(query={}){
  const file=String(query.file||''),meta=wpcSnowFileMetadata(file);
  if(now()-Date.parse(meta.issuedAt)>12*HOUR||Date.parse(meta.issuedAt)>now()+15*60000||Date.parse(meta.end)<=now())throw new Error('WPC snow map has expired.');
  return frame(file);
 }
 return {load,getMap};
}
