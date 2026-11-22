/**
 * Multi-Modal Family Wish-List Intake & Document Parser.
 * Supports all 7 intake modes:
 * 1. Product name text
 * 2. Retailer product URL
 * 3. Screenshot upload (filename/OCR text + thumbnail preview)
 * 4. Spreadsheet or document upload (CSV, TSV, XLSX, DOCX, DOC, RTF, JSON, TXT)
 * 5. Bulk pasted list
 * 6. Imported shopping lists (Amazon/Target/Google Sheets CSV or JSON exports)
 * 7. General gift ideas ("great Christmas gifts for a college student")
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { normalizeProductIdentity, roundMoney } from './intelligence.js';
import { inspectRetailerUrl } from './adapters.js';

function cleanCell(val) {
  return String(val ?? '').replace(/\r/g, '').trim();
}

function parseMoney(val) {
  if (val == null || val === '') return null;
  const num = Number(String(val).replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) && num > 0 && num < 100000 ? roundMoney(num) : null;
}

/**
 * RFC-4180 compliant CSV / TSV line parser.
 */
export function parseDelimitedText(text, delimiter = null) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = raw.split(/\r?\n/)[0] || '';
  const sep = delimiter || (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',');

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

/**
 * Minimal dependency-free XLSX reader (reads ZIP central directory + sharedStrings + sheet1 via Node zlib).
 */
export function parseXlsxBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 30) return [];
  const entries = new Map();

  // Locate ZIP local file headers or central directory (EOCD signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return [];

  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let pos = cdOffset;
  const cdEnd = Math.min(buffer.length, cdOffset + cdSize);

  while (pos + 46 <= cdEnd) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    if (name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet1\.xml$/i.test(name)) {
      if (localHeaderOffset + 30 > buffer.length) continue;
      const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const slice = buffer.subarray(dataStart, dataStart + compSize);
      try {
        const rawXml = method === 8 ? zlib.inflateRawSync(slice).toString('utf8') : slice.toString('utf8');
        entries.set(name, rawXml);
      } catch {}
    }
  }

  const sheetXml = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetXml) return [];

  const sharedStrings = [];
  const ssXml = entries.get('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of ssXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/gi)) {
      const parts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => m[1]);
      sharedStrings.push(parts.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
    }
  }

  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells = [];
    for (const cMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cMatch[1];
      const inner = cMatch[2];
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : '';
      let val = '';
      if (cellType === 'inlineStr') {
        val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((t) => t[1]).join('');
      } else {
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/i);
        if (vMatch) {
          val = cellType === 's' ? (sharedStrings[Number(vMatch[1])] || '') : vMatch[1];
        }
      }
      cells.push(val.trim());
    }
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  return rows;
}

/**
 * Convert tabular rows (with or without headers) into wish-list item drafts.
 */
