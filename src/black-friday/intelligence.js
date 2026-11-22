/**
 * Deterministic Product Normalization, Exact Cross-Retailer Matching,
 * True Deal Detection, 0-100 Shopping Decision Engine, Smarter Alternatives,
 * and Autonomous Deal Hunter Intelligence.
 *
 * Non-negotiable accuracy policy:
 * - Never invent historical prices, review scores, inventory, or discounts.
 * - Never award decision-score points for unavailable evidence.
 * - Reject model-generation, capacity, screen-size, condition, and accessory mismatches.
 */

import crypto from 'node:crypto';
import {
  KNOWN_BRANDS,
  PRODUCT_CATEGORIES,
  RETAILER_DIRECTORY,
  RETAILER_BY_ID,
  GIFT_PERSONA_RULES,
  PRIMARY_LOCATION,
} from './constants.js';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'off', 'free', 'shipping', 'sale', 'deal', 'deals',
  'black', 'friday', 'cyber', 'monday', 'save', 'up', 'to', 'only', 'just', 'now', 'new',
  'select', 'more', 'pack', 'set', 'kit', 'bundle', 'edition', 'series', 'model', 'plus',
  'at', 'on', 'in', 'by', 'or', 'of', 'a', 'an', 'is', 'are', 'get', 'buy', 'shop',
  'online', 'store', 'pickup', 'clearance', 'doorbuster', 'lowest', 'price', 'ever',
  'amazon', 'walmart', 'target', 'best', 'costco', 'sams', 'club', 'kohls', 'macys',
  'home', 'depot', 'lowes', 'ebay', 'newegg', 'w', 's', 'h', 'sh', 'fs', 'reg', 'was',
]);

const ACCESSORY_TERMS = /\b(case|cover|sleeve|screen protector|tempered glass|replacement band|watch band|ear tips|earpads|carrying case|travel case|charging cable|wall charger|adapter|mount|stand|tripod|strap|pouch|shell|skin|decal|filter pack|dust bag|replacement brush|replacement head|refill|ink cartridge|toner)\b/i;

const REFURB_PATTERN = /\b(refurbished|renewed|reconditioned|factory reconditioned|certified pre-owned|pre-owned|used|like new)\b/i;
const OPEN_BOX_PATTERN = /\b(open[\s-]?box|scratch\s*&?\s*dent|display model)\b/i;

