/**
 * Family Shopping HQ · Black Friday Command Center v2.0 Client Application.
 * Zero decorative fluff, zero dead buttons, zero invented preferences.
 */

import { renderPriceHistoryChart, renderRetailerCompareBars } from './charts.js';

const STORAGE_PREFS_KEY = 'bf_command_prefs_v2';
const STORAGE_CACHE_KEY = 'bf_command_cache_v2';

const VIEW_META = {
  'command-center': ['Family Shopping HQ', 'Favorite stores, upload center, wish-list matches & personalized deals · Knightdale, NC 27545'],
  'all-stores': ['Retailer Deal Pages', 'Tap a retailer to leave this app and open its official deals page'],
  'upload-center': ['Upload Center', 'Upload Excel (.xlsx/.xls), CSV, PDF, Word, screenshots, emails, or URLs — preview & edit before saving'],
  wishlists: ['Wish Lists & Saved Deals', 'Monitored family wish lists & user-uploaded deals with original price history preserved'],
  profiles: ['Family Shopping Profiles', 'Editable member brands, sizes, hobbies, preferred stores & gift budgets'],
  'black-friday-live': ['Black Friday Sales', 'Confirmed 2026 event countdowns, retailer Black Friday links & verified holiday deals'],
  compare: ['Compare Prices', 'Cross-retailer exact comparisons & 3-tier smarter alternatives'],
  'local-deals': ['Knightdale / Raleigh Local', 'Nearby physical stores around 27545, pickup options & local chain deals'],
  'price-history': ['Price History', 'Genuine timestamped multi-retailer observations — never fabricated'],
  alerts: ['Alerts', 'Deduplicated smart notifications, quiet hours & delivery channel status'],
  'best-deals': ['Browse All Live Feeds', 'Optional full live-feed explorer across authorized deal sources'],
  settings: ['Settings & Source Health', 'Thresholds, decision weights, persistence diagnostics & JSON backup'],
};

const TIER_LABELS = {
  exceptional: 'Exceptional 40%+',
  great: 'Great 25–39%',
  good: 'Good 15–24%',
  watch: 'Watch <15%',
  unverified: 'Baseline Unknown',
};

const CAT_ICONS = {
  electronics: '💻', gaming: '🎮', home: '🏠', tools: '🛠️',
  apparel: '👟', beauty: '✨', toys: '🧱', outdoors: '⛺', pets: '🐾', other: '🛍️',
};

const appState = {
  data: null,
  activeView: 'command-center',
  homeStoreQuery: '',
  homeSelectedStore: 'all',
  homeDealsSearch: '',
  homeDealsSort: 'score',
  homeDeals25Plus: false,
  homeDealsImgOnly: true,
  homeDealsLimit: 9999,
  homeRecipient: 'all',
  homeWlSearch: '',
  homeWlStore: 'all',
  homeWlFilter: 'all',
  homeWlSort: 'discount',
  homeWlLimit: 60,
  uploadType: 'wishlist', // 'wishlist' | 'deal'
  uploadMode: 'file',     // 'file' | 'bulk' | 'urls' | 'manual'
  uploadPreview: null,    // { uploadType, suggestedUploadType, uploadFileId, uploadFileIds, parseWarning, items: [...] }
  previewPage: 0,
  previewQuery: '',
  previewPageSize: 50,
  selectedProfileId: 'all',
  wishlistStatusFilter: 'all',
  bfSubtab: 'all',
  localTab: 'all',
  historyKey: '',
  historyRange: 'all',
  altWishlistId: '',
  compareDealIds: [],
  filters: {
    q: '', tier: 'all', retailer: 'all', category: 'all', sort: 'score',
    maxPrice: '', freeShip: false, newOnly: false, localOnly: false,
  },
  storeFilters: { q: '', category: 'all', favOnly: false },
  sse: null,
  countdownTimer: null,
};

const $ = (id) => document.getElementById(id);

