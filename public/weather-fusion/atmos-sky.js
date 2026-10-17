/* Atmos sky — a canvas sky computed from the forecast, not a photograph.
 * Sun and moon come from solar/lunar geometry at the selected point and time
 * (the same low-precision formulas behind weather-math's solarElevation). Cloud
 * amount follows the forecast's sky cover, rain/snow/fog/thunder are drawn only
 * when the displayed condition says so, humid air adds horizon haze and the
 * wind sets the drift. A Piedmont treeline (open prairie in the Plains) closes
 * the view; its shadow is the page colour below. */

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

/* ---------- Colour ---------- */
const hex=value=>{const n=parseInt(value.slice(1),16);return [n>>16&255,n>>8&255,n&255];};
const mix=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
const css=(c,a=1)=>`rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
function keyframes(table,value){
 if(value<=table[0][0])return table[0].slice(1);
 for(let i=1;i<table.length;i++)if(value<=table[i][0]){
  const t=(value-table[i-1][0])/(table[i][0]-table[i-1][0]);
  return table[i].slice(1).map((c,j)=>mix(table[i-1][j+1],c,t));
 }
 return table.at(-1).slice(1);
}
const table=rows=>rows.map(([a,...c])=>[a,...c.map(hex)]);
// Sun altitude → zenith, mid-sky and horizon colours: Rayleigh blue by day,
// the blue hour and the orange horizon band through twilight.
const SKY=table([
 [-18,'#03060f','#060a18','#0a1022'],[-12,'#050a1b','#0a132c','#151d3d'],[-8,'#0a1230','#18214a','#2f2f5a'],
 [-5,'#121d46','#2f3466','#7d5677'],[-2,'#1b2c5c','#4d4d82','#d07a63'],[0.5,'#24407a','#6a6f9f','#f19a63'],
 [3,'#2d5594','#8189b0','#f5b878'],[7,'#3363aa','#83a5d2','#f0d2a6'],[14,'#2e6cc6','#77ade4','#cbe2f3'],
 [30,'#2a6cd3','#68a6ea','#bddcf6'],[60,'#2565d5','#5c9fee','#b2d8f7'],
]);
const OVERCAST=table([[-12,'#0b0f19','#11151f','#191b22'],[-4,'#1f2433','#2b2e3c','#463c41'],[2,'#5b6272','#737886','#9a8d88'],[10,'#848e9c','#9aa3ae','#b8bec6'],[40,'#8f9aa8','#a8b1bc','#c4cad1']]);
const STORM=table([[-12,'#07090f','#0b0e15','#11131a'],[0,'#2d3240','#3a3f4c','#4a4a52'],[15,'#4b5462','#5d6672','#727a84'],[40,'#525c6a','#646d79','#7b838c']]);
// Cloud tops (lit) and bases (shade) by sun altitude: white by day, peach and
// rose at sunset, slate after dark.
const CLOUD=table([[-14,'#202a40','#111727'],[-7,'#454563','#1d2138'],[-2.5,'#d99482','#4c4262'],[0.5,'#ffbf92','#76607a'],[4,'#ffdcb8','#9c909f'],[10,'#fff9f0','#b7c1cd'],[40,'#ffffff','#bcc6d2']]);
const CLOUD_DARK=table([[-10,'#141924','#0a0d15'],[0,'#4f5463','#272b36'],[12,'#7e8794','#4c5462'],[40,'#89929e','#58616e']]);

/* ---------- Seeded randomness & noise ---------- */
function rng(seed){let a=seed>>>0;return ()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function noise1(seed){
 const random=rng(seed),values=Array.from({length:256},()=>random());
 const at=x=>{const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return lerp(values[i&255],values[(i+1)&255],u);};
 return (x,octaves=4)=>{let sum=0,amp=.5,freq=1,norm=0;for(let o=0;o<octaves;o++){sum+=amp*at(x*freq+o*17.3);norm+=amp;amp*=.5;freq*=2;}return sum/norm;};
}

/* ---------- Clouds ---------- */
// A cumulus is a cluster of soft puffs sharing a flat base (the condensation
// level). Sprites are greyscale: white sun-facing tops, grey bases. Colour and
// light are applied per frame so a time-lapse can relight them for free.
function cumulusSprite(seed,targetWidth,{flat=.5,puffs=12}={}){
 // Build the puff cluster in abstract units, then size the canvas to its bounds
 // so no puff is ever clipped; `base` records where the flat bottom sits.
 const random=rng(seed),list=[];
 for(let k=0;k<puffs;k++){
  const u=(k+.2+random()*.6)/puffs,profile=Math.pow(Math.sin(Math.PI*u),.85);
  const r=(.16+.3*profile*(.7+random()*.45))*(1-flat*.22);
  list.push({x:u*2+(random()-.5)*.1,y:-r*(.62+random()*.3)-profile*.12*random(),r});
 }
 for(let k=0;k<puffs*.7;k++){
  const p=list[Math.floor(random()*list.length)],a=-Math.PI*(.15+random()*.7);
  list.push({x:p.x+Math.cos(a)*p.r*.75,y:p.y+Math.sin(a)*p.r*.7,r:p.r*(.32+random()*.3)});
 }
 const left=Math.min(...list.map(p=>p.x-p.r)),right=Math.max(...list.map(p=>p.x+p.r)),top=Math.min(...list.map(p=>p.y-p.r));
 const scale=targetWidth/(right-left),width=Math.ceil(targetWidth),base=Math.ceil(-top*scale+2),height=Math.ceil(base+.06*scale);
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const g=canvas.getContext('2d');
 const px=p=>({x:(p.x-left)*scale,y:base+p.y*scale,r:p.r*scale});
 const pts=list.map(px);
 for(const p of pts){
  const grad=g.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
  grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.72,'rgba(255,255,255,1)');grad.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=grad;g.beginPath();g.arc(p.x,p.y,p.r,0,Math.PI*2);g.fill();
 }
 g.globalCompositeOperation='source-atop';
 const body=g.createLinearGradient(0,0,0,base);
 body.addColorStop(0,'rgb(255,255,255)');body.addColorStop(.45,'rgb(240,240,240)');body.addColorStop(1,'rgb(152,152,152)');
 g.fillStyle=body;g.fillRect(0,0,width,height);
 for(const p of pts){
  const shade=g.createRadialGradient(p.x+p.r*.15,p.y+p.r*.5,0,p.x+p.r*.15,p.y+p.r*.5,p.r*.95);
  shade.addColorStop(0,'rgba(120,120,120,.32)');shade.addColorStop(1,'rgba(120,120,120,0)');
  g.fillStyle=shade;g.fillRect(p.x-p.r*1.2,p.y-p.r*.6,p.r*2.6,p.r*2.2);
  const lit=g.createRadialGradient(p.x,p.y-p.r*.45,0,p.x,p.y-p.r*.45,p.r*.85);
  lit.addColorStop(0,'rgba(255,255,255,.7)');lit.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=lit;g.fillRect(p.x-p.r,p.y-p.r*1.4,p.r*2,p.r*2);
 }
 g.globalCompositeOperation='destination-in';
 const floor=g.createLinearGradient(0,base-.06*scale,0,base+.04*scale);
 floor.addColorStop(0,'rgba(0,0,0,1)');floor.addColorStop(1,'rgba(0,0,0,0)');
 g.fillStyle=floor;g.fillRect(0,0,width,height);
 return {canvas,base,width,height};
}
// A tileable stratus deck: soft, horizontally stretched texture for overcast skies.
function deckTexture(width,height,seed){
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const g=canvas.getContext('2d'),image=g.createImageData(width,height),random=rng(seed);
 const lattice=Array.from({length:256*64},()=>random());
 const value=(x,y,period)=>{
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  const cell=(i,j)=>lattice[(((j%64)+64)%64)*256+(((i%period)+period)%period)];
  return lerp(lerp(cell(x0,y0),cell(x0+1,y0),u),lerp(cell(x0,y0+1),cell(x0+1,y0+1),u),v);
 };
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let sum=0,amp=.5,norm=0;
  for(let o=0;o<5;o++){const cells=3*2**o;sum+=amp*value(x/width*cells,y/height*cells*1.6+o*7,cells);norm+=amp;amp*=.52;}
  const v=sum/norm,i=(y*width+x)*4;
  image.data[i]=image.data[i+1]=image.data[i+2]=Math.round(196+59*clamp((v-.25)/.5));
  image.data[i+3]=Math.round(255*clamp(.78+v*.3));
 }
 g.putImageData(image,0,0);
 return canvas;
}

/* ---------- Treeline ---------- */
function circle(path,x,y,r){path.moveTo(x+r,y);path.arc(x,y,r,0,Math.PI*2);}
function blob(path,x,y,rx,ry){path.moveTo(x+rx,y);path.ellipse(x,y,rx,ry,0,0,Math.PI*2);}
// Loblolly pine: a tall straight trunk carrying one clumpy, oval crown.
function loblolly(path,x,base,h,random){
 const lean=(random()-.5)*h*.05,top=base-h,trunk=Math.max(1.1,h*.024);
 const rx=h*(.1+random()*.05),ry=h*(.075+random()*.035),cy=top+ry*1.05,cx=x+lean;
 path.moveTo(x-trunk,base);path.lineTo(cx-trunk*.6,cy);path.lineTo(cx+trunk*.6,cy);path.lineTo(x+trunk,base);path.closePath();
 blob(path,cx,cy,rx,ry);
 const lumps=4+Math.floor(random()*4);
 for(let i=0;i<lumps;i++){
  const a=Math.PI*(1.05+random()*.9),d=.55+random()*.35;
  blob(path,cx+Math.cos(a)*rx*d,cy+Math.sin(a)*ry*d*.9,rx*(.35+random()*.25),ry*(.4+random()*.25));
 }
 if(random()<.55){const side=random()<.5?-1:1,by=cy+ry*(1.1+random()*.6);blob(path,cx+side*rx*(.75+random()*.3),by,rx*.42,ry*.38);path.moveTo(cx,by+1);path.lineTo(cx+side*rx*.7,by-1);path.lineTo(cx+side*rx*.7,by+.6);path.lineTo(cx,by+2.2);path.closePath();}
}
// Eastern red cedar: a dense, narrow cone.
function cedar(path,x,base,h,random){
 const w=h*(.12+random()*.06),steps=10;
 path.moveTo(x-w,base);
 for(let i=1;i<=steps;i++){const t=i/steps;path.lineTo(x-w*(1-t)*(1+(i%2?.14:-.06)),base-h*t);}
 for(let i=steps-1;i>=0;i--){const t=i/steps;path.lineTo(x+w*(1-t)*(1+(i%2?.14:-.06)),base-h*t);}
 path.closePath();
}
// Mixed hardwood canopy: a rolling, leafy forest edge.
function canopy(path,width,base,height,seed,{low=.42,swing=.34}={}){
 const n=noise1(seed),random=rng(seed+7);
 const heightAt=x=>height*(low+swing*(n(x/110,3)-.35)+.16*(n(x/28+40,2)-.5));
 path.moveTo(-30,base+4);
 for(let x=-30;x<=width+30;x+=5)path.lineTo(x,base-heightAt(x));
 path.lineTo(width+30,base+4);path.closePath();
 for(let x=-24;x<=width+24;x+=3+random()*6){const r=height*(.045+random()*.07);circle(path,x,base-heightAt(x)+r*.4,r);}
 return heightAt;
}
function treeline(width,base,maxHeight,seed,kind,layer){
 const random=rng(seed),path=new Path2D(),far=layer==='far';
 path.rect(-30,base,width+60,4000);
 if(kind==='prairie'){
  // Open Plains horizon: a long, low swell with occasional shelterbelts.
  const n=noise1(seed);
  path.moveTo(-30,base+2);
  for(let x=-30;x<=width+30;x+=10)path.lineTo(x,base-(far?5:2)-n(x/140,3)*(far?6:3));
  path.lineTo(width+30,base+2);path.closePath();
  let x=random()*width*.4;
  while(x<width+20){
   const run=(far?50:30)+random()*(far?110:70);
   for(let t=0;t<run;t+=far?3.5:5)circle(path,x+t,base-maxHeight*(far?.2:.24)*(.6+random()*.4),maxHeight*(far?.09:.12)*(.7+random()*.4));
   x+=run+140+random()*300;
  }
  return path;
 }
 const ridge=canopy(path,width,base,maxHeight,seed,far?{low:.34,swing:.22}:{low:.44,swing:.34});
 let x=-16+random()*16;
 while(x<width+20){
  const pick=random(),under=ridge(x);
  if(pick<.66){const h=maxHeight*(far?.62+random()*.2:.8+random()*.2);if(h>under*1.15)loblolly(path,x,base-under*.6,h-under*.6,random);}
  else if(pick<.86){const h=maxHeight*(far?.48+random()*.14:.6+random()*.24);if(h>under)cedar(path,x,base,h,random);}
  x+=(far?11:16)+random()*(far?22:30);
 }
 return path;
}

/* ---------- Renderer ---------- */
export function createSky(canvas,{reducedMotion=false,ground='#0D1714'}={}){
 const ctx=canvas.getContext('2d',{alpha:false});
 const groundColor=hex(ground);
 let width=0,height=0,dpr=1,horizon=0,running=false,frame=0,last=0,visible=true,timeScale=1;
 let location={latitude:35.787,longitude:-78.4806,terrain:'piedmont'};
 let state={time:Date.now(),scene:{cover:.3,rain:0,snow:0,fog:0,haze:0,dark:0,storm:false,wind:5,windDir:270}};
 let stars=[],drops=[],flakes=[],trees=null,flash=null,nextFlash=0,deckOffset=0;
 const layerA=document.createElement('canvas'),layerB=document.createElement('canvas');
 const a=layerA.getContext('2d'),b=layerB.getContext('2d');
 let clouds=null,deck=null;
 // Three parallax bands: distant small clouds along the horizon, a middle
 // band, and large near clouds overhead.
 const BANDS=[
  {count:16,top:.62,bottom:.95,size:[.09,.18],squash:.55,speed:.32,sprite:224},
  {count:11,top:.34,bottom:.72,size:[.16,.3],squash:.7,speed:.6,sprite:320},
  {count:7,top:.08,bottom:.46,size:[.28,.5],squash:.8,speed:1,sprite:448},
 ];
 function buildClouds(){
  if(clouds)return;
  clouds=BANDS.map((band,bi)=>{
   const random=rng(101+bi*31);
   return Array.from({length:band.count},(_,k)=>({
    sprite:cumulusSprite(1000+bi*100+k,band.sprite,{flat:bi===0?.6:.35,puffs:9+Math.floor(random()*7)}),
    x:(k+random()*.8)/band.count,y:band.top+(band.bottom-band.top)*random(),size:band.size[0]+(band.size[1]-band.size[0])*random(),
    threshold:random(),stretch:.85+random()*.4,
   }));
  });
  deck=deckTexture(384,96,77);
 }
 function resize(){
  const rect=canvas.getBoundingClientRect();
  width=Math.max(1,Math.round(rect.width));height=Math.max(1,Math.round(rect.height));
  dpr=Math.min(window.devicePixelRatio||1,width>900?1.5:2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const bottom=skyBottom(),scale=Math.min(1.5,dpr);
  layerA.width=layerB.width=Math.round(width*scale);layerA.height=layerB.height=Math.round(bottom*scale);
  a.setTransform(scale,0,0,scale,0,0);b.setTransform(scale,0,0,scale,0,0);
  const random=rng(91);
  stars=Array.from({length:Math.round(width*bottom/1700)},()=>({x:random()*width,y:random(),size:.5+random()*random()*1.4,phase:random()*6.3,rate:.6+random()*1.8,bright:.35+random()*.65}));
  drops=Array.from({length:Math.round(Math.min(420,width*1.1))},()=>({x:random(),y:random(),speed:.75+random()*.5,length:.6+random()*.7}));
  flakes=Array.from({length:Math.round(Math.min(260,width*.6))},()=>({x:random(),y:random(),speed:.5+random()*.8,size:.6+random()*random()*1.6,sway:random()*6.3}));
  trees=null;
  render(0);
 }
 function setHorizon(px){const next=Math.round(px);if(next!==horizon){horizon=next;resize();}}
 function setLocation(latitude,longitude){
  if(!finite(latitude)||!finite(longitude))return;
  const terrain=longitude<-96.5?'prairie':'piedmont';
  if(terrain!==location.terrain)trees=null;
  location={latitude,longitude,terrain};
  if(!running)render(0);
 }
 function setState(next){
  state={time:finite(next?.time)?next.time:state.time,scene:{...state.scene,...(next?.scene||{})}};
  if(!running)render(0);
 }
 const skyBottom=()=>Math.max(80,horizon||height*.6);
 const treeHeight=()=>Math.round(Math.min(84,Math.max(42,skyBottom()*.16)));
 function project(azimuth,altitude){
  const bottom=skyBottom();
  return {x:(azimuth-75)/210*width,y:bottom-clamp(altitude/78,-.2,1.08)*(bottom-36)};
 }
 function palette(){
  const sun=sunPosition(state.time,location.latitude,location.longitude);
  const s=state.scene,alt=sun.altitude;
  const clear=keyframes(SKY,alt),grey=keyframes(OVERCAST,alt),storm=keyframes(STORM,alt);
  const overcast=clamp(smooth(.45,1,s.cover)*.95+s.fog*.4);
  const darkness=clamp(s.dark);
  const sky=clear.map((c,i)=>mix(mix(c,grey[i],overcast),storm[i],darkness*overcast));
  const [lit,shade]=keyframes(CLOUD,alt),[darkLit,darkShade]=keyframes(CLOUD_DARK,alt);
  const dull=clamp(darkness*1.05+smooth(.75,1,s.cover)*.55);
  return {sun,sky,cloudLit:mix(lit,darkLit,dull),cloudShade:mix(shade,darkShade,dull),overcast};
 }
 function drawSky(p){
  const bottom=skyBottom(),[zenith,middle,low]=p.sky;
  const g=ctx.createLinearGradient(0,0,0,bottom);
  g.addColorStop(0,css(zenith));g.addColorStop(.58,css(middle));g.addColorStop(1,css(low));
  ctx.fillStyle=g;ctx.fillRect(0,0,width,bottom+2);
  const alt=p.sun.altitude,pos=project(p.sun.azimuth,Math.max(alt,0));
  // Twilight glow concentrated around the sun's azimuth.
  const glow=smooth(-11,-1,alt)*(1-smooth(4,16,alt))*(1-p.overcast*.75);
  if(glow>.01){
   const r=ctx.createRadialGradient(pos.x,bottom,0,pos.x,bottom,width*.85);
   r.addColorStop(0,css([255,170,110],.55*glow));r.addColorStop(.35,css([240,120,110],.22*glow));r.addColorStop(1,css([120,80,140],0));
   ctx.fillStyle=r;ctx.fillRect(0,0,width,bottom);
  }
  // Belt of Venus: the pink anti-twilight arch opposite the sun.
  const belt=smooth(-6,-1.5,alt)*(1-smooth(1,4,alt))*(1-p.overcast);
  if(belt>.01){
   const anti=width-pos.x,v=ctx.createRadialGradient(anti,bottom,0,anti,bottom,width*.7);
   v.addColorStop(0,css([232,160,178],.28*belt));v.addColorStop(1,css([232,160,178],0));
   ctx.fillStyle=v;ctx.fillRect(0,0,width,bottom);
  }
  // Low overcast at night picks up a faint glow from town lights.
  const town=smooth(-2,-10,alt)*smooth(.55,.95,state.scene.cover);
  if(town>.01){
   const c=ctx.createLinearGradient(0,bottom*.5,0,bottom);
   c.addColorStop(0,'rgba(70,52,46,0)');c.addColorStop(1,css([92,66,52],.45*town));
   ctx.fillStyle=c;ctx.fillRect(0,bottom*.5,width,bottom*.5);
  }
 }
 function drawStars(p,time){
  const alt=p.sun.altitude,s=state.scene;
  const alpha=smooth(-5,-14,alt)*Math.pow(1-clamp(s.cover),1.6)*(1-s.fog);
  if(alpha<.02)return;
  const bottom=skyBottom();
  ctx.fillStyle='#e9f0ff';
  for(const star of stars){
   const twinkle=reducedMotion?1:.75+.25*Math.sin(time/1000*star.rate+star.phase);
   ctx.globalAlpha=alpha*star.bright*twinkle*(1-smooth(.7,1,star.y));
   ctx.fillRect(star.x,star.y*bottom*.95,star.size,star.size);
  }
  ctx.globalAlpha=1;
 }
 function drawMoon(p){
  const moon=moonPosition(state.time,location.latitude,location.longitude);
  if(moon.altitude<-1)return;
  const {fraction,phase}=moonIllumination(state.time),pos=project(moon.azimuth,moon.altitude);
  if(pos.x<-40||pos.x>width+40)return;
  const day=smooth(-4,6,p.sun.altitude),r=Math.max(7,Math.min(width,skyBottom())*.026);
  const visibility=(1-day*.65)*(1-Math.pow(state.scene.cover,2)*.85)*(1-state.scene.fog*.6);
  if(visibility<.04)return;
  const glow=ctx.createRadialGradient(pos.x,pos.y,r*.8,pos.x,pos.y,r*8);
  glow.addColorStop(0,css([220,230,255],.24*fraction*visibility*(1-day)));glow.addColorStop(1,'rgba(220,230,255,0)');
  ctx.fillStyle=glow;ctx.fillRect(pos.x-r*8,pos.y-r*8,r*16,r*16);
  ctx.save();ctx.globalAlpha=visibility;
  ctx.fillStyle=css([40,48,70],.5*(1-day));ctx.beginPath();ctx.arc(pos.x,pos.y,r,0,Math.PI*2);ctx.fill();
  const waxing=phase<.5,k=Math.cos(2*Math.PI*phase),rx=r*Math.abs(k);
  ctx.beginPath();
  if(waxing){ctx.arc(pos.x,pos.y,r,-Math.PI/2,Math.PI/2,false);if(k>0)ctx.ellipse(pos.x,pos.y,rx,r,0,Math.PI/2,-Math.PI/2,true);else ctx.ellipse(pos.x,pos.y,rx,r,0,Math.PI/2,Math.PI*1.5,false);}
  else{ctx.arc(pos.x,pos.y,r,-Math.PI/2,Math.PI/2,true);if(k>0)ctx.ellipse(pos.x,pos.y,rx,r,0,Math.PI/2,Math.PI*1.5,false);else ctx.ellipse(pos.x,pos.y,rx,r,0,Math.PI/2,-Math.PI/2,true);}
  ctx.closePath();ctx.fillStyle=css(mix([244,240,226],[255,255,255],day));ctx.fill();ctx.restore();
 }
 function drawSun(p){
  const alt=p.sun.altitude;
  if(alt<-3)return;
  const pos=project(p.sun.azimuth,alt),low=1-smooth(2,18,alt);
  const core=mix([255,250,234],[255,196,120],low),halo=mix([255,240,200],[255,150,90],low);
  const through=clamp(1-Math.pow(state.scene.cover,2.2)*.92-state.scene.dark*.3-state.scene.fog*.5);
  const size=Math.max(10,Math.min(width,skyBottom())*.032);
  const g=ctx.createRadialGradient(pos.x,pos.y,size*.5,pos.x,pos.y,size*11);
  g.addColorStop(0,css(halo,.6*clamp(through+.25)));g.addColorStop(.25,css(halo,.18*clamp(through+.2)));g.addColorStop(1,css(halo,0));
  ctx.fillStyle=g;ctx.fillRect(pos.x-size*11,pos.y-size*11,size*22,size*22);
  if(through>.05&&alt>-.6){
   ctx.save();ctx.beginPath();ctx.rect(0,0,width,skyBottom());ctx.clip();
   ctx.fillStyle=css(core,through);ctx.beginPath();ctx.arc(pos.x,pos.y,size,0,Math.PI*2);ctx.fill();ctx.restore();
  }
 }
 function drawClouds(p,dt){
  const s=state.scene,bottom=skyBottom(),cover=clamp(s.cover);
  if(cover<.015)return;
  buildClouds();
  // Viewer faces south: east is screen-left. Wind blows from windDir.
  const drift=Math.sin(s.windDir*RAD)*(4+s.wind*.6)*timeScale;
  a.clearRect(0,0,width,bottom);
  // Overcast: a stratus deck fills the gaps between cumulus.
  const deckAlpha=smooth(.55,.95,cover);
  if(deckAlpha>.01){
   if(!reducedMotion)deckOffset=(deckOffset+drift*.4*dt/1000)%(width*1.2);
   a.globalAlpha=deckAlpha;
   const tile=Math.max(width*1.2,400);
   for(let x=(deckOffset%tile+tile)%tile-tile;x<width;x+=tile)a.drawImage(deck,x,0,tile,bottom);
   a.globalAlpha=1;
  }
  const visibleShare=clamp(cover*1.25);
  BANDS.forEach((band,bi)=>{
   for(const cloud of clouds[bi]){
    const alpha=smooth(cloud.threshold-.08,cloud.threshold+.04,visibleShare)*(1-deckAlpha*.62);
    if(alpha<.01)continue;
    if(!reducedMotion)cloud.x=((cloud.x+drift*band.speed*dt/1000/width/2)%1+1)%1;
    // Size against the wider of the view and the sky's height, so tall phone
    // skies get properly sized clouds.
    const reference=Math.max(width,bottom*1.7),sprite=cloud.sprite;
    const grow=.8+cover*.55,w=reference*cloud.size*grow*cloud.stretch,h=w*sprite.height/sprite.width*band.squash;
    const span=width+w*2,x=cloud.x*span-w,y=cloud.y*bottom-h*sprite.base/sprite.height;
    a.globalAlpha=alpha*(bi===0?.92:1);
    a.drawImage(sprite.canvas,x,y,w,h);
   }
  });
  a.globalAlpha=1;
  // Light the greyscale clouds: tint with the lit colour, then shade the bases
  // and let distant clouds take on the horizon colour.
  b.globalCompositeOperation='source-over';b.clearRect(0,0,width,bottom);
  b.fillStyle=css(p.cloudLit);b.fillRect(0,0,width,bottom);
  b.globalCompositeOperation='destination-in';b.drawImage(layerA,0,0,width,bottom);
  b.globalCompositeOperation='multiply';b.drawImage(layerA,0,0,width,bottom);
  b.globalCompositeOperation='source-atop';
  const tone=b.createLinearGradient(0,0,0,bottom);
  tone.addColorStop(0,css(p.cloudShade,0));tone.addColorStop(.6,css(p.cloudShade,.18+.3*s.dark));tone.addColorStop(1,css(mix(p.cloudShade,p.sky[2],.55),.55));
  b.fillStyle=tone;b.fillRect(0,0,width,bottom);
  b.globalCompositeOperation='source-over';
  ctx.drawImage(layerB,0,0,width,bottom);
 }
 function drawWeather(p,dt,time){
  const s=state.scene,bottom=skyBottom(),alt=p.sun.altitude;
  if(s.haze>.02&&alt>-4){
   const g=ctx.createLinearGradient(0,bottom*.55,0,bottom);
   const tint=mix([244,240,224],[255,214,170],1-smooth(4,20,alt));
   g.addColorStop(0,css(tint,0));g.addColorStop(1,css(tint,.34*s.haze*smooth(-4,8,alt)*(1-s.cover*.5)));
   ctx.fillStyle=g;ctx.fillRect(0,bottom*.55,width,bottom*.45);
  }
  if(s.storm&&!reducedMotion){
   if(!flash&&time>nextFlash)flash={start:time,x:width*(.15+Math.random()*.7),y:bottom*(.15+Math.random()*.3),double:Math.random()<.5};
   if(flash){
    const age=time-flash.start,pulse=Math.max(0,1-age/260)+(flash.double&&age>320?Math.max(0,1-(age-320)/200)*.7:0);
    if(age>700){flash=null;nextFlash=time+3500+Math.random()*6000;}
    else if(pulse>0){const g=ctx.createRadialGradient(flash.x,flash.y,0,flash.x,flash.y,width*.45);g.addColorStop(0,`rgba(225,225,255,${.42*pulse})`);g.addColorStop(1,'rgba(225,225,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,width,bottom);}
   }
  }
  // Screen-x drift of the wind for slanted rain and snow.
  const lean=Math.sin(s.windDir*RAD)*clamp(s.wind/30,0,.6);
  if(s.rain>.01){
   const count=Math.round(drops.length*clamp(s.rain)),day=smooth(-6,8,alt);
   ctx.strokeStyle=css(mix([120,138,170],[214,224,238],day),.2+.32*s.rain);ctx.lineWidth=1;ctx.beginPath();
   const fall=dt/1000*1.6*(timeScale>1?1.4:1);
   for(let i=0;i<count;i++){
    const drop=drops[i];
    if(!reducedMotion){drop.y+=fall*drop.speed;if(drop.y>1.05){drop.y-=1.1;drop.x=(drop.x+.37)%1;}}
    const x=drop.x*width,y=drop.y*bottom,length=(10+14*s.rain)*drop.length;
    ctx.moveTo(x,y);ctx.lineTo(x+lean*length,y+length);
   }
   ctx.stroke();
   ctx.fillStyle=css(mix([20,28,44],[190,200,214],day),.1*s.rain);ctx.fillRect(0,0,width,bottom);
  }
  if(s.snow>.01){
   const count=Math.round(flakes.length*clamp(s.snow));
   ctx.fillStyle='rgba(245,248,255,.85)';
   for(let i=0;i<count;i++){
    const f=flakes[i];
    if(!reducedMotion){f.y+=dt/1000*.09*f.speed*(timeScale>1?2:1);f.sway+=dt/1000*1.2;if(f.y>1.03){f.y-=1.06;f.x=(f.x+.29)%1;}}
    const x=f.x*width+Math.sin(f.sway)*6+lean*f.y*30,y=f.y*bottom;
    ctx.beginPath();ctx.arc(x,y,f.size,0,Math.PI*2);ctx.fill();
   }
  }
 }
 function drawLand(p){
  const bottom=skyBottom(),s=state.scene,maxH=treeHeight();
  if(!trees||trees.width!==width||trees.base!==bottom||trees.terrain!==location.terrain){
   trees={width,base:bottom,terrain:location.terrain,far:treeline(width,bottom-3,maxH*.78,7,location.terrain,'far'),near:treeline(width,bottom+1,maxH,3,location.terrain,'near')};
  }
  // Aerial perspective: distant trees take on the horizon colour.
  const day=smooth(-8,10,p.sun.altitude),low=p.sky[2];
  ctx.fillStyle=css(mix(groundColor,low,.2+.16*day+.2*s.haze));ctx.fill(trees.far);
  const veil=mix(p.cloudShade,p.cloudLit,.6),grey=(veil[0]*.3+veil[1]*.59+veil[2]*.11);
  const fogColor=mix([grey,grey,grey+4],low,.18);
  if(s.fog>.02){
   // Fog flattens the whole view, then thickens toward the ground.
   ctx.fillStyle=css(fogColor,.18+.62*s.fog*s.fog);ctx.fillRect(0,0,width,bottom);
   const g=ctx.createLinearGradient(0,bottom*.3,0,bottom+6);
   g.addColorStop(0,css(fogColor,0));g.addColorStop(1,css(fogColor,.9*s.fog));
   ctx.fillStyle=g;ctx.fillRect(0,bottom*.3,width,bottom*.7+6);
  }
  ctx.fillStyle=css(groundColor);ctx.fill(trees.near);
  if(s.fog>.02){
   const g=ctx.createLinearGradient(0,bottom-maxH*1.1,0,bottom+2);
   g.addColorStop(0,css(fogColor,.55*s.fog));g.addColorStop(.75,css(fogColor,.18*s.fog));g.addColorStop(1,css(fogColor,0));
   ctx.save();ctx.clip(trees.near);ctx.fillStyle=g;ctx.fillRect(0,bottom-maxH*1.1,width,maxH*1.1+2);ctx.restore();
  }
 }
 function render(dt,time=performance.now()){
  if(!width||!height)return;
  const p=palette();
  drawSky(p);drawStars(p,time);drawMoon(p);drawSun(p);drawClouds(p,dt);drawWeather(p,dt,time);drawLand(p);
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
 return {resize,setHorizon,setLocation,setState,setTimeScale:value=>{timeScale=finite(value)&&value>0?value:1;},start,stop,setVisible,render:()=>render(0),
  get treeHeight(){return treeHeight();},
  get reducedMotion(){return reducedMotion;},set reducedMotion(value){reducedMotion=!!value;if(reducedMotion)stop();else start();render(0);}};
}
