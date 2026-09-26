import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash,createPrivateKey,createPublicKey,privateDecrypt,publicEncrypt,randomBytes,scryptSync,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {validateState,mutate,mergeImport} from '../private-pl/model.js';
const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','private-pl');
const BASE='/household-pl';
const FEED='https://raw.githubusercontent.com/nourie42/Sun-Nourie/household-data/private-pl/weekly.enc.json';
const AAD=Buffer.from('private-household-pl:v1');
const enc=(b)=>b.toString('base64');
const dec=(s)=>{if(typeof s!=='string'||s.length>6000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Invalid encrypted data.');return Buffer.from(s,'base64');};
function cipher(data,key){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(AAD);return {v:1,iv:enc(iv),tag:null,data:enc(Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(data)))),c.final()])) ,getTag:()=>enc(c.getAuthTag())};}
function pack(data,key){const e=cipher(data,key);e.tag=e.getTag();delete e.getTag;return e;}
function unpack(e,key){if(e?.v!==1)throw Error('Unknown encryption format.');const iv=dec(e.iv),tag=dec(e.tag);if(iv.length!==12||tag.length!==16)throw Error('Invalid encryption metadata.');const d=createDecipheriv('aes-256-gcm',key,iv);d.setAAD(AAD);d.setAuthTag(tag);return JSON.parse(gunzipSync(Buffer.concat([d.update(dec(e.data)),d.final()]),{maxOutputLength:16000000}).toString('utf8'));}
export function sealImport(payload,publicKey){const key=randomBytes(32);return {...pack(payload,key),alg:'RSA-OAEP-256+A256GCM+gzip',key:enc(publicEncrypt({key:publicKey,oaepHash:'sha256'},key))};}
export function openImport(envelope,privateKey){if(envelope?.alg!=='RSA-OAEP-256+A256GCM+gzip')throw Error('Invalid encrypted import.');return unpack(envelope,privateDecrypt({key:privateKey,oaepHash:'sha256'},dec(envelope.key)));}
export class EncryptedStore{
 constructor(dir,key,seed){this.dir=dir;this.key=key;this.seed=seed;this.chain=Promise.resolve();this.state=null;}
 async init(){
  await fs.mkdir(this.dir,{recursive:true,mode:0o700});
  try{this.state=validateState(unpack(JSON.parse(await fs.readFile(path.join(this.dir,'state.enc.json'),'utf8')),this.key));}
  catch(e){if(e.code!=='ENOENT')throw Error('Private store could not be read; the saved data was not overwritten.');if(!this.seed)throw Error('Private statement has not been initialized.');this.state=validateState(this.seed);await this.write({...this.state,revision:1});}
  return this;
 }
 async write(next){
  const target=path.join(this.dir,'state.enc.json'),temp=path.join(this.dir,'state.'+randomBytes(8).toString('hex')+'.tmp');
  const handle=await fs.open(temp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(pack(next,this.key)));await handle.sync();}finally{await handle.close();}
  try{await fs.copyFile(target,target+'.previous');await fs.chmod(target+'.previous',0o600);}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.rename(temp,target);const dirHandle=await fs.open(this.dir,'r');try{await dirHandle.sync();}finally{await dirHandle.close();}
  this.state=next;
 }
 async change(revision,fn){
  const work=this.chain.then(async()=>{if(revision!==null&&revision!==this.state.revision){const e=Error('This sheet changed in another window. Refresh before saving.');e.status=409;throw e;}const next=fn(this.state);if(next===this.state)return this.state;next.revision=this.state.revision+1;await this.write(validateState(next));return this.state;});
  this.chain=work.catch(()=>{});return work;
 }
}
async function persistentMount(dir){
 try{const mounts=(await fs.readFile('/proc/mounts','utf8')).split('\n').map(l=>l.split(' ')[1]).filter(Boolean);return mounts.some(m=>m!=='/'&&m!=='/tmp'&&m!=='/etc'&&dir.startsWith(m.replace(/\/$/,'')+'/'));}catch{return false;}
}
function send(res,status,data,type='application/json; charset=utf-8') {res.statusCode=status;res.setHeader('Content-Type',type);res.end(type.startsWith('application/json')?JSON.stringify(data):data);}
async function body(req,max=3000000){
 if(!String(req.headers['content-type']||'').startsWith('application/json')){const e=Error('Use JSON for changes.');e.status=415;throw e;}
 const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>max){const e=Error('Import is too large.');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=Error('Invalid JSON.');e.status=400;throw e;}
}
export function createHouseholdHandler({env=process.env,root=ROOT,fetchImpl=globalThis.fetch,local=false}={}){
 const production=!local, sessions=new Map();let store=null,configError='',privateKey=null,key=null,hash=null,salt=null,ready=null;
 let failed=0,windowStart=Date.now(),lastPoll=0,syncMessage='';
 const initialize=async()=>{
  try{
   if(typeof env.HOUSEHOLD_PASSWORD!=='string'||env.HOUSEHOLD_PASSWORD.length<16||!env.HOUSEHOLD_PRIVATE_KEY_B64)throw Error('Private access is not configured.');
   privateKey=createPrivateKey(Buffer.from(env.HOUSEHOLD_PRIVATE_KEY_B64,'base64'));
   if(privateKey.asymmetricKeyType!=='rsa'||privateKey.asymmetricKeyDetails.modulusLength<3072)throw Error('Private access is not configured.');
   key=createHash('sha256').update('private-household-state-v1\0').update(privateKey.export({type:'pkcs8',format:'der'})).digest();
   salt=randomBytes(16);hash=scryptSync(env.HOUSEHOLD_PASSWORD,salt,32,{N:32768,maxmem:64*1024*1024});
   if(!env.HOUSEHOLD_DATA_DIR||!path.isAbsolute(env.HOUSEHOLD_DATA_DIR))throw Error('Persistent private storage is not configured.');
   const dir=path.resolve(env.HOUSEHOLD_DATA_DIR);
   if(production&&!await persistentMount(dir))throw Error('A mounted persistent disk is required before this sheet can save data.');
   let seed=null;try{const p=openImport(JSON.parse(await fs.readFile(path.join(root,'seed.enc.json'),'utf8')),privateKey);if(p.kind!=='seed'||p.version!==1)throw Error();seed=p.state;}catch(e){if(e.code!=='ENOENT')throw Error('The private starter data could not be decrypted.');}
   store=await new EncryptedStore(dir,key,seed).init();
  }catch(e){configError=e.message;}
 };
 ready=initialize();
 function auth(req){
  const token=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('household_session='))?.slice(18);
  const session=token&&sessions.get(token);if(!session||session.expires<Date.now()){if(token)sessions.delete(token);return null;}return {token,...session};
 }
 const originOK=req=>{try{const o=new URL(req.headers.origin);return o.host===req.headers.host&&(o.protocol==='https:'||local&&o.protocol==='http:');}catch{return false;}};
 async function syncFeed(force=false){
  if(!store||!privateKey||!fetchImpl||!force&&Date.now()-lastPoll<600000)return;
  lastPoll=Date.now();
  try{
   const response=await fetchImpl(FEED,{signal:AbortSignal.timeout(9000),redirect:'error',headers:{'Cache-Control':'no-cache'}});
   if(response.status===404){syncMessage='No newer weekly import is available.';return;}
   if(!response.ok)throw Error();
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>3000000)throw Error();chunks.push(chunk);}
   const payload=openImport(JSON.parse(Buffer.concat(chunks).toString('utf8')),privateKey);
   await store.change(null,s=>mergeImport(s,payload));syncMessage='Latest encrypted import checked.';
  }catch{syncMessage='Weekly import could not be refreshed. Your last saved data and edits are intact.';}
 }
 const handler=async(req,res,next=()=>{res.statusCode=404;res.end();})=>{
  const rawUrl=req.originalUrl||req.url||'/';let url;try{url=new URL(rawUrl,'http://local');}catch{return next();}
  if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return next();
  res.setHeader('Cache-Control','no-store, private, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  const p=url.pathname.slice(BASE.length)||'/';
  try{
   // Only generic application assets are public. No embedded user records or credentials.
   const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/app.css':['app.css','text/css; charset=utf-8'],'/model.js':['model.js','text/javascript; charset=utf-8']};
   if(req.method==='GET'&&assets[p]){const [file,type]=assets[p];return send(res,200,await fs.readFile(path.join(root,file),'utf8'),type);}
   await ready;
   if(p==='/api/status'&&req.method==='GET')return send(res,200,{authenticated:!!auth(req),ready:!!store,message:store?'':configError||'Private storage is not available.'});
   if(!store)return send(res,503,{error:configError||'Private storage is not available.'});
   if(p==='/api/login'&&req.method==='POST'){
    if(!originOK(req))return send(res,403,{error:'Open the private page to sign in.'});
    if(Date.now()-windowStart>15*60000){failed=0;windowStart=Date.now();}
    if(failed>=10){res.setHeader('Retry-After','900');return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});}
    const b=await body(req,4096);failed++;
    if(typeof b.password!=='string'||b.password.length>256||!timingSafeEqual(scryptSync(b.password,salt,32,{N:32768,maxmem:64*1024*1024}),hash))return send(res,401,{error:'Password not accepted.'});
    failed=0;for(const [t,s]of sessions)if(s.expires<Date.now())sessions.delete(t);if(sessions.size>=32)sessions.delete(sessions.keys().next().value);
    const token=randomBytes(32).toString('hex');sessions.set(token,{csrf:randomBytes(32).toString('hex'),expires:Date.now()+8*3600000});
    res.setHeader('Set-Cookie',`household_session=${token}; Path=${BASE}; HttpOnly; SameSite=Strict; Max-Age=28800${production?'; Secure':''}`);return send(res,200,{ok:true});
   }
   const session=auth(req);if(!session)return send(res,401,{error:'Sign in to view this private sheet.'});
   if(req.method!=='GET'&&(!originOK(req)||typeof req.headers['x-csrf-token']!=='string'||req.headers['x-csrf-token']!==session.csrf))return send(res,403,{error:'Refresh the sheet before making changes.'});
   if(p==='/api/logout'&&req.method==='POST'){sessions.delete(session.token);res.setHeader('Set-Cookie',`household_session=; Path=${BASE}; HttpOnly; SameSite=Strict; Max-Age=0${production?'; Secure':''}`);return send(res,200,{ok:true});}
   if(p==='/api/state'&&req.method==='GET'){await syncFeed();return send(res,200,{state:store.state,csrf:session.csrf,syncMessage});}
   if(p==='/api/change'&&req.method==='POST'){const b=await body(req,100000);if(!Number.isSafeInteger(b.revision))return send(res,400,{error:'Missing sheet revision.'});const state=await store.change(b.revision,s=>mutate(s,b.change||{}));return send(res,200,{state,csrf:session.csrf,syncMessage});}
   if(p==='/api/refresh'&&req.method==='POST'){await syncFeed(true);return send(res,200,{state:store.state,csrf:session.csrf,syncMessage});}
   if(p==='/api/import'&&req.method==='POST'){const b=await body(req);const payload=b.payload?.alg?openImport(b.payload,privateKey):b.payload;const state=await store.change(b.revision,s=>mergeImport(s,payload));return send(res,200,{state,csrf:session.csrf,syncMessage:'Import saved.'});}
   if(p==='/api/backup'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="private-household-backup.json"');return send(res,200,{version:1,kind:'backup',state:store.state});}
   return send(res,404,{error:'Not found.'});
  }catch(e){const status=e.status||400;return send(res,status,{error:status>=500?'The change could not be saved. Your prior data remains intact.':String(e.message||'Request could not be completed.').slice(0,200)});}
 };
 return {handler,ready,getStore:()=>store,getPublicKey:()=>privateKey?createPublicKey(privateKey).export({type:'spki',format:'pem'}):null};
}
export function registerHouseholdPLRoutes(app,options={}) {const instance=createHouseholdHandler(options);app.use(instance.handler);return instance;}
