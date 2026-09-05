from pathlib import Path
p=Path('public/weather-fusion/app.js');s=p.read_text()
a=s.index('function setBasemap()');b=s.index('function initMap()',a)
s=s[:a]+'''function setBasemap() {
  if (!map || !window.L) return;
  if (baseLayer) map.removeLayer(baseLayer);
  const selected = $('basemap').value;
  const service = selected === 'satellite' ? 'USGSImageryTopo' : 'USGSTopo';
  const pane = map.getPane('weather-base') || map.createPane('weather-base');
  pane.style.zIndex = '200';
  pane.style.filter = selected === 'dark' ? 'grayscale(1) invert(1) brightness(.7) contrast(.9)' : '';
  baseLayer = window.L.tileLayer(`https://basemap.nationalmap.gov/arcgis/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`, {
    pane: 'weather-base', maxZoom: 16, maxNativeZoom: 16, updateWhenIdle: true,
    attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener noreferrer">USGS The National Map</a> · background map, not live clouds'
  }).addTo(map);
  baseLayer.on('tileerror', () => mapMessage('The USGS background map could not load. Weather-model overlays and official source links remain available.'));
}
''' +s[b:]
s=s.replace("$('condition').textContent = c.condition || 'Current conditions unavailable';", "$('condition').textContent = c.condition || (data.hours[0]?.condition ? `${data.hours[0].condition} · forecast` : 'Current condition description unavailable');")
s=s.replace("$('hero-scene').innerHTML = icon(c.condition, day, 120);", "$('hero-scene').innerHTML = icon(c.condition || data.hours[0]?.condition, day, 120);")
p.write_text(s)
p=Path('public/weather-fusion/index.html');s=p.read_text().replace('OpenStreetMap / CARTO / Esri','USGS The National Map').replace('value="street">Street','value="street">Topographic').replace('value="satellite">Satellite imagery','value="satellite">Aerial imagery');p.write_text(s)
p=Path('public/weather-fusion/style.css');s=p.read_text()
if '/* Full-page background' not in s:s+='\n/* Full-page background remains visible during scrolling and full-page capture. */\nbody{background-attachment:scroll}\n'
p.write_text(s)
p=Path('scripts/weatherFusionBrowserSmoke.js');s=p.read_text()
a=" await page.locator('#map-panel').scrollIntoViewIfNeeded();"
b=''' await page.locator('#map-panel').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-weather-base-pane img')].some(i=>i.complete&&i.naturalWidth>0),null,{timeout:60000});
 for(const style of ['street','satellite','dark']){
  await page.locator('#basemap').selectOption(style);
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-weather-base-pane img')].some(i=>i.complete&&i.naturalWidth>0),null,{timeout:60000});
  const urls=await page.locator('.leaflet-weather-base-pane img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth>0).map(i=>i.src));
  assert.ok(urls.every(url=>url.includes('basemap.nationalmap.gov')));
  report.maps.push({layer:'basemap-'+style,loaded:true,provider:'USGS The National Map'});
 }
'''
if 'basemap-'+"style" not in s:s=s.replace(a,b)
s=s.replace(" await page.screenshot({path:dir+'/desktop.png',fullPage:true});", " await page.evaluate(()=>document.activeElement?.blur());\n await page.screenshot({path:dir+'/desktop.png',fullPage:true});")
s=s.replace(" await page.screenshot({path:dir+'/mobile.png',fullPage:true});", " await page.evaluate(()=>document.activeElement?.blur());\n await page.screenshot({path:dir+'/mobile.png',fullPage:true});")
p.write_text(s)
