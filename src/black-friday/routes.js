/**
 * Express Routes & Real-Time SSE Stream for Black Friday Command Center.
 * Mounted at /black-friday/ and /api/black-friday/*.
 * Shares Sun-Nourie's existing weatherSiteAccess cookie session (no extra login).
 */

import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BLACK_FRIDAY_VERSION } from './constants.js';
import { createBlackFridayStore } from './store.js';
import { createBlackFridayEngine } from './scheduler.js';
import { inspectRetailerUrl } from './adapters.js';
import { matchGiftIdeaDeals } from './intelligence.js';
import {
  createWishlistItemObject,
  buildWishlistItemFromUrl,
  parseBulkTextToDrafts,
  parseUploadedDocument,
  findDuplicateWishlistItem,
  normalizePriority,
  normalizeStatus,
} from './wishlistParser.js';
import { deliverAlertExternally, getChannelStatus } from './notifications.js';

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

  // Redirect bare /black-friday -> /black-friday/
  app.get(/^\/black-friday$/i, (_req, res) => res.redirect(302, '/black-friday/'));

  // Serve UI & static PWA assets
  const uiRouter = express.Router();
  uiRouter.use((req, res, next) => {
    const isHtml = req.path === '/' || req.path.endsWith('.html');
    setPrivateHeaders(res, isHtml);
    next();
  });

  uiRouter.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
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

  // REST + SSE API Router
  const api = express.Router();
  api.use(express.json({ limit: '6mb' }));
  api.use((_req, res, next) => {
    setPrivateHeaders(res, false);
    next();
  });

  // 1. Immediate cached bootstrap payload
  api.get('/bootstrap', (_req, res) => {
    res.json(engine.buildDashboardPayload());
  });

  // 2. Real-time Server-Sent Events stream
  api.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'private, no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    send({ type: 'connected', version: BLACK_FRIDAY_VERSION, at: now().toISOString() });

    const listener = (evt) => send(evt);
    engine.events.on('update', listener);

    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    req.on('close', () => {
      clearInterval(heartbeat);
      engine.events.off('update', listener);
    });
  });

  // 3. Health & Monitoring Telemetry
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
        engine: env.SUPABASE_URL ? 'atomic_json_plus_supabase' : 'atomic_json_wal',
        backupsCount: backups.length,
        latestBackup: backups[0] || null,
        totalDealsStored: Object.keys(store.getState().deals || {}).length,
        totalHistoryProducts: Object.keys(store.getState().priceHistory || {}).length,
      },
    });
  });

  // 4. On-demand background refresh
  api.post('/refresh', async (req, res) => {
    if (!engine.canManualRefresh() && !req.body?.force) {
      return res.status(429).json({
        ok: false,
        error: 'A refresh was just requested. Wait a few seconds before triggering another manual sweep.',
      });
    }
    engine.markManualRefresh();
    const result = await engine.runMonitoringSweep({
      reason: 'manual',
      workerSource: 'manual',
      createBackup: Boolean(req.body?.backup),
    });
    res.json({ ...result, dashboard: engine.buildDashboardPayload() });
  });

  // 5. Filterable Deals Explorer
  api.get('/deals', (req, res) => {
    const dash = engine.buildDashboardPayload();
    let list = req.query.includeArchived === '1' ? [...dash.deals, ...dash.archivedDeals] : [...dash.deals];
    const q = String(req.query.q || '').trim().toLowerCase();
    const tier = String(req.query.tier || '').trim().toLowerCase();
    const retailer = String(req.query.retailer || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim().toLowerCase();
    const localOnly = req.query.localOnly === '1';
    const maxPrice = Number(req.query.maxPrice);
    const minDiscount = Number(req.query.minDiscount);
    const sort = String(req.query.sort || 'score');

    if (q) {
      list = list.filter((d) => `${d.title} ${d.brand || ''} ${d.modelNumber || ''} ${d.retailerName} ${d.description || ''}`.toLowerCase().includes(q));
    }
    if (tier && tier !== 'all') list = list.filter((d) => d.tier === tier);
    if (retailer && retailer !== 'all') list = list.filter((d) => d.retailerId === retailer);
    if (category && category !== 'all') list = list.filter((d) => d.category === category);
    if (localOnly) list = list.filter((d) => d.localPickupKnightdale === 'available' || d.localPickupKnightdale === 'check_store');
    if (Number.isFinite(maxPrice) && maxPrice > 0) list = list.filter((d) => d.currentPrice !== null && d.currentPrice <= maxPrice);
    if (Number.isFinite(minDiscount) && minDiscount > 0) list = list.filter((d) => d.verifiedDiscountPct !== null && d.verifiedDiscountPct >= minDiscount);

    if (sort === 'discount') list.sort((a, b) => (b.verifiedDiscountPct ?? -1) - (a.verifiedDiscountPct ?? -1));
    else if (sort === 'price_asc') list.sort((a, b) => (a.finalAllInTotal ?? 1e9) - (b.finalAllInTotal ?? 1e9));
    else if (sort === 'price_desc') list.sort((a, b) => (b.finalAllInTotal ?? -1) - (a.finalAllInTotal ?? -1));
    else if (sort === 'newest') list.sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
    else list.sort((a, b) => (b.decision?.score ?? 0) - (a.decision?.score ?? 0));

    res.json({ total: list.length, deals: list });
  });

  // 6. Single Deal Detail + Real Price History
  api.get('/deals/:id', (req, res) => {
    const dash = engine.buildDashboardPayload();
    const deal = dash.deals.find((d) => d.id === req.params.id) || dash.archivedDeals.find((d) => d.id === req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    const history = store.getState().priceHistory[deal.canonicalKey] || [];
    const competitors = dash.deals.filter((d) => d.canonicalKey === deal.canonicalKey && d.id !== deal.id);
    res.json({ deal, history, competitors });
  });

  // 7. Wish-List CRUD & All 7 Intake Modes
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
    const result = matchGiftIdeaDeals(prompt, dash.deals);
    res.json(result);
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

      // Duplicate purchase & item prevention
      const dup = findDuplicateWishlistItem(item, state.wishlist);
      if (dup && !body.allowDuplicate) {
        return res.status(409).json({
          error: dup.status === 'purchased'
            ? `Duplicate purchase warning: "${dup.name}" was already marked Purchased${dup.purchasedRetailer ? ` at ${dup.purchasedRetailer}` : ''}!`
            : `Already tracked on your wish list: "${dup.name}" (${dup.status}).`,
          duplicate: dup,
        });
      }

      state.wishlist.unshift(item);
      await store.persist();

      // Run immediate live search across authorized feeds if requested (default true)
      let searchResult = null;
      if (body.searchImmediately !== false) {
        searchResult = await engine.searchForWishlistItem(item.id);
      }

      const dash = engine.buildDashboardPayload();
      const enriched = dash.wishlist.find((w) => w.id === item.id) || item;
      const giftMatches = item.isGiftIdea ? matchGiftIdeaDeals(item.name, dash.deals) : null;

      res.status(201).json({
        item: enriched,
        inspected,
        searchResult,
        giftMatches,
        dashboard: dash,
      });
    } catch (error) {
      res.status(400).json({ error: String(error?.message || 'Could not add wish-list item.') });
    }
  });

  api.post('/wishlist/import', async (req, res) => {
    try {
      const body = req.body || {};
      const defaults = {
        profileId: body.profileId || 'family-main',
        recipient: body.recipient || '',
        priority: body.priority || 'standard',
      };

      let drafts = [];
      if (body.mode === 'bulk') {
        drafts = parseBulkTextToDrafts(body.text || '', defaults);
      } else {
        drafts = await parseUploadedDocument({
          filename: body.filename || 'upload.csv',
          mimeType: body.mimeType || '',
          contentText: body.contentText || '',
          contentBase64: body.contentBase64 || '',
          extractedOcrText: body.extractedOcrText || '',
          defaults,
        });
      }

      const state = store.getState();
      const added = [];
      const skippedDuplicates = [];

      for (const draft of drafts.slice(0, 100)) {
        const dup = findDuplicateWishlistItem(draft, state.wishlist);
        if (dup && !body.allowDuplicates) {
          skippedDuplicates.push({ candidate: draft.name, existing: dup.name, status: dup.status });
          continue;
        }
        state.wishlist.unshift(draft);
        added.push(draft);
      }

      await store.persist();
      res.status(201).json({
        addedCount: added.length,
        skippedDuplicatesCount: skippedDuplicates.length,
        added,
        skippedDuplicates,
        dashboard: engine.buildDashboardPayload(),
      });
    } catch (error) {
      res.status(400).json({ error: String(error?.message || 'Could not import wish-list file.') });
    }
  });

  api.patch('/wishlist/:id', async (req, res) => {
    const state = store.getState();
    const item = state.wishlist.find((w) => w.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Wish-list item not found.' });

    const b = req.body || {};
    const updatable = ['name', 'brand', 'modelNumber', 'upc', 'gtin', 'asin', 'sku', 'color', 'size', 'specs', 'requiredFeatures', 'recipient', 'profileId', 'category', 'sourceUrl', 'notes', 'allowRefurbished', 'allowOpenBox', 'purchasedRetailer'];
    for (const key of updatable) {
      if (Object.hasOwn(b, key)) item[key] = b[key];
    }
    if (Object.hasOwn(b, 'preferredPrice')) item.preferredPrice = b.preferredPrice === '' || b.preferredPrice == null ? null : Number(b.preferredPrice);
    if (Object.hasOwn(b, 'maxPrice')) item.maxPrice = b.maxPrice === '' || b.maxPrice == null ? null : Number(b.maxPrice);
    if (Object.hasOwn(b, 'purchasedPrice')) item.purchasedPrice = b.purchasedPrice === '' || b.purchasedPrice == null ? null : Number(b.purchasedPrice);
    if (Object.hasOwn(b, 'priority')) item.priority = normalizePriority(b.priority);
    if (Object.hasOwn(b, 'status')) {
      const nextStatus = normalizeStatus(b.status);
      item.status = nextStatus;
      if (nextStatus === 'purchased' && !item.purchasedAt) item.purchasedAt = now().toISOString();
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

  // 8. Family Profiles Management
  api.post('/profiles', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Profile name is required.' });
    const state = store.getState();
    const profile = {
      id: `prof_${crypto.randomBytes(4).toString('hex')}`,
      name: name.slice(0, 60),
      type: String(req.body?.type || 'member'),
      icon: String(req.body?.icon || '🎁').slice(0, 4),
      budget: Number(req.body?.budget) > 0 ? Number(req.body.budget) : 300,
      description: String(req.body?.description || '').slice(0, 160),
    };
    state.profiles.push(profile);
    await store.persist();
    res.status(201).json({ profile, profiles: state.profiles });
  });

  api.delete('/profiles/:id', async (req, res) => {
    const state = store.getState();
    if (req.params.id === 'family-main') return res.status(400).json({ error: 'Default Family Wish List cannot be removed.' });
    state.profiles = state.profiles.filter((p) => p.id !== req.params.id);
    for (const w of state.wishlist) {
      if (w.profileId === req.params.id) w.profileId = 'family-main';
    }
    await store.persist();
    res.json({ ok: true, profiles: state.profiles });
  });

  // 9. Smarter Product Alternatives
  api.get('/alternatives/:wishlistItemId', (req, res) => {
    const out = engine.discoverAlternativesForItem(req.params.wishlistItemId);
    if (!out) return res.status(404).json({ error: 'Wish-list item not found.' });
    res.json(out);
  });

  // 10. Deal Hunter & Learning Feedback
  api.get('/hunter', (_req, res) => {
    res.json(engine.buildDashboardPayload().hunter);
  });

  api.post('/hunter/feedback', async (req, res) => {
    const { dealId, action, brand } = req.body || {};
    if (!dealId || !['save', 'reject', 'unsave', 'reset'].includes(action)) {
      return res.status(400).json({ error: 'Valid dealId and action (save|reject|unsave|reset) required.' });
    }
    const state = store.getState();
    const saved = new Set(state.feedback.savedDealIds || []);
    const rejected = new Set(state.feedback.rejectedDealIds || []);
    const rejectedBrands = new Set(state.feedback.rejectedBrands || []);

    if (action === 'save') { saved.add(dealId); rejected.delete(dealId); }
    else if (action === 'unsave') { saved.delete(dealId); }
    else if (action === 'reject') {
      rejected.add(dealId);
      saved.delete(dealId);
      if (req.body.suppressBrand && brand) rejectedBrands.add(String(brand).toLowerCase());
    } else if (action === 'reset') {
      rejected.clear();
      rejectedBrands.clear();
    }

    state.feedback.savedDealIds = [...saved];
    state.feedback.rejectedDealIds = [...rejected];
    state.feedback.rejectedBrands = [...rejectedBrands];
    await store.persist();
    const dash = engine.buildDashboardPayload();
    res.json({ ok: true, hunter: dash.hunter });
  });

  // 11. Interactive Real Price History
  api.get('/history/:canonicalKey', (req, res) => {
    const key = decodeURIComponent(req.params.canonicalKey || '');
    const range = String(req.query.range || 'all');
    const allEntries = store.getState().priceHistory[key] || [];
    const nowMs = now().getTime();
    const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const days = daysMap[range] || null;
    const entries = days
      ? allEntries.filter((e) => nowMs - Date.parse(e.observedAt) <= days * 86400000)
      : allEntries;

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

  // 12. Alerts & Test Notification Delivery
  api.post('/alerts/read', async (req, res) => {
    const state = store.getState();
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids) : null;
    for (const a of state.alerts) {
      if (!ids || ids.has(a.id)) a.read = true;
    }
    await store.persist();
    res.json({ ok: true, unreadCount: state.alerts.filter((a) => !a.read).length });
  });

  api.post('/alerts/test', async (req, res) => {
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

    const external = await deliverAlertExternally(testAlert, {
      env,
      settings: state.settings,
      fetchImpl,
      force: true,
      now: now(),
    });

    state.alerts.unshift(testAlert);
    store.trimAlerts();
    await store.persist();

    engine.events.emit('update', { type: 'alert_created', alert: testAlert });
    res.json({
      ok: true,
      alert: testAlert,
      externalDelivery: external,
      channels: getChannelStatus({ env, settings: state.settings }),
    });
  });

  // 13. Settings Update
  api.patch('/settings', async (req, res) => {
    const state = store.getState();
    const b = req.body || {};
    if (b.theme && ['dark', 'light'].includes(b.theme)) state.settings.theme = b.theme;
    if (b.location && typeof b.location === 'object') {
      state.settings.location = { ...state.settings.location, ...b.location };
    }
    if (b.thresholds && typeof b.thresholds === 'object') {
      state.settings.thresholds = { ...state.settings.thresholds, ...b.thresholds };
    }
    if (b.decisionWeights && typeof b.decisionWeights === 'object') {
      state.settings.decisionWeights = { ...state.settings.decisionWeights, ...b.decisionWeights };
    }
    if (b.alerts && typeof b.alerts === 'object') {
      state.settings.alerts = { ...state.settings.alerts, ...b.alerts };
    }
    if (b.monitoring && typeof b.monitoring === 'object') {
      state.settings.monitoring = { ...state.settings.monitoring, ...b.monitoring };
    }
    if (b.budgets && typeof b.budgets === 'object') {
      state.settings.budgets = { ...state.settings.budgets, ...b.budgets };
    }
    if (b.enabledSources && typeof b.enabledSources === 'object') {
      state.settings.enabledSources = { ...state.settings.enabledSources, ...b.enabledSources };
    }
    await store.persist();
    res.json({ ok: true, settings: state.settings, dashboard: engine.buildDashboardPayload() });
  });

  // 14. Full JSON / CSV Backup Export
  api.get('/export', (req, res) => {
    const format = String(req.query.format || 'json').toLowerCase();
    const state = store.getState();
    if (format === 'csv') {
      const header = ['Name', 'Brand', 'Model', 'Recipient', 'Profile', 'Priority', 'Status', 'Preferred Price', 'Max Price', 'URL', 'Notes'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [header.map(esc).join(',')];
      for (const w of state.wishlist) {
        rows.push([w.name, w.brand, w.modelNumber, w.recipient, w.profileId, w.priority, w.status, w.preferredPrice, w.maxPrice, w.sourceUrl, w.notes].map(esc).join(','));
      }
      res.setHeader('Content-Disposition', 'attachment; filename="family-wishlist-export.csv"');
      return res.type('text/csv').send(rows.join('\n'));
    }
    res.setHeader('Content-Disposition', 'attachment; filename="black-friday-command-center-backup.json"');
    res.json(state);
  });

  app.use('/api/black-friday', api);

  return { store, engine };
}
