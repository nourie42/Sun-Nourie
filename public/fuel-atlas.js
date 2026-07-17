(() => {
  "use strict";

  const MIN_SEARCH_ZOOM = 7;
  const MAX_LAT_SPAN = 9;
  const MAX_LON_SPAN = 15;
  const MAX_BBOX_AREA = 110;
  const INITIAL_CENTER = [40.9, -77.7];
  const INITIAL_ZOOM = 8;
  const LIST_LIMIT = 300;
  const REQUIRED_FILTER_VERSION = "verified-distributor-categories-v3";
  const COMPANY_DIRECTORY_TIMEOUT_MS = 15000;
  const COMPANY_EXHAUSTIVE_TIMEOUT_MS = 43000;
  const VALID_TYPES = new Set(["distributor", "heating_oil", "bulk_plant", "terminal", "propane"]);
  const QUALIFYING_NAICS = new Set(["424710", "424720", "454310", "457210"]);
  const RETAIL_NAICS = new Set(["447110", "447190", "457110", "457120"]);
  const TERMINAL_TEXT = /\b(?:marine\s+|rail\s+|pipeline\s+|storage\s+|fuel\s+|oil\s+|petroleum\s+)?terminal\b|\bdepot\b|\btank\s*farm\b/i;
  const BULK_PLANT_TEXT = /\bbulk\s+(?:plant|station|fuel\s+plant|oil\s+plant|petroleum\s+plant)\b/i;
  const PROPANE_TEXT = /\bpropane\b|\blpg\b|liquefied\s+petroleum/i;
  const HEATING_OIL_TEXT = /\bheating[ _-]?oil\b|\bfuel[ _-]?oil\b|\bhome\s+heating\b|\bkerosene\s+(?:dealer|delivery|supplier)\b/i;
  const DISTRIBUTOR_TEXT = /\bdistribut(?:or|ors|ion|ions|ing)?\b|\bwholesal(?:e|er|ers|ing)?\b|\bsupplier\b|\bfuel\s+delivery\b|\bcommercial\s+fuel\b|\bdiesel\s+(?:supplier|delivery|distributor)\b|\bpetroleum\s+products?\b|\blubricant(?:s)?\s+(?:supplier|distributor)\b|\boil\s+(?:co\.?|company)\b|\bfuel\s+(?:co\.?|company)\b|\bpetroleum\s+(?:co\.?|company)\b/i;
  const FUEL_BUSINESS_TEXT = /\b(?:oil|petroleum|petrolite|fuel|diesel|gasoline|kerosene|propane|lpg|lubricant|asphalt|terminal|depot|tank\s*farm|bulk\s+plant|refining|refinery)\b/i;
  const RETAIL_OR_UNRELATED_TEXT = /\b(gas\s+station|service\s+station|filling\s+station|fuel\s+center|travel\s+center|truck\s+stop|travel\s+plaza|truck\s+plaza|convenience|c-?store|food\s+mart|petro\s+mart|mini\s+mart|quick\s+mart|\bmart\b|retail|car\s+wash|oil\s+change|lube\s+shop|quick\s+lube|treatment\s+plant|wastewater|sewage|water\s+treatment|remediation|cleanup|spill\s+site|landfill|power\s+plant|generating\s+station|school|hospital)\b/i;
  const TERMINAL_INDUSTRIAL = /^(fuel_terminal|oil_terminal|tank_farm|oil_storage|petroleum_storage|fuel_storage|depot)$/i;
  const CORPORATE_QUERY_TEXT = /\b(fuel|fuels|oil|petroleum|energy|energies|propane|lubricant|distribut(?:or|ion|ing)?|marketer|marketing|jobber|wholesale|supplier|supply|company|co\.?|corp\.?|corporation|inc\.?|llc|l\.p\.|services|resources|logistics|cooperative)\b/i;
  const CORPORATE_RESULT_REJECT = /gas_station|service_station|convenience_store|retail_location|store_location|travel_center|truck_stop|map_listing/i;
  const CORPORATE_SOURCE_REJECT = /openstreetmap|google places|amenity\s*\/\s*fuel|amenity=fuel/i;
  const STREET_TEXT = /\b(street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|highway|hwy\.?|route|drive|dr\.?|lane|ln\.?|court|ct\.?)\b/i;
  const STATE_NAMES = new Set([
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
    "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
    "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri",
    "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
    "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west virginia", "wisconsin", "wyoming", "district of columbia",
  ]);
  const STATE_ABBREVIATIONS = new Set([
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks",
    "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny",
    "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
    "wi", "wy", "dc",
  ]);

  const els = {
    workspace: document.getElementById("workspace"),
    placeForm: document.getElementById("placeForm"),
    placeSearch: document.getElementById("placeSearch"),
    placeButton: document.getElementById("placeButton"),
    filters: document.getElementById("filters"),
    results: document.getElementById("results"),
    count: document.getElementById("count"),
    states: document.getElementById("states"),
    owners: document.getElementById("owners"),
    status: document.getElementById("status"),
    reload: document.getElementById("reload"),
    locate: document.getElementById("locate"),
    resetView: document.getElementById("resetView"),
    details: document.getElementById("details"),
    detailBody: document.getElementById("detailBody"),
    close: document.getElementById("close"),
    resultTitle: document.getElementById("resultTitle"),
    searchHelp: document.getElementById("searchHelp"),
    loadingOverlay: document.getElementById("loadingOverlay"),
    loadingTitle: document.getElementById("loadingTitle"),
    loadingDetail: document.getElementById("loadingDetail"),
  };

  if (typeof L === "undefined" || !document.getElementById("map")) {
    if (els.status) els.status.textContent = "Map library failed to load. Refresh the page.";
    return;
  }

  els.placeSearch.placeholder = "Find any distributor company, city/state, or ZIP";
  els.placeSearch.setAttribute("aria-label", "Find any distributor company, city, state, ZIP code, or address");

  const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView(INITIAL_CENTER, INITIAL_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);
  let records = [];
  let activeType = "all";
  let textFilter = "";
  let loading = false;
  let globalSearchActive = false;
  let requestSequence = 0;
  let searchSequence = 0;
  let filterTimer = null;
  let pinnedCompanyRecord = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  function setStatus(message, tone = "neutral") {
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  }

  function setLoadingOverlay(visible, title = "", detail = "") {
    if (!els.loadingOverlay) return;
    if (title && els.loadingTitle) els.loadingTitle.textContent = title;
    if (detail && els.loadingDetail) els.loadingDetail.textContent = detail;
    els.loadingOverlay.hidden = !visible;
    els.loadingOverlay.setAttribute("aria-busy", visible ? "true" : "false");
  }

  function parseNaicsCodes(value) {
    return [...new Set((String(value || "").match(/\b\d{6}\b/g) || []))];
  }

  function tagText(tags = {}) {
    return [
      tags.name, tags.operator, tags["operator:name"], tags.owner, tags["owner:name"], tags.brand,
      tags.description, tags.product, tags.products, tags.content, tags.substance, tags.storage,
      tags.shop, tags.industrial, tags.office, tags.landuse, tags.building,
      tags["fuel_iq:qualification"], tags["fuel_iq:classification_basis"],
    ].filter(Boolean).join(" ");
  }

  function explicitRolePresent(tags = {}) {
    const text = tagText(tags);
    return TERMINAL_TEXT.test(text)
      || BULK_PLANT_TEXT.test(text)
      || PROPANE_TEXT.test(text)
      || HEATING_OIL_TEXT.test(text)
      || DISTRIBUTOR_TEXT.test(text);
  }

  function isClearlyRetailOrUnrelated(tags = {}) {
    const amenity = String(tags.amenity || "").toLowerCase();
    const shop = String(tags.shop || "").toLowerCase();
    const codes = parseNaicsCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
    if (amenity === "fuel") return true;
    if (["fuel", "gas", "convenience", "supermarket"].includes(shop)) return true;
    if (codes.some((code) => RETAIL_NAICS.has(code)) && !TERMINAL_TEXT.test(tagText(tags)) && !BULK_PLANT_TEXT.test(tagText(tags))) return true;
    return RETAIL_OR_UNRELATED_TEXT.test(tagText(tags));
  }

  function isQualifiedFacility(tags = {}) {
    if (isClearlyRetailOrUnrelated(tags)) return false;
    const codes = parseNaicsCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
    if (codes.length) {
      if (!codes.some((code) => QUALIFYING_NAICS.has(code))) return false;
      return FUEL_BUSINESS_TEXT.test(tagText(tags)) || explicitRolePresent(tags);
    }
    return Boolean(tags.name || tags.operator || tags["operator:name"] || tags.owner || tags["owner:name"])
      && explicitRolePresent(tags);
  }

  function typeLabel(type) {
    return ({
      distributor: "Fuel distributor",
      heating_oil: "Heating oil dealer",
      bulk_plant: "Bulk plant",
      terminal: "Terminal / depot",
      propane: "Propane dealer",
    })[type] || "Fuel distributor";
  }

  function typeColor(type) {
    return ({
      distributor: "#1976a8",
      heating_oil: "#e48b24",
      bulk_plant: "#6f55aa",
      terminal: "#c83d4f",
      propane: "#18805d",
    })[type] || "#1976a8";
  }

  function classify(tags = {}) {
    const explicit = String(tags["fuel_iq:facility_type"] || "").toLowerCase();
    if (VALID_TYPES.has(explicit)) return explicit;

    const text = tagText(tags);
    const industrial = String(tags.industrial || "");
    const codes = parseNaicsCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
    if (TERMINAL_INDUSTRIAL.test(industrial) || TERMINAL_TEXT.test(text)) return "terminal";
    if (industrial === "bulk_plant" || BULK_PLANT_TEXT.test(text)) return "bulk_plant";
    if (PROPANE_TEXT.test(text)) return "propane";
    if (String(tags.shop || "").toLowerCase() === "heating_oil" || HEATING_OIL_TEXT.test(text)) return "heating_oil";
    if (DISTRIBUTOR_TEXT.test(text) || codes.includes("424720") || codes.includes("454310") || codes.includes("457210")) return "distributor";
    return "distributor";
  }

  function parseCategories(tags, primaryType) {
    const supplied = String(tags["fuel_iq:categories"] || "")
      .split(",").map((item) => item.trim()).filter((item) => VALID_TYPES.has(item));
    const values = supplied.length ? supplied : (primaryType === "heating_oil" || primaryType === "propane"
      ? ["distributor", primaryType]
      : [primaryType]);
    return [...new Set(values)];
  }

  function addressLine(tags) {
    return [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || tags["addr:full"] || "";
  }

  function sourceUrl(element, lat, lon) {
    if (element.source_url) return element.source_url;
    if (element.type === "corporate") return "/distributors.html";
    if (["node", "way", "relation"].includes(element.type) && element.id) {
      return `https://www.openstreetmap.org/${element.type}/${element.id}`;
    }
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
  }

  function normalize(element) {
    const tags = element.tags || {};
    if (!isQualifiedFacility(tags)) return null;
    const center = element.center || element;
    const lat = Number(center.lat);
    const lon = Number(center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const primaryType = classify(tags);
    const categories = parseCategories(tags, primaryType);
    const owner = tags.owner || tags["owner:name"] || "";
    const operator = tags.operator || tags["operator:name"] || "";
    const name = tags.name || operator || owner || "Verified fuel distribution facility";
    return {
      id: `${element.type || "feature"}-${element.id || `${lat}-${lon}`}`,
      name,
      owner,
      operator,
      phone: tags.phone || tags["contact:phone"] || tags["contact:mobile"] || "",
      email: tags.email || tags["contact:email"] || "",
      website: tags.website || tags["contact:website"] || tags.url || "",
      street: addressLine(tags),
      city: tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || tags["addr:hamlet"] || "",
      state: tags["addr:state"] || "",
      zip: tags["addr:postcode"] || "",
      headquarters: tags["fuel_iq:headquarters"] || "",
      aliases: tags["fuel_iq:aliases"] || "",
      parentCompany: tags["fuel_iq:parent_company"] || "",
      locationPrecision: tags["fuel_iq:location_precision"] || "",
      corporateMatch: element.type === "corporate" || String(tags["fuel_iq:company_search_result"] || "") === "true",
      qualification: tags["fuel_iq:qualification"] || "Explicit public distributor or bulk-facility role",
      classificationBasis: tags["fuel_iq:classification_basis"] || "Explicit public distributor or facility role",
      naics: tags["fuel_iq:naics_codes"] || "",
      sourceName: element.source_name || tags["fuel_iq:source"] || "OpenStreetMap public facility data",
      lat,
      lon,
      type: primaryType,
      categories,
      sourceUrl: sourceUrl(element, lat, lon),
      tags,
    };
  }

  function visibleRecords() {
    const query = textFilter.trim().toLowerCase();
    return records.filter((record) => {
      if (activeType !== "all" && !record.categories.includes(activeType)) return false;
      if (!query) return true;
      return [
        record.name, record.owner, record.operator, record.street, record.city,
        record.state, record.zip, record.naics, record.classificationBasis,
        record.headquarters, record.aliases, record.parentCompany,
      ].join(" ").toLowerCase().includes(query);
    });
  }

  function normalizeLink(value) {
    if (!value) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    return `https://${value}`;
  }

  function detailRow(name, value, link = "") {
    if (!value) return `<div class="detail-row"><label>${escapeHtml(name)}</label><span class="empty">Not publicly listed</span></div>`;
    return `<div class="detail-row"><label>${escapeHtml(name)}</label>${link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
      : `<span>${escapeHtml(value)}</span>`}</div>`;
  }

  function openDetails(record) {
    els.details.hidden = false;
    els.workspace.classList.add("detail-open");
    const locality = [record.city, record.state].filter(Boolean).join(", ");
    const fullAddress = [record.street, locality, record.zip].filter(Boolean).join(" ");
    const categoryText = record.categories.map(typeLabel).join(", ");
    const displayedLocation = record.corporateMatch
      ? (record.headquarters || fullAddress || "Headquarters will be confirmed during distributor research")
      : (fullAddress || "Address not publicly supplied");
    const badge = record.corporateMatch ? "Corporate distributor match" : typeLabel(record.type);
    const classificationHeading = record.corporateMatch ? "How this company was found" : "How this location is classified";
    const corporateNotice = record.corporateMatch
      ? `<div class="detail-block"><h3>Map precision</h3><p class="empty">This company was found with the same nationwide corporate lookup used by Distributor Intelligence. The marker is positioned from public headquarters or operating-area information and is not automatically a verified bulk plant, terminal, or exact facility footprint.</p>${detailRow("Location precision", record.locationPrecision)}</div>`
      : "";

    els.detailBody.innerHTML = `
      <span class="badge">${escapeHtml(badge)}</span>
      <h2>${escapeHtml(record.name)}</h2>
      <div class="address">${escapeHtml(displayedLocation)}</div>
      ${corporateNotice}
      <div class="detail-block"><h3>${escapeHtml(classificationHeading)}</h3>
        ${detailRow("Primary type", typeLabel(record.type))}
        ${detailRow("Included filters", categoryText)}
        ${detailRow("Classification basis", record.classificationBasis)}
        ${detailRow("Qualification", record.qualification)}
        ${detailRow("NAICS codes", record.naics)}
      </div>
      <div class="detail-block"><h3>Ownership and operation</h3>
        ${detailRow("Legal owner", record.owner)}
        ${detailRow("Operating entity", record.operator)}
        ${detailRow("Parent company", record.parentCompany)}
        ${detailRow("Known aliases", record.aliases)}
      </div>
      <div class="detail-block"><h3>Public business contact</h3>
        ${detailRow("Phone", record.phone, record.phone ? `tel:${record.phone}` : "")}
        ${detailRow("Email", record.email, record.email ? `mailto:${record.email}` : "")}
        ${detailRow("Website", record.website, record.website ? normalizeLink(record.website) : "")}
      </div>
      <div class="detail-block"><h3>Source</h3>
        <p class="empty">${escapeHtml(record.corporateMatch
          ? `${record.sourceName}. Fuel IQ used the corporate company result only to navigate nationwide; nearby map facilities remain separately sourced and classified.`
          : `${record.sourceName}. NAICS qualifies a record for the directory; explicit facility wording determines whether it is a distributor, bulk plant, terminal, heating-oil dealer or propane dealer.`)}</p>
        <a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source record</a>
      </div>`;
  }

  function countsFor(items) {
    const counts = { distributor: 0, heating_oil: 0, bulk_plant: 0, terminal: 0, propane: 0 };
    for (const item of items) for (const category of item.categories) counts[category] += 1;
    return counts;
  }

  function render() {
    const items = visibleRecords();
    const corporateCount = items.filter((item) => item.corporateMatch).length;
    markerLayer.clearLayers();
    els.results.innerHTML = "";
    els.count.textContent = items.length.toLocaleString();
    els.states.textContent = new Set(items.map((item) => item.state).filter(Boolean)).size.toLocaleString();
    els.owners.textContent = items.filter((item) => item.owner).length.toLocaleString();
    els.resultTitle.textContent = corporateCount
      ? `${items.length.toLocaleString()} map results · ${corporateCount.toLocaleString()} company match${corporateCount === 1 ? "" : "es"}`
      : `${items.length.toLocaleString()} verified locations`;

    if (!items.length) {
      els.results.innerHTML = records.length
        ? '<p class="empty">No loaded locations match this filter. Facility categories are based on explicit wording; NAICS alone does not make a location a bulk plant or terminal.</p>'
        : '<p class="empty">No verified fuel-distribution records were returned for this exact area.</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((record, index) => {
      L.circleMarker([record.lat, record.lon], {
        radius: record.corporateMatch ? 9 : 6,
        color: record.corporateMatch ? "#f4b942" : "#ffffff",
        weight: record.corporateMatch ? 3 : 1.5,
        fillColor: typeColor(record.type),
        fillOpacity: 0.92,
        title: record.name,
      }).on("click", () => openDetails(record)).addTo(markerLayer);

      if (index >= LIST_LIMIT) return;
      const button = document.createElement("button");
      button.className = "result";
      button.type = "button";
      const locality = record.headquarters || [record.city, record.state].filter(Boolean).join(", ") || record.street || "Address not supplied";
      const descriptor = record.corporateMatch ? "Corporate distributor match" : typeLabel(record.type);
      button.innerHTML = `<strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(descriptor)} · ${escapeHtml(locality)}</span>`;
      button.addEventListener("click", () => {
        map.setView([record.lat, record.lon], Math.max(map.getZoom(), record.corporateMatch ? 11 : 14));
        openDetails(record);
      });
      fragment.appendChild(button);
    });
    els.results.appendChild(fragment);

    if (items.length > LIST_LIMIT) {
      const note = document.createElement("p");
      note.className = "empty result-limit";
      note.textContent = `Showing the first ${LIST_LIMIT.toLocaleString()} names; all ${items.length.toLocaleString()} points remain on the map.`;
      els.results.appendChild(note);
    }
  }

  function currentSearchReadiness() {
    const bounds = map.getBounds();
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lonSpan = bounds.getEast() - bounds.getWest();
    const area = latSpan * lonSpan;
    const ready = map.getZoom() >= MIN_SEARCH_ZOOM && latSpan <= MAX_LAT_SPAN && lonSpan <= MAX_LON_SPAN && area <= MAX_BBOX_AREA;
    return { ready, bounds, latSpan, lonSpan, area };
  }

  function updateSearchButton() {
    if (loading || globalSearchActive) return;
    const readiness = currentSearchReadiness();
    els.reload.textContent = readiness.ready ? "Search this map area" : "Zoom in to search";
    els.reload.classList.toggle("needs-zoom", !readiness.ready);
    els.searchHelp.textContent = readiness.ready
      ? "Ready to browse this map area. Company-name searches above are nationwide and use the Distributor Intelligence corporate lookup."
      : `Company-name searches above work nationwide. Area searches require zoom ${MIN_SEARCH_ZOOM} or closer.`;
  }

  async function fetchJson(url, timeoutMs = 40000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) {
        const error = new Error(payload?.message || `Request failed with HTTP ${response.status}`);
        error.code = payload?.code || "REQUEST_FAILED";
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function showAreaTooLarge() {
    setLoadingOverlay(false);
    setStatus("Choose a city/state or zoom in before searching this map area.", "warning");
    els.results.innerHTML = `<p class="empty"><strong>This map view is too large for a dependable detailed area search.</strong><br>Enter any distributor company above for a nationwide lookup, enter a city/state/ZIP, or zoom to level ${MIN_SEARCH_ZOOM}+.</p>`;
    els.placeSearch.focus();
  }

  function normalizedName(value) {
    return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function mergePinnedCompany(items) {
    if (!pinnedCompanyRecord) return items;
    const pinnedName = normalizedName(pinnedCompanyRecord.name);
    const nearbyDuplicate = (item) => normalizedName(item.name) === pinnedName
      && Math.abs(item.lat - pinnedCompanyRecord.lat) < 0.2
      && Math.abs(item.lon - pinnedCompanyRecord.lon) < 0.2;
    return [pinnedCompanyRecord, ...items.filter((item) => item.id !== pinnedCompanyRecord.id && !nearbyDuplicate(item))];
  }

  async function loadArea({ fitResults = false } = {}) {
    if (loading) return;
    const readiness = currentSearchReadiness();
    if (!readiness.ready) {
      showAreaTooLarge();
      updateSearchButton();
      return;
    }

    const requestId = ++requestSequence;
    const bounds = readiness.bounds;
    const params = new URLSearchParams({
      south: bounds.getSouth().toFixed(5),
      west: bounds.getWest().toFixed(5),
      north: bounds.getNorth().toFixed(5),
      east: bounds.getEast().toFixed(5),
      zoom: String(map.getZoom()),
      v: REQUIRED_FILTER_VERSION,
    });

    loading = true;
    for (const button of [els.reload, els.placeButton, els.locate, els.resetView]) button.disabled = true;
    els.reload.textContent = "Searching…";
    records = pinnedCompanyRecord ? [pinnedCompanyRecord] : [];
    textFilter = "";
    markerLayer.clearLayers();
    els.count.textContent = records.length.toLocaleString();
    els.states.textContent = new Set(records.map((item) => item.state).filter(Boolean)).size.toLocaleString();
    els.owners.textContent = records.filter((item) => item.owner).length.toLocaleString();
    els.resultTitle.textContent = pinnedCompanyRecord ? "Company found · loading nearby facilities…" : "Searching…";
    els.results.innerHTML = '<p class="empty">Searching verified distributor and facility records…</p>';
    setLoadingOverlay(
      true,
      pinnedCompanyRecord ? `Loading facilities near ${pinnedCompanyRecord.name}…` : "Searching verified distributor locations…",
      pinnedCompanyRecord
        ? "The company match is nationwide. Nearby facility records are now being loaded separately from public map and regulatory sources."
        : "Separating distributors and fuel dealers from explicitly named bulk plants and terminals. Ordinary gas stations are excluded.",
    );
    setStatus(pinnedCompanyRecord
      ? `Found ${pinnedCompanyRecord.name}; searching nearby verified facilities…`
      : "Searching verified distributors, fuel dealers, bulk plants and terminals…", "loading");

    try {
      const payload = await fetchJson(`/api/fuel-atlas/search?${params.toString()}`);
      if (requestId !== requestSequence) return;
      if (payload?.filterVersion !== REQUIRED_FILTER_VERSION) {
        throw new Error("The server is still deploying the corrected facility-classification version. Refresh shortly.");
      }

      const seen = new Set();
      const loadedRecords = (payload?.elements || [])
        .map(normalize)
        .filter((record) => record && !seen.has(record.id) && seen.add(record.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      records = mergePinnedCompany(loadedRecords);
      render();

      if (fitResults && records.length) {
        const resultBounds = L.latLngBounds(records.map((record) => [record.lat, record.lon]));
        if (resultBounds.isValid()) map.fitBounds(resultBounds.pad(0.12), { maxZoom: 12 });
      }

      const facilityRecords = records.filter((record) => !record.corporateMatch);
      const counts = countsFor(facilityRecords);
      const suffix = payload?.cached ? " (cached)" : "";
      const partial = payload?.partial ? " One public source was unavailable; verified results from completed sources are shown." : "";
      const companyPrefix = pinnedCompanyRecord ? `${pinnedCompanyRecord.name} found nationwide. ` : "";
      setStatus(
        `${companyPrefix}${facilityRecords.length.toLocaleString()} nearby verified facilities loaded${suffix}: ${counts.distributor.toLocaleString()} distributors/dealers, ${counts.bulk_plant.toLocaleString()} bulk plants, ${counts.terminal.toLocaleString()} terminals, ${counts.heating_oil.toLocaleString()} heating-oil and ${counts.propane.toLocaleString()} propane.${partial}`,
        payload?.partial ? "warning" : "success",
      );
    } catch (error) {
      if (requestId !== requestSequence) return;
      records = pinnedCompanyRecord ? [pinnedCompanyRecord] : [];
      render();
      if (pinnedCompanyRecord) {
        setStatus(`${pinnedCompanyRecord.name} was found with the nationwide company lookup, but nearby facility sources could not be loaded.`, "warning");
        els.results.insertAdjacentHTML("beforeend", '<p class="empty">The corporate company match remains available above. Retry the map area to load nearby physical facilities.</p>');
      } else if (error?.name === "AbortError") {
        setStatus("Search timed out. Retry this area.", "error");
        els.results.innerHTML = '<p class="empty">The verified distributor sources took too long to respond. Retry this area.</p>';
      } else if (error?.code === "AREA_TOO_LARGE") {
        showAreaTooLarge();
      } else {
        setStatus(error?.message || "Search failed. Retry this area.", "error");
        els.results.innerHTML = `<p class="empty"><strong>Search could not be completed.</strong><br>${escapeHtml(error?.message || "A verified public source may be temporarily busy.")}</p>`;
      }
    } finally {
      if (requestId === requestSequence) {
        loading = false;
        for (const button of [els.reload, els.placeButton, els.locate, els.resetView]) button.disabled = false;
        setLoadingOverlay(false);
        updateSearchButton();
      }
    }
  }

  function geocodeResult(payload) {
    const result = payload?.result;
    if (!result || !Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lon))) {
      throw new Error("No matching U.S. location was found.");
    }
    return result;
  }

  async function geocodeQuery(query, timeoutMs = 30000) {
    return geocodeResult(await fetchJson(`/api/fuel-atlas/geocode?q=${encodeURIComponent(query)}`, timeoutMs));
  }

  async function focusPlace(query, result = null) {
    const value = String(query || "").trim();
    if (value.length < 2) throw new Error("Enter a city, state, ZIP code, address, or distributor company.");
    const place = result || await geocodeQuery(value);
    pinnedCompanyRecord = null;
    map.setView([Number(place.lat), Number(place.lon)], 10);
    els.placeSearch.value = place.label || value;
    setStatus(`Searching around ${place.label || value}…`, "loading");
    await loadArea();
    return true;
  }

  function isCorporateCandidate(item) {
    if (!item || typeof item !== "object") return false;
    const name = String(item.legal_name || item.name || "").trim();
    const type = String(item.entity_type || "").toLowerCase();
    const source = String(item.source || "").toLowerCase();
    if (!name || CORPORATE_RESULT_REJECT.test(type) || CORPORATE_SOURCE_REJECT.test(source)) return false;
    return true;
  }

  async function companyCandidates(query, mode) {
    const timeoutMs = mode === "directory" ? COMPANY_DIRECTORY_TIMEOUT_MS : COMPANY_EXHAUSTIVE_TIMEOUT_MS;
    const params = new URLSearchParams({ q: query, location: "", mode });
    const payload = await fetchJson(`/api/distributors/search?${params.toString()}`, timeoutMs);
    if (payload?.ok !== true) throw new Error(payload?.message || "Corporate distributor search failed.");
    return (Array.isArray(payload.candidates) ? payload.candidates : []).filter(isCorporateCandidate);
  }

  function looksLikeLocationOnlyQuery(value) {
    const query = String(value || "").trim();
    const normalized = query.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    if (/^\d{5}(?:-\d{4})?$/.test(normalized)) return true;
    if (STATE_NAMES.has(normalized) || STATE_ABBREVIATIONS.has(normalized)) return true;
    if (/^\d+\s+/.test(normalized) && STREET_TEXT.test(normalized)) return true;

    const commaParts = query.split(",").map((part) => part.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      const tail = commaParts.at(-1).toLowerCase().replace(/[^a-z]/g, " ").replace(/\s+/g, " ").trim();
      if ((STATE_NAMES.has(tail) || STATE_ABBREVIATIONS.has(tail)) && !CORPORATE_QUERY_TEXT.test(commaParts[0])) return true;
    }

    if (CORPORATE_QUERY_TEXT.test(normalized)) return false;
    return true;
  }

  function headquartersParts(value) {
    const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return { city: parts[0] || "", state: "" };
    return { city: parts.slice(0, -1).join(", "), state: parts.at(-1) };
  }

  function corporateElement(candidate, result) {
    const name = String(candidate.legal_name || candidate.name || "Corporate distributor match").trim();
    const headquarters = String(candidate.headquarters || result.label || "").trim();
    const { city, state } = headquartersParts(headquarters);
    const aliases = Array.isArray(candidate.aliases) ? candidate.aliases.filter(Boolean).join(", ") : String(candidate.aliases || "");
    const sourceName = String(candidate.source || "Fuel IQ corporate distributor search");
    const website = String(candidate.website || "");
    const sourceUrl = String(candidate.source_url || website || "/distributors.html");
    const lat = Number(result.lat);
    const lon = Number(result.lon);
    const id = normalizedName(name).replace(/\s+/g, "-") || `${lat}-${lon}`;
    return {
      type: "corporate",
      id,
      lat,
      lon,
      source_name: sourceName,
      source_url: sourceUrl,
      tags: {
        name,
        office: "company",
        website,
        description: String(candidate.description || "Corporate fuel distributor or petroleum marketer returned by the Fuel IQ company lookup."),
        owner: "",
        "addr:city": city,
        "addr:state": state,
        "fuel_iq:facility_type": "distributor",
        "fuel_iq:categories": "distributor",
        "fuel_iq:classification_basis": "Corporate distributor match from the same Fuel IQ lookup used by Distributor Intelligence",
        "fuel_iq:qualification": "Verified corporate distributor name; headquarters or operating area geocoded for nationwide map navigation",
        "fuel_iq:source": sourceName,
        "fuel_iq:company_search_result": "true",
        "fuel_iq:headquarters": headquarters,
        "fuel_iq:aliases": aliases,
        "fuel_iq:parent_company": String(candidate.parent_company || ""),
        "fuel_iq:location_precision": result.label && headquarters && result.label !== headquarters
          ? `Geocoded near ${result.label}; corporate headquarters returned as ${headquarters}`
          : "Public headquarters or operating-area geocode; verify an exact street address before site-level diligence",
      },
    };
  }

  async function locateCompany(candidate) {
    const name = String(candidate.legal_name || candidate.name || "").trim();
    const headquarters = String(candidate.headquarters || "").trim();
    const attempts = [...new Set([
      [name, headquarters].filter(Boolean).join(", "),
      headquarters,
      name,
    ].map((value) => value.trim()).filter(Boolean))];

    setLoadingOverlay(true, `Locating ${name}…`, "Fuel IQ found the corporate distributor nationwide and is positioning the map from its public headquarters or operating area.");
    setStatus(`Locating ${name}…`, "loading");

    let result = null;
    let lastError = null;
    for (const attempt of attempts) {
      try {
        result = await geocodeQuery(attempt, 30000);
        if (result) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!result) throw lastError || new Error(`Fuel IQ found ${name}, but its headquarters could not be mapped.`);

    const record = normalize(corporateElement(candidate, result));
    if (!record) throw new Error(`Fuel IQ found ${name}, but could not build a safe corporate map result.`);
    pinnedCompanyRecord = record;
    textFilter = "";
    els.placeSearch.value = name;
    map.setView([record.lat, record.lon], 11);
    await loadArea();
    map.setView([record.lat, record.lon], Math.max(map.getZoom(), 11));
    openDetails(record);
  }

  async function findCompanyOrPlace(query) {
    const value = String(query || "").trim();
    if (value.length < 2) {
      setStatus("Enter a city, state, ZIP code, address, or distributor company.", "warning");
      els.placeSearch.focus();
      return;
    }

    const priorRecords = records;
    const priorPinnedCompany = pinnedCompanyRecord;
    const thisSearch = ++searchSequence;
    globalSearchActive = true;
    pinnedCompanyRecord = null;
    for (const button of [els.placeButton, els.reload, els.locate, els.resetView]) button.disabled = true;
    setLoadingOverlay(true, "Searching nationwide distributor companies…", `Checking the same Fuel IQ corporate distributor index used by Distributor Intelligence for “${value}”.`);
    setStatus(`Searching nationwide for ${value}…`, "loading");

    let directoryError = null;
    try {
      try {
        const directory = await companyCandidates(value, "directory");
        if (thisSearch !== searchSequence) return;
        if (directory.length) {
          await locateCompany(directory[0]);
          return;
        }
      } catch (error) {
        directoryError = error;
      }

      let placeResult = null;
      let placeError = null;
      const locationFirst = looksLikeLocationOnlyQuery(value);
      if (locationFirst) {
        setLoadingOverlay(true, `Finding ${value}…`, "No indexed company name matched, so Fuel IQ is checking the U.S. place search before running a live corporate lookup.");
        try { placeResult = await geocodeQuery(value, 30000); }
        catch (error) { placeError = error; }
        if (thisSearch !== searchSequence) return;
        if (placeResult) {
          await focusPlace(value, placeResult);
          return;
        }
      }

      setLoadingOverlay(true, "Checking live corporate sources…", `No indexed company matched “${value}”. Fuel IQ is checking aliases, DBAs, parent companies, and current public corporate sources.`);
      setStatus(`Checking live corporate sources for ${value}…`, "loading");
      let exhaustive = [];
      let exhaustiveError = null;
      try { exhaustive = await companyCandidates(value, "exhaustive"); }
      catch (error) { exhaustiveError = error; }
      if (thisSearch !== searchSequence) return;
      if (exhaustive.length) {
        await locateCompany(exhaustive[0]);
        return;
      }

      if (!locationFirst) {
        setLoadingOverlay(true, `Finding ${value}…`, "No corporate distributor was verified, so Fuel IQ is checking whether the text is a U.S. city, state, ZIP code, or address.");
        try { placeResult = await geocodeQuery(value, 30000); }
        catch (error) { placeError = error; }
        if (thisSearch !== searchSequence) return;
        if (placeResult) {
          await focusPlace(value, placeResult);
          return;
        }
      }

      const detail = exhaustiveError?.name === "AbortError" || directoryError?.name === "AbortError"
        ? "The corporate lookup timed out and no matching U.S. place was found. Try the legal name, DBA, parent company, city, or state."
        : (placeError?.message || exhaustiveError?.message || directoryError?.message || "No matching distributor company or U.S. place was found.");
      throw new Error(detail);
    } catch (error) {
      if (thisSearch !== searchSequence) return;
      pinnedCompanyRecord = priorPinnedCompany;
      records = priorRecords;
      textFilter = "";
      render();
      setStatus(error?.message || "Search could not be completed.", "error");
      els.results.insertAdjacentHTML("afterbegin", `<p class="empty"><strong>No company or place match was found.</strong><br>${escapeHtml(error?.message || "Try the legal company name, DBA, parent company, city, state, ZIP code, or address.")}</p>`);
    } finally {
      if (thisSearch === searchSequence) {
        globalSearchActive = false;
        for (const button of [els.placeButton, els.reload, els.locate, els.resetView]) button.disabled = false;
        if (!loading) setLoadingOverlay(false);
        updateSearchButton();
      }
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("Location access is not supported by this browser.", "error");
      return;
    }
    searchSequence += 1;
    globalSearchActive = false;
    pinnedCompanyRecord = null;
    els.locate.disabled = true;
    setLoadingOverlay(true, "Finding your location…", "Your location is used only to position this distributor search.");
    setStatus("Requesting your location…", "loading");
    navigator.geolocation.getCurrentPosition(async (position) => {
      map.setView([position.coords.latitude, position.coords.longitude], 10);
      els.locate.disabled = false;
      await loadArea();
    }, (error) => {
      els.locate.disabled = false;
      setLoadingOverlay(false);
      setStatus(error.code === error.PERMISSION_DENIED
        ? "Location permission was declined. Search a city or state instead."
        : "Your location could not be determined.", "error");
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
  }

  els.close.addEventListener("click", () => {
    els.details.hidden = true;
    els.workspace.classList.remove("detail-open");
  });

  els.reload.addEventListener("click", () => {
    pinnedCompanyRecord = null;
    searchSequence += 1;
    loadArea();
  });
  els.locate.addEventListener("click", useCurrentLocation);
  els.resetView.addEventListener("click", () => {
    requestSequence += 1;
    searchSequence += 1;
    loading = false;
    globalSearchActive = false;
    pinnedCompanyRecord = null;
    setLoadingOverlay(false);
    map.setView([39.8283, -98.5795], 4);
    records = [];
    render();
    showAreaTooLarge();
    updateSearchButton();
  });

  els.filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    activeType = button.dataset.type;
    els.filters.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });

  els.placeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = els.placeSearch.value.trim();
    const normalizedQuery = normalizedName(query);
    const localMatches = records.filter((record) => {
      const names = [record.name, record.owner, record.operator, record.aliases, record.parentCompany]
        .map(normalizedName).filter(Boolean);
      return normalizedQuery && names.some((name) => name === normalizedQuery || name.startsWith(`${normalizedQuery} `));
    });
    if (query && localMatches.length) {
      const first = localMatches[0];
      map.setView([first.lat, first.lon], first.corporateMatch ? 11 : 14);
      openDetails(first);
      return;
    }
    await findCompanyOrPlace(query);
  });

  els.placeSearch.addEventListener("input", () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      textFilter = els.placeSearch.value.trim();
      if (records.length) render();
    }, 180);
  });

  map.on("moveend zoomend", () => {
    updateSearchButton();
    if (!loading && !globalSearchActive) {
      const readiness = currentSearchReadiness();
      setStatus(
        readiness.ready
          ? "Map moved—search this area to refresh corrected facility categories. Company-name searches above remain nationwide."
          : `Company-name searches work nationwide; area browsing requires zoom ${MIN_SEARCH_ZOOM}+ or a city/state search.`,
        readiness.ready ? "neutral" : "warning",
      );
    }
  });

  updateSearchButton();
  setStatus("Loading the starting verified distributor region…", "loading");
  window.setTimeout(() => loadArea(), 100);
})();
