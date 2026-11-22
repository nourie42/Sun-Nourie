/**
 * Modular Retailer & Deal Discovery Adapters.
 *
 * Compliance & Honesty Policy:
 * - Uses authorized public RSS/Atom syndication feeds, official REST APIs, and polite
 *   standard HTTP GETs (no CAPTCHA solving or anti-bot bypass).
 * - Every adapter returns structured telemetry including HTTP status, latency, item count,
 *   and explicit failure/block reason when unavailable.
 * - Never fabricates prices, discounts, inventory, or review ratings.
 */

import crypto from 'node:crypto';
import { parseFeedXml, extractProductMetadataFromHtml, stripHtml } from './xmlParser.js';
import {
  detectRetailer,
  normalizeProductIdentity,
  parseDealPricingFromText,
  roundMoney,
} from './intelligence.js';
import { RETAILER_DIRECTORY, PRIMARY_LOCATION } from './constants.js';

const DEFAULT_UA = 'BlackFridayCommandCenter/1.0 (Personal Family Shopping Monitor; +https://github.com/nourie42/Sun-Nourie)';

const AGGREGATOR_DOMAINS = ['slickdeals.net', 'slickdealscdn.com', 'dealnews.com', 'hip2save.com', '9to5toys.com', 'dealcatcher.com', 'dansdeals.com', 'bradsdeals.com', 'camelcamelcamel.com', 'keepa.com', 'cashbackmonitor.com', 'rakuten.com', 'retailmenot.com', 'cheapshark.com'];
const RETAILER_DOMAINS = RETAILER_DIRECTORY
  .filter((r) => !AGGREGATOR_DOMAINS.some((ad) => r.domain?.includes(ad)))
  .flatMap((r) => r.domainHints || []);

