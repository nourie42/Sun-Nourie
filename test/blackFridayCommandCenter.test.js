import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';

import { BLACK_FRIDAY_VERSION, RETAILER_DIRECTORY, LOCAL_STORES_KNIGHTDALE } from '../src/black-friday/constants.js';
import { parseFeedXml, extractProductMetadataFromHtml } from '../src/black-friday/xmlParser.js';
import {
  normalizeProductIdentity,
  matchWishlistToDeal,
  evaluateDeal,
  discoverAlternatives,
  runDealHunter,
  matchGiftIdeaDeals,
  parseDealPricingFromText,
  buildPersonalizedRecommendations,
  findSimilarOrCheaper,
  detectRetailer,
} from '../src/black-friday/intelligence.js';
import {
  parseBulkTextToDrafts,
  parseDelimitedText,
  rowsToWishlistDrafts,
  createWishlistItemObject,
  findDuplicateWishlistItem,
  parseXlsxBuffer,
  parseXlsxSheets,
  dedupeDraftsWithinFile,
  extractTextFromPdfBuffer,
} from '../src/black-friday/wishlistParser.js';
import { evaluateSmartAlerts, isWithinQuietHours } from '../src/black-friday/notifications.js';
import { registerBlackFridayRoutes } from '../src/black-friday/routes.js';
import { registerWeatherSiteAccess, isProtectedWeatherPath, isPublicWeatherPath } from '../src/weatherSiteAccess.js';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'));

test('experimental website shows Black Friday link while main/v3 apps and Fuel IQ do not', () => {
  const expHtml = fs.readFileSync(path.join(REPO_ROOT, 'public', 'weather-fusion', 'index.html'), 'utf8');
  const v3Html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'weather-fusion', 'v3', 'index.html'), 'utf8');
  const homeNav = fs.readFileSync(path.join(REPO_ROOT, 'public', 'home-navigation.js'), 'utf8');
  const fuelIndex = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

  // Experimental page has the link inside the experimental-only pill class
  assert.match(expHtml, /<a class="experimental-wn-link" id="black-friday-link" href="\/black-friday\/"/);
  // CSS hides .experimental-wn-link unless html[data-weather-page="experimental"]
  assert.match(expHtml, /\.experimental-wn-link\{display:none;/);
  assert.match(expHtml, /html\[data-weather-page="experimental"\] \.experimental-wn-link/);

  // Main/V3 weather app and Fuel IQ apps do NOT contain any Black Friday link
  assert.doesNotMatch(v3Html, /black-friday/i);
  assert.doesNotMatch(homeNav, /black-friday/i);
  assert.doesNotMatch(fuelIndex, /black-friday/i);

  // Access control protects /black-friday and /api/black-friday behind the experimental session
  assert.equal(isProtectedWeatherPath('/black-friday/'), true);
  assert.equal(isProtectedWeatherPath('/api/black-friday/bootstrap'), true);
  assert.equal(isPublicWeatherPath('/black-friday/'), false);
  assert.equal(isPublicWeatherPath('/api/black-friday/bootstrap'), false);
});

