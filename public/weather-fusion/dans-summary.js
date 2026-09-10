import {collectDanTakeEvidence,visibleDanTakeItems,danTakeText,discussionPeriod,sectionAnchor} from './dans-take.js?v=comfort-paws-uv-v1';
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
 const overview=danOverview(briefing,forecast,now);
 const items=visibleDanTakeItems(briefing?.danTake||briefing,forecast,now);
 let changes=danTakeText(items);
 // During AI/provider failures, a dated source excerpt still makes an explicitly
 // discussed possible change available, with its original timing and attribution.
 let sourceExcerpt=null;
 if(!changes){const c=collectDanTakeEvidence(forecast,now).candidates.find(c=>c.quote.length<=330);if(c){sourceExcerpt=c;changes=`${c.period}: ${plain(anchoredText(c.quote,Date.parse(c.sectionIssuedAt),forecast.location.timeZone,now))}`;}}
 return {...overview,changes,sourceExcerpt,source:overview.source+(sourceExcerpt?' · changes: NWS discussion excerpt':''),text:overview.text+(changes?'\n\nWatch for changes — '+changes:'')};
}
