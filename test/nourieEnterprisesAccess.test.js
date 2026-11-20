import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerNourieEnterprisesAccess,isProtectedNourieEnterprisesPath} from '../src/nourieEnterprisesAccess.js';

const PASSWORD='test-only-enterprise-password';
async function setup(t,config={}) {
  const app=express();
  registerNourieEnterprisesAccess(app,{
    env:{NOURIE_ENTERPRISES_PASSWORD:PASSWORD,...(config.env??{})},
    secret:'test-enterprises-signature-key',
    now: config.now??Date.now,
  });
  app.use((req,res)=>res.set('Cache-Control','public, max-age=3600').json({allowed:true,path:req.originalUrl}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url='http://127.0.0.1:'+server.address().port;
  const request=(target,opts={})=>fetch(url+target,{redirect:'manual',...opts});
  const login=(pw=PASSWORD,target='/nourie-enterprises/',headers={})=>request('/nourie-enterprises/login',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},
    body:new URLSearchParams({password:pw,returnTo:target}),
  });
  return {request,login};
}

test('protect page, static assets, methods and path spellings',async t=>{
  const {request}=await setup(t);
  for(const pathname of ['/nourie-enterprises','/nourie-enterprises/','/nourie-enterprises/index.html','/nourie-enterprises/style.css','/nourie-enterprises/app.js','/%6Eourie-enterprises/index.html','/nourie-enterprises%2Fapp.js']){
    for(const method of ['GET','HEAD','POST']){
      const r=await request(pathname,{method});
      assert.equal(r.status,401,method+' '+pathname);
      assert.equal(r.headers.get('cache-control'),'private, no-store');
      assert.match(r.headers.get('x-robots-tag'),/noindex/);
    }
  }
  assert.equal((await request('/weather-fusion/')).status,200);
  assert.equal((await request('/health')).status,200);
});
test('password missing fails closed and does not affect the weather site',async t=>{
  const {request,login}=await setup(t,{env:{NOURIE_ENTERPRISES_PASSWORD:''}});
  assert.equal((await request('/nourie-enterprises/')).status,503);
  assert.equal((await login()).status,503);
  assert.equal((await request('/weather-fusion/')).status,200);
});
test('valid session authorizes assets without revealing password, other auth cookies do not unlock',async t=>{
  const {request,login}=await setup(t);
  const r=await login(PASSWORD,'/nourie-enterprises/?concept=1');
  assert.equal(r.status,303);
  assert.equal(r.headers.get('location'),'/nourie-enterprises/?concept=1');
  const header=r.headers.get('set-cookie');
  assert.match(header,/HttpOnly; SameSite=Strict; Max-Age=43200/);
  assert.ok(!header.includes(PASSWORD));
  const cookie=header.split(';')[0];
  for(const p of ['/nourie-enterprises/','/nourie-enterprises/app.js','/nourie-enterprises/style.css']){
    const allowed=await request(p,{headers:{Cookie:cookie}});
    assert.equal(allowed.status,200,p);
    assert.equal(allowed.headers.get('cache-control'),'private, no-store');
  }
  assert.equal((await request('/nourie-enterprises/',{headers:{Cookie:'weather_site_auth=abc'}})).status,401);
  assert.equal((await request('/nourie-enterprises/',{headers:{Cookie:cookie.slice(0,-1)+'a'}})).status,401);
});
test('wrong password, origin protections, redirect safety, logout and expiry',async t=>{
  let now=Date.now();
  const {request,login}=await setup(t,{now:()=>now});
  assert.equal((await login('incorrect')).status,401);
  assert.equal((await login(PASSWORD,'/',{Origin:'https://attacker.example'})).status,403);
  for(const redirect of ['https://bad.example','//bad.example','/weather-fusion/','/nourie-enterprises/logout','/nourie-enterprises/login']){
    assert.equal((await login(PASSWORD,redirect)).headers.get('location'),'/nourie-enterprises/');
  }
  const cookie=(await login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/nourie-enterprises/logout',{method:'POST',headers:{Cookie:cookie}})).status,303);
  assert.equal((await request('/nourie-enterprises/',{headers:{Cookie:cookie}})).status,401);
  const newer=(await login()).headers.get('set-cookie').split(';')[0];
  now+=12*60*60*1000;
  assert.equal((await request('/nourie-enterprises/',{headers:{Cookie:newer}})).status,401);
});
test('sign-in rejects six failed guesses per period and uses Secure cookie on HTTPS',async t=>{
  const {login,request}=await setup(t);
  for(let i=0;i<6;i++)assert.equal((await login('bad')).status,401);
  assert.equal((await login()).status,429);
  assert.equal((await request('/weather-fusion/')).status,200);
});
test('secure cookies on public HTTPS',async t=>{
  const {login}=await setup(t,{env:{NODE_ENV:'production'}});
  assert.match((await login()).headers.get('set-cookie'),/; Secure/);
});
test('canonical route matching is restricted to one feature',()=>{
  for(const p of ['/nourie-enterprises/','/NOURIE-ENTERPRISES/index.html','/%6eourie-enterprises/app.js','/x/../nourie-enterprises/index.html']){
    assert.equal(isProtectedNourieEnterprisesPath(p),true,p);
  }
  for(const p of ['/weather-fusion/','/nourie-enterprises-other','/fuel-atlas.html'])assert.equal(isProtectedNourieEnterprisesPath(p),false,p);
});
