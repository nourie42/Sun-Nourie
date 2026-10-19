/** User-selected handling of one isolated temperature forecast, not calibration. */
export const TEMPERATURE_OUTLIER_VERSION='weather-nourie-temperature-outliers-v1';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};

export function adjustTemperaturePolicy(values,basePolicy,dayIndex){
 const unchanged=()=>({policy:basePolicy,temperatureAdjustment:null});
 if(dayIndex!==1&&dayIndex!==2)return unchanged();
 const sources=Object.entries(basePolicy||{}).filter(([id,weight])=>finite(weight)&&weight>0&&finite(values?.[id])).map(([id,weight])=>({id,weight,value:values[id]}));
 if(sources.length<4||!sources.some(source=>source.id==='ecmwf'))return unchanged();
 const candidates=sources.filter(source=>{
  if(source.id==='ecmwf')return false;
  const peers=sources.filter(peer=>peer.id!==source.id),peerValues=peers.map(peer=>peer.value),min=Math.min(...peerValues),max=Math.max(...peerValues);
  const outside=Math.max(min-source.value,source.value-max);
  return peers.length>=3&&peers.some(peer=>peer.id==='ecmwf')&&max-min<=3+1e-9&&Math.abs(source.value-median(peerValues))>=4-1e-9&&outside>=3-1e-9;
 });
 if(candidates.length!==1)return unchanged();
 const candidate=candidates[0],peers=sources.filter(source=>source.id!==candidate.id),peerValues=peers.map(source=>source.value);
 const total=sources.reduce((sum,source)=>sum+source.weight,0);
 const policy=Object.fromEntries(sources.map(source=>[source.id,source.weight/total]));
 const baseWeight=policy[candidate.id],weight=baseWeight*.1,transferredWeight=baseWeight-weight;
 policy[candidate.id]=weight;policy.ecmwf+=transferredWeight;
 const peerMedian=median(peerValues);
 return {policy,temperatureAdjustment:{applied:true,version:TEMPERATURE_OUTLIER_VERSION,sourceId:candidate.id,recipientId:'ecmwf',baseWeight,weight,transferredWeight,
  peerIds:peers.map(source=>source.id),peerMedian,peerMin:Math.min(...peerValues),peerMax:Math.max(...peerValues),deviation:Math.abs(candidate.value-peerMedian)}};
}
