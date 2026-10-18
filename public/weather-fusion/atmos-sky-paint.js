/* Atmos sky painting: the forecast drawn as sky, with no photographs.
 *
 * Colour follows the sun's altitude, from day blue through a warm band at sunset
 * and the blue hour to night. Cloud cover is the share of the sky the clouds fill:
 * one fixed cloud field is cut at the rank that gives that share, so 30% cover fills
 * 30% of the sky, and the shapes drift with the wind. The sun and the moon are drawn
 * where the astronomy puts them, under any cloud, and the moon shows its real phase.
 * The treeline is pines and broadleaf trees, a paler far row and a near row. */

export const RAD=Math.PI/180;
export const CLOUD_W=640,CLOUD_H=280;
export const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export const mix=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
export const css=(c,a=1)=>`rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a).toFixed(3)})`;
export function rng(seed){let a=seed>>>0;return ()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const greyOf=c=>{const l=c[0]*.3+c[1]*.59+c[2]*.11;return [l,l,l*1.03];};

/* Azimuths from 75° (east, the left edge) to 285° (west, the right edge) fill the window; altitude sets the height. */
export const xOfAzimuth=az=>(((az%360)+360)%360-75)/210;
export const yOfAltitude=(alt,horizonY)=>horizonY*(1-clamp(alt,0,90)/90);

/* Sky colours by the sun's altitude: [altitude, zenith, horizon], from day down to night. */
const SKY=[
 [24,[40,96,176],[150,188,222]],
 [8,[58,118,196],[182,206,228]],
 [0,[74,100,162],[238,164,112]],
 [-4,[44,60,114],[226,118,88]],
 [-8,[24,34,78],[130,82,116]],
 [-12,[12,20,52],[44,56,98]],
 [-18,[6,11,32],[24,34,64]],
];
export function skyColours(alt){
 if(alt>=SKY[0][0])return {zenith:SKY[0][1],horizon:SKY[0][2]};
 for(let i=1;i<SKY.length;i++){
  const [a,z,h]=SKY[i];
  if(alt>=a){
   const [pa,pz,ph]=SKY[i-1],t=(alt-a)/(pa-a);
   return {zenith:mix(z,pz,t),horizon:mix(h,ph,t)};
  }
 }
 const last=SKY[SKY.length-1];
 return {zenith:last[1],horizon:last[2]};
}

/* The sky for this moment. Cloud greys the blue, a storm darkens it, fog pales it, and humid air whitens the horizon. */
export function skyPaint({alt=0,cover=0,storm=false,fog=0,haze=0,dark=0}={}){
 const k=skyColours(alt),night=1-smooth(-10,-4,alt),over=smooth(.5,1,cover);
 let z=mix(k.zenith,greyOf(k.zenith),.85*over),h=mix(k.horizon,greyOf(k.horizon),.7*over);
 const dim=clamp(.42*dark+(storm?.35:0),0,.6);
 z=mix(z,[28,34,48],dim);h=mix(h,[58,64,78],dim);
 const fogC=mix([198,206,216],[56,64,84],night);
 z=mix(z,fogC,.55*clamp(fog));h=mix(h,fogC,.85*clamp(fog));
 h=mix(h,[234,240,246],.3*clamp(haze)*(1-night));
 return {zenith:z,horizon:h};
}

/* The cloud field: fractal value noise that tiles across the sky (so it wraps with the wind) and is feathered
 * at the top and into the horizon haze. Each cell is replaced by its rank among all cells, so a cover fraction
 * picks exactly that share of the sky. */
export function cloudField(seed=7){
 const random=rng(seed);
 const bands=[[4,2,.5],[8,4,.3],[16,8,.14],[32,16,.06]].map(([px,py,amp])=>({px,py,amp,v:Float32Array.from({length:px*py},()=>random())}));
 const raw=new Float32Array(CLOUD_W*CLOUD_H);
 for(let y=0;y<CLOUD_H;y++){
  const feather=1-smooth(.66,1,y/CLOUD_H);
  for(let x=0;x<CLOUD_W;x++){
   let sum=0,norm=0;
   for(const b of bands){
    const u=x/CLOUD_W*b.px,v=y/CLOUD_H*b.py,x0=Math.floor(u),y0=Math.floor(v),fx=smooth(0,1,u-x0),fy=smooth(0,1,v-y0);
    const i0=((x0%b.px)+b.px)%b.px,i1=(i0+1)%b.px,j0=((y0%b.py)+b.py)%b.py,j1=(j0+1)%b.py;
    sum+=b.amp*lerp(lerp(b.v[j0*b.px+i0],b.v[j0*b.px+i1],fx),lerp(b.v[j1*b.px+i0],b.v[j1*b.px+i1],fx),fy);
    norm+=b.amp;
   }
   raw[y*CLOUD_W+x]=sum/norm*feather;
  }
 }
 const soft=blurField(raw,CLOUD_W,CLOUD_H,2),n=soft.length,sorted=Float32Array.from(soft).sort(),rank=new Float32Array(n);
 for(let i=0;i<n;i++){
  const v=soft[i];let lo=0,hi=n;
  while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<v)lo=m+1;else hi=m;}
  rank[i]=lo/n;
 }
 return rank;
}
/* A small box blur: wraps across the sky, clamps at the top and bottom, and softens the grid that the noise lattice would otherwise show. */
function blurField(src,w,h,r){
 const tmp=new Float32Array(w*h),out=new Float32Array(w*h),k=1/(2*r+1);
 for(let y=0;y<h;y++){
  let s=0;for(let x=-r;x<=r;x++)s+=src[y*w+((x%w)+w)%w];
  for(let x=0;x<w;x++){
   tmp[y*w+x]=s*k;
   s+=src[y*w+((x+r+1)%w+w)%w]-src[y*w+((x-r)%w+w)%w];
  }
 }
 for(let x=0;x<w;x++){
  let s=0;for(let y=-r;y<=r;y++)s+=tmp[clamp(y,0,h-1)*w+x];
  for(let y=0;y<h;y++){
   out[y*w+x]=s*k;
   s+=tmp[clamp(y+r+1,0,h-1)*w+x]-tmp[clamp(y-r,0,h-1)*w+x];
  }
 }
 return out;
}
/** The share of the field the clouds cover at this cover fraction (a cell is covered when its rank reaches 1 − cover). */
export function coverShare(rank,cover){
 let n=0;for(const r of rank)if(r>=1-cover)n++;
 return n/rank.length;
}

