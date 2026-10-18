/* Atmos sky — the forecast drawn over the main page's own sky photographs.
 * The photographs are the ones behind the main page's Today card, so the sky and
 * the trees along its bottom edge look the same on both pages. The forecast
 * decides which photograph shows and how it is lit: sky cover blends clear and
 * cloudy skies, a rain or storm photograph takes over when the displayed
 * condition says so, and night swaps in the night sky. Sun and moon come from
 * solar and lunar geometry at the selected point and time, humid air adds haze
 * along the horizon, and the wind drifts the picture sideways. Rain, snow, fog
 * and lightning are drawn only when the displayed condition calls for them. */

const RAD=Math.PI/180,DAY=86400000,J1970=2440588,J2000=2451545,OBLIQUITY=RAD*23.4397;
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const finite=v=>typeof v==='number'&&Number.isFinite(v);

/* ---------- Astronomy ---------- */
const toDays=time=>time/DAY-0.5+J1970-J2000;
const rightAscension=(l,b)=>Math.atan2(Math.sin(l)*Math.cos(OBLIQUITY)-Math.tan(b)*Math.sin(OBLIQUITY),Math.cos(l));
const declination=(l,b)=>Math.asin(Math.sin(b)*Math.cos(OBLIQUITY)+Math.cos(b)*Math.sin(OBLIQUITY)*Math.sin(l));
const azimuthOf=(H,phi,dec)=>Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi));
const altitudeOf=(H,phi,dec)=>Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H));
const siderealTime=(d,lw)=>RAD*(280.16+360.9856235*d)-lw;
function sunCoords(d){
 const M=RAD*(357.5291+0.98560028*d),C=RAD*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M));
 const L=M+C+RAD*102.9372+Math.PI;
 return {dec:declination(L,0),ra:rightAscension(L,0)};
}
function moonCoords(d){
 const L=RAD*(218.316+13.176396*d),M=RAD*(134.963+13.064993*d),F=RAD*(93.272+13.22935*d);
 const l=L+RAD*6.289*Math.sin(M),b=RAD*5.128*Math.sin(F);
 return {ra:rightAscension(l,b),dec:declination(l,b),dist:385001-20905*Math.cos(M)};
}
/** Altitude and compass azimuth (degrees from north) of the sun. */
export function sunPosition(time,latitude,longitude){
 const lw=RAD*-longitude,phi=RAD*latitude,d=toDays(time),c=sunCoords(d),H=siderealTime(d,lw)-c.ra;
 return {altitude:altitudeOf(H,phi,c.dec)/RAD,azimuth:(azimuthOf(H,phi,c.dec)/RAD+540)%360};
}
export function moonPosition(time,latitude,longitude){
 const lw=RAD*-longitude,phi=RAD*latitude,d=toDays(time),c=moonCoords(d),H=siderealTime(d,lw)-c.ra;
 return {altitude:altitudeOf(H,phi,c.dec)/RAD,azimuth:(azimuthOf(H,phi,c.dec)/RAD+540)%360};
}
/** Illuminated fraction and phase (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter). */
export function moonIllumination(time){
 const d=toDays(time),s=sunCoords(d),m=moonCoords(d),sdist=149598000;
 const phi=Math.acos(clamp(Math.sin(s.dec)*Math.sin(m.dec)+Math.cos(s.dec)*Math.cos(m.dec)*Math.cos(s.ra-m.ra),-1,1));
 const inc=Math.atan2(sdist*Math.sin(phi),m.dist-sdist*Math.cos(phi));
 const angle=Math.atan2(Math.cos(s.dec)*Math.sin(s.ra-m.ra),Math.sin(s.dec)*Math.cos(m.dec)-Math.cos(s.dec)*Math.sin(m.dec)*Math.cos(s.ra-m.ra));
 return {fraction:(1+Math.cos(inc))/2,phase:0.5+0.5*inc*(angle<0?-1:1)/Math.PI};
}
export function moonPhaseName(phase){
 const p=((phase%1)+1)%1;
 if(p<.03||p>.97)return 'New moon';
 if(p<.22)return 'Waxing crescent moon';
 if(p<.28)return 'First quarter moon';
 if(p<.47)return 'Waxing gibbous moon';
 if(p<.53)return 'Full moon';
 if(p<.72)return 'Waning gibbous moon';
 if(p<.78)return 'Last quarter moon';
 return 'Waning crescent moon';
}
export function directionWord(azimuth){return ['north','northeast','east','southeast','south','southwest','west','northwest'][Math.round((((azimuth%360)+360)%360)/45)%8];}