export function roundMoney(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function detectRetailer({ vendorName = '', url = '', text = '' } = {}) {
  const combinedVendor = String(vendorName || '').toLowerCase().trim();
  const combinedUrl = String(url || '').toLowerCase();
  const combinedText = String(text || '').toLowerCase();

  // 1. Direct URL domain hint check (most reliable when direct retailer URL is present)
  if (combinedUrl) {
    for (const r of RETAILER_DIRECTORY) {
      if (r.domainHints?.some((d) => combinedUrl.includes(d))) {
        return { id: r.id, name: r.name, matchedBy: 'url_domain' };
      }
    }
  }

  // 2. Explicit vendor name tag from RSS (e.g. TechBargains <vendorname>, DealNews merchant)
  if (combinedVendor) {
    for (const r of RETAILER_DIRECTORY) {
      if (
        combinedVendor === r.name.toLowerCase() ||
        combinedVendor === r.id ||
        r.aliases?.some((a) => combinedVendor === a || combinedVendor.includes(a))
      ) {
        return { id: r.id, name: r.name, matchedBy: 'vendor_tag' };
      }
    }
  }

  // 3. Explicit text patterns ("Buy Now at Amazon", "at Target", "from Best Buy", "Walmart has")
  const merchantPatterns = [
    /buy now at ([a-z0-9 '&.\-]{2,32})/i,
    /\bat (amazon|walmart|target|best buy|costco|sam'?s club|home depot|lowe'?s|macy'?s|kohl'?s|newegg|ebay|nordstrom|nordstrom rack|sephora|ulta|nike|adidas|apple|samsung|dell|hp|lenovo|wayfair|chewy|lego|gamestop|rei|dick'?s sporting goods|academy sports|harbor freight|tractor supply|ace hardware|old navy|gap|jcpenney|belk|qvc|hsn|woot|b&h photo|bath & body works|lululemon)\b/i,
    /\b(amazon|walmart|target|best buy|costco|sam'?s club|home depot|lowe'?s|macy'?s|kohl'?s|newegg|ebay|nordstrom|sephora|ulta|nike|adidas|apple|samsung|dell|hp|lenovo|wayfair|chewy|lego|gamestop|rei|harbor freight|tractor supply|ace hardware|old navy|gap|jcpenney|belk|woot)\s+(?:has|offers|is offering|black friday|sale|deals?)\b/i,
  ];
  for (const pat of merchantPatterns) {
    const m = combinedText.match(pat);
    if (m?.[1]) {
      const candidate = m[1].toLowerCase().trim().replace(/\.$/, '');
      for (const r of RETAILER_DIRECTORY) {
        if (
          candidate === r.name.toLowerCase() ||
          candidate === r.id ||
          r.aliases?.some((a) => candidate.includes(a) || a.includes(candidate))
        ) {
          return { id: r.id, name: r.name, matchedBy: 'text_pattern' };
        }
      }
    }
  }

  // 4. Fallback: clean explicit vendorName if provided even if not in top-60 directory
  if (vendorName && vendorName.trim().length >= 2 && vendorName.trim().length <= 40) {
    const clean = vendorName.trim();
    const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
    return { id, name: clean, matchedBy: 'vendor_other' };
  }

  return { id: 'other', name: 'Online Retailer', matchedBy: 'unknown' };
}

export function extractIdentifiers({ url = '', text = '', explicit = {} } = {}) {
  const ids = {
    asin: explicit.asin || null,
    upc: explicit.upc || null,
    gtin: explicit.gtin || null,
    sku: explicit.sku || null,
    mpn: explicit.mpn || null,
    tcin: explicit.tcin || null,
    walmartId: explicit.walmartId || null,
  };

  const fullUrl = String(url || '');
  const fullText = String(text || '');

  // Amazon ASIN from URL (/dp/B0..., /gp/product/B0..., camelcamelcamel /product/B0...)
  if (!ids.asin) {
    const asinMatch = fullUrl.match(/(?:\/dp\/|\/gp\/product\/|\/product\/)(B0[A-Z0-9]{8}|[0-9]{9}[0-9X])(?=[/?#&]|$)/i);
    if (asinMatch) ids.asin = asinMatch[1].toUpperCase();
  }

  // Target TCIN (/A-12345678)
  if (!ids.tcin) {
    const tcinMatch = fullUrl.match(/\/-\/A-(\d{6,10})/i);
    if (tcinMatch) ids.tcin = tcinMatch[1];
  }

  // Best Buy SKU (skuId=1234567 or /1234567.p)
  if (!ids.sku) {
    const bbSku = fullUrl.match(/(?:skuId=|\/)(\d{7})(?:\.p|[&#?]|$)/i);
    if (bbSku && /bestbuy\.com/i.test(fullUrl)) ids.sku = bbSku[1];
  }

  // Walmart Item ID (/ip/slug/123456789)
  if (!ids.walmartId) {
    const wm = fullUrl.match(/walmart\.com\/ip\/[^/?#]+\/(\d{6,12})/i);
    if (wm) ids.walmartId = wm[1];
  }

  // Explicit UPC/GTIN in text
  if (!ids.upc && !ids.gtin) {
    const upcMatch = fullText.match(/\b(?:UPC|GTIN|EAN)[:\s#]*(\d{12,14})\b/i);
    if (upcMatch) {
      if (upcMatch[1].length === 12) ids.upc = upcMatch[1];
      else ids.gtin = upcMatch[1];
    }
  }

  return ids;
}

export function detectBrand(text) {
  const haystack = String(text || '');
  for (const brand of KNOWN_BRANDS) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
    if (re.test(haystack)) return brand;
  }
  return null;
}

export function extractModelNumber(text) {
  const clean = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\$\d[\d,.]*/g, ' ');

  // High-confidence structured model tokens (letters + digits + optional hyphens, e.g. WH-1000XM5, OLED65C4PUA, RTX 4070, DCD771C2, 75375)
  const candidates = [];

  // Hyphenated/alphanumeric electronics/appliance/tool models
  const alnumMatches = clean.matchAll(/\b([A-Z]{1,6}[-]?[0-9]{2,6}[A-Z0-9-]{0,6}|[A-Z]{2,5}[0-9]{1,3}[A-Z]{1,3}[0-9]{0,3})\b/g);
  for (const m of alnumMatches) {
    const token = m[1];
    if (/^(202[0-9]|199\d|1080p|2160p|4K|8K|USB|HDMI|WIFI|LED|OLED|QLED|DDR[45]|PCIE|NVME|SATA|RGB|IPS|VA|HDR\d*|MP|FPS|HZ|GHZ|MHZ|MAH|WH|GB|TB|MB|OZ|FL|LB|LBS|FT|IN|MM|CM|QT|PC|PCS|PK|CT|XL|XXL|XS|SM|MD|LG|V\d{1,2}|M[1-5])$/i.test(token)) continue;
    if (/^(EXTRA|SAVE|OFF|DEAL|BF|BFRIDAY|CYBER|PROMO|CODE|GIFT|VIP|WELCOME|HOLIDAY|BIRTHDAY|SPRING|SUMMER|WINTER|FALL|FLASH|SALE)\d{1,4}$/i.test(token)) continue;
    if (/^\d+(?:GB|TB|MB|HZ|W|V|IN|FT|OZ|LB|QT|MM|CM|ML|G|KG|PK|PC|CT)$/i.test(token)) continue;
    if (/[A-Z]/i.test(token) && /\d/.test(token) && token.length >= 4 && token.length <= 18) {
      candidates.push(token.toUpperCase());
    }
  }

  // LEGO 5-digit set numbers
  if (/\blego\b/i.test(clean)) {
    const legoSet = clean.match(/\b(\d{5})\b/);
    if (legoSet) candidates.unshift(legoSet[1]);
  }

  return candidates[0] || null;
}

const VERSION_UNIT_FOLLOW = /^(?:oz|fl|lb|lbs|gb|tb|mb|in|inch|ft|mm|cm|m|qt|quart|gal|cup|cups|pk|pack|pc|pcs|ct|count|pair|w|watt|watts|v|volt|volts|hz|khz|ghz|mah|wh|hr|hrs|hour|hours|min|mins|day|days|yr|yrs|year|years|k|p|%|off|plus|x)\b/i;
const VERSION_STOP_PRECEDE = new Set([
  'for', 'just', 'only', 'now', 'was', 'from', 'to', 'of', 'in', 'at', 'by', 'up', 'save',
  'extra', 'under', 'over', 'with', 'w', 'and', 'or', 'pack', 'set', 'qty', 'size', 'step',
  'top', 'best', 'nov', 'november', 'dec', 'december', 'jan', 'january', 'oct', 'october',
]);

/**
 * Extract product series + generation numbers (e.g. "clip 5", "airpods 4", "iphone 16", "switch 2", "quest 3").
 * Prevents confusing different generations like JBL Clip 4 vs JBL Clip 5.
 */
export function extractSeriesVersions(text) {
  const clean = String(text || '').replace(/\$\d[\d,.]*/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const out = {};
  const re = /\b([a-z][a-z0-9-]{2,16})\s+(\d{1,2})\b(?:\s*([a-z%]+))?/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const word = m[1].toLowerCase();
    const num = m[2];
    const follow = m[3] || '';
    if (VERSION_STOP_PRECEDE.has(word)) continue;
    if (follow && VERSION_UNIT_FOLLOW.test(follow)) continue;
    if (!out[word]) out[word] = num;
  }
  return out;
}

export function extractSpecsAndAttributes(text) {
  const s = String(text || '');
  const storageMatch = s.match(/\b(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
  const screenMatch = s.match(/\b(2[4789]|3[24]|4[02389]|5[058]|6[05]|7[057]|8[356]|98)(?:\s*(?:"|''|inch|in\b|-inch))/i);
  const genMatch = s.match(/\b(gen\s*\d+|generation\s*\d+|\d+(?:st|nd|rd|th)\s*gen|mk\s*[ivx\d]+|xm\d|series\s*\d+|switch\s*2|ps5\s*pro|pro\s*max|ultra\s*\d|m[1-5]\s*(?:pro|max|ultra)?)\b/i);
  const colorMatch = s.match(/\b(midnight|starlight|space\s*(?:gray|grey|black)|titanium|obsidian|porcelain|matte\s*black|silver|graphite|gold|rose\s*gold|white|black|blue|navy|red|crimson|green|olive|sage|pink|purple|lavender|walnut|oak|stainless\s*steel)\b/i);
  const packMatch = s.match(/\b(\d+)[\s-]*(pack|count|piece|pc|ct|pair)\b/i);
  const capacityMatch = s.match(/\b(\d+(?:\.\d+)?)\s*(qt|quart|oz|fl\s*oz|cup|liter|l\b|gal|gallon|w\b|watt|btu|psi|v\b|volt)\b/i);
  const seriesVersions = extractSeriesVersions(s);

  return {
    storage: storageMatch ? `${storageMatch[1]}${storageMatch[2].toUpperCase()}` : null,
    screenSize: screenMatch ? `${screenMatch[1]}"` : null,
    generation: genMatch ? genMatch[1].replace(/\s+/g, ' ').trim().toLowerCase() : null,
    seriesVersions,
    color: colorMatch ? colorMatch[1].trim() : null,
    packSize: packMatch ? `${packMatch[1]}-${packMatch[2].toLowerCase()}` : null,
    capacity: capacityMatch ? `${capacityMatch[1]} ${capacityMatch[2].toLowerCase()}` : null,
  };
}

export function detectCondition(text) {
  const s = String(text || '');
  if (OPEN_BOX_PATTERN.test(s)) return 'open_box';
  if (REFURB_PATTERN.test(s)) return 'refurbished';
  return 'new';
}

export function detectCategory(text, explicitCategories = []) {
  const combined = `${String(text || '')} ${(explicitCategories || []).join(' ')}`.toLowerCase();
  let best = { id: 'other', label: 'General & Gifts', hits: 0 };
  for (const cat of PRODUCT_CATEGORIES) {
    let hits = 0;
    for (const kw of cat.keywords) {
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      if (re.test(combined)) hits += kw.length > 5 ? 2 : 1;
    }
    if (hits > best.hits) best = { id: cat.id, label: cat.label, hits };
  }
  return best.id;
}

export function tokenizeProduct(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return [...new Set(raw)];
}

export function normalizeProductIdentity({ title = '', brand = null, modelNumber = null, url = '', description = '', categories = [], explicitIds = {} } = {}) {
  const combined = `${title} ${description}`;
  const detectedBrand = brand || detectBrand(title) || detectBrand(description);
  const detectedModel = modelNumber || extractModelNumber(title);
  const identifiers = extractIdentifiers({ url, text: combined, explicit: explicitIds });
  const specs = extractSpecsAndAttributes(title);
  const condition = detectCondition(combined);
  const isAccessory = ACCESSORY_TERMS.test(title);
  const category = detectCategory(title, categories);
  const tokens = tokenizeProduct(title);

  // Build deterministic canonical key for grouping identical products & price history
  let canonicalKey = null;
  if (identifiers.upc) canonicalKey = `upc:${identifiers.upc}`;
  else if (identifiers.gtin) canonicalKey = `gtin:${identifiers.gtin}`;
  else if (identifiers.asin) canonicalKey = `asin:${identifiers.asin}`;
  else if (detectedBrand && detectedModel) {
    canonicalKey = `bm:${detectedBrand.toLowerCase().replace(/[^a-z0-9]/g, '')}:${detectedModel.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  } else {
    const core = tokens.slice(0, 6).join('-');
    const verSig = Object.entries(specs.seriesVersions || {}).map(([k, v]) => `${k}${v}`).sort().join('-');
    const digest = crypto.createHash('sha1').update(`${detectedBrand || ''}|${core}|${verSig}|${specs.storage || ''}|${specs.screenSize || ''}`).digest('hex').slice(0, 12);
    canonicalKey = `norm:${core.slice(0, 32) || 'item'}:${digest}`;
  }

  return {
    brand: detectedBrand,
    modelNumber: detectedModel,
    identifiers,
    specs,
    condition,
    isAccessory,
    category,
    tokens,
    canonicalKey,
  };
}

/**
 * Parse pricing, regular/normal baseline, coupon code, shipping, and expiration from deal text.
 */
export function parseDealPricingFromText({ title = '', description = '', priceTag = '', shippingTag = '', sourceId = '' } = {}) {
  // Strip shipping-threshold clauses ("free shipping w/ $49", "orders over $35") so they are never mistaken for item prices
  const stripThresholds = (s) =>
    String(s || '')
      .replace(/\b(?:free\s+(?:shipping|s&h|delivery)|ships?\s+free)\s*(?:w\/|with|on(?:\s+orders)?(?:\s+of|\s+over)?)\s*\$[\d,]+(?:\.\d{1,2})?\+?/gi, ' free shipping ')
      .replace(/\b(?:orders?\s+(?:of|over|above)|spend|min(?:imum)?(?:\s+order)?)\s*\$[\d,]+(?:\.\d{1,2})?\+?/gi, ' ');

  const cleanTitle = stripThresholds(title);
  const cleanDesc = stripThresholds(description);
  const full = `${cleanTitle}\n${cleanDesc}`;

  // Detect storewide / multi-item event roundups ("Up to 80% off", "Black Friday Sale: ...") without an exact single-item price in the title
  const isStorewideRoundup =
    /\b(?:up to \d+%\s*off|extra \d+%\s*off|sitewide|storewide|black friday (?:sale|deals)|cyber monday (?:sale|deals)|deals starting at|from \$\d+)\b/i.test(cleanTitle) &&
    !/\b(?:for|just|only)\s*\$[\d,]+(?:\.\d{1,2})?/i.test(cleanTitle);

  let currentPrice = null;
  let reportedRegularPrice = null;
  let baselineSource = null;

  // CamelCamelCamel explicit format: "down 16.88% ($3.90) to $19.20 from $23.10"
  const camelMatch = cleanTitle.match(/down\s+([\d.]+)%\s*\(\$[\d,.]+\)\s*to\s*\$([\d,]+(?:\.\d{1,2})?)\s*from\s*\$([\d,]+(?:\.\d{1,2})?)/i);
  if (camelMatch) {
    currentPrice = Number(camelMatch[2].replace(/,/g, ''));
    reportedRegularPrice = Number(camelMatch[3].replace(/,/g, ''));
    baselineSource = 'camel_average';
  }

  // Explicit structured price tag
  if (currentPrice === null && priceTag && !isStorewideRoundup) {
    const m = priceTag.match(/\$([\d,]+(?:\.\d{1,2})?)/);
    if (m) currentPrice = Number(m[1].replace(/,/g, ''));
  }

  // Common single-product price patterns: prioritize title first, then exact final/sale price in description (skip for storewide roundups)
  if (currentPrice === null && !isStorewideRoundup) {
    const titlePrice = cleanTitle.match(/(?:for|just|only|now|to)?\s*\$([\d,]+(?:\.\d{1,2})?)/i);
    if (titlePrice) {
      currentPrice = Number(titlePrice[1].replace(/,/g, ''));
    } else {
      const finalMatch = cleanDesc.match(/(?:final price|sale price|on sale for|dropping to(?: as low as)?)\s*:?\s*\$([\d,]+(?:\.\d{1,2})?)/i);
      if (finalMatch) currentPrice = Number(finalMatch[1].replace(/,/g, ''));
    }
  }

  // Regular / historical baseline price patterns (only when a concrete single-product currentPrice exists)
  if (reportedRegularPrice === null && currentPrice !== null && !isStorewideRoundup) {
    const regPatterns = [
      /(?:down from(?: the original)?|reg(?:ularly|\.)?(?: up to)?|original price:?|normally|usually|list price:?|was|msrp:?|compare at|elsewhere(?: for)?)\s*\$([\d,]+(?:\.\d{1,2})?)/i,
      /\(\s*(?:reg\.?|was|orig\.?|list|msrp)\s*\$([\d,]+(?:\.\d{1,2})?)\s*\)/i,
      /you'?d pay (?:between )?\$([\d,]+(?:\.\d{1,2})?)/i,
    ];
    for (const pat of regPatterns) {
      const m = full.match(pat);
      if (m) {
        const val = Number(m[1].replace(/,/g, ''));
        // Guard against wildly unrelated prices in multi-product descriptions (must be within 5x unless CamelCamelCamel)
        if (Number.isFinite(val) && val > currentPrice && val <= currentPrice * 5) {
          reportedRegularPrice = val;
          baselineSource = sourceId.startsWith('camel') ? 'camel_average' : 'editorial_regular';
          break;
        }
      }
    }
  }

  // Handle "$X off" / "save $X" when currentPrice is known but regular wasn't explicitly stated
  if (reportedRegularPrice === null && currentPrice !== null && !isStorewideRoundup) {
    const saveDollar = full.match(/(?:save|\$)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:off|price cut|discount)\b/i);
    if (saveDollar) {
      const delta = Number(saveDollar[1].replace(/,/g, ''));
      if (Number.isFinite(delta) && delta > 0 && delta < currentPrice * 3.5) {
        reportedRegularPrice = roundMoney(currentPrice + delta);
        baselineSource = 'editorial_regular';
      }
    }
  }

  // Sanity guard: reject absurd zero or negative prices
  if (currentPrice !== null && (!Number.isFinite(currentPrice) || currentPrice <= 0 || currentPrice > 50000)) {
    currentPrice = null;
  }
  if (reportedRegularPrice !== null && (currentPrice === null || reportedRegularPrice <= currentPrice || reportedRegularPrice > 75000)) {
    reportedRegularPrice = null;
    baselineSource = null;
  }

  // Shipping
  const shipHaystack = `${shippingTag} ${title} ${description}`;
  let shippingCost = null;
  let shippingFree = false;
  if (/\b(free\s*(?:shipping|s&h|delivery|ship)|f\/s|\+\s*fs\b|shipping is free|ships free|free store pickup)\b/i.test(shipHaystack)) {
    shippingFree = true;
    shippingCost = 0;
  } else {
    const shipNum = shipHaystack.match(/\+\s*\$([\d.]+)\s*(?:s&h|shipping|ship)/i);
    if (shipNum) {
      const parsedShip = Number(shipNum[1]);
      if (Number.isFinite(parsedShip) && parsedShip >= 0 && parsedShip < 500) {
        shippingCost = parsedShip;
      }
    }
  }

  // Coupon / Promo code extraction
  let couponCode = null;
  const codeMatch = full.match(/(?:promo\s*code|coupon\s*code|use\s*code|with\s*code|code:?)\s*["'`]?([A-Z0-9]{4,20})["'`]?/i);
  if (codeMatch && !/^(THIS|THAT|WITH|FROM|FREE|SALE|CODE|DEAL|MORE|YOUR|HERE|ONLY|SAVE|OFF)$/i.test(codeMatch[1])) {
    couponCode = codeMatch[1].toUpperCase();
  }

  // All-time low / price mistake / Black Friday / Cyber Monday / Doorbuster / Local pickup flags
  const mentionsAllTimeLow = /\b(all[\s-]?time low|lowest price ever|lowest ever|best price ever|new low)\b/i.test(full);
  const isPriceMistake = /\b(price mistake|pricing error|glitch|ymmv.*mistake)\b/i.test(full);
  const isCyberMonday = /\bcyber\s*monday\b/i.test(full);
  const isEarlyBlackFriday = /\bearly\s*black\s*friday\b/i.test(full);
  const isBlackFriday = /\bblack\s*friday\b/i.test(full) || isEarlyBlackFriday;
  const isDoorbuster = /\bdoorbuster\b/i.test(full);
  const isClearance = /\b(clearance|closeout|final sale|liquidation|end of model|last chance|outlet)\b/i.test(full);
  const mentionsLocalPickup = /\b(store pickup|in[\s-]?store|curbside|drive up|pick up today|local pickup|warehouse club)\b/i.test(full);

  // Expiration extraction (e.g. "Through November 29th", "Ends 11/30", "today only")
  let expiresAt = null;
  const throughDate = full.match(/\b(?:through|ends|valid until|expires)\s+(nov(?:ember)?|dec(?:ember)?|jan(?:uary)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (throughDate) {
    const months = { nov: 10, november: 10, dec: 11, december: 11, jan: 0, january: 0 };
    const mo = months[throughDate[1].toLowerCase()];
    const day = Number(throughDate[2]);
    const year = mo === 0 ? 2027 : 2026;
    if (mo !== undefined && day >= 1 && day <= 31) {
      expiresAt = new Date(Date.UTC(year, mo, day, 23, 59, 59)).toISOString();
    }
  }

  return {
    currentPrice: roundMoney(currentPrice),
    reportedRegularPrice: roundMoney(reportedRegularPrice),
    baselineSource,
    shippingCost: roundMoney(shippingCost),
    shippingFree,
    couponCode,
    mentionsAllTimeLow,
    isPriceMistake,
    isBlackFriday,
    isEarlyBlackFriday,
    isCyberMonday,
    isDoorbuster,
    isClearance,
    mentionsLocalPickup,
    expiresAt,
  };
}

/**
 * Compute median of numeric array.
 */
export function median(values) {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function average(values) {
  const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Determine freshness status strictly from verification timestamp.
 */
export function computeFreshness(verifiedAt, nowMs = Date.now()) {
  const ts = Date.parse(verifiedAt || '');
  if (!Number.isFinite(ts)) return 'unverified';
  const ageMin = (nowMs - ts) / 60000;
  if (ageMin <= 30) return 'live_verified';
  if (ageMin <= 360) return 'recently_verified';
  return 'stale';
}

/**
 * Match a wish-list item to a deal using strict deterministic guardrails.
 * Returns { matched: boolean, confidence: number, matchType: string, rejectionReason: string|null }
 */
export function matchWishlistToDeal(item, deal) {
  if (!item || !deal) return { matched: false, confidence: 0, matchType: 'none', rejectionReason: 'Missing input' };

  // Condition guardrail
  if (deal.condition === 'refurbished' && !item.allowRefurbished) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: 'Refurbished unit excluded by wish-list preferences' };
  }
  if (deal.condition === 'open_box' && !item.allowOpenBox) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: 'Open-box unit excluded by wish-list preferences' };
  }

  // Accessory guardrail: don't match a $15 case when the user wants the actual device
  const itemIdentity = item.identity || normalizeProductIdentity({
    title: `${item.brand || ''} ${item.name || ''} ${item.modelNumber || ''}`,
    brand: item.brand,
    modelNumber: item.modelNumber,
    url: item.sourceUrl,
  });
  const dealIdentity = deal.identity || normalizeProductIdentity({
    title: deal.title,
    brand: deal.brand,
    modelNumber: deal.modelNumber,
    url: deal.retailerUrl,
  });

  if (!itemIdentity.isAccessory && dealIdentity.isAccessory) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: 'Deal is an accessory rather than the main product' };
  }

  // Exact identifier matches (UPC, GTIN, ASIN, TCIN, SKU)
  const idPairs = [
    ['upc', item.upc || itemIdentity.identifiers.upc, deal.identifiers?.upc],
    ['gtin', item.gtin || itemIdentity.identifiers.gtin, deal.identifiers?.gtin],
    ['asin', item.asin || itemIdentity.identifiers.asin, deal.identifiers?.asin],
    ['tcin', item.tcin || itemIdentity.identifiers.tcin, deal.identifiers?.tcin],
    ['sku', item.sku || itemIdentity.identifiers.sku, deal.identifiers?.sku],
  ];
  for (const [idType, a, b] of idPairs) {
    if (a && b && String(a).toUpperCase() === String(b).toUpperCase()) {
      return { matched: true, confidence: 0.98, matchType: `exact_${idType}`, rejectionReason: null };
    }
  }

  // Generation / series-version / capacity / screen-size anti-confusion guardrails
  if (itemIdentity.specs.generation && dealIdentity.specs.generation && itemIdentity.specs.generation !== dealIdentity.specs.generation) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: `Generation mismatch (${itemIdentity.specs.generation} vs ${dealIdentity.specs.generation})` };
  }
  const itemSeries = itemIdentity.specs.seriesVersions || {};
  const dealSeries = dealIdentity.specs.seriesVersions || {};
  const dealTokensLookup = new Set(dealIdentity.tokens);
  for (const [seriesWord, itemVer] of Object.entries(itemSeries)) {
    if (dealSeries[seriesWord] && dealSeries[seriesWord] !== itemVer) {
      return { matched: false, confidence: 0, matchType: 'none', rejectionReason: `Product generation mismatch (${seriesWord} ${itemVer} vs ${seriesWord} ${dealSeries[seriesWord]})` };
    }
    // If wish list specifies a product line+version (e.g. "clip 5"), candidate must contain that line name (blocks "JBL Go 5" matching "JBL Clip 5")
    if (!dealTokensLookup.has(seriesWord) && !dealSeries[seriesWord]) {
      return { matched: false, confidence: 0, matchType: 'none', rejectionReason: `Different product line (expected "${seriesWord} ${itemVer}")` };
    }
  }
  // Bundle / multi-pack mismatch guardrail
  const itemIsBundle = /\b(bundle|\d+[\s-]*pack|pair|combo)\b/i.test(item.name || '');
  const dealIsBundle = /\b(bundle|\d+[\s-]*pack|combo)\b/i.test(deal.title || '');
  if (!itemIsBundle && dealIsBundle) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: 'Deal is a bundle/multi-pack rather than single unit' };
  }
  if (itemIdentity.specs.storage && dealIdentity.specs.storage && itemIdentity.specs.storage !== dealIdentity.specs.storage) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: `Storage mismatch (${itemIdentity.specs.storage} vs ${dealIdentity.specs.storage})` };
  }
  if (itemIdentity.specs.screenSize && dealIdentity.specs.screenSize && itemIdentity.specs.screenSize !== dealIdentity.specs.screenSize) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: `Screen size mismatch (${itemIdentity.specs.screenSize} vs ${dealIdentity.specs.screenSize})` };
  }

  // Brand conflict check when both brands are known
  const itemBrand = (item.brand || itemIdentity.brand || '').toLowerCase();
  const dealBrand = (deal.brand || dealIdentity.brand || '').toLowerCase();
  if (itemBrand && dealBrand && itemBrand !== dealBrand) {
    return { matched: false, confidence: 0, matchType: 'none', rejectionReason: `Brand mismatch (${itemBrand} vs ${dealBrand})` };
  }

  // Exact Brand + Model Number match
  const itemModel = (item.modelNumber || itemIdentity.modelNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const dealModel = (deal.modelNumber || dealIdentity.modelNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const dealTitleCompact = String(deal.title || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (itemModel && itemModel.length >= 4) {
    if (dealModel && itemModel === dealModel) {
      return { matched: true, confidence: 0.94, matchType: 'exact_model_number', rejectionReason: null };
    }
    if (dealTitleCompact.includes(itemModel)) {
      return { matched: true, confidence: 0.9, matchType: 'title_model_match', rejectionReason: null };
    }
    // If both have explicit distinct model numbers from same brand, don't falsely merge them as identical!
    if (dealModel && dealModel !== itemModel) {
      return { matched: false, confidence: 0, matchType: 'none', rejectionReason: `Model mismatch (${itemModel} vs ${dealModel})` };
    }
  }

  // Token overlap matching (requires strong coverage of wish-list product tokens)
  const itemTokens = itemIdentity.tokens.filter((t) => t.length >= 2);
  const dealTokensSet = new Set(dealIdentity.tokens);
  if (!itemTokens.length) return { matched: false, confidence: 0, matchType: 'none', rejectionReason: 'No matchable tokens' };

  const matchedTokens = itemTokens.filter((t) => dealTokensSet.has(t));
  const recall = matchedTokens.length / itemTokens.length;
  const precision = dealIdentity.tokens.length ? matchedTokens.length / dealIdentity.tokens.length : 0;

  if (itemTokens.length >= 2 && recall >= 0.8 && matchedTokens.length >= 2) {
    const conf = Math.min(0.88, roundMoney(0.68 + recall * 0.14 + precision * 0.08));
    return { matched: true, confidence: conf, matchType: 'strong_token_match', rejectionReason: null };
  }

  // Required features check: if user only typed 1 brand+keyword like "AirPods" and recall === 1
  if (itemTokens.length === 1 && matchedTokens.length === 1 && itemBrand && dealBrand === itemBrand) {
    return { matched: true, confidence: 0.72, matchType: 'brand_keyword_match', rejectionReason: null };
  }

  return { matched: false, confidence: 0, matchType: 'none', rejectionReason: 'Insufficient product similarity' };
}

/**
 * Evaluate a single deal: true discount, all-in cost, historical comparison,
 * deal classification, and 0-100 shopping decision score.
 */
export function evaluateDeal(deal, {
  historyEntries = [],
  competitorDeals = [],
  cashbackRates = {},
  wishlistMatches = [],
  settings = {},
  nowMs = Date.now(),
} = {}) {
  const taxRate = settings.location?.salesTaxRate ?? PRIMARY_LOCATION.salesTaxRate;
  const thresholds = settings.thresholds || { exceptionalPct: 40, greatPct: 25, goodPct: 15 };
  const weights = settings.decisionWeights || {
    discount: 25, history: 20, quality: 15, relevance: 15, allInCost: 10, availability: 10, confidence: 5,
  };

  const currentPrice = roundMoney(deal.currentPrice);
  const shippingCost = deal.shippingFree ? 0 : roundMoney(deal.shippingCost);
  const estimatedTax = currentPrice !== null ? roundMoney(currentPrice * taxRate) : null;

  // Cashback rate lookup (only if verified real rate exists)
  const cbEntry = cashbackRates[deal.retailerId] || null;
  const cashbackPercent = cbEntry?.percent > 0 ? cbEntry.percent : null;
  const cashbackPortal = cbEntry?.portal || null;
  const estimatedCashback = currentPrice !== null && cashbackPercent ? roundMoney(currentPrice * (cashbackPercent / 100)) : 0;

  const finalAllInTotal = currentPrice !== null
    ? roundMoney(currentPrice + (shippingCost ?? 0) + (estimatedTax ?? 0))
    : null;
  const effectiveAfterCashback = finalAllInTotal !== null && estimatedCashback > 0
    ? roundMoney(finalAllInTotal - estimatedCashback)
    : finalAllInTotal;

  // Historical stats strictly from real recorded observations
  const histPrices = historyEntries
    .map((h) => h.price)
    .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0);
  const cutoff30 = nowMs - 30 * 86400000;
  const cutoff90 = nowMs - 90 * 86400000;
  const hist30 = historyEntries.filter((h) => Date.parse(h.observedAt) >= cutoff30 && h.price > 0).map((h) => h.price);
  const hist90 = historyEntries.filter((h) => Date.parse(h.observedAt) >= cutoff90 && h.price > 0).map((h) => h.price);

  const observedAvg = roundMoney(average(histPrices));
  const observedMedian = roundMoney(median(histPrices));
  const observedMin = histPrices.length ? roundMoney(Math.min(...histPrices)) : null;
  const observedMax = histPrices.length ? roundMoney(Math.max(...histPrices)) : null;
  const avg30 = roundMoney(average(hist30));
  const avg90 = roundMoney(average(hist90));

  // Cross-retailer competitor prices (excluding this exact deal)
  const compPrices = competitorDeals
    .filter((c) => c.id !== deal.id && c.currentPrice > 0)
    .map((c) => c.currentPrice);
  const competitorMedian = roundMoney(median(compPrices));
  const competitorMin = compPrices.length ? roundMoney(Math.min(...compPrices)) : null;

  // Defensible Normal Baseline Price
  let normalPrice = null;
  let baselineType = 'unknown';
  let baselineLabel = 'Historical baseline unknown — recording observations';
  let inflatedListWarning = false;

  if (histPrices.length >= 2 && observedMedian !== null) {
    normalPrice = observedMedian;
    baselineType = 'observed_history';
    baselineLabel = `Observed median across ${histPrices.length} recorded snapshots`;
  } else if (deal.baselineSource === 'camel_average' && deal.reportedRegularPrice > 0) {
    normalPrice = deal.reportedRegularPrice;
    baselineType = 'camel_average';
    baselineLabel = 'CamelCamelCamel historical Amazon average';
  } else if (compPrices.length >= 2 && competitorMedian > 0) {
    normalPrice = competitorMedian;
    baselineType = 'cross_retailer_median';
    baselineLabel = `Median across ${compPrices.length} competing listings`;
  } else if (deal.reportedRegularPrice > 0) {
    normalPrice = deal.reportedRegularPrice;
    baselineType = 'editorial_regular';
    baselineLabel = `Editorial / retailer regular price reported by ${deal.sourceName || 'source'}`;
  }

  // Inflated-MSRP check: if a retailer's claimed regular price is >35% higher than observed median or competitor median
  if (deal.reportedRegularPrice > 0 && observedMedian > 0 && deal.reportedRegularPrice > observedMedian * 1.35) {
    inflatedListWarning = true;
  } else if (deal.reportedRegularPrice > 0 && competitorMedian > 0 && deal.reportedRegularPrice > competitorMedian * 1.35) {
    inflatedListWarning = true;
  }

  // Verified Discount %
  let verifiedDiscountPct = null;
  let estimatedSavings = null;
  if (currentPrice !== null && normalPrice !== null && normalPrice > currentPrice) {
    verifiedDiscountPct = Number((((normalPrice - currentPrice) / normalPrice) * 100).toFixed(1));
    estimatedSavings = roundMoney(normalPrice - currentPrice);
  } else if (currentPrice !== null && normalPrice !== null && normalPrice <= currentPrice) {
    verifiedDiscountPct = 0;
    estimatedSavings = 0;
  }

  // Deal Tier Classification
  let tier = 'unverified';
  if (verifiedDiscountPct === null) {
    tier = 'unverified';
  } else if (verifiedDiscountPct >= thresholds.exceptionalPct) {
    tier = 'exceptional';
  } else if (verifiedDiscountPct >= thresholds.greatPct) {
    tier = 'great';
  } else if (verifiedDiscountPct >= thresholds.goodPct) {
    tier = 'good';
  } else {
    tier = 'watch';
  }

  // Freshness & Confidence
  const freshness = computeFreshness(deal.verifiedAt, nowMs);
  let confidenceScore = 0;
  const confidenceReasons = [];
  if (currentPrice !== null) { confidenceScore += 30; confidenceReasons.push('Verified price parsed'); }
  if (baselineType === 'observed_history' || baselineType === 'camel_average') {
    confidenceScore += 30;
    confidenceReasons.push('Defensible historical baseline');
  } else if (baselineType === 'cross_retailer_median' || baselineType === 'editorial_regular') {
    confidenceScore += 20;
    confidenceReasons.push('Corroborated regular selling price');
  }
  if (deal.sourceScore != null && deal.sourceScore >= 10) {
    confidenceScore += 15;
    confidenceReasons.push(`Community verified (${deal.sourceScore > 0 ? '+' : ''}${deal.sourceScore})`);
  } else if (['dealnews_main', 'dealnews_electronics', 'dealnews_home', 'dealnews_clothing', '9to5toys', 'camelcamelcamel_drops', 'cheapshark', 'bestbuy_api'].includes(deal.sourceId)) {
    confidenceScore += 15;
    confidenceReasons.push(`Editor/API curated (${deal.sourceName})`);
  }
  if (freshness === 'live_verified') confidenceScore += 15;
  else if (freshness === 'recently_verified') confidenceScore += 10;
  if (deal.retailerUrl && /^https:\/\//.test(deal.retailerUrl)) confidenceScore += 10;
  if (inflatedListWarning) {
    confidenceScore = Math.max(20, confidenceScore - 20);
    confidenceReasons.push('Caution: reported list price exceeds observed baseline');
  }
  confidenceScore = Math.min(100, confidenceScore);
  const confidenceLabel = confidenceScore >= 80 ? 'High' : confidenceScore >= 55 ? 'Moderate' : 'Low / Limited';

  // Local vs Online distinction for Knightdale 27545
  const retailerMeta = RETAILER_BY_ID[deal.retailerId];
  let localPickupStatus = deal.localPickupKnightdale || 'unverified';
  if (localPickupStatus === 'unverified') {
    if (deal.mentionsLocalPickup && retailerMeta?.localPresence) {
      localPickupStatus = 'check_store';
    } else if (retailerMeta?.localPresence) {
      localPickupStatus = 'check_store';
    } else {
      localPickupStatus = 'online_only';
    }
  }

  // 0-100 Shopping Decision Engine (strictly zero points for missing evidence)
  const decision = computeDecisionScore({
    deal,
    currentPrice,
    finalAllInTotal,
    normalPrice,
    baselineType,
    verifiedDiscountPct,
    observedMin,
    observedMedian,
    historyCount: histPrices.length,
    competitorMin,
    shippingFree: deal.shippingFree,
    cashbackPercent,
    wishlistMatches,
    localPickupStatus,
    confidenceScore,
    weights,
  });

  // Grounded "Why this deal is worth considering"
  const whyParts = [];
  if (verifiedDiscountPct !== null && verifiedDiscountPct >= thresholds.greatPct) {
    whyParts.push(`${verifiedDiscountPct}% below ${baselineType === 'observed_history' ? 'recorded median' : baselineType === 'camel_average' ? 'CamelCamelCamel average' : 'regular selling price'} (saves $${estimatedSavings?.toFixed(2)})`);
  } else if (verifiedDiscountPct !== null && verifiedDiscountPct >= thresholds.goodPct) {
    whyParts.push(`${verifiedDiscountPct}% verified discount (-$${estimatedSavings?.toFixed(2)})`);
  }
  if (deal.mentionsAllTimeLow || (observedMin !== null && currentPrice !== null && currentPrice <= observedMin && histPrices.length >= 2)) {
    whyParts.push('Matches or beats lowest observed price');
  }
  if (deal.couponCode) whyParts.push(`Extra savings with promo code ${deal.couponCode}`);
  if (deal.shippingFree) whyParts.push('Free shipping included');
  if (cashbackPercent) whyParts.push(`Stackable with ~${cashbackPercent}% cashback (${cashbackPortal})`);
  if (wishlistMatches.length) whyParts.push(`Matches family wish-list item: ${wishlistMatches[0].name}`);
  if (deal.isPriceMistake) whyParts.push('Flagged as potential price mistake (may be canceled by retailer)');
  if (!whyParts.length) {
    whyParts.push(currentPrice !== null ? `Live offer verified at $${currentPrice.toFixed(2)} via ${deal.sourceName}` : `Active promotion reported by ${deal.sourceName}`);
  }

  return {
    ...deal,
    currentPrice,
    normalPrice,
    baselineType,
    baselineLabel,
    inflatedListWarning,
    verifiedDiscountPct,
    estimatedSavings,
    tier,
    shippingCost,
    estimatedTax,
    taxRatePct: Number((taxRate * 100).toFixed(2)),
    cashbackPercent,
    cashbackPortal,
    estimatedCashback,
    finalAllInTotal,
    effectiveAfterCashback,
    freshness,
    confidenceScore,
    confidenceLabel,
    confidenceReasons,
    localPickupKnightdale: localPickupStatus,
    matchedWishlistIds: wishlistMatches.map((w) => w.id),
    priceStats: {
      observationsCount: histPrices.length,
      observedAvg,
      observedMedian,
      observedMin,
      observedMax,
      avg30,
      avg90,
      competitorMedian,
      competitorMin,
      isAtObservedLow: observedMin !== null && currentPrice !== null && currentPrice <= observedMin && histPrices.length >= 2,
    },
    decision,
    whyWorthConsidering: whyParts.join(' · '),
  };
}

export function computeDecisionScore({
  deal,
  currentPrice,
  finalAllInTotal,
  normalPrice,
  baselineType,
  verifiedDiscountPct,
  observedMin,
  observedMedian,
  historyCount,
  competitorMin,
  shippingFree,
  cashbackPercent,
  wishlistMatches,
  localPickupStatus,
  confidenceScore,
  weights,
}) {
  const wSum = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0) || 100;
  const normW = (k) => ((Number(weights[k]) || 0) / wSum) * 100;

  const breakdown = [];
  let earned = 0;
  let evidencedWeight = 0;

  // 1. Actual Verified Discount (25%)
  const wDiscount = normW('discount');
  if (verifiedDiscountPct !== null && baselineType !== 'unknown') {
    const ratio = Math.min(1, Math.max(0, verifiedDiscountPct / 45));
    const pts = ratio * wDiscount;
    earned += pts;
    evidencedWeight += wDiscount;
    breakdown.push({ factor: 'Verified Discount', score: roundMoney(pts), max: roundMoney(wDiscount), evidenced: true, note: `${verifiedDiscountPct}% off ${baselineType.replace(/_/g, ' ')}` });
  } else {
    breakdown.push({ factor: 'Verified Discount', score: 0, max: roundMoney(wDiscount), evidenced: false, note: 'No defensible baseline yet — 0 pts awarded' });
  }

  // 2. Historical Price Attractiveness (20%)
  const wHistory = normW('history');
  if (historyCount >= 2 && observedMin !== null && observedMedian !== null && currentPrice !== null) {
    let ratio = 0.5;
    if (currentPrice <= observedMin) ratio = 1.0;
    else if (currentPrice < observedMedian) ratio = 0.75;
    else if (currentPrice <= observedMedian * 1.05) ratio = 0.45;
    else ratio = 0.15;
    const pts = ratio * wHistory;
    earned += pts;
    evidencedWeight += wHistory;
    breakdown.push({ factor: 'Historical Attractiveness', score: roundMoney(pts), max: roundMoney(wHistory), evidenced: true, note: currentPrice <= observedMin ? 'At observed historical low' : `Observed low $${observedMin}` });
  } else if (baselineType === 'camel_average' || deal.mentionsAllTimeLow) {
    const ratio = deal.mentionsAllTimeLow ? 0.92 : 0.72;
    const pts = ratio * wHistory;
    earned += pts;
    evidencedWeight += wHistory;
    breakdown.push({ factor: 'Historical Attractiveness', score: roundMoney(pts), max: roundMoney(wHistory), evidenced: true, note: deal.mentionsAllTimeLow ? 'Reported all-time low' : 'CamelCamelCamel historical drop' });
  } else {
    breakdown.push({ factor: 'Historical Attractiveness', score: 0, max: roundMoney(wHistory), evidenced: false, note: 'Historical depth not yet observed — 0 pts awarded' });
  }

  // 3. Product Quality / Reviews (15%)
  const wQuality = normW('quality');
  const rev = deal.reviewData;
  if (rev?.verifiedOwnerRating != null) {
    const scale = rev.ratingScale || 5;
    const normalizedRating = rev.verifiedOwnerRating / scale;
    const countFactor = rev.reviewCount >= 100 ? 1 : rev.reviewCount >= 20 ? 0.9 : 0.75;
    const pts = Math.max(0, Math.min(1, (normalizedRating - 0.5) / 0.5)) * countFactor * wQuality;
    earned += pts;
    evidencedWeight += wQuality;
    breakdown.push({ factor: 'Product Quality', score: roundMoney(pts), max: roundMoney(wQuality), evidenced: true, note: `${rev.verifiedOwnerRating}/${scale} owner rating${rev.reviewCount ? ` (${rev.reviewCount} reviews)` : ''}` });
  } else if (deal.sourceScore != null && deal.sourceScore >= 5) {
    const ratio = Math.min(0.85, 0.45 + deal.sourceScore / 80);
    const pts = ratio * wQuality;
    earned += pts;
    evidencedWeight += wQuality * 0.6;
    breakdown.push({ factor: 'Product Quality', score: roundMoney(pts), max: roundMoney(wQuality), evidenced: true, note: `Community deal score +${deal.sourceScore} (owner ratings not retrieved)` });
  } else {
    breakdown.push({ factor: 'Product Quality', score: 0, max: roundMoney(wQuality), evidenced: false, note: 'Owner reviews not retrieved — 0 pts awarded' });
  }

  // 4. Wish-List Relevance (15%)
  const wRel = normW('relevance');
  if (wishlistMatches.length > 0) {
    const topMatch = wishlistMatches[0];
    const prioMult = topMatch.priority === 'high' ? 1.0 : topMatch.priority === 'standard' ? 0.88 : 0.75;
    const pts = prioMult * wRel;
    earned += pts;
    evidencedWeight += wRel;
    breakdown.push({ factor: 'Wish-List Relevance', score: roundMoney(pts), max: roundMoney(wRel), evidenced: true, note: `Matches "${topMatch.name}" (${topMatch.priority} priority)` });
  } else {
    breakdown.push({ factor: 'Wish-List Relevance', score: 0, max: roundMoney(wRel), evidenced: false, note: 'Discovery item (not on family wish list)' });
  }

  // 5. All-In Purchase Cost (10%)
  const wAllIn = normW('allInCost');
  if (currentPrice !== null) {
    let ratio = 0.5;
    if (shippingFree) ratio += 0.25;
    if (cashbackPercent > 0) ratio += 0.15;
    if (competitorMin !== null && currentPrice <= competitorMin) ratio += 0.1;
    if (wishlistMatches[0]?.preferredPrice && currentPrice <= wishlistMatches[0].preferredPrice) ratio = 1.0;
    else if (wishlistMatches[0]?.maxPrice && currentPrice > wishlistMatches[0].maxPrice) ratio = 0.2;
    const pts = Math.min(1, ratio) * wAllIn;
    earned += pts;
    evidencedWeight += wAllIn;
    breakdown.push({ factor: 'All-In Purchase Cost', score: roundMoney(pts), max: roundMoney(wAllIn), evidenced: true, note: `Est. $${finalAllInTotal?.toFixed(2)} incl. NC 7.25% tax${shippingFree ? ' & free ship' : ''}` });
  } else {
    breakdown.push({ factor: 'All-In Purchase Cost', score: 0, max: roundMoney(wAllIn), evidenced: false, note: 'Price missing' });
  }

  // 6. Availability & Convenience (10%)
  const wAvail = normW('availability');
  if (deal.availabilityStatus === 'out_of_stock') {
    evidencedWeight += wAvail;
    breakdown.push({ factor: 'Availability & Convenience', score: 0, max: roundMoney(wAvail), evidenced: true, note: 'Reported out of stock' });
  } else if (deal.availabilityStatus === 'in_stock' || localPickupStatus === 'available') {
    const ratio = localPickupStatus === 'available' ? 1.0 : 0.8;
    const pts = ratio * wAvail;
    earned += pts;
    evidencedWeight += wAvail;
    breakdown.push({ factor: 'Availability & Convenience', score: roundMoney(pts), max: roundMoney(wAvail), evidenced: true, note: localPickupStatus === 'available' ? 'Verified Knightdale pickup available' : 'Verified in stock' });
  } else if (localPickupStatus === 'check_store' || deal.shippingFree) {
    const pts = 0.55 * wAvail;
    earned += pts;
    evidencedWeight += wAvail * 0.6;
    breakdown.push({ factor: 'Availability & Convenience', score: roundMoney(pts), max: roundMoney(wAvail), evidenced: true, note: localPickupStatus === 'check_store' ? 'Local store chain near Knightdale (verify shelf stock)' : 'Online free shipping' });
  } else {
    breakdown.push({ factor: 'Availability & Convenience', score: 0, max: roundMoney(wAvail), evidenced: false, note: 'Stock status not directly verified — 0 pts awarded' });
  }

  // 7. Deal Confidence (5%)
  const wConf = normW('confidence');
  const confPts = (confidenceScore / 100) * wConf;
  earned += confPts;
  evidencedWeight += wConf;
  breakdown.push({ factor: 'Deal Confidence', score: roundMoney(confPts), max: roundMoney(wConf), evidenced: true, note: `${confidenceScore}% verification confidence` });

  const totalScore = Math.round(Math.min(100, Math.max(0, earned)));
  const evidenceCoveragePct = Math.round(Math.min(100, evidencedWeight));
  const scoreConfidence = evidenceCoveragePct >= 65 ? 'well_evidenced' : evidenceCoveragePct >= 40 ? 'partial_evidence' : 'limited_evidence';

  // Action recommendation
  let action = 'WAIT';
  const reasons = [];
  const wishTarget = wishlistMatches[0]?.preferredPrice || null;
  const wishMax = wishlistMatches[0]?.maxPrice || null;

  if (deal.availabilityStatus === 'out_of_stock') {
    action = 'WAIT';
    reasons.push('Currently reported out of stock.');
  } else if (competitorMin !== null && currentPrice !== null && currentPrice > competitorMin * 1.08) {
    action = 'CONSIDER ALTERNATIVE';
    reasons.push(`Another verified listing is cheaper ($${competitorMin.toFixed(2)} vs $${currentPrice.toFixed(2)}).`);
  } else if (
    (verifiedDiscountPct !== null && verifiedDiscountPct >= 25 && confidenceScore >= 60) ||
    (wishTarget !== null && currentPrice !== null && currentPrice <= wishTarget) ||
    (totalScore >= 65 && verifiedDiscountPct !== null && verifiedDiscountPct >= 20)
  ) {
    action = 'BUY NOW';
    if (verifiedDiscountPct >= 25) reasons.push(`Strong verified discount of ${verifiedDiscountPct}% below ${baselineType.replace(/_/g, ' ')}.`);
    if (wishTarget !== null && currentPrice <= wishTarget) reasons.push(`Meets or beats your target price of $${wishTarget.toFixed(2)}.`);
    if (deal.mentionsAllTimeLow) reasons.push('Matches reported all-time low.');
  } else if (wishMax !== null && currentPrice !== null && currentPrice > wishMax) {
    action = 'CONSIDER ALTERNATIVE';
    reasons.push(`Current price ($${currentPrice.toFixed(2)}) exceeds your maximum budget ($${wishMax.toFixed(2)}).`);
  } else {
    action = 'WAIT';
    if (verifiedDiscountPct === null) reasons.push('Historical baseline is not yet established; continue automated tracking.');
    else reasons.push(`Current discount (${verifiedDiscountPct}%) is below strong Black Friday target thresholds.`);
  }

  return {
    score: totalScore,
    evidenceCoveragePct,
    scoreConfidence,
    action,
    reasons,
    breakdown,
  };
}

/**
 * Smarter Product Alternatives Engine for a single wish-list item.
 * Categorizes verified live deals into the 3 required recommendation buckets:
 * 1. Same Product, Better Price
 * 2. Better Product, Similar Price
 * 3. Similar Product, Much Lower Price
 */
export function discoverAlternatives(item, evaluatedDeals = []) {
  const itemIdentity = item.identity || normalizeProductIdentity({
    title: `${item.brand || ''} ${item.name || ''} ${item.modelNumber || ''}`,
    brand: item.brand,
    modelNumber: item.modelNumber,
    url: item.sourceUrl,
  });

  const exactMatches = [];
  const categoryCandidates = [];

  for (const deal of evaluatedDeals) {
    if (deal.archived || deal.currentPrice === null) continue;
    if (deal.condition === 'refurbished' && !item.allowRefurbished) continue;
    if (deal.condition === 'open_box' && !item.allowOpenBox) continue;

    const match = matchWishlistToDeal(item, deal);
    if (match.matched) {
      exactMatches.push({ deal, match });
      continue;
    }

    // Check category + semantic similarity for alternatives (excluding accessories unless item is accessory)
    const dealIdentity = deal.identity || normalizeProductIdentity({ title: deal.title, brand: deal.brand, url: deal.retailerUrl });
    if (!itemIdentity.isAccessory && dealIdentity.isAccessory) continue;

    if (dealIdentity.category === itemIdentity.category && itemIdentity.category !== 'other') {
      const itemTokens = new Set(itemIdentity.tokens);
      const shared = dealIdentity.tokens.filter((t) => itemTokens.has(t));
      // Require meaningful product-type overlap or brand match
      if (shared.length >= 1 || (itemIdentity.brand && dealIdentity.brand === itemIdentity.brand)) {
        categoryCandidates.push({ deal, sharedTokens: shared });
      }
    }
  }

  exactMatches.sort((a, b) => (a.deal.finalAllInTotal ?? a.deal.currentPrice) - (b.deal.finalAllInTotal ?? b.deal.currentPrice));

  const referencePrice =
    exactMatches[0]?.deal.currentPrice ??
    item.preferredPrice ??
    item.maxPrice ??
    null;

  // 1. Same Product, Better Price (compare cheapest exact retailer vs other exact matches or user's reference)
  const sameBetterPrice = [];
  if (exactMatches.length >= 2) {
    const highestExact = exactMatches[exactMatches.length - 1].deal;
    for (const { deal, match } of exactMatches.slice(0, 4)) {
      if (deal.retailerId !== highestExact.retailerId || deal.currentPrice < highestExact.currentPrice) {
        const savings = roundMoney(highestExact.currentPrice - deal.currentPrice);
        if (savings > 0) {
          sameBetterPrice.push(buildAlternativeCard(deal, {
            bucket: 'same_better_price',
            bucketLabel: 'Same Product, Better Price',
            originalPrice: highestExact.currentPrice,
            savings,
            differences: `Identical product (${match.matchType.replace(/_/g, ' ')}) sold by ${deal.retailerName} instead of ${highestExact.retailerName}.`,
            advantages: [`Saves $${savings.toFixed(2)} compared to ${highestExact.retailerName}`, deal.shippingFree ? 'Free shipping verified' : 'Check shipping total'].filter(Boolean),
            disadvantages: [deal.localPickupKnightdale === 'online_only' ? 'Online shipping only (no Knightdale pickup)' : 'Verify local pickup stock before driving'],
            reason: `Your item is $${highestExact.currentPrice.toFixed(2)} at ${highestExact.retailerName}, but verified at $${deal.currentPrice.toFixed(2)} at ${deal.retailerName}.`,
          }));
        }
      }
    }
  } else if (exactMatches.length === 1 && item.maxPrice && exactMatches[0].deal.currentPrice < item.maxPrice) {
    const d = exactMatches[0].deal;
    const savings = roundMoney(item.maxPrice - d.currentPrice);
    sameBetterPrice.push(buildAlternativeCard(d, {
      bucket: 'same_better_price',
      bucketLabel: 'Same Product, Better Price',
      originalPrice: item.maxPrice,
      savings,
      differences: `Exact match found at ${d.retailerName} below your max price of $${item.maxPrice.toFixed(2)}.`,
      advantages: [`$${savings.toFixed(2)} under your budget cap`, d.verifiedDiscountPct ? `${d.verifiedDiscountPct}% verified discount` : 'Live verified price'],
      disadvantages: [d.baselineType === 'unknown' ? 'Historical price baseline still building' : 'Limited-time promotional pricing'],
      reason: `Verified live at $${d.currentPrice.toFixed(2)} at ${d.retailerName} (under your $${item.maxPrice.toFixed(2)} max).`,
    }));
  }

  // 2. Better Product, Similar Price (within ±22% of referencePrice, higher verified discount/rating/score)
  const betterSimilarPrice = [];
  // 3. Similar Product, Much Lower Price (≥20% cheaper than referencePrice)
  const similarLowerPrice = [];

  if (referencePrice !== null && referencePrice > 0) {
    const sortedCandidates = [...categoryCandidates].sort((a, b) => (b.deal.decision?.score || 0) - (a.deal.decision?.score || 0));

    for (const { deal, sharedTokens } of sortedCandidates) {
      const ratio = deal.currentPrice / referencePrice;
      const savings = roundMoney(referencePrice - deal.currentPrice);

      if (ratio >= 0.78 && ratio <= 1.22 && betterSimilarPrice.length < 4) {
        const hasHigherQualitySignal =
          (deal.reviewData?.verifiedOwnerRating >= 4.2) ||
          (deal.verifiedDiscountPct >= 25) ||
          (deal.normalPrice && deal.normalPrice > referencePrice * 1.15);
        if (hasHigherQualitySignal) {
          betterSimilarPrice.push(buildAlternativeCard(deal, {
            bucket: 'better_similar_price',
            bucketLabel: 'Better Product, Similar Price',
            originalPrice: referencePrice,
            savings: savings > 0 ? savings : 0,
            differences: `${deal.brand || deal.retailerName} model in the same category (${sharedTokens.join(', ') || itemIdentity.category})${deal.normalPrice ? `, normally $${deal.normalPrice.toFixed(2)}` : ''}.`,
            advantages: [
              deal.normalPrice > referencePrice ? `Higher retail tier (normally $${deal.normalPrice.toFixed(2)}) discounted into your price range` : null,
              deal.reviewData?.verifiedOwnerRating ? `Verified ${deal.reviewData.verifiedOwnerRating}/${deal.reviewData.ratingScale || 5} owner rating` : null,
              deal.verifiedDiscountPct ? `${deal.verifiedDiscountPct}% verified discount` : null,
            ].filter(Boolean),
            disadvantages: [
              deal.brand && item.brand && deal.brand.toLowerCase() !== item.brand.toLowerCase() ? `Different brand (${deal.brand} vs ${item.brand})` : 'Different model — confirm exact features before buying',
            ],
            reason: `Comparable cost ($${deal.currentPrice.toFixed(2)} vs $${referencePrice.toFixed(2)}) with stronger verified value${deal.normalPrice ? ` (regularly $${deal.normalPrice.toFixed(2)})` : ''}.`,
          }));
        }
      } else if (ratio <= 0.8 && ratio >= 0.25 && similarLowerPrice.length < 4) {
        similarLowerPrice.push(buildAlternativeCard(deal, {
          bucket: 'similar_lower_price',
          bucketLabel: 'Similar Product, Much Lower Price',
          originalPrice: referencePrice,
          savings,
          differences: `Lower-cost alternative in ${itemIdentity.category} sharing ${sharedTokens.join(', ') || 'category use case'}.`,
          advantages: [
            `Saves $${savings.toFixed(2)} (${Math.round((1 - ratio) * 100)}% less than $${referencePrice.toFixed(2)})`,
            deal.verifiedDiscountPct ? `${deal.verifiedDiscountPct}% off its own baseline` : 'Verified live price',
          ],
          disadvantages: [
            'Lower price tier — compare specs, warranty, and exact required features against your primary pick',
            !deal.reviewData?.verifiedOwnerRating ? 'Independent owner rating not yet retrieved' : null,
          ].filter(Boolean),
          reason: `Your original choice is around $${referencePrice.toFixed(2)}, while this verified alternative is $${deal.currentPrice.toFixed(2)} (saving $${savings.toFixed(2)}).`,
        }));
      }
    }
  }

  return {
    wishlistItemId: item.id,
    referencePrice,
    exactMatchesCount: exactMatches.length,
    same_better_price: sameBetterPrice,
    better_similar_price: betterSimilarPrice,
    similar_lower_price: similarLowerPrice,
  };
}

function buildAlternativeCard(deal, meta) {
  return {
    dealId: deal.id,
    imageUrl: deal.imageUrl,
    name: deal.title,
    brand: deal.brand,
    retailerId: deal.retailerId,
    retailerName: deal.retailerName,
    retailerUrl: deal.retailerUrl,
    currentPrice: deal.currentPrice,
    finalAllInTotal: deal.finalAllInTotal,
    normalPrice: deal.normalPrice,
    verifiedDiscountPct: deal.verifiedDiscountPct,
    reviewData: deal.reviewData || null,
    decisionScore: deal.decision?.score ?? null,
    verifiedAt: deal.verifiedAt,
    ...meta,
  };
}

/**
 * The Deal Hunter: Autonomous Discovery Engine.
 * Learns from wish lists, preferred brands, recipient profiles, categories, budgets,
 * saved deals, and rejected deals. Every recommendation explicitly explains why
 * our family would want it.
 */
export function runDealHunter({
  evaluatedDeals = [],
  wishlist = [],
  profiles = [],
  feedback = { savedDealIds: [], rejectedDealIds: [], rejectedBrands: [], rejectedCategories: [] },
  settings = {},
} = {}) {
  const rejectedIds = new Set(feedback.rejectedDealIds || []);
  const savedIds = new Set(feedback.savedDealIds || []);
  const rejectedBrands = new Set((feedback.rejectedBrands || []).map((b) => b.toLowerCase()));

  // Build dynamic preference profile from family wish lists + saved deals + profiles
  const brandAffinity = new Map();
  const categoryAffinity = new Map();
  const keywordAffinity = new Map();
  const recipientTags = [];
  const budgetSamples = [];

  for (const item of wishlist) {
    if (item.status === 'no_longer_interested') continue;
    const weight = item.priority === 'high' ? 3 : 2;
    if (item.brand) brandAffinity.set(item.brand.toLowerCase(), (brandAffinity.get(item.brand.toLowerCase()) || 0) + weight);
    const cat = item.category || item.identity?.category;
    if (cat && cat !== 'other') categoryAffinity.set(cat, (categoryAffinity.get(cat) || 0) + weight);
    for (const tok of (item.identity?.tokens || tokenizeProduct(item.name)).slice(0, 5)) {
      keywordAffinity.set(tok, (keywordAffinity.get(tok) || 0) + 1);
    }
    if (item.recipient) recipientTags.push(item.recipient);
    if (item.maxPrice) budgetSamples.push(item.maxPrice);
    else if (item.preferredPrice) budgetSamples.push(item.preferredPrice);
  }

  for (const prof of profiles) {
    if (prof.budget > 0) budgetSamples.push(prof.budget);
  }

  // Boost from saved recommendations
  for (const d of evaluatedDeals) {
    if (!savedIds.has(d.id)) continue;
    if (d.brand) brandAffinity.set(d.brand.toLowerCase(), (brandAffinity.get(d.brand.toLowerCase()) || 0) + 2);
    if (d.category && d.category !== 'other') categoryAffinity.set(d.category, (categoryAffinity.get(d.category) || 0) + 2);
  }

  const comfortMaxBudget = budgetSamples.length
    ? Math.max(settings.budgets?.perGiftDefaultMax || 150, roundMoney(median(budgetSamples) * 1.5))
    : (settings.budgets?.perGiftDefaultMax || 200) * 2;

  const recommendations = [];

  for (const deal of evaluatedDeals) {
    if (deal.archived || rejectedIds.has(deal.id) || deal.currentPrice === null) continue;
    if (deal.brand && rejectedBrands.has(deal.brand.toLowerCase())) continue;

    // Classify discovery signal types
    const discoveryTags = [];
    let hunterScore = 0;
    const reasons = [];

    const bKey = (deal.brand || '').toLowerCase();
    const cKey = deal.category || 'other';

    if (deal.matchedWishlistIds?.length) {
      hunterScore += 22;
      reasons.push(`Directly matches a tracked item on your family wish list`);
    }
    if (bKey && brandAffinity.has(bKey)) {
      hunterScore += 18 + Math.min(10, brandAffinity.get(bKey) * 2);
      reasons.push(`Matches preferred family brand (${deal.brand}) from your wish lists`);
    }
    if (cKey !== 'other' && categoryAffinity.has(cKey)) {
      hunterScore += 14 + Math.min(8, categoryAffinity.get(cKey) * 2);
      reasons.push(`Aligns with your active ${cKey} shopping category`);
    }

    // Keyword resonance
    const sharedKw = (deal.identity?.tokens || []).filter((t) => keywordAffinity.has(t));
    if (sharedKw.length >= 1) {
      hunterScore += Math.min(15, sharedKw.length * 6);
    }

    // Opportunity types
    if (deal.isPriceMistake) {
      discoveryTags.push('price_mistake');
      hunterScore += 25;
      reasons.push('Flagged as a potentially cancelable price mistake');
    }
    if (deal.isBlackFriday && deal.verifiedDiscountPct >= 30) {
      discoveryTags.push('unexpected_black_friday');
      hunterScore += 24;
      reasons.push(`Deep ${deal.verifiedDiscountPct}% verified Black Friday discount`);
    } else if (deal.verifiedDiscountPct >= 35) {
      discoveryTags.push('deep_discount');
      hunterScore += 22;
      reasons.push(`Unusually steep ${deal.verifiedDiscountPct}% verified drop`);
    }
    if (deal.isClearance) {
      discoveryTags.push('clearance');
      hunterScore += 14;
      reasons.push('Clearance / closeout markdown opportunity');
    }
    if (deal.condition === 'refurbished' || deal.condition === 'open_box') {
      discoveryTags.push(deal.condition);
      hunterScore += 8;
      reasons.push(`Labeled ${deal.condition.replace('_', '-')} bargain`);
    }
    if (deal.couponCode) {
      discoveryTags.push('coupon_opportunity');
      hunterScore += 10;
      reasons.push(`Hidden/stackable promo code (${deal.couponCode})`);
    }
    if (deal.normalPrice >= 150 && deal.currentPrice <= comfortMaxBudget && deal.verifiedDiscountPct >= 25) {
      discoveryTags.push('premium_made_affordable');
      hunterScore += 16;
      reasons.push(`Premium item (normally $${deal.normalPrice.toFixed(2)}) discounted into your family budget ($${deal.currentPrice.toFixed(2)})`);
    }
    if (deal.currentPrice <= (settings.budgets?.perGiftDefaultMax || 150) && (deal.verifiedDiscountPct >= 25 || deal.mentionsAllTimeLow || (deal.sourceScore && deal.sourceScore >= 15))) {
      discoveryTags.push('high_value_gift');
      hunterScore += 14;
      reasons.push(`Strong gift candidate under $${settings.budgets?.perGiftDefaultMax || 150}`);
    }

    // Reject random low-value items that have neither family relevance nor strong verified value
    const hasFamilySignal = reasons.some((r) => /wish list|brand|category|budget|gift/i.test(r));
    const hasStrongDeal = (deal.verifiedDiscountPct >= 25) || deal.isPriceMistake || deal.mentionsAllTimeLow || (deal.sourceScore >= 20);
    if (!hasFamilySignal && !hasStrongDeal) continue;
    if (hunterScore < 20) continue;

    // Compose explicit "Why would our family want this?"
    const whyFamily = reasons.slice(0, 3).join('; ') + (deal.localPickupKnightdale === 'check_store' ? ' · Available from a Knightdale/Raleigh area retailer.' : '.');

    recommendations.push({
      dealId: deal.id,
      hunterScore: Math.min(100, Math.round(hunterScore)),
      discoveryTags: discoveryTags.length ? discoveryTags : ['curated_value'],
      whyFamilyWouldWantThis: whyFamily,
      saved: savedIds.has(deal.id),
      deal,
    });
  }

  recommendations.sort((a, b) => b.hunterScore - a.hunterScore || (b.deal.verifiedDiscountPct || 0) - (a.deal.verifiedDiscountPct || 0));

  return {
    learnedSignals: {
      preferredBrands: [...brandAffinity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([b]) => b),
      activeCategories: [...categoryAffinity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c),
      recipients: [...new Set(recipientTags)].slice(0, 10),
      comfortMaxBudget,
      savedCount: savedIds.size,
      rejectedCount: rejectedIds.size,
    },
    recommendations: recommendations.slice(0, 60),
  };
}

/**
 * Match a natural-language Gift Idea (e.g. "great Christmas gifts for a college student under $100")
 * against real verified live deals.
 */
export function matchGiftIdeaDeals(promptText, evaluatedDeals = []) {
  const text = String(promptText || '').trim();
  const budgetMatch = text.match(/(?:under|below|max|less than|<=?)\s*\$?(\d+(?:\.\d{1,2})?)/i);
  const maxBudget = budgetMatch ? Number(budgetMatch[1]) : null;

  const matchedCategories = new Set();
  const matchedKeywords = new Set(tokenizeProduct(text));

  for (const rule of GIFT_PERSONA_RULES) {
    if (rule.match.test(text)) {
      for (const c of rule.categories) matchedCategories.add(c);
      for (const kw of rule.keywords) matchedKeywords.add(kw);
    }
  }

  const scored = [];
  for (const deal of evaluatedDeals) {
    if (deal.archived || deal.currentPrice === null) continue;
    if (maxBudget !== null && deal.currentPrice > maxBudget) continue;

    let score = 0;
    const hay = `${deal.title} ${deal.description || ''}`.toLowerCase();
    const hitTerms = [];

    if (matchedCategories.has(deal.category)) score += 18;
    for (const kw of matchedKeywords) {
      if (kw.length >= 3 && hay.includes(kw)) {
        score += 12;
        hitTerms.push(kw);
      }
    }
    if (deal.verifiedDiscountPct >= 25) score += 15;
    if (deal.mentionsAllTimeLow) score += 10;
    if (score >= 20) {
      scored.push({
        deal,
        relevanceScore: score,
        matchedTerms: [...new Set(hitTerms)].slice(0, 5),
      });
    }
  }

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore || (b.deal.verifiedDiscountPct || 0) - (a.deal.verifiedDiscountPct || 0));
  return {
    prompt: text,
    parsedBudget: maxBudget,
    targetCategories: [...matchedCategories],
    matches: scored.slice(0, 15),
  };
}