/* Cloud colour for the time of day: white by day, warm at sunset, grey under overcast or storm, and moonlit
 * slate after dark. */
function cloudTone(alt,storm,over){
 const day=smooth(-2,10,alt),dusk=smooth(-12,-3,alt)*(1-smooth(0,8,alt)),night=1-smooth(-9,-3,alt);
 let light=[255,255,250],shade=[150,162,186];
 light=mix(light,[255,198,150],dusk*.75);shade=mix(shade,[120,92,122],dusk*.6);
 light=mix(light,[182,188,200],over*day*.7);shade=mix(shade,[100,108,124],over*day*.8);
 light=mix(light,[72,84,112],night);shade=mix(shade,[12,18,36],night);
 const dim=storm?.6:1;
 return {light:light.map(v=>v*dim),shade:shade.map(v=>v*dim)};
}
/** A cloud texture for the field, repainted only when the cover, the light direction or the time of day changes. */
export function cloudTexture(rank){
 let canvas=null,g=null,image=null,key='';
 return {
  update(cover,light,alt,storm){
   if(!canvas){
    if(typeof document==='undefined')return null;
    canvas=document.createElement('canvas');canvas.width=CLOUD_W;canvas.height=CLOUD_H;
    g=canvas.getContext('2d');image=g.createImageData(CLOUD_W,CLOUD_H);
   }
   const k=[Math.round(cover*50),Math.round(light.x*6),Math.round(light.y*6),Math.round(alt/8),storm?1:0].join('|');
   if(k===key)return canvas;
   key=k;
   const d=image.data,on=cover<.02?0:1,over=smooth(.6,1,cover),tone=cloudTone(alt,storm,over),thr=1-clamp(cover);
   const ox=Math.round(clamp(light.x)*4),oy=Math.round(clamp(light.y)*4);
   const [lr,lg,lb]=tone.light,[sr,sg,sb]=tone.shade,dr=lr-sr,dg=lg-sg,db=lb-sb;
   for(let y=0;y<CLOUD_H;y++){
    const base=1-.2*smooth(.5,.95,y/CLOUD_H),ny=clamp(y-oy,0,CLOUD_H-1);
    for(let x=0;x<CLOUD_W;x++){
     const i=y*CLOUD_W+x,r=rank[i],a=on*smooth(thr-.05,thr+.05,r),c=i*4;
     if(a<=.003){d[c+3]=0;continue;}
     // A cell whose sunward neighbour is thinner sits on a lit edge; cover thins the contrast.
     const nx=(x+ox+CLOUD_W)%CLOUD_W,edge=clamp(.5+3.2*(r-rank[ny*CLOUD_W+nx])),t=lerp(.5,edge,1-.7*over);
     const depth=clamp((r-thr)/(1-thr+.001));
     d[c]=(sr+dr*t)*base;d[c+1]=(sg+dg*t)*base;d[c+2]=(sb+db*t)*base;d[c+3]=255*a*(.6+.4*depth)*.94;
    }
   }
   g.putImageData(image,0,0);
   return canvas;
  },
 };
}

