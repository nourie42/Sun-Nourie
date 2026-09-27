import test from 'node:test';
import assert from 'node:assert/strict';
import {installWeatherNextAccess} from '../public/weather-fusion/weathernext-access.js';

test('NVIDIA location forecast loads automatically without an extra access button or password',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  const calls=[],forecast={hidden:false,before(panel){this.panel=panel;}},title={textContent:''};
  const button={disabled:false},message={textContent:''},form={hidden:false,addEventListener(){}};
  const panel={hidden:true,setAttribute(){},querySelector(selector){return selector==='form'?form:selector==='button'?button:message;}};
  globalThis.document={createElement:()=>panel,getElementById:id=>id==='forecast'?forecast:id==='weathernext-access-title'?title:null};
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    if(String(url).includes('/compare/google?')){
      if(calls.filter(x=>x.url.includes('/compare/google?')).length===1)return {ok:false,status:409,json:async()=>({code:'LOCATION_REQUIRED',error:'Load selected location'})};
      return {ok:true,status:200,json:async()=>({current:{temperature:72}})};
    }
    return {ok:true,status:200,json:async()=>({})};
  };
  try{
    const access=installWeatherNextAccess({});
    const data=await access.requestForecast('latitude=35.79&longitude=-78.48&name=Knightdale',new AbortController().signal);
    assert.equal(data.current.temperature,72);
    assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);
    assert.equal(forecast.hidden,false);
    assert.equal(panel.hidden,true);
  }finally{
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    globalThis.fetch=previousFetch;
  }
});
