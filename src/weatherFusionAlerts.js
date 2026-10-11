const INTERVAL=30000;
const countyId=value=>typeof value==='string'?value.match(/^https:\/\/api\.weather\.gov\/zones\/county\/([A-Z]{2}C\d{3})$/)?.[1]:null;
const active=(a,now)=>a.status==='Actual'&&a.messageType!=='Cancel'&&Date.parse(a.expires)>now&&(!a.ends||Date.parse(a.ends)>now)&&(!a.sent||Date.parse(a.sent)<=now+60000);

export function mergeOfficialAlerts(pointFeatures,countyFeatures,county,now){
  const features=[...countyFeatures.map(f=>({feature:f,scope:'county'})),...pointFeatures.map(f=>({feature:f,scope:'point'}))];
  const superseded=new Set();
  for(const {feature:f} of features){
    if(f.properties?.status!=='Actual'||Date.parse(f.properties.sent)>now+60000)continue;
    for(const ref of f.properties.references||[])if(ref['@id']||ref.identifier)superseded.add(ref['@id']||ref.identifier);
  }
  const alerts=new Map();
  for(const {feature:f,scope} of features){
    const a=f.properties,id=f.id||a?.['@id']||a?.id;
    if(!id||!a||superseded.has(id)||superseded.has(a.id)||!active(a,now))continue;
    if(scope==='county'&&!/\bwarning\b/i.test(a.event||''))continue;
    // The point endpoint is authoritative for point coverage; county matches are
    // deliberately broader and must never be presented as point-confirmed.
    alerts.set(id,{...a,id,url:f.id||a['@id'],geometry:f.geometry,scope,county});
  }
  return [...alerts.values()];
}

export function createAlertService({request,cache,now=Date.now}){
  async function source(url){
    return cache.get(url,INTERVAL,async()=>{
      try{
        const data=await request(url,{timeout:8000,revalidate:true});
        if(!Array.isArray(data.features)||data.pagination?.next)throw new Error('The alert list is incomplete.');
        return {features:data.features,status:'ready',fetchedAt:new Date(now()).toISOString(),url};
      }catch(error){return {features:[],status:'unavailable',fetchedAt:null,url,message:String(error.message).slice(0,160)};}
    });
  }
  return async(location,point)=>{
    const id=countyId(point?.county),county=id?{id}:null;
    const pointUrl=`https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`;
    const countyUrl=id?`https://api.weather.gov/alerts/active?zone=${id}`:null;
    const [local,regional]=await Promise.all([source(pointUrl),countyUrl?source(countyUrl):Promise.resolve({features:[],status:'unavailable',fetchedAt:null,message:'County alert coverage could not be verified.'})]);
    const status=local.status==='ready'&&regional.status==='ready'?'ready':'unavailable';
    const fetched=[local.fetchedAt,regional.fetchedAt].filter(Boolean).sort();
    const meta={id:'alerts',label:'Official NWS point and county alerts',status,fetchedAt:fetched[0]||null,issuedAt:null,url:pointUrl,countyUrl,pointStatus:local.status,countyStatus:regional.status,county:id,message:[local.message,regional.message].filter(Boolean).join(' ')};
    return {location:{...location,timeZone:point?.timeZone||'America/New_York'},alerts:mergeOfficialAlerts(local.features,regional.features,county,now()),feeds:[meta],checkedAt:new Date(now()).toISOString()};
  };
}