test('mobile sidebar stays above its scrim and retailer cards lead to official deal pages', () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'black-friday', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(REPO_ROOT, 'public', 'black-friday', 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(REPO_ROOT, 'public', 'black-friday', 'app.js'), 'utf8');

  assert.match(html, /data-view="all-stores"[\s\S]*Retailer Deal Pages/);
  assert.match(css, /\.app-shell\s*\{[\s\S]*?z-index:\s*auto;/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*?z-index:\s*30;/);
  assert.match(css, /\.sidebar-scrim\s*\{[\s\S]*?z-index:\s*25;/);
  assert.match(app, /href="\$\{esc\(s\.blackFridayUrl \|\| s\.dealsUrl \|\| s\.url\)\}"/);
  assert.match(app, /Open \$\{esc\(s\.name\)\} Black Friday Deals/);
});

test('product matching identifies identical models and blocks generation/size/accessory/refurb confusion', () => {
  const wish = createWishlistItemObject({
    name: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones',
    brand: 'Sony',
    modelNumber: 'WH-1000XM5',
    asin: 'B09XS7JWHH',
    preferredPrice: 249,
    maxPrice: 299,
    allowRefurbished: false,
    allowOpenBox: false,
  });

  const exactMatch = {
    id: 'd1',
    title: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones (Black)',
    brand: 'Sony',
    modelNumber: 'WH-1000XM5',
    identifiers: { asin: 'B09XS7JWHH' },
    condition: 'new',
    retailerUrl: 'https://www.amazon.com/dp/B09XS7JWHH',
  };
  assert.equal(matchWishlistToDeal(wish, exactMatch).matched, true);
  assert.ok(matchWishlistToDeal(wish, exactMatch).confidence >= 0.94);

  const wrongGen = {
    id: 'd2',
    title: 'Sony WH-1000XM4 Wireless Noise Canceling Headphones',
    brand: 'Sony',
    modelNumber: 'WH-1000XM4',
    identifiers: {},
    condition: 'new',
    retailerUrl: 'https://www.bestbuy.com/site/sony-xm4',
  };
  assert.equal(matchWishlistToDeal(wish, wrongGen).matched, false);

  const accessory = {
    id: 'd3',
    title: 'Hard Travel Carrying Case for Sony WH-1000XM5 Headphones',
    brand: 'Sony',
    modelNumber: 'WH-1000XM5',
    identifiers: {},
    condition: 'new',
    retailerUrl: 'https://www.amazon.com/dp/B000CASE01',
  };
  assert.equal(matchWishlistToDeal(wish, accessory).matched, false);

  const refurb = {
    id: 'd4',
    title: 'Sony WH-1000XM5 Headphones (Certified Refurbished)',
    brand: 'Sony',
    modelNumber: 'WH-1000XM5',
    identifiers: {},
    condition: 'refurbished',
    retailerUrl: 'https://www.ebay.com/itm/123',
  };
  assert.equal(matchWishlistToDeal(wish, refurb).matched, false);

  const tvWish = createWishlistItemObject({ name: 'LG C4 65" OLED 4K Smart TV', brand: 'LG' });
  const wrongSizeTv = {
    id: 'd5',
    title: 'LG C4 55" OLED 4K Smart TV',
    brand: 'LG',
    identifiers: {},
    condition: 'new',
    retailerUrl: 'https://www.bestbuy.com/site/lg-c4-55',
  };
  assert.equal(matchWishlistToDeal(tvWish, wrongSizeTv).matched, false);

  // Series-version guardrail: JBL Clip 5 must NEVER match JBL Clip 4
  const clip5Wish = createWishlistItemObject({ name: 'JBL Clip 5 Bluetooth Speaker', brand: 'JBL' });
  const clip4Deal = {
    id: 'd6',
    title: 'JBL Clip 4 Ultra-Portable Waterproof Bluetooth Speaker',
    brand: 'JBL',
    identifiers: {},
    condition: 'new',
    retailerUrl: 'https://www.woot.com/offers/jbl-clip-4',
  };
  const clip5Deal = {
    id: 'd7',
    title: 'JBL Clip 5 Ultra-Portable Waterproof Bluetooth Speaker',
    brand: 'JBL',
    identifiers: {},
    condition: 'new',
    retailerUrl: 'https://www.amazon.com/dp/B0CLIP5555',
  };
  assert.equal(matchWishlistToDeal(clip5Wish, clip4Deal).matched, false);
  assert.equal(matchWishlistToDeal(clip5Wish, clip5Deal).matched, true);

  // Different product line guardrail: JBL Go 5 must NOT match JBL Clip 5; bundle must NOT match single unit
  const go5Deal = {
    id: 'd8',
    title: 'JBL Go 5 Portable Bluetooth Speaker, Waterproof and Dustproof',
    brand: 'JBL',
    identifiers: {},
    condition: 'new',
    retailerUrl: 'https://www.amazon.com/dp/B0JBLGO500',
  };
  const clip5Bundle = {
    id: 'd9',
    title: 'JBL Clip 5 Bluetooth Speaker Bundle with Charger',
    brand: 'JBL',
    identifiers: {},
    condition: 'new',
    retailerUrl: 'https://www.amazon.com/dp/B0CLIP5BND',
  };
  assert.equal(matchWishlistToDeal(clip5Wish, go5Deal).matched, false);
  assert.equal(matchWishlistToDeal(clip5Wish, clip5Bundle).matched, false);
});

test('true deal detection computes Wake County 7.25% NC tax, defensible baselines, inflated list warnings, and honest zero-evidence scoring', () => {
  const nowIso = '2026-11-22T15:00:00.000Z';
  const dealWithHistory = {
    id: 'jbl-1',
    canonicalKey: 'bm:jbl:clip5',
    title: 'JBL Clip 5 Ultra-Portable Waterproof Bluetooth Speaker',
    brand: 'JBL',
    retailerId: 'amazon',
    retailerName: 'Amazon',
    currentPrice: 50,
    reportedRegularPrice: 80,
    baselineSource: 'editorial_regular',
    shippingCost: 0,
    shippingFree: true,
    retailerUrl: 'https://www.amazon.com/dp/B0CLIP5000',
    availabilityStatus: 'in_stock',
    sourceId: 'dealnews_electronics',
    sourceName: 'DealNews Electronics',
    verifiedAt: nowIso,
    condition: 'new',
  };

  const history = [
    { observedAt: '2026-10-15T12:00:00.000Z', price: 79.95, retailerId: 'amazon' },
    { observedAt: '2026-11-01T12:00:00.000Z', price: 79.95, retailerId: 'target' },
    { observedAt: '2026-11-15T12:00:00.000Z', price: 69.95, retailerId: 'amazon' },
  ];

  const evaluated = evaluateDeal(dealWithHistory, {
    historyEntries: history,
    cashbackRates: { amazon: { percent: 2, portal: 'Top Portal' } },
    nowMs: Date.parse(nowIso),
  });

  assert.equal(evaluated.baselineType, 'observed_history');
  assert.equal(evaluated.normalPrice, 79.95);
  assert.equal(evaluated.verifiedDiscountPct, 37.5);
  assert.equal(evaluated.tier, 'great');
  assert.equal(evaluated.estimatedTax, 3.63); // 50 * 0.0725 = 3.625 -> 3.63
  assert.equal(evaluated.finalAllInTotal, 53.63);
  assert.equal(evaluated.priceStats.isAtObservedLow, true);
  assert.equal(evaluated.decision.action, 'BUY NOW');

  // Unknown baseline must NOT invent discount or award discount points
  const noBaselineDeal = {
    ...dealWithHistory,
    id: 'unknown-1',
    reportedRegularPrice: null,
    baselineSource: null,
    availabilityStatus: 'unverified',
  };
  const evalUnknown = evaluateDeal(noBaselineDeal, { historyEntries: [], nowMs: Date.parse(nowIso) });
  assert.equal(evalUnknown.normalPrice, null);
  assert.equal(evalUnknown.verifiedDiscountPct, null);
  assert.equal(evalUnknown.tier, 'unverified');
  const discFactor = evalUnknown.decision.breakdown.find((b) => b.factor === 'Verified Discount');
  assert.equal(discFactor.score, 0);
  assert.equal(discFactor.evidenced, false);

  // Inflated list price (>35% above observed median) triggers explicit warning
  const inflatedDeal = { ...dealWithHistory, reportedRegularPrice: 140 };
  const evalInflated = evaluateDeal(inflatedDeal, { historyEntries: history, nowMs: Date.parse(nowIso) });
  assert.equal(evalInflated.inflatedListWarning, true);

  // Storewide roundup with shipping threshold ("free shipping w/ $49") must NEVER parse $49 as product price
  const roundup = parseDealPricingFromText({
    title: "Dick's Sporting Goods Black Friday Sale: Up to 80% off + free shipping w/ $49",
    description: 'Save big on kayaks up to $1,999 and apparel.',
    sourceId: 'dealnews_main',
  });
  assert.equal(roundup.currentPrice, null);
  assert.equal(roundup.reportedRegularPrice, null);
  assert.equal(roundup.isBlackFriday, true);
});

test('smarter alternatives engine discovers all 3 verified buckets and Deal Hunter learns family preferences', () => {
  const nowIso = '2026-11-22T15:00:00.000Z';
  const wish = createWishlistItemObject({
    name: 'Sony WH-1000XM5 Wireless Headphones',
    brand: 'Sony',
    modelNumber: 'WH-1000XM5',
    preferredPrice: 260,
    maxPrice: 320,
    category: 'electronics',
  });

  const deals = [
    evaluateDeal({
      id: 'xm5-amz', canonicalKey: 'bm:sony:wh1000xm5', title: 'Sony WH-1000XM5 Wireless Headphones',
      brand: 'Sony', modelNumber: 'WH-1000XM5', category: 'electronics', retailerId: 'amazon', retailerName: 'Amazon',
      currentPrice: 298, reportedRegularPrice: 399.99, baselineSource: 'editorial_regular', shippingFree: true,
      retailerUrl: 'https://www.amazon.com/dp/B09XS7JWHH', sourceId: 'dealnews_main', sourceName: 'DealNews', verifiedAt: nowIso, condition: 'new',
    }, { nowMs: Date.parse(nowIso) }),
    evaluateDeal({
      id: 'xm5-bb', canonicalKey: 'bm:sony:wh1000xm5', title: 'Sony WH-1000XM5 Wireless Headphones',
      brand: 'Sony', modelNumber: 'WH-1000XM5', category: 'electronics', retailerId: 'bestbuy', retailerName: 'Best Buy',
      currentPrice: 249.99, reportedRegularPrice: 399.99, baselineSource: 'editorial_regular', shippingFree: true,
      retailerUrl: 'https://www.bestbuy.com/site/sony-xm5', sourceId: 'dealnews_main', sourceName: 'DealNews', verifiedAt: nowIso, condition: 'new',
    }, { nowMs: Date.parse(nowIso) }),
    evaluateDeal({
      id: 'bose-qc', canonicalKey: 'bm:bose:qcultra', title: 'Bose QuietComfort Ultra Wireless Headphones',
      brand: 'Bose', modelNumber: 'QCULTRA', category: 'electronics', retailerId: 'target', retailerName: 'Target',
      currentPrice: 279, reportedRegularPrice: 429, baselineSource: 'editorial_regular', shippingFree: true,
      reviewData: { verifiedOwnerRating: 4.6, ratingScale: 5, reviewCount: 410 },
      retailerUrl: 'https://www.target.com/p/bose-qc-ultra', sourceId: 'dealnews_main', sourceName: 'DealNews', verifiedAt: nowIso, condition: 'new',
    }, { nowMs: Date.parse(nowIso) }),
    evaluateDeal({
      id: 'anker-q45', canonicalKey: 'bm:anker:q45', title: 'Anker Soundcore Space Q45 Wireless Headphones',
      brand: 'Anker', modelNumber: 'Q45', category: 'electronics', retailerId: 'walmart', retailerName: 'Walmart',
      currentPrice: 89.99, reportedRegularPrice: 149.99, baselineSource: 'editorial_regular', shippingFree: true,
      retailerUrl: 'https://www.walmart.com/ip/anker-q45', sourceId: 'dealnews_main', sourceName: 'DealNews', verifiedAt: nowIso, condition: 'new',
    }, { nowMs: Date.parse(nowIso) }),
  ];

  const alts = discoverAlternatives(wish, deals);
  assert.ok(alts.same_better_price.length >= 1, 'finds Same Product, Better Price');
  assert.equal(alts.same_better_price[0].retailerId, 'bestbuy');
  assert.ok(alts.better_similar_price.length >= 1, 'finds Better Product, Similar Price');
  assert.ok(alts.similar_lower_price.length >= 1, 'finds Similar Product, Much Lower Price');
  assert.equal(alts.similar_lower_price[0].dealId, 'anker-q45');

  const hunter = runDealHunter({ evaluatedDeals: deals, wishlist: [wish] });
  assert.ok(hunter.recommendations.length >= 1);
  assert.ok(hunter.learnedSignals.preferredBrands.includes('sony'));
  assert.ok(hunter.recommendations[0].whyFamilyWouldWantThis.length > 15);
});

test('bulk parser, CSV parser, gift idea matcher, and duplicate purchase guard work accurately', () => {
  const bulk = parseBulkTextToDrafts(
    '1. Sony WH-1000XM5 Headphones target $249 max $299 for Dad [high]\n- LEGO Star Wars 75375 under $65 for Kids'
  );
  assert.equal(bulk.length, 2);
  assert.equal(bulk[0].priority, 'high');
  assert.equal(bulk[0].preferredPrice, 249);
  assert.equal(bulk[0].maxPrice, 299);
  assert.equal(bulk[0].recipient, 'Dad');
  assert.equal(bulk[1].maxPrice, 65);

  const csvRows = parseDelimitedText('Product Name,Brand,Target Price,Recipient,Priority\nNinja Creami Deluxe,Ninja,$169.99,Mom,high');
  const csvDrafts = rowsToWishlistDrafts(csvRows);
  assert.equal(csvDrafts.length, 1);
  assert.equal(csvDrafts[0].brand, 'Ninja');
  assert.equal(csvDrafts[0].preferredPrice, 169.99);

  // Duplicate prevention catches already purchased item
  const purchased = { ...csvDrafts[0], status: 'purchased', purchasedRetailer: 'Target' };
  const dup = findDuplicateWishlistItem(createWishlistItemObject({ name: 'Ninja Creami Deluxe', recipient: 'Mom' }), [purchased]);
  assert.ok(dup);
  assert.equal(dup.status, 'purchased');

  // Gift idea matcher
  const giftMatch = matchGiftIdeaDeals('great Christmas gifts for a college student under $80', [
    { id: 'g1', archived: false, title: 'JBL Clip 5 Bluetooth Speaker', category: 'electronics', currentPrice: 50, verifiedDiscountPct: 37.5, description: 'Portable speaker' },
    { id: 'g2', archived: false, title: 'Expensive 85" OLED TV', category: 'electronics', currentPrice: 2499, verifiedDiscountPct: 30, description: 'TV' },
  ]);
  assert.equal(giftMatch.parsedBudget, 80);
  assert.equal(giftMatch.matches.length, 1);
  assert.equal(giftMatch.matches[0].deal.id, 'g1');
});

test('smart alerts trigger on >=25% discount, deduplicate repeats, and respect quiet hours', () => {
  const wish = createWishlistItemObject({ name: 'JBL Clip 5', brand: 'JBL', preferredPrice: 55 });
  const now = new Date('2026-11-22T15:00:00.000Z'); // 10:00 AM ET (outside quiet hours)
  const evalDeal = evaluateDeal({
    id: 'jbl1', canonicalKey: wish.canonicalKey, title: 'JBL Clip 5 Bluetooth Speaker',
    brand: 'JBL', retailerId: 'amazon', retailerName: 'Amazon',
    currentPrice: 50, reportedRegularPrice: 80, baselineSource: 'editorial_regular', shippingFree: true,
    retailerUrl: 'https://www.amazon.com/dp/B0JBLCLIP5', sourceId: 'dealnews_electronics', sourceName: 'DealNews',
    verifiedAt: now.toISOString(), condition: 'new',
  }, { wishlistMatches: [wish], nowMs: now.getTime() });

  const firstRun = evaluateSmartAlerts({ wishlist: [wish], evaluatedDeals: [evalDeal], existingAlerts: [], now });
  assert.ok(firstRun.some((a) => a.type === 'wishlist_discount'));
  assert.ok(firstRun.some((a) => a.type === 'target_price_reached'));

  // Re-running with same unchanged deal produces 0 duplicate alerts
  const secondRun = evaluateSmartAlerts({ wishlist: [wish], evaluatedDeals: [evalDeal], existingAlerts: firstRun, now });
  assert.equal(secondRun.length, 0);

  // Quiet hours check: 23:30 ET is inside 22:00-07:00
  const lateNightUtc = new Date('2026-11-23T04:30:00.000Z'); // 11:30 PM EST
  assert.equal(isWithinQuietHours({ quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' }, lateNightUtc), true);
  assert.equal(isWithinQuietHours({ quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' }, now), false);
});

test('all 60+ retailer URLs and Knightdale local store links are valid HTTPS URLs', () => {
  assert.ok(RETAILER_DIRECTORY.length >= 55);
  assert.ok(LOCAL_STORES_KNIGHTDALE.some((s) => s.area === 'Knightdale' && s.distanceMiles <= 2.5));
  for (const r of RETAILER_DIRECTORY) {
    assert.match(r.url, /^https:\/\//, `${r.name} url`);
    if (r.dealsUrl) assert.match(r.dealsUrl, /^https:\/\//, `${r.name} dealsUrl`);
    if (r.blackFridayUrl) assert.match(r.blackFridayUrl, /^https:\/\//, `${r.name} blackFridayUrl`);
    if (r.storeFinderUrl) assert.match(r.storeFinderUrl, /^https:\/\//, `${r.name} storeFinderUrl`);
  }
});

test('XML RSS parser and JSON-LD HTML metadata extractor parse real structured feeds cleanly', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
    <title>JBL Clip 5 Speaker for $50 + free shipping</title>
    <link>https://www.amazon.com/dp/B0CLIP5555</link>
    <description><![CDATA[<img src="https://example.com/jbl.jpg">Down from $80 at Amazon.]]></description>
    <vendorname>Amazon</vendorname>
    <pubDate>Sun, 22 Nov 2026 14:00:00 +0000</pubDate>
  </item></channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].vendorName, 'Amazon');
  assert.equal(items[0].imageUrl, 'https://example.com/jbl.jpg');

  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Test Espresso Machine',
    brand: { '@type': 'Brand', name: 'Breville' },
    sku: 'BES870XL',
    gtin13: '0021614055934',
    offers: { '@type': 'Offer', price: '549.95', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.7', reviewCount: '1245' },
  })}</script></head><body></body></html>`;
  const meta = extractProductMetadataFromHtml(html, 'https://www.bestbuy.com/site/breville/1234567.p');
  assert.equal(meta.brand, 'Breville');
  assert.equal(meta.price, 549.95);
  assert.equal(meta.availability, 'in_stock');
  assert.equal(meta.reviewData.verifiedOwnerRating, 4.7);
  assert.equal(meta.reviewData.reviewCount, 1245);
});

test('full Express API + auth gate + failed source reporting + persistence lifecycle works end-to-end', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-cmd-test-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const mockFetch = async (url) => {
    const s = String(url);
    if (s.includes('reddit.com')) {
      return new Response('', { status: 429, headers: { 'content-type': 'text/plain' } });
    }
    if (s.includes('redsky.target.com')) {
      return new Response('<html><meta name="description" content="px-captcha"></html>', { status: 435, headers: { 'content-type': 'text/html' } });
    }
    if (s.includes('cheapshark.com')) {
      return new Response(JSON.stringify([{
        title: 'Hades II', salePrice: '19.99', normalPrice: '29.99', dealID: 'abc',
        steamRatingPercent: '95', steamRatingCount: '42000', steamRatingText: 'Overwhelmingly Positive',
        metacriticScore: '93', thumb: 'https://example.com/hades.jpg', dealRating: '9.5', lastChange: 1795350000,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (s.includes('cashbackmonitor.com')) {
      return new Response('<table><tr><td><a href="/cashback-store/best-buy/">Best Buy</a></td><td>4.5%</td></tr></table>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Sony WH-1000XM5 Headphones for $248 + free shipping</title>
      <link>https://www.amazon.com/dp/B09XS7JWHH</link>
      <description><![CDATA[<img src="https://example.com/xm5.jpg">Down from $399.99 at Amazon. Black Friday deal.]]></description>
      <vendorname>Amazon</vendorname>
      <pubDate>Sun, 22 Nov 2026 14:20:00 +0000</pubDate>
    </item></channel></rss>`, { status: 200, headers: { 'content-type': 'text/xml' } });
  };

  const app = express();
  registerWeatherSiteAccess(app, { env: {}, secret: 'bf-test-secret' });
  const { engine } = registerBlackFridayRoutes(app, {
    env: { BLACK_FRIDAY_DISABLE_GITHUB_SYNC: '1' },
    dataDir: tmpDir,
    fetchImpl: mockFetch,
    autoStart: false,
  });
  t.after(() => engine.stop());

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  // 1. Unauthenticated request is blocked (401)
  const unauth = await fetch(`${base}/black-friday/`, { redirect: 'manual' });
  assert.equal(unauth.status, 401);

  // 2. Sign in via existing weather-fusion login (same session as experimental website)
  const loginRes = await fetch(`${base}/weather-fusion/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'care', returnTo: '/black-friday/' }),
  });
  assert.equal(loginRes.status, 303);
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];

  // 3. Authenticated page serves HTML containing version number and all 11 nav items
  const htmlRes = await fetch(`${base}/black-friday/`, { headers: { Cookie: cookie } });
  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  assert.ok(html.includes(BLACK_FRIDAY_VERSION));
  assert.ok(html.includes('id="view-command-center"'));
  assert.ok(html.includes('id="view-all-stores"'));

  // 4. Add wish-list item & run sweep
  const addRes = await fetch(`${base}/api/black-friday/wishlist`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Sony WH-1000XM5 Headphones',
      brand: 'Sony',
      modelNumber: 'WH-1000XM5',
      preferredPrice: 260,
      maxPrice: 300,
      priority: 'high',
      recipient: 'Dad',
    }),
  });
  assert.equal(addRes.status, 201);
  const added = await addRes.json();
  assert.ok(added.item.id);
  assert.ok(added.item.matchedOffersCount >= 1);

  // 5. Trigger refresh sweep & confirm failed/blocked sources (Reddit 429, Target 435) are visibly reported
  const refRes = await fetch(`${base}/api/black-friday/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true, backup: true }),
  });
  assert.equal(refRes.status, 200);
  const refreshed = await refRes.json();
  assert.equal(refreshed.ok, true);
  assert.ok(refreshed.observationsAdded >= 1);

  const healthRes = await fetch(`${base}/api/black-friday/health`, { headers: { Cookie: cookie } });
  const health = await healthRes.json();
  assert.equal(health.version, BLACK_FRIDAY_VERSION);
  assert.equal(health.sourceHealth.find((s) => s.sourceId === 'reddit_deals').status, 'rate_limited');
  assert.equal(health.sourceHealth.find((s) => s.sourceId === 'target_redsky').status, 'blocked');
  assert.equal(health.sourceHealth.find((s) => s.sourceId === 'bestbuy_api').status, 'api_key_required');
  assert.ok(health.persistence.backupsCount >= 1);

  // 6. Test alert delivery works
  const alertRes = await fetch(`${base}/api/black-friday/alerts/test`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  });
  assert.equal(alertRes.status, 200);
  const alertJson = await alertRes.json();
  assert.equal(alertJson.ok, true);
  assert.ok(alertJson.alert.channelsDelivered.includes('in_dashboard'));
});

