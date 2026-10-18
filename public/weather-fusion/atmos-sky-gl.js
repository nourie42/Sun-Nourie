/* Atmos sky on the graphics chip. Every pixel is worked out from the sun's and the
 * moon's real positions (the same ones the words beside the sky quote):
 * a single-scattering atmosphere with ozone absorption gives the blue day, the warm
 * sunset and the blue hour; the clouds sit on a plane whose share of the sky is the
 * forecast's cover;
 * the sun and moon discs, stars, treeline, fog, rain, snow and thunder follow the
 * displayed condition. atmos-sky.js falls back to the painted canvas sky where
 * WebGL is not available. */
import {rng} from './atmos-sky-paint.js?v=atmos-v6';

export const CLOUD_TILE=256;

/* A periodic cloud field: four octaves of value noise, softened, then ranked to
 * 0..255. Thresholding the rank at 1 - cover therefore covers exactly that share
 * of the sky, whatever the noise looks like. */
export function cloudRanks(seed=7,n=CLOUD_TILE){
 const random=rng(seed),field=new Float32Array(n*n);
 for(const [cells,weight] of [[8,.5],[16,.27],[32,.14],[64,.07]]){
  const lattice=new Float32Array(cells*cells);
  for(let i=0;i<lattice.length;i++)lattice[i]=random();
  for(let y=0;y<n;y++){
   const gy=y*cells/n,y0=Math.floor(gy),fy=gy-y0,sy=fy*fy*(3-2*fy),ya=(y0%cells)*cells,yb=((y0+1)%cells)*cells;
   for(let x=0;x<n;x++){
    const gx=x*cells/n,x0=Math.floor(gx),fx=gx-x0,sx=fx*fx*(3-2*fx),xa=x0%cells,xb=(x0+1)%cells;
    const top=lattice[ya+xa]*(1-sx)+lattice[ya+xb]*sx,bottom=lattice[yb+xa]*(1-sx)+lattice[yb+xb]*sx;
    field[y*n+x]+=weight*(top*(1-sy)+bottom*sy);
   }
  }
 }
 const soft=new Float32Array(n*n);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)soft[y*n+x]=(field[y*n+(x+n-1)%n]+field[y*n+x]+field[y*n+(x+1)%n])/3;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)field[y*n+x]=(soft[((y+n-1)%n)*n+x]+soft[y*n+x]+soft[((y+1)%n)*n+x])/3;
 const order=Array.from(field.keys()).sort((a,b)=>field[a]-field[b]),ranks=new Uint8Array(n*n);
 for(let r=0;r<order.length;r++)ranks[order[r]]=Math.round(255*r/(order.length-1));
 return ranks;
}

const UNIFORMS=['uSize','uDpr','uHorizon','uSunDir','uSunAlt','uSunPx','uSunR','uSunShow','uMoonDir','uMoonPx','uMoonShow','uMoonFrac','uMoonWaxing','uCover','uRain','uSnow','uFog','uHaze','uDark','uStorm','uWind','uLean','uTime','uFlash','uFlashPx','uCloud'];

function compile(gl,type,source){
 const shader=gl.createShader(type);
 gl.shaderSource(shader,source);gl.compileShader(shader);
 if(gl.getShaderParameter(shader,gl.COMPILE_STATUS))return shader;
 console.warn(gl.getShaderInfoLog(shader));
 return null;
}

/* A scratch canvas proves the shaders compile and link before the page's own canvas
 * is given a WebGL context, because a canvas that has one cannot fall back to 2D. */
function graphicsChipWorks(){
 try{
  const probe=document.createElement('canvas'),gl=probe.getContext('webgl');
  if(!gl)return false;
  const vertex=compile(gl,gl.VERTEX_SHADER,VERT),fragment=compile(gl,gl.FRAGMENT_SHADER,FRAG);
  if(!vertex||!fragment)return false;
  const program=gl.createProgram();
  gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
  const linked=!!gl.getProgramParameter(program,gl.LINK_STATUS);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return linked;
 }catch(error){return false;}
}

