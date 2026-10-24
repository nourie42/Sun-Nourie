import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/deal-lens/', import.meta.url));
const privateRoot = fileURLToPath(new URL('../data/deal-lens/', import.meta.url));
const privateAssets = new Map([['original-model-data.js','application/javascript'],['original-model.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]);

export function readProtectedModelFile(name, modelKey, directory=privateRoot) {
  if (!privateAssets.has(name)) throw Error('Unknown model asset.');
  const key=Buffer.from(modelKey||'', 'base64');
  if(key.length!==32)throw Error('Original model key is not configured.');
  const payload=readFileSync(path.join(directory,name+'.enc'));
  if(payload.subarray(0,5).toString()!=='DLME1')throw Error('Invalid model asset.');
  const decipher=createDecipheriv('aes-256-gcm',key,payload.subarray(5,17));
  decipher.setAAD(Buffer.from(name));decipher.setAuthTag(payload.subarray(17,33));
  return Buffer.concat([decipher.update(payload.subarray(33)),decipher.final()]);
}

// Registered after the existing weather sign-in middleware in server.js.
// Reading documents, importing pasted results and exporting workbooks happen
// in the browser. There is no provider credential or model request here.
export function registerDealLensRoutes(app, {modelKey=process.env.DEAL_LENS_MODEL_KEY, modelDirectory=privateRoot}={}) {
  app.get(/^\/deal-lens$/i, (_req, res) => res.redirect(302, '/deal-lens/'));
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.get('/api/status', (_req, res) => res.json({ mode: 'copy-paste', paidEnabled: false, version: 'copy-paste-local-v1' }));
  router.all('/api/analyze', (_req, res) => res.status(410).json({ code: 'DIRECT_API_DISABLED', error: 'Use the copy prompt and paste results workflow. Paid extraction is disabled.' }));
  for(const [name,contentType] of privateAssets)router.get('/'+name, (_req,res)=>{
    try {res.type(contentType).send(readProtectedModelFile(name,modelKey,modelDirectory));}
    catch {res.status(503).send('The original model is not configured on this server.');}
  });
  router.use(express.static(root, { dotfiles: 'deny', etag: false, maxAge: 0, index: 'index.html', fallthrough: false }));
  router.use((error, _req, res, _next) => {
    res.status(error.status === 403 ? 403 : 404).send('Deal Lens file not found.');
  });
  app.use('/deal-lens', router);
}
