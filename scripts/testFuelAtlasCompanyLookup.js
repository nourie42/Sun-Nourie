import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function makeClassList() {
  const values = new Set();
  return {
    add(...items) { items.forEach((item) => values.add(item)); },
    remove(...items) { items.forEach((item) => values.delete(item)); },
    toggle(item, force) {
      if (force === true) values.add(item);
      else if (force === false) values.delete(item);
      else if (values.has(item)) values.delete(item);
      else values.add(item);
      return values.has(item);
    },
    contains(item) { return values.has(item); },
  };
}

function makeElement(id = "") {
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    className: "",
    classList: makeClassList(),
    listeners: {},
    children: [],
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name]; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    appendChild(child) { this.children.push(child); return child; },
    insertAdjacentHTML(position, html) {
      this.innerHTML = position === "afterbegin" ? `${html}${this.innerHTML}` : `${this.innerHTML}${html}`;
    },
    focus() { this.focused = true; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
}

const ids = [
  "workspace", "placeForm", "placeSearch", "placeButton", "filters", "results", "count", "states",
  "owners", "status", "reload", "locate", "resetView", "details", "detailBody", "close", "resultTitle",
  "searchHelp", "loadingOverlay", "loadingTitle", "loadingDetail", "map",
];
const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));

const document = {
  getElementById(id) { return elements[id] || null; },
  createDocumentFragment() {
    return { children: [], appendChild(child) { this.children.push(child); return child; } };
  },
  createElement(tagName) { return makeElement(tagName); },
};

const map = {
  center: [40.9, -77.7],
  zoom: 8,
  handlers: {},
  setView(center, zoom) { this.center = center; this.zoom = zoom; return this; },
  getZoom() { return this.zoom; },
  getBounds() {
    const [lat, lon] = this.center;
    return {
      getSouth: () => lat - 0.3,
      getWest: () => lon - 0.4,
      getNorth: () => lat + 0.3,
      getEast: () => lon + 0.4,
    };
  },
  on(name, handler) { this.handlers[name] = handler; return this; },
  fitBounds() { return this; },
};

const markerLayer = { clearLayers() {}, addTo() { return this; } };
const L = {
  map() { return map; },
  tileLayer() { return { addTo() { return this; } }; },
  layerGroup() { return markerLayer; },
  circleMarker() { return { on() { return this; }, addTo() { return this; } }; },
  latLngBounds() { return { isValid: () => true, pad() { return this; } }; },
};

const calls = [];
async function fetchStub(input) {
  const url = String(input?.url || input);
  calls.push(url);
  if (url.startsWith("/api/distributors/search?")) {
    const params = new URL(`https://fuel-iq.test${url}`).searchParams;
    assert.equal(params.get("q"), "Tiger Fuels in Virginia");
    assert.equal(params.get("mode"), "directory");
    return new Response(JSON.stringify({
      ok: true,
      candidates: [{
        legal_name: "Tiger Fuel Company",
        aliases: ["Tiger Fuel", "Tiger Fuels"],
        headquarters: "Charlottesville, Virginia",
        website: "https://tigerfuel.com/",
        description: "Corporate fuel distributor and petroleum marketer",
        parent_company: "",
        entity_type: "corporate_distributor",
        source: "Fuel IQ corporate distributor index",
        source_url: "https://tigerfuel.com/",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("/api/fuel-atlas/geocode?")) {
    const params = new URL(`https://fuel-iq.test${url}`).searchParams;
    assert.match(params.get("q"), /Tiger Fuel Company/);
    assert.match(params.get("q"), /Charlottesville, Virginia/);
    return new Response(JSON.stringify({
      ok: true,
      result: {
        lat: 38.0293,
        lon: -78.4767,
        label: "Charlottesville, Virginia",
        provider: "Test geocoder",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("/api/fuel-atlas/search?")) {
    return new Response(JSON.stringify({
      ok: true,
      filterVersion: "verified-distributor-categories-v3",
      cached: false,
      partial: false,
      elements: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unexpected request: ${url}`);
}

const sandbox = {
  console,
  document,
  navigator: { geolocation: null },
  L,
  fetch: fetchStub,
  AbortController,
  URL,
  URLSearchParams,
  Response,
  setTimeout: () => 1,
  clearTimeout: () => {},
};
sandbox.window = sandbox;

const source = fs.readFileSync(new URL("../public/fuel-atlas.js", import.meta.url), "utf8");
vm.runInNewContext(source, sandbox, { filename: "fuel-atlas.js" });

assert.equal(elements.placeSearch.placeholder, "Find any distributor company, city/state, or ZIP");
assert.ok(elements.placeForm.listeners.submit, "Fuel Atlas search form should install a submit handler");
elements.placeSearch.value = "Tiger Fuels in Virginia";
await elements.placeForm.listeners.submit({ preventDefault() {} });

assert.equal(calls.filter((url) => url.includes("/api/distributors/search")).length, 1, "Tiger Fuel should resolve in the fast directory phase");
assert.equal(calls.some((url) => url.includes("mode=exhaustive")), false, "An indexed Tiger Fuel match should not wait for exhaustive lookup");
assert.equal(calls.some((url) => url.includes("/api/fuel-atlas/geocode")), true, "The matched company's headquarters should be mapped");
assert.equal(calls.some((url) => url.includes("/api/fuel-atlas/search")), true, "Nearby independently verified facilities should still load");
assert.equal(elements.placeSearch.value, "Tiger Fuel Company");
assert.match(elements.detailBody.innerHTML, /Tiger Fuel Company/);
assert.match(elements.detailBody.innerHTML, /Corporate distributor match/);
assert.match(elements.detailBody.innerHTML, /same nationwide corporate lookup used by Distributor Intelligence/);
assert.equal(Number(map.center[0]), 38.0293, "The company latitude should come from the matched headquarters, not the original map view");
assert.equal(Number(map.center[1]), -78.4767, "The company longitude should come from the matched headquarters, not the original map view");

console.log("Fuel Atlas nationwide Tiger Fuel company lookup passed.");
