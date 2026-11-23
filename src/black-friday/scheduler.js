/**
 * Autonomous Background Price Monitoring Scheduler & Personalized Dashboard Engine (v2.0).
 *
 * Monitors family wish lists AND user-uploaded saved deals continuously server-side.
 * Preserves original uploaded prices as historical records whenever prices change.
 * Enforces the strict 4-tier wish-list & family-profile recommendation hierarchy.
 */

import { EventEmitter } from 'node:events';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import {
  BLACK_FRIDAY_VERSION,
  RETAILER_DIRECTORY,
  RETAILER_BY_ID,
  MAIN_STORE_IDS,
  LOCAL_STORES_KNIGHTDALE,
  SHOPPING_EVENTS_2026,
  PRIMARY_LOCATION,
  DEFAULT_FAVORITE_STORES,
} from './constants.js';
import {
  runAllAdapters,
  searchLiveSourcesForItem,
  inspectRetailerUrl,
  verifyRetailerDirectoryLinks,
  SOURCE_CATALOG,
  MAX_DEAL_POST_AGE_MS,
} from './adapters.js';
import {
  evaluateDeal,
  matchWishlistToDeal,
  normalizeProductIdentity,
  discoverAlternatives,
  extractDealTextFacts,
  isVideoGameDeal,
  runDealHunter,
  buildPersonalizedRecommendations,
  findSimilarOrCheaper,
  roundMoney,
} from './intelligence.js';
import {
  evaluateSmartAlerts,
  deliverAlertExternally,
  getChannelStatus,
} from './notifications.js';
import { cleanDealsWithAi, judgeWishlistMatches, extractPriceFactsWithAi } from './ai.js';

const gzipAsync = promisify(gzip);
const HOUR_MS = 60 * 60 * 1000;

function isHolidayFeedWeek(date) {
  const thanksgiving = new Date(Date.UTC(date.getUTCFullYear(), 10, 1));
  thanksgiving.setUTCDate(22 + (4 - thanksgiving.getUTCDay() + 7) % 7);
  // Monday before Thanksgiving through Cyber Monday, Eastern time.
  const start = thanksgiving.getTime() - 3 * 24 * HOUR_MS + 5 * HOUR_MS;
  return date.getTime() >= start && date.getTime() < start + 8 * 24 * HOUR_MS;
}

function indexWishlistOffers(deals, include = () => true) {
  const offers = new Map();
  for (const deal of deals) {
    for (const id of deal.matchedWishlistIds) {
      if (!include(deal, id)) continue;
      const matches = offers.get(id) || [];
      matches.push(deal);
      offers.set(id, matches);
    }
  }
  return offers;
}

function photoKey(deal) {
  const ids = deal.identifiers || {};
  if (ids.upc || ids.gtin) return `barcode:${ids.upc || ids.gtin}`;
  if (ids.asin) return `asin:${ids.asin}`;
  if (ids.tcin) return `tcin:${ids.tcin}`;
  if (ids.walmartId) return `walmart:${ids.walmartId}`;
  if (deal.retailerId && ids.sku) return `sku:${deal.retailerId}:${ids.sku}`;
  return null;
}

function archiveReason(deal, nowMs) {
  if (Date.parse(deal.expiresAt) <= nowMs) return 'Confirmed expiration passed';
  if (nowMs - Date.parse(deal.publishedAt) > MAX_DEAL_POST_AGE_MS) return 'Deal post is more than a week old';
  if (nowMs - Date.parse(deal.lastSeenAt || deal.verifiedAt) > 72 * HOUR_MS) return 'No longer present in active feeds (>72h)';
  return null;
}