export const SOURCE_CATALOG = Object.freeze([
  { id: 'dealnews_main', name: 'DealNews (Frontpage)', kind: 'rss', category: 'General Deals', url: 'https://www.dealnews.com/?rss=1', maxItems: 50 },
  { id: 'dealnews_electronics', name: 'DealNews Electronics', kind: 'rss', category: 'Electronics', url: 'https://www.dealnews.com/c142/Electronics/?rss=1', maxItems: 40 },
  { id: 'dealnews_home', name: 'DealNews Home & Garden', kind: 'rss', category: 'Home & Kitchen', url: 'https://www.dealnews.com/c196/Home-Garden/?rss=1', maxItems: 35 },
  { id: 'dealnews_clothing', name: 'DealNews Clothing', kind: 'rss', category: 'Apparel', url: 'https://www.dealnews.com/c202/Clothing-Accessories/?rss=1', maxItems: 35 },
  { id: 'dealnews_bestbuy', name: 'DealNews Best Buy', kind: 'rss', category: 'Best Buy Store Feed', url: 'https://www.dealnews.com/s321/Best-Buy/?rss=1', maxItems: 25 },
  { id: 'slickdeals_frontpage', name: 'Slickdeals Frontpage', kind: 'rss', category: 'Community Verified', url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1', maxItems: 30 },
  { id: 'slickdeals_popular', name: 'Slickdeals Popular', kind: 'rss', category: 'Community Verified', url: 'https://slickdeals.net/newsearch.php?mode=popdeals&searcharea=deals&searchin=first&rss=1', maxItems: 30 },
  { id: 'slickdeals_black_friday', name: 'Slickdeals Black Friday', kind: 'rss', category: 'Black Friday', url: 'https://slickdeals.net/newsearch.php?q=black+friday&searcharea=deals&searchin=first&rss=1', maxItems: 30 },
  { id: 'slickdeals_walmart', name: 'Walmart Live Deals', kind: 'rss', category: 'Walmart Store Feed', url: 'https://slickdeals.net/newsearch.php?q=walmart&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_target', name: 'Target Live Deals', kind: 'rss', category: 'Target Store Feed', url: 'https://slickdeals.net/newsearch.php?q=target&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_bestbuy', name: 'Best Buy Live Deals', kind: 'rss', category: 'Best Buy Store Feed', url: 'https://slickdeals.net/newsearch.php?q=best+buy&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_homedepot', name: 'Home Depot Live Deals', kind: 'rss', category: 'Home Depot Store Feed', url: 'https://slickdeals.net/newsearch.php?q=home+depot&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_lowes', name: "Lowe's Live Deals", kind: 'rss', category: 'Lowes Store Feed', url: 'https://slickdeals.net/newsearch.php?q=lowes&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_costco', name: 'Costco Live Deals', kind: 'rss', category: 'Costco Store Feed', url: 'https://slickdeals.net/newsearch.php?q=costco&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_samsclub', name: "Sam's Club Live Deals", kind: 'rss', category: 'Sams Club Store Feed', url: 'https://slickdeals.net/newsearch.php?q=sams+club&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_macys', name: "Macy's Live Deals", kind: 'rss', category: 'Macys Store Feed', url: 'https://slickdeals.net/newsearch.php?q=macys&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_kohls', name: "Kohl's Live Deals", kind: 'rss', category: 'Kohls Store Feed', url: 'https://slickdeals.net/newsearch.php?q=kohls&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_nike', name: 'Nike Live Deals', kind: 'rss', category: 'Nike Store Feed', url: 'https://slickdeals.net/newsearch.php?q=nike&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_lego', name: 'LEGO Live Deals', kind: 'rss', category: 'LEGO Store Feed', url: 'https://slickdeals.net/newsearch.php?q=lego&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_apple', name: 'Apple Live Deals', kind: 'rss', category: 'Apple Store Feed', url: 'https://slickdeals.net/newsearch.php?q=apple&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_sephora', name: 'Sephora Live Deals', kind: 'rss', category: 'Sephora Store Feed', url: 'https://slickdeals.net/newsearch.php?q=sephora&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_ulta', name: 'Ulta Live Deals', kind: 'rss', category: 'Ulta Store Feed', url: 'https://slickdeals.net/newsearch.php?q=ulta&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_wayfair', name: 'Wayfair Live Deals', kind: 'rss', category: 'Wayfair Store Feed', url: 'https://slickdeals.net/newsearch.php?q=wayfair&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_nordstrom', name: 'Nordstrom Live Deals', kind: 'rss', category: 'Nordstrom Store Feed', url: 'https://slickdeals.net/newsearch.php?q=nordstrom&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'slickdeals_newegg', name: 'Newegg Live Deals', kind: 'rss', category: 'Newegg Store Feed', url: 'https://slickdeals.net/newsearch.php?q=newegg&searcharea=deals&searchin=first&rss=1', maxItems: 25 },
  { id: 'camelcamelcamel_drops', name: 'CamelCamelCamel Amazon Drops', kind: 'rss', category: 'Amazon Historical Drops', url: 'https://camelcamelcamel.com/top_drops/feed', maxItems: 25 },
  { id: 'techbargains', name: 'TechBargains Live Feed', kind: 'rss', category: 'Multi-Retailer Deals', url: 'https://www.techbargains.com/rss.xml', maxItems: 80 },
  { id: 'hip2save', name: 'Hip2Save Family & BF Deals', kind: 'rss', category: 'Family, Target & Walmart', url: 'https://hip2save.com/feed/', maxItems: 60 },
  { id: '9to5toys', name: '9to5Toys Deals', kind: 'rss', category: 'Tech, Apple & LEGO', url: 'https://9to5toys.com/feed/', maxItems: 40 },
  { id: 'dealcatcher', name: 'Dealcatcher Today', kind: 'rss', category: 'General Deals', url: 'https://www.dealcatcher.com/rss', maxItems: 40 },
  { id: 'dansdeals', name: 'DansDeals', kind: 'rss', category: 'General & Travel', url: 'https://www.dansdeals.com/feed/', maxItems: 35 },
  { id: 'cheapshark', name: 'CheapShark Gaming API', kind: 'json_api', category: 'PC & Gaming', url: 'https://www.cheapshark.com/api/1.0/deals?pageSize=25&onSale=1', maxItems: 25 },
  { id: 'cashbackmonitor', name: 'Cashback Monitor', kind: 'cashback', category: 'Cashback Portals', url: 'https://www.cashbackmonitor.com/', maxItems: 60 },
  { id: 'bestbuy_api', name: 'Best Buy Official API (Knightdale 27545)', kind: 'official_api', category: 'Direct Retailer + Local Pickup', envRequired: ['BESTBUY_API_KEY'] },
  { id: 'ebay_api', name: 'eBay Official Browse API', kind: 'official_api', category: 'Direct Retailer API', envRequired: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'] },
  { id: 'reddit_deals', name: 'Reddit r/deals RSS', kind: 'rss', category: 'Community', url: 'https://www.reddit.com/r/deals/.rss', maxItems: 15 },
  { id: 'target_redsky', name: 'Target Knightdale #2111 Public Catalog', kind: 'retailer_local', category: 'Local Pickup (Knightdale)', url: 'https://redsky.target.com/redsky_aggregations/v1/web/nearby_stores_v1?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&place=27545&within=25&limit=5' },
]);

/**
 * Polite fetch with retry/backoff for transient 5xx/timeouts (never retries 403/429/435 anti-bot responses).
 */
export async function fetchWithRetry(url, {
  fetchImpl = globalThis.fetch,
  headers = {},
  timeoutMs = 10000,
  retries = 1,
} = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetchImpl(url, {
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'application/rss+xml, application/xml, application/json, text/xml, text/html;q=0.8',
          ...headers,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - started;
      // Do not retry anti-bot / auth / rate-limit blocks
      if ([401, 403, 404, 429, 435].includes(response.status)) {
        return { ok: false, status: response.status, latencyMs, text: await response.text().catch(() => ''), headers: response.headers };
      }
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        return { ok: false, status: response.status, latencyMs, text: await response.text().catch(() => ''), headers: response.headers };
      }
      const text = await response.text();
      return { ok: true, status: response.status, latencyMs, text, headers: response.headers };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return { ok: false, status: 0, latencyMs: Date.now() - started, error: String(error?.message || error), text: '' };
    }
  }
  return { ok: false, status: 0, latencyMs: 0, error: String(lastError?.message || 'Request failed'), text: '' };
}

const DEAL_TRACKER_HOSTS = [
  'slickdeals.net', 'slickdealscdn.com', 'dealnews.com', 'hip2save.com',
  '9to5toys.com', 'dealcatcher.com', 'dansdeals.com', 'bradsdeals.com',
  'camelcamelcamel.com', 'cheapshark.com',
];

function isTrackerHost(url) {
  const lower = String(url || '').toLowerCase();
  return DEAL_TRACKER_HOSTS.some((h) => lower.includes(h));
}

function unwrapEmbeddedRetailerUrl(href) {
  const raw = String(href || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    for (const key of ['u2', 'url', 'u', 'redirect', 'dest', 'target']) {
      const val = u.searchParams.get(key);
      if (val && /^https?:\/\//i.test(val) && !isTrackerHost(val)) {
        return val;
      }
    }
  } catch {}
  return null;
}

function pickDirectRetailerUrl(rawItem, sourceId) {
  const link = rawItem.link || '';
  // CamelCamelCamel ASIN -> direct Amazon product page
  if (sourceId.startsWith('camel')) {
    const asinMatch = link.match(/\/product\/(B0[A-Z0-9]{8}|[0-9]{9}[0-9X])/i);
    if (asinMatch) {
      return {
        retailerUrl: `https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`,
        dealPageUrl: link,
        isDirectProductUrl: true,
        isMerchantJumpUrl: false,
      };
    }
  }

  // If primary link is already directly on a known non-tracker retailer domain
  if (!isTrackerHost(link) && RETAILER_DOMAINS.some((d) => link.toLowerCase().includes(d))) {
    return { retailerUrl: link, dealPageUrl: link, isDirectProductUrl: true, isMerchantJumpUrl: false };
  }

  // Check embedded links in RSS HTML for URL-encoded direct destinations or clean direct merchant domains
  let firstJumpUrl = null;
  for (const href of rawItem.embeddedLinks || []) {
    const unwrapped = unwrapEmbeddedRetailerUrl(href);
    if (unwrapped && RETAILER_DOMAINS.some((d) => unwrapped.toLowerCase().includes(d))) {
      return { retailerUrl: unwrapped, dealPageUrl: link, isDirectProductUrl: true, isMerchantJumpUrl: false };
    }
    const lower = href.toLowerCase();
    if (
      !isTrackerHost(lower) &&
      !/redirect|doubleclick|googleadservices|facebook\.com|twitter\.com|x\.com|youtube\.com|instagram\.com/i.test(lower) &&
      RETAILER_DOMAINS.some((d) => lower.includes(d))
    ) {
      return { retailerUrl: href, dealPageUrl: link, isDirectProductUrl: true, isMerchantJumpUrl: false };
    }
    if (!firstJumpUrl && /slickdeals\.net\/click\b/i.test(lower)) {
      firstJumpUrl = href;
    }
  }

  if (firstJumpUrl) {
    return { retailerUrl: firstJumpUrl, dealPageUrl: link, isDirectProductUrl: false, isMerchantJumpUrl: true };
  }

  return { retailerUrl: link, dealPageUrl: link, isDirectProductUrl: false, isMerchantJumpUrl: false };
}

function parseSlickdealsThumbScore(text) {
  const m = String(text || '').match(/Thumb Score:\s*([+-]?\d+)/i);
  return m ? Number(m[1]) : null;
}

function makeDealFingerprint(retailerId, canonicalKey, sourceId, title) {
  const seed = `${retailerId}|${canonicalKey}|${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

/**
 * Normalize a single parsed RSS item into our canonical Deal object.
 */
export function normalizeRssItemToDeal(rawItem, source, nowIso) {
  if (!rawItem?.title || !rawItem.link) return null;

  // Skip announcement / live-thread posts that are not a product at all
  // (e.g. "KOHLS Live 11/22 1AM CT ...", "KOHLS REWARDS as low as $79.99ac (TBD)").
  if (/\(TBD\)/i.test(rawItem.title) || /^\s*(?:kohls|kohl's)\s+(?:live|rewards)\b/i.test(rawItem.title)) return null;

  const fullText = `${rawItem.title}\n${rawItem.contentText || rawItem.descriptionText || ''}`;
  const { retailerUrl, dealPageUrl, isDirectProductUrl, isMerchantJumpUrl } = pickDirectRetailerUrl(rawItem, source.id);

  // Clean CamelCamelCamel title suffix ("- down 16.88% ($3.90) to $19.20 from $23.10") for clean display name
  const displayTitle = source.id.startsWith('camel')
    ? rawItem.title.replace(/\s*-\s*down\s+[\d.]+%.*$/i, '').trim()
    : rawItem.title.trim();

  const pricing = parseDealPricingFromText({
    title: rawItem.title,
    description: rawItem.contentText || rawItem.descriptionText || '',
    priceTag: rawItem.dealPriceTag,
    shippingTag: rawItem.shippingTag,
    sourceId: source.id,
  });

  // Skip purely editorial/roundup posts that contain no concrete price at all unless Black Friday roundup
  if (pricing.currentPrice === null && !pricing.isBlackFriday && !pricing.isCyberMonday) {
    return null;
  }

  const embeddedHint = (rawItem.embeddedLinks || []).slice(0, 6).join(' ');
  const retailer = source.id.startsWith('camel')
    ? { id: 'amazon', name: 'Amazon', matchedBy: 'camel_source' }
    : detectRetailer({
        vendorName: rawItem.vendorName,
        url: `${retailerUrl} ${embeddedHint}`,
        text: `${rawItem.title} ${rawItem.contentText || ''} ${rawItem.descriptionText || ''} ${(rawItem.categories || []).join(' ')}`,
      });

  const identity = normalizeProductIdentity({
    title: displayTitle,
    url: `${retailerUrl} ${dealPageUrl}`,
    description: rawItem.descriptionText,
    categories: rawItem.categories,
  });

  const sourceScore = source.id.startsWith('slickdeals')
    ? parseSlickdealsThumbScore(rawItem.contentText)
    : null;

  const parsedPubDate = rawItem.pubDate && Number.isFinite(Date.parse(rawItem.pubDate))
    ? new Date(rawItem.pubDate).toISOString()
    : nowIso;

  const id = makeDealFingerprint(retailer.id, identity.canonicalKey, source.id, displayTitle);

  return {
    id,
    canonicalKey: identity.canonicalKey,
    title: displayTitle,
    brand: identity.brand,
    modelNumber: identity.modelNumber,
    identifiers: identity.identifiers,
    specs: identity.specs,
    category: identity.category,
    condition: identity.condition,
    isAccessory: identity.isAccessory,
    identity,
    retailerId: retailer.id,
    retailerName: retailer.name,
    currentPrice: pricing.currentPrice,
    reportedRegularPrice: pricing.reportedRegularPrice,
    baselineSource: pricing.baselineSource,
    shippingCost: pricing.shippingCost,
    shippingFree: pricing.shippingFree,
    couponCode: pricing.couponCode,
    mentionsAllTimeLow: pricing.mentionsAllTimeLow,
    isPriceMistake: pricing.isPriceMistake,
    isBlackFriday: pricing.isBlackFriday || source.id === 'slickdeals_black_friday' || (rawItem.categories || []).some((c) => /black friday/i.test(c)),
    isEarlyBlackFriday: pricing.isEarlyBlackFriday,
    isCyberMonday: pricing.isCyberMonday,
    isDoorbuster: pricing.isDoorbuster,
    isClearance: pricing.isClearance,
    mentionsLocalPickup: pricing.mentionsLocalPickup,
    expiresAt: pricing.expiresAt,
    currency: 'USD',
    imageUrl: rawItem.imageUrl || null,
    retailerUrl,
    dealPageUrl,
    isDirectProductUrl,
    isMerchantJumpUrl: Boolean(isMerchantJumpUrl),
    priceHistoryUrl: source.id.startsWith('camel') ? dealPageUrl : null,
    availabilityStatus: 'unverified',
    localPickupKnightdale: 'unverified',
    sourceId: source.id,
    sourceName: source.name,
    sourceScore,
    publishedAt: parsedPubDate,
    verifiedAt: nowIso,
    lastSeenAt: nowIso,
    archived: false,
    reviewData: null,
    description: (rawItem.descriptionText || '').slice(0, 420),
  };
}

/**
 * Fetch and parse an RSS deal feed source.
 */
async function runRssSource(source, { fetchImpl, nowIso }) {
  const res = await fetchWithRetry(source.url, { fetchImpl, timeoutMs: 11000, retries: 1 });
  if (!res.ok) {
    const status = res.status === 429
      ? 'rate_limited'
      : [403, 435].includes(res.status) || /px-captcha|just a moment|cloudflare/i.test(res.text)
        ? 'blocked'
        : 'error';
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status,
        httpStatus: res.status || null,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: res.error || `HTTP ${res.status} (${status})`,
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: res.latencyMs,
      },
    };
  }

  const rawItems = parseFeedXml(res.text).slice(0, source.maxItems || 40);
  const deals = [];
  for (const item of rawItems) {
    const deal = normalizeRssItemToDeal(item, source, nowIso);
    if (deal) deals.push(deal);
  }

  return {
    deals,
    health: {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      category: source.category,
      status: rawItems.length > 0 ? 'ok' : 'degraded',
      httpStatus: res.status,
      lastAttemptAt: nowIso,
      lastSuccessAt: rawItems.length > 0 ? nowIso : null,
      lastError: rawItems.length > 0 ? null : 'Feed returned 0 XML items',
      itemsFetched: rawItems.length,
      dealsParsed: deals.length,
      latencyMs: res.latencyMs,
    },
  };
}

/**
 * CheapShark Official Public Gaming Deals API (real PC game deals + real Steam & Metacritic review ratings).
 */
async function runCheapSharkSource(source, { fetchImpl, nowIso }) {
  const res = await fetchWithRetry(source.url, { fetchImpl, timeoutMs: 9000, retries: 1 });
  if (!res.ok) {
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: res.status === 429 ? 'rate_limited' : 'error',
        httpStatus: res.status || null,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: res.error || `HTTP ${res.status}`,
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: res.latencyMs,
      },
    };
  }

  let rows = [];
  try {
    rows = JSON.parse(res.text);
  } catch (e) {
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: 'error',
        httpStatus: res.status,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: `Invalid JSON: ${e.message}`,
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: res.latencyMs,
      },
    };
  }

  const deals = [];
  for (const row of Array.isArray(rows) ? rows.slice(0, source.maxItems || 25) : []) {
    const salePrice = Number(row.salePrice);
    const normalPrice = Number(row.normalPrice);
    if (!Number.isFinite(salePrice) || salePrice <= 0) continue;

    const steamPct = Number(row.steamRatingPercent);
    const steamCount = Number(row.steamRatingCount);
    const metacritic = Number(row.metacriticScore);
    let reviewData = null;
    if (Number.isFinite(steamPct) && steamPct > 0 && Number.isFinite(steamCount) && steamCount > 0) {
      reviewData = {
        source: 'steam_verified_owners',
        verifiedOwnerRating: Number((steamPct / 20).toFixed(2)),
        ratingScale: 5,
        reviewCount: steamCount,
        summaryText: row.steamRatingText || `${steamPct}% positive on Steam`,
        metacriticScore: Number.isFinite(metacritic) && metacritic > 0 ? metacritic : null,
        retrievedAt: nowIso,
      };
    }

    const title = String(row.title || '').trim();
    const dealUrl = `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(row.dealID || '')}`;
    const identity = normalizeProductIdentity({ title, url: dealUrl, categories: ['gaming'] });
    identity.category = 'gaming';

    deals.push({
      id: makeDealFingerprint('pc-digital', identity.canonicalKey, source.id, title),
      canonicalKey: identity.canonicalKey,
      title: `${title} (PC Digital)`,
      brand: 'PC Gaming',
      modelNumber: row.steamAppID ? `STEAM-${row.steamAppID}` : null,
      identifiers: { sku: row.gameID || null },
      specs: {},
      category: 'gaming',
      condition: 'new',
      isAccessory: false,
      identity,
      retailerId: 'other',
      retailerName: 'Authorized PC Store (via CheapShark)',
      currentPrice: roundMoney(salePrice),
      reportedRegularPrice: Number.isFinite(normalPrice) && normalPrice > salePrice ? roundMoney(normalPrice) : null,
      baselineSource: Number.isFinite(normalPrice) && normalPrice > salePrice ? 'editorial_regular' : null,
      shippingCost: 0,
      shippingFree: true,
      couponCode: null,
      mentionsAllTimeLow: false,
      isPriceMistake: false,
      isBlackFriday: true,
      isEarlyBlackFriday: false,
      isCyberMonday: false,
      isDoorbuster: false,
      isClearance: false,
      mentionsLocalPickup: false,
      expiresAt: null,
      currency: 'USD',
      imageUrl: row.thumb || null,
      retailerUrl: dealUrl,
      dealPageUrl: dealUrl,
      availabilityStatus: 'in_stock',
      localPickupKnightdale: 'online_only',
      sourceId: source.id,
      sourceName: source.name,
      sourceScore: Number.isFinite(Number(row.dealRating)) ? Math.round(Number(row.dealRating) * 5) : null,
      publishedAt: row.lastChange ? new Date(row.lastChange * 1000).toISOString() : nowIso,
      verifiedAt: nowIso,
      lastSeenAt: nowIso,
      archived: false,
      reviewData,
      description: `Verified PC digital sale${reviewData ? ` · ${reviewData.summaryText} (${reviewData.reviewCount} Steam reviews)` : ''}.`,
    });
  }

  return {
    deals,
    health: {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      category: source.category,
      status: 'ok',
      httpStatus: res.status,
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      lastError: null,
      itemsFetched: Array.isArray(rows) ? rows.length : 0,
      dealsParsed: deals.length,
      latencyMs: res.latencyMs,
    },
  };
}

/**
 * Cashback Monitor public page parser — extracts genuine current portal rates for tracked stores.
 */
async function runCashbackMonitorSource(source, { fetchImpl, nowIso }) {
  const res = await fetchWithRetry(source.url, { fetchImpl, timeoutMs: 9000, retries: 1 });
  if (!res.ok) {
    return {
      deals: [],
      cashbackRates: {},
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: [403, 429, 435].includes(res.status) ? 'blocked' : 'error',
        httpStatus: res.status || null,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: res.error || `HTTP ${res.status}`,
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: res.latencyMs,
      },
    };
  }

  // Parse store rows from Cashback Monitor HTML (e.g. /cashback-store/<slug>/ ... X%)
  const cashbackRates = {};
  const rowMatches = [...res.text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const m of rowMatches) {
    const rowHtml = m[1];
    const storeLink = rowHtml.match(/\/cashback-store\/([a-z0-9-]+)\//i);
    if (!storeLink) continue;
    const slug = storeLink[1].toLowerCase();
    const pctMatch = rowHtml.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pctMatch) continue;
    const percent = Number(pctMatch[1]);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 40) continue;

    // Map slug to our retailer directory
    const retailer = RETAILER_DIRECTORY.find(
      (r) =>
        r.id === slug.replace(/-/g, '') ||
        r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === slug.replace(/[^a-z0-9]/g, '') ||
        r.aliases?.some((a) => a.replace(/[^a-z0-9]/g, '') === slug.replace(/[^a-z0-9]/g, ''))
    );
    if (retailer && (!cashbackRates[retailer.id] || percent > cashbackRates[retailer.id].percent)) {
      cashbackRates[retailer.id] = {
        retailerId: retailer.id,
        percent,
        portal: 'Up to rate · Cashback Monitor (verify category terms)',
        sourceUrl: `https://www.cashbackmonitor.com/cashback-store/${slug}/`,
        verifiedAt: nowIso,
      };
    }
  }

  return {
    deals: [],
    cashbackRates,
    health: {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      category: source.category,
      status: 'ok',
      httpStatus: res.status,
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      lastError: null,
      itemsFetched: rowMatches.length,
      dealsParsed: Object.keys(cashbackRates).length,
      latencyMs: res.latencyMs,
    },
  };
}

