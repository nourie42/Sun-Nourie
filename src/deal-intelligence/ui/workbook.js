(function () {
  'use strict';

  const MAX_FILE = 10 * 1024 * 1024;
  const MAX_EXPANDED = 30 * 1024 * 1024;
  const MAX_CELLS = 50000;
  const decoder = new TextDecoder('utf-8');
  const fail = message => { throw new Error(message); };
  const descendants = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const child = (node, name) => Array.from(node.children || []).find(item => item.localName === name);
  const scalar = value => value == null ? '' : String(value).trim();
  const headerKey = value => scalar(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const aliases = {
    name: ['company', 'company name', 'name', 'target', 'target name', 'business', 'business name'],
    legalName: ['legal name', 'legal company name', 'legal business name', 'legal entity'],
    type: ['type', 'business type', 'company type'],
    states: ['states', 'state', 'operating states', 'geography'],
    siteCount: ['location count', 'site count', 'sites', 'locations', 'number of sites', 'number of locations'],
    ownerName: ['owner', 'owner name', 'decision maker', 'decision maker name'],
    ownerTitle: ['owner title', 'decision maker title', 'contact title'],
    contactEmail: ['email', 'contact email', 'owner email'],
    contactPhone: ['phone', 'contact phone', 'owner phone', 'telephone'],
    stage: ['stage', 'deal stage', 'pipeline stage'],
    sourceUrls: ['source', 'url', 'sources', 'source url', 'source urls', 'website', 'website url'],
    notes: ['notes', 'note', 'research notes'],
    nextAction: ['next action', 'next step', 'outreach action'],
    dueDate: ['due date', 'next action date'],
  };
  const aliasLookup = new Map(Object.entries(aliases).flatMap(([field, names]) => names.map(name => [name, field])));
  const stages = ['Research', 'Ready to contact', 'Contacted', 'Interested', 'NDA', 'Diligence', 'Closed', 'Passed'];

  function sourceUrls(value) {
    const urls = scalar(value).split(/[\s;,]+/).map(item => {
      try {
        const url = new URL(item);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
      } catch { return ''; }
    }).filter(Boolean);
    return [...new Set(urls)];
  }

  function mapTargets(input) {
    const sheets = Array.isArray(input) ? input : input?.sheets || [];
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
        const fields = new Map();
        rows[index].forEach((value, column) => {
          const field = aliasLookup.get(headerKey(value));
          if (field && !fields.has(field)) fields.set(field, column);
        });
        if (!fields.has('name') && !fields.has('legalName')) continue;
        const get = (row, field) => fields.has(field) ? scalar(row[fields.get(field)]) : '';
        const targets = [];
        const seen = new Set();
        for (const row of rows.slice(index + 1)) {
          const name = get(row, 'name') || get(row, 'legalName');
          if (!name || /^(unknown|n\/a|null|none|company|company name|name|target|total|totals)$/i.test(name)) continue;
          const key = headerKey(name);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const countText = get(row, 'siteCount').replace(/,/g, '');
          const count = /^\d+(?:\.0+)?$/.test(countText) ? Number(countText) : null;
          const stateText = get(row, 'states');
          const states = stateText.split(/[,;|\/\n]+/).flatMap(part => /^[a-z]{2}(?:\s+[a-z]{2})+$/i.test(part.trim()) ? part.trim().split(/\s+/) : [part.trim()]).filter(part => part && !/^(unknown|n\/a|null|none)$/i.test(part));
          const rawStage = get(row, 'stage');
          const dueDate = get(row, 'dueDate');
          targets.push({
            id: crypto.randomUUID(), name, legalName: get(row, 'legalName'),
            type: get(row, 'type') || 'Unknown',
            states: [...new Set(states.map(state => /^[a-z]{2}$/i.test(state) ? state.toUpperCase() : state))],
            siteCount: count !== null && Number.isSafeInteger(count) ? count : null,
            ownerName: get(row, 'ownerName'), ownerTitle: get(row, 'ownerTitle'),
            contactEmail: get(row, 'contactEmail'), contactPhone: get(row, 'contactPhone'),
            stage: stages.find(stage => stage.toLowerCase() === rawStage.toLowerCase()) || 'Research',
            score: null, confidence: 'Low', sellerSignal: 'Unknown', sellerSignalReason: 'Unknown',
            sourceUrls: sourceUrls(get(row, 'sourceUrls')), notes: get(row, 'notes'),
            nextAction: get(row, 'nextAction') || 'Review imported company and verify sources.',
            dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : '',
            sample: false, financials: {},
          });
        }
        if (targets.length) return targets;
      }
    }
    return [];
  }

  function xml(bytes, label) {
    const text = decoder.decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail(`${label} contains unsupported XML document declarations.`);
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.getElementsByTagName('parsererror').length || descendants(document, 'parsererror').length) fail(`${label} contains invalid XML.`);
    return document;
  }

  function relationshipPath(target) {
    if (!target || /[\\?#]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target)) return '';
    const parts = target.startsWith('/') ? [] : ['xl'];
    for (const part of target.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (parts.length <= 1) return '';
        parts.pop();
      } else parts.push(part);
    }
    return parts[0] === 'xl' ? parts.join('/') : '';
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let crc = index;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      table[index] = crc >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function openZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = offset => view.getUint16(offset, true);
    const u32 = offset => view.getUint32(offset, true);
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
      if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
    }
    if (end < 0) fail('This file is not a valid XLSX ZIP workbook. Legacy .xls files must be saved as .xlsx or CSV first.');
    const count = u16(end + 10);
    const directorySize = u32(end + 12);
    const directoryStart = u32(end + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff || (end >= 20 && u32(end - 20) === 0x07064b50)) fail('ZIP64 workbooks are not supported. Save a smaller XLSX workbook or export CSV.');
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) fail('Multi-volume ZIP workbooks are not supported.');
    if (directoryStart + directorySize !== end) fail('The XLSX ZIP directory is invalid.');
    const entries = new Map();
    let offset = directoryStart;
    let declaredExpanded = 0;
    for (let index = 0; index < count; index += 1) {
      if (offset + 46 > end || u32(offset) !== 0x02014b50) fail('The XLSX ZIP directory is damaged.');
      const flags = u16(offset + 8);
      const method = u16(offset + 10);
      const crc = u32(offset + 16);
      const compressed = u32(offset + 20);
      const expanded = u32(offset + 24);
      const nameLength = u16(offset + 28);
      const extraLength = u16(offset + 30);
      const commentLength = u16(offset + 32);
      const disk = u16(offset + 34);
      const localOffset = u32(offset + 42);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (nextOffset > end) fail('The XLSX ZIP entry is damaged.');
      if (flags & 0x41) fail('Encrypted workbooks are not supported. Save an unencrypted XLSX copy first.');
      if (![0, 8].includes(method)) fail(`Unsupported XLSX compression method ${method}. Save a standard XLSX copy or export CSV.`);
      if (disk || compressed === 0xffffffff || expanded === 0xffffffff || localOffset === 0xffffffff) fail('ZIP64 and multi-volume workbooks are not supported.');
      for (let extra = offset + 46 + nameLength; extra < offset + 46 + nameLength + extraLength;) {
        if (extra + 4 > offset + 46 + nameLength + extraLength) fail('The XLSX ZIP metadata is invalid.');
        if (u16(extra) === 1) fail('ZIP64 workbooks are not supported.');
        extra += 4 + u16(extra + 2);
        if (extra > offset + 46 + nameLength + extraLength) fail('The XLSX ZIP metadata is invalid.');
      }
      declaredExpanded += expanded;
      if (declaredExpanded > MAX_EXPANDED) fail('Workbook expands beyond the 30 MB import limit. Export a smaller workbook or CSV.');
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (entries.has(name)) fail('The XLSX ZIP contains duplicate file entries.');
      entries.set(name, { name, flags, method, crc, compressed, expanded, localOffset });
      offset = nextOffset;
    }
    if (offset !== directoryStart + directorySize) fail('The XLSX ZIP directory length is invalid.');
    const cache = new Map();
    let actualExpanded = 0;
    return {
      has: name => entries.has(name),
      async read(name) {
        if (cache.has(name)) return cache.get(name);
        const entry = entries.get(name);
        if (!entry) fail(`Workbook is missing ${name}.`);
        const result = (async () => {
          const local = entry.localOffset;
          if (local + 30 > directoryStart || u32(local) !== 0x04034b50) fail('The XLSX ZIP file header is damaged.');
          if (u16(local + 6) & 0x41) fail('Encrypted workbooks are not supported.');
          if (u16(local + 8) !== entry.method) fail('The XLSX ZIP compression metadata does not match.');
          const nameLength = u16(local + 26);
          const extraLength = u16(local + 28);
          const start = local + 30 + nameLength + extraLength;
          if (start > directoryStart || start + entry.compressed > directoryStart || decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name) fail('The XLSX ZIP file bounds are invalid.');
          const compressed = bytes.subarray(start, start + entry.compressed);
          let output;
          if (entry.method === 0) output = compressed;
          else {
            let stream;
            try { stream = new DecompressionStream('deflate-raw'); }
            catch { fail('This browser cannot decompress XLSX files. Update your browser or export the workbook as CSV.'); }
            const reader = new Blob([compressed]).stream().pipeThrough(stream).getReader();
            const chunks = [];
            let size = 0;
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > entry.expanded || actualExpanded + size > MAX_EXPANDED) {
                  await reader.cancel();
                  fail('Workbook expands beyond its declared size or the 30 MB import limit.');
                }
                chunks.push(value);
              }
            } catch (error) { fail(`Unable to decompress XLSX data: ${error.message}`); }
            output = new Uint8Array(size);
            let position = 0;
            for (const chunk of chunks) { output.set(chunk, position); position += chunk.byteLength; }
          }
          actualExpanded += output.byteLength;
          if (actualExpanded > MAX_EXPANDED || output.byteLength !== entry.expanded || crc32(output) !== entry.crc) fail('The XLSX ZIP content is damaged or exceeds the import limit.');
          return output;
        })();
        cache.set(name, result);
        return result;
      },
    };
  }

  function columnIndex(reference) {
    const match = /^([A-Z]{1,3})[1-9]\d*$/i.exec(reference || '');
    if (!match) return null;
    let index = 0;
    for (const character of match[1].toUpperCase()) index = index * 26 + character.charCodeAt(0) - 64;
    if (index > 16384) fail('Worksheet contains a cell outside Excel column limits.');
    return index - 1;
  }

  async function readWorkbook(file) {
    if (!file || typeof file.arrayBuffer !== 'function') fail('Choose an XLSX workbook to import.');
    if (/\.xls$/i.test(file.name || '')) fail('Legacy .xls files are not supported. Save as .xlsx or CSV first.');
    if (file.size > MAX_FILE) fail('Workbook exceeds the 10 MB upload limit. Export a smaller XLSX workbook or CSV.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_FILE) fail('Workbook exceeds the 10 MB upload limit.');
    const zip = openZip(bytes);
    const workbook = xml(await zip.read('xl/workbook.xml'), 'Workbook');
    const relations = xml(await zip.read('xl/_rels/workbook.xml.rels'), 'Workbook relationships');
    const relationships = new Map(descendants(relations, 'Relationship').map(item => [item.getAttribute('Id'), item]));
    const warnings = [];
    let sharedStrings = [];
    const stringRelation = [...relationships.values()].find(item => /\/sharedStrings$/.test(item.getAttribute('Type') || '') && item.getAttribute('TargetMode') !== 'External');
    const stringsPath = stringRelation ? relationshipPath(stringRelation.getAttribute('Target')) : 'xl/sharedStrings.xml';
    if (stringsPath && zip.has(stringsPath)) {
      const strings = xml(await zip.read(stringsPath), 'Shared strings');
      sharedStrings = descendants(strings, 'si').map(item => descendants(item, 't').filter(text => text.parentElement?.localName !== 'rPh').map(text => text.textContent || '').join(''));
    }
    const sheets = [];
    let cellCount = 0;
    for (const sheet of descendants(workbook, 'sheet')) {
      const name = sheet.getAttribute('name') || `Sheet ${sheets.length + 1}`;
      const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
      const relation = relationships.get(id);
      if (!relation || relation.getAttribute('TargetMode') === 'External') { warnings.push(`Skipped ${name}: worksheet relationship is missing or external.`); continue; }
      const type = relation.getAttribute('Type') || '';
      if (!/\/worksheet$/.test(type)) { warnings.push(`Skipped ${name}: only worksheet tabs can be imported.`); continue; }
      const path = relationshipPath(relation.getAttribute('Target'));
      if (!path || !zip.has(path)) fail(`Worksheet ${name} has an invalid or missing internal file.`);
      const document = xml(await zip.read(path), `Worksheet ${name}`);
      const rows = [];
      const formulaCells = [];
      let missingCaches = 0;
      const sheetData = descendants(document, 'sheetData')[0];
      if (sheetData) for (const row of Array.from(sheetData.children).filter(item => item.localName === 'row')) {
        const values = [];
        let nextColumn = 0;
        for (const cell of Array.from(row.children).filter(item => item.localName === 'c')) {
          cellCount += 1;
          if (cellCount > MAX_CELLS) fail('Workbook exceeds the 50,000-cell import limit. Export selected rows to a smaller workbook or CSV.');
          const column = columnIndex(cell.getAttribute('r')) ?? nextColumn;
          if (column >= 16384) fail('Worksheet contains too many columns.');
          nextColumn = column + 1;
          const valueNode = child(cell, 'v');
          const raw = valueNode?.textContent || '';
          const type = cell.getAttribute('t');
          let value = '';
          if (type === 'inlineStr') value = descendants(child(cell, 'is') || cell, 't').filter(text => text.parentElement?.localName !== 'rPh').map(text => text.textContent || '').join('');
          else if (type === 's' && valueNode) {
            if (!/^\d+$/.test(raw) || Number(raw) >= sharedStrings.length) fail(`Worksheet ${name} references a missing shared string.`);
            value = sharedStrings[Number(raw)];
          } else if (type === 'b') value = raw === '1' ? true : raw === '0' ? false : '';
          else if (['str', 'e', 'd'].includes(type)) value = raw;
          else if (raw.trim()) value = Number.isFinite(Number(raw)) ? Number(raw) : raw;
          const formula = child(cell, 'f');
          if (formula) {
            if (!valueNode) { value = ''; missingCaches += 1; }
            formulaCells.push({ reference: cell.getAttribute('r') || '', formula: formula.textContent || '', type: formula.getAttribute('t') || '', sharedIndex: formula.getAttribute('si'), range: formula.getAttribute('ref') || '', cachedValue: value });
          }
          values[column] = value;
        }
        if (values.length) rows.push(values);
      }
      sheets.push({ name, rows, formulas: formulaCells.length, formulaCells });
      if (missingCaches) warnings.push(`${name}: ${missingCaches} formula cells have no stored cached result and were imported as blank.`);
    }
    const formulaCount = sheets.reduce((sum, sheet) => sum + sheet.formulas, 0);
    if (formulaCount) warnings.push(`${formulaCount} formula cells use stored cached values only, which may be outdated. Formula metadata is retained in this import; the original Excel file is unchanged. This app does not recalculate Excel formulas or treat imported financial results as verified calculations.`);
    if (!sheets.length) fail('This workbook has no readable worksheet tabs.');
    const targets = mapTargets(sheets);
    if (!targets.length) warnings.push('No target table was identified. Include a company, name, target, business, or legal name header. Worksheet values were still read.');
    return { sheets, targets, sites: [], warnings };
  }

  window.DealWorkbook = Object.freeze({ readWorkbook, mapTargets });
})();
