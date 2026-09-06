/** The hero is always the current observation/estimate, never tonight's low. */
export function currentHero(forecast,isDay=true){
 const c=forecast?.current||{};
 return {temperature:typeof c.temperature==='number'&&Number.isFinite(c.temperature)?c.temperature:null,condition:c.condition||'Current conditions unavailable',isDay,tonight:false,range:''};
}