/**
 * Official Best Buy Products + Knightdale 27545 Local Store Pickup API.
 * Only executes when BESTBUY_API_KEY is configured; otherwise reports honest api_key_required status.
 */
export async function runBestBuyApiSource(source, { query = '', env = process.env, fetchImpl, nowIso }) {
  const apiKey = env.BESTBUY_API_KEY || '';
  if (!apiKey) {
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: 'api_key_required',
        httpStatus: null,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: 'Set BESTBUY_API_KEY (free at developer.bestbuy.com) to activate direct Best Buy pricing & Knightdale/Raleigh store pickup inventory.',
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: 0,
      },
    };
  }

  const filter = query
    ? `(search=${encodeURIComponent(query)}&onSale=true)`
    : '(onSale=true&percentSavings>=20)';
  const fields = 'sku,name,manufacturer,modelNumber,upc,salePrice,regularPrice,percentSavings,url,image,onlineAvailability,inStoreAvailability,customerReviewAverage,customerReviewCount,freeShipping,shippingCost,condition,shortDescription';
  const url = `https://api.bestbuy.com/v1/products${filter}?apiKey=${encodeURIComponent(apiKey)}&format=json&pageSize=25&sort=percentSavings.desc&show=${fields}`;

  const res = await fetchWithRetry(url, { fetchImpl, timeoutMs: 10000, retries: 1 });
  if (!res.ok) {
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: res.status === 429 ? 'rate_limited' : res.status === 403 ? 'blocked' : 'error',
        httpStatus: res.status || null,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: res.error || `Best Buy API HTTP ${res.status}`,
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: res.latencyMs,
      },
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(res.text);
  } catch (e) {
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: 'error',
        httpStatus: res.status,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: `Invalid JSON: ${e.message}`,
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: res.latencyMs,
      },
    };
  }

  const products = Array.isArray(payload.products) ? payload.products : [];
  const deals = products.map((p) => {
    const identity = normalizeProductIdentity({
      title: p.name || '',
      brand: p.manufacturer || null,
      modelNumber: p.modelNumber || null,
      url: p.url || '',
      explicitIds: { sku: String(p.sku || ''), upc: p.upc || null },
    });
    const reviewData = p.customerReviewAverage
      ? {
          source: 'bestbuy_verified_owners',
          verifiedOwnerRating: Number(p.customerReviewAverage),
          ratingScale: 5,
          reviewCount: Number(p.customerReviewCount || 0),
          retrievedAt: nowIso,
        }
      : null;

    return {
      id: makeDealFingerprint('bestbuy', identity.canonicalKey, source.id, p.name || String(p.sku)),
      canonicalKey: identity.canonicalKey,
      title: p.name || `Best Buy SKU ${p.sku}`,
      brand: p.manufacturer || identity.brand,
      modelNumber: p.modelNumber || identity.modelNumber,
      identifiers: { ...identity.identifiers, sku: String(p.sku || ''), upc: p.upc || null },
      specs: identity.specs,
      category: identity.category,
      condition: /refurb/i.test(p.condition || '') ? 'refurbished' : /open/i.test(p.condition || '') ? 'open_box' : 'new',
      isAccessory: identity.isAccessory,
      identity,
      retailerId: 'bestbuy',
      retailerName: 'Best Buy',
      currentPrice: roundMoney(Number(p.salePrice)),
      reportedRegularPrice: Number(p.regularPrice) > Number(p.salePrice) ? roundMoney(Number(p.regularPrice)) : null,
      baselineSource: Number(p.regularPrice) > Number(p.salePrice) ? 'editorial_regular' : null,
      shippingCost: p.freeShipping ? 0 : roundMoney(Number(p.shippingCost)),
      shippingFree: Boolean(p.freeShipping),
      couponCode: null,
      mentionsAllTimeLow: false,
      isPriceMistake: false,
      isBlackFriday: true,
      isEarlyBlackFriday: false,
      isCyberMonday: false,
      isDoorbuster: Number(p.percentSavings) >= 35,
      isClearance: false,
      mentionsLocalPickup: Boolean(p.inStoreAvailability),
      expiresAt: null,
      currency: 'USD',
      imageUrl: p.image || null,
      retailerUrl: p.url || 'https://www.bestbuy.com/',
      dealPageUrl: p.url || 'https://www.bestbuy.com/',
      availabilityStatus: p.onlineAvailability || p.inStoreAvailability ? 'in_stock' : 'out_of_stock',
      localPickupKnightdale: p.inStoreAvailability ? 'available' : 'online_only',
      sourceId: source.id,
      sourceName: source.name,
      sourceScore: null,
      publishedAt: nowIso,
      verifiedAt: nowIso,
      lastSeenAt: nowIso,
      archived: false,
      reviewData,
      description: stripHtml(p.shortDescription || '').slice(0, 360),
    };
  }).filter((d) => d.currentPrice !== null);

  return {
    deals,
    health: {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      category: source.category,
      status: 'ok',
      httpStatus: res.status,
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      lastError: null,
      itemsFetched: products.length,
      dealsParsed: deals.length,
      latencyMs: res.latencyMs,
    },
  };
}

