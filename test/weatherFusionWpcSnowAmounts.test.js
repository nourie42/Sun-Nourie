import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {kmlFromKmz,decodeWpcSnowKml,wpcSnowPointAmount,wpcSnowFileMetadata,createWpcSnowAmountService,WPC_SNOW_GIS_ROOT} from '../src/weatherFusionWpcSnowAmounts.js';
import {addSnowOutlook} from '../src/weatherFusionSnow.js';
import {winterMapDescriptors,winterAreaDataUrl,winterAmountText,snowDetailHTML} from '../public/weather-fusion/snow-outlook.js';

const now=Date.parse('2026-10-14T10:00:00Z'),file='ppp_co_24hr_expected_sn_in_2026101409f027.kmz';
const outer='-105,39,0 -99,39,0 -99,46,0 -105,46,0 -105,39,0';
const higher='-104,40,0 -100,40,0 -100,45,0 -104,45,0 -104,40,0';
const holes=['-103.8,41,0 -103,41,0 -103,42,0 -103.8,42,0 -103.8,41,0','-102.8,41,0 -102,41,0 -102,42,0 -102.8,42,0 -102.8,41,0'];
function placemark(value,coords,inner=[],filename=file){
 const m=wpcSnowFileMetadata(filename),plain=s=>s.slice(0,19).replace('T',' ');
 return `<Placemark><name>${value} Inches</name><description>value ${value}\nunits Inches\nParameter deterministic\nWx Element Snow\nDuration 24 HR\nInitTime ${plain(m.issuedAt)}\nValidStart ${plain(m.start)}\nValidEnd ${plain(m.end)}</description><styleUrl>#source-blue</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>${inner.length?`<innerBoundaryIs>${inner.map(r=>`<LinearRing><coordinates>${r}</coordinates></LinearRing>`).join('')}</innerBoundaryIs>`:''}</Polygon></Placemark>`;
}
const kml=(filename=file)=>`<kml><Document><Style id="source-blue"><PolyStyle><color>75ff0000</color></PolyStyle></Style>${placemark(.1,outer,[],filename)}${placemark(2,higher,holes,filename)}</Document></kml>`;
function kmz(text){
 const name=Buffer.from('forecast.kml'),raw=Buffer.from(text),compressed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
 const directory=Buffer.concat([central,name]),body=Buffer.concat([local,name,compressed]);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(body.length,16);return Buffer.concat([body,directory,end]);
}

test('official expected snowfall archives preserve units, valid periods, colors and all interior holes',()=>{
 const text=kml(),decoded=decodeWpcSnowKml(kmlFromKmz(kmz(text)),file,now);
 assert.equal(decoded.features.length,2);assert.equal(decoded.features[1].geometry.coordinates.length,3);
 assert.equal(decoded.metadata.start,'2026-10-14T12:00:00.000Z');assert.equal(decoded.metadata.end,'2026-10-15T12:00:00.000Z');
 assert.equal(decoded.features[0].properties.color,'#0000ff');
 assert.equal(wpcSnowPointAmount(decoded,{latitude:43,longitude:-102}).value,2);
 for(const longitude of [-103.4,-102.4])assert.equal(wpcSnowPointAmount(decoded,{latitude:41.5,longitude}).value,.1);
 const hazen=wpcSnowPointAmount(decoded,{latitude:47.294,longitude:-101.622});
 assert.deepEqual(hazen.range,[0,.1]);assert.match(hazen.method,/Below the published 0.1-inch/);
 assert.throws(()=>wpcSnowPointAmount(decoded,{latitude:60,longitude:5}),/does not cover/);
 assert.throws(()=>decodeWpcSnowKml(text.replace('units Inches','units Percent'),file,now),/identity, units or valid period/);
 assert.throws(()=>decodeWpcSnowKml(text.replace('Parameter deterministic','Parameter probability'),file,now),/identity/);
 assert.throws(()=>decodeWpcSnowKml(text,file,now+48*3600000),/stale or expired/);
 assert.throws(()=>kmlFromKmz(Buffer.from('not a zip')),/empty or oversized/);
 assert.throws(()=>wpcSnowFileMetadata('ppp_co_24hr_prob_sn_in_2026101409f027.kmz'),/Unexpected/);
});