/* Trees along the horizon: a far row, paler and lower, and a near row. Pines are tall with layered boughs;
 * broadleaf trees have rounded crowns. Shapes are fixed for a window size, so the treeline stays steady. */
export function treeSpecs(width,height,horizonY,seed=21){
 const random=rng(seed),specs=[];
 [[0,horizonY,.11,.19],[1,horizonY+height*.035,.17,.33]].forEach(([row,base,min,max])=>{
  let x=-width*.03;
  while(x<width*1.03){
   const pine=random()<.55,h=height*lerp(min,max,random()),w=pine?h*lerp(.2,.3,random()):h*lerp(.4,.56,random());
   specs.push({row,x,base,h,w,pine,j:Array.from({length:12},()=>.9+random()*.2)});
   x+=w*lerp(.3,.55,random());
  }
 });
 return specs;
}
function pinePath(ctx,t){
 const {x,base:b,h,w,j}=t,top=b-h;
 [[0,.56,.46],[.24,.8,.74],[.46,1,1]].forEach(([apex,bottom,half],k)=>{
  const ay=top+h*apex,by=top+h*bottom,hw=w/2*half;
  ctx.moveTo(x,ay);ctx.lineTo(x+hw*j[k],by);ctx.lineTo(x-hw*j[k+3],by);ctx.closePath();
 });
 ctx.rect(x-h*.02,b-h*.1,h*.04,h*.1);
}
function oakPath(ctx,t){
 const {x,base:b,h,w,j}=t,R=w/2,cy=b-h*.64;
 [[0,0,1],[-.5,.22,.72],[.5,.18,.76],[-.22,-.46,.68],[.26,-.4,.7]].forEach(([dx,dy,r],k)=>{
  const cx=x+dx*R*j[k],y=cy+dy*R*j[k+4],rad=R*r*j[k+6];
  ctx.moveTo(cx+rad,y);ctx.arc(cx,y,rad,0,Math.PI*2);
 });
 ctx.rect(x-R*.07,cy+R*.5,R*.14,b-cy-R*.5);
}
/** Tree and ground colours for the time of day: green by day, near black after dark; the far row takes on the haze. */
export function treePalette(alt,horizon,fog=0){
 const night=1-smooth(-9,-3,alt),hazeC=mix(horizon,[150,160,170],.5*clamp(fog));
 const near={pine:mix([24,58,48],[4,11,14],night),oak:mix([40,86,58],[6,14,17],night)};
 const far={pine:mix(near.pine,hazeC,.35),oak:mix(near.oak,hazeC,.35)};
 return {trees:[far,near],ground:[mix([44,74,54],[5,11,13],night),mix([28,50,38],[2,5,7],night)]};
}
export function drawTreeline(ctx,specs,{width,height,horizonY,colours}){
 const ground=ctx.createLinearGradient(0,horizonY,0,height);
 ground.addColorStop(0,css(colours.ground[0]));ground.addColorStop(1,css(colours.ground[1]));
 ctx.fillStyle=ground;ctx.fillRect(0,horizonY,width,height-horizonY);
 for(const t of specs){
  const tint=.92+.16*((t.j[3]-.9)/.2);
  ctx.fillStyle=css(colours.trees[t.row][t.pine?'pine':'oak'].map(c=>c*tint));
  ctx.beginPath();
  if(t.pine)pinePath(ctx,t);else oakPath(ctx,t);
  ctx.fill();
 }
}

