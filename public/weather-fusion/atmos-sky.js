/* Atmos sky: the forecast drawn as the sky (the painting is in atmos-sky-paint.js).
 * The sun and moon are placed by the solar and lunar formulas below, the same ones
 * the words beside the sky quote, so the picture and the words agree. Cloud cover,
 * rain, snow, fog and thunder come from the displayed condition, and the wind
 * drifts the clouds and leans the rain. */

import {RAD,clamp,smooth,css,mix,rng,skyPaint,cloudField,cloudTexture,treeSpecs,treePalette,drawTreeline,starField,drawSun,drawMoon,xOfAzimuth,yOfAltitude,CLOUD_W,CLOUD_H} from './atmos-sky-paint.js?v=atmos-v5';

const DAY=86400000,J1970=2440588,J2000=2451545,OBLIQUITY=RAD*23.4397;
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

/* ---------- Renderer ---------- */
export function createSky(canvas,{reducedMotion=false}={}){
 const ctx=canvas.getContext('2d',{alpha:false}),clouds=cloudTexture(cloudField(7));
 let width=0,height=0,horizonY=0,dpr=1,running=false,frame=0,last=0,visible=true,timeScale=1,offset=0,flash=null,nextFlash=0;
 let location={latitude:35.787,longitude:-78.4806};
 let state={time:Date.now(),scene:{cover:.3,rain:0,snow:0,fog:0,haze:0,dark:0,storm:false,wind:5,windDir:270}};
 let drops=[],flakes=[],stars=[],trees=[];
 function resize(){
  const rect=canvas.getBoundingClientRect();
  width=Math.max(1,Math.round(rect.width));height=Math.max(1,Math.round(rect.height));
  dpr=Math.min(window.devicePixelRatio||1,width>900?1.5:2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  horizonY=Math.round(height*.72);
  const random=rng(91);
  drops=Array.from({length:Math.round(Math.min(420,width*1.1))},()=>({x:random(),y:random(),speed:.75+random()*.5,length:.6+random()*.7}));
  flakes=Array.from({length:Math.round(Math.min(260,width*.6))},()=>({x:random(),y:random(),speed:.5+random()*.8,size:.6+random()*random()*1.6,sway:random()*6.3}));
  stars=starField(width,height);
  trees=treeSpecs(width,height,horizonY);
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
 /** Where the sun and moon are, and the moon's phase, for the moment shown. */
 function sunAndMoon(){
  const t=state.time,{latitude,longitude}=location;
  const sun=sunPosition(t,latitude,longitude),moon=moonPosition(t,latitude,longitude);
  return {sun,moon,alt:sun.altitude,phase:moonIllumination(t).phase};
 }
 function drawStars(alpha,time){
  if(alpha<.02)return;
  for(const star of stars){
   const twinkle=reducedMotion?.85:.65+.35*Math.sin(star.phase+time/1000*star.rate);
   ctx.fillStyle=css([226,234,248],alpha*twinkle*(.45+.55*star.size/1.4));
   ctx.beginPath();ctx.arc(star.x*width,star.y*horizonY,star.size,0,Math.PI*2);ctx.fill();
  }
 }
 // The clouds are tiled at the texture's own proportions, so their shapes keep their size as the window changes.
 function drawClouds(p,s,cover){
  const toward=p.alt>-6?{x:(p.sun.azimuth-180)/120,y:p.alt/45}:{x:(p.moon.azimuth-180)/120,y:p.moon.altitude/45};
  const image=clouds.update(cover,{x:clamp(toward.x,-1,1),y:clamp(toward.y,0,1)},p.alt,!!s.storm);
  if(!image)return;
  const scale=horizonY/CLOUD_H,tile=CLOUD_W*scale,start=-(((offset%tile)+tile)%tile);
  for(let x=start;x<width;x+=tile)ctx.drawImage(image,x,0,tile,horizonY);
 }
 function drawFog(p,s){
  if(!(s.fog>.02))return;
  const day=smooth(-6,6,p.alt),strong=.18+.62*s.fog*s.fog,tint=mix([70,82,104],[206,214,224],day);
  const g=ctx.createLinearGradient(0,0,0,height);
  g.addColorStop(0,css(tint,strong*.3));g.addColorStop(.6,css(tint,strong*.7));g.addColorStop(1,css(tint,strong*.85));
  ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
 }
 function drawPrecipitation(p,s,dt){
  const lean=Math.sin((s.windDir??270)*RAD)*clamp((s.wind??4)/30,0,.6);
  if(s.rain>.01){
   const count=Math.round(drops.length*clamp(s.rain)),day=smooth(-6,8,p.alt);
   ctx.strokeStyle=css(mix([150,166,196],[226,234,244],day),.2+.32*s.rain);ctx.lineWidth=1;ctx.beginPath();
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
 // Lightning only for thunder or storm wording, never for a plain rain forecast.
 function drawLightning(storm,time){
  if(!storm||reducedMotion)return;
  if(!flash&&time>nextFlash)flash={start:time,x:width*(.15+Math.random()*.7),y:height*(.08+Math.random()*.3),double:Math.random()<.5};
  if(!flash)return;
  const age=time-flash.start;
  if(age>700){flash=null;nextFlash=time+3500+Math.random()*6000;return;}
  const pulse=Math.max(0,1-age/260)+(flash.double&&age>320?Math.max(0,1-(age-320)/200)*.7:0);
  if(pulse<=0)return;
  const g=ctx.createRadialGradient(flash.x,flash.y,0,flash.x,flash.y,width*.45);
  g.addColorStop(0,css([225,225,255],.42*pulse));g.addColorStop(1,css([225,225,255],0));
  ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
 }
 function render(dt,time=performance.now()){
  if(!width||!height)return;
  const s=state.scene,p=sunAndMoon(),cover=clamp(finite(s.cover)?s.cover:.3),storm=!!s.storm;
  // The clouds move the way the air does: wind from the west carries them east, which is to the left.
  if(!reducedMotion)offset-=Math.sin((s.windDir??270)*RAD)*Math.max(0,s.wind??4)*.45*Math.min(timeScale,6)*dt/1000;
  const paint=skyPaint({alt:p.alt,cover,storm,fog:s.fog??0,haze:s.haze??0,dark:s.dark??0});
  const sky=ctx.createLinearGradient(0,0,0,horizonY);
  sky.addColorStop(0,css(paint.zenith));sky.addColorStop(1,css(paint.horizon));
  ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
  const night=1-smooth(-9,-3,p.alt),r=Math.max(7,Math.min(width,height)*.03);
  drawStars(night*(1-smooth(.25,.9,cover)),time);
  // The sun and moon sit under the cloud: thin cloud veils them and thick cloud hides them.
  const sunX=xOfAzimuth(p.sun.azimuth)*width,sunY=yOfAltitude(p.alt,horizonY);
  if(p.alt>-1&&sunX>-4*r&&sunX<width+4*r)drawSun(ctx,sunX,sunY,r,{alt:p.alt,veil:smooth(.45,.95,cover)});
  const moonX=xOfAzimuth(p.moon.azimuth)*width,moonY=yOfAltitude(p.moon.altitude,horizonY);
  if(p.moon.altitude>-1&&moonX>-4*r&&moonX<width+4*r)
   drawMoon(ctx,moonX,moonY,r*.85,{phase:p.phase,alpha:(1-.75*smooth(-8,2,p.alt))*(1-.9*smooth(.45,.95,cover))});
  drawClouds(p,s,cover);
  drawTreeline(ctx,trees,{width,height,horizonY,colours:treePalette(p.alt,paint.horizon,s.fog??0)});
  if(s.haze>.02){
   const top=horizonY-height*.16,bottom=horizonY+height*.04,haze=ctx.createLinearGradient(0,top,0,bottom);
   haze.addColorStop(0,css(paint.horizon,0));haze.addColorStop(1,css(paint.horizon,.32*clamp(s.haze)));
   ctx.fillStyle=haze;ctx.fillRect(0,top,width,bottom-top);
  }
  if(s.snow>.02){ctx.fillStyle=css([236,244,255],.18*clamp(s.snow));ctx.fillRect(0,0,width,height);}
  drawFog(p,s);
  drawPrecipitation(p,s,dt);
  drawLightning(storm,time);
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