/* Returns null when WebGL or the shader is unavailable, so the caller can fall back. */
export function createGlPainter(canvas){
 if(!graphicsChipWorks())return null;
 let gl=null;
 try{gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false});}catch(error){gl=null;}
 if(!gl)return null;
 const vertex=compile(gl,gl.VERTEX_SHADER,VERT),fragment=compile(gl,gl.FRAGMENT_SHADER,FRAG);
 if(!vertex||!fragment)return null;
 const program=gl.createProgram();
 gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS)){console.warn(gl.getProgramInfoLog(program));return null;}
 gl.useProgram(program);
 const buffer=gl.createBuffer();
 gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const aPos=gl.getAttribLocation(program,'aPos');
 gl.enableVertexAttribArray(aPos);gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,CLOUD_TILE,CLOUD_TILE,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,cloudRanks(7,CLOUD_TILE));
 const U={};
 for(const name of UNIFORMS)U[name]=gl.getUniformLocation(program,name);
 gl.uniform1i(U.uCloud,0);
 let width=1,height=1,ratio=1,horizon=1;
 return{
  resize(w,h,dpr,horizonY){
   width=w;height=h;ratio=dpr;horizon=horizonY;
   canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));
   gl.viewport(0,0,canvas.width,canvas.height);
  },
  draw(f){
   gl.uniform2f(U.uSize,width,height);gl.uniform1f(U.uDpr,ratio);gl.uniform1f(U.uHorizon,horizon);
   gl.uniform3fv(U.uSunDir,f.sunDir);gl.uniform1f(U.uSunAlt,f.sunAlt);gl.uniform2fv(U.uSunPx,f.sunPx);gl.uniform1f(U.uSunR,f.sunR);gl.uniform1f(U.uSunShow,f.sunShow);
   gl.uniform3fv(U.uMoonDir,f.moonDir);gl.uniform2fv(U.uMoonPx,f.moonPx);gl.uniform1f(U.uMoonShow,f.moonShow);gl.uniform1f(U.uMoonFrac,f.moonFrac);gl.uniform1f(U.uMoonWaxing,f.moonWaxing);
   gl.uniform1f(U.uCover,f.cover);gl.uniform1f(U.uRain,f.rain);gl.uniform1f(U.uSnow,f.snow);gl.uniform1f(U.uFog,f.fog);gl.uniform1f(U.uHaze,f.haze);gl.uniform1f(U.uDark,f.dark);gl.uniform1f(U.uStorm,f.storm);
   gl.uniform2fv(U.uWind,f.wind);gl.uniform1f(U.uLean,f.lean);gl.uniform1f(U.uTime,f.time);gl.uniform1f(U.uFlash,f.flash);gl.uniform2fv(U.uFlashPx,f.flashPx);
   gl.drawArrays(gl.TRIANGLES,0,3);
  }
 };
}

const VERT=`attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG=`#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uSize;
uniform float uDpr;
uniform float uHorizon;
uniform vec3 uSunDir;
uniform float uSunAlt;
uniform vec2 uSunPx;
uniform float uSunR;
uniform float uSunShow;
uniform vec3 uMoonDir;
uniform vec2 uMoonPx;
uniform float uMoonShow;
uniform float uMoonFrac;
uniform float uMoonWaxing;
uniform float uCover;
uniform float uRain;
uniform float uSnow;
uniform float uFog;
uniform float uHaze;
uniform float uDark;
uniform float uStorm;
uniform vec2 uWind;
uniform float uLean;
uniform float uTime;
uniform float uFlash;
uniform vec2 uFlashPx;
uniform sampler2D uCloud;

const float RG = 6360.0;
const float RA = 6420.0;
const float HR = 8.0;
const float HM = 1.2;
const vec3 BETA_R = vec3(0.0058, 0.0135, 0.0331);
const float BETA_M = 0.006;
const float SUN_I = 20.0;
const float PERIOD = 6.0;
const float CLOUD_BASE = 1.6;
const vec3 OZONE = vec3(0.0011, 0.0019, 0.00022);

float ozone(float h) { return max(0.0, 1.0 - abs(h - 25.0) / 15.0); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2(i, 0.0)), hash(vec2(i + 1.0, 0.0)), f);
}

float fbm1(float x) {
  return 0.55 * noise1(x) + 0.3 * noise1(x * 2.03 + 11.0) + 0.15 * noise1(x * 4.07 + 5.0);
}

bool raySphere(vec3 o, vec3 d, float r, out float t0, out float t1) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  t0 = 0.0;
  t1 = -1.0;
  if (disc < 0.0) return false;
  float s = sqrt(disc);
  t0 = -b - s;
  t1 = -b + s;
  return true;
}

vec3 sunTransmittance(vec3 o, vec3 sd) {
  float g0, g1, t0, t1;
  if (raySphere(o, sd, RG, g0, g1) && g0 > 0.0) return vec3(0.0);
  raySphere(o, sd, RA, t0, t1);
  float seg = max(t1, 0.0) / 8.0;
  float odR = 0.0;
  float odM = 0.0;
  float odO = 0.0;
  float tc = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 p = o + sd * (tc + seg * 0.5);
    float h = max(length(p) - RG, 0.0);
    odR += exp(-h / HR) * seg;
    odM += exp(-h / HM) * seg;
    odO += ozone(h) * seg;
    tc += seg;
  }
  return exp(-(BETA_R * odR + BETA_M * 1.1 * odM + OZONE * odO));
}

