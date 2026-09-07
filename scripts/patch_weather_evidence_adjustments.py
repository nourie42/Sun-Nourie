from pathlib import Path

def edit(path,old,new,count=1):
 p=Path(path);s=p.read_text()
 assert s.count(old)==count,(path,s.count(old),old[:100])
 p.write_text(s.replace(old,new))

# The old fixture baked in 94 F independently of its weather inputs. The test
# must instead reject such a poisoned display cache, not force physics to 94.
p=Path('test/weatherFusionOutdoorConsistency.test.js');s=p.read_text()
a=s.index("test('86 shade versus 94 sunlight");b=s.index('\nfor(const [condition,time]',a)
s=s[:a]+r'''test('every current display calculates from raw inputs rather than trusting a painted sun value',()=>{
 const f=make(),expected=thermalComfort(f.current,f.location,now);
 f.comfort={...expected,shade:999,sun:999,outdoors:999};
 const sample=currentSample(f,now);
 assert.equal(sample.feels,expected.outdoors);assert.notEqual(sample.feels,999);
 assert.match(heroFeelsHTML(sample),new RegExp('<strong>'+Math.round(expected.outdoors)+'°</strong>'));
 assert.match(heroFeelsHTML(sample),/In direct sun/);
 const root={innerHTML:'',scrollLeft:35};globalThis.document={getElementById:()=>root};
 try{renderHourlyWeather(f,now);assert.match(root.innerHTML,new RegExp('<span>Now</span>.*?Feels like<b>'+Math.round(expected.outdoors)+'°</b>'));assert.equal(root.scrollLeft,35);}
 finally{delete globalThis.document;}
 const figures=sunShadeHTML(sample.comfort,f.location,now);
 assert.match(figures,new RegExp('shade-person.*?<strong>'+Math.round(expected.shade)+'°</strong>','s'));
 assert.match(figures,new RegExp('sun-person.*?<strong>'+Math.round(expected.outdoors)+'°</strong>','s'));
 assert.ok(!figures.includes('999°'));
});
'''+s[b:];p.write_text(s)

# Humidity must have its own physical effect even without sunlight. It must NOT
# satisfy the unrelated assertion that it always exceed a second equation.
p=Path('test/weatherFusionHumidityBulletins.test.js');s=p.read_text();a=s.index("test('high dew point");b=s.index("\ntest('bulletin card",a)
s=s[:a]+'''test('humidity raises UTCI under clouds without a warmer-equation override',()=>{
 const current={temperature:88,dewpoint:72,humidity:null,wind:5,condition:'Cloudy',type:'observation'};
 const comfort=thermalComfort(current,location,now);
 const drier=thermalComfort({...current,dewpoint:50},location,now);
 assert.ok(comfort.rawOutdoors>drier.rawOutdoors,'Humidity must raise the same-cloud-sky estimate');
 assert.equal(comfort.sun,null);assert.equal(comfort.outdoors,comfort.shade);
 assert.match(comfort.note,/without selecting a warmer formula/);
 assert.ok(comfort.inputEvidence.humidity>drier.inputEvidence.humidity);
});
'''+s[b:];p.write_text(s)

# The sky fixture previously generated Steadman shade values while exercising a
# UTCI outdoor preview. Generate the documented hourly contract from its inputs.
edit('test/weatherFusionSkyConsistency.test.js',
 "return {time:times[index],inputs,value:Number(shadeFeelsLike(temperature,null,6,inputs.dewpoint).value.toFixed(1))};",
 "const comfort=thermalComfort(inputs,location,Date.parse(times[index]));return {time:times[index],inputs,value:Number(comfort.rawOutdoors.toFixed(1)),shadeValue:Number(comfort.rawShade.toFixed(1)),exposure:'outdoors'};")
edit('test/weatherFusionSkyConsistency.test.js',
 "Now is identical to the hero and does not expose the older current-hour forecast as another current observation",
 "Now is the station estimate and the overlapping forecast hour remains a separate forecast")
edit('test/weatherFusionSkyConsistency.test.js',
 "assert.equal(samples[1].time,'2026-09-06T16:00:00Z');assert.equal(samples.length,3);",
 "assert.equal(samples[1].time,'2026-09-06T15:00:00Z');assert.equal(samples.length,4);assert.equal(samples[1].source,'Hourly forecast');assert.equal(samples[0].source,'Station observation');")
edit('test/weatherFusionSkyConsistency.test.js',
 "assert.equal(samples.filter(p=>!p.now&&Date.parse(p.time)<=now).length,0);",
 "assert.equal(samples.filter(p=>!p.now&&Date.parse(p.time)<=now).length,1);")
p=Path('test/weatherFusionPersonalDetails.test.js');s=p.read_text().replace("What could change - Dan's take","Dan's take");p.write_text(s)

# Keep real DOM tests exercising a visible, evidence-backed Dan take, not the
# unsupported generic fixture string used before the evidence requirement.
p=Path('scripts/weatherFusionPersonalBrowser.js');s=p.read_text()
s="import {CHANGES_VERSION,changeContext,validateChanges} from '../public/weather-fusion/forecast-changes.js';\n"+s
s=s.replace("text:'Rain may be widespread in the region this afternoon.'", "text:'.DISCUSSION...\\nAs of 800 AM Sunday...\\n\\nIf clouds linger this afternoon, temperatures could be cooler than forecast.'")
s=s.replace("if(req.params.kind==='briefing')return res.json({", "if(req.params.kind==='briefing')return res.json({changesVersion:CHANGES_VERSION,forecastChanges:validateChanges([{candidateId:'change-0',summary:`Clouds lingering around ${f.location.name} could hold down afternoon temperatures.`}],changeContext(f,epoch),epoch),")
s=s.replace("What could change - Dan's take","Dan's take")
p.write_text(s)

# Reject malformed lists without throwing in a legacy/cached client response.
edit('public/weather-fusion/forecast-changes.js',"return (briefing.forecastChanges||[]).filter(c=>", "return (Array.isArray(briefing.forecastChanges)?briefing.forecastChanges:[]).filter(c=>")

# Keep the independent-reference audit log readable. Out-of-domain handling is
# still asserted explicitly; the expected Python warnings add no evidence.
p=Path('scripts/verifyWeatherThermalReference.py');s=p.read_text().replace('import json, math, subprocess, sys','import json, math, subprocess, sys, warnings\nwarnings.filterwarnings("ignore", category=UserWarning, module=r"pythermalcomfort\\.models\\.utci")');p.write_text(s)
print('Updated fixtures for the documented evidence and raw-input contracts; no production value was changed to satisfy a fixture.')
