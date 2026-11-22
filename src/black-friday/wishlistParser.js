/**
 * Real Multi-Format Upload Center Parser (Wish Lists & User-Found Deals).
 * Supports:
 * - Excel (.xlsx with exact column mapping + legacy .xls)
 * - CSV / TSV
 * - PDF (text streams + FlateDecode decompression + embedded /URI links)
 * - Word documents (.docx / .doc via word-extractor) & RTF
 * - Plain text, copied emails, multi-URL batches, shopping list HTML/JSON exports
 * - Screenshots & Images (preserved with thumbnail + guided/OCR text extraction)
 *
 * Always produces an editable preview with duplicate detection & explicit warnings
 * rather than silently discarding unparseable uploads.
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {
  normalizeProductIdentity,
  detectRetailer,
  roundMoney,
} from './intelligence.js';
import { inspectRetailerUrl } from './adapters.js';

function cleanCell(val) {
  return String(val ?? '').replace(/\r/g, '').trim();
}

export function parseMoney(val) {
  if (val == null || val === '') return null;
  const num = Number(String(val).replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) && num > 0 && num < 100000 ? roundMoney(num) : null;
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
 * RFC-4180 compliant CSV / TSV parser.
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

function colLettersToIndex(letters) {
  let idx = 0;
  for (const ch of String(letters || '').toUpperCase()) {
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(0, idx - 1);
}

/**
 * Zero-dependency XLSX spreadsheet reader (preserves exact sparse cell columns & sharedStrings).
 */
export function parseXlsxBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 30) return [];
  const entries = new Map();

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

    if (name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
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

  const sheetKey = [...entries.keys()].find((k) => /sheet1\.xml$/i.test(k)) || [...entries.keys()].find((k) => /sheet\d+\.xml$/i.test(k));
  const sheetXml = sheetKey ? entries.get(sheetKey) : null;
  if (!sheetXml) return [];

  const sharedStrings = [];
  const ssXml = entries.get('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of ssXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/gi)) {
      const parts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => m[1]);
      sharedStrings.push(
        parts.join('')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
      );
    }
  }

  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells = [];
    let fallbackCol = 0;
    for (const cMatch of rowMatch[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attrs = cMatch[1] || '';
      const inner = cMatch[2] || '';
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
      const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : fallbackCol;
      fallbackCol = colIdx + 1;

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
      while (cells.length <= colIdx) cells.push('');
      cells[colIdx] = val.replace(/&amp;/g, '&').trim();
    }
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  return rows;
}

/**
 * Legacy .xls parser (handles HTML-table .xls, XML SpreadsheetML .xls, and binary BIFF8 string extraction).
 */
export function parseXlsBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return [];
  const head = buffer.subarray(0, 512).toString('utf8');
  if (/<table|<tr|<td/i.test(head)) {
    const full = buffer.toString('utf8');
    const rows = [];
    for (const tr of full.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (cells.some(Boolean)) rows.push(cells);
    }
    return rows;
  }
  if (/<Workbook|<Worksheet|<Row/i.test(head)) {
    const full = buffer.toString('utf8');
    const rows = [];
    for (const r of full.matchAll(/<Row[^>]*>([\s\S]*?)<\/Row>/gi)) {
      const cells = [...r[1].matchAll(/<Data[^>]*>([\s\S]*?)<\/Data>/gi)].map((m) => m[1].trim());
      if (cells.some(Boolean)) rows.push(cells);
    }
    return rows;
  }
  // Binary BIFF8 fallback: extract printable ASCII/UTF-16LE lines that look like product entries
  const latin = buffer.toString('latin1');
  const runs = [...latin.matchAll(/[\x20-\x7E]{5,180}/g)]
    .map((m) => m[0].trim())
    .filter((s) => !/^(Root Entry|Workbook|SummaryInformation|DocumentSummaryInformation|Microsoft Excel|Calibri|Arial|Tahoma|General|Sheet\d)$/i.test(s));
  return runs.map((line) => [line]);
}

/**
 * Zero-dependency PDF text & embedded /URI link extractor.
 * Handles both uncompressed and FlateDecode PDF streams.
 */
