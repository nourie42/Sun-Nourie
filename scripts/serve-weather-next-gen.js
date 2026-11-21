// Separate feature-branch preview. Reuse the live engine through a streaming
// same-origin proxy; never run another model engine or copy production secrets.
import express from 'express';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {registerWeatherNextGenRoutes} from '../src/weatherNextGenRoutes.js';

const app=express(),root=fileURLToPath(new URL('../public/weather-fusion/',import.meta.url));
const origin='https://sun-nourie-live.onrender.com';
app.disable('x-powered-by');
app.get('/health',(_req,res)=>res.json({ok:true,application:'weather-nourie-next-gen',engine:'existing-live-service'}));
registerWeatherNextGenRoutes(app);
app.get(['/','/weather-fusion/','/weather-fusion'],(_req,res)=>res.sendFile(root+'index.html'));
app.use('/weather-fusion',(req,res,next)=>{
  if(!/\.(js|css|webp|png|jpe?g|svg|json|webmanifest|ico)$/i.test(req.path))return next();
  express.static(root,{index:false})(req,res,next);
});
app.use('/api/weather-fusion',async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method))return res.status(405).json({error:'This preview uses read-only weather requests.'});
  const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),95000);
  res.on('close',()=>{clearTimeout(deadline);abort.abort();});
  try{
    const response=await fetch(new URL(req.originalUrl,origin),{method:req.method,signal:abort.signal,headers:{Accept:'application/json','User-Agent':'Weather-Nourie-Next-Gen-Preview/1.0'}});
    res.status(response.status).set('Cache-Control','no-store');
    for(const name of ['content-type','retry-after'])if(response.headers.has(name))res.set(name,response.headers.get(name));
    if(response.body)Readable.fromWeb(response.body).on('error',()=>res.end()).pipe(res);else res.end();
  }catch{if(!res.headersSent)res.status(502).json({error:'The existing forecast service could not be reached. Please retry.'});else res.end();}
});
// Other apps retain their existing service and access policies.
app.use((req,res)=>res.redirect(302,origin+req.originalUrl));
const server=app.listen(Number(process.env.PORT||3100),'0.0.0.0',()=>console.log('Weather Nourie Next Gen preview is ready.'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),8000).unref();});
