/**
 * Black Friday Command Center — Interactive Client Application.
 * Zero placeholder buttons, persistent filters & preferences, live SSE updates,
 * immediate cached rendering, and strict honest status reporting.
 */

import { renderPriceHistoryChart, renderRetailerCompareBars } from './charts.js';

const STORAGE_PREFS_KEY = 'bf_command_prefs_v1';
const STORAGE_CACHE_KEY = 'bf_command_cache_v1';

const VIEW_META = {
  'command-center': ['Command Center', 'Live autonomous deal intelligence · Knightdale, NC 27545'],
  wishlists: ['Our Wish Lists', '7-mode intake, family profiles, exact product matching & duplicate purchase guard'],
  'best-deals': ['Best Deals', 'Verified discounts ranked by decision score with all-in NC 7.25% tax'],
  'black-friday-live': ['Black Friday Live', 'Confirmed 2026 event countdowns, doorbusters, Cyber Monday & expired archive'],
  'deal-hunter': ['Deal Hunter', 'Autonomous family discovery engine learning from your wish lists & feedback'],
  compare: ['Compare Products', '3-tier smarter alternatives & side-by-side verified offer matrix'],
  'local-deals': ['Local Deals', 'Knightdale 27545, Raleigh, Garner, Wake Forest & Cary stores and warehouse clubs'],
  'price-history': ['Price History', 'Genuine timestamped multi-retailer observations — never fabricated'],
  alerts: ['Alerts', 'Deduplicated smart notifications, quiet hours & verified delivery channels'],
  'all-stores': ['All Stores', 'Searchable 60+ retailer directory with honest monitoring status & direct links'],
  settings: ['Settings', 'Customizable discount thresholds, decision weights, schedules & source diagnostics'],
};

const TIER_LABELS = {
  exceptional: 'Exceptional 40%+',
  great: 'Great 25–39%',
  good: 'Good 15–24%',
  watch: 'Watch <15%',
  unverified: 'Unverified Baseline',
};

const CAT_ICONS = {
  electronics: '💻',
  gaming: '🎮',
  home: '🏠',
  tools: '🛠️',
  apparel: '👟',
  beauty: '✨',
  toys: '🧱',
  outdoors: '⛺',
  pets: '🐾',
  other: '🛍️',
};

const appState = {
  data: null,
  activeView: 'command-center',
  intakeMode: 'manual',
  selectedProfileId: 'all',
  wishlistStatusFilter: 'all',
  bfSubtab: 'all',
  hunterTag: 'all',
  localTab: 'all',
  historyKey: '',
  historyRange: 'all',
  altWishlistId: '',
  compareDealIds: [],
  filters: {
    q: '',
    tier: 'all',
    retailer: 'all',
    category: 'all',
    sort: 'score',
    maxPrice: '',
    freeShip: false,
    newOnly: false,
    localOnly: false,
  },
  storeFilters: { q: '', category: 'all', status: 'all' },
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
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function toast(msg) {
  const stack = $('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFS_KEY) || '{}');
    if (raw.theme === 'light' || raw.theme === 'dark') applyTheme(raw.theme, false);
    if (raw.filters) appState.filters = { ...appState.filters, ...raw.filters };
    if (Array.isArray(raw.compareDealIds)) appState.compareDealIds = raw.compareDealIds.slice(0, 4);
    if (raw.activeView && VIEW_META[raw.activeView]) appState.activeView = raw.activeView;
  } catch {}
}

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify({
      theme: document.documentElement.dataset.theme || 'dark',
      filters: appState.filters,
      compareDealIds: appState.compareDealIds,
      activeView: appState.activeView,
    }));
  } catch {}
}

function applyTheme(theme, persistServer = false) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  const btn = $('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'light' ? '🌙 Dark' : '☀️ Light';
  savePrefs();
  if (persistServer) {
    api('/api/black-friday/settings', { method: 'PATCH', body: { theme } }).catch(() => {});
  }
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
  if (!res.ok) {
    throw new Error(json?.error || `Request failed (HTTP ${res.status})`);
  }
  return json;
}

/* ==================== NAVIGATION ==================== */
function switchView(viewId) {
  if (!VIEW_META[viewId]) return;
  appState.activeView = viewId;
  savePrefs();

  document.querySelectorAll('.view-panel').forEach((el) => {
    el.classList.toggle('is-active', el.id === `view-${viewId}`);
  });
  document.querySelectorAll('#nav-list .nav-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === viewId);
  });

  const [title, sub] = VIEW_META[viewId];
  $('topbar-title').textContent = title;
  $('topbar-sub').textContent = sub;

  // Close mobile drawer
  $('sidebar').classList.remove('is-open');
  $('sidebar-scrim').classList.remove('is-open');

  renderActiveView();
}

/* ==================== DEAL CARD RENDERER (ALL 16 REQUIRED FIELDS) ==================== */
function renderDealCardHtml(deal, { showHunterWhy = null, hunterMeta = null } = {}) {
  const tierClass = `tier-${deal.tier || 'unverified'}`;
  const badgeClass = `badge-${deal.tier || 'unverified'}`;
  const discountLabel = deal.verifiedDiscountPct !== null
    ? `${deal.verifiedDiscountPct}% OFF`
    : 'Baseline Unknown';
  const actionClass = deal.decision?.action === 'BUY NOW' ? 'badge-buy' : deal.decision?.action === 'CONSIDER ALTERNATIVE' ? 'badge-alt' : 'badge-wait';
  const inCompare = appState.compareDealIds.includes(deal.id);
  const freshnessLabel = deal.freshness === 'live_verified' ? 'Live Verified' : deal.freshness === 'recently_verified' ? 'Recently Verified' : deal.freshness === 'stale' ? 'Stale' : 'Unverified';
  const stockLabel = deal.availabilityStatus === 'in_stock' ? 'In Stock (Verified)' : deal.availabilityStatus === 'limited' ? 'Limited Stock' : deal.availabilityStatus === 'out_of_stock' ? 'Out of Stock' : 'Stock Unverified';
  const shippingLabel = deal.shippingFree ? 'Free Ship' : deal.shippingCost !== null ? `+${money(deal.shippingCost)} ship` : 'Verify ship';

  const rev = deal.reviewData;
  const reviewHtml = rev?.verifiedOwnerRating
    ? `<span class="badge badge-great">★ ${esc(rev.verifiedOwnerRating)}/${esc(rev.ratingScale || 5)}${rev.reviewCount ? ` (${esc(rev.reviewCount)})` : ''} · Verified Reviews</span>`
    : deal.sourceScore != null
      ? `<span class="badge badge-watch">👍 Community Score ${deal.sourceScore > 0 ? '+' : ''}${esc(deal.sourceScore)}</span>`
      : '';

  const imgHtml = deal.imageUrl
    ? `<img src="${esc(deal.imageUrl)}" alt="${esc(deal.title)}" loading="lazy" decoding="async" />`
    : `<div class="deal-media-fallback" aria-hidden="true">${CAT_ICONS[deal.category] || '🛍️'}</div>`;

  return `
    <article class="deal-card ${tierClass}" data-deal-id="${esc(deal.id)}">
      <div class="deal-media">
        ${imgHtml}
        <div class="deal-media-top">
          <span class="badge ${badgeClass} tabular">${esc(discountLabel)}</span>
          <span class="score-pill tabular" title="Shopping Decision Score (0-100 · ${esc(deal.decision?.evidenceCoveragePct ?? 0)}% evidenced)">
            Score ${esc(deal.decision?.score ?? 0)}/100
          </span>
        </div>
      </div>

      <div class="deal-body">
        <div class="deal-meta-row">
          <span class="retailer-tag">${esc(deal.retailerName || 'Retailer')}</span>
          <span class="badge ${actionClass}">${esc(deal.decision?.action || 'WAIT')}</span>
        </div>

        <h3 class="deal-title" title="${esc(deal.title)}">${esc(deal.title)}</h3>
        ${(deal.brand || deal.modelNumber) ? `<div class="small muted">${esc([deal.brand, deal.modelNumber ? `Model ${deal.modelNumber}` : null].filter(Boolean).join(' · '))}</div>` : ''}

        <div class="deal-price-box">
          <span class="price-now tabular">${money(deal.currentPrice)}</span>
          <span class="tabular">
            ${deal.normalPrice !== null ? `<span class="price-normal">${money(deal.normalPrice)}</span>` : '<span class="small muted">Normal price unknown</span>'}
          </span>
          <div class="price-breakdown tabular">
            <span>Ship: <strong>${esc(shippingLabel)}</strong></span>
            <span>Est. NC Tax (${esc(deal.taxRatePct ?? 7.25)}%): <strong>${money(deal.estimatedTax)}</strong></span>
            <span>Est. All-In: <strong>${money(deal.finalAllInTotal)}</strong></span>
            ${deal.cashbackPercent ? `<span style="color:var(--accent-emerald);">After ~${esc(deal.cashbackPercent)}% CB: <strong>${money(deal.effectiveAfterCashback)}</strong></span>` : ''}
          </div>
        </div>

        <div class="deal-tags">
          <span class="badge ${badgeClass}">${esc(TIER_LABELS[deal.tier] || 'Unverified')}</span>
          ${deal.isBlackFriday ? '<span class="badge badge-bf">Black Friday</span>' : ''}
          ${deal.isDoorbuster ? '<span class="badge badge-bf">Doorbuster</span>' : ''}
          ${deal.isPriceMistake ? '<span class="badge badge-danger">⚠️ Possible Price Mistake</span>' : ''}
          ${deal.inflatedListWarning ? '<span class="badge badge-danger">⚠️ Inflated List Warning</span>' : ''}
          ${deal.couponCode ? `<span class="badge badge-good">Code: ${esc(deal.couponCode)}</span>` : ''}
          ${deal.condition !== 'new' ? `<span class="badge badge-watch">${esc(deal.condition.replace('_', '-').toUpperCase())}</span>` : ''}
          ${deal.localPickupKnightdale === 'available' ? '<span class="badge badge-local">📍 Knightdale Pickup Verified</span>' : deal.localPickupKnightdale === 'check_store' ? '<span class="badge badge-local">📍 Local Chain (Check Stock)</span>' : '<span class="badge badge-watch">Online Only</span>'}
          <span class="badge badge-watch">${esc(stockLabel)}</span>
          ${deal.expiresAt ? `<span class="badge badge-danger">Ends ${esc(formatClock(deal.expiresAt))}</span>` : ''}
          ${reviewHtml}
        </div>

        <div class="deal-why">
          <strong>${showHunterWhy ? 'Why our family would want this:' : 'Why consider:'}</strong>
          ${esc(showHunterWhy || deal.whyWorthConsidering)}
        </div>

        <div class="deal-verify-line tabular">
          <span>${esc(freshnessLabel)} · ${esc(timeAgo(deal.verifiedAt))} (${esc(deal.sourceName)})</span>
          <span>Confidence: <strong>${esc(deal.confidenceLabel)} (${esc(deal.confidenceScore)}%)</strong></span>
        </div>

        <div class="deal-actions">
          <a class="btn btn-primary btn-sm" href="${esc(deal.retailerUrl)}" target="_blank" rel="noopener noreferrer">Open at ${esc(deal.retailerName)} ↗</a>
          <button class="btn btn-sm" data-action="detail" data-deal-id="${esc(deal.id)}" type="button">Details</button>
          <button class="btn btn-sm" data-action="history" data-key="${esc(deal.canonicalKey)}" type="button">📈</button>
          <button class="btn btn-sm" data-action="compare" data-deal-id="${esc(deal.id)}" type="button">${inCompare ? '✓ Comparing' : '⚖️'}</button>
          ${hunterMeta ? `
            <button class="btn btn-sm" data-action="hunter-add-wl" data-deal-id="${esc(deal.id)}" type="button">+ Wish List</button>
            <button class="btn btn-sm" data-action="hunter-save" data-deal-id="${esc(deal.id)}" type="button">${hunterMeta.saved ? '★ Saved' : '☆ Save'}</button>
            <button class="btn btn-sm btn-danger" data-action="hunter-reject" data-deal-id="${esc(deal.id)}" data-brand="${esc(deal.brand || '')}" type="button">✕</button>
          ` : ''}
        </div>
      </div>
    </article>`;
}

