import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackClock,playbackSkyState} from '../public/weather-fusion/weather-playback.js';
import {buildTimeline} from '../public/weather-fusion/atmos-model.js';
import {hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {comfortArtworkContext} from '../public/weather-fusion/comfort-outlook.js';
import {comfortSceneState} from '../public/weather-fusion/exposure-scene.js';

const now=Date.parse('2026-10-16T16:30:00Z');
function fixture(){
 const location={latitude:42.60118,longitude:-76.18048,timeZone:'America/New_York'};
 const hours=[],series={feels:[],temperature:[],dewpoint:[],wind:[],gust:[]};
 for(const [time,temperature,condition,pop,skyCover] of [
  ['2026-10-16T16:00:00Z',80,'Sunny',3,0],
  ['2026-10-16T17:00:00Z',82,'Sunny',3,0],
  ['2026-10-17T07:00:00Z',38,'Rain',90,100],
  ['2026-10-17T08:00:00Z',36,'Chance Rain Showers',14,80],
  ['2026-10-17T12:00:00Z',30,'Snow',90,100],
 ]){
  const inputs={temperature,condition,dewpoint:temperature-5,wind:10,humidity:75,skyCover,type:'guidance'};
  const comfort=thermalComfort(inputs,location,Date.parse(time));
  hours.push({time,temperature,condition,pop,skyCover,precipitation:pop>=50?.03:0});
  series.feels.push({time,value:Number(comfort.rawOutdoors.toFixed(1)),inputs,shadeValue:Number(comfort.rawShade.toFixed(1))});
  for(const [field,value] of [['temperature',temperature],['dewpoint',temperature-5],['wind',10]])series[field].push({time,value});
 }
 return {location,hours,current:{time:'2026-10-16T16:00:00Z',temperature:80,dewpoint:75,humidity:75,wind:10,condition:'Sunny',skyCover:0,type:'observation'},assembledAt:new Date(now).toISOString(),metricForecasts:{series}};
}
function clockFixture(steps){
 const selected=[],states=[],pending=new Map();let sequence=0;
 const clock=createPlaybackClock({onSelect:step=>selected.push(step),onState:state=>states.push(state),schedule:fn=>{const id=++sequence;pending.set(id,fn);return id;},cancel:id=>pending.delete(id)});
 clock.setSteps(steps);
 return {clock,selected,states,pending,tick(){const [id,fn]=pending.entries().next().value||[];assert.ok(fn,'playback has a scheduled step');pending.delete(id);fn();}};
}

test('playback timeline keeps the exact hourly display sample times, weather and clothing inputs',()=>{
 const forecast=fixture(),samples=hourlyDisplaySamples(forecast,now),steps=buildTimeline(forecast,now);
 assert.equal(steps.length,samples.length);
 samples.forEach((sample,index)=>{
  const step=steps[index];assert.equal(step.id,sample.id);assert.equal(step.condition,sample.condition);
  assert.equal(step.feels,sample.feels);assert.equal(step.temperature,sample.temperature);
  assert.equal(step.isDay,sample.isDay);assert.equal(step.rain,sample.pop);
 });
 assert.equal(steps.find(step=>step.id==='2026-10-17T07:00:00.000Z').isDay,false,'3 AM is nighttime at Cortland');
 assert.equal(steps[1].rainShown,null,'sub-5 rain chances stay hidden without changing forecast values');
});

test('playback rain, snow and nighttime follow the same complete scene rules as the people',()=>{
 const forecast=fixture(),samples=hourlyDisplaySamples(forecast,now),steps=buildTimeline(forecast,now);
 for(const step of steps.slice(1)){
  const sample=samples.find(row=>row.id===step.id),context={...comfortArtworkContext(forecast,sample,now),condition:sample.condition,pop:sample.pop};
  const art=comfortSceneState(sample.isDay,sample.condition,sample.feels,context),preview=playbackSkyState(step);
  assert.equal(preview.time,Date.parse(sample.time));
  if(art.key==='rain')assert.ok(preview.scene.rain>0);
  if(art.key==='carry-umbrella')assert.equal(preview.scene.rain,0,'possibility does not become rain falling on the viewer');
  if(art.key==='snow')assert.ok(preview.scene.snow>0);
  if(!sample.isDay)assert.match(art.asset,/night|dawn/);
 }
});

test('confirmed current precipitation cannot be erased by an older cloudy description',()=>{
 const base={time:now,isNow:true,rainNow:true,rain:null,wind:7,skyCover:100,condition:'Cloudy',kind:'cloudy'};
 assert.ok(playbackSkyState(base).scene.rain>0);
 const snow=playbackSkyState({...base,kind:'snow',condition:'Snow'}).scene;
 assert.ok(snow.snow>0);assert.equal(snow.rain,0,'confirmed snow retains its own phase');
});

test('playback selects one complete published hour, stops at the last hour and restarts at now',()=>{
 const steps=buildTimeline(fixture(),now),{clock,selected,pending,tick}=clockFixture(steps);
 clock.play();assert.equal(clock.state().playing,true);
 tick();assert.equal(selected.at(-1),steps[1]);
 for(let i=2;i<steps.length;i++)tick();
 assert.equal(clock.state().playing,false);assert.equal(clock.state().step,steps.at(-1));assert.equal(pending.size,0);
 clock.play();assert.equal(selected.at(-1),steps[0]);assert.equal(clock.state().playing,true);
 clock.pause();assert.equal(pending.size,0);
});

test('scrubbing and external hourly selections pause playback without selection feedback',()=>{
 const steps=buildTimeline(fixture(),now),{clock,selected,pending,tick}=clockFixture(steps);
 clock.play();tick();clock.select(3);
 assert.equal(clock.state().step,steps[3]);assert.equal(clock.state().playing,false);assert.equal(pending.size,0);
 const published=selected.length;
 clock.selectTime(steps[2].id,{notifySelection:false});
 assert.equal(clock.state().step,steps[2]);assert.equal(selected.length,published,'hourly click need not call back into comfort renderer');
 clock.selectTime('now');assert.equal(selected.at(-1),steps[0]);
});

test('location reset clears playback and a same-location refresh retains the exact selected timestamp',()=>{
 const steps=buildTimeline(fixture(),now),{clock,pending}=clockFixture(steps);
 clock.select(2);clock.play();clock.setSteps(steps,{keepTime:steps[2].id});
 assert.equal(clock.state().selected,2);assert.equal(clock.state().playing,false);assert.equal(pending.size,0);
 clock.setSteps([]);assert.equal(clock.state().step,null);assert.equal(clock.state().length,0);
 clock.setSteps(steps);assert.equal(clock.state().step.isNow,true);
 clock.play();clock.destroy();assert.equal(pending.size,0);assert.equal(clock.state().step,null);
});

test('a same-place forecast refresh preserves playing at the selected hour with one replacement timer',()=>{
 const steps=buildTimeline(fixture(),now),{clock,selected,pending,tick}=clockFixture(steps);
 clock.play();tick();
 const selectedId=clock.state().step.id,oldTimer=[...pending.keys()][0],published=selected.length;
 const refreshed=buildTimeline(fixture(),now+1000);
 clock.setSteps(refreshed,{keepTime:selectedId,preservePlaying:true});
 assert.equal(clock.state().playing,true);
 assert.equal(clock.state().step.id,selectedId);
 assert.equal(selected.length,published,'refresh does not republish a different people hour');
 assert.equal(pending.size,1);assert.equal(pending.has(oldTimer),false,'the prior play timer is cancelled');
 tick();assert.equal(clock.state().step.id,steps[2].id,'the next tick continues forward rather than resetting to now');
 clock.setSteps(refreshed,{keepTime:clock.state().step.id});
 assert.equal(clock.state().playing,false,'new-place replacement still pauses unless preservation is explicitly requested');
 assert.equal(pending.size,0);
});
