/** Regional snowfall is queried independently at each displayed cell. A local
 * point total is never interpolated or painted across the surrounding area. */
import {WINTER_MODELS, WINTER_WEIGHTS, normalizeWinterModel, winterIntervalAmount, blendWinterAmounts} from './weatherFusionWinterModels.js';

const HOUR=3600000, TTL=10*60000, STEP=.5, RADIUS=4;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const iso=value=>new Date(value).toISOString();
const fail=message=>Object.assign(new Error(message),{status:400});
const levels=[
  {value:.001,label:'Trace–0.1″',color:'#c4e8ff'},
  {value:.1,label:'0.1–1″',color:'#83c8ef'},
  {value:1,label:'1–2″',color:'#459fdd'},
  {value:2,label:'2–4″',color:'#2663b6'},
  {value:4,label:'4–6″',color:'#5549bf'},
  {value:6,label:'6″+',color:'#b754bd'},
];
const color=value=>[...levels].reverse().find(level=>value>=level.value)?.color||'#c4e8ff';

function validateSegments(raw,start,end){
  let rows;
  try{rows=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw fail('Invalid snowfall map periods.');}
  if(!Array.isArray(rows)||!rows.length||rows.length>2)throw fail('Choose one or two snowfall map periods.');
  let cursor=start;
  return rows.map(row=>{
    const from=Date.parse(row?.start),through=Date.parse(row?.end),models=row?.models;
    if(!finite(from)||!finite(through)||from!==cursor||through<=from||through>end||from%HOUR||through%HOUR)throw fail('Snowfall map periods must cover the selected day continuously.');
    if(!Array.isArray(models)||!models.length||models.length>2||new Set(models).size!==models.length||models.some(id=>!Object.hasOwn(WINTER_MODELS,id)))throw fail('Invalid snowfall map models.');
    const family=Object.values(WINTER_WEIGHTS).find(weights=>models.every(id=>Object.hasOwn(weights,id)));
    if(!family)throw fail('Snowfall map models must use the same forecast blend.');
    cursor=through;
    if(row===rows.at(-1)&&cursor!==end)throw fail('Snowfall map periods do not cover this day.');
    return {start:from,end:through,models:[...models].sort(),weights:Object.fromEntries(models.map(id=>[id,family[id]]))};
  });
}

export function modelSnowMapRequest(query={},now=Date.now()){
  const latitude=Number(query.lat),longitude=Number(query.lon),start=Date.parse(query.start),end=Date.parse(query.end);
  if(!finite(latitude)||!finite(longitude)||latitude<24||latitude>50||longitude<-125||longitude>-66)throw fail('Choose a location in the contiguous U.S.');
  if(!finite(start)||!finite(end)||start%HOUR||end%HOUR||end<=start||end-start>26*HOUR||start<Math.floor(now/HOUR)*HOUR-HOUR||end<=now||end>now+264*HOUR)throw fail('Choose a current snowfall forecast day.');
  const segments=validateSegments(query.segments,start,end);
  return {latitude,longitude,start,end,segments};
}

/** Day descriptors keep the actual available contributors and exact periods
 * already used by the point forecast, including a near-term/extended split. */
export function modelSnowMapDescriptor(day,location){
  if(!location||!finite(location.latitude)||!finite(location.longitude))return null;
  const period=day?.amountWindow||day?.displaySnowfall,start=Date.parse(period?.start),end=Date.parse(period?.end);
  if(!finite(start)||!finite(end)||end<=start)return null;
  const blend=day?.blend,windows=Array.isArray(blend?.windows)?blend.windows:[{start:blend?.window?.start,end:blend?.window?.end,snowfall:blend}];
  const segments=windows.map(window=>({start:window.start,end:window.end,models:(window.snowfall?.sources||[]).filter(source=>Object.hasOwn(WINTER_MODELS,source.id)&&finite(source.value)&&source.requestedWeight>0).map(source=>source.id)}));
  try{validateSegments(segments,start,end);}catch{return null;}
  const models=[...new Set(segments.flatMap(segment=>segment.models))];
  const label=models.map(id=>WINTER_MODELS[id].label).join(' / ');
  return {id:`model-snow-grid-${day.date}`,kind:'geojson',quantity:'snowfall',source:'model-grid',date:day.date,
    label:`${label} snow totals · ${day.date}`,title:'Model snowfall forecast',unit:'in',start:iso(start),end:iso(end),
    url:'/api/weather-fusion/winter-map?'+new URLSearchParams({kind:'model-grid',lat:String(location.latitude),lon:String(location.longitude),start:iso(start),end:iso(end),segments:JSON.stringify(segments)}),
    sourceUrl:'https://open-meteo.com/en/docs',description:'Regional snowfall depth from independently sampled model cells for this exact forecast day. Available requested model shares are normalized; this is model guidance, not an official WPC contour.'};
}

export function modelSnowMapSamples(latitude,longitude){
  const lat=Math.round(latitude/STEP)*STEP,lon=Math.round(longitude/STEP)*STEP,result=[];
  for(let y=-RADIUS;y<=RADIUS;y++)for(let x=-RADIUS;x<=RADIUS;x++){
    const latitude=lat+y*STEP,longitude=lon+x*STEP;
    if(latitude<24||latitude>50||longitude<-125||longitude>-66)continue;
    result.push({latitude,longitude,bounds:[Math.max(-125,longitude-STEP/2),Math.max(24,latitude-STEP/2),Math.min(-66,longitude+STEP/2),Math.min(50,latitude+STEP/2)]});
  }
  return result;
}