/* ==================== RENDERERS FOR ALL 11 VIEWS ==================== */

function renderSidebarBadges() {
  const d = appState.data;
  if (!d) return;
  $('badge-wishlist').textContent = String(d.kpis.wishlistTotalCount || 0);
  $('badge-deals').textContent = String(d.kpis.totalActiveDeals || 0);
  $('badge-hunter').textContent = String(d.kpis.newGiftRecommendationsCount || 0);

  const unread = d.kpis.unreadAlertsCount || 0;
  const alBadge = $('badge-alerts');
  alBadge.textContent = String(unread);
  alBadge.hidden = unread === 0;

  $('sidebar-location').textContent = `${d.location.city}, ${d.location.state} ${d.location.zip}`;
  $('sidebar-tax').textContent = `${(d.location.salesTaxRate * 100).toFixed(2)}% tax`;
  $('footer-version').textContent = d.version;

  const dot = $('live-dot');
  dot.className = `live-dot ${d.kpis.monitoringStatus.running ? 'is-busy' : ''}`;
  $('sidebar-scheduler-line').textContent = d.kpis.lastSuccessfulUpdate
    ? `Updated ${timeAgo(d.kpis.lastSuccessfulUpdate)} · Next ${formatClock(d.kpis.nextScheduledUpdate)}`
    : 'Background monitor initializing…';
}

