(() => {
  const $id = (id) => document.getElementById(id);
  const nativeFetch = window.fetch.bind(window);
  let researchActive = false;

  function ensureResultsCard() {
    const results = $id("siteResearchResults");
    const wrap = document.querySelector(".wrap");
    if (!results || !wrap) return null;
    let card = $id("siteResearchResultsCard");
    if (!card) {
      card = document.createElement("section");
      card.id = "siteResearchResultsCard";
      card.className = "card fiq-results-card";
      card.hidden = true;
      card.innerHTML = '<div class="fiq-results-head"><div><h2>Exhaustive Site Research Results</h2><p>Public records, ratings, development activity, traffic, competition, and market findings are consolidated below.</p></div><span class="fiq-results-badge">Research complete</span></div>';
      wrap.appendChild(card);
    }
    if (results.parentElement !== card) card.appendChild(results);
    return card;
  }

  function showRadar(message = "Starting exhaustive public-source research…", progress = 8) {
    const overlay = $id("siteResearchLoadingOverlay");
    if (!overlay) return;
    researchActive = true;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("fiq-research-busy");
    const messageEl = $id("siteResearchLoadingMessage");
    const bar = $id("siteResearchLoadingBar");
    if (messageEl) messageEl.textContent = message;
    if (bar) bar.style.width = `${Math.max(8, Math.min(96, Number(progress) || 8))}%`;
  }

  function hideRadar() {
    const overlay = $id("siteResearchLoadingOverlay");
    researchActive = false;
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("fiq-research-busy");
  }

  function syncCompletedReport(data) {
    const results = $id("siteResearchResults");
    const card = ensureResultsCard();
    if (results && data?.html) results.innerHTML = data.html;
    const hasReport = Boolean(results && (results.textContent.trim() || results.children.length));
    if (card) card.hidden = !hasReport;

    const wordLink = $id("siteResearchWord");
    const wordButton = $id("siteResearchWordButton");
    if (wordLink && data?.wordUrl) {
      wordLink.href = data.wordUrl;
      wordLink.download = "FuelIQ_Site_Research.doc";
      wordLink.hidden = false;
    }
    if (wordButton) {
      const ready = Boolean(data?.wordUrl || (wordLink && !wordLink.hidden && wordLink.getAttribute("href") && wordLink.getAttribute("href") !== "#"));
      wordButton.disabled = !ready;
      wordButton.setAttribute("aria-disabled", ready ? "false" : "true");
      wordButton.title = ready ? "Download the completed exhaustive Word report" : "Run the exhaustive search before exporting this report";
    }

    const scrollButton = $id("scrollToResearchResults");
    if (scrollButton) scrollButton.hidden = !hasReport;
    hideRadar();
    if (hasReport) setTimeout(() => card?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }

  function syncExistingState() {
    const go = $id("go");
    if (go) go.textContent = "Quick Estimate";
    const basic = $id("exportPDF");
    if (basic) basic.textContent = "Export Basic Report to Word";

    const card = ensureResultsCard();
    const results = $id("siteResearchResults");
    const hasReport = Boolean(results && (results.textContent.trim() || results.children.length));
    if (card) card.hidden = !hasReport;
    const scrollButton = $id("scrollToResearchResults");
    if (scrollButton) scrollButton.hidden = !hasReport;

    const status = String($id("siteResearchStatus")?.textContent || "");
    const progress = Number($id("siteResearchProgress")?.value || 0);
    if (/starting|resuming|researching|running|cross-checking|synthesizing|in progress/i.test(status) || (progress > 0 && progress < 100)) {
      showRadar(status || "Fuel IQ is researching the site…", progress || 10);
    } else if (/failed|unavailable|expired/i.test(status)) {
      hideRadar();
    }
  }

  window.fetch = async (...args) => {
    const request = args[0];
    const url = typeof request === "string" ? request : String(request?.url || "");
    const method = String(args[1]?.method || request?.method || "GET").toUpperCase();
    const isStart = method === "POST" && /\/api\/site-research\/research(?:\?|$)/.test(url);
    const isPoll = method === "GET" && /\/api\/site-research\/research\//.test(url);
    if (isStart) showRadar("Starting exhaustive public-source research…", 9);

    try {
      const response = await nativeFetch(...args);
      if (isStart || isPoll) {
        response.clone().json().then((data) => {
          const elapsed = Number(data?.elapsedSeconds || 0);
          const progress = data?.status === "completed" ? 100 : Math.min(95, 12 + Math.floor(elapsed / 6));
          if (data?.status === "completed") {
            syncCompletedReport(data);
          } else if (data?.status === "failed" || data?.status === "expired" || data?.ok === false) {
            hideRadar();
          } else {
            showRadar(data?.message || "Fuel IQ is researching public sources…", progress);
          }
        }).catch(() => {});
      }
      return response;
    } catch (error) {
      if (isStart || isPoll) hideRadar();
      throw error;
    }
  };

  document.addEventListener("click", (event) => {
    const run = event.target.closest?.("#runSiteResearch");
    if (run) {
      const results = $id("siteResearchResults");
      if (results) results.innerHTML = "";
      const card = ensureResultsCard();
      if (card) card.hidden = true;
      const scrollButton = $id("scrollToResearchResults");
      if (scrollButton) scrollButton.hidden = true;
      showRadar("Preparing the exhaustive site research…", 8);
    }
  }, true);

  const observer = new MutationObserver(syncExistingState);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      syncExistingState();
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "href", "value", "disabled"] });
    }, { once: true });
  } else {
    syncExistingState();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "href", "value", "disabled"] });
  }

  window.addEventListener("beforeunload", () => { if (researchActive) hideRadar(); });
})();
