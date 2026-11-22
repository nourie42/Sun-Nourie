/**
 * Persistent Database Store with Atomic Writes, Rolling Backups,
 * Real Price History Ledger, and GitHub Worker / Supabase Sync.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLACK_FRIDAY_VERSION,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_PROFILES,
} from './constants.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data', 'black-friday');
const GITHUB_SNAPSHOT_URL = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/black-friday-data/snapshot.json';
const MAX_BACKUPS = 10;
const MAX_ALERTS = 250;
const MAX_DEALS = 450;
const MAX_HISTORY_PER_PRODUCT = 365;
const MAX_SCHEDULER_HISTORY = 40;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: BLACK_FRIDAY_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    profiles: deepClone(DEFAULT_PROFILES),
    wishlist: [],
    deals: {},
    priceHistory: {},
    sourceHealth: {},
    cashbackRates: {},
    alerts: [],
    feedback: {
      savedDealIds: [],
      rejectedDealIds: [],
      rejectedBrands: [],
      rejectedCategories: [],
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
  dataDir = process.env.BLACK_FRIDAY_DATA_DIR || DEFAULT_DATA_DIR,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const statePath = path.join(dataDir, 'state.json');
  const backupDir = path.join(dataDir, 'backups');
  let state = loadSync();
  let writeChain = Promise.resolve();
  let lastBackupAt = 0;

  function loadSync() {
    try {
      if (fsSync.existsSync(statePath)) {
        const raw = JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
        if (raw && typeof raw === 'object') {
          const init = createInitialState();
          return {
            ...init,
            ...raw,
            appVersion: BLACK_FRIDAY_VERSION,
            profiles: Array.isArray(raw.profiles) && raw.profiles.length ? raw.profiles : init.profiles,
            wishlist: Array.isArray(raw.wishlist) ? raw.wishlist : [],
            deals: raw.deals && typeof raw.deals === 'object' ? raw.deals : {},
            priceHistory: raw.priceHistory && typeof raw.priceHistory === 'object' ? raw.priceHistory : {},
            sourceHealth: raw.sourceHealth && typeof raw.sourceHealth === 'object' ? raw.sourceHealth : {},
            cashbackRates: raw.cashbackRates && typeof raw.cashbackRates === 'object' ? raw.cashbackRates : {},
            alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
            feedback: { ...init.feedback, ...(raw.feedback || {}) },
            scheduler: { ...init.scheduler, ...(raw.scheduler || {}), running: false },
            settings: mergeSettings(raw.settings),
          };
        }
      }
    } catch (error) {
      console.error('[black-friday/store] Could not read persisted state, starting fresh:', error?.message || error);
    }
    return createInitialState();
  }

  async function persist({ createBackup = false } = {}) {
    state.updatedAt = new Date().toISOString();
    state.appVersion = BLACK_FRIDAY_VERSION;
    const payload = JSON.stringify(state, null, 2);

    const op = writeChain.catch(() => {}).then(async () => {
      await fs.mkdir(dataDir, { recursive: true });
      const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, statePath);

      // Periodic rolling backups (at least once every 30 min or when explicitly requested)
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

      // Optional Supabase REST sync if user configured SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
      if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
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
            signal: AbortSignal.timeout(6000),
          });
        } catch {
          // Non-fatal; local atomic file remains authoritative
        }
      }
    });

    writeChain = op;
    return op;
  }

  /**
   * Append real timestamped price observations to priceHistory.
   * Never synthesizes past points. Deduplicates unchanged prices within 20 min for same retailer.
   */
  function recordPriceObservations(dealsList = [], nowMs = Date.now()) {
    let added = 0;
    for (const deal of dealsList) {
      if (!deal?.canonicalKey || deal.currentPrice === null || !Number.isFinite(deal.currentPrice)) continue;
      if (!state.priceHistory[deal.canonicalKey]) {
        state.priceHistory[deal.canonicalKey] = [];
      }
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

  /**
   * Merge newly fetched deals into state, archiving expired or stale unseen deals cleanly.
   */
  function mergeDeals(incomingDeals = [], nowIso = new Date().toISOString()) {
    const nowMs = Date.parse(nowIso);
    const previousDealsById = {};
    for (const [id, d] of Object.entries(state.deals)) {
      previousDealsById[id] = { currentPrice: d.currentPrice, availabilityStatus: d.availabilityStatus };
    }

    // Deduplicate incoming deals by id, keeping richest image/regularPrice/reviewData
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

    // Archive deals whose confirmed expiration date has passed or that haven't been seen in 72h
    for (const deal of Object.values(state.deals)) {
      if (deal.expiresAt && Date.parse(deal.expiresAt) < nowMs) {
        deal.archived = true;
        deal.archiveReason = 'Confirmed expiration passed';
      } else if (deal.lastSeenAt && nowMs - Date.parse(deal.lastSeenAt) > 72 * 3600000) {
        deal.archived = true;
        deal.archiveReason = 'No longer present in active feeds (>72h)';
      }
    }

    // Prune oldest archived deals if map grows beyond MAX_DEALS
    const allIds = Object.keys(state.deals);
    if (allIds.length > MAX_DEALS) {
      const sorted = Object.values(state.deals).sort((a, b) => {
        if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1;
        return Date.parse(b.lastSeenAt || b.verifiedAt || 0) - Date.parse(a.lastSeenAt || a.verifiedAt || 0);
      });
      const keep = new Set(sorted.slice(0, MAX_DEALS).map((d) => d.id));
      for (const id of allIds) {
        if (!keep.has(id)) delete state.deals[id];
      }
    }

    return previousDealsById;
  }

  /**
   * Hydrate newer verified snapshot published by GitHub Actions background worker (black-friday-data branch).
   * Never overwrites local family wish lists or user settings.
   */
  async function syncFromGitHubWorker({ snapshotUrl = env.BLACK_FRIDAY_SNAPSHOT_URL || GITHUB_SNAPSHOT_URL } = {}) {
    if (!snapshotUrl || env.BLACK_FRIDAY_DISABLE_GITHUB_SYNC === '1') return { synced: false, reason: 'disabled' };
    try {
      const res = await fetchImpl(snapshotUrl, {
        headers: { 'User-Agent': 'BlackFridayCommandCenter/1.0' },
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
      const files = (await fs.readdir(backupDir)).filter((f) => f.startsWith('state-') && f.endsWith('.json')).sort().reverse();
      return files;
    } catch {
      return [];
    }
  }

  return {
    getState: () => state,
    setState: (next) => { state = next; },
    persist,
    recordPriceObservations,
    mergeDeals,
    syncFromGitHubWorker,
    listBackups,
    trimAlerts: () => {
      if (state.alerts.length > MAX_ALERTS) state.alerts = state.alerts.slice(0, MAX_ALERTS);
    },
    pushSchedulerLog: (entry) => {
      state.scheduler.history = [entry, ...(state.scheduler.history || [])].slice(0, MAX_SCHEDULER_HISTORY);
    },
    dataDir,
    statePath,
  };
}
