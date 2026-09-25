export function installWeatherNextAccess({refresh}){
 const panel=document.createElement('section');
 panel.id='weathernext-access';panel.className='weather-access';panel.hidden=true;
 panel.setAttribute('aria-labelledby','weathernext-access-title');
 panel.innerHTML=`<h2 id="weathernext-access-title">Forecast for your location</h2>
 <p>Use your location button or search for a city or ZIP above. Select Load my forecast to request a new location.</p>
 <form>
 <button type="submit">Load my forecast</button></form><p role="status" aria-live="polite"></p>`;
 const forecast=document.getElementById('forecast');forecast.before(panel);
 const form=panel.querySelector('form'),button=panel.querySelector('button'),message=panel.querySelector('[role="status"]');
 let pending=null,generation=0;
 async function post(path,body){
  const response=await fetch('/api/weather-fusion/compare/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-WeatherNext-Request':'1'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Location lookup unavailable.'),{status:response.status});return data;
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!pending||button.disabled)return;
  const selected=pending,id=generation;button.disabled=true;message.textContent='Checking access…';
  try{
   if(id!==generation)return;
   message.textContent='Loading WeatherNext for your selected location. This can take a minute.';
   await post('location',Object.fromEntries(new URLSearchParams(selected)));
   if(id===generation){panel.hidden=true;forecast.hidden=false;refresh();}
  }catch(error){if(id===generation){message.textContent=error.message;}}
  finally{button.disabled=false;}
 });
 async function requestForecast(params,signal){
  const id=++generation;pending=String(params);
  const response=await fetch('/api/weather-fusion/compare/google?'+params,{signal,cache:'no-store',credentials:'same-origin'});
  const data=await response.json();
  if(id!==generation)throw new DOMException('Location changed','AbortError');
  if(!response.ok){
   panel.hidden=false;forecast.hidden=true;form.hidden=data.code!=='LOCATION_REQUIRED';
   document.getElementById('weathernext-access-title').textContent=data.code==='LOCATION_REQUIRED'?'Forecast for your location':'Forecast unavailable';
   message.textContent=(data.error||'The forecast could not be loaded. Please try Refresh.');
   throw Object.assign(new Error(data.error||'Weather service unavailable.'),{status:response.status});
  }
  panel.hidden=true;forecast.hidden=false;return data;
 }
 return {requestForecast};
}
