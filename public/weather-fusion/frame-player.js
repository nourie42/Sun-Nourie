/** Own all model overlays so rapid seeks and slow loads can never orphan a frame. */
export function createFramePlayer({map,makeImage,timeoutMs=20000}) {
  const owned=new Set();let visible=null,pending=null,generation=0;
  function remove(layer) {if(!layer)return;layer.off();map.removeLayer(layer);owned.delete(layer);}
  function abortPending() {
    if(!pending)return;
    const previous=pending;pending=null;clearTimeout(previous.timer);remove(previous.layer);previous.resolve(false);
  }
  function clear() {++generation;abortPending();for(const layer of [...owned])remove(layer);visible=null;}
  async function show(frame,options={},hooks={}) {
    const token=++generation;abortPending();
    return new Promise(resolve=>{
      let layer;
      try{layer=makeImage(frame.url,frame.bounds,{...options,opacity:0});}
      catch(error){hooks.error?.(error);resolve(false);return;}
      owned.add(layer);
      const request={layer,resolve,timer:null};pending=request;
      const fail=()=>{
        if(token!==generation)return;
        pending=null;clearTimeout(request.timer);remove(layer);
        // Remove the old image too; do not present it with the failed frame's time.
        for(const old of [...owned])remove(old);visible=null;
        hooks.error?.(new Error('Model frame failed to load'));resolve(false);
      };
      layer.on('load',()=>{
        if(token!==generation){remove(layer);resolve(false);return;}
        clearTimeout(request.timer);pending=null;
        for(const old of [...owned])if(old!==layer)remove(old);
        layer.setOpacity(1);visible=layer;
        const element=layer.getElement?.();
        if(element){element.dataset.weatherModelFrame='visible';element.dataset.frameTime=frame.time||'';element.dataset.frameUrl=frame.url;}
        hooks.loaded?.();resolve(true);
      });
      layer.on('error',fail);
      request.timer=setTimeout(fail,timeoutMs);
      try{layer.addTo(map);}catch{fail();}
    });
  }
  return {show,clear,get loading(){return !!pending;},get visible(){return visible;},get layerCount(){return owned.size;}};
}
