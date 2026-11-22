/* A separate scope and cache name: never claim the original application or
 * cache forecasts, alerts, sign-in responses, API credentials or other apps. */
const CACHE='weather-nourie-next-gen-static-v2';
const PREFIX='/experimental/next-gen/';
const OFFLINE='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#17272e"><title>Weather Nourie Next Gen · Offline</title><body style="margin:0;background:#17272e;color:#f3f4ee;font:16px/1.6 system-ui;min-height:100vh;display:grid;place-items:center"><main style="max-width:340px;padding:28px"><small style="letter-spacing:.15em;color:#b9cbd0">WEATHER NOURIE · NEXT GEN</small><h1 style="font-weight:500;line-height:1.2">You’re offline.</h1><p>A connection is needed for a fresh forecast. No old forecast is being presented as current.</p><a href="/experimental/next-gen/" style="display:inline-block;padding:12px 20px;background:#d8e4df;color:#17272e;border-radius:24px;text-decoration:none">Try again</a></main></body></html>';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([PREFIX+'next-gen.css?v=2',PREFIX+'manifest.webmanifest'])));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('weather-nourie-next-gen-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||!url.pathname.startsWith(PREFIX))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>new Response(OFFLINE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
    return;
  }
  if(!/\.(?:js|css|webmanifest|png|svg)$/.test(url.pathname)||url.pathname.endsWith('/sw.js'))return;
  event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}return response;}).catch(()=>caches.match(request)));
});
