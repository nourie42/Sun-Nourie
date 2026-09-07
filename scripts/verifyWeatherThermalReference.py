"""Independent UTCI arithmetic verification, not validation of local skin sensation.
Mean radiant temperature remains an explicitly disclosed meteorological estimate.
Install the pinned reference with: pip install pythermalcomfort==4.4.2
"""
import json, math, subprocess, sys, warnings
warnings.filterwarnings("ignore", category=UserWarning, module=r"pythermalcomfort\.models\.utci")
from pathlib import Path
from pythermalcomfort.models import utci

if len(sys.argv)>1:
    report=json.loads(Path(sys.argv[1]).read_text())
    samples=[]
    for row in report['locations']:
        c=row['current'];e=row['comfort']['inputEvidence']
        samples.append({'temperature':c['temperature'],'humidity':e['humidity'],'wind':c['wind'],'tr':e['meanRadiantTemperatureF'],'actual':row['comfort']['rawOutdoors'],'name':row['name']})
else:
    node=r"""
    import {tier3FeelsLike} from './public/weather-fusion/weather-math.js';
    const location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},rows=[];
    for(const temperature of [0,32,46,65,66,74.99,75,75.01,79,88,95,110])
    for(const humidity of [20,50,94])for(const wind of [0,2,4.3,10,39])
    for(const condition of ['Clear','Overcast'])for(const time of ['2026-09-07T09:00Z','2026-09-07T18:00Z']){
      const r=tier3FeelsLike({temperature,humidity,wind,condition},location,Date.parse(time),'outdoors');
      if(r.warmerResultOverride!==false)throw new Error('A warmer-result override is forbidden');
      if(time.includes('09:00')&&r.deltaMrtC!==0)throw new Error('Nighttime solar load must be zero');
      rows.push({temperature,humidity,wind,condition,time,tr:r.tr,actual:r.value});
    }
    console.log(JSON.stringify(rows));
    """
    samples=json.loads(subprocess.check_output(['node','--input-type=module','-e',node],text=True))
    report={}

errors=[];missing=0;examples=[]
for c in samples:
    wind=c.get('wind');temperature=c.get('temperature');humidity=c.get('humidity');tr=c.get('tr')
    if any(x is None for x in [wind,temperature,humidity,tr]):
        assert c.get('actual') is None,c
        missing+=1;continue
    v=max(.5,wind*.44704)
    result=float(utci(tdb=(temperature-32)/1.8,tr=(tr-32)/1.8,v=v,rh=humidity,round_output=False).utci)
    expected=result*1.8+32
    if not math.isfinite(expected):
        assert c['actual'] is None,c
        missing+=1;continue
    assert c['actual'] is not None,c
    error=c['actual']-expected
    assert abs(error)<1e-6,(c,expected,error)
    errors.append(abs(error))
    if len(sys.argv)>1 or (temperature in [66,88] and humidity==94 and wind in [0,4.3] and c.get('condition')=='Clear' and '09:00' in c.get('time','')):
        examples.append({**c,'independentReferenceF':expected,'absoluteErrorF':abs(error)})
proof={'reference':'pythermalcomfort 4.4.2 UTCI (independent Python implementation)','source':'https://pythermalcomfort.readthedocs.io/en/stable/_modules/pythermalcomfort/models/utci.html','cases':len(samples),'numericCases':len(errors),'outOfDomainOrMissingCases':missing,'maximumAbsoluteErrorF':max(errors,default=0),'passed':True,'examples':examples,'scope':'Confirms UTCI arithmetic and domain handling, not physical accuracy of assumed MRT, airport representativeness, or individual skin sensation.'}
if len(sys.argv)>1:
    report['independentThermalVerification']=proof
    Path(sys.argv[1]).write_text(json.dumps(report,indent=2)+'\n')
else:
    Path('docs/weather-thermal-reference-verification.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof,indent=2))
