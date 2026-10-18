import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
// Exercise the native event handlers. Browser focus, layout and hit testing
// require separate browser checks and are not represented by these elements.
function element(){
 return {hidden:false,attributes:{},handlers:{},style:{},innerHTML:'',scrolls:[],children:[],
  append(...children){this.children.push(...children);},
  setAttribute(key,value){this.attributes[key]=String(value);},
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);},
  scrollIntoView(options){this.scrolls.push(options);},
  emit(type,properties={}){const event={prevented:false,preventDefault(){this.prevented=true;},...properties};for(const handler of this.handlers[type]||[])handler(event);return event;},
 };
}

test('native shortcut labels retain their actual anchor or panel relationships',()=>{
 const html=read('index.html'),nav=html.match(/<nav class="weather-jump-nav"[\s\S]*?<\/nav>/)?.[0];
 assert.ok(nav);
 const links=[...nav.matchAll(/<(a|button)\b([^>]*)>[\s\S]*?<span class="jump-label">([^<]+)<\/span>[\s\S]*?<\/(?:a|button)>/g)];
 assert.deepEqual(links.map(match=>match[3]),['Map','Your Day','7-Day','AQI','Car Wash','Feel Meter','Snow','Compare']);
 for(const [,tag,attrs] of links){
  const href=attrs.match(/href="#([^"]+)"/)?.[1];
  if(tag==='a'){assert.ok(href);if(href==='dewpoint-gross-meter')assert.match(attrs,/aria-controls="dewpoint-gross-meter"/);else assert.ok(html.includes(`id="${href}"`),`${href} is a real native section`);}
  else assert.match(attrs,/type="button"/);
 }
});

test('Feel Meter provides a real visible destination even before the first forecast arrives',()=>{
 const button=element(),host=element(),nodes=new Map([['open-gross',button],['car-wash-forecast',host],['skin-exposure',host]]),classes=new Set();
 if(read('index.html').includes('id="dewpoint-gross-meter"'))nodes.set('dewpoint-gross-meter',element());
 host.insertAdjacentElement=(_position,panel)=>nodes.set(panel.id,panel);
 host.after=panel=>nodes.set(panel.id,panel);
 const body={append:panel=>nodes.set(panel.id,panel),appendChild:panel=>nodes.set(panel.id,panel)};
 const context={document:{readyState:'complete',body,documentElement:{classList:{add:name=>classes.add(name)}},getElementById:id=>nodes.get(id)||null,createElement:()=>element(),querySelector:()=>host},location:{hash:''},requestAnimationFrame:fn=>fn(),matchMedia:()=>({matches:true})};
 runInNewContext(read('gross-toggle.js'),context);button.emit('click');
 const panel=nodes.get('dewpoint-gross-meter');
 assert.ok(panel,'the activated control has a visible destination while data is pending');assert.equal(panel.hidden,false);assert.ok(classes.has('gross-open'));assert.equal(button.attributes['aria-expanded'],'true');assert.equal(panel.scrolls.length,1);
 assert.ok(panel.children.some(child=>child.attributes.role==='status'&&/loading|location|city/i.test(child.textContent)),'a pending panel explains how to obtain the reading');
});

test('Feel Meter click and Space activation reveal the panel and honor reduced motion',()=>{
 for(const activation of ['click','space']){
  const button=element(),panel=element(),classes=new Set();
  const context={document:{readyState:'complete',documentElement:{classList:{add:name=>classes.add(name)}},getElementById:id=>id==='open-gross'?button:id==='dewpoint-gross-meter'?panel:null},location:{hash:''},requestAnimationFrame:fn=>fn(),matchMedia:()=>({matches:true})};
  runInNewContext(read('gross-toggle.js'),context);
  const event=activation==='click'?button.emit('click'):button.emit('keydown',{key:' '});
  assert.ok(event.prevented);assert.ok(classes.has('gross-open'));assert.equal(button.attributes['aria-expanded'],'true');assert.equal(panel.scrolls.length,1);assert.equal(panel.scrolls[0].behavior,'auto');
 }
});

test('Car Wash responds before data loads, then uses the actual selected forecast',()=>{
 const app=read('app.js'),start=app.indexOf("$('open-car-wash').addEventListener('click',"),end=app.indexOf("\n$('basemap')",start);
 assert.ok(start>=0&&end>start);
 const button=element(),panel=element(),calls=[];
 const context={$:id=>id==='open-car-wash'?button:id==='car-wash-forecast'?panel:null,forecast:null,matchMedia:()=>({matches:true}),renderWeatherPanel:(id,title,render)=>{calls.push({id,title});panel.innerHTML=render();},renderCarWashForecast:data=>`Forecast for ${data.location.name}`};
 runInNewContext(app.slice(start,end),context);
 button.emit('click');assert.equal(panel.hidden,false);assert.equal(button.attributes['aria-expanded'],'true');assert.match(panel.innerHTML,/role="status"/);assert.match(panel.innerHTML,/city|location|loading/i);assert.equal(panel.scrolls[0].behavior,'auto');
 context.forecast={location:{name:'Boston'}};button.emit('click');assert.equal(calls.length,1);assert.equal(panel.innerHTML,'Forecast for Boston');
});

test('Compare opens and closes its real panel while provider requests are still pending',()=>{
 const source=read('wn-blend.js'),start=source.indexOf('async function init()'),end=source.indexOf('// Reload the comparison',start);
 assert.ok(start>=0&&end>start);
 const nodes=new Map([['open-compare',element()]]),hero={after(section){nodes.set(section.id,section);}},pending=()=>new Promise(()=>{});
 const document={querySelector:selector=>selector==='.hero'?hero:null,getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],createElement(){const section=element();Object.defineProperty(section,'innerHTML',{set(value){for(const id of value.matchAll(/id="([^"]+)"/g))nodes.set(id[1],element());},get(){return '';}});return section;}};
 const context={document,VARIABLES:{temp:{label:'Temperature'}},curVar:'temp',getLoc:()=> 'boston',fetchJSON:pending,loadWNFeed:pending,render(){},window:{addEventListener(){}}};
 runInNewContext(source.slice(start,end)+'\nthis.initialization=init();',context);
 const button=nodes.get('open-compare'),panel=nodes.get('wn-compare-section');
 assert.ok(panel);assert.equal(typeof button.onclick,'function');assert.equal(panel.hidden,true);
 button.onclick();assert.equal(panel.hidden,false);assert.equal(button.attributes['aria-expanded'],'true');assert.equal(panel.scrolls.length,1);
 button.onclick();assert.equal(panel.hidden,true);assert.equal(button.attributes['aria-expanded'],'false');
});