function renderCommandCenter() {
  const d = appState.data;
  if (!d) return;
  const k = d.kpis;
  const m = k.monitoringStatus;

  $('kpi-grid').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Active Verified Deals</div>
      <div class="kpi-value tabular">${esc(k.totalActiveDeals)}</div>
      <div class="kpi-sub">${esc(k.archivedDealsCount)} expired/archived automatically</div>
    </div>
    <div class="kpi-card is-emerald">
      <div class="kpi-label">Wish-List Discounted</div>
      <div class="kpi-value tabular">${esc(k.wishlistDiscountedCount)} <span class="small muted">/ ${esc(k.wishlistTotalCount)}</span></div>
      <div class="kpi-sub">Matched across authorized live feeds</div>
    </div>
    <div class="kpi-card is-gold">
      <div class="kpi-label">Verified 25%+ Discounts</div>
      <div class="kpi-value tabular">${esc(k.verified25PlusCount)}</div>
      <div class="kpi-sub">Against defensible baselines only</div>
    </div>
    <div class="kpi-card is-emerald">
      <div class="kpi-label">Largest Verified Drop</div>
      <div class="kpi-value tabular">${k.largestVerifiedDiscountPct != null ? `${k.largestVerifiedDiscountPct}%` : '—'}</div>
      <div class="kpi-sub" title="${esc(k.largestDiscountTitle || '')}">${esc(k.largestDiscountTitle || 'Awaiting sweep')}</div>
    </div>
    <div class="kpi-card is-violet">
      <div class="kpi-label">Est. Savings vs Normal</div>
      <div class="kpi-value tabular">${money(k.estimatedSavingsVsNormal)}</div>
      <div class="kpi-sub">${esc(k.savingsBasis)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Gift Recommendations</div>
      <div class="kpi-value tabular">${esc(k.newGiftRecommendationsCount)}</div>
      <div class="kpi-sub">Autonomous Deal Hunter discoveries</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Last &amp; Next Update</div>
      <div class="kpi-value tabular" style="font-size:18px;padding-top:4px;">${esc(timeAgo(k.lastSuccessfulUpdate))}</div>
      <div class="kpi-sub">Next: ${esc(formatClock(k.nextScheduledUpdate))} (${esc(m.lastWorkerSource || 'server')})</div>
    </div>
    <div class="kpi-card ${m.failed > 0 ? 'is-warn' : 'is-emerald'}">
      <div class="kpi-label">Retailer Monitoring</div>
      <div class="kpi-value tabular">${esc(m.healthy)} <span class="small muted">OK</span> · ${esc(m.failed)} <span class="small" style="color:var(--accent-rose);">Err/Blk</span></div>
      <div class="kpi-sub">${esc(m.apiKeyRequired)} optional APIs awaiting key</div>
    </div>`;

  // Best Deals Right Now
  const bestEl = $('cc-best-deals');
  if (!d.bestDealsRightNow.length) {
    bestEl.innerHTML = `<div class="chart-empty" style="grid-column:1/-1;"><div class="chart-empty-title">Running live sweep across authorized retail feeds…</div><p class="muted">Click "Refresh Feeds" above or wait a few seconds for live verified deals to populate.</p></div>`;
  } else {
    bestEl.innerHTML = d.bestDealsRightNow.slice(0, 8).map((deal) => renderDealCardHtml(deal)).join('');
  }

  // Wish-list Radar
  const radarEl = $('cc-wishlist-radar');
  if (!d.wishlist.length) {
    radarEl.innerHTML = `<div class="chart-empty"><div class="chart-empty-title">No family wish-list items tracked yet</div><p class="muted">Add a product by name, retailer link, screenshot, spreadsheet, bulk paste, or general gift idea — monitoring starts automatically.</p><button class="btn btn-primary" data-goto="wishlists" type="button">+ Add Your First Wish-List Item</button></div>`;
  } else {
    radarEl.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Product</th><th>Recipient</th><th>Status</th><th>Target / Max</th><th>Best Verified Offer</th><th>All-In Est.</th><th>Action</th></tr></thead>
      <tbody>${d.wishlist.slice(0, 8).map((w) => `
        <tr>
          <td><strong>${esc(w.name)}</strong><div class="small muted">${esc([w.brand, w.modelNumber].filter(Boolean).join(' · '))}</div></td>
          <td>${esc(w.recipient || 'Family')}</td>
          <td><span class="badge ${w.status === 'deal_found' ? 'badge-exceptional' : w.status === 'purchased' ? 'badge-great' : 'badge-watch'}">${esc(w.status.replace(/_/g, ' '))}</span></td>
          <td class="tabular">${money(w.preferredPrice)} / ${money(w.maxPrice)}</td>
          <td>${w.bestOffer ? `<strong>${money(w.bestOffer.currentPrice)}</strong> at ${esc(w.bestOffer.retailerName)}${w.bestOffer.verifiedDiscountPct != null ? ` <span class="badge badge-${esc(w.bestOffer.tier)}">${w.bestOffer.verifiedDiscountPct}% off</span>` : ''}` : '<span class="muted">Monitoring…</span>'}</td>
          <td class="tabular">${w.bestOffer ? money(w.bestOffer.finalAllInTotal) : '—'}</td>
          <td>${w.bestOffer ? `<a class="btn btn-sm btn-primary" href="${esc(w.bestOffer.retailerUrl)}" target="_blank" rel="noopener noreferrer">Buy ↗</a>` : `<button class="btn btn-sm" data-wl-search="${esc(w.id)}" type="button">Check Now</button>`}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  // Source Health Strip
  $('cc-source-health').innerHTML = d.sourceHealth.map((s) => `
    <div class="health-item status-${esc(s.status)}">
      <div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:3px;">
        <strong>${esc(s.name)}</strong>
        <span class="badge ${s.status === 'ok' ? 'badge-exceptional' : s.status === 'api_key_required' || s.status === 'pending' ? 'badge-good' : 'badge-danger'}">${esc(s.status.replace(/_/g, ' '))}</span>
      </div>
      <div class="muted tabular">${s.status === 'ok' ? `${s.dealsParsed} verified · ${s.latencyMs}ms · ${timeAgo(s.lastSuccessAt)}` : esc(s.lastError || `HTTP ${s.httpStatus || 'N/A'}`)}</div>
    </div>`).join('');
}

/* ==================== WISH LISTS (ALL 7 INTAKE MODES) ==================== */
function renderIntakePanel() {
  const d = appState.data;
  const profiles = d?.profiles || [];
  const profileOpts = profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.icon || '🎁')} ${esc(p.name)}</option>`).join('');
  const mode = appState.intakeMode;
  const host = $('intake-panel-body');

  if (mode === 'manual') {
    host.innerHTML = `
      <form id="wl-manual-form" class="intake-grid">
        <div class="field span-2"><label for="wl-name">Product Name *</label><input id="wl-name" type="text" required placeholder="e.g. Sony WH-1000XM5 Wireless Noise Canceling Headphones" /></div>
        <div class="field"><label for="wl-profile">Family Profile / List</label><select id="wl-profile">${profileOpts}</select></div>
        <div class="field"><label for="wl-brand">Brand (auto-detected if blank)</label><input id="wl-brand" type="text" placeholder="e.g. Sony, Apple, LEGO" /></div>
        <div class="field"><label for="wl-model">Model / SKU / UPC / ASIN</label><input id="wl-model" type="text" placeholder="e.g. WH1000XM5 or B09XS7JWHH" /></div>
        <div class="field"><label for="wl-recipient">Intended Recipient</label><input id="wl-recipient" type="text" placeholder="e.g. Mom, Dad, Kids, Household" /></div>
        <div class="field"><label for="wl-pref-price">Preferred Target Price ($)</label><input id="wl-pref-price" type="number" step="0.01" min="1" placeholder="e.g. 249.99" /></div>
        <div class="field"><label for="wl-max-price">Maximum Acceptable Price ($)</label><input id="wl-max-price" type="number" step="0.01" min="1" placeholder="e.g. 299.99" /></div>
        <div class="field"><label for="wl-priority">Priority</label>
          <select id="wl-priority"><option value="high">High (15-min monitoring)</option><option value="standard" selected>Standard</option><option value="low">Low</option></select>
        </div>
        <div class="field"><label for="wl-color">Color / Size / Specs</label><input id="wl-color" type="text" placeholder="e.g. Midnight Blue, 256GB, 65&quot;" /></div>
        <div class="field span-2"><label for="wl-features">Required Features / Notes</label><input id="wl-features" type="text" placeholder="e.g. Must be new sealed, USB-C, local pickup preferred" /></div>
        <div class="field span-3" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
          <label class="small" style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;"><input id="wl-allow-refurb" type="checkbox" style="width:auto;" /> Allow manufacturer refurbished</label>
          <label class="small" style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;"><input id="wl-allow-openbox" type="checkbox" style="width:auto;" /> Allow open-box</label>
          <button class="btn btn-primary" type="submit" style="margin-left:auto;">+ Add &amp; Search Retailers Immediately</button>
        </div>
      </form>`;
  } else if (mode === 'url') {
    host.innerHTML = `
      <form id="wl-url-form" class="intake-grid">
        <div class="field span-2"><label for="wl-url-input">Paste Retailer Product URL *</label><input id="wl-url-input" type="url" required placeholder="https://www.amazon.com/dp/... or Target / Best Buy / Walmart / Home Depot URL" /></div>
        <div class="field" style="display:flex;align-items:flex-end;"><button id="wl-url-preview-btn" class="btn" type="button" style="width:100%;">🔍 Inspect Link Live</button></div>
        <div id="wl-url-preview-box" class="span-3"></div>
        <div class="field"><label for="wl-url-profile">Profile</label><select id="wl-url-profile">${profileOpts}</select></div>
        <div class="field"><label for="wl-url-recipient">Recipient</label><input id="wl-url-recipient" type="text" placeholder="Who is this for?" /></div>
        <div class="field"><label for="wl-url-pref">Target Price ($)</label><input id="wl-url-pref" type="number" step="0.01" placeholder="Optional" /></div>
        <div class="field span-3" style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit">+ Add Product from Link &amp; Track</button>
        </div>
      </form>`;
  } else if (mode === 'screenshot') {
    host.innerHTML = `
      <form id="wl-screenshot-form" class="intake-grid">
        <div class="field span-2"><label for="wl-ss-file">Upload Product Screenshot (PNG / JPG / WebP)</label><input id="wl-ss-file" type="file" accept="image/*" required /></div>
        <div class="field"><label for="wl-ss-profile">Profile</label><select id="wl-ss-profile">${profileOpts}</select></div>
        <div class="field span-3"><label for="wl-ss-text">Product Name / Text Visible in Screenshot (one per line if multiple)</label><textarea id="wl-ss-text" rows="2" placeholder="Optional: type or paste the product name & model shown in the screenshot for exact cross-retailer matching"></textarea></div>
        <div id="wl-ss-preview" class="span-3"></div>
        <div class="field span-3" style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit">+ Save Screenshot &amp; Track Product</button>
        </div>
      </form>`;
  } else if (mode === 'file' || mode === 'import') {
    host.innerHTML = `
      <form id="wl-file-form" class="intake-grid">
        <div class="field span-2"><label for="wl-doc-file">${mode === 'import' ? 'Import Shopping List (Amazon/Target CSV/HTML, Google Sheets CSV, JSON)' : 'Upload Spreadsheet or Document (CSV, TSV, XLSX, DOCX, DOC, RTF, JSON, TXT)'}</label><input id="wl-doc-file" type="file" accept=".csv,.tsv,.xlsx,.docx,.doc,.rtf,.json,.txt,.html,.htm" required /></div>
        <div class="field"><label for="wl-doc-profile">Default Profile</label><select id="wl-doc-profile">${profileOpts}</select></div>
        <div class="field"><label for="wl-doc-recipient">Default Recipient</label><input id="wl-doc-recipient" type="text" placeholder="Optional" /></div>
        <div class="field span-2" style="display:flex;align-items:flex-end;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit">↑ Parse &amp; Import Items</button>
        </div>
      </form>`;
  } else if (mode === 'bulk') {
    host.innerHTML = `
      <form id="wl-bulk-form" class="intake-grid">
        <div class="field span-3">
          <label for="wl-bulk-text">Bulk Paste Wish List (one product per line — supports inline URLs, "for Mom", "target $199", "under $250", "[high]")</label>
          <textarea id="wl-bulk-text" rows="5" required placeholder="Sony WH-1000XM5 Headphones target $249 for Dad [high]&#10;KitchenAid Artisan Stand Mixer under $329 for Mom&#10;LEGO Star Wars Millennium Falcon 75375 under $65 for Kids"></textarea>
        </div>
        <div class="field"><label for="wl-bulk-profile">Default Profile</label><select id="wl-bulk-profile">${profileOpts}</select></div>
        <div class="field span-2" style="display:flex;align-items:flex-end;justify-content:flex-end;">
          <button class="btn btn-primary" type="submit">+ Import Bulk List</button>
        </div>
      </form>`;
  } else if (mode === 'gift_idea') {
    host.innerHTML = `
      <form id="wl-gift-form" class="intake-grid">
        <div class="field span-2"><label for="wl-gift-prompt">Describe a General Gift Idea *</label><input id="wl-gift-prompt" type="text" required placeholder="e.g. great Christmas gifts for a college student under $100" /></div>
        <div class="field"><label for="wl-gift-profile">Save Under Profile</label><select id="wl-gift-profile">${profileOpts}</select></div>
        <div class="field span-3" style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button id="wl-gift-match-btn" class="btn" type="button">🔍 Preview Matching Live Deals</button>
          <button class="btn btn-primary" type="submit">+ Save &amp; Track Gift Idea</button>
        </div>
        <div id="wl-gift-results" class="span-3"></div>
      </form>`;
  }
}

function renderWishlistsView() {
  const d = appState.data;
  if (!d) return;
  renderIntakePanel();

  const profiles = d.profiles || [];
  const tabsHtml = [
    `<button class="pill-tab ${appState.selectedProfileId === 'all' ? 'is-active' : ''}" data-profile="all" type="button">All Lists (${d.wishlist.length})</button>`,
    ...profiles.map((p) => {
      const cnt = d.wishlist.filter((w) => w.profileId === p.id).length;
      return `<button class="pill-tab ${appState.selectedProfileId === p.id ? 'is-active' : ''}" data-profile="${esc(p.id)}" type="button">${esc(p.icon || '🎁')} ${esc(p.name)} (${cnt})</button>`;
    }),
  ].join('');
  $('profile-tabs').innerHTML = tabsHtml;

  let items = [...d.wishlist];
  if (appState.selectedProfileId !== 'all') items = items.filter((w) => w.profileId === appState.selectedProfileId);
  if (appState.wishlistStatusFilter !== 'all') items = items.filter((w) => w.status === appState.wishlistStatusFilter);

  const container = $('wishlist-container');
  if (!items.length) {
    container.innerHTML = `<div class="chart-empty"><div class="chart-empty-title">No items in this wish list yet</div><p class="muted">Use any of the 7 intake tabs above to add products, links, screenshots, spreadsheets, or gift ideas.</p></div>`;
    return;
  }

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
            <span class="badge ${item.priority === 'high' ? 'badge-danger' : item.priority === 'low' ? 'badge-watch' : 'badge-great'}">${esc(item.priority)} priority</span>
            ${item.isGiftIdea ? '<span class="badge badge-local">💡 Gift Idea</span>' : ''}
            ${item.recipient ? `<span class="badge badge-watch">For: ${esc(item.recipient)}</span>` : ''}
          </div>
          <div class="small muted" style="margin-bottom:6px;">
            ${esc([item.brand, item.modelNumber ? `Model: ${item.modelNumber}` : null, item.upc ? `UPC: ${item.upc}` : null, item.asin ? `ASIN: ${item.asin}` : null, item.color, item.size, item.specs].filter(Boolean).join(' · ') || 'Auto-normalized tracking active')}
          </div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;margin-bottom:8px;" class="tabular">
            <span>Target: <strong>${money(item.preferredPrice)}</strong></span>
            <span>Max: <strong>${money(item.maxPrice)}</strong></span>
            <span>Matched Offers: <strong>${esc(item.matchedOffersCount)}</strong></span>
            <span>Last Checked: <strong>${esc(timeAgo(item.lastCheckedAt))}</strong></span>
          </div>
          ${best ? `
            <div class="deal-why" style="margin-bottom:8px;">
              <strong>Best Verified Offer:</strong> ${money(best.currentPrice)} (Est. ${money(best.finalAllInTotal)} all-in) at <strong>${esc(best.retailerName)}</strong>
              ${best.verifiedDiscountPct != null ? ` · <span class="badge badge-${esc(best.tier)}">${best.verifiedDiscountPct}% OFF</span>` : ''}
              · <a href="${esc(best.retailerUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);font-weight:700;">Open Deal ↗</a>
            </div>` : `<div class="small muted" style="margin-bottom:8px;">No exact live feed match yet — background monitor searches continuously every ${item.priority === 'high' ? '15 min' : 'cycle'}.</div>`}
          ${item.notes ? `<div class="small muted">${esc(item.notes)}</div>` : ''}
        </div>
        <div class="wishlist-card-actions" style="display:flex;flex-direction:column;gap:6px;min-width:155px;">
          <select class="wl-status-select" data-wl-id="${esc(item.id)}" aria-label="Item status">
            ${['wanted', 'monitoring', 'deal_found', 'purchased', 'no_longer_interested'].map((st) => `<option value="${st}" ${item.status === st ? 'selected' : ''}>${st.replace(/_/g, ' ')}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-primary" data-wl-search="${esc(item.id)}" type="button">🔍 Search Live Now</button>
          <button class="btn btn-sm" data-wl-alts="${esc(item.id)}" type="button">💡 Alternatives</button>
          <button class="btn btn-sm" data-action="history" data-key="${esc(best?.canonicalKey || item.canonicalKey)}" type="button">📈 History (${esc(item.historyCount)})</button>
          <button class="btn btn-sm btn-danger" data-wl-delete="${esc(item.id)}" type="button">Remove</button>
        </div>
      </article>`;
  }).join('');
}

/* ==================== BEST DEALS VIEW ==================== */
function renderBestDealsView() {
  const d = appState.data;
  if (!d) return;

  // Populate retailer dropdown cleanly
  const retSel = $('filter-retailer');
  const existingVal = appState.filters.retailer;
  const activeRetMap = new Map();
  for (const deal of d.deals) activeRetMap.set(deal.retailerId, deal.retailerName);
  retSel.innerHTML = `<option value="all">All Retailers (${activeRetMap.size})</option>` +
    [...activeRetMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
  retSel.value = activeRetMap.has(existingVal) ? existingVal : 'all';

  $('filter-q').value = appState.filters.q;
  $('filter-tier').value = appState.filters.tier;
  $('filter-category').value = appState.filters.category;
  $('filter-sort').value = appState.filters.sort;
  $('filter-max-price').value = appState.filters.maxPrice;
  $('filter-free-ship').checked = Boolean(appState.filters.freeShip);
  $('filter-new-only').checked = Boolean(appState.filters.newOnly);
  $('filter-local-only').checked = Boolean(appState.filters.localOnly);

  let list = [...d.deals];
  const f = appState.filters;
  if (f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    list = list.filter((x) => `${x.title} ${x.brand || ''} ${x.modelNumber || ''} ${x.retailerName} ${x.description || ''}`.toLowerCase().includes(q));
  }
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
  else list.sort((a, b) => (b.decision?.score ?? 0) - (a.decision?.score ?? 0));

  $('deals-count-label').textContent = `${list.length} verified deal${list.length === 1 ? '' : 's'} shown`;
  const grid = $('best-deals-grid');
  grid.innerHTML = list.length
    ? list.slice(0, 80).map((deal) => renderDealCardHtml(deal)).join('')
    : '<div class="chart-empty" style="grid-column:1/-1;"><div class="chart-empty-title">No deals match your current filters</div><p class="muted">Adjust or reset filters above to view all live verified deals.</p></div>';
}

/* ==================== BLACK FRIDAY LIVE VIEW ==================== */
function formatCountdownParts(targetIso) {
  const diff = Math.max(0, Date.parse(targetIso) - Date.now());
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { live: diff === 0, d, h, m, s };
}

function renderBlackFridayLiveView() {
  const d = appState.data;
  if (!d) return;

  const bfEvent = d.events.find((e) => e.id === 'black-friday-2026');
  const cmEvent = d.events.find((e) => e.id === 'cyber-monday-2026');

  const drawCountdowns = () => {
    const cards = [
      { label: 'Black Friday 2026 · Nov 27', event: bfEvent },
      { label: 'Cyber Monday 2026 · Nov 30', event: cmEvent },
    ];
    $('bf-countdowns').innerHTML = cards.map(({ label, event }) => {
      const p = formatCountdownParts(event?.startsAt || '2026-11-27T05:00:00Z');
      return `
        <div class="countdown-card">
          <div class="section-kicker">${p.live ? 'EVENT ACTIVE NOW' : 'CONFIRMED COUNTDOWN'}</div>
          <h2 style="margin:0;">${esc(label)}</h2>
          <div class="small muted">${esc(event?.summary || '')}</div>
          <div class="countdown-digits tabular">
            <div class="cd-box"><div class="cd-num">${String(p.d).padStart(2, '0')}</div><div class="cd-unit">Days</div></div>
            <div class="cd-box"><div class="cd-num">${String(p.h).padStart(2, '0')}</div><div class="cd-unit">Hours</div></div>
            <div class="cd-box"><div class="cd-num">${String(p.m).padStart(2, '0')}</div><div class="cd-unit">Mins</div></div>
            <div class="cd-box"><div class="cd-num">${String(p.s).padStart(2, '0')}</div><div class="cd-unit">Secs</div></div>
          </div>
        </div>`;
    }).join('');
  };
  drawCountdowns();
  if (appState.countdownTimer) clearInterval(appState.countdownTimer);
  appState.countdownTimer = setInterval(() => {
    if (appState.activeView === 'black-friday-live') drawCountdowns();
  }, 1000);

  const nowMs = Date.now();
  $('bf-timeline').innerHTML = d.events.map((ev) => {
    const start = Date.parse(ev.startsAt);
    const end = Date.parse(ev.endsAt);
    const status = nowMs >= start && nowMs <= end ? 'LIVE NOW' : nowMs > end ? 'Ended' : 'Upcoming';
    return `
      <div class="timeline-card ${status === 'LIVE NOW' ? 'is-live' : ''}">
        <div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:5px;">
          <strong>${esc(ev.name)}</strong>
          <span class="badge ${status === 'LIVE NOW' ? 'badge-exceptional' : status === 'Ended' ? 'badge-watch' : 'badge-great'}">${esc(status)}</span>
        </div>
        <div class="small muted tabular" style="margin-bottom:5px;">${esc(ev.startsAt.slice(0, 10))} → ${esc(ev.endsAt.slice(0, 10))}</div>
        <div class="small">${esc(ev.summary)}</div>
      </div>`;
  }).join('');

  let list = [];
  if (appState.bfSubtab === 'archived') {
    list = d.archivedDeals || [];
  } else {
    list = d.deals.filter((x) => {
      if (appState.bfSubtab === 'early') return x.isEarlyBlackFriday || x.isBlackFriday;
      if (appState.bfSubtab === 'cyber') return x.isCyberMonday;
      if (appState.bfSubtab === 'doorbuster') return x.isDoorbuster || (x.verifiedDiscountPct != null && x.verifiedDiscountPct >= 35);
      if (appState.bfSubtab === 'online') return x.localPickupKnightdale === 'online_only';
      if (appState.bfSubtab === 'local') return x.localPickupKnightdale === 'available' || x.localPickupKnightdale === 'check_store';
      return x.isBlackFriday || x.isEarlyBlackFriday || x.isCyberMonday || x.isDoorbuster || (x.verifiedDiscountPct != null && x.verifiedDiscountPct >= 25);
    });
  }

  $('bf-deals-grid').innerHTML = list.length
    ? list.slice(0, 60).map((deal) => renderDealCardHtml(deal)).join('')
    : `<div class="chart-empty" style="grid-column:1/-1;"><div class="chart-empty-title">No deals currently in this event filter</div><p class="muted">Deals populate automatically as verified holiday promotions go live.</p></div>`;
}

/* ==================== DEAL HUNTER VIEW ==================== */
function renderDealHunterView() {
  const d = appState.data;
  if (!d) return;
  const h = d.hunter || { learnedSignals: {}, recommendations: [] };
  const sig = h.learnedSignals || {};

  $('hunter-signals').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
      <span class="badge badge-great">Comfort Budget ≤ ${money(sig.comfortMaxBudget || 300)}</span>
      <span class="badge badge-exceptional">Saved Signals: ${esc(sig.savedCount || 0)}</span>
      <span class="badge badge-watch">Dismissed: ${esc(sig.rejectedCount || 0)}</span>
      ${(sig.preferredBrands || []).map((b) => `<span class="badge badge-local">Brand: ${esc(b)}</span>`).join('')}
      ${(sig.activeCategories || []).map((c) => `<span class="badge badge-good">Category: ${esc(c)}</span>`).join('')}
      ${!(sig.preferredBrands?.length || sig.activeCategories?.length) ? '<span class="small muted">Add items to your Family Wish Lists or save recommendations below to sharpen Deal Hunter learning.</span>' : ''}
    </div>`;

  let recs = h.recommendations || [];
  if (appState.hunterTag !== 'all') {
    recs = recs.filter((r) => (r.discoveryTags || []).includes(appState.hunterTag) || (appState.hunterTag === 'refurbished' && (r.discoveryTags || []).includes('open_box')));
  }

  $('hunter-grid').innerHTML = recs.length
    ? recs.slice(0, 40).map((rec) => renderDealCardHtml(rec.deal, {
        showHunterWhy: rec.whyFamilyWouldWantThis,
        hunterMeta: { saved: rec.saved, score: rec.hunterScore },
      })).join('')
    : '<div class="chart-empty" style="grid-column:1/-1;"><div class="chart-empty-title">No discoveries match this opportunity tag yet</div><p class="muted">Select "All Discoveries" or run a live sweep to scan for fresh family bargains.</p></div>';
}

