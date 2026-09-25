import express from 'express';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest();
const cookieName='wn_access';
export function createWeatherNextAccess(app,{password=process.env.WEATHERNEXT_SHARED_PASSWORD||'',now=Date.now,origin=process.env.WEATHERNEXT_PUBLIC_ORIGIN||'https://sun-nourie-live.onrender.com'}={}){
 const sessions=new Map(),attempts=new Map();
 const configured=password.length>=12&&password.length<=256;
 const cleanup=map=>{for(const [key,value] of map)if(value.expires<=now())map.delete(key);};
 const authorized=req=>{
  cleanup(sessions);
  const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  return !!token&&sessions.has(token);
 };
 const sameOrigin=(req,res,next)=>{
  if(req.headers.origin!==origin||req.headers['x-weathernext-request']!=='1')return res.status(403).json({error:'Open the forecast page to make this request.'});
  next();
 };
 const requireAccess=(req,res,next)=>{
  if(!configured)return res.status(503).json({error:'Private location lookups are awaiting server setup.',code:'SETUP_REQUIRED'});
  if(!authorized(req))return res.status(401).json({error:'Password required',code:'PASSWORD_REQUIRED'});
  next();
 };
 app.get('/api/weather-fusion/compare/access',(req,res)=>res.set('Cache-Control','no-store').json({configured,unlocked:authorized(req)}));
 app.post('/api/weather-fusion/compare/unlock',sameOrigin,express.json({limit:'2kb'}),(req,res)=>{
  res.set('Cache-Control','no-store');cleanup(attempts);
  // Global ceiling also applies: do not trust client-supplied forwarding headers.
  const key=req.socket.remoteAddress||'unknown',entry=attempts.get(key)||{count:0,expires:now()+15*60000};
  const global=attempts.get('*')||{count:0,expires:now()+15*60000};
  if(entry.count>=8||global.count>=40)return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
  if(!configured)return res.status(503).json({error:'The shared password has not been configured by the site owner.'});
  entry.count++;global.count++;attempts.set(key,entry);attempts.set('*',global);
  if(typeof req.body?.password!=='string'||!timingSafeEqual(digest(req.body.password),digest(password)))return res.status(401).json({error:'Incorrect password.'});
  cleanup(sessions);
  if(sessions.size>=500)return res.status(429).json({error:'Access is busy. Try again later.'});
  const token=randomBytes(32).toString('hex');sessions.set(token,{expires:now()+24*3600000});
  res.cookie(cookieName,token,{httpOnly:true,secure:origin.startsWith('https:'),sameSite:'strict',path:'/api/weather-fusion/compare',maxAge:24*3600000});
  res.json({unlocked:true});
 });
 return {authorized,requireAccess,sameOrigin,configured};
}