function esc(val) {
  return String(val ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(val) {
  return typeof val === 'number' && Number.isFinite(val) ? `$${val.toFixed(2)}` : '—';
}

function timeAgo(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return 'Never';
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatClock(iso) {
  const d = new Date(iso || '');
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

function toast(msg) {
  const stack = $('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function getStoreMeta(retailerId, fallbackDomain = null, fallbackName = null) {
  const known = appState.data?.storesDirectory?.find((s) => s.id === retailerId);
  if (known) return known;
  if (fallbackDomain) {
    return {
      id: retailerId || 'store',
      name: fallbackName || fallbackDomain,
      domain: fallbackDomain,
      logoUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(fallbackDomain)}&sz=128`,
      monogram: (fallbackName || fallbackDomain).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'ST',
      accent: '#38bdf8',
    };
  }
  return null;
}

function renderStoreAvatar(store, small = false) {
  const accent = store?.accent || '#38bdf8';
  const mono = store?.monogram || (store?.name || 'ST').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  const logoUrl = store?.logoUrl || '';
  return `
    <span class="store-logo-avatar ${small ? 'is-sm' : ''}" style="background:${logoUrl ? '#ffffff' : esc(accent)};">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(store?.name || '')}" loading="lazy" data-monogram="${esc(mono)}" data-accent="${esc(accent)}" />` : `<span class="store-logo-monogram">${esc(mono)}</span>`}
    </span>`;
}

function attachLogoFallbacks(root = document) {
  root.querySelectorAll('.store-logo-avatar img').forEach((img) => {
    if (img.dataset.boundFallback) return;
    img.dataset.boundFallback = '1';
    img.addEventListener('error', () => {
      const parent = img.parentElement;
      if (!parent) return;
      parent.style.background = img.dataset.accent || '#38bdf8';
      parent.innerHTML = `<span class="store-logo-monogram">${esc(img.dataset.monogram || 'ST')}</span>`;
    });
  });
}

function attachImageFallbacks(root = document) {
  attachLogoFallbacks(root);
  root.querySelectorAll('.deal-media img').forEach((img) => {
    if (img.dataset.boundImgFallback) return;
    img.dataset.boundImgFallback = '1';
    img.addEventListener('error', () => {
      const media = img.parentElement;
      if (!media) return;
      img.remove();
      if (!media.querySelector('.deal-media-fallback')) {
        const fb = document.createElement('div');
        fb.className = 'deal-media-fallback';
        fb.textContent = img.dataset.fallbackIcon || '🛍️';
        media.prepend(fb);
      }
    });
  });
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFS_KEY) || '{}');
    if (raw.theme === 'light' || raw.theme === 'dark') applyTheme(raw.theme, false);
    if (raw.filters) appState.filters = { ...appState.filters, ...raw.filters };
    if (Array.isArray(raw.compareDealIds)) appState.compareDealIds = raw.compareDealIds.slice(0, 4);
  } catch {}
}

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify({
      theme: document.documentElement.dataset.theme || 'dark',
      filters: appState.filters,
      compareDealIds: appState.compareDealIds,
    }));
  } catch {}
}

function applyTheme(theme, persistServer = false) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  const btn = $('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'light' ? '🌙 Dark' : '☀️ Light';
  savePrefs();
  if (persistServer) api('/api/black-friday/settings', { method: 'PATCH', body: { theme } }).catch(() => {});
}

async function api(url, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(json?.error || `Request failed (HTTP ${res.status})`);
  return json;
}

function switchView(viewId) {
  if (!VIEW_META[viewId]) return;
  appState.activeView = viewId;
  document.querySelectorAll('.view-panel').forEach((el) => el.classList.toggle('is-active', el.id === `view-${viewId}`));
  document.querySelectorAll('#nav-list .nav-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === viewId));
  const [title, sub] = VIEW_META[viewId];
  $('topbar-title').textContent = title;
  $('topbar-sub').textContent = sub;
  $('sidebar').classList.remove('is-open');
  $('sidebar-scrim').classList.remove('is-open');
  renderActiveView();
}

function openUploadCenter(type = 'wishlist', mode = 'file') {
  appState.uploadType = type;
  appState.uploadMode = mode;
  switchView('upload-center');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==================== ACTIONABLE PRODUCT CARD (PRIORITY 6) ==================== */
function renderProductCardHtml(deal, recMeta = null) {
  const store = getStoreMeta(deal.retailerId) || { name: deal.retailerName, monogram: (deal.retailerName || 'ST').slice(0, 2).toUpperCase(), accent: '#38bdf8' };
  const tierClass = `tier-${deal.tier || 'unverified'}`;
  const badgeClass = `badge-${deal.tier || 'unverified'}`;
  const hasRealDrop = deal.verifiedDiscountPct !== null && deal.verifiedDiscountPct >= 2 && deal.normalPrice !== null && deal.normalPrice > deal.currentPrice;
  const discountLabel = hasRealDrop
    ? `${deal.verifiedDiscountPct}% OFF`
    : (deal.normalPrice !== null && deal.currentPrice >= deal.normalPrice
      ? 'At Typical Price'
      : (deal.verifiedDiscountPct !== null && deal.verifiedDiscountPct > 0 ? 'Near Typical' : 'Baseline Unknown'));
  const imgHtml = deal.imageUrl
    ? `<img src="${esc(deal.imageUrl)}" alt="${esc(deal.title)}" loading="lazy" decoding="async" data-fallback-icon="${CAT_ICONS[deal.category] || '🛍️'}" />`
    : `<div class="deal-media-fallback" aria-hidden="true">${CAT_ICONS[deal.category] || '🛍️'}</div>`;

  // Priority 6: Honest SHOP NOW label — direct merchant links & merchant jump links vs aggregator thread
  const shopLabel = deal.isDirectProductUrl
    ? `SHOP NOW ↗`
    : deal.isMerchantJumpUrl
      ? `SHOP AT ${esc((deal.retailerName || 'STORE').toUpperCase())} ↗`
      : `VIEW DEAL (${esc(deal.sourceName?.split(' ')[0] || 'Deal')}) ↗`;

  const recExplanationHtml = recMeta
    ? `<div class="rec-why-grid">
        <div><strong>${esc(recMeta.tierLabel)}</strong> · Triggered by: <strong>${esc(recMeta.triggeredBy)}</strong></div>
        <div><strong>Why relevant:</strong> ${esc(recMeta.whyRelevant)}</div>
        <div><strong>Better / Worse:</strong> ${esc(recMeta.betterOrWorse)}</div>
        <div><strong>Savings &amp; Store:</strong> ${recMeta.savesMoney ? `Saves ~${money(recMeta.estimatedSavings)}` : 'Current live price'} · Buy at <strong>${esc(recMeta.whereToBuy)}</strong></div>
      </div>`
    : `<div class="deal-why"><strong>Why consider:</strong> ${esc(deal.whyWorthConsidering)}</div>`;

  return `
    <article class="deal-card ${tierClass}" data-deal-id="${esc(deal.id)}">
      <div class="deal-media">
        ${imgHtml}
        <div class="deal-media-top">
          <span class="badge ${badgeClass} tabular">${esc(discountLabel)}</span>
          <span class="score-pill tabular">Score ${esc(deal.decision?.score ?? 0)}/100</span>
        </div>
      </div>

      <div class="deal-body">
        <div class="deal-meta-row">
          <span style="display:inline-flex;align-items:center;gap:7px;">
            ${renderStoreAvatar(store, true)}
            <span class="retailer-tag">${esc(deal.retailerName || 'Retailer')}</span>
          </span>
          <span class="badge ${deal.decision?.action === 'BUY NOW' ? 'badge-buy' : 'badge-wait'}">${esc(deal.decision?.action || 'WAIT')}</span>
        </div>

        <h3 class="deal-title" title="${esc(deal.title)}">${esc(deal.title)}</h3>
        ${(deal.brand || deal.modelNumber) ? `<div class="small muted">${esc([deal.brand, deal.modelNumber ? `Model: ${deal.modelNumber}` : null].filter(Boolean).join(' · '))}</div>` : ''}

        <div class="deal-price-box">
          <span class="price-now tabular">${money(deal.currentPrice)}</span>
          <span class="tabular">
            ${deal.normalPrice !== null && deal.normalPrice > deal.currentPrice
              ? `<span class="price-normal">${money(deal.normalPrice)}</span>`
              : deal.normalPrice !== null
                ? `<span class="small muted">Typical ${money(deal.normalPrice)}</span>`
                : '<span class="small muted">Typical price unknown</span>'}
          </span>
          <div class="price-breakdown tabular">
            <span>Ship: <strong>${deal.shippingFree ? 'Free' : deal.shippingCost != null ? money(deal.shippingCost) : 'Verify'}</strong></span>
            <span>NC Tax (${esc(deal.taxRatePct ?? 7.25)}%): <strong>${money(deal.estimatedTax)}</strong></span>
            <span>All-In: <strong>${money(deal.finalAllInTotal)}</strong></span>
          </div>
        </div>

        ${recExplanationHtml}

        <div class="deal-verify-line tabular">
          <span>Verified ${esc(timeAgo(deal.verifiedAt))} via ${esc(deal.sourceName)}</span>
          <span>${deal.isDirectProductUrl ? 'Direct Product Link' : 'Verified Deal Page'}</span>
        </div>

        <div class="deal-actions">
          <a class="btn btn-primary btn-sm" href="${esc(deal.retailerUrl)}" target="_blank" rel="noopener noreferrer">${shopLabel}</a>
          <button class="btn btn-sm" data-action="compare-prices" data-deal-id="${esc(deal.id)}" type="button">COMPARE PRICES</button>
          <button class="btn btn-sm" data-action="detail" data-deal-id="${esc(deal.id)}" type="button">Details</button>
        </div>

        <div class="feedback-row">
          <button class="fb-btn ${deal.isLoved ? 'is-loved' : ''}" data-fb="love" data-deal-id="${esc(deal.id)}" type="button">${deal.isLoved ? '♥ SAVED / LOVED' : '♡ LOVE IT / SAVE'}</button>
          <button class="fb-btn is-reject" data-fb="reject" data-deal-id="${esc(deal.id)}" data-title="${esc(deal.title)}" type="button">✕ NOT INTERESTED</button>
          <button class="fb-btn" data-action="find-similar" data-deal-id="${esc(deal.id)}" type="button">≈ FIND SIMILAR</button>
          <button class="fb-btn" data-action="find-cheaper" data-deal-id="${esc(deal.id)}" type="button">↓ FIND CHEAPER</button>
          <button class="fb-btn" data-fb="bought" data-deal-id="${esc(deal.id)}" type="button">✓ ALREADY BOUGHT</button>
        </div>
      </div>
    </article>`;
}

function renderUploadedItemCardHtml(item) {
  const isSavedDeal = item._kind === 'deal';
  const store = getStoreMeta(item.retailerId, item.storeDomain, item.retailerName) || {
    name: item.retailerName || 'Store',
    monogram: (item.retailerName || 'ST').slice(0, 2).toUpperCase(),
    accent: '#38bdf8',
  };
  const salePrice = isSavedDeal ? item.currentPrice : (item.bestOffer?.currentPrice ?? item.preferredPrice);
  const regPrice = isSavedDeal ? item.originalRegularPrice : (item.originalPrice ?? item.bestOffer?.normalPrice ?? null);
  const discPct = isSavedDeal ? item.verifiedDiscountPct : (item.discountPct ?? item.bestOffer?.verifiedDiscountPct ?? null);
  const saveDollar = isSavedDeal
    ? (item.savingsAmount ?? (regPrice != null && salePrice != null && regPrice > salePrice ? regPrice - salePrice : null))
    : (item.savingsAmount ?? (regPrice != null && salePrice != null && regPrice > salePrice ? regPrice - salePrice : null));

  const tierClass = discPct >= 40 ? 'tier-exceptional' : discPct >= 25 ? 'tier-great' : discPct >= 15 ? 'tier-good' : 'tier-watch';
  const badgeClass = discPct >= 40 ? 'badge-exceptional' : discPct >= 25 ? 'badge-great' : discPct >= 15 ? 'badge-good' : 'badge-watch';

  const thumb = item.imageUrl || item.screenshotThumbnail || item.bestOffer?.imageUrl || null;
  const imgHtml = thumb
    ? `<img src="${esc(thumb)}" alt="${esc(item.name)}" loading="lazy" decoding="async" data-fallback-icon="${CAT_ICONS[item.category] || '🎁'}" />`
    : `<div class="deal-media-fallback" style="flex-direction:column;gap:8px;">${renderStoreAvatar(store, false)}<span class="small muted">${esc(item.retailerName || 'Saved Item')}</span></div>`;

  const directUrl = item.url || item.sourceUrl || item.matchedLiveUrl || item.bestOffer?.retailerUrl || null;
  const searchFallbackUrl = item.storeSearchUrl || item.storeHomeUrl || store.url || null;
  const actionUrl = directUrl || searchFallbackUrl;
  const actionLabel = directUrl ? 'SHOP NOW ↗' : `Search ${esc(item.retailerName || 'Store')} ↗`;

  return `
    <article class="deal-card ${tierClass} uploaded-deal-card">
      <div class="deal-media">
        ${imgHtml}
        <div class="deal-media-top">
          <span class="badge ${badgeClass} tabular">${discPct != null ? `${Number(discPct).toFixed(1).replace(/\.0$/, '')}% OFF` : (isSavedDeal ? 'Saved Deal' : 'Wish List')}</span>
          ${item.evidence ? `<span class="badge ${item.evidence === 'Strong' ? 'badge-buy' : item.evidence === 'Medium' ? 'badge-great' : 'badge-watch'}">${esc(item.evidence)} Evid.</span>` : ''}
        </div>
      </div>

      <div class="deal-body">
        <div class="deal-meta-row">
          <span style="display:inline-flex;align-items:center;gap:7px;min-width:0;">
            ${renderStoreAvatar(store, true)}
            <span class="retailer-tag" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.retailerName || 'Store')}</span>
          </span>
          <span style="display:inline-flex;gap:5px;flex-wrap:wrap;">
            ${item.recipient ? `<span class="badge badge-local">${esc(item.recipient)}</span>` : ''}
            ${item.tier ? `<span class="badge badge-watch">${esc(item.tier)}</span>` : ''}
          </span>
        </div>

        <h3 class="deal-title" title="${esc(item.name)}">${esc(item.name)}</h3>

        <div class="deal-price-box">
          <span class="price-now tabular">${salePrice != null ? money(salePrice) : 'Price Needed'}</span>
          <span class="tabular">
            ${regPrice != null && (salePrice == null || regPrice > salePrice) ? `<span class="price-normal">${money(regPrice)}</span>` : ''}
            ${saveDollar != null && saveDollar > 0 ? `<span class="badge badge-exceptional" style="margin-left:6px;">Save ${money(saveDollar)}</span>` : ''}
          </span>
          ${(item.checkedAtText || item.foundBy || item.regularPriceSource) ? `
            <div class="price-breakdown">
              ${item.regularPriceSource ? `<span>Src: <strong>${esc(item.regularPriceSource.slice(0, 32))}</strong></span>` : ''}
              ${item.foundBy ? `<span>By: <strong>${esc(item.foundBy)}</strong></span>` : ''}
              ${item.checkedAtText ? `<span>Checked: <strong>${esc(item.checkedAtText)}</strong></span>` : ''}
            </div>` : ''}
        </div>

        ${item.notes ? `<div class="deal-why">${esc(item.notes.slice(0, 170))}${item.notes.length > 170 ? '…' : ''}</div>` : ''}

        <div class="deal-actions">
          ${actionUrl ? `<a class="btn btn-primary btn-sm" href="${esc(actionUrl)}" target="_blank" rel="noopener noreferrer">${actionLabel}</a>` : ''}
          ${item.storeHomeUrl && directUrl ? `<a class="btn btn-sm" href="${esc(item.storeHomeUrl)}" target="_blank" rel="noopener noreferrer">Store ↗</a>` : ''}
          ${!isSavedDeal ? `<button class="btn btn-sm" data-wl-search="${esc(item.id)}" type="button">🔍 Check Live</button>` : ''}
        </div>
      </div>
    </article>`;
}

/* ==================== 1. HOME PAGE (EXACT 3-SECTION EXPERIENCE) ==================== */
function renderHomePage() {
  const d = appState.data;
  if (!d) return;

  // ---- SECTION 1: MAIN STORES LIVE DEALS WITH STORE PICKER ----
  const mainStats = d.mainStoreStats || [];
  const allLiveWithPrice = (d.deals || []).filter((x) => x.currentPrice !== null);
  const storePickerEl = $('home-store-picker');
  if (storePickerEl) {
    const pickerHtml = [
      `<button class="store-pick-pill ${appState.homeSelectedStore === 'all' ? 'is-active' : ''}" data-pick-store="all" type="button">🛍️ All Main Stores <span class="store-pick-count tabular">${allLiveWithPrice.length}</span></button>`,
      ...mainStats.map((st) => `
        <button class="store-pick-pill ${appState.homeSelectedStore === st.id ? 'is-active' : ''}" data-pick-store="${esc(st.id)}" type="button">
          ${renderStoreAvatar(st, true)}
          <span>${esc(st.name)}</span>
          <span class="store-pick-count tabular">${st.verifiedDealsCount}</span>
        </button>`),
    ].join('');
    storePickerEl.innerHTML = pickerHtml;
  }

  let liveFiltered = [...allLiveWithPrice];
  if (appState.homeSelectedStore !== 'all') {
    liveFiltered = liveFiltered.filter((x) => x.retailerId === appState.homeSelectedStore);
  }
  if (appState.homeDealsSearch.trim()) {
    const q = appState.homeDealsSearch.trim().toLowerCase();
    liveFiltered = liveFiltered.filter((x) =>
      `${x.title} ${x.brand || ''} ${x.modelNumber || ''} ${x.retailerName || ''}`.toLowerCase().includes(q)
    );
  }
  if (appState.homeDeals25Plus) {
    liveFiltered = liveFiltered.filter((x) => x.verifiedDiscountPct !== null && x.verifiedDiscountPct >= 25);
  }
  if (appState.homeDealsImgOnly) {
    liveFiltered = liveFiltered.filter((x) => Boolean(x.imageUrl));
  }

  if (appState.homeDealsSort === 'discount') {
    liveFiltered.sort((a, b) => (b.verifiedDiscountPct ?? -1) - (a.verifiedDiscountPct ?? -1) || (b.imageUrl ? 1 : 0) - (a.imageUrl ? 1 : 0));
  } else if (appState.homeDealsSort === 'price_asc') {
    liveFiltered.sort((a, b) => (a.currentPrice ?? 1e9) - (b.currentPrice ?? 1e9));
  } else if (appState.homeDealsSort === 'newest') {
    liveFiltered.sort((a, b) => Date.parse(b.publishedAt || b.verifiedAt || 0) - Date.parse(a.publishedAt || a.verifiedAt || 0));
  } else {
    // 'score': Put deals WITH product photos + direct links + real discounts first, spread across selected stores when 'all'
    liveFiltered.sort((a, b) => {
      const aVis = (a.imageUrl ? 18 : 0) + (a.isDirectProductUrl || a.isMerchantJumpUrl ? 12 : 0) + (a.decision?.score || 0);
      const bVis = (b.imageUrl ? 18 : 0) + (b.isDirectProductUrl || b.isMerchantJumpUrl ? 12 : 0) + (b.decision?.score || 0);
      return bVis - aVis;
    });
  }

  // When 'all' is selected and no search, interleave top deals across stores (max 3 per store in top view) so all major companies are visible at a glance
  let dealsToDisplay = liveFiltered;
  if (appState.homeSelectedStore === 'all' && !appState.homeDealsSearch.trim() && appState.homeDealsSort === 'score') {
    const interleaved = [];
    const seenIds = new Set();
    const byStore = new Map();
    for (const deal of liveFiltered) {
      const arr = byStore.get(deal.retailerId) || [];
      arr.push(deal);
      byStore.set(deal.retailerId, arr);
    }
    for (let round = 0; round < 4; round += 1) {
      for (const [, arr] of byStore) {
        if (arr[round] && !seenIds.has(arr[round].id)) {
          seenIds.add(arr[round].id);
          interleaved.push(arr[round]);
        }
      }
    }
    for (const deal of liveFiltered) {
      if (!seenIds.has(deal.id)) interleaved.push(deal);
    }
    dealsToDisplay = interleaved;
  }

  const mainGrid = $('home-main-deals-grid');
  const slicedDeals = dealsToDisplay.slice(0, appState.homeDealsLimit);
  if (slicedDeals.length) {
    mainGrid.innerHTML = slicedDeals.map((x) => renderProductCardHtml(x)).join('');
  } else {
    const pickedStore = mainStats.find((s) => s.id === appState.homeSelectedStore);
    mainGrid.innerHTML = `
      <div class="onboarding-box" style="grid-column:1/-1;">
        <h3>No live deals currently matched ${pickedStore ? `from ${esc(pickedStore.name)}` : 'for these filters'}</h3>
        <p>${pickedStore ? `Live feeds currently didn’t return an active post tagged to ${esc(pickedStore.name)}. You can open ${esc(pickedStore.name)} deals directly or clear the filter.` : 'Try clearing the search/filter or click Pull Latest Deals.'}</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          ${pickedStore ? `<a class="btn btn-primary btn-sm" href="${esc(pickedStore.dealsUrl)}" target="_blank" rel="noopener noreferrer">Open ${esc(pickedStore.name)} Deals ↗</a>` : ''}
          <button class="btn btn-sm" data-pick-store="all" type="button">Show All Main Stores</button>
        </div>
      </div>`;
  }
  const moreFooter = $('home-main-deals-footer');
  if (moreFooter) {
    moreFooter.hidden = dealsToDisplay.length <= appState.homeDealsLimit;
    if (!moreFooter.hidden && $('home-main-deals-more')) {
      $('home-main-deals-more').textContent = `Show More Deals (${slicedDeals.length} of ${dealsToDisplay.length}) ↓`;
    }
  }

  // ---- SECTION 2: WISH LISTS & UPLOADED DEALS BROWSER ----
  const combinedUploaded = [
    ...(d.savedDeals || []).map((sd) => ({ ...sd, _kind: 'deal' })),
    ...(d.wishlist || []).map((wl) => ({ ...wl, _kind: 'wishlist' })),
  ];

  const recipientCounts = new Map();
  for (const it of combinedUploaded) {
    const r = (it.recipient || '').trim() || 'Family';
    recipientCounts.set(r, (recipientCounts.get(r) || 0) + 1);
  }
  const recTabs = $('home-uploaded-recipient-tabs');
  if (recTabs) {
    if (!combinedUploaded.length) {
      recTabs.innerHTML = '';
    } else {
      recTabs.innerHTML = [
        `<button class="pill-tab ${appState.homeRecipient === 'all' ? 'is-active' : ''}" data-home-recip="all" type="button">All (${combinedUploaded.length})</button>`,
        ...[...recipientCounts.entries()].sort((a, b) => b[1] - a[1]).map(([rec, cnt]) =>
          `<button class="pill-tab ${appState.homeRecipient === rec ? 'is-active' : ''}" data-home-recip="${esc(rec)}" type="button">${esc(rec)} (${cnt})</button>`
        ),
      ].join('');
    }
  }

  if ($('home-uploaded-controls')) $('home-uploaded-controls').hidden = combinedUploaded.length === 0;

  // Populate store dropdown in Section 2
  const wlStoreSel = $('home-wl-store');
  if (wlStoreSel) {
    const storeMap = new Map();
    for (const it of combinedUploaded) {
      const sName = (it.retailerName || '').trim();
      if (sName) storeMap.set(sName, (storeMap.get(sName) || 0) + 1);
    }
    const prevVal = appState.homeWlStore;
    wlStoreSel.innerHTML = `<option value="all">All Stores (${storeMap.size})</option>` +
      [...storeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([sn, c]) => `<option value="${esc(sn)}">${esc(sn)} (${c})</option>`).join('');
    if ([...wlStoreSel.options].some((o) => o.value === prevVal)) wlStoreSel.value = prevVal;
  }

  let upFiltered = [...combinedUploaded];
  if (appState.homeRecipient !== 'all') {
    upFiltered = upFiltered.filter((it) => ((it.recipient || '').trim() || 'Family') === appState.homeRecipient);
  }
  if (appState.homeWlStore !== 'all') {
    upFiltered = upFiltered.filter((it) => (it.retailerName || '').trim() === appState.homeWlStore);
  }
  if (appState.homeWlSearch.trim()) {
    const q = appState.homeWlSearch.trim().toLowerCase();
    upFiltered = upFiltered.filter((it) => `${it.name} ${it.retailerName || ''} ${it.notes || ''} ${it.tier || ''}`.toLowerCase().includes(q));
  }
  if (appState.homeWlFilter === '25plus') {
    upFiltered = upFiltered.filter((it) => (it.verifiedDiscountPct ?? it.discountPct ?? 0) >= 25);
  } else if (appState.homeWlFilter === 'strong_medium') {
    upFiltered = upFiltered.filter((it) => /^(strong|medium)$/i.test(it.evidence || ''));
  } else if (appState.homeWlFilter === 'wishlist_only') {
    upFiltered = upFiltered.filter((it) => it._kind === 'wishlist');
  } else if (appState.homeWlFilter === 'deals_only') {
    upFiltered = upFiltered.filter((it) => it._kind === 'deal');
  }

  const getDisc = (it) => Number(it.verifiedDiscountPct ?? it.discountPct ?? -1);
  const getSave = (it) => Number(it.savingsAmount ?? -1);
  const getPrice = (it) => Number(it.currentPrice ?? it.preferredPrice ?? 1e9);

  if (appState.homeWlSort === 'discount') {
    upFiltered.sort((a, b) => getDisc(b) - getDisc(a) || getSave(b) - getSave(a));
  } else if (appState.homeWlSort === 'savings') {
    upFiltered.sort((a, b) => getSave(b) - getSave(a));
  } else if (appState.homeWlSort === 'price_asc') {
    upFiltered.sort((a, b) => getPrice(a) - getPrice(b));
  } else {
    upFiltered.sort((a, b) => Date.parse(b.uploadedAt || b.createdAt || 0) - Date.parse(a.uploadedAt || a.createdAt || 0));
  }

  const upSummary = $('home-uploaded-summary');
  const upGrid = $('home-uploaded-items-grid');
  const upFooter = $('home-uploaded-footer');
  if (!combinedUploaded.length) {
    if (upSummary) upSummary.textContent = '';
    if (upGrid) {
      upGrid.innerHTML = `
        <div class="onboarding-box" style="grid-column:1/-1;">
          <h3>No Wish Lists or Uploaded Deals Yet</h3>
          <p>Click <strong>+ ADD WISH LIST</strong> or <strong>+ UPLOAD DEALS</strong> above to upload your Excel (.xlsx/.xls), CSV, PDF, Word docs, screenshots, emails, or product links. All rows will appear right here cleanly organized by family member, store, discount %, and working shopping links.</p>
        </div>`;
    }
    if (upFooter) upFooter.hidden = true;
  } else {
    const slicedUp = upFiltered.slice(0, appState.homeWlLimit);
    if (upSummary) {
      upSummary.textContent = `Showing ${slicedUp.length} of ${upFiltered.length} uploaded items (${combinedUploaded.length} total saved across family lists)`;
    }
    if (upGrid) {
      upGrid.innerHTML = slicedUp.map((it) => renderUploadedItemCardHtml(it)).join('') ||
        '<div class="small muted" style="grid-column:1/-1;">No uploaded items match your current filter.</div>';
    }
    if (upFooter) {
      upFooter.hidden = upFiltered.length <= appState.homeWlLimit;
      if (!upFooter.hidden && $('home-uploaded-more')) {
        $('home-uploaded-more').textContent = `Show More Uploaded Items (${slicedUp.length} of ${upFiltered.length}) ↓`;
      }
    }
  }

  // Live Retailer Matches & Alternatives for Wish Lists (inside Section 2)
  const p = d.personalized || { hasPreferences: false, tier1Exact: [], tier2Alternatives: [] };
  const t1Host = $('home-tier1-wishlist');
  if (t1Host) {
    if (!combinedUploaded.length) {
      t1Host.innerHTML = '';
    } else if (p.tier1Exact.length) {
      t1Host.innerHTML = `<div class="deals-grid">${p.tier1Exact.slice(0, 9).map((rec) => renderProductCardHtml(rec.deal, rec)).join('')}</div>`;
    } else {
      t1Host.innerHTML = `
        <div class="small muted">
          Monitoring ${esc(d.wishlist.length)} wish-list items + ${esc(d.savedDeals?.length || 0)} uploaded deals against live store feeds.
          <button class="btn btn-sm" id="home-recheck-now" type="button" style="margin-left:8px;">↻ Run Live Check Now</button>
        </div>`;
    }
  }

  const t2Host = $('home-tier2-alternatives');
  if (t2Host) {
    if (p.tier2Alternatives?.length) {
      t2Host.innerHTML = `
        <div class="section-kicker" style="margin-bottom:8px;">Closer &amp; Better-Value Alternatives Found</div>
        <div class="deals-grid">${p.tier2Alternatives.slice(0, 6).map((rec) => renderProductCardHtml(rec.deal, rec)).join('')}</div>`;
    } else {
      t2Host.innerHTML = '';
    }
  }

  // ---- SECTION 3: SEPARATE SECTION — ALL STORES & MAIN BLACK FRIDAY DEALS ----
  const q = appState.homeStoreQuery.trim().toLowerCase();
  const storesToShow = q
    ? d.storesDirectory.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
    : (d.favoriteStores.length ? d.favoriteStores : d.storesDirectory.slice(0, 20));

  $('home-favorite-stores-rail').innerHTML = storesToShow.map((st) => `
    <a class="store-logo-tile" href="${esc(st.blackFridayUrl || st.dealsUrl || st.url)}" target="_blank" rel="noopener noreferrer" data-store-id="${esc(st.id)}" title="Open ${esc(st.name)} deals in a new browser tab">
      ${renderStoreAvatar(st, false)}
      <span class="store-tile-name">${esc(st.name)}</span>
      <span class="small muted" style="font-size:10px;">${st.verifiedDealsCount > 0 ? `${st.verifiedDealsCount} ${st.verifiedDealsCount === 1 ? 'deal' : 'deals'}` : 'Shop ↗'}</span>
    </a>`).join('') || '<div class="small muted" style="padding:12px;">No favorite stores match that search — click Browse All 96 Stores above.</div>';

  const bfHighlightIds = ['amazon', 'target', 'walmart', 'bestbuy', 'homedepot', 'lowes', 'macys', 'kohls', 'nike', 'sephora', 'ulta', 'lego'];
  const bfStores = bfHighlightIds.map((id) => d.storesDirectory.find((s) => s.id === id)).filter(Boolean);
  $('home-bf-store-sales').innerHTML = bfStores.map((s) => `
    <div class="store-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--text-primary);">
          ${renderStoreAvatar(s, true)}
          <strong>${esc(s.name)}</strong>
        </a>
        <span class="badge badge-bf">${s.hasDedicatedBlackFridayUrl ? 'Black Friday' : 'Deals Page'}</span>
      </div>
      <div class="small muted">${s.verifiedDealsCount > 0 ? `${s.verifiedDealsCount} live deals tracked` : 'Direct official retailer sale page'}${s.cashback ? ` · Up to ${s.cashback.percent}% CB` : ''}</div>
      <div class="store-links">
        <a class="btn btn-sm btn-primary" href="${esc(s.blackFridayUrl)}" target="_blank" rel="noopener noreferrer">${s.hasDedicatedBlackFridayUrl ? 'Black Friday Sale ↗' : 'Shop Deals ↗'}</a>
        <a class="btn btn-sm" href="${esc(s.dealsUrl)}" target="_blank" rel="noopener noreferrer">Clearance / Deals ↗</a>
      </div>
    </div>`).join('');

  $('home-local-stores').innerHTML = d.localStores.slice(0, 8).map((st) => {
    const storeMeta = getStoreMeta(st.retailerId);
    return `
      <div class="store-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="display:inline-flex;align-items:center;gap:8px;">
            ${renderStoreAvatar(storeMeta || { name: st.retailerName }, true)}
            <strong>${esc(st.branchName)}</strong>
          </span>
          <span class="badge badge-local tabular">${esc(st.distanceMiles)} mi</span>
        </div>
        <div class="small muted">${esc(st.address)}</div>
        <div class="store-links">
          <a class="btn btn-sm btn-primary" href="${esc(st.storeUrl)}" target="_blank" rel="noopener noreferrer">Local Store ↗</a>
          <a class="btn btn-sm" href="${esc(st.clearanceUrl)}" target="_blank" rel="noopener noreferrer">Deals ↗</a>
        </div>
      </div>`;
  }).join('');

  const m = d.kpis.monitoringStatus;
  const persist = d.persistence || {};
  $('home-monitoring-status').innerHTML = `
    <div class="health-grid" style="margin-bottom:12px;">
      <div class="health-item status-ok">
        <strong>Products Monitored</strong>
        <div class="small muted tabular">${esc(d.kpis.wishlistTotalCount)} wish-list items · ${esc(d.kpis.savedDealsCount)} uploaded deals · ${esc(d.kpis.uploadedFilesCount)} files preserved</div>
      </div>
      <div class="health-item ${m.failed > 0 ? 'status-error' : 'status-ok'}">
        <strong>Authorized Feed Health</strong>
        <div class="small muted tabular">${esc(m.healthy)} OK · ${esc(m.failed)} Error/Blocked · ${esc(m.apiKeyRequired)} Optional API Keys Needed</div>
      </div>
      <div class="health-item status-ok">
        <strong>Background Monitoring</strong>
        <div class="small muted tabular">Last: ${esc(timeAgo(d.kpis.lastSuccessfulUpdate))} · Next: ${esc(formatClock(d.kpis.nextScheduledUpdate))}</div>
      </div>
      <div class="health-item ${persist.survivesRedeploys ? 'status-ok' : 'status-api_key_required'}">
        <strong>Persistence Mode</strong>
        <div class="small muted">${esc(persist.mode?.replace(/_/g, ' ') || 'local disk')}</div>
      </div>
    </div>
    <div class="health-grid">${d.sourceHealth.slice(0, 8).map((s) => `
      <div class="health-item status-${esc(s.status)}">
        <div style="display:flex;justify-content:space-between;gap:6px;">
          <strong>${esc(s.name)}</strong>
          <span class="badge ${s.status === 'ok' ? 'badge-exceptional' : s.status === 'api_key_required' ? 'badge-good' : 'badge-danger'}">${esc(s.status.replace(/_/g, ' '))}</span>
        </div>
        <div class="muted tabular">${s.status === 'ok' ? `${s.dealsParsed} offers · ${timeAgo(s.lastSuccessAt)}` : esc(s.lastError || `HTTP ${s.httpStatus || 'N/A'}`)}</div>
      </div>`).join('')}
    </div>`;

  attachImageFallbacks($('view-command-center'));
}

/* ==================== 2. REAL UPLOAD CENTER (PRIORITY 2) ==================== */
function renderUploadCenter() {
  const d = appState.data;
  if (!d) return;

  document.querySelectorAll('#upload-type-toggle .pill-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.utype === appState.uploadType));
  document.querySelectorAll('#upload-mode-tabs .pill-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.umode === appState.uploadMode));

  const profileOpts = (d.profiles || []).map((p) => `<option value="${esc(p.id)}">${esc(p.icon || '👤')} ${esc(p.name)}</option>`).join('');
  const stage = $('upload-input-stage');
  const isDeal = appState.uploadType === 'deal';

  if (appState.uploadMode === 'file') {
    stage.innerHTML = `
      <form id="uc-file-form" class="intake-grid">
        <div class="field span-3">
          <div id="uc-dropzone" class="dropzone">
            <label for="uc-file-input" style="display:block;cursor:pointer;font-weight:750;margin-bottom:6px;">
              Drop or Choose One or Multiple Files — Excel (.xlsx, .xls), CSV, TSV, PDF, Word (.docx/.doc), RTF, Text, HTML, JSON, or Screenshots
            </label>
            <input id="uc-file-input" type="file" multiple accept=".xlsx,.xls,.csv,.tsv,.pdf,.docx,.doc,.rtf,.txt,.html,.htm,.json,image/*" required />
          </div>
        </div>
        <div class="field"><label for="uc-profile">Default Family Profile</label><select id="uc-profile">${profileOpts}</select></div>
        <div class="field"><label for="uc-recipient">Recipient (if not in file)</label><input id="uc-recipient" type="text" placeholder="e.g. Mom, Kids" /></div>
        <div class="field"><label for="uc-priority">Monitoring Priority</label>
          <select id="uc-priority"><option value="high">High (15 min)</option><option value="standard" selected>Standard</option><option value="low">Low</option></select>
        </div>
        <div class="field span-3" id="uc-screenshot-notes-wrap" style="display:none;">
          <label for="uc-ocr-text">Screenshot Text / Deal Notes (e.g. "Sony WH-1000XM5 $249.99 at Best Buy" — optional, you can also edit in the preview table)</label>
          <textarea id="uc-ocr-text" rows="2" placeholder="Optional: paste or type product name, retailer, price, or URL shown in the screenshot"></textarea>
          <div id="uc-img-preview" style="margin-top:8px;"></div>
        </div>
        <div class="field span-3" style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit">🔍 Extract &amp; Preview ${isDeal ? 'Deals' : 'Wish-List Products'}</button>
        </div>
      </form>`;
  } else if (appState.uploadMode === 'bulk') {
    stage.innerHTML = `
      <form id="uc-bulk-form" class="intake-grid">
        <div class="field span-3">
          <label for="uc-bulk-text">Paste Copied List, Email, or Spreadsheet Rows (one item per line — extracts product, brand, model, price, retailer &amp; URL)</label>
          <textarea id="uc-bulk-text" rows="6" required placeholder="JBL Clip 5 Bluetooth Speaker $50 Amazon https://www.amazon.com/dp/B0...&#10;Nike Air Pegasus 41 Size 10 Black target $95 for Dad [high]&#10;LEGO Star Wars Millennium Falcon 75375 under $65 for Kids"></textarea>
        </div>
        <div class="field"><label for="uc-bulk-profile">Family Profile</label><select id="uc-bulk-profile">${profileOpts}</select></div>
        <div class="field"><label for="uc-bulk-recipient">Default Recipient</label><input id="uc-bulk-recipient" type="text" placeholder="Optional" /></div>
        <div class="field" style="display:flex;align-items:flex-end;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit" style="width:100%;">🔍 Extract &amp; Preview</button>
        </div>
      </form>`;
  } else if (appState.uploadMode === 'urls') {
    stage.innerHTML = `
      <form id="uc-urls-form" class="intake-grid">
        <div class="field span-3">
          <label for="uc-urls-text">Paste One or Multiple Product URLs (one URL per line — inspects each link live)</label>
          <textarea id="uc-urls-text" rows="5" required placeholder="https://www.amazon.com/dp/B09XS7JWHH&#10;https://www.target.com/p/...&#10;https://www.bestbuy.com/site/..."></textarea>
        </div>
        <div class="field"><label for="uc-urls-profile">Family Profile</label><select id="uc-urls-profile">${profileOpts}</select></div>
        <div class="field"><label for="uc-urls-recipient">Default Recipient</label><input id="uc-urls-recipient" type="text" placeholder="Optional" /></div>
        <div class="field" style="display:flex;align-items:flex-end;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit" style="width:100%;">🔍 Inspect URLs &amp; Preview</button>
        </div>
      </form>`;
  } else {
    stage.innerHTML = `
      <form id="uc-manual-form" class="intake-grid">
        <div class="field span-2"><label for="uc-m-name">Product Name *</label><input id="uc-m-name" type="text" required placeholder="e.g. Dyson V15 Detect Cordless Vacuum" /></div>
        <div class="field"><label for="uc-m-profile">Family Profile</label><select id="uc-m-profile">${profileOpts}</select></div>
        <div class="field"><label for="uc-m-brand">Brand</label><input id="uc-m-brand" type="text" placeholder="Auto-detected if blank" /></div>
        <div class="field"><label for="uc-m-model">Model / SKU</label><input id="uc-m-model" type="text" placeholder="Optional" /></div>
        <div class="field"><label for="uc-m-retailer">Retailer</label><input id="uc-m-retailer" type="text" placeholder="e.g. Target, Amazon, Nike" /></div>
        <div class="field"><label for="uc-m-size">Size / Capacity</label><input id="uc-m-size" type="text" placeholder="e.g. Size M, 10.5, 256GB" /></div>
        <div class="field"><label for="uc-m-color">Color</label><input id="uc-m-color" type="text" placeholder="e.g. Black, Midnight" /></div>
        <div class="field"><label for="uc-m-price">${isDeal ? 'Deal Price ($) *' : 'Target Price ($)'}</label><input id="uc-m-price" type="number" step="0.01" ${isDeal ? 'required' : ''} placeholder="e.g. 149.99" /></div>
        <div class="field span-2"><label for="uc-m-url">Product URL</label><input id="uc-m-url" type="url" placeholder="https://..." /></div>
        <div class="field"><label for="uc-m-recipient">Recipient</label><input id="uc-m-recipient" type="text" placeholder="Who is this for?" /></div>
        <div class="field span-3" style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit">✓ Preview &amp; Save ${isDeal ? 'Deal' : 'Wish-List Item'}</button>
        </div>
      </form>`;
  }

  renderUploadPreviewPanel();
  renderUploadedFilesVault();
}

function syncDomEditsIntoPreview() {
  const prev = appState.uploadPreview;
  if (!prev) return [];
  const rows = [...document.querySelectorAll('#upload-preview-table-host tbody tr[data-pidx]')];
  for (const tr of rows) {
    const idx = Number(tr.dataset.pidx);
    const base = prev.items[idx];
    if (!base) continue;
    base.selected = tr.querySelector('.pv-sel')?.checked ?? base.selected;
    base.name = tr.querySelector('.pv-name')?.value?.trim() || base.name;
    base.brand = tr.querySelector('.pv-brand')?.value?.trim() || '';
    base.modelNumber = tr.querySelector('.pv-model')?.value?.trim() || '';
    base.size = tr.querySelector('.pv-size')?.value?.trim() || '';
    base.color = tr.querySelector('.pv-color')?.value?.trim() || '';
    const pRaw = tr.querySelector('.pv-price')?.value;
    base.price = pRaw ? Number(pRaw) : null;
    base.retailerName = tr.querySelector('.pv-retailer')?.value?.trim() || '';
    base.url = tr.querySelector('.pv-url')?.value?.trim() || '';
    base.recipient = tr.querySelector('.pv-recip')?.value?.trim() || base.recipient || '';
    base.profileId = tr.querySelector('.pv-profile')?.value || base.profileId || 'family-main';
  }
  return prev.items;
}

function renderUploadPreviewPanel() {
  const panel = $('upload-preview-panel');
  const prev = appState.uploadPreview;
  if (!prev) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const isDeal = prev.uploadType === 'deal';
  const selectedTotal = prev.items.filter((i) => i.selected && (i.name || i.url)).length;
  $('upload-preview-kicker').textContent = `${isDeal ? 'SAVING AS UPLOADED DEALS' : 'SAVING AS WISH LIST ITEMS'} · ${prev.items.length} Unique Extracted${prev.intraFileDuplicatesRemoved ? ` (${prev.intraFileDuplicatesRemoved} intra-file duplicates merged)` : ''} · ${selectedTotal} Selected · ${prev.duplicatesCount || 0} Already Saved`;
  $('upload-preview-title').textContent = `Preview & Approve Before Saving${prev.filename ? ` (${prev.filename})` : ''}`;

  const warn = $('upload-preview-warning');
  if (prev.parseWarning) {
    warn.hidden = false;
    warn.textContent = prev.parseWarning;
  } else {
    warn.hidden = true;
  }

  const pq = appState.previewQuery.trim().toLowerCase();
  const filteredIndices = [];
  for (let i = 0; i < prev.items.length; i += 1) {
    const it = prev.items[i];
    if (!pq || `${it.name} ${it.retailerName} ${it.recipient} ${it.notes}`.toLowerCase().includes(pq)) {
      filteredIndices.push(i);
    }
  }
  const pageSize = appState.previewPageSize || 50;
  const totalPages = Math.max(1, Math.ceil(filteredIndices.length / pageSize));
  if (appState.previewPage >= totalPages) appState.previewPage = totalPages - 1;
  const start = appState.previewPage * pageSize;
  const pageIndices = filteredIndices.slice(start, start + pageSize);

  const toolbarEl = $('upload-preview-toolbar');
  if (toolbarEl) {
    toolbarEl.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="pv-search-input" type="search" value="${esc(appState.previewQuery)}" placeholder="Filter preview rows…" style="width:210px;" />
        <button class="btn btn-sm" id="pv-select-all-btn" type="button">✓ Select All (${prev.items.length})</button>
        <button class="btn btn-sm" id="pv-deselect-all-btn" type="button">Clear Selection</button>
        <button class="btn btn-sm ${prev.suggestedUploadType === 'deal' && !isDeal ? 'btn-gold' : ''}" id="pv-switch-type-btn" type="button">
          ${isDeal ? 'Save as Wish List Instead' : '🏷️ Save as Discovered Deals Instead'}
        </button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;" class="small tabular">
        <button class="btn btn-sm" id="pv-prev-page" type="button" ${appState.previewPage <= 0 ? 'disabled' : ''}>← Prev</button>
        <span>Page ${appState.previewPage + 1} / ${totalPages} (${filteredIndices.length} rows)</span>
        <button class="btn btn-sm" id="pv-next-page" type="button" ${appState.previewPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
      </div>`;
  }

  const profileOpts = (appState.data?.profiles || []).map((p) => ({ id: p.id, label: `${p.icon || '👤'} ${p.name}` }));
  $('upload-preview-table-host').innerHTML = `
    <table class="data-table preview-table">
      <thead>
        <tr>
          <th>Keep</th>
          <th>Product Name</th>
          <th>Recipient / Tier</th>
          <th>Sale $ / Reg $</th>
          <th>Discount</th>
          <th>Store</th>
          <th>Product URL</th>
          <th>Profile</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${pageIndices.map((idx) => {
        const it = prev.items[idx];
        return `
        <tr class="${it.needsReview ? 'preview-row-warn' : ''} ${it.isDuplicate ? 'preview-row-dup' : ''}" data-pidx="${idx}">
          <td><input type="checkbox" class="pv-sel" ${it.selected ? 'checked' : ''} style="width:auto;" /></td>
          <td>
            <input type="text" class="pv-name" value="${esc(it.name)}" style="min-width:210px;margin-bottom:4px;" />
            <div style="display:flex;gap:4px;">
              <input type="text" class="pv-brand" value="${esc(it.brand || '')}" placeholder="Brand" style="min-width:85px;" />
              <input type="text" class="pv-model" value="${esc(it.modelNumber || '')}" placeholder="Model" style="min-width:85px;" />
              <input type="text" class="pv-size" value="${esc(it.size || '')}" placeholder="Size" style="min-width:55px;" />
              <input type="text" class="pv-color" value="${esc(it.color || '')}" placeholder="Color" style="min-width:55px;" />
            </div>
          </td>
          <td>
            <input type="text" class="pv-recip" value="${esc(it.recipient || '')}" placeholder="For whom" style="min-width:95px;margin-bottom:4px;" />
            <div class="small muted">${esc(it.tier || '')}</div>
          </td>
          <td class="tabular">
            <input type="number" step="0.01" class="pv-price" value="${it.price ?? ''}" placeholder="Sale $" style="width:88px;" />
            ${it.originalPrice != null ? `<div class="small muted">Reg ${money(it.originalPrice)}</div>` : ''}
          </td>
          <td class="small tabular">
            ${it.discountPct != null ? `<span class="badge badge-exceptional">${it.discountPct}% OFF</span>` : '<span class="muted">—</span>'}
            ${it.evidence ? `<div class="muted">${esc(it.evidence)}</div>` : ''}
          </td>
          <td><input type="text" class="pv-retailer" value="${esc(it.retailerName || '')}" placeholder="Store" style="min-width:115px;" /></td>
          <td>
            <input type="text" class="pv-url" value="${esc(it.url || '')}" placeholder="${it.storeSearchUrl ? 'Optional link (Store search ready)' : 'https://...'}" style="min-width:155px;" />
          </td>
          <td>
            <select class="pv-profile" style="min-width:120px;">
              ${profileOpts.map((po) => `<option value="${esc(po.id)}" ${it.profileId === po.id ? 'selected' : ''}>${esc(po.label)}</option>`).join('')}
            </select>
          </td>
          <td class="small">
            ${it.isDuplicate ? `<span class="badge badge-danger" title="${esc(it.duplicateReason || '')}">Duplicate</span>` : ''}
            ${it.needsReview ? `<span class="badge badge-good" title="${esc(it.reviewReason || '')}">Check</span><div class="muted" style="font-size:10.5px;">${esc(it.reviewReason || '')}</div>` : (!it.isDuplicate ? '<span class="badge badge-exceptional">Ready</span>' : '')}
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}

function collectPreviewItemsFromDom() {
  return syncDomEditsIntoPreview();
}

function renderUploadedFilesVault() {
  const files = appState.data?.uploadedFiles || [];
  const host = $('uploaded-files-vault');
  if (!files.length) {
    host.innerHTML = '<div class="small muted">No files uploaded yet. Every Excel sheet, CSV, PDF, Word doc, screenshot, or text list you upload is preserved here permanently.</div>';
    return;
  }
  host.innerHTML = `
    <table class="data-table">
      <thead><tr><th>File Name</th><th>Type</th><th>Extracted</th><th>Size</th><th>Uploaded</th><th>Notes / Action</th></tr></thead>
      <tbody>${files.map((f) => `
        <tr>
          <td><strong>${esc(f.filename)}</strong></td>
          <td><span class="badge ${f.uploadType === 'deal' ? 'badge-good' : 'badge-great'}">${esc(f.uploadType)}</span></td>
          <td class="tabular">${esc(f.extractedCount)} items</td>
          <td class="tabular small muted">${Math.max(1, Math.round((f.sizeBytes || 0) / 1024))} KB</td>
          <td class="small tabular">${esc(formatClock(f.uploadedAt))}</td>
          <td>
            ${f.parseWarning ? `<div class="small" style="color:var(--accent-gold);margin-bottom:4px;">${esc(f.parseWarning)}</div>` : ''}
            <a class="btn btn-sm" href="/api/black-friday/uploads/${encodeURIComponent(f.id)}" target="_blank" rel="noopener noreferrer">Open Original ↗</a>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ==================== 3. WISH LISTS & USER-SAVED DEALS ==================== */
function renderWishlistsView() {
  const d = appState.data;
  if (!d) return;

  const profiles = d.profiles || [];
  $('profile-tabs').innerHTML = [
    `<button class="pill-tab ${appState.selectedProfileId === 'all' ? 'is-active' : ''}" data-profile="all" type="button">All Family Lists (${d.wishlist.length})</button>`,
    ...profiles.map((p) => {
      const cnt = d.wishlist.filter((w) => w.profileId === p.id).length;
      return `<button class="pill-tab ${appState.selectedProfileId === p.id ? 'is-active' : ''}" data-profile="${esc(p.id)}" type="button">${esc(p.icon || '👤')} ${esc(p.name)} (${cnt})</button>`;
    }),
  ].join('');

  let items = [...d.wishlist];
  if (appState.selectedProfileId !== 'all') items = items.filter((w) => w.profileId === appState.selectedProfileId);
  if (appState.wishlistStatusFilter !== 'all') items = items.filter((w) => w.status === appState.wishlistStatusFilter);

  const container = $('wishlist-container');
  if (!items.length) {
    container.innerHTML = `<div class="onboarding-box"><h3>No wish-list products here yet</h3><p>Click "+ Upload Wish List" to import Excel, CSV, PDF, Word, screenshots, URLs, or type products.</p><button class="btn btn-primary" data-open-upload="wishlist" type="button">+ Add Wish List</button></div>`;
  } else {
    container.innerHTML = items.map((item) => {
      const thumb = item.bestOffer?.imageUrl || item.imageUrl || item.screenshotThumbnail;
      const best = item.bestOffer;
      return `
        <article class="wishlist-card" data-wl-id="${esc(item.id)}">
          <div class="wishlist-thumb">
            ${thumb ? `<img src="${esc(thumb)}" alt="${esc(item.name)}" loading="lazy" />` : `<span style="font-size:28px;">${CAT_ICONS[item.category] || '🎁'}</span>`}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <strong style="font-size:15.5px;">${esc(item.name)}</strong>
              <span class="badge ${item.priority === 'high' ? 'badge-danger' : 'badge-great'}">${esc(item.priority)}</span>
              ${item.recipient ? `<span class="badge badge-watch">For: ${esc(item.recipient)}</span>` : ''}
            </div>
            <div class="small muted" style="margin-bottom:6px;">
              ${esc([item.brand, item.modelNumber ? `Model: ${item.modelNumber}` : null, item.size, item.color, item.retailerName].filter(Boolean).join(' · '))}
            </div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;margin-bottom:8px;" class="tabular">
              <span>Target: <strong>${money(item.preferredPrice)}</strong></span>
              <span>Max: <strong>${money(item.maxPrice)}</strong></span>
              <span>Live Matches: <strong>${esc(item.matchedOffersCount)}</strong></span>
              <span>Last Checked: <strong>${esc(timeAgo(item.lastCheckedAt))}</strong></span>
            </div>
            ${best ? `
              <div class="deal-why" style="margin-bottom:8px;">
                <strong>Best Verified Match:</strong> ${money(best.currentPrice)} (Est. ${money(best.finalAllInTotal)} all-in) at <strong>${esc(best.retailerName)}</strong>
                ${best.verifiedDiscountPct != null ? ` · <span class="badge badge-${esc(best.tier)}">${best.verifiedDiscountPct}% OFF</span>` : ''}
                · <a href="${esc(best.retailerUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);font-weight:800;">${best.isDirectProductUrl ? 'SHOP NOW ↗' : 'View Deal ↗'}</a>
              </div>` : `<div class="small muted" style="margin-bottom:8px;">Monitoring continuously across authorized feeds${item.sourceUrl ? ` · <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);">Open Saved Product Link ↗</a>` : ''}</div>`}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">
              <label class="small muted">Move to profile:</label>
              <select class="wl-move-select" data-wl-id="${esc(item.id)}" style="width:auto;padding:4px 8px;font-size:12px;">
                ${profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === item.profileId ? 'selected' : ''}>${esc(p.icon || '👤')} ${esc(p.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="wishlist-card-actions" style="display:flex;flex-direction:column;gap:6px;min-width:155px;">
            <select class="wl-status-select" data-wl-id="${esc(item.id)}" aria-label="Item status">
              ${['wanted', 'monitoring', 'deal_found', 'purchased', 'no_longer_interested'].map((st) => `<option value="${st}" ${item.status === st ? 'selected' : ''}>${st.replace(/_/g, ' ')}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-primary" data-wl-search="${esc(item.id)}" type="button">🔍 Check Prices Now</button>
            <button class="btn btn-sm" data-wl-alts="${esc(item.id)}" type="button">💡 Alternatives</button>
            <button class="btn btn-sm" data-action="history" data-key="${esc(best?.canonicalKey || item.canonicalKey)}" type="button">📈 History (${esc(item.historyCount)})</button>
            <button class="btn btn-sm btn-danger" data-wl-delete="${esc(item.id)}" type="button">Remove</button>
          </div>
        </article>`;
    }).join('');
  }

  // Render User-Uploaded Saved Deals (UPLOAD DEALS)
  const sdHost = $('saved-deals-container');
  const savedDeals = d.savedDeals || [];
  if (!savedDeals.length) {
    sdHost.innerHTML = '<div class="small muted">No uploaded deals saved yet. Use <strong>+ UPLOAD DEALS</strong> to save screenshots, links, or lists of deals you discover yourself — we preserve the original retailer, price, URL, and date forever.</div>';
  } else {
    sdHost.innerHTML = savedDeals.map((sd) => {
      const changed = sd.originalUploadedPrice != null && sd.currentPrice != null && sd.currentPrice !== sd.originalUploadedPrice;
      const storeMeta = getStoreMeta(sd.retailerId);
      return `
        <article class="wishlist-card">
          <div class="wishlist-thumb">
            ${sd.imageUrl || sd.screenshotThumbnail ? `<img src="${esc(sd.imageUrl || sd.screenshotThumbnail)}" alt="${esc(sd.name)}" loading="lazy" />` : `<span style="font-size:26px;">🏷️</span>`}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              ${renderStoreAvatar(storeMeta || { name: sd.retailerName }, true)}
              <strong>${esc(sd.name)}</strong>
              <span class="badge badge-good">${esc(sd.retailerName || 'Saved Deal')}</span>
            </div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin:6px 0;" class="tabular">
              <span>Current Price: <strong style="color:var(--accent-emerald);">${money(sd.currentPrice)}</strong></span>
              <span>Original Uploaded: <strong>${money(sd.originalUploadedPrice)}</strong> (${esc(formatClock(sd.uploadedAt))})</span>
              ${changed ? `<span class="badge badge-great">Price Changed — History Preserved (${sd.priceHistory?.length || 1} pts)</span>` : ''}
            </div>
            ${sd.notes ? `<div class="small muted">${esc(sd.notes)}</div>` : ''}
          </div>
          <div class="wishlist-card-actions" style="display:flex;flex-direction:column;gap:6px;min-width:140px;">
            ${sd.url ? `<a class="btn btn-sm btn-primary" href="${esc(sd.url)}" target="_blank" rel="noopener noreferrer">SHOP NOW ↗</a>` : ''}
            ${sd.uploadFileId ? `<a class="btn btn-sm" href="/api/black-friday/uploads/${encodeURIComponent(sd.uploadFileId)}" target="_blank" rel="noopener noreferrer">Original File ↗</a>` : ''}
            <button class="btn btn-sm btn-danger" data-sd-delete="${esc(sd.id)}" type="button">Delete</button>
          </div>
        </article>`;
    }).join('');
    attachLogoFallbacks(sdHost);
  }
}

/* ==================== 4. FAMILY SHOPPING PROFILES (PRIORITY 4) ==================== */
function renderProfilesView() {
  const d = appState.data;
  if (!d) return;

  $('profiles-grid').innerHTML = (d.profiles || []).map((prof) => {
    const items = d.wishlist.filter((w) => w.profileId === prof.id);
    const bought = items.filter((w) => w.status === 'purchased');
    return `
      <div class="profile-card" data-prof-id="${esc(prof.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="font-size:17px;font-weight:800;">${esc(prof.icon || '👤')} ${esc(prof.name)}</div>
          <span class="badge badge-great tabular">Budget: ${money(prof.budget)}</span>
        </div>
        <div class="small muted">${esc(items.length)} wish-list items · ${esc(bought.length)} purchased</div>

        <div class="field"><label>Favorite Brands (comma-separated)</label><input type="text" class="pf-brands" value="${esc((prof.favoriteBrands || []).join(', '))}" placeholder="e.g. Nike, Apple, Lululemon" /></div>
        <div class="field"><label>Interests &amp; Hobbies (comma-separated)</label><input type="text" class="pf-interests" value="${esc((prof.interests || []).join(', '))}" placeholder="e.g. golf, espresso, LEGO, skincare" /></div>
        <div class="field"><label>Clothing / Shoe Sizes</label><input type="text" class="pf-sizes" value="${esc(prof.clothingSizes || '')}" placeholder="e.g. Shirt L, Shoes 10.5" /></div>
        <div class="field"><label>Preferred Retailers (comma-separated)</label><input type="text" class="pf-retailers" value="${esc((prof.preferredRetailers || []).join(', '))}" placeholder="e.g. target, nike, sephora" /></div>
        <div class="field"><label>Gift Budget ($)</label><input type="number" class="pf-budget" value="${esc(prof.budget || 300)}" min="1" /></div>
        <div class="field"><label>Saved Ideas (comma-separated)</label><input type="text" class="pf-ideas" value="${esc((prof.savedIdeas || []).join(', '))}" placeholder="Gift notes or ideas" /></div>

        ${prof.dislikedProducts?.length ? `<div class="small muted"><strong>Disliked Products:</strong> ${esc(prof.dislikedProducts.join(', '))}</div>` : ''}
        <div style="display:flex;gap:8px;justify-content:space-between;margin-top:4px;">
          <button class="btn btn-sm btn-primary" data-save-profile="${esc(prof.id)}" type="button">Save Profile</button>
          ${prof.id !== 'family-main' ? `<button class="btn btn-sm btn-danger" data-del-profile="${esc(prof.id)}" type="button">Delete</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ==================== 5. PERMANENT SHOP ALL STORES DIRECTORY (PRIORITY 1) ==================== */
function renderAllStoresView() {
  const d = appState.data;
  if (!d) return;

  const categories = [...new Set(d.storesDirectory.map((s) => s.category))];
  const catSel = $('stores-category-filter');
  catSel.innerHTML = '<option value="all">All 9 Categories (' + d.storesDirectory.length + ')</option>' +
    categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  catSel.value = appState.storeFilters.category;
  $('stores-search').value = appState.storeFilters.q;
  $('stores-fav-only').checked = appState.storeFilters.favOnly;

  let list = [...d.storesDirectory];
  if (appState.storeFilters.q.trim()) {
    const q = appState.storeFilters.q.trim().toLowerCase();
    list = list.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q));
  }
  if (appState.storeFilters.category !== 'all') list = list.filter((s) => s.category === appState.storeFilters.category);
  if (appState.storeFilters.favOnly) list = list.filter((s) => s.isFavorite);

  const grouped = new Map();
  for (const s of list) {
    const arr = grouped.get(s.category) || [];
    arr.push(s);
    grouped.set(s.category, arr);
  }

  const linkBadge = (lv) => {
    if (!lv || lv.status === 'unverified') return '<span class="badge badge-unverified">Link Unverified</span>';
    if (lv.status === 'verified') return '<span class="badge badge-exceptional">✓ Link Verified</span>';
    if (lv.status === 'bot_protected') return '<span class="badge badge-great" title="Retailer blocks automated bots — opens normally in your browser">Browser Direct</span>';
    return `<span class="badge badge-danger">Check URL (${esc(lv.httpStatus || 'err')})</span>`;
  };

  $('all-stores-container').innerHTML = [...grouped.entries()].map(([cat, stores]) => `
    <div style="margin-bottom:22px;">
      <h3 style="margin:0 0 10px;font-size:15.5px;color:var(--accent-cyan);">${esc(cat)} (${stores.length})</h3>
      <div class="stores-grid">${stores.map((s) => `
        <div class="store-card" data-store-id="${esc(s.id)}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <a href="${esc(s.blackFridayUrl || s.dealsUrl || s.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:var(--text-primary);min-width:0;" aria-label="Open ${esc(s.name)} deals on the retailer website">
              ${renderStoreAvatar(s, false)}
              <div style="min-width:0;">
                <strong style="display:block;font-size:14.5px;">${esc(s.name)}</strong>
                <span class="small muted">${esc(s.domain)}</span>
              </div>
            </a>
            <button class="store-fav-star ${s.isFavorite ? 'is-fav' : ''}" data-toggle-fav="${esc(s.id)}" type="button" title="Toggle favorite store" aria-label="Favorite ${esc(s.name)}">${s.isFavorite ? '★' : '☆'}</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            ${linkBadge(s.linkVerification)}
            ${s.verifiedDealsCount > 0 ? `<span class="badge badge-good tabular">${s.verifiedDealsCount} tracked ${s.verifiedDealsCount === 1 ? 'deal' : 'deals'}</span>` : ''}
            ${s.cashback ? `<span class="badge badge-exceptional tabular">Up to ${s.cashback.percent}% CB</span>` : ''}
            ${s.localPresence ? '<span class="badge badge-local">📍 NC Local</span>' : ''}
          </div>
          <div class="store-links">
            <a class="btn btn-sm btn-primary" href="${esc(s.blackFridayUrl || s.dealsUrl || s.url)}" target="_blank" rel="noopener noreferrer">${s.hasDedicatedBlackFridayUrl ? `Open ${esc(s.name)} Black Friday Deals ↗` : `Open ${esc(s.name)} Deals ↗`}</a>
            ${s.blackFridayUrl !== s.dealsUrl ? `<a class="btn btn-sm" href="${esc(s.dealsUrl)}" target="_blank" rel="noopener noreferrer">All Sales ↗</a>` : ''}
            <a class="btn btn-sm" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Store Home ↗</a>
            ${s.storeFinderUrl ? `<a class="btn btn-sm" href="${esc(s.storeFinderUrl)}" target="_blank" rel="noopener noreferrer">27545 Stores ↗</a>` : ''}
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('') || '<div class="chart-empty">No retailers match your search.</div>';

  attachLogoFallbacks($('all-stores-container'));
}

/* ==================== REMAINING VIEWS (BF Live, Compare, Local, History, Alerts, Browse, Settings) ==================== */
function renderBlackFridayLiveView() {
  const d = appState.data;
  if (!d) return;
  const bfEvent = d.events.find((e) => e.id === 'black-friday-2026');
  const cmEvent = d.events.find((e) => e.id === 'cyber-monday-2026');
  const fmtCd = (iso) => {
    const diff = Math.max(0, Date.parse(iso) - Date.now());
    return { d: Math.floor(diff / 86400000), h: Math.floor((diff % 86400000) / 3600000), m: Math.floor((diff % 3600000) / 60000), s: Math.floor((diff % 60000) / 1000) };
  };
  const drawCd = () => {
    $('bf-countdowns').innerHTML = [
      { label: 'Black Friday 2026 · Nov 27', ev: bfEvent },
      { label: 'Cyber Monday 2026 · Nov 30', ev: cmEvent },
    ].map(({ label, ev }) => {
      const p = fmtCd(ev?.startsAt || '2026-11-27T05:00:00Z');
      return `<div class="countdown-card"><div class="section-kicker">CONFIRMED 2026 EVENT</div><h2 style="margin:0;">${esc(label)}</h2><div class="small muted">${esc(ev?.summary || '')}</div><div class="countdown-digits tabular"><div class="cd-box"><div class="cd-num">${String(p.d).padStart(2, '0')}</div><div class="cd-unit">Days</div></div><div class="cd-box"><div class="cd-num">${String(p.h).padStart(2, '0')}</div><div class="cd-unit">Hours</div></div><div class="cd-box"><div class="cd-num">${String(p.m).padStart(2, '0')}</div><div class="cd-unit">Mins</div></div><div class="cd-box"><div class="cd-num">${String(p.s).padStart(2, '0')}</div><div class="cd-unit">Secs</div></div></div></div>`;
    }).join('');
  };
  drawCd();
  if (appState.countdownTimer) clearInterval(appState.countdownTimer);
  appState.countdownTimer = setInterval(() => { if (appState.activeView === 'black-friday-live') drawCd(); }, 1000);

  const nowMs = Date.now();
  $('bf-timeline').innerHTML = d.events.map((ev) => {
    const st = nowMs >= Date.parse(ev.startsAt) && nowMs <= Date.parse(ev.endsAt) ? 'LIVE NOW' : nowMs > Date.parse(ev.endsAt) ? 'Ended' : 'Upcoming';
    return `<div class="timeline-card ${st === 'LIVE NOW' ? 'is-live' : ''}"><div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;"><strong>${esc(ev.name)}</strong><span class="badge ${st === 'LIVE NOW' ? 'badge-exceptional' : 'badge-great'}">${st}</span></div><div class="small muted tabular">${ev.startsAt.slice(0, 10)} → ${ev.endsAt.slice(0, 10)}</div><div class="small">${esc(ev.summary)}</div></div>`;
  }).join('');

  const list = appState.bfSubtab === 'archived'
    ? d.archivedDeals || []
    : d.deals.filter((x) => {
        if (appState.bfSubtab === 'early') return x.isEarlyBlackFriday || x.isBlackFriday;
        if (appState.bfSubtab === 'cyber') return x.isCyberMonday;
        if (appState.bfSubtab === 'doorbuster') return x.isDoorbuster || (x.verifiedDiscountPct >= 35);
        if (appState.bfSubtab === 'local') return x.localPickupKnightdale === 'available' || x.localPickupKnightdale === 'check_store';
        return x.isBlackFriday || x.isEarlyBlackFriday || x.isCyberMonday || x.isDoorbuster || (x.verifiedDiscountPct >= 25);
      });
  $('bf-deals-grid').innerHTML = list.length ? list.slice(0, 50).map((x) => renderProductCardHtml(x)).join('') : '<div class="small muted">No deals in this tab yet.</div>';
  attachLogoFallbacks($('bf-deals-grid'));
}

async function renderCompareView() {
  const d = appState.data;
  if (!d) return;
  const wlSel = $('alt-wishlist-select');
  if (!d.wishlist.length) {
    wlSel.innerHTML = '<option value="">Upload a wish-list item first</option>';
    $('alternatives-stage').innerHTML = '<div class="onboarding-box"><h3>No wish-list items yet</h3><p>Upload your wish lists to unlock automatic cross-retailer price comparison &amp; smarter alternatives.</p><button class="btn btn-primary" data-open-upload="wishlist" type="button">+ Upload Wish List</button></div>';
  } else {
    wlSel.innerHTML = d.wishlist.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
    if (!appState.altWishlistId || !d.wishlist.some((w) => w.id === appState.altWishlistId)) appState.altWishlistId = d.wishlist[0].id;
    wlSel.value = appState.altWishlistId;
    try {
      const alts = await api(`/api/black-friday/alternatives/${encodeURIComponent(appState.altWishlistId)}`);
      const bucket = (title, items) => `
        <div style="margin-bottom:14px;">
          <h3 style="margin:0 0 8px;">${esc(title)} (${items.length})</h3>
          ${items.length ? `<div class="deals-grid">${items.map((a) => `
            <div class="deal-card"><div class="deal-body">
              <div class="deal-meta-row"><span class="retailer-tag">${esc(a.retailerName)}</span>${a.savings > 0 ? `<span class="badge badge-exceptional tabular">Save ${money(a.savings)}</span>` : ''}</div>
              <h4 class="deal-title">${esc(a.name)}</h4>
              <div class="tabular"><strong style="font-size:20px;color:var(--accent-emerald);">${money(a.currentPrice)}</strong> <span class="small muted">(All-In ${money(a.finalAllInTotal)})</span></div>
              <div class="deal-why">${esc(a.reason)}</div>
              <div class="small muted">${esc(a.differences)}</div>
              <div class="deal-actions"><a class="btn btn-primary btn-sm" href="${esc(a.retailerUrl)}" target="_blank" rel="noopener noreferrer">Open Offer ↗</a></div>
            </div></div>`).join('')}</div>` : '<div class="small muted">No matching offers currently in this bucket.</div>'}
        </div>`;
      $('alternatives-stage').innerHTML =
        bucket('Same Product, Better Price', alts.same_better_price || []) +
        bucket('Better Product, Similar Price', alts.better_similar_price || []) +
        bucket('Similar Product, Much Lower Price', alts.similar_lower_price || []);
    } catch (e) { $('alternatives-stage').innerHTML = `<div class="small muted">${esc(e.message)}</div>`; }
  }

  const addSel = $('compare-add-select');
  addSel.innerHTML = d.deals.slice(0, 80).map((x) => `<option value="${esc(x.id)}">${esc(x.retailerName)} — ${esc(x.title.slice(0, 60))} (${money(x.currentPrice)})</option>`).join('');
  const selected = appState.compareDealIds.map((id) => d.deals.find((x) => x.id === id)).filter(Boolean);
  const matrixEl = $('compare-matrix');
  if (!selected.length) {
    matrixEl.innerHTML = '<div class="small muted">Click <strong>COMPARE PRICES</strong> on any product card or add deals above to compare side-by-side.</div>';
    return;
  }
  matrixEl.innerHTML = `<div id="compare-bars-host" style="margin-bottom:14px;"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th>${selected.map((x) => `<th>${esc(x.title.slice(0, 56))}</th>`).join('')}</tr></thead><tbody>
    <tr><td><strong>Retailer</strong></td>${selected.map((x) => `<td>${esc(x.retailerName)}</td>`).join('')}</tr>
    <tr><td><strong>Current Price</strong></td>${selected.map((x) => `<td class="tabular"><strong>${money(x.currentPrice)}</strong></td>`).join('')}</tr>
    <tr><td><strong>Est. All-In (7.25% NC Tax)</strong></td>${selected.map((x) => `<td class="tabular"><strong>${money(x.finalAllInTotal)}</strong></td>`).join('')}</tr>
    <tr><td><strong>Verified Discount</strong></td>${selected.map((x) => `<td>${x.verifiedDiscountPct != null ? `${x.verifiedDiscountPct}% OFF` : 'Baseline Unknown'}</td>`).join('')}</tr>
    <tr><td><strong>Action</strong></td>${selected.map((x) => `<td><a class="btn btn-sm btn-primary" href="${esc(x.retailerUrl)}" target="_blank" rel="noopener noreferrer">${x.isDirectProductUrl ? 'SHOP NOW ↗' : 'View Deal ↗'}</a></td>`).join('')}</tr>
  </tbody></table></div>`;
  renderRetailerCompareBars($('compare-bars-host'), selected);
}

function renderLocalDealsView() {
  const d = appState.data;
  if (!d) return;
  $('local-stores-grid').innerHTML = d.localStores.map((st) => {
    const storeMeta = getStoreMeta(st.retailerId);
    return `
      <div class="store-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="display:inline-flex;align-items:center;gap:8px;">${renderStoreAvatar(storeMeta || { name: st.retailerName }, true)}<strong>${esc(st.branchName)}</strong></span>
          <span class="badge badge-local tabular">${esc(st.distanceMiles)} mi</span>
        </div>
        <div class="small muted">${esc(st.address)} · ${esc(st.area)}</div>
        <div class="store-links">
          <a class="btn btn-sm btn-primary" href="${esc(st.storeUrl)}" target="_blank" rel="noopener noreferrer">Store Page ↗</a>
          <a class="btn btn-sm" href="${esc(st.clearanceUrl)}" target="_blank" rel="noopener noreferrer">Clearance ↗</a>
        </div>
      </div>`;
  }).join('');

  const kIds = new Set(d.localStores.filter((s) => s.distanceMiles <= 2.5).map((s) => s.retailerId));
  let list = d.deals.filter((x) => x.localPickupKnightdale === 'available' || x.localPickupKnightdale === 'check_store');
  if (appState.localTab === 'knightdale') list = list.filter((x) => kIds.has(x.retailerId));
  else if (appState.localTab === 'warehouse') list = list.filter((x) => x.retailerId === 'costco' || x.retailerId === 'samsclub');
  else if (appState.localTab === 'pickup_verified') list = list.filter((x) => x.mentionsLocalPickup || x.localPickupKnightdale === 'available');
  $('local-deals-grid').innerHTML = list.length ? list.slice(0, 36).map((x) => renderProductCardHtml(x)).join('') : '<div class="small muted">No local deals match this filter right now.</div>';
  attachLogoFallbacks($('view-local-deals'));
}

async function renderPriceHistoryView() {
  const d = appState.data;
  if (!d) return;
  const index = d.priceHistoryIndex || [];
  const dealByKey = new Map();
  for (const deal of d.deals) if (!dealByKey.has(deal.canonicalKey)) dealByKey.set(deal.canonicalKey, deal);
  const sel = $('history-product-select');
  if (!index.length) {
    sel.innerHTML = '<option value="">No observations recorded yet</option>';
    renderPriceHistoryChart($('history-chart-host'), { entries: [] });
    return;
  }
  const sorted = [...index].sort((a, b) => b.observationsCount - a.observationsCount);
  sel.innerHTML = sorted.slice(0, 120).map((row) => {
    const deal = dealByKey.get(row.canonicalKey);
    return `<option value="${esc(row.canonicalKey)}">${esc(deal ? `${deal.title.slice(0, 62)} (${row.observationsCount} obs)` : row.canonicalKey)}</option>`;
  }).join('');
  if (!appState.historyKey || !sorted.some((r) => r.canonicalKey === appState.historyKey)) appState.historyKey = sorted[0].canonicalKey;
  sel.value = appState.historyKey;
  const hist = await api(`/api/black-friday/history/${encodeURIComponent(appState.historyKey)}?range=${encodeURIComponent(appState.historyRange)}`);
  const linked = dealByKey.get(appState.historyKey);
  renderPriceHistoryChart($('history-chart-host'), { entries: hist.entries, normalPrice: linked?.normalPrice ?? null, honestyNote: hist.honestyNote });
  $('history-table-host').innerHTML = hist.entries.length ? `<table class="data-table"><thead><tr><th>Observed (ET)</th><th>Retailer</th><th>Price</th><th>All-In</th><th>Source</th></tr></thead><tbody>${[...hist.entries].reverse().slice(0, 30).map((e) => `<tr><td class="tabular">${esc(formatClock(e.observedAt))}</td><td>${esc(e.retailerName)}</td><td class="tabular"><strong>${money(e.price)}</strong></td><td class="tabular">${money(e.allInTotal)}</td><td class="small muted">${esc(e.sourceId)}</td></tr>`).join('')}</tbody></table>` : '';
}

function renderAlertsView() {
  const d = appState.data;
  if (!d) return;
  const ch = d.alertChannels || {};
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const cards = [
    ch.inDashboard,
    { label: 'Browser Notifications', active: perm === 'granted', detail: perm === 'granted' ? 'Browser permission granted.' : 'Click "Enable Browser Alerts" to activate.' },
    ch.email, ch.webhook,
  ].filter(Boolean);
  $('alert-channels-grid').innerHTML = cards.map((c) => `<div class="health-item ${c.active ? 'status-ok' : 'status-api_key_required'}"><div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;"><strong>${esc(c.label)}</strong><span class="badge ${c.active ? 'badge-exceptional' : 'badge-good'}">${c.active ? 'Active' : 'Not Active'}</span></div><div class="muted">${esc(c.detail)}</div></div>`).join('');
  $('alerts-feed').innerHTML = d.alerts?.length ? d.alerts.map((a) => `<div class="alert-card ${a.read ? '' : 'is-unread'}"><div><strong>${esc(a.title)}</strong><div class="small">${esc(a.message)}</div><div class="small muted tabular">${esc(formatClock(a.triggeredAt))}</div></div>${a.retailerUrl ? `<a class="btn btn-sm btn-primary" href="${esc(a.retailerUrl)}" ${a.retailerUrl.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>Open ↗</a>` : ''}</div>`).join('') : '<div class="small muted">No alerts triggered yet.</div>';
}

function renderBestDealsView() {
  const d = appState.data;
  if (!d) return;
  const retSel = $('filter-retailer');
  const activeRetMap = new Map();
  for (const deal of d.deals) activeRetMap.set(deal.retailerId, deal.retailerName);
  retSel.innerHTML = `<option value="all">All Retailers (${activeRetMap.size})</option>` + [...activeRetMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
  retSel.value = activeRetMap.has(appState.filters.retailer) ? appState.filters.retailer : 'all';

  let list = [...d.deals];
  const f = appState.filters;
  if (f.q.trim()) { const q = f.q.trim().toLowerCase(); list = list.filter((x) => `${x.title} ${x.brand || ''} ${x.retailerName}`.toLowerCase().includes(q)); }
  if (f.tier !== 'all') list = list.filter((x) => x.tier === f.tier);
  if (f.retailer !== 'all') list = list.filter((x) => x.retailerId === f.retailer);
  if (f.category !== 'all') list = list.filter((x) => x.category === f.category);
  if (f.maxPrice && Number(f.maxPrice) > 0) list = list.filter((x) => x.currentPrice !== null && x.currentPrice <= Number(f.maxPrice));
  if (f.freeShip) list = list.filter((x) => x.shippingFree);
  if (f.newOnly) list = list.filter((x) => x.condition === 'new');
  if (f.localOnly) list = list.filter((x) => x.localPickupKnightdale === 'available' || x.localPickupKnightdale === 'check_store');
  if (f.sort === 'discount') list.sort((a, b) => (b.verifiedDiscountPct ?? -1) - (a.verifiedDiscountPct ?? -1));
  else if (f.sort === 'price_asc') list.sort((a, b) => (a.finalAllInTotal ?? 1e9) - (b.finalAllInTotal ?? 1e9));
  else if (f.sort === 'price_desc') list.sort((a, b) => (b.finalAllInTotal ?? -1) - (a.finalAllInTotal ?? -1));
  else if (f.sort === 'newest') list.sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));

  $('deals-count-label').textContent = `${list.length} verified live-feed deals`;
  $('best-deals-grid').innerHTML = list.length ? list.slice(0, 60).map((x) => renderProductCardHtml(x)).join('') : '<div class="small muted">No deals match your filters.</div>';
  attachLogoFallbacks($('best-deals-grid'));
}

function renderSettingsView() {
  const d = appState.data;
  if (!d) return;
  const s = d.settings;
  const w = s.decisionWeights;
  $('persistence-banner').innerHTML = `<strong>Persistence Status (${esc(d.persistence?.mode || 'disk')}):</strong> ${esc(d.persistence?.note || '')}`;
  $('settings-form-host').innerHTML = `
    <div class="intake-grid">
      <div class="field"><label for="set-zip">Primary ZIP Code</label><input id="set-zip" type="text" value="${esc(s.location.zip)}" /></div>
      <div class="field"><label for="set-tax">Sales Tax Rate (%)</label><input id="set-tax" type="number" step="0.01" value="${esc((s.location.salesTaxRate * 100).toFixed(2))}" /></div>
      <div class="field"><label for="set-budget">Total Holiday Budget ($)</label><input id="set-budget" type="number" value="${esc(s.budgets.totalHolidayBudget)}" /></div>
      <div class="field"><label for="set-t-exc">Exceptional %</label><input id="set-t-exc" type="number" value="${esc(s.thresholds.exceptionalPct)}" /></div>
      <div class="field"><label for="set-t-great">Great %</label><input id="set-t-great" type="number" value="${esc(s.thresholds.greatPct)}" /></div>
      <div class="field"><label for="set-t-good">Good %</label><input id="set-t-good" type="number" value="${esc(s.thresholds.goodPct)}" /></div>
      <div class="field"><label for="set-alert-pct">Alert Trigger (% Off)</label><input id="set-alert-pct" type="number" value="${esc(s.alerts.defaultDiscountTriggerPct)}" /></div>
      <div class="field"><label for="set-quiet-start">Quiet Start (ET)</label><input id="set-quiet-start" type="time" value="${esc(s.alerts.quietHoursStart)}" /></div>
      <div class="field"><label for="set-quiet-end">Quiet End (ET)</label><input id="set-quiet-end" type="time" value="${esc(s.alerts.quietHoursEnd)}" /></div>
      <div class="field"><label for="set-email">Email Recipient</label><input id="set-email" type="email" value="${esc(s.alerts.emailRecipient || '')}" /></div>
      <div class="field"><label for="set-cadence-hp">High-Priority Min</label><input id="set-cadence-hp" type="number" value="${esc(s.monitoring.highPriorityMinutes)}" /></div>
      <div class="field"><label for="set-cadence-std">Standard Min</label><input id="set-cadence-std" type="number" value="${esc(s.monitoring.standardMinutes)}" /></div>
      <div class="field"><label for="w-discount">Wt: Discount</label><input id="w-discount" type="number" value="${esc(w.discount)}" /></div>
      <div class="field"><label for="w-history">Wt: History</label><input id="w-history" type="number" value="${esc(w.history)}" /></div>
      <div class="field"><label for="w-quality">Wt: Quality</label><input id="w-quality" type="number" value="${esc(w.quality)}" /></div>
      <div class="field"><label for="w-relevance">Wt: Relevance</label><input id="w-relevance" type="number" value="${esc(w.relevance)}" /></div>
      <div class="field"><label for="w-allin">Wt: All-In</label><input id="w-allin" type="number" value="${esc(w.allInCost)}" /></div>
      <div class="field"><label for="w-avail">Wt: Availability</label><input id="w-avail" type="number" value="${esc(w.availability)}" /></div>
      <div class="field"><label for="w-conf">Wt: Confidence</label><input id="w-conf" type="number" value="${esc(w.confidence)}" /></div>
    </div>`;

  $('settings-diagnostics-host').innerHTML = `<table class="data-table"><thead><tr><th>Source</th><th>Status</th><th>HTTP</th><th>Offers</th><th>Last Success</th><th>Detail</th></tr></thead><tbody>${d.sourceHealth.map((src) => `<tr><td><strong>${esc(src.name)}</strong></td><td><span class="badge ${src.status === 'ok' ? 'badge-exceptional' : src.status === 'api_key_required' ? 'badge-good' : 'badge-danger'}">${esc(src.status.replace(/_/g, ' '))}</span></td><td class="tabular">${esc(src.httpStatus ?? '—')}</td><td class="tabular">${esc(src.dealsParsed)}/${esc(src.itemsFetched)}</td><td class="small tabular">${esc(src.lastSuccessAt ? formatClock(src.lastSuccessAt) : 'Never')}</td><td class="small muted">${esc(src.lastError || 'Healthy')}</td></tr>`).join('')}</tbody></table>`;
}

/* ==================== ACTIONABLE MODALS (COMPARE PRICES / FIND SIMILAR / FIND CHEAPER / DETAILS) ==================== */
async function openCompareModal(dealId, initialMode = 'compare') {
  const modal = $('deal-modal');
  modal.hidden = false;
  $('deal-modal-kicker').textContent = initialMode === 'cheaper' ? 'Find Cheaper Verified Alternatives' : initialMode === 'similar' ? 'Find Similar Verified Products' : 'Cross-Retailer Price Comparison';
  $('deal-modal-title').textContent = 'Searching live offers…';
  $('deal-modal-body').innerHTML = '<div class="muted">Comparing verified prices across monitored retailers…</div>';

  try {
    const out = await api(`/api/black-friday/deals/${encodeURIComponent(dealId)}/compare`);
    const deal = out.deal;
    $('deal-modal-title').textContent = deal.title;

    const exactBlock = out.exactMatches.length
      ? `<div id="modal-compare-bars" style="margin-bottom:12px;"></div>
         <div class="deals-grid">${out.exactMatches.map((m) => renderProductCardHtml(m)).join('')}</div>`
      : `<div class="banner-notice">No other exact matching retailer listings were located across live monitored feeds right now for "${esc(deal.title)}". We keep watching automatically — check comparable cheaper/similar options below.</div>`;

    const simList = initialMode === 'cheaper' ? out.cheaper : out.similar;
    const altTitle = initialMode === 'cheaper' ? `Cheaper Verified Options (${out.cheaper.length})` : `Similar Verified Products (${out.similar.length})`;
    const altBlock = simList.length
      ? `<div class="deals-grid">${simList.map((s) => renderProductCardHtml(s.deal, {
          tierLabel: initialMode === 'cheaper' ? 'Cheaper Option' : 'Similar Product',
          triggeredBy: deal.title.slice(0, 48),
          whyRelevant: s.reason,
          betterOrWorse: s.savings > 0 ? `Saves ${money(s.savings)} vs $${deal.currentPrice?.toFixed(2)}` : 'Compare specs & features',
          savesMoney: s.savings > 0,
          estimatedSavings: s.savings,
          whereToBuy: s.deal.retailerName,
        })).join('')}</div>`
      : `<div class="small muted">No ${initialMode === 'cheaper' ? 'cheaper' : 'similar'} verified products found in the same category right now.</div>`;

    $('deal-modal-body').innerHTML = initialMode === 'compare'
      ? `<div class="section-kicker" style="margin-bottom:8px;">Exact Cross-Retailer Matching Offers (${out.exactMatches.length + 1} total)</div>${exactBlock}<h3 style="margin:18px 0 10px;">${altTitle}</h3>${altBlock}`
      : `<h3 style="margin:0 0 10px;">${altTitle}</h3>${altBlock}`;

    if (initialMode === 'compare' && out.exactMatches.length) {
      renderRetailerCompareBars($('modal-compare-bars'), [deal, ...out.exactMatches]);
    }
    attachLogoFallbacks($('deal-modal-body'));
  } catch (e) {
    $('deal-modal-body').innerHTML = `<div class="banner-notice">${esc(e.message)}</div>`;
  }
}

async function openDealDetailModal(dealId) {
  const modal = $('deal-modal');
  modal.hidden = false;
  $('deal-modal-kicker').textContent = 'Verified Offer Intelligence';
  $('deal-modal-title').textContent = 'Loading…';
  $('deal-modal-body').innerHTML = '<div class="muted">Loading details…</div>';
  try {
    const res = await api(`/api/black-friday/deals/${encodeURIComponent(dealId)}`);
    const deal = res.deal;
    $('deal-modal-kicker').textContent = `${deal.retailerName} · Verified via ${deal.sourceName}`;
    $('deal-modal-title').textContent = deal.title;
    $('deal-modal-body').innerHTML = `
      <div class="deal-price-box" style="margin-bottom:14px;">
        <span class="price-now tabular">${money(deal.currentPrice)}</span>
        <span class="tabular">${deal.normalPrice ? `<span class="price-normal">${money(deal.normalPrice)}</span>` : '<span class="small muted">Baseline unknown</span>'}</span>
        <div class="price-breakdown tabular">
          <span>Discount: <strong>${deal.verifiedDiscountPct != null ? `${deal.verifiedDiscountPct}%` : 'Unverified'}</strong></span>
          <span>NC Tax: <strong>${money(deal.estimatedTax)}</strong></span>
          <span>All-In: <strong>${money(deal.finalAllInTotal)}</strong></span>
        </div>
      </div>
      <div class="table-wrap" style="margin-bottom:14px;"><table class="data-table"><thead><tr><th>Decision Factor</th><th>Points</th><th>Basis</th></tr></thead><tbody>${(deal.decision?.breakdown || []).map((b) => `<tr><td><strong>${esc(b.factor)}</strong></td><td class="tabular">${b.score}/${b.max}</td><td class="small muted">${esc(b.note)}</td></tr>`).join('')}</tbody></table></div>
      <div id="modal-chart-host"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <a class="btn btn-primary" href="${esc(deal.retailerUrl)}" target="_blank" rel="noopener noreferrer">${deal.isDirectProductUrl ? 'SHOP NOW ↗' : `Open via ${esc(deal.sourceName)} ↗`}</a>
      </div>`;
    renderPriceHistoryChart($('modal-chart-host'), { entries: res.history || [], normalPrice: deal.normalPrice });
  } catch (e) { $('deal-modal-body').innerHTML = `<div class="banner-notice">${esc(e.message)}</div>`; }
}

/* ==================== DISPATCH & SYNC ==================== */
function renderSidebarBadges() {
  const d = appState.data;
  if (!d) return;
  $('badge-stores').textContent = String(d.storesDirectory?.length || 96);
  $('badge-wishlist').textContent = String((d.wishlist?.length || 0) + (d.savedDeals?.length || 0));
  $('badge-profiles').textContent = String(d.profiles?.length || 0);
  $('badge-deals').textContent = String(d.kpis.totalActiveDeals || 0);
  const unread = d.kpis.unreadAlertsCount || 0;
  $('badge-alerts').textContent = String(unread);
  $('badge-alerts').hidden = unread === 0;
  $('footer-version').textContent = d.version;
  $('sidebar-scheduler-line').textContent = d.kpis.lastSuccessfulUpdate
    ? `Checked ${timeAgo(d.kpis.lastSuccessfulUpdate)} · Next ${formatClock(d.kpis.nextScheduledUpdate)}`
    : 'Monitor initializing…';
}

function renderActiveView() {
  renderSidebarBadges();
  switch (appState.activeView) {
    case 'command-center': renderHomePage(); break;
    case 'upload-center': renderUploadCenter(); break;
    case 'wishlists': renderWishlistsView(); break;
    case 'profiles': renderProfilesView(); break;
    case 'all-stores': renderAllStoresView(); break;
    case 'black-friday-live': renderBlackFridayLiveView(); break;
    case 'compare': void renderCompareView(); break;
    case 'local-deals': renderLocalDealsView(); break;
    case 'price-history': void renderPriceHistoryView(); break;
    case 'alerts': renderAlertsView(); break;
    case 'best-deals': renderBestDealsView(); break;
    case 'settings': renderSettingsView(); break;
  }
}

function hydrateData(payload) {
  appState.data = payload;
  try { sessionStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(payload)); } catch {}
  renderActiveView();
}

async function fetchBootstrap() {
  try {
    const data = await api('/api/black-friday/bootstrap');
    $('offline-banner').hidden = true;
    hydrateData(data);
  } catch (e) {
    $('offline-banner').hidden = false;
    toast(`Could not load live state: ${e.message}`);
  }
}

function connectSse() {
  if (appState.sse) appState.sse.close();
  try {
    const es = new EventSource('/api/black-friday/stream');
    appState.sse = es;
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'sweep_started') $('live-dot')?.classList.add('is-busy');
        else if (['sweep_complete', 'wishlist_search_complete', 'alert_created'].includes(msg.type)) {
          $('live-dot')?.classList.remove('is-busy');
          void fetchBootstrap();
        }
      } catch {}
    };
  } catch {}
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || '');
      resolve(str.includes(',') ? str.split(',')[1] : str);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

/* ==================== GLOBAL EVENT WIRING ==================== */
function bindEvents() {
  // Delegate navigation from the document so sidebar clicks remain functional
  // even if the sidebar is rerendered or a mobile overlay is active.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#nav-list .nav-btn[data-view]');
    if (!btn) return;
    e.preventDefault();
    switchView(btn.dataset.view);
  });

  $('mobile-menu-btn').addEventListener('click', () => {
    $('sidebar').classList.toggle('is-open');
    $('sidebar-scrim').classList.toggle('is-open');
  });
  $('sidebar-scrim').addEventListener('click', () => {
    $('sidebar').classList.remove('is-open');
    $('sidebar-scrim').classList.remove('is-open');
  });

  $('top-upload-btn').addEventListener('click', () => openUploadCenter('wishlist', 'file'));
  $('top-stores-btn').addEventListener('click', () => switchView('all-stores'));
  $('hero-upload-wishlist-btn').addEventListener('click', () => openUploadCenter('wishlist', 'file'));
  $('hero-upload-deals-btn').addEventListener('click', () => openUploadCenter('deal', 'file'));
  $('wl-open-upload-btn').addEventListener('click', () => openUploadCenter('wishlist', 'file'));
  $('sd-open-upload-btn').addEventListener('click', () => openUploadCenter('deal', 'file'));

  $('home-store-quick-search').addEventListener('input', (e) => {
    appState.homeStoreQuery = e.target.value;
    renderHomePage();
  });

  // Home Section 1: Store Picker & Live Deals filters
  $('home-deals-search')?.addEventListener('input', (e) => { appState.homeDealsSearch = e.target.value; appState.homeDealsLimit = 9999; renderHomePage(); });
  $('home-deals-sort')?.addEventListener('change', (e) => { appState.homeDealsSort = e.target.value; renderHomePage(); });
  $('home-deals-25plus')?.addEventListener('change', (e) => { appState.homeDeals25Plus = e.target.checked; appState.homeDealsLimit = 9999; renderHomePage(); });
  $('home-deals-img-only')?.addEventListener('change', (e) => { appState.homeDealsImgOnly = e.target.checked; appState.homeDealsLimit = 9999; renderHomePage(); });
  $('home-main-deals-more')?.addEventListener('click', () => { appState.homeDealsLimit += 24; renderHomePage(); });

  // Home Section 2: Uploaded Wish Lists & Deals filters
  $('home-wl-search')?.addEventListener('input', (e) => { appState.homeWlSearch = e.target.value; appState.homeWlLimit = 24; renderHomePage(); });
  $('home-wl-store')?.addEventListener('change', (e) => { appState.homeWlStore = e.target.value; appState.homeWlLimit = 24; renderHomePage(); });
  $('home-wl-filter')?.addEventListener('change', (e) => { appState.homeWlFilter = e.target.value; appState.homeWlLimit = 24; renderHomePage(); });
  $('home-wl-sort')?.addEventListener('change', (e) => { appState.homeWlSort = e.target.value; renderHomePage(); });
  $('home-uploaded-more')?.addEventListener('click', () => { appState.homeWlLimit += 36; renderHomePage(); });

  $('theme-toggle-btn').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
  });

  const runManualRefresh = async (btn) => {
    if (btn) btn.disabled = true;
    toast('Scanning authorized retail feeds & your wish lists…');
    try {
      const out = await api('/api/black-friday/refresh', { method: 'POST', body: {} });
      if (out.dashboard) hydrateData(out.dashboard);
      toast(`Checked ${out.okSources} sources (${out.observationsAdded} new history observations).`);
    } catch (e) { toast(e.message); }
    finally { if (btn) btn.disabled = false; }
  };
  $('refresh-now-btn').addEventListener('click', (e) => runManualRefresh(e.currentTarget));
  $('home-recheck-live-btn')?.addEventListener('click', (e) => runManualRefresh(e.currentTarget));
  $('diag-refresh-btn').addEventListener('click', (e) => runManualRefresh(e.currentTarget));

  $('deal-modal-close').addEventListener('click', () => { $('deal-modal').hidden = true; });
  $('deal-modal').addEventListener('click', (e) => { if (e.target === $('deal-modal')) $('deal-modal').hidden = true; });

  // Delegated click handler
  document.addEventListener('click', async (e) => {
    const gotoBtn = e.target.closest('[data-goto]');
    if (gotoBtn) return switchView(gotoBtn.dataset.goto);

    const pickStore = e.target.closest('[data-pick-store]');
    if (pickStore) {
      appState.homeSelectedStore = pickStore.dataset.pickStore;
      appState.homeDealsLimit = 9999;
      renderHomePage();
      return;
    }

    const homeRecip = e.target.closest('[data-home-recip]');
    if (homeRecip) {
      appState.homeRecipient = homeRecip.dataset.homeRecip;
      appState.homeWlLimit = 24;
      renderHomePage();
      return;
    }

    if (e.target.id === 'pv-select-all-btn' && appState.uploadPreview) {
      syncDomEditsIntoPreview();
      appState.uploadPreview.items.forEach((it) => { it.selected = true; });
      renderUploadPreviewPanel();
      return;
    }
    if (e.target.id === 'pv-deselect-all-btn' && appState.uploadPreview) {
      syncDomEditsIntoPreview();
      appState.uploadPreview.items.forEach((it) => { it.selected = false; });
      renderUploadPreviewPanel();
      return;
    }
    if (e.target.id === 'pv-switch-type-btn' && appState.uploadPreview) {
      syncDomEditsIntoPreview();
      appState.uploadPreview.uploadType = appState.uploadPreview.uploadType === 'deal' ? 'wishlist' : 'deal';
      appState.uploadType = appState.uploadPreview.uploadType;
      renderUploadCenter();
      return;
    }
    if (e.target.id === 'pv-prev-page' && appState.previewPage > 0) {
      syncDomEditsIntoPreview();
      appState.previewPage -= 1;
      renderUploadPreviewPanel();
      return;
    }
    if (e.target.id === 'pv-next-page') {
      syncDomEditsIntoPreview();
      appState.previewPage += 1;
      renderUploadPreviewPanel();
      return;
    }

    const openUp = e.target.closest('[data-open-upload]');
    if (openUp) return openUploadCenter(openUp.dataset.openUpload, 'file');

    if (e.target.id === 'home-recheck-now') return runManualRefresh(e.target);

    // Store Favorite Star Toggle
    const favBtn = e.target.closest('[data-toggle-fav]');
    if (favBtn) {
      try {
        const out = await api('/api/black-friday/stores/favorite', { method: 'POST', body: { storeId: favBtn.dataset.toggleFav } });
        hydrateData(out.dashboard);
        toast(out.isFavorite ? 'Added store to your Home Page favorites bar!' : 'Removed from favorites.');
      } catch (err) { toast(err.message); }
      return;
    }

    // Recommendation Feedback Buttons (LOVE IT, NOT INTERESTED, ALREADY BOUGHT)
    const fbBtn = e.target.closest('[data-fb]');
    if (fbBtn) {
      const action = fbBtn.dataset.fb;
      const dealId = fbBtn.dataset.dealId;
      try {
        const out = await api('/api/black-friday/feedback', {
          method: 'POST',
          body: { dealId, action, title: fbBtn.dataset.title || '' },
        });
        hydrateData(out.dashboard);
        toast(
          action === 'love' ? 'Saved & marked LOVE IT — recommendations updated!' :
          action === 'reject' ? 'Rejected permanently (only this exact product — category untouched).' :
          'Marked ALREADY BOUGHT — removed from recommendations & logged.'
        );
      } catch (err) { toast(err.message); }
      return;
    }

    // Card Actions (COMPARE PRICES, FIND SIMILAR, FIND CHEAPER, DETAILS, HISTORY)
    const act = e.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'compare-prices') return openCompareModal(act.dataset.dealId, 'compare');
      if (a === 'find-similar') return openCompareModal(act.dataset.dealId, 'similar');
      if (a === 'find-cheaper') return openCompareModal(act.dataset.dealId, 'cheaper');
      if (a === 'detail') return openDealDetailModal(act.dataset.dealId);
      if (a === 'history') { appState.historyKey = act.dataset.key; return switchView('price-history'); }
    }

    // Upload Center Toggles
    const utTab = e.target.closest('#upload-type-toggle .pill-tab');
    if (utTab) { appState.uploadType = utTab.dataset.utype; renderUploadCenter(); return; }
    const umTab = e.target.closest('#upload-mode-tabs .pill-tab');
    if (umTab) { appState.uploadMode = umTab.dataset.umode; renderUploadCenter(); return; }

    // Wish-list & Saved-deal actions
    const wlSearch = e.target.closest('[data-wl-search]');
    if (wlSearch) {
      wlSearch.disabled = true;
      toast('Searching live retail feeds for exact matches…');
      try {
        const out = await api(`/api/black-friday/wishlist/${encodeURIComponent(wlSearch.dataset.wlSearch)}/search`, { method: 'POST' });
        hydrateData(out.dashboard);
        toast(`Found ${out.matches.length} matching live offer(s)!`);
      } catch (err) { toast(err.message); }
      finally { wlSearch.disabled = false; }
      return;
    }
    const wlAlts = e.target.closest('[data-wl-alts]');
    if (wlAlts) { appState.altWishlistId = wlAlts.dataset.wlAlts; return switchView('compare'); }
    const wlDel = e.target.closest('[data-wl-delete]');
    if (wlDel) {
      const out = await api(`/api/black-friday/wishlist/${encodeURIComponent(wlDel.dataset.wlDelete)}`, { method: 'DELETE' });
      hydrateData(out.dashboard);
      toast('Removed wish-list item.');
      return;
    }
    const sdDel = e.target.closest('[data-sd-delete]');
    if (sdDel) {
      const out = await api(`/api/black-friday/saved-deals/${encodeURIComponent(sdDel.dataset.sdDelete)}`, { method: 'DELETE' });
      hydrateData(out.dashboard);
      toast('Deleted saved deal.');
      return;
    }

    // Profile Save / Delete
    const saveProf = e.target.closest('[data-save-profile]');
    if (saveProf) {
      const card = saveProf.closest('.profile-card');
      try {
        const out = await api(`/api/black-friday/profiles/${encodeURIComponent(saveProf.dataset.saveProfile)}`, {
          method: 'PATCH',
          body: {
            favoriteBrands: card.querySelector('.pf-brands').value,
            interests: card.querySelector('.pf-interests').value,
            clothingSizes: card.querySelector('.pf-sizes').value,
            preferredRetailers: card.querySelector('.pf-retailers').value,
            budget: Number(card.querySelector('.pf-budget').value) || 300,
            savedIdeas: card.querySelector('.pf-ideas').value,
          },
        });
        hydrateData(out.dashboard);
        toast('Family profile saved & recommendations updated!');
      } catch (err) { toast(err.message); }
      return;
    }
    const delProf = e.target.closest('[data-del-profile]');
    if (delProf) {
      const out = await api(`/api/black-friday/profiles/${encodeURIComponent(delProf.dataset.delProfile)}`, { method: 'DELETE' });
      hydrateData(out.dashboard);
      toast('Deleted family profile.');
      return;
    }

    // Tabs
    const profTab = e.target.closest('#profile-tabs .pill-tab');
    if (profTab) { appState.selectedProfileId = profTab.dataset.profile; renderWishlistsView(); return; }
    const bfTab = e.target.closest('#bf-subtabs .pill-tab');
    if (bfTab) { appState.bfSubtab = bfTab.dataset.bf; document.querySelectorAll('#bf-subtabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === bfTab)); renderBlackFridayLiveView(); return; }
    const locTab = e.target.closest('#local-filter-tabs .pill-tab');
    if (locTab) { appState.localTab = locTab.dataset.local; document.querySelectorAll('#local-filter-tabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === locTab)); renderLocalDealsView(); return; }
    const rngTab = e.target.closest('#history-range-tabs .pill-tab');
    if (rngTab) { appState.historyRange = rngTab.dataset.range; document.querySelectorAll('#history-range-tabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === rngTab)); void renderPriceHistoryView(); return; }
  });

  // Upload Preview Buttons
  $('upload-add-blank-row-btn').addEventListener('click', () => {
    if (!appState.uploadPreview) return;
    appState.uploadPreview.items = collectPreviewItemsFromDom();
    appState.uploadPreview.items.push({
      selected: true, name: '', brand: '', modelNumber: '', size: '', color: '',
      price: null, retailerName: '', url: '', profileId: 'family-main', priority: 'standard', needsReview: false, isDuplicate: false,
    });
    renderUploadPreviewPanel();
  });
  $('upload-cancel-preview-btn').addEventListener('click', () => {
    appState.uploadPreview = null;
    renderUploadPreviewPanel();
  });
  $('upload-commit-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!appState.uploadPreview) return;
    const approved = collectPreviewItemsFromDom().filter((i) => i.selected && (i.name || i.url));
    if (!approved.length) return toast('Check at least one valid product row to save.');
    btn.disabled = true;
    toast(`Saving ${approved.length} approved item(s)…`);
    try {
      const out = await api('/api/black-friday/uploads/commit', {
        method: 'POST',
        body: {
          uploadType: appState.uploadPreview.uploadType,
          uploadFileId: appState.uploadPreview.uploadFileId,
          items: approved,
        },
      });
      const committedType = appState.uploadPreview.uploadType;
      appState.uploadPreview = null;
      appState.previewPage = 0;
      appState.previewQuery = '';
      appState.homeRecipient = 'all';
      appState.homeWlLimit = 24;
      hydrateData(out.dashboard);
      toast(`Saved ${out.addedCount} item(s)${out.immediateMatches ? ` · Found ${out.immediateMatches} live deal match(es)!` : ''}`);
      switchView('command-center');
      $('home-wishlist-hub-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  });

  // Preview search filter & drag-and-drop
  document.addEventListener('input', (e) => {
    if (e.target.id === 'pv-search-input' && appState.uploadPreview) {
      syncDomEditsIntoPreview();
      appState.previewQuery = e.target.value;
      appState.previewPage = 0;
      renderUploadPreviewPanel();
    }
  });
  document.addEventListener('dragover', (e) => {
    if (e.target.closest('#uc-dropzone')) {
      e.preventDefault();
      e.target.closest('#uc-dropzone').classList.add('is-dragover');
    }
  });
  document.addEventListener('dragleave', (e) => {
    if (e.target.closest('#uc-dropzone')) {
      e.target.closest('#uc-dropzone').classList.remove('is-dragover');
    }
  });
  document.addEventListener('drop', (e) => {
    const dz = e.target.closest('#uc-dropzone');
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove('is-dragover');
    const inp = $('uc-file-input');
    if (inp && e.dataTransfer?.files?.length) {
      inp.files = e.dataTransfer.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Delegated changes (status, move profile, file image preview)
  document.addEventListener('change', async (e) => {
    if (e.target.classList.contains('wl-status-select')) {
      const out = await api(`/api/black-friday/wishlist/${encodeURIComponent(e.target.dataset.wlId)}`, { method: 'PATCH', body: { status: e.target.value } });
      hydrateData(out.dashboard);
      toast(`Updated status to ${e.target.value.replace(/_/g, ' ')}.`);
    } else if (e.target.classList.contains('wl-move-select')) {
      const out = await api(`/api/black-friday/wishlist/${encodeURIComponent(e.target.dataset.wlId)}/move`, { method: 'POST', body: { profileId: e.target.value } });
      hydrateData(out.dashboard);
      toast('Moved item to selected family member!');
    } else if (e.target.id === 'uc-file-input' && e.target.files?.[0]) {
      const f = e.target.files[0];
      const isImg = f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
      const wrap = $('uc-screenshot-notes-wrap');
      if (wrap) wrap.style.display = isImg ? 'block' : 'none';
      if (isImg) {
        const r = new FileReader();
        r.onload = () => { $('uc-img-preview').innerHTML = `<img src="${r.result}" alt="Preview" style="max-height:140px;border-radius:10px;border:1px solid var(--border-glass);" />`; };
        r.readAsDataURL(f);
      }
    }
  });

  // Upload Center & Profile Form Submissions
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.id === 'uc-file-form') {
      e.preventDefault();
      const files = [...($('uc-file-input')?.files || [])];
      if (!files.length) return;
      toast(`Reading ${files.length} file${files.length > 1 ? 's' : ''} (${files[0].name}${files.length > 1 ? ` + ${files.length - 1} more` : ''})…`);
      try {
        const mergedItems = [];
        const warnings = [];
        let lastFileId = null;
        let totalIntraDup = 0;
        let dealSugCount = 0;
        let lastUploadedFiles = null;

        for (const file of files) {
          const b64 = await fileToBase64(file);
          const prev = await api('/api/black-friday/uploads/preview', {
            method: 'POST',
            body: {
              uploadType: appState.uploadType, mode: 'file', filename: file.name, mimeType: file.type,
              contentBase64: b64, extractedOcrText: $('uc-ocr-text')?.value?.trim() || '',
              profileId: $('uc-profile').value, recipient: $('uc-recipient').value.trim(), priority: $('uc-priority').value,
            },
          });
          lastFileId = prev.uploadFileId || lastFileId;
          if (Array.isArray(prev.uploadedFiles)) lastUploadedFiles = prev.uploadedFiles;
          if (prev.parseWarning) warnings.push(`${file.name}: ${prev.parseWarning}`);
          if (prev.suggestedUploadType === 'deal') dealSugCount += 1;
          totalIntraDup += prev.intraFileDuplicatesRemoved || 0;
          for (const it of prev.items || []) {
            mergedItems.push({ ...it, uploadFileId: prev.uploadFileId });
          }
        }

        const effectiveType = appState.uploadType;
        appState.previewPage = 0;
        appState.previewQuery = '';
        appState.uploadPreview = {
          uploadType: effectiveType,
          suggestedUploadType: dealSugCount > 0 ? 'deal' : effectiveType,
          uploadFileId: lastFileId,
          filename: files.map((f) => f.name).join(', '),
          parseWarning: warnings.join(' · ') || null,
          intraFileDuplicatesRemoved: totalIntraDup,
          extractedCount: mergedItems.length,
          duplicatesCount: mergedItems.filter((i) => i.isDuplicate).length,
          needsReviewCount: mergedItems.filter((i) => i.needsReview).length,
          items: mergedItems,
        };
        if (appState.data && Array.isArray(lastUploadedFiles)) appState.data.uploadedFiles = lastUploadedFiles;
        renderUploadCenter();
        toast(`Extracted ${mergedItems.length} unique item(s)${totalIntraDup ? ` (${totalIntraDup} duplicates merged)` : ''} — review & click Save Approved Items.`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'uc-bulk-form') {
      e.preventDefault();
      try {
        const prev = await api('/api/black-friday/uploads/preview', {
          method: 'POST',
          body: {
            uploadType: appState.uploadType, mode: 'bulk', filename: `pasted-${appState.uploadType}.txt`,
            contentText: $('uc-bulk-text').value, profileId: $('uc-bulk-profile').value, recipient: $('uc-bulk-recipient').value.trim(),
          },
        });
        appState.previewPage = 0;
        appState.previewQuery = '';
        appState.uploadPreview = prev;
        if (appState.data && Array.isArray(prev.uploadedFiles)) appState.data.uploadedFiles = prev.uploadedFiles;
        renderUploadCenter();
        toast(`Extracted ${prev.extractedCount} product(s) — review & approve below.`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'uc-urls-form') {
      e.preventDefault();
      toast('Inspecting product URL(s) live…');
      try {
        const prev = await api('/api/black-friday/uploads/preview', {
          method: 'POST',
          body: {
            uploadType: appState.uploadType, mode: 'urls', filename: `urls-${appState.uploadType}.txt`,
            urlsText: $('uc-urls-text').value, profileId: $('uc-urls-profile').value, recipient: $('uc-urls-recipient').value.trim(),
          },
        });
        appState.previewPage = 0;
        appState.previewQuery = '';
        appState.uploadPreview = prev;
        if (appState.data && Array.isArray(prev.uploadedFiles)) appState.data.uploadedFiles = prev.uploadedFiles;
        renderUploadCenter();
        toast(`Inspected ${prev.extractedCount} URL(s) — review & approve below.`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'uc-manual-form') {
      e.preventDefault();
      appState.previewPage = 0;
      appState.previewQuery = '';
      appState.uploadPreview = {
        uploadType: appState.uploadType,
        uploadFileId: null,
        parseWarning: null,
        duplicatesCount: 0,
        needsReviewCount: 0,
        items: [{
          selected: true,
          name: $('uc-m-name').value.trim(),
          brand: $('uc-m-brand').value.trim(),
          modelNumber: $('uc-m-model').value.trim(),
          size: $('uc-m-size').value.trim(),
          color: $('uc-m-color').value.trim(),
          price: $('uc-m-price').value ? Number($('uc-m-price').value) : null,
          retailerName: $('uc-m-retailer').value.trim(),
          url: $('uc-m-url').value.trim(),
          profileId: $('uc-m-profile').value,
          recipient: $('uc-m-recipient').value.trim(),
          priority: 'high',
          isDuplicate: false,
          needsReview: false,
        }],
      };
      renderUploadPreviewPanel();
      toast('Preview ready — click Save Approved Items to add & track!');
    } else if (form.id === 'create-member-form') {
      e.preventDefault();
      try {
        const out = await api('/api/black-friday/profiles', {
          method: 'POST',
          body: {
            name: $('cm-name').value.trim(),
            budget: Number($('cm-budget').value) || 300,
            clothingSizes: $('cm-sizes').value.trim(),
            favoriteBrands: $('cm-brands').value.trim(),
            interests: $('cm-interests').value.trim(),
            preferredRetailers: $('cm-retailers').value.trim(),
          },
        });
        form.reset();
        $('create-member-panel').style.display = 'none';
        hydrateData(out.dashboard);
        toast(`Created profile for ${out.profile.name}!`);
      } catch (err) { toast(err.message); }
    }
  });

  // Profile modal toggle
  $('create-member-toggle').addEventListener('click', () => {
    const p = $('create-member-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  });
  $('cm-cancel-btn').addEventListener('click', () => { $('create-member-panel').style.display = 'none'; });

  // Store Directory filters & Verify Store Links
  $('stores-search').addEventListener('input', (e) => { appState.storeFilters.q = e.target.value; renderAllStoresView(); });
  $('stores-category-filter').addEventListener('change', (e) => { appState.storeFilters.category = e.target.value; renderAllStoresView(); });
  $('stores-fav-only').addEventListener('change', (e) => { appState.storeFilters.favOnly = e.target.checked; renderAllStoresView(); });
  $('verify-store-links-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    toast('Verifying official URLs across all 96+ retailers…');
    try {
      const out = await api('/api/black-friday/stores/verify-links', { method: 'POST' });
      hydrateData(out.dashboard);
      toast(`Verified ${out.checkedCount} retailer links!`);
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  });

  // Wish-list status filter, Compare controls, History selector, Alerts, Browse Filters, Settings Save
  $('wl-status-filter').addEventListener('change', (e) => { appState.wishlistStatusFilter = e.target.value; renderWishlistsView(); });
  $('alt-wishlist-select').addEventListener('change', (e) => { appState.altWishlistId = e.target.value; void renderCompareView(); });
  $('compare-add-btn').addEventListener('click', () => {
    const id = $('compare-add-select').value;
    if (id && !appState.compareDealIds.includes(id)) appState.compareDealIds = [...appState.compareDealIds.slice(-3), id];
    savePrefs();
    void renderCompareView();
  });
  $('compare-clear-btn').addEventListener('click', () => { appState.compareDealIds = []; savePrefs(); void renderCompareView(); });
  $('history-product-select').addEventListener('change', (e) => { appState.historyKey = e.target.value; void renderPriceHistoryView(); });

  $('enable-browser-push-btn').addEventListener('click', async () => {
    if (typeof Notification === 'undefined') return toast('Browser notifications unsupported.');
    const perm = await Notification.requestPermission();
    await api('/api/black-friday/settings', { method: 'PATCH', body: { alerts: { browserNotificationsEnabled: perm === 'granted' } } });
    await fetchBootstrap();
    toast(`Browser notification permission: ${perm}`);
  });
  $('send-test-alert-btn').addEventListener('click', async () => {
    const out = await api('/api/black-friday/alerts/test', { method: 'POST' });
    await fetchBootstrap();
    toast('Test alert delivered to dashboard!');
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(out.alert.title, { body: out.alert.message, icon: '/black-friday/icon.svg' }); } catch {}
    }
  });
  $('mark-alerts-read-btn').addEventListener('click', async () => {
    await api('/api/black-friday/alerts/read', { method: 'POST', body: {} });
    await fetchBootstrap();
  });

  const syncFilters = () => {
    appState.filters = {
      q: $('filter-q').value, tier: $('filter-tier').value, retailer: $('filter-retailer').value,
      category: $('filter-category').value, sort: $('filter-sort').value, maxPrice: $('filter-max-price').value,
      freeShip: $('filter-free-ship').checked, newOnly: $('filter-new-only').checked, localOnly: $('filter-local-only').checked,
    };
    savePrefs();
    renderBestDealsView();
  };
  for (const id of ['filter-q', 'filter-tier', 'filter-retailer', 'filter-category', 'filter-sort', 'filter-max-price', 'filter-free-ship', 'filter-new-only', 'filter-local-only']) {
    $(id).addEventListener(id === 'filter-q' || id === 'filter-max-price' ? 'input' : 'change', syncFilters);
  }
  $('filter-reset-btn').addEventListener('click', () => {
    appState.filters = { q: '', tier: 'all', retailer: 'all', category: 'all', sort: 'score', maxPrice: '', freeShip: false, newOnly: false, localOnly: false };
    savePrefs();
    renderBestDealsView();
  });

  $('reset-rejected-btn').addEventListener('click', async () => {
    const out = await api('/api/black-friday/feedback', { method: 'POST', body: { action: 'reset_rejected' } });
    hydrateData(out.dashboard);
    toast('Restored all previously rejected products.');
  });

  $('save-settings-btn').addEventListener('click', async () => {
    const out = await api('/api/black-friday/settings', {
      method: 'PATCH',
      body: {
        location: { zip: $('set-zip').value.trim() || '27545', salesTaxRate: Math.max(0, Math.min(0.2, (Number($('set-tax').value) || 7.25) / 100)) },
        budgets: { totalHolidayBudget: Number($('set-budget').value) || 2500 },
        thresholds: { exceptionalPct: Number($('set-t-exc').value) || 40, greatPct: Number($('set-t-great').value) || 25, goodPct: Number($('set-t-good').value) || 15 },
        alerts: { defaultDiscountTriggerPct: Number($('set-alert-pct').value) || 25, quietHoursStart: $('set-quiet-start').value, quietHoursEnd: $('set-quiet-end').value, emailRecipient: $('set-email').value.trim(), emailEnabled: Boolean($('set-email').value.trim()) },
        monitoring: { highPriorityMinutes: Number($('set-cadence-hp').value) || 15, standardMinutes: Number($('set-cadence-std').value) || 90 },
        decisionWeights: { discount: Number($('w-discount').value) || 0, history: Number($('w-history').value) || 0, quality: Number($('w-quality').value) || 0, relevance: Number($('w-relevance').value) || 0, allInCost: Number($('w-allin').value) || 0, availability: Number($('w-avail').value) || 0, confidence: Number($('w-conf').value) || 0 },
      },
    });
    hydrateData(out.dashboard);
    toast('Settings saved!');
  });
}

function boot() {
  loadPrefs();
  bindEvents();
  try {
    const cached = JSON.parse(sessionStorage.getItem(STORAGE_CACHE_KEY) || 'null');
    if (cached && cached.storesDirectory) { appState.data = cached; renderActiveView(); }
  } catch {}
  void fetchBootstrap();
  connectSse();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/black-friday/sw.js', { scope: '/black-friday/' }).catch(() => {});
}

boot();
