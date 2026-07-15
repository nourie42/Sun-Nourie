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
  const $id = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      @media(max-width:900px){.site-research-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:600px){.site-research-grid{grid-template-columns:1fr}.site-research-report{padding:14px}.site-research-card .research-actions{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function updateHeader() {
    const header = document.querySelector("header");
    if (!header) return;

    for (const link of [...header.querySelectorAll("a")]) {
      const href = String(link.getAttribute("href") || "").toLowerCase();
      const text = String(link.textContent || "").trim().toLowerCase();
      if (href.includes("developments.html") || href.includes("scraper.html") || text === "developments search" || text === "prospector") {
        link.remove();
      }
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
    if (label) label.textContent = "AADT Override (optional)";
    input.required = false;
    input.placeholder = "Use DOT search when blank";
    input.setAttribute("aria-describedby", "aadtOptionalHelp");

    if (!$id("aadtOptionalHelp")) {
      const help = document.createElement("div");
      help.id = "aadtOptionalHelp";
      help.className = "muted subtle";
      help.style.marginTop = "6px";
      help.textContent = "Leave blank to use the official DOT search and Fuel IQ fallback rules.";
      input.insertAdjacentElement("afterend", help);
    }

    const enableButtons = () => {
      go.disabled = false;
      if (refresh) refresh.disabled = false;
      return true;
    };

    try { globalThis.canEstimate = () => true; } catch {}
    try { globalThis.updateGoButtonState = enableButtons; } catch {}
    try { canEstimate = () => true; } catch {}
    try { updateGoButtonState = enableButtons; } catch {}
    enableButtons();

    const observer = new MutationObserver(() => {
      const working = $id("overlay")?.style.display === "flex";
      if (!working) enableButtons();
    });
    observer.observe(go, { attributes: true, attributeFilter: ["disabled"] });
    if (refresh) observer.observe(refresh, { attributes: true, attributeFilter: ["disabled"] });
    input.addEventListener("input", enableButtons);

    const instructions = document.querySelector(".instructions");
    if (instructions) {
      instructions.innerHTML = '<b>Instructions:</b> Enter an address and click <i>Estimate</i>. AADT is optional; when blank, Fuel IQ searches official DOT data and applies its fallback rules if needed. Use <i>Advanced Options</i> for underwriting changes and <i>Exhaustive Site Research</i> for public-record and market research.';
    }

    const notesHelp = input.ownerDocument.querySelector(".notes-toolbar .muted.subtle");
    if (notesHelp) notesHelp.textContent = "Notes are saved with the estimate and included in PDF and Word research reports.";
  }

  function buildResearchCard() {
    if ($id("siteResearchCard")) return;
    const firstCard = document.querySelector(".wrap > .card");
    if (!firstCard) return;

    const card = document.createElement("div");
    card.id = "siteResearchCard";
    card.className = "card site-research-card";
    card.innerHTML = `
      <div class="research-head">
        <div>
          <b>Exhaustive Site Research & Word Report</b>
          <div class="muted subtle" style="margin-top:5px">Select any combination of report details. All sections are selected by default.</div>
        </div>
        <div class="research-actions">
          <button type="button" id="siteResearchSelectAll">Select all</button>
          <button type="button" id="siteResearchClear">Clear</button>
        </div>
      </div>
      <div id="siteResearchChecks" class="site-research-grid"></div>
      <div class="property-record-note"><b>Property Records & Ownership are always searched.</b> The report will return the public owner of record by name when available and will distinguish a person from an LLC, corporation, trust, or government owner.</div>
      <div class="site-research-runbar">
        <button type="button" id="runSiteResearch">Run Exhaustive Search</button>
        <progress id="siteResearchProgress" max="100" value="0" hidden></progress>
        <a id="siteResearchWord" href="#" hidden>Export Research to Word</a>
      </div>
      <div id="siteResearchStatus" aria-live="polite"></div>
      <div id="siteResearchResults"></div>
    `;
    firstCard.insertAdjacentElement("afterend", card);

    const checks = $id("siteResearchChecks");
    checks.innerHTML = SECTION_DEFS.map(([key, title]) => `
      <label class="chip"><input type="checkbox" class="site-research-section" value="${key}" checked> <span>${title}</span></label>
    `).join("");

    $id("siteResearchSelectAll")?.addEventListener("click", () => {
      document.querySelectorAll(".site-research-section").forEach((input) => { input.checked = true; });
    });
    $id("siteResearchClear")?.addEventListener("click", () => {
      document.querySelectorAll(".site-research-section").forEach((input) => { input.checked = false; });
    });
    $id("runSiteResearch")?.addEventListener("click", runResearch);
  }

  function selectedSections() {
    return [...document.querySelectorAll(".site-research-section:checked")].map((input) => input.value);
  }

  function currentNormalizedAddress() {
    try {
      if (typeof selectedNormalized !== "undefined" && selectedNormalized) return selectedNormalized;
    } catch {}
    try {
      if (typeof selectedCoords !== "undefined" && selectedCoords) return selectedCoords;
    } catch {}
    return null;
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

    setStatus("Running the Fuel IQ estimate first so the research report can use the current AADT, competition, and gallons context…", 7);
    const result = await callEstimate();
    if (!result?.ok) throw new Error(result?.status || "Fuel IQ estimate failed before research.");
    if (typeof renderAll === "function") renderAll(result);
    if (typeof pills === "function") pills();
    return result;
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
    if (address.length < 4) {
      alert("Please select a valid site address first.");
      return;
    }
    if (!sections.length) {
      alert("Select at least one report detail.");
      return;
    }

    const runButton = $id("runSiteResearch");
    const wordLink = $id("siteResearchWord");
    const results = $id("siteResearchResults");
    if (runButton) runButton.disabled = true;
    if (wordLink) wordLink.hidden = true;
    if (results) results.innerHTML = "";

    try {
      const estimateContext = await ensureEstimateContext();
      setStatus("Starting exhaustive public-record and market research…", 10);
      const response = await fetch("/api/site-research/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          sections,
          normalizedAddress: currentNormalizedAddress(),
          siteNotes: String($id("siteNotes")?.value || "").trim(),
          estimateContext,
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
      if (!response.ok || data?.ok === false || data?.status === "failed" || data?.status === "expired") {
        throw new Error(data?.message || data?.detail || "The exhaustive research job failed.");
      }
      const elapsed = Number(data?.elapsedSeconds || 0);
      const progressValue = Math.min(94, 12 + Math.floor(elapsed / 5));
      const attempt = data?.maxAttempts ? ` Attempt ${data.attempt || 1} of ${data.maxAttempts}.` : "";
      setStatus(`${data?.message || "Researching public sources…"}${attempt}`, progressValue);
      await wait(5000);
    }
  }

  function renderCompleted(data) {
    const results = $id("siteResearchResults");
    const wordLink = $id("siteResearchWord");
    if (results) results.innerHTML = data?.html || "<p>Research completed, but no report HTML was returned.</p>";
    if (wordLink && data?.wordUrl) {
      wordLink.href = data.wordUrl;
      wordLink.download = "FuelIQ_Site_Report.doc";
      wordLink.hidden = false;
    }
    setStatus("Exhaustive research complete. Review the sourced report below or export it to Word.", 100);
  }

  async function resumeSavedJob() {
    const jobId = sessionStorage.getItem(JOB_STORAGE_KEY);
    if (!jobId) return;
    const runButton = $id("runSiteResearch");
    if (runButton) runButton.disabled = true;
    try {
      setStatus("Resuming the site research job from this browser session…", 12);
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
    buildResearchCard();
    showResearchAvailability();
    resumeSavedJob();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
