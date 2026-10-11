export const BULLETIN_GROUPS={warning:'Warnings',watch:'Watches',statement:'Statements & advisories',discussion:'Heavy-rain discussions'};
export function bulletinKind(event=''){
 if(/\bwarning\b/i.test(event))return 'warning';
 if(/\bwatch\b/i.test(event))return 'watch';
 return 'statement';
}
export function officialBulletinUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return 'https://www.weather.gov/';
  if(u.hostname==='api.weather.gov'&&/^\/(alerts|products)\//.test(u.pathname))return u.href;
  if(u.hostname==='www.spc.noaa.gov'&&/^\/products\/md\/(?:\d{4}\/)?md\d{4}\.(html|txt)$/.test(u.pathname))return u.href;
  if(u.hostname==='www.wpc.ncep.noaa.gov'&&u.pathname==='/metwatch/metwatch_mpd_multi.php'&&/^\d{4}$/.test(u.searchParams.get('md')||'')&&/^20\d{2}$/.test(u.searchParams.get('yr')||'')&&[...u.searchParams.keys()].length===2)return u.href;
 }catch{}
 return 'https://www.weather.gov/';
}
export function bulletinSourceKey(item){
 let h=2166136261;for(const c of JSON.stringify([item.id,item.title,item.plainSummary,item.description,item.instruction,item.issuedAt,item.expires,item.area,item.scope,item.detection]))h=Math.imul(h^c.charCodeAt(0),16777619);
 return (h>>>0).toString(16);
}
export function bulletinFacts(forecast,now=Date.now()){
 const byId=new Map();
 for(const a of forecast?.alerts||[]){
  if(!a.id||a.status&&a.status!=='Actual'||a.messageType==='Cancel'||!(Date.parse(a.expires)>now)||Date.parse(a.sent)>now+60000)continue;
  if(a.ends&&Date.parse(a.ends)<=now)continue;
  const detection=a.parameters?.tornadoDetection?.[0]||'';
  const emergency=/tornado warning/i.test(a.event||'')&&(/tornado emergency/i.test(`${a.headline||''} ${a.description||''}`)||a.parameters?.tornadoDamageThreat?.includes('CATASTROPHIC'));
  const item={id:String(a.id),kind:bulletinKind(a.event),title:a.event||'NWS notice',headline:a.headline||'',area:a.areaDesc||'',issuedAt:a.sent||'',expires:a.expires,severity:a.severity||'',description:a.description||'',instruction:a.instruction||'',scope:a.scope||'point',detection,emergency,url:officialBulletinUrl(a.url||a.id)};
  item.sourceKey=bulletinSourceKey(item);byId.set(item.id,item);
 }
 // Routine Area Forecast Discussions stay behind the local outlook and science
 // section. Only active, geographically verified special discussions go here.
 for(const d of forecast?.specialDiscussions||[]){
  if(d.productType!=='SPC-MD'||d.applicable!==true||!(Date.parse(d.expires)>now)||!(Date.parse(d.sent)<=now+60000)||!d.description)continue;
  const item={id:String(d.id),kind:'discussion',title:d.event||'Special weather discussion',headline:'',area:d.areaDesc||'Special discussion covering this location; not an official warning.',issuedAt:d.sent,expires:d.expires,severity:'',description:d.description,instruction:d.instruction||'',url:officialBulletinUrl(d.url||d.id)};
  item.sourceKey=bulletinSourceKey(item);byId.set(item.id,item);
 }
 for(const d of forecast?.precipitationDiscussions||[]){
  if(d.productType!=='WPC-MPD'||d.applicable!==true||!(Date.parse(d.expires)>now)||!(Date.parse(d.sent)<=now+60000)||!d.description||!d.plainSummary)continue;
  const item={id:String(d.id),kind:'discussion',title:d.event||'Heavy Rain & Flash Flooding Discussion',headline:'',area:d.areaDesc||'Heavy-rain discussion covering this location.',issuedAt:d.sent,expires:d.expires,severity:'',plainSummary:d.plainSummary,description:d.description,instruction:d.instruction||'',url:officialBulletinUrl(d.url)};
  item.sourceKey=bulletinSourceKey(item);byId.set(item.id,item);
 }
 const priority=item=>/tornado warning/i.test(item.title)?item.emergency?0:item.detection==='OBSERVED'?1:2:/flash flood warning/i.test(item.title)?3:item.kind==='warning'?4:/tornado watch/i.test(item.title)?5:item.kind==='watch'?6:item.kind==='statement'?7:8;
 return [...byId.values()].sort((a,b)=>priority(a)-priority(b)||Date.parse(b.issuedAt)-Date.parse(a.issuedAt));
}
