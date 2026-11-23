// "Before you buy" price check (Daniel, 2026-11-22): type any item and the
// system searches for the lowest current price it can actually reach:
//   1. this site's own live deals (matched by product identity), and
//   2. a fresh Slickdeals live search for that exact product.
// Store websites block automated price reads, and the Gemini key's web
// grounding quota returned 429 in testing, so results are labeled by source
// and every offer links out for a final tap-to-confirm at the store.
import { matchWishlistToDeal, parseDealPricingFromText, isVideoGameDeal } from './intelligence.js';

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

const DOMAIN_RETAILERS = [
  ['amazon.com', 'Amazon'], ['walmart.com', 'Walmart'], ['target.com', 'Target'],
  ['bestbuy.com', 'Best Buy'], ['kohls.com', "Kohl's"], ['homedepot.com', 'Home Depot'],
  ['lowes.com', "Lowe's"], ['costco.com', 'Costco'], ['samsclub.com', "Sam's Club"],
  ['academy.com', 'Academy Sports'], ['cabelas.com', "Cabela's"], ['barnesandnoble.com', 'Barnes & Noble'],
  ['macys.com', "Macy's"], ['nike.com', 'Nike'], ['newegg.com', 'Newegg'], ['ebay.com', 'eBay'],
  ['sharkninja.com', 'SharkNinja'], ['wayfair.com', 'Wayfair'], ['gamestop.com', 'GameStop'],
];

function guessRetailer(text) {
  const t = String(text || '');
  for (const [domain, name] of DOMAIN_RETAILERS) if (t.includes(domain)) return name;
  const m = t.match(/\bat ([A-Z][A-Za-z&.' ]{2,22}?)(?:\s*(?:\.|,|\||$))/);
  return m ? m[1].trim() : 'Store in post';
}

function xmlUnescape(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml || '').split(/<item>/).slice(1);
  for (const block of blocks) {
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? xmlUnescape(m[1]) : '';
    };
    const title = pick('title');
    const link = pick('link');
    const description = pick('description');
    if (title && link) items.push({ title, link, description });
    if (items.length >= 25) break;
  }
  return items;
}

function tokenSubsetMatch(query, title) {
  const stop = new Set(['the', 'a', 'an', 'for', 'with', 'and', 'of', 'in', 'on']);
  const qTokens = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !stop.has(w));
  if (qTokens.length < 2) return false;
  const t = String(title).toLowerCase();
  return qTokens.every((w) => t.includes(w));
}

export async function priceCheck({ query, myPrice = null }, { fetchImpl = fetch, deals = [] } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return { ok: false, error: 'Type at least a few letters of the product name.' };
  const cacheKey = `${q.toLowerCase()}|${myPrice ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  // New-condition only: a "lowest price" answer that leads with a
  // refurbished or resale unit is a wrong answer.
  const item = { name: q, allowRefurbished: false, allowOpenBox: false };
  const CONDITION_RE = /refurbished|renewed|refurb\b|resale|open[ -]?box|pre[ -]?owned|used\b/i;
  // Accessory guard: parts and add-ons (CREAMi pints, lids, blades...) are
  // not the product. Unless the shopper asked for the accessory itself, an
  // accessory can never be the "cheapest" answer (Daniel, 2026-11-22: a
  // $9.99 2-pack of CREAMi pints was crowned cheapest CREAMi).
  const ACCESSORY_RE = /\b(pints?|containers?|lids?|blades?|replacement|accessor\w*|compatible with|refills?)\b/i;
  const queryWantsAccessory = ACCESSORY_RE.test(q);
  const offers = [];
  const seen = new Set();
  const addOffer = (o) => {
    if (!o || !(o.price > 0) || !o.url) return;
    if (!queryWantsAccessory && ACCESSORY_RE.test(o.title || '')) return;
    if (CONDITION_RE.test(o.title || '')) return;
    const key = `${o.retailer}|${o.price}|${o.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    offers.push(o);
  };

  // 1) This site's live deals
  for (const deal of deals) {
    if (isVideoGameDeal(deal)) continue;
    let matched = false;
    try { matched = matchWishlistToDeal(item, deal).matched; } catch { matched = false; }
    if (!matched && !tokenSubsetMatch(q, deal.title)) continue;
    addOffer({
      retailer: deal.retailerName || 'Store',
      price: deal.finalAllInTotal ?? deal.currentPrice,
      url: deal.dealPageUrl || deal.retailerUrl,
      source: "This site's live deals",
      title: deal.displayTitle || deal.title,
    });
  }

  // 2) Slickdeals live search
  let sdError = null;
  try {
    const url = `https://slickdeals.net/newsearch.php?q=${encodeURIComponent(q)}&searcharea=deals&searchin=first&rss=1&pp=25`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    for (const rssItem of parseRssItems(xml)) {
      if (CONDITION_RE.test(rssItem.title)) continue;
      const pricing = parseDealPricingFromText({ title: rssItem.title, description: rssItem.description, sourceId: 'slickdeals_search' });
      if (!(pricing.currentPrice > 0)) continue;
      const pseudoDeal = { title: rssItem.title, description: rssItem.description, currentPrice: pricing.currentPrice };
      if (isVideoGameDeal(pseudoDeal)) continue;
      let matched = false;
      try { matched = matchWishlistToDeal(item, pseudoDeal).matched; } catch { matched = false; }
      if (!matched && !tokenSubsetMatch(q, rssItem.title)) continue;
      addOffer({
        retailer: guessRetailer(`${rssItem.title} ${rssItem.description}`),
        price: pricing.currentPrice,
        url: rssItem.link,
        source: 'Slickdeals live search (just now)',
        title: rssItem.title,
      });
    }
  } catch (e) {
    sdError = String(e?.message || e);
  }

  offers.sort((a, b) => a.price - b.price);
  const lowest = offers[0] || null;
  let verdict = null;
  if (!lowest) {
    verdict = 'No live offers found for that search. Try the exact product name or the model number (for example "Ninja CREAMi NC301").';
  } else if (myPrice !== null && myPrice > 0) {
    if (myPrice <= lowest.price + 0.005) verdict = `✅ Your price $${myPrice.toFixed(2)} is the lowest we found.`;
    else verdict = `⬇ Cheaper found: $${lowest.price.toFixed(2)} at ${lowest.retailer} — saves $${(myPrice - lowest.price).toFixed(2)} vs your price.`;
  } else {
    verdict = `Lowest found: $${lowest.price.toFixed(2)} at ${lowest.retailer}.`;
  }

  const result = {
    ok: true,
    query: q,
    checkedAt: new Date().toISOString(),
    offers: offers.slice(0, 12),
    lowest,
    myPrice,
    verdict,
    sourcesNote: "Checked this site's live deals and a fresh Slickdeals search. Store sites block automatic price reads, so tap a result to confirm the price at the store before buying.",
    sdError,
  };
  cache.set(cacheKey, { at: Date.now(), result });
  return result;
}
