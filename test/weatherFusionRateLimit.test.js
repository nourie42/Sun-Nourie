import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {clientIp} from '../src/clientIp.js';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';

test('Cloudflare client IP is used only on Render, ignoring spoofable forwarded chains',()=>{
  const req={headers:{'cf-connecting-ip':'192.0.2.10','x-forwarded-for':'203.0.113.5, 192.0.2.10, 198.51.100.1'},ip:'198.51.100.1'};
  assert.equal(clientIp(req,{RENDER:'true'}),'192.0.2.10');
  assert.equal(clientIp(req,{}),'198.51.100.1');
  assert.equal(clientIp({...req,headers:{'cf-connecting-ip':'invalid','x-forwarded-for':'203.0.113.5'}},{RENDER:'true'}),'198.51.100.1');
});

test('one Render client exhausting the weather request limit leaves another available',async t=>{
  const app=express();
  registerWeatherFusionRoutes(app,{env:{RENDER:'true'},fetchImpl:async()=>{throw new Error('No external sources needed');}});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}/api/weather-fusion/search?q=`;
  const request=ip=>fetch(url,{headers:{'CF-Connecting-IP':ip,'X-Forwarded-For':'203.0.113.5, 198.51.100.1'}});
  for(let i=0;i<45;i++)assert.equal((await request('192.0.2.10')).status,200);
  assert.equal((await request('192.0.2.10')).status,429);
  assert.equal((await request('192.0.2.11')).status,200);
});
