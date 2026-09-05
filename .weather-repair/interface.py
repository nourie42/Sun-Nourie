from pathlib import Path
root=Path('public/weather-fusion')
p=root/'index.html';s=p.read_text()
assert 'data-direct-model' in s, 'Unexpected weather page base'
a=s.find('  <script>')
if a>=0:s=s[:a]+'</body>\n</html>\n'
s=s.replace('<iframe id="model-map" title="Model weather map" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen hidden></iframe>', '<div id="model-map" hidden></div>')
a=s.index('          <div class="map-tabs"');b=s.index('          <div class="map-stage"',a)
s=s[:a]+'''          <div class="map-tabs" role="group" aria-label="Weather map layer">
            <button class="selected" data-layer="radar" aria-pressed="true">Live radar</button><button data-layer="hrrr" aria-pressed="false">HRRR</button><button data-layer="ecmwf" aria-pressed="false">ECMWF rain</button><button data-layer="nbm" aria-pressed="false">NBM rain</button><button data-layer="temperature" aria-pressed="false">Temperature</button><button data-layer="wind" aria-pressed="false">Wind</button><button data-layer="clouds" aria-pressed="false">Clouds</button>
          </div>
'''+s[b:]
s=s.replace('NWS · next 48 hours', 'Fusion temperatures · NWS rain chance')
s=s.replace('Daytime high · overnight low. Blue percentages', 'Blended daytime high · overnight low. Blue percentages')
a=s.index('        <details class="evidence-detail"><summary>Models, timing');b=s.index('\n      </section>',a)
s=s[:a]+'''        <details class="evidence-detail"><summary>Models, timing & forecast policy</summary><p id="methodology"></p><div class="policy-grid"><div><strong>Models actually used</strong><p>HRRR, ECMWF IFS and NOAA NBM point values are decoded from provider GRIB2 data. Model initialization, coverage and availability are checked before contributing. The two saved locations have native model inputs; other searched locations retain NWS coverage.</p></div><div><strong>AI explains the evidence</strong><p>The AI receives the blended numbers, individual model estimates, HRRR simulated reflectivity and latest local NWS discussion. It cannot change numeric cards or official alerts. Starting blend weights are not a statistically calibrated skill ranking.</p></div><div><strong>Precipitation windows</strong><p>The main metric shows the next 24 hours. Daily cards show the remaining period through 7 AM, or complete 7 AM–7 AM future days. Totals are liquid equivalent, not measured rainfall. Interpolation within coarse model intervals does not establish storm arrival times.</p></div></div><p class="muted" id="google-status">Google WeatherNext is not currently included: approved forecast dataset access is required. A text-generation model is not a substitute for numerical weather data.</p><p class="muted">Map images use the same decoded runs as the point inputs. HRRR reflectivity is a forecast, not live radar. ECMWF rain accumulates from its model initialization; NBM rain uses the interval shown under the map. Cloud/wind/temperature maps use ECMWF. Regional map coverage: North Carolina and surrounding areas.</p><p class="muted">External comparisons: <a href="https://weather.us/model-charts/rapid-us/north-carolina/radar-reflectivity.html" target="_blank" rel="noopener noreferrer">Weather.us HRRR ↗</a> · <a href="https://weather.us/model-charts/euro/north-carolina/acc-total-precipitation.html" target="_blank" rel="noopener noreferrer">Weather.us ECMWF ↗</a>. These references do not supply the numeric forecast and are not embedded.</p><div id="source-register"></div></details>'''+s[b:]
s=s.replace('NOAA/NCEP HRRR & NBM · ECMWF Open Data · Weather.us user-selected model visualization · Windy', 'NOAA/NCEP HRRR & NBM · ECMWF Open Data (CC BY 4.0)')
s=s.replace('Weather.us model pages are loaded only when you select those model tabs.', 'Weather model maps are generated from public provider data, not embedded third-party webpages.')
s=s.replace('/weather-fusion/style.css"','/weather-fusion/style.css?v=2-direct"').replace('/weather-fusion/app.js"','/weather-fusion/app.js?v=2-direct"')
assert '<iframe' not in s
p.write_text(s)
p=root/'app.js';s=p.read_text()
s=s.replace("let lastRadarFetch = 0, currentBriefing", "let modelCatalog = null, modelFetched = 0, modelFrames = [], modelIndex = 0, modelLayer = null, mapSelectionToken = 0, modelFrameToken = 0;\nlet lastRadarFetch = 0, currentBriefing")
s=s.replace("'Model-derived apparent temperature; not an observed measurement.'", "c.apparentSource || 'Feels-like calculation unavailable.'")
s=s.replace("card('PRECIPITATION', 'drop', finite(d.qpf) ? `${number(d.qpf, 2)}<small>in</small>` : '—', `7 AM–7 AM · ${d.qpfSource}. Full-window liquid equivalent.`)", "card('PRECIPITATION', 'drop', finite(data.precipitation?.value) ? `${number(data.precipitation.value, 2)}<small>in</small>` : '—', `Next 24 hours from ${clock(data.precipitation?.start)} · ${data.precipitation?.source || 'Unavailable'}. Forecast liquid equivalent.`)")
s=s.replace('Sunrise and sunset appear when the model data connection is configured.', 'Astronomical times are temporarily unavailable.')
s=s.replace('`Sunrise ${clock(data.solar.sunrise)} · local time.`','`Sunrise ${clock(data.solar.sunrise)} · calculated local time.`')
s=s.replace("const names = { ready: 'Available', unavailable: 'Unavailable', stale: 'Stale', 'not-configured': 'Setup required' };", "const names = { ready: 'Available', unavailable: 'Unavailable', stale: 'Stale — excluded', 'not-covered': 'NWS-only location' };")
s=s.replace("${labels[id]} · ${names[f?.status] || 'Unavailable'}</span>", "${labels[id]} · ${f?.contributes ? 'Contributing' : names[f?.status] || 'Unavailable'}${f?.contributes && f.issuedAt ? `<small>Run ${esc(clock(f.issuedAt, { month: 'short', day: 'numeric' }))}</small>` : ''}</span>")
s=s.replace("'AI + NWS DISCUSSION'", "'AI + NUMERICAL MODELS'")
s=s.replace(r"(?:customer-)?api\.open-meteo\.com", r"www\.nco\.ncep\.noaa\.gov|www\.ecmwf\.int")
s=s.replace("if (moveMap && selectedLayer !== 'radar') loadModelMap();", "if (selectedLayer !== 'radar' && (moveMap || Date.now()-modelFetched > 120000)) void loadModelMap();")
a=s.index('function showDay(');b=s.index('function setBasemap()',a)
s=s[:a]+'''function showDay(index) {
  const d = forecast?.days[index];
  if (!d) return;
  const names = { hrrr: 'NOAA HRRR', ecmwf: 'ECMWF IFS · 0.25°', nbm: 'NOAA National Blend' };
  const modelRows = Object.entries(d.guidance).map(([id,v])=>`<tr><td>${names[id] || esc(id)}</td><td>${temperature(v.high)} / ${temperature(v.low)}</td><td>${inches(v.qpf)}</td><td>${finite(v.gust)?`${number(v.gust)} mph`:'—'}</td></tr>`).join('');
  const weights = (blend) => (blend?.sources || []).map(x=>`${x.id.toUpperCase()} ${Math.round(x.weight*100)}%`).join(' / ') || 'Unavailable';
  $('day-content').innerHTML = `<div class="dialog-eyebrow">${esc(d.date)} · Weather Fusion</div><h2 id="day-title" class="dialog-title">${esc(d.label==='Today'?'Today & tonight':d.label)}</h2><p class="dialog-condition">${esc(d.condition)}</p><div class="dialog-temps">${temperature(d.high)}<span>${temperature(d.low)}</span></div><div class="dialog-stats"><div><strong>${percent(d.popDay)} / ${percent(d.popNight)}</strong><small>Official NWS chance · day / night</small></div><div><strong>${inches(d.qpf)}</strong><small>${esc(d.qpfWindowLabel || 'Forecast window')}</small></div></div><p class="dialog-prose"><strong>Official NWS detail:</strong> ${esc(d.detail || 'Unavailable')}</p>${d.nightDetail && d.nightDetail!==d.detail?`<p class="dialog-prose"><strong>Tonight:</strong> ${esc(d.nightDetail)}</p>`:''}<h3 class="dialog-subtitle">Source comparison · ${esc(d.agreement)}</h3><table class="comparison"><thead><tr><th>Source</th><th>High / low</th><th>Precipitation</th><th>Peak gust</th></tr></thead><tbody><tr><td><strong>Weather Fusion</strong></td><td>${temperature(d.high)} / ${temperature(d.low)}</td><td>${inches(d.qpf)}</td><td>—</td></tr><tr><td>NWS official</td><td>${temperature(d.official?.high)} / ${temperature(d.official?.low)}</td><td>${inches(d.qpfBlend?.sourceValues?.nws)}</td><td>—</td></tr>${modelRows}</tbody></table><p class="table-note"><strong>Temperature blend:</strong> high ${esc(weights(d.highBlend))}; low ${esc(weights(d.lowBlend))}.</p><p class="table-note"><strong>Precipitation blend:</strong> ${esc(d.qpfSource)}. ${esc(clock(d.qpfWindow.start,{month:'short',day:'numeric'}))} → ${esc(clock(d.qpfWindow.end,{month:'short',day:'numeric'}))}.</p><p class="table-note">Model temperatures are aligned to NWS daytime / overnight forecast periods. Missing coverage is not zero. Coarse model precipitation intervals are prorated at window boundaries. These are forecast values, not measured accumulation.</p><p class="table-note">Starting blend weights are uncalibrated; model agreement is not an accuracy probability. Official NWS rain probability and warnings remain separate.</p>`;
  $('day-dialog').showModal();
}
''' + s[b:]
a=s.index('async function loadRadar()');b=s.index("$('refresh').addEventListener",a)
s=s[:a]+'''async function loadRadar() {
  const id = ++radarGeneration;
  lastRadarFetch = Date.now();
  try {
    const data = await api('radar');
    if (id !== radarGeneration) return;
    radarMeta = data; frames = data.frames || [];
    frameIndex = Math.max(0, frames.length-1);
    if (selectedLayer !== 'radar') return;
    configureFrames(frames.length,frameIndex);
    if (!frames.length) { if(radarLayer){map?.removeLayer(radarLayer);radarLayer=null;} $('radar-stamp').textContent='Unavailable'; mapMessage(data.message); return; }
    showFrame(frameIndex);
  } catch { if(id===radarGeneration && selectedLayer==='radar'){stopRadar();mapMessage('Radar timestamps could not be verified. Check the official radar link.');} }
}
function configureFrames(count,index=0) {
  $('radar-time').max=String(Math.max(0,count-1));$('radar-time').value=String(index);$('radar-time').disabled=!count;$('radar-play').disabled=count<2;
}
function showFrame(index) {
  if(selectedLayer!=='radar'||!map||!window.L||!radarMeta||!frames[index])return;
  frameIndex=index;
  if(radarLayer)map.removeLayer(radarLayer);
  const expected=frames[index];
  radarLayer=window.L.tileLayer.wms(radarMeta.url,{layers:radarMeta.layer,format:'image/png',transparent:true,version:'1.1.1',opacity:.72,time:expected,zIndex:200,attribution:'Observed radar © NOAA / NWS',updateWhenIdle:true}).addTo(map);
  $('radar-time').value=String(index);$('radar-stamp').textContent=`${clock(expected)} · loading`;
  radarLayer.on('load',()=>{if(selectedLayer==='radar'&&frames[frameIndex]===expected){$('radar-stamp').textContent=clock(expected);mapMessage(radarMeta.status==='stale'?'Radar is stale; check its timestamp.':'');}});
  radarLayer.on('tileerror',()=>{if(selectedLayer==='radar'){stopRadar();mapMessage('A radar tile failed to load. Blank areas do not establish clear weather.');}});
}
function stopRadar(){if(radarTimer)clearInterval(radarTimer);radarTimer=null;$('radar-play').textContent='▶';$('radar-play').setAttribute('aria-label','Play map animation');}
function modelCaption(layer,frame){
  const type=selectedLayer==='hrrr'?'Forecast reflectivity (not observed radar)':selectedLayer==='ecmwf'?'Accumulated precipitation since initialization':selectedLayer==='nbm'?'Interval precipitation':selectedLayer==='temperature'?'2 m temperature':selectedLayer==='wind'?'10 m wind speed':'Total cloud cover';
  const pointRun=forecast?.modelContributions?.find(m=>m.id===layer.model)?.runAt;
  const mismatch=pointRun && Date.parse(pointRun)!==Date.parse(layer.runAt)?' · Map and point forecast have different run times; refresh the forecast.':'';
  const interval=frame.field==='precipitation'?` · ${clock(frame.start,{month:'short',day:'numeric'})} → ${clock(frame.end,{month:'short',day:'numeric'})}`:'';
  return `${layer.label} · ${type} · ${frame.units}${interval} · run ${clock(layer.runAt,{month:'short',day:'numeric'})}${mismatch}`;
}
async function loadModelMap(){
  const token=++mapSelectionToken,layerName=selectedLayer;
  if(layerName==='radar')return;
  try{
    if(!modelCatalog||Date.now()-modelFetched>120000){modelCatalog=await api('models');modelFetched=Date.now();}
    if(token!==mapSelectionToken||selectedLayer!==layerName)return;
    const layer=modelCatalog.layers[layerName];modelFrames=layer?.frames || [];modelIndex=0;
    configureFrames(modelFrames.length,0);
    if(!modelFrames.length){mapMessage('No verified current frames are available for this model. Other forecasts remain usable.');$('radar-stamp').textContent='Unavailable';return;}
    const nearest=modelFrames.findIndex(f=>Date.parse(f.time)>=Date.now());modelIndex=Math.max(0,nearest);
    const legend={hrrr:'Forecast reflectivity · 5 / 15 / 25 / 35 / 45 / 55 / 65 dBZ',ecmwf:'Precipitation · 0.05 / 0.1 / 0.25 / 0.5 / 1 / 2 / 4 in',nbm:'Interval precipitation · 0.05 / 0.1 / 0.25 / 0.5 / 1 / 2 / 4 in',temperature:'Temperature · 20 / 32 / 45 / 60 / 75 / 85 / 95 / 105 °F',wind:'Wind speed · 5 / 10 / 15 / 20 / 30 / 40 / 60 mph',clouds:'Cloud cover · 10 / 25 / 50 / 75 / 90%'};
    $('radar-legend').textContent=legend[layerName];
    $('map-source').href=layer.sourceUrl;$('map-source').textContent='Official data source ↗';
    showModelFrame(modelIndex);
  }catch{if(token===mapSelectionToken){configureFrames(0);mapMessage('Model map data could not be loaded. Retry with Refresh.');}}
}
function showModelFrame(index){
  const f=modelFrames[index],layer=modelCatalog?.layers[selectedLayer];
  if(!f||!layer||!map||selectedLayer==='radar')return;
  modelIndex=index;const token=++modelFrameToken;
  $('radar-time').value=String(index);$('radar-stamp').textContent=`${clock(f.time,{weekday:'short'})} · loading`;
  mapMessage('Loading decoded model data…');
  const image=window.L.imageOverlay(f.url,f.bounds,{opacity:1,zIndex:200,attribution:layer.model==='ecmwf'?'ECMWF Open Data · CC BY 4.0':'NOAA model guidance'});
  const previous=modelLayer;modelLayer=image;
  image.on('load',()=>{
    if(token!==modelFrameToken){map.removeLayer(image);return;}
    if(previous)map.removeLayer(previous);
    $('radar-stamp').textContent=clock(f.time,{weekday:'short'});$('map-caption').textContent=modelCaption(layer,f);
    mapMessage(map.getBounds().intersects(f.bounds)?'':'Model image covers North Carolina and the surrounding region. Pan back to the saved locations.');
  });
  image.on('error',()=>{if(token===modelFrameToken){stopRadar();map.removeLayer(image);if(previous)map.removeLayer(previous);modelLayer=null;mapMessage('This model image did not load. Choose another frame or refresh.');}});
  image.addTo(map);
}
function selectLayer(layer){
  selectedLayer=layer;stopRadar();++mapSelectionToken;++modelFrameToken;
  document.querySelectorAll('[data-layer]').forEach(button=>{const active=button.dataset.layer===layer;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  if(radarLayer){map?.removeLayer(radarLayer);radarLayer=null;}if(modelLayer){map?.removeLayer(modelLayer);modelLayer=null;}
  $('radar-map').hidden=false;$('radar-map').style.display='';$('model-map').hidden=true;$('radar-controls').hidden=false;$('radar-controls').style.display='';$('radar-legend').hidden=false;$('radar-legend').style.display='';
  const official=$('model-official-source');if(official)official.hidden=true;
  mapMessage('');if(!map)initMap();map?.invalidateSize();
  if(layer==='radar'){$('map-source').href='https://radar.weather.gov/';$('map-source').textContent='Official radar ↗';$('map-caption').textContent='NOAA observed reflectivity · past frames only';$('radar-legend').textContent='Observed reflectivity · light → strong';configureFrames(frames.length,frameIndex);if(frames.length)showFrame(frameIndex);else void loadRadar();}
  else{configureFrames(0);void loadModelMap();}
}
function showSelectedFrame(index){if(selectedLayer==='radar')showFrame(index);else showModelFrame(index);}

''' +s[b:]
s=s.replace("showFrame(Number($('radar-time').value))", "showSelectedFrame(Number($('radar-time').value))")
s=s.replace("  if (frames.length < 2) return;", "  if ((selectedLayer==='radar'?frames:modelFrames).length < 2) return;")
s=s.replace("radarTimer = setInterval(() => showFrame((frameIndex + 1) % frames.length), 1200);", "radarTimer = setInterval(() => { const count=(selectedLayer==='radar'?frames:modelFrames).length; const index=selectedLayer==='radar'?frameIndex:modelIndex; if(count)showSelectedFrame((index+1)%count); }, 1600);")
p.write_text(s)
p=root/'style.css';s=p.read_text();s+='\n/* Direct-model evidence and map UI remain scoped to the weather add-on. */\n.feed-chip small{display:block;margin-top:4px;font-size:10px;opacity:.8}.map-caption{gap:12px;align-items:flex-start}.map-caption>span:first-child{flex:1}.radar-legend{white-space:normal;font-size:11px;line-height:1.6}.map-error{pointer-events:none}.map-stage{background:rgba(12,27,46,.7)}\n';p.write_text(s)