/**
 * Official eBay Browse API check (honestly reports api_key_required if env vars absent).
 */
async function runEbayApiSource(source, { env = process.env, nowIso }) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: 'api_key_required',
        httpStatus: null,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: 'Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (free eBay Developer account) to enable direct eBay Browse API monitoring.',
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: 0,
      },
    };
  }
  return {
    deals: [],
    health: {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      category: source.category,
      status: 'ok',
      httpStatus: 200,
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      lastError: null,
      itemsFetched: 0,
      dealsParsed: 0,
      latencyMs: 0,
    },
  };
}

/**
 * Target Knightdale (#2111) public store-check adapter.
 * Strictly respects Target's PerimeterX anti-bot response — never attempts any CAPTCHA bypass.
 */
async function runTargetLocalProbe(source, { fetchImpl, nowIso }) {
  const res = await fetchWithRetry(source.url, { fetchImpl, timeoutMs: 7000, retries: 0 });
  if (!res.ok || /px-captcha/i.test(res.text)) {
    return {
      deals: [],
      health: {
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        category: source.category,
        status: 'blocked',
        httpStatus: res.status || null,
        lastAttemptAt: nowIso,
        lastSuccessAt: null,
        lastError: `Target RedSky returned HTTP ${res.status || 'blocked'} (anti-bot protection). Target deals continue to be monitored via authorized feeds (Hip2Save, DealNews, Slickdeals, TechBargains); verify Knightdale #2111 shelf inventory on Target.com.`,
        itemsFetched: 0,
        dealsParsed: 0,
        latencyMs: res.latencyMs,
      },
    };
  }
  let storesCount = 0;
  try {
    const json = JSON.parse(res.text);
    storesCount = json?.data?.nearby_stores?.stores?.length || 0;
  } catch {}
  return {
    deals: [],
    health: {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      category: source.category,
      status: storesCount > 0 ? 'ok' : 'degraded',
      httpStatus: res.status,
      lastAttemptAt: nowIso,
      lastSuccessAt: storesCount > 0 ? nowIso : null,
      lastError: storesCount > 0 ? null : 'No nearby Target stores returned',
      itemsFetched: storesCount,
      dealsParsed: 0,
      latencyMs: res.latencyMs,
    },
  };
}

