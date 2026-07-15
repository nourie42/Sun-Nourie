(() => {
  const SECTION_DEFS = [
    ["executive_read", "Executive Read"],
    ["metric_detail", "Metric Detail"],
    ["site_snapshot", "Site Snapshot"],
    ["area_profile_demand_drivers", "Area Profile & Demand Drivers"],
    ["residential_growth", "Residential Growth"],
    ["commercial_retail_growth", "Commercial & Retail Growth"],
    ["traffic_volume", "Traffic & Volume Read"],
    ["current_competition", "Current Competition"],
    ["competition_growth_future_risk", "Competition Growth & Future Risk"],
    ["strengths_weaknesses_due_diligence", "Strengths, Weaknesses & Due Diligence"],
    ["recommended_site_positioning", "Recommended Site Positioning"],
    ["revised_conclusion", "Revised Conclusion"],
    ["sources_notes", "Sources & Notes"],
  ];

  const JOB_STORAGE_KEY = "fuelIqSiteResearchJobId";
  const COMPETITOR_RADIUS_MI = 1.5;
  const $id = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let aadtChoices = [];
  let selectedAadtIndex = -1;
  let aadtProgrammaticChange = false;
  let lastAadtCoordinateKey = "";
  let rerunTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
  }

  function addStyles() {
    if ($id("siteResearchStyles")) return;
    const style = document.createElement("style");
    style.id = "siteResearchStyles";
    style.textContent = `
      .site-research-card .research-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      .site-research-card .research-actions{display:flex;gap:8px;flex-wrap:wrap}
      .site-research-card .research-actions button{padding:8px 11px;font-size:12px;background:#172338;border:1px solid var(--line)}
      .site-research-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 10px;margin-top:14px}
      .site-research-grid .chip{border-radius:10px;align-items:flex-start;line-height:1.25}
      .site-research-grid .chip input{margin-top:2px;flex:0 0 auto}
      .property-record-note{margin:14px 0 10px;padding:11px 12px;border:1px solid #8a6a18;background:rgba(251,191,36,.08);border-radius:10px;color:#fde68a}
      .site-research-runbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
      #runSiteResearch{min-width:220px}
      #siteResearchProgress{width:min(430px,100%);height:12px;accent-color:#22d3ee}
      #siteResearchStatus{font-size:13px;color:#cfe3ff;min-height:20px;margin-top:10px}
      #siteResearchWord{display:inline-flex;align-items:center;justify-content:center;padding:12px 16px;border-radius:10px;background:linear-gradient(135deg,#2563eb,#22d3ee);color:#fff;text-decoration:none;font-weight:800}
      #siteResearchWord[hidden]{display:none}
      #siteResearchResults{margin-top:16px}
      .site-research-report{background:#f8fafc;color:#172033;border-radius:12px;padding:22px;line-height:1.5}
      .site-research-report h1{font-size:26px;color:#0b1f33;margin:0 0 4px}.site-research-report h2{font-size:19px;color:#123d61;border-bottom:1px solid #cbd5e1;padding-bottom:5px;margin:24px 0 10px}.site-research-report h3{font-size:15px;color:#334155;margin:16px 0 7px}
      .site-report-address{font-size:16px;font-weight:800;margin:2px 0}.site-report-prepared{color:#64748b;font-size:12px;margin:2px 0}.site-report-disclaimer{background:#e2e8f0;border:1px solid #cbd5e1;padding:10px;border-radius:8px;margin:14px 0}
      .site-research-report .table-wrap{overflow:auto}.site-research-report table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:12px}.site-research-report th,.site-research-report td{border:1px solid #cbd5e1;padding:7px;vertical-align:top;text-align:left}.site-research-report th{background:#e2e8f0;color:#1e293b}.site-research-report tr:hover{background:#f1f5f9}.site-research-report .key-value th{width:28%}
      .site-research-report a{color:#075985}.site-research-report ul{padding-left:22px}.site-research-report li{margin:4px 0}.site-research-report .source-ids{color:#475569}
      .fuel-distributor-top-link{padding:8px 14px;background:#fbbf24;border-radius:8px;color:#0b1f33!important;font-weight:700;text-decoration:none;white-space:nowrap}
      .aadt-choice-card{display:none}.aadt-choice-card.is-ready{display:block}
      .aadt-choice-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .aadt-choice-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}
      .aadt-choice{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--line);border-radius:10px;background:#0b1220;cursor:pointer;min-height:112px}
      .aadt-choice:has(input:checked){border-color:#22d3ee;box-shadow:0 0 0 1px rgba(34,211,238,.25) inset;background:#0e1c2c}
      .aadt-choice input{width:auto;margin-top:3px;accent-color:#22d3ee;flex:0 0 auto}
      .aadt-choice strong{font-size:18px}.aadt-choice .meta{font-size:12px;color:#a9b6d0;margin-top:3px;line-height:1.45}
      #aadtChoiceStatus{font-size:12px;color:#cfe3ff;margin-top:9px;min-height:18px}
      .competitor-15-wrap{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12)}
      .competitor-15-wrap table{font-size:12px;margin-top:8px}.competitor-15-wrap td,.competitor-15-wrap th{padding:7px 6px}
      .competitor-lookup-note{font-size:12px;color:#a9b6d0;margin-top:7px}
      @media(max-width:900px){.site-research-grid,.aadt-choice-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:600px){.site-research-grid,.aadt-choice-list{grid-template-columns:1fr}.site-research-report{padding:14px}.site-research-card .research-actions{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function updateHeader() {
    const header = document.querySelector("header");
    if (!header) return;
    for (const link of [...header.querySelectorAll("a")]) {
      const href = String(link.getAttribute("href") || "").toLowerCase();
      const text = String(link.textContent || "").trim().toLowerCase();
      if (href.includes("developments.html") || href.includes("scraper.html") || text === "developments search" || text === "prospector") link.remove();
    }
    if (!$id("fuelDistributorIntelligenceTop")) {
      const paLink = [...header.querySelectorAll("a")].find((link) => /pa aadt/i.test(link.textContent || ""));
      const link = document.createElement("a");
      link.id = "fuelDistributorIntelligenceTop";
      link.className = "fuel-distributor-top-link";
      link.href = "/distributors.html";
      link.textContent = "Distributor Intelligence";
      link.setAttribute("aria-label", "Open Distributor Intelligence");
      if (paLink) paLink.insertAdjacentElement("afterend", link);
      else header.appendChild(link);
    }
    $id("fuel-distributor-intelligence-launch")?.remove();
  }

  function makeAadtOptional() {
    const input = $id("aadtOverride");
    const go = $id("go");
    const refresh = $id("refreshAfterChange");
    if (!input || !go) return;
    const label = input.closest("div")?.querySelector("label");
    if (label) label.textContent = "Selected AADT / Custom Override";
    input.required = false;
    input.placeholder = "Choose a DOT reading below or type a custom value";
    input.setAttribute("aria-describedby", "aadtOptionalHelp");
    if (!$id("aadtOptionalHelp")) {
      const help = document.createElement("div");
      help.id = "aadtOptionalHelp";
      help.className = "muted subtle";
      help.style.marginTop = "6px";
      help.textContent = "The nearest three official readings appear after an address is selected. A custom value may also be entered.";
      input.insertAdjacentElement("afterend", help);
    }

    let enableTimer = null;
    const enableButtons = () => {
      const working = $id("overlay")?.style.display === "flex";
      if (working) {
        clearTimeout(enableTimer);
        enableTimer = setTimeout(enableButtons, 120);
        return true;
      }
      go.disabled = false;
      if (refresh) refresh.disabled = false;
      return true;
    };
    try { globalThis.canEstimate = () => true; } catch {}
    try { globalThis.updateGoButtonState = enableButtons; } catch {}
    try { canEstimate = () => true; } catch {}
    try { updateGoButtonState = enableButtons; } catch {}
    enableButtons();

    const observer = new MutationObserver(enableButtons);
    observer.observe(go, { attributes: true, attributeFilter: ["disabled"] });
    if (refresh) observer.observe(refresh, { attributes: true, attributeFilter: ["disabled"] });

    input.addEventListener("input", () => {
      enableButtons();
      if (aadtProgrammaticChange) return;
      selectedAadtIndex = -1;
      document.querySelectorAll('input[name="fuelIqAadtChoice"]').forEach((radio) => { radio.checked = false; });
      const status = $id("aadtChoiceStatus");
      if (status && input.value.trim()) status.textContent = "Custom AADT override entered. The calculation will use this value.";
    });

    const instructions = document.querySelector(".instructions");
    if (instructions) {
      instructions.innerHTML = '<b>Instructions:</b> Select an address, choose one of the first three official AADT readings, and click <i>Estimate</i>. The volume calculation uses the selected reading. Use <i>Advanced Options</i> for underwriting changes and the exhaustive research panel below the estimate for public-record and market research.';
    }
    const notesHelp = document.querySelector(".notes-toolbar .muted.subtle");
    if (notesHelp) notesHelp.textContent = "Notes are saved with the estimate and included in Word reports.";
  }

  function buildAadtChooser() {
    if ($id("aadtChoiceCard")) return;
    const firstCard = document.querySelector(".wrap > .card");
    if (!firstCard) return;
    const card = document.createElement("div");
    card.id = "aadtChoiceCard";
    card.className = "card aadt-choice-card";
    card.innerHTML = `
      <div class="aadt-choice-head">
        <div><b>Select the AADT Reading Used for Volume</b><div class="muted subtle" style="margin-top:5px">The three nearest official DOT readings are shown in distance order.</div></div>
        <button type="button" id="refreshAadtChoices" style="padding:8px 11px;font-size:12px">Refresh readings</button>
      </div>
      <div id="aadtChoiceList" class="aadt-choice-list"></div>
      <div id="aadtChoiceStatus" aria-live="polite">Select an address to load nearby official readings.</div>`;
    firstCard.insertAdjacentElement("afterend", card);
    $id("refreshAadtChoices")?.addEventListener("click", () => loadAadtChoices(true));
  }

  function selectedCoordinates() {
    try {
      if (typeof selectedCoords !== "undefined" && selectedCoords && Number.isFinite(Number(selectedCoords.lat)) && Number.isFinite(Number(selectedCoords.lon))) {
        return { lat: Number(selectedCoords.lat), lon: Number(selectedCoords.lon) };
      }
    } catch {}
    try {
      if (typeof selectedNormalized !== "undefined" && selectedNormalized && Number.isFinite(Number(selectedNormalized.lat)) && Number.isFinite(Number(selectedNormalized.lon))) {
        return { lat: Number(selectedNormalized.lat), lon: Number(selectedNormalized.lon) };
      }
    } catch {}
    return null;
  }

  function currentSelectedAadt() {
    return selectedAadtIndex >= 0 && aadtChoices[selectedAadtIndex] ? aadtChoices[selectedAadtIndex] : null;
  }

  function renderAadtChoices(items) {
    const card = $id("aadtChoiceCard");
    const list = $id("aadtChoiceList");
    const status = $id("aadtChoiceStatus");
    if (!card || !list || !status) return;
    aadtChoices = items;
    card.classList.add("is-ready");
    if (!items.length) {
      selectedAadtIndex = -1;
      list.innerHTML = '<div class="muted">No official DOT readings were returned within 1.5 miles. A custom AADT can still be entered above.</div>';
      status.textContent = "No official reading was found for this address. Fuel IQ fallback rules remain available.";
      return;
    }
    list.innerHTML = items.map((item, index) => {
      const source = item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Official source</a>` : "Official DOT layer";
      return `<label class="aadt-choice">
        <input type="radio" name="fuelIqAadtChoice" value="${index}">
        <span><strong>${escapeHtml(formatNumber(item.aadt))}</strong><div class="meta">${escapeHtml(item.year || "Year not stated")} • ${escapeHtml(item.route || "Route not stated")}<br>~${escapeHtml(Number(item.miles).toFixed(3))} mi • ${escapeHtml(item.location || "Station/location ID not stated")}<br>${source}</div></span>
      </label>`;
    }).join("");
    list.querySelectorAll('input[name="fuelIqAadtChoice"]').forEach((radio) => {
      radio.addEventListener("change", () => applyAadtChoice(Number(radio.value), true));
    });
    applyAadtChoice(0, false);
  }

  function applyAadtChoice(index, userInitiated) {
    const item = aadtChoices[index];
    const input = $id("aadtOverride");
    if (!item || !input) return;
    selectedAadtIndex = index;
    const radio = document.querySelector(`input[name="fuelIqAadtChoice"][value="${index}"]`);
    if (radio) radio.checked = true;
    aadtProgrammaticChange = true;
    input.value = String(Math.round(Number(item.aadt)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    aadtProgrammaticChange = false;
    const status = $id("aadtChoiceStatus");
    if (status) status.textContent = `${formatNumber(item.aadt)} AADT selected from ${item.route || "the nearest official station"}. The volume calculation will use this reading.`;

    if (userInitiated && currentEstimateResult() && typeof onEstimateClick === "function") {
      clearTimeout(rerunTimer);
      rerunTimer = setTimeout(() => {
        try { onEstimateClick(); } catch {}
      }, 250);
    }
  }

  async function loadAadtChoices(force = false) {
    const card = $id("aadtChoiceCard");
    const status = $id("aadtChoiceStatus");
    if (!card || !status) return;
    let coords = selectedCoordinates();
    for (let attempt = 0; !coords && attempt < 8; attempt += 1) {
      await wait(150);
      coords = selectedCoordinates();
    }
    if (!coords) {
      card.classList.remove("is-ready");
      status.textContent = "Select an autocomplete address so Fuel IQ can load official AADT readings.";
      return;
    }
    const key = `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}`;
    if (!force && key === lastAadtCoordinateKey && aadtChoices.length) return;
    lastAadtCoordinateKey = key;
    card.classList.add("is-ready");
    status.textContent = "Loading the three nearest official DOT readings…";
    try {
      const response = await fetch(`/aadt/nearby?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}&radiusMi=1.5`, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || data?.ok === false) throw new Error(data?.status || `HTTP ${response.status}`);
      const items = (Array.isArray(data.items) ? data.items : [])
        .filter((item) => Number.isFinite(Number(item.aadt)) && Number.isFinite(Number(item.miles)))
        .sort((a, b) => Number(a.miles) - Number(b.miles))
        .slice(0, 3);
      renderAadtChoices(items);
    } catch (error) {
      renderAadtChoices([]);
      status.textContent = `AADT readings could not be loaded: ${error?.message || error}. Enter a custom value or retry.`;
    }
  }

  function patchAddressSelection() {
    try {
      if (typeof chooseAc === "function") {
        const originalChooseAc = chooseAc;
        chooseAc = async function patchedChooseAc(index) {
          const value = await originalChooseAc(index);
          await wait(100);
          await loadAadtChoices(true);
          return value;
        };
      }
    } catch {}
    $id("addr")?.addEventListener("input", () => {
      lastAadtCoordinateKey = "";
      aadtChoices = [];
      selectedAadtIndex = -1;
      $id("aadtChoiceCard")?.classList.remove("is-ready");
    });
    $id("addr")?.addEventListener("change", () => setTimeout(() => loadAadtChoices(false), 300));
    $id("ac")?.addEventListener("click", () => setTimeout(() => loadAadtChoices(true), 450));
  }

  function ensureCompetitorPanel() {
    const estimateCard = $id("estimateCard");
    const compLine = $id("compLine");
    if (!estimateCard || $id("competitor15Panel")) return;
    const panel = document.createElement("div");
    panel.id = "competitor15Panel";
    panel.className = "competitor-15-wrap";
    panel.innerHTML = '<b>Competitors within 1.5 miles</b><div id="competitor15Content" class="muted subtle" style="margin-top:7px">Run an estimate to load the verified competitive set.</div>';
    if (compLine) compLine.insertAdjacentElement("afterend", panel);
    else estimateCard.appendChild(panel);
  }

  function renderCompetitorPanel(result) {
    ensureCompetitorPanel();
    const content = $id("competitor15Content");
    if (!content) return;
    const competitors = (Array.isArray(result?.map?.competitors) ? result.map.competitors : [])
      .filter((item) => Number.isFinite(Number(item?.miles)) && Number(item.miles) <= COMPETITOR_RADIUS_MI)
      .sort((a, b) => Number(a.miles) - Number(b.miles));
    const sources = Array.isArray(result?.competition_lookup?.sources) ? result.competition_lookup.sources : [];
    const warnings = Array.isArray(result?.competition_lookup?.warnings) ? result.competition_lookup.warnings : [];
    if (!competitors.length) {
      content.innerHTML = `<div>No active fuel competitor was verified in the 1.5-mile search. This is a data-gap result, not proof that none exists.</div>${warnings.length ? `<div class="competitor-lookup-note">Lookup warnings: ${escapeHtml(warnings.join(" | "))}</div>` : ""}`;
      return;
    }
    content.innerHTML = `<div style="overflow:auto"><table><thead><tr><th>Distance</th><th>Competitor</th><th>Address</th><th>Source</th></tr></thead><tbody>${competitors.map((item) => `
      <tr><td>${escapeHtml(Number(item.miles).toFixed(3))} mi</td><td><b>${escapeHtml(item.name || item.brand || "Fuel station")}</b>${item.heavy ? '<div class="small">High-impact / big-box format</div>' : ""}</td><td>${escapeHtml(item.address || "—")}</td><td>${escapeHtml(item.source || "Map / places search")}</td></tr>`).join("")}</tbody></table></div>
      <div class="competitor-lookup-note">Search radius is fixed at 1.5 miles. Sources checked: ${escapeHtml(sources.join(", ") || "available map and places sources")}.</div>`;
  }

  function patchEstimateRendering() {
    ensureCompetitorPanel();
    try {
      if (typeof renderAll === "function") {
        const originalRenderAll = renderAll;
        renderAll = function patchedRenderAll(result) {
          const value = originalRenderAll(result);
          renderCompetitorPanel(result);
          return value;
        };
      }
    } catch {}
  }

  function currentEstimateResult() {
    try {
      if (typeof lastEstimateResult !== "undefined" && lastEstimateResult?.ok === true) return lastEstimateResult;
    } catch {}
    return null;
  }

  async function ensureEstimateContext() {
    const existing = currentEstimateResult();
    if (existing) return existing;
    if (typeof callEstimate !== "function") return null;
    setStatus("Running the Fuel IQ estimate first so the research report uses the selected AADT, verified 1.5-mile competition, and current gallons context…", 6);
    const result = await callEstimate();
    if (!result?.ok) throw new Error(result?.status || "Fuel IQ estimate failed before research.");
    if (typeof renderAll === "function") renderAll(result);
    if (typeof pills === "function") pills();
    return result;
  }

  function replacePdfExportWithWord() {
    const existing = $id("exportPDF");
    if (!existing) return;
    const button = existing.cloneNode(true);
    button.id = "exportPDF";
    button.textContent = "Export to Word";
    button.disabled = false;
    existing.replaceWith(button);
    button.addEventListener("click", exportEstimateToWord);
  }

  async function exportEstimateToWord() {
    const button = $id("exportPDF");
    const address = String($id("addr")?.value || "").trim();
    if (address.length < 4) {
      alert("Please select a valid site address first.");
      return;
    }
    const priorLabel = button?.textContent || "Export to Word";
    try {
      if (button) { button.disabled = true; button.textContent = "Building Word report…"; }
      const result = await ensureEstimateContext();
      const selectedAadt = currentSelectedAadt();
      const response = await fetch("/report/word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          result,
          selectedAadt,
          siteNotes: String($id("siteNotes")?.value || "").trim(),
          mpds: Number($id("mpds")?.value || 0),
          diesel: Number($id("diesel")?.value || 0),
          aadtOverride: Number($id("aadtOverride")?.value || 0) || null,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "FuelIQ_Site_Estimate.doc";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      alert(`Word export failed: ${error?.message || error}`);
    } finally {
      if (button) { button.disabled = false; button.textContent = priorLabel; }
    }
  }

  function buildResearchCard() {
    if ($id("siteResearchCard")) return;
    const estimateCard = $id("estimateCard");
    if (!estimateCard) return;
    const card = document.createElement("div");
    card.id = "siteResearchCard";
    card.className = "card site-research-card";
    card.innerHTML = `
      <div class="research-head">
        <div><b>Exhaustive Site Research & Word Report</b><div class="muted subtle" style="margin-top:5px">This panel is directly below the estimate. Select any combination of details; all are selected by default.</div></div>
        <div class="research-actions"><button type="button" id="siteResearchSelectAll">Select all</button><button type="button" id="siteResearchClear">Clear</button></div>
      </div>
      <div id="siteResearchChecks" class="site-research-grid"></div>
      <div class="property-record-note"><b>Property Records & Ownership are always searched.</b> Fuel IQ runs separate official-record, traffic/competition, and growth/market search passes, then combines the sourced results. It returns the public owner of record by name when available and distinguishes a person from an LLC, corporation, trust, or government owner.</div>
      <div class="site-research-runbar"><button type="button" id="runSiteResearch">Run Exhaustive Search</button><progress id="siteResearchProgress" max="100" value="0" hidden></progress><a id="siteResearchWord" href="#" hidden>Export Research to Word</a></div>
      <div id="siteResearchStatus" aria-live="polite"></div><div id="siteResearchResults"></div>`;
    estimateCard.insertAdjacentElement("afterend", card);
    const checks = $id("siteResearchChecks");
    checks.innerHTML = SECTION_DEFS.map(([key, title]) => `<label class="chip"><input type="checkbox" class="site-research-section" value="${key}" checked> <span>${title}</span></label>`).join("");
    $id("siteResearchSelectAll")?.addEventListener("click", () => document.querySelectorAll(".site-research-section").forEach((input) => { input.checked = true; }));
    $id("siteResearchClear")?.addEventListener("click", () => document.querySelectorAll(".site-research-section").forEach((input) => { input.checked = false; }));
    $id("runSiteResearch")?.addEventListener("click", runResearch);
  }

  function selectedSections() {
    return [...document.querySelectorAll(".site-research-section:checked")].map((input) => input.value);
  }

  function currentNormalizedAddress() {
    try {
      if (typeof selectedNormalized !== "undefined" && selectedNormalized) return selectedNormalized;
    } catch {}
    const coords = selectedCoordinates();
    return coords || null;
  }

  function setStatus(message, progressValue = null) {
    const status = $id("siteResearchStatus");
    const progress = $id("siteResearchProgress");
    if (status) status.textContent = message || "";
    if (progress) {
      if (progressValue == null) progress.hidden = true;
      else {
        progress.hidden = false;
        progress.value = Math.max(0, Math.min(100, progressValue));
      }
    }
  }

  async function readJson(response) {
    const text = await response.text();
    try { return JSON.parse(text); }
    catch { throw new Error(text || `HTTP ${response.status}`); }
  }

  async function runResearch() {
    const address = String($id("addr")?.value || "").trim();
    const sections = selectedSections();
    if (address.length < 4) { alert("Please select a valid site address first."); return; }
    if (!sections.length) { alert("Select at least one report detail."); return; }
    const runButton = $id("runSiteResearch");
    const wordLink = $id("siteResearchWord");
    const results = $id("siteResearchResults");
    if (runButton) runButton.disabled = true;
    if (wordLink) wordLink.hidden = true;
    if (results) results.innerHTML = "";
    try {
      const estimateContext = await ensureEstimateContext();
      setStatus("Starting three exhaustive public-source search passes using the cost-efficient research model…", 9);
      const response = await fetch("/api/site-research/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          sections,
          normalizedAddress: currentNormalizedAddress(),
          siteNotes: String($id("siteNotes")?.value || "").trim(),
          estimateContext,
          selectedAadt: currentSelectedAadt(),
          aadtCandidates: aadtChoices.slice(0, 3),
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data?.ok === false || !data?.jobId) throw new Error(data?.message || data?.detail || "Could not start site research.");
      sessionStorage.setItem(JOB_STORAGE_KEY, data.jobId);
      await pollResearch(data.jobId);
    } catch (error) {
      sessionStorage.removeItem(JOB_STORAGE_KEY);
      setStatus(`Research failed: ${error?.message || error}`, null);
    } finally {
      if (runButton) runButton.disabled = false;
    }
  }

  async function pollResearch(jobId) {
    for (;;) {
      const response = await fetch(`/api/site-research/research/${encodeURIComponent(jobId)}`, { headers: { Accept: "application/json" } });
      const data = await readJson(response);
      if (data?.status === "completed") {
        sessionStorage.removeItem(JOB_STORAGE_KEY);
        renderCompleted(data);
        return;
      }
      if (!response.ok || data?.ok === false || data?.status === "failed" || data?.status === "expired") throw new Error(data?.message || data?.detail || "The exhaustive research job failed.");
      const elapsed = Number(data?.elapsedSeconds || 0);
      const progressValue = Math.min(95, 12 + Math.floor(elapsed / 6));
      const passes = Array.isArray(data?.passes) ? ` ${data.passes.filter((item) => item.status === "completed").length}/${data.passes.length} research passes complete.` : "";
      setStatus(`${data?.message || "Researching public sources…"}${passes}`, progressValue);
      await wait(5000);
    }
  }

  function renderCompleted(data) {
    const results = $id("siteResearchResults");
    const wordLink = $id("siteResearchWord");
    if (results) results.innerHTML = data?.html || "<p>Research completed, but no report HTML was returned.</p>";
    if (wordLink && data?.wordUrl) {
      wordLink.href = data.wordUrl;
      wordLink.download = "FuelIQ_Site_Research.doc";
      wordLink.hidden = false;
    }
    setStatus("Exhaustive multi-pass research complete. Review the sourced report below or export it to Word.", 100);
  }

  async function resumeSavedJob() {
    const jobId = sessionStorage.getItem(JOB_STORAGE_KEY);
    if (!jobId) return;
    const runButton = $id("runSiteResearch");
    if (runButton) runButton.disabled = true;
    try {
      setStatus("Resuming the exhaustive site research job from this browser session…", 12);
      await pollResearch(jobId);
    } catch (error) {
      sessionStorage.removeItem(JOB_STORAGE_KEY);
      setStatus(`Previous research job could not be resumed: ${error?.message || error}`, null);
    } finally {
      if (runButton) runButton.disabled = false;
    }
  }

  async function showResearchAvailability() {
    try {
      const response = await fetch("/api/site-research/status", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!data?.openAiEnabled) setStatus("Exhaustive research is unavailable until OPENAI_API_KEY is configured on the server.", null);
    } catch {}
  }

  function initialize() {
    addStyles();
    updateHeader();
    makeAadtOptional();
    buildAadtChooser();
    patchAddressSelection();
    patchEstimateRendering();
    replacePdfExportWithWord();
    buildResearchCard();
    showResearchAvailability();
    resumeSavedJob();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
