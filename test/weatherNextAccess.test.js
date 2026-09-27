import test from 'node:test';
import assert from 'node:assert/strict';
import {installWeatherNextAccess} from '../public/weather-fusion/weathernext-access.js';

function installDom(){
 const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
 const forecast={hidden:false,before(panel){this.panel=panel;}},title={textContent:''},message={textContent:''};
 const panel={hidden:true,setAttribute(){},querySelector(selector){return selector==='h2'?title:message;}};
 globalThis.document={createElement:()=>panel,getElementById:id=>id==='forecast'?forecast:null};
 return {forecast,panel,title,message,restore(){if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;globalThis.fetch=previousFetch;}};
}

test('NVIDIA location forecast renders the successful automatic location response directly',async()=>{
 const dom=installDom(),calls=[];
 globalThis.fetch=async(url,options={})=>{
  calls.push({url:String(url),method:options.method||'GET'});
  if(String(url).includes('/compare/google?'))return {ok:false,status:409,json:async()=>({code:'LOCATION_REQUIRED',error:'Load selected location'})};
  return {ok:true,status:200,json:async()=>({current:{temperature:72},hours:[{temperature:72}]})};
 };
 try{
  const access=installWeatherNextAccess({});
  const data=await access.requestForecast('latitude=35.79&longitude=-78.48&name=Knightdale',new AbortController().signal);
  assert.equal(data.current.temperature,72);
  assert.deepEqual(calls.map(call=>call.method),['GET','POST']);
  assert.equal(dom.forecast.hidden,false);
  assert.equal(dom.panel.hidden,true);
 }finally{dom.restore();}
});

test('NVIDIA location lookup failure leaves loading and gives an actionable retry message',async()=>{
 const dom=installDom();
 globalThis.fetch=async(url)=>String(url).includes('/compare/google?')
  ?{ok:false,status:409,json:async()=>({code:'LOCATION_REQUIRED',error:'Load selected location'})}
  :{ok:false,status:503,json:async()=>({error:'WeatherNext service unavailable.'})};
 try{
  const access=installWeatherNextAccess({});
  await assert.rejects(access.requestForecast('latitude=35.79&longitude=-78.48',new AbortController().signal),/WeatherNext service unavailable/);
  assert.equal(dom.panel.hidden,false);
  assert.equal(dom.forecast.hidden,true);
  assert.equal(dom.title.textContent,'Forecast unavailable');
  assert.match(dom.message.textContent,/WeatherNext service unavailable.*Refresh to try again/);
 }finally{dom.restore();}
});
