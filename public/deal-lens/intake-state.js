(() => {
  const token=f=>[f.source||'',f.scope||'portfolio',f.siteName||'',f.period||'',f.key].join('|');
  function facts(deal){
    const rows=[...(deal.aiReview?.facts||[]),...(deal.reportedFacts||[])];
    for(const [key,record] of Object.entries(deal.facts||{}))for(const f of record.candidates||[])rows.push({...f,key});
    for(const source of deal.financialSources||[])for(const [key,value] of Object.entries(source.fields||{}))rows.push({key,value,source:source.source,period:source.period,scope:'portfolio',confidence:source.confidence||'medium'});
    const seen=new Set();return rows.filter(f=>{const key=token(f);if(!Number.isFinite(f.value)||seen.has(key))return false;seen.add(key);return true;});
  }
  function materials(deal){
    const seen=new Set();return (deal.materials||[]).map(r=>({...r,name:r.name.replace(/ · (?:page \d+(?:\.pdf)?|section \d+)(?:.*)?$/i,'')})).filter(r=>{const key=r.name.trim().toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  }
  const hasData=d=>!!(d.aiReview||(d.history||[]).length||(d.materials||[]).length||Object.keys(d.facts||{}).length);
  function remember(deal,newFacts){const byKey=new Map(facts(deal).map(f=>[token(f),f]));for(const f of newFacts||[])byKey.set(token(f),f);deal.reportedFacts=[...byKey.values()].slice(-500);}
  const uploadName=files=>files.length===1?files[0].name.replace(/^\d+-/,'').replace(/\.[^.]+$/,'').replace(/[-_]+/g,' '):'New deal';
  window.DealIntake={facts,materials,hasData,remember,token,uploadName};
})();