export function createBlackFridayEngine({
  store,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  autoStart = true,
} = {}) {
  const events = new EventEmitter();
  let timer = null;
  let activeSweepPromise = null;
  let lastManualRefreshMs = 0;
  let payloadCache = null;
  let payloadCacheFingerprint = '';

  function isBlackFridayPeakWindow(date = now()) {
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    return (m === 10 && d >= 15) || (m === 11 && d <= 5);
  }

  function nextCadenceMinutes() {
    const state = store.getState();
    const cfg = state.settings?.monitoring || {};
    const hasHighPriority = (state.wishlist || []).some((w) => w.priority === 'high' && !['purchased', 'no_longer_interested'].includes(w.status));
    if (hasHighPriority) return Math.max(10, Number(cfg.highPriorityMinutes) || 15);
    if (isBlackFridayPeakWindow()) return Math.max(10, Number(cfg.blackFridayEventMinutes) || 15);
    return Math.max(15, Number(cfg.standardMinutes) || 90);
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    const state = store.getState();
    const monitoring = state.settings?.monitoring || {};
    const feedOnly = monitoring.autoUpdate !== true;
    if (feedOnly && (monitoring.autoRefreshHolidayFeed === false || !isHolidayFeedWeek(now()))) {
      state.scheduler.nextScheduledRunAt = null;
      return;
    }
    const lastRun = Date.parse(state.scheduler.lastRunAt || '') || 0;
    const delayMs = feedOnly ? Math.max(30_000, lastRun + HOUR_MS - now().getTime()) : nextCadenceMinutes() * 60_000;
    state.scheduler.nextScheduledRunAt = new Date(now().getTime() + delayMs).toISOString();
    timer = setTimeout(() => {
      if (feedOnly && (state.settings.monitoring.autoRefreshHolidayFeed === false || !isHolidayFeedWeek(now()))) return scheduleNext();
      void runMonitoringSweep({ reason: 'scheduled', workerSource: 'server', feedOnly }).catch(console.error);
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function evaluateAllDeals() {
    const state = store.getState();
    const nowMs = now().getTime();
    const rawDeals = Object.values(state.deals || {}).map((deal) => {
      const reason = archiveReason(deal, nowMs);
      return reason && !deal.archived ? { ...deal, archived: true, archiveReason: reason } : deal;
    });
    const activeWish = (state.wishlist || []).filter((w) => !['purchased', 'no_longer_interested'].includes(w.status));

    // Perf: matchWishlistToDeal() reuses a cached `identity` when present.
    // Compute each identity ONCE here instead of once per wishlist×deal pair
    // (with thousands of wish-list items that pair loop is millions of
    // regex-heavy normalizations per evaluation and saturates the server).
    for (const w of activeWish) {
      if (!w.identity) {
        try {
          w.identity = normalizeProductIdentity({
            title: `${w.brand || ''} ${w.name || ''} ${w.modelNumber || ''}`,
            brand: w.brand,
            modelNumber: w.modelNumber,
            url: w.sourceUrl,
          });
        } catch { /* leave unset; matcher will compute it */ }
      }
    }
    for (const d of rawDeals) {
      if (!d.identity) {
        try {
          d.identity = normalizeProductIdentity({
            title: d.title,
            brand: d.brand,
            modelNumber: d.modelNumber,
            url: d.retailerUrl,
          });
        } catch { /* leave unset; matcher will compute it */ }
      }
    }

    const byCanonical = new Map();
    for (const d of rawDeals) {
      if (d.archived) continue;
      const list = byCanonical.get(d.canonicalKey) || [];
      list.push(d);
      byCanonical.set(d.canonicalKey, list);
    }

    // Perf: candidate pre-filter for the wishlist×deal matcher. Running the
    // full matcher on every pair (3,069 items × ~850 deals ≈ 2.6M calls)
    // saturates/kills the server. The full matcher can only return a match
    // when a pair shares (a) an exact identifier, (b) the item's model number
    // in the deal's model/title, or (c) enough identity tokens (>=2 shared,
    // or the item's single token). Index items by token/model/identifier and
    // run the full matcher only on pairs that pass — results are unchanged.
    const itemTokensList = activeWish.map((w) => [...new Set((w.identity?.tokens || []).filter((t) => t.length >= 2))]);
    const tokenIndex = new Map();
    itemTokensList.forEach((toks, i) => {
      for (const t of toks) {
        const arr = tokenIndex.get(t) || [];
        arr.push(i);
        tokenIndex.set(t, arr);
      }
    });
    const modelItems = [];
    const idItems = [];
    activeWish.forEach((w, i) => {
      const model = String(w.modelNumber || w.identity?.modelNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (model && model.length >= 4) modelItems.push({ i, model });
      const ids = [w.upc || w.identity?.identifiers?.upc, w.gtin || w.identity?.identifiers?.gtin, w.asin || w.identity?.identifiers?.asin, w.tcin || w.identity?.identifiers?.tcin, w.sku || w.identity?.identifiers?.sku].filter(Boolean).map((x) => String(x).toUpperCase());
      if (ids.length) idItems.push({ i, ids });
    });

    const evaluated = rawDeals.map((deal) => {
      const candIdx = new Set();
      const dealTokens = new Set(deal.identity?.tokens || []);
      const sharedCounts = new Map();
      for (const t of dealTokens) {
        for (const i of tokenIndex.get(t) || []) sharedCounts.set(i, (sharedCounts.get(i) || 0) + 1);
      }
      for (const [i, c] of sharedCounts) {
        if (c >= 2 || (c === 1 && itemTokensList[i].length === 1)) candIdx.add(i);
      }
      if (modelItems.length) {
        const dealModel = String(deal.modelNumber || deal.identity?.modelNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const dealTitleCompact = String(deal.title || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        for (const { i, model } of modelItems) {
          if ((dealModel && dealModel === model) || dealTitleCompact.includes(model)) candIdx.add(i);
        }
      }
      if (idItems.length) {
        const dealIds = new Set([deal.identifiers?.upc, deal.identifiers?.gtin, deal.identifiers?.asin, deal.identifiers?.tcin, deal.identifiers?.sku].filter(Boolean).map((x) => String(x).toUpperCase()));
        if (dealIds.size) {
          for (const { i, ids } of idItems) {
            if (ids.some((x) => dealIds.has(x))) candIdx.add(i);
          }
        }
      }
      const wishlistMatches = [...candIdx]
        .map((i) => activeWish[i])
        .filter((w) => state.aiMatchVerdicts?.[`${w.canonicalKey}|${deal.canonicalKey}`] !== 'mismatch' && matchWishlistToDeal(w, deal).matched);
      const historyEntries = state.priceHistory[deal.canonicalKey] || [];
      const competitorDeals = byCanonical.get(deal.canonicalKey) || [];
      return evaluateDeal(deal, {
        historyEntries,
        competitorDeals,
        cashbackRates: state.cashbackRates || {},
        wishlistMatches,
        settings: state.settings,
        nowMs,
      });
    });

    evaluated.sort((a, b) => {
      if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1;
      const wDiff = (b.matchedWishlistIds.length > 0 ? 1 : 0) - (a.matchedWishlistIds.length > 0 ? 1 : 0);
      if (wDiff !== 0) return wDiff;
      const scoreDiff = (b.decision?.score || 0) - (a.decision?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.verifiedDiscountPct || -1) - (a.verifiedDiscountPct || -1);
    });

    return evaluated;
  }

  async function runMonitoringSweep({
    reason = 'scheduled',
    workerSource = 'server',
    targetedWishlistIds = null,
    createBackup = false,
    feedOnly = false,
  } = {}) {
    if (activeSweepPromise) return activeSweepPromise;

    const run = (async () => {
      const startedMs = Date.now();
      const startedAt = now();
      const startedIso = startedAt.toISOString();
      const state = store.getState();
      state.scheduler.running = true;
      state.scheduler.lastRunAt = startedIso;
      events.emit('update', { type: 'sweep_started', at: startedIso, reason });

      try {
        // 1. General multi-source sweep
        const adapterOut = await runAllAdapters({
          enabledSources: state.settings?.enabledSources || {},
          env,
          fetchImpl,
          now,
          feedOnly,
        });

        // 2. Targeted live search for active wish-list items (prioritizing High priority first!)
        const prioOrder = { high: 0, standard: 1, low: 2 };
        const wishTargets = (state.wishlist || [])
          .filter((w) => !['purchased', 'no_longer_interested'].includes(w.status))
          .filter((w) => !targetedWishlistIds || targetedWishlistIds.includes(w.id))
          .sort((a, b) => (prioOrder[a.priority] ?? 1) - (prioOrder[b.priority] ?? 1))
          .slice(0, feedOnly ? 0 : 8);

        const targetedDeals = [];
        for (const item of wishTargets) {
          const searchOut = await searchLiveSourcesForItem(item, { env, fetchImpl, now });
          targetedDeals.push(...searchOut.deals);
          item.lastCheckedAt = searchOut.checkedAt;
          for (const h of searchOut.sourcesChecked) {
            adapterOut.healthById[h.sourceId] = h;
          }
          // If the wish-list item has a direct retailer URL, also politely check it for fresh JSON-LD price
          if (item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl)) {
            const inspected = await inspectRetailerUrl(item.sourceUrl, { fetchImpl, now }).catch(() => null);
            if (inspected?.ok && inspected.currentPrice != null) {
              targetedDeals.push({
                id: `url_${item.id}`,
                canonicalKey: item.canonicalKey,
                title: inspected.name || item.name,
                brand: inspected.brand || item.brand,
                modelNumber: inspected.modelNumber || item.modelNumber,
                identifiers: inspected.identifiers || {},
                specs: inspected.specs || {},
                category: item.category,
                condition: 'new',
                isAccessory: false,
                retailerId: inspected.retailerId,
                retailerName: inspected.retailerName,
                currentPrice: inspected.currentPrice,
                reportedRegularPrice: item.originalPrice ?? null,
                baselineSource: item.originalPrice ? 'editorial_regular' : null,
                shippingCost: null,
                shippingFree: false,
                currency: 'USD',
                imageUrl: inspected.imageUrl || item.imageUrl || null,
                retailerUrl: inspected.url,
                dealPageUrl: inspected.url,
                isDirectProductUrl: true,
                availabilityStatus: inspected.availabilityStatus || 'unverified',
                localPickupKnightdale: 'unverified',
                sourceId: 'direct_url_inspector',
                sourceName: `${inspected.retailerName} Direct URL`,
                publishedAt: startedIso,
                verifiedAt: startedIso,
                lastSeenAt: startedIso,
                archived: false,
                reviewData: inspected.reviewData || null,
                description: inspected.description || '',
              });
            }
          }
        }

        const allFetchedDeals = [...adapterOut.deals, ...targetedDeals];
        const favoriteStores = new Set(state.settings.favoriteStores);
        const missingPhotos = allFetchedDeals.filter((deal) => {
          if (deal.imageUrl || !deal.isDirectProductUrl || !favoriteStores.has(deal.retailerId) || !(deal.currentPrice > 0)) return false;
          try {
            const host = new URL(deal.retailerUrl).hostname.toLowerCase();
            const domain = RETAILER_BY_ID[deal.retailerId]?.domain;
            return domain && (host === domain || host.endsWith(`.${domain}`));
          } catch { return false; }
        }).slice(0, 8);
        for (let i = 0; i < missingPhotos.length; i += 3) {
          await Promise.all(missingPhotos.slice(i, i + 3).map(async (deal) => {
            deal.imageUrl = state.deals[deal.id]?.imageUrl ||
              (await inspectRetailerUrl(deal.retailerUrl, { fetchImpl, now }).catch(() => null))?.imageUrl || null;
          }));
        }

        // 3. Merge source health & cashback rates
        for (const [sid, h] of Object.entries(adapterOut.healthById)) {
          const prev = state.sourceHealth[sid] || {};
          state.sourceHealth[sid] = {
            ...prev,
            ...h,
            lastSuccessAt: h.lastSuccessAt || prev.lastSuccessAt || null,
            consecutiveFailures: h.status === 'ok' ? 0 : (prev.consecutiveFailures || 0) + 1,
          };
        }
        if (Object.keys(adapterOut.cashbackRates || {}).length) {
          state.cashbackRates = { ...state.cashbackRates, ...adapterOut.cashbackRates };
        }

        // 3.5 Optional AI cleanup of feed titles (no-op without GEMINI_API_KEY)
        const aiReport = feedOnly ? null : await cleanDealsWithAi(allFetchedDeals, { fetchImpl }).catch(() => null);
        if (aiReport) state.aiCleanup = { at: startedIso, ...aiReport };

        // 3.6 AI price-fact extraction: most deal posts state a regular price
        // somewhere in their text; read the ones the regexes missed so more
        // deals can show a real discount (Daniel, 2026-11-22: only ~18% of
        // deals had a verified discount). Numbers are validated against the
        // post text inside the extractor — nothing is invented.
        try {
          const needFacts = feedOnly ? [] : allFetchedDeals.filter((d) => d.currentPrice > 0 && !(d.reportedRegularPrice > d.currentPrice) && !extractDealTextFacts(d).statedRegularPrice);
          if (needFacts.length) {
            const factsReport = await extractPriceFactsWithAi(needFacts, { fetchImpl }).catch(() => null);
            if (factsReport) state.aiPriceFacts = { at: startedIso, ...factsReport };
          }
        } catch { /* optional step */ }

        // 3.75 Store-page price check for direct retailer links: a price read
        // off the store's own product page beats the deal post's claim.
        // Best effort — many retailers block bots; failures are silent.
        try {
          const RETAIL_HOST = /(kohls\.com|target\.com|bestbuy\.com|walmart\.com|homedepot\.com|lowes\.com|amazon\.com|academy\.com|cabelas\.com|barnesandnoble\.com)/i;
          const candidates = (feedOnly ? [] : allFetchedDeals)
            .filter((d) => d.url && RETAIL_HOST.test(d.url) && d.currentPrice > 0)
            .sort((a, b) => ((b.reportedRegularPrice || 0) - (b.currentPrice || 0)) - ((a.reportedRegularPrice || 0) - (a.currentPrice || 0)))
            .slice(0, 10);
          await Promise.all(candidates.map(async (d) => {
            try {
              const res = await fetchImpl(d.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/html' },
                signal: AbortSignal.timeout(8000),
              });
              if (!res.ok) return;
              const html = await res.text();
              let price = null;
              const ld = html.match(/"offers"\s*:\s*\{[^}]*?"price"\s*:\s*"?([\d,]+\.\d{2})"?/);
              const meta = html.match(/property="product:price:amount"\s+content="([\d,]+\.\d{2})"/);
              const sale = html.match(/\$([\d,]+\.\d{2})\s*Sale/i);
              if (ld) price = Number(ld[1].replace(/,/g, ''));
              else if (meta) price = Number(meta[1].replace(/,/g, ''));
              else if (sale) price = Number(sale[1].replace(/,/g, ''));
              if (Number.isFinite(price) && price > 0) {
                d.storeCheckedPrice = price;
                const reg = html.match(/\$([\d,]+\.\d{2})\s*Reg/i);
                if (reg) d.storeCheckedRegularPrice = Number(reg[1].replace(/,/g, ''));
              }
            } catch { /* store check is best-effort */ }
          }));
        } catch { /* never fail the sweep over store checks */ }

        // 4. Merge deals & record real price history
        const previousDealsById = store.mergeDeals(allFetchedDeals, startedIso);
        const observationsAdded = store.recordPriceObservations(allFetchedDeals, startedAt.getTime());

        // 5. Evaluate deals & update wish-list statuses + saved-deal price tracking (preserving original uploaded price!)
        const evaluatedDeals = evaluateAllDeals();
        const activeEvaluated = evaluatedDeals.filter((d) => !d.archived);

        const wishlistOffers = indexWishlistOffers(activeEvaluated);
        for (const item of state.wishlist || []) {
          if (['purchased', 'no_longer_interested'].includes(item.status)) continue;
          const matches = wishlistOffers.get(item.id) || [];
          if (matches.length) item.lastCheckedAt = startedIso;
          const hasQualifyingDeal = matches.some(
            (m) =>
              (m.verifiedDiscountPct !== null && m.verifiedDiscountPct >= (state.settings.thresholds?.goodPct ?? 15)) ||
              (item.preferredPrice && m.currentPrice !== null && m.currentPrice <= item.preferredPrice)
          );
          if (hasQualifyingDeal && item.status !== 'deal_found') {
            item.status = 'deal_found';
            item.updatedAt = startedIso;
          }
        }

        // 5.5 AI check of wish-list matches: the token matcher over-matches
        // (accessories, wrong models). Pairs the AI judges "not the same
        // product" are stored and filtered out of wish-list best offers in
        // the dashboard payload. Verdicts persist in state across sweeps.
        try {
          const pairs = [];
          const seenPair = new Set();
          const wishById = new Map(state.wishlist.map((item) => [item.id, item]));
          for (const d of activeEvaluated) {
            for (const wid of d.matchedWishlistIds || []) {
              const item = wishById.get(wid);
              if (!item?.canonicalKey || !d.canonicalKey) continue;
              const key = `${item.canonicalKey}|${d.canonicalKey}`;
              if (seenPair.has(key) || state.aiMatchVerdicts?.[key]) continue;
              seenPair.add(key);
              pairs.push({ key, wishName: item.name, dealTitle: d.displayTitle || d.title });
            }
          }
          if (!feedOnly && pairs.length) {
            const judged = await judgeWishlistMatches(pairs.slice(0, 48), { fetchImpl });
            if (judged.size) {
              state.aiMatchVerdicts = { ...(state.aiMatchVerdicts || {}) };
              for (const [k, v] of judged) state.aiMatchVerdicts[k] = v;
            }
          }
        } catch { /* AI match check is optional; never fail the sweep over it */ }

        // Check user-uploaded savedDeals against latest live prices & preserve originalUploadedPrice forever
        for (const sd of feedOnly ? [] : (state.savedDeals || [])) {
          let observedPrice = null;
          let observedSource = null;
          if (sd.url && /^https?:\/\//i.test(sd.url)) {
            const insp = await inspectRetailerUrl(sd.url, { fetchImpl, now }).catch(() => null);
            if (insp?.ok && insp.currentPrice != null) {
              observedPrice = insp.currentPrice;
              observedSource = 'direct_url_recheck';
            }
          }
          if (observedPrice === null) {
            const matchedLive = activeEvaluated.find((d) => matchWishlistToDeal(sd, d).matched);
            if (matchedLive?.currentPrice != null) {
              observedPrice = matchedLive.currentPrice;
              observedSource = matchedLive.sourceName;
            }
          }
          sd.lastCheckedAt = startedIso;
          if (observedPrice !== null && observedPrice !== sd.currentPrice) {
            sd.currentPrice = observedPrice;
            sd.updatedAt = startedIso;
            if (!Array.isArray(sd.priceHistory)) sd.priceHistory = [];
            sd.priceHistory.push({
              observedAt: startedIso,
              price: observedPrice,
              source: observedSource || 'background_monitor',
              note: sd.originalUploadedPrice != null
                ? `Updated from original uploaded $${sd.originalUploadedPrice.toFixed(2)}`
                : 'Observed by background monitor',
            });
          }
        }

        // 6. Smart Alerts evaluation & delivery
        const wishById = new Map(state.wishlist.map((item) => [item.id, item]));
        const newAlerts = feedOnly ? [] : evaluateSmartAlerts({
          wishlist: state.wishlist,
          evaluatedDeals: activeEvaluated,
          wishlistOffers: indexWishlistOffers(activeEvaluated, (deal, itemId) =>
            state.aiMatchVerdicts?.[`${wishById.get(itemId)?.canonicalKey}|${deal.canonicalKey}`] !== 'mismatch'),
          previousDealsById,
          existingAlerts: state.alerts,
          settings: state.settings,
          now: startedAt,
        });

        for (const alert of newAlerts) {
          await deliverAlertExternally(alert, { env, settings: state.settings, fetchImpl, now: startedAt });
        }
        if (newAlerts.length) {
          state.alerts = [...newAlerts, ...state.alerts];
          store.trimAlerts();
        }

        const okSources = Object.values(adapterOut.healthById).filter((h) => h.status === 'ok').length;
        const failedSources = Object.values(adapterOut.healthById).filter((h) => ['error', 'blocked', 'rate_limited'].includes(h.status)).length;
        const durationMs = Date.now() - startedMs;

        const refreshedDeals = allFetchedDeals.some((deal) => deal.currentPrice > 0);
        if (refreshedDeals) state.scheduler.lastSuccessfulRunAt = startedIso;
        state.scheduler.runsCount = (state.scheduler.runsCount || 0) + 1;
        state.scheduler.lastWorkerSource = workerSource;
        state.scheduler.running = false;
        store.pushSchedulerLog({
          at: startedIso,
          ok: refreshedDeals,
          reason,
          workerSource,
          durationMs,
          okSources,
          failedSources,
          dealsFetched: allFetchedDeals.length,
          observationsAdded,
          alertsTriggered: newAlerts.length,
        });

        await store.persist({ createBackup });
        const pricedOffers = allFetchedDeals.filter((deal) => deal.currentPrice > 0);
        console.log(`[black-friday] ${feedOnly ? 'Deal feed' : 'Monitoring'} refresh in ${durationMs}ms: ${okSources} sources responded, ${pricedOffers.length} priced offers, ${pricedOffers.filter((deal) => deal.imageUrl).length} with photos.`);
        events.emit('update', {
          type: 'sweep_complete',
          ok: refreshedDeals,
          at: startedIso,
          dealsFetched: allFetchedDeals.length,
          observationsAdded,
          alertsTriggered: newAlerts.length,
          okSources,
          failedSources,
        });

        return {
          ok: refreshedDeals,
          at: startedIso,
          durationMs,
          okSources,
          failedSources,
          dealsFetched: allFetchedDeals.length,
          observationsAdded,
          alertsTriggered: newAlerts.length,
        };
      } catch (error) {
        state.scheduler.running = false;
        store.pushSchedulerLog({ at: startedIso, reason, workerSource, error: String(error?.message || error) });
        await store.persist().catch((persistError) => console.error('[black-friday] Failed to persist refresh failure:', persistError.message));
        events.emit('update', { type: 'sweep_error', at: startedIso, error: String(error?.message || error) });
        return { ok: false, at: startedIso, error: String(error?.message || error) };
      } finally {
        activeSweepPromise = null;
        if (autoStart) scheduleNext();
      }
    })();

    activeSweepPromise = run;
    return run;
  }

  async function searchForWishlistItem(itemId) {
    const state = store.getState();
    const item = state.wishlist.find((w) => w.id === itemId);
    if (!item) return null;

    const searchOut = await searchLiveSourcesForItem(item, { env, fetchImpl, now });
    item.lastCheckedAt = searchOut.checkedAt;
    for (const h of searchOut.sourcesChecked) {
      state.sourceHealth[h.sourceId] = h;
    }

    const previousDealsById = store.mergeDeals(searchOut.deals, searchOut.checkedAt);
    const observationsAdded = store.recordPriceObservations(searchOut.deals, Date.parse(searchOut.checkedAt));
    const evaluated = evaluateAllDeals();
    const active = evaluated.filter((d) => !d.archived);
    const matches = active.filter((d) => d.matchedWishlistIds.includes(item.id));
    if (matches.length && item.status === 'wanted') item.status = 'monitoring';
    if (matches.some((m) => (m.verifiedDiscountPct ?? 0) >= (state.settings.thresholds?.goodPct ?? 15) || (item.preferredPrice && m.currentPrice <= item.preferredPrice))) {
      item.status = 'deal_found';
    }

    const newAlerts = evaluateSmartAlerts({
      wishlist: [item],
      evaluatedDeals: active,
      previousDealsById,
      existingAlerts: state.alerts,
      settings: state.settings,
      now: now(),
    });
    if (newAlerts.length) {
      for (const a of newAlerts) await deliverAlertExternally(a, { env, settings: state.settings, fetchImpl, now: now() });
      state.alerts = [...newAlerts, ...state.alerts];
      store.trimAlerts();
    }

    await store.persist();
    events.emit('update', { type: 'wishlist_search_complete', itemId, matchesCount: matches.length });

    return {
      item,
      query: searchOut.query,
      sourcesChecked: searchOut.sourcesChecked,
      observationsAdded,
      matches,
      alternatives: discoverAlternatives(item, active),
      alertsTriggered: newAlerts.length,
    };
  }

  async function verifyStores() {
    const state = store.getState();
    const statuses = await verifyRetailerDirectoryLinks(RETAILER_DIRECTORY, { fetchImpl, now });
    state.retailerLinkStatus = { ...(state.retailerLinkStatus || {}), ...statuses };
    await store.persist();
    return statuses;
  }

  function buildDashboardPayload() {
    const state = store.getState();
    // Perf: with thousands of wish-list items a full rebuild costs seconds of
    // CPU. Rebuild only when the underlying state actually changed (every
    // mutation bumps state.updatedAt via persist); otherwise serve the cache.
    const fingerprint = [
      state.updatedAt || '',
      (state.wishlist || []).length,
      (state.savedDeals || []).length,
      (state.profiles || []).length,
      Object.keys(state.deals || {}).length,
      (state.alerts || []).length,
      state.scheduler?.lastSuccessfulRunAt || '',
      Math.floor(now().getTime() / (15 * 60_000)),
    ].join('|');
    if (payloadCache && payloadCacheFingerprint === fingerprint) return payloadCache;
    const payload = buildDashboardPayloadUncached(state);
    payloadCache = payload;
    payloadCacheFingerprint = fingerprint;
    return payload;
  }

  // Wire slimming (2026-11-22): the full dashboard payload is ~11 MB of JSON.
  // The browser never reads deal identity/priceStats/reviewData, the full
  // matchedOffers arrays, or most of bestOffer. Serving the slim copy (plus
  // gzip in routes.js) is the fix for the small Render instance tipping into
  // 502s under ordinary page loads. Internal consumers keep the full object.
  const WIRE_DEAL_DROP = new Set(['identity', 'priceStats', 'reviewData', 'description']);
  function stripDealForWire(d) {
    if (!d || typeof d !== 'object') return d;
    const out = {};
    for (const [k, v] of Object.entries(d)) if (!WIRE_DEAL_DROP.has(k)) out[k] = v;
    if (d.decision) out.decision = { score: d.decision.score, action: d.decision.action, reasons: d.decision.reasons };
    return out;
  }
  function projectOfferForWire(d) {
    if (!d || typeof d !== 'object') return null;
    return {
      id: d.id, canonicalKey: d.canonicalKey, title: d.title,
      currentPrice: d.currentPrice, normalPrice: d.normalPrice,
      verifiedDiscountPct: d.verifiedDiscountPct, finalAllInTotal: d.finalAllInTotal,
      retailerId: d.retailerId, retailerName: d.retailerName, retailerUrl: d.retailerUrl, dealPageUrl: d.dealPageUrl,
      imageUrl: d.imageUrl, tier: d.tier, isDirectProductUrl: d.isDirectProductUrl,
      freshness: d.freshness,
    };
  }
  function stripDealsDeep(value, depth) {
    if (!value || typeof value !== 'object' || depth > 3) return value;
    if (Array.isArray(value)) return value.map((v) => stripDealsDeep(v, depth + 1));
    if (value.canonicalKey && 'currentPrice' in value) return stripDealForWire(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = (v && typeof v === 'object') ? stripDealsDeep(v, depth + 1) : v;
    return out;
  }
  let wireCache = { source: null, slim: null, gzip: null };
  function slimDashboardForWire(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (wireCache.source === payload) return wireCache.slim;
    const slim = {
      ...payload,
      deals: (payload.deals || []).map(stripDealForWire),
      archivedDeals: (payload.archivedDeals || []).map(stripDealForWire),
      bestDealsRightNow: (payload.bestDealsRightNow || []).map(stripDealForWire),
      personalized: stripDealsDeep(payload.personalized, 0),
      hunter: stripDealsDeep(payload.hunter, 0),
      wishlist: (payload.wishlist || []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        const { identity, matchedOffers, bestOffer, ...rest } = item;
        return { ...rest, bestOffer: bestOffer ? projectOfferForWire(bestOffer) : null, matchedOffers: [] };
      }),
    };
    wireCache = { source: payload, slim, gzip: null };
    return slim;
  }
  function gzipDashboard(slim) {
    if (!slim || wireCache.slim !== slim) return null;
    wireCache.gzip ||= gzipAsync(JSON.stringify(slim)).catch((error) => {
      if (wireCache.slim === slim) wireCache.gzip = null;
      throw error;
    });
    return wireCache.gzip;
  }

  function buildDashboardPayloadUncached(state) {
    const evaluatedAll = evaluateAllDeals();
    const activeDeals = evaluatedAll.filter((d) => !d.archived);
    const archivedDeals = evaluatedAll.filter((d) => d.archived);
    const rejectedIds = new Set(state.feedback?.rejectedDealIds || []);
    const rejectedKeys = new Set(state.feedback?.rejectedCanonicalKeys || []);
    const lovedIds = new Set([...(state.feedback?.lovedDealIds || []), ...(state.feedback?.savedDealIds || [])]);
    const boughtIds = new Set(state.feedback?.boughtDealIds || []);

    const photoByProduct = new Map();
    for (const deal of activeDeals) {
      const key = photoKey(deal);
      if (key && deal.imageUrl && !photoByProduct.has(key)) photoByProduct.set(key, deal.imageUrl);
    }
    const enrichedActiveDeals = activeDeals.map((d) => ({
      ...d,
      imageUrl: d.imageUrl || photoByProduct.get(photoKey(d)) || null,
      isLoved: lovedIds.has(d.id),
      isRejected: rejectedIds.has(d.id) || (d.canonicalKey && rejectedKeys.has(d.canonicalKey)),
      isBought: boughtIds.has(d.id),
    }));

    const visibleDeals = enrichedActiveDeals.filter((d) => !d.isRejected && !isVideoGameDeal(d));
    const wishlistOffers = indexWishlistOffers(visibleDeals);

    const enrichedWishlist = (state.wishlist || []).map((item) => {
      const matchedOffers = [...(wishlistOffers.get(item.id) || [])]
        .sort((a, b) => (a.finalAllInTotal ?? a.currentPrice ?? Infinity) - (b.finalAllInTotal ?? b.currentPrice ?? Infinity));
      const bestOffer = matchedOffers.find((deal) => deal.currentPrice > 0 && deal.availabilityStatus !== 'out_of_stock' &&
        (!item.maxPrice || (deal.finalAllInTotal ?? deal.currentPrice) <= item.maxPrice)) || null;
      const historyCount = (state.priceHistory[item.canonicalKey] || []).length +
        (bestOffer && bestOffer.canonicalKey !== item.canonicalKey ? (state.priceHistory[bestOffer.canonicalKey] || []).length : 0);
      return {
        ...item,
        matchedOffersCount: matchedOffers.length,
        bestOffer,
        matchedOffers: matchedOffers.slice(0, 8),
        historyCount,
      };
    });

    const personalized = buildPersonalizedRecommendations({
      evaluatedDeals: visibleDeals,
      wishlist: state.wishlist,
      savedDeals: state.savedDeals || [],
      profiles: state.profiles || [],
      feedback: state.feedback || {},
      wishlistOffers,
    });

    const hunter = runDealHunter({
      evaluatedDeals: visibleDeals,
      wishlist: state.wishlist,
      profiles: state.profiles,
      feedback: state.feedback,
      settings: state.settings,
    });

    const sourceHealthList = SOURCE_CATALOG.map((src) => {
      const recorded = state.sourceHealth[src.id];
      if (recorded) return recorded;
      return {
        sourceId: src.id,
        name: src.name,
        kind: src.kind,
        category: src.category,
        status: src.envRequired ? 'api_key_required' : 'pending',
        httpStatus: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: src.envRequired ? `Requires env var: ${src.envRequired.join(', ')}` : 'Awaiting first scheduled check',
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: 0,
      };
    });

    const favSet = new Set(state.settings?.favoriteStores || DEFAULT_FAVORITE_STORES);
    const storesDirectory = RETAILER_DIRECTORY.map((r) => {
      const storeDeals = visibleDeals.filter((d) => d.retailerId === r.id);
      const matchingWishCount = new Set(storeDeals.flatMap((d) => d.matchedWishlistIds || [])).size;
      const latestVerified = storeDeals.map((d) => d.verifiedAt).filter(Boolean).sort().reverse()[0] || state.scheduler.lastSuccessfulRunAt || null;
      let liveMonitoringStatus = r.monitoringMode;
      if (r.id === 'bestbuy' && env.BESTBUY_API_KEY) liveMonitoringStatus = 'direct_api_active';
      if (r.id === 'ebay' && env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) liveMonitoringStatus = 'direct_api_active';
      const linkCheck = state.retailerLinkStatus?.[r.id] || { status: 'unverified', checkedAt: null };

      return {
        ...r,
        isFavorite: favSet.has(r.id),
        linkVerification: linkCheck,
        liveMonitoringStatus,
        verifiedDealsCount: storeDeals.length,
        matchingWishlistCount: matchingWishCount,
        lastCheckedAt: latestVerified,
        cashback: state.cashbackRates[r.id] || null,
      };
    });

    const favoriteStoresList = storesDirectory.filter((s) => s.isFavorite);
    const dealByCanonical = new Map();
    for (const d of visibleDeals) {
      if (d.canonicalKey && !dealByCanonical.has(d.canonicalKey)) {
        dealByCanonical.set(d.canonicalKey, d);
      }
    }
    const enrichedSavedDeals = (state.savedDeals || []).map((sd) => {
      const liveMatch = sd.canonicalKey ? dealByCanonical.get(sd.canonicalKey) : null;
      return {
        ...sd,
        imageUrl: sd.imageUrl || sd.screenshotThumbnail || liveMatch?.imageUrl || null,
        matchedLiveUrl: liveMatch?.retailerUrl || null,
        matchedLivePrice: liveMatch?.currentPrice ?? null,
      };
    });

    const favoriteOrder = [...new Set([...MAIN_STORE_IDS, ...favSet])];
    const mainStoreStats = [...favoriteStoresList]
      .sort((a, b) => favoriteOrder.indexOf(a.id) - favoriteOrder.indexOf(b.id));

    const unreadAlertsCount = (state.alerts || []).filter((a) => !a.read).length;

    const verified25Plus = visibleDeals.filter((d) => d.verifiedDiscountPct !== null && d.verifiedDiscountPct >= 25);
    const largestDiscountDeal = visibleDeals
      .filter((d) => d.verifiedDiscountPct !== null)
      .sort((a, b) => b.verifiedDiscountPct - a.verifiedDiscountPct)[0] || null;
    const wishlistDiscountedCount = enrichedWishlist.filter(
      (w) => !['purchased', 'no_longer_interested'].includes(w.status) && w.bestOffer &&
        ((w.bestOffer.verifiedDiscountPct !== null && w.bestOffer.verifiedDiscountPct >= 15) || (w.preferredPrice && w.bestOffer.currentPrice <= w.preferredPrice))
    ).length;

    const healthySources = sourceHealthList.filter((s) => s.status === 'ok').length;
    const failedSources = sourceHealthList.filter((s) => ['error', 'blocked', 'rate_limited'].includes(s.status)).length;
    const keyRequiredSources = sourceHealthList.filter((s) => s.status === 'api_key_required').length;

    return {
      version: BLACK_FRIDAY_VERSION,
      aiCleanup: state.aiCleanup || null,
      aiPriceFacts: state.aiPriceFacts || null,
      generatedAt: now().toISOString(),
      location: state.settings.location || PRIMARY_LOCATION,
      persistence: store.getPersistenceInfo(),
      kpis: {
        totalActiveDeals: visibleDeals.length,
        archivedDealsCount: archivedDeals.length,
        wishlistTotalCount: state.wishlist.length,
        savedDealsCount: (state.savedDeals || []).length,
        uploadedFilesCount: (state.uploadedFiles || []).length,
        wishlistDiscountedCount,
        verified25PlusCount: verified25Plus.length,
        largestVerifiedDiscountPct: largestDiscountDeal?.verifiedDiscountPct ?? null,
        largestDiscountTitle: largestDiscountDeal?.title ?? null,
        estimatedSavingsVsNormal: roundMoney(enrichedWishlist.reduce((s, w) => s + (w.bestOffer?.estimatedSavings || 0), 0)),
        newGiftRecommendationsCount: personalized.tier3Related.length + personalized.tier4Discoveries.length,
        lastSuccessfulUpdate: state.scheduler.lastSuccessfulRunAt,
        nextScheduledUpdate: state.scheduler.nextScheduledRunAt,
        monitoringStatus: {
          healthy: healthySources,
          failed: failedSources,
          apiKeyRequired: keyRequiredSources,
          total: sourceHealthList.length,
          running: Boolean(state.scheduler.running),
          lastWorkerSource: state.scheduler.lastWorkerSource,
        },
        unreadAlertsCount,
      },
      personalized,
      bestDealsRightNow: visibleDeals.filter((d) => d.currentPrice !== null).slice(0, 12),
      deals: visibleDeals,
      archivedDeals: archivedDeals.slice(0, 60),
      wishlist: enrichedWishlist,
      savedDeals: enrichedSavedDeals,
      mainStoreStats,
      uploadedFiles: state.uploadedFiles || [],
      profiles: state.profiles,
      hunter,
      events: SHOPPING_EVENTS_2026,
      localStores: LOCAL_STORES_KNIGHTDALE,
      favoriteStores: favoriteStoresList,
      storesDirectory,
      sourceHealth: sourceHealthList,
      alerts: (() => {
        // Collapse same-item, same-minute alert piles (older runs could fire
        // target + historical-low + better-price alerts for one event).
        const PRIO = { back_in_stock: 0, price_drop: 1, target_price_reached: 2, historical_low: 3, wishlist_discount: 4, better_retailer: 5, major_coupon: 6, local_pickup: 7, expiring_soon: 8, exceptional_deal: 9 };
        const byKey = new Map();
        for (const a of state.alerts || []) {
          const key = a.wishlistItemId ? `${a.wishlistItemId}|${String(a.triggeredAt || '').slice(0, 16)}` : a.id;
          const prev = byKey.get(key);
          if (!prev || (PRIO[a.type] ?? 9) < (PRIO[prev.type] ?? 9)) byKey.set(key, a);
        }
        return [...byKey.values()]
          .filter((a) => a.wishlistItemId || !isVideoGameDeal({ title: a.title || a.message || '', category: '' }))
          .sort((x, y) => String(y.triggeredAt || '').localeCompare(String(x.triggeredAt || '')))
          .slice(0, 100);
      })(),
      alertChannels: getChannelStatus({ env, settings: state.settings }),
      scheduler: state.scheduler,
      settings: state.settings,
      priceHistoryIndex: Object.entries(state.priceHistory || {}).map(([key, entries]) => ({
        canonicalKey: key,
        observationsCount: entries.length,
        latestPrice: entries[entries.length - 1]?.price ?? null,
        lowestPrice: entries.length ? Math.min(...entries.map((e) => e.price)) : null,
        latestObservedAt: entries[entries.length - 1]?.observedAt ?? null,
        retailers: [...new Set(entries.map((e) => e.retailerName))],
      })),
    };
  }

  function start() {
    if (!autoStart) return;
    void (async () => {
      await store.hydrateFromSupabase().catch(() => {});
      await store.syncFromGitHubWorker().catch(() => {});
      const state = store.getState();
      if (state.settings?.monitoring?.autoUpdate !== true) {
        scheduleNext();
        return;
      }
      const lastOk = Date.parse(state.scheduler.lastSuccessfulRunAt || 0) || 0;
      const ageMin = (now().getTime() - lastOk) / 60000;
      if (Object.keys(state.deals || {}).length === 0 || ageMin >= 20) {
        await runMonitoringSweep({ reason: 'startup', workerSource: 'server' });
      } else {
        scheduleNext();
      }
    })().catch(console.error);
  }

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  return {
    events,
    start,
    stop,
    runMonitoringSweep,
    searchForWishlistItem,
    verifyStores,
    evaluateAllDeals,
    buildDashboardPayload,
    slimDashboardForWire,
    gzipDashboard,
    scheduleNext,
    canManualRefresh: () => Date.now() - lastManualRefreshMs >= 6000,
    markManualRefresh: () => { lastManualRefreshMs = Date.now(); },
    discoverAlternativesForItem: (itemId) => {
      const state = store.getState();
      const item = state.wishlist.find((w) => w.id === itemId);
      if (!item) return null;
      const active = evaluateAllDeals().filter((d) => !d.archived);
      return discoverAlternatives(item, active);
    },
    compareDealOffers: (dealId) => {
      const dash = buildDashboardPayload();
      const deal = dash.deals.find((d) => d.id === dealId) || dash.archivedDeals.find((d) => d.id === dealId);
      if (!deal) return null;
      const exactMatches = dash.deals.filter(
        (d) => d.id !== deal.id && (d.canonicalKey === deal.canonicalKey || matchWishlistToDeal(deal, d).matched)
      );
      return {
        deal,
        exactMatches,
        similar: findSimilarOrCheaper(deal, dash.deals, 'similar'),
        cheaper: findSimilarOrCheaper(deal, dash.deals, 'cheaper'),
      };
    },
  };
}