test('source discovery selects nonoverlapping future WPC periods and shares bounded frame requests across points',async()=>{
 const leads=[21,27,33,39,45,51,57,63],files=leads.map(n=>file.replace('f027',`f${String(n).padStart(3,'0')}`)),calls=[];
 const fetchImpl=async url=>{
  calls.push(url);
  const name=url.split('/').at(-1),body=name==='latest_cycle.txt'?'2026101409 2026101409_1633':name===''?files.map(f=>`<a href="${f}">${f}</a>`).join(''):null;
  return {ok:true,headers:{get:()=>null},text:async()=>body,arrayBuffer:async()=>kmz(kml(name))};
 };
 const source=createWpcSnowAmountService({fetchImpl,now:()=>now}),first=await source.load({latitude:43,longitude:-102}),second=await source.load({latitude:47.294,longitude:-101.622});
 assert.equal(first.status,'ready');assert.equal(first.amounts.length,2);assert.equal(first.amounts[0].start,'2026-10-14T12:00:00.000Z');
 assert.equal(first.amounts[1].start,first.amounts[0].end);assert.equal(first.amounts[0].value,2);
 assert.deepEqual(second.amounts[0].range,[0,.1]);assert.equal(calls.filter(u=>u.endsWith('.kmz')).length,2);
 assert.ok(calls.every(u=>u.startsWith(WPC_SNOW_GIS_ROOT)));
 const map=await source.getMap({file});assert.equal(map.features.length,2);assert.equal(calls.filter(u=>u.endsWith('.kmz')).length,2);
 await assert.rejects(()=>source.getMap({file:'../../other.kmz'}));
});

test('WPC60 contributes only against the same 24-hour model interval and propagates contour uncertainty',()=>{
 const hour=3600000,axis=now,model=(id,value)=>({id,intervals:Array.from({length:120},(_,i)=>({start:axis+i*hour,end:axis+(i+1)*hour,value}))});
 const output={location:{timeZone:'UTC'},days:['2026-10-14','2026-10-15','2026-10-16','2026-10-17'].map(date=>({date})),hours:[],riskOutlooks:[]};
 const amounts=[{start:'2026-10-14T12:00:00Z',end:'2026-10-15T12:00:00Z',value:2,range:[2,3],precision:'contour-lower-bound',method:'Published WPC contour.'},{start:'2026-10-15T12:00:00Z',end:'2026-10-16T12:00:00Z',value:1,range:[1,2],precision:'contour-lower-bound',method:'Published WPC contour.'}];
 addSnowOutlook(output,{now,winterModels:{hrrr:model('hrrr',.1),nam:model('nam',.2),ecmwf:model('ecmwf',.3),gfs:model('gfs',.4)},wpcWinter:{amounts,probabilities:[],maps:[{id:'expected',kind:'geojson',quantity:'snowfall',url:'/api/weather-fusion/winter-map?file='+file,label:'WPC expected snow totals'}]}});
 const [near,later]=output.snow.blendWindows;
 assert.equal(near.start,amounts[0].start.replace('Z','.000Z'));assert.equal(near.snowfall.coverage,100);assert.equal(near.snowfall.actualWeights.wpc,60);
 assert.equal(near.snowfall.value,2.52);assert.deepEqual(near.snowfall.range,[2.52,3.12]);
 assert.equal(later.snowfall.weights.wpc,60);assert.equal(later.snowfall.coverage,90);assert.equal(later.snowfall.sources.find(s=>s.id==='weathernext').value,null);
 for(let i=1;i<output.snow.blendWindows.length;i++)assert.ok(Date.parse(output.snow.blendWindows[i].start)>=Date.parse(output.snow.blendWindows[i-1].end));
 assert.equal(winterMapDescriptors(output.snow)[0].id,'expected');
 assert.match(snowDetailHTML(output.snow,'Test town','UTC'),/100% of requested weight/);
 assert.match(snowDetailHTML(output.snow,'Test town','UTC'),/WPC 24-hour snowfall blend/);
 assert.match(snowDetailHTML(output.snow,'Test town','UTC'),/Local calendar-day guidance; WPC uses the separate 24-hour periods below/);
 assert.match(snowDetailHTML(output.snow,'Test town','UTC'),/conservative contour lower bounds/);
 assert.equal(winterAmountText(0,[0,.06]),'<0.1″');assert.equal(winterAmountText(0), '0.0″');
 assert.ok(winterAreaDataUrl('/api/weather-fusion/winter-map?file='+file));assert.equal(winterAreaDataUrl('https://evil.example/map?file='+file),null);
});
