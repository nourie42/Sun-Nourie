/**
 * Express Routes & Real-Time SSE Stream for Black Friday Command Center (v2.0).
 * Mounted at /black-friday/ and /api/black-friday/*.
 */

import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BLACK_FRIDAY_VERSION, RETAILER_BY_ID } from './constants.js';
import { createBlackFridayStore } from './store.js';
import { createBlackFridayEngine } from './scheduler.js';
import { inspectRetailerUrl } from './adapters.js';
import { matchGiftIdeaDeals } from './intelligence.js';
import {
  createWishlistItemObject,
  createUserSavedDealObject,
  buildWishlistItemFromUrl,
  buildUploadPreview,
  findDuplicateWishlistItem,
  normalizePriority,
  normalizeStatus,
  parseMoney,
} from './wishlistParser.js';
import { deliverAlertExternally, getChannelStatus } from './notifications.js';
import { priceCheck } from './pricecheck.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'black-friday');

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

function setPrivateHeaders(res, isHtml = false) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (isHtml) res.setHeader('Content-Security-Policy', PAGE_CSP);
}

export function registerBlackFridayRoutes(app, {
  env = process.env,
  dataDir = env.BLACK_FRIDAY_DATA_DIR,
  fetchImpl = globalThis.fetch,
  autoStart = env.NODE_ENV !== 'test' && env.BLACK_FRIDAY_NO_AUTOSTART !== '1',
  now = () => new Date(),
} = {}) {
  const store = createBlackFridayStore({ dataDir, env, fetchImpl });
  const engine = createBlackFridayEngine({ store, env, fetchImpl, now, autoStart });

  if (autoStart) engine.start();

  app.get(/^\/black-friday$/i, (_req, res) => res.redirect(302, '/black-friday/'));

  const uiRouter = express.Router();
  uiRouter.use((req, res, next) => {
    const isHtml = req.path === '/' || req.path.endsWith('.html');
    setPrivateHeaders(res, isHtml);
    next();
  });

  uiRouter.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  uiRouter.get('/manifest.webmanifest', (_req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(PUBLIC_DIR, 'manifest.webmanifest'));
  });
  uiRouter.get('/sw.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Service-Worker-Allowed', '/black-friday/');
    res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
  });

  const STATIC_ALLOWLIST = new Map([
    ['/styles.css', 'text/css'],
    ['/app.js', 'application/javascript'],
    ['/charts.js', 'application/javascript'],
    ['/icon.svg', 'image/svg+xml'],
  ]);
  for (const [assetPath, mime] of STATIC_ALLOWLIST) {
    uiRouter.get(assetPath, (_req, res) => {
      res.type(mime);
      res.sendFile(path.join(PUBLIC_DIR, assetPath.slice(1)));
    });
  }
  app.use('/black-friday', uiRouter);

  const api = express.Router();
  api.use(express.json({ limit: '25mb' }));
  api.use((_req, res, next) => {
    setPrivateHeaders(res, false);
    next();
  });

  // 1. Immediate cached bootstrap
  api.get('/bootstrap', (_req, res) => {
    res.json(engine.buildDashboardPayload());
  });

  // 1b. "Before you buy" price check (Daniel, 2026-11-22): search the site's
  // live deals + a fresh Slickdeals search for the lowest price on anything.
  api.post('/price-check', async (req, res) => {
    const query = String(req.body?.query || '').trim().slice(0, 120);
    const myPriceRaw = Number(req.body?.myPrice);
    const myPrice = Number.isFinite(myPriceRaw) && myPriceRaw > 0 ? myPriceRaw : null;
    if (query.length < 3) return res.status(400).json({ ok: false, error: 'Type at least a few letters of the product name.' });
    try {
      const dash = engine.buildDashboardPayload();
      const out = await priceCheck({ query, myPrice }, { deals: dash.deals || [] });
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok: false, error: `Price check failed: ${e?.message || e}` });
    }
  });

  // 2. Real-time SSE stream
  api.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'private, no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ type: 'connected', version: BLACK_FRIDAY_VERSION, at: now().toISOString() });
    const listener = (evt) => send(evt);
    engine.events.on('update', listener);
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
    req.on('close', () => {
      clearInterval(heartbeat);
      engine.events.off('update', listener);
    });
  });

  // 3. Health & Telemetry
  api.get('/health', async (_req, res) => {
    const dash = engine.buildDashboardPayload();
    const backups = await store.listBackups();
    res.json({
      ok: true,
      version: BLACK_FRIDAY_VERSION,
      scheduler: dash.scheduler,
      monitoringStatus: dash.kpis.monitoringStatus,
      sourceHealth: dash.sourceHealth,
      alertChannels: dash.alertChannels,
      persistence: {
        ...dash.persistence,
        backupsCount: backups.length,
        latestBackup: backups[0] || null,
        totalDealsStored: Object.keys(store.getState().deals || {}).length,
        totalHistoryProducts: Object.keys(store.getState().priceHistory || {}).length,
        uploadedFilesCount: (store.getState().uploadedFiles || []).length,
      },
    });
  });

  // 4. Manual Refresh
  api.post('/refresh', async (req, res) => {
    if (!engine.canManualRefresh() && !req.body?.force) {
      return res.status(429).json({ ok: false, error: 'A refresh just ran. Wait a few seconds before trying again.' });
    }
    engine.markManualRefresh();
    const result = await engine.runMonitoringSweep({
      reason: 'manual',
      workerSource: 'manual',
      createBackup: Boolean(req.body?.backup),
    });
    res.json({ ...result, dashboard: engine.buildDashboardPayload() });
  });

  // 5. Store Directory Favorites & Link Verification (Priority 1)
  api.post('/stores/favorite', async (req, res) => {
    const storeId = String(req.body?.storeId || '').trim();
    if (!RETAILER_BY_ID[storeId]) return res.status(400).json({ error: 'Unknown retailer ID.' });
    const state = store.getState();
    const list = new Set(state.settings.favoriteStores || []);
    // Explicit set wins when the client sends the desired state (idempotent —
    // a bare toggle raced when two calls landed together, 2026-11-22 bot
    // check); a body without isFavorite keeps the old toggle behavior.
    if (typeof req.body?.isFavorite === 'boolean') {
      if (req.body.isFavorite) list.add(storeId);
      else list.delete(storeId);
    } else if (list.has(storeId)) list.delete(storeId);
    else list.add(storeId);
    state.settings.favoriteStores = [...list];
    await store.persist();
    // Light response on purpose: returning the full dashboard made the star
    // tap take 10+ seconds on the phone, so it looked broken (and a second
    // tap toggled it back). The client updates the star + favorites bar
    // locally from favoriteStoreIds.
    res.json({ ok: true, isFavorite: list.has(storeId), favoriteStoreIds: [...list] });
  });

  api.post('/stores/verify-links', async (_req, res) => {
    const statuses = await engine.verifyStores();
    res.json({ ok: true, checkedCount: Object.keys(statuses).length, statuses, dashboard: engine.buildDashboardPayload() });
  });

  // 6. REAL UPLOAD CENTER: Preview, Preserve Original File & Commit (Priority 2)
  api.post('/uploads/preview', async (req, res) => {
    try {
      const b = req.body || {};
      const state = store.getState();
      const uploadType = b.uploadType === 'deal' ? 'deal' : 'wishlist';
      const mode = b.mode || 'file';

      const preview = await buildUploadPreview({
        uploadType,
        mode,
        filename: b.filename || '',
        mimeType: b.mimeType || '',
        contentText: b.contentText || '',
        contentBase64: b.contentBase64 || '',
        extractedOcrText: b.extractedOcrText || '',
        urlsText: b.urlsText || '',
        defaults: {
          profileId: b.profileId || 'family-main',
          recipient: b.recipient || '',
          priority: b.priority || 'standard',
        },
        existingWishlist: state.wishlist || [],
        existingSavedDeals: state.savedDeals || [],
        fetchImpl,
      });

      // Preserve the original uploaded file/text permanently even if parseWarning occurred!
      let savedFile = null;
      if (b.contentBase64 || b.contentText || b.urlsText) {
        savedFile = await store.saveUploadedFile({
          filename: b.filename || `${uploadType}-${mode}-${Date.now()}.txt`,
          mimeType: b.mimeType || 'text/plain',
          contentBase64: b.contentBase64 || '',
          contentText: b.contentText || b.urlsText || '',
          uploadType,
          extractedCount: preview.extractedCount,
          parseWarning: preview.parseWarning,
        });
      }

      res.json({
        ...preview,
        uploadFileId: savedFile?.id || null,
        preservedFile: savedFile,
        uploadedFiles: (store.getState().uploadedFiles || []).slice(0, 40),
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || 'Upload preview failed.') });
    }
  });

  api.post('/uploads/commit', async (req, res) => {
    try {
      const b = req.body || {};
      const uploadType = b.uploadType === 'deal' ? 'deal' : 'wishlist';
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) return res.status(400).json({ error: 'No approved items provided to save.' });

      const state = store.getState();
      const added = [];
      const skippedDuplicates = [];
      const createdWishlistIds = [];

      // Fast O(1) duplicate indexes + automatic recipient profile creation
      const targetList = uploadType === 'deal' ? state.savedDeals : state.wishlist;
      const makeExactDupKey = (obj) => {
        const n = String(obj.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const r = String(obj.recipient || '').toLowerCase().trim();
        const s = String(obj.retailerId || obj.retailerName || '').toLowerCase().trim();
        return n ? `${n}|${r}|${s}` : '';
      };
      const exKeys = new Set();
      const exAsins = new Set();
      const exUpcs = new Set();
      for (const ex of targetList || []) {
        if (ex.status === 'no_longer_interested') continue;
        const k = makeExactDupKey(ex);
        if (k) exKeys.add(k);
        if (ex.asin) exAsins.add(String(ex.asin).toUpperCase());
        if (ex.upc) exUpcs.add(String(ex.upc));
      }

      const profileByLower = new Map((state.profiles || []).map((p) => [p.name.toLowerCase(), p]));
      const ensureRecipientProfile = (recipientName, fallbackProfileId) => {
        const clean = String(recipientName || '').trim();
        if (!clean || clean.toLowerCase() === 'family' || clean.toLowerCase() === 'household') {
          return fallbackProfileId || 'family-main';
        }
        const existing = profileByLower.get(clean.toLowerCase());
        if (existing) return existing.id;
        const profId = `prof_${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || crypto.randomBytes(3).toString('hex')}`;
        const existingById = (state.profiles || []).find((p) => p.id === profId);
        if (existingById) {
          profileByLower.set(clean.toLowerCase(), existingById);
          return existingById.id;
        }
        const newProf = {
          id: profId,
          name: clean.slice(0, 60),
          type: 'member',
          icon: '🎁',
          budget: 300,
          description: 'Created from uploaded family list',
          favoriteBrands: [],
          clothingSizes: '',
          interests: [],
          preferredRetailers: [],
          dislikedProducts: [],
          savedIdeas: [],
        };
        state.profiles.push(newProf);
        profileByLower.set(clean.toLowerCase(), newProf);
        return profId;
      };

      const batchToAdd = [];
      for (const raw of items.slice(0, 1000)) {
        if (raw.selected === false) continue;
        if (!String(raw.name || '').trim() && !String(raw.url || '').trim()) continue;

        const assignedProfileId = ensureRecipientProfile(raw.recipient, raw.profileId || 'family-main');

        if (uploadType === 'deal') {
          const dealObj = createUserSavedDealObject({
            ...raw,
            profileId: assignedProfileId,
            sourceUrl: raw.url || raw.sourceUrl || null,
            price: raw.price ?? raw.preferredPrice,
            originalPrice: raw.originalPrice,
            uploadFileId: b.uploadFileId || raw.uploadFileId || null,
          });
          const dupKey = makeExactDupKey(dealObj);
          const isDup =
            (dupKey && exKeys.has(dupKey)) ||
            (dealObj.asin && exAsins.has(String(dealObj.asin).toUpperCase())) ||
            (dealObj.upc && exUpcs.has(String(dealObj.upc)));
          if (isDup && !b.allowDuplicates) {
            skippedDuplicates.push({ name: dealObj.name });
            continue;
          }
          if (dupKey) exKeys.add(dupKey);
          if (dealObj.asin) exAsins.add(String(dealObj.asin).toUpperCase());
          if (dealObj.upc) exUpcs.add(String(dealObj.upc));
          batchToAdd.push(dealObj);
        } else {
          const wlObj = createWishlistItemObject({
            ...raw,
            profileId: assignedProfileId,
            sourceUrl: raw.url || raw.sourceUrl || null,
            preferredPrice: raw.price ?? raw.preferredPrice,
            maxPrice: raw.maxPrice,
            originalPrice: raw.originalPrice,
            uploadFileId: b.uploadFileId || raw.uploadFileId || null,
          });
          const dupKey = makeExactDupKey(wlObj);
          const isDup =
            (dupKey && exKeys.has(dupKey)) ||
            (wlObj.asin && exAsins.has(String(wlObj.asin).toUpperCase())) ||
            (wlObj.upc && exUpcs.has(String(wlObj.upc)));
          if (isDup && !b.allowDuplicates) {
            skippedDuplicates.push({ name: wlObj.name });
            continue;
          }
          if (dupKey) exKeys.add(dupKey);
          if (wlObj.asin) exAsins.add(String(wlObj.asin).toUpperCase());
          if (wlObj.upc) exUpcs.add(String(wlObj.upc));
          batchToAdd.push(wlObj);
          createdWishlistIds.push(wlObj.id);
        }
      }

      if (uploadType === 'deal') {
        state.savedDeals = [...batchToAdd, ...(state.savedDeals || [])];
      } else {
        state.wishlist = [...batchToAdd, ...(state.wishlist || [])];
      }
      added.push(...batchToAdd);

      await store.persist({ createBackup: added.length >= 5 });

      // Automatically start searching for matching deals for newly uploaded wish-list items (first 3 synchronously so results appear fast, rest queued in background)
      let immediateMatches = 0;
      if (uploadType === 'wishlist' && createdWishlistIds.length && b.searchImmediately !== false) {
        for (const wid of createdWishlistIds.slice(0, 3)) {
          const sOut = await engine.searchForWishlistItem(wid).catch(() => null);
          if (sOut?.matches?.length) immediateMatches += sOut.matches.length;
        }
        if (createdWishlistIds.length > 3) {
          void (async () => {
            for (const wid of createdWishlistIds.slice(3, 8)) {
              await engine.searchForWishlistItem(wid).catch(() => {});
            }
          })();
        }
      }

      res.status(201).json({
        ok: true,
        uploadType,
        addedCount: added.length,
        skippedDuplicatesCount: skippedDuplicates.length,
        immediateMatches,
        added,
        skippedDuplicates,
        dashboard: engine.buildDashboardPayload(),
      });
    } catch (error) {
      res.status(400).json({ error: String(error?.message || 'Could not save uploaded items.') });
    }
  });

  api.get('/uploads/:fileId', async (req, res) => {
    const file = await store.readUploadedFile(req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Uploaded file not found.' });
    res.setHeader('Content-Disposition', `inline; filename="${file.meta.filename.replace(/"/g, '')}"`);
    res.type(file.meta.mimeType || 'application/octet-stream').send(file.data);
  });

  // 7. User-Uploaded Saved Deals CRUD
  api.patch('/saved-deals/:id', async (req, res) => {
    const state = store.getState();
    const sd = (state.savedDeals || []).find((x) => x.id === req.params.id);
    if (!sd) return res.status(404).json({ error: 'Saved deal not found.' });
    const b = req.body || {};
    if (b.name) { sd.name = String(b.name).trim(); sd.title = sd.name; }
    if (Object.hasOwn(b, 'notes')) sd.notes = String(b.notes || '');
    if (Object.hasOwn(b, 'profileId')) sd.profileId = b.profileId;
    if (Object.hasOwn(b, 'url')) sd.url = b.url;
    if (Object.hasOwn(b, 'currentPrice')) {
      const nextP = parseMoney(b.currentPrice);
      if (nextP !== null && nextP !== sd.currentPrice) {
        sd.currentPrice = nextP;
        if (!Array.isArray(sd.priceHistory)) sd.priceHistory = [];
        sd.priceHistory.push({ observedAt: now().toISOString(), price: nextP, source: 'manual_update', note: 'Updated price (original preserved)' });
      }
    }
    sd.updatedAt = now().toISOString();
    await store.persist();
    res.json({ ok: true, savedDeal: sd, dashboard: engine.buildDashboardPayload() });
  });

  api.delete('/saved-deals/:id', async (req, res) => {
    const state = store.getState();
    state.savedDeals = (state.savedDeals || []).filter((x) => x.id !== req.params.id);
    await store.persist();
    res.json({ ok: true, dashboard: engine.buildDashboardPayload() });
  });

  // 8. Deals Explorer, Detail & Actionable Compare Prices / Find Similar / Find Cheaper (Priority 6)
  api.get('/deals', (req, res) => {
    const dash = engine.buildDashboardPayload();
    let list = req.query.includeArchived === '1' ? [...dash.deals, ...dash.archivedDeals] : [...dash.deals];
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) list = list.filter((d) => `${d.title} ${d.brand || ''} ${d.modelNumber || ''} ${d.retailerName}`.toLowerCase().includes(q));
    res.json({ total: list.length, deals: list });
  });

  api.get('/deals/:id', (req, res) => {
    const dash = engine.buildDashboardPayload();
    const deal = dash.deals.find((d) => d.id === req.params.id) || dash.archivedDeals.find((d) => d.id === req.params.id);
    if (!deal) return res.status(404).json({ error: 'That deal is not in the current list anymore — tap Refresh and try again.' });
    const history = store.getState().priceHistory[deal.canonicalKey] || [];
    const competitors = dash.deals.filter((d) => d.canonicalKey === deal.canonicalKey && d.id !== deal.id);
    res.json({ deal, history, competitors });
  });

  api.get('/deals/:id/compare', (req, res) => {
    const out = engine.compareDealOffers(req.params.id);
    if (!out) return res.status(404).json({ error: 'That deal is not in the current list anymore — tap Refresh and try again.' });
    res.json(out);
  });

  // 9. Actionable Recommendation Feedback: LOVE IT / NOT INTERESTED / ALREADY BOUGHT (Priority 3)
  api.post('/feedback', async (req, res) => {
    const { dealId, action, profileId, canonicalKey, title } = req.body || {};
    if (!['love', 'unlove', 'reject', 'bought', 'reset_rejected'].includes(action)) {
      return res.status(400).json({ error: 'Valid action (love|unlove|reject|bought|reset_rejected) required.' });
    }
    const state = store.getState();
    const loved = new Set(state.feedback.lovedDealIds || []);
    const saved = new Set(state.feedback.savedDealIds || []);
    const rejected = new Set(state.feedback.rejectedDealIds || []);
    const rejectedKeys = new Set(state.feedback.rejectedCanonicalKeys || []);
    const bought = new Set(state.feedback.boughtDealIds || []);

    const dealObj = dealId ? state.deals[dealId] : null;
    const key = canonicalKey || dealObj?.canonicalKey || null;

    if (action === 'love' && dealId) {
      loved.add(dealId);
      saved.add(dealId);
      rejected.delete(dealId);
      if (key) rejectedKeys.delete(key);
    } else if (action === 'unlove' && dealId) {
      loved.delete(dealId);
      saved.delete(dealId);
    } else if (action === 'reject' && dealId) {
      // Exact product rejection ONLY — never suppresses the entire category!
      rejected.add(dealId);
      if (key) rejectedKeys.add(key);
      loved.delete(dealId);
      saved.delete(dealId);
      if (profileId) {
        const prof = state.profiles.find((p) => p.id === profileId);
        if (prof && title) {
          prof.dislikedProducts = [...new Set([...(prof.dislikedProducts || []), String(title)])];
        }
      }
    } else if (action === 'bought' && dealId) {
      bought.add(dealId);
      // Also mark matching wish-list item as purchased if present
      for (const w of state.wishlist) {
        if (w.canonicalKey === key || (dealObj && w.name.toLowerCase() === dealObj.title.toLowerCase())) {
          w.status = 'purchased';
          w.purchasedRetailer = dealObj?.retailerName || w.purchasedRetailer;
          w.purchasedPrice = dealObj?.currentPrice ?? w.purchasedPrice;
          w.purchasedAt = now().toISOString();
          w.updatedAt = now().toISOString();
        }
      }
    } else if (action === 'reset_rejected') {
      rejected.clear();
      rejectedKeys.clear();
    }

    state.feedback.lovedDealIds = [...loved];
    state.feedback.savedDealIds = [...saved];
    state.feedback.rejectedDealIds = [...rejected];
    state.feedback.rejectedCanonicalKeys = [...rejectedKeys];
    state.feedback.boughtDealIds = [...bought];
    await store.persist();
    // Light response on purpose: returning the full dashboard made every
    // feedback tap take ~13s on Daniel's phone, so taps looked broken and
    // a second tap could undo the first. The client updates the card in
    // place from these fields.
    res.json({ ok: true, action, dealId: dealId || null });
  });

  // Back-compat alias for Deal Hunter feedback
  api.post('/hunter/feedback', async (req, res) => {
    const { dealId, action } = req.body || {};
    const mapped = action === 'save' ? 'love' : action === 'unsave' ? 'unlove' : action === 'reset' ? 'reset_rejected' : 'reject';
    req.body = { dealId, action: mapped };
    const state = store.getState();
    const loved = new Set(state.feedback.lovedDealIds || []);
    const rejected = new Set(state.feedback.rejectedDealIds || []);
    const rejectedKeys = new Set(state.feedback.rejectedCanonicalKeys || []);
    const key = dealId && state.deals[dealId]?.canonicalKey;
    if (mapped === 'love' && dealId) { loved.add(dealId); rejected.delete(dealId); }
    else if (mapped === 'unlove' && dealId) loved.delete(dealId);
    else if (mapped === 'reject' && dealId) { rejected.add(dealId); if (key) rejectedKeys.add(key); loved.delete(dealId); }
    else if (mapped === 'reset_rejected') { rejected.clear(); rejectedKeys.clear(); }
    state.feedback.lovedDealIds = [...loved];
    state.feedback.savedDealIds = [...loved];
    state.feedback.rejectedDealIds = [...rejected];
    state.feedback.rejectedCanonicalKeys = [...rejectedKeys];
    await store.persist();
    const dash = engine.buildDashboardPayload();
    res.json({ ok: true, hunter: dash.hunter, dashboard: dash });
  });

  // 10. Wish-List CRUD + Move Between Family Profiles (Priority 4)
  api.get('/wishlist', (_req, res) => {
    const dash = engine.buildDashboardPayload();
    res.json({ wishlist: dash.wishlist, profiles: dash.profiles });
  });

  api.post('/wishlist/inspect-url', async (req, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) return res.status(400).json({ error: 'Product URL is required.' });
    const result = await inspectRetailerUrl(rawUrl, { fetchImpl, now });
    res.status(result.ok ? 200 : 400).json(result);
  });

  api.post('/wishlist/gift-idea', (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Gift idea description is required.' });
    const dash = engine.buildDashboardPayload();
    res.json(matchGiftIdeaDeals(prompt, dash.deals));
  });

  api.post('/wishlist', async (req, res) => {
    try {
      const body = req.body || {};
      const state = store.getState();
      let item;
      let inspected = null;

      if (body.sourceType === 'url' && body.sourceUrl) {
        const built = await buildWishlistItemFromUrl(body.sourceUrl, body, { fetchImpl });
        item = built.item;
        inspected = built.inspected;
      } else {
        if (!String(body.name || '').trim() && !String(body.sourceUrl || '').trim()) {
          return res.status(400).json({ error: 'Provide a product name, gift idea, or retailer URL.' });
        }
        item = createWishlistItemObject(body);
      }

      const dup = findDuplicateWishlistItem(item, state.wishlist);
      if (dup && !body.allowDuplicate) {
        return res.status(409).json({
          error: dup.status === 'purchased'
            ? `Duplicate purchase warning: "${dup.name}" was already marked Purchased!`
            : `Already tracked on your wish list: "${dup.name}" (${dup.status}).`,
          duplicate: dup,
        });
      }

      state.wishlist.unshift(item);
      await store.persist();

      let searchResult = null;
      if (body.searchImmediately !== false) {
        searchResult = await engine.searchForWishlistItem(item.id);
      }

      const dash = engine.buildDashboardPayload();
      const enriched = dash.wishlist.find((w) => w.id === item.id) || item;
      const giftMatches = item.isGiftIdea ? matchGiftIdeaDeals(item.name, dash.deals) : null;
      res.status(201).json({ item: enriched, inspected, searchResult, giftMatches, dashboard: dash });
    } catch (error) {
      res.status(400).json({ error: String(error?.message || 'Could not add wish-list item.') });
    }
  });

  api.post('/wishlist/:id/move', async (req, res) => {
    const state = store.getState();
    const item = state.wishlist.find((w) => w.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Wish-list item not found.' });
    const targetProfile = state.profiles.find((p) => p.id === req.body?.profileId);
    if (!targetProfile) return res.status(400).json({ error: 'Target family profile not found.' });
    item.profileId = targetProfile.id;
    item.recipient = req.body?.recipient ?? targetProfile.name;
    item.updatedAt = now().toISOString();
    await store.persist();
    res.json({ ok: true, item, dashboard: engine.buildDashboardPayload() });
  });

  api.patch('/wishlist/:id', async (req, res) => {
    const state = store.getState();
    const item = state.wishlist.find((w) => w.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Wish-list item not found.' });
    const b = req.body || {};
    const updatable = ['name', 'brand', 'modelNumber', 'upc', 'gtin', 'asin', 'sku', 'color', 'size', 'specs', 'requiredFeatures', 'recipient', 'profileId', 'category', 'sourceUrl', 'notes', 'allowRefurbished', 'allowOpenBox', 'purchasedRetailer'];
    for (const key of updatable) if (Object.hasOwn(b, key)) item[key] = b[key];
    if (Object.hasOwn(b, 'preferredPrice')) item.preferredPrice = parseMoney(b.preferredPrice);
    if (Object.hasOwn(b, 'maxPrice')) item.maxPrice = parseMoney(b.maxPrice);
    if (Object.hasOwn(b, 'purchasedPrice')) item.purchasedPrice = parseMoney(b.purchasedPrice);
    if (Object.hasOwn(b, 'priority')) item.priority = normalizePriority(b.priority);
    if (Object.hasOwn(b, 'status')) {
      item.status = normalizeStatus(b.status);
      if (item.status === 'purchased' && !item.purchasedAt) item.purchasedAt = now().toISOString();
    }
    item.updatedAt = now().toISOString();
    await store.persist();
    res.json({ item, dashboard: engine.buildDashboardPayload() });
  });

  api.delete('/wishlist/:id', async (req, res) => {
    const state = store.getState();
    const before = state.wishlist.length;
    state.wishlist = state.wishlist.filter((w) => w.id !== req.params.id);
    if (state.wishlist.length === before) return res.status(404).json({ error: 'Wish-list item not found.' });
    await store.persist();
    res.json({ ok: true, dashboard: engine.buildDashboardPayload() });
  });

  api.post('/wishlist/:id/search', async (req, res) => {
    const out = await engine.searchForWishlistItem(req.params.id);
    if (!out) return res.status(404).json({ error: 'Wish-list item not found.' });
    res.json({ ...out, dashboard: engine.buildDashboardPayload() });
  });

  // 11. Editable Family Shopping Profiles (Priority 4)
  api.post('/profiles', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Profile name is required.' });
    const state = store.getState();
    const toList = (v) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
    const profile = store.normalizeProfile({
      id: `prof_${crypto.randomBytes(4).toString('hex')}`,
      name,
      type: req.body?.type || 'member',
      icon: req.body?.icon || '👤',
      budget: Number(req.body?.budget) > 0 ? Number(req.body.budget) : 300,
      description: req.body?.description || '',
      favoriteBrands: toList(req.body?.favoriteBrands),
      clothingSizes: String(req.body?.clothingSizes || ''),
      interests: toList(req.body?.interests),
      preferredRetailers: toList(req.body?.preferredRetailers),
      dislikedProducts: toList(req.body?.dislikedProducts),
      savedIdeas: toList(req.body?.savedIdeas),
    });
    state.profiles.push(profile);
    await store.persist();
    res.status(201).json({ profile, dashboard: engine.buildDashboardPayload() });
  });

  api.patch('/profiles/:id', async (req, res) => {
    const state = store.getState();
    const prof = state.profiles.find((p) => p.id === req.params.id);
    if (!prof) return res.status(404).json({ error: 'Profile not found.' });
    const b = req.body || {};
    const toList = (v) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

    if (b.name) prof.name = String(b.name).trim().slice(0, 60);
    if (b.icon) prof.icon = String(b.icon).slice(0, 4);
    if (b.budget != null && Number(b.budget) > 0) prof.budget = Number(b.budget);
    if (Object.hasOwn(b, 'description')) prof.description = String(b.description || '').slice(0, 200);
    if (Object.hasOwn(b, 'clothingSizes')) prof.clothingSizes = String(b.clothingSizes || '').slice(0, 160);
    if (Object.hasOwn(b, 'favoriteBrands')) prof.favoriteBrands = toList(b.favoriteBrands);
    if (Object.hasOwn(b, 'interests')) prof.interests = toList(b.interests);
    if (Object.hasOwn(b, 'preferredRetailers')) prof.preferredRetailers = toList(b.preferredRetailers);
    if (Object.hasOwn(b, 'dislikedProducts')) prof.dislikedProducts = toList(b.dislikedProducts);
    if (Object.hasOwn(b, 'savedIdeas')) prof.savedIdeas = toList(b.savedIdeas);

    await store.persist();
    res.json({ ok: true, profile: prof, dashboard: engine.buildDashboardPayload() });
  });

  api.delete('/profiles/:id', async (req, res) => {
    const state = store.getState();
    if (req.params.id === 'family-main') return res.status(400).json({ error: 'Default Family Shared List cannot be deleted.' });
    state.profiles = state.profiles.filter((p) => p.id !== req.params.id);
    for (const w of state.wishlist) if (w.profileId === req.params.id) w.profileId = 'family-main';
    await store.persist();
    res.json({ ok: true, dashboard: engine.buildDashboardPayload() });
  });

  // 12. Alternatives, Price History, Alerts, Settings, Export
  api.get('/alternatives/:wishlistItemId', (req, res) => {
    const out = engine.discoverAlternativesForItem(req.params.wishlistItemId);
    if (!out) return res.status(404).json({ error: 'Wish-list item not found.' });
    res.json(out);
  });

  api.get('/history/:canonicalKey', (req, res) => {
    const key = decodeURIComponent(req.params.canonicalKey || '');
    const range = String(req.query.range || 'all');
    const allEntries = store.getState().priceHistory[key] || [];
    const nowMs = now().getTime();
    const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const days = daysMap[range] || null;
    const entries = days ? allEntries.filter((e) => nowMs - Date.parse(e.observedAt) <= days * 86400000) : allEntries;
    const prices = entries.map((e) => e.price).filter((p) => typeof p === 'number' && Number.isFinite(p));
    res.json({
      canonicalKey: key,
      range,
      observationsCount: entries.length,
      lowestObserved: prices.length ? Math.min(...prices) : null,
      highestObserved: prices.length ? Math.max(...prices) : null,
      currentLatest: entries.length ? entries[entries.length - 1].price : null,
      entries,
      honestyNote: entries.length < 2
        ? 'Recording real observations going forward. Historical prices are never fabricated.'
        : `Showing ${entries.length} genuine timestamped price observations.`,
    });
  });

  api.post('/alerts/read', async (req, res) => {
    const state = store.getState();
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids) : null;
    for (const a of state.alerts) if (!ids || ids.has(a.id)) a.read = true;
    await store.persist();
    res.json({ ok: true, unreadCount: state.alerts.filter((a) => !a.read).length });
  });

  api.post('/alerts/test', async (_req, res) => {
    const state = store.getState();
    const testAlert = {
      id: `al_test_${crypto.randomBytes(4).toString('hex')}`,
      dedupKey: `test:${Date.now()}`,
      type: 'test_verification',
      severity: 'medium',
      title: 'Test Alert Verified — Black Friday Command Center',
      message: `Notification pipeline verified at ${now().toISOString()} for Knightdale, NC 27545.`,
      wishlistItemId: null,
      dealId: null,
      retailerUrl: '/black-friday/',
      triggeredAt: now().toISOString(),
      read: false,
      channelsAttempted: ['in_dashboard'],
      channelsDelivered: ['in_dashboard'],
    };
    const external = await deliverAlertExternally(testAlert, { env, settings: state.settings, fetchImpl, force: true, now: now() });
    state.alerts.unshift(testAlert);
    store.trimAlerts();
    await store.persist();
    engine.events.emit('update', { type: 'alert_created', alert: testAlert });
    res.json({ ok: true, alert: testAlert, externalDelivery: external, channels: getChannelStatus({ env, settings: state.settings }) });
  });

  api.patch('/settings', async (req, res) => {
    const state = store.getState();
    const b = req.body || {};
    if (b.theme && ['dark', 'light'].includes(b.theme)) state.settings.theme = b.theme;
    if (Array.isArray(b.favoriteStores)) state.settings.favoriteStores = b.favoriteStores;
    if (b.location && typeof b.location === 'object') state.settings.location = { ...state.settings.location, ...b.location };
    if (b.thresholds && typeof b.thresholds === 'object') state.settings.thresholds = { ...state.settings.thresholds, ...b.thresholds };
    if (b.decisionWeights && typeof b.decisionWeights === 'object') state.settings.decisionWeights = { ...state.settings.decisionWeights, ...b.decisionWeights };
    if (b.alerts && typeof b.alerts === 'object') state.settings.alerts = { ...state.settings.alerts, ...b.alerts };
    if (b.monitoring && typeof b.monitoring === 'object') state.settings.monitoring = { ...state.settings.monitoring, ...b.monitoring };
    if (b.budgets && typeof b.budgets === 'object') state.settings.budgets = { ...state.settings.budgets, ...b.budgets };
    if (b.enabledSources && typeof b.enabledSources === 'object') state.settings.enabledSources = { ...state.settings.enabledSources, ...b.enabledSources };
    await store.persist();
    res.json({ ok: true, settings: state.settings, dashboard: engine.buildDashboardPayload() });
  });

  api.get('/export', (req, res) => {
    const format = String(req.query.format || 'json').toLowerCase();
    const state = store.getState();
    if (format === 'csv') {
      const header = ['Name', 'Brand', 'Model', 'Size', 'Color', 'Recipient', 'Profile', 'Priority', 'Status', 'Target Price', 'Max Price', 'URL', 'Notes'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [header.map(esc).join(',')];
      for (const w of state.wishlist) {
        rows.push([w.name, w.brand, w.modelNumber, w.size, w.color, w.recipient, w.profileId, w.priority, w.status, w.preferredPrice, w.maxPrice, w.sourceUrl, w.notes].map(esc).join(','));
      }
      res.setHeader('Content-Disposition', 'attachment; filename="family-wishlist-export.csv"');
      return res.type('text/csv').send(rows.join('\n'));
    }
    res.setHeader('Content-Disposition', 'attachment; filename="black-friday-hq-backup.json"');
    res.json(state);
  });

  app.use('/api/black-friday', api);
  return { store, engine };
}