export function starField(width,height,seed=5){
 const random=rng(seed);
 return Array.from({length:Math.round(clamp(width*.28,70,260))},()=>({x:random(),y:random()*.95,size:.5+random()*random()*1.4,phase:random()*6.283,rate:.6+random()*1.6}));
}

/* The sun: a soft disc with a glow, warmer near the horizon. Thin cloud veils it; thick cloud hides it. */
export function drawSun(ctx,x,y,r,{alt=40,veil=0}={}){
 const warm=1-smooth(6,24,alt),core=mix([255,246,214],[255,184,108],warm),a=1-.9*clamp(veil);
 const glow=ctx.createRadialGradient(x,y,0,x,y,r*8);
 glow.addColorStop(0,css(core,.5*a));glow.addColorStop(.18,css(core,.16*a));glow.addColorStop(1,css(core,0));
 ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,r*8,0,Math.PI*2);ctx.fill();
 const disc=ctx.createRadialGradient(x,y,0,x,y,r*1.1);
 disc.addColorStop(0,css([255,255,250],a));disc.addColorStop(.82,css(core,a));disc.addColorStop(1,css(core,0));
 ctx.fillStyle=disc;ctx.beginPath();ctx.arc(x,y,r*1.1,0,Math.PI*2);ctx.fill();
}

let moonSprite={key:'',canvas:null};
/* The moon with its real phase: a lit disc with the unlit part cut away, so the sky shows through the dark limb.
 * Waxing moons are lit on the right (west, from the viewer facing south); waning moons on the left. */
export function drawMoon(ctx,x,y,r,{phase=0,alpha=1}={}){
 const p=((phase%1)+1)%1,size=Math.ceil(r*2+6),key=`${Math.round(r*2)}|${Math.round(p*200)}`;
 if(moonSprite.key!==key){
  const c=document.createElement('canvas');c.width=size;c.height=size;
  const g=c.getContext('2d'),cx=size/2,f=(1-Math.cos(2*Math.PI*p))/2;
  const lit=g.createRadialGradient(cx-r*.35,cx-r*.35,r*.1,cx,cx,r);
  lit.addColorStop(0,'#fdfdf8');lit.addColorStop(1,'#d3dae6');
  g.fillStyle=lit;g.beginPath();g.arc(cx,cx,r,0,Math.PI*2);g.fill();
  g.globalCompositeOperation='destination-out';
  g.beginPath();g.arc(cx+(p<.5?-1:1)*2*r*f,cx,r*1.01,0,Math.PI*2);g.fill();
  moonSprite={key,canvas:c};
 }
 ctx.save();ctx.globalAlpha=clamp(alpha);
 ctx.drawImage(moonSprite.canvas,x-size/2,y-size/2);
 ctx.restore();
}
