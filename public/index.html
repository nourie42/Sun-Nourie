<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Fuel Gallons Estimator — Chat</title>

  <!-- Leaflet -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>

  <style>
    :root { --bg:#0e1117; --panel:#161a22; --line:#2a2f3a; --text:#e6e6e6; --muted:#9aa4b2; --primary:#3b82f6; }
    *{ box-sizing: border-box; }
    body { background:var(--bg); color:var(--text); font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
    .wrap { max-width: 980px; margin: 24px auto; padding: 0 16px; }
    h1 { font-size: 40px; margin: 0 0 12px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin:12px 0; }
    label { display:block; font-weight:600; margin:10px 0 6px; }
    input { width:100%; padding:12px; border-radius:8px; border:1px solid var(--line); background:#0f1320; color:var(--text); }
    .row { display:flex; gap:12px; flex-wrap:wrap; }
    .row > div { flex:1; min-width: 220px; }
    button { background:var(--primary); color:white; border:0; padding:12px 16px; border-radius:10px; font-weight:700; cursor:pointer; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    .muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .right { text-align:right; }
    .heading { font-size:18px; font-weight:700; margin: 0 0 8px; }
    .pill { display:inline-block; background:#0f1320; border:1px solid var(--line); border-radius:999px; padding:4px 10px; margin-right:6px; font-size:12px; }
    #map { height: 420px; border-radius:12px; border:1px solid var(--line); }
    .inputs-inline { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .notice { font-size:12px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Fuel Gallons Estimator — Chat</h1>

    <div class="card">
      <div class="row">
        <div>
          <label>Site address (one line) or lat,lon</label>
          <input id="addr" placeholder="4173 Knightdale Blvd, Knightdale NC 27545  — OR — 35.7872,-78.49" />
        </div>
        <div>
          <label>Regular MPDs</label>
          <input id="mpds" type="number" value="3" />
        </div>
        <div>
          <label>Diesel positions (optional)</label>
          <input id="diesel" type="number" value="0" />
        </div>
      </div>
      <div class="inputs-inline" style="margin-top:12px;">
        <div style="flex:1; min-width:240px;">
          <label>AADT override (optional)</label>
          <input id="aadtOverride" type="number" placeholder="enter AADT to force (e.g., 10449)" />
        </div>
        <button id="go">Estimate</button>
        <span class="muted">Drag the site pin and click “Use marker & Re-run” to compute from the exact point.</span>
      </div>
    </div>

    <div class="card" id="report">
      <div class="heading">Result</div>
      <div id="out" class="muted">—</div>

      <div style="margin-top:12px" class="inputs-inline">
        <div style="flex:1; min-width:240px;">
          <label>Adjust AADT and re-run</label>
          <input id="rerunAadt" type="number" placeholder="type a new AADT and click Re-run" />
        </div>
        <button id="rerunBtn">Re-run</button>
        <span class="muted">Re-estimates using your override only.</span>
      </div>
    </div>

    <div class="card">
      <div class="heading">Map: site & competition (1 mile)</div>
      <div id="map">Loading…</div>
      <div class="inputs-inline" style="margin-top:8px;">
        <span class="muted">Move the blue site pin if needed.</span>
        <button id="usePin">Use marker & Re-run</button>
        <span id="pinPos" class="notice"></span>
      </div>
    </div>

    <div class="card">
      <div class="heading">Developments (planned/proposed/permit/coming-soon/construction)</div>
      <div id="devs" class="muted">—</div>
    </div>

    <div class="card">
      <details>
        <summary>Debug JSON</summary>
        <pre id="debug" class="mono muted">/ waiting…</pre>
      </details>
    </div>
  </div>

<script>
const $ = (id) => document.getElementById(id);
const out = $("out"), debug = $("debug"), goBtn = $("go"), rerunBtn = $("rerunBtn"), usePinBtn = $("usePin");

let map, markersLayer, mapInited = false, siteMarker = null, pendingPin = null;

function setOut(html){ out.innerHTML = html; }
function setDebug(obj){ debug.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2); }
function fmt(n){ return (n ?? 0).toLocaleString(undefined, {maximumFractionDigits: 0}); }
function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

async function callEstimate({ overrideValue, usePin=false } = {}){
  const address = $("addr").value.trim();
  const mpds = Number($("mpds").value || 0);
  const diesel = Number($("diesel").value || 0);
  const aadtOverride = overrideValue ?? $("aadtOverride").value.trim();
  const body = { address, mpds, diesel, aadtOverride };

  if (usePin && pendingPin) {
    body.siteLat = pendingPin.lat;
    body.siteLon = pendingPin.lon;
  }

  const res = await fetch("/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}\n` + text.slice(0,1200));
  return JSON.parse(text);
}

async function estimate(){
  try {
    goBtn.disabled = true;
    setOut(`<span class="muted">Working…</span>`);
    const data = await callEstimate();
    setDebug(data);
    renderReport(data);
    renderMap(data.map);
    renderDevs(data.developments);
  } catch (e) {
    setOut(`<div class="muted">Error:<br><pre class="mono">${esc(e.message)}</pre></div>`);
  } finally {
    goBtn.disabled = false;
  }
}

async function rerun(){
  try {
    rerunBtn.disabled = true;
    const v = $("rerunAadt").value.trim();
    if (!v) { alert("Enter an AADT override first."); return; }
    setOut(`<span class="muted">Re-running with override AADT ${fmt(Number(v))}…</span>`);
    const data = await callEstimate({ overrideValue: v });
    setDebug(data);
    renderReport(data);
    renderMap(data.map);
    renderDevs(data.developments);
  } catch (e) {
    setOut(`<div class="muted">Error:<br><pre class="mono">${esc(e.message)}</pre></div>`);
  } finally {
    rerunBtn.disabled = false;
  }
}

async function rerunUsePin(){
  try {
    if (!pendingPin) { alert("Drag the site pin first."); return; }
    usePinBtn.disabled = true;
    setOut(`<span class="muted">Re-running from marker location…</span>`);
    const data = await callEstimate({ usePin: true });
    setDebug(data);
    renderReport(data);
    renderMap(data.map);
    renderDevs(data.developments);
  } catch (e) {
    setOut(`<div class="muted">Error:<br><pre class="mono">${esc(e.message)}</pre></div>`);
  } finally {
    usePinBtn.disabled = false;
  }
}

function renderReport(d){
  const i = d.inputs || {};
  const sectionTop = `
    <div class="grid">
      <div><b>Base Estimate (gal/mo)</b><br><div style="font-size:28px; font-weight:800;">${fmt(d.base)}</div></div>
      <div class="right">
        <div><span class="pill">Low</span> <b>${fmt(d.low)}</b></div>
        <div style="margin-top:6px;"><span class="pill">High</span> <b>${fmt(d.high)}</b></div>
        <div style="margin-top:6px;">Year-2: <b>${fmt(d.year2)}</b></div>
        <div style="margin-top:6px;">Year-3: <b>${fmt(d.year3)}</b></div>
      </div>
    </div>
    <hr>
    <div class="heading">Inputs used</div>
    <div class="muted">AADT used ${fmt(i.aadt_used)}; MPDs ${esc(i.mpds)}${i.diesel ? " + diesel " + esc(i.diesel) : ""}; truck share ${Math.round((i.truck_share_assumed ?? 0)*100)}% (assumed)</div>
    <div class="heading" style="margin-top:12px;">One-paragraph rationale</div>
    <div>${esc(d.rationale || "") || "<span class='muted'>—</span>"}</div>
  `;
  setOut(sectionTop);
  $("rerunAadt").value = i.aadt_used ?? "";
}

function renderDevs(devs){
  const el = $("devs");
  if (!Array.isArray(devs) || !devs.length) { el.innerHTML = "<span class='muted'>none found</span>"; return; }
  el.innerHTML = "<ul>" + devs.map(d => `<li>${esc(d.name)} • ${esc(d.status)} • ${esc(d.miles)} mi</li>`).join("") + "</ul>";
}

function renderMap(m){
  if (!m || !m.site) return;
  if (!mapInited) {
    map = L.map('map', { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(map);
    mapInited = true;
  }
  if (markersLayer) markersLayer.remove();
  markersLayer = L.layerGroup().addTo(map);

  const site = m.site;
  const comps = Array.isArray(m.competitors) ? m.competitors : [];
  const siteLatLng = [site.lat, site.lon];

  map.setView(siteLatLng, 15);

  // Draggable site marker
  siteMarker = L.marker(siteLatLng, { title: "Site", draggable: true }).addTo(markersLayer)
    .bindPopup(`<b>Site</b><br>${esc(site.label || "")}`);
  siteMarker.on("dragend", (e) => {
    const p = e.target.getLatLng();
    pendingPin = { lat: p.lat, lon: p.lng };
    $("pinPos").textContent = `marker: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} (ready to re-run)`;
  });

  // Competitors
  if (comps.length) {
    for (const c of comps) {
      L.circleMarker([c.lat, c.lon], { radius: 6, weight: 1, color: c.heavy ? "#ff7f50" : "#4ade80", fillOpacity: 0.85 })
        .addTo(markersLayer)
        .bindPopup(`<b>${esc(c.name || "Fuel station")}</b><br>${c.miles} mi`);
    }
    const bounds = L.latLngBounds([siteLatLng, ...comps.map(c => [c.lat, c.lon])]);
    map.fitBounds(bounds.pad(0.25));
  }
}

$("go").addEventListener("click", estimate);
$("rerunBtn").addEventListener("click", rerun);
$("usePin").addEventListener("click", rerunUsePin);
</script>
</body>
</html>
