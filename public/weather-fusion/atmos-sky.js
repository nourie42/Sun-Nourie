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
 [-18,'#0a1430','#122042','#1d2c55'],[-12,'#0c1736','#15244a','#24315e'],[-8,'#0f1c40','#1f2b58','#3a3a6a'],
 [-5,'#121d46','#2f3466','#7d5677'],[-2,'#1b2c5c','#4d4d82','#d07a63'],[0.5,'#24407a','#6a6f9f','#f19a63'],
 [3,'#2d5594','#8189b0','#f5b878'],[7,'#3363aa','#83a5d2','#f0d2a6'],[14,'#2e6cc6','#77ade4','#cbe2f3'],
 [30,'#2a6cd3','#68a6ea','#bddcf6'],[60,'#2565d5','#5c9fee','#b2d8f7'],
]);
const OVERCAST=table([[-12,'#151b2a','#1b2132','#24283a'],[-4,'#1f2433','#2b2e3c','#463c41'],[2,'#5b6272','#737886','#9a8d88'],[10,'#848e9c','#9aa3ae','#b8bec6'],[40,'#8f9aa8','#a8b1bc','#c4cad1']]);
const STORM=table([[-12,'#10141f','#151a26','#1c202c'],[0,'#2d3240','#3a3f4c','#4a4a52'],[15,'#4b5462','#5d6672','#727a84'],[40,'#525c6a','#646d79','#7b838c']]);
// Cloud tops (lit) and bases (shade) by sun altitude: white by day, peach and
// rose at sunset, slate after dark.
const CLOUD=table([[-14,'#2c3754','#1a2238'],[-7,'#454563','#1d2138'],[-2.5,'#d99482','#4c4262'],[0.5,'#ffbf92','#76607a'],[4,'#ffdcb8','#9c909f'],[10,'#fff9f0','#b7c1cd'],[40,'#ffffff','#bcc6d2']]);
const CLOUD_DARK=table([[-10,'#1d2331','#121722'],[0,'#4f5463','#272b36'],[12,'#7e8794','#4c5462'],[40,'#89929e','#58616e']]);

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

/* Opt-in textured cloud volumes for the photographic park. The density edge
 * has several noise scales; it is not the old row of clipped white circles.
 * These sprites are built once, then the normal wind/parallax renderer moves
 * them without running a per-pixel simulation on every animation frame. */
function volumeNoise(seed){
 const random=rng(seed),size=128,values=Float32Array.from({length:size*size},()=>random());
 const at=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),sample=(i,j)=>values[(j&127)*size+(i&127)];return lerp(lerp(sample(ix,iy),sample(ix+1,iy),u),lerp(sample(ix,iy+1),sample(ix+1,iy+1),u),v);};
 return (x,y)=>{let sum=0,amplitude=.55,normal=0;for(let octave=0;octave<4;octave++){sum+=at(x,y)*amplitude;normal+=amplitude;x=x*2.03+11.7;y=y*2.01+7.9;amplitude*=.48;}return sum/normal;};
}
function volumeCloudSprite(seed,targetWidth){
 const random=rng(seed),noise=volumeNoise(seed+17),width=Math.round(targetWidth),height=Math.round(width*.56),puffs=[];
 for(let index=0;index<9;index++){
  const u=(index+.3+random()*.4)/9,profile=Math.sin(Math.PI*u);
  const x=.10+u*.80,y=.60-profile*.19+(random()-.5)*.065,rx=.105+profile*.06,ry=.16+profile*.16;
  puffs.push({x,y,xx:1/(rx*rx),yy:1/(ry*ry)});
  if(index>0&&index<8){const sx=x+(random()-.5)*.06,sy=y-ry*.72,srx=rx*(.34+random()*.25),sry=ry*(.34+random()*.25);puffs.push({x:sx,y:sy,xx:1/(srx*srx),yy:1/(sry*sry)});}
 }
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const g=canvas.getContext('2d'),pixels=g.createImageData(width,height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/width,v=y/height;let density=-2;
  for(const puff of puffs){const dx=u-puff.x,dy=v-puff.y;density=Math.max(density,1-dx*dx*puff.xx-dy*dy*puff.yy);}
  if(density<-.22)continue;
  const texture=noise(u*12,v*9),detail=noise(u*31+9,v*24+3),depth=density+(texture-.5)*.62+(detail-.5)*.12;
  const opacity=smooth(-.08,.38,depth);if(opacity<.004)continue;
  const roundedTop=smooth(.62,.16,v),wisps=smooth(.38,.72,texture),shade=clamp(.20+roundedTop*.55+wisps*.18+detail*.14);
  const light=clamp(139+shade*111+(texture-.5)*23,126,255),i=(y*width+x)*4;
  pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=Math.round(light);pixels.data[i+3]=Math.round(opacity*255);
 }
 g.putImageData(pixels,0,0);return {canvas,width,height,base:height*.82};
}
function volumeDeckTexture(width,height,seed){
 const noise=volumeNoise(seed),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const g=canvas.getContext('2d'),pixels=g.createImageData(width,height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/width,v=y/height,warp=noise(u*3,v*2),mass=noise(u*5+warp*2,v*3+warp),fine=noise(u*19+7,v*12+3);
  const billow=smooth(.25,.78,mass),light=clamp(136+billow*105+(fine-.5)*33+(1-v)*13,120,255),i=(y*width+x)*4;
  pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=Math.round(light);pixels.data[i+3]=255;
 }
 g.putImageData(pixels,0,0);return canvas;
}

