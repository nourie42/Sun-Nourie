(() => {
  "use strict";

  const MIN_SEARCH_ZOOM = 7;
  const MAX_LAT_SPAN = 9;
  const MAX_LON_SPAN = 15;
  const MAX_BBOX_AREA = 110;
  const INITIAL_CENTER = [40.9, -77.7];
  const INITIAL_ZOOM = 8;
  const LIST_LIMIT = 350;
  const REQUIRED_BUILD_ID = "2026-07-17-naics-bbox-v4";
  const TARGET_NAICS = new Set(["424710", "424720", "454310", "454311", "454312", "454319", "457210", "486110", "486910"]);
  const TARGET_SIC = new Set(["5171", "5172", "5983", "5984"]);
  const RETAIL_NAICS = new Set(["447110", "447190", "457110", "457120"]);
  const RETAIL_SIC = new Set(["5541"]);
  const STRONG_ROLE_TEXT = /\b(heating[ _-]?oil|fuel[ _-]?oil|propane|\blpg\b|bulk[ _-]?(plant|station|terminal)|tank[ _-]?farm|storage[ _-]?terminal|petroleum[ _-]?terminal|fuel[ _-]?terminal|oil[ _-]?terminal|fuel[ _-]?depot|oil[ _-]?depot|fuel[ _-]?(distribut|wholesal)|petroleum[ _-]?(distribut|wholesal)|oil[ _-]?(company|co\.?|distribut|wholesal)|pipeline[ _-]?terminal)\b/i;
  const REJECT_TEXT = /\b(gas station|service station|filling station|fuel center|fuel centre|travel center|travel centre|truck stop|convenience store|food mart|mini mart|quick stop|petro mart|gas mart|c-store|car wash|oil change|quick lube|lube shop|treatment plant|wastewater|sewage|landfill)\b/i;
  const RETAIL_BRAND_ONLY = /^(shell|bp|exxon|mobil|exxonmobil|sunoco|marathon|citgo|valero|chevron|gulf|speedway|circle k|wawa|sheetz|7[- ]?eleven|murphy|murphy usa|costco|sam'?s club|pilot|flying j|love'?s)(?:\s*#?\s*\d+)?$/i;

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
  let requestSequence = 0;
  let filterTimer = null;

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

  function parseCodes(value) {
    return [...new Set((String(value || "").match(/\b\d{4,6}\b/g) || []))];
  }

  function tagText(tags = {}) {
    return [
      tags.name, tags.operator, tags["operator:name"], tags.owner, tags["owner:name"], tags.brand,
      tags.description, tags.product, tags.products, tags.content, tags.substance, tags.storage,
      tags.shop, tags.industrial, tags.office, tags.landuse, tags.building, tags["fuel_iq:evidence"],
    ].filter(Boolean).join(" ");
  }

  function isClearlyRetailOrUnrelated(tags = {}) {
    const amenity = String(tags.amenity || "").toLowerCase();
    const shop = String(tags.shop || "").toLowerCase();
    const name = String(tags.name || tags.operator || tags.brand || "").trim();
    const naics = parseCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
    const sic = parseCodes(tags["fuel_iq:sic_codes"] || tags.sic || tags["sic:code"]);
    if (amenity === "fuel") return true;
    if (["fuel", "gas", "convenience", "supermarket"].includes(shop)) return true;
    if (naics.some((code) => RETAIL_NAICS.has(code)) || sic.some((code) => RETAIL_SIC.has(code))) return true;
    if (REJECT_TEXT.test(tagText(tags))) return true;
    return RETAIL_BRAND_ONLY.test(name);
  }

  function isQualifiedFacility(tags = {}) {
    if (isClearlyRetailOrUnrelated(tags)) return false;
    const verified = String(tags["fuel_iq:verified"] || "").toLowerCase() === "yes";
    const naics = parseCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
    const sic = parseCodes(tags["fuel_iq:sic_codes"] || tags.sic || tags["sic:code"]);
    if (verified) {
      return naics.some((code) => TARGET_NAICS.has(code)) || sic.some((code) => TARGET_SIC.has(code));
    }

    const text = tagText(tags);
    const identified = Boolean(tags.name || tags.operator || tags["operator:name"] || tags.owner || tags["owner:name"]);
    if (!identified || !STRONG_ROLE_TEXT.test(text)) return false;
    const shop = String(tags.shop || "").toLowerCase();
    const industrial = String(tags.industrial || "");
    if (shop === "heating_oil") return true;
    if (/^(bulk_plant|fuel_terminal|oil_terminal|tank_farm|oil_storage|petroleum_storage|fuel_storage|depot)$/i.test(industrial)) return true;
    if (/^(oil|petroleum|fuel|terminal)$/i.test(industrial)) return true;
    if (String(tags.landuse || "").toLowerCase() === "industrial") return true;
    if (/^(industrial|warehouse)$/i.test(String(tags.building || ""))) return true;
    if (/^(company|logistics)$/i.test(String(tags.office || ""))) return true;
    return String(tags.man_made || "").toLowerCase() === "storage_tank";
  }

  function typeLabel(type) {
    return ({
      distributor: "Fuel distributor",
      heating_oil: "Heating oil company",
      bulk_plant: "Bulk plant",
      terminal: "Terminal / depot",
      propane: "Propane distributor",
    })[type] || "Fuel distributor";
  }

  function typeColor(type) {
    return ({
      distributor: "#1976a8", heating_oil: "#e48b24", bulk_plant: "#6f55aa", terminal: "#c83d4f", propane: "#18805d",
    })[type] || "#1976a8";
  }

  function classify(tags) {
    const explicit = String(tags["fuel_iq:facility_type"] || "").toLowerCase();
    if (["distributor", "heating_oil", "bulk_plant", "terminal", "propane"].includes(explicit)) return explicit;
    const text = tagText(tags).toLowerCase();
    if (/heating[ _-]?oil|home heating|fuel[ _-]?oil/.test(text)) return "heating_oil";
    if (/propane|\blpg\b/.test(text)) return "propane";
    if (/terminal|tank[ _-]?farm|storage terminal|fuel depot|oil depot|pipeline/.test(text)) return "terminal";
    if (/bulk[ _-]?(plant|station|fuel)|petroleum bulk/.test(text)) return "bulk_plant";
    return "distributor";
  }

  function addressLine(tags) {
    return [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || tags["addr:full"] || "";
  }

  function sourceUrl(element, lat, lon) {
    if (element.source_url) return element.source_url;
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
      qualification: tags["fuel_iq:evidence"] || "Explicit distributor, bulk, terminal, heating-oil or propane facility tag",
      naics: tags["fuel_iq:naics_codes"] || "",
      sic: tags["fuel_iq:sic_codes"] || "",
      registryId: tags["fuel_iq:registry_id"] || "",
      sourceName: element.source_name || tags["fuel_iq:source"] || "OpenStreetMap explicit facility data",
      lat,
      lon,
      type: classify(tags),
      sourceUrl: sourceUrl(element, lat, lon),
      tags,
    };
  }

  function visibleRecords() {
    const query = textFilter.trim().toLowerCase();
    return records.filter((record) => {
      if (activeType !== "all" && record.type !== activeType) return false;
      if (!query) return true;
      return [record.name, record.owner, record.operator, record.street, record.city, record.state, record.zip, record.naics, record.sic]
        .join(" ").toLowerCase().includes(query);
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
    els.detailBody.innerHTML = `
      <span class="badge">${escapeHtml(typeLabel(record.type))}</span>
      <h2>${escapeHtml(record.name)}</h2>
      <div class="address">${escapeHtml(fullAddress || "Address not publicly supplied")}</div>
      <div class="detail-block"><h3>Why this location qualifies</h3>
        ${detailRow("Industry evidence", record.qualification)}
        ${detailRow("NAICS codes", record.naics)}
        ${detailRow("SIC codes", record.sic)}
        ${detailRow("EPA registry ID", record.registryId)}
      </div>
      <div class="detail-block"><h3>Ownership and operation</h3>
        ${detailRow("Legal owner", record.owner)}
        ${detailRow("Operating entity", record.operator)}
      </div>
      <div class="detail-block"><h3>Public business contact</h3>
        ${detailRow("Phone", record.phone, record.phone ? `tel:${record.phone}` : "")}
        ${detailRow("Email", record.email, record.email ? `mailto:${record.email}` : "")}
        ${detailRow("Website", record.website, record.website ? normalizeLink(record.website) : "")}
      </div>
      <div class="detail-block"><h3>Source</h3>
        <p class="empty">${escapeHtml(record.sourceName)}. Ordinary gas stations and unrelated petroleum facilities are excluded. Missing owner and contact fields are not inferred.</p>
        <a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source record</a>
      </div>`;
  }

  function render() {
    const items = visibleRecords();
    markerLayer.clearLayers();
    els.results.innerHTML = "";
    els.count.textContent = items.length.toLocaleString();
    els.states.textContent = new Set(items.map((item) => item.state).filter(Boolean)).size.toLocaleString();
    els.owners.textContent = items.filter((item) => item.owner).length.toLocaleString();
    els.resultTitle.textContent = `${items.length.toLocaleString()} verified locations`;

    if (!items.length) {
      els.results.innerHTML = records.length
        ? '<p class="empty">No verified locations match the current filter.</p>'
        : '<p class="empty">No facilities in this area met the petroleum-wholesaler, fuel-dealer, bulk-terminal, pipeline-terminal, heating-oil or propane verification rules. Ordinary gas stations are never substituted.</p>';
      return;
    }

    items.forEach((record) => {
      L.circleMarker([record.lat, record.lon], {
        radius: 6, color: "#ffffff", weight: 1.5, fillColor: typeColor(record.type), fillOpacity: 0.92, title: record.name,
      }).on("click", () => openDetails(record)).addTo(markerLayer);
    });

    items.slice(0, LIST_LIMIT).forEach((record) => {
      const button = document.createElement("button");
      button.className = "result";
      button.type = "button";
      button.innerHTML = `<strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(typeLabel(record.type))} · ${escapeHtml(record.qualification)} · ${escapeHtml([record.city, record.state].filter(Boolean).join(", ") || record.street || "Address not supplied")}</span>`;
      button.addEventListener("click", () => {
        map.setView([record.lat, record.lon], Math.max(map.getZoom(), 14));
        openDetails(record);
      });
      els.results.appendChild(button);
    });

    if (items.length > LIST_LIMIT) {
      const note = document.createElement("p");
      note.className = "empty result-limit";
      note.textContent = `Showing the first ${LIST_LIMIT.toLocaleString()} names; all ${items.length.toLocaleString()} verified locations remain on the map.`;
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
    if (loading) return;
    const readiness = currentSearchReadiness();
    els.reload.textContent = readiness.ready ? "Search this map area" : "Zoom in to search";
    els.reload.classList.toggle("needs-zoom", !readiness.ready);
    els.searchHelp.textContent = readiness.ready
      ? "Ready to scan the entire visible box for industry-verified distributors, fuel dealers, bulk plants, pipelines and terminals."
      : `Searches work at zoom ${MIN_SEARCH_ZOOM} or closer. Find a city/state above, use your location, or zoom in.`;
  }

  async function fetchJson(url, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, signal: controller.signal });
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
    setStatus("Choose a state or multi-state region, or zoom in before searching.", "warning");
    els.results.innerHTML = `<p class="empty"><strong>This map view is too large for a dependable verified search.</strong><br>Enter a city, state, ZIP code, or address above; use “My location”; or zoom to level ${MIN_SEARCH_ZOOM}+.</p>`;
    els.placeSearch.focus();
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
      south: bounds.getSouth().toFixed(5), west: bounds.getWest().toFixed(5),
      north: bounds.getNorth().toFixed(5), east: bounds.getEast().toFixed(5),
      zoom: String(map.getZoom()), v: REQUIRED_BUILD_ID,
    });

    loading = true;
    els.reload.disabled = true;
    els.placeButton.disabled = true;
    els.locate.disabled = true;
    els.resetView.disabled = true;
    els.reload.textContent = "Searching…";
    records = [];
    textFilter = "";
    markerLayer.clearLayers();
    els.count.textContent = "0";
    els.states.textContent = "0";
    els.owners.textContent = "0";
    els.resultTitle.textContent = "Searching…";
    els.results.innerHTML = '<p class="empty">Scanning the entire visible map box and checking industry-code evidence…</p>';
    setLoadingOverlay(
      true,
      "Searching verified distributor locations…",
      "Scanning the entire visible area for petroleum wholesalers, fuel dealers, bulk plants, pipelines, terminals, heating oil and propane. Ordinary gas stations are excluded.",
    );
    setStatus("Searching the full visible box for industry-verified distributor facilities…", "loading");

    try {
      const payload = await fetchJson(`/api/fuel-atlas/search?${params.toString()}`);
      if (requestId !== requestSequence) return;
      if (payload?.buildId !== REQUIRED_BUILD_ID) throw new Error("The full-bounds distributor build is still deploying. Refresh in a moment.");
      const seen = new Set();
      records = (payload?.elements || []).map(normalize).filter((record) => record && !seen.has(record.id) && seen.add(record.id));
      render();
      if (fitResults && records.length) {
        const resultBounds = L.latLngBounds(records.map((record) => [record.lat, record.lon]));
        if (resultBounds.isValid()) map.fitBounds(resultBounds.pad(0.12), { maxZoom: 12 });
      }
      const suffix = payload?.cached ? " (cached)" : "";
      const sourceCount = Array.isArray(payload?.sourceSummary)
        ? payload.sourceSummary.filter((source) => source.status === "ok").length
        : (payload?.sources || []).length;
      const sectors = Number(payload?.coverage?.occupiedGridCells || 0);
      const partial = payload?.partial ? " Supplemental coverage was unavailable or skipped; verified primary-source results are shown." : "";
      const truncation = payload?.truncated ? " Result cap reached—zoom in for complete local detail." : "";
      setStatus(`${records.length.toLocaleString()} verified facilities loaded from ${sourceCount || 1} source${sourceCount === 1 ? "" : "s"}, spanning ${sectors.toLocaleString()} map sector${sectors === 1 ? "" : "s"}${suffix}.${partial}${truncation}`, payload?.truncated ? "warning" : "success");
    } catch (error) {
      if (requestId !== requestSequence) return;
      records = [];
      render();
      if (error?.name === "AbortError") {
        setStatus("Verified distributor search timed out. Retry this area.", "error");
        els.results.innerHTML = '<p class="empty">The verified distributor sources did not respond before the browser deadline. Retry once; ordinary gas stations will not be shown as a fallback.</p>';
      } else if (error?.code === "AREA_TOO_LARGE") {
        showAreaTooLarge();
      } else {
        setStatus(error?.message || "Verified distributor search failed.", "error");
        els.results.innerHTML = `<p class="empty"><strong>Search could not be completed.</strong><br>${escapeHtml(error?.message || "The verified sources may be temporarily busy.")}</p>`;
      }
    } finally {
      if (requestId === requestSequence) {
        loading = false;
        els.reload.disabled = false;
        els.placeButton.disabled = false;
        els.locate.disabled = false;
        els.resetView.disabled = false;
        setLoadingOverlay(false);
        updateSearchButton();
      }
    }
  }

  async function findPlace(query) {
    const value = String(query || "").trim();
    if (value.length < 2) {
      setStatus("Enter a city, state, ZIP code, or address.", "warning");
      els.placeSearch.focus();
      return;
    }
    els.placeButton.disabled = true;
    setLoadingOverlay(true, "Finding your search area…", `Locating ${value} before scanning the visible area for verified distributors.`);
    setStatus(`Finding ${value}…`, "loading");
    try {
      const payload = await fetchJson(`/api/fuel-atlas/geocode?q=${encodeURIComponent(value)}`, 30000);
      const result = payload?.result;
      if (!result || !Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lon))) throw new Error("No matching U.S. location was found.");
      map.setView([Number(result.lat), Number(result.lon)], 10);
      els.placeSearch.value = result.label || value;
      setStatus(`Searching around ${result.label || value}…`, "loading");
      await loadArea({ fitResults: false });
    } catch (error) {
      setLoadingOverlay(false);
      setStatus(error?.message || "Location could not be found.", "error");
      els.results.innerHTML = `<p class="empty">${escapeHtml(error?.message || "No matching U.S. location was found.")}</p>`;
    } finally {
      els.placeButton.disabled = false;
      if (!loading) setLoadingOverlay(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("Location access is not supported by this browser.", "error");
      return;
    }
    els.locate.disabled = true;
    setLoadingOverlay(true, "Finding your location…", "Your location is used only to position this verified distributor search.");
    setStatus("Requesting your location…", "loading");
    navigator.geolocation.getCurrentPosition(async (position) => {
      map.setView([position.coords.latitude, position.coords.longitude], 10);
      setStatus("Searching around your location…", "loading");
      els.locate.disabled = false;
      await loadArea();
    }, (error) => {
      els.locate.disabled = false;
      setLoadingOverlay(false);
      setStatus(error.code === error.PERMISSION_DENIED ? "Location permission was declined. Search a city or state instead." : "Your location could not be determined.", "error");
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
  }

  els.close.addEventListener("click", () => {
    els.details.hidden = true;
    els.workspace.classList.remove("detail-open");
  });
  els.reload.addEventListener("click", () => loadArea());
  els.locate.addEventListener("click", useCurrentLocation);
  els.resetView.addEventListener("click", () => {
    requestSequence += 1;
    loading = false;
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
  els.placeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = els.placeSearch.value.trim();
    const localMatches = visibleRecords().filter((record) => [record.name, record.owner, record.operator].join(" ").toLowerCase().includes(query.toLowerCase()));
    if (query && localMatches.length) {
      const first = localMatches[0];
      map.setView([first.lat, first.lon], 14);
      openDetails(first);
      return;
    }
    findPlace(query);
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
    if (!loading) {
      const readiness = currentSearchReadiness();
      setStatus(readiness.ready ? "Map moved—search this area to rescan the full visible box." : `Zoom to level ${MIN_SEARCH_ZOOM}+ or find a city/state.`, readiness.ready ? "neutral" : "warning");
    }
  });

  updateSearchButton();
  setStatus("Loading the starting full-bounds distributor region…", "loading");
  window.setTimeout(() => loadArea(), 100);
})();
