import {inDiscussionPolygon} from './weatherFusionSpecialDiscussions.js';

const HOUR=3600000;
const INDEX_URL='https://www.wpc.ncep.noaa.gov/metwatch/metwatch_mpd.php';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clean=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,match=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[match])).replace(/\s+/g,' ').trim();

export function precipitationDiscussionUrl(value){
 try{
  const url=new URL(value,INDEX_URL),params=[...url.searchParams.keys()].sort();
  if(url.protocol!=='https:'||url.hostname!=='www.wpc.ncep.noaa.gov'||url.port||url.username||url.password||url.pathname!=='/metwatch/metwatch_mpd_multi.php'||params.join(',')!=='md,yr'||!/^\d{4}$/.test(url.searchParams.get('md')||'')||!/^20\d{2}$/.test(url.searchParams.get('yr')||''))return null;
  return url.href;
 }catch{return null;}
}

function nearestUtc(token,reference){
 const day=+token.slice(0,2),hour=+token.slice(2,4),minute=+token.slice(4,6),date=new Date(reference);
 if(day<1||day>31||hour>23||minute>59)return NaN;
 const choices=[-1,0,1].map(month=>Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+month,day,hour,minute)).filter(time=>new Date(time).getUTCDate()===day);
 return choices.sort((a,b)=>Math.abs(a-reference)-Math.abs(b-reference))[0]??NaN;
}

function discussionPolygon(text){
 const block=String(text).match(/LAT\.\.\.LON\s+([\s\S]*?)$/i)?.[1]||'';
 const ring=[...block.matchAll(/\b(\d{4})(\d{4})\b/g)].map(match=>[Number(match[2])/-100,Number(match[1])/100]);
 if(ring.length<3||!ring.flat().every(finite))return [];
 ring.push([...ring[0]]);return ring;
}

export function simplifyPrecipitationSummary(value){
 let text=clean(value)
  .replace(/\bmay promote\b/gi,'could cause')
  .replace(/\bsome localized and mainly urban areas of flash flooding\b/gi,'localized flash flooding, especially in urban areas')
  .replace(/\bgoing through\b/gi,'through')
  .replace(/\bwill be capable of producing\b/gi,'could produce')
  .replace(/\binstances of flash flooding\b/gi,'flash flooding')
  .replace(/\bflash flood concerns?\b/gi,'flash-flood risk');
 if(text.length>800)text=text.slice(0,797).replace(/\s+\S*$/,'')+'...';
 return text;
}

export function parsePrecipitationDiscussion(html,url,location,now=Date.now()){
 const safe=precipitationDiscussionUrl(url);if(!safe)return null;
 const source=String(html).match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1];if(!source||source.length>30000)return null;
 const plain=source.replace(/\r/g,'').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,match=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[match]));
 const number=plain.match(/Mesoscale Precipitation Discussion\s+(\d{4})/i)?.[1];
 const valid=plain.match(/Valid\s+(\d{6})Z\s*-\s*(\d{6})Z/i);
 const summary=plain.match(/SUMMARY\.\.\.([\s\S]*?)\n\s*DISCUSSION\.\.\./i)?.[1];
 const affected=plain.match(/Areas affected\.\.\.([\s\S]*?)\n\s*\nConcerning\.\.\./i)?.[1];
 const concerning=plain.match(/Concerning\.\.\.([\s\S]*?)\n\s*\nValid\s+/i)?.[1];
 if(!number||!valid||!summary||!affected||!concerning||new URL(safe).searchParams.get('md')!==number)return null;
 const sent=nearestUtc(valid[1],now),expires=nearestUtc(valid[2],sent),ring=discussionPolygon(plain);
 if(!finite(sent)||!finite(expires)||sent>now+60000||expires<=now||expires<=sent||expires-sent>12*HOUR||!inDiscussionPolygon(location.longitude,location.latitude,[ring]))return null;
 const area=clean(affected).replace(/\.{2,}/g,' · '),concern=clean(concerning).replace(/\.{2,}/g,' · ');
 return {id:safe,event:'Heavy Rain & Flash Flooding Discussion',kind:'discussion',productType:'WPC-MPD',number,applicable:true,sent:new Date(sent).toISOString(),expires:new Date(expires).toISOString(),areaDesc:`${area} · ${concern}.`,plainSummary:simplifyPrecipitationSummary(summary),description:clean(plain),instruction:'',url:safe};
}

export function createPrecipitationDiscussionService({cached,now=Date.now}){
 return async location=>{
  const meta={id:'precipitation-discussions',label:'WPC heavy-rain discussions',status:'unavailable',fetchedAt:null,issuedAt:null,url:INDEX_URL};
  try{
   const response=await cached(INDEX_URL,120000,{text:true,timeout:12000}),html=String(response.data);
   const links=[...html.matchAll(/href=["']([^"']*metwatch_mpd_multi\.php\?md=\d{4}(?:&amp;|&)yr=20\d{2})/gi)].map(match=>precipitationDiscussionUrl(match[1].replace(/&amp;/g,'&'))).filter(Boolean);
   const unique=[...new Set(links)];if(unique.length>20)throw new Error('WPC discussion index returned too many products.');
   const products=await Promise.all(unique.map(async url=>{const page=await cached(url,120000,{text:true,timeout:12000});return parsePrecipitationDiscussion(page.data,url,location,now());}));
   const value=products.filter(Boolean);
   return {value,meta:{...meta,status:'ready',fetchedAt:response.fetchedAt,issuedAt:value.reduce((latest,item)=>Date.parse(item.sent)>Date.parse(latest||0)?item.sent:latest,null)}};
  }catch{return {value:null,meta:{...meta,message:'Heavy-rain discussions could not be checked. Official public warnings remain independent.'}};}
 };
}