export function rowsToWishlistDrafts(rows, defaults = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const first = rows[0].map((c) => cleanCell(c).toLowerCase());
  const looksLikeHeader = first.some((h) =>
    /^(product|item|name|title|description|brand|model|url|link|price|target|max|recipient|for|priority|notes|category|asin|upc)$/.test(h) ||
    /product name|item name|target price|max price|wish list|amazon/.test(h)
  );

  const header = looksLikeHeader ? first : ['name', 'url', 'preferredprice', 'recipient', 'priority', 'notes'];
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;

  const findCol = (...patterns) => header.findIndex((h) => patterns.some((p) => p.test(h)));
  const colName = findCol(/^(product|item|name|title)/, /product name|item name|title/);
  const colBrand = findCol(/^brand/, /manufacturer/);
  const colModel = findCol(/^model/, /sku|mpn|part/);
  const colUpc = findCol(/^upc/, /gtin|ean|barcode/);
  const colAsin = findCol(/^asin/);
  const colUrl = findCol(/^(url|link|website|product url)/, /http|link/);
  const colPref = findCol(/^(preferred|target|desired|ideal|price)/, /target price|preferred price/);
  const colMax = findCol(/^(max|budget|limit|ceiling)/, /max price/);
  const colRecip = findCol(/^(recipient|for|person|member|who)/);
  const colPrio = findCol(/^(priority|urgency)/);
  const colColor = findCol(/^(color|colour|finish)/);
  const colSize = findCol(/^(size|capacity|storage)/);
  const colNotes = findCol(/^(notes|comment|features|specs|details)/);

  const drafts = [];
  for (const r of dataRows) {
    const get = (idx) => (idx >= 0 && idx < r.length ? cleanCell(r[idx]) : '');
    let name = get(colName >= 0 ? colName : 0);
    let url = get(colUrl);
    if (!url && /^https?:\/\//i.test(name)) {
      url = name;
      name = '';
    }
    if (!name && !url) continue;

    drafts.push(
      createWishlistItemObject({
        name: name || url,
        brand: get(colBrand) || null,
        modelNumber: get(colModel) || null,
        upc: get(colUpc) || null,
        asin: get(colAsin) || null,
        sourceUrl: url || null,
        preferredPrice: parseMoney(get(colPref)),
        maxPrice: parseMoney(get(colMax)),
        recipient: get(colRecip) || defaults.recipient || '',
        priority: normalizePriority(get(colPrio) || defaults.priority),
        color: get(colColor) || null,
        size: get(colSize) || null,
        notes: get(colNotes) || '',
        profileId: defaults.profileId || 'family-main',
        sourceType: defaults.sourceType || 'spreadsheet',
      })
    );
  }
  return drafts;
}

export function normalizePriority(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (/^(high|urgent|top|must|1|critical|asap)/.test(s)) return 'high';
  if (/^(low|nice|maybe|3|someday)/.test(s)) return 'low';
  return 'standard';
}

export function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (['wanted', 'monitoring', 'deal_found', 'purchased', 'no_longer_interested'].includes(s)) return s;
  return 'monitoring';
}

/**
 * Parse a bulk pasted text list (bullets, numbered lines, URLs, inline prices/recipients/priorities).
 * Examples:
 * - Sony WH-1000XM5 Headphones - target $249 max $299 for Dad [high]
 * - https://www.amazon.com/dp/B09XS7JWHH
 * - LEGO Star Wars Millennium Falcon 75375 under $70 for Aiden
 */
export function parseBulkTextToDrafts(rawText, defaults = {}) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length >= 2);

  // If it looks like CSV/TSV with header, route through tabular parser
  if (lines.length >= 2 && (lines[0].includes('\t') || (lines[0].split(',').length >= 3 && /name|product|title|price|url/i.test(lines[0])))) {
    return rowsToWishlistDrafts(parseDelimitedText(rawText), { ...defaults, sourceType: 'bulk' });
  }

  const drafts = [];
  for (const line of lines) {
    let working = line;
    const urlMatch = working.match(/https?:\/\/[^\s,]+/i);
    const sourceUrl = urlMatch ? urlMatch[0].replace(/[),.;]+$/, '') : null;
    if (sourceUrl) working = working.replace(sourceUrl, ' ').trim();

    let priority = defaults.priority || 'standard';
    const prioMatch = working.match(/\[(high|standard|medium|low|urgent)\]/i);
    if (prioMatch) {
      priority = normalizePriority(prioMatch[1]);
      working = working.replace(prioMatch[0], ' ').trim();
    }

    let recipient = defaults.recipient || '';
    const forMatch = working.match(/\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|mom|dad|wife|husband|son|daughter|kids|family|college student)\b/i);
    if (forMatch) {
      recipient = forMatch[1].trim();
      working = working.replace(forMatch[0], ' ').trim();
    }

    let preferredPrice = null;
    let maxPrice = null;
    const maxMatch = working.match(/\b(?:max|under|below|budget|<=)\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
    if (maxMatch) {
      maxPrice = parseMoney(maxMatch[1]);
      working = working.replace(maxMatch[0], ' ').trim();
    }
    const targetMatch = working.match(/\b(?:target|ideal|prefer(?:red)?|want)\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
    if (targetMatch) {
      preferredPrice = parseMoney(targetMatch[1]);
      working = working.replace(targetMatch[0], ' ').trim();
    } else if (maxPrice === null) {
      const barePrice = working.match(/[-–—:]\s*\$([\d,]+(?:\.\d{1,2})?)\s*$/);
      if (barePrice) {
        preferredPrice = parseMoney(barePrice[1]);
        working = working.replace(barePrice[0], ' ').trim();
      }
    }

    const cleanName = working.replace(/[-–—,:;\s]+$/g, '').replace(/^[-–—,:;\s]+/g, '').trim();
    if (!cleanName && !sourceUrl) continue;

    drafts.push(
      createWishlistItemObject({
        name: cleanName || sourceUrl,
        sourceUrl,
        preferredPrice,
        maxPrice,
        recipient,
        priority,
        profileId: defaults.profileId || 'family-main',
        sourceType: defaults.sourceType || 'bulk',
      })
    );
  }
  return drafts;
}

