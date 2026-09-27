export function installWeatherNextAccess({refresh}){
 const panel=document.createElement('section');
 panel.id='weathernext-access';panel.className='weather-access';panel.hidden=true;
 panel.setAttribute('aria-labelledby','weathernext-access-title');
 panel.innerHTML=`<h2 id="weathernext-access-title">Forecast for your location</h2>
 <p role="status" aria-live="polite"></p>`;
 const forecast=document.getElementById('forecast');forecast.before(panel);
 const title=panel.querySelector('h2'),message=panel.querySelector('[role="status"]');
 let generation=0;
 async function post(path,body,signal){
  const timeout=AbortSignal.timeout(35000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await fetch('/api/weather-fusion/compare/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',signal:requestSignal,headers:{'Content-Type':'application/json','X-WeatherNext-Request':'1'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Location lookup unavailable.'),{status:response.status});return data;
 }
 async function requestForecast(params,signal){
  const id=++generation;
  try{
   let response=await fetch('/api/weather-fusion/compare/google?'+params,{signal,cache:'no-store',credentials:'same-origin'});
   let data=await response.json();
   if(id!==generation)throw new DOMException('Location changed','AbortError');
   if(!response.ok&&response.status===409&&data.code==='LOCATION_REQUIRED'){
    panel.hidden=false;forecast.hidden=true;
    title.textContent='Loading forecast for your location';
    message.textContent='Requesting the WeatherNext forecast for this location…';
    data=await post('location',Object.fromEntries(new URLSearchParams(params)),signal);
    response={ok:true};
    if(id!==generation)throw new DOMException('Location changed','AbortError');
   }
   if(!response.ok&&data.code!=='LOCATION_REQUIRED'){
    const error=Object.assign(new Error(data.error||'The forecast could not be loaded.'),{status:response.status});
    throw error;
   }
   if(!data?.current||!Array.isArray(data.hours))throw new Error('WeatherNext returned an incomplete forecast.');
   panel.hidden=true;forecast.hidden=false;return data;
  }catch(error){
   if(id!==generation||error.name==='AbortError')throw error;
   panel.hidden=false;forecast.hidden=true;title.textContent='Forecast unavailable';
   message.textContent=error.name==='TimeoutError'?'WeatherNext took too long to respond. Tap Refresh to try again.':`${error.message||'The forecast could not be loaded.'} Tap Refresh to try again.`;
   throw error;
  }
 }
 return {requestForecast};
}
