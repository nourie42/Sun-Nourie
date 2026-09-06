import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {utciC,saturationHpa,researchComfort,radiantExposure} from '../public/weather-fusion/thermal-research.js';
const references=JSON.parse(readFileSync(new URL('./weather-utci-reference.json',import.meta.url),'utf8'));
for(const [i,p] of references.entries())test(`UTCI matches independent pythermalcomfort 4.4.2 reference ${i+1}`,()=>{
 const actual=utciC(p.ta,p.tr,p.v,p.rh);
 if(saturationHpa(p.ta)*p.rh/1000>5)assert.equal(actual,null,'Outside conservative vapor-pressure domain');
 else assert.ok(Math.abs(actual-p.utci)<1e-7,`${actual} vs ${p.utci}`);
});
test('UTCI domain boundaries and missing values never produce fabricated temperatures',()=>{
 for(const args of [[null,20,1,50],[55,55,1,50],[25,100,1,50],[25,25,18,50],[25,25,1,101],[25,25,1,-1]])assert.equal(utciC(...args),null);
 for(const current of [{temperature:null,wind:5,humidity:50},{temperature:80,wind:null,humidity:50},{temperature:80,wind:5,humidity:null}])assert.equal(researchComfort(current,.7).outdoors,null);
});
test('cloud and rain scenarios block direct sunlight while retaining diffuse/reflected energy',()=>{
 const data={temperature:82,dewpoint:68,wind:5};
 const sunny=radiantExposure({...data,condition:'Sunny'},.8),partial=radiantExposure({...data,condition:'Partly Cloudy'},.8),cloudy=radiantExposure({...data,condition:'Cloudy'},.8),rain=radiantExposure({...data,condition:'Rain'},.8);
 assert.ok(sunny.directNormal>partial.directNormal);assert.equal(cloudy.directNormal,0);assert.equal(rain.directNormal,0);
 assert.ok(cloudy.diffuseHorizontal>0&&cloudy.reflectedHorizontal>0);assert.ok(sunny.absorbedShade>0);assert.ok(sunny.mrtOpenC>sunny.mrtShadeC);
 const night=researchComfort({...data,condition:'Clear'},-.4);assert.equal(night.sun,null);assert.equal(night.outdoors,night.shade);assert.equal(night.radiation.directNormal,0);
});
