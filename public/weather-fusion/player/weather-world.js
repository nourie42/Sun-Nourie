import {createSky} from '../atmos-sky.js?v=actual-world-v4';
import {selectPhotoScene,createLatestRequestGate} from './photo-scene.js?v=actual-world-v4';
import {CHARACTERS,normalizeCharacter,getCharacterScene,computeIntegratedSceneLayout} from './character-scene.js?v=actual-world-v4';
import {selectedHourSkyState,projectSelectedCelestial} from './selected-hour-sky.js?v=actual-world-v4';

// The changing sky is independent. Alpha artwork retains the person, trees,
// path and contact shadows together in separately authored lighting plates.
const clamp=(value,low=0,high=1)=>Math.max(low,Math.min(high,value));
const mix=(a,b,fraction)=>a+(b-a)*fraction;
const ease=fraction=>fraction*fraction*(3-2*fraction);
const fileURL=file=>new URL(file,import.meta.url).href;
const HORIZON=.475;
const CLOUD_FILE='../player-clouds-atlas.webp';
const cloudCell=index=>{
  const column=index%3,row=Math.floor(index/3),left=index===8?4:2,top=left;
  // The overcast tile begins a few pixels inside the adjacent cirrus/right
  // and cumulus/bottom cell boundaries. Crop only that atlas gutter; preserve
  // the other soft cloud edges and their translucent wisps in full.
  const right=index===7?10:left,bottom=index===5?10:top;
  return [(column*512+left)/1536,(row*1024/3+top)/1024,(512-left-right)/1536,(1024/3-top-bottom)/1024];
};

