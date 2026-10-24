/* Structured roster reading on this device. No model or network requests. */
(() => {
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  function read(rows,source='Pasted site table'){
    const result=[];
    for(let i=0;i<rows.length;i++){
      const header=rows[i],cols=Object.keys(header).filter(k=>k!=='_row');
      const find=re=>cols.find(c=>re.test(norm(header[c])));
      const name=find(/^(?:(?:asset|site|store|location) )?name$|^(?:asset|site|store|location)$/),address=find(/^(?:street )?address$/);
      if(!name||!address)continue;
      const id=find(/^(?:(?:asset|site|store|location|model) )?id(?: number)?$|^id $|^store no$|^site no$/),city=find(/^city$/),state=find(/^state$/),zip=find(/^zip(?: code)?$/),division=find(/^division$|^asset type$|^type$/),channel=find(/^channel(?: of trade)?$/),owner=find(/^(?:re |real estate |legal )?owner(?:ship)?$/),tenure=find(/^(?:(?:re|real estate) )?control$|^tenure$|^owned or leased$/);
      // Workbooks often split RE / Owner and RE / Control across two rows.
      const prev=rows[i-1]||{};
      const own=owner||cols.find(c=>/owner/.test(norm(prev[c])+' '+norm(header[c]))),control=tenure||cols.find(c=>/control/.test(norm(prev[c])+' '+norm(header[c])));
      for(let j=i+1;j<rows.length;j++){
        const r=rows[j],n=String(r[name]||'').trim(),a=String(r[address]||'').trim();
        if(!n||!a||/^(?:total|subtotal|asset name|site name)$/i.test(n)||!/[0-9]/.test(a))continue;
        const location=[a,r[city],r[state],r[zip]].filter(Boolean).join(', ');
        result.push({id:String(r[id]||'').trim(),name:n,address:location,division:String(r[division]||''),channel:String(r[channel]||''),owner:String(r[own]||''),tenure:String(r[control]||''),source:source+(r._row?'!'+r._row:''),notes:''});
      }
      break;
    }
    const seen=new Set();return result.filter(r=>{const k=(r.id+'|'+r.name+'|'+r.address).toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
  }
  function merge(deal,sites){
    deal.sites||=[];deal.siteClues||=[];
    for(const r of sites||[]){
      const existing=deal.sites.find(s=>(r.id&&s.id===r.id)||s.name?.toLowerCase()===r.name.toLowerCase());
      if(existing){for(const [k,v] of Object.entries(r))if(v&&!existing[k])existing[k]=v;}
      else deal.sites.push({...r,ebitda:'',gallons:'',route:'Unassigned',reason:r.address});
      const clue=deal.siteClues.find(s=>s.name?.toLowerCase()===r.name.toLowerCase());
      if(clue)Object.assign(clue,Object.fromEntries(Object.entries(r).filter(([,v])=>v)));
      else deal.siteClues.push({...r,snippets:[r.division,r.tenure,r.owner].filter(Boolean)});
    }
  }
  const counts=sites=>{const nonRetail=sites.filter(s=>/commercial|bulk|terminal|warehouse/i.test(s.division||s.name||'')).length;return {assets:sites.length,sites:sites.length-nonRetail,nonRetail};};
  globalThis.DealRoster={read,merge,counts};
})();
