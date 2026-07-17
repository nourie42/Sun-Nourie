(() => {
  'use strict';

  const ENDPOINTS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  const MAX_LAT_SPAN = 10;
  const MAX_LON_SPAN = 14;
  const MAX_AREA = 110;
  const TILE_AREA_THRESHOLD = 42;
  const MAX_RESULTS_IN_LIST = 350;
  const REQUEST_TIMEOUT_MS = 14000;

  const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([37.8, -96], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);

  const layer = typeof L.markerClusterGroup === 'function'
    ? L.markerClusterGroup({ chunkedLoading: true, removeOutsideVisibleBounds: true, maxClusterRadius: 46 })
    : L.layerGroup();
  layer.addTo(map);

  const els = {
    workspace: document.getElementById('workspace'),
    search: document.getElementById('search'),
    filters: document.getElementById('filters'),
    results: document.getElementById('results'),
    count: document.getElementById('count'),
    states: document.getElementById('states'),
    owners: document.getElementById('owners'),
    status: document.getElementById('status'),
    reload: document.getElementById('reload'),
    details: document.getElementById('details'),
    detailBody: document.getElementById('detailBody'),
    close: document.getElementById('close'),
    resultTitle: document.getElementById('resultTitle'),
    loading: document.getElementById('loading'),
    loadingTitle: document.getElementById('loadingTitle'),
    loadingDetail: document.getElementById('loadingDetail'),
  };

  let records = [];
  let active = 'all';
  let filterTimer = null;
  let searchSerial = 0;
  let searching = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  const TARGET_TEXT = /\b(heating[\s_-]?oil|fuel[\s_-]?oil|petroleum|propane|lpg|bulk[\s_-]?(plant|fuel)|tank[\s_-]?farm|storage[\s_-]?terminal|fuel[\s_-]?terminal|oil[\s_-]?terminal|petroleum[\s_-]?terminal|fuel[\s_-]?(distribut|wholesal|company)|petroleum[\s_-]?(distribut|wholesal|company)|oil[\s_-]?(company|co\.?|distribut|wholesal)|\boil\b)/i;
  const NEGATIVE_TEXT = /\b(amenity fuel|gas station|service station|filling station|travel center|truck stop|convenience store|oil change|motor oil|essential oils?|olive oil|cooking oil|vegetable oil|oilfield|drilling|exploration|well service|lubrication service|lube shop)\b/i;
  const INDUSTRIAL_VALUES = /^(oil|petroleum|fuel|tank_farm|oil_storage|petroleum_storage|fuel_storage|bulk_plant|fuel_terminal|oil_terminal|terminal|depot)$/i;
  const STORAGE_VALUES = /^(fuel|fuel_oil|heating_oil|oil|petroleum|diesel|gasoline|kerosene|propane|lpg)$/i;

  function tagText(tags) {
    return [
      tags.name, tags.operator, tags.owner, tags['owner:name'], tags.brand, tags.company,
      tags.description, tags.product, tags.products, tags.substance, tags.content,
      tags.industrial, tags.office, tags.shop, tags.storage, tags.terminal, tags.depot,
    ].filter(Boolean).join(' ');
  }

  function isTargetFacility(tags) {
    const amenity = String(tags.amenity || '').toLowerCase();
    const shop = String(tags.shop || '').toLowerCase();
    if (amenity === 'fuel') return false;
    if (['convenience', 'supermarket'].includes(shop)) return false;

    const text = tagText(tags);
    if (NEGATIVE_TEXT.test(`${amenity} ${text}`)) return false;

    const office = /^(company|logistics)$/i.test(String(tags.office || ''));
    const industrial = INDUSTRIAL_VALUES.test(String(tags.industrial || ''));
    const heatingOilShop = shop === 'heating_oil';
    const namedIndustrialSite = /^(industrial|warehouse)$/i.test(String(tags.building || '')) && TARGET_TEXT.test(text);
    const namedIndustrialLand = String(tags.landuse || '').toLowerCase() === 'industrial' && TARGET_TEXT.test(text);
    const storage = STORAGE_VALUES.test(String(tags.storage || tags.substance || tags.content || '').toLowerCase());
    const namedStorageTank = String(tags.man_made || '').toLowerCase() === 'storage_tank'
      && storage
      && Boolean(tags.name || tags.operator || tags.owner || tags['owner:name']);
    const companyRecord = office && TARGET_TEXT.test(text);

    return heatingOilShop || industrial || namedIndustrialSite || namedIndustrialLand || namedStorageTank || companyRecord;
  }

  function classify(tags) {
    const text = `${tagText(tags)} ${tags.industrial || ''}`.toLowerCase();
    if (/heating[\s_-]?oil|home heating|fuel[\s_-]?oil|kerosene/.test(text)) return 'heating_oil';
    if (/propane|\blpg\b/.test(text)) return 'propane';
    if (/bulk[\s_-]?(plant|fuel)|petroleum bulk/.test(text)) return 'bulk_plant';
    if (/terminal|tank[\s_-]?farm|storage terminal|fuel storage|oil storage|petroleum storage|\bdepot\b/.test(text)) return 'terminal';
    return 'distributor';
  }

  function label(type) {
    return ({
      distributor: 'Fuel distributor',
      heating_oil: 'Heating oil company',
      bulk_plant: 'Bulk plant',
      terminal: 'Terminal / depot',
      propane: 'Propane distributor',
    })[type] || 'Fuel distributor';
  }

  function address(tags) {
    return [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
      || tags['addr:full']
      || '';
  }

  function normalize(element) {
    const tags = element.tags || {};
    if (!isTargetFacility(tags)) return null;
    const center = element.center || element;
    const lat = Number(center.lat);
    const lon = Number(center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const owner = tags.owner || tags['owner:name'] || '';
    const operator = tags.operator || tags.company || '';
    const name = tags.name || operator || owner || 'Unnamed fuel distribution facility';
    return {
      id: `${element.type}-${element.id}`,
      osmType: element.type,
      osmId: element.id,
      name,
      owner,
      operator,
      phone: tags.phone || tags['contact:phone'] || tags['operator:phone'] || '',
      email: tags.email || tags['contact:email'] || tags['operator:email'] || '',
      website: tags.website || tags['contact:website'] || tags.url || '',
      street: address(tags),
      city: tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || tags['addr:hamlet'] || '',
      state: tags['addr:state'] || '',
      zip: tags['addr:postcode'] || '',
      lat,
      lon,
      type: classify(tags),
      tags,
    };
  }

  function informationScore(record) {
    return [record.name, record.owner, record.operator, record.phone, record.email, record.website, record.street, record.city, record.state, record.zip]
      .filter(Boolean).length;
  }

  function dedupe(items) {
    const byElement = new Map();
    for (const record of items) {
      if (record) byElement.set(record.id, record);
    }

    const byFacility = new Map();
    for (const record of byElement.values()) {
      const identity = String(record.name || record.operator || record.owner || 'unnamed')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const tank = String(record.tags.man_made || '').toLowerCase() === 'storage_tank';
      const precision = tank ? 100 : 1000;
      const key = `${identity}|${Math.round(record.lat * precision)}|${Math.round(record.lon * precision)}`;
      const existing = byFacility.get(key);
      if (!existing || informationScore(record) > informationScore(existing)) byFacility.set(key, record);
    }
    return [...byFacility.values()];
  }

  function currentSearchability() {
    const bounds = map.getBounds();
    const latSpan = Math.abs(bounds.getNorth() - bounds.getSouth());
    const lonSpan = Math.abs(bounds.getEast() - bounds.getWest());
    const area = latSpan * lonSpan;
    const ok = latSpan <= MAX_LAT_SPAN && lonSpan <= MAX_LON_SPAN && area <= MAX_AREA;
    return { ok, bounds, latSpan, lonSpan, area };
  }

  function setStatus(message, kind = '') {
    els.status.textContent = message;
    els.status.classList.toggle('error', kind === 'error');
    els.status.classList.toggle('success', kind === 'success');
  }

  function refreshSearchButton({ preserveStatus = false } = {}) {
    const { ok } = currentSearchability();
    if (searching) {
      els.reload.disabled = true;
      els.reload.textContent = 'Searching…';
      return;
    }
    els.reload.disabled = !ok;
    els.reload.textContent = ok ? 'Search this map area' : 'Zoom in to search';
    if (!preserveStatus) {
      setStatus(ok
        ? 'Ready — search this area for distributor facilities only.'
        : 'Zoom in to a state or small multi-state region to search.');
    }
  }

  function setLoading(isLoading, detail = '') {
    searching = isLoading;
    els.loading.hidden = !isLoading;
    if (detail) els.loadingDetail.textContent = detail;
    refreshSearchButton({ preserveStatus: true });
  }

  function visible() {
    const query = els.search.value.trim().toLowerCase();
    return records.filter((record) => (
      (active === 'all' || record.type === active)
      && (!query || [record.name, record.owner, record.operator, record.street, record.city, record.state, record.zip]
        .join(' ').toLowerCase().includes(query))
    ));
  }

  function markerColor(type) {
    return ({
      heating_oil: '#e48b24', bulk_plant: '#6f55aa', terminal: '#c83d4f', propane: '#18805d', distributor: '#1976a8',
    })[type] || '#1976a8';
  }

  function render() {
    const items = visible();
    layer.clearLayers();
    els.results.innerHTML = '';
    els.count.textContent = items.length.toLocaleString();
    els.states.textContent = new Set(items.map((item) => item.state).filter(Boolean)).size.toLocaleString();
    els.owners.textContent = items.filter((item) => item.owner).length.toLocaleString();
    els.resultTitle.textContent = `${items.length.toLocaleString()} locations`;

    if (!items.length) {
      els.results.innerHTML = records.length
        ? '<p class="empty">No loaded locations match this filter.</p>'
        : '<p class="empty">No distributor facilities were returned for this area. Try a nearby area or a slightly wider view.</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((record, index) => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="dot" style="background:${markerColor(record.type)}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([record.lat, record.lon], { icon, title: record.name })
        .on('click', () => openDetails(record))
        .addTo(layer);

      if (index >= MAX_RESULTS_IN_LIST) return;
      const button = document.createElement('button');
      button.className = 'result';
      button.type = 'button';
      button.innerHTML = `<strong>${esc(record.name)}</strong><span>${esc(label(record.type))} · ${esc([record.city, record.state].filter(Boolean).join(', ') || record.street || 'Address not supplied')}</span>`;
      button.addEventListener('click', () => {
        map.setView([record.lat, record.lon], 14);
        openDetails(record);
      });
      fragment.appendChild(button);
    });
    els.results.appendChild(fragment);

    if (items.length > MAX_RESULTS_IN_LIST) {
      const note = document.createElement('div');
      note.className = 'result-limit';
      note.textContent = `Showing the first ${MAX_RESULTS_IN_LIST.toLocaleString()} entries in the list. All ${items.length.toLocaleString()} locations remain visible on the map.`;
      els.results.appendChild(note);
    }
  }

  function detailRow(name, value, link) {
    if (!value) return `<div class="row"><label>${esc(name)}</label><span class="empty">Not publicly listed</span></div>`;
    return `<div class="row"><label>${esc(name)}</label>${link
      ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>`
      : `<span>${esc(value)}</span>`}</div>`;
  }

  function safeWebsite(value) {
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  function openDetails(record) {
    els.details.hidden = false;
    els.workspace.classList.add('detail-open');
    const locality = [record.city, record.state].filter(Boolean).join(', ');
    const fullAddress = [record.street, locality, record.zip].filter(Boolean).join(' ');
    const source = `https://www.openstreetmap.org/${encodeURIComponent(record.osmType)}/${encodeURIComponent(record.osmId)}`;
    const website = safeWebsite(record.website);

    els.detailBody.innerHTML = `
      <span class="badge">${esc(label(record.type))}</span>
      <h2>${esc(record.name)}</h2>
      <div class="address">${esc(fullAddress || 'Address not publicly supplied')}</div>
      <div class="block"><h3>Ownership and operation</h3>
        ${detailRow('Legal owner', record.owner)}
        ${detailRow('Operating entity', record.operator)}
      </div>
      <div class="block"><h3>Public business contact</h3>
        ${detailRow('Phone', record.phone, record.phone ? `tel:${record.phone}` : '')}
        ${detailRow('Email', record.email, record.email ? `mailto:${record.email}` : '')}
        ${detailRow('Website', record.website, website)}
      </div>
      <div class="block"><h3>Source</h3>
        <p class="empty">OpenStreetMap public company and facility tags. Gas-station records are explicitly excluded. Missing ownership and contact fields are never inferred.</p>
        <a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Open source record</a>
      </div>`;
  }

  function bboxString(bounds) {
    return [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => Number(value).toFixed(5)).join(',');
  }

  function buildQuery(bounds) {
    const bbox = bboxString(bounds);
    const businessTerms = 'fuel|oil|petroleum|propane|lpg|heating|bulk|terminal|tank[ _-]?farm|depot';
    const storageTerms = 'fuel|fuel_oil|heating_oil|oil|petroleum|diesel|gasoline|kerosene|propane|lpg';
    return `[out:json][timeout:24];(
      nwr["shop"="heating_oil"](${bbox});
      nwr["industrial"~"^(oil|petroleum|fuel|tank_farm|oil_storage|petroleum_storage|fuel_storage|bulk_plant|fuel_terminal|oil_terminal|terminal|depot)$",i](${bbox});
      nwr["office"~"^(company|logistics)$"]["name"~"${businessTerms}",i](${bbox});
      nwr["office"~"^(company|logistics)$"]["operator"~"${businessTerms}",i](${bbox});
      nwr["office"~"^(company|logistics)$"]["product"~"${storageTerms}",i](${bbox});
      nwr["office"~"^(company|logistics)$"]["description"~"fuel|heating[ _-]?oil|petroleum|propane|bulk[ _-]?plant|terminal|distribut|wholesal",i](${bbox});
      nwr["landuse"="industrial"]["name"~"${businessTerms}",i](${bbox});
      nwr["building"~"^(industrial|warehouse)$"]["name"~"${businessTerms}",i](${bbox});
      nwr["man_made"="storage_tank"]["substance"~"^(${storageTerms})$",i]["operator"](${bbox});
      nwr["man_made"="storage_tank"]["content"~"^(${storageTerms})$",i]["operator"](${bbox});
      nwr["man_made"="storage_tank"]["substance"~"^(${storageTerms})$",i]["name"](${bbox});
      nwr["man_made"="storage_tank"]["content"~"^(${storageTerms})$",i]["name"](${bbox});
      nwr["storage"~"^(${storageTerms})$",i]["name"~"${businessTerms}",i](${bbox});
    );out center tags qt;`;
  }

  function splitBounds(bounds) {
    const latMid = (bounds.south + bounds.north) / 2;
    const lonMid = (bounds.west + bounds.east) / 2;
    return [
      { south: bounds.south, west: bounds.west, north: latMid, east: lonMid },
      { south: bounds.south, west: lonMid, north: latMid, east: bounds.east },
      { south: latMid, west: bounds.west, north: bounds.north, east: lonMid },
      { south: latMid, west: lonMid, north: bounds.north, east: bounds.east },
    ];
  }

  function toPlainBounds(bounds) {
    return {
      south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast(),
    };
  }

  async function fetchEndpoint(endpoint, query) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Public map service returned ${response.status}`);
      const text = await response.text();
      if (!text.trim().startsWith('{')) throw new Error('Public map service returned an invalid response');
      return JSON.parse(text);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function fetchTile(bounds, tileIndex) {
    const query = buildQuery(bounds);
    const failures = [];
    for (let attempt = 0; attempt < ENDPOINTS.length; attempt += 1) {
      const endpoint = ENDPOINTS[(tileIndex + attempt) % ENDPOINTS.length];
      try {
        return await fetchEndpoint(endpoint, query);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(failures[failures.length - 1] || 'Public map services did not respond');
  }

  async function searchTiles(tiles, serial) {
    const elements = [];
    const errors = [];
    let nextIndex = 0;
    let completed = 0;
    const workerCount = Math.min(2, tiles.length);

    async function worker() {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= tiles.length) return;
        try {
          const data = await fetchTile(tiles[index], index);
          if (serial !== searchSerial) return;
          elements.push(...(Array.isArray(data.elements) ? data.elements : []));
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        } finally {
          completed += 1;
          if (serial === searchSerial) {
            els.loadingDetail.textContent = tiles.length > 1
              ? `Searched ${completed} of ${tiles.length} map sections. Gas stations are excluded.`
              : 'Checking public distributor and facility records. Gas stations are excluded.';
          }
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { elements, errors };
  }

  async function load() {
    const searchability = currentSearchability();
    if (!searchability.ok || searching) {
      refreshSearchButton();
      return;
    }

    const serial = ++searchSerial;
    const plainBounds = toPlainBounds(searchability.bounds);
    const tiles = searchability.area > TILE_AREA_THRESHOLD ? splitBounds(plainBounds) : [plainBounds];

    records = [];
    layer.clearLayers();
    els.results.innerHTML = '<p class="empty">Searching targeted distributor facilities…</p>';
    els.count.textContent = '0';
    els.states.textContent = '0';
    els.owners.textContent = '0';
    els.resultTitle.textContent = 'Searching…';
    setStatus('Searching public distributor-facility records…');
    setLoading(true, tiles.length > 1
      ? `Searching ${tiles.length} smaller map sections for faster, more reliable results.`
      : 'Fuel distributors, heating oil, bulk plants, terminals and propane only.');

    try {
      const { elements, errors } = await searchTiles(tiles, serial);
      if (serial !== searchSerial) return;
      if (!elements.length && errors.length === tiles.length) {
        throw new Error('The public distributor-data services did not respond');
      }

      records = dedupe(elements.map(normalize).filter(Boolean))
        .sort((a, b) => a.name.localeCompare(b.name));
      render();

      if (errors.length) {
        setStatus(`${records.length.toLocaleString()} targeted facilities loaded. One map section was unavailable; zoom in and retry that area.`, 'error');
      } else if (records.length) {
        setStatus(`${records.length.toLocaleString()} distributor, heating-oil, bulk, terminal and propane facilities loaded.`, 'success');
      } else {
        setStatus('No targeted distributor facilities were found in this area. Gas stations were excluded.');
      }
    } catch (error) {
      if (serial !== searchSerial) return;
      records = [];
      render();
      const message = error instanceof Error ? error.message : String(error);
      setStatus('Search failed — zoom in slightly and try again.', 'error');
      els.results.innerHTML = `<p class="empty"><strong>${esc(message)}.</strong><br>Zoom in slightly and retry. The search no longer requests gas-station records.</p>`;
    } finally {
      if (serial === searchSerial) setLoading(false);
    }
  }

  els.close.addEventListener('click', () => {
    els.details.hidden = true;
    els.workspace.classList.remove('detail-open');
  });

  els.reload.addEventListener('click', load);
  els.filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (!button) return;
    active = button.dataset.type;
    els.filters.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button));
    render();
  });
  els.search.addEventListener('input', () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(render, 160);
  });
  map.on('moveend', () => {
    if (searching) return;
    const { ok } = currentSearchability();
    refreshSearchButton({ preserveStatus: true });
    setStatus(ok
      ? 'Map moved — select “Search this map area” to refresh distributor facilities.'
      : 'Zoom in to a state or small multi-state region to search.');
  });

  refreshSearchButton();
})();
