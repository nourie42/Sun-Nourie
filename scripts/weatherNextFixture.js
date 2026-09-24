// Deterministic TEST-ONLY data. Never imported or served by production code.
export function weatherNextFixture(catalog){
 const stats=catalog.statistics,now='2026-09-24T13:00:00Z';
 const points=[{id:'knightdale',name:'Knightdale / Raleigh, NC',latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},{id:'greenville',name:'Greenville, NC',latitude:35.6127,longitude:-77.3664,timeZone:'America/New_York'}];
 const sources={};
 for(const [id,grid,count,start] of [['surface','surface',360,'2026-09-24T00:00:00Z'],['station','station',360,'2026-09-24T00:00:00Z'],['interimSurface','surface',48,'2026-09-24T11:00:00Z'],['interimStation','station',48,'2026-09-24T11:00:00Z']]){
  const fields=catalog.fields.filter(f=>f.grid===grid);
  sources[id]={status:'ready',runAt:start,fetchedAt:now,gridResolutionDegrees:grid==='station'?.05:.1,fields:fields.map(f=>f.id),sourceTable:'TEST FIXTURE ONLY',horizonHours:count,points:points.map((p,pi)=>({...p,gridLatitude:p.latitude,gridLongitude:p.longitude,hourly:Array.from({length:count},(_,i)=>{
   const h=i+1,time=new Date(Date.parse(start)+h*3600000).toISOString(),values={};
   for(const f of fields){
    let base=f.kind==='temperature'?290+5*Math.sin(h/24*Math.PI*2)+pi:f.kind==='rain'?(h%30<7?.0005:0):f.kind==='fraction'?.45:f.kind==='solar'?Math.max(0,1600000*Math.sin(h/24*Math.PI*2)):f.kind==='pressure'?101300:5+2*Math.sin(h/12);
    if(f.id.includes('dewpoint'))base-=6;
    if(f.kind==='signed-speed')base=-base;
    values[f.id]=Object.fromEntries(stats.map((s,j)=>[s,f.id==='sea_surface_temperature'?null:s==='mean'?base:base+(j-3)*(f.kind==='temperature'?1:f.kind==='rain'?.0001:f.kind==='fraction'?.05:f.kind==='pressure'?150:f.kind==='solar'?20000:.5)]));
    if(f.kind==='rain'||f.kind==='solar')for(const s of stats)values[f.id][s]=Math.max(0,values[f.id][s]);
   }
   return {time,forecastHour:h,values};
  })}))};
 }
 return {schema:'weather-nourie-weathernext-site-v1',model:'Google WeatherNext 3',generatedAt:now,ensembleMembers:64,points,sources};
}