/* ---------- Colour and noise ---------- */
const mix=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
const css=(c,a=1)=>`rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a).toFixed(3)})`;
function rng(seed){let a=seed>>>0;return ()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

// The main page's own sky photographs (the Today card). Each is 1200 x 800.
const PHOTOS={
 clear:'/weather-fusion/today-sky-clear.webp',
 clouds:'/weather-fusion/today-sky-clouds.webp',
 rain:'/weather-fusion/today-sky-rain.webp',
 storm:'/weather-fusion/today-sky-storm.webp',
 night:'/weather-fusion/today-sky-night-v2.webp',
};

/* ---------- Renderer ---------- */
export function createSky(canvas,{reducedMotion=false}={}){
 const ctx=canvas.getContext('2d',{alpha:false});
 let width=0,height=0,dpr=1,running=false,frame=0,last=0,visible=true,timeScale=1,offset=0;
 let location={latitude:35.787,longitude:-78.4806};
 let state={time:Date.now(),scene:{cover:.3,rain:0,snow:0,fog:0,haze:0,dark:0,storm:false,wind:5,windDir:270}};
 let drops=[],flakes=[],flash=null,nextFlash=0;
 const photos={};
 for(const [key,src] of Object.entries(PHOTOS)){
  const image=new Image();
  image.decoding='async';
  image.onload=()=>{photos[key]=image;if(!running)render(0);};
  image.src=src;
 }
 function resize(){
  const rect=canvas.getBoundingClientRect();
  width=Math.max(1,Math.round(rect.width));height=Math.max(1,Math.round(rect.height));
  dpr=Math.min(window.devicePixelRatio||1,width>900?1.5:2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const random=rng(91);
  drops=Array.from({length:Math.round(Math.min(420,width*1.1))},()=>({x:random(),y:random(),speed:.75+random()*.5,length:.6+random()*.7}));
  flakes=Array.from({length:Math.round(Math.min(260,width*.6))},()=>({x:random(),y:random(),speed:.5+random()*.8,size:.6+random()*random()*1.6,sway:random()*6.3}));
  render(0);
 }
 function setLocation(latitude,longitude){
  if(!finite(latitude)||!finite(longitude))return;
  location={latitude,longitude};
  if(!running)render(0);
 }
 function setState(next){
  state={time:finite(next?.time)?next.time:state.time,scene:{...state.scene,...(next?.scene||{})}};
  if(!running)render(0);
 }
 /** Everything the picture needs for this moment: light, which photographs, and how much weather. */
 function palette(){
  const s=state.scene,sun=sunPosition(state.time,location.latitude,location.longitude),alt=sun.altitude;
  const night=1-smooth(-9,-3,alt),dusk=smooth(-9,-3,alt)*(1-smooth(4,12,alt));
  const cloudy=smooth(.2,.75,s.cover),storm=s.storm?1:0,rain=smooth(.12,.5,s.rain)*(1-storm);
  const others=(1-rain)*(1-storm);
  return {sun,alt,night,dusk,cloudy,storm,rain,weights:{clear:others*(1-cloudy),clouds:others*cloudy,rain,storm}};
 }
 // Photographs are cover-fitted to the window and aligned to the bottom, so the
 // trees along their lower edge stay in view. The wind moves them sideways; a
 // mirrored copy continues each picture past its edge with no seam.
 function drawPhotos(p,dt){
  const s=state.scene,w=width,h=height;
  // The picture moves the way the air does: wind from the west carries it east, which is to the left.
  if(!reducedMotion)offset-=Math.sin((s.windDir??270)*RAD)*Math.max(0,s.wind??4)*.45*Math.min(timeScale,6)*dt/1000;
  ctx.fillStyle='#17294a';ctx.fillRect(0,0,w,h);
  const layer=(image,alpha)=>{
   const a=clamp(alpha);if(!image||a<.003)return;
   const scale=Math.max(w/image.naturalWidth,h/image.naturalHeight),pw=image.naturalWidth*scale,ph=image.naturalHeight*scale,top=h-ph;
   const x0=-(((offset%pw)+pw)%pw);
   ctx.globalAlpha=a;
   ctx.drawImage(image,x0,top,pw,ph);
   ctx.save();ctx.translate(x0+2*pw,0);ctx.scale(-1,1);ctx.drawImage(image,0,top,pw,ph);ctx.restore();
   ctx.globalAlpha=1;
  };
  const day=1-p.night,weights=p.weights;
  // Each photograph goes over the ones before it with its share of the weight so far, so the
  // picture is exactly the weighted mix of the photographs that have loaded.
  let total=0;
  for(const [image,share] of [[photos.clear,weights.clear*day],[photos.clouds,weights.clouds*day],[photos.rain,weights.rain*day],[photos.storm,weights.storm*day],[photos.night,p.night]]){
   if(!image||!(share>0))continue;
   total+=share;
   layer(image,share/total);
  }
 }
 // A navy veil keeps the sky in the same dark glass tone as the page, and deepens
 // with night, cloud, rain and storm; snow adds a pale wash.
 function drawVeil(p){
  const s=state.scene;
  ctx.fillStyle=css([9,20,42],clamp(.22+.26*p.night+.16*p.cloudy+.1*p.rain+.1*p.storm,0,.8));
  ctx.fillRect(0,0,width,height);
  if(s.snow>.02){ctx.fillStyle=css([236,244,255],.22*clamp(s.snow));ctx.fillRect(0,0,width,height);}
 }
 // Low sun warms the lower sky and the trees.
 function drawDusk(p){
  const w=p.dusk*(1-p.cloudy*.5)*(1-p.storm);if(w<.02)return;
  const g=ctx.createLinearGradient(0,height*.45,0,height);
  g.addColorStop(0,css([255,150,92],0));g.addColorStop(1,css([255,138,88],.3*w));
  ctx.fillStyle=g;ctx.fillRect(0,height*.45,width,height*.55);
 }
 // The sun is drawn where the geometry puts it: east is left, west is right, and
 // altitude sets the height. It fades under cloud, rain and storm.
 function drawSun(p){
  const visible=clamp(smooth(-2,4,p.alt)*(1-p.cloudy*.7)*(1-p.rain)*(1-p.storm));
  if(visible<.02)return;
  const x=clamp((p.sun.azimuth-75)/210)*width,y=height*(.66-clamp(p.alt/72,-.1,.9)*.52);
  const warm=1-smooth(4,22,p.alt),core=mix([255,246,222],[255,186,122],warm),halo=mix([255,236,190],[255,150,88],warm);
  const reach=Math.max(140,height*1.1);
  const g=ctx.createRadialGradient(x,y,0,x,y,reach);
  g.addColorStop(0,css(halo,.42*visible));g.addColorStop(.14,css(halo,.16*visible));g.addColorStop(.5,css(halo,.04*visible));g.addColorStop(1,css(halo,0));
  ctx.fillStyle=g;ctx.fillRect(x-reach,y-reach,reach*2,reach*2);
  const d=Math.max(7,height*.03),disc=ctx.createRadialGradient(x,y,0,x,y,d*2.4);
  disc.addColorStop(0,css(core,.95*visible));disc.addColorStop(.42,css(core,.62*visible));disc.addColorStop(1,css(core,0));
  ctx.fillStyle=disc;ctx.fillRect(x-d*2.4,y-d*2.4,d*4.8,d*4.8);
 }
 // The moon's phase is drawn from its illuminated fraction, and it shows only
 // after dark and through a gap in the cloud.
 function drawMoon(p){
  const moon=moonPosition(state.time,location.latitude,location.longitude);
  if(moon.altitude<-1)return;
  const {fraction,phase}=moonIllumination(state.time),s=state.scene;
  const x=clamp((moon.azimuth-75)/210)*width,y=height*(.66-clamp(moon.altitude/72,-.1,.9)*.52);
  const visibility=clamp(p.night*(1-Math.pow(p.cloudy,2)*.85)*(1-s.fog*.6)*(1-p.rain)*(1-p.storm));
  if(visibility<.03)return;
  const r=Math.max(6,height*.03);
  const glow=ctx.createRadialGradient(x,y,r*.8,x,y,r*7);
  glow.addColorStop(0,css([200,214,240],.22*fraction*visibility));glow.addColorStop(1,css([200,214,240],0));
  ctx.fillStyle=glow;ctx.fillRect(x-r*7,y-r*7,r*14,r*14);
  ctx.save();ctx.globalAlpha=visibility;
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle='rgba(34,44,70,.7)';ctx.fill();
  const waxing=phase<.5,k=Math.cos(2*Math.PI*phase),rx=r*Math.abs(k);
  ctx.beginPath();
  if(waxing){ctx.arc(x,y,r,-Math.PI/2,Math.PI/2,false);if(k>0)ctx.ellipse(x,y,rx,r,0,Math.PI/2,-Math.PI/2,true);else ctx.ellipse(x,y,rx,r,0,Math.PI/2,Math.PI*1.5,false);}
  else{ctx.arc(x,y,r,-Math.PI/2,Math.PI/2,true);if(k>0)ctx.ellipse(x,y,rx,r,0,Math.PI/2,Math.PI*1.5,false);else ctx.ellipse(x,y,rx,r,0,Math.PI/2,-Math.PI/2,true);}
  ctx.closePath();ctx.fillStyle=css([240,242,236]);ctx.fill();
  ctx.restore();
 }
 // Humid air hazes the horizon, most at dawn and dusk.
 function drawHaze(p){
  const s=state.scene;if(s.haze<.02)return;
  const tint=mix([222,232,242],[255,200,160],1-smooth(4,20,p.alt));
  const g=ctx.createLinearGradient(0,height*.5,0,height);
  g.addColorStop(0,css(tint,0));g.addColorStop(1,css(tint,.3*s.haze*(1-p.cloudy*.4)));
  ctx.fillStyle=g;ctx.fillRect(0,height*.5,width,height*.5);
 }
 // Lightning only for thunder or storm wording, never for a plain rain forecast.
 function drawLightning(p,time){
  if(!p.storm||reducedMotion)return;
  if(!flash&&time>nextFlash)flash={start:time,x:width*(.15+Math.random()*.7),y:height*(.1+Math.random()*.3),double:Math.random()<.5};
  if(!flash)return;
  const age=time-flash.start,pulse=Math.max(0,1-age/260)+(flash.double&&age>320?Math.max(0,1-(age-320)/200)*.7:0);
  if(age>700){flash=null;nextFlash=time+3500+Math.random()*6000;return;}
  if(pulse<=0)return;
  const g=ctx.createRadialGradient(flash.x,flash.y,0,flash.x,flash.y,width*.45);
  g.addColorStop(0,css([225,225,255],.42*pulse));g.addColorStop(1,css([225,225,255],0));
  ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
 }
 // Fog sits on the ground: thickest near the horizon, thinning toward the top.
 function drawFog(p){
  const s=state.scene;if(s.fog<.02)return;
  const day=smooth(-6,6,p.alt),strong=.18+.62*s.fog*s.fog;
  const tint=mix([70,82,104],[206,214,224],day);
  const g=ctx.createLinearGradient(0,0,0,height);
  g.addColorStop(0,css(tint,strong*.3));g.addColorStop(.6,css(tint,strong*.7));g.addColorStop(1,css(tint,strong*.85));
  ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
 }
 function drawPrecipitation(p,dt){
  const s=state.scene,lean=Math.sin((s.windDir??270)*RAD)*clamp((s.wind??4)/30,0,.6);
  if(s.rain>.01){
   const count=Math.round(drops.length*clamp(s.rain)),day=smooth(-6,8,p.alt);
   ctx.strokeStyle=css(mix([150,166,196],[226,234,244],day),.22+.34*s.rain);ctx.lineWidth=1;ctx.beginPath();
   const fall=dt/1000*1.6*(timeScale>1?1.4:1);
   for(let i=0;i<count;i++){
    const drop=drops[i];
    if(!reducedMotion){drop.y+=fall*drop.speed;if(drop.y>1.05){drop.y-=1.1;drop.x=(drop.x+.37)%1;}}
    const x=drop.x*width,y=drop.y*height,length=(10+14*s.rain)*drop.length;
    ctx.moveTo(x,y);ctx.lineTo(x+lean*length,y+length);
   }
   ctx.stroke();
  }
  if(s.snow>.01){
   const count=Math.round(flakes.length*clamp(s.snow));
   ctx.fillStyle='rgba(250,252,255,.9)';
   for(let i=0;i<count;i++){
    const f=flakes[i];
    if(!reducedMotion){f.y+=dt/1000*.09*f.speed*(timeScale>1?2:1);f.sway+=dt/1000*1.2;if(f.y>1.03){f.y-=1.06;f.x=(f.x+.29)%1;}}
    const x=f.x*width+Math.sin(f.sway)*6+lean*f.y*30,y=f.y*height;
    ctx.beginPath();ctx.arc(x,y,f.size,0,Math.PI*2);ctx.fill();
   }
  }
 }
 function render(dt,time=performance.now()){
  if(!width||!height)return;
  const p=palette();
  drawPhotos(p,dt);drawVeil(p);drawDusk(p);drawSun(p);drawMoon(p);drawHaze(p);drawLightning(p,time);drawFog(p);drawPrecipitation(p,dt);
 }
 function loop(time){
  if(!running)return;
  frame=requestAnimationFrame(loop);
  if(!visible)return;
  const dt=last?Math.min(80,time-last):16;
  if(timeScale===1&&dt<30&&last)return; // about 30 fps at rest, full rate during a time-lapse
  last=time;render(dt,time);
 }
 function start(){
  if(reducedMotion){render(0);return;}
  if(running)return;running=true;last=0;frame=requestAnimationFrame(loop);
 }
 function stop(){running=false;cancelAnimationFrame(frame);}
 function setVisible(value){visible=value;if(visible&&!running&&!reducedMotion)start();}
 return {resize,setLocation,setState,setTimeScale:value=>{timeScale=finite(value)&&value>0?value:1;},start,stop,setVisible,render:()=>render(0),
  get reducedMotion(){return reducedMotion;},set reducedMotion(value){reducedMotion=!!value;if(reducedMotion)stop();else start();render(0);}};
}
