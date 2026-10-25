import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readModelFile } from './dealLensModelAssets.js';

const root = fileURLToPath(new URL('../public/deal-lens/', import.meta.url));
const privateAssets = new Map([['original-model-data.js','application/javascript'],['original-model.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]);

// Registered after the existing weather sign-in middleware in server.js.
// Reading documents, importing pasted results and exporting workbooks happen
// in the browser. There is no provider credential or model request here.
export function registerDealLensRoutes(app, {modelDirectory}={}) {
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
    try {res.type(contentType).send(readModelFile(name,modelDirectory));}
    catch {res.status(503).send('The original model is not configured on this server.');}
  });
  router.use(express.static(root, { dotfiles: 'deny', etag: false, maxAge: 0, index: 'index.html', fallthrough: false }));
  router.use((error, _req, res, _next) => {
    res.status(error.status === 403 ? 403 : 404).send('Deal Lens file not found.');
  });
  app.use('/deal-lens', router);
}
