/** Shared server/browser contract. No keyword-to-weather boilerplate fallback.
 * Only AI paraphrases of explicit, dated, still-relevant AFD evidence can appear.
 * Ambiguous timing is omitted, not guessed. Dates are anchored to source issuance,
 * including a retained section's own "As of" time, never to the time of retrieval.
 */
export const DAN_TAKE_VERSION = 'weather-nourie-dans-take-kid-clear-v9';
export const plainDanWording=text=>String(text||'').replace(/than (?:some |the )?(?:model )?runs (?:indicate|suggest|show)/gi,'than expected').replace(/\ba dry layer\b/gi,'dry air').replace(/\ba layer of dry air\b/gi,'dry air');
// Dan's Take is an outcome-first explanation for a ten-year-old, not a lightly
// edited forecast discussion. Keep this list broad so scientific mechanisms can
// never leak into the public card when the AI merely copies the source.
export const hasDanJargon=text=>/\b(?:convergence|divergence|troughs?|troughing|ridges?|ridging|subsidence|mid[ -]levels?|upper[ -]levels?|aloft|instability|shear|vorticity|shortwaves?|isentropic|baroclinic|cyclogenesis|anticyclones?|dewpoint|PWAT|HRRR|ECMWF|NBM|CAPE|QPF|synoptic|advection|deterministic|convection|guidance|ensembles?|runs|forcing(?: for ascent)?|airmass)\b|\bsinking air\b/i.test(text);
const H = 3600000, DAY = 24 * H, MAX_SOURCE_AGE = 12 * H;
const norm = v => String(v || '').replace(/\s+/g, ' ').trim();
const finite = Number.isFinite;
const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const dayPattern = 'Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?';
function localParts(ms, zone) {
  const p = new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
  const get = key => p.find(x => x.type === key).value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,hour:+get('hour'),minute:+get('minute')};
}
const addDays = (date, n) => new Date(Date.parse(date+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
const weekday = date => new Date(date+'T12:00:00Z').getUTCDay();
function wall(date, hour, zone, minute=0) {
  if(hour>=24)return wall(addDays(date,Math.floor(hour/24)),hour%24,zone,minute);
  const target=Date.parse(`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`);
  let guess=target;
  for(let i=0;i<5;i++){
    const p=localParts(guess,zone),got=Date.parse(`${p.date}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:00Z`);
    const change=target-got;guess+=change;if(!change)break;
  }
  return guess;
}
function partRange(date, part, zone) {
  const hours={morning:[6,12],afternoon:[12,18],evening:[18,24],night:[18,30],overnight:[18,30]};
  const [a,b]=hours[part]||[0,24];
  return {start:wall(date,a,zone),end:wall(date,b,zone),part:part||''};
}
const past = text => /\b(yesterday|last night|last (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|earlier today|previous day|already (?:passed|ended|moved|occurred)|has (?:already )?(?:passed|ended|departed)|had (?:been|passed|ended)|was uncertain|were uncertain|remained uncertain|uncertainty was|moved through|passed through)\b/i.test(text);
export function explicitForecastUncertainty(text) {
  const s=norm(text);
  if(!s||past(s)||/\b(?:no|little|minimal)\b[^.!?]{0,35}\b(?:uncertainty|forecast changes?)\b|\bhigh confidence\b/i.test(s))return false;
  return /\buncertain(?:ty|ties)?\b|\blow(?:er)? confidence\b|\bconfidence\b[^.!?]{0,35}\b(?:low|limited|poor)\b|\bforecast challenge\b|\b(?:models?|solutions?|guidance|ensembles?)\b[^.!?]{0,65}\b(?:disagree|differ|diverge|spread|uncertain)\w*\b|\b(?:differences|spread|disagreement)\b[^.!?]{0,50}\b(?:models?|solutions?|guidance|ensembles?)\b|\bforecast\b[^.!?]{0,50}\b(?:adjust|revis|chang|shift)\w*\b/i.test(s)
    || /\b(?:GFS|ECMWF|HRRR|NAM|NBM|GEFS|EPS)\b[^.!?]{0,110}\b(?:faster|slower|earlier|later|warmer|cooler|wetter|drier|farther|further)\b[^.!?]{0,110}\b(?:while|than|but|whereas)\b/i.test(s)
    || /\b(?:remains to be seen|not yet clear|not clear yet|still unclear)\b[^.!?]{0,130}\b(?:rain|QPF|precip|front|cloud|fog|wind|temp|timing|coverage)\w*/i.test(s)
    || /\bif\b[^.!?]{8,180}\b(?:could|may|might|would)\b/i.test(s)
    || /\b(?:could|may|might)\b[^.!?]{0,100}\b(?:shift|change|delay|speed up|slow down|arrive earlier|arrive later|higher than|lower than|warmer than|cooler than|wetter than|drier than|increase|decrease|limit|reduce|depend)\w*\b/i.test(s);
}
/** Resolve only explicit dates/dayparts; absence returns null, not "today". */
export function discussionPeriod(text, anchor, zone) {
  const s=norm(text);if(!s||past(s))return null;
  const base=localParts(anchor,zone),found=[];
  const re=new RegExp(`\\b(${dayPattern}|today|tomorrow|tonight|overnight|this morning|this afternoon|this evening)(?:\\s+(morning|afternoon|evening|night))?\\b`,'gi');
  for(const m of s.matchAll(re)){
    const word=m[1].toLowerCase();let date=base.date,part=m[2]?.toLowerCase()||'';
    if(word==='tomorrow')date=addDays(date,1);
    else if(word==='tonight')part='night';
    else if(word==='overnight'){part='night';if(base.hour<6)date=addDays(date,-1);}
    else if(word.startsWith('this '))part=word.slice(5);
    else if(!['today','tomorrow'].includes(word)){
      const dow=dayNames.findIndex(d=>d.toLowerCase().startsWith(word.slice(0,3)));
      if(dow<0)continue;
      date=addDays(date,(dow-weekday(date)+7)%7);
    }
    found.push({...partRange(date,part,zone),index:m.index});
  }
  for(const m of s.matchAll(/\b(?:this\s+)?weekend\b/gi)){
    const dow=weekday(base.date),saturday=addDays(base.date,dow===0?-1:(6-dow+7)%7);
    found.push({start:wall(saturday,0,zone),end:wall(addDays(saturday,2),0,zone),part:'',index:m.index});
  }
  if(!found.length)return null;
  const first=found.reduce((a,b)=>a.start<=b.start?a:b);
  const last=found.reduce((a,b)=>a.end>=b.end?a:b);
  // A source's explicit "until/by/through 6 AM Tuesday" expires at that time,
  // not at the end of Tuesday. Do not extend an already elapsed morning.
  const clock=/\b(?:until|by|through)\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i.exec(s);
  let end=last.end;
  if(clock){const p=localParts(last.start,zone),hour=(+clock[1]%12)+(clock[3].toLowerCase()==='pm'?12:0);end=wall(p.date,hour,zone,+(clock[2]||0));}
  const start=/^\s*(?:until|through|by)\b/i.test(s)?Math.min(anchor,first.start):first.start;
  return end>start?{start,end,part:found.length===1?first.part:''}:null;
}
export function sectionAnchor(body, issued, zone) {
  const m=new RegExp(`\\b(?:as of|issued at)\\s+(\\d{1,4})\\s*(AM|PM)\\s*(?:(?:[ECMP][DS]T|AK[DS]T|HST|UTC)\\s+)?(${dayPattern})?`,'i').exec(body.slice(0,350));
  if(!m)return issued;
  const digits=+m[1],hour=(Math.floor(digits>=100?digits/100:digits)%12)+(m[2].toLowerCase()==='pm'?12:0),minute=digits>=100?digits%100:0;
  if(hour>23||minute>59)return NaN;
  let date=localParts(issued,zone).date;
  if(m[3]){const dow=dayNames.findIndex(d=>d.toLowerCase().startsWith(m[3].toLowerCase().slice(0,3)));date=addDays(date,-((weekday(date)-dow+7)%7));}
  let time=wall(date,hour,zone,minute);
  if(time>issued+5*60000)time=wall(addDays(date,m[3]?-7:-1),hour,zone,minute);
  return time;
}
function sections(raw) {
  const re=/^\.([A-Z][A-Z /-]*?)(?:\s*\/([^/]+)\/)?\s*\.{3,}/gm,matches=[...raw.matchAll(re)];
  if(!matches.length)return [{name:'DISCUSSION',heading:'',body:raw}];
  return matches.map((m,i)=>({name:m[1].trim(),heading:norm(m[2]),body:raw.slice(m.index+m[0].length,matches[i+1]?.index??raw.length).split(/\b(?:PREVIOUS DISCUSSION|PREV DISCUSSION)\b/i)[0]}));
}
function sourceOf(data, now) {
  const d=data?.discussion,loc=data?.location;
  if(!d?.text||!loc?.timeZone||!d.office||!loc.office||d.office.toUpperCase()!==loc.office.toUpperCase())return null;
  if(data.feeds?.find(f=>f.id==='afd')?.status!=='ready')return null;
  try{new Intl.DateTimeFormat('en-US',{timeZone:loc.timeZone}).format(new Date(now));}catch{return null;}
  const issued=Date.parse(d.issuanceTime);
  if(!finite(issued)||issued>now||now-issued>MAX_SOURCE_AGE)return null;
  if(!d.id&&!d.url)return null;
  return {id:d.id||d.url,office:d.office,issuedAt:d.issuanceTime,locationKey:`${loc.latitude},${loc.longitude}`,expiresAt:new Date(issued+MAX_SOURCE_AGE).toISOString()};
}
export function collectDanTakeEvidence(data, now=Date.now()) {
  const source=sourceOf(data,now),candidates=[];
  if(!source)return {version:DAN_TAKE_VERSION,source:null,candidates,status:'discussion-not-current'};
  const issued=Date.parse(source.issuedAt),zone=data.location.timeZone,raw=data.discussion.text;
  for(const [si,section] of sections(raw).entries()){
    if(!/^(?:UPDATE|SYNOPSIS|NEAR TERM|SHORT TERM|LONG TERM|DISCUSSION|KEY MESSAGES|WEATHER SUMMARY|WHAT HAS CHANGED)$/.test(section.name))continue;
    const anchor=sectionAnchor(section.body,issued,zone);if(!finite(anchor)||issued-anchor>DAY)continue;
    const headingRange=discussionPeriod(section.heading,anchor,zone);
    const maxLead=section.name==='NEAR TERM'?36*H:section.name==='SHORT TERM'?96*H:8*DAY;
    if(headingRange&&(headingRange.end<=now||headingRange.end>anchor+maxLead))continue;
    const body=section.body.replace(/\b(?:As of|Issued at)[^\n]*(?:\n|$)/gi,'').replace(/\n\s*-\s+/g,'\n\n');
    for(const [pi,paragraph] of body.split(/\n\s*\n/).entries()){
      const sentences=norm(paragraph).split(/(?<=[.!?])\s+/).filter(Boolean);
      for(const [qi,quote] of sentences.entries()){
        if(quote.length<24||quote.length>850||past(quote)||!explicitForecastUncertainty(quote))continue;
        const previous=sentences[qi-1]||'',context=norm([previous,quote,sentences[qi+1]||''].join(' '));
        // Own timing takes priority; otherwise inherit the previous sentence or
        // the explicit section period. Never inherit a yesterday/last-night recap.
        const ownRange=discussionPeriod(quote,anchor,zone);
        if(!ownRange&&past(previous))continue;
        const range=ownRange||discussionPeriod(previous,anchor,zone)||headingRange;
        if(!range||range.end<=now||range.start>=now+8*DAY||range.end>anchor+maxLead)continue;
        if(!norm(raw).includes(quote))continue;
        const display=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',month:'short',day:'numeric'});
        const a=display.format(new Date(range.start)),b=display.format(new Date(range.end-1));
        const daysAhead=Math.round((Date.parse(localParts(range.start,zone).date+'T12:00Z')-Date.parse(localParts(now,zone).date+'T12:00Z'))/DAY);
        const prefix=daysAhead>=2&&daysAhead<=7?'This coming week — ':'';
        const period=prefix+(a===b?a+(range.part?` ${range.part}`:''):`${a} – ${b}`);
        candidates.push({id:`s${si}-p${pi}-q${qi}`,quote,context,section:section.name,sourcePeriod:section.heading,
          sectionIssuedAt:new Date(anchor).toISOString(),period,validFrom:new Date(range.start).toISOString(),
          eventEnd:new Date(range.end).toISOString(),validUntil:new Date(Math.min(range.end,issued+MAX_SOURCE_AGE)).toISOString()});
      }
    }
  }
  return {version:DAN_TAKE_VERSION,source,candidates:candidates.slice(0,64),status:candidates.length?'evidence-available':'no-explicit-future-change'};
}
function acceptableParaphrase(text, candidate) {
  if(hasDanJargon(text))return false;
  if(typeof text!=='string'||text.trim().length<15||text.length>120||text.trim().split(/\s+/).length>20||/[<>]|\d/.test(text))return false;
  if(/\b(yesterday|last night|earlier today|today|tonight|tomorrow)\b/i.test(text))return false;
  // A day explicitly present in the verified period is supported. An unrelated
  // weekday is rejected; ambiguous relative dates still come only from code.
  const mentioned=[...text.matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi)].map(m=>m[1].toLowerCase());
  if(mentioned.some(day=>!candidate.period.toLowerCase().includes(day)))return false;
  if(/forecast(?:s)? can change|no (?:major|meaningful|significant).*uncertaint|main sources? of forecast uncertainty|all clear|guaranteed|perfectly safe|\bforecasters?\s+(?:indicate|say|expect|think|believe|are unsure)|\b(?:HRRR|ECMWF|NBM|CAPE|QPF|synoptic|advection|deterministic|convection|guidance)\b/i.test(text))return false;
  // The adjacent sentences are part of the supplied, exact AFD excerpt. Using
  // only the middle sentence wrongly rejected a plain-English rain paraphrase
  // of 'front timing / PoPs / QPF'. Never borrow a phenomenon from a past recap.
  const evidence=norm([candidate.quote,...candidate.context.split(/(?<=[.!?])\s+/).filter(s=>!past(s))].join(' '));
  const topics=[[/\bfront\b/i,/\bfront|boundary/i],[/\bstorms?\b|thunder/i,/storm|thunder|convec/i],[/\brain\b|showers?/i,/rain|precip|shower|convec|PoPs|QPF/i],[/\bsnow\b/i,/snow|winter|frozen/i],[/\bfog\b/i,/fog|visib/i],[/\bcloud|clearing/i,/cloud|clear|stratus|sun/i],[/\bwind/i,/wind|breeze|gust/i],[/\btemperatures?|warmer|cooler|colder|hotter/i,/temp|warm|cool|cold|heat|highs|lows/i]];
  return !topics.some(([claim,support])=>claim.test(text)&&!support.test(evidence));
}
export function approveDanTake(proposals, data, now=Date.now()) {
  const context=collectDanTakeEvidence(data,now),seen=new Set(),items=[],rejected=[];
  for(const proposal of Array.isArray(proposals)?proposals:[]){
    const c=context.candidates.find(c=>c.id===proposal?.evidenceId),summary=plainDanWording(proposal?.summary);
    if(!c||seen.has(c.id)||!acceptableParaphrase(summary,c)){rejected.push({evidenceId:String(proposal?.evidenceId||'').slice(0,60),reason:!c?'unknown-evidence':seen.has(c.id)?'duplicate':'unsupported-paraphrase'});continue;}
    seen.add(c.id);items.push({evidenceId:c.id,summary:summary.trim(),period:c.period,sourceQuote:c.quote,
      section:c.section,sectionIssuedAt:c.sectionIssuedAt,validFrom:c.validFrom,eventEnd:c.eventEnd,validUntil:c.validUntil});
  }
  items.sort((a,b)=>Date.parse(a.validFrom)-Date.parse(b.validFrom));
  return {danTakeVersion:DAN_TAKE_VERSION,danTakeReview:{candidateCount:context.candidates.length,proposedCount:Array.isArray(proposals)?proposals.length:0,approvedCount:items.length,rejected},danTakeSource:context.source,danTakeStatus:items.length?'supported':context.status==='evidence-available'?'no-approved-change':context.status,forecastChanges:items.slice(0,6)};
}
export function visibleDanTakeItems(briefing, forecast, now=Date.now()) {
  if(briefing?.mode!=='ai'||briefing.danTakeVersion!==DAN_TAKE_VERSION||!forecast?.signature||briefing.signature!==forecast.signature)return [];
  const context=collectDanTakeEvidence(forecast,now),source=briefing.danTakeSource;
  if(!source||!context.source||JSON.stringify(source)!==JSON.stringify(context.source))return [];
  // An old quote, an ended interval or an old discussion must not survive a
  // cache hit, location change, new AFD, midnight or a suspended browser tab.
  const candidates=context.candidates;
  const verified=(Array.isArray(briefing.forecastChanges)?briefing.forecastChanges:[]).filter(item=>{
    const c=candidates.find(c=>c.id===item?.evidenceId);
    return c&&item.sourceQuote===c.quote&&item.validUntil===c.validUntil&&Date.parse(item.validUntil)>now;
  });
  return approveDanTake(verified,forecast,now).forecastChanges;
}
export function danTakeText(items){
  const groups=new Map();
  const cleanSummary=value=>norm(value).replace(/^(?:dan\s*['’]?\s*s\s+take\b\s*[:\-—–.]?\s*)+/i,'').trim();
  for(const item of Array.isArray(items)?items:[]){
    if(!item?.period||!item?.summary)continue;
    const summary=cleanSummary(item.summary);if(!summary)continue;
    if(!groups.has(item.period))groups.set(item.period,[]);
    const list=groups.get(item.period),key=summary.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if(!list.some(entry=>entry.key===key))list.push({key,text:summary});
  }
  // Distinct dates share one weekly label; retain every dated forecast below it.
  let comingWeekShown=false;
  return [...groups].map(([period,list])=>{
    const weeklyPrefix='This coming week — ';
    let label=period;
    if(period.startsWith(weeklyPrefix)){
      if(comingWeekShown)label=period.slice(weeklyPrefix.length);
      comingWeekShown=true;
    }
    return `${label}: ${list.map(x=>x.text).join(' ')}`;
  }).join('\n\n');
}

/** Reuse ONLY a previously approved take from the same exact discussion and
 * location. A changed numeric forecast signature is not a changed AFD. Full
 * outlook prose is intentionally excluded from this small source-bound object. */
export function rebindDanTake(previous,forecast,now=Date.now()){
  if(!previous||!forecast?.signature)return null;
  const rebound={...previous,signature:forecast.signature};
  const items=visibleDanTakeItems(rebound,forecast,now);
  if(!items.length)return null;
  return {mode:'ai',signature:forecast.signature,danTakeVersion:DAN_TAKE_VERSION,
    danTakeSource:rebound.danTakeSource,danTakeStatus:'supported',forecastChanges:items,
    generatedAt:previous.generatedAt||null,model:previous.model||null,reused:true};
}
