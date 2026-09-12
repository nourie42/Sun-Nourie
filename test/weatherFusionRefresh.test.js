import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
const section=app.slice(app.indexOf('function refreshOpenDay()'),app.indexOf('\nfunction setBasemap()'));
const day=date=>({date,label:date,high:84,low:71,condition:'Cloudy',nightCondition:'Clear',chance:59,confidence:{label:'Moderate',key:'moderate',sourceCount:3,factors:[],note:''}});
function harness() {
  const dialog={open:false,scrollTop:0,shown:0,closed:0,showModal(){this.open=true;this.shown++;},close(){this.open=false;this.closed++;}};
  const root={html:'',input:null,confidence:null,summary:null,
    get innerHTML(){return this.html;},
    set innerHTML(value){
      if(this.contains(context.document.activeElement))context.document.activeElement=null;
      this.html=value;
      this.input={id:'day-graph-hour',value:'0',events:[],dispatchEvent(event){this.events.push(event.type);},matches:()=>false,focus(options){this.focusOptions=options;context.document.activeElement=this;}};
      this.confidence={open:false};
      this.summary={id:'',matches:selector=>selector==='.dialog-confidence > summary',focus(options){this.focusOptions=options;context.document.activeElement=this;}};
    },
    contains(element){return !!element&&(element===this.input||element===this.summary);},
    querySelector(selector){return selector==='#day-graph-hour'?this.input:selector==='.dialog-confidence'?this.confidence:selector==='.dialog-confidence > summary'?this.summary:null;},
  };
  const elements={'day-dialog':dialog,'day-content':root,'day-science-link':{addEventListener(){}}};
  const context={
    $:id=>id==='day-graph-hour'?root.input:elements[id],document:{activeElement:null},forecast:{location:{timeZone:'UTC'},days:[day('2026-09-12'),day('2026-09-13')]},activeDayDetail:null,
    Date,Event:class {constructor(type){this.type=type;}},finite:Number.isFinite,esc:String,temperature:value=>`${value}°`,percent:value=>`${value}%`,inches:value=>`${value} in`,
    dailyDisplay:d=>({label:d.label,condition:d.condition,tonight:false,primary:d.high,secondary:d.low,primaryLabel:'High'}),
    forecastPeriodSummary:(f,index)=>({chance:f.days[index].chance,amount:.1,summary:`Updated chance ${f.days[index].chance}%.`}),
    dayGraphHTML:()=>'<section></section>',installDayGraph(){},
    dayGraphPoints:(f,index)=>[7,8,9].map(hour=>({time:`${f.days[index].date}T0${hour}:00:00Z`})),
  };
  runInNewContext(`${section}\nthis.show=showDay;this.refresh=refreshOpenDay;`,context);
  return {context,dialog,root};
}

test('the forecast API bypasses browser cache without changing source timestamps',()=>{
  const api=app.slice(app.indexOf('async function api('),app.indexOf('\nfunction icon('));
  assert.match(api,/cache: 'no-store'/);
  assert.doesNotMatch(api,/assembledAt\s*=|issuedAt\s*=|runAt\s*=/);
});

test('both page modes refresh each minute, on return, restored page, and reconnect',()=>{
  assert.match(app,/setInterval\(\(\) => \{ if \(!document\.hidden && !busy\) void load\(\); \}, 60000\)/);
  assert.match(app,/visibilitychange[\s\S]*?else if \(!busy\) void load\(\)/);
  assert.match(app,/window\.addEventListener\('online', \(\) => \{ if \(!document\.hidden && !busy\) void load\(\)/);
  assert.match(app,/window\.addEventListener\('pageshow', \(event\) => \{ if \(event\.persisted && !document\.hidden && !busy\) void load\(\)/);
  assert.match(app,/draw\('day-content', 'Forecast details', \(\) => refreshOpenDay\(\)\)/);
});

test('an open forecast dialog replaces stale numbers on the next snapshot without reopening',()=>{
  const {context,dialog,root}=harness();
  context.show(1);
  assert.match(root.innerHTML,/59%/);
  dialog.scrollTop=210;root.confidence.open=true;root.input.value='2';
  context.forecast.days[1].chance=31;
  context.refresh();
  assert.match(root.innerHTML,/31%/);assert.doesNotMatch(root.innerHTML,/59%/);
  assert.equal(dialog.shown,1,'Refresh must not reopen the modal or steal focus.');
  assert.equal(dialog.scrollTop,210);assert.equal(root.confidence.open,true);
  assert.equal(root.input.value,'2');assert.deepEqual(root.input.events,['input']);
});

test('the selected calendar day stays selected after the forecast rolls to a new day',()=>{
  const {context,dialog,root}=harness();
  context.show(1);
  context.forecast.days=[{...day('2026-09-13'),chance:22},day('2026-09-14')];
  context.refresh();
  assert.equal(context.activeDayDetail.date,'2026-09-13');assert.match(root.innerHTML,/22%/);
  assert.equal(dialog.shown,1);
  context.forecast.days=[day('2026-09-14')];
  context.refresh();
  assert.equal(dialog.open,false);assert.equal(context.activeDayDetail,null);
});

test('background refresh never opens a closed day dialog',()=>{
  const {context,dialog}=harness();
  context.refresh();assert.equal(dialog.shown,0);
  context.show(0);dialog.close();context.refresh();assert.equal(dialog.shown,1);
});

test('periodic dialog refresh preserves keyboard focus on the graph and confidence summary',()=>{
  const {context,root}=harness();context.show(1);
  context.document.activeElement=root.input;
  context.refresh();assert.equal(context.document.activeElement,root.input);assert.equal(root.input.focusOptions.preventScroll,true);
  context.document.activeElement=root.summary;
  context.refresh();assert.equal(context.document.activeElement,root.summary);assert.equal(root.summary.focusOptions.preventScroll,true);
  const outside={id:'close-day'};context.document.activeElement=outside;
  context.refresh();assert.equal(context.document.activeElement,outside,'Refreshing content must not steal focus from another control.');
});

test('forecast details omit the user-rejected hour-by-hour explanatory comment',()=>{
  assert.doesNotMatch(section,/story\.sourceNote|overnight\.sourceNote|dialog-data-note|This wording uses/);
});
