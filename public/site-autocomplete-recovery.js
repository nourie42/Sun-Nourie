(() => {
  const input = document.getElementById("addr");
  if (!input || window.__fiqAutocompleteRecoveryInstalled) return;
  window.__fiqAutocompleteRecoveryInstalled = true;

  const status = document.getElementById("apiStatus");
  const legacyBox = document.getElementById("ac");
  let timer = null;
  let requestId = 0;
  let activeIndex = -1;
  let items = [];
  let controller = null;

  const box = document.createElement("div");
  box.id = "fiqAutocompleteRecovery";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  document.body.appendChild(box);

  const style = document.createElement("style");
  style.id = "fiqAutocompleteRecoveryStyles";
  style.textContent = `
    #fiqAutocompleteRecovery {
      position: fixed;
      z-index: 2147483000;
      max-height: min(360px, 46vh);
      overflow-y: auto;
      padding: 6px;
      border: 1px solid #c9d8e3;
      border-radius: 12px;
      background: #fff;
      color: #0b1f33;
      box-shadow: 0 18px 44px rgba(9,30,49,.24);
    }
    #fiqAutocompleteRecovery[hidden] { display: none !important; }
    #fiqAutocompleteRecovery .fiq-ac-option {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 11px 12px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: #0b1f33;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }
    #fiqAutocompleteRecovery .fiq-ac-option:hover,
    #fiqAutocompleteRecovery .fiq-ac-option.is-active { background: #edf6fb; }
    #fiqAutocompleteRecovery .fiq-ac-address {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.35;
    }
    #fiqAutocompleteRecovery .fiq-ac-source {
      flex: 0 0 auto;
      padding: 3px 7px;
      border-radius: 999px;
      background: #e8f1f7;
      color: #35617d;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    #fiqAutocompleteRecovery .fiq-ac-empty {
      padding: 12px;
      color: #5f7180;
      font-size: 13px;
      line-height: 1.45;
    }
  `;
  document.head.appendChild(style);

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function positionBox() {
    if (box.hidden) return;
    const rect = input.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(280, rect.width);
    box.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    box.style.width = `${Math.min(width, window.innerWidth - margin * 2)}px`;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const estimated = Math.min(360, Math.max(100, items.length * 54 + 12));
    if (spaceBelow >= Math.min(estimated, 180)) {
      box.style.top = `${rect.bottom + 6}px`;
      box.style.bottom = "auto";
    } else {
      box.style.top = "auto";
      box.style.bottom = `${Math.max(margin, window.innerHeight - rect.top + 6)}px`;
    }
  }

  function hide() {
    box.hidden = true;
    activeIndex = -1;
  }

  function normalize(raw, source) {
    const display = String(raw?.display || raw?.description || raw?.formatted_address || raw?.label || "").trim();
    if (!display) return null;
    return {
      display,
      source: String(raw?.type || raw?.source || source || "Address"),
      placeId: raw?.place_id || raw?.placeId || null,
      lat: Number.isFinite(Number(raw?.lat)) ? Number(raw.lat) : null,
      lon: Number.isFinite(Number(raw?.lon ?? raw?.lng)) ? Number(raw.lon ?? raw.lng) : null,
      normalized: raw?.normalized || null,
    };
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((item) => {
      if (!item) return false;
      const key = item.display.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
  }

  function render(emptyMessage = "No matching addresses found yet. Keep typing, or add the city and state.") {
    if (!items.length) {
      box.innerHTML = `<div class="fiq-ac-empty"></div>`;
      box.querySelector(".fiq-ac-empty").textContent = emptyMessage;
      box.hidden = false;
      positionBox();
      return;
    }
    box.innerHTML = items.map((item, index) => `
      <button type="button" class="fiq-ac-option${index === activeIndex ? " is-active" : ""}" role="option" data-index="${index}" aria-selected="${index === activeIndex}">
        <span class="fiq-ac-address"></span><span class="fiq-ac-source"></span>
      </button>`).join("");
    box.querySelectorAll(".fiq-ac-option").forEach((button) => {
      const index = Number(button.dataset.index);
      button.querySelector(".fiq-ac-address").textContent = items[index].display;
      button.querySelector(".fiq-ac-source").textContent = items[index].source;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        select(index);
      });
    });
    box.hidden = false;
    positionBox();
  }

  async function fetchJson(url, signal, timeoutMs = 9000) {
    const timeout = new Promise((_, reject) => {
      const error = new Error("Address provider timed out");
      error.name = "TimeoutError";
      setTimeout(() => reject(error), timeoutMs);
    });
    const request = fetch(url, { cache: "no-store", signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Address provider returned ${response.status}`);
      return response.json();
    });
    return Promise.race([request, timeout]);
  }

  function queryVariants(query) {
    const clean = query.replace(/\s+/g, " ").trim();
    const variants = [clean];
    if (!/\b(?:USA|United States)\b/i.test(clean)) variants.push(`${clean}, USA`);
    return [...new Set(variants)].slice(0, 2);
  }

  async function providerSearch(query, signal) {
    const variants = queryVariants(query);
    const calls = [];
    for (const variant of variants) {
      calls.push(fetchJson(`/google/autocomplete?input=${encodeURIComponent(variant)}&cb=${Date.now()}`, signal));
      calls.push(fetchJson(`/osm/autocomplete?q=${encodeURIComponent(variant)}&cb=${Date.now()}`, signal));
    }
    const settled = await Promise.allSettled(calls);
    const found = [];
    let successfulProviders = 0;
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      successfulProviders += 1;
      if (!result.value?.ok) continue;
      for (const item of result.value.items || []) found.push(normalize(item, item?.type || "Address"));
    }
    return { found: dedupe(found), successfulProviders };
  }

  function publishSelectedCoordinates(selected) {
    if (selected.lat == null || selected.lon == null) return;
    const coords = { lat: Number(selected.lat), lon: Number(selected.lon) };
    try { selectedCoords = coords; } catch {}
    try {
      selectedNormalized = selected.normalized || {
        formatted: selected.display,
        lat: coords.lat,
        lon: coords.lon,
        source: selected.source,
        place_id: selected.placeId,
      };
    } catch {}
    window.__fiqSelectedAddress = { ...selected, ...coords };
    window.dispatchEvent(new CustomEvent("fiq:address-selected", { detail: window.__fiqSelectedAddress }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function persistSelection(item) {
    let selected = item;
    if (item.placeId && (!item.normalized || item.lat == null || item.lon == null)) {
      try {
        const data = await fetchJson(`/google/place_details?place_id=${encodeURIComponent(item.placeId)}`, null, 10000);
        const normalized = data?.ok && data.item ? normalize(data.item, "Google") : null;
        if (normalized) selected = { ...item, ...normalized };
      } catch {}
    }
    window.__fiqSelectedAddress = selected;
    publishSelectedCoordinates(selected);
    if (selected.normalized && selected.lat != null && selected.lon != null) {
      fetch("/api/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: selected.display,
          normalized: selected.normalized,
          source: selected.source,
          place_id: selected.placeId,
        }),
      }).catch(() => {});
    }
  }

  function select(index) {
    const item = items[index];
    if (!item) return;
    clearTimeout(timer);
    requestId += 1;
    controller?.abort();
    input.value = item.display;
    input.focus();
    hide();
    setStatus(`Address selected — ${item.source}`);
    persistSelection(item);
  }

  async function search(query, id) {
    controller?.abort();
    controller = new AbortController();
    setStatus("Searching addresses…");
    try {
      const result = await providerSearch(query, controller.signal);
      if (id !== requestId || input.value.trim() !== query) return;
      items = result.found;
      activeIndex = items.length ? 0 : -1;
      if (items.length) {
        render();
        setStatus(`Autocomplete ready — ${items.length} address match${items.length === 1 ? "" : "es"}`);
      } else if (!result.successfulProviders) {
        render("Address search is temporarily unavailable. You can still type the complete address and run the estimate.");
        setStatus("Address providers unavailable — full address entry still works");
      } else {
        render();
        setStatus("No address matches yet — keep typing or add city and state");
      }
    } catch (error) {
      if (id !== requestId || error?.name === "AbortError") return;
      items = [];
      render("Address search is temporarily unavailable. You can still type the complete address and run the estimate.");
      setStatus("Address search temporarily unavailable — full address entry still works");
    }
  }

  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(timer);
    controller?.abort();
    requestId += 1;
    if (query.length < 2) {
      items = [];
      hide();
      setStatus("Autocomplete ready — type at least 2 characters");
      return;
    }
    const id = requestId;
    timer = setTimeout(() => search(query, id), 260);
  }, true);

  input.addEventListener("keydown", (event) => {
    if (box.hidden || !items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(items.length - 1, activeIndex + 1);
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      select(Math.max(0, activeIndex));
    } else if (event.key === "Escape") {
      hide();
    }
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (event.target !== input && !box.contains(event.target)) hide();
  }, true);
  window.addEventListener("resize", positionBox, { passive: true });
  window.addEventListener("scroll", positionBox, { passive: true });

  if (legacyBox) legacyBox.style.display = "none";
  setStatus("Autocomplete ready — type an address");
})();
