/* Lazy, single-renderer globe. Forecast state stays owned by the Beta controller. */
export class GlobePanel{
 constructor(){
  this.panel=document.getElementById('weather-globe-panel');this.preview=document.getElementById('globe-preview-mount');this.dialog=document.getElementById('weather-globe-dialog');this.expandedMount=document.getElementById('globe-expanded-mount');this.status=document.getElementById('globe-layer-status');this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.motion=!this.reduced.matches&&!navigator.connection?.saveData;this.visible=false;this.layers={radar:true,clouds:true,wind:true};
  this.observer=new IntersectionObserver(entries=>{this.visible=entries.some(e=>e.isIntersecting);if(this.visible&&this.forecast?.canonical&&!navigator.connection?.saveData)void this.ensure();this.activity();},{rootMargin:'50px'});this.observer.observe(this.panel);
  document.getElementById('open-weather-globe').addEventListener('click',()=>this.open());document.getElementById('close-weather-globe').addEventListener('click',()=>this.dialog.close());
  this.dialog.addEventListener('close',()=>{clearInterval(this.radarTimer);this.radarTimer=null;this.updatePlayButton(false);this.renderer?.move(this.preview,false);this.activity();if(history.state?.weatherGlobe)history.back();});
  addEventListener('popstate',()=>{if(this.dialog.open)this.dialog.close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInterval(this.radarTimer);this.radarTimer=null;this.updatePlayButton(false);}this.activity();});
  this.reduced.addEventListener('change',()=>{if(this.reduced.matches){this.motion=false;this.applyMotion();}});
  for(const button of this.dialog.querySelectorAll('[data-globe-layer]'))button.addEventListener('click',()=>{const k=button.dataset.globeLayer;this.layers[k]=!this.layers[k];button.classList.toggle('active',this.layers[k]);button.setAttribute('aria-pressed',String(this.layers[k]));this.renderer?.setLayer(k,this.layers[k]);});
  document.getElementById('globe-recenter').addEventListener('click',()=>this.renderer?.center(this.forecast.location));
  document.getElementById('globe-zoom-in').addEventListener('click',()=>this.renderer?.zoom(.8));document.getElementById('globe-zoom-out').addEventListener('click',()=>this.renderer?.zoom(1.25));
  document.getElementById('globe-refresh').addEventListener('click',()=>{if(this.renderer)void this.refreshFeeds();else void this.ensure();});
  document.getElementById('globe-motion').addEventListener('click',()=>{this.motion=!this.motion;this.applyMotion();});
  document.getElementById('globe-radar-time').addEventListener('input',e=>{clearInterval(this.radarTimer);this.radarTimer=null;this.updatePlayButton(false);void this.radarFrame(Number(e.target.value));});
  document.getElementById('globe-radar-play').addEventListener('click',()=>{if(this.radarTimer){clearInterval(this.radarTimer);this.radarTimer=null;this.updatePlayButton(false);return;}if(!this.feeds?.radar.frames?.length)return;this.updatePlayButton(true);this.radarTimer=setInterval(()=>{if(!this.radarBusy)void this.radarFrame(((this.frameIndex||0)+1)%this.feeds.radar.frames.length);},1500);});
  document.getElementById('globe-open-radar-map').addEventListener('click',()=>{this.dialog.close();document.getElementById('map-panel').scrollIntoView({behavior:this.reduced.matches?'instant':'smooth'});});
  this.applyMotion();
 }
 updateForecast(forecast){this.forecast=forecast;const l=forecast.location;document.getElementById('globe-location-label').textContent=l.name||'Selected location';document.getElementById('globe-point-label').textContent=`${l.name||'Selected location'} · ${l.latitude.toFixed(4)}°, ${l.longitude.toFixed(4)}°`;this.panel.dataset.latitude=l.latitude;this.panel.dataset.longitude=l.longitude;this.renderer?.center(l);if(this.visible&&forecast.canonical&&!navigator.connection?.saveData)void this.ensure();}
 activity(){const active=(this.dialog.open||this.visible)&&!document.hidden;this.renderer?.setActive(active);
  const update=active&&this.renderer&&(!navigator.connection?.saveData||this.dialog.open);
  if(update&&!this.refreshTimer)this.refreshTimer=setInterval(()=>{if(this.renderer)void this.refreshFeeds();},120000);
  if(!update&&this.refreshTimer){clearInterval(this.refreshTimer);this.refreshTimer=null;}
 }
 applyMotion(){const b=document.getElementById('globe-motion');b.textContent=this.motion?'Pause motion':'Enable motion';b.setAttribute('aria-pressed',String(this.motion));this.renderer?.setMotion(this.motion);}
 async ensure(){
  const rect=this.panel.getBoundingClientRect();if(!this.dialog.open&&(rect.top>innerHeight+50||rect.bottom< -50))return;
  if(this.pending)return this.pending;if(this.renderer){if(Date.now()-(this.checkedAt||0)>10*60000)void this.refreshFeeds();return;}
  this.pending=(async()=>{try{
   const {WeatherGlobeRenderer}=await import('./globe-renderer.js?v=globe-v1');this.renderer=new WeatherGlobeRenderer(this.dialog.open?this.expandedMount:this.preview);this.renderer.expanded=this.dialog.open;this.renderer.canvas.style.touchAction=this.dialog.open?'none':'pan-y';this.renderer.center(this.forecast.location);this.renderer.setMotion(this.motion);this.renderer.canvas.dataset.latitude=this.forecast.location.latitude;this.renderer.canvas.dataset.longitude=this.forecast.location.longitude;document.getElementById('globe-loading').hidden=true;this.activity();await this.refreshFeeds();
  }catch{document.getElementById('globe-loading').textContent='Globe unavailable · Open local radar';this.status.textContent='The 3D globe is unavailable on this device. Detailed local radar remains available below.';this.expandedMount.textContent='Use the local radar map below.';}finally{this.pending=null;}})();return this.pending;
 }
 async open(){if(!this.forecast)return;if(!this.dialog.open){history.pushState({...history.state,weatherGlobe:true},'');this.dialog.showModal();}this.renderer?.move(this.expandedMount,true);this.activity();await this.ensure();this.renderer?.resize();}
 async refreshFeeds(){
  if(this.feedPending)return this.feedPending;
  this.feedPending=(async()=>{const refresh=document.getElementById('globe-refresh');refresh.disabled=true;refresh.setAttribute('aria-busy','true');try{
   const r=await fetch('/api/weather-fusion/globe',{cache:'no-store',signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error();const data=await r.json();for(const key of ['wind','clouds','radar'])data[key]??={status:'unavailable'};this.feeds=data;this.checkedAt=Date.now();const stamp=t=>new Intl.DateTimeFormat('en-US',{timeZone:this.forecast.timeZone||'America/New_York',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(t));
   const windAge=Date.now()-Date.parse(data.wind?.validAt);if(data.wind?.status==='ready'&&windAge<=90*60000&&windAge>=-5*60000){if(this.renderer.grid?.validAt!==data.wind.validAt)this.renderer.setWind(data.wind);}else{this.renderer.setWind(null);data.wind.status='unavailable';}
   const descriptions=[data.wind.status==='ready'?`Wind · GFS ${stamp(data.wind.validAt)} · sampled global field`:'Wind field unavailable'];
   if(data.clouds?.status==='ready'){
    try{if(this.cloudTime!==data.clouds.validAt||!this.renderer.cloudsMesh)await this.renderer.setImage('clouds','/api/weather-fusion/globe-image?'+new URLSearchParams({layer:'clouds',time:data.clouds.validAt}));this.cloudTime=data.clouds.validAt;this.renderer.setLayer('clouds',this.layers.clouds);descriptions.push('Satellite IR · '+stamp(data.clouds.validAt));}catch{this.renderer.clearLayer('clouds');descriptions.push('Satellite image unavailable');}
   }else{this.renderer.clearLayer('clouds');descriptions.push('Satellite image unavailable');}
   if(data.radar?.status==='ready'&&data.radar.frames?.length){document.getElementById('globe-radar-time').max=data.radar.frames.length-1;await this.radarFrame(data.radar.frames.length-1);descriptions.push('Radar · NOAA MRMS · '+stamp(data.radar.validAt));}else{this.renderer.clearLayer('radar');document.getElementById('globe-radar-stamp').textContent='Radar unavailable';descriptions.push('Radar unavailable');}
   this.status.textContent=descriptions.join('\n');this.renderer.canvas.dataset.windParticles=this.renderer.particles.length;this.renderer.canvas.dataset.windTime=data.wind?.validAt||'';
  }catch{this.status.textContent='Weather layers are temporarily unavailable. The Earth view and detailed local radar remain accessible.';}finally{this.feedPending=null;refresh.disabled=false;refresh.removeAttribute('aria-busy');}})();return this.feedPending;
 }
 async radarFrame(index){if(!this.feeds?.radar.frames?.[index]||!this.renderer)return;const token=(this.radarGeneration||0)+1;this.radarGeneration=token;this.radarBusy=true;const time=this.feeds.radar.frames[index];try{
  const shown=this.radarShownTime===time&&this.renderer.radarMesh?true:await this.renderer.setImage('radar','/api/weather-fusion/globe-image?'+new URLSearchParams({layer:'radar',time}));if(token!==this.radarGeneration||!shown)return;this.radarShownTime=time;this.renderer.setLayer('radar',this.layers.radar);this.frameIndex=index;document.getElementById('globe-radar-time').value=index;document.getElementById('globe-radar-stamp').textContent=new Intl.DateTimeFormat('en-US',{timeZone:this.forecast.timeZone||'America/New_York',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(time));
 }catch{if(token===this.radarGeneration)document.getElementById('globe-radar-stamp').textContent='Radar frame unavailable';}finally{if(token===this.radarGeneration)this.radarBusy=false;}}
 updatePlayButton(playing){const b=document.getElementById('globe-radar-play');b.textContent=playing?'Pause radar':'Play radar';b.setAttribute('aria-pressed',String(playing));}
}
