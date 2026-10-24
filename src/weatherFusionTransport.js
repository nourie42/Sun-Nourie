// Share an upstream cooldown across point, exposure and winter requests. The
// ensemble endpoint and static model metadata are different products and remain
// available; never rotate endpoints to evade a provider's retry window.
export function createWeatherTransport(fetchImpl,now=Date.now){
 let retryAt=0;
 return async function weatherFetch(url,options){
  const parsed=new URL(url),limited=parsed.hostname==='api.open-meteo.com'&&parsed.pathname==='/v1/forecast';
  if(limited&&now()<retryAt)return new Response(JSON.stringify({error:true,reason:'Weather forecast provider is in its requested retry window.'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':String(Math.ceil((retryAt-now())/1000))}});
  const response=await fetchImpl(url,options);
  if(limited&&response.status===429){
   const header=response.headers?.get?.('retry-after'),seconds=Number(header),until=header?(Number.isFinite(seconds)?now()+seconds*1000:Date.parse(header)):NaN;
   retryAt=Math.max(retryAt,Number.isFinite(until)?Math.max(now()+60000,until):now()+5*60000);
  }
  return response;
 };
}

// Keep the existing 400/minute ceiling, reserving its latter half for core
// forecasts. Optional products must not starve the next city's official data.
export function createWeatherRequestBudget(now=Date.now){
 let minute=-1,count=0;
 return url=>{
  const current=Math.floor(now()/60000);if(current!==minute){minute=current;count=0;}
  const u=new URL(url),core=u.hostname==='api.weather.gov'&&/^\/(?:points|gridpoints)\//.test(u.pathname);
  if(count>=400||(!core&&count>=200))throw Object.assign(new Error(core?'Weather source request budget reached.':'Supplemental weather requests paused to preserve core forecast capacity.'),{status:429});
  count++;
 };
}