/**
 * Parse uploaded base64/text file (CSV, TSV, XLSX, DOCX, DOC, RTF, JSON, TXT, or Screenshot image).
 */
export async function parseUploadedDocument({
  filename = 'upload.txt',
  mimeType = '',
  contentText = '',
  contentBase64 = '',
  extractedOcrText = '',
  defaults = {},
} = {}) {
  const lower = String(filename || '').toLowerCase();

  // Screenshot image mode
  if (/image\//i.test(mimeType) || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
    const cleanFilename = filename
      .replace(/\.[^.]+$/, '')
      .replace(/screenshot|screen[\s_-]?shot|img|image|photo|capture|\d{4}[-_]\d{2}[-_]\d{2}/gi, ' ')
      .replace(/[-_]+/g, ' ')
      .trim();
    const textHint = String(extractedOcrText || contentText || '').trim();
    const lines = textHint ? parseBulkTextToDrafts(textHint, { ...defaults, sourceType: 'screenshot' }) : [];

    const screenshotDataUrl = contentBase64 && contentBase64.length < 350000
      ? (contentBase64.startsWith('data:') ? contentBase64 : `data:${mimeType || 'image/png'};base64,${contentBase64}`)
      : null;

    if (lines.length) {
      return lines.map((item) => ({ ...item, screenshotThumbnail: screenshotDataUrl, sourceType: 'screenshot' }));
    }

    return [
      createWishlistItemObject({
        name: cleanFilename.length >= 3 ? cleanFilename : 'Product from Uploaded Screenshot (edit title for exact match)',
        notes: textHint || `Uploaded screenshot: ${filename}`,
        screenshotThumbnail: screenshotDataUrl,
        profileId: defaults.profileId || 'family-main',
        sourceType: 'screenshot',
        recipient: defaults.recipient || '',
        priority: defaults.priority || 'standard',
      }),
    ];
  }

  // JSON import (supports our own export format or generic product array)
  if (lower.endsWith('.json') || /json/i.test(mimeType)) {
    const text = contentText || (contentBase64 ? Buffer.from(contentBase64, 'base64').toString('utf8') : '');
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.wishlist) ? parsed.wishlist : Array.isArray(parsed.items) ? parsed.items : [];
    return arr
      .filter((x) => x && (x.name || x.title || x.url || x.sourceUrl))
      .map((x) =>
        createWishlistItemObject({
          ...x,
          name: x.name || x.title || x.url || x.sourceUrl,
          sourceUrl: x.sourceUrl || x.url || null,
          profileId: x.profileId || defaults.profileId || 'family-main',
          sourceType: 'import',
        })
      );
  }

  // XLSX spreadsheet
  if (lower.endsWith('.xlsx') || /spreadsheetml/i.test(mimeType)) {
    const buf = Buffer.from(contentBase64 || '', 'base64');
    const rows = parseXlsxBuffer(buf);
    return rowsToWishlistDrafts(rows, { ...defaults, sourceType: 'spreadsheet' });
  }

  // DOC / DOCX via already-installed word-extractor
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    const { default: WordExtractor } = await import('word-extractor');
    const extractor = new WordExtractor();
    const buf = Buffer.from(contentBase64 || '', 'base64');
    const doc = await extractor.extract(buf);
    return parseBulkTextToDrafts(doc.getBody() || '', { ...defaults, sourceType: 'spreadsheet' });
  }

  // RTF via already-installed rtf-parser
  if (lower.endsWith('.rtf')) {
    const text = contentText || Buffer.from(contentBase64 || '', 'base64').toString('utf8');
    // Lightweight plain-text extraction from RTF (fast & synchronous)
    const stripped = text
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-f]{2}/gi, '')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .trim();
    return parseBulkTextToDrafts(stripped, { ...defaults, sourceType: 'spreadsheet' });
  }

  // CSV / TSV / HTML shopping list export / TXT
  const text = contentText || (contentBase64 ? Buffer.from(contentBase64, 'base64').toString('utf8') : '');
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    const rows = parseDelimitedText(text, lower.endsWith('.tsv') ? '\t' : ',');
    return rowsToWishlistDrafts(rows, { ...defaults, sourceType: 'spreadsheet' });
  }

  // HTML Amazon/Target wishlist export
  if (lower.endsWith('.html') || lower.endsWith('.htm') || /<html|<a\s+href=/i.test(text)) {
    const drafts = [];
    const seen = new Set();
    for (const m of text.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']*(?:amazon\.com\/dp\/|target\.com\/p\/|walmart\.com\/ip\/|bestbuy\.com\/site\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = m[1];
      const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (seen.has(url)) continue;
      seen.add(url);
      drafts.push(
        createWishlistItemObject({
          name: title.length >= 3 ? title : url,
          sourceUrl: url,
          profileId: defaults.profileId || 'family-main',
          sourceType: 'import',
          recipient: defaults.recipient || '',
        })
      );
    }
    if (drafts.length) return drafts;
  }

  return parseBulkTextToDrafts(text, { ...defaults, sourceType: 'spreadsheet' });
}

