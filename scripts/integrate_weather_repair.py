from pathlib import Path
import subprocess,re
MAIN='f23610ec7091383573e84ba0780a010d64b78125'
BASE='f4d1a1d42dfc7641f4766293b8c2f09992365fed'
def git(*args):return subprocess.check_output(['git',*args],text=True)
def edit(path,old,new,count=1):
 p=Path(path);s=p.read_text();assert s.count(old)==count,(path,s.count(old),old[:90]);p.write_text(s.replace(old,new))

# Main advanced while the thermal audit was running. Merge it, do not overwrite
# its new date/evidence/office/topic guards or its added behavioral coverage.
assert git('rev-parse','origin/main').strip()==MAIN,'Main changed again; inspect before integrating.'
our_app=Path('public/weather-fusion/app.js').read_text()
thermal_evidence=our_app[our_app.index("  const inputRoot=$('thermal-input-evidence');"):our_app.index("  const important = ['nws'",our_app.index('function renderEvidence'))]
result=subprocess.run(['git','merge','--no-commit','--no-ff',MAIN],capture_output=True,text=True)
print(result.stdout,result.stderr)
assert result.returncode in [0,1]
# These are the overlapping Dan-take paths; main's implementation and test
# contract are retained, then the separately verified thermal edits are applied.
choose=['src/weatherFusion.js','src/weatherFusionExperience.js','public/weather-fusion/app.js','public/weather-fusion/index.html','test/weatherFusionForecastDetails.test.js','test/weatherFusionUserFeedback.test.js','scripts/weatherFusionPersonalBrowser.js']
for path in choose:Path(path).write_text(git('show',MAIN+':'+path))
subprocess.run(['git','add',*choose],check=True)
unresolved=git('diff','--name-only','--diff-filter=U').splitlines();assert not unresolved,unresolved

path='src/weatherFusion.js'
edit(path,'temperature: rounded(toF(o.temperature))','temperature: toF(o.temperature)')
edit(path,'humidity: rounded(o.relativeHumidity?.value), dewpoint: rounded(toF(o.dewpoint))','humidity: numeric(o.relativeHumidity?.value), dewpoint: toF(o.dewpoint)')
edit(path,'wind: rounded(toMph(o.windSpeed))','wind: toMph(o.windSpeed)')
edit(path,'result.aiConfigured = !!env.OPENAI_API_KEY;',"result.aiConfigured = !!env.OPENAI_API_KEY;\n      result.changesVersion=DAN_TAKE_VERSION;\n      result.thermalAuditVersion='weather-nourie-thermal-audit-v1';")
# Permit all approved distinct source possibilities, not arbitrary filler or a
# fixed six-item truncation. Evidence itself remains bounded by source size.
p=Path(path);s=p.read_text().replace("type:'array',maxItems:6,items:","type:'array',items:");p.write_text(s)

path='public/weather-fusion/app.js'
edit(path,'function renderEvidence(data) {','function renderEvidence(data) {\n'+thermal_evidence)
path='public/weather-fusion/index.html'
edit(path,"What could change - Dan's take","Dan's take")
edit(path,'app.js?v=14-dated-dans-take','app.js?v=14-evidence-thermal')
edit(path,'hourly-feels.css?v=3-outdoor','hourly-feels.css?v=4-inputs')
edit(path,'<p id="skin-science">','<div id="thermal-input-evidence"></div><p id="skin-science">')

# Alternatives are often written "Friday vs Thursday night" in the real AFD.
# Sentence order is NOT chronological order: never roll Thursday into next week.
path='public/weather-fusion/dans-take.js'
edit(path,"weather-nourie-dans-take-v2","weather-nourie-dans-take-v3")
edit(path,"""  let first=found[0],last=found.at(-1);
  if(last.start<first.start&&found.length>1){
    const p=localParts(last.start,zone);last=partRange(addDays(p.date,7),last.part,zone);
  }""", """  const first=found.reduce((a,b)=>a.start<=b.start?a:b);
  const last=found.reduce((a,b)=>a.end>=b.end?a:b);""")
