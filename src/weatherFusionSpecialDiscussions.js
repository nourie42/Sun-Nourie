const H=3600000;
const ROOT='https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function discussionUrl(value){
 try{const u=new URL(String(value).replace(/&amp;/g,'&'));return u.protocol==='https:'&&u.hostname==='www.spc.noaa.gov'&&!u.port&&!u.username&&!u.password&&/^\/products\/md\/(?:\d{4}\/)?md\d{4}\.(html|txt)$/.test(u.pathname)?u.href:null;}catch{return null;}
}
export function inDiscussionPolygon(longitude,latitude,rings){
 if(!finite(longitude)||!finite(latitude)||!Array.isArray(rings)||!rings.length)return false;
 let inside=false;
 for(const ring of rings){
  if(!Array.isArray(ring)||ring.length<4)return false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const [ax,ay]=ring[j]||[],[bx,by]=ring[i]||[];
   if(![ax,ay,bx,by].every(finite))return false;
   const cross=(longitude-ax)*(by-ay)-(latitude-ay)*(bx-ax);
   if(Math.abs(cross)<1e-9&&longitude>=Math.min(ax,bx)&&longitude<=Math.max(ax,bx)&&latitude>=Math.min(ay,by)&&latitude<=Math.max(ay,by))return true;
   if((ay>latitude)!==(by>latitude)&&longitude<(bx-ax)*(latitude-ay)/(by-ay)+ax)inside=!inside;
  }
 }
 return inside;
}
function nearestUtc(token,reference){
 const day=+token.slice(0,2),hour=+token.slice(2,4),minute=+token.slice(4,6),date=new Date(reference);
 if(day<1||day>31||hour>23||minute>59)return NaN;
 const choices=[-1,0,1].map(m=>Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+m,day,hour,minute)).filter(t=>new Date(t).getUTCDate()===day);
 return choices.sort((a,b)=>Math.abs(a-reference)-Math.abs(b-reference))[0]??NaN;
}
export function parseSpecialDiscussion(html,url,now=Date.now()){
 const safe=discussionUrl(url);if(!safe)return null;
 const text=String(html).match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1]??(/<html/i.test(html)?'':String(html));
 const plain=text.replace(/<[^>]*>/g,'').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,m=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[m])).trim();
 const number=plain.match(/Mesoscale Discussion\s+(\d{1,4})/i)?.[1],valid=plain.match(/Valid\s+(\d{6})Z\s*-\s*(\d{6})Z/i);
 if(!number||!valid||plain.length>26000)return null;
 const start=nearestUtc(valid[1],now),end=nearestUtc(valid[2],start);
 if(!finite(start)||!finite(end)||end<=now||start>now+60000||end<=start||end-start>12*H)return null;
 return {id:safe,event:`SPC special weather discussion ${number}`,kind:'discussion',productType:'SPC-MD',applicable:true,sent:new Date(start).toISOString(),expires:new Date(end).toISOString(),areaDesc:'Regional special discussion covering this point; not an official warning.',description:plain,instruction:'',url:safe};
}
export function createSpecialDiscussionService({cached,now=Date.now}){
 return async location=>{
  const meta={id:'special-discussions',label:'SPC special weather discussions',status:'unavailable',fetchedAt:null,issuedAt:null,url:'https://www.spc.noaa.gov/products/md/'};
  try{
   const q=new URLSearchParams({f:'json',where:"name <> 'NoArea'",geometry:`${location.longitude},${location.latitude}`,geometryType:'esriGeometryPoint',inSR:'4326',outSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'name,popupinfo,idp_filedate',returnGeometry:'true',resultRecordCount:'20'});
   const response=await cached(`${ROOT}?${q}`,120000,{timeout:6000}),data=response.data;
   if(data?.error||!Array.isArray(data?.features)||data.exceededTransferLimit)throw new Error('Special-discussion source returned incomplete data.');
   const features=data.features.filter(f=>inDiscussionPolygon(location.longitude,location.latitude,f.geometry?.rings));
   const results=await Promise.all(features.slice(0,20).map(async f=>{
    const links=String(f.attributes?.popupinfo||'').match(/https:\/\/www\.spc\.noaa\.gov\/products\/md\/(?:\d{4}\/)?md\d{4}\.(?:html|txt)/g)||[];
    const url=links.map(discussionUrl).find(Boolean);if(!url)throw new Error('A relevant discussion has no verified official source link.');
    const {data:text}=await cached(url,120000,{text:true,timeout:6000});return parseSpecialDiscussion(text,url,now());
   }));
   const value=[...new Map(results.filter(Boolean).map(x=>[x.id,x])).values()];
   return {value,meta:{...meta,status:'ready',fetchedAt:response.fetchedAt}};
  }catch{return {value:null,meta:{...meta,message:'Special discussions could not be checked. Official warnings and statements remain independent.'}};}
 };
}