/**
 * Create a clean, fully normalized wish-list item record.
 */
export function createWishlistItemObject(input = {}) {
  const nowIso = new Date().toISOString();
  const rawName = String(input.name || '').trim();
  const isGiftIdea = input.sourceType === 'gift_idea' || Boolean(input.isGiftIdea);

  const identity = normalizeProductIdentity({
    title: `${input.brand || ''} ${rawName} ${input.modelNumber || ''}`,
    brand: input.brand || null,
    modelNumber: input.modelNumber || null,
    url: input.sourceUrl || '',
    description: `${input.notes || ''} ${input.requiredFeatures || ''}`,
    explicitIds: {
      upc: input.upc || null,
      gtin: input.gtin || null,
      asin: input.asin || null,
      sku: input.sku || null,
      tcin: input.tcin || null,
      mpn: input.mpn || null,
    },
  });

  return {
    id: input.id || `wl_${crypto.randomBytes(6).toString('hex')}`,
    name: rawName || 'Unnamed Product',
    brand: input.brand || identity.brand || null,
    modelNumber: input.modelNumber || identity.modelNumber || null,
    upc: input.upc || identity.identifiers.upc || null,
    gtin: input.gtin || identity.identifiers.gtin || null,
    asin: input.asin || identity.identifiers.asin || null,
    sku: input.sku || identity.identifiers.sku || null,
    tcin: input.tcin || identity.identifiers.tcin || null,
    color: input.color || identity.specs.color || null,
    size: input.size || identity.specs.screenSize || identity.specs.storage || identity.specs.capacity || null,
    specs: input.specs || [identity.specs.storage, identity.specs.screenSize, identity.specs.generation, identity.specs.capacity].filter(Boolean).join(', ') || null,
    requiredFeatures: String(input.requiredFeatures || '').trim(),
    preferredPrice: parseMoney(input.preferredPrice),
    maxPrice: parseMoney(input.maxPrice),
    recipient: String(input.recipient || '').trim(),
    profileId: input.profileId || (isGiftIdea ? 'unassigned-ideas' : 'family-main'),
    category: input.category || identity.category || 'other',
    priority: normalizePriority(input.priority),
    status: normalizeStatus(input.status || 'monitoring'),
    allowRefurbished: Boolean(input.allowRefurbished),
    allowOpenBox: Boolean(input.allowOpenBox),
    isGiftIdea,
    sourceUrl: input.sourceUrl || null,
    sourceType: input.sourceType || 'manual',
    imageUrl: input.imageUrl || null,
    screenshotThumbnail: input.screenshotThumbnail || null,
    notes: String(input.notes || '').trim(),
    canonicalKey: identity.canonicalKey,
    identity,
    purchasedRetailer: input.purchasedRetailer || null,
    purchasedPrice: parseMoney(input.purchasedPrice),
    purchasedAt: input.purchasedAt || null,
    lastCheckedAt: input.lastCheckedAt || null,
    createdAt: input.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Enrich a wish-list draft when a retailer URL was pasted.
 */
export async function buildWishlistItemFromUrl(rawUrl, extras = {}, { fetchImpl = globalThis.fetch } = {}) {
  const inspected = await inspectRetailerUrl(rawUrl, { fetchImpl });
  if (!inspected.ok) {
    throw new Error(inspected.error || 'Could not inspect URL.');
  }
  const item = createWishlistItemObject({
    ...extras,
    name: extras.name || inspected.name,
    brand: extras.brand || inspected.brand,
    modelNumber: extras.modelNumber || inspected.modelNumber,
    upc: extras.upc || inspected.identifiers?.upc,
    gtin: extras.gtin || inspected.identifiers?.gtin,
    asin: extras.asin || inspected.identifiers?.asin,
    sku: extras.sku || inspected.identifiers?.sku,
    tcin: extras.tcin || inspected.identifiers?.tcin,
    sourceUrl: inspected.url,
    imageUrl: inspected.imageUrl,
    category: extras.category || inspected.category,
    sourceType: 'url',
    notes: [extras.notes, inspected.note].filter(Boolean).join(' · '),
  });
  return { item, inspected };
}

/**
 * Duplicate guard: check if an incoming item duplicates an existing wish-list entry
 * (especially preventing duplicate purchases!).
 */
export function findDuplicateWishlistItem(candidate, existingList = []) {
  for (const ex of existingList) {
    if (ex.status === 'no_longer_interested') continue;
    if (candidate.asin && ex.asin && candidate.asin === ex.asin) return ex;
    if (candidate.upc && ex.upc && candidate.upc === ex.upc) return ex;
    if (candidate.gtin && ex.gtin && candidate.gtin === ex.gtin) return ex;
    if (candidate.sourceUrl && ex.sourceUrl && candidate.sourceUrl === ex.sourceUrl) return ex;
    if (
      candidate.canonicalKey &&
      ex.canonicalKey &&
      candidate.canonicalKey === ex.canonicalKey &&
      (candidate.recipient || '').toLowerCase() === (ex.recipient || '').toLowerCase()
    ) {
      return ex;
    }
    if (
      candidate.name.toLowerCase() === ex.name.toLowerCase() &&
      (candidate.recipient || '').toLowerCase() === (ex.recipient || '').toLowerCase()
    ) {
      return ex;
    }
  }
  return null;
}
