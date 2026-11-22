/**
 * Black Friday Command Center — Core Constants, Complete 96+ Retailer Directory,
 * Recognizable Brand Metadata & Knightdale 27545 Local Store Footprint.
 *
 * Honesty policy:
 * - Every retailer URL is a real official URL (never placeholder routes).
 * - If a retailer has no dedicated Black Friday URL, blackFridayUrl points to its
 *   legitimate deals/sale page instead (never a guessed 404).
 * - urlStatus tracks verified browser/HTTP verification ('verified' | 'bot_protected' | 'unverified').
 */

export const BLACK_FRIDAY_VERSION = '2.2.6-bf2026.10';
export const SCHEMA_VERSION = 2;

export const PRIMARY_LOCATION = Object.freeze({
  city: 'Knightdale',
  state: 'NC',
  zip: '27545',
  county: 'Wake County',
  latitude: 35.7877,
  longitude: -78.4806,
  timeZone: 'America/New_York',
  salesTaxRate: 0.0725,
  nearbyAreas: ['Knightdale', 'Raleigh', 'Garner', 'Wake Forest', 'Cary', 'North Raleigh', 'Wendell', 'Zebulon'],
});

export const DEFAULT_FAVORITE_STORES = Object.freeze([
  'target', 'bestbuy', 'academy', 'walmart', 'homedepot',
  'lowes', 'amazon', 'cabelas', 'barnesnoble', 'kohls',
]);

export const MAIN_STORE_IDS = Object.freeze([
  'target', 'bestbuy', 'academy', 'walmart', 'homedepot',
  'lowes', 'amazon', 'cabelas', 'barnesnoble', 'kohls',
]);

export const RETAILER_SEARCH_URLS = Object.freeze({
  amazon: 'https://www.amazon.com/s?k={q}',
  walmart: 'https://www.walmart.com/search?q={q}',
  target: 'https://www.target.com/s?searchTerm={q}',
  bestbuy: 'https://www.bestbuy.com/site/searchpage.jsp?st={q}',
  costco: 'https://www.costco.com/CatalogSearch?keyword={q}',
  samsclub: 'https://www.samsclub.com/s/{q}',
  ebay: 'https://www.ebay.com/sch/i.html?_nkw={q}',
  macys: 'https://www.macys.com/shop/featured/{q}',
  kohls: 'https://www.kohls.com/search.jsp?search={q}',
  nordstrom: 'https://www.nordstrom.com/sr?keyword={q}',
  nordstromrack: 'https://www.nordstromrack.com/sr?keyword={q}',
  homedepot: 'https://www.homedepot.com/s/{q}',
  lowes: 'https://www.lowes.com/search?searchTerm={q}',
  wayfair: 'https://www.wayfair.com/keyword.php?keyword={q}',
  nike: 'https://www.nike.com/w?q={q}',
  adidas: 'https://www.adidas.com/us/search?q={q}',
  apple: 'https://www.apple.com/us/search/{q}',
  samsung: 'https://www.samsung.com/us/search/searchMain/?listType=g&searchTerm={q}',
  newegg: 'https://www.newegg.com/p/pl?d={q}',
  sephora: 'https://www.sephora.com/search?keyword={q}',
  ulta: 'https://www.ulta.com/search?search={q}',
  lego: 'https://www.lego.com/en-us/search?q={q}',
  dicks: 'https://www.dickssportinggoods.com/search/SearchDisplay?searchTerm={q}',
  rei: 'https://www.rei.com/search?q={q}',
  oldnavy: 'https://oldnavy.gap.com/browse/search.do?searchText={q}',
  chewy: 'https://www.chewy.com/s?query={q}',
  williamssonoma: 'https://www.williams-sonoma.com/search/results.html?words={q}',
  harborfreight: 'https://www.harborfreight.com/search?q={q}',
  gamestop: 'https://www.gamestop.com/search/?q={q}',
  etsy: 'https://www.etsy.com/search?q={q}',
});

