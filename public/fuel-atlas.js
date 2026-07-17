(() => {
  "use strict";

  const MIN_SEARCH_ZOOM = 7;
  const MAX_LAT_SPAN = 9;
  const MAX_LON_SPAN = 15;
  const MAX_BBOX_AREA = 110;
  const INITIAL_CENTER = [40.9, -77.7];
  const INITIAL_ZOOM = 8;
  const LIST_LIMIT = 250;

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

  function typeLabel(type) {
    return ({
      distributor: "Fuel distributor",
      heating_oil: "Heating oil company",
      bulk_plant: "Bulk plant",
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

  function classify(tags) {
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

    if (/heating[ _-]?oil|home heating|fuel oil/.test(text)) return "heating_oil";
    if (/propane|\blpg\b/.test(text)) return "propane";
    if (/terminal|tank[ _-]?farm|storage terminal|fuel depot|oil depot/.test(text)) return "terminal";
    if (/bulk plant|bulk fuel|petroleum bulk|cardlock/.test(text)) return "bulk_plant";
    return "distributor";
  }

  function addressLine(tags) {
    return [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || tags["addr:full"] || "";
  }

  function sourceUrl(element, lat, lon) {
    if (["node", "way", "relation"].includes(element.type) && element.id) {
      return `https://www.openstreetmap.org/${element.type}/${element.id}`;
    }
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
  }

  function normalize(element) {
    const tags = element.tags || {};
    const center = element.center || element;
    const lat = Number(center.lat);
    const lon = Number(center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const owner = tags.owner || tags["owner:name"] || "";
    const operator = tags.operator || tags["operator:name"] || "";
    const name = tags.name || operator || tags.brand || owner || "Fuel storage or distribution facility";
    const meaningful = Boolean(tags.name || operator || owner || tags.brand || tags.shop || tags.office || tags.industrial || tags.landuse);
    if (!meaningful) return null;

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
        <h3>Source</h3>
        <p class="empty">OpenStreetMap public business and facility tags. Owner and contact fields are shown only when the source explicitly supplies them.</p>
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
    els.resultTitle.textContent = `${items.length.toLocaleString()} locations`;

    if (!items.length) {
      els.results.innerHTML = records.length
        ? '<p class="empty">No loaded locations match the current filter.</p>'
        : '<p class="empty">No public distributor, heating-oil, bulk-plant, terminal, or propane records were found in this area. Try a nearby city or a slightly wider regional view.</p>';
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
      ? "This view is small enough for a detailed public-source search."
      : `Searches work at zoom ${MIN_SEARCH_ZOOM} or closer. Find a city/state above, use your location, or zoom in.`;
  }

  async function fetchJson(url, timeoutMs = 50000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
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
    setStatus("Choose a city/state or zoom in before searching.", "warning");
    els.results.innerHTML = `<p class="empty"><strong>This map view is too large for a dependable detailed search.</strong><br>Enter a city, state, ZIP code, or address above; use “My location”; or zoom to level ${MIN_SEARCH_ZOOM}+.</p>`;
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

    try {
      const payload = await fetchJson(`/api/fuel-atlas/search?${params.toString()}`);
      if (requestId !== requestSequence) return;
      const seen = new Set();
      records = (payload?.elements || [])
        .map(normalize)
        .filter((record) => record && !seen.has(record.id) && seen.add(record.id));
      textFilter = "";
      render();
      if (fitResults && records.length) {
        const boundsForResults = L.latLngBounds(records.map((record) => [record.lat, record.lon]));
        if (boundsForResults.isValid()) map.fitBounds(boundsForResults.pad(0.12), { maxZoom: 12 });
      }
      const suffix = payload?.cached ? " (cached)" : "";
      const truncation = payload?.truncated ? " Result cap reached—zoom in for complete local detail." : "";
      setStatus(`${records.length.toLocaleString()} public fuel-related records loaded${suffix}.${truncation}`, payload?.truncated ? "warning" : "success");
    } catch (error) {
      if (requestId !== requestSequence) return;
      records = [];
      render();
      if (error?.name === "AbortError") {
        setStatus("Search timed out. Try a smaller nearby area.", "error");
        els.results.innerHTML = '<p class="empty">The public map source took too long to respond. Zoom in one level and retry.</p>';
      } else if (error?.code === "AREA_TOO_LARGE") {
        showAreaTooLarge();
      } else {
        setStatus(error?.message || "Search failed. Retry in a smaller area.", "error");
        els.results.innerHTML = `<p class="empty"><strong>Search could not be completed.</strong><br>${escapeHtml(error?.message || "The public source may be temporarily busy.")}</p>`;
      }
    } finally {
      if (requestId === requestSequence) {
        loading = false;
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
    try {
      const payload = await fetchJson(`/api/fuel-atlas/geocode?q=${encodeURIComponent(value)}`, 30000);
      const result = payload?.result;
      if (!result || !Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lon))) throw new Error("No matching U.S. location was found.");

      map.setView([Number(result.lat), Number(result.lon)], 10);
      els.placeSearch.value = result.label || value;
      setStatus(`Searching around ${result.label || value}…`, "loading");
      await loadArea({ fitResults: false });
    } catch (error) {
      setStatus(error?.message || "Location could not be found.", "error");
      els.results.innerHTML = `<p class="empty">${escapeHtml(error?.message || "No matching U.S. location was found.")}</p>`;
    } finally {
      els.placeButton.disabled = false;
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("Location access is not supported by this browser.", "error");
      return;
    }
    els.locate.disabled = true;
    setStatus("Requesting your location…", "loading");
    navigator.geolocation.getCurrentPosition(async (position) => {
      map.setView([position.coords.latitude, position.coords.longitude], 10);
      setStatus("Searching around your location…", "loading");
      els.locate.disabled = false;
      await loadArea();
    }, (error) => {
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
      setStatus(readiness.ready ? "Map moved—search this area to refresh." : `Zoom to level ${MIN_SEARCH_ZOOM}+ or find a city/state.`, readiness.ready ? "neutral" : "warning");
    }
  });

  updateSearchButton();
  setStatus("Loading the starting region…", "loading");
  window.setTimeout(() => loadArea(), 100);
})();
