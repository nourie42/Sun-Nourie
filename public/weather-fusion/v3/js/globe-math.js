/* Geographic transforms and interpolation; no fallback or synthetic wind. */
const D=Math.PI/180;
export function globePosition(latitude,longitude,radius=1){const lat=latitude*D,lon=longitude*D;return [radius*Math.cos(lat)*Math.cos(lon),radius*Math.sin(lat),-radius*Math.cos(lat)*Math.sin(lon)];}
export function globeCoordinates([x,y,z]){const r=Math.hypot(x,y,z);return {latitude:Math.asin(y/r)/D,longitude:Math.atan2(-z,x)/D};}
export function sampleGlobeWind(grid,latitude,longitude){
 if(!grid?.vectors?.length||!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
 const y=(latitude-grid.lat0)/grid.dy;if(y<0||y>grid.ny-1)return null;
 const x=(((longitude-grid.lon0)/grid.dx)%grid.nx+grid.nx)%grid.nx,x0=Math.floor(x),y0=Math.floor(y),xf=x-x0,yf=y-y0;
 const corners=[[x0,y0,(1-xf)*(1-yf)],[(x0+1)%grid.nx,y0,xf*(1-yf)],[x0,Math.min(grid.ny-1,y0+1),(1-xf)*yf],[(x0+1)%grid.nx,Math.min(grid.ny-1,y0+1),xf*yf]];
 let u=0,v=0;for(const [col,row,w]of corners){if(w<1e-9)continue;const p=grid.vectors[row*grid.nx+col];if(!p?.every(Number.isFinite))return null;u+=p[0]*w;v+=p[1]*w;}return {u,v,speed:Math.hypot(u,v)};
}
export function windParticleCount(speed){return Number.isFinite(speed)&&speed>0?Math.min(22,Math.floor(speed*1.6)):0;}
export function advanceWind(point,wind,seconds){const latitude=point.latitude+wind.v*seconds/111320;return {latitude,longitude:((point.longitude+wind.u*seconds/(111320*Math.max(.12,Math.cos(point.latitude*D)))+540)%360)-180};}
export function subsolarPoint(now=Date.now()){
 const d=new Date(now),yearStart=Date.UTC(d.getUTCFullYear(),0,1),day=(now-yearStart)/86400000;
 const gamma=2*Math.PI/365*(day-1+(d.getUTCHours()-12)/24);
 const equation=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
 const declination=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
 const minutes=d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;
 return {latitude:declination/D,longitude:((180-(minutes+equation)/4+540)%360)-180};
}