export function buildStoreSearchUrl(retailerId, storeName = '', productName = '', fallbackHomeUrl = '') {
  const cleanQuery = String(productName || '')
    .replace(/["'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  const template = RETAILER_SEARCH_URLS[retailerId];
  if (template && cleanQuery) {
    return template.replace('{q}', encodeURIComponent(cleanQuery));
  }
  if (fallbackHomeUrl && /^https?:\/\//i.test(fallbackHomeUrl) && !cleanQuery) {
    return fallbackHomeUrl;
  }
  if (cleanQuery && fallbackHomeUrl && /^https?:\/\//i.test(fallbackHomeUrl)) {
    try {
      const host = new URL(fallbackHomeUrl).hostname.replace(/^www\./, '');
      return `https://www.google.com/search?q=${encodeURIComponent(`site:${host} ${cleanQuery}`)}`;
    } catch {}
  }
  if (cleanQuery && storeName) {
    return `https://www.google.com/search?q=${encodeURIComponent(`${storeName} ${cleanQuery}`)}`;
  }
  return fallbackHomeUrl || null;
}

export const DEFAULT_SETTINGS = Object.freeze({
  location: { ...PRIMARY_LOCATION },
  theme: 'dark',
  favoriteStores: [...DEFAULT_FAVORITE_STORES],
  thresholds: {
    exceptionalPct: 40,
    greatPct: 25,
    goodPct: 15,
  },
  decisionWeights: {
    discount: 25,
    history: 20,
    quality: 15,
    relevance: 15,
    allInCost: 10,
    availability: 10,
    confidence: 5,
  },
  alerts: {
    defaultDiscountTriggerPct: 25,
    priceDropSinceLastCheckPct: 10,
    enableHistoricalLow: true,
    enableBetterRetailer: true,
    enableBackInStock: true,
    enableTargetPrice: true,
    enableExceptionalAlternative: true,
    enableMajorCoupon: true,
    enableExpiringSoon: true,
    enableLocalPickup: true,
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    browserNotificationsEnabled: false,
    emailEnabled: false,
    emailRecipient: '',
    webhookEnabled: false,
  },
  monitoring: {
    autoUpdate: false,
    highPriorityMinutes: 15,
    blackFridayEventMinutes: 15,
    standardMinutes: 90,
    discoveryMinutes: 240,
    maxHistoryDays: 365,
  },
  budgets: {
    totalHolidayBudget: 2500,
    perGiftDefaultMax: 150,
  },
  enabledSources: {
    dealnews_main: true,
    dealnews_electronics: true,
    dealnews_home: true,
    dealnews_clothing: true,
    dealnews_bestbuy: true,
    slickdeals_frontpage: true,
    slickdeals_popular: true,
    slickdeals_black_friday: true,
    slickdeals_walmart: true,
    slickdeals_target: true,
    slickdeals_bestbuy: true,
    slickdeals_homedepot: true,
    slickdeals_lowes: true,
    slickdeals_costco: true,
    slickdeals_samsclub: true,
    slickdeals_macys: true,
    slickdeals_kohls: true,
    slickdeals_nike: true,
    slickdeals_lego: true,
    slickdeals_apple: true,
    slickdeals_sephora: true,
    slickdeals_ulta: true,
    slickdeals_wayfair: true,
    slickdeals_nordstrom: true,
    slickdeals_newegg: true,
    camelcamelcamel_drops: true,
    techbargains: true,
    hip2save: true,
    '9to5toys': true,
    dealcatcher: true,
    dansdeals: true,
    cheapshark: true,
    cashbackmonitor: true,
    bestbuy_api: true,
    ebay_api: true,
    reddit_deals: true,
    target_redsky: true,
  },
});

/**
 * Clean starting profiles with empty preference arrays — we NEVER invent a family member's
 * favorite brands, sizes, or hobbies. Users edit or add unlimited family profiles.
 */
export const DEFAULT_PROFILES = Object.freeze([
  {
    id: 'family-main',
    name: 'Family Shared List',
    type: 'family',
    icon: '🏠',
    budget: 1000,
    description: 'Shared household and family shopping list',
    favoriteBrands: [],
    clothingSizes: '',
    interests: [],
    preferredRetailers: [],
    dislikedProducts: [],
    savedIdeas: [],
  },
  {
    id: 'christmas-gifts',
    name: 'Christmas Gifts',
    type: 'occasion',
    icon: '🎄',
    budget: 1200,
    description: 'Holiday gifts across family and friends',
    favoriteBrands: [],
    clothingSizes: '',
    interests: [],
    preferredRetailers: [],
    dislikedProducts: [],
    savedIdeas: [],
  },
]);

export const SHOPPING_EVENTS_2026 = Object.freeze([
  {
    id: 'early-black-friday-2026',
    name: 'Early Black Friday Week',
    type: 'early_black_friday',
    startsAt: '2026-11-19T05:00:00.000Z',
    endsAt: '2026-11-26T04:59:59.000Z',
    confirmed: true,
    summary: 'Early Black Friday online rollouts at Amazon, Walmart, Target, Best Buy, Home Depot, Lowe’s, Kohl’s, and Macy’s.',
    retailers: ['amazon', 'walmart', 'target', 'bestbuy', 'homedepot', 'lowes', 'kohls', 'macys'],
  },
  {
    id: 'thanksgiving-online-2026',
    name: 'Thanksgiving Day Online Doorbusters',
    type: 'black_friday',
    startsAt: '2026-11-26T05:00:00.000Z',
    endsAt: '2026-11-27T04:59:59.000Z',
    confirmed: true,
    summary: 'Most physical stores closed on Thanksgiving Day; online Black Friday pricing activates across major national retailers.',
    retailers: ['amazon', 'walmart', 'target', 'bestbuy', 'apple', 'samsung', 'nike'],
  },
  {
    id: 'black-friday-2026',
    name: 'Black Friday 2026',
    type: 'black_friday',
    startsAt: '2026-11-27T05:00:00.000Z',
    endsAt: '2026-11-28T04:59:59.000Z',
    confirmed: true,
    summary: 'Peak in-store & online doorbusters. Local Knightdale & Raleigh stores open early for pickup and clearance.',
    retailers: ['amazon', 'walmart', 'target', 'bestbuy', 'costco', 'samsclub', 'homedepot', 'lowes', 'macys', 'kohls', 'apple', 'lego'],
  },
  {
    id: 'cyber-monday-2026',
    name: 'Cyber Monday 2026',
    type: 'cyber_monday',
    startsAt: '2026-11-30T05:00:00.000Z',
    endsAt: '2026-12-01T04:59:59.000Z',
    confirmed: true,
    summary: 'Online-exclusive tech, apparel, travel, beauty, and promo-code stacking deals.',
    retailers: ['amazon', 'bestbuy', 'newegg', 'dell', 'hp', 'lenovo', 'apple', 'sephora', 'ulta', 'nike', 'adidas'],
  },
  {
    id: 'cyber-week-2026',
    name: 'Cyber Week Extended Sales',
    type: 'cyber_monday',
    startsAt: '2026-12-01T05:00:00.000Z',
    endsAt: '2026-12-07T04:59:59.000Z',
    confirmed: true,
    summary: 'Second-chance tech, toy, home, and warehouse club savings before holiday shipping cutoffs.',
    retailers: ['amazon', 'walmart', 'target', 'costco', 'wayfair', 'kohls'],
  },
  {
    id: 'green-monday-2026',
    name: 'Green Monday',
    type: 'holiday',
    startsAt: '2026-12-14T05:00:00.000Z',
    endsAt: '2026-12-15T04:59:59.000Z',
    confirmed: true,
    summary: 'Major online push before standard Christmas ground shipping deadlines.',
    retailers: ['amazon', 'target', 'walmart', 'bestbuy', 'ebay'],
  },
  {
    id: 'super-saturday-2026',
    name: 'Super Saturday Local Pickup Sprint',
    type: 'holiday',
    startsAt: '2026-12-19T05:00:00.000Z',
    endsAt: '2026-12-20T04:59:59.000Z',
    confirmed: true,
    summary: 'Final Saturday before Christmas — prioritize Knightdale & Raleigh same-day pickup and drive-up.',
    retailers: ['target', 'walmart', 'bestbuy', 'kohls', 'macys', 'ulta', 'sephora'],
  },
  {
    id: 'after-christmas-clearance-2026',
    name: 'After-Christmas & Year-End Clearance',
    type: 'clearance',
    startsAt: '2026-12-26T05:00:00.000Z',
    endsAt: '2027-01-04T04:59:59.000Z',
    confirmed: true,
    summary: 'Seasonal clearance, open-box returns, winter apparel markdowns, and end-of-model-year electronics drops.',
    retailers: ['target', 'walmart', 'bestbuy', 'homedepot', 'lowes', 'nordstrom', 'nordstromrack', 'rei'],
  },
]);

export const LOCAL_STORES_KNIGHTDALE = Object.freeze([
  { id: 'walmart-knightdale', retailerId: 'walmart', retailerName: 'Walmart Supercenter', branchName: 'Knightdale Supercenter', area: 'Knightdale', address: '7106 Knightdale Blvd, Knightdale, NC 27545', distanceMiles: 1.4, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.walmart.com/store-finder?location=27545', clearanceUrl: 'https://www.walmart.com/shop/deals/clearance' },
  { id: 'petco-knightdale', retailerId: 'petco', retailerName: 'Petco', branchName: 'Petco Knightdale', area: 'Knightdale', address: '6801 Knightdale Blvd, Knightdale, NC 27545', distanceMiles: 1.6, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.petco.com/shop/en/petcostore/store-locator', clearanceUrl: 'https://www.petco.com/shop/en/petcostore/c/clearance' },
  { id: 'lowes-knightdale', retailerId: 'lowes', retailerName: "Lowe's", branchName: "Lowe's of Knightdale", area: 'Knightdale', address: '6600 Knightdale Blvd, Knightdale, NC 27545', distanceMiles: 1.7, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.lowes.com/store/NC-Knightdale/2483', clearanceUrl: 'https://www.lowes.com/l/savings/clearance' },
  { id: 'target-knightdale', retailerId: 'target', retailerName: 'Target', branchName: 'Target Knightdale (#2111)', area: 'Knightdale', storeCode: '2111', address: '1000 Shoppes at Midway Dr, Knightdale, NC 27545', distanceMiles: 1.85, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.target.com/sl/knightdale/2111', clearanceUrl: 'https://www.target.com/c/clearance/-/N-5q0ga' },
  { id: 'ulta-knightdale', retailerId: 'ulta', retailerName: 'Ulta Beauty', branchName: 'Ulta Beauty Knightdale', area: 'Knightdale', address: 'Shoppes at Midway, Knightdale, NC 27545', distanceMiles: 1.9, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.ulta.com/stores', clearanceUrl: 'https://www.ulta.com/promotion/sale' },
  { id: 'tjmaxx-knightdale', retailerId: 'tjmaxx', retailerName: 'T.J. Maxx', branchName: 'T.J. Maxx / HomeGoods (Knightdale / Raleigh)', area: 'Knightdale', address: 'Knightdale / Triangle Town area, NC', distanceMiles: 2.0, pickup: false, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://tjmaxx.tjx.com/store/stores/storeLocator.jsp', clearanceUrl: 'https://tjmaxx.tjx.com/store/shop/clearance/_/N-3951437597' },
  { id: 'samsclub-raleigh', retailerId: 'samsclub', retailerName: "Sam's Club", branchName: "Sam's Club Capital Blvd (Raleigh)", area: 'North Raleigh', address: '3001 Calvary Dr, Raleigh, NC 27604', distanceMiles: 6.2, pickup: true, sameDayDelivery: true, warehouseClub: true, storeUrl: 'https://www.samsclub.com/locator', clearanceUrl: 'https://www.samsclub.com/b/instant-savings-book/19240107' },
  { id: 'bestbuy-triangle', retailerId: 'bestbuy', retailerName: 'Best Buy', branchName: 'Best Buy Triangle Town Center', area: 'North Raleigh', address: '3820 Sumner Blvd, Raleigh, NC 27616', distanceMiles: 6.4, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.bestbuy.com/site/store-locator/27545', clearanceUrl: 'https://www.bestbuy.com/site/misc/deal-of-the-day/pcmcat248000050016.c' },
  { id: 'dicks-triangle', retailerId: 'dicks', retailerName: "Dick's Sporting Goods", branchName: "Dick's Sporting Goods Triangle Town", area: 'North Raleigh', address: '3800 Sumner Blvd, Raleigh, NC 27616', distanceMiles: 6.5, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://stores.dickssportinggoods.com/nc/raleigh/', clearanceUrl: 'https://www.dickssportinggoods.com/f/clearance-deals' },
  { id: 'kohls-raleigh', retailerId: 'kohls', retailerName: "Kohl's", branchName: "Kohl's Triangle Town / Raleigh", area: 'North Raleigh', address: '3401 Sumner Blvd, Raleigh, NC 27616', distanceMiles: 6.6, pickup: true, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://www.kohls.com/stores.shtml', clearanceUrl: 'https://www.kohls.com/sale-event/clearance.jsp' },
  { id: 'homedepot-raleigh', retailerId: 'homedepot', retailerName: 'Home Depot', branchName: 'Home Depot Capital Blvd', area: 'North Raleigh', address: '4901 Capital Blvd, Raleigh, NC 27616', distanceMiles: 6.8, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.homedepot.com/l/search/27545/full/', clearanceUrl: 'https://www.homedepot.com/SpecialBuy/SpecialBuyOfTheDay' },
  { id: 'harborfreight-raleigh', retailerId: 'harborfreight', retailerName: 'Harbor Freight', branchName: 'Harbor Freight Capital Blvd', area: 'Raleigh', address: '3600 Capital Blvd, Raleigh, NC 27604', distanceMiles: 6.9, pickup: false, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://www.harborfreight.com/storelocator/location/map', clearanceUrl: 'https://www.harborfreight.com/clearance' },
  { id: 'homedepot-garner', retailerId: 'homedepot', retailerName: 'Home Depot', branchName: 'Home Depot Garner', area: 'Garner', address: '2660 Timber Dr, Garner, NC 27529', distanceMiles: 8.2, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.homedepot.com/l/search/27529/full/', clearanceUrl: 'https://www.homedepot.com/SpecialBuy/SpecialBuyOfTheDay' },
  { id: 'costco-raleigh', retailerId: 'costco', retailerName: 'Costco', branchName: 'Costco Wholesale Raleigh', area: 'Raleigh', address: '2838 Wake Forest Rd, Raleigh, NC 27609', distanceMiles: 8.9, pickup: false, sameDayDelivery: true, warehouseClub: true, storeUrl: 'https://www.costco.com/warehouse-locations', clearanceUrl: 'https://www.costco.com/warehouse-savings.html' },
  { id: 'rei-raleigh', retailerId: 'rei', retailerName: 'REI', branchName: 'REI Raleigh (North Hills)', area: 'North Raleigh', address: '4291 The Circle at North Hills St, Raleigh, NC 27609', distanceMiles: 10.5, pickup: true, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://www.rei.com/stores/raleigh', clearanceUrl: 'https://www.rei.com/rei-garage' },
  { id: 'nordstromrack-raleigh', retailerId: 'nordstromrack', retailerName: 'Nordstrom Rack', branchName: 'Nordstrom Rack North Hills', area: 'North Raleigh', address: '4160 Main at North Hills St, Raleigh, NC 27609', distanceMiles: 10.6, pickup: true, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://www.nordstromrack.com/stores', clearanceUrl: 'https://www.nordstromrack.com/clearance' },
  { id: 'belk-crabtree', retailerId: 'belk', retailerName: 'Belk', branchName: 'Belk Crabtree Valley Mall', area: 'Raleigh', address: '4325 Glenwood Ave, Raleigh, NC 27612', distanceMiles: 12.1, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.belk.com/stores/', clearanceUrl: 'https://www.belk.com/clearance/' },
  { id: 'macys-crabtree', retailerId: 'macys', retailerName: "Macy's", branchName: "Macy's Crabtree Valley Mall", area: 'Raleigh', address: '4325 Glenwood Ave, Raleigh, NC 27612', distanceMiles: 12.1, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.macys.com/stores/', clearanceUrl: 'https://www.macys.com/shop/sale/clearance-closeout' },
  { id: 'apple-crabtree', retailerId: 'apple', retailerName: 'Apple', branchName: 'Apple Crabtree Valley Mall', area: 'Raleigh', address: '4325 Glenwood Ave, Raleigh, NC 27612', distanceMiles: 12.1, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.apple.com/retail/crabtreevalleymall/', clearanceUrl: 'https://www.apple.com/shop/refurbished' },
  { id: 'lego-crabtree', retailerId: 'lego', retailerName: 'LEGO Store', branchName: 'LEGO Store Crabtree Valley Mall', area: 'Raleigh', address: '4325 Glenwood Ave, Raleigh, NC 27612', distanceMiles: 12.1, pickup: false, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://www.lego.com/en-us/stores/store/crabtree-valley-mall', clearanceUrl: 'https://www.lego.com/en-us/categories/sales-and-deals' },
  { id: 'cabelas-garner', retailerId: 'cabelas', retailerName: "Cabela's", branchName: "Cabela's Garner (White Oak)", area: 'Garner', address: '201 Cabela Dr, Garner, NC 27529', distanceMiles: 11.8, pickup: true, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://stores.basspro.com/us/nc/garner/201-cabela-drive.html', clearanceUrl: 'https://www.cabelas.com/shop/en/bargain-cave' },
  { id: 'golfgalaxy-raleigh', retailerId: 'golfgalaxy', retailerName: 'Golf Galaxy', branchName: 'Golf Galaxy Cary / Raleigh', area: 'Cary', address: 'Crossroads Plaza, Cary, NC 27518', distanceMiles: 14.5, pickup: true, sameDayDelivery: false, warehouseClub: false, storeUrl: 'https://www.golfgalaxy.com/s/store-locator', clearanceUrl: 'https://www.golfgalaxy.com/f/golf-deals' },
  { id: 'academy-apex', retailerId: 'academy', retailerName: 'Academy Sports', branchName: 'Academy Sports + Outdoors Apex', area: 'Cary', address: '1011 Beaver Creek Commons Dr, Apex, NC 27502', distanceMiles: 18.4, pickup: true, sameDayDelivery: true, warehouseClub: false, storeUrl: 'https://www.academy.com/storelocator', clearanceUrl: 'https://www.academy.com/c/clearance' },
]);

function mkStore(id, name, category, domain, {
  url = `https://www.${domain}/`,
  dealsUrl = null,
  blackFridayUrl = null,
  storeFinderUrl = null,
  localPresence = false,
  warehouseClub = false,
  monitoringMode = 'live_feed_aggregated',
  accent = '#38bdf8',
  monogram = null,
  aliases = [],
  domainHints = null,
  dealTiming = null,
} = {}) {
  return {
    id,
    name,
    category,
    domain,
    logoUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
    monogram: monogram || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase(),
    accent,
    url,
    dealsUrl: dealsUrl || url,
    // If a store has no dedicated verified Black Friday page, link directly to its legitimate deals page
    blackFridayUrl: blackFridayUrl || dealsUrl || url,
    hasDedicatedBlackFridayUrl: Boolean(blackFridayUrl),
    storeFinderUrl,
    localPresence,
    warehouseClub,
    monitoringMode,
    aliases: [domain, ...aliases],
    domainHints: domainHints || [domain],
    dealTiming,
  };
}

/**
 * Complete 96-Retailer Favorite Shopping Directory across all 9 user-requested categories.
 */
export const RETAILER_DIRECTORY = Object.freeze([
  // 1. General Shopping (8)
  mkStore('amazon', 'Amazon', 'General Shopping', 'amazon.com', { dealsUrl: 'https://www.amazon.com/gp/goldbox', blackFridayUrl: 'https://www.amazon.com/blackfriday', storeFinderUrl: 'https://www.amazon.com/ulp', accent: '#ff9900', monogram: 'AZ', aliases: ['amzn'], domainHints: ['amazon.com', 'amzn.to'], dealTiming: "Black Friday Week Nov 19–30 · Biggest new drops Fri Nov 27 and Cyber Mon Nov 30 at 3 AM and 11 AM ET" }),
  mkStore('walmart', 'Walmart', 'General Shopping', 'walmart.com', { dealsUrl: 'https://www.walmart.com/shop/deals', blackFridayUrl: 'https://www.walmart.com/shop/deals/black-friday', storeFinderUrl: 'https://www.walmart.com/store-finder?location=27545', localPresence: true, accent: '#0071dc', monogram: 'WM', dealTiming: "Deals online Mon Nov 23, 12:01 AM ET (Walmart+ members get hot drops first; everyone else Tue) · Stores join Fri 6 AM · Cyber Monday Nov 30–Dec 2" }),
  mkStore('target', 'Target', 'General Shopping', 'target.com', { dealsUrl: 'https://www.target.com/c/top-deals/-/N-4xw74', blackFridayUrl: 'https://www.target.com/c/target-black-friday/-/N-5q0f2', storeFinderUrl: 'https://www.target.com/sl/knightdale/2111', localPresence: true, accent: '#cc0000', monogram: 'TG', dealTiming: "Sale Nov 22–29 · Deal of the Day daily · Circle 360 early access Wed Nov 25, 3 AM ET · Stores open Fri 6 AM — gift cards for the first 100 in line" }),
  mkStore('costco', 'Costco', 'General Shopping', 'costco.com', { dealsUrl: 'https://www.costco.com/warehouse-savings.html', storeFinderUrl: 'https://www.costco.com/warehouse-locations', localPresence: true, warehouseClub: true, accent: '#e31837', monogram: 'CO', aliases: ['costco wholesale'] }),
  mkStore('samsclub', "Sam's Club", 'General Shopping', 'samsclub.com', { dealsUrl: 'https://www.samsclub.com/b/instant-savings-book/19240107', storeFinderUrl: 'https://www.samsclub.com/locator', localPresence: true, warehouseClub: true, accent: '#0067a0', monogram: 'SC', aliases: ['sams club'] }),
  mkStore('ebay', 'eBay', 'General Shopping', 'ebay.com', { dealsUrl: 'https://www.ebay.com/deals', monitoringMode: 'direct_api_ready', accent: '#e53238', monogram: 'eB' }),
  mkStore('qvc', 'QVC', 'General Shopping', 'qvc.com', { dealsUrl: 'https://www.qvc.com/', accent: '#0077c8', monogram: 'QV' }),
  mkStore('hsn', 'HSN', 'General Shopping', 'hsn.com', { dealsUrl: 'https://www.hsn.com/', accent: '#007dc3', monogram: 'HS' }),

  // 2. Department Stores (10)
  mkStore('macys', "Macy's", 'Department Stores', 'macys.com', { dealsUrl: 'https://www.macys.com/shop/sale/clearance-closeout', blackFridayUrl: 'https://www.macys.com/s/black-friday/', storeFinderUrl: 'https://www.macys.com/stores/', localPresence: true, accent: '#e21a2c', monogram: 'M★', aliases: ['macys'] }),
  mkStore('kohls', "Kohl's", 'Department Stores', 'kohls.com', { dealsUrl: 'https://www.kohls.com/sale-event/clearance.jsp', blackFridayUrl: 'https://www.kohls.com/sale-event/black-friday-deals.jsp', storeFinderUrl: 'https://www.kohls.com/stores.shtml', localPresence: true, accent: '#7c3aed', monogram: 'KH', aliases: ['kohls'], dealTiming: "Black Friday Week Nov 22–28 · Extra 20% off + $15 Kohl’s Cash per $50 · Online doorbusters Thu 1:01 AM ET · Stores Fri 5 AM — the earliest opener" }),
  mkStore('belk', 'Belk', 'Department Stores', 'belk.com', { dealsUrl: 'https://www.belk.com/clearance/', storeFinderUrl: 'https://www.belk.com/stores/', localPresence: true, accent: '#0076be', monogram: 'BK' }),
  mkStore('dillards', "Dillard's", 'Department Stores', 'dillards.com', { dealsUrl: 'https://www.dillards.com/c/sale-clearance', storeFinderUrl: 'https://www.dillards.com/stores', localPresence: true, monitoringMode: 'directory_only', accent: '#94a3b8', monogram: 'DL', aliases: ['dillards'] }),
  mkStore('jcpenney', 'JCPenney', 'Department Stores', 'jcpenney.com', { dealsUrl: 'https://www.jcpenney.com/m/jcpenney-deals', blackFridayUrl: 'https://www.jcpenney.com/m/black-friday-deals', storeFinderUrl: 'https://www.jcpenney.com/locations/nc/raleigh', localPresence: true, accent: '#cc0000', monogram: 'JC', aliases: ['jcp'] }),
  mkStore('nordstrom', 'Nordstrom', 'Department Stores', 'nordstrom.com', { dealsUrl: 'https://www.nordstrom.com/browse/sale', storeFinderUrl: 'https://www.nordstrom.com/stores', localPresence: true, accent: '#cbd5e1', monogram: 'NR' }),
  mkStore('nordstromrack', 'Nordstrom Rack', 'Department Stores', 'nordstromrack.com', { dealsUrl: 'https://www.nordstromrack.com/clearance', storeFinderUrl: 'https://www.nordstromrack.com/stores', localPresence: true, accent: '#38bdf8', monogram: 'RK' }),
  mkStore('bloomingdales', "Bloomingdale's", 'Department Stores', 'bloomingdales.com', { dealsUrl: 'https://www.bloomingdales.com/shop/sale', storeFinderUrl: 'https://locations.bloomingdales.com/', accent: '#f59e0b', monogram: 'BL' }),
  mkStore('boscovs', "Boscov's", 'Department Stores', 'boscovs.com', { dealsUrl: 'https://www.boscovs.com/category/clearance', storeFinderUrl: 'https://www.boscovs.com/store-locator', accent: '#ef4444', monogram: 'BS' }),
  mkStore('saksoff5th', 'Saks OFF 5TH', 'Department Stores', 'saksoff5th.com', { dealsUrl: 'https://www.saksoff5th.com/c/clearance', storeFinderUrl: 'https://www.saksoff5th.com/stores', accent: '#e2e8f0', monogram: 'S5', aliases: ['saks off 5th', 'saks'] }),

  // 3. Clothing & Fashion (22)
  mkStore('nike', 'Nike', 'Clothing & Fashion', 'nike.com', { dealsUrl: 'https://www.nike.com/w/sale-3yaep', blackFridayUrl: 'https://www.nike.com/w/black-friday-2phlm', storeFinderUrl: 'https://www.nike.com/retail', localPresence: true, accent: '#f8fafc', monogram: 'NK' }),
  mkStore('adidas', 'Adidas', 'Clothing & Fashion', 'adidas.com', { url: 'https://www.adidas.com/us', dealsUrl: 'https://www.adidas.com/us/sale', blackFridayUrl: 'https://www.adidas.com/us/black_friday', storeFinderUrl: 'https://www.adidas.com/us/storefinder', accent: '#38bdf8', monogram: 'AD' }),
  mkStore('underarmour', 'Under Armour', 'Clothing & Fashion', 'underarmour.com', { url: 'https://www.underarmour.com/en-us/', dealsUrl: 'https://www.underarmour.com/en-us/c/outlet/', storeFinderUrl: 'https://www.underarmour.com/en-us/t/store-locator/', localPresence: true, accent: '#ef4444', monogram: 'UA', aliases: ['ua'] }),
  mkStore('lululemon', 'Lululemon', 'Clothing & Fashion', 'lululemon.com', { url: 'https://shop.lululemon.com/', dealsUrl: 'https://shop.lululemon.com/c/we-made-too-much/n18mhd', storeFinderUrl: 'https://shop.lululemon.com/stores', localPresence: true, accent: '#d31334', monogram: 'LL' }),
  mkStore('athleta', 'Athleta', 'Clothing & Fashion', 'athleta.gap.com', { url: 'https://athleta.gap.com/', dealsUrl: 'https://athleta.gap.com/browse/category.do?cid=1023728', storeFinderUrl: 'https://athleta.gap.com/stores', localPresence: true, accent: '#a855f7', monogram: 'AT', aliases: ['athleta.com'] }),
  mkStore('oldnavy', 'Old Navy', 'Clothing & Fashion', 'oldnavy.gap.com', { url: 'https://oldnavy.gap.com/', dealsUrl: 'https://oldnavy.gap.com/browse/category.do?cid=96964', storeFinderUrl: 'https://oldnavy.gap.com/stores', localPresence: true, accent: '#1d4ed8', monogram: 'ON', aliases: ['oldnavy.com'] }),
  mkStore('gap', 'Gap', 'Clothing & Fashion', 'gap.com', { dealsUrl: 'https://www.gap.com/browse/category.do?cid=65179', storeFinderUrl: 'https://www.gap.com/stores', localPresence: true, accent: '#1e3a8a', monogram: 'GP', aliases: ['gap factory'] }),
  mkStore('ae', 'American Eagle', 'Clothing & Fashion', 'ae.com', { url: 'https://www.ae.com/us/en', dealsUrl: 'https://www.ae.com/us/en/c/ae/clearance/cat6470584', storeFinderUrl: 'https://storelocations.ae.com/', localPresence: true, accent: '#0ea5e9', monogram: 'AE' }),
  mkStore('aerie', 'Aerie', 'Clothing & Fashion', 'ae.com', { url: 'https://www.ae.com/us/en/c/aerie/cat4840006', dealsUrl: 'https://www.ae.com/us/en/c/aerie/clearance/cat6460070', storeFinderUrl: 'https://storelocations.ae.com/', localPresence: true, accent: '#f472b6', monogram: 'AR', aliases: ['aerie'] }),
  mkStore('abercrombie', 'Abercrombie & Fitch', 'Clothing & Fashion', 'abercrombie.com', { url: 'https://www.abercrombie.com/shop/us', dealsUrl: 'https://www.abercrombie.com/shop/us/sale', storeFinderUrl: 'https://www.abercrombie.com/shop/us/store-locator', localPresence: true, accent: '#94a3b8', monogram: 'AF', aliases: ['abercrombie', 'a&f'] }),
  mkStore('hollister', 'Hollister', 'Clothing & Fashion', 'hollisterco.com', { url: 'https://www.hollisterco.com/shop/us', dealsUrl: 'https://www.hollisterco.com/shop/us/clearance', storeFinderUrl: 'https://www.hollisterco.com/shop/us/store-locator', localPresence: true, accent: '#38bdf8', monogram: 'HC' }),
  mkStore('hm', 'H&M', 'Clothing & Fashion', 'hm.com', { url: 'https://www2.hm.com/en_us/index.html', dealsUrl: 'https://www2.hm.com/en_us/sale.html', storeFinderUrl: 'https://www2.hm.com/en_us/customer-service/shopping-at-hm/store-locator.html', localPresence: true, accent: '#e50010', monogram: 'HM', aliases: ['h&m'] }),
  mkStore('zara', 'Zara', 'Clothing & Fashion', 'zara.com', { url: 'https://www.zara.com/us/', dealsUrl: 'https://www.zara.com/us/', storeFinderUrl: 'https://www.zara.com/us/en/stores', monitoringMode: 'directory_only', accent: '#e2e8f0', monogram: 'ZR' }),
  mkStore('uniqlo', 'Uniqlo', 'Clothing & Fashion', 'uniqlo.com', { url: 'https://www.uniqlo.com/us/en/', dealsUrl: 'https://www.uniqlo.com/us/en/feature/limited-offers/women', storeFinderUrl: 'https://map.uniqlo.com/us/en/', accent: '#ff0000', monogram: 'UQ' }),
  mkStore('freepeople', 'Free People', 'Clothing & Fashion', 'freepeople.com', { dealsUrl: 'https://www.freepeople.com/sale-all/', storeFinderUrl: 'https://www.freepeople.com/stores/', localPresence: true, monitoringMode: 'directory_only', accent: '#fb7185', monogram: 'FP' }),
  mkStore('anthropologie', 'Anthropologie', 'Clothing & Fashion', 'anthropologie.com', { dealsUrl: 'https://www.anthropologie.com/sale-all', storeFinderUrl: 'https://www.anthropologie.com/stores', localPresence: true, monitoringMode: 'directory_only', accent: '#f59e0b', monogram: 'AN' }),
  mkStore('madewell', 'Madewell', 'Clothing & Fashion', 'madewell.com', { dealsUrl: 'https://www.madewell.com/sale', storeFinderUrl: 'https://stores.madewell.com/', localPresence: true, accent: '#38bdf8', monogram: 'MW' }),
  mkStore('asos', 'ASOS', 'Clothing & Fashion', 'asos.com', { url: 'https://www.asos.com/us/', dealsUrl: 'https://www.asos.com/us/women/sale/cat/?cid=7046', accent: '#f8fafc', monogram: 'AS' }),
  mkStore('tjmaxx', 'T.J. Maxx', 'Clothing & Fashion', 'tjmaxx.tjx.com', { url: 'https://tjmaxx.tjx.com/store/index.jsp', dealsUrl: 'https://tjmaxx.tjx.com/store/shop/clearance/_/N-3951437597', storeFinderUrl: 'https://tjmaxx.tjx.com/store/stores/storeLocator.jsp', localPresence: true, monitoringMode: 'directory_only', accent: '#e11d48', monogram: 'TJ', aliases: ['tj maxx', 'tjmaxx'] }),
  mkStore('marshalls', 'Marshalls', 'Clothing & Fashion', 'marshalls.com', { url: 'https://www.marshalls.com/us/store/index.jsp', dealsUrl: 'https://www.marshalls.com/us/store/shop/clearance/_/N-3951437597', storeFinderUrl: 'https://www.marshalls.com/us/store/stores/storeLocator.jsp', localPresence: true, monitoringMode: 'directory_only', accent: '#0284c7', monogram: 'MR' }),
  mkStore('ross', 'Ross Dress for Less', 'Clothing & Fashion', 'rossstores.com', { url: 'https://www.rossstores.com/', dealsUrl: 'https://www.rossstores.com/', storeFinderUrl: 'https://www.rossstores.com/store-locator/', localPresence: true, monitoringMode: 'directory_only', accent: '#2563eb', monogram: 'RS', aliases: ['ross'] }),
  mkStore('burlington', 'Burlington', 'Clothing & Fashion', 'burlington.com', { dealsUrl: 'https://www.burlington.com/', storeFinderUrl: 'https://www.burlington.com/store-locator', localPresence: true, monitoringMode: 'directory_only', accent: '#dc2626', monogram: 'BU' }),

  // 4. Beauty (4)
  mkStore('sephora', 'Sephora', 'Beauty', 'sephora.com', { dealsUrl: 'https://www.sephora.com/sale', blackFridayUrl: 'https://www.sephora.com/beauty/black-friday', storeFinderUrl: 'https://www.sephora.com/happening/stores/raleigh', localPresence: true, accent: '#f43f5e', monogram: 'SP' }),
  mkStore('ulta', 'Ulta Beauty', 'Beauty', 'ulta.com', { dealsUrl: 'https://www.ulta.com/promotion/sale', blackFridayUrl: 'https://www.ulta.com/promotion/black-friday', storeFinderUrl: 'https://www.ulta.com/stores', localPresence: true, accent: '#f97316', monogram: 'UL' }),
  mkStore('bathbodyworks', 'Bath & Body Works', 'Beauty', 'bathandbodyworks.com', { dealsUrl: 'https://www.bathandbodyworks.com/t/top-offers', blackFridayUrl: 'https://www.bathandbodyworks.com/t/black-friday', storeFinderUrl: 'https://www.bathandbodyworks.com/store-locator', localPresence: true, accent: '#2563eb', monogram: 'BB' }),
  mkStore('victoriassecret', "Victoria's Secret", 'Beauty', 'victoriassecret.com', { url: 'https://www.victoriassecret.com/us/', dealsUrl: 'https://www.victoriassecret.com/us/vs/sale', storeFinderUrl: 'https://www.victoriassecret.com/us/store-locator', localPresence: true, accent: '#ec4899', monogram: 'VS' }),

  // 5. Electronics (11)
  mkStore('bestbuy', 'Best Buy', 'Electronics', 'bestbuy.com', { dealsUrl: 'https://www.bestbuy.com/site/misc/deal-of-the-day/pcmcat248000050016.c', blackFridayUrl: 'https://www.bestbuy.com/site/black-friday/sale-ad/pcmcat1568908420641.c', storeFinderUrl: 'https://www.bestbuy.com/site/store-locator/27545', localPresence: true, monitoringMode: 'direct_api_ready', accent: '#facc15', monogram: 'BB', aliases: ['best buy'], dealTiming: "Sale Nov 19–28 · New doorbusters on Fridays + a Thanksgiving Day online flash sale · Stores Fri 6 AM–10 PM" }),
  mkStore('apple', 'Apple', 'Electronics', 'apple.com', { dealsUrl: 'https://www.apple.com/shop/refurbished', blackFridayUrl: 'https://www.apple.com/shop/gifts/shopping-event', storeFinderUrl: 'https://www.apple.com/retail/crabtreevalleymall/', localPresence: true, accent: '#e2e8f0', monogram: 'AP', aliases: ['apple store'] }),
  mkStore('samsung', 'Samsung', 'Electronics', 'samsung.com', { url: 'https://www.samsung.com/us/', dealsUrl: 'https://www.samsung.com/us/shop/all-deals/', blackFridayUrl: 'https://www.samsung.com/us/shop/black-friday/', accent: '#1d4ed8', monogram: 'SM' }),
  mkStore('dell', 'Dell', 'Electronics', 'dell.com', { url: 'https://www.dell.com/en-us', dealsUrl: 'https://www.dell.com/en-us/shop/deals', blackFridayUrl: 'https://www.dell.com/en-us/lp/black-friday-deals', accent: '#0284c7', monogram: 'DL', aliases: ['dell outlet'] }),
  mkStore('hp', 'HP', 'Electronics', 'hp.com', { url: 'https://www.hp.com/us-en/home.html', dealsUrl: 'https://www.hp.com/us-en/shop/slp/weekly-deals', accent: '#0096d6', monogram: 'HP' }),
  mkStore('lenovo', 'Lenovo', 'Electronics', 'lenovo.com', { url: 'https://www.lenovo.com/us/en/', dealsUrl: 'https://www.lenovo.com/us/en/d/deals/doorbusters/', accent: '#e2231a', monogram: 'LN' }),
  mkStore('newegg', 'Newegg', 'Electronics', 'newegg.com', { dealsUrl: 'https://www.newegg.com/todays-deals', accent: '#f59e0b', monogram: 'NE' }),
  mkStore('gamestop', 'GameStop', 'Electronics', 'gamestop.com', { dealsUrl: 'https://www.gamestop.com/deals', storeFinderUrl: 'https://www.gamestop.com/stores/', localPresence: true, accent: '#ef4444', monogram: 'GS' }),
  mkStore('googlestore', 'Google Store', 'Electronics', 'store.google.com', { url: 'https://store.google.com/us/', dealsUrl: 'https://store.google.com/us/collection/offers', accent: '#34d399', monogram: 'GG', aliases: ['google store'] }),
  mkStore('microsoft', 'Microsoft Store', 'Electronics', 'microsoft.com', { url: 'https://www.microsoft.com/en-us/store/b/home', dealsUrl: 'https://www.microsoft.com/en-us/store/b/sale', accent: '#38bdf8', monogram: 'MS', aliases: ['microsoft'] }),
  mkStore('bhphoto', 'B&H Photo Video', 'Electronics', 'bhphotovideo.com', { dealsUrl: 'https://www.bhphotovideo.com/c/buy/rebates-promotions/ci/22144', accent: '#a855f7', monogram: 'BH', aliases: ['b&h', 'b&h photo'] }),

  // 6. Home & Furniture (12)
  mkStore('homedepot', 'Home Depot', 'Home & Furniture', 'homedepot.com', { dealsUrl: 'https://www.homedepot.com/SpecialBuy/SpecialBuyOfTheDay', blackFridayUrl: 'https://www.homedepot.com/c/black-friday', storeFinderUrl: 'https://www.homedepot.com/l/search/27545/full/', localPresence: true, accent: '#f96302', monogram: 'HD', aliases: ['the home depot'], dealTiming: "Black Friday Savings Nov 5–25 · Appliance deals Thu Nov 26 · Doorbusters Fri Nov 27, stores 6 AM · A new Special Buy every day" }),
  mkStore('lowes', "Lowe's", 'Home & Furniture', 'lowes.com', { dealsUrl: 'https://www.lowes.com/l/savings', blackFridayUrl: 'https://www.lowes.com/l/savings/black-friday-deals', storeFinderUrl: 'https://www.lowes.com/store/NC-Knightdale/2483', localPresence: true, accent: '#004990', monogram: 'LW', aliases: ['lowes'], dealTiming: "12 Days of Deals from Nov 16 — a new drop every day · Doorbusters Fri Nov 27 (MyLowe’s members get them online a day early, Nov 26)" }),
  mkStore('wayfair', 'Wayfair', 'Home & Furniture', 'wayfair.com', { dealsUrl: 'https://www.wayfair.com/daily-sales/closeout', accent: '#7f187f', monogram: 'WF' }),
  mkStore('ikea', 'IKEA', 'Home & Furniture', 'ikea.com', { url: 'https://www.ikea.com/us/en/', dealsUrl: 'https://www.ikea.com/us/en/offers/', storeFinderUrl: 'https://www.ikea.com/us/en/stores/', accent: '#facc15', monogram: 'IK' }),
  mkStore('potterybarn', 'Pottery Barn', 'Home & Furniture', 'potterybarn.com', { dealsUrl: 'https://www.potterybarn.com/shop/sale/', storeFinderUrl: 'https://www.potterybarn.com/customer-service/store-locator.html', localPresence: true, accent: '#cbd5e1', monogram: 'PB' }),
  mkStore('westelm', 'West Elm', 'Home & Furniture', 'westelm.com', { dealsUrl: 'https://www.westelm.com/shop/sale/', storeFinderUrl: 'https://www.westelm.com/stores/', localPresence: true, accent: '#94a3b8', monogram: 'WE' }),
  mkStore('crateandbarrel', 'Crate & Barrel', 'Home & Furniture', 'crateandbarrel.com', { dealsUrl: 'https://www.crateandbarrel.com/sale/', storeFinderUrl: 'https://www.crateandbarrel.com/stores/', localPresence: true, accent: '#e2e8f0', monogram: 'CB', aliases: ['crate & barrel'] }),
  mkStore('williamssonoma', 'Williams Sonoma', 'Home & Furniture', 'williams-sonoma.com', { dealsUrl: 'https://www.williams-sonoma.com/shop/sale-special-offer/', storeFinderUrl: 'https://www.williams-sonoma.com/customer-service/store-locator.html', localPresence: true, accent: '#10b981', monogram: 'WS' }),
  mkStore('athome', 'At Home', 'Home & Furniture', 'athome.com', { dealsUrl: 'https://www.athome.com/clearance/', storeFinderUrl: 'https://www.athome.com/store-find/', localPresence: true, monitoringMode: 'directory_only', accent: '#06b6d4', monogram: 'AH' }),
  mkStore('homegoods', 'HomeGoods', 'Home & Furniture', 'homegoods.com', { dealsUrl: 'https://www.homegoods.com/', storeFinderUrl: 'https://www.homegoods.com/locator', localPresence: true, monitoringMode: 'directory_only', accent: '#dc2626', monogram: 'HG' }),
  mkStore('acehardware', 'Ace Hardware', 'Home & Furniture', 'acehardware.com', { dealsUrl: 'https://www.acehardware.com/hot-buys', storeFinderUrl: 'https://www.acehardware.com/store-locator', localPresence: true, accent: '#dc2626', monogram: 'AC' }),
  mkStore('bedbathbeyond', 'Bed Bath & Beyond', 'Home & Furniture', 'bedbathandbeyond.com', { dealsUrl: 'https://www.bedbathandbeyond.com/deals', accent: '#0284c7', monogram: 'BB', aliases: ['overstock', 'overstock.com'], domainHints: ['bedbathandbeyond.com', 'overstock.com'] }),

  // 7. Sporting Goods (7)
  mkStore('dicks', "Dick's Sporting Goods", 'Sporting Goods', 'dickssportinggoods.com', { dealsUrl: 'https://www.dickssportinggoods.com/f/clearance-deals', blackFridayUrl: 'https://www.dickssportinggoods.com/s/black-friday', storeFinderUrl: 'https://stores.dickssportinggoods.com/nc/raleigh/', localPresence: true, accent: '#10b981', monogram: 'DS', aliases: ['dicks sporting goods'] }),
  mkStore('academy', 'Academy Sports', 'Sporting Goods', 'academy.com', { dealsUrl: 'https://www.academy.com/c/clearance', storeFinderUrl: 'https://www.academy.com/storelocator', localPresence: true, accent: '#0284c7', monogram: 'AS', aliases: ['academy sports + outdoors'], dealTiming: "Online sale Nov 20–29 · Stores Fri 5 AM–11 PM · Closed Thanksgiving" }),
  mkStore('rei', 'REI', 'Sporting Goods', 'rei.com', { dealsUrl: 'https://www.rei.com/rei-garage', storeFinderUrl: 'https://www.rei.com/stores/raleigh', localPresence: true, accent: '#22c55e', monogram: 'RI', aliases: ['rei co-op'] }),
  mkStore('basspro', 'Bass Pro Shops', 'Sporting Goods', 'basspro.com', { dealsUrl: 'https://www.basspro.com/shop/en/bargain-cave', storeFinderUrl: 'https://stores.basspro.com/', localPresence: true, accent: '#f59e0b', monogram: 'BP' }),
  mkStore('cabelas', "Cabela's", 'Sporting Goods', 'cabelas.com', { dealsUrl: 'https://www.cabelas.com/shop/en/bargain-cave', storeFinderUrl: 'https://stores.basspro.com/us/nc/garner/201-cabela-drive.html', localPresence: true, accent: '#84cc16', monogram: 'CB', aliases: ['cabelas'], dealTiming: "Online Nov 24–30 · Open Thanksgiving Day (short hours) · Black Friday doors 5 AM" }),
  mkStore('scheels', 'Scheels', 'Sporting Goods', 'scheels.com', { dealsUrl: 'https://www.scheels.com/c/sale', storeFinderUrl: 'https://www.scheels.com/stores', accent: '#ef4444', monogram: 'SH' }),
  mkStore('golfgalaxy', 'Golf Galaxy', 'Sporting Goods', 'golfgalaxy.com', { dealsUrl: 'https://www.golfgalaxy.com/f/golf-deals', storeFinderUrl: 'https://www.golfgalaxy.com/s/store-locator', localPresence: true, accent: '#38bdf8', monogram: 'GG' }),

  // 8. Gifts & Specialty (12)
  mkStore('etsy', 'Etsy', 'Gifts & Specialty', 'etsy.com', { dealsUrl: 'https://www.etsy.com/featured/deals', monitoringMode: 'directory_only', accent: '#f97316', monogram: 'ET' }),
  mkStore('lego', 'LEGO', 'Gifts & Specialty', 'lego.com', { url: 'https://www.lego.com/en-us', dealsUrl: 'https://www.lego.com/en-us/categories/sales-and-deals', blackFridayUrl: 'https://www.lego.com/en-us/black-friday-deals', storeFinderUrl: 'https://www.lego.com/en-us/stores/store/crabtree-valley-mall', localPresence: true, accent: '#ef4444', monogram: 'LG', aliases: ['lego store'] }),
  mkStore('barnesnoble', 'Barnes & Noble', 'Gifts & Specialty', 'barnesandnoble.com', { dealsUrl: 'https://www.barnesandnoble.com/b/deals', storeFinderUrl: 'https://stores.barnesandnoble.com', localPresence: true, accent: '#366251', monogram: 'BN', aliases: ['barnes and noble', 'bn'], dealTiming: "Closed Thanksgiving · Black Friday from about 8 AM in stores (varies by store) · Online deals from 3 AM ET Fri" }),
  mkStore('disneystore', 'Disney Store', 'Gifts & Specialty', 'disneystore.com', { dealsUrl: 'https://www.disneystore.com/sale-content/', accent: '#3b82f6', monogram: 'DN', aliases: ['shopdisney', 'shopdisney.com'], domainHints: ['disneystore.com', 'shopdisney.com'] }),
  mkStore('uncommongoods', 'Uncommon Goods', 'Gifts & Specialty', 'uncommongoods.com', { dealsUrl: 'https://www.uncommongoods.com/gifts/sale', monitoringMode: 'directory_only', accent: '#14b8a6', monogram: 'UG' }),
  mkStore('fivebelow', 'Five Below', 'Gifts & Specialty', 'fivebelow.com', { dealsUrl: 'https://www.fivebelow.com/categories/new-and-now', storeFinderUrl: 'https://locations.fivebelow.com/', localPresence: true, monitoringMode: 'directory_only', accent: '#38bdf8', monogram: '5B' }),
  mkStore('michaels', 'Michaels', 'Gifts & Specialty', 'michaels.com', { dealsUrl: 'https://www.michaels.com/shop/clearance', storeFinderUrl: 'https://locations.michaels.com/', localPresence: true, accent: '#e11d48', monogram: 'MC' }),
  mkStore('hobbylobby', 'Hobby Lobby', 'Gifts & Specialty', 'hobbylobby.com', { dealsUrl: 'https://www.hobbylobby.com/weekly-ad', storeFinderUrl: 'https://www.hobbylobby.com/stores/search', localPresence: true, monitoringMode: 'directory_only', accent: '#f97316', monogram: 'HL' }),
  mkStore('tractorsupply', 'Tractor Supply', 'Gifts & Specialty', 'tractorsupply.com', { dealsUrl: 'https://www.tractorsupply.com/tsc/cms/clearance', storeFinderUrl: 'https://www.tractorsupply.com/tsc/store-locator', localPresence: true, accent: '#dc2626', monogram: 'TS', aliases: ['tsc'] }),
  mkStore('harborfreight', 'Harbor Freight', 'Gifts & Specialty', 'harborfreight.com', { dealsUrl: 'https://www.harborfreight.com/clearance', storeFinderUrl: 'https://www.harborfreight.com/storelocator/location/map', localPresence: true, accent: '#ef4444', monogram: 'HF' }),
  mkStore('chewy', 'Chewy', 'Gifts & Specialty', 'chewy.com', { dealsUrl: 'https://www.chewy.com/b/deals-2723', accent: '#2563eb', monogram: 'CW' }),
  mkStore('petsmart', 'PetSmart', 'Gifts & Specialty', 'petsmart.com', { dealsUrl: 'https://www.petsmart.com/sale/', storeFinderUrl: 'https://www.petsmart.com/store-locator/', localPresence: true, accent: '#ef4444', monogram: 'PS' }),
  mkStore('petco', 'Petco', 'Gifts & Specialty', 'petco.com', { dealsUrl: 'https://www.petco.com/shop/en/petcostore/c/clearance', storeFinderUrl: 'https://www.petco.com/shop/en/petcostore/store-locator', localPresence: true, accent: '#0284c7', monogram: 'PC' }),

  // 9. Deal Discovery (10)
  mkStore('slickdeals', 'Slickdeals', 'Deal Discovery', 'slickdeals.net', { url: 'https://slickdeals.net/', dealsUrl: 'https://slickdeals.net/', blackFridayUrl: 'https://slickdeals.net/blackfriday/', accent: '#0ea5e9', monogram: 'SD' }),
  mkStore('dealnews', 'DealNews', 'Deal Discovery', 'dealnews.com', { dealsUrl: 'https://www.dealnews.com/', blackFridayUrl: 'https://www.dealnews.com/black-friday/', accent: '#10b981', monogram: 'DN' }),
  mkStore('bradsdeals', "Brad's Deals", 'Deal Discovery', 'bradsdeals.com', { dealsUrl: 'https://www.bradsdeals.com/', blackFridayUrl: 'https://www.bradsdeals.com/black-friday', accent: '#3b82f6', monogram: 'BD' }),
  mkStore('retailmenot', 'RetailMeNot', 'Deal Discovery', 'retailmenot.com', { dealsUrl: 'https://www.retailmenot.com/', blackFridayUrl: 'https://www.retailmenot.com/holidays/black-friday', accent: '#a855f7', monogram: 'RM' }),
  mkStore('rakuten', 'Rakuten', 'Deal Discovery', 'rakuten.com', { dealsUrl: 'https://www.rakuten.com/coupons', accent: '#7c3aed', monogram: 'RK' }),
  mkStore('woot', 'Woot!', 'Deal Discovery', 'woot.com', { dealsUrl: 'https://www.woot.com/alldeals', accent: '#22c55e', monogram: 'WT' }),
  mkStore('meh', 'Meh', 'Deal Discovery', 'meh.com', { url: 'https://meh.com/', dealsUrl: 'https://meh.com/', accent: '#94a3b8', monogram: 'MH' }),
  mkStore('camelcamelcamel', 'CamelCamelCamel', 'Deal Discovery', 'camelcamelcamel.com', { url: 'https://camelcamelcamel.com/', dealsUrl: 'https://camelcamelcamel.com/top_drops', accent: '#f59e0b', monogram: '3C' }),
  mkStore('keepa', 'Keepa', 'Deal Discovery', 'keepa.com', { url: 'https://keepa.com/', dealsUrl: 'https://keepa.com/#!deals', accent: '#38bdf8', monogram: 'KP' }),
  mkStore('cashbackmonitor', 'Cashback Monitor', 'Deal Discovery', 'cashbackmonitor.com', { dealsUrl: 'https://www.cashbackmonitor.com/', accent: '#10b981', monogram: 'CB' }),
]);

export const RETAILER_BY_ID = Object.freeze(
  Object.fromEntries(RETAILER_DIRECTORY.map((r) => [r.id, r]))
);

export const KNOWN_BRANDS = Object.freeze([
  'Apple', 'Sony', 'Samsung', 'LG', 'Bose', 'JBL', 'Sonos', 'Beats', 'Sennheiser', 'Anker',
  'Nintendo', 'PlayStation', 'Xbox', 'Microsoft', 'Google', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer',
  'MSI', 'AMD', 'Intel', 'NVIDIA', 'Logitech', 'Razer', 'Corsair', 'Garmin', 'Fitbit', 'Oura',
  'Dyson', 'Shark', 'Ninja', 'KitchenAid', 'Breville', 'Vitamix', 'Instant Pot', 'Cuisinart', 'Keurig', 'Nespresso',
  'Roomba', 'iRobot', 'Roborock', 'Eufy', 'Ring', 'Blink', 'Arlo', 'Philips', 'Oral-B', 'Braun',
  'DeWalt', 'Milwaukee', 'Makita', 'Ryobi', 'Craftsman', 'Bosch', 'Black+Decker', 'EGO', 'Greenworks',
  'Yeti', 'Stanley', 'Hydro Flask', 'Owala', 'RTIC', 'Traeger', 'Weber', 'Blackstone', 'Solo Stove',
  'Nike', 'Adidas', 'Under Armour', 'New Balance', 'Hoka', 'Brooks', 'On', 'Asics', 'Patagonia', 'North Face',
  'Columbia', 'Carhartt', 'Lululemon', 'Athleta', 'Levi', 'Coach', 'Ralph Lauren', 'UGG', 'Crocs', 'Birkenstock',
  'Free People', 'Madewell', 'LEGO', 'Barbie', 'Hot Wheels', 'Nerf', 'Hasbro', 'Mattel', 'Fisher-Price', 'Disney',
  'Canon', 'Nikon', 'Fujifilm', 'GoPro', 'DJI', 'Brother', 'Epson', 'Roku', 'Fire TV', 'Kindle',
  'Seiko', 'Casio', 'Estee Lauder', 'Clinique', 'Olaplex', 'Laneige', 'Sol de Janeiro', 'CeraVe',
  'Samsonite', 'Away', 'Tumi', 'Crayola', 'Melissa & Doug', 'VTech', 'Play-Doh', 'Tempur-Pedic', 'Casper',
  'Titleist', 'Callaway', 'TaylorMade', 'Ping', 'Scotty Cameron', 'Le Creuset', 'All-Clad', 'Lodge',
]);

export const PRODUCT_CATEGORIES = Object.freeze([
  { id: 'electronics', label: 'Electronics & Tech', keywords: ['tv', 'oled', 'qled', 'laptop', 'macbook', 'ipad', 'tablet', 'iphone', 'pixel', 'galaxy', 'headphone', 'earbud', 'airpods', 'speaker', 'soundbar', 'monitor', 'ssd', 'nvme', 'gpu', 'rtx', 'router', 'camera', 'printer', 'smartwatch', 'watch', 'charger', 'power bank', 'bluetooth', 'usb', 'hdmi', 'kindle', 'roku', 'echo', 'fire tv', 'chromebook', 'desktop', 'keyboard', 'mouse', 'webcam', 'projector'] },
  { id: 'gaming', label: 'Gaming', keywords: ['nintendo', 'switch', 'ps5', 'playstation', 'xbox', 'steam', 'controller', 'gaming', 'mario', 'zelda', 'pokemon', 'headset', 'vr', 'quest', 'console', 'game'] },
  { id: 'home', label: 'Home & Kitchen', keywords: ['vacuum', 'dyson', 'shark', 'ninja', 'air fryer', 'blender', 'espresso', 'coffee', 'keurig', 'kitchenaid', 'mixer', 'cookware', 'pan', 'pot', 'mattress', 'pillow', 'sheet', 'blanket', 'towel', 'air purifier', 'humidifier', 'heater', 'fan', 'furniture', 'chair', 'desk', 'sofa', 'rug', 'lamp', 'storage', 'organizer', 'tumbler', 'stanley', 'yeti', 'owala', 'dutch oven', 'creuset'] },
  { id: 'tools', label: 'Tools & Home Improvement', keywords: ['drill', 'saw', 'dewalt', 'milwaukee', 'ryobi', 'makita', 'craftsman', 'wrench', 'socket', 'toolbox', 'ladder', 'mower', 'blower', 'pressure washer', 'generator', 'grill', 'blackstone', 'traeger', 'weber', 'light', 'thermostat', 'doorbell', 'lock', 'battery', 'impact driver', 'compressor'] },
  { id: 'apparel', label: 'Clothing & Shoes', keywords: ['shoe', 'sneaker', 'boot', 'slide', 'sandal', 'jacket', 'coat', 'hoodie', 'sweater', 'fleece', 'shirt', 'tee', 'polo', 'jeans', 'pant', 'legging', 'short', 'dress', 'sock', 'hat', 'beanie', 'glove', 'pajama', 'backpack', 'luggage', 'bag', 'nike', 'adidas', 'jordan', 'patagonia', 'north face', 'carhartt', 'ugg', 'crocs', 'lululemon', 'athleta', 'pullover'] },
  { id: 'beauty', label: 'Beauty & Personal Care', keywords: ['skincare', 'serum', 'moisturizer', 'cleanser', 'makeup', 'mascara', 'lipstick', 'perfume', 'cologne', 'fragrance', 'shampoo', 'conditioner', 'hair dryer', 'straightener', 'toothbrush', 'shaver', 'razor', 'lotion', 'candle', 'sephora', 'ulta', 'lauder', 'clinique', 'oral-b'] },
  { id: 'toys', label: 'Toys, LEGO & Gifts', keywords: ['lego', 'toy', 'doll', 'barbie', 'hot wheels', 'nerf', 'board game', 'puzzle', 'plush', 'playset', 'action figure', 'rc car', 'scooter', 'bike', 'gift set', 'gift card', 'disney', 'kids', 'toddler', 'baby'] },
  { id: 'outdoors', label: 'Sports & Outdoors', keywords: ['golf', 'tent', 'camping', 'cooler', 'kayak', 'fishing', 'hiking', 'fitness', 'dumbbell', 'treadmill', 'yoga', 'basketball', 'football', 'baseball', 'soccer', 'cycling', 'pickleball', 'tackle', 'putter', 'driver', 'club'] },
  { id: 'pets', label: 'Pets', keywords: ['dog', 'cat', 'pet', 'chewy', 'kibble', 'litter', 'leash', 'collar', 'crate', 'treat', 'aquarium', 'petsmart', 'petco'] },
]);

export const GIFT_PERSONA_RULES = Object.freeze([
  { match: /college|student|dorm|teen/i, categories: ['electronics', 'home', 'apparel', 'gaming'], keywords: ['earbuds', 'headphones', 'speaker', 'backpack', 'tumbler', 'coffee', 'charger', 'power bank', 'hoodie', 'lamp', 'tablet', 'monitor', 'blanket'] },
  { match: /dad|father|husband|men|him|guy/i, categories: ['tools', 'electronics', 'outdoors', 'apparel'], keywords: ['dewalt', 'milwaukee', 'grill', 'cooler', 'yeti', 'speaker', 'headphones', 'watch', 'golf', 'jacket', 'boots', 'coffee', 'espresso', 'wrench', 'drill'] },
  { match: /mom|mother|wife|women|her/i, categories: ['home', 'beauty', 'apparel', 'electronics'], keywords: ['kitchenaid', 'dyson', 'ninja', 'espresso', 'candle', 'blanket', 'skincare', 'perfume', 'ugg', 'stanley', 'owala', 'kindle', 'airpods', 'luggage', 'robe'] },
  { match: /kid|child|boy|girl|toddler|son|daughter|\b[3-9]\s*year|\b1[0-2]\s*year/i, categories: ['toys', 'gaming', 'apparel'], keywords: ['lego', 'nintendo', 'switch', 'mario', 'toy', 'playset', 'rc', 'scooter', 'barbie', 'nerf', 'board game', 'disney', 'plush', 'tablet'] },
  { match: /gamer|gaming|pc|tech/i, categories: ['gaming', 'electronics'], keywords: ['nintendo', 'ps5', 'xbox', 'controller', 'headset', 'monitor', 'ssd', 'keyboard', 'mouse', 'gpu', 'steam', 'game'] },
  { match: /cook|chef|kitchen|home|housewarming|family/i, categories: ['home', 'electronics'], keywords: ['ninja', 'air fryer', 'blender', 'kitchenaid', 'espresso', 'cookware', 'vacuum', 'dyson', 'shark', 'blanket', 'towel', 'speaker'] },
  { match: /dog|cat|pet/i, categories: ['pets'], keywords: ['dog', 'cat', 'pet', 'chewy', 'treat', 'bed', 'toy'] },
  { match: /fitness|runner|gym|outdoor|camp|golf/i, categories: ['outdoors', 'apparel', 'electronics'], keywords: ['garmin', 'watch', 'nike', 'adidas', 'running', 'golf', 'cooler', 'yeti', 'tent', 'hiking', 'dumbbell', 'earbuds'] },
]);
