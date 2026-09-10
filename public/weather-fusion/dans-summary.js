import {hasDanJargon,collectDanTakeEvidence,visibleDanTakeItems,danTakeText,discussionPeriod,sectionAnchor,explicitForecastUncertainty} from './dans-take.js?v=clear-weather-daygraph-v3';
const norm=v=>String(v||'').replace(/\s+/g,' ').trim();
const dateKey=(time,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
function anchoredText(text,anchor,zone,now){
 if(dateKey(anchor,zone)===dateKey(now,zone))return text;
 const date=dateKey(anchor,zone),next=new Date(Date.parse(date+'T12:00Z')+86400000).toISOString().slice(0,10);
 const label=d=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}).format(new Date(d+'T12:00Z'));
 return text.replace(/\b(tomorrow|tonight|today|this morning|this afternoon|this evening)\b/gi,word=>{
  const w=word.toLowerCase();return label(w==='tomorrow'?next:date)+(w==='tonight'?' night':w.startsWith('this ')?' '+w.slice(5):'');
 });
}
const brief=text=>{const sentences=norm(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[];let result='';for(const s of sentences.slice(0,2)){if(result.length+s.length>440)break;result+=s+' ';}return result.trim();};
const plain=text=>norm(text).replace(/\bconvection\b/gi,'showers and storms').replace(/\bprecipitation\b/gi,'wet weather').replace(/\btemps\b/gi,'temperatures').replace(/\bPoPs\b/g,'rain chances').replace(/\bQPF\b/g,'rainfall amounts');
export function danOverview(briefing,forecast,now=Date.now()){
 if(!forecast)return {text:'Checking the latest forecast discussion…',source:'Updating'};
 const evidence=collectDanTakeEvidence(forecast,now);
 const zone=forecast.location?.timeZone||'America/New_York';
 const generated=Date.parse(briefing?.generatedAt||evidence.source?.issuedAt);
 const sameSource=briefing?.mode==='ai'&&briefing.signature===forecast.signature&&evidence.source&&Number.isFinite(generated)&&dateKey(generated,zone)===dateKey(now,zone)&&JSON.stringify(briefing.danTakeSource)===JSON.stringify(evidence.source);
 if(sameSource&&brief(briefing.summary))return {text:brief(briefing.summary),source:'From the local NWS discussion'};
 if(evidence.source){
  // SYNOPSIS is the NWS's own current overview; no historical section is recycled.
  const body=forecast.discussion.text.match(/^\.(?:SYNOPSIS|KEY MESSAGES)[^\n]*\n([\s\S]*?)(?=^\.[A-Z]|^&&|\$\$|(?![\s\S]))/m)?.[1]||'';
  const issued=Date.parse(evidence.source.issuedAt);
  const anchor=sectionAnchor(body,issued,zone);
  const synopsis=Number.isFinite(anchor)&&issued-anchor<=86400000?body.replace(/^\s*(?:As of|Issued at)[^\n]*(?:\n|$)/gmi,'').replace(/^\s*(?:\d+[).]|[-*])\s*/gm,''):'';
  const currentSentences=(norm(synopsis).match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]).filter(s=>{const period=discussionPeriod(s,anchor,zone);return !period||period.end>now;}).join(' ');
  if(brief(currentSentences))return {text:plain(anchoredText(brief(currentSentences),anchor,zone,now)),source:'Local NWS discussion summary'};
 }
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(now)));
 const day=forecast.days?.[0],text=brief((hour>=15?day?.nightDetail:day?.detail)||day?.detail||'');
 return {text:text||'The local forecast is temporarily unavailable. Please check the National Weather Service for the latest weather.',source:'NWS forecast · discussion summary unavailable'};
}
export function danCard(briefing,forecast,now=Date.now()){
 const items=[],parts=[];
 const compact=value=>norm(value).replace(/^(?:dan\s*['’]?\s*s\s+take\b\s*[:\-—–.]?\s*)+/i,'');
 const append=(item,summary)=>{
  const sentence=compact(summary),period=item.period.replace(/^This coming week — /,'');
  if(hasDanJargon(sentence)||!sentence||sentence.length>200||sentence.split(/\s+/).length>28)return false;
  const part=`${period}: ${sentence}`,combined=[...parts,part].join(' ');
  if(combined.length>380||combined.split(/\s+/).length>55)return false;
  items.push({...item,summary:sentence});parts.push(part);return true;
 };
 for(const item of visibleDanTakeItems(briefing?.danTake||briefing,forecast,now)){
  if(items.length===2)break;
  if(explicitForecastUncertainty(item.sourceQuote))append(item,item.summary);
 }
 let sourceExcerpt=null;
 if(!parts.length&&briefing?.mode!=='ai')for(const c of collectDanTakeEvidence(forecast,now).candidates){
  if(!explicitForecastUncertainty(c.quote))continue;
  let summary=plain(anchoredText(c.quote,Date.parse(c.sectionIssuedAt),forecast.location.timeZone,now));
  // Source-bound fallback states the explicit rain-coverage uncertainty, not
  // the technical mechanism. Unknown jargon is omitted, never pasted verbatim.
  if(/\bcoverage\b[^.!?]*\b(?:may|could|might)\b[^.!?]*\blimit/i.test(c.quote)&&/rain|shower|storm|convec/i.test(c.context)&&/subsidence|dry layer/i.test(c.quote))summary='Showers and storms may be less widespread than expected.';
  // A short, complete dated excerpt is allowed during an AI failure. No generic
  // overview, routine forecast or truncated half-sentence fills an empty card.
  if(append({...c,sourceQuote:c.quote},summary)){sourceExcerpt=c;break;}
 }
 const text=parts.join(' ');
 return {text,changes:text,items,sourceExcerpt,source:''};
}
