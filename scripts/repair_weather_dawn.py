from pathlib import Path
import re

def edit(path,old,new):
 p=Path(path);s=p.read_text()
 if s.count(old)!=1:raise RuntimeError(f'{path}: expected one anchor, found {s.count(old)}: {old[:110]}')
 p.write_text(s.replace(old,new))

p='public/weather-fusion/dans-take.js'
edit(p,'weather-nourie-dans-take-integrity-v2','weather-nourie-dans-take-dawn-v1')
edit(p,"const dayPattern = 'Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?';","const dayPattern = 'Sun(?:day)?|Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:rs|rsday)?|Fri(?:day)?|Sat(?:urday)?';")
edit(p,'  if(!found.length)return null;',r'''  if(!found.length){
    const groups=[[/\b(?:mid[ -]?week|middle of (?:the )?week)\b/i,[3,4]],[/\b(?:late (?:in )?(?:the )?week|later (?:this|in the) week|end of (?:the )?week)\b/i,[4,5]],[/\b(?:this |the |upcoming )?weekend\b/i,[6,0]]];
    for(const [re,days] of groups)if(re.test(s)){
      const first=addDays(base.date,(days[0]-weekday(base.date)+7)%7);
      days.forEach((day,index)=>found.push({...partRange(addDays(first,index),'',zone),index:s.search(re)}));
      break;
    }
  }
  if(!found.length)return null;''')
edit(p,"return end>start?{start,end,part:found.length===1?first.part:''}:null;","return end>start?{start,end,part:found.length===1?first.part:'',startPart:first.part,endPart:last.part}:null;")
edit(p,"        const previous=sentences[qi-1]||'',context=norm([previous,quote,sentences[qi+1]||''].join(' '));","        const previous=sentences[qi-1]||'',context=norm([previous,quote,sentences[qi+1]||''].filter(s=>!past(s)).join(' '));")
edit(p,"        const period=prefix+(a===b?a+(range.part?` ${range.part}`:''):`${a} – ${b}`);","        const period=prefix+(a===b?a+(range.part?` ${range.part}`:''):`${range.startPart?a.replace(',',` ${range.startPart},`):a} into ${range.endPart?b.replace(',',` ${range.endPart},`):b}`);")
edit(p,"if(briefing?.mode!=='ai'||","if((briefing?.danTakeMode||briefing?.mode)!=='ai'||")
with Path(p).open('a') as f:f.write('''
export function combineDanTake(briefing, take, forecast, now=Date.now()) {
  if(!take||take.signature!==forecast?.signature)return briefing;
  const items=visibleDanTakeItems(take,forecast,now);
  if(take.mode==='unavailable'&&visibleDanTakeItems(briefing,forecast,now).length)return briefing;
  return {...briefing,danTakeMode:take.mode,danTakeVersion:take.danTakeVersion,danTakeSource:take.danTakeSource,
    danTakeStatus:take.danTakeStatus,danTakeReview:take.danTakeReview,danTakeDiagnostic:take.danTakeDiagnostic,
    forecastChanges:items,uncertainty:danTakeText(items)};
}
''')

p='src/weatherFusion.js'
edit(p,'import {stationWeather',"import {createDanTakeService} from './weatherFusionDanTake.js';\nimport {stationWeather")
edit(p,"result.integrityVersion='weather-nourie-integrity-v1';","result.integrityVersion='weather-nourie-integrity-v1';\n      result.dawnVersion='weather-nourie-dawn-v1';")
edit(p,"    const briefingKey=`${DAN_TAKE_VERSION}:${data.signature}:${dateKey(now(),data.location.timeZone)}`;\n    const briefing = await aiCache.get(briefingKey, 30 * MINUTE, async () => {",'''    // Cache prose by the actual discussion/forecast, not station fluctuations.
    // New source text, model runs, local date and forecast period invalidate it.
    const part=Math.floor(Number(new Intl.DateTimeFormat('en-US',{timeZone:data.location.timeZone,hour:'numeric',hourCycle:'h23'}).format(new Date(now())))/6);
    const briefingKey=hash({version:DAN_TAKE_VERSION,point:key,discussion:data.discussion?.id,
      day:dateKey(now(),data.location.timeZone),part,forecast:data.days.map(d=>[d.date,d.detail,d.nightDetail,d.condition,d.nightCondition]),
      models:data.modelContributions.map(m=>[m.id,m.runAt])});
    const briefing = await aiCache.get(briefingKey, 60 * MINUTE, async () => {''')
