// Bound both response headers and body reads; an abandoned mobile request must
// not leave Refresh disabled forever. Parent cancellation stays distinguishable.
export async function fetchJsonWithDeadline(url,{signal,timeoutMs=45000,fetchImpl=fetch,...options}={}){
 const controller=new AbortController();let timer,abort;
 const stopped=new Promise((_,reject)=>{
  abort=()=>{const reason=signal?.reason||new DOMException('Request cancelled','AbortError');controller.abort(reason);reject(reason);};
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{const error=new DOMException('Weather request timed out. Tap Refresh to retry, or search for a city.','TimeoutError');controller.abort(error);reject(error);},timeoutMs);
 });
 try{
  if(signal?.aborted)return await stopped;
  return await Promise.race([stopped,(async()=>{
   const response=await fetchImpl(url,{...options,signal:controller.signal});
   const data=await response.json();
   if(!response.ok)throw Object.assign(new Error(data.error||'Weather service unavailable.'),{status:response.status});
   return data;
  })()]);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
