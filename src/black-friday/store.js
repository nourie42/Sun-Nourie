/**
 * Persistent Database Store with Atomic Writes, Uploaded File Preservation,
 * Rolling Backups, Real Price History Ledger, Render Persistent Disk auto-detection,
 * and Bidirectional Supabase / GitHub Worker Sync.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BLACK_FRIDAY_VERSION,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_PROFILES,
} from './constants.js';
import { createWishlistItemObject } from './wishlistParser.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data', 'black-friday');
const GITHUB_SNAPSHOT_URL = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/black-friday-data/snapshot.json';
const MAX_BACKUPS = 10;
const MAX_ALERTS = 250;
const MAX_DEALS = 1200;
const MAX_HISTORY_PER_PRODUCT = 365;
const MAX_SCHEDULER_HISTORY = 40;
const MAX_UPLOADED_FILES = 120;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function resolveDefaultDataDir(env = process.env) {
  if (env.BLACK_FRIDAY_DATA_DIR) return env.BLACK_FRIDAY_DATA_DIR;
  // Auto-detect Render Persistent Disk standard mount (/var/data) when available
  if (process.platform !== 'win32') {
    try {
      if (fsSync.existsSync('/var/data')) {
        fsSync.accessSync('/var/data', fsSync.constants.W_OK);
        return '/var/data/black-friday';
      }
    } catch {}
  }
  return DEFAULT_DATA_DIR;
}

function normalizeProfile(p = {}) {
  return {
    id: p.id || `prof_${crypto.randomBytes(4).toString('hex')}`,
    name: String(p.name || 'Family Member').slice(0, 60),
    type: String(p.type || 'member'),
    icon: String(p.icon || '🎁').slice(0, 4),
    budget: Number(p.budget) > 0 ? Number(p.budget) : 300,
    description: String(p.description || '').slice(0, 200),
    favoriteBrands: Array.isArray(p.favoriteBrands) ? p.favoriteBrands : [],
    clothingSizes: String(p.clothingSizes || '').slice(0, 160),
    interests: Array.isArray(p.interests) ? p.interests : [],
    preferredRetailers: Array.isArray(p.preferredRetailers) ? p.preferredRetailers : [],
    dislikedProducts: Array.isArray(p.dislikedProducts) ? p.dislikedProducts : [],
    savedIdeas: Array.isArray(p.savedIdeas) ? p.savedIdeas : [],
  };
}

export function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: BLACK_FRIDAY_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    profiles: deepClone(DEFAULT_PROFILES).map(normalizeProfile),
    wishlist: [],
    savedDeals: [],
    uploadedFiles: [],
    deals: {},
    priceHistory: {},
    sourceHealth: {},
    retailerLinkStatus: {},
    cashbackRates: {},
    alerts: [],
    feedback: {
      savedDealIds: [],
      lovedDealIds: [],
      rejectedDealIds: [],
      rejectedCanonicalKeys: [],
      boughtDealIds: [],
    },
    scheduler: {
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      nextScheduledRunAt: null,
      runsCount: 0,
      lastWorkerSource: null,
      running: false,
      history: [],
    },
    settings: deepClone(DEFAULT_SETTINGS),
  };
}

function mergeSettings(saved = {}) {
  const base = deepClone(DEFAULT_SETTINGS);
  return {
    ...base,
    ...saved,
    // An empty array is a real saved preference. Falling back to defaults here
    // made favorites reappear after the user removed the final store.
    favoriteStores: Array.isArray(saved.favoriteStores)
      ? saved.favoriteStores
      : base.favoriteStores,
    location: { ...base.location, ...(saved.location || {}) },
    thresholds: { ...base.thresholds, ...(saved.thresholds || {}) },
    decisionWeights: { ...base.decisionWeights, ...(saved.decisionWeights || {}) },
    alerts: { ...base.alerts, ...(saved.alerts || {}) },
    monitoring: { ...base.monitoring, ...(saved.monitoring || {}) },
    budgets: { ...base.budgets, ...(saved.budgets || {}) },
    enabledSources: { ...base.enabledSources, ...(saved.enabledSources || {}) },
  };
}

export function createBlackFridayStore({
  dataDir = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedDir = dataDir || resolveDefaultDataDir(env);
  const statePath = path.join(resolvedDir, 'state.json');
  const backupDir = path.join(resolvedDir, 'backups');
  const uploadsDir = path.join(resolvedDir, 'uploads');
  let state = loadSync();
  seedWishlistFromRepoFile();
  seedDealsFromRepoFile();

  // Durability: local disk state does not survive git redeploys on Render
  // (no persistent disk / Supabase configured). The family's wish list is
  // therefore also kept as a seed file in the repo; whenever the loaded
  // state has an empty wish list (fresh deploy), restore from the seed.
  // In-app changes still persist to disk and win while the instance lives;
  // the seed only fills an empty list.
  function seedWishlistFromRepoFile() {
    try {
      if (Array.isArray(state.wishlist) && state.wishlist.length) return;
      const seedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wishlist-seed.json');
      if (!fsSync.existsSync(seedPath)) return;
      const seed = JSON.parse(fsSync.readFileSync(seedPath, 'utf8'));
      const items = Array.isArray(seed?.items) ? seed.items : [];
      if (!items.length) return;

      const profileByLower = new Map((state.profiles || []).map((p) => [String(p.name || '').toLowerCase(), p]));
      const ensureRecipientProfile = (recipientName) => {
        const clean = String(recipientName || '').trim();
        if (!clean || clean.toLowerCase() === 'family' || clean.toLowerCase() === 'household') return 'family-main';
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

      const seen = new Set();
      for (const raw of items) {
        if (!raw || (!String(raw.name || '').trim() && !String(raw.url || '').trim())) continue;
        const wlObj = createWishlistItemObject({
          ...raw,
          profileId: ensureRecipientProfile(raw.recipient),
          sourceUrl: raw.url || raw.sourceUrl || null,
          preferredPrice: raw.price ?? raw.preferredPrice,
          originalPrice: raw.originalPrice,
        });
        const dupKey = `${String(wlObj.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(wlObj.recipient || '').toLowerCase().trim()}|${String(wlObj.retailerId || wlObj.retailerName || '').toLowerCase().trim()}`;
        if (seen.has(dupKey)) continue;
        seen.add(dupKey);
        state.wishlist.push(wlObj);
      }
      if (state.wishlist.length) {
        console.log(`[black-friday/store] Seeded ${state.wishlist.length} wish-list items from repo seed file.`);
      }
    } catch (error) {
      console.error('[black-friday/store] Wish-list seed failed:', error?.message || error);
    }
  }
  let writeChain = Promise.resolve();
  let lastBackupAt = 0;

  function hydrateRawObject(raw) {
    const init = createInitialState();
    return {
      ...init,
      ...raw,
      schemaVersion: SCHEMA_VERSION,
      appVersion: BLACK_FRIDAY_VERSION,
      profiles: Array.isArray(raw.profiles) && raw.profiles.length
        ? raw.profiles.map(normalizeProfile)
        : init.profiles,
      wishlist: Array.isArray(raw.wishlist) ? raw.wishlist : [],
      savedDeals: Array.isArray(raw.savedDeals) ? raw.savedDeals : [],
      uploadedFiles: Array.isArray(raw.uploadedFiles) ? raw.uploadedFiles : [],
      deals: raw.deals && typeof raw.deals === 'object' ? raw.deals : {},
      priceHistory: raw.priceHistory && typeof raw.priceHistory === 'object' ? raw.priceHistory : {},
      sourceHealth: raw.sourceHealth && typeof raw.sourceHealth === 'object' ? raw.sourceHealth : {},
      retailerLinkStatus: raw.retailerLinkStatus && typeof raw.retailerLinkStatus === 'object' ? raw.retailerLinkStatus : {},
      cashbackRates: raw.cashbackRates && typeof raw.cashbackRates === 'object' ? raw.cashbackRates : {},
      alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
      feedback: {
        ...init.feedback,
        ...(raw.feedback || {}),
        lovedDealIds: Array.isArray(raw.feedback?.lovedDealIds) ? raw.feedback.lovedDealIds : (Array.isArray(raw.feedback?.savedDealIds) ? raw.feedback.savedDealIds : []),
        rejectedCanonicalKeys: Array.isArray(raw.feedback?.rejectedCanonicalKeys) ? raw.feedback.rejectedCanonicalKeys : [],
        boughtDealIds: Array.isArray(raw.feedback?.boughtDealIds) ? raw.feedback.boughtDealIds : [],
      },
      scheduler: { ...init.scheduler, ...(raw.scheduler || {}), running: false },
      settings: mergeSettings(raw.settings),
    };
  }

  // Same durability pattern as the wish list: after a redeploy the deals
  // state is empty until the next Refresh, which made every card button
  // (Find Similar / Find Cheaper / Compare) answer "Deal not found".
  // Restore the last good deals snapshot from the repo seed so the site is
  // never empty; prices still only UPDATE when Daniel clicks Refresh.
  function seedDealsFromRepoFile() {
    try {
      if (state.deals && Object.keys(state.deals).length) return;
      const seedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deals-seed.json');
      if (!fsSync.existsSync(seedPath)) return;
      const seed = JSON.parse(fsSync.readFileSync(seedPath, 'utf8'));
      const list = Array.isArray(seed?.deals) ? seed.deals : [];
      if (!list.length) return;
      state.deals = {};
      for (const d of list) if (d && d.id) state.deals[d.id] = d;
      if (!state.scheduler.lastSuccessfulRunAt && Number.isFinite(Date.parse(seed.snapshotAt))) {
        state.scheduler.lastSuccessfulRunAt = seed.snapshotAt;
      }
    } catch { /* seed is best-effort */ }
  }

  function loadSync() {
    try {
      if (fsSync.existsSync(statePath)) {
        const raw = JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
        if (raw && typeof raw === 'object') return hydrateRawObject(raw);
      }
    } catch (error) {
      console.error('[black-friday/store] Could not read persisted state, starting fresh:', error?.message || error);
    }
    return createInitialState();
  }

  /**
   * Hydrate persisted state from Supabase PostgreSQL on startup if configured and newer than local disk.
   */
  async function hydrateFromSupabase() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { synced: false, reason: 'not_configured' };
    try {
      const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/black_friday_state?id=eq.primary&select=payload,updated_at`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return { synced: false, reason: `HTTP ${res.status}` };
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row?.payload) return { synced: false, reason: 'empty' };
      const remoteTs = Date.parse(row.updated_at || row.payload.updatedAt || 0) || 0;
      const localTs = Date.parse(state.updatedAt || 0) || 0;
      if (remoteTs > localTs || (!state.wishlist.length && row.payload.wishlist?.length)) {
        state = hydrateRawObject(row.payload);
        await persist({ skipSupabase: true });
        return { synced: true, updatedAt: state.updatedAt };
      }
      return { synced: false, reason: 'local_is_newer' };
    } catch (e) {
      return { synced: false, reason: String(e?.message || e) };
    }
  }

  async function persist({ createBackup = false, skipSupabase = false } = {}) {
    state.updatedAt = new Date().toISOString();
    state.appVersion = BLACK_FRIDAY_VERSION;
    const payload = JSON.stringify(state, null, 2);

    const op = writeChain.catch(() => {}).then(async () => {
      await fs.mkdir(resolvedDir, { recursive: true });
      const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, statePath);

      const nowMs = Date.now();
      if (createBackup || nowMs - lastBackupAt > 30 * 60 * 1000) {
        lastBackupAt = nowMs;
        await fs.mkdir(backupDir, { recursive: true });
        const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
        const bFile = path.join(backupDir, `state-${stamp}.json`);
        await fs.writeFile(bFile, payload, 'utf8');
        const files = (await fs.readdir(backupDir)).filter((f) => f.startsWith('state-') && f.endsWith('.json')).sort();
        if (files.length > MAX_BACKUPS) {
          for (const old of files.slice(0, files.length - MAX_BACKUPS)) {
            await fs.unlink(path.join(backupDir, old)).catch(() => {});
          }
        }
      }

      if (!skipSupabase && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/black_friday_state`, {
            method: 'POST',
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify({ id: 'primary', payload: state, updated_at: state.updatedAt }),
            signal: AbortSignal.timeout(7000),
          });
        } catch {}
      }
    });

    writeChain = op;
    return op;
  }

  /**
   * Preserve original uploaded file on disk (even if parsing failed or needed correction).
   */
  async function saveUploadedFile({ filename = 'upload.txt', mimeType = 'application/octet-stream', contentBase64 = '', contentText = '', uploadType = 'wishlist', extractedCount = 0, parseWarning = null } = {}) {
    const id = `uf_${crypto.randomBytes(6).toString('hex')}`;
    const safeName = String(filename || 'upload.txt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const storedName = `${id}-${safeName}`;
    await fs.mkdir(uploadsDir, { recursive: true });

    const buf = contentBase64
      ? Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : Buffer.from(String(contentText || ''), 'utf8');
    await fs.writeFile(path.join(uploadsDir, storedName), buf);

    const record = {
      id,
      filename: filename || safeName,
      storedName,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes: buf.length,
      uploadType,
      extractedCount,
      parseWarning,
      uploadedAt: new Date().toISOString(),
    };
    state.uploadedFiles.unshift(record);
    if (state.uploadedFiles.length > MAX_UPLOADED_FILES) {
      state.uploadedFiles = state.uploadedFiles.slice(0, MAX_UPLOADED_FILES);
    }
    await persist();
    return record;
  }

  async function readUploadedFile(fileId) {
    const meta = (state.uploadedFiles || []).find((f) => f.id === fileId);
    if (!meta) return null;
    const filePath = path.join(uploadsDir, meta.storedName);
    try {
      const data = await fs.readFile(filePath);
      return { meta, data };
    } catch {
      return null;
    }
  }

  function recordPriceObservations(dealsList = [], nowMs = Date.now()) {
    let added = 0;
    for (const deal of dealsList) {
      if (!deal?.canonicalKey || deal.currentPrice === null || !Number.isFinite(deal.currentPrice)) continue;
      if (!state.priceHistory[deal.canonicalKey]) state.priceHistory[deal.canonicalKey] = [];
      const series = state.priceHistory[deal.canonicalKey];
      const latestSameRetailer = [...series].reverse().find((p) => p.retailerId === deal.retailerId);
      const isDuplicateRecent =
        latestSameRetailer &&
        latestSameRetailer.price === deal.currentPrice &&
        nowMs - Date.parse(latestSameRetailer.observedAt) < 20 * 60 * 1000;

      if (!isDuplicateRecent) {
        series.push({
          observedAt: deal.verifiedAt || new Date(nowMs).toISOString(),
          price: deal.currentPrice,
          regularPrice: deal.reportedRegularPrice ?? null,
          shippingCost: deal.shippingCost ?? null,
          allInTotal: deal.finalAllInTotal ?? null,
          retailerId: deal.retailerId,
          retailerName: deal.retailerName,
          sourceId: deal.sourceId,
          url: deal.retailerUrl,
          availabilityStatus: deal.availabilityStatus || 'unverified',
          condition: deal.condition || 'new',
        });
        if (series.length > MAX_HISTORY_PER_PRODUCT) {
          state.priceHistory[deal.canonicalKey] = series.slice(-MAX_HISTORY_PER_PRODUCT);
        }
        added += 1;
      }
    }
    return added;
  }

  function mergeDeals(incomingDeals = [], nowIso = new Date().toISOString()) {
    const nowMs = Date.parse(nowIso);
    const previousDealsById = {};
    for (const [id, d] of Object.entries(state.deals)) {
      previousDealsById[id] = { currentPrice: d.currentPrice, availabilityStatus: d.availabilityStatus };
    }

    for (const deal of incomingDeals) {
      const existing = state.deals[deal.id];
      if (existing) {
        state.deals[deal.id] = {
          ...existing,
          ...deal,
          imageUrl: deal.imageUrl || existing.imageUrl || null,
          reportedRegularPrice: deal.reportedRegularPrice ?? existing.reportedRegularPrice ?? null,
          reviewData: deal.reviewData || existing.reviewData || null,
          firstSeenAt: existing.firstSeenAt || existing.verifiedAt || nowIso,
          lastSeenAt: nowIso,
          archived: false,
        };
      } else {
        state.deals[deal.id] = {
          ...deal,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          archived: false,
        };
      }
    }

    for (const deal of Object.values(state.deals)) {
      if (deal.expiresAt && Date.parse(deal.expiresAt) < nowMs) {
        deal.archived = true;
        deal.archiveReason = 'Confirmed expiration passed';
      } else if (deal.lastSeenAt && nowMs - Date.parse(deal.lastSeenAt) > 72 * 3600000) {
        deal.archived = true;
        deal.archiveReason = 'No longer present in active feeds (>72h)';
      }
    }

    const allIds = Object.keys(state.deals);
    if (allIds.length > MAX_DEALS) {
      // Preserve up to the newest 45 deals per retailer before pruning so Amazon never crowds out Walmart/Target/Best Buy/etc.
      const keep = new Set();
      const perRetailerCount = new Map();
      const sorted = Object.values(state.deals).sort((a, b) => {
        if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1;
        return Date.parse(b.lastSeenAt || b.verifiedAt || 0) - Date.parse(a.lastSeenAt || a.verifiedAt || 0);
      });
      for (const d of sorted) {
        if (d.archived) continue;
        const rid = d.retailerId || 'other';
        const c = perRetailerCount.get(rid) || 0;
        if (c < 45 && keep.size < MAX_DEALS) {
          keep.add(d.id);
          perRetailerCount.set(rid, c + 1);
        }
      }
      for (const d of sorted) {
        if (keep.size >= MAX_DEALS) break;
        keep.add(d.id);
      }
      for (const id of allIds) {
        if (!keep.has(id)) delete state.deals[id];
      }
    }

    return previousDealsById;
  }

  async function syncFromGitHubWorker({ snapshotUrl = env.BLACK_FRIDAY_SNAPSHOT_URL || GITHUB_SNAPSHOT_URL } = {}) {
    if (!snapshotUrl || env.BLACK_FRIDAY_DISABLE_GITHUB_SYNC === '1') return { synced: false, reason: 'disabled' };
    try {
      const res = await fetchImpl(snapshotUrl, {
        headers: { 'User-Agent': 'BlackFridayCommandCenter/2.0' },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return { synced: false, reason: `HTTP ${res.status}` };
      const snap = await res.json();
      if (!snap || typeof snap !== 'object' || !snap.publishedAt) return { synced: false, reason: 'invalid_snapshot' };

      const localTs = Date.parse(state.scheduler.lastSuccessfulRunAt || 0) || 0;
      const remoteTs = Date.parse(snap.publishedAt) || 0;
      if (remoteTs <= localTs && Object.keys(state.deals).length > 0) {
        return { synced: false, reason: 'local_is_newer' };
      }

      if (Array.isArray(snap.deals) && snap.deals.length) {
        mergeDeals(snap.deals, snap.publishedAt);
        recordPriceObservations(snap.deals, remoteTs);
      }
      if (snap.sourceHealth && typeof snap.sourceHealth === 'object') {
        state.sourceHealth = { ...state.sourceHealth, ...snap.sourceHealth };
      }
      if (snap.cashbackRates && typeof snap.cashbackRates === 'object') {
        state.cashbackRates = { ...state.cashbackRates, ...snap.cashbackRates };
      }
      state.scheduler.lastSuccessfulRunAt = snap.publishedAt;
      state.scheduler.lastRunAt = snap.publishedAt;
      state.scheduler.lastWorkerSource = 'github_actions';
      await persist();
      return { synced: true, publishedAt: snap.publishedAt, dealsMerged: snap.deals?.length || 0 };
    } catch (e) {
      return { synced: false, reason: String(e?.message || e) };
    }
  }

  async function listBackups() {
    try {
      return (await fs.readdir(backupDir)).filter((f) => f.startsWith('state-') && f.endsWith('.json')).sort().reverse();
    } catch {
      return [];
    }
  }

  function getPersistenceInfo() {
    const usesSupabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
    const usesRenderDisk = resolvedDir.startsWith('/var/data');
    return {
      mode: usesSupabase ? 'supabase_postgres_plus_disk' : usesRenderDisk ? 'render_persistent_disk' : 'local_atomic_disk',
      survivesRedeploys: usesSupabase || usesRenderDisk,
      dataDir: resolvedDir,
      note: usesSupabase
        ? 'Persisted to Supabase PostgreSQL + local atomic backups (survives redeploys and device switches).'
        : usesRenderDisk
          ? 'Persisted to Render Persistent Disk (/var/data/black-friday).'
          : 'Persisted to local server disk (survives refreshes, browser restarts & device switches; attach a Render Persistent Disk at /var/data or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to survive git redeploys).',
    };
  }

  return {
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeProfile,
    hydrateFromSupabase,
    persist,
    saveUploadedFile,
    readUploadedFile,
    recordPriceObservations,
    mergeDeals,
    syncFromGitHubWorker,
    listBackups,
    getPersistenceInfo,
    trimAlerts: () => {
      if (state.alerts.length > MAX_ALERTS) state.alerts = state.alerts.slice(0, MAX_ALERTS);
    },
    pushSchedulerLog: (entry) => {
      state.scheduler.history = [entry, ...(state.scheduler.history || [])].slice(0, MAX_SCHEDULER_HISTORY);
    },
    dataDir: resolvedDir,
    statePath,
    uploadsDir,
  };
}