export async function createWeatherWorld(container,{onError,initialFrame={},initialOutfit={},initialCharacter='white'}={}){
  if(!container?.appendChild)throw new TypeError('A forecast scene container is required.');
  const gate=createLatestRequestGate(),images=new Map(),loadedImages=new Map();
  const motionPreference=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const canvas=document.createElement('canvas'),skyCanvas=document.createElement('canvas'),foreground=document.createElement('canvas'),plate=document.createElement('canvas');
  const context=canvas.getContext('2d',{alpha:false}),foregroundContext=foreground.getContext('2d'),plateContext=plate.getContext('2d');
  if(!context||!foregroundContext||!plateContext)throw new Error('This browser could not create the weather scene.');
  canvas.className='weather-world-canvas';canvas.setAttribute('aria-hidden','true');skyCanvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',display:'block'});
  Object.assign(skyCanvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',visibility:'hidden',pointerEvents:'none'});
  const pendingNote=document.createElement('span');pendingNote.setAttribute('role','status');pendingNote.hidden=true;
  Object.assign(pendingNote.style,{position:'absolute',left:'50%',bottom:'14px',transform:'translateX(-50%)',padding:'8px 12px',borderRadius:'14px',background:'#15334ac9',color:'#f1f8ff',font:'12px system-ui',whiteSpace:'nowrap',zIndex:'2'});
  container.append(skyCanvas,canvas,pendingNote);
  const sky=createSky(skyCanvas,{reducedMotion:!!motionPreference?.matches,landscape:false,precipitation:false,horizon:HORIZON,externalAnimation:true,cloudDepthMotion:true,detailedClouds:true});
  let frame=initialFrame,outfit=initialOutfit,character=normalizeCharacter(initialCharacter),selected=null;
  let active=null,previous=null,disposed=false,visible=true,playing=false,width=1,height=1,dpr=1,raf=0,last=0,elapsed=0,cloudsReady=false;
  let outfitBlend=1,skyBlend=1,skyDuration=300,lastSelectionAt=0;
  let targetSky=selectedHourSkyState(frame),fromSky=targetSky,renderedSky=targetSky;
  const random=(seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;})(40317);
  const drops=Array.from({length:300},()=>({x:random(),y:random(),depth:.25+random()*.75,speed:.65+random()*.7}));
  const flakes=Array.from({length:150},()=>({x:random(),y:random(),size:.7+random()*1.7,phase:random()*Math.PI*2,speed:.5+random()*.8}));

  function imageFor(file,priority='auto'){
    if(!file)throw new Error('The selected scene has no authored lighting artwork.');
    if(images.has(file))return images.get(file);
    const pending=new Promise((resolve,reject)=>{
      const image=new Image();image.decoding='async';image.fetchPriority=priority;
      image.onload=async()=>{try{await image.decode?.();}catch{}loadedImages.set(file,image);resolve(image);};
      image.onerror=()=>reject(new Error('The selected person’s weather scene could not load.'));image.src=fileURL(file);
    });
    images.set(file,pending);pending.catch(()=>{if(images.get(file)===pending)images.delete(file);});return pending;
  }
  function stateFor(spec){
    if(spec.skyAlpha!==true||!spec.dayFile||!spec.nightFile)throw new Error('The selected scene needs paired day and night foregrounds.');
    const day=loadedImages.get(spec.dayFile),night=loadedImages.get(spec.nightFile);return day&&night?{spec,day,night}:null;
  }
  async function ensureCloudArtwork(priority='auto'){
    if(cloudsReady)return;
    const image=await imageFor(CLOUD_FILE,priority);if(disposed)return;
    sky.setCloudAtlas({image,rects:Array.from({length:8},(_,index)=>cloudCell(index)),deckRect:cloudCell(8)});cloudsReady=true;
    container.dataset.cloudArtwork='photographic-alpha';
  }
  function sourceRect(state,lighting='day'){return (lighting==='night'?state.spec.nightRect:state.spec.dayRect)||state.spec.rect;}
  function layoutFor(state,lighting='day'){
    const image=lighting==='night'?state.night:state.day;
    return computeIntegratedSceneLayout({viewportWidth:width,viewportHeight:height,sourceWidth:image.naturalWidth,sourceHeight:image.naturalHeight,scene:{...state.spec,rect:sourceRect(state,lighting)}});
  }
  function paintSource(image,rect,layout,alpha=1,operation='source-over'){
    plateContext.globalCompositeOperation=operation;plateContext.globalAlpha=alpha;
    plateContext.drawImage(image,rect[0]*image.naturalWidth,rect[1]*image.naturalHeight,rect[2]*image.naturalWidth,rect[3]*image.naturalHeight,layout.left,layout.top,layout.imageWidth,layout.imageHeight);
  }
  function paintPlate(state,weight,nightAmount){
    if(!state||weight<=0)return;plateContext.clearRect(0,0,width,height);
    // Addition gives registered plates a true opacity crossfade; source-over
    // would incorrectly make their opaque ground translucent at twilight.
    paintSource(state.day,sourceRect(state),layoutFor(state),1-nightAmount);
    paintSource(state.night,sourceRect(state,'night'),layoutFor(state,'night'),nightAmount,'lighter');
    plateContext.globalAlpha=1;plateContext.globalCompositeOperation='source-over';
    foregroundContext.globalAlpha=weight;foregroundContext.globalCompositeOperation='lighter';
    foregroundContext.drawImage(plate,0,0,plate.width,plate.height,0,0,width,height);
  }
  function interpolateSky(fraction){
    if(fraction>=1||!fromSky||!targetSky)return targetSky;
    const f=ease(fraction),sameLocation=fromSky.location?.latitude===targetSky.location?.latitude&&fromSky.location?.longitude===targetSky.location?.longitude;
    const timestamp=sameLocation&&fromSky.time!==null&&targetSky.time!==null?mix(fromSky.time,targetSky.time,f):targetSky.time;
    const result=selectedHourSkyState({...frame,time:timestamp});
    for(const key of ['cover','rain','snow','fog','haze','dark','wind'])result.scene[key]=mix(fromSky.scene[key],targetSky.scene[key],f);
    const turn=((targetSky.scene.windDir-fromSky.scene.windDir+540)%360)-180;result.scene.windDir=(fromSky.scene.windDir+turn*f+360)%360;return result;
  }
  function updateDiagnostics(state){
    const astronomy=state.astronomy,sun=projectSelectedCelestial(astronomy?.sun,{width,height,horizon:HORIZON}),moon=projectSelectedCelestial(astronomy?.moon,{width,height,horizon:HORIZON});
    Object.assign(container.dataset,{renderMode:'forecast-canvas',skyEpoch:String(state.time??''),frameTime:String(frame.time||''),weatherSourceTime:String(frame.sourceTime||frame.time||''),
      celestialGeometryKnown:String(!!astronomy),sunAltitude:String(astronomy?.sun.altitude??''),sunAzimuth:String(astronomy?.sun.azimuth??''),moonAltitude:String(astronomy?.moon.altitude??''),moonAzimuth:String(astronomy?.moon.azimuth??''),moonPhase:String(astronomy?.moonLight.phase??''),
      sunScreen:JSON.stringify(sun),moonScreen:JSON.stringify(moon),skyCoverage:String(state.scene.cover),skyCloudBasis:state.cloudBasis,skyLighting:state.lighting,nightAmount:String(state.nightAmount),skyHorizon:String(HORIZON),
      sceneBlend:outfitBlend.toFixed(3),skyBlend:skyBlend.toFixed(3),ambientMotion:String(!motionPreference?.matches),forecastPlaying:String(playing)});
    if(active){const layout=layoutFor(active);Object.assign(container.dataset,{character:active.spec.character,characterPose:active.spec.pose||'shelter',photoScene:active.spec.key,sceneSource:active.spec.dayFile,
      resolvedDayScene:active.spec.dayFile,resolvedNightScene:active.spec.nightFile,integratedPhotograph:'true',authoredNightLighting:'true',skyAlpha:'true',subjectBounds:JSON.stringify(layout.subject),foregroundPose:active.spec.pose||'shelter',foregroundHeightRatio:String(active.spec.foregroundHeightRatio)});}
  }
  function advanceParticles(delta,state){
    if(motionPreference?.matches)return;const seconds=delta/1000,lean=Math.sin(state.scene.windDir*Math.PI/180)*clamp(state.scene.wind/35,0,.7);
    for(const drop of drops){drop.y=(drop.y+seconds*(.8+drop.depth*.9)*drop.speed)%1.12;drop.x=((drop.x+seconds*lean*.07)%1+1)%1;}
    for(const flake of flakes){flake.y=(flake.y+seconds*.065*flake.speed)%1.05;flake.phase+=seconds*.7;flake.x=((flake.x+seconds*lean*.025)%1+1)%1;}
  }
  function drawPrecipitation(state,near){
    const scene=state.scene,lean=Math.sin(scene.windDir*Math.PI/180)*clamp(scene.wind/32,0,.8);
    if(scene.rain>.01){
      const count=Math.round(drops.length*scene.rain);context.strokeStyle=state.nightAmount>.6?'rgba(192,213,238,.30)':'rgba(218,234,246,.46)';context.lineWidth=near?1.15:.65;context.beginPath();
      for(let i=0;i<count;i++){const drop=drops[i];if((drop.depth>.55)!==near)continue;const x=drop.x*width,y=drop.y*height,length=(8+18*scene.rain)*drop.depth;context.moveTo(x,y);context.lineTo(x+lean*length,y+length);}context.stroke();
    }
    if(scene.snow>.01){
      context.fillStyle=state.nightAmount>.6?'rgba(220,233,255,.85)':'rgba(252,254,255,.94)';
      for(let i=0;i<Math.round(flakes.length*scene.snow);i++){const flake=flakes[i];if((flake.size>1.45)!==near)continue;const x=flake.x*width+Math.sin(flake.phase)*5,y=flake.y*height;context.beginPath();context.arc(x,y,flake.size,0,Math.PI*2);context.fill();}
    }
  }
  function drawGroundFog(state){
    if(state.scene.fog<.02)return;const fog=context.createLinearGradient(0,height*.35,0,height),tint=state.nightAmount>.6?'99,116,143':'216,225,230';
    fog.addColorStop(0,`rgba(${tint},0)`);fog.addColorStop(.4,`rgba(${tint},${state.scene.fog*.25})`);fog.addColorStop(1,`rgba(${tint},${state.scene.fog*.54})`);context.fillStyle=fog;context.fillRect(0,0,width,height);
  }
  function requestRender(){if(!disposed&&visible&&!document.hidden&&!raf)raf=requestAnimationFrame(draw);}
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
  function draw(now){
    raf=0;if(disposed||!visible||document.hidden)return;const reduced=!!motionPreference?.matches;
    if(!reduced&&last&&now-last<30){requestRender();return;}const delta=last?Math.min(80,now-last):1000/30;last=now;if(!reduced)elapsed+=delta;
    outfitBlend=reduced?1:clamp(outfitBlend+delta/120);skyBlend=reduced?1:clamp(skyBlend+delta/skyDuration);renderedSky=interpolateSky(skyBlend);
    if(renderedSky.location)sky.setLocation(renderedSky.location.latitude,renderedSky.location.longitude);
    sky.setCelestialVisible(!!renderedSky.astronomy);sky.setState({time:renderedSky.time??0,scene:renderedSky.scene});sky.renderFrame(reduced?0:delta,reduced?0:elapsed);
    context.drawImage(skyCanvas,0,0,skyCanvas.width,skyCanvas.height,0,0,width,height);advanceParticles(delta,renderedSky);drawPrecipitation(renderedSky,false);
    foregroundContext.clearRect(0,0,width,height);
    if(outfitBlend<1&&previous&&previous.spec.key!==active?.spec.key)paintPlate(previous,1-ease(outfitBlend),renderedSky.nightAmount);
    paintPlate(active,outfitBlend<1&&previous?.spec.key!==active?.spec.key?ease(outfitBlend):1,renderedSky.nightAmount);
    foregroundContext.globalAlpha=1;foregroundContext.globalCompositeOperation='source-over';context.drawImage(foreground,0,0,foreground.width,foreground.height,0,0,width,height);
    drawGroundFog(renderedSky);drawPrecipitation(renderedSky,true);updateDiagnostics(renderedSky);if(outfitBlend>=1)previous=active;
    if(!reduced||outfitBlend<1||skyBlend<1)requestRender();
  }
  function resize(){
    if(disposed)return;const rect=container.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);dpr=Math.min(globalThis.devicePixelRatio||1,1.6);
    for(const [target,targetContext] of [[canvas,context],[foreground,foregroundContext],[plate,plateContext]]){target.width=Math.max(1,Math.round(width*dpr));target.height=Math.max(1,Math.round(height*dpr));targetContext.setTransform(dpr,0,0,dpr,0,0);targetContext.imageSmoothingEnabled=true;targetContext.imageSmoothingQuality='high';}
    sky.resize();requestRender();
  }
  function install(state,first=false){
    const changed=active?.spec.key!==state.spec.key;if(changed){previous=active||state;active=state;outfitBlend=first||motionPreference?.matches?1:0;}else active={...active,...state};
    if(first||motionPreference?.matches)previous=active;pendingNote.hidden=true;container.dataset.characterPending='';container.dataset.photoReady='true';container.dataset.characterReady='true';requestRender();
  }
  function requestScene(first=false){
    selected=getCharacterScene(character,selectPhotoScene(frame,outfit),frame);const token=gate.next(),ready=stateFor(selected);
    if(ready&&cloudsReady){install(ready,first);return Promise.resolve();}container.dataset.characterPending=character;pendingNote.textContent=`Preparing ${CHARACTERS.find(person=>person.id===character)?.name||'your person'}’s scene…`;pendingNote.hidden=first;
    return Promise.all([imageFor(selected.dayFile,first?'high':'auto'),imageFor(selected.nightFile,first?'high':'auto'),ensureCloudArtwork(first?'high':'auto')]).then(()=>{if(gate.isCurrent(token)&&!disposed)install(stateFor(selected),first);},error=>{if(gate.isCurrent(token)&&!disposed){pendingNote.hidden=true;container.dataset.characterPending='error';onError?.(error);throw error;}});
  }
  function setFrame(value={},clothing={}){
    if(disposed)return;frame=value;outfit=clothing;const selectedAt=performance.now(),interval=lastSelectionAt?selectedAt-lastSelectionAt:500;lastSelectionAt=selectedAt;
    fromSky=renderedSky;targetSky=selectedHourSkyState(frame);skyBlend=motionPreference?.matches?1:0;skyDuration=Math.max(35,Math.min(300,interval*.6));void requestScene().catch(()=>{});requestRender();
  }
  function setCharacter(value){if(disposed)return;const next=normalizeCharacter(value);if(next===character&&active)return;character=next;void requestScene().catch(()=>{});}
  function setPlaying(value){playing=!!value;container.dataset.forecastPlaying=String(playing);requestRender();}
  function onVisibility(){if(document.hidden)stop();else requestRender();}
  function onMotion(){stop();sky.reducedMotion=!!motionPreference?.matches;outfitBlend=1;skyBlend=1;requestRender();}
  const observer=globalThis.ResizeObserver?new ResizeObserver(resize):null;observer?.observe(container);if(!observer)globalThis.addEventListener('resize',resize);
  const intersection=globalThis.IntersectionObserver?new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;sky.setVisible(visible);if(visible)requestRender();else stop();},{rootMargin:'100px'}):null;
  intersection?.observe(container);document.addEventListener('visibilitychange',onVisibility);motionPreference?.addEventListener?.('change',onMotion);
  function dispose(){
    if(disposed)return;disposed=true;gate.dispose();stop();sky.stop();observer?.disconnect();intersection?.disconnect();document.removeEventListener('visibilitychange',onVisibility);motionPreference?.removeEventListener?.('change',onMotion);globalThis.removeEventListener('resize',resize);
    canvas.remove();skyCanvas.remove();pendingNote.remove();images.clear();loadedImages.clear();
  }
  resize();
  try{await requestScene(true);}catch(error){dispose();throw error;}
  return {setFrame,setCharacter,setPlaying,resize,dispose};
}
