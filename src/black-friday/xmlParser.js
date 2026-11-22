/**
 * Zero-dependency XML (RSS 2.0 / RSS 0.91 / Atom) and HTML JSON-LD / OpenGraph parser.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
};

export function decodeHtmlEntities(input) {
  if (!input) return '';
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&([a-z]+);/gi, (full, name) => NAMED_ENTITIES[name.toLowerCase()] ?? full);
}

export function stripHtml(input) {
  if (!input) return '';
  const decoded = decodeHtmlEntities(String(input));
  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function unwrapCdata(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .trim();
}

function extractTag(block, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeHtmlEntities(unwrapCdata(m[1]));
}

function extractAllTags(block, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    const val = decodeHtmlEntities(unwrapCdata(m[1])).trim();
    if (val) out.push(val);
  }
  return out;
}

function extractAttr(tagHtml, attrName) {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = String(tagHtml || '').match(re);
  return m ? decodeHtmlEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
}

export function extractFirstImageFromHtml(html) {
  if (!html) return null;
  const decoded = decodeHtmlEntities(html);
  const imgMatches = [...decoded.matchAll(/<img\b[^>]*>/gi)];
  for (const match of imgMatches) {
    const src = extractAttr(match[0], 'src') || extractAttr(match[0], 'data-src');
    if (!src) continue;
    if (/^https?:\/\//i.test(src) && !/pixel|spacer|1x1|tracking|gravatar|avatar/i.test(src)) {
      return src;
    }
  }
  return null;
}

export function extractAllLinksFromHtml(html) {
  if (!html) return [];
  const decoded = decodeHtmlEntities(html);
  const links = [];
  for (const match of decoded.matchAll(/<a\b[^>]*>/gi)) {
    const href = extractAttr(match[0], 'href');
    if (/^https?:\/\//i.test(href)) links.push(href);
  }
  return links;
}

/**
 * Parse RSS 2.0 / 0.91 or Atom XML feed into normalized raw items.
 */
export function parseFeedXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const items = [];

  // RSS <item>
  const rssMatches = [...xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  for (const m of rssMatches) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const guid = extractTag(block, 'guid');
    const descriptionRaw = extractTag(block, 'description');
    const contentEncoded = extractTag(block, 'content:encoded');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
    const categories = extractAllTags(block, 'category');
    const vendorName = extractTag(block, 'vendorname') || extractTag(block, 'dealnews:merchant');
    const imageLink = extractTag(block, 'imagelink');
    const dealPriceTag = extractTag(block, 'dealnews:price');
    const shippingTag = extractTag(block, 'dealnews:shipping');

    let mediaImage = null;
    const mediaTag = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/i);
    if (mediaTag) {
      const candidate = extractAttr(mediaTag[0], 'url');
      if (/^https?:\/\//i.test(candidate)) mediaImage = candidate;
    }

    const htmlBody = contentEncoded || descriptionRaw;
    const imageUrl =
      (/^https?:\/\//i.test(imageLink) ? imageLink : null) ||
      mediaImage ||
      extractFirstImageFromHtml(htmlBody) ||
      extractFirstImageFromHtml(descriptionRaw) ||
      null;

    items.push({
      title: stripHtml(title),
      link: link.trim(),
      guid: guid.trim(),
      descriptionHtml: descriptionRaw,
      contentHtml: contentEncoded || descriptionRaw,
      descriptionText: stripHtml(descriptionRaw),
      contentText: stripHtml(contentEncoded || descriptionRaw),
      pubDate: pubDate.trim(),
      categories,
      vendorName: stripHtml(vendorName),
      dealPriceTag: stripHtml(dealPriceTag),
      shippingTag: stripHtml(shippingTag),
      imageUrl,
      embeddedLinks: extractAllLinksFromHtml(htmlBody),
    });
  }

  if (items.length > 0) return items;

  // Atom <entry>
  const atomMatches = [...xmlText.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  for (const m of atomMatches) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const id = extractTag(block, 'id');
    const linkTag = block.match(/<link\b[^>]*>/i);
    const link = linkTag ? extractAttr(linkTag[0], 'href') : '';
    const content = extractTag(block, 'content') || extractTag(block, 'summary');
    const updated = extractTag(block, 'updated') || extractTag(block, 'published');
    const categories = [...block.matchAll(/<category\b[^>]*>/gi)]
      .map((c) => extractAttr(c[0], 'label') || extractAttr(c[0], 'term'))
      .filter(Boolean);

    items.push({
      title: stripHtml(title),
      link: link.trim(),
      guid: id.trim(),
      descriptionHtml: content,
      contentHtml: content,
      descriptionText: stripHtml(content),
      contentText: stripHtml(content),
      pubDate: updated.trim(),
      categories,
      vendorName: '',
      dealPriceTag: '',
      shippingTag: '',
      imageUrl: extractFirstImageFromHtml(content),
      embeddedLinks: extractAllLinksFromHtml(content),
    });
  }

  return items;
}