vec3 skyRadiance(vec3 o, vec3 d, vec3 sd) {
  float t0, t1, g0, g1;
  if (!raySphere(o, d, RA, t0, t1) || t1 < 0.0) return vec3(0.0);
  float tmin = max(t0, 0.0);
  float tmax = t1;
  if (raySphere(o, d, RG, g0, g1) && g0 > 0.0) tmax = min(tmax, g0);
  if (tmax <= tmin) return vec3(0.0);
  float seg = (tmax - tmin) / 12.0;
  float mu = dot(d, sd);
  float g = 0.76;
  float phR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
  float phM = 3.0 / (8.0 * 3.14159) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  float odO = 0.0;
  float tc = tmin;
  for (int i = 0; i < 12; i++) {
    vec3 p = o + d * (tc + seg * 0.5);
    float h = max(length(p) - RG, 0.0);
    float hr = exp(-h / HR) * seg;
    float hm = exp(-h / HM) * seg;
    odR += hr;
    odM += hm;
    odO += ozone(h) * seg;
    float lg0, lg1, l0, l1;
    bool sunlit = !(raySphere(p, sd, RG, lg0, lg1) && lg0 > 0.0);
    if (sunlit) {
      raySphere(p, sd, RA, l0, l1);
      float segL = max(l1, 0.0) / 5.0;
      float odRL = 0.0;
      float odML = 0.0;
      float odOL = 0.0;
      float tcl = 0.0;
      for (int j = 0; j < 5; j++) {
        vec3 pl = p + sd * (tcl + segL * 0.5);
        float hl = max(length(pl) - RG, 0.0);
        odRL += exp(-hl / HR) * segL;
        odML += exp(-hl / HM) * segL;
        odOL += ozone(hl) * segL;
        tcl += segL;
      }
      vec3 att = exp(-(BETA_R * (odR + odRL) + BETA_M * 1.1 * (odM + odML) + OZONE * (odO + odOL)));
      sumR += att * hr;
      sumM += att * hm;
    }
    tc += seg;
  }
  return (sumR * BETA_R * phR + sumM * BETA_M * phM) * SUN_I;
}

/* The base rank sets the cloud shapes and their share. The two finer samples only
 * ragged the edges, with zero mean, so the share the threshold gives is kept. */
float cloudRank(vec2 uv) {
  float r1 = texture2D(uCloud, uv).r;
  float r2 = texture2D(uCloud, uv * 3.7 + vec2(0.31, 0.17)).r;
  float r3 = texture2D(uCloud, uv * 9.1 + vec2(0.57, 0.83)).r;
  return r1 + 0.16 * (r2 - 0.5) + 0.07 * (r3 - 0.5);
}

float cloudDensity(float r) {
  if (uCover < 0.01) return 0.0;
  float thr = 1.0 - uCover;
  return max(smoothstep(thr - 0.06, thr + 0.06, r), smoothstep(0.96, 0.99, uCover));
}

vec2 planeUv(vec3 d) {
  float t = CLOUD_BASE / d.y;
  return (d.xz * t - uWind) / PERIOD;
}

float densityToward(vec3 d) {
  if (d.y < 0.004) return 0.0;
  return cloudDensity(cloudRank(planeUv(d)));
}

float rainLayer(vec2 p, float layer, float scale) {
  float colW = 9.0 * scale;
  float c = floor(p.x / colW);
  float h = hash(vec2(c, layer));
  if (h > uRain) return 0.0;
  float speed = (150.0 + 70.0 * h) * scale;
  float period = uSize.y + 80.0 * scale;
  float y0 = mod(h * 977.0 * scale + uTime * speed, period) - 40.0 * scale;
  float len = (14.0 + 10.0 * fract(h * 7.13)) * scale;
  if (p.y > y0 || p.y < y0 - len) return 0.0;
  float xc = (c + 0.25 + 0.5 * fract(h * 31.7)) * colW;
  float xs = xc + uLean * (p.y - y0);
  float dx = abs(p.x - xs);
  return smoothstep(0.9 * scale, 0.0, dx) * (0.5 + 0.5 * h) * (1.0 - 0.5 * (y0 - p.y) / len);
}

