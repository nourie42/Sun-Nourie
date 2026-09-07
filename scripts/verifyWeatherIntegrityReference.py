"""Independent arithmetic/domain check, not a claim of measured local radiation.
Reference: pythermalcomfort 4.4.2, its published UTCI implementation.
"""
import json, math, subprocess, warnings
from pathlib import Path
from pythermalcomfort.models import utci
warnings.filterwarnings('ignore', category=UserWarning, module=r'pythermalcomfort\.models\.utci')
code=r"""
import {tier3FeelsLike} from './public/weather-fusion/weather-math.js';
const location={latitude:35.787,longitude:-78.4806},rows=[];
for(const temperature of [0,32,46,65,66,74.99,75,75.01,79,88,95,110])
for(const humidity of [20,50,94])for(const wind of [0,2,4.3,10,25,39])
for(const skyCover of [0,12,62,100])for(const time of ['2026-09-07T09:00Z','2026-09-07T18:00Z'])
for(const exposure of ['shade','outdoors']){
 const r=tier3FeelsLike({temperature,humidity,wind,skyCover,condition:'Chance thunderstorms'},location,Date.parse(time),exposure);
 if(r.warmerResultOverride!==false)throw new Error('Warmer-index override is forbidden');
 if(time.includes('09:00')&&r.deltaMrtC!==0)throw new Error('Night solar load must be zero');
 rows.push({temperature,humidity,wind,skyCover,time,exposure,tr:r.tr,actual:r.value});
}
console.log(JSON.stringify(rows));
"""
rows=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],text=True))
errors=[];out_of_domain=0
for c in rows:
    ref=float(utci(tdb=(c['temperature']-32)/1.8,tr=(c['tr']-32)/1.8,v=max(.5,c['wind']*.44704),rh=c['humidity'],round_output=False).utci)*1.8+32
    if not math.isfinite(ref):
        assert c['actual'] is None,(c,ref)
        out_of_domain+=1
    else:
        assert c['actual'] is not None,(c,ref)
        error=abs(c['actual']-ref)
        assert error<1e-6,(c,ref,error)
        errors.append(error)
proof={'reference':'pythermalcomfort 4.4.2 UTCI','referenceSource':'https://pythermalcomfort.readthedocs.io/en/stable/_modules/pythermalcomfort/models/utci.html','caseCount':len(rows),'numericCases':len(errors),'outOfDomainCases':out_of_domain,'maximumAbsoluteErrorF':max(errors),'passed':True,'scope':'Independent verification of UTCI arithmetic, all-season continuity and domain handling. Estimated cloud attenuation/MRT, airport representativeness and individual physiology are not validated by equation agreement.'}
Path('docs/weather-integrity-reference-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof,indent=2))
