(() => {
  if (window.__fiqAddressProviderFallbackInstalled) return;
  window.__fiqAddressProviderFallbackInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const exactCache = new Map();
  const EXACT_CACHE_MS = 15 * 60 * 1000;

  function canonicalQuery(value) {
    return String(value || "")
      .replace(/,?\s*(?:USA|United States)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksLikeCompleteAddress(value) {
    const query = canonicalQuery(value);
    const hasNumber = /^\d+[A-Za-z]?(?:[-/]\d+)?\s+/.test(query);
    const hasStreet = /\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|highway|hwy|route|rt|drive|dr|lane|ln|court|ct|parkway|pkwy|trail|trl|way|circle|cir|terrace|ter|place|pl)\b/i.test(query);
    const hasLocality = query.includes(",") || /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(query);
    return hasNumber && hasStreet && hasLocality;
  }

  function requestUrl(input) {
    try {
      if (input instanceof Request) return new URL(input.url, window.location.href);
      return new URL(String(input), window.location.href);
    } catch {
      return null;
    }
  }

  async function jsonOrNull(response) {
    try { return await response.json(); }
    catch { return null; }
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function minimalNormalized(display, lat, lon, source) {
    return {
      formatted: display,
      line1: String(display || "").split(",")[0]?.trim() || "",
      city: "",
      county: "",
      state: "",
      postcode: "",
      country: "US",
      lat,
      lon,
      source,
    };
  }

  function normalizeFindPlace(data, query) {
    if (!data?.ok) return null;
    const lat = finite(data?.location?.lat);
    const lon = finite(data?.location?.lng ?? data?.location?.lon);
    if (lat == null || lon == null) return null;
    const display = String(data.address || data.formatted_address || query || "").trim();
    if (!display) return null;
    return {
      type: "Google exact",
      display,
      place_id: data.place_id || null,
      lat,
      lon,
      normalized: minimalNormalized(display, lat, lon, "Google exact"),
    };
  }

  function normalizeCensus(data, query) {
    const match = data?.result?.addressMatches?.[0];
    const lat = finite(match?.coordinates?.y);
    const lon = finite(match?.coordinates?.x);
    if (lat == null || lon == null) return null;
    const display = String(match?.matchedAddress || query || "").trim();
    if (!display) return null;
    return {
      type: "US Census",
      display,
      lat,
      lon,
      normalized: minimalNormalized(display, lat, lon, "US Census"),
    };
  }

  function normalizeNominatim(row, query) {
    const lat = finite(row?.lat);
    const lon = finite(row?.lon);
    if (lat == null || lon == null) return null;
    const display = String(row?.display_name || query || "").trim();
    if (!display) return null;
    const address = row?.address || {};
    return {
      type: "OpenStreetMap exact",
      display,
      place_id: row?.place_id || null,
      lat,
      lon,
      normalized: {
        formatted: display,
        line1: [address.house_number, address.road].filter(Boolean).join(" ") || display.split(",")[0]?.trim() || "",
        city: address.city || address.town || address.village || address.hamlet || "",
        county: address.county || "",
        state: address.state || "",
        postcode: address.postcode || "",
        country: String(address.country_code || "US").toUpperCase(),
        lat,
        lon,
        source: "OpenStreetMap exact",
      },
    };
  }

  function parseStructuredAddress(query) {
    const parts = canonicalQuery(query).split(",").map((part) => part.trim()).filter(Boolean);
    const street = parts[0] || "";
    const city = parts[1] || "";
    const stateZip = parts.slice(2).join(" ");
    const stateMatch = stateZip.match(/\b([A-Z]{2})\b/i);
    const zipMatch = stateZip.match(/\b(\d{5}(?:-\d{4})?)\b/);
    return { street, city, state: stateMatch?.[1]?.toUpperCase() || "", zip: zipMatch?.[1] || "" };
  }

  async function lookupExact(query, signal) {
    const canonical = canonicalQuery(query);
    const cacheKey = canonical.toLowerCase();
    const cached = exactCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < EXACT_CACHE_MS) return cached.items;

    const structured = parseStructuredAddress(canonical);
    const censusBase = "https://geocoding.geo.census.gov/geocoder/locations";
    const calls = [
      nativeFetch(`/google/findplace?input=${encodeURIComponent(canonical)}&cb=${Date.now()}`, { cache: "no-store", signal })
        .then(jsonOrNull).then((data) => normalizeFindPlace(data, canonical)),
      nativeFetch(`${censusBase}/onelineaddress?address=${encodeURIComponent(canonical)}&benchmark=Public_AR_Current&format=json`, { cache: "no-store", signal })
        .then(jsonOrNull).then((data) => normalizeCensus(data, canonical)),
      nativeFetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=3&countrycodes=us&q=${encodeURIComponent(canonical)}`, { cache: "no-store", signal })
        .then(jsonOrNull).then((rows) => Array.isArray(rows) ? rows.map((row) => normalizeNominatim(row, canonical)).filter(Boolean) : []),
    ];

    if (structured.street && structured.city && structured.state) {
      const params = new URLSearchParams({
        street: structured.street,
        city: structured.city,
        state: structured.state,
        benchmark: "Public_AR_Current",
        format: "json",
      });
      if (structured.zip) params.set("zip", structured.zip);
      calls.push(
        nativeFetch(`${censusBase}/address?${params}`, { cache: "no-store", signal })
          .then(jsonOrNull).then((data) => normalizeCensus(data, canonical))
      );
    }

    const settled = await Promise.allSettled(calls);
    const flattened = settled.flatMap((result) => {
      if (result.status !== "fulfilled" || !result.value) return [];
      return Array.isArray(result.value) ? result.value : [result.value];
    });
    const seen = new Set();
    const items = flattened.filter((item) => {
      const key = `${item.display}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);

    exactCache.set(cacheKey, { savedAt: Date.now(), items });
    return items;
  }

  function syntheticResponse(body) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  window.fetch = async function fuelIqAddressAwareFetch(input, init = {}) {
    const response = await nativeFetch(input, init);
    const url = requestUrl(input);
    if (!url || url.pathname !== "/google/autocomplete") return response;

    const query = canonicalQuery(url.searchParams.get("input"));
    if (!looksLikeCompleteAddress(query)) return response;

    let body = null;
    try { body = await response.clone().json(); }
    catch { return response; }
    if (body?.ok && Array.isArray(body.items) && body.items.length) return response;

    try {
      const exactItems = await lookupExact(query, init?.signal);
      if (exactItems.length) {
        return syntheticResponse({ ok: true, status: "EXACT_MATCH", items: exactItems });
      }
    } catch (error) {
      if (error?.name === "AbortError") throw error;
    }

    return syntheticResponse({
      ok: true,
      status: "MANUAL_ADDRESS",
      items: [{ type: "Use exact address", display: query }],
    });
  };

  document.addEventListener("pointerdown", (event) => {
    const option = event.target?.closest?.("#fiqAutocompleteRecovery .fiq-ac-option");
    if (!option) return;
    const source = option.querySelector(".fiq-ac-source")?.textContent || "";
    if (!/Use exact address/i.test(source)) return;
    setTimeout(() => {
      const input = document.getElementById("addr");
      const display = input?.value?.trim() || "";
      if (!display) return;
      window.__fiqSelectedAddress = { display, source: "Typed address", manual: true };
      window.dispatchEvent(new CustomEvent("fiq:address-selected", { detail: window.__fiqSelectedAddress }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const status = document.getElementById("apiStatus");
      if (status) status.textContent = "Complete address accepted — Fuel IQ will verify it during the estimate";
    }, 0);
  }, true);
})();