float snowLayer(vec2 p, float layer, float scale) {
  float cell = 16.0 * scale;
  float cx = floor(p.x / cell);
  float h = hash(vec2(cx, layer));
  if (h > uSnow) return 0.0;
  float speed = (10.0 + 14.0 * fract(h * 13.1)) * scale;
  float period = uSize.y + 24.0;
  float yy = mod(fract(h * 41.7) * period + uTime * speed, period) - 12.0;
  float xx = (cx + 0.5) * cell + 4.0 * sin(uTime * 0.8 + h * 20.0) + uLean * yy * 0.5;
  return smoothstep(1.5 * scale, 0.3 * scale, length(vec2(p.x - xx, p.y - yy)));
}

void main() {
  vec2 px = vec2(gl_FragCoord.x / uDpr, uSize.y - gl_FragCoord.y / uDpr);
  vec3 o = vec3(0.0, RG + 0.001, 0.0);
  float altDeg = 90.0 * (1.0 - px.y / uHorizon);
  float az = radians(75.0 + 210.0 * clamp(px.x / uSize.x, 0.0, 1.0));
  float alt = radians(altDeg);
  vec3 d = vec3(sin(az) * cos(alt), sin(alt), cos(az) * cos(alt));
  float dayF = smoothstep(-6.0, 6.0, uSunAlt);
  float nightF = 1.0 - smoothstep(-12.0, -5.0, uSunAlt);
  vec3 sunT = sunTransmittance(o, uSunDir);
  vec3 L = skyRadiance(o, d, uSunDir);

  float hz = uHaze * exp(-max(altDeg, 0.0) / 6.0) * 0.35;
  if (hz > 0.002) {
    vec3 zenHaze = skyRadiance(o, vec3(0.0, 1.0, 0.0), uSunDir);
    L = mix(L, (zenHaze * 1.1 + vec3(0.01)) * (0.7 + 0.3 * dayF), hz);
  }

  float cloudA = 0.0;
  vec3 cloudC = vec3(0.0);
  if (d.y > 0.004) {
    vec2 uv = planeUv(d);
    float r = cloudRank(uv);
    float dens = cloudDensity(r);
    if (dens > 0.001) {
      float dist = CLOUD_BASE / d.y;
      vec3 zen = skyRadiance(o, vec3(0.0, 1.0, 0.0), uSunDir);
      vec2 sdxz = uSunDir.xz / max(length(uSunDir.xz), 0.0001);
      float occ = cloudDensity(cloudRank(uv + sdxz * 0.04));
      float thick = clamp((r - (1.0 - uCover)) / 0.35, 0.0, 1.0);
      float shade = (1.0 - 0.45 * occ) * (1.0 - 0.3 * thick);
      float sunUp = smoothstep(-3.0, 4.0, uSunAlt);
      vec3 ambient = zen * 0.9 + vec3(0.012, 0.016, 0.024) * (1.0 - 0.5 * sunUp);
      vec3 sunLight = sunT * SUN_I * 0.045 * sunUp;
      float mu = max(dot(d, uSunDir), 0.0);
      vec3 lit = ambient * (0.8 + 0.2 * shade) + sunLight * shade;
      lit += sunT * SUN_I * 0.05 * pow(mu, 8.0) * dens * sunUp;
      lit *= mix(1.0, 0.6, smoothstep(0.55, 1.0, uCover));
      float aerial = 1.0 - exp(-dist / 40.0);
      cloudC = mix(lit, L, aerial);
      cloudA = dens;
    }
  }
  L = mix(L, cloudC, cloudA);

  float sunVis = uSunShow * (1.0 - nightF);
  if (sunVis > 0.0) {
    float ds = length(px - uSunPx) / uSunR;
    float sunCloud = densityToward(uSunDir);
    float veil = (1.0 - sunCloud) * (1.0 - sunCloud) * (1.0 - 0.5 * smoothstep(0.45, 0.95, uCover));
    float disc = smoothstep(1.0, 0.75, ds);
    float glow = exp(-ds * ds * 0.9) * 0.45 + exp(-ds * 0.5) * 0.04;
    L += sunT * SUN_I * (disc * 60.0 + glow * 0.9) * veil * sunVis;
  }

  vec3 col = vec3(1.0) - exp(-L * 1.25);
  col += vec3(0.01, 0.016, 0.04) * (1.0 - smoothstep(-16.0, -4.0, uSunAlt)) * (1.0 - cloudA * 0.6);

  if (uMoonShow > 0.5) {
    float rm = uSunR * 0.85;
    vec2 dm = (px - uMoonPx) / rm;
    float rr = length(dm);
    float disc = smoothstep(1.0, 0.96, rr);
    float side = uMoonWaxing > 0.5 ? 1.0 : -1.0;
    float sq = sqrt(max(0.0, 1.0 - dm.y * dm.y));
    float tt = 2.0 * uMoonFrac - 1.0;
    float litM = smoothstep(-0.04, 0.04, dm.x * side + tt * sq);
    vec3 moonCol = mix(vec3(0.05, 0.06, 0.09), vec3(0.9, 0.92, 0.95) * (0.92 + 0.08 * (1.0 - rr * rr)), litM);
    float moonAlpha = disc * (1.0 - 0.75 * smoothstep(-8.0, 2.0, uSunAlt)) * (1.0 - 0.9 * smoothstep(0.45, 0.95, uCover)) * (1.0 - 0.95 * densityToward(uMoonDir));
    col = mix(col, moonCol, moonAlpha);
    col += vec3(0.07, 0.08, 0.1) * exp(-rr * rr * 0.12) * (1.0 - smoothstep(-8.0, 2.0, uSunAlt)) * (1.0 - 0.8 * uCover) * 0.5 * (1.0 - disc);
  }

  float starAmt = nightF * (1.0 - 0.9 * smoothstep(0.25, 0.9, uCover)) * (1.0 - cloudA);
  if (starAmt > 0.01) {
    vec2 cell = floor(px / 7.0);
    float h = hash(cell + 13.7);
    if (h > 0.9) {
      vec2 c = (cell + vec2(hash(cell + 3.1), hash(cell + 7.9))) * 7.0;
      float dd = length(px - c);
      float tw = 0.75 + 0.25 * sin(uTime * (1.0 + 2.0 * h) + h * 50.0);
      float b = smoothstep(1.3, 0.0, dd) * (0.35 + 0.65 * (h - 0.9) / 0.1) * tw;
      col += vec3(0.85, 0.9, 1.0) * b * starAmt;
    }
  }

  if (px.y > uHorizon) {
    float depth = (px.y - uHorizon) / max(uSize.y - uHorizon, 1.0);
    vec3 lawn = mix(vec3(0.02, 0.035, 0.02), vec3(0.16, 0.27, 0.11), dayF);
    col = lawn * (1.0 - 0.4 * depth) * (0.85 + 0.15 * noise1(px.x * 0.4 + px.y * 0.9));
  } else {
    float farTop = uHorizon - (9.0 + 22.0 * fbm1(px.x * 0.028 + 2.0) + 6.0 * noise1(px.x * 0.19));
    float nearTop = uHorizon - (3.0 + 15.0 * fbm1(px.x * 0.045 + 9.0) + 4.0 * noise1(px.x * 0.31 + 3.0));
    vec3 farC = mix(vec3(0.012, 0.02, 0.03), vec3(0.14, 0.24, 0.16), dayF);
    vec3 nearC = mix(vec3(0.006, 0.012, 0.012), vec3(0.06, 0.15, 0.08), dayF);
    farC = mix(farC, col, 0.45);
    if (px.y >= farTop) col = farC;
    if (px.y >= nearTop) col = nearC * (0.85 + 0.3 * noise1(px.x * 0.9 + px.y * 0.4));
  }

  if (uFog > 0.01) {
    vec3 fogCol = mix(vec3(0.27, 0.32, 0.42), vec3(0.8, 0.84, 0.88), dayF);
    float fa = clamp((0.18 + 0.62 * uFog * uFog) * (0.35 + 0.65 * exp(-max(altDeg, 0.0) / 9.0)), 0.0, 0.92);
    col = mix(col, fogCol, fa);
  }
  col = mix(col, vec3(0.93, 0.95, 1.0), 0.18 * uSnow);
  col *= (1.0 - 0.5 * uDark) * (1.0 - 0.3 * uStorm);

  if (uRain > 0.01) {
    float ra = clamp(rainLayer(px, 1.0, 1.0) + 0.7 * rainLayer(px, 2.0, 0.7), 0.0, 1.0);
    col = mix(col, vec3(0.78, 0.82, 0.9), ra * (0.25 + 0.3 * uRain));
  }
  if (uSnow > 0.01) {
    float sf = clamp(snowLayer(px, 1.0, 1.0) + 0.6 * snowLayer(px, 2.0, 0.6), 0.0, 1.0);
    col = mix(col, vec3(0.97, 0.98, 1.0), sf * 0.9);
  }

  if (uFlash > 0.001) {
    float fd = length(px - uFlashPx) / (uSize.x * 0.45);
    col += vec3(0.8, 0.84, 1.0) * uFlash * (exp(-fd * fd * 3.0) * 0.5 + 0.06);
  }

  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);
}`;