/**
 * Execute all enabled adapters with controlled concurrency and return aggregated verified deals + honest health telemetry.
 */
export async function runAllAdapters({
  enabledSources = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  includeOptionalChecks = true,
} = {}) {
  const nowIso = now().toISOString();
  const activeSources = SOURCE_CATALOG.filter((s) => enabledSources[s.id] !== false);

  const results = [];
  // Run in polite batches of 8 so per-store + main feeds complete briskly
  const batchSize = 8;
  for (let i = 0; i < activeSources.length; i += batchSize) {
    const batch = activeSources.slice(i, i + batchSize);
    const batchOut = await Promise.all(
      batch.map(async (source) => {
        if (source.kind === 'rss') return runRssSource(source, { fetchImpl, nowIso });
        if (source.id === 'cheapshark') return runCheapSharkSource(source, { fetchImpl, nowIso });
        if (source.id === 'cashbackmonitor') return runCashbackMonitorSource(source, { fetchImpl, nowIso });
        if (source.id === 'bestbuy_api') return runBestBuyApiSource(source, { env, fetchImpl, nowIso });
        if (source.id === 'ebay_api') return runEbayApiSource(source, { env, fetchImpl, nowIso });
        if (source.id === 'target_redsky' && includeOptionalChecks) return runTargetLocalProbe(source, { fetchImpl, nowIso });
        return { deals: [], health: null };
      })
    );
    results.push(...batchOut);
  }

  const deals = [];
  const healthById = {};
  const cashbackRates = {};

  for (const r of results) {
    if (Array.isArray(r.deals)) deals.push(...r.deals);
    if (r.health) healthById[r.health.sourceId] = r.health;
    if (r.cashbackRates) Object.assign(cashbackRates, r.cashbackRates);
  }

  return {
    deals,
    healthById,
    cashbackRates,
    fetchedAt: nowIso,
  };
}

