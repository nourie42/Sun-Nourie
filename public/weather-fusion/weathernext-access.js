export function installWeatherNextAccess({refresh}){
 const panel=document.createElement('section');
 panel.id='weathernext-access';panel.className='weather-access';panel.hidden=true;
 panel.setAttribute('aria-labelledby','weathernext-access-title');
 panel.innerHTML=`<h2 id="weathernext-access-title">Password required</h2>
 <p>Use your location button or search for a city or ZIP above. Enter the shared password to load a new forecast. Saved forecasts do not require a password.</p>
 <form><label for="weathernext-password">Shared password</label><input id="weathernext-password" type="password" autocomplete="current-password" maxlength="256" required>
 <button type="submit">Unlock and load my forecast</button></form><p role="status" aria-live="polite"></p>`;
 const forecast=document.getElementById('forecast');forecast.before(panel);
 const form=panel.querySelector('form'),input=panel.querySelector('input'),label=panel.querySelector('label'),button=panel.querySelector('button'),message=panel.querySelector('[role="status"]');
 let unlocked=false,pending=null,generation=0;
 const update=()=>{label.hidden=input.hidden=unlocked;input.required=!unlocked;button.textContent=unlocked?'Load my forecast':'Unlock and load my forecast';document.getElementById('weathernext-access-title').textContent=unlocked?'Location unlocked':'Password required';};
 const state=fetch('/api/weather-fusion/compare/access',{cache:'no-store',credentials:'same-origin'}).then(r=>r.json()).then(data=>{unlocked=data.unlocked===true;update();}).catch(()=>{});
 async function post(path,body){
  const response=await fetch('/api/weather-fusion/compare/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-WeatherNext-Request':'1'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Location lookup unavailable.'),{status:response.status});return data;
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!pending||button.disabled)return;
  const selected=pending,id=generation;button.disabled=true;message.textContent='Checking access.';
  try{
   await state;
   if(!unlocked){await post('unlock',{password:input.value});unlocked=true;input.value='';update();}
   if(id!==generation)return;
   message.textContent='Loading WeatherNext for your selected location. This can take a minute.';
   await post('location',Object.fromEntries(new URLSearchParams(selected)));
   if(id===generation){panel.hidden=true;forecast.hidden=false;refresh();}
  }catch(error){if(id===generation){if(error.status===401){unlocked=false;update();}message.textContent=error.message;}}
  finally{button.disabled=false;}
 });
 async function requestForecast(params,signal){
  const id=++generation;pending=String(params);
  const response=await fetch('/api/weather-fusion/compare/google?'+params,{signal,cache:'no-store',credentials:'same-origin'});
  const data=await response.json();
  if(id!==generation)throw new DOMException('Location changed','AbortError');
  if(!response.ok){
   panel.hidden=false;forecast.hidden=true;form.hidden=response.status!==401;
   document.getElementById('weathernext-access-title').textContent=response.status===401?(unlocked?'Location unlocked':'Password required'):'Forecast unavailable';
   message.textContent=response.status===401?(unlocked?'Ready to load the selected location.':'Choose your location above, then unlock to load its forecast.'):(data.error||'The forecast could not be loaded. Please try Refresh.');
   throw Object.assign(new Error(data.error||'Weather service unavailable.'),{status:response.status});
  }
  panel.hidden=true;forecast.hidden=false;return data;
 }
 return {requestForecast};
}