edit(p,"const activeChanges=visibleDanTakeItems(briefing,data,now());","const activeChanges=visibleDanTakeItems({...briefing,signature:data.signature},data,now());")
edit(p,"return {...briefing,forecastChanges:activeChanges,uncertainty:danTakeText(activeChanges)};","return {...briefing,signature:data.signature,forecastChanges:activeChanges,uncertainty:danTakeText(activeChanges)};")
edit(p,"  const getBulletins=createBulletinService({getForecast,request,env,now});",'''  const takeService=createDanTakeService({request,env,now,claimRequest:()=>{
    const day=new Date(now()).toISOString().slice(0,10);
    if(aiBudget.day!==day)aiBudget={day,count:0};
    const raw=Number(env.WEATHER_FUSION_AI_DAILY_LIMIT||96),limit=finite(raw)?Math.max(0,Math.min(500,raw)):96;
    if(aiBudget.count>=limit)return false;
    aiBudget.count++;return true;
  }});
  async function getDanTake(query){
    const data=await getForecast(query);
    if(query.signature&&query.signature!==data.signature)throw errorWithStatus('The source forecast changed. Refresh before requesting Dan take.',409);
    return takeService(data);
  }
  const getBulletins=createBulletinService({getForecast,request,env,now});''')
edit(p,'return { getForecast, getBriefing, getBulletins, search, radar, modelMaps: direct.maps };','return { getForecast, getBriefing, getDanTake, getBulletins, search, radar, modelMaps: direct.maps };')
edit(p,"'weather-repair.css','utci.js'","'weather-repair.css','utci.js','dans-take.js','outdoor-feels.js','source-transition.js'")
edit(p,"  app.get('/api/weather-fusion/briefing', route(service.getBriefing));","  app.get('/api/weather-fusion/briefing', route(service.getBriefing));\n  app.get('/api/weather-fusion/dans-take', route(service.getDanTake));")

p='public/weather-fusion/app.js'
edit(p,'DAN_TAKE_VERSION,visibleDanTakeItems,danTakeText','DAN_TAKE_VERSION,visibleDanTakeItems,danTakeText,combineDanTake')
edit(p,'import {weatherIcon',"import {renderSourceTransition} from './source-transition.js';\nimport {weatherIcon")
edit(p,'let lastRadarFetch = 0, currentBriefing = null, requestController = null;','let lastRadarFetch = 0, currentBriefing = null, currentDanTake = null, requestController = null;')
edit(p,'function render(data) {\n  forecast = data;', '''function render(data) {
  // Station-only updates preserve a take only after exact source revalidation.
  if(currentDanTake){
    const candidate={...currentDanTake,signature:data.signature};
    currentDanTake=visibleDanTakeItems(candidate,data,Date.now()).length?candidate:null;
  }
  forecast = data;''')
edit(p,'function renderHours(data) { renderHourlyWeather(data,Date.now()); }','function renderHours(data) { renderHourlyWeather(data,Date.now()); renderSourceTransition(data,Date.now()); }')
edit(p,'function renderBriefing(data) {\n  currentBriefing = data;',"function renderBriefing(data) {\n  if(typeof currentDanTake!=='undefined')data=combineDanTake(data,currentDanTake,forecast,Date.now());\n  currentBriefing = data;")
edit(p,'    // Official notices are rendered synchronously; AI explanations never delay them.', '''    // A small source-cached take request is independent of the longer outlook.
    // A slow or failed outlook cannot erase valid current-discussion evidence.
    if(data.aiConfigured&&!(currentDanTake?.mode==='ai'&&currentDanTake.signature===data.signature)){
      api('dans-take',query({signature:data.signature}),requestController.signal).then(take=>{
        if(id!==generation||take.signature!==forecast?.signature)return;
        currentDanTake=take;
        renderBriefing(currentBriefing||{signature:data.signature,mode:'nws-summary',sources:['nws']});
      }).catch(error=>{if(id===generation&&error.name!=='AbortError')console.warn('Dan take request unavailable:',error.status||error.name);});
    }
    // Official notices are rendered synchronously; AI explanations never delay them.''')