/* ==================== COMPARE & SMARTER ALTERNATIVES VIEW ==================== */
async function renderCompareView() {
  const d = appState.data;
  if (!d) return;

  // 1. Smarter Alternatives selector
  const wlSel = $('alt-wishlist-select');
  if (!d.wishlist.length) {
    wlSel.innerHTML = '<option value="">Add a wish-list item first</option>';
    $('alternatives-stage').innerHTML = '<div class="chart-empty"><div class="chart-empty-title">No wish-list items yet</div><p class="muted">Add a product in "Our Wish Lists" to automatically discover Same Product Better Price, Better Product Similar Price, and Similar Product Much Lower Price alternatives.</p></div>';
  } else {
    wlSel.innerHTML = d.wishlist.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}${w.preferredPrice ? ` (Target ${money(w.preferredPrice)})` : ''}</option>`).join('');
    if (!appState.altWishlistId || !d.wishlist.some((w) => w.id === appState.altWishlistId)) {
      appState.altWishlistId = d.wishlist[0].id;
    }
    wlSel.value = appState.altWishlistId;

    try {
      const alts = await api(`/api/black-friday/alternatives/${encodeURIComponent(appState.altWishlistId)}`);
      const renderBucket = (title, kicker, items) => `
        <div style="margin-bottom:16px;">
          <div class="section-kicker">${esc(kicker)}</div>
          <h3 style="margin:2px 0 10px;">${esc(title)} (${items.length})</h3>
          ${items.length ? `<div class="deals-grid">${items.map((a) => `
            <div class="deal-card">
              <div class="deal-body">
                <div class="deal-meta-row">
                  <span class="retailer-tag">${esc(a.retailerName)}</span>
                  ${a.savings > 0 ? `<span class="badge badge-exceptional tabular">Save ${money(a.savings)}</span>` : '<span class="badge badge-great">Comparable Price</span>'}
                </div>
                <h4 class="deal-title">${esc(a.name)}</h4>
                <div class="tabular"><strong style="font-size:20px;color:var(--accent-emerald);">${money(a.currentPrice)}</strong> <span class="small muted">(Est. ${money(a.finalAllInTotal)} all-in)</span></div>
                <div class="deal-why"><strong>Why recommended:</strong> ${esc(a.reason)}</div>
                <div class="small"><strong>Differences:</strong> ${esc(a.differences)}</div>
                <div class="small" style="color:var(--accent-emerald);"><strong>Pros:</strong> ${esc((a.advantages || []).join(' · '))}</div>
                <div class="small muted"><strong>Cons:</strong> ${esc((a.disadvantages || []).join(' · '))}</div>
                <div class="deal-actions">
                  <a class="btn btn-primary btn-sm" href="${esc(a.retailerUrl)}" target="_blank" rel="noopener noreferrer">Open Offer ↗</a>
                  <button class="btn btn-sm" data-action="compare" data-deal-id="${esc(a.dealId)}" type="button">⚖️ Compare</button>
                </div>
              </div>
            </div>`).join('')}</div>` : `<div class="small muted">No verified live offers currently qualify for this bucket — the engine re-checks automatically every sweep.</div>`}
        </div>`;

      $('alternatives-stage').innerHTML =
        renderBucket('Same Product, Better Price', 'Identical Model / Identifier Cross-Retailer Savings', alts.same_better_price || []) +
        renderBucket('Better Product, Similar Price', 'Higher Verified Quality or Retail Tier at Comparable Cost', alts.better_similar_price || []) +
        renderBucket('Similar Product, Much Lower Price', 'Verified Lower-Cost Category Alternatives (≥ 20% Less)', alts.similar_lower_price || []);
    } catch (e) {
      $('alternatives-stage').innerHTML = `<div class="small muted">Could not load alternatives: ${esc(e.message)}</div>`;
    }
  }

  // 2. Side-by-side Comparison Matrix
  const addSel = $('compare-add-select');
  addSel.innerHTML = d.deals.slice(0, 80).map((x) => `<option value="${esc(x.id)}">${esc(x.retailerName)} — ${esc(x.title.slice(0, 62))} (${money(x.currentPrice)})</option>`).join('');

  const selectedDeals = appState.compareDealIds
    .map((id) => d.deals.find((x) => x.id === id))
    .filter(Boolean);

  const matrixEl = $('compare-matrix');
  if (!selectedDeals.length) {
    matrixEl.innerHTML = '<div class="chart-empty"><div class="chart-empty-title">Select 2 to 4 deals to compare side-by-side</div><p class="muted">Click the ⚖️ button on any deal card anywhere in the dashboard or add one from the dropdown above.</p></div>';
    return;
  }

  const rows = [
    ['Retailer', (x) => `<strong>${esc(x.retailerName)}</strong>`],
    ['Current Price', (x) => `<strong class="tabular" style="font-size:18px;color:var(--accent-emerald);">${money(x.currentPrice)}</strong>`],
    ['Normal Baseline', (x) => `<span class="tabular">${money(x.normalPrice)}</span><div class="small muted">${esc(x.baselineLabel)}</div>`],
    ['Verified Discount', (x) => x.verifiedDiscountPct != null ? `<span class="badge badge-${esc(x.tier)} tabular">${x.verifiedDiscountPct}% OFF (-${money(x.estimatedSavings)})</span>` : '<span class="badge badge-unverified">Unknown</span>'],
    ['Shipping + NC 7.25% Tax', (x) => `<span class="tabular">${x.shippingFree ? 'Free ship' : x.shippingCost != null ? money(x.shippingCost) : 'Verify'} + ${money(x.estimatedTax)} tax</span>`],
    ['Final Est. All-In Total', (x) => `<strong class="tabular">${money(x.finalAllInTotal)}</strong>${x.cashbackPercent ? `<div class="small" style="color:var(--accent-emerald);">After ~${x.cashbackPercent}% CB: ${money(x.effectiveAfterCashback)}</div>` : ''}`],
    ['Decision Score & Advice', (x) => `<strong class="tabular">${x.decision?.score ?? 0}/100</strong> · <span class="badge ${x.decision?.action === 'BUY NOW' ? 'badge-buy' : 'badge-wait'}">${esc(x.decision?.action || 'WAIT')}</span>`],
    ['Reviews & Quality', (x) => x.reviewData?.verifiedOwnerRating ? `★ ${x.reviewData.verifiedOwnerRating}/${x.reviewData.ratingScale || 5} (${x.reviewData.reviewCount || 0} verified)` : x.sourceScore != null ? `Community score ${x.sourceScore}` : '<span class="muted">Not retrieved</span>'],
    ['Local Pickup (27545)', (x) => esc(x.localPickupKnightdale.replace(/_/g, ' '))],
    ['Condition & Coupon', (x) => `${esc(x.condition)} ${x.couponCode ? `· Code ${esc(x.couponCode)}` : ''}`],
    ['Direct Link', (x) => `<a class="btn btn-sm btn-primary" href="${esc(x.retailerUrl)}" target="_blank" rel="noopener noreferrer">Open Store ↗</a> <button class="btn btn-sm btn-danger" data-action="compare" data-deal-id="${esc(x.id)}" type="button">Remove</button>`],
  ];

  matrixEl.innerHTML = `<div id="compare-bars-host" style="margin-bottom:14px;"></div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Attribute</th>${selectedDeals.map((x) => `<th>${esc(x.title.slice(0, 64))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, fn]) => `<tr><td><strong>${esc(label)}</strong></td>${selectedDeals.map((x) => `<td>${fn(x)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  renderRetailerCompareBars($('compare-bars-host'), selectedDeals);
}

/* ==================== LOCAL DEALS (KNIGHTDALE 27545) ==================== */
function renderLocalDealsView() {
  const d = appState.data;
  if (!d) return;

  const knightdaleRetailerIds = new Set(d.localStores.filter((s) => s.distanceMiles <= 2.5).map((s) => s.retailerId));
  const warehouseIds = new Set(['costco', 'samsclub']);

  let localDeals = d.deals.filter((x) => x.localPickupKnightdale === 'available' || x.localPickupKnightdale === 'check_store');
  if (appState.localTab === 'knightdale') localDeals = localDeals.filter((x) => knightdaleRetailerIds.has(x.retailerId));
  else if (appState.localTab === 'warehouse') localDeals = localDeals.filter((x) => warehouseIds.has(x.retailerId));
  else if (appState.localTab === 'pickup_verified') localDeals = localDeals.filter((x) => x.mentionsLocalPickup || x.localPickupKnightdale === 'available');

  $('local-deals-grid').innerHTML = localDeals.length
    ? localDeals.slice(0, 48).map((deal) => renderDealCardHtml(deal)).join('')
    : '<div class="chart-empty" style="grid-column:1/-1;"><div class="chart-empty-title">No local deals matched this filter right now</div><p class="muted">Switch to "All Triangle Chains" or check the verified Knightdale/Raleigh clearance links below.</p></div>';

  $('local-stores-grid').innerHTML = d.localStores.map((st) => `
    <div class="store-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <strong>${esc(st.branchName)}</strong>
        <span class="badge badge-local tabular">${esc(st.distanceMiles)} mi</span>
      </div>
      <div class="small muted">${esc(st.address)} · ${esc(st.area)}</div>
      <div class="deal-tags">
        ${st.pickup ? '<span class="badge badge-exceptional">Store Pickup</span>' : ''}
        ${st.sameDayDelivery ? '<span class="badge badge-great">Same-Day Delivery</span>' : ''}
        ${st.warehouseClub ? '<span class="badge badge-good">Warehouse Club</span>' : ''}
      </div>
      <div class="store-links">
        <a class="btn btn-sm btn-primary" href="${esc(st.storeUrl)}" target="_blank" rel="noopener noreferrer">Store Page ↗</a>
        <a class="btn btn-sm" href="${esc(st.clearanceUrl)}" target="_blank" rel="noopener noreferrer">Clearance ↗</a>
      </div>
    </div>`).join('');
}

/* ==================== PRICE HISTORY VIEW ==================== */
async function renderPriceHistoryView() {
  const d = appState.data;
  if (!d) return;

  const index = d.priceHistoryIndex || [];
  const dealByKey = new Map();
  for (const deal of d.deals) if (!dealByKey.has(deal.canonicalKey)) dealByKey.set(deal.canonicalKey, deal);

  const sel = $('history-product-select');
  if (!index.length) {
    sel.innerHTML = '<option value="">Awaiting first recorded observations</option>';
    renderPriceHistoryChart($('history-chart-host'), { entries: [] });
    $('history-table-host').innerHTML = '';
    return;
  }

  const sorted = [...index].sort((a, b) => b.observationsCount - a.observationsCount || Date.parse(b.latestObservedAt || 0) - Date.parse(a.latestObservedAt || 0));
  sel.innerHTML = sorted.slice(0, 120).map((row) => {
    const deal = dealByKey.get(row.canonicalKey);
    const label = deal ? `${deal.title.slice(0, 65)} (${row.observationsCount} obs · ${money(row.latestPrice)})` : `${row.canonicalKey} (${row.observationsCount} obs)`;
    return `<option value="${esc(row.canonicalKey)}">${esc(label)}</option>`;
  }).join('');

  if (!appState.historyKey || !sorted.some((r) => r.canonicalKey === appState.historyKey)) {
    appState.historyKey = sorted[0].canonicalKey;
  }
  sel.value = appState.historyKey;

  try {
    const hist = await api(`/api/black-friday/history/${encodeURIComponent(appState.historyKey)}?range=${encodeURIComponent(appState.historyRange)}`);
    const linkedDeal = dealByKey.get(appState.historyKey);
    const linkedWish = d.wishlist.find((w) => w.canonicalKey === appState.historyKey || w.bestOffer?.canonicalKey === appState.historyKey);

    renderPriceHistoryChart($('history-chart-host'), {
      entries: hist.entries,
      normalPrice: linkedDeal?.normalPrice ?? null,
      preferredPrice: linkedWish?.preferredPrice ?? null,
      honestyNote: hist.honestyNote,
    });

    $('history-table-host').innerHTML = hist.entries.length ? `
      <table class="data-table">
        <thead><tr><th>Observed Timestamp (ET)</th><th>Retailer</th><th>Price</th><th>Est. All-In</th><th>Source</th><th>Condition</th><th>Link</th></tr></thead>
        <tbody>${[...hist.entries].reverse().slice(0, 40).map((e) => `
          <tr>
            <td class="tabular">${esc(formatClock(e.observedAt))}</td>
            <td><strong>${esc(e.retailerName)}</strong></td>
            <td class="tabular"><strong>${money(e.price)}</strong></td>
            <td class="tabular">${money(e.allInTotal)}</td>
            <td class="small muted">${esc(e.sourceId)}</td>
            <td>${esc(e.condition || 'new')}</td>
            <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Open ↗</a>` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '';
  } catch (e) {
    $('history-chart-host').innerHTML = `<div class="chart-empty">${esc(e.message)}</div>`;
  }
}

/* ==================== ALERTS VIEW ==================== */
function renderAlertsView() {
  const d = appState.data;
  if (!d) return;

  const ch = d.alertChannels || {};
  const browserPerm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const cards = [
    ch.inDashboard,
    {
      label: 'Browser Push Notifications',
      active: browserPerm === 'granted',
      configured: browserPerm === 'granted',
      detail: browserPerm === 'granted' ? 'Browser permission GRANTED — click Send Test Alert to verify.' : browserPerm === 'denied' ? 'Blocked in browser settings.' : 'Click "Enable Browser Alerts" to activate.',
    },
    ch.email,
    ch.webhook,
  ].filter(Boolean);

  $('alert-channels-grid').innerHTML = cards.map((c) => `
    <div class="health-item ${c.active ? 'status-ok' : 'status-api_key_required'}">
      <div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;">
        <strong>${esc(c.label)}</strong>
        <span class="badge ${c.active ? 'badge-exceptional' : 'badge-good'}">${c.active ? 'Active' : 'Not Active'}</span>
      </div>
      <div class="muted">${esc(c.detail)}</div>
    </div>`).join('');

  const feed = $('alerts-feed');
  if (!d.alerts?.length) {
    feed.innerHTML = '<div class="chart-empty"><div class="chart-empty-title">No alerts triggered yet</div><p class="muted">Alerts trigger automatically when wish-list items drop ≥ 25%, hit target prices, reach historical lows, or when you click "Send Test Alert".</p></div>';
    return;
  }

  feed.innerHTML = d.alerts.map((a) => `
    <div class="alert-card ${a.read ? '' : 'is-unread'}">
      <div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
          <span class="badge ${a.severity === 'high' ? 'badge-exceptional' : 'badge-great'}">${esc(a.type.replace(/_/g, ' '))}</span>
          <strong>${esc(a.title)}</strong>
          ${!a.read ? '<span class="badge badge-danger">NEW</span>' : ''}
        </div>
        <div class="small">${esc(a.message)}</div>
        <div class="small muted tabular" style="margin-top:4px;">${esc(formatClock(a.triggeredAt))} · Delivered: ${esc((a.channelsDelivered || ['in_dashboard']).join(', '))}</div>
      </div>
      ${a.retailerUrl ? `<a class="btn btn-sm btn-primary" href="${esc(a.retailerUrl)}" ${a.retailerUrl.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>Open ↗</a>` : ''}
    </div>`).join('');
}

/* ==================== ALL STORES DIRECTORY VIEW ==================== */
function renderAllStoresView() {
  const d = appState.data;
  if (!d) return;

  const categories = [...new Set(d.storesDirectory.map((s) => s.category))];
  const catSel = $('stores-category-filter');
  const prevCat = appState.storeFilters.category;
  catSel.innerHTML = '<option value="all">All Store Categories</option>' + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  catSel.value = prevCat;

  let list = [...d.storesDirectory];
  if (appState.storeFilters.q.trim()) {
    const q = appState.storeFilters.q.trim().toLowerCase();
    list = list.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
  }
  if (appState.storeFilters.category !== 'all') list = list.filter((s) => s.category === appState.storeFilters.category);
  if (appState.storeFilters.status !== 'all') list = list.filter((s) => s.liveMonitoringStatus === appState.storeFilters.status);

  const grouped = new Map();
  for (const s of list) {
    const arr = grouped.get(s.category) || [];
    arr.push(s);
    grouped.set(s.category, arr);
  }

  const modeBadge = (mode) => {
    if (mode === 'direct_api_active') return '<span class="badge badge-exceptional">Direct API Active</span>';
    if (mode === 'direct_api_ready') return '<span class="badge badge-great">Live Feeds + API Ready</span>';
    if (mode === 'live_feed_aggregated') return '<span class="badge badge-great">Live Deal Feeds</span>';
    return '<span class="badge badge-watch">Directory Links Only</span>';
  };

  $('all-stores-container').innerHTML = [...grouped.entries()].map(([cat, stores]) => `
    <div style="margin-bottom:20px;">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--accent-cyan);">${esc(cat)} (${stores.length})</h3>
      <div class="stores-grid">${stores.map((s) => `
        <div class="store-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <strong>${esc(s.name)}</strong>
            ${modeBadge(s.liveMonitoringStatus)}
          </div>
          <div class="small muted tabular">
            Verified Deals: <strong>${esc(s.verifiedDealsCount)}</strong> · Wish-List Matches: <strong>${esc(s.matchingWishlistCount)}</strong>
            ${s.cashback ? ` · <span style="color:var(--accent-emerald);">~${esc(s.cashback.percent)}% CB</span>` : ''}
          </div>
          <div class="small muted">Last Check: ${esc(timeAgo(s.lastCheckedAt))}${s.localPresence ? ' · 📍 Local NC Store' : ''}</div>
          <div class="store-links">
            <a class="btn btn-sm btn-primary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Official Site ↗</a>
            ${s.dealsUrl ? `<a class="btn btn-sm" href="${esc(s.dealsUrl)}" target="_blank" rel="noopener noreferrer">Deals ↗</a>` : ''}
            ${s.blackFridayUrl ? `<a class="btn btn-sm" href="${esc(s.blackFridayUrl)}" target="_blank" rel="noopener noreferrer">Black Friday ↗</a>` : ''}
            ${s.storeFinderUrl ? `<a class="btn btn-sm" href="${esc(s.storeFinderUrl)}" target="_blank" rel="noopener noreferrer">27545 Stores ↗</a>` : ''}
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('') || '<div class="chart-empty">No retailers match your search.</div>';
}

/* ==================== SETTINGS & DIAGNOSTICS VIEW ==================== */
function renderSettingsView() {
  const d = appState.data;
  if (!d) return;
  const s = d.settings;
  const w = s.decisionWeights;

  $('settings-form-host').innerHTML = `
    <div class="intake-grid">
      <div class="field"><label for="set-zip">Primary ZIP Code</label><input id="set-zip" type="text" value="${esc(s.location.zip)}" /></div>
      <div class="field"><label for="set-tax">Estimated Sales Tax Rate (%)</label><input id="set-tax" type="number" step="0.01" value="${esc((s.location.salesTaxRate * 100).toFixed(2))}" /></div>
      <div class="field"><label for="set-budget">Total Holiday Budget ($)</label><input id="set-budget" type="number" value="${esc(s.budgets.totalHolidayBudget)}" /></div>

      <div class="field"><label for="set-t-exc">Exceptional Deal Threshold (%)</label><input id="set-t-exc" type="number" value="${esc(s.thresholds.exceptionalPct)}" /></div>
      <div class="field"><label for="set-t-great">Great Deal Threshold (%)</label><input id="set-t-great" type="number" value="${esc(s.thresholds.greatPct)}" /></div>
      <div class="field"><label for="set-t-good">Good Deal Threshold (%)</label><input id="set-t-good" type="number" value="${esc(s.thresholds.goodPct)}" /></div>

      <div class="field"><label for="set-alert-pct">Default Alert Trigger (% Off)</label><input id="set-alert-pct" type="number" value="${esc(s.alerts.defaultDiscountTriggerPct)}" /></div>
      <div class="field"><label for="set-quiet-start">Quiet Hours Start (ET)</label><input id="set-quiet-start" type="time" value="${esc(s.alerts.quietHoursStart)}" /></div>
      <div class="field"><label for="set-quiet-end">Quiet Hours End (ET)</label><input id="set-quiet-end" type="time" value="${esc(s.alerts.quietHoursEnd)}" /></div>

      <div class="field"><label for="set-email">Alert Email Recipient (requires RESEND_API_KEY)</label><input id="set-email" type="email" value="${esc(s.alerts.emailRecipient || '')}" placeholder="family@example.com" /></div>
      <div class="field"><label for="set-cadence-hp">High-Priority Cadence (min)</label><input id="set-cadence-hp" type="number" min="10" max="120" value="${esc(s.monitoring.highPriorityMinutes)}" /></div>
      <div class="field"><label for="set-cadence-std">Standard Cadence (min)</label><input id="set-cadence-std" type="number" min="15" max="360" value="${esc(s.monitoring.standardMinutes)}" /></div>

      <div class="span-3" style="padding-top:8px;border-top:1px solid var(--border-subtle);">
        <div class="section-kicker">Decision Engine Weights (Normalized Automatically)</div>
        <div class="intake-grid" style="margin-top:8px;">
          <div class="field"><label for="w-discount">Verified Discount (${esc(w.discount)}%)</label><input id="w-discount" type="number" min="0" max="100" value="${esc(w.discount)}" /></div>
          <div class="field"><label for="w-history">Historical Attractiveness (${esc(w.history)}%)</label><input id="w-history" type="number" min="0" max="100" value="${esc(w.history)}" /></div>
          <div class="field"><label for="w-quality">Product Quality (${esc(w.quality)}%)</label><input id="w-quality" type="number" min="0" max="100" value="${esc(w.quality)}" /></div>
          <div class="field"><label for="w-relevance">Wish-List Relevance (${esc(w.relevance)}%)</label><input id="w-relevance" type="number" min="0" max="100" value="${esc(w.relevance)}" /></div>
          <div class="field"><label for="w-allin">All-In Cost (${esc(w.allInCost)}%)</label><input id="w-allin" type="number" min="0" max="100" value="${esc(w.allInCost)}" /></div>
          <div class="field"><label for="w-avail">Availability (${esc(w.availability)}%)</label><input id="w-avail" type="number" min="0" max="100" value="${esc(w.availability)}" /></div>
          <div class="field"><label for="w-conf">Deal Confidence (${esc(w.confidence)}%)</label><input id="w-conf" type="number" min="0" max="100" value="${esc(w.confidence)}" /></div>
        </div>
      </div>
    </div>`;

  $('settings-diagnostics-host').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Source</th><th>Type</th><th>Status</th><th>HTTP</th><th>Deals Parsed</th><th>Latency</th><th>Last Success</th><th>Diagnostic / Error Detail</th></tr></thead>
      <tbody>${d.sourceHealth.map((src) => `
        <tr>
          <td><strong>${esc(src.name)}</strong><div class="small muted">${esc(src.category)}</div></td>
          <td class="small">${esc(src.kind)}</td>
          <td><span class="badge ${src.status === 'ok' ? 'badge-exceptional' : src.status === 'api_key_required' || src.status === 'pending' ? 'badge-good' : 'badge-danger'}">${esc(src.status.replace(/_/g, ' '))}</span></td>
          <td class="tabular">${esc(src.httpStatus ?? '—')}</td>
          <td class="tabular">${esc(src.dealsParsed)} / ${esc(src.itemsFetched)}</td>
          <td class="tabular">${src.latencyMs ? `${src.latencyMs}ms` : '—'}</td>
          <td class="small tabular">${esc(src.lastSuccessAt ? formatClock(src.lastSuccessAt) : 'Never')}</td>
          <td class="small muted">${esc(src.lastError || 'Healthy')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ==================== DEAL DETAIL MODAL ==================== */
async function openDealModal(dealId) {
  const modal = $('deal-modal');
  modal.hidden = false;
  $('deal-modal-body').innerHTML = '<div class="muted">Loading verified offer details &amp; price history…</div>';

  try {
    const res = await api(`/api/black-friday/deals/${encodeURIComponent(dealId)}`);
    const deal = res.deal;
    $('deal-modal-kicker').textContent = `${deal.retailerName} · Verified via ${deal.sourceName}`;
    $('deal-modal-title').textContent = deal.title;

    const rev = deal.reviewData;
    const revBlock = rev?.verifiedOwnerRating
      ? `<strong>${rev.verifiedOwnerRating}/${rev.ratingScale || 5}</strong> across ${rev.reviewCount ?? 'unknown'} verified owner reviews (${rev.source})${rev.metacriticScore ? ` · Metacritic ${rev.metacriticScore}/100` : ''}`
      : 'Independent owner review ratings were not retrieved from this source. No score is invented.';

    $('deal-modal-body').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:16px;">
        <div class="deal-price-box" style="margin:0;">
          <span class="price-now tabular">${money(deal.currentPrice)}</span>
          <span class="tabular">${deal.normalPrice ? `<span class="price-normal">${money(deal.normalPrice)}</span>` : '<span class="small muted">Baseline unknown</span>'}</span>
          <div class="price-breakdown tabular">
            <span>Discount: <strong>${deal.verifiedDiscountPct != null ? `${deal.verifiedDiscountPct}%` : 'Unverified'}</strong></span>
            <span>Shipping: <strong>${deal.shippingFree ? 'Free' : money(deal.shippingCost)}</strong></span>
            <span>Est. NC Tax: <strong>${money(deal.estimatedTax)}</strong></span>
            <span>Final Est. All-In: <strong>${money(deal.finalAllInTotal)}</strong></span>
          </div>
        </div>
        <div style="padding:12px;border-radius:12px;background:var(--bg-chip);border:1px solid var(--border-subtle);">
          <div class="section-kicker">Decision Engine (${esc(deal.decision?.score ?? 0)}/100 · ${esc(deal.decision?.evidenceCoveragePct ?? 0)}% Evidenced)</div>
          <div style="margin:4px 0;"><span class="badge ${deal.decision?.action === 'BUY NOW' ? 'badge-buy' : 'badge-wait'}">${esc(deal.decision?.action)}</span> <span class="small muted">${esc(deal.decision?.scoreConfidence?.replace(/_/g, ' '))}</span></div>
          <div class="small">${esc((deal.decision?.reasons || []).join(' '))}</div>
        </div>
      </div>

      <div style="margin-bottom:14px;padding:12px;border-radius:12px;background:var(--bg-chip);border:1px solid var(--border-subtle);">
        <div class="section-kicker">Real Product Reviews &amp; Quality Intelligence</div>
        <div class="small">${revBlock}</div>
      </div>

      <div style="margin-bottom:14px;">
        <div class="section-kicker">7-Factor Decision Score Breakdown (0 pts for unavailable evidence)</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Factor</th><th>Score</th><th>Evidenced</th><th>Basis</th></tr></thead>
          <tbody>${(deal.decision?.breakdown || []).map((b) => `
            <tr>
              <td><strong>${esc(b.factor)}</strong></td>
              <td class="tabular">${b.score} / ${b.max}</td>
              <td><span class="badge ${b.evidenced ? 'badge-exceptional' : 'badge-unverified'}">${b.evidenced ? 'Verified' : 'No Data'}</span></td>
              <td class="small muted">${esc(b.note)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      <div style="margin-bottom:14px;">
        <div class="section-kicker">Recorded Price History</div>
        <div id="modal-chart-host"></div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        ${deal.priceHistoryUrl ? `<a class="btn btn-sm" href="${esc(deal.priceHistoryUrl)}" target="_blank" rel="noopener noreferrer">CamelCamelCamel Chart ↗</a>` : ''}
        <a class="btn btn-primary" href="${esc(deal.retailerUrl)}" target="_blank" rel="noopener noreferrer">Open at ${esc(deal.retailerName)} ↗</a>
      </div>`;

    renderPriceHistoryChart($('modal-chart-host'), {
      entries: res.history || [],
      normalPrice: deal.normalPrice,
      honestyNote: (res.history || []).length < 2
        ? 'Recording real observations going forward. Historical prices are never fabricated.'
        : `Showing ${res.history.length} genuine timestamped observations.`,
    });
  } catch (e) {
    $('deal-modal-body').innerHTML = `<div class="banner-notice">${esc(e.message)}</div>`;
  }
}

/* ==================== RENDER DISPATCHER ==================== */
function renderActiveView() {
  renderSidebarBadges();
  switch (appState.activeView) {
    case 'command-center': renderCommandCenter(); break;
    case 'wishlists': renderWishlistsView(); break;
    case 'best-deals': renderBestDealsView(); break;
    case 'black-friday-live': renderBlackFridayLiveView(); break;
    case 'deal-hunter': renderDealHunterView(); break;
    case 'compare': void renderCompareView(); break;
    case 'local-deals': renderLocalDealsView(); break;
    case 'price-history': void renderPriceHistoryView(); break;
    case 'alerts': renderAlertsView(); break;
    case 'all-stores': renderAllStoresView(); break;
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
    toast(`Could not refresh live state: ${e.message}`);
  }
}

/* ==================== LIVE SSE STREAM ==================== */
function connectSse() {
  if (appState.sse) appState.sse.close();
  try {
    const es = new EventSource('/api/black-friday/stream');
    appState.sse = es;
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'sweep_started') {
          $('live-dot')?.classList.add('is-busy');
        } else if (msg.type === 'sweep_complete' || msg.type === 'wishlist_search_complete') {
          $('live-dot')?.classList.remove('is-busy');
          void fetchBootstrap();
          if (msg.alertsTriggered > 0) {
            toast(`🔔 ${msg.alertsTriggered} new deal alert(s) triggered!`);
          }
        } else if (msg.type === 'alert_created' && msg.alert) {
          void fetchBootstrap();
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification(msg.alert.title, { body: msg.alert.message, icon: '/black-friday/icon.svg' }); } catch {}
          }
        }
      } catch {}
    };
  } catch {}
}

/* ==================== GLOBAL EVENT BINDINGS ==================== */
function bindEvents() {
  // Sidebar navigation
  $('nav-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn[data-view]');
    if (btn) switchView(btn.dataset.view);
  });

  // Mobile menu drawer
  $('mobile-menu-btn').addEventListener('click', () => {
    $('sidebar').classList.toggle('is-open');
    $('sidebar-scrim').classList.toggle('is-open');
  });
  $('sidebar-scrim').addEventListener('click', () => {
    $('sidebar').classList.remove('is-open');
    $('sidebar-scrim').classList.remove('is-open');
  });

  // Topbar actions
  $('quick-add-btn').addEventListener('click', () => {
    switchView('wishlists');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('theme-toggle-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next, true);
  });

  const triggerManualRefresh = async (btn) => {
    if (btn) btn.disabled = true;
    toast('Scanning authorized retail feeds & wish-list items…');
    try {
      const out = await api('/api/black-friday/refresh', { method: 'POST', body: {} });
      if (out.dashboard) hydrateData(out.dashboard);
      toast(`Verified ${out.dealsFetched} offers across ${out.okSources} active sources (${out.observationsAdded} new history points).`);
    } catch (e) {
      toast(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  $('refresh-now-btn').addEventListener('click', (e) => triggerManualRefresh(e.currentTarget));
  $('diag-refresh-btn').addEventListener('click', (e) => triggerManualRefresh(e.currentTarget));

  // Modal close
  $('deal-modal-close').addEventListener('click', () => { $('deal-modal').hidden = true; });
  $('deal-modal').addEventListener('click', (e) => {
    if (e.target === $('deal-modal')) $('deal-modal').hidden = true;
  });

  // Delegated click handler for cards, buttons, goto links, wishlist actions
  document.addEventListener('click', async (e) => {
    const gotoBtn = e.target.closest('[data-goto]');
    if (gotoBtn) return switchView(gotoBtn.dataset.goto);

    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'detail') return openDealModal(actionEl.dataset.dealId);
      if (action === 'history') {
        appState.historyKey = actionEl.dataset.key;
        return switchView('price-history');
      }
      if (action === 'compare') {
        const id = actionEl.dataset.dealId;
        if (appState.compareDealIds.includes(id)) {
          appState.compareDealIds = appState.compareDealIds.filter((x) => x !== id);
          toast('Removed from comparison matrix.');
        } else {
          appState.compareDealIds = [...appState.compareDealIds.slice(-3), id];
          toast('Added to Compare Products matrix.');
        }
        savePrefs();
        return renderActiveView();
      }
      if (action === 'hunter-save' || action === 'hunter-reject') {
        const dealId = actionEl.dataset.dealId;
        try {
          const out = await api('/api/black-friday/hunter/feedback', {
            method: 'POST',
            body: { dealId, action: action === 'hunter-save' ? 'save' : 'reject', brand: actionEl.dataset.brand || '' },
          });
          if (appState.data) appState.data.hunter = out.hunter;
          toast(action === 'hunter-save' ? 'Saved! Deal Hunter will prioritize similar deals.' : 'Dismissed. Deal Hunter updated preferences.');
          renderDealHunterView();
        } catch (err) { toast(err.message); }
        return;
      }
      if (action === 'hunter-add-wl') {
        const deal = appState.data?.deals.find((x) => x.id === actionEl.dataset.dealId);
        if (!deal) return;
        try {
          const res = await api('/api/black-friday/wishlist', {
            method: 'POST',
            body: {
              name: deal.title,
              brand: deal.brand,
              modelNumber: deal.modelNumber,
              sourceUrl: deal.retailerUrl,
              imageUrl: deal.imageUrl,
              preferredPrice: deal.currentPrice,
              profileId: 'unassigned-ideas',
              searchImmediately: false,
            },
          });
          hydrateData(res.dashboard);
          toast('Added to Family Wish Lists!');
        } catch (err) { toast(err.message); }
        return;
      }
    }

    // Wish-list actions
    const wlSearch = e.target.closest('[data-wl-search]');
    if (wlSearch) {
      wlSearch.disabled = true;
      toast('Searching authorized live feeds for exact matches…');
      try {
        const out = await api(`/api/black-friday/wishlist/${encodeURIComponent(wlSearch.dataset.wlSearch)}/search`, { method: 'POST' });
        hydrateData(out.dashboard);
        toast(`Found ${out.matches.length} matching live offer(s) for "${out.item.name}".`);
      } catch (err) { toast(err.message); }
      finally { wlSearch.disabled = false; }
      return;
    }

    const wlAlts = e.target.closest('[data-wl-alts]');
    if (wlAlts) {
      appState.altWishlistId = wlAlts.dataset.wlAlts;
      return switchView('compare');
    }

    const wlDel = e.target.closest('[data-wl-delete]');
    if (wlDel) {
      try {
        const out = await api(`/api/black-friday/wishlist/${encodeURIComponent(wlDel.dataset.wlDelete)}`, { method: 'DELETE' });
        hydrateData(out.dashboard);
        toast('Removed item from wish list.');
      } catch (err) { toast(err.message); }
      return;
    }

    // Sub-tabs
    const intakeTab = e.target.closest('#intake-mode-tabs .pill-tab');
    if (intakeTab) {
      appState.intakeMode = intakeTab.dataset.intake;
      document.querySelectorAll('#intake-mode-tabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === intakeTab));
      renderIntakePanel();
      return;
    }

    const profTab = e.target.closest('#profile-tabs .pill-tab');
    if (profTab) {
      appState.selectedProfileId = profTab.dataset.profile;
      renderWishlistsView();
      return;
    }

    const bfTab = e.target.closest('#bf-subtabs .pill-tab');
    if (bfTab) {
      appState.bfSubtab = bfTab.dataset.bf;
      document.querySelectorAll('#bf-subtabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === bfTab));
      renderBlackFridayLiveView();
      return;
    }

    const hTab = e.target.closest('#hunter-filter-tabs .pill-tab');
    if (hTab) {
      appState.hunterTag = hTab.dataset.htag;
      document.querySelectorAll('#hunter-filter-tabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === hTab));
      renderDealHunterView();
      return;
    }

    const locTab = e.target.closest('#local-filter-tabs .pill-tab');
    if (locTab) {
      appState.localTab = locTab.dataset.local;
      document.querySelectorAll('#local-filter-tabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === locTab));
      renderLocalDealsView();
      return;
    }

    const rangeTab = e.target.closest('#history-range-tabs .pill-tab');
    if (rangeTab) {
      appState.historyRange = rangeTab.dataset.range;
      document.querySelectorAll('#history-range-tabs .pill-tab').forEach((t) => t.classList.toggle('is-active', t === rangeTab));
      void renderPriceHistoryView();
      return;
    }

    // URL Preview & Gift Idea Preview
    if (e.target.id === 'wl-url-preview-btn') {
      const url = $('wl-url-input')?.value?.trim();
      if (!url) return toast('Paste a product URL first.');
      const box = $('wl-url-preview-box');
      box.innerHTML = '<div class="small muted">Inspecting product URL politely…</div>';
      try {
        const res = await api('/api/black-friday/wishlist/inspect-url', { method: 'POST', body: { url } });
        box.innerHTML = `<div class="deal-why">
          <strong>${esc(res.name)}</strong> (${esc(res.retailerName)}) — Status: <span class="badge ${res.inspectionStatus === 'live_verified' ? 'badge-exceptional' : 'badge-good'}">${esc(res.inspectionStatus.replace(/_/g, ' '))}</span><br/>
          ${res.currentPrice != null ? `Verified Price: <strong>${money(res.currentPrice)}</strong> · ` : ''}${esc(res.note || '')}
        </div>`;
      } catch (err) {
        box.innerHTML = `<div class="small" style="color:var(--accent-rose);">${esc(err.message)}</div>`;
      }
      return;
    }

    if (e.target.id === 'wl-gift-match-btn') {
      const prompt = $('wl-gift-prompt')?.value?.trim();
      if (!prompt) return toast('Enter a gift idea first.');
      const host = $('wl-gift-results');
      try {
        const res = await api('/api/black-friday/wishlist/gift-idea', { method: 'POST', body: { prompt } });
        host.innerHTML = res.matches.length
          ? `<div class="section-kicker" style="margin-bottom:8px;">Matching Live Verified Deals (${res.matches.length})${res.parsedBudget ? ` · Under ${money(res.parsedBudget)}` : ''}</div>
             <div class="deals-grid">${res.matches.slice(0, 6).map((m) => renderDealCardHtml(m.deal)).join('')}</div>`
          : '<div class="small muted">No immediate matches under that exact criteria — save the gift idea so Deal Hunter monitors upcoming drops automatically.</div>';
      } catch (err) { toast(err.message); }
    }
  });

  // Wish-list status inline change
  document.addEventListener('change', async (e) => {
    if (e.target.classList.contains('wl-status-select')) {
      const id = e.target.dataset.wlId;
      try {
        const out = await api(`/api/black-friday/wishlist/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { status: e.target.value },
        });
        hydrateData(out.dashboard);
        toast(`Status updated to "${e.target.value.replace(/_/g, ' ')}".`);
      } catch (err) { toast(err.message); }
    }
    if (e.target.id === 'wl-ss-file' && e.target.files?.[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        const prev = $('wl-ss-preview');
        if (prev) prev.innerHTML = `<img src="${reader.result}" alt="Screenshot preview" style="max-height:140px;border-radius:10px;border:1px solid var(--border-glass);" />`;
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });

  // Intake form submissions
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.id === 'wl-manual-form') {
      e.preventDefault();
      try {
        const res = await api('/api/black-friday/wishlist', {
          method: 'POST',
          body: {
            name: $('wl-name').value.trim(),
            profileId: $('wl-profile').value,
            brand: $('wl-brand').value.trim() || null,
            modelNumber: $('wl-model').value.trim() || null,
            recipient: $('wl-recipient').value.trim(),
            preferredPrice: $('wl-pref-price').value || null,
            maxPrice: $('wl-max-price').value || null,
            priority: $('wl-priority').value,
            color: $('wl-color').value.trim() || null,
            requiredFeatures: $('wl-features').value.trim(),
            allowRefurbished: $('wl-allow-refurb').checked,
            allowOpenBox: $('wl-allow-openbox').checked,
            sourceType: 'manual',
          },
        });
        hydrateData(res.dashboard);
        form.reset();
        toast(`Added "${res.item.name}" — found ${res.item.matchedOffersCount} live offer(s)!`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'wl-url-form') {
      e.preventDefault();
      try {
        const res = await api('/api/black-friday/wishlist', {
          method: 'POST',
          body: {
            sourceType: 'url',
            sourceUrl: $('wl-url-input').value.trim(),
            profileId: $('wl-url-profile').value,
            recipient: $('wl-url-recipient').value.trim(),
            preferredPrice: $('wl-url-pref').value || null,
          },
        });
        hydrateData(res.dashboard);
        form.reset();
        toast(`Added "${res.item.name}" from retailer link!`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'wl-bulk-form') {
      e.preventDefault();
      try {
        const res = await api('/api/black-friday/wishlist/import', {
          method: 'POST',
          body: { mode: 'bulk', text: $('wl-bulk-text').value, profileId: $('wl-bulk-profile').value },
        });
        hydrateData(res.dashboard);
        form.reset();
        toast(`Imported ${res.addedCount} item(s)${res.skippedDuplicatesCount ? ` (${res.skippedDuplicatesCount} duplicates skipped)` : ''}.`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'wl-gift-form') {
      e.preventDefault();
      try {
        const res = await api('/api/black-friday/wishlist', {
          method: 'POST',
          body: {
            name: $('wl-gift-prompt').value.trim(),
            profileId: $('wl-gift-profile').value,
            sourceType: 'gift_idea',
            isGiftIdea: true,
          },
        });
        hydrateData(res.dashboard);
        form.reset();
        toast(`Saved gift idea & matched ${res.giftMatches?.matches?.length || 0} live deals!`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'wl-screenshot-form') {
      e.preventDefault();
      const file = $('wl-ss-file')?.files?.[0];
      if (!file) return;
      const b64 = await fileToBase64(file);
      try {
        const res = await api('/api/black-friday/wishlist/import', {
          method: 'POST',
          body: {
            mode: 'file',
            filename: file.name,
            mimeType: file.type,
            contentBase64: b64,
            extractedOcrText: $('wl-ss-text').value.trim(),
            profileId: $('wl-ss-profile').value,
          },
        });
        hydrateData(res.dashboard);
        form.reset();
        toast(`Uploaded screenshot and added ${res.addedCount} tracked item(s).`);
      } catch (err) { toast(err.message); }
    } else if (form.id === 'wl-file-form') {
      e.preventDefault();
      const file = $('wl-doc-file')?.files?.[0];
      if (!file) return;
      const b64 = await fileToBase64(file);
      try {
        const res = await api('/api/black-friday/wishlist/import', {
          method: 'POST',
          body: {
            mode: 'file',
            filename: file.name,
            mimeType: file.type,
            contentBase64: b64,
            profileId: $('wl-doc-profile').value,
            recipient: $('wl-doc-recipient').value.trim(),
          },
        });
        hydrateData(res.dashboard);
        form.reset();
        toast(`Imported ${res.addedCount} item(s) from ${file.name}.`);
      } catch (err) { toast(err.message); }
    }
  });

  // Profile creation
  $('new-profile-toggle').addEventListener('click', () => {
    const w = $('new-profile-form-wrap');
    w.style.display = w.style.display === 'none' ? 'block' : 'none';
  });
  $('np-cancel-btn').addEventListener('click', () => { $('new-profile-form-wrap').style.display = 'none'; });
  $('np-save-btn').addEventListener('click', async () => {
    const name = $('np-name').value.trim();
    if (!name) return toast('Enter a profile name.');
    try {
      const out = await api('/api/black-friday/profiles', { method: 'POST', body: { name, budget: Number($('np-budget').value) || 300 } });
      if (appState.data) appState.data.profiles = out.profiles;
      $('np-name').value = '';
      $('new-profile-form-wrap').style.display = 'none';
      renderWishlistsView();
      toast(`Created profile "${name}".`);
    } catch (err) { toast(err.message); }
  });

  $('wl-status-filter').addEventListener('change', (e) => {
    appState.wishlistStatusFilter = e.target.value;
    renderWishlistsView();
  });

  // Best Deals Filters (persistent)
  const syncDealFilters = () => {
    appState.filters = {
      q: $('filter-q').value,
      tier: $('filter-tier').value,
      retailer: $('filter-retailer').value,
      category: $('filter-category').value,
      sort: $('filter-sort').value,
      maxPrice: $('filter-max-price').value,
      freeShip: $('filter-free-ship').checked,
      newOnly: $('filter-new-only').checked,
      localOnly: $('filter-local-only').checked,
    };
    savePrefs();
    renderBestDealsView();
  };
  for (const id of ['filter-q', 'filter-tier', 'filter-retailer', 'filter-category', 'filter-sort', 'filter-max-price', 'filter-free-ship', 'filter-new-only', 'filter-local-only']) {
    $(id).addEventListener(id === 'filter-q' || id === 'filter-max-price' ? 'input' : 'change', syncDealFilters);
  }
  $('filter-reset-btn').addEventListener('click', () => {
    appState.filters = { q: '', tier: 'all', retailer: 'all', category: 'all', sort: 'score', maxPrice: '', freeShip: false, newOnly: false, localOnly: false };
    savePrefs();
    renderBestDealsView();
  });

  // Hunter Reset
  $('hunter-reset-btn').addEventListener('click', async () => {
    const out = await api('/api/black-friday/hunter/feedback', { method: 'POST', body: { dealId: 'all', action: 'reset' } });
    if (appState.data) appState.data.hunter = out.hunter;
    renderDealHunterView();
    toast('Reset dismissed Deal Hunter recommendations.');
  });

  // Compare selectors
  $('alt-wishlist-select').addEventListener('change', (e) => {
    appState.altWishlistId = e.target.value;
    void renderCompareView();
  });
  $('compare-add-btn').addEventListener('click', () => {
    const id = $('compare-add-select').value;
    if (!id) return;
    if (!appState.compareDealIds.includes(id)) appState.compareDealIds = [...appState.compareDealIds.slice(-3), id];
    savePrefs();
    void renderCompareView();
  });
  $('compare-clear-btn').addEventListener('click', () => {
    appState.compareDealIds = [];
    savePrefs();
    void renderCompareView();
  });

  // History product selector
  $('history-product-select').addEventListener('change', (e) => {
    appState.historyKey = e.target.value;
    void renderPriceHistoryView();
  });

  // Alerts controls
  $('enable-browser-push-btn').addEventListener('click', async () => {
    if (typeof Notification === 'undefined') return toast('Browser notifications are not supported in this browser.');
    const perm = await Notification.requestPermission();
    await api('/api/black-friday/settings', { method: 'PATCH', body: { alerts: { browserNotificationsEnabled: perm === 'granted' } } });
    await fetchBootstrap();
    toast(perm === 'granted' ? 'Browser notifications granted!' : `Browser notification status: ${perm}`);
  });
  $('send-test-alert-btn').addEventListener('click', async () => {
    try {
      const out = await api('/api/black-friday/alerts/test', { method: 'POST' });
      await fetchBootstrap();
      toast('Test alert delivered to dashboard!');
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(out.alert.title, { body: out.alert.message, icon: '/black-friday/icon.svg' });
      }
    } catch (err) { toast(err.message); }
  });
  $('mark-alerts-read-btn').addEventListener('click', async () => {
    await api('/api/black-friday/alerts/read', { method: 'POST', body: {} });
    await fetchBootstrap();
    toast('All alerts marked as read.');
  });

  // All Stores Filters
  $('stores-search').addEventListener('input', (e) => { appState.storeFilters.q = e.target.value; renderAllStoresView(); });
  $('stores-category-filter').addEventListener('change', (e) => { appState.storeFilters.category = e.target.value; renderAllStoresView(); });
  $('stores-status-filter').addEventListener('change', (e) => { appState.storeFilters.status = e.target.value; renderAllStoresView(); });

  // Settings Save
  $('save-settings-btn').addEventListener('click', async () => {
    try {
      const body = {
        location: {
          zip: $('set-zip').value.trim() || '27545',
          salesTaxRate: Math.max(0, Math.min(0.2, (Number($('set-tax').value) || 7.25) / 100)),
        },
        budgets: { totalHolidayBudget: Number($('set-budget').value) || 2500 },
        thresholds: {
          exceptionalPct: Number($('set-t-exc').value) || 40,
          greatPct: Number($('set-t-great').value) || 25,
          goodPct: Number($('set-t-good').value) || 15,
        },
        alerts: {
          defaultDiscountTriggerPct: Number($('set-alert-pct').value) || 25,
          quietHoursStart: $('set-quiet-start').value || '22:00',
          quietHoursEnd: $('set-quiet-end').value || '07:00',
          emailRecipient: $('set-email').value.trim(),
          emailEnabled: Boolean($('set-email').value.trim()),
        },
        monitoring: {
          highPriorityMinutes: Number($('set-cadence-hp').value) || 15,
          standardMinutes: Number($('set-cadence-std').value) || 90,
        },
        decisionWeights: {
          discount: Number($('w-discount').value) || 0,
          history: Number($('w-history').value) || 0,
          quality: Number($('w-quality').value) || 0,
          relevance: Number($('w-relevance').value) || 0,
          allInCost: Number($('w-allin').value) || 0,
          availability: Number($('w-avail').value) || 0,
          confidence: Number($('w-conf').value) || 0,
        },
      };
      const out = await api('/api/black-friday/settings', { method: 'PATCH', body });
      hydrateData(out.dashboard);
      toast('Settings saved & deal scores recalculated.');
    } catch (err) { toast(err.message); }
  });

  window.addEventListener('offline', () => { $('offline-banner').hidden = false; });
  window.addEventListener('online', () => { $('offline-banner').hidden = true; void fetchBootstrap(); });
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

/* ==================== BOOTSTRAP ==================== */
function boot() {
  loadPrefs();
  bindEvents();

  // Render cached snapshot immediately to eliminate loading screens
  try {
    const cached = JSON.parse(sessionStorage.getItem(STORAGE_CACHE_KEY) || 'null');
    if (cached && cached.kpis) {
      appState.data = cached;
      switchView(appState.activeView);
    }
  } catch {}

  if (!appState.data) switchView(appState.activeView);

  void fetchBootstrap();
  connectSse();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/black-friday/sw.js', { scope: '/black-friday/' }).catch(() => {});
  }
}

boot();
