/** Newest verified NWS Area Forecast Discussion, never a backwards cache step.
 * Both routes are documented in the NWS OpenAPI. /latest returns product text;
 * the collection is independently checked for a newer, immutable product ID.
 */
export const DISCUSSION_SOURCE_VERSION='nws-afd-monotonic-v1';
const MINUTE=60000, MAX_AGE=12*60*MINUTE;
const stamp=ms=>new Date(ms).toISOString();
const validOffice=s=>typeof s==='string'&&/^[A-Z]{3}$/.test(s);
const productURL=s=>typeof s==='string'&&/^https:\/\/api\.weather\.gov\/products\/[A-Za-z0-9-]+$/.test(s);
function decodeProduct(data,office,time,indexRow=null){
  if(!data||typeof data.productText!=='string'||!data.productText.trim())return null;
  const issued=Date.parse(data.issuanceTime);
  if(!Number.isFinite(issued)||issued>time)return null;
  if(indexRow&&Date.parse(indexRow.issuanceTime)!==issued)return null;
  if(data.productCode&&data.productCode!=='AFD')return null;
  const issuing=String(data.issuingOffice||'').replace(/^K/,'').toUpperCase();
  if(issuing&&issuing!==office)return null;
  // A direct product must identify its type and office. Some legacy fixtures
  // omit these fields in a detail fetched from a type/office-scoped index.
  if(!indexRow&&(data.productCode!=='AFD'||issuing!==office))return null;
  const pil=data.productText.match(/^AFD([A-Z]{3})\s*$/m)?.[1];
  if(pil&&pil!==office)return null;
  const url=productURL(data['@id'])?data['@id']:typeof data.id==='string'&&/^[A-Za-z0-9-]+$/.test(data.id)?`https://api.weather.gov/products/${data.id}`:indexRow?.['@id'];
  if(!productURL(url))return null;
  return {id:data.id||url.split('/').at(-1),office,issuanceTime:data.issuanceTime,
    text:data.productText.replace(/\r/g,'').slice(0,26000),url};
}
export function createDiscussionSource({request,now=Date.now,ttl=2*MINUTE}={}){
  if(typeof request!=='function')throw new TypeError('A bounded official-source request function is required.');
  const offices=new Map();
  return async function loadDiscussion(office){
    const metaBase={id:'afd',label:`NWS ${office||''} discussion`,url:validOffice(office)?`https://api.weather.gov/products/types/AFD/locations/${office}/latest`:'https://api.weather.gov/products/types/AFD'};
    if(!validOffice(office))return {value:null,meta:{...metaBase,status:'unavailable',message:'Forecast office is unavailable.',fetchedAt:null,issuedAt:null}};
    if(!offices.has(office)){
      if(offices.size>=150)offices.delete(offices.keys().next().value);
      offices.set(office,{last:null,until:0,result:null,pending:null});
    }
    const state=offices.get(office);
    if(state.pending)return state.pending;
    if(state.until>now()&&(!state.last||now()-Date.parse(state.last.value.issuanceTime)<MAX_AGE))return state.result;
    state.pending=(async()=>{
      const at=now(),indexURL=metaBase.url.replace(/\/latest$/,'');
      const replies=await Promise.allSettled([request(metaBase.url,{timeout:7000,revalidate:true}),request(indexURL,{timeout:7000,revalidate:true})]);
      const candidates=[];
      if(replies[0].status==='fulfilled'){
        const product=decodeProduct(replies[0].value,office,at);
        if(product)candidates.push(product);
      }
      const index=replies[1].status==='fulfilled'?replies[1].value:null;
      // Some servers do not implement /latest; a response shaped like an index
      // can still be resolved through its immutable IDs, but is not a product.
      const otherIndex=replies[0].status==='fulfilled'?replies[0].value:null;
      const rows=[...(Array.isArray(index?.['@graph'])?index['@graph']:[]),...(Array.isArray(otherIndex?.['@graph'])?otherIndex['@graph']:[])]
        .filter(row=>row?.productCode==='AFD'&&productURL(row['@id'])&&Number.isFinite(Date.parse(row.issuanceTime))&&Date.parse(row.issuanceTime)<=at)
        .sort((a,b)=>Date.parse(b.issuanceTime)-Date.parse(a.issuanceTime));
      const unique=[...new Map(rows.map(row=>[row['@id'],row])).values()];
      const newestDirect=Math.max(...candidates.map(p=>Date.parse(p.issuanceTime)),-Infinity);
      // Bound source traffic. A direct validated product already establishes a
      // floor; only potentially newer index entries need their text retrieved.
      await Promise.all(unique.filter(row=>Date.parse(row.issuanceTime)>newestDirect).slice(0,3).map(async row=>{
        try{const p=decodeProduct(await request(row['@id'],{timeout:7000,revalidate:true}),office,at,row);if(p)candidates.push(p);}catch{/* retain another verified source */}
      }));
      candidates.sort((a,b)=>Date.parse(b.issuanceTime)-Date.parse(a.issuanceTime));
      const fetched=candidates[0]||null,previous=state.last;
      const regressed=!!(previous&&fetched&&Date.parse(fetched.issuanceTime)<Date.parse(previous.value.issuanceTime));
      if(fetched&&(!previous||Date.parse(fetched.issuanceTime)>=Date.parse(previous.value.issuanceTime))){
        state.last={value:fetched,fetchedAt:stamp(now())};
      }
      const chosen=state.last,age=chosen?now()-Date.parse(chosen.value.issuanceTime):Infinity;
      const status=!chosen?'unavailable':age>=MAX_AGE?'stale':'ready';
      const retrievalStatus=regressed?'regression-ignored':!fetched&&chosen?'last-verified':status==='ready'?'verified-latest':status;
      const message=status==='stale'?'The latest retrieved discussion exceeds the twelve-hour freshness limit; it is excluded from Dan’s take.'
        :regressed?'An older NWS response was ignored; the newest previously verified discussion is retained.'
        :!fetched&&chosen?'The newest-discussion check failed; retaining the previously verified discussion until its original expiry.'
        :!chosen?'No valid local NWS discussion could be retrieved.':'';
      state.result={value:status==='ready'?chosen.value:null,meta:{...metaBase,status,sourceVersion:DISCUSSION_SOURCE_VERSION,retrievalStatus,
        fetchedAt:chosen?.fetchedAt||null,checkedAt:stamp(now()),issuedAt:chosen?.value.issuanceTime||null,
        productUrl:chosen?.value.url||null,message}};
      state.until=now()+ttl;
      return state.result;
    })().finally(()=>{state.pending=null;});
    return state.pending;
  };
}