/**
 * Extract schema.org/Product JSON-LD and OpenGraph metadata from an HTML product page.
 */
export function extractProductMetadataFromHtml(html, pageUrl = '') {
  if (!html || typeof html !== 'string') return null;

  const meta = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const prop = (extractAttr(tag[0], 'property') || extractAttr(tag[0], 'name')).toLowerCase();
    const content = extractAttr(tag[0], 'content');
    if (prop && content) meta[prop] = content;
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? stripHtml(titleMatch[1]) : '';

  const products = [];
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
        const type = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (type.some((t) => typeof t === 'string' && /Product/i.test(t))) {
          products.push(node);
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  const prod = products[0] || null;
  let price = null;
  let currency = 'USD';
  let availability = 'unverified';
  let sellerName = null;
  let canonicalOfferUrl = pageUrl;

  if (prod?.offers) {
    const offers = Array.isArray(prod.offers) ? prod.offers : [prod.offers];
    const firstOffer = offers.find((o) => o && (o.price != null || o.lowPrice != null)) || offers[0];
    if (firstOffer) {
      const rawPrice = firstOffer.price ?? firstOffer.lowPrice;
      const parsedPrice = Number(String(rawPrice ?? '').replace(/[^0-9.]/g, ''));
      if (Number.isFinite(parsedPrice) && parsedPrice > 0) price = parsedPrice;
      if (firstOffer.priceCurrency) currency = String(firstOffer.priceCurrency);
      if (firstOffer.url && /^https?:\/\//i.test(firstOffer.url)) canonicalOfferUrl = firstOffer.url;
      if (firstOffer.seller?.name) sellerName = String(firstOffer.seller.name);
      const avail = String(firstOffer.availability || '');
      if (/InStock/i.test(avail)) availability = 'in_stock';
      else if (/LimitedAvailability|PreOrder/i.test(avail)) availability = 'limited';
      else if (/OutOfStock|SoldOut|Discontinued/i.test(avail)) availability = 'out_of_stock';
    }
  }

  if (price === null && meta['product:price:amount']) {
    const parsedMetaPrice = Number(String(meta['product:price:amount']).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsedMetaPrice) && parsedMetaPrice > 0) price = parsedMetaPrice;
  }

  let image = null;
  if (prod?.image) {
    const rawImg = Array.isArray(prod.image) ? prod.image[0] : prod.image;
    if (typeof rawImg === 'string' && /^https?:\/\//i.test(rawImg)) image = rawImg;
    else if (rawImg?.url && /^https?:\/\//i.test(rawImg.url)) image = rawImg.url;
  }
  if (!image && meta['og:image'] && /^https?:\/\//i.test(meta['og:image'])) {
    image = meta['og:image'];
  }

  let brand = null;
  if (prod?.brand) {
    brand = typeof prod.brand === 'string' ? prod.brand : prod.brand.name || null;
  }

  let reviewData = null;
  if (prod?.aggregateRating) {
    const ratingVal = Number(prod.aggregateRating.ratingValue);
    const reviewCount = Number(prod.aggregateRating.reviewCount ?? prod.aggregateRating.ratingCount);
    if (Number.isFinite(ratingVal) && ratingVal > 0 && ratingVal <= 5) {
      reviewData = {
        source: 'retailer_schema_org',
        verifiedOwnerRating: Number(ratingVal.toFixed(2)),
        ratingScale: 5,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
        retrievedAt: new Date().toISOString(),
      };
    }
  }

  const name = prod?.name ? stripHtml(prod.name) : meta['og:title'] || pageTitle;
  const sku = prod?.sku ? String(prod.sku).trim() : null;
  const mpn = prod?.mpn ? String(prod.mpn).trim() : null;
  const gtin = String(prod?.gtin13 || prod?.gtin12 || prod?.gtin14 || prod?.gtin || prod?.upc || '').trim() || null;
  const description = prod?.description ? stripHtml(prod.description).slice(0, 600) : meta['og:description'] || meta.description || '';

  return {
    name: name || null,
    brand: brand ? stripHtml(brand) : null,
    sku,
    mpn,
    gtin,
    price,
    currency,
    availability,
    sellerName,
    imageUrl: image,
    canonicalUrl: canonicalOfferUrl || pageUrl,
    description,
    reviewData,
    hasStructuredSchema: Boolean(prod),
  };
}