edit(p,'  currentBriefing = null;\n  resetExperience();','  currentBriefing = null;currentDanTake=null;\n  resetExperience();')
edit(p,"  $('hourly').innerHTML = '<p class=\"muted\">Loading hourly forecast…</p>';","  $('hourly').innerHTML = '<p class=\"muted\">Loading hourly forecast…</p>';\n  if($('hourly-source-note')){$('hourly-source-note').hidden=true;$('hourly-source-note').innerHTML='';}")
edit(p,"'Hidden: no approved, dated, still-upcoming change is available from the current local discussion.'","data.danTakeDiagnostic?`Temporarily unavailable (${data.danTakeDiagnostic}). This does not mean the discussion has no forecast-changing factors.`:'No locally applicable, dated, still-upcoming change is approved from this discussion.'")
p='public/weather-fusion/index.html'
s=Path(p).read_text()
edit(p,re.search(r'app\.js\?v=[^"\s]+',s)[0],'app.js?v=16-dawn-discussion')
edit(p,re.search(r'hourly-feels\.css\?v=[^"\s]+',s)[0],'hourly-feels.css?v=5-dawn')
edit(p,'Hourly data is loading.</p></div></section>','Hourly data is loading.</p></div><div id="hourly-source-note" class="hourly-source-note" hidden></div></section>')
p='public/weather-fusion/personal-details.js'
edit(p,'import {forecastGrossLevel}',"import {solarEffectText} from './source-transition.js';\nimport {forecastGrossLevel}")
edit(p,'<span>${label} · ${period}</span></figcaption>','<span>${label} · ${period}</span><span class="solar-impact">${esc(solarEffectText(comfort))}</span></figcaption>')
edit('src/weatherFusionHourlyFeels.js','if(hour){hour.skyCover=','if(hour){hour.humidity=humidity;hour.dewpoint=dewpoint;hour.isDay=sun.daylight;hour.skyCover=')
with Path('public/weather-fusion/hourly-feels.css').open('a') as f:f.write('''
.hourly-source-note{margin-top:16px;border-top:1px solid rgba(200,222,246,.15);padding-top:12px;text-align:left;color:#c5daee;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.hourly-source-note p{margin:0 0 10px}.hourly-source-note summary{cursor:pointer;font-weight:650;color:#e7f1ff;padding:4px 0}.hourly-source-note details p:first-of-type{margin-top:10px}
.sun-person .solar-impact{display:block;margin:10px auto 0;font-size:12px!important;line-height:1.45;font-weight:500;max-width:240px;color:#c4e4f5}
''')
for p in Path('public/weather-fusion').glob('*.js'):
 s=p.read_text();updated=re.sub(r"(\./(?:weather-display|hourly-feels|personal-details|experience|dans-take|source-transition)\.js)(?:\?v=[^'\"]*)?(?=['\"])",r'\1?v=dawn-v1',s)
 if updated!=s:p.write_text(updated)
p=Path('test/weatherFusionForecastDetails.test.js');s=p.read_text()
s,n=re.subn(r'app\\\.js\\\?v=integrity-v[12]',r'app\\.js\\?v=16-dawn-discussion',s)
if n!=1:raise RuntimeError('Expected one frontend cache-version assertion')
p.write_text(s)
print('Applied guarded patch: independent source-bound take and source diagnostics; thermal equations unchanged.')