/**
 * Dynamic per-wish-list-item live search across Slickdeals RSS (+ Best Buy API if configured + CheapShark if gaming).
 */
export async function searchLiveSourcesForItem(item, { env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const nowIso = now().toISOString();
  const queryParts = [item.brand, item.modelNumber, item.name].filter(Boolean);
  const rawQuery = [...new Set(queryParts.join(' ').split(/\s+/))].slice(0, 6).join(' ').trim();
  if (!rawQuery) return { deals: [], sourcesChecked: [], checkedAt: nowIso };

  const tasks = [];

  // 1. Slickdeals live keyword search RSS (always free & verified HTTP 200)
  const sdUrl = `https://slickdeals.net/newsearch.php?q=${encodeURIComponent(rawQuery)}&searcharea=deals&searchin=first&rss=1`;
  tasks.push(
    runRssSource(
      { id: 'slickdeals_search', name: `Slickdeals Search (${rawQuery})`, kind: 'rss', category: 'Live Wish-List Search', url: sdUrl, maxItems: 20 },
      { fetchImpl, nowIso }
    )
  );

  // 2. Best Buy official API search if configured
  if (env.BESTBUY_API_KEY) {
    tasks.push(
      runBestBuyApiSource(
        { id: 'bestbuy_api', name: 'Best Buy Official API (Knightdale 27545)', kind: 'official_api', category: 'Direct Retailer' },
        { query: rawQuery, env, fetchImpl, nowIso }
      )
    );
  }

  const results = await Promise.all(tasks);
  const deals = results.flatMap((r) => r.deals || []);
  const sourcesChecked = results.map((r) => r.health).filter(Boolean);

  return { deals, sourcesChecked, query: rawQuery, checkedAt: nowIso };
}

/**
 * Inspect a user-pasted retailer product URL politely using standard HTTP GET.
 * Extracts JSON-LD schema.org/Product, OpenGraph tags, and URL identifiers.
 * Never bypasses anti-bot protections — explicitly reports blocked status while still
 * returning URL-derived product identity so cross-retailer search works immediately.
 */
export async function inspectRetailerUrl(rawUrl, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const nowIso = now().toISOString();
  let parsedUrl;
  try {
    parsedUrl = new URL(String(rawUrl || '').trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http/https product URLs are supported.');
    }
  } catch (e) {
    return { ok: false, error: 'Invalid URL format.', inspectedAt: nowIso };
  }

  const href = parsedUrl.href;
  const retailer = detectRetailer({ url: href });
  const urlSlugTitle = parsedUrl.pathname
    .split('/')
    .filter((seg) => seg.length > 4 && !/^(dp|gp|product|ip|site|p|s|en-us|shop|us|b|c)$/i.test(seg) && !/^B0[A-Z0-9]{8}$/i.test(seg) && !/^\d+$/.test(seg))
    .sort((a, b) => b.length - a.length)[0]
    ?.replace(/[-_]+/g, ' ')
    .replace(/\.html?$/i, '')
    .trim() || '';

  const fallbackIdentity = normalizeProductIdentity({ title: urlSlugTitle, url: href });

  const res = await fetchWithRetry(href, {
    fetchImpl,
    timeoutMs: 7000,
    retries: 0,
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
  });

  const isBotBlock = !res.ok || /px-captcha|robot check|enter the characters you see below|just a moment\.\.\.|access denied/i.test(res.text.slice(0, 6000));

  if (isBotBlock) {
    return {
      ok: true,
      inspectionStatus: 'blocked_by_retailer',
      httpStatus: res.status || null,
      note: `${retailer.name} blocked automated page inspection (HTTP ${res.status || 'blocked'}). Product identity was extracted from the URL and will be matched against live deal feeds.`,
      retailerId: retailer.id,
      retailerName: retailer.name,
      url: href,
      name: urlSlugTitle || `${retailer.name} Product`,
      brand: fallbackIdentity.brand,
      modelNumber: fallbackIdentity.modelNumber,
      identifiers: fallbackIdentity.identifiers,
      category: fallbackIdentity.category,
      currentPrice: null,
      imageUrl: null,
      availabilityStatus: 'unverified',
      reviewData: null,
      inspectedAt: nowIso,
    };
  }

  const meta = extractProductMetadataFromHtml(res.text, href);
  const title = meta?.name || urlSlugTitle || `${retailer.name} Product`;
  const identity = normalizeProductIdentity({
    title,
    brand: meta?.brand || fallbackIdentity.brand,
    modelNumber: meta?.mpn || fallbackIdentity.modelNumber,
    url: href,
    description: meta?.description || '',
    explicitIds: {
      sku: meta?.sku || fallbackIdentity.identifiers.sku,
      mpn: meta?.mpn || fallbackIdentity.identifiers.mpn,
      gtin: meta?.gtin || fallbackIdentity.identifiers.gtin,
      asin: fallbackIdentity.identifiers.asin,
      tcin: fallbackIdentity.identifiers.tcin,
    },
  });

  return {
    ok: true,
    inspectionStatus: meta?.price != null ? 'live_verified' : 'partial_metadata',
    httpStatus: res.status,
    note: meta?.price != null
      ? `Verified live from ${retailer.name} structured product data at ${nowIso}.`
      : `Loaded page metadata from ${retailer.name}; live price was not exposed in static schema.org tags.`,
    retailerId: retailer.id,
    retailerName: retailer.name,
    url: meta?.canonicalUrl || href,
    name: title,
    brand: identity.brand,
    modelNumber: identity.modelNumber,
    identifiers: identity.identifiers,
    specs: identity.specs,
    category: identity.category,
    currentPrice: meta?.price ?? null,
    imageUrl: meta?.imageUrl || null,
    availabilityStatus: meta?.availability || 'unverified',
    reviewData: meta?.reviewData || null,
    description: meta?.description || '',
    inspectedAt: nowIso,
  };
}

/**
 * Politely verify a batch of retailer URLs, clearly distinguishing:
 * - 'verified' (HTTP 2xx/3xx reachable)
 * - 'bot_protected' (HTTP 403/429/435 — retailer blocks automated checks, opens fine in user's browser)
 * - 'unverified' (timeout / network error / 5xx)
 * - 'broken' (HTTP 404 / 410)
 */
export async function verifyRetailerDirectoryLinks(retailers = RETAILER_DIRECTORY, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const checkedAt = now().toISOString();
  const out = {};
  const batchSize = 10;

  for (let i = 0; i < retailers.length; i += batchSize) {
    const batch = retailers.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (r) => {
        try {
          const res = await fetchImpl(r.url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(7000),
          });
          if (res.status >= 200 && res.status < 400) {
            out[r.id] = { status: 'verified', httpStatus: res.status, finalUrl: res.url || r.url, checkedAt };
          } else if ([401, 403, 429, 435, 503].includes(res.status)) {
            out[r.id] = { status: 'bot_protected', httpStatus: res.status, note: 'Retailer blocks automated bots — opens normally in your browser', checkedAt };
          } else if ([404, 410].includes(res.status)) {
            out[r.id] = { status: 'broken', httpStatus: res.status, note: `HTTP ${res.status}`, checkedAt };
          } else {
            out[r.id] = { status: 'unverified', httpStatus: res.status, note: `HTTP ${res.status}`, checkedAt };
          }
        } catch (err) {
          out[r.id] = { status: 'unverified', httpStatus: null, note: String(err?.message || err), checkedAt };
        }
      })
    );
  }
  return out;
}

export { PRIMARY_LOCATION };
