import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeries,CHART_DRAW_ORDER,CHART_LINE_STYLE,COLORS,nicePrecipitationTicks,comparisonReading} from '../public/weather-fusion/wn-blend.js';
import {precipitationLikelihood,publishedPrecipitationLikelihood} from '../src/weatherFusionDirect.js';
import {rainChancePolicy} from '../src/weatherFusionPolicy.js';

const H=3600000;
const iso=time=>new Date(time).toISOString();

test('WeatherNext 3 and GEFS are drawn with colors and dashes that stay apart from WeatherNext and GFS',()=>{
  for(const id of ['weathernext3','gefs']){
    assert.ok(CHART_DRAW_ORDER.includes(id));
    assert.ok(CHART_LINE_STYLE[id].dash);
    assert.ok(COLORS[id]);
  }
  assert.notEqual(COLORS.weathernext3,COLORS.wn);
  assert.notEqual(COLORS.gefs,COLORS.gfs);
  assert.notEqual(CHART_LINE_STYLE.weathernext3.dash,CHART_LINE_STYLE.wn.dash);
  assert.notEqual(CHART_LINE_STYLE.gefs.dash,CHART_LINE_STYLE.weathernext3.dash);
});

test('precipitation ticks use round steps and low rain stays visible as under 5 percent',()=>{
  const ticks=nicePrecipitationTicks(0.45);
  assert.deepEqual(ticks,[0,0.1,0.2,0.3,0.4,0.5]);
  assert.equal(comparisonReading('pop','nourie',3,null,v=>`${Math.round(v)}%`),'<5%');
  assert.equal(comparisonReading('pop','nws',0,'probability'),'<5%');
  assert.equal(comparisonReading('pop','ecmwf',100,'deterministic'),'Wet');
  assert.equal(comparisonReading('pop','ecmwf',100/3,'deterministic'),'Light');
  assert.equal(comparisonReading('pop','hrrr',0,'deterministic'),'Dry');
  assert.equal(comparisonReading('pop','nbm',42,'probability'),'42%');
  assert.equal(comparisonReading('rain','nourie',0,null,v=>`${v.toFixed(2)}"`),'0.00"');
});

test('each model rain line uses that model daily maximum, not the blend peak hour',()=>{
  const start=Date.parse('2026-11-06T04:00:00Z'),end=start+24*H,now=Date.parse('2026-11-01T16:00:00Z');
  const rows=Array.from({length:24},(_,i)=>{
    const time=start+i*H;
    const blend=i===3?80:10;
    return {time:iso(time),end:iso(time+H),precipitation:0,rainLikelihood:{
      value:blend,
      sourceValues:{nws:blend===80?20:5,nbm:i===10?100:0,ecmwf:i===3?100:0},
      sourceKinds:{nws:'probability',nbm:'probability',ecmwf:'deterministic'}
    }};
  });
  const day={date:'2026-11-06',rainLikelihood:{value:80,aggregation:'maximum-hourly',coverage:{complete:true,availableHours:24,expectedHours:24},peak:{sourceValues:{nws:20,nbm:0,ecmwf:100}},window:{start:iso(start),end:iso(end)}}};
  const today={date:'2026-11-01',rainLikelihood:{value:0,coverage:{complete:true,availableHours:8,expectedHours:8},peak:{sourceValues:{}}},high:60,low:40};
  const fx={location:{timeZone:'America/New_York'},days:[today,day],hours:[],rainTimeline:rows,feeds:[],metricForecasts:{series:{}}};
  const built=buildSeries(fx,null,'pop',now);
  assert.equal(built.modelMaps[1].nbm,100);
  assert.equal(built.modelMaps[1].ecmwf,100);
  assert.equal(built.modelMaps[1].nws,20);
  assert.equal(built.modelKinds[1].nbm,'probability');
  assert.equal(built.modelKinds[1].ecmwf,'deterministic');
});

test('a partial final day keeps the blend and the model lines and records the short coverage',()=>{
  const start=Date.parse('2026-11-10T05:00:00Z'),end=start+18*H,now=Date.parse('2026-11-01T16:00:00Z');
  const rows=Array.from({length:18},(_,i)=>({time:iso(start+i*H),end:iso(start+(i+1)*H),precipitation:.01,rainLikelihood:{value:i===4?33:4,sourceValues:{nbm:i===4?40:2,ecmwf:i===4?100:0},sourceKinds:{nbm:'probability',ecmwf:'deterministic'}}}));
  const day={date:'2026-11-10',rainLikelihood:{value:null,availablePeak:33,aggregation:'maximum-hourly',coverage:{complete:false,availableHours:18,expectedHours:24},window:{start:iso(start),end:iso(end)}}};
  const today={date:'2026-11-01',rainLikelihood:{value:5,coverage:{complete:true,availableHours:8,expectedHours:8}},high:60,low:40};
  const fx={location:{timeZone:'America/New_York'},days:[today,day],hours:[],rainTimeline:rows,feeds:[],metricForecasts:{series:{}}};
  const built=buildSeries(fx,null,'pop',now);
  assert.equal(built.forecastValues[1],33);
  assert.equal(built.modelMaps[1].nbm,40);
  assert.equal(built.modelMaps[1].ecmwf,100);
  assert.deepEqual(built.partialDays[1],{availableHours:18,expectedHours:24});
  assert.equal(built.partialDays[0],null);
});

test('the first three blend days publish the NWS chance while NBM probability stays available for the line',()=>{
  assert.deepEqual(rainChancePolicy(1,{nws:0,ecmwf:.012,nbm:.2,wn:0},{blendV2:true}),{nws:1});
  const later=rainChancePolicy(4,{nws:0,ecmwf:.2,nbm:.1,wn:.05,gefs:.2,weathernext3:.1},{blendV2:true});
  assert.equal(later.nws,.4);
  assert.equal(later.gefs,.1);
  assert.equal(later.weathernext3,.1);
  const scored=precipitationLikelihood(12,{sourceValues:{hrrr:0,ecmwf:.012,nbm:0}},{nws:1},{nbmProbability:47});
  assert.equal(scored.value,12);
  assert.equal(scored.sourceValues.nbm,47);
  assert.equal(scored.sourceKinds.nbm,'probability');
  assert.equal(scored.sourcePoints.ecmwf,null);
  assert.equal(scored.reductionReasons.ecmwf,'uncorroborated');
  assert.ok(Math.abs(scored.sourceValues.ecmwf-100/3)<1e-8);
});

test('NBM published probability replaces the wet or dry signal when the hour is scored',()=>{
  const score=publishedPrecipitationLikelihood(20,{sourceValues:{hrrr:0,ecmwf:0,nbm:.2}},{nws:.4,hrrr:.3,ecmwf:.1,nbm:.2},{nbmProbability:55});
  assert.equal(score.sourceKinds.nbm,'probability');
  assert.equal(score.sourceValues.nbm,55);
  assert.equal(score.sourcePoints.nbm,11);
  assert.equal(score.reductionReasons.nbm,undefined);
});
