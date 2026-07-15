(() => {
  const companyInput = document.getElementById('companyName');
  const locationInput = document.getElementById('locationHint');
  const form = document.getElementById('researchForm');
  const researchButton = document.getElementById('researchButton');
  const panelDescription = document.querySelector('.panel-title p');
  if (!companyInput || !locationInput || !form || !researchButton) return;

  const LOOKUP_TIMEOUT_MS = 9000;
  const style = document.createElement('style');
  style.textContent = `
    .company-picker{position:relative}
    .company-search-help{font-size:11px;color:#6b7c8d;margin:7px 2px 0;line-height:1.4}
    .company-search-help.error{color:#a7352b}
    .company-results{display:none;position:absolute;z-index:40;left:0;right:0;top:calc(100% + 7px);background:#fff;border:1px solid #cdd9e3;border-radius:12px;box-shadow:0 18px 45px rgba(11,31,51,.19);max-height:360px;overflow:auto;padding:6px}
    .company-results.open{display:block}
    .company-result{display:block;width:100%;border:0;background:#fff;border-radius:9px;padding:11px 12px;text-align:left;cursor:pointer;color:#0b1f33}
    .company-result:hover,.company-result:focus{background:#eef6fb;outline:none}
    .company-result strong{display:block;font-size:13px;line-height:1.3}
    .company-result .company-address{display:block;color:#607283;font-size:11px;line-height:1.35;margin-top:3px}
    .company-result .company-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:5px;color:#738596;font-size:10px}
    .company-source{display:inline-block;padding:2px 6px;border-radius:999px;background:#e9f2f8;color:#235d84;font-weight:750}
    .company-manual{border-top:1px solid #e1e8ee;margin-top:4px;padding-top:8px}
    .company-searching{padding:10px 12px;color:#647688;font-size:11px;border-bottom:1px solid #edf1f4}
    .company-selected{display:none;margin-top:9px;border:1px solid #a7d6bd;background:#eefaf3;border-radius:10px;padding:10px 11px;position:relative}
    .company-selected.open{display:block}
    .company-selected strong{display:block;color:#155e42;font-size:12px;padding-right:26px}
    .company-selected span{display:block;color:#4f6d60;font-size:10px;margin-top:3px;line-height:1.35}
    .company-clear{position:absolute;right:7px;top:6px;border:0;background:transparent;color:#537566;font-size:18px;cursor:pointer;line-height:1}
    .company-picker-required{border-color:#d3847e!important;box-shadow:0 0 0 4px rgba(180,35,24,.09)!important}
  `;
  document.head.appendChild(style);

  if (panelDescription) panelDescription.textContent = 'Start typing, then select the correct company from the matches.';
  companyInput.setAttribute('autocomplete', 'off');
  companyInput.setAttribute('aria-autocomplete', 'list');
  companyInput.setAttribute('aria-expanded', 'false');

  const originalParent = companyInput.parentNode;
  const picker = document.createElement('div');
  picker.className = 'company-picker';
  originalParent.insertBefore(picker, companyInput);
  picker.appendChild(companyInput);

  const results = document.createElement('div');
  results.id = 'companySearchResults';
  results.className = 'company-results';
  results.setAttribute('role', 'listbox');
  picker.appendChild(results);

  const help = document.createElement('div');
  help.className = 'company-search-help';
  help.textContent = 'Type at least 2 characters. Fuel IQ will identify the company and headquarters automatically.';
  picker.insertAdjacentElement('afterend', help);

  const selectedCard = document.createElement('div');
  selectedCard.className = 'company-selected';
  selectedCard.innerHTML = '<button class="company-clear" type="button" aria-label="Clear selected company">×</button><strong></strong><span></span>';
  help.insertAdjacentElement('afterend', selectedCard);

  let selectedCompany = null;
  let timer = null;
  let requestNumber = 0;
  let activeController = null;
  let enrichmentController = null;
  let lastSearched = '';

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>\'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
  }

  function closeResults() {
    results.classList.remove('open');
    companyInput.setAttribute('aria-expanded', 'false');
  }

  function openResults() {
    results.classList.add('open');
    companyInput.setAttribute('aria-expanded', 'true');
  }

  function setHelp(message, isError = false) {
    help.textContent = message;
    help.classList.toggle('error', isError);
  }

  function stopLookup() {
    requestNumber += 1;
    if (activeController) activeController.abort();
    activeController = null;
  }

  function stopEnrichment() {
    if (enrichmentController) enrichmentController.abort();
    enrichmentController = null;
  }

  function clearSelection({ keepValue = true } = {}) {
    stopEnrichment();
    selectedCompany = null;
    selectedCard.classList.remove('open');
    companyInput.classList.remove('company-picker-required');
    locationInput.value = '';
    researchButton.disabled = true;
    researchButton.textContent = 'Select a Company to Research';
    if (!keepValue) companyInput.value = '';
  }

  function updateSelectedCard(item, fallback = 'Selected company identity') {
    selectedCard.querySelector('strong').textContent = item.legal_name || item.name || companyInput.value;
    const details = [item.headquarters, item.website, item.source].filter(Boolean).join(' • ');
    selectedCard.querySelector('span').textContent = details || fallback;
    selectedCard.classList.add('open');
  }

  function finishSelection(item) {
    selectedCompany = item;
    companyInput.value = item.legal_name || item.name || companyInput.value.trim();
    locationInput.value = item.headquarters || '';
    updateSelectedCard(item, 'Company selected; headquarters will be identified during research.');
    companyInput.classList.remove('company-picker-required');
    researchButton.disabled = false;
    researchButton.textContent = 'Research Selected Company with ChatGPT';
    setHelp(item.headquarters
      ? 'Company and headquarters selected automatically. Click the research button to start the report.'
      : 'Company selected. Fuel IQ will identify the headquarters during research.', false);
    closeResults();
  }

  async function enrichManualSelection(item) {
    stopEnrichment();
    const controller = new AbortController();
    enrichmentController = controller;
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    researchButton.disabled = true;
    researchButton.textContent = 'Finding Company Headquarters…';
    updateSelectedCard(item, 'Finding company headquarters automatically…');
    setHelp('Finding the company headquarters automatically…', false);

    try {
      const query = item.legal_name || item.name || companyInput.value.trim();
      const response = await fetch(`/api/distributors/search?q=${encodeURIComponent(query)}&location=`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Company search returned ${response.status}.`); }
      if (!response.ok || !data.ok) throw new Error(data.message || `Company search failed (${response.status}).`);
      if (selectedCompany !== item) return;

      const match = (Array.isArray(data.candidates) ? data.candidates : []).find((candidate) => candidate?.headquarters) || null;
      if (match) {
        finishSelection({
          ...item,
          legal_name: match.legal_name || match.name || item.legal_name,
          name: match.name || item.name,
          headquarters: match.headquarters,
          website: match.website || '',
          source: match.source || 'Public company lookup',
          manual: false,
        });
      } else {
        finishSelection(item);
      }
    } catch (error) {
      if (selectedCompany !== item) return;
      finishSelection(item);
    } finally {
      clearTimeout(timeout);
      if (enrichmentController === controller) enrichmentController = null;
    }
  }

  function selectCompany(item) {
    if (!item) return;
    stopLookup();
    stopEnrichment();
    selectedCompany = item;
    companyInput.value = item.legal_name || item.name || companyInput.value.trim();
    locationInput.value = item.headquarters || '';
    companyInput.classList.remove('company-picker-required');
    closeResults();

    if (item.manual && !item.headquarters) {
      enrichManualSelection(item);
      return;
    }

    finishSelection(item);
  }

  window.fuelIqSelectDistributorCompany = selectCompany;

  function manualCandidate(query) {
    return {
      name: query,
      legal_name: query,
      headquarters: '',
      website: '',
      description: 'Use this exact company name; Fuel IQ will find the headquarters automatically',
      confidence: 'Exact-name selection',
      source: 'Exact name entered',
      manual: true,
    };
  }

  function candidateButton(item, index) {
    const name = item.legal_name || item.name || 'Company match';
    const address = item.headquarters || (item.manual ? 'Headquarters will be found automatically' : 'Headquarters not identified');
    const description = item.description || item.confidence || '';
    return `<button class="company-result" type="button" role="option" data-company-index="${index}">
      <strong>${escapeHtml(name)}</strong>
      <span class="company-address">${escapeHtml(address)}</span>
      <span class="company-meta"><span class="company-source">${escapeHtml(item.source || 'Public search')}</span><span>${escapeHtml(description)}</span></span>
    </button>`;
  }

  function renderCandidates(candidates, query, { searching = false, lookupFailed = false } = {}) {
    const valid = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const manual = manualCandidate(query);
    const all = [...valid, manual];
    const rows = valid.map((item, index) => candidateButton(item, index)).join('');
    const manualIndex = valid.length;
    results.innerHTML = `${searching ? '<div class="company-searching">Checking public company matches and headquarters…</div>' : ''}
      ${rows}
      <div class="company-manual">${candidateButton(manual, manualIndex)}</div>`;
    results._companyCandidates = all;
    openResults();
    if (searching) {
      setHelp('Select a public match, or use the exact-name option and Fuel IQ will find the headquarters automatically.', false);
    } else if (valid.length) {
      setHelp('Select the correct company below. Its headquarters will be used automatically.', false);
    } else {
      setHelp(lookupFailed
        ? 'Public lookup timed out. Select the exact-name option and Fuel IQ will continue identifying the headquarters.'
        : 'No separate public match was found. Select the exact-name option to continue.', lookupFailed);
    }
  }

  async function searchCompanies({ force = false } = {}) {
    const query = companyInput.value.trim();
    if (query.length < 2) {
      stopLookup();
      closeResults();
      setHelp('Type at least 2 characters to find the company.', false);
      return;
    }
    if (!force && query === lastSearched && results._companyCandidates?.length) {
      openResults();
      return;
    }

    stopLookup();
    lastSearched = query;
    const thisRequest = requestNumber;
    renderCandidates([], query, { searching: true });

    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/distributors/search?q=${encodeURIComponent(query)}&location=`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Company search returned ${response.status}.`); }
      if (thisRequest !== requestNumber || selectedCompany) return;
      if (!response.ok || !data.ok) throw new Error(data.message || `Company search failed (${response.status}).`);
      renderCandidates(data.candidates, query);
    } catch (error) {
      if (thisRequest !== requestNumber || selectedCompany) return;
      const timedOut = error?.name === 'AbortError';
      renderCandidates([], query, { lookupFailed: timedOut });
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) activeController = null;
    }
  }

  clearSelection();

  companyInput.addEventListener('input', () => {
    if (selectedCompany && companyInput.value.trim() === (selectedCompany.legal_name || selectedCompany.name || '').trim()) return;
    clearSelection({ keepValue: true });
    clearTimeout(timer);
    const query = companyInput.value.trim();
    if (query.length >= 2) renderCandidates([], query, { searching: true });
    timer = setTimeout(() => searchCompanies(), 350);
  });

  companyInput.addEventListener('focus', () => {
    if (!selectedCompany && companyInput.value.trim().length >= 2) searchCompanies();
  });

  results.addEventListener('click', event => {
    const button = event.target.closest('[data-company-index]');
    if (!button) return;
    const item = results._companyCandidates?.[Number(button.dataset.companyIndex)];
    if (item) selectCompany(item);
  });

  selectedCard.querySelector('.company-clear').addEventListener('click', () => {
    clearSelection({ keepValue: true });
    companyInput.focus();
    searchCompanies({ force: true });
  });

  document.addEventListener('click', event => {
    if (!picker.contains(event.target)) closeResults();
    const chip = event.target.closest('.chip');
    if (chip) {
      setTimeout(() => {
        const name = chip.dataset.company || companyInput.value.trim();
        const headquarters = chip.dataset.location || '';
        if (!name) return;
        companyInput.value = name;
        selectCompany({
          name,
          legal_name: name,
          headquarters,
          website: '',
          description: 'Fuel IQ example company',
          confidence: 'Preset company',
          source: 'Fuel IQ example',
          prefer_headquarters: true,
        });
      }, 0);
    }
  });

  form.addEventListener('submit', event => {
    if (selectedCompany && !researchButton.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (selectedCompany && researchButton.disabled) {
      setHelp('Fuel IQ is still finding the company headquarters. The research button will unlock automatically.', false);
      return;
    }
    companyInput.classList.add('company-picker-required');
    setHelp('Select a company result before starting research.', true);
    searchCompanies({ force: true });
    companyInput.focus();
  }, true);

  const newSearchButton = document.getElementById('newSearchButton');
  if (newSearchButton) newSearchButton.addEventListener('click', () => {
    stopLookup();
    clearSelection({ keepValue: true });
  });
})();
