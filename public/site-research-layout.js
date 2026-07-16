(() => {
  const $id = (id) => document.getElementById(id);
  const MAX_BOOT_ATTEMPTS = 80;

  function ensureHiddenCompatibilityFields() {
    document.querySelector('.notes-toolbar')?.remove();
    let notes = $id('siteNotes');
    if (!notes) {
      notes = document.createElement('input');
      notes.id = 'siteNotes';
      notes.type = 'hidden';
      notes.value = '';
      ($id('siteWorkflowCard') || document.body).appendChild(notes);
    } else {
      notes.value = '';
      if (notes.tagName !== 'INPUT' || notes.type !== 'hidden') notes.style.display = 'none';
    }
    $id('devs')?.setAttribute('hidden', '');
    $id('ratingLine')?.setAttribute('hidden', '');
  }

  function positionResearchUi() {
    const workflow = $id('siteWorkflowCard') || document.querySelector('.wrap > .card');
    const inputRow = workflow?.querySelector('.input-row');
    const estimateButton = $id('go');
    const researchButton = $id('runSiteResearch');
    const refreshButton = $id('refreshAfterChange');
    const researchCard = $id('siteResearchCard');
    const aadtCard = $id('aadtChoiceCard');
    if (!workflow || !inputRow || !estimateButton || !researchButton || !researchCard || !aadtCard) return false;

    workflow.classList.add('fiq-input-card');
    workflow.id ||= 'siteWorkflowCard';
    const actionStack = estimateButton.closest('.input-row > div') || estimateButton.parentElement;
    actionStack?.classList.add('analysis-action-stack');
    if (researchButton.previousElementSibling !== estimateButton) estimateButton.insertAdjacentElement('afterend', researchButton);
    if (refreshButton && refreshButton.parentElement !== actionStack) actionStack?.appendChild(refreshButton);

    aadtCard.classList.remove('card');
    aadtCard.classList.add('aadt-choice-panel', 'fiq-positioned');
    researchCard.classList.remove('card');
    researchCard.classList.add('research-options-panel', 'fiq-positioned');

    // The recommended official AADT is always above exhaustive report selections.
    workflow.appendChild(aadtCard);
    workflow.appendChild(researchCard);

    const chooserTitle = aadtCard.querySelector('.aadt-choice-head > div:first-child');
    if (chooserTitle) chooserTitle.innerHTML = '<b>Recommended AADT for the Volume Estimate</b><div class="muted subtle" style="margin-top:5px">Fuel IQ checks the nearest official readings first, then expands the official-source search when local coverage is sparse.</div>';

    const researchTitle = researchCard.querySelector('.research-head > div:first-child');
    if (researchTitle) researchTitle.innerHTML = '<b>Exhaustive report selections</b><div class="muted subtle" style="margin-top:5px">Choose the report detail. Property records, ratings, development activity, traffic, and competition are researched during every exhaustive run.</div>';

    const progress = $id('siteResearchProgress');
    const status = $id('siteResearchStatus');
    const runbar = researchCard.querySelector('.site-research-runbar');
    let feedback = $id('siteResearchFeedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.id = 'siteResearchFeedback';
      feedback.className = 'research-feedback-row';
    }
    if (progress && progress.parentElement !== feedback) feedback.appendChild(progress);
    if (status && status.parentElement !== feedback) feedback.appendChild(status);
    const propertyNote = researchCard.querySelector('.property-record-note');
    if (propertyNote) propertyNote.insertAdjacentElement('afterend', feedback);
    else researchCard.appendChild(feedback);

    // Preserve the hidden source link before removing the legacy runbar. The fixed
    // export button and completion observers depend on this link remaining in the DOM.
    const exhaustiveLink = $id('siteResearchWord');
    if (exhaustiveLink) {
      exhaustiveLink.classList.add('fiq-export-source');
      const exportHost = $id('reportExportDock') || document.body;
      if (exhaustiveLink.parentElement !== exportHost) exportHost.appendChild(exhaustiveLink);
    }
    runbar?.remove();
    setTimeout(invalidateMovedMaps, 120);
    return true;
  }

  function invalidateMovedMaps() {
    try {
      if (typeof map !== 'undefined' && map?.invalidateSize) map.invalidateSize(false);
    } catch {}
    try {
      if (typeof aadtMap !== 'undefined' && aadtMap?.invalidateSize) aadtMap.invalidateSize(false);
    } catch {}
  }

  function combineMapSectionsFallback() {
    const mapElement = $id('map');
    const aadtMapElement = $id('aadtMap');
    if (!mapElement || !aadtMapElement || $id('mapAadtCard')) return;
    const mapCard = mapElement.closest('.card');
    const aadtCard = aadtMapElement.closest('.card');
    if (!mapCard || !aadtCard || mapCard === aadtCard) return;
    mapCard.id = 'mapAadtCard';
    mapCard.classList.add('fiq-map-card');
    const sourceLine = $id('aadtSourceLine');
    const tableWrap = $id('aadtTable')?.parentElement;
    const aadtPane = document.createElement('section');
    aadtPane.className = 'fiq-map-pane';
    aadtPane.innerHTML = '<div class="fiq-pane-label">Official AADT readings</div>';
    aadtPane.appendChild(aadtMapElement);
    const grid = document.createElement('div');
    grid.className = 'fiq-map-grid';
    const sitePane = document.createElement('section');
    sitePane.className = 'fiq-map-pane';
    while (mapCard.firstChild) sitePane.appendChild(mapCard.firstChild);
    grid.append(sitePane, aadtPane);
    mapCard.appendChild(grid);
    if (sourceLine) mapCard.prepend(sourceLine);
    if (tableWrap) mapCard.appendChild(tableWrap);
    aadtCard.remove();
    setTimeout(invalidateMovedMaps, 120);
  }

  function buildResultsCard() {
    const results = $id('siteResearchResults');
    const wrap = document.querySelector('.wrap');
    if (!results || !wrap) return null;
    let card = $id('siteResearchResultsCard');
    if (!card) {
      card = document.createElement('section');
      card.id = 'siteResearchResultsCard';
      card.className = 'card fiq-results-card';
      card.hidden = true;
      card.innerHTML = '<div class="fiq-results-head"><div><h2>Exhaustive Site Research Results</h2><p>Public records, ratings, development activity, traffic, competition, and market findings are consolidated below.</p></div><span class="fiq-results-badge">Research complete</span></div>';
      wrap.appendChild(card);
    }
    if (results.parentElement !== card) card.appendChild(results);
    return card;
  }

  function resultsHaveContent() {
    const results = $id('siteResearchResults');
    return Boolean(results && (results.textContent.trim() || results.children.length));
  }

  function hideResearchLoading() {
    const overlay = $id('siteResearchLoadingOverlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('fiq-research-busy');
  }

  function syncResultsState() {
    const card = buildResultsCard();
    const scrollButton = $id('scrollToResearchResults');
    const hasContent = resultsHaveContent();
    if (card) card.hidden = !hasContent;
    if (scrollButton) scrollButton.hidden = !hasContent;
    if (hasContent) hideResearchLoading();
  }

  function wireExportDock() {
    const dock = $id('reportExportDock') || document.querySelector('.footerbar');
    const basicButton = $id('exportPDF');
    const exhaustiveButton = $id('siteResearchWordButton');
    const exhaustiveLink = $id('siteResearchWord');
    const scrollButton = $id('scrollToResearchResults');
    if (!dock || !basicButton || !exhaustiveButton || !exhaustiveLink || !scrollButton) return false;

    basicButton.textContent = 'Export Basic Report to Word';
    exhaustiveLink.classList.add('fiq-export-source');
    if (exhaustiveLink.parentElement !== dock) dock.appendChild(exhaustiveLink);

    if (!exhaustiveButton.dataset.wired) {
      exhaustiveButton.dataset.wired = 'true';
      exhaustiveButton.addEventListener('click', () => {
        if (!exhaustiveButton.disabled) exhaustiveLink.click();
      });
    }
    if (!scrollButton.dataset.wired) {
      scrollButton.dataset.wired = 'true';
      scrollButton.addEventListener('click', () => {
        const card = $id('siteResearchResultsCard');
        if (card && !card.hidden) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const syncExport = () => {
      const href = String(exhaustiveLink.getAttribute('href') || '').trim();
      const ready = !exhaustiveLink.hidden && href && href !== '#';
      exhaustiveButton.disabled = !ready;
      exhaustiveButton.setAttribute('aria-disabled', ready ? 'false' : 'true');
      exhaustiveButton.title = ready ? 'Download the completed exhaustive Word report' : 'Run the exhaustive search before exporting this report';
    };
    new MutationObserver(syncExport).observe(exhaustiveLink, { attributes: true, attributeFilter: ['href', 'hidden'] });
    syncExport();
    return true;
  }

  function showResearchLoading() {
    const overlay = $id('siteResearchLoadingOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('fiq-research-busy');
    syncResearchLoadingMessage();
  }

  function syncResearchLoadingMessage() {
    const status = $id('siteResearchStatus');
    const progress = $id('siteResearchProgress');
    const message = $id('siteResearchLoadingMessage');
    const bar = $id('siteResearchLoadingBar');
    const text = String(status?.textContent || '').trim();
    if (message && text) message.textContent = text;
    if (bar) {
      const value = Number(progress?.value);
      bar.style.width = `${Number.isFinite(value) ? Math.max(8, Math.min(100, value)) : 18}%`;
    }
    if (/failed|unavailable|could not|expired/i.test(text)) hideResearchLoading();
    if (/complete/i.test(text) && resultsHaveContent()) hideResearchLoading();
  }

  function wireResearchLoading() {
    const runButton = $id('runSiteResearch');
    const status = $id('siteResearchStatus');
    const progress = $id('siteResearchProgress');
    const results = $id('siteResearchResults');
    if (!runButton || !status || !progress || !results) return false;

    if (!runButton.dataset.loadingWired) {
      runButton.dataset.loadingWired = 'true';
      runButton.addEventListener('click', () => {
        setTimeout(() => {
          const text = String(status.textContent || '');
          if (runButton.disabled || /starting|research|running|resuming/i.test(text)) showResearchLoading();
        }, 40);
      });
    }

    new MutationObserver(() => {
      syncResearchLoadingMessage();
      syncResultsState();
    }).observe(status, { childList: true, subtree: true, characterData: true });
    new MutationObserver(syncResearchLoadingMessage).observe(progress, { attributes: true, attributeFilter: ['value', 'hidden'] });
    new MutationObserver(syncResultsState).observe(results, { childList: true, subtree: true, characterData: true });

    const current = String(status.textContent || '');
    if (/resuming|starting|researching|running|cross-checking|synthesizing/i.test(current) || (!progress.hidden && Number(progress.value) < 100)) showResearchLoading();
    syncResultsState();
    return true;
  }

  function improveAadtStatus() {
    const status = $id('aadtChoiceStatus');
    if (!status || status.dataset.enhanced) return;
    status.dataset.enhanced = 'true';
    const sync = () => {
      const text = String(status.textContent || '');
      if (/No official reading was found/i.test(text)) {
        status.textContent = 'No official reading was returned after the expanded state and public ArcGIS search. Enter a custom AADT or retry the official-source search.';
      }
    };
    new MutationObserver(sync).observe(status, { childList: true, subtree: true, characterData: true });
    sync();
  }

  function initialize(attempt = 0) {
    ensureHiddenCompatibilityFields();
    combineMapSectionsFallback();
    const positioned = positionResearchUi();
    const exportReady = wireExportDock();
    const loadingReady = wireResearchLoading();
    const ready = positioned && exportReady && loadingReady;
    improveAadtStatus();
    syncResultsState();
    if (!ready && attempt < MAX_BOOT_ATTEMPTS) {
      setTimeout(() => initialize(attempt + 1), 50);
      return;
    }
    document.body.dataset.fiqProfessionalLayout = 'ready';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize(), { once: true });
  else initialize();
})();
