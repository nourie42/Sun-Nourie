/* Start the chosen-location request while the application modules load. No
 * fallback city, replacement forecast, persistent forecast cache or extra poll. */
(()=>{
 if(globalThis.__weatherNourieForecastStarted||globalThis.__weatherNouriePrefetch)return;
 const valid=p=>p&&typeof p.latitude==='number'&&typeof p.longitude==='number'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&p.latitude>=24&&p.latitude<=50&&p.longitude>=-125&&p.longitude<=-66;
 const read=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
 const selected=read('weather-fusion-selected-city'),device=read('weather-fusion-device-place');
 const params=new URLSearchParams(globalThis.location?.search||'');
 const linked={latitude:Number(params.get('latitude')),longitude:Number(params.get('longitude'))};
 const place=valid(linked)?linked:valid(selected)?selected:valid(device)?device:null;if(!place)return;
 const controller=new AbortController(),startedAt=Date.now();
 const timer=setTimeout(()=>controller.abort(new DOMException('Weather request timed out. Tap Refresh to retry.','TimeoutError')),45000);
 const promise=fetch('/api/weather-fusion/forecast?'+new URLSearchParams({latitude:place.latitude,longitude:place.longitude}),{signal:controller.signal,cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}}).then(async response=>{
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Weather service unavailable.'),{status:response.status});return data;
 }).finally(()=>clearTimeout(timer));
 promise.catch(()=>{});
 globalThis.__weatherNouriePrefetch={key:`${place.latitude},${place.longitude}`,promise,controller,startedAt,consumed:false};
})();
