/* Isolated globe feeds: observed MRMS, timestamped satellite IR and GFS winds.
 * These layers never feed back into Weather Nourie's forecast calculations. */
const HOUR=3600000,MINUTE=60000;
export const GLOBE_GRID={nx:20,ny:10,lon0:-171,lat0:-81,dx:18,dy:18};
export const GLOBE_RADAR_URL='https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
export const GLOBE_RADAR_BOUNDS=[-130,20,-60,55];
const finite=Number.isFinite;
export function cloudStamp(value){
 const m=/^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})$/.exec(String(value));
 if(!m)return null;const time=Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);return finite(time)?time:null;
}
export function normalizeGlobeWind(data,now=Date.now()){
 const rows=Array.isArray(data)?data:[],g=GLOBE_GRID,times=[];
 const vectors=Array.from({length:g.nx*g.ny},(_,i)=>{
  const r=rows[i],h=r?.hourly,t=h?.time?.[0],time=typeof t==='number'?t*1000:Date.parse(String(t).endsWith('Z')?t:t+'Z');
  const speed=h?.wind_speed_10m?.[0],direction=h?.wind_direction_10m?.[0];
  if(!finite(time)||time!==Math.floor(now/HOUR)*HOUR||!finite(speed)||speed<0||!finite(direction)||direction<0||direction>360||r.hourly_units?.wind_speed_10m!=='m/s')return null;
  const expectedLat=g.lat0+Math.floor(i/g.nx)*g.dy,expectedLon=g.lon0+i%g.nx*g.dx;
  if(!finite(r.latitude)||!finite(r.longitude)||Math.abs(r.latitude-expectedLat)>1||Math.abs(r.longitude-expectedLon)>1)return null;
  times.push(time);const a=direction*Math.PI/180;return [-speed*Math.sin(a),-speed*Math.cos(a)].map(x=>Math.round(x*1000)/1000);
 });
 const validAt=times.length?new Date(Math.max(...times)).toISOString():null;
 return {...g,vectors,validAt,source:'NOAA GFS via Open-Meteo',units:'m/s',sampledResolutionDegrees:18,status:times.length?'ready':'unavailable'};
}
export function createGlobeService({fetchImpl=globalThis.fetch,now=Date.now,parseRadarTimes=()=>[]}={}){
 const cache=new Map(),pending=new Map(),failed=new Map();let providerRetryAt=0;
 async function memo(key,ttl,fn){
  const old=cache.get(key);if(old&&now()-old.at<ttl)return old.value;if(pending.has(key))return pending.get(key);const failure=failed.get(key);if(failure&&now()<failure.until)throw failure.error;
  const promise=Promise.resolve().then(fn).then(value=>{cache.set(key,{at:now(),value});failed.delete(key);return value;}).catch(error=>{if(failed.size>24)failed.clear();failed.set(key,{until:now()+Math.max(60000,error.retryMs||0),error});throw error;}).finally(()=>pending.delete(key));pending.set(key,promise);return promise;
 }
 async function request(url,kind='json'){
  if(String(url).startsWith('https://api.open-meteo.com/')&&now()<providerRetryAt)throw Object.assign(Error('Wind provider retry window'),{retryMs:providerRetryAt-now()});
  const r=await fetchImpl(url,{signal:AbortSignal.timeout(12000),headers:{Accept:kind==='image'?'image/png':kind==='text'?'application/xml':'application/json'},redirect:'error'});
  if(!r.ok){const error=Object.assign(Error('Globe source unavailable'),{code:'HTTP_'+r.status});if(r.status===429){const after=r.headers.get('retry-after'),seconds=Number(after);error.retryMs=after?(Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(after)-now())):5*MINUTE;}if(r.status===429&&String(url).startsWith('https://api.open-meteo.com/'))providerRetryAt=now()+Math.max(MINUTE,error.retryMs||0);throw error;}
  if(kind==='image'){
   if(!r.headers.get('content-type')?.includes('image/png'))throw Error('Invalid globe image type');
   const buffer=Buffer.from(await r.arrayBuffer());if(buffer.length>6*1024*1024||buffer.length<8||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid globe image');return buffer;
  }
  return kind==='text'?r.text():r.json();
 }
 async function winds(){return memo('wind:'+Math.floor(now()/HOUR),HOUR,async()=>{
  for(const key of cache.keys())if(key.startsWith('wind:'))cache.delete(key);
  const lat=[],lon=[],g=GLOBE_GRID;for(let y=0;y<g.ny;y++)for(let x=0;x<g.nx;x++){lat.push(g.lat0+y*g.dy);lon.push(g.lon0+x*g.dx);}
  const hour=new Date(Math.floor(now()/HOUR)*HOUR).toISOString().slice(0,16);
  const q=new URLSearchParams({latitude:lat.join(','),longitude:lon.join(','),hourly:'wind_speed_10m,wind_direction_10m',wind_speed_unit:'ms',models:'gfs_seamless',start_hour:hour,end_hour:hour,timezone:'GMT',timeformat:'unixtime'});
  const wind=normalizeGlobeWind(await request('https://api.open-meteo.com/v1/forecast?'+q),now());if(wind.status!=='ready')throw Object.assign(Error('No current wind field'),{code:'WIND_DATA_INVALID'});return wind;
 });}
 async function clouds(){return memo('cloud-info',10*MINUTE,async()=>{
  const data=await request('https://realearth.ssec.wisc.edu/api/times?products=globalir');
  const times=(data?.globalir||[]).map(cloudStamp).filter(t=>finite(t)&&t<=now()+5*MINUTE&&now()-t<3*HOUR).sort((a,b)=>a-b);
  if(!times.length)throw Error('No recent satellite image');
  return {status:'ready',validAt:new Date(times.at(-1)).toISOString(),source:'UW–Madison SSEC RealEarth · global infrared satellite composite',projection:'EPSG:3857',bounds:[-85.05112878,-180,85.05112878,180]};
 });}
 async function radar(){return memo('radar-info',2*MINUTE,async()=>{
  const frames=parseRadarTimes(await request(GLOBE_RADAR_URL+'?service=WMS&version=1.3.0&request=GetCapabilities','text'),now()).filter(t=>now()-Date.parse(t)<20*MINUTE).slice(-8);
  if(!frames.length)throw Error('No recent MRMS radar');
  return {status:'ready',frames,validAt:frames.at(-1),source:'NOAA MRMS observed reflectivity',bounds:GLOBE_RADAR_BOUNDS};
 });}
 async function metadata(){
  const values=await Promise.allSettled([winds(),clouds(),radar()]);
  return Object.fromEntries(values.map((r,i)=>[['wind','clouds','radar'][i],r.status==='fulfilled'?r.value:{status:'unavailable',source:['NOAA GFS via Open-Meteo','SSEC satellite infrared','NOAA MRMS radar'][i],reason:String(r.reason?.code||r.reason?.name||'SOURCE_UNAVAILABLE').slice(0,64)}]));
 }
 async function image(kind,time){
  const stamp=Date.parse(time);if(!finite(stamp))throw Object.assign(Error('Invalid image time'),{status:400});
  if(kind==='clouds'){
   const c=await clouds();if(c.validAt!==new Date(stamp).toISOString())throw Object.assign(Error('Satellite time unavailable; refresh the globe'),{status:404});
   return memo('cloud-image:'+c.validAt,10*MINUTE,async()=>{
    // One current satellite texture is retained. Never substitute a stock cloud map.
    for(const k of cache.keys())if(k.startsWith('cloud-image:'))cache.delete(k);
    const q=new URLSearchParams({products:'globalir',time:c.validAt.slice(0,19).replace('T',' '),bounds:c.bounds.join(','),width:'1024',height:'1024'});
    return request('https://realearth.ssec.wisc.edu/api/image?'+q,'image');
   });
  }
  if(kind!=='radar')throw Object.assign(Error('Unknown globe layer'),{status:404});
  const r=await radar();if(!r.frames.includes(new Date(stamp).toISOString()))throw Object.assign(Error('Radar frame unavailable'),{status:404});
  return memo('radar-image:'+time,5*MINUTE,async()=>{
   for(const k of cache.keys())if(k.startsWith('radar-image:')&&!r.frames.some(t=>k==='radar-image:'+t))cache.delete(k);
   const q=new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:'conus_bref_qcd',styles:'radar_reflectivity',srs:'EPSG:4326',bbox:GLOBE_RADAR_BOUNDS.join(','),width:'1024',height:'512',format:'image/png',transparent:'true',time:new Date(stamp).toISOString()});
   return request(GLOBE_RADAR_URL+'?'+q,'image');
  });
 }
 return {metadata,image};
}
export function registerGlobeRoutes(app,options={}){
 const service=createGlobeService(options);
 app.get('/api/weather-fusion/globe',async(_req,res)=>{try{res.setHeader('Cache-Control','public, max-age=120');res.json(await service.metadata());}catch{res.status(503).json({error:'Globe feeds unavailable'});}});
 app.get('/api/weather-fusion/globe-image',async(req,res)=>{try{const image=await service.image(req.query.layer,req.query.time);res.setHeader('Cache-Control','public, max-age=300');res.setHeader('X-Content-Type-Options','nosniff');res.type('image/png').send(image);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Weather image unavailable'});}});
 return service;
}