export function extractTextFromPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return { text: '', urls: [] };
  const raw = buffer.toString('latin1');
  const urls = new Set();

  for (const m of raw.matchAll(/\/URI\s*\(([^)]+)\)/g)) {
    const u = m[1].replace(/\\([()\\])/g, '$1').trim();
    if (/^https?:\/\//i.test(u)) urls.add(u);
  }

  const chunks = [];
  const decodePdfString = (s) =>
    s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\([()\\])/g, '$1')
      .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));

  const extractOperators = (content) => {
    // Handle TJ arrays: [(Hello) -20 ( World)] TJ
    for (const tjArr of content.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) {
      const parts = [...tjArr[1].matchAll(/\(((?:[^)\\]|\\.)*)\)/g)].map((m) => decodePdfString(m[1]));
      if (parts.length) chunks.push(parts.join(''));
    }
    // Handle simple Tj / ' / " text strings
    for (const tj of content.matchAll(/\(((?:[^)\\]|\\.)*)\)\s*(?:Tj|'|")/g)) {
      const str = decodePdfString(tj[1]).trim();
      if (str) chunks.push(str);
    }
  };

  // Scan all streams
  let searchFrom = 0;
  while (searchFrom < buffer.length) {
    const streamIdx = buffer.indexOf('stream', searchFrom, 'latin1');
    if (streamIdx < 0) break;
    let start = streamIdx + 6;
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
    else if (buffer[start] === 0x0a) start += 1;
    const end = buffer.indexOf('endstream', start, 'latin1');
    if (end < 0) break;
    const slice = buffer.subarray(start, end);
    searchFrom = end + 9;

    let decoded = null;
    try {
      decoded = zlib.inflateSync(slice).toString('latin1');
    } catch {
      try {
        decoded = zlib.inflateRawSync(slice).toString('latin1');
      } catch {
        const plain = slice.toString('latin1');
        if (/Tj|TJ|BT/.test(plain)) decoded = plain;
      }
    }
    if (decoded) {
      extractOperators(decoded);
      for (const u of decoded.matchAll(/https?:\/\/[^\s)<>"]+/gi)) urls.add(u[0]);
    }
  }

  // Also check top-level raw content if uncompressed PDF
  if (!chunks.length) extractOperators(raw);

  const text = chunks
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, urls: [...urls] };
}

/**
 * Convert tabular rows (with or without headers) into normalized preview items.
 */
