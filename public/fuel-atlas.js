(() => {
  "use strict";

  const MIN_SEARCH_ZOOM = 8;
  const MAX_LAT_SPAN = 5;
  const MAX_LON_SPAN = 8;
  const MAX_BBOX_AREA = 28;
  const INITIAL_CENTER = [40.2732, -76.8867];
  const INITIAL_ZOOM = 10;
  const LIST_LIMIT = 300;
  const CLIENT_SEARCH_TIMEOUT_MS = 20000;

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
    searchOverlay: document.getElementById("searchOverlay"),
    searchingTitle: document.getElementById("searchingTitle"),
    searchingDetail: document.getElementById("searchingDetail"),
  };

  if (typeof L === "undefined" || !document.getElementById("map")) {
    if (els.status) els.status.textContent = "Map library failed to load. Refresh the page.";
    return;
  }

  const map = L.map("map", { zoomControl: true }).setView(INITIAL_CENTER, INITIAL_ZOOM);
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
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

  function setStatus(message, tone = "neutral") {
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  }

  function setSearching(active, title = "Searching public fuel-location sources…", detail = "") {
    if (!els.searchOverlay) return;
    els.searchOverlay.hidden = !active;
    els.searchOverlay.setAttribute("aria-hidden", active ? "false" : "true");
    document.body.setAttribute("aria-busy", active ? "true" : "false");
    if (title && els.searchingTitle) els.searchingTitle.textContent = title;
    if (els.searchingDetail) els.searchingDetail.textContent = detail || "Checking distributor, heating-oil, bulk-plant, terminal and propane records. Gas stations are excluded.";
  }

  function typeLabel(type) {
    return ({
      distributor: "Fuel distributor",
      heating_oil: "Heating oil company",
      bulk_plant: "Bulk plant / cardlock",
      terminal: "Terminal / depot",
      propane: "Propane distributor",
    })[type] || "Fuel business";
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
    const text = [
      tags.name,
      tags.operator,
      tags.brand,
      tags.description,
      tags.product,
      tags.fuel,
      tags.content,
      tags.storage,
      tags.shop,
      tags.industrial,
      tags.office,
      tags.landuse,
    ].filter(Boolean).join(" ").toLowerCase();

    if (/heating[ _-]?oil|home heating|fuel[ _-]?oil/.test(text)) return "heating_oil";
    if (/propane|\blpg\b/.test(text)) return "propane";
    if (/terminal|tank[ _-]?farm|storage terminal|fuel depot|oil depot/.test(text)) return "terminal";
    if (/bulk(?:\s+(?:fuel|oil|petroleum|plant|storage))?|cardlock|commercial fuel|fleet fuel/.test(text)) return "bulk_plant";
    return "distributor";
  }

  function addressLine(tags = {}) {
    return [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || tags["addr:full"] || "";
  }

  function sourceUrl(element, lat, lon) {
    if (["node", "way", "relation"].includes(element.type) && element.id) {
      return `https://www.openstreetmap.org/${element.type}/${element.id}`;
    }
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
  }

  function normalizeRecord(item) {
    if (!item) return null;
    if (item.source && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))) {
      return {
        id: String(item.id || `${item.source}-${item.lat}-${item.lon}-${item.name || "facility"}`),
        name: String(item.name || item.operator || item.owner || "Fuel distribution facility"),
        owner: String(item.owner || ""),
        operator: String(item.operator || ""),
        phone: String(item.phone || ""),
        email: String(item.email || ""),
        website: String(item.website || ""),
        street: String(item.street || ""),
        city: String(item.city || ""),
        state: String(item.state || ""),
        zip: String(item.zip || ""),
        lat: Number(item.lat),
        lon: Number(item.lon),
        type: item.type || "distributor",
        source: String(item.source || "Public source"),
        sourceUrl: String(item.sourceUrl || ""),
        sources: Array.isArray(item.sources) ? item.sources : [{ name: item.source || "Public source", url: item.sourceUrl || "" }],
      };
    }

    const tags = item.tags || {};
    const center = item.center || item;
    const lat = Number(center.lat);
    const lon = Number(center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const owner = tags.owner || tags["owner:name"] || "";
    const operator = tags.operator || tags["operator:name"] || "";
    const url = sourceUrl(item, lat, lon);
    return {
      id: `${item.type || "feature"}-${item.id || `${lat}-${lon}`}`,
      name: tags.name || operator || tags.brand || owner || "Fuel distribution facility",
      owner,
      operator,
      phone: tags.phone || tags["contact:phone"] || tags["contact:mobile"] || "",
      email: tags.email || tags["contact:email"] || "",
      website: tags.website || tags["contact:website"] || tags.url || "",
      street: addressLine(tags),
      city: tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || tags["addr:hamlet"] || "",
      state: tags["addr:state"] || "",
      zip: tags["addr:postcode"] || "",
      lat,
      lon,
      type: classify(tags),
      source: "OpenStreetMap",
      sourceUrl: url,
      sources: [{ name: "OpenStreetMap", url }],
    };
  }

  function visibleRecords() {
    const query = textFilter.trim().toLowerCase();
    return records.filter((record) => {
      if (activeType !== "all" && record.type !== activeType) return false;
      if (!query) return true;
      return [record.name, record.owner, record.operator, record.street, record.city, record.state, record.zip]
        .join(" ")
        .toLowerCase()
        .includes(query);
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

  function sourceRows(record) {
    const sources = Array.isArray(record.sources) && record.sources.length
      ? record.sources
      : [{ name: record.source || "Public source", url: record.sourceUrl || "" }];
    return sources.map((source) => source.url
      ? `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name || "Open source record")}</a></li>`
      : `<li>${escapeHtml(source.name || "Public source")}</li>`).join("");
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
      <div class="detail-block">
        <h3>Ownership and operation</h3>
        ${detailRow("Legal owner", record.owner)}
        ${detailRow("Operating entity", record.operator)}
      </div>
      <div class="detail-block">
        <h3>Public business contact</h3>
        ${detailRow("Phone", record.phone, record.phone ? `tel:${record.phone}` : "")}
        ${detailRow("Email", record.email, record.email ? `mailto:${record.email}` : "")}
        ${detailRow("Website", record.website, record.website ? normalizeLink(record.website) : "")}
      </div>
      <div class="detail-block">
        <h3>Sources</h3>
        <p class="empty">Owner and contact fields appear only when a public source explicitly supplies them. Missing fields are not inferred.</p>
        <ul class="source-list">${sourceRows(record)}</ul>
      </div>`;
  }

  function render() {
    const items = visibleRecords();
    markerLayer.clearLayers();
    els.results.innerHTML = "";
    els.count.textContent = items.length.toLocaleString();
    els.states.textContent = new Set(items.map((item) => item.state).filter(Boolean)).size.toLocaleString();
    els.owners.textContent = items.filter((item) => item.owner).length.toLocaleString();
    els.resultTitle.textContent = `${items.length.toLocaleString()} locations`;

    if (!items.length) {
      els.results.innerHTML = records.length
        ? '<p class="empty">No loaded locations match the current filter.</p>'
        : '<p class="empty">No specialized distributor, heating-oil, bulk-plant, terminal, cardlock, or propane records were returned for this exact map view. Gas stations are intentionally excluded.</p>';
      return;
    }

    items.forEach((record) => {
      L.circleMarker([record.lat, record.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: typeColor(record.type),
        fillOpacity: 0.92,
        title: record.name,
      }).on("click", () => openDetails(record)).addTo(markerLayer);
    });

    items.slice(0, LIST_LIMIT).forEach((record) => {
      const button = document.createElement("button");
      button.className = "result";
      button.type = "button";
      button.innerHTML = `<strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(typeLabel(record.type))} · ${escapeHtml([record.city, record.state].filter(Boolean).join(", ") || record.street || "Address not supplied")}</span>`;
      button.addEventListener("click", () => {
        map.setView([record.lat, record.lon], Math.max(map.getZoom(), 14));
        openDetails(record);
      });
      els.results.appendChild(button);
    });

    if (items.length > LIST_LIMIT) {
      const note = document.createElement("p");
      note.className = "empty result-limit";
      note.textContent = `Showing the first ${LIST_LIMIT.toLocaleString()} names in the list; all ${items.length.toLocaleString()} points remain on the map.`;
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
      ? "This view is ready for a focused distributor and fuel-facility search. Ordinary gas stations are excluded."
      : `Searches work at zoom ${MIN_SEARCH_ZOOM} or closer. Find a city/state above, use your location, or zoom in.`;
  }

  async function fetchJson(url, timeoutMs = CLIENT_SEARCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal, cache: "no-store" });
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
    setSearching(false);
    setStatus("Choose a city/state or zoom in before searching.", "warning");
    els.results.innerHTML = `<p class="empty"><strong>This map view is too large for a dependable detailed search.</strong><br>Enter a city, state, ZIP code, or address above; use “My location”; or zoom to level ${MIN_SEARCH_ZOOM}+.</p>`;
    els.placeSearch.focus();
  }

  function successfulSourceNames(payload) {
    return (payload?.sourceSummary || [])
      .filter((source) => source.status === "ok" && Number(source.count) >= 0)
      .map((source) => source.name);
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
    });

    loading = true;
    els.reload.disabled = true;
    els.placeButton.disabled = true;
    els.locate.disabled = true;
    els.reload.textContent = "Searching…";
    setStatus("Searching public fuel-location sources…", "loading");
    setSearching(
      true,
      "Searching public fuel-location sources…",
      "Checking fuel distributors, heating-oil companies, bulk plants, terminals, depots, cardlocks and propane suppliers. Gas stations are excluded.",
    );

    try {
      const payload = await fetchJson(`/api/fuel-atlas/search?${params.toString()}`);
      if (requestId !== requestSequence) return;
      const seen = new Set();
      records = (payload?.records || payload?.elements || [])
        .map(normalizeRecord)
        .filter((record) => record && !seen.has(record.id) && seen.add(record.id));
      textFilter = "";
      render();

      if (fitResults && records.length) {
        const boundsForResults = L.latLngBounds(records.map((record) => [record.lat, record.lon]));
        if (boundsForResults.isValid()) map.fitBounds(boundsForResults.pad(0.12), { maxZoom: 12 });
      }

      const elapsedSeconds = Number(payload?.durationMs) > 0 ? ` in ${(Number(payload.durationMs) / 1000).toFixed(1)}s` : "";
      const sourceNames = successfulSourceNames(payload);
      const sourceText = sourceNames.length ? ` Sources: ${sourceNames.join(", ")}.` : "";
      const cacheText = payload?.stale ? " Using the most recent cached results." : payload?.cached ? " Cached result." : "";
      if (records.length) {
        const warningText = payload?.partial ? " Some public sources were unavailable, but completed sources are shown." : "";
        setStatus(`${records.length.toLocaleString()} specialized fuel locations loaded${elapsedSeconds}.${sourceText}${cacheText}${warningText}`, payload?.partial ? "warning" : "success");
      } else if (sourceNames.length) {
        setStatus(`Search completed${elapsedSeconds}; no specialized fuel locations were returned in this exact view. Gas stations were excluded.${sourceText}`, "warning");
      } else {
        setStatus("The search completed, but no public source returned data. Retry shortly or move the map a few miles.", "error");
        els.results.innerHTML = '<p class="empty"><strong>No source returned usable data.</strong><br>The request ended without hanging. Retry once, or move to a nearby city and search again.</p>';
      }
    } catch (error) {
      if (requestId !== requestSequence) return;
      records = [];
      render();
      if (error?.name === "AbortError") {
        setStatus("Fuel IQ did not receive the server response. Retry this exact area.", "error");
        els.results.innerHTML = '<p class="empty"><strong>The Fuel IQ server did not answer within 20 seconds.</strong><br>The public-source calls are capped server-side; retry once after the deployment has fully restarted.</p>';
      } else if (error?.code === "AREA_TOO_LARGE") {
        showAreaTooLarge();
      } else {
        setStatus(error?.message || "Search failed. Retry this area.", "error");
        els.results.innerHTML = `<p class="empty"><strong>Search could not be completed.</strong><br>${escapeHtml(error?.message || "The search service may still be restarting.")}</p>`;
      }
    } finally {
      if (requestId === requestSequence) {
        loading = false;
        setSearching(false);
        els.reload.disabled = false;
        els.placeButton.disabled = false;
        els.locate.disabled = false;
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
    setStatus(`Finding ${value}…`, "loading");
    setSearching(true, "Finding the requested map area…", `Locating ${value} before searching the specialized fuel-location sources.`);
    try {
      const payload = await fetchJson(`/api/fuel-atlas/geocode?q=${encodeURIComponent(value)}`, 12000);
      const result = payload?.result;
      if (!result || !Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lon))) throw new Error("No matching U.S. location was found.");

      map.setView([Number(result.lat), Number(result.lon)], 11);
      els.placeSearch.value = result.label || value;
      setStatus(`Searching around ${result.label || value}…`, "loading");
      await loadArea({ fitResults: false });
    } catch (error) {
      setSearching(false);
      setStatus(error?.message || "Location could not be found.", "error");
      els.results.innerHTML = `<p class="empty">${escapeHtml(error?.message || "No matching U.S. location was found.")}</p>`;
    } finally {
      els.placeButton.disabled = false;
      if (!loading) setSearching(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("Location access is not supported by this browser.", "error");
      return;
    }
    els.locate.disabled = true;
    setStatus("Requesting your location…", "loading");
    setSearching(true, "Finding your location…", "Your browser is locating the map area before the fuel-facility search begins.");
    navigator.geolocation.getCurrentPosition(async (position) => {
      map.setView([position.coords.latitude, position.coords.longitude], 11);
      setStatus("Searching around your location…", "loading");
      els.locate.disabled = false;
      await loadArea();
    }, (error) => {
      setSearching(false);
      els.locate.disabled = false;
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
    setSearching(false);
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
    const localMatches = records.filter((record) => [record.name, record.owner, record.operator].join(" ").toLowerCase().includes(query.toLowerCase()));
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
      setStatus(readiness.ready ? "Map moved—search this area to refresh." : `Zoom to level ${MIN_SEARCH_ZOOM}+ or find a city/state.`, readiness.ready ? "neutral" : "warning");
    }
  });

  updateSearchButton();
  setStatus("Loading the starting region…", "loading");
  setSearching(true, "Searching public fuel-location sources…", "Loading distributors, heating-oil companies, bulk plants, terminals, depots, cardlocks and propane suppliers around Harrisburg. Gas stations are excluded.");
  window.setTimeout(() => loadArea(), 150);
})();