/* ---------- Landscape ---------- */
// Leaf colours follow the season at the location: fresh green in spring, deep
// green in summer, Piedmont fall colour in October and November, bare branches
// in winter. Evergreens stay green all year.
const LEAVES={
 winter:null,
 early:['#9cbf6b','#a9c77a','#8fb766','#b7c98a'],
 spring:['#7fbf5a','#6fb04f','#8ccb63','#5fa347'],
 summer:['#4f8f3a','#5b9a42','#447f35','#66a54c'],
 late:['#5f9a3e','#7da443','#9aa83f','#c0a13a'],
 fall:['#6f9a45','#7f9b3d','#5f8f3e','#8aa346','#d9a334','#cf7a2c','#b8452e','#e4b847','#c96a2d'],
 bare:['#b07a3a','#9a5a2c','#b98d3d','#8a6a45'],
};
const EVERGREEN=['#2f5e3d','#386b45','#2a5537','#3d7349'];
function season(month){return month===12||month<=2?'winter':month===3?'early':month<=5?'spring':month<=8?'summer':month===9?'late':month===10?'fall':'bare';}
const mixHex=(a,b,t)=>css(mix(hex(a),hex(b),t));
const shadeHex=(a,k)=>css(hex(a).map(v=>Math.max(0,Math.min(255,v*k))));
function deciduous(g,x,base,h,leafSet,random){
 const trunkW=Math.max(1.6,h*.065),crownR=h*(.32+random()*.08),cy=base-h+crownR*1.02,cx=x+(random()-.5)*h*.04;
 const bark='#5d4433';
 g.fillStyle=bark;g.beginPath();
 g.moveTo(x-trunkW*.6,base);g.lineTo(cx-trunkW*.35,cy+crownR*.3);g.lineTo(cx+trunkW*.35,cy+crownR*.3);g.lineTo(x+trunkW*.6,base);g.closePath();g.fill();
 if(!leafSet){bareTree(g,cx,cy+crownR*.35,h*.62,bark,random);return;}
 const leaf=leafSet[Math.floor(random()*leafSet.length)];
 const crown=new Path2D(),blobs=6+Math.floor(random()*4);
 for(let i=0;i<blobs;i++){
  const a=random()*Math.PI*2,d=crownR*(.25+random()*.4),r=crownR*(.42+random()*.22);
  const bx=cx+Math.cos(a)*d*1.05,by=cy+Math.sin(a)*d*.78-crownR*.08;
  crown.moveTo(bx+r,by);crown.arc(bx,by,r,0,Math.PI*2);
 }
 crown.moveTo(cx+crownR*.62,cy);crown.arc(cx,cy,crownR*.62,0,Math.PI*2);
 g.fillStyle=leaf;g.fill(crown);
 g.save();g.clip(crown);
 // Sunlit from the upper left, shaded underneath.
 const light=g.createLinearGradient(cx-crownR,cy-crownR,cx+crownR*.9,cy+crownR*1.1);
 light.addColorStop(0,mixHex(leaf,'#fff6d8',.3));light.addColorStop(.5,'rgba(0,0,0,0)');light.addColorStop(1,shadeHex(leaf,.6));
 g.globalAlpha=.9;g.fillStyle=light;g.fillRect(cx-crownR*1.6,cy-crownR*1.6,crownR*3.2,crownR*3.2);
 // Small leaf clumps break up the outline into foliage texture.
 const dark=shadeHex(leaf,.78),bright=mixHex(leaf,'#fffbe6',.22);
 for(let i=0;i<34;i++){
  const a=random()*Math.PI*2,d=crownR*Math.sqrt(random())*.95,r=crownR*(.06+random()*.08);
  const px=cx+Math.cos(a)*d,py=cy+Math.sin(a)*d*.85,upper=py<cy-crownR*.1&&px<cx+crownR*.2;
  g.globalAlpha=upper?.28:.22;g.fillStyle=upper&&random()<.7?bright:dark;
  g.beginPath();g.arc(px,py,r,0,Math.PI*2);g.fill();
 }
 g.restore();g.globalAlpha=1;
}
// Winter hardwood: a trunk that splits into thinner and thinner branches.
function bareTree(g,x,y,length,color,random){
 g.strokeStyle=color;g.lineCap='round';
 const branch=(bx,by,angle,len,width,depth)=>{
  const ex=bx+Math.cos(angle)*len,ey=by-Math.sin(angle)*len;
  g.lineWidth=width;g.beginPath();g.moveTo(bx,by);g.lineTo(ex,ey);g.stroke();
  if(depth<=0||len<3)return;
  const count=2+(random()<.35?1:0);
  for(let i=0;i<count;i++)branch(ex,ey,angle+(i-(count-1)/2)*(.5+random()*.35),len*(.62+random()*.12),Math.max(.6,width*.66),depth-1);
 };
 branch(x,y,Math.PI/2+(random()-.5)*.15,length*.38,Math.max(1.2,length*.05),5);
}
// A pine: drooping, slightly ragged tiers that narrow to a point.
function evergreen(g,x,base,h,random){
 const w=h*(.19+random()*.06),tiers=5+Math.floor(random()*2),green=EVERGREEN[Math.floor(random()*EVERGREEN.length)];
 g.fillStyle='#5a4130';g.fillRect(x-Math.max(1,h*.028),base-h*.16,Math.max(2,h*.056),h*.16);
 const shape=new Path2D(),top=base-h;
 for(let k=0;k<tiers;k++){
  const f=k/(tiers-1),yBottom=base-h*.1-(h*.86)*f*.9,yTop=k===tiers-1?top:yBottom-h*(.3-.08*f);
  const half=w*(1-f*.8)*(.92+random()*.16),sag=h*.035,lean=(random()-.5)*w*.08;
  shape.moveTo(x+lean*.3,yTop);
  shape.quadraticCurveTo(x+half*.45,yBottom-h*.08,x+half,yBottom+sag*.4);
  const teeth=3+Math.floor(random()*2);
  for(let t=1;t<=teeth;t++){
   const px=x+half-(2*half)*t/teeth,py=yBottom+(t%2?-sag*.35:sag*.25);
   shape.lineTo(px+half/teeth,yBottom-sag*.55);shape.lineTo(px,py);
  }
  shape.quadraticCurveTo(x-half*.45,yBottom-h*.08,x+lean*.3,yTop);shape.closePath();
 }
 g.fillStyle=green;g.fill(shape);
 g.save();g.clip(shape);
 g.globalAlpha=.36;g.fillStyle=shadeHex(green,.55);g.fillRect(x+w*.05,top,w*1.3,h);
 g.globalAlpha=.2;g.fillStyle=mixHex(green,'#f4f0c8',.35);g.fillRect(x-w*1.3,top,w*.75,h);
 g.restore();g.globalAlpha=1;
}
function hills(g,width,base,height,seed,color){
 const n=noise1(seed);
 g.fillStyle=color;g.beginPath();g.moveTo(-10,base+2);
 for(let x=-10;x<=width+10;x+=6)g.lineTo(x,base-height*(.35+.65*n(x/220,3)));
 g.lineTo(width+10,base+2);g.closePath();g.fill();
}
// The edge of a distant forest: one soft, hazy band of crowns and spires.
function forestEdge(g,width,base,height,random,color,spires=true){
 const n=noise1(97),edge=new Path2D();
 for(let x=-12;x<width+12;x+=4+random()*5){
  const r=height*(.22+random()*.2),y=base-height*(.35+.5*n(x/90,2))-r*.2;
  edge.moveTo(x+r,y);edge.arc(x,y,r,0,Math.PI*2);
  if(spires&&random()<.12){const tall=height*(.55+random()*.45);edge.moveTo(x-r*.55,y);edge.lineTo(x,y-tall);edge.lineTo(x+r*.55,y);edge.closePath();}
 }
 edge.rect(-12,base-height*.35,width+24,height*.35+2);
 g.fillStyle=color;g.fill(edge);
}
/** Paint the whole landscape once in daylight colours; lighting is applied per frame. */
function paintLandscape(width,height,horizon,maxTree,month,terrain,scale){
 const canvas=document.createElement('canvas'),top=Math.max(0,Math.floor(horizon-maxTree*1.12));
 canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round((height-top)*scale));
 const g=canvas.getContext('2d');g.setTransform(scale,0,0,scale,0,-top*scale);
 const random=rng(2026),kind=season(month),leaves=LEAVES[kind],prairie=terrain==='prairie';
 // Distant hills and forest, softened by the air between you and them.
 hills(g,width,horizon,maxTree*(prairie?.18:.42),11,'#a9c2c9');
 hills(g,width,horizon,maxTree*(prairie?.1:.26),23,'#97b6ae');
 if(!prairie){
  forestEdge(g,width,horizon+1,maxTree*.36,random,kind==='winter'?'#9aa9a8':kind==='fall'||kind==='bare'?'#93a88a':'#86a68c');
  forestEdge(g,width,horizon+1,maxTree*.22,random,kind==='winter'?'#8a9a96':kind==='fall'||kind==='bare'?'#7f9a74':'#6f9877',false);
 }
 // The field.
 const grassTop=kind==='winter'?'#a3a67a':kind==='bare'?'#9ba95f':kind==='fall'?'#8fae55':kind==='early'?'#93b860':'#7db457';
 const field=g.createLinearGradient(0,horizon,0,height);
 field.addColorStop(0,shadeHex(grassTop,.9));field.addColorStop(.18,grassTop);field.addColorStop(1,shadeHex(grassTop,.72));
 g.fillStyle=field;g.fillRect(0,horizon,width,height-horizon);
 g.strokeStyle=shadeHex(grassTop,.8);g.lineWidth=1;g.globalAlpha=.5;g.beginPath();
 for(let x=0;x<width;x+=3+random()*3){const y=horizon+4+random()*(height-horizon)*.9,l=2+random()*4;g.moveTo(x,y);g.lineTo(x+(random()-.5)*2,y-l);}
 g.stroke();g.globalAlpha=1;
 // Groves and single trees standing in the field, back to front.
 const groves=prairie?Math.max(2,Math.round(width/420)):Math.max(3,Math.round(width/230)+1);
 const spots=Array.from({length:groves},(_,i)=>({center:(i+.15+random()*.7)/groves*width,span:(prairie?60:70)+random()*(prairie?120:170)}));
 const trees=[];
 for(const spot of spots){
  for(let x=spot.center-spot.span/2;x<spot.center+spot.span/2;x+=prairie?9+random()*6:12+random()*16){
   const h=maxTree*(prairie?.45+random()*.25:.58+random()*.42);
   trees.push({x,h,base:horizon+2+random()*(maxTree*.08),conifer:!prairie&&random()<.34});
  }
 }
 if(!prairie)for(let k=0;k<Math.round(width/300);k++)trees.push({x:random()*width,h:maxTree*(.5+random()*.35),base:horizon+3+random()*maxTree*.1,conifer:random()<.4});
 trees.sort((a,b)=>a.base-b.base);
 for(const t of trees){
  g.fillStyle='rgba(28,52,22,.22)';g.beginPath();g.ellipse(t.x+t.h*.06,t.base+1,t.h*(t.conifer?.2:.32),Math.max(1.5,t.h*.035),0,0,Math.PI*2);g.fill();
  if(t.conifer)evergreen(g,t.x,t.base,t.h,random);else deciduous(g,t.x,t.base,t.h,leaves,random);
 }
 return {canvas,top};
}