export function rowsToWishlistDrafts(rows, defaults = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const first = rows[0].map((c) => cleanCell(c).toLowerCase());
  const looksLikeHeader = first.some((h) =>
    /^(product|item|name|title|description|brand|model|url|link|price|sale|target|max|regular|original|retailer|store|merchant|recipient|for|priority|notes|category|asin|upc|size|color)$/.test(h) ||
    /product name|item name|target price|max price|sale price|regular price|wish list|store name|retailer/.test(h)
  );

  const header = looksLikeHeader ? first : ['name', 'url', 'price', 'recipient', 'priority', 'notes'];
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;

  const findCol = (...patterns) => header.findIndex((h) => patterns.some((p) => p.test(h)));
  const colName = findCol(/^(product|item|name|title)/, /product name|item name|title/);
  const colBrand = findCol(/^brand/, /manufacturer/);
  const colModel = findCol(/^model/, /sku|mpn|part/);
  const colUpc = findCol(/^upc/, /gtin|ean|barcode/);
  const colAsin = findCol(/^asin/);
  const colRetailer = findCol(/^(retailer|store|merchant|site|vendor|shop)/);
  const colUrl = findCol(/^(url|link|website|product url)/, /http|link/);
  const colPref = findCol(/^(preferred|target|desired|ideal|sale|deal|current|price)/, /target price|preferred price|sale price|deal price/);
  const colOrig = findCol(/^(original|regular|msrp|list|was|normal)/, /regular price|original price/);
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
    if (!url) {
      const anyUrl = r.find((c) => /^https?:\/\//i.test(cleanCell(c)));
      if (anyUrl) url = cleanCell(anyUrl);
    }
    if (!url && /^https?:\/\//i.test(name)) {
      url = name;
      name = '';
    }
    if (!name && !url) continue;

    const retailerRaw = get(colRetailer);
    const detectedRet = detectRetailer({ vendorName: retailerRaw, url, text: `${name} ${retailerRaw}` });

    drafts.push(
      createWishlistItemObject({
        name: name || url,
        brand: get(colBrand) || null,
        modelNumber: get(colModel) || null,
        upc: get(colUpc) || null,
        asin: get(colAsin) || null,
        sourceUrl: url || null,
        retailerId: detectedRet.id,
        retailerName: retailerRaw || detectedRet.name,
        preferredPrice: parseMoney(get(colPref)),
        originalPrice: parseMoney(get(colOrig)),
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

/**
 * Parse copied lists, email forwards, or multi-URL batches into product drafts.
 */
export function parseBulkTextToDrafts(rawText, defaults = {}) {
  const cleanedRaw = String(rawText || '')
    .replace(/^(?:From|To|Sent|Date|Subject|Cc):.*$/gim, '')
    .trim();

  const lines = cleanedRaw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•▪◦>]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length >= 2);

  if (
    lines.length >= 2 &&
    (lines[0].includes('\t') ||
      (lines[0].split(',').length >= 3 && /name|product|title|price|url|retailer|store/i.test(lines[0])))
  ) {
    return rowsToWishlistDrafts(parseDelimitedText(cleanedRaw), { ...defaults, sourceType: defaults.sourceType || 'bulk' });
  }

  // Merge URL-only lines onto the preceding product title line when copied from emails/lists
  const merged = [];
  for (const line of lines) {
    if (/^https?:\/\/\S+$/i.test(line) && merged.length && !/https?:\/\//i.test(merged[merged.length - 1])) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`;
    } else {
      merged.push(line);
    }
  }

  const drafts = [];
  for (const line of merged) {
    if (/^(unsubscribe|view in browser|privacy policy|copyright|sent from my)/i.test(line)) continue;
    let working = line;

    const urlMatch = working.match(/https?:\/\/[^\s,<>")]+/i);
    const sourceUrl = urlMatch ? urlMatch[0].replace(/[),.;]+$/, '') : null;
    if (sourceUrl) working = working.replace(urlMatch[0], ' ').trim();

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
    let originalPrice = null;
    let maxPrice = null;

    const regMatch = working.match(/\b(?:was|reg\.?|orig\.?|normally|list|msrp)\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
    if (regMatch) {
      originalPrice = parseMoney(regMatch[1]);
      working = working.replace(regMatch[0], ' ').trim();
    }
    const maxMatch = working.match(/\b(?:max|under|below|budget|<=)\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
    if (maxMatch) {
      maxPrice = parseMoney(maxMatch[1]);
      working = working.replace(maxMatch[0], ' ').trim();
    }
    const targetMatch = working.match(/\b(?:target|ideal|prefer(?:red)?|want|now|sale|price:?|for)\s*\$([\d,]+(?:\.\d{1,2})?)/i);
    if (targetMatch) {
      preferredPrice = parseMoney(targetMatch[1]);
      working = working.replace(targetMatch[0], ' ').trim();
    } else {
      const barePrice = working.match(/\$([\d,]+(?:\.\d{1,2})?)/);
      if (barePrice) {
        preferredPrice = parseMoney(barePrice[1]);
        working = working.replace(barePrice[0], ' ').trim();
      }
    }

    const detectedRet = detectRetailer({ url: sourceUrl || '', text: line });
    const cleanName = working.replace(/[-–—,:;|()\[\]\s]+$/g, '').replace(/^[-–—,:;|()\[\]\s]+/g, '').trim();
    if (!cleanName && !sourceUrl) continue;

    // Derive readable title from URL slug if line was only a URL
    let finalName = cleanName;
    if (!finalName && sourceUrl) {
      try {
        const u = new URL(sourceUrl);
        const slug = u.pathname
          .split('/')
          .filter((s) => s.length > 4 && !/^(dp|gp|product|ip|site|p|s|en-us|shop|us|b|c)$/i.test(s) && !/^B0[A-Z0-9]{8}$/i.test(s) && !/^\d+$/.test(s))
          .sort((a, b) => b.length - a.length)[0];
        finalName = slug ? slug.replace(/[-_]+/g, ' ').replace(/\.html?$/i, '').trim() : sourceUrl;
      } catch {
        finalName = sourceUrl;
      }
    }

    drafts.push(
      createWishlistItemObject({
        name: finalName,
        sourceUrl,
        retailerId: detectedRet.id,
        retailerName: detectedRet.name,
        preferredPrice,
        originalPrice,
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
 * Parse any uploaded file (XLSX, XLS, CSV, TSV, PDF, DOCX, DOC, RTF, JSON, HTML, TXT, Screenshot/Image)
 * and return structured extracted drafts + explicit parseWarning when a file needs manual review.
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
  const buf = contentBase64 ? Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64') : null;
  let parseWarning = null;

  // 1. Screenshot / Image upload
  if (/image\//i.test(mimeType) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) {
    const cleanFilename = filename
      .replace(/\.[^.]+$/, '')
      .replace(/screenshot|screen[\s_-]?shot|img|image|photo|capture|\d{4}[-_]\d{2}[-_]\d{2}/gi, ' ')
      .replace(/[-_]+/g, ' ')
      .trim();
    const textHint = String(extractedOcrText || contentText || '').trim();
    const screenshotDataUrl = contentBase64 && contentBase64.length < 450000
      ? (contentBase64.startsWith('data:') ? contentBase64 : `data:${mimeType || 'image/png'};base64,${contentBase64}`)
      : null;

    const lines = textHint ? parseBulkTextToDrafts(textHint, { ...defaults, sourceType: 'screenshot' }) : [];
    if (lines.length) {
      return {
        drafts: lines.map((item) => ({ ...item, screenshotThumbnail: screenshotDataUrl, imageUrl: item.imageUrl || screenshotDataUrl, sourceType: 'screenshot' })),
        parseWarning: null,
      };
    }

    parseWarning = 'Image preserved. Review and confirm the product name, retailer, and price below before saving (automatic image text extraction is limited without text notes).';
    return {
      drafts: [
        createWishlistItemObject({
          name: cleanFilename.length >= 3 ? cleanFilename : 'Product from Screenshot — edit title',
          notes: `Uploaded image: ${filename}`,
          screenshotThumbnail: screenshotDataUrl,
          imageUrl: screenshotDataUrl,
          profileId: defaults.profileId || 'family-main',
          sourceType: 'screenshot',
          recipient: defaults.recipient || '',
          priority: defaults.priority || 'standard',
          needsReview: true,
          reviewReason: 'Verify product title, retailer, and price from screenshot preview',
        }),
      ],
      parseWarning,
    };
  }

  // 2. PDF Document
  if (lower.endsWith('.pdf') || /pdf/i.test(mimeType)) {
    const { text, urls } = extractTextFromPdfBuffer(buf || Buffer.from(contentText || '', 'latin1'));
    const combinedText = [text, ...urls.filter((u) => !text.includes(u))].filter(Boolean).join('\n');
    const drafts = combinedText ? parseBulkTextToDrafts(combinedText, { ...defaults, sourceType: 'pdf' }) : [];
    if (!drafts.length) {
      parseWarning = 'This PDF appears to be scanned/image-only or encrypted with no readable text layer. The original file has been preserved — add or paste its items below.';
    }
    return { drafts, parseWarning };
  }

  // 3. JSON export
  if (lower.endsWith('.json') || /json/i.test(mimeType)) {
    const text = contentText || (buf ? buf.toString('utf8') : '');
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.wishlist)
        ? parsed.wishlist
        : Array.isArray(parsed.savedDeals)
          ? parsed.savedDeals
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];
    const drafts = arr
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
    return { drafts, parseWarning: drafts.length ? null : 'JSON file contained no recognizable product records.' };
  }

  // 4. Excel .xlsx
  if (lower.endsWith('.xlsx') || /spreadsheetml/i.test(mimeType)) {
    const rows = parseXlsxBuffer(buf || Buffer.alloc(0));
    const drafts = rowsToWishlistDrafts(rows, { ...defaults, sourceType: 'xlsx' });
    return {
      drafts,
      parseWarning: drafts.length ? null : 'Could not extract tabular rows from .xlsx workbook. Original file preserved.',
    };
  }

  // 5. Legacy Excel .xls
  if (lower.endsWith('.xls') || /ms-excel/i.test(mimeType)) {
    const rows = parseXlsBuffer(buf || Buffer.alloc(0));
    const drafts = rowsToWishlistDrafts(rows, { ...defaults, sourceType: 'xls' });
    return {
      drafts,
      parseWarning: drafts.length ? null : 'Legacy binary .xls layout could not be fully parsed. Save as .xlsx/.csv or edit extracted lines below; original file preserved.',
    };
  }

  // 6. Word .docx / .doc
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    try {
      const { default: WordExtractor } = await import('word-extractor');
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buf || Buffer.alloc(0));
      const drafts = parseBulkTextToDrafts(doc.getBody() || '', { ...defaults, sourceType: 'word' });
      return { drafts, parseWarning: drafts.length ? null : 'No products detected in Word document body.' };
    } catch (e) {
      return { drafts: [], parseWarning: `Word extraction error (${e.message}). Original file preserved.` };
    }
  }

  // 7. RTF
  if (lower.endsWith('.rtf')) {
    const text = contentText || (buf ? buf.toString('utf8') : '');
    const stripped = text
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-f]{2}/gi, '')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .trim();
    const drafts = parseBulkTextToDrafts(stripped, { ...defaults, sourceType: 'rtf' });
    return { drafts, parseWarning: drafts.length ? null : 'No products detected in RTF document.' };
  }

  // 8. CSV / TSV
  const text = contentText || (buf ? buf.toString('utf8') : '');
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    const rows = parseDelimitedText(text, lower.endsWith('.tsv') ? '\t' : ',');
    const drafts = rowsToWishlistDrafts(rows, { ...defaults, sourceType: 'csv' });
    return { drafts, parseWarning: drafts.length ? null : 'No product rows found in CSV/TSV file.' };
  }

  // 9. Saved HTML shopping list (Amazon / Target / Walmart / Best Buy)
  if (lower.endsWith('.html') || lower.endsWith('.htm') || /<html|<a\s+href=/i.test(text)) {
    const drafts = [];
    const seen = new Set();
    for (const m of text.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']*(?:amazon\.com\/dp\/|target\.com\/p\/|walmart\.com\/ip\/|bestbuy\.com\/site\/|homedepot\.com\/p\/|lowes\.com\/pd\/|nike\.com\/t\/|sephora\.com\/product\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = m[1];
      const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (seen.has(url)) continue;
      seen.add(url);
      const ret = detectRetailer({ url });
      drafts.push(
        createWishlistItemObject({
          name: title.length >= 3 ? title : url,
          sourceUrl: url,
          retailerId: ret.id,
          retailerName: ret.name,
          profileId: defaults.profileId || 'family-main',
          sourceType: 'import',
          recipient: defaults.recipient || '',
        })
      );
    }
    if (drafts.length) return { drafts, parseWarning: null };
  }

  // 10. Plain text / email / pasted list
  const drafts = parseBulkTextToDrafts(text, { ...defaults, sourceType: 'text' });
  return { drafts, parseWarning: drafts.length ? null : 'Could not identify products in uploaded text. Original file preserved.' };
}

/**
 * Full Upload Center Preview Pipeline: parses any mode/file, enriches multi-URLs if needed,
 * runs duplicate detection, flags items needing review, and returns editable preview rows.
 */
export async function buildUploadPreview({
  uploadType = 'wishlist',
  mode = 'file',
  filename = '',
  mimeType = '',
  contentText = '',
  contentBase64 = '',
  extractedOcrText = '',
  urlsText = '',
  defaults = {},
  existingWishlist = [],
  existingSavedDeals = [],
  fetchImpl = globalThis.fetch,
} = {}) {
  let drafts = [];
  let parseWarning = null;

  if (mode === 'urls') {
    const urls = String(urlsText || contentText || '')
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s))
      .slice(0, 25);
    for (const rawUrl of urls) {
      try {
        const { item, inspected } = await buildWishlistItemFromUrl(rawUrl, defaults, { fetchImpl });
        if (inspected?.currentPrice != null && item.preferredPrice == null) {
          item.preferredPrice = inspected.currentPrice;
        }
        if (inspected?.retailerId) {
          item.retailerId = inspected.retailerId;
          item.retailerName = inspected.retailerName;
        }
        if (inspected?.inspectionStatus === 'blocked_by_retailer') {
          item.needsReview = true;
          item.reviewReason = `${inspected.retailerName} blocked live page inspection (HTTP ${inspected.httpStatus || 'blocked'}) — confirm product name & price`;
        }
        drafts.push(item);
      } catch (e) {
        drafts.push(
          createWishlistItemObject({
            name: rawUrl,
            sourceUrl: rawUrl,
            profileId: defaults.profileId || 'family-main',
            sourceType: 'url',
            needsReview: true,
            reviewReason: e.message,
          })
        );
      }
    }
    if (!drafts.length) parseWarning = 'No valid http/https URLs were found. Paste one URL per line.';
  } else if (mode === 'bulk') {
    drafts = parseBulkTextToDrafts(contentText, { ...defaults, sourceType: 'bulk' });
    if (!drafts.length) parseWarning = 'No products could be parsed from the pasted text.';
  } else {
    const res = await parseUploadedDocument({
      filename: filename || 'upload.txt',
      mimeType,
      contentText,
      contentBase64,
      extractedOcrText,
      defaults,
    });
    drafts = res.drafts || [];
    parseWarning = res.parseWarning || null;
  }

  // Flag duplicates & incomplete extractions for user review before committing
  const existingPool = uploadType === 'deal' ? existingSavedDeals : existingWishlist;
  const previewItems = drafts.slice(0, 150).map((d) => {
    const dup = findDuplicateWishlistItem(d, existingPool);
    const needsReview = Boolean(
      d.needsReview ||
      !d.name ||
      /^https?:\/\//i.test(d.name) ||
      d.name.length < 3 ||
      (uploadType === 'deal' && d.preferredPrice == null)
    );
    const reviewReason =
      d.reviewReason ||
      (/^https?:\/\//i.test(d.name) ? 'Replace raw URL with product name' : null) ||
      (uploadType === 'deal' && d.preferredPrice == null ? 'Enter deal price for accurate tracking' : null);

    return {
      tempId: `tmp_${crypto.randomBytes(4).toString('hex')}`,
      selected: !dup,
      uploadType,
      name: d.name,
      brand: d.brand || '',
      modelNumber: d.modelNumber || '',
      size: d.size || '',
      color: d.color || '',
      price: d.preferredPrice ?? null,
      originalPrice: d.originalPrice ?? null,
      maxPrice: d.maxPrice ?? null,
      retailerId: d.retailerId || detectRetailer({ url: d.sourceUrl || '', text: d.name }).id,
      retailerName: d.retailerName || detectRetailer({ url: d.sourceUrl || '', text: d.name }).name,
      url: d.sourceUrl || '',
      recipient: d.recipient || defaults.recipient || '',
      profileId: d.profileId || defaults.profileId || 'family-main',
      priority: d.priority || defaults.priority || 'standard',
      notes: d.notes || '',
      imageUrl: d.imageUrl || d.screenshotThumbnail || null,
      screenshotThumbnail: d.screenshotThumbnail || null,
      sourceType: d.sourceType || mode,
      isDuplicate: Boolean(dup),
      duplicateReason: dup ? `Matches existing "${dup.name}" (${dup.status || 'saved'})` : null,
      needsReview,
      reviewReason,
    };
  });

  return {
    ok: true,
    uploadType,
    filename: filename || null,
    parseWarning,
    extractedCount: previewItems.length,
    duplicatesCount: previewItems.filter((i) => i.isDuplicate).length,
    needsReviewCount: previewItems.filter((i) => i.needsReview).length,
    items: previewItems,
  };
}

/**
 * Create a clean, normalized wish-list item record.
 */
export function createWishlistItemObject(input = {}) {
  const nowIso = new Date().toISOString();
  const rawName = String(input.name || '').trim();
  const isGiftIdea = input.sourceType === 'gift_idea' || Boolean(input.isGiftIdea);

  const identity = normalizeProductIdentity({
    title: `${input.brand || ''} ${rawName} ${input.modelNumber || ''}`,
    brand: input.brand || null,
    modelNumber: input.modelNumber || null,
    url: input.sourceUrl || input.url || '',
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

  const ret = detectRetailer({
    vendorName: input.retailerName || '',
    url: input.sourceUrl || input.url || '',
    text: rawName,
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
    preferredPrice: parseMoney(input.preferredPrice ?? input.price),
    originalPrice: parseMoney(input.originalPrice),
    maxPrice: parseMoney(input.maxPrice),
    recipient: String(input.recipient || '').trim(),
    profileId: input.profileId || 'family-main',
    retailerId: input.retailerId || ret.id,
    retailerName: input.retailerName || ret.name,
    category: input.category || identity.category || 'other',
    priority: normalizePriority(input.priority),
    status: normalizeStatus(input.status || 'monitoring'),
    allowRefurbished: Boolean(input.allowRefurbished),
    allowOpenBox: Boolean(input.allowOpenBox),
    isGiftIdea,
    sourceUrl: input.sourceUrl || input.url || null,
    sourceType: input.sourceType || 'manual',
    uploadFileId: input.uploadFileId || null,
    imageUrl: input.imageUrl || null,
    screenshotThumbnail: input.screenshotThumbnail || null,
    notes: String(input.notes || '').trim(),
    needsReview: Boolean(input.needsReview),
    reviewReason: input.reviewReason || null,
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
 * Create a user-uploaded saved deal record (UPLOAD DEALS workflow).
 * Preserves original retailer, original uploaded price, URL, and date forever even if price changes.
 */
export function createUserSavedDealObject(input = {}) {
  const nowIso = new Date().toISOString();
  const base = createWishlistItemObject(input);
  const uploadedPrice = parseMoney(input.price ?? input.currentPrice ?? input.preferredPrice);
  const regularPrice = parseMoney(input.originalPrice ?? input.reportedRegularPrice);

  return {
    id: input.id || `ud_${crypto.randomBytes(6).toString('hex')}`,
    name: base.name,
    title: base.name,
    brand: base.brand,
    modelNumber: base.modelNumber,
    size: base.size,
    color: base.color,
    category: base.category,
    retailerId: base.retailerId,
    retailerName: base.retailerName,
    url: base.sourceUrl || null,
    imageUrl: base.imageUrl || base.screenshotThumbnail || null,
    screenshotThumbnail: base.screenshotThumbnail || null,
    originalUploadedPrice: uploadedPrice,
    currentPrice: uploadedPrice,
    originalRegularPrice: regularPrice,
    uploadedAt: input.uploadedAt || nowIso,
    updatedAt: nowIso,
    profileId: base.profileId,
    recipient: base.recipient,
    notes: base.notes,
    uploadFileId: input.uploadFileId || null,
    canonicalKey: base.canonicalKey,
    identity: base.identity,
    priceHistory: uploadedPrice != null
      ? [{ observedAt: input.uploadedAt || nowIso, price: uploadedPrice, source: 'user_upload', note: 'Original uploaded deal price' }]
      : [],
  };
}

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
    retailerId: inspected.retailerId,
    retailerName: inspected.retailerName,
    sourceUrl: inspected.url,
    imageUrl: inspected.imageUrl,
    category: extras.category || inspected.category,
    sourceType: 'url',
    notes: [extras.notes, inspected.note].filter(Boolean).join(' · '),
  });
  return { item, inspected };
}

export function findDuplicateWishlistItem(candidate, existingList = []) {
  for (const ex of existingList || []) {
    if (ex.status === 'no_longer_interested') continue;
    if (candidate.asin && ex.asin && candidate.asin === ex.asin) return ex;
    if (candidate.upc && ex.upc && candidate.upc === ex.upc) return ex;
    if (candidate.gtin && ex.gtin && candidate.gtin === ex.gtin) return ex;
    const candUrl = candidate.sourceUrl || candidate.url;
    const exUrl = ex.sourceUrl || ex.url;
    if (candUrl && exUrl && candUrl === exUrl) return ex;
    if (
      candidate.canonicalKey &&
      ex.canonicalKey &&
      candidate.canonicalKey === ex.canonicalKey &&
      (candidate.recipient || '').toLowerCase() === (ex.recipient || '').toLowerCase()
    ) {
      return ex;
    }
    if (
      (candidate.name || '').toLowerCase() === (ex.name || '').toLowerCase() &&
      (candidate.recipient || '').toLowerCase() === (ex.recipient || '').toLowerCase()
    ) {
      return ex;
    }
  }
  return null;
}