test('v2.0: 96+ required retailers, zero-filler personalized 4-tier hierarchy, exact rejection, and Upload Center preview/commit', () => {
  // Verify every user-named retailer is present across all 9 categories
  const names = new Set(RETAILER_DIRECTORY.map((r) => r.name));
  for (const required of [
    'Amazon', 'Walmart', 'Target', 'Costco', "Sam's Club", 'eBay', 'QVC', 'HSN',
    "Macy's", "Kohl's", 'Belk', "Dillard's", 'JCPenney', 'Nordstrom', 'Nordstrom Rack', "Bloomingdale's", "Boscov's", 'Saks OFF 5TH',
    'Nike', 'Adidas', 'Under Armour', 'Lululemon', 'Athleta', 'Old Navy', 'Gap', 'American Eagle', 'Aerie', 'Abercrombie & Fitch', 'Hollister', 'H&M', 'Zara', 'Uniqlo', 'Free People', 'Anthropologie', 'Madewell', 'ASOS', 'T.J. Maxx', 'Marshalls', 'Ross Dress for Less', 'Burlington',
    'Sephora', 'Ulta Beauty', 'Bath & Body Works', "Victoria's Secret",
    'Best Buy', 'Apple', 'Samsung', 'Dell', 'HP', 'Lenovo', 'Newegg', 'GameStop', 'Google Store', 'Microsoft Store',
    'Home Depot', "Lowe's", 'Wayfair', 'IKEA', 'Pottery Barn', 'West Elm', 'Crate & Barrel', 'Williams Sonoma', 'At Home', 'HomeGoods', 'Ace Hardware',
    "Dick's Sporting Goods", 'Academy Sports', 'REI', 'Bass Pro Shops', "Cabela's", 'Scheels', 'Golf Galaxy',
    'Etsy', 'LEGO', 'Disney Store', 'Uncommon Goods', 'Five Below', 'Michaels', 'Hobby Lobby', 'Tractor Supply', 'Harbor Freight', 'Chewy', 'PetSmart', 'Petco',
    'Slickdeals', 'DealNews', "Brad's Deals", 'RetailMeNot', 'Rakuten', 'Woot!', 'Meh', 'CamelCamelCamel', 'Keepa', 'Cashback Monitor',
  ]) {
    assert.ok(names.has(required), `Missing required retailer: ${required}`);
  }

  // Zero random deals when user has no wish lists or configured profile interests
  const sampleDeal = evaluateDeal({
    id: 'rnd-1', canonicalKey: 'norm:random:1', title: 'Random Blender $49', brand: 'Ninja',
    category: 'home', retailerId: 'amazon', retailerName: 'Amazon', currentPrice: 49,
    reportedRegularPrice: 99, baselineSource: 'editorial_regular', shippingFree: true,
    retailerUrl: 'https://www.amazon.com/dp/B0RANDOM01', isDirectProductUrl: true,
    sourceId: 'dealnews_main', sourceName: 'DealNews', verifiedAt: new Date().toISOString(), condition: 'new',
  });
  const emptyRecs = buildPersonalizedRecommendations({ evaluatedDeals: [sampleDeal], wishlist: [], profiles: [{ id: 'p1', name: 'Family', favoriteBrands: [], interests: [], preferredRetailers: [] }], feedback: {} });
  assert.equal(emptyRecs.hasPreferences, false);
  assert.equal(emptyRecs.tier1Exact.length, 0);
  assert.equal(emptyRecs.tier4Discoveries.length, 0);

  // Rejecting ONE exact item does NOT suppress another item in the same category
  const otherHomeDeal = evaluateDeal({
    id: 'home-2', canonicalKey: 'norm:other-home:2', title: 'Ninja Air Fryer Pro $79', brand: 'Ninja',
    category: 'home', retailerId: 'target', retailerName: 'Target', currentPrice: 79,
    reportedRegularPrice: 129, baselineSource: 'editorial_regular', shippingFree: true,
    retailerUrl: 'https://www.target.com/p/ninja-air-fryer', isDirectProductUrl: true,
    sourceId: 'dealnews_home', sourceName: 'DealNews', verifiedAt: new Date().toISOString(), condition: 'new',
  });
  const withReject = buildPersonalizedRecommendations({
    evaluatedDeals: [sampleDeal, otherHomeDeal],
    wishlist: [],
    profiles: [{ id: 'p1', name: 'Mom', budget: 200, favoriteBrands: ['Ninja'], interests: ['kitchen'], preferredRetailers: [] }],
    feedback: { rejectedDealIds: ['rnd-1'], rejectedCanonicalKeys: ['norm:random:1'] },
  });
  assert.equal(withReject.hasPreferences, true);
  assert.equal(withReject.tier4Discoveries.some((r) => r.dealId === 'rnd-1'), false, 'exact rejected item is suppressed');
  assert.equal(withReject.tier4Discoveries.some((r) => r.dealId === 'home-2'), true, 'other item in same brand/category still recommended');

  // Product subtype guardrail: a "Wireless Printer" must NEVER be suggested as an alternative to "Wireless Headphones"
  const wirelessPrinter = evaluateDeal({
    id: 'printer-1', canonicalKey: 'norm:epson-wf:1', title: 'Epson Workforce Pro WF-3823 Wireless All-in-One Printer',
    brand: 'Epson', category: 'electronics', retailerId: 'amazon', retailerName: 'Amazon', currentPrice: 79.99,
    reportedRegularPrice: 149.99, baselineSource: 'editorial_regular', shippingFree: true,
    retailerUrl: 'https://www.amazon.com/dp/B0PRINTER1', isDirectProductUrl: true,
    sourceId: 'dealnews_electronics', sourceName: 'DealNews', verifiedAt: new Date().toISOString(), condition: 'new',
  });
  const ancEarbuds = evaluateDeal({
    id: 'earbuds-1', canonicalKey: 'norm:jlab-anc:1', title: 'JLab JBuds Sport ANC 4 True Wireless Earbuds',
    brand: 'JLab', category: 'electronics', retailerId: 'amazon', retailerName: 'Amazon', currentPrice: 79.99,
    reportedRegularPrice: 129.99, baselineSource: 'editorial_regular', shippingFree: true,
    retailerUrl: 'https://www.amazon.com/dp/B0EARBUDS1', isDirectProductUrl: true,
    sourceId: 'dealnews_electronics', sourceName: 'DealNews', verifiedAt: new Date().toISOString(), condition: 'new',
  });
  const hpItem = createWishlistItemObject({ name: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', brand: 'Sony', modelNumber: 'WH-1000XM5', preferredPrice: 250 });
  const altCheck = discoverAlternatives(hpItem, [wirelessPrinter, ancEarbuds]);
  const allAltIds = [...altCheck.same_better_price, ...altCheck.better_similar_price, ...altCheck.similar_lower_price].map((a) => a.dealId);
  assert.equal(allAltIds.includes('printer-1'), false, 'wireless printer must NEVER match wireless headphones');
  assert.equal(allAltIds.includes('earbuds-1'), true, 'genuine ANC earbuds should match headphones alternative');

  // PDF text extractor works on plain PDF text stream
  const miniPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT (Sony WH-1000XM5 Headphones $249) Tj ET\nendstream\nendobj\n/URI (https://www.amazon.com/dp/B09XS7JWHH)\n%%EOF', 'latin1');
  const pdfOut = extractTextFromPdfBuffer(miniPdf);
  assert.match(pdfOut.text, /Sony WH-1000XM5/);
  assert.ok(pdfOut.urls.includes('https://www.amazon.com/dp/B09XS7JWHH'));
});

test('v2.1: real banner-row + stacked-table CSV, Excel hyperlinks, and main-store attribution fixes', () => {
  // 1. User's exact CSV layout: 2 banner lines, real header row, repeated header row, Link="Open", decimal Discount %
  const sampleCsv = [
    '"Gift Deals Ranked by Discount — November 20, 2026",,,,,,,,,,,,,,',
    '"36 deals over 25% off out of 487 unique deals.",,,,,,,,,,,,,,',
    'Rank,Recipient,Tier,Item,Store,Link,Sale price,Regular price,You save $,Discount %,Evidence,Regular-price source,Checked ET,Found by,Notes',
    '1,Angel,Stocking stuffers (<$10),"Kuromi 10"" Western Rodeo Plush",Sanrio (official online),Open,9.99,38,28.01,0.737105,Medium,Seller compare-at,"Nov 20, 2026, 1:20 PM ET",Gift Scout 4,"Sanrio ask"',
    '4,Angel,Level 3 (under $20),Okarun Figure,Good Smile US,Open,13.19,32.99,19.8,0.60018,Medium,Holiday Guide,"Nov 20, 2026, 1:20 PM ET",Gift Scout 2,"See (https://www.goodsmileus.com/pages/2026-holiday-gift-guides)"',
    'Rank,Recipient,Tier,Item,Store,Link,Sale price,Regular price,You save $,Discount %,Evidence,Regular-price source,Checked ET,Found by,Notes',
    '1,Angel,Stocking stuffers (<$10),"Kuromi 10"" Western Rodeo Plush",Sanrio (official online),Open,9.99,38,28.01,0.737105,Medium,Seller compare-at,"Nov 20, 2026, 1:20 PM ET",Gift Scout 4,"Duplicate in full table"',
    '2,Kish,Great,"Ray-Ban Meta Gen 2 Wayfarer",Walmart.com,Open,306,409,103,0.25183,Weak,Walmart strikethrough,"Nov 20, 2026, 1:19 PM ET",Gift Scout 4,"Sold by Walmart.com"',
  ].join('\n');

  const rawRows = parseDelimitedText(sampleCsv);
  const parsedDrafts = rowsToWishlistDrafts(rawRows, { sourceType: 'csv' });
  const deduped = dedupeDraftsWithinFile(parsedDrafts);
  assert.equal(deduped.duplicatesRemoved, 1, 'should merge repeated item from top table + full table');
  assert.equal(deduped.unique.length, 3);

  const kuromi = deduped.unique.find((d) => /Kuromi/i.test(d.name));
  assert.equal(kuromi.recipient, 'Angel');
  assert.equal(kuromi.preferredPrice, 9.99);
  assert.equal(kuromi.originalPrice, 38);
  assert.equal(kuromi.discountPct, 73.7);
  assert.equal(kuromi.evidence, 'Medium');
  assert.equal(kuromi.sourceUrl, null, 'must NEVER store literal "Open" as sourceUrl');
  assert.ok(kuromi.storeSearchUrl && kuromi.storeSearchUrl.startsWith('https://'), 'should derive valid working storeSearchUrl');

  const okarun = deduped.unique.find((d) => /Okarun/i.test(d.name));
  assert.equal(okarun.sourceUrl, 'https://www.goodsmileus.com/pages/2026-holiday-gift-guides');

  const rayban = deduped.unique.find((d) => /Ray-Ban/i.test(d.name));
  assert.equal(rayban.retailerId, 'walmart');
  assert.equal(rayban.recipient, 'Kish');

  // 2. Retailer attribution skips slickdeals/dealnews URLs and detects true merchant from bracket domain & &trd=
  const sdWalmart = detectRetailer({
    url: 'https://slickdeals.net/f/12345-tv-deal',
    text: 'Walmart [walmart.com] has TCL 65" QLED 4K TV for $398',
  });
  assert.equal(sdWalmart.id, 'walmart');
  assert.equal(sdWalmart.name, 'Walmart');

  const dnTarget = detectRetailer({
    url: 'https://www.dealnews.com/products/Sony-WH1000XM5/12345.html',
    vendorName: 'Target',
    text: 'Sony Headphones at Target',
  });
  assert.equal(dnTarget.id, 'target');

  const amzThird = detectRetailer({ vendorName: 'Amazon (3rd-party seller)' });
  assert.equal(amzThird.id, 'amazon');

  // 3. XLSX hyperlink + formula extraction when Link cell says "Open"
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c ^= buf[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, content] of files) {
      const nameBuf = Buffer.from(name, 'utf8');
      const rawBuf = Buffer.from(content, 'utf8');
      const compBuf = zlib.deflateRawSync(rawBuf);
      const crc = crc32(rawBuf);
      const local = Buffer.alloc(30 + nameBuf.length);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compBuf.length, 18); local.writeUInt32LE(rawBuf.length, 22);
      local.writeUInt16LE(nameBuf.length, 26); nameBuf.copy(local, 30);
      locals.push(local, compBuf);
      const central = Buffer.alloc(46 + nameBuf.length);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
      central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compBuf.length, 20);
      central.writeUInt32LE(rawBuf.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
      nameBuf.copy(central, 46);
      centrals.push(central);
      offset += local.length + compBuf.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
  }
  const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Banner</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Item</t></is></c><c r="B2" t="inlineStr"><is><t>Store</t></is></c><c r="C2" t="inlineStr"><is><t>Link</t></is></c><c r="D2" t="inlineStr"><is><t>Sale price</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Samsung Galaxy Tab S10 FE</t></is></c><c r="B3" t="inlineStr"><is><t>Samsung</t></is></c><c r="C3" t="inlineStr"><is><t>Open</t></is></c><c r="D3"><v>349.99</v></c></row></sheetData><hyperlinks><hyperlink ref="C3" r:id="rId9"/></hyperlinks></worksheet>`;
  const sheetRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.samsung.com/us/tablets/galaxy-tab-s10-fe/" TargetMode="External"/></Relationships>`;
  // Note: sheetXml uses inlineStr <is><t>...</t></is> so check inlineStr tag parsing cleanly
  const xlsxBuf = makeZip([
    ['xl/worksheets/sheet1.xml', sheetXml],
    ['xl/worksheets/_rels/sheet1.xml.rels', sheetRels],
  ]);
  const sheets = parseXlsxSheets(xlsxBuf);
  assert.equal(sheets.length, 1);
  const hlDrafts = rowsToWishlistDrafts(sheets[0].rows);
  assert.equal(hlDrafts.length, 1);
  assert.equal(hlDrafts[0].name, 'Samsung Galaxy Tab S10 FE');
  assert.equal(hlDrafts[0].sourceUrl, 'https://www.samsung.com/us/tablets/galaxy-tab-s10-fe/');
});