edit(path,'forecastChanges:items.slice(0,6)','forecastChanges:items')

# Keep one production evidence contract, not two competing card generators.
Path('public/weather-fusion/forecast-changes.js').unlink()
p=Path('test/weatherFusionEvidence.test.js');s=p.read_text();start=s.index("test('the app does not force")
head="""import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDanTakeEvidence,approveDanTake,visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
import {tier3FeelsLike,thermalComfort} from '../public/weather-fusion/weather-math.js';
import {currentSample,forecastSample,hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
const now=Date.parse('2026-09-07T09:00Z'),location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York',office:'RAH'};
test('actual AFD alternative order Friday vs Thursday night is not shifted into next week',()=>{
 const data={signature:'order',location,feeds:[{id:'afd',status:'ready'}],discussion:{id:'actual-order',office:'RAH',issuanceTime:'2026-09-07T07:01:00Z',text:'.DISCUSSION...\\nAs of 300 AM Monday...\\n\\nThere is still some uncertainty with respect to when the front/trough will move through NC (most ensemble guidance suggests Friday vs Thursday night), but rain chances continue through Friday.'}};
 const evidence=collectDanTakeEvidence(data,now);assert.equal(evidence.candidates.length,1);
 const c=evidence.candidates[0];assert.equal(c.validFrom,'2026-09-10T22:00:00.000Z');assert.equal(c.eventEnd,'2026-09-12T04:00:00.000Z');
 const approved=approveDanTake([{evidenceId:c.id,summary:'The front could arrive earlier or later, shifting when the rain reaches the area.'}],data,now);
 const b={...approved,signature:data.signature,mode:'ai'};assert.equal(visibleDanTakeItems(b,data,now).length,1);
 assert.match(danTakeText(b.forecastChanges),/Thursday.*Friday/s);
});
"""
p.write_text(head+s[start:])

# The end-to-end audit uses the existing main-branch evidence API and adds
# independent actual-input thermal verification; it never injects an AI result.
p=Path('scripts/verifyWeatherEvidenceLive.js');s=p.read_text()
s=s.replace("import {CHANGES_VERSION,changeContext,activeChanges,changesText} from '../public/weather-fusion/forecast-changes.js';", "import {DAN_TAKE_VERSION as CHANGES_VERSION,collectDanTakeEvidence as changeContext,visibleDanTakeItems as activeChanges,danTakeText} from '../public/weather-fusion/dans-take.js';\nconst changesText=(b,f,time)=>danTakeText(activeChanges(b,f,time));")
s=s.replace('.includes(c.text)','.includes(c.sourceQuote)');p.write_text(s)
for path in ['scripts/weatherFusionPersonalBrowser.js','scripts/weatherFusionBrowserSmoke.js','scripts/verifyWeatherDansTakeLive.js']:
 p=Path(path);s=p.read_text().replace("What could change - Dan's take","Dan's take");p.write_text(s)
for p in Path('test').glob('weatherFusion*.test.js'):
 s=p.read_text().replace("What could change - Dan's take","Dan's take").replace('14-dated-dans-take','14-evidence-thermal');p.write_text(s)
# Bust changed browser modules uniformly, including the retained evidence module.
for p in Path('public/weather-fusion').glob('*.js'):
 s=p.read_text();s=re.sub(r"(\./(?:weather-math|utci|weather-display|experience|outdoor-feels|hourly-feels|personal-details|comfort-outlook|dans-take)\.js)(?:\?v=[^'\"]*)?(?=['\"])",r'\1?v=evidence-v1',s);p.write_text(s)
p=Path('.github/workflows/weather-evidence-thermal.yml');s=p.read_text().replace('public/weather-fusion/forecast-changes.js','public/weather-fusion/dans-take.js');p.write_text(s)
print('Preserved current main changes and integrated only reviewed thermal/evidence-date corrections.')
