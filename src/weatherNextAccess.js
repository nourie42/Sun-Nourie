// Public access; query-triggering requests must still originate on this site.
export function createWeatherNextAccess(_app,{origin=process.env.WEATHERNEXT_PUBLIC_ORIGIN||'https://sun-nourie-live.onrender.com'}={}){
 const sameOrigin=(req,res,next)=>{
  if(req.headers.origin!==origin||req.headers['x-weathernext-request']!=='1')return res.status(403).json({error:'Open the forecast page to make this request.'});
  next();
 };
 return {sameOrigin};
}
