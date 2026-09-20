const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function requestJson(url,options={},hooks={}){
 const fetcher=hooks.fetchImpl||fetch,wait=hooks.wait||sleep;
 for(let attempt=0;attempt<6;attempt++){
  try{
   const response=await fetcher(url,{...options,signal:AbortSignal.timeout(30000)});
   if([408,429,502,503,504].includes(response.status))throw Object.assign(new Error('Service temporarily unavailable.'),{retryable:true});
   let data;try{data=await response.json();}catch{throw Object.assign(new Error('Service returned an unreadable response.'),{retryable:response.ok||response.status>=500});}
   if(!response.ok)throw Object.assign(new Error(data.error||`Request failed (${response.status}).`),{status:response.status});
   return data;
  }catch(error){
   if(!(error instanceof TypeError||error.name==='TimeoutError'||error.name==='AbortError'||error.retryable))throw error;
   if(attempt===5)throw Object.assign(new Error('Connection to Deal Desk was interrupted. Your files are retained. Try again when connected.'),{connectionLost:true});
   hooks.onReconnect?.(`Connection interrupted. Reconnecting to the same analysis (attempt ${attempt+1} of 5)…`);
   await wait(Math.min(1000*2**attempt,8000));
  }
 }
}
export async function runAnalysisJob(mode,payload,headers,hooks={}){
 const requestId=hooks.requestId||crypto.randomUUID();
 const options={method:'POST',headers,body:JSON.stringify({...payload,requestId})};
 const wait=hooks.wait||sleep,now=hooks.now||Date.now;
 const submit=()=>requestJson('/api/deal-desk/'+mode,options,hooks);
 let job=await submit(),restarts=0;
 const deadline=now()+18*60*1000;
 hooks.onJob?.(job.jobId);
 while(now()<deadline){
  await wait(1500);
  let data;
  try{data=await requestJson('/api/deal-desk/jobs/'+job.jobId,{headers},hooks);}catch(error){
   if(error.status!==404||restarts++>=1)throw error;
   hooks.onReconnect?.('The service restarted. Resubmitting your retained files automatically…');
   job=await submit();hooks.onJob?.(job.jobId);continue;
  }
  if(data.state==='failed')throw new Error(data.error||'Document processing failed.');
  hooks.onPhase?.(data.phase||'Reviewing…');
  if(data.state==='complete')return data.result;
 }
 throw new Error('Analysis is taking longer than expected. Your files are retained.');
}
