/**
 * Autonomous Background Price Monitoring Scheduler & Personalized Dashboard Engine (v2.0).
 *
 * Monitors family wish lists AND user-uploaded saved deals continuously server-side.
 * Preserves original uploaded prices as historical records whenever prices change.
 * Enforces the strict 4-tier wish-list & family-profile recommendation hierarchy.
 */

import { EventEmitter } from 'node:events';
import {
  BLACK_FRIDAY_VERSION,
  RETAILER_DIRECTORY,
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
} from './adapters.js';
import {
  evaluateDeal,
  matchWishlistToDeal,
  normalizeProductIdentity,
  discoverAlternatives,
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
    // Click-only mode (Daniel, 2026-11-22): prices update only when he clicks
    // Refresh. Automatic sweeps stay off unless monitoring.autoUpdate is set.
    if (store.getState().settings?.monitoring?.autoUpdate !== true) {
      store.getState().scheduler.nextScheduledRunAt = null;
      return;
    }
    const mins = nextCadenceMinutes();
    const nextIso = new Date(now().getTime() + mins * 60000).toISOString();
    store.getState().scheduler.nextScheduledRunAt = nextIso;
    timer = setTimeout(() => {
      void runMonitoringSweep({ reason: 'scheduled', workerSource: 'server' });
    }, mins * 60000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function evaluateAllDeals() {
    const state = store.getState();
    const nowMs = now().getTime();
    const rawDeals = Object.values(state.deals || {});
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

    const evaluated = rawDeals.map((deal) => {
      const wishlistMatches = activeWish.filter((w) => matchWishlistToDeal(w, deal).matched);
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
  } = {}) {
    if (activeSweepPromise) return activeSweepPromise;

    const run = (async () => {
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
        });

        // 2. Targeted live search for active wish-list items (prioritizing High priority first!)
        const prioOrder = { high: 0, standard: 1, low: 2 };
        const wishTargets = (state.wishlist || [])
          .filter((w) => !['purchased', 'no_longer_interested'].includes(w.status))
          .filter((w) => !targetedWishlistIds || targetedWishlistIds.includes(w.id))
          .sort((a, b) => (prioOrder[a.priority] ?? 1) - (prioOrder[b.priority] ?? 1))
          .slice(0, 8);

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

        // 4. Merge deals & record real price history
        const previousDealsById = store.mergeDeals(allFetchedDeals, startedIso);
        const observationsAdded = store.recordPriceObservations(allFetchedDeals, startedAt.getTime());

        // 5. Evaluate deals & update wish-list statuses + saved-deal price tracking (preserving original uploaded price!)
        const evaluatedDeals = evaluateAllDeals();
        const activeEvaluated = evaluatedDeals.filter((d) => !d.archived);

        for (const item of state.wishlist || []) {
          if (['purchased', 'no_longer_interested'].includes(item.status)) continue;
          const matches = activeEvaluated.filter((d) => d.matchedWishlistIds.includes(item.id));
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

        // Check user-uploaded savedDeals against latest live prices & preserve originalUploadedPrice forever
        for (const sd of state.savedDeals || []) {
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
        const newAlerts = evaluateSmartAlerts({
          wishlist: state.wishlist,
          evaluatedDeals: activeEvaluated,
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
        const durationMs = Date.now() - startedAt.getTime();

        if (okSources > 0) state.scheduler.lastSuccessfulRunAt = startedIso;
        state.scheduler.runsCount = (state.scheduler.runsCount || 0) + 1;
        state.scheduler.lastWorkerSource = workerSource;
        state.scheduler.running = false;
        store.pushSchedulerLog({
          at: startedIso,
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
        events.emit('update', {
          type: 'sweep_complete',
          at: startedIso,
          dealsFetched: allFetchedDeals.length,
          observationsAdded,
          alertsTriggered: newAlerts.length,
          okSources,
          failedSources,
        });

        return {
          ok: okSources > 0,
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
        await store.persist();
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
    ].join('|');
    if (payloadCache && payloadCacheFingerprint === fingerprint) return payloadCache;
    const payload = buildDashboardPayloadUncached(state);
    payloadCache = payload;
    payloadCacheFingerprint = fingerprint;
    return payload;
  }

  function buildDashboardPayloadUncached(state) {
    const evaluatedAll = evaluateAllDeals();
    const activeDeals = evaluatedAll.filter((d) => !d.archived);
    const archivedDeals = evaluatedAll.filter((d) => d.archived);
    const rejectedIds = new Set(state.feedback?.rejectedDealIds || []);
    const rejectedKeys = new Set(state.feedback?.rejectedCanonicalKeys || []);
    const lovedIds = new Set([...(state.feedback?.lovedDealIds || []), ...(state.feedback?.savedDealIds || [])]);
    const boughtIds = new Set(state.feedback?.boughtDealIds || []);

    const enrichedActiveDeals = activeDeals.map((d) => ({
      ...d,
      isLoved: lovedIds.has(d.id),
      isRejected: rejectedIds.has(d.id) || (d.canonicalKey && rejectedKeys.has(d.canonicalKey)),
      isBought: boughtIds.has(d.id),
    }));

    const visibleDeals = enrichedActiveDeals.filter((d) => !d.isRejected);

    const enrichedWishlist = (state.wishlist || []).map((item) => {
      const matchedOffers = visibleDeals
        .filter((d) => d.matchedWishlistIds.includes(item.id))
        .sort((a, b) => (a.finalAllInTotal ?? a.currentPrice ?? 1e9) - (b.finalAllInTotal ?? b.currentPrice ?? 1e9));
      const bestOffer = matchedOffers[0] || null;
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

    const mainStoreSet = new Set(MAIN_STORE_IDS);
    const mainStoreStats = storesDirectory
      .filter((s) => mainStoreSet.has(s.id) || s.verifiedDealsCount >= 3)
      .filter((s) => !['slickdeals', 'dealnews', 'bradsdeals', 'retailmenot', 'rakuten', 'camelcamelcamel', 'keepa', 'cashbackmonitor'].includes(s.id))
      .sort((a, b) => b.verifiedDealsCount - a.verifiedDealsCount || (MAIN_STORE_IDS.indexOf(a.id) - MAIN_STORE_IDS.indexOf(b.id)))
      .slice(0, 26);

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
      alerts: state.alerts.slice(0, 100),
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
        console.log('[black-friday] Auto-update is off — prices refresh only on manual Refresh clicks.');
        return;
      }
      const lastOk = Date.parse(state.scheduler.lastSuccessfulRunAt || 0) || 0;
      const ageMin = (now().getTime() - lastOk) / 60000;
      if (Object.keys(state.deals || {}).length === 0 || ageMin >= 20) {
        await runMonitoringSweep({ reason: 'startup', workerSource: 'server' });
      } else {
        scheduleNext();
      }
    })();
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
