const finite=v=>typeof v==='number'&&Number.isFinite(v);
/** Compare actual station pressure with the same station about three hours earlier.
 * Never compare station pressure with a sea-level forecast, or replace missing values.
 */
export function pressureTrendFromObservations(features,current){
 const time=Date.parse(current?.time),pressure=current?.pressurePa;
 const missing={status:'unavailable',direction:'unknown',deltaMb:null,hours:null};
 if(!finite(time)||!finite(pressure)||pressure<50000||pressure>110000)return missing;
 const candidates=(features||[]).flatMap(f=>{
  const p=f.properties||{},t=Date.parse(p.timestamp),q=p.barometricPressure,age=(time-t)/3600000;
  if(q?.unitCode!=='wmoUnit:Pa'||!finite(q.value)||q.value<50000||q.value>110000||!finite(age)||age<2.5||age>3.5)return [];
  return [{time:t,value:q.value,age}];
 }).sort((a,b)=>Math.abs(a.age-3)-Math.abs(b.age-3));
 const previous=candidates[0];if(!previous)return missing;
 const deltaMb=Number(((pressure-previous.value)/100).toFixed(2));
 return {status:'ready',direction:deltaMb>.2?'rising':deltaMb<-.2?'falling':'steady',deltaMb,hours:Number(previous.age.toFixed(2)),fromTime:new Date(previous.time).toISOString(),toTime:current.time,basis:'Same-station observed barometric pressure'};
}
