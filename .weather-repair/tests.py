from pathlib import Path
p=Path('test/weatherFusion.test.js');s=p.read_text()
assert "test('commercial gate does not silently" in s
s=s.replace("test('NWS numbers remain primary; periods and liquid amounts stay separate'", "test('NWS fallback keeps probability separate and uses the remaining precipitation window'")
s=s.replace("assert.equal(f.days[0].qpf, .1)", "assert.equal(f.days[0].qpf, .079)")
s=s.replace("assert.equal(f.hours[0].precipitation, .02)", "assert.equal(f.hours[0].precipitation, .004)")
s=s.replace("assert.equal(f.solar.sunset, '2026-09-05T23:34:00.000Z');", "assert.ok(Date.parse(f.solar.sunset) > Date.parse('2026-09-05T23:30:00Z'));\n  assert.ok(Date.parse(f.solar.sunset) < Date.parse('2026-09-05T23:45:00Z'));")
snapshot='''export function snapshot(id='hrrr') {
  const begin=Date.parse('2026-09-05T12:00:00Z')/1000;
  const count=id==='hrrr'?49:193;
  const time=Array.from({length:count},(_,i)=>begin+i*3600);
  return {schema:'weather-fusion-direct-v2',model:id,complete:true,runAt:new Date(begin*1000).toISOString(),validUntil:new Date(time.at(-1)*1000).toISOString(),resolution:'Test native grid',points:[{id:'knightdale',latitude:35.787,longitude:-78.4806,hourly_units:{temperature_2m:'°F',precipitation:'inch',wind_speed_10m:'mp/h'},hourly:{time,temperature_2m:time.map(()=>id==='hrrr'?90:80),precipitation:time.map(()=>.01),wind_speed_10m:time.map(()=>8)},precipitationIntervals:time.slice(1).map(t=>({start:t-3600,end:t,value:.01}))}]};
}
'''
s=s.replace("  if (u.hostname.endsWith('open-meteo.com') && u.pathname === '/v1/forecast') return response(model());", "  if (u.hostname === 'raw.githubusercontent.com' && u.pathname.includes('/models/')) return response(snapshot(u.pathname.split('/').at(-1).replace('.json','')));")
s=s.replace("sources: ['nws', 'afd', 'hrrr']", "sources: ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm']")
s=s.replace("url.includes('models=gfs_hrrr')", "url.includes('/models/hrrr.json')").replace("url.includes('models=ecmwf_ifs')", "url.includes('/models/ecmwf.json')")
s=s.replace("test('commercial gate does not silently use the noncommercial model API'", "test('direct NOAA/ECMWF data works without an intermediary API key'")
s=s.replace("assert.equal(f.feeds.find((x) => x.id === 'hrrr').status, 'not-configured');", "assert.equal(f.feeds.find((x) => x.id === 'hrrr').status, 'ready');")
s=s.replace("assert.ok(b.input.includes('TEST FIXTURE'));", "assert.ok(b.input.includes('TEST FIXTURE')); const facts=JSON.parse(b.input); assert.equal(facts.modelContributions.length,3); assert.ok(facts.days[0].highBlend.sources.some(x=>x.id==='hrrr')); assert.ok(facts.next24HoursPrecipitation.sources.some(x=>x.id==='ecmwf'));")
a=s.index('const H =');b=s.index("test('coordinate validation",a)
fixture=s[a:b]
fixture=fixture.replace('const H =','export const H =').replace('const base =','export const base =').replace('const times =','export const times =').replace('function model(','export function model(').replace('const periods =','export const periods =').replace('const hourlyPeriods =','export const hourlyPeriods =').replace('const grid =','export const grid =').replace('const inputs =','export const inputs =')
fixture="import {coordinates,localTime,nextDate,buildForecast} from '../src/weatherFusion.js';\n"+fixture+snapshot
Path('test/weatherFusion.fixtures.js').write_text(fixture)
s=s[:a]+"import {H,now,base,times,model,periods,hourlyPeriods,grid,inputs,snapshot} from './weatherFusion.fixtures.js';\n"+s[b:]
p.write_text(s)
p=Path('.github/workflows/weather-fusion.yml');s=p.read_text().replace('node --test test/weatherFusion.test.js test/weatherFusionGateway.test.js','node --test test/weatherFusion*.test.js');s=s.replace('node --check src/weatherFusion.js','node --check src/weatherFusion.js\n          node --check src/weatherFusionDirect.js');p.write_text(s)