/* ---------- Renderer ---------- */
export function createSky(canvas,{reducedMotion=false,landscape=true,precipitation=true,horizon=null,externalAnimation=false,cloudDepthMotion=false,detailedClouds=false}={}){
 const ctx=canvas.getContext('2d',{alpha:false});
 let width=0,height=0,dpr=1,running=false,frame=0,last=0,visible=true,timeScale=1;
 let location={latitude:35.787,longitude:-78.4806,terrain:'piedmont'};
 let state={time:Date.now(),scene:{cover:.3,rain:0,snow:0,fog:0,haze:0,dark:0,storm:false,wind:5,windDir:270}};
 let stars=[],drops=[],flakes=[],land=null,flash=null,nextFlash=0,deckOffset=0,deckDepthOffset=0,celestialVisible=true;
 const layerA=document.createElement('canvas'),layerB=document.createElement('canvas'),landLayer=document.createElement('canvas');
 const a=layerA.getContext('2d'),b=layerB.getContext('2d'),l=landLayer.getContext('2d');
 let clouds=null,deck=null,cloudAtlas=null;
 function artworkSprite(rect){
  const image=cloudAtlas.image,sx=rect[0]*image.naturalWidth,sy=rect[1]*image.naturalHeight,sw=rect[2]*image.naturalWidth,sh=rect[3]*image.naturalHeight;
  const sprite=document.createElement('canvas');sprite.width=Math.max(1,Math.round(sw));sprite.height=Math.max(1,Math.round(sh));
  sprite.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,sprite.width,sprite.height);
  return {canvas:sprite,width:sprite.width,height:sprite.height,base:sprite.height*.82};
 }
 // Three parallax bands: distant small clouds along the horizon, a middle
 // band, and large near clouds overhead.
 const BANDS=[
  {count:16,top:.62,bottom:.95,size:[.09,.18],squash:.55,speed:.32,sprite:224},
  {count:11,top:.34,bottom:.72,size:[.16,.3],squash:.7,speed:.6,sprite:320},
  {count:7,top:.08,bottom:.46,size:[.28,.5],squash:.8,speed:1,sprite:448},
 ];
 function buildClouds(){
  if(clouds)return;
  const volumeSprites=new Map();
  const photographicSprite=index=>{const key=`art-${index}`;if(!volumeSprites.has(key))volumeSprites.set(key,artworkSprite(cloudAtlas.rects[index]));return volumeSprites.get(key);};
  clouds=BANDS.map((band,bi)=>{
   const random=rng(101+bi*31);
   return Array.from({length:band.count},(_,k)=>({
    sprite:cloudAtlas?photographicSprite((bi*3+k)%cloudAtlas.rects.length):detailedClouds?(()=>{const key=bi*3+k%3;if(!volumeSprites.has(key))volumeSprites.set(key,volumeCloudSprite(1000+key*137,band.sprite));return volumeSprites.get(key);})():cumulusSprite(1000+bi*100+k,band.sprite,{flat:bi===0?.6:.35,puffs:9+Math.floor(random()*7)}),
    x:(k+random()*.8)/band.count,y:band.top+(band.bottom-band.top)*random(),size:band.size[0]+(band.size[1]-band.size[0])*random(),
    threshold:random(),stretch:.85+random()*.4,depth:cloudDepthMotion?random():.5,
   }));
  });
  deck=cloudAtlas?.deckRect?artworkSprite(cloudAtlas.deckRect).canvas:detailedClouds?volumeDeckTexture(448,192,77):deckTexture(384,96,77);
 }
 const grass=()=>Math.round(Math.min(64,Math.max(30,height*.11)));
 const skyBottom=()=>finite(horizon)?Math.max(1,height*clamp(horizon,.2,.95)):Math.max(60,height-grass());
 const maxTree=()=>Math.round(Math.min(132,Math.max(54,height*.22)));
 function resize(){
  const rect=canvas.getBoundingClientRect();
  width=Math.max(1,Math.round(rect.width));height=Math.max(1,Math.round(rect.height));
  dpr=Math.min(window.devicePixelRatio||1,width>900?1.5:2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const bottom=landscape?skyBottom():height,scale=Math.min(1.5,dpr);
  layerA.width=layerB.width=Math.round(width*scale);layerA.height=layerB.height=Math.round(bottom*scale);
  a.setTransform(scale,0,0,scale,0,0);b.setTransform(scale,0,0,scale,0,0);
  const random=rng(91);
  stars=Array.from({length:Math.round(width*bottom/1700)},()=>({x:random()*width,y:random(),size:.5+random()*random()*1.4,phase:random()*6.3,rate:.6+random()*1.8,bright:.35+random()*.65}));
  drops=Array.from({length:Math.round(Math.min(420,width*1.1))},()=>({x:random(),y:random(),speed:.75+random()*.5,length:.6+random()*.7}));
  flakes=Array.from({length:Math.round(Math.min(260,width*.6))},()=>({x:random(),y:random(),speed:.5+random()*.8,size:.6+random()*random()*1.6,sway:random()*6.3}));
  land=null;
  render(0);
 }
 function setLocation(latitude,longitude){
  if(!finite(latitude)||!finite(longitude))return;
  const terrain=longitude<-96.5?'prairie':'piedmont';
  if(terrain!==location.terrain)land=null;
  location={latitude,longitude,terrain};
  if(!running&&!externalAnimation)render(0);
 }
 function setState(next){
  state={time:finite(next?.time)?next.time:state.time,scene:{...state.scene,...(next?.scene||{})}};
  if(!running&&!externalAnimation)render(0);
 }
 function project(azimuth,altitude){
  const bottom=skyBottom();
  return {x:(azimuth-75)/210*width,y:bottom-clamp(altitude/78,-.2,1.08)*(bottom-36)};
 }
 function palette(){
  const sun=celestialVisible?sunPosition(state.time,location.latitude,location.longitude):{altitude:finite(state.scene.sunAltitude)?state.scene.sunAltitude:-6,azimuth:180};
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
  ctx.fillStyle=g;ctx.fillRect(0,0,width,landscape?bottom+2:height);
  const alt=p.sun.altitude,pos=project(p.sun.azimuth,Math.max(alt,0));
  const glow=smooth(-11,-1,alt)*(1-smooth(4,16,alt))*(1-p.overcast*.75);
  if(glow>.01){
   const r=ctx.createRadialGradient(pos.x,bottom,0,pos.x,bottom,width*.85);
   r.addColorStop(0,css([255,170,110],.55*glow));r.addColorStop(.35,css([240,120,110],.22*glow));r.addColorStop(1,css([120,80,140],0));
   ctx.fillStyle=r;ctx.fillRect(0,0,width,bottom);
  }
  const belt=smooth(-6,-1.5,alt)*(1-smooth(1,4,alt))*(1-p.overcast);
  if(belt>.01){
   const anti=width-pos.x,v=ctx.createRadialGradient(anti,bottom,0,anti,bottom,width*.7);
   v.addColorStop(0,css([232,160,178],.28*belt));v.addColorStop(1,css([232,160,178],0));
   ctx.fillStyle=v;ctx.fillRect(0,0,width,bottom);
  }
  const town=smooth(-2,-10,alt)*smooth(.55,.95,state.scene.cover);
  if(town>.01){
   const c=ctx.createLinearGradient(0,bottom*.5,0,bottom);
   c.addColorStop(0,'rgba(70,52,46,0)');c.addColorStop(1,css([92,66,52],.4*town));
   ctx.fillStyle=c;ctx.fillRect(0,bottom*.5,width,bottom*.5);
  }
 }
 function drawStars(p,time){
  const alt=p.sun.altitude,s=state.scene;
  const alpha=smooth(-5,-14,alt)*Math.pow(1-clamp(s.cover),1.6)*(1-s.fog);
  if(alpha<.02)return;
  const bottom=skyBottom();
  ctx.fillStyle='#eef3ff';
  for(const star of stars){
   const twinkle=reducedMotion?1:.75+.25*Math.sin(time/1000*star.rate+star.phase);
   ctx.globalAlpha=alpha*star.bright*twinkle*(1-smooth(.7,1,star.y));
   ctx.fillRect(star.x,star.y*bottom*.95,star.size,star.size);
  }
  ctx.globalAlpha=1;
 }
 function drawMoon(p){
  if(!celestialVisible)return;
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
  if(!celestialVisible)return;
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
  // The photographic foreground is the final terrain mask. Its genuine alpha
  // holes can extend below the astronomical horizon, so cloud colour must not
  // stop along an arbitrary horizontal line inside those holes.
  const s=state.scene,bottom=landscape?skyBottom():height,cover=clamp(s.cover);
  if(cover<.015)return;
  buildClouds();
  // Viewer faces south: east is screen-left. Wind blows from windDir.
  const drift=Math.sin(s.windDir*RAD)*(4+s.wind*.6)*timeScale;
  // In the opt-in park view north/south winds move clouds through depth. Their
  // screen motion must not vanish merely because lateral drift is zero.
  const depthDrift=cloudDepthMotion?Math.cos(s.windDir*RAD)*(3+s.wind*.45)*timeScale:0;
  a.clearRect(0,0,width,bottom);
  const deckAlpha=smooth(.55,.95,cover);
  if(deckAlpha>.01){
   if(!reducedMotion)deckOffset=(deckOffset+drift*.4*dt/1000)%(width*1.2);
   if(!reducedMotion)deckDepthOffset+=depthDrift*.35*dt/1000;
   a.globalAlpha=deckAlpha;
   const tile=Math.max(width*1.2,400);
   const depthY=cloudDepthMotion?Math.sin(deckDepthOffset/Math.max(1,bottom)*Math.PI)*bottom*.12:0;
   for(let x=(deckOffset%tile+tile)%tile-tile;x<width;x+=tile)a.drawImage(deck,x,cloudDepthMotion?-bottom*.16+depthY:0,tile,cloudDepthMotion?bottom*1.32:bottom);
   a.globalAlpha=1;
  }
  const visibleShare=clamp(cover*1.25);
  BANDS.forEach((band,bi)=>{
   for(const cloud of clouds[bi]){
    const alpha=smooth(cloud.threshold-.08,cloud.threshold+.04,visibleShare)*(1-deckAlpha*(detailedClouds?.97:.62));
    if(alpha<.01)continue;
    if(!reducedMotion)cloud.x=((cloud.x+drift*band.speed*dt/1000/width/2)%1+1)%1;
    if(cloudDepthMotion&&!reducedMotion)cloud.depth=((cloud.depth+depthDrift*band.speed*dt/1000/Math.max(1,bottom))%1+1)%1;
    const reference=Math.max(width,bottom*1.7),sprite=cloud.sprite;
    const depthScale=cloudDepthMotion?1.12-cloud.depth*.30:1;
    const cloudSquash=detailedClouds?[.65,.88,1.02][bi]:band.squash;
    const grow=.8+cover*.55,w=reference*cloud.size*grow*cloud.stretch*depthScale,h=w*sprite.height/sprite.width*cloudSquash;
    const cloudY=cloudDepthMotion?lerp(band.top,band.bottom,cloud.depth):cloud.y;
    const span=width+w*2,x=cloud.x*span-w,y=cloudY*bottom-h*sprite.base/sprite.height;
    const depthFade=cloudDepthMotion?smooth(0,.08,cloud.depth)*(1-smooth(.92,1,cloud.depth)):1;
    a.globalAlpha=alpha*(bi===0?.92:1)*depthFade;
    a.drawImage(sprite.canvas,x,y,w,h);
   }
  });
  a.globalAlpha=1;
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
 }
 function drawPrecipitation(p,dt){
  const s=state.scene,alt=p.sun.altitude,low=height;
  const lean=Math.sin(s.windDir*RAD)*clamp(s.wind/30,0,.6);
  if(s.rain>.01){
   const count=Math.round(drops.length*clamp(s.rain)),day=smooth(-6,8,alt);
   ctx.strokeStyle=css(mix([150,166,196],[226,234,244],day),.22+.34*s.rain);ctx.lineWidth=1;ctx.beginPath();
   const fall=dt/1000*1.6*(timeScale>1?1.4:1);
   for(let i=0;i<count;i++){
    const drop=drops[i];
    if(!reducedMotion){drop.y+=fall*drop.speed;if(drop.y>1.05){drop.y-=1.1;drop.x=(drop.x+.37)%1;}}
    const x=drop.x*width,y=drop.y*low,length=(10+14*s.rain)*drop.length;
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
    const x=f.x*width+Math.sin(f.sway)*6+lean*f.y*30,y=f.y*low;
    ctx.beginPath();ctx.arc(x,y,f.size,0,Math.PI*2);ctx.fill();
   }
  }
 }
 function drawLand(p){
  const horizon=skyBottom(),s=state.scene,alt=p.sun.altitude;
  const month=new Date(state.time).getUTCMonth()+1,scale=Math.min(2,dpr);
  if(!land||land.width!==width||land.height!==height||land.month!==month||land.terrain!==location.terrain){
   land={width,height,month,terrain:location.terrain,...paintLandscape(width,height,horizon,maxTree(),month,location.terrain,scale)};
   landLayer.width=land.canvas.width;landLayer.height=land.canvas.height;
  }
  // Light the landscape: daylight as painted, warm at sunrise and sunset,
  // greyer under heavy cloud, deep blue at night, washed out in fog.
  l.globalCompositeOperation='source-over';l.clearRect(0,0,landLayer.width,landLayer.height);
  l.drawImage(land.canvas,0,0);
  l.globalCompositeOperation='source-atop';
  const day=smooth(-7,8,alt),warm=smooth(-3,1,alt)*(1-smooth(6,15,alt)),gloom=clamp(.34*s.dark+.16*smooth(.6,1,s.cover));
  const tints=[[[14,24,52],.8*(1-day)],[[255,150,74],.2*warm],[[74,84,98],gloom*day],[mix(p.cloudShade,p.cloudLit,.6),.55*s.fog]];
  for(const [color,alpha] of tints)if(alpha>.01){l.fillStyle=css(color,alpha);l.fillRect(0,0,landLayer.width,landLayer.height);}
  if(s.snow>.3){l.fillStyle=css([248,250,255],.45*smooth(.3,.8,s.snow));l.fillRect(0,Math.round((horizon-land.top)*scale),landLayer.width,landLayer.height);}
  l.globalCompositeOperation='source-over';
  ctx.drawImage(landLayer,0,land.top,width,height-land.top);
 }
 // Fog sits on the ground: thickest at the horizon, thinning toward the zenith.
 function drawFog(p){
  const s=state.scene;if(s.fog<.02)return;
  const horizon=skyBottom(),day=smooth(-6,6,p.sun.altitude);
  const tint=mix(mix([70,80,100],[214,220,226],day),p.cloudLit,.35),strong=.18+.62*s.fog*s.fog;
  const g=ctx.createLinearGradient(0,0,0,height);
  g.addColorStop(0,css(tint,strong*.35));
  g.addColorStop(clamp((horizon-maxTree()*1.4)/height),css(tint,strong*.7));
  g.addColorStop(clamp(horizon/height),css(tint,strong));
  g.addColorStop(1,css(tint,strong*.75));
  ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
 }
 function render(dt,time=performance.now()){
  if(!width||!height)return;
  const p=palette();
  drawSky(p);drawStars(p,time);drawMoon(p);drawSun(p);drawClouds(p,dt);drawWeather(p,dt,time);
  if(landscape)drawLand(p);
  drawFog(p);
  if(precipitation)drawPrecipitation(p,dt);
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
  if(externalAnimation){render(0);return;}
  if(reducedMotion){render(0);return;}
  if(running)return;running=true;last=0;frame=requestAnimationFrame(loop);
 }
 function stop(){running=false;cancelAnimationFrame(frame);}
 function setVisible(value){visible=value;if(visible&&!running&&!reducedMotion&&!externalAnimation)start();}
 return {resize,setLocation,setState,setTimeScale:value=>{timeScale=finite(value)&&value>0?value:1;},start,stop,setVisible,render:()=>render(0),
  renderFrame:(dt=0,time=performance.now())=>{if(visible)render(reducedMotion?0:dt,reducedMotion?0:time);},
  setCelestialVisible:value=>{celestialVisible=!!value;if(!running&&!externalAnimation)render(0);},
  setCloudAtlas:value=>{if(!value?.image||!Array.isArray(value.rects)||!value.rects.length)return;cloudAtlas=value;clouds=null;deck=null;if(!running&&!externalAnimation)render(0);},
  get treeHeight(){return maxTree();},get groundHeight(){return grass();},
  get reducedMotion(){return reducedMotion;},set reducedMotion(value){reducedMotion=!!value;if(reducedMotion)stop();else if(!externalAnimation)start();render(0);}};
}
