/** Retrieval and observation clocks are distinct. Rendering never refreshes them. */
const MINUTE=60000;
export const MAX_SNAPSHOT_AGE_MS=90*MINUTE;
export const MAX_OBSERVATION_AGE_MS=75*MINUTE;
const FUTURE_TOLERANCE_MS=5*MINUTE;
function clockStatus(value,now,maxAge,present){
 if(!present)return {status:'unknown',expired:false,time:null,ageMinutes:null};
 const time=Date.parse(value),age=now-time;
 if(!Number.isFinite(now)||!Number.isFinite(time))return {status:'invalid',expired:true,time:null,ageMinutes:null};
 if(age < -FUTURE_TOLERANCE_MS)return {status:'invalid',expired:true,time:value,ageMinutes:age/MINUTE};
 return {status:age>maxAge?'stale':'fresh',expired:age>maxAge,time:value,ageMinutes:age/MINUTE};
}
export function forecastSnapshotFreshness(forecast,now=Date.now()){
 return clockStatus(forecast?.assembledAt,now,MAX_SNAPSHOT_AGE_MS,Object.hasOwn(forecast||{},'assembledAt'));
}
export function currentReadingFreshness(forecast,now=Date.now()){
 const snapshot=forecastSnapshotFreshness(forecast,now);
 if(snapshot.expired)return {...snapshot,reason:'The weather snapshot is stale or its update time is invalid.'};
 const current=forecast?.current||{};
 const reading=clockStatus(current.time,now,current.type==='observation'?MAX_OBSERVATION_AGE_MS:MAX_SNAPSHOT_AGE_MS,Object.hasOwn(current,'time'));
 return {...reading,reason:reading.expired?'The current source reading is stale or its timestamp is invalid.':''};
}
