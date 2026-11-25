import {advanceWind,sampleWindField,screenWindDensity} from './globe-math.js?v=tiled-v4';
const WIND_COLORS=['rgba(204,240,255,.92)','rgba(130,222,255,.94)','rgba(140,240,170,.95)','rgba(255,232,120,.96)','rgba(255,160,80,.97)','rgba(255,100,130,.98)'];
const STREET_WIND_COLORS=['rgba(10,106,149,.7)','rgba(6,95,142,.8)','rgba(10,120,90,.85)','rgba(150,110,0,.9)','rgba(190,80,10,.92)','rgba(190,20,60,.95)'];
let library;
function loadLibrary(){
 if(globalThis.maplibregl)return Promise.resolve(globalThis.maplibregl);
 if(!library)library=new Promise((resolve,reject)=>{
  if(!document.getElementById('nourie-maplibre-css')){const css=document.createElement('link');css.id='nourie-maplibre-css';css.rel='stylesheet';css.href='/weather-fusion/v3/vendor/maplibre-gl.css?v=5.6.2';document.head.append(css);}
  const script=document.createElement('script');script.src='/weather-fusion/v3/vendor/maplibre-gl.js?v=5.6.2';script.onload=()=>resolve(globalThis.maplibregl);script.onerror=()=>reject(Error('Map library unavailable'));document.head.append(script);
 });return library;
}
const BASE_STYLE={version:8,projection:{type:'globe'},sources:{
 'earth':{type:'raster',tiles:['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri'},
 'streets':{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'},
 'places':{type:'raster',tiles:['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:13,attribution:'Labels © Esri'}
},layers:[{id:'earth',type:'raster',source:'earth',paint:{'raster-fade-duration':0}},{id:'streets',type:'raster',source:'streets',layout:{visibility:'none'},paint:{'raster-fade-duration':0}},{id:'places',type:'raster',source:'places',paint:{'raster-opacity':.85,'raster-fade-duration':0}}]};
export class WeatherGlobeRenderer{
 static async create(mount){await loadLibrary();return new WeatherGlobeRenderer(mount);}
 constructor(mount){
  this.mount=mount;this.layers={radar:true,clouds:true,wind:true};this.active=false;this.motion=true;this.expanded=false;this.street=false;this.particles=[];this.weather={};this.layerTokens={};this.token=0;
  this.shell=document.createElement('div');this.shell.className='globe-map-shell';this.mapMount=document.createElement('div');this.mapMount.className='globe-map';this.windCanvas=document.createElement('canvas');this.windCanvas.className='globe-wind-canvas';this.windCanvas.setAttribute('aria-hidden','true');this.shell.append(this.mapMount,this.windCanvas);mount.append(this.shell);
  const M=globalThis.maplibregl;
  this.map=new M.Map({container:this.mapMount,style:BASE_STYLE,center:[-80,30],zoom:1.1,minZoom:0,maxZoom:16,pixelRatio:Math.min(devicePixelRatio||1,1.5),renderWorldCopies:false,maxTileCacheSize:72,fadeDuration:0,attributionControl:{compact:true},canvasContextAttributes:{antialias:true,powerPreference:'low-power'},dragRotate:false,pitchWithRotate:false,touchPitch:false});
  this.canvas=this.map.getCanvas();this.canvas.classList.add('weather-globe-canvas');this.canvas.setAttribute('aria-label','Interactive geographic weather globe');
  this.ready=new Promise(resolve=>this.map.on('style.load',()=>{this.map.setProjection({type:'globe'});this.map.setSky({'sky-color':'#0b1928','horizon-color':'#264555','atmosphere-blend':.6});resolve();}));
  const point=document.createElement('span');point.className='globe-location-dot';point.setAttribute('role','img');point.setAttribute('aria-label','Selected weather location');this.marker=new M.Marker({element:point,anchor:'center',pitchAlignment:'viewport',rotationAlignment:'viewport'}).setLngLat([-80,30]).addTo(this.map);this.markerElement=point;
  this.ctx=this.windCanvas.getContext('2d');this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(mount);
  this.map.on('movestart',()=>{this.moving=true;this.clearTrails();});
  this.map.on('moveend',()=>{this.moving=false;this.buildFlow();this.seed();if(!this.motion)this.drawArrows();this.onViewportChange?.(this.getView());});
  this.map.on('render',()=>{if(!this.motion&&this.grid)this.drawArrows();});
  this.map.on('error',e=>{if(e.sourceId==='earth'&&++this.baseErrors>=3)this.setBasemap(true);});this.baseErrors=0;
  this.setInteractive(false);this.resize();
 }
 setInteractive(enabled){for(const handler of ['dragPan','scrollZoom','boxZoom','doubleClickZoom','touchZoomRotate','keyboard']){this.map[handler]?.[enabled?'enable':'disable']();}this.map.touchZoomRotate.disableRotation();}
 getView(){const p=this.map.getCenter();return {latitude:p.lat,longitude:((p.lng+540)%360)-180,zoom:this.map.getZoom()};}
 move(mount,expanded){
  if(this.expanded&&!expanded)this.expandedView={center:this.map.getCenter(),zoom:this.map.getZoom()};this.mount=mount;this.expanded=expanded;mount.append(this.shell);this.ro.disconnect();this.ro.observe(mount);this.setInteractive(expanded);
  if(expanded){if(this.expandedView)this.map.jumpTo(this.expandedView);else this.map.jumpTo({center:[this.location.longitude,this.location.latitude],zoom:1.7});}
  else if(this.location)this.map.jumpTo({center:[this.location.longitude,this.location.latitude],zoom:1.1});this.resize();
 }
 center(location,force=false){
  const changed=!this.location||this.location.latitude!==location.latitude||this.location.longitude!==location.longitude;this.location=location;
  this.canvas.dataset.latitude=location.latitude;this.canvas.dataset.longitude=location.longitude;this.marker.setLngLat([location.longitude,location.latitude]);this.markerElement.setAttribute('aria-label',`${location.name||'Selected location'} ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`);
  if(changed||force)this.map.jumpTo({center:[location.longitude,location.latitude],zoom:this.expanded?this.map.getZoom():1.1});
 }
 zoom(factor){const view={zoom:Math.max(0,Math.min(16,this.map.getZoom()-Math.log2(factor)*2))};if(matchMedia('(prefers-reduced-motion: reduce)').matches)this.map.jumpTo(view);else this.map.easeTo({...view,duration:250,essential:false});}
 setBasemap(streets){this.street=streets;void this.ready.then(()=>{this.map.setLayoutProperty('streets','visibility',streets?'visible':'none');this.map.setLayoutProperty('earth','visibility',streets?'none':'visible');this.map.setLayoutProperty('places','visibility',streets?'none':'visible');this.clearTrails();this.drawArrows();});}
 resize(){if(!this.shell.isConnected)return;this.map.resize();const r=this.mount.getBoundingClientRect();this.width=r.width;this.height=r.height;const dpr=Math.min(devicePixelRatio||1,1.5);this.windCanvas.width=Math.round(r.width*dpr);this.windCanvas.height=Math.round(r.height*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);this.buildFlow();this.seed();this.clearTrails();if(!this.motion)this.drawArrows();}
 setActive(value){this.active=value;if(!value){cancelAnimationFrame(this.frame);this.frame=null;this.map.stop();}else if(this.motion&&this.frame==null)this.loop(performance.now());else this.drawArrows();}
 setMotion(value){this.motion=value;if(!value){cancelAnimationFrame(this.frame);this.frame=null;this.clearTrails();this.drawArrows();}else if(this.active&&this.frame==null)this.loop(performance.now());}
 setLayer(kind,value){this.layers[kind]=value;if(kind==='wind'){this.clearTrails();if(value&&!this.motion)this.drawArrows();}const id=this.weather[kind]?.id;if(id&&this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility',value?'visible':'none');}
 clearLayer(kind){
  this.layerTokens[kind]=(this.layerTokens[kind]||0)+1;
  const record=this.weather[kind];
  delete this.weather[kind];
  this[kind+'Mesh']=null;
  if(kind==='radar'){
   for(const time of this.radarBuffer?.keys()||[])this.discardRadar(time);
  }else if(record)this.removeWeatherTiles(record.id);
 }
 async prepareRadar(time){
  if(this.weather.radar?.time===time)return this.weather.radar;
  this.radarBuffer??=new Map();
  const existing=this.radarBuffer.get(time);
  if(existing)return existing;
  const entry={time,id:`nourie-radar-${++this.token}`,ready:false};
  this.radarBuffer.set(time,entry);
  entry.promise=this.loadWeatherTiles('radar',entry).then(()=>{
   entry.ready=true;
   return entry;
  }).catch(error=>{
   if(this.radarBuffer.get(time)===entry)this.radarBuffer.delete(time);
   throw error;
  });
  return entry;
 }
 discardRadar(time){
  const entry=this.radarBuffer?.get(time);
  if(!entry||this.weather.radar===entry)return;
  if(this.radarBuffer.get(time)===entry)this.radarBuffer.delete(time);
  if(entry.ready)this.removeWeatherTiles(entry.id);
  else void entry.promise.then(()=>this.removeWeatherTiles(entry.id)).catch(()=>{});
 }
 removeWeatherTiles(id){
  if (this.map.getLayer(id)) this.map.removeLayer(id);
  if (this.map.getSource(id)) this.map.removeSource(id);
 }
 async setWeatherTiles(kind,time){
  if(this.weather[kind]?.time===time)return true;
  const generation=(this.layerTokens[kind]||0)+1;
  this.layerTokens[kind]=generation;
  const entry=kind==='radar'
   ? await this.prepareRadar(time)
   : {time,id:`nourie-clouds-${++this.token}`};
  if(kind==='radar')await entry.promise;
  else await this.loadWeatherTiles(kind,entry);
  if(generation!==this.layerTokens[kind]){
   if(kind!=='radar')this.removeWeatherTiles(entry.id);
   return false;
  }

  const previous=this.weather[kind];
  if(previous?.id!==entry.id&&previous){
   if(kind==='radar'){
    this.map.setPaintProperty(previous.id,'raster-opacity',0);
    this.map.setLayoutProperty(previous.id,'visibility','visible');
   }else this.removeWeatherTiles(previous.id);
  }
  this.weather[kind]=entry;
  this[kind+'Mesh']=true;
  this.map.setPaintProperty(entry.id,'raster-opacity',kind==='radar'?['interpolate',['linear'],['zoom'],0,.82,10,.75,15,.45]:['interpolate',['linear'],['zoom'],0,.85,6,.7,10,.22,14,.06]);
  this.map.setLayoutProperty(entry.id,'visibility',this.layers[kind]?'visible':'none');
  return true;
 }
 async loadWeatherTiles(kind,{id,time}){
  await this.ready;
  const q=new URLSearchParams({layer:kind,time}),tiles=`${location.origin}/api/weather-fusion/globe-tile?${q}&z={z}&x={x}&y={y}`;
  this.map.addSource(id,{type:'raster',tiles:[tiles],tileSize:256,minzoom:0,maxzoom:kind==='clouds'?5:10,...(kind==='radar'?{bounds:[-130,20,-60,55]}:{})});
  this.map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':0,...(kind==='radar'?{'raster-opacity-transition':{duration:0}}:{}),'raster-fade-duration':0,'raster-resampling':kind==='radar'?'nearest':'linear'}},'places');
  try{
   await new Promise((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);this.map.off('sourcedata',loaded);this.map.off('error',failed);};
    const loaded=e=>{if(e.sourceId===id&&this.map.isSourceLoaded(id)){clean();resolve();}};
    const failed=e=>{if(e.sourceId===id){clean();reject(Error('Weather tiles unavailable'));}};
    const timer=setTimeout(()=>{clean();reject(Error('Weather tiles still loading'));},12000);
    this.map.on('sourcedata',loaded);this.map.on('error',failed);
    if(this.map.isSourceLoaded(id)){clean();resolve();}
   });
  }catch(error){
   this.removeWeatherTiles(id);
   throw error;
  }
 }
 setWind(grid){this.grid=grid;this.buildFlow();this.seed();this.clearTrails();this.canvas.dataset.windParticles=this.particles.length;if(!this.motion)this.drawArrows();}
 surface(x,y){
  const ll=this.map.unproject([x,y]);if(!Number.isFinite(ll.lat)||!Number.isFinite(ll.lng)||Math.abs(ll.lat)>85)return null;
  if(this.map.transform.isLocationOccluded(ll))return null;const p=this.map.project(ll);if(Math.hypot(p.x-x,p.y-y)>3)return null;
  return {latitude:ll.lat,longitude:ll.lng};
 }
 geographicVelocity(x,y){const ll=this.surface(x,y);if(!ll)return null;const wind=sampleWindField(this.grid,ll.latitude,ll.longitude);if(!wind||wind.speed<.15)return null;const next=advanceWind(ll,wind,1),p=this.map.project([next.longitude,next.latitude]),dx=p.x-x,dy=p.y-y,n=Math.hypot(dx,dy);if(n<1e-8||n>this.width*.3)return null;const speed=Math.min(70,9+wind.speed*2.2);return {x:dx/n*speed,y:dy/n*speed,speed:wind.speed};}
 buildFlow(){this.flow=null;if(!this.grid||!this.width||!this.height)return;const step=22,nx=Math.ceil(this.width/step)+1,ny=Math.ceil(this.height/step)+1,values=[];for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)values.push(this.geographicVelocity(x*step,y*step));this.flow={step,nx,ny,values};}
 velocity(x,y){const f=this.flow;if(!f||x<0||y<0||x>this.width||y>this.height)return null;const gx=x/f.step,gy=y/f.step,ix=Math.floor(gx),iy=Math.floor(gy),u=gx-ix,v=gy-iy;let out={x:0,y:0,speed:0};for(const [dx,dy,w]of [[0,0,(1-u)*(1-v)],[1,0,u*(1-v)],[0,1,(1-u)*v],[1,1,u*v]]){if(w<1e-8)continue;const p=f.values[(iy+dy)*f.nx+ix+dx];if(!p)return null;out.x+=p.x*w;out.y+=p.y*w;out.speed+=p.speed*w;}return out;}
 seed(){
  this.particles=[];if(!this.grid||!this.width||!this.height)return;
  let mean=0,n=0;for(let y=20;y<this.height;y+=70)for(let x=20;x<this.width;x+=70){const v=this.velocity(x,y);if(v){mean+=v.speed;n++;}}
  const count=screenWindDensity(this.width*this.height,n?mean/n:0);let tries=0;while(this.particles.length<count&&tries++<count*10){const x=Math.random()*this.width,y=Math.random()*this.height,v=this.velocity(x,y);if(!v||Math.random()>Math.min(1,.25+v.speed/18))continue;this.particles.push({x,y,age:Math.random()*7});}this.canvas.dataset.windParticles=this.particles.length;
 }
 clearTrails(){this.ctx.clearRect(0,0,this.width||0,this.height||0);}
 windClass(speed){const ms=(speed-9)/2.2;return ms<3?0:ms<6?1:ms<10?2:ms<15?3:ms<22?4:5;}
 classColor(i){return this.street?STREET_WIND_COLORS[i]:WIND_COLORS[i];}
 color(speed){return this.classColor(this.windClass(speed));}
 drawArrows(){if(this.motion||this.moving||!this.layers.wind||!this.grid)return;this.clearTrails();for(let y=18;y<this.height;y+=36)for(let x=18;x<this.width;x+=36){const v=this.velocity(x,y);if(!v)continue;const n=Math.hypot(v.x,v.y);if(n<1e-8)continue;const dx=v.x/n*7,dy=v.y/n*7;this.ctx.strokeStyle=this.color(v.speed);this.ctx.lineWidth=1;this.ctx.beginPath();this.ctx.moveTo(x-dx,y-dy);this.ctx.lineTo(x+dx,y+dy);this.ctx.moveTo(x+dx-dx*.6-dy*.45,y+dy-dy*.6+dx*.45);this.ctx.lineTo(x+dx,y+dy);this.ctx.lineTo(x+dx-dx*.6+dy*.45,y+dy-dy*.6-dx*.45);this.ctx.stroke();}}
 loop(now){
  this.frame=null;if(!this.active||!this.motion)return;
  if(now-(this.last||0)>35){
   const dt=Math.min(.08,(now-(this.last||now))/1000);this.last=now;
   if(this.layers.wind&&this.grid&&!this.moving){
    const ctx=this.ctx;
    ctx.globalCompositeOperation='destination-in';ctx.fillStyle='rgba(0,0,0,.95)';ctx.fillRect(0,0,this.width,this.height);ctx.globalCompositeOperation='source-over';
    const buckets=[[],[],[],[],[],[]];
    for(const p of this.particles){
     const v=this.velocity(p.x,p.y);
     if(!v||p.age>8||p.x<0||p.y<0||p.x>this.width||p.y>this.height){p.x=Math.random()*this.width;p.y=Math.random()*this.height;p.age=0;continue;}
     const x=p.x+v.x*dt,y=p.y+v.y*dt;
     buckets[this.windClass(v.speed)].push(p.x,p.y,x,y);
     p.x=x;p.y=y;p.age+=dt;
    }
    ctx.lineCap='round';ctx.shadowColor='rgba(3,16,34,.6)';ctx.shadowBlur=2;
    buckets.forEach((seg,i)=>{
     if(!seg.length)return;
     ctx.strokeStyle=this.classColor(i);ctx.lineWidth=1.35+i*.22;ctx.beginPath();
     for(let k=0;k<seg.length;k+=4){ctx.moveTo(seg[k],seg[k+1]);ctx.lineTo(seg[k+2],seg[k+3]);}
     ctx.stroke();
    });
    ctx.shadowBlur=0;ctx.shadowColor='transparent';
   }
  }
  this.frame=requestAnimationFrame(t=>this.loop(t));
 }
}
