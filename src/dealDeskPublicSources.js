import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
function publicAddress(ip){return !(/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|23\d\.|24\d\.|25\d\.|::|f[cd]|fe[89ab])/i.test(ip));}
export async function fetchPublicSource(url,fetchImpl=fetch){
 for(let redirects=0;redirects<4;redirects++){
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||isIP(u.hostname))throw Error('Unsupported source URL');
  const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Non-public source URL');
  const response=await fetchImpl(u.href,{redirect:'manual',headers:{'User-Agent':'DealDesk research contact admin@nourie42.com','Accept':'text/html,text/plain,application/xhtml+xml'},signal:AbortSignal.timeout(20000)});
  if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location'),u).href;continue;}
  if(!response.ok||!/(text\/|xhtml|xml|json)/i.test(response.headers.get('content-type')||''))throw Error('Source unavailable as text');
  const reader=response.body.getReader();let size=0,parts=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5e6){await reader.cancel();throw Error('Source exceeds reading limit');}parts.push(Buffer.from(value));}
  return Buffer.concat(parts).toString('utf8').replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:tr|p|div|h[1-6]|li)>/gi,'\n').replace(/<\/(?:td|th)>/gi,' | ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
 }
 throw Error('Too many source redirects');
}
export async function expandPublicSources(sources,fetchImpl){
 return Promise.all(sources.slice(0,6).map(async s=>{try{const text=await fetchPublicSource(s.url,fetchImpl);if(text.length>650000)throw Error('Source too large');return {...s,text:s.text+'\nFULL SOURCE TABLES AND CONTEXT:\n'+text};}catch{return {...s,warnings:[...(s.warnings||[]),'Full page unavailable; extracted figures must match the available cited passages.']};}}));
}
