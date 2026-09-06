/** Tier 3 from Real_Feel_Skin_Temperature_Research.pdf, pp.5/8.
 * UTCI is the all-season fallback. Radiation is a modeled SolarCal-style input,
 * not measured MRT, a calibrated Fiala/Zhang surrogate, EPST or skin temperature.
 * Coefficients: pythermalcomfort 4.4.2 (MIT), generated without rounding.
 */
import {UTCI_TERMS} from './utci-terms.js';
import {weatherState} from './weather-state.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const toC=f=>(f-32)/1.8,toF=c=>c*1.8+32;
const round=v=>finite(v)?Math.round(v):null;
export const THERMAL_VERSION='weather-nourie-utci-exposure-v1';
export function saturationHpa(c){
 const k=c+273.15,g=[-2836.5744,-6028.076559,19.54263612,-.02737830188,.000016261698,7.0229056e-10,-1.8680009e-13];
 let x=2.7150305*Math.log1p(k);g.forEach((a,i)=>{x+=a*k**(i-2);});return Math.exp(x)*.01;
}
export function utciC(ta,tr,windMs,rh){
 if(![ta,tr,windMs,rh].every(finite)||ta< -50||ta>50||tr-ta< -30||tr-ta>70||windMs<.5||windMs>17||rh<0||rh>100)return null;
 const pa=saturationHpa(ta)*rh/1000;
 if(pa>5)return null;
 const variables=[ta,windMs,tr-ta,pa],powers=variables.map(x=>Array.from({length:7},(_,i)=>x**i));
 let total=0;for(const [c,a,b,d,e] of UTCI_TERMS)total+=c*powers[0][a]*powers[1][b]*powers[2][d]*powers[3][e];
 return finite(total)?total:null;
}
export function radiantExposure(current,elevation){
 const ta=finite(current.temperature)?toC(current.temperature):NaN,weather=weatherState(current.condition,current.skyCover),day=finite(elevation)&&elevation>0;
 const defaults={clear:.05,'partly-cloudy':.5,cloudy:1,rain:1,storm:1,snow:1,fog:1};
 let cloud=finite(current.skyCover)?Math.max(0,Math.min(1,current.skyCover/100)):defaults[weather.kind];
 if(['cloudy','rain','storm','snow','fog'].includes(weather.kind))cloud=1;
 const known=finite(cloud)&&finite(elevation),alt=day?Math.max(0,Math.sin(elevation)):0;
 const direct=known&&day?850*Math.exp(-.16/Math.max(.06,alt))*(1-cloud)**2:0;
 const diffuse=known&&day?(90+130*cloud)*alt:0;
 const ground=direct*alt+diffuse,reflected=.2*ground;
 const qShade=.7*(.5*diffuse+.5*reflected),qOpen=qShade+.7*.25*direct;
 const mrt=q=>finite(ta)?((ta+273.15)**4+q/(.97*5.670374419e-8*.72))**.25-273.15:null;
 return {kind:weather.kind,label:weather.label,known,daylight:finite(elevation)?day:null,cloudCover:finite(cloud)?cloud*100:null,
  directNormal:direct,diffuseHorizontal:diffuse,reflectedHorizontal:reflected,absorbedShade:qShade,absorbedOpen:qOpen,
  mrtShadeC:mrt(qShade),mrtOpenC:mrt(qOpen),longwaveMrtC:ta,
  status:!finite(elevation)?'geometry-unavailable':!weather.known&&!finite(current.skyCover)?'sky-unavailable':day?'modeled':'night'};
}
export function thermalStress(c){
 if(!finite(c))return 'Outside model range or inputs missing';
 for(const [limit,label] of [[-40,'Extreme cold stress'],[-27,'Very strong cold stress'],[-13,'Strong cold stress'],[0,'Moderate cold stress'],[9,'Slight cold stress'],[26,'No thermal stress'],[32,'Moderate heat stress'],[38,'Strong heat stress'],[46,'Very strong heat stress'],[Infinity,'Extreme heat stress']])if(c<limit)return label;
}
export function researchComfort(current,elevation){
 const ta=finite(current.temperature)?toC(current.temperature):NaN,wind=current.wind;
 let rh=current.humidity;
 if(finite(current.dewpoint)&&finite(current.temperature)&&current.dewpoint<=current.temperature+1){
  const sat=c=>6.112*Math.exp(17.67*c/(c+243.5));rh=Math.min(100,Math.max(0,100*sat(toC(current.dewpoint))/sat(ta)));
 }
 const measuredWind=finite(wind)&&wind>=0?wind*.44704:null,v=finite(measuredWind)?Math.max(.5,measuredWind):null;
 const r=radiantExposure(current,elevation),base=utciC(ta,ta,v,rh),shade=utciC(ta,r.mrtShadeC,v,rh),open=utciC(ta,r.mrtOpenC,v,rh);
 const sf=finite(shade)?toF(shade):null,of=finite(open)?toF(open):null;
 return {version:THERMAL_VERSION,shade:round(sf),sun:r.daylight&&r.directNormal>0?round(of):null,outdoors:round(of),
  rawShade:sf,rawOutdoors:of,baselineUtci:finite(base)?toF(base):null,method:'UTCI · modeled weather exposure (research Tier 3 fallback)',humidity:rh,
  weatherKind:r.kind,weatherLabel:r.label,condition:current.condition,conditionSource:current.conditionSource||null,daylight:r.daylight,
  radiation:r,radiationStatus:r.status,absorbedRadiation:r.absorbedOpen,solarAdjustment:finite(of)&&finite(sf)?of-sf:null,
  stress:thermalStress(open),windFloorApplied:finite(measuredWind)&&measuredWind<.5,
  note:'Tier 3 UTCI fallback from the supplied research. Primary feels-like includes modeled direct, diffuse and reflected short-wave radiation for this hour; shade blocks the direct beam, not all radiation. SolarCal-style assumptions: standing-person projected fraction 0.25, short-wave absorptance 0.7, ground albedo 0.2 and long-wave MRT equal to air temperature. Cloud/solar estimates are not measured radiation. UTCI uses standard 10 m wind, adaptive clothing and a reference person; calm wind uses its 0.5 m/s lower bound. Invalid inputs/out-of-domain values stay unavailable. Wet bulb remains a separate diagnostic and is not added again. No calibrated EPST, literal skin temperature, wet-clothing effect, street-canyon geometry, or guaranteed personal sensation is claimed.'};
}
