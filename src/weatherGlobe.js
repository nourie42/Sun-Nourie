import {PNG} from 'pngjs';
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
export function normalizeGfsGrid(payload,validAt){
 const table=payload?.table,names=table?.columnNames||[],units=table?.columnUnits||[],ix=key=>names.indexOf(key),ti=ix('time'),la=ix('latitude'),lo=ix('longitude'),ui=ix('ugrd10m'),vi=ix('vgrd10m');
 if([ti,la,lo,ui,vi].some(i=>i<0)||!['m s-1','m/s'].includes(units[ui])||!['m s-1','m/s'].includes(units[vi]))throw Error('GFS vector fields unavailable');
 const rows=(table.rows||[]).filter(r=>Date.parse(r[ti])===Date.parse(validAt)&&finite(r[la])&&finite(r[lo]));
 const lats=[...new Set(rows.map(r=>r[la]))].sort((a,b)=>a-b),lons=[...new Set(rows.map(r=>r[lo]))].sort((a,b)=>a-b);
 if(lats.length<2||lons.length<2)throw Error('GFS grid unavailable');
 const dx=lons[1]-lons[0],dy=lats[1]-lats[0],nx=lons.length,ny=lats.length;
 if(lats.some((v,i)=>Math.abs(v-lats[0]-i*dy)>1e-6)||lons.some((v,i)=>Math.abs(v-lons[0]-i*dx)>1e-6))throw Error('Irregular GFS grid');
 const vectors=Array(nx*ny).fill(null);for(const r of rows){if(!finite(r[ui])||!finite(r[vi])||Math.hypot(r[ui],r[vi])>150)continue;const x=Math.round((r[lo]-lons[0])/dx),y=Math.round((r[la]-lats[0])/dy);vectors[y*nx+x]=[r[ui],r[vi]];}
 if(!vectors.some(Boolean))throw Error('GFS vectors unavailable');
 return {nx,ny,lon0:lons[0],lat0:lats[0],dx,dy,wrapLongitude:Math.abs(nx*dx-360)<1e-6,vectors,validAt,source:'NOAA GFS · PacIOOS ERDDAP',units:'m/s',sampledResolutionDegrees:dx,maxAgeMinutes:240,status:'ready'};
}
export function globeTileBounds(z,x,y){
 if(![z,x,y].every(Number.isInteger)||z<0||z>10||x<0||y<0||x>=2**z||y>=2**z)throw Object.assign(Error('Invalid weather tile'),{status:400});
 const extent=20037508.342789244,n=2**z;return [x/n*2*extent-extent,extent-(y+1)/n*2*extent,(x+1)/n*2*extent-extent,extent-y/n*2*extent];
}
export function satelliteCloudTile(buffer){
 const png=PNG.sync.read(buffer);for(let i=0;i<png.data.length;i+=4){const brightness=png.data[i],sourceAlpha=png.data[i+3];png.data[i]=242;png.data[i+1]=247;png.data[i+2]=250;png.data[i+3]=Math.round(sourceAlpha*Math.max(0,Math.min(1,(brightness-85)/125))*.85);}return PNG.sync.write(png,{deflateLevel:3});
}
export function createGlobeService({fetchImpl=globalThis.fetch,now=Date.now,parseRadarTimes=()=>[]}={}){
 const cache=new Map(),pending=new Map(),failed=new Map(),radarSeen=new Map(),cloudSeen=new Set(),lastWind=new Map();let providerRetryAt=0;
 async function memo(key,ttl,fn){
  const old=cache.get(key);if(old&&now()-old.at<ttl)return old.value;if(pending.has(key))return pending.get(key);const failure=failed.get(key);if(failure&&now()<failure.until)throw failure.error;
  const promise=Promise.resolve().then(fn).then(value=>{cache.set(key,{at:now(),value});if(Buffer.isBuffer(value)){let bytes=0;const images=[...cache].filter(([,v])=>Buffer.isBuffer(v.value));for(const [,v]of images)bytes+=v.value.length;while(images.length>160||bytes>8*1024*1024){const [old,e]=images.shift();if(old===key)break;cache.delete(old);bytes-=e.value.length;}}failed.delete(key);return value;}).catch(error=>{if(failed.size>24)failed.clear();failed.set(key,{until:now()+Math.max(60000,error.retryMs||0),error});throw error;}).finally(()=>pending.delete(key));pending.set(key,promise);return promise;
 }
 async function request(url,kind='json'){
  if(String(url).startsWith('https://api.open-meteo.com/')&&now()<providerRetryAt)throw Object.assign(Error('Wind provider retry window'),{retryMs:providerRetryAt-now()});
  const r=await fetchImpl(url,{signal:AbortSignal.timeout(/pacioos\.hawaii|api\.open-meteo/.test(String(url))?6500:12000),headers:{'User-Agent':'WeatherNourie/1.0 (https://github.com/nourie42/Sun-Nourie)',Accept:kind==='image'?'image/png':kind==='text'?'application/xml':'application/json'},redirect:'error'});
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
  const requestedAt=now(),hour=new Date(Math.floor(requestedAt/HOUR)*HOUR).toISOString().slice(0,16);
  const q=new URLSearchParams({latitude:lat.join(','),longitude:lon.join(','),hourly:'wind_speed_10m,wind_direction_10m',wind_speed_unit:'ms',models:'gfs_seamless',start_hour:hour,end_hour:hour,timezone:'GMT',timeformat:'unixtime'});
  const wind=normalizeGlobeWind(await request('https://api.open-meteo.com/v1/forecast?'+q),requestedAt);if(wind.status!=='ready')throw Object.assign(Error('No current wind field'),{code:'WIND_DATA_INVALID'});lastWind.set('open-meteo',wind);return wind;
 });}
 async function gfs(region=null){
  const validAt=new Date(Math.floor(now()/(3*HOUR))*3*HOUR).toISOString(),lat=Number(region?.latitude),lon=Number(region?.longitude),local=finite(lat)&&finite(lon)&&Math.abs(lat)<=85&&Math.abs(lon)<=180;
  const south=local?Math.max(-90,Math.min(80,Math.floor(lat/10)*10)):-90,north=local?south+10:90,west=local?Math.floor(((lon%360+360)%360)/10)*10:0,east=local?Math.min(359.5,west+10):359.5,stride=local?1:10;
  const place=local?`${south}:${west}`:'global',key=`gfs:${validAt}:${place}`;
  try{return await memo(key,30*MINUTE,async()=>{
   const slice=`[(${validAt.replace('.000Z','Z')})][(${north}):${stride}:(${south})][(${west}):${stride}:(${east})]`;
   const q=`ugrd10m${slice},vgrd10m${slice}`;
   // NOAA's CoastWatch endpoint redirects this dataset to its PacIOOS host.
   const grid=normalizeGfsGrid(await request('https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.json?'+encodeURI(q)),validAt);
   lastWind.set(place,grid);while(lastWind.size>9)lastWind.delete([...lastWind.keys()].find(k=>k!=='global')||lastWind.keys().next().value);
   const keys=[...cache.keys()].filter(k=>k.startsWith('gfs:'));while(keys.length>=12)cache.delete(keys.shift());return grid;
  });}catch(error){const known=lastWind.get(place);if(known&&now()-Date.parse(known.validAt)<4*HOUR)return {...known,status:'stale',updateDelayed:true};if(local)throw error;try{return await winds();}catch(fallback){const old=lastWind.get('open-meteo');if(old&&now()-Date.parse(old.validAt)<4*HOUR)return {...old,status:'stale',maxAgeMinutes:240,updateDelayed:true};throw fallback;}}
 }
 async function clouds(){return memo('cloud-info',10*MINUTE,async()=>{
  const data=await request('https://realearth.ssec.wisc.edu/api/times?products=globalir');
  const times=(data?.globalir||[]).map(cloudStamp).filter(t=>finite(t)&&t<=now()+5*MINUTE&&now()-t<3*HOUR).sort((a,b)=>a-b);
  if(!times.length)throw Error('No recent satellite image');
  const validAt=new Date(times.at(-1)).toISOString();cloudSeen.add(validAt);while(cloudSeen.size>4)cloudSeen.delete(cloudSeen.values().next().value);return {status:'ready',validAt,source:'UW–Madison SSEC RealEarth · global infrared satellite composite',projection:'EPSG:3857',bounds:[-85.05112878,-180,85.05112878,180]};
 });}
 async function radar(){return memo('radar-info',2*MINUTE,async()=>{
  const frames=parseRadarTimes(await request(GLOBE_RADAR_URL+'?service=WMS&version=1.3.0&request=GetCapabilities','text'),now()).filter(t=>now()-Date.parse(t)<=2*HOUR).slice(-13);
  if(!frames.length||now()-Date.parse(frames.at(-1))>20*MINUTE)throw Error('No recent MRMS radar');for(const t of frames)radarSeen.set(t,Date.parse(t));for(const [t,stamp]of radarSeen)if(now()-stamp>3*HOUR)radarSeen.delete(t);
  return {status:'ready',frames,validAt:frames.at(-1),source:'NOAA MRMS observed reflectivity',bounds:GLOBE_RADAR_BOUNDS};
 });}
 async function metadata(query={}){
  const wind=async()=>{const local=finite(Number(query.latitude))&&finite(Number(query.longitude))&&Math.abs(Number(query.latitude))<=85&&Math.abs(Number(query.longitude))<=180;const [world,regional]=await Promise.allSettled([gfs(),local?gfs(query):Promise.resolve(null)]);if(world.status==='rejected'){if(regional.status==='fulfilled'&&regional.value)return regional.value;throw world.reason;}const grid={...world.value};if(regional.status==='fulfilled'&&regional.value?.validAt===grid.validAt)grid.regional=regional.value;return grid;};
  const values=await Promise.allSettled([wind(),clouds(),radar()]);
  return Object.fromEntries(values.map((r,i)=>[['wind','clouds','radar'][i],r.status==='fulfilled'?r.value:{status:'unavailable',source:['NOAA GFS via Open-Meteo','SSEC satellite infrared','NOAA MRMS radar'][i],reason:String(r.reason?.code||r.reason?.name||'SOURCE_UNAVAILABLE').slice(0,64)}]));
 }
 async function image(kind,time){
  const stamp=Date.parse(time);if(!finite(stamp))throw Object.assign(Error('Invalid image time'),{status:400});
  if(kind==='clouds'){
   const c=await clouds();if(!cloudSeen.has(new Date(stamp).toISOString()))throw Object.assign(Error('Satellite time unavailable; refresh the globe'),{status:404});
   const validTime=new Date(stamp).toISOString();return memo('cloud-image:'+validTime,10*MINUTE,async()=>{
    // One current satellite texture is retained. Never substitute a stock cloud map.
    for(const k of cache.keys())if(k.startsWith('cloud-image:'))cache.delete(k);
    const q=new URLSearchParams({products:'globalir',time:validTime.slice(0,19).replace('T',' '),bounds:c.bounds.join(','),width:'1024',height:'1024'});
    return request('https://realearth.ssec.wisc.edu/api/image?'+q,'image');
   });
  }
  if(kind!=='radar')throw Object.assign(Error('Unknown globe layer'),{status:404});
  const r=await radar();if(!radarSeen.has(new Date(stamp).toISOString())||now()-stamp>3*HOUR)throw Object.assign(Error('Radar frame unavailable'),{status:404});
  return memo('radar-image:'+time,5*MINUTE,async()=>{
   for(const k of cache.keys())if(k.startsWith('radar-image:')&&!r.frames.some(t=>k==='radar-image:'+t))cache.delete(k);
   const q=new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:'conus_bref_qcd',styles:'radar_reflectivity',srs:'EPSG:4326',bbox:GLOBE_RADAR_BOUNDS.join(','),width:'1024',height:'512',format:'image/png',transparent:'true',time:new Date(stamp).toISOString()});
   return request(GLOBE_RADAR_URL+'?'+q,'image');
  });
 }
 async function tile(kind,time,z,x,y){
  const bounds=globeTileBounds(z,x,y),stamp=Date.parse(time);if(!finite(stamp))throw Object.assign(Error('Invalid weather time'),{status:400});
  if(kind==='radar'){await radar();if(!radarSeen.has(new Date(stamp).toISOString())||now()-stamp>3*HOUR)throw Object.assign(Error('Radar time unavailable'),{status:404});}
  else if(kind==='clouds'){await clouds();if(!cloudSeen.has(new Date(stamp).toISOString()))throw Object.assign(Error('Satellite time unavailable'),{status:404});}
  else throw Object.assign(Error('Unknown weather layer'),{status:404});
  return memo(`tile:${kind}:${time}:${z}:${x}:${y}`,5*MINUTE,async()=>{
   if(kind==='clouds'){
    const q=new URLSearchParams({products:'globalir',time:new Date(stamp).toISOString().slice(0,19).replace('T',' '),x:String(x),y:String(y),z:String(z)});
    return satelliteCloudTile(await request('https://realearth.ssec.wisc.edu/api/image?'+q,'image'));
   }
   const q=new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:'conus_bref_qcd',styles:'radar_reflectivity',srs:'EPSG:3857',bbox:bounds.join(','),width:'256',height:'256',format:'image/png',transparent:'true',time:new Date(stamp).toISOString()});return request(GLOBE_RADAR_URL+'?'+q,'image');
  });
 }
 return {metadata,image,tile};
}
export function registerGlobeRoutes(app,options={}){
 const service=createGlobeService(options);
 app.get('/api/weather-fusion/globe',async(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json(await service.metadata(req.query));}catch{res.status(503).json({error:'Globe feeds unavailable'});}});
 app.get('/api/weather-fusion/globe-image',async(req,res)=>{try{const image=await service.image(req.query.layer,req.query.time);res.setHeader('Cache-Control','public, max-age=300');res.setHeader('X-Content-Type-Options','nosniff');res.type('image/png').send(image);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Weather image unavailable'});}});
 app.get('/api/weather-fusion/globe-tile',async(req,res)=>{try{const data=await service.tile(req.query.layer,req.query.time,Number(req.query.z),Number(req.query.x),Number(req.query.y));res.setHeader('Cache-Control','public, max-age=300');res.setHeader('X-Content-Type-Options','nosniff');res.type('image/png').send(data);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Weather tile unavailable'});}});
 return service;
}
