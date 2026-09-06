const HOUR=3600000;
export const BULLETIN_GROUPS={warning:'Warnings',watch:'Watches',statement:'Statements & advisories',discussion:'Discussions'};
export function bulletinKind(event=''){
 if(/\bwarning\b/i.test(event))return 'warning';
 if(/\bwatch\b/i.test(event))return 'watch';
 return 'statement';
}
export function officialBulletinUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='api.weather.gov'&&!u.username&&!u.password&&!u.port&&/^\/(alerts|products)\//.test(u.pathname)?u.href:'https://www.weather.gov/';}catch{return 'https://www.weather.gov/';}}
export function bulletinSourceKey(item){
 // Equality tag only; the server's cache uses SHA-256 of the complete source facts.
 let h=2166136261;for(const c of JSON.stringify([item.id,item.title,item.description,item.instruction,item.issuedAt,item.expires,item.area])){h=Math.imul(h^c.charCodeAt(0),16777619);}
 return (h>>>0).toString(16);
}
export function bulletinFacts(forecast,now=Date.now()){
 const byId=new Map();
 for(const a of forecast?.alerts||[]){
  if(!a.id||a.status&&a.status!=='Actual'||a.messageType==='Cancel'||!(Date.parse(a.expires)>now)||Date.parse(a.sent)>now+60000)continue;
  if(a.ends&&Date.parse(a.ends)<=now)continue;
  const item={id:String(a.id),kind:bulletinKind(a.event),title:a.event||'NWS notice',headline:a.headline||'',area:a.areaDesc||'',issuedAt:a.sent||'',expires:a.expires,severity:a.severity||'',description:a.description||'',instruction:a.instruction||'',url:officialBulletinUrl(a.id)};
  item.sourceKey=bulletinSourceKey(item);byId.set(item.id,item);
 }
 const d=forecast?.discussion,issued=Date.parse(d?.issuanceTime);
 if(d?.text&&Number.isFinite(issued)&&issued<=now+60000&&now-issued<=24*HOUR&&forecast?.feeds?.find(f=>f.id==='afd')?.status==='ready'){
  const item={id:String(d.id||d.url),kind:'discussion',title:`NWS ${d.office||forecast.location?.office||''} forecast discussion`,headline:'',area:'Regional forecast-office discussion; not a point-specific warning.',issuedAt:d.issuanceTime,expires:null,severity:'',description:d.text,instruction:'',url:officialBulletinUrl(d.url)};
  item.sourceKey=bulletinSourceKey(item);byId.set(item.id,item);
 }
 return [...byId.values()].sort((a,b)=>Object.keys(BULLETIN_GROUPS).indexOf(a.kind)-Object.keys(BULLETIN_GROUPS).indexOf(b.kind)||Date.parse(b.issuedAt)-Date.parse(a.issuedAt));
}