export function modelSnowRegionalUrl(samples,ids,start,end){
  return 'https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:samples.map(row=>row.latitude).join(','),longitude:samples.map(row=>row.longitude).join(','),
    models:ids.map(id=>WINTER_MODELS[id].model).join(','),hourly:'snowfall',timezone:'GMT',timeformat:'unixtime',
    start_date:iso(start).slice(0,10),end_date:iso(end).slice(0,10)});
}

function namedForecast(data,id){
  const field=`snowfall_${WINTER_MODELS[id].model}`;
  return {...data,hourly:{...data?.hourly,snowfall:data?.hourly?.[field]??data?.hourly?.snowfall},hourly_units:{...data?.hourly_units,snowfall:data?.hourly_units?.[field]??data?.hourly_units?.snowfall}};
}

export function regionalSnowAmount(data,metadata,request,sample,now){
  const models=Object.fromEntries([...new Set(request.segments.flatMap(row=>row.models))].map(id=>{
    try{return [id,normalizeWinterModel(namedForecast(data,id),metadata[id],id,sample,now)];}catch{return [id,null];}
  }));
  const parts=request.segments.map(segment=>{
    const values=Object.fromEntries(segment.models.map(id=>[id,winterIntervalAmount(models[id]?.intervals,segment.start,segment.end).value]));
    return {...blendWinterAmounts(values,segment.weights),start:iso(segment.start),end:iso(segment.end)};
  });
  return {value:parts.every(part=>finite(part.value))?parts.reduce((sum,part)=>sum+part.value,0):null,coverage:Math.min(...parts.map(part=>part.coverage)),parts};
}

export function regionalSnowCollection(rows,samples,metadata,request,now){
  if(!Array.isArray(rows)||rows.length!==samples.length)throw new Error('Regional snowfall source returned an incomplete grid.');
  const amounts=rows.map((row,index)=>regionalSnowAmount(row,metadata,request,samples[index],now));
  const cells=samples.slice(0,-1),usable=amounts.slice(0,-1).filter(row=>finite(row.value));
  if(!usable.length)throw new Error('Regional snowfall amounts are unavailable for this day.');
  const features=cells.flatMap((cell,index)=>{
    const amount=amounts[index];if(!finite(amount.value)||amount.value<.001)return [];
    const [west,south,east,north]=cell.bounds;
    return [{type:'Feature',geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]},
      properties:{value:amount.value,inches:amount.value,color:color(amount.value),opacity:.6,coverage:amount.coverage,source:'model-grid',latitude:cell.latitude,longitude:cell.longitude}}];
  });
  const ids=[...new Set(request.segments.flatMap(row=>row.models))],point=amounts.at(-1);
  return {type:'FeatureCollection',features,metadata:{quantity:'snowfall',unit:'in',source:'model-grid',title:'Model snowfall forecast',start:iso(request.start),end:iso(request.end),
    legend:levels,sourceUrl:'https://open-meteo.com/en/docs',models:ids.map(id=>({id,label:WINTER_MODELS[id].label,runAt:finite(metadata[id]?.last_run_initialisation_time)?iso(metadata[id].last_run_initialisation_time*1000):null})),
    segments:request.segments.map(row=>({start:iso(row.start),end:iso(row.end),models:row.models,weights:row.weights})),
    sampledCells:cells.length,availableCells:usable.length,zeroCells:usable.filter(row=>row.value<.001).length,
    point:{latitude:request.latitude,longitude:request.longitude,value:point.value,unit:'in',coverage:point.coverage},
    coverage:'Regional model samples on a 0.5-degree display grid; no spatial interpolation.',
    precision:'Each cell shows an independent model snowfall query, integrated over exactly this day. Available requested model shares are normalized within each period. Missing source shares are not filled with zero; WPC and WeatherNext are not part of this regional model grid.'}};
}

export function createModelSnowMapService({cached,now=Date.now}){
  const maps=new Map();
  return async query=>{
    const request=modelSnowMapRequest(query,now()),key=JSON.stringify(request),previous=maps.get(key);
    if(previous&&now()-previous.createdAt<TTL)return previous.task;
    if(maps.size>=24)maps.delete(maps.keys().next().value);
    const task=(async()=>{
      const cells=modelSnowMapSamples(request.latitude,request.longitude),samples=[...cells,{latitude:request.latitude,longitude:request.longitude}],ids=[...new Set(request.segments.flatMap(row=>row.models))];
      const [forecast,metaRows]=await Promise.all([
        cached(modelSnowRegionalUrl(samples,ids,request.start,request.end),TTL,{timeout:20000}),
        Promise.all(ids.map(async id=>{try{return [id,(await cached(`https://api.open-meteo.com/data/${WINTER_MODELS[id].domain}/static/meta.json`,5*60000,{timeout:12000})).data];}catch{return [id,null];}})),
      ]);
      return regionalSnowCollection(forecast.data,samples,Object.fromEntries(metaRows),request,now());
    })().catch(error=>{maps.delete(key);throw error;});
    maps.set(key,{createdAt:now(),task});return task;
  };
}
