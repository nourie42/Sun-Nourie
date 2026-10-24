import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(root, 'weather_nourie_blend_v2.json'), 'utf8'));
const assert = (test, why) => { if (!test) throw new Error(why); };
const expected = [[0,24],[24,48],[48,72],[72,168],[168,264],[264,360]];
function validateSeries(label,bands,limits){
  assert(bands.length === limits.length,`${label} wrong number of bands`);
  bands.forEach((b,i) => {
    const [start,end] = limits[i];
    assert(b.start_hour_inclusive === start && b.end_hour_exclusive === end,`${label}/${b.id}: wrong lead interval`);
    const parts = Object.values(b.weights_percent);
    assert(parts.length>0 && parts.every(v => Number.isInteger(v) && v>=0 && v<=100),`${label}/${b.id}: invalid weights`);
    assert(parts.reduce((a,b)=>a+b,0)===100, `${label}/${b.id}: weights don't sum to 100`);
    assert(b.weights_percent.hrrr === undefined || end<=48 || b.weights_percent.hrrr===0,`${label}/${b.id}: HRRR beyond 48h`);
  });
  return bands.length;
}
assert(data.schema === 'weather-nourie-proposed-blend-v2','wrong config schema');
assert(data.status === 'IMPLEMENTATION_SPEC_ONLY_NOT_INSTALLED','do not mark spec as deployed');
assert(data.defaults.new_v2_public_forecast_enabled === false,'live v2 must be off by default');
assert(data.defaults.weathernext3_approved_for_public_blend === false,'WeatherNext3 cannot be silently approved');
const vars = data.variables;
let checked=0;
checked += validateSeries('temperature',vars.temperature.bands,expected);
checked += validateSeries('rain_probability',vars.rain_probability.bands,expected);
checked += validateSeries('rain_amount',vars.rain_amount.bands,expected.slice(0,4));
vars.rain_probability.bands.forEach(b=>assert(b.weights_percent.nws === (b.start_hour_inclusive<168?40:0),`${b.id}: violated locked NWS rain share`));
vars.temperature.bands.forEach(b=>{
  if(b.start_hour_inclusive>=168) assert(b.weights_percent.nws===0,`${b.id}: NWS horizon expired`);
  if(b.start_hour_inclusive>=264) assert(b.weights_percent.nbm===0,`${b.id}: NBM horizon expired`);
});
const winter=data.winter.user_selected;
assert(winter.length===2,'winter has changed unexpectedly');
assert(winter[0].weights_percent.wpc===60&&winter[0].weights_percent.hrrr===25&&winter[0].weights_percent.nam===15,'near-term winter weights changed');
assert(winter[1].weights_percent.wpc===60&&winter[1].weights_percent.ecmwf===20&&winter[1].weights_percent.weathernext3===10&&winter[1].weights_percent.gfs===10,'extended winter weights changed');
console.log(`PASS: ${checked} proposal weight bands verified, NWS/HRRR/NBM constraints verified.`);
console.log('Important: this checks the portable JSON only. It does NOT test website code, source availability, forecast accuracy, or production deployment.');
