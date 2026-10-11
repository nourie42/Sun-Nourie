const limitedStatuses=new Set(['unavailable','stale','not-configured','not-covered']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const labels={exposure:'UV/surface weather','air-quality':'Air quality',grid:'Precipitation totals',afd:'Local discussion',observation:'Station observation',hrrr:'HRRR',ecmwf:'ECMWF',nbm:'National Blend',alerts:'Official alerts'};
const issueText=feed=>`${labels[feed.id]||feed.label||feed.id} ${feed.status==='stale'?'stale':feed.status==='not-covered'?'limited for this location':feed.status==='not-configured'?'not configured':'unavailable'}`;

export function forecastSourceHealth(data) {
  const feeds=Array.isArray(data?.feeds)?data.feeds:[];
  const google=data?.comparison?.source==='google';
  const core=google?feeds.filter(feed=>feed.id?.startsWith('google-')):[
    {...feeds.find(feed=>feed.id==='nws'),id:'nws',label:'Daily forecast'},
    {...feeds.find(feed=>feed.id==='hourly'),id:'hourly',label:'Hourly forecast'}
  ];
  const forecastIssues=core.filter(feed=>feed.status!=='ready');
  if(google&&!core.length)forecastIssues.push({id:'google',label:'WeatherNext forecast',status:'unavailable'});
  for(const [id,label,usable] of [
    ['daily-data','Daily forecast',(data?.days||[]).some(day=>finite(day.high)||finite(day.low))],
    ['hourly-data','Hourly forecast',(data?.hours||[]).some(hour=>finite(hour.temperature))]
  ])if(!usable&&!forecastIssues.some(feed=>feed.id===(id==='daily-data'?'nws':'hourly')))forecastIssues.push({id,label,status:'unavailable'});
  const coreIds=new Set(core.map(feed=>feed.id));
  const extraIssues=feeds.filter(feed=>!coreIds.has(feed.id)&&limitedStatuses.has(feed.status));
  const requiredIssues=[...forecastIssues,...extraIssues.filter(feed=>feed.id==='alerts')];
  if(!forecastIssues.length&&!extraIssues.length)return {requiredIssues,note:''};
  const issueLabels=[...new Set([...forecastIssues,...extraIssues].map(issueText))];
  const summary=issueLabels.slice(0,3).join('; ')+(issueLabels.length>3?`; ${issueLabels.length-3} other source limitations`:'');
  const alertNote=extraIssues.some(feed=>feed.id==='alerts')?' Check weather.gov for official warnings.':'';
  return {requiredIssues,note:` \u00b7 ${forecastIssues.length?'':'Forecast available. '}${summary}. Details in Scientific Stuff below.${alertNote}`};
}
