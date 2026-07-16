(() => {
  const companyInput = document.getElementById('companyName');
  const locationInput = document.getElementById('locationHint');
  const form = document.getElementById('researchForm');
  const researchButton = document.getElementById('researchButton');
  const panelDescription = document.querySelector('.panel-title p');
  if (!companyInput || !locationInput || !form || !researchButton) return;

  const LOOKUP_TIMEOUT_MS = 38000;
  const style = document.createElement('style');
  style.textContent = `
    .company-picker{position:relative}
    .company-search-help{font-size:11px;color:#6b7c8d;margin:7px 2px 0;line-height:1.4}
    .company-search-help.error{color:#a7352b}
    .company-results{display:none;position:absolute;z-index:40;left:0;right:0;top:calc(100% + 7px);background:#fff;border:1px solid #cdd9e3;border-radius:12px;box-shadow:0 18px 45px rgba(11,31,51,.19);max-height:390px;overflow:auto;padding:6px}
    .company-results.open{display:block}
    .company-result{display:block;width:100%;border:0;background:#fff;border-radius:9px;padding:11px 12px;text-align:left;cursor:pointer;color:#0b1f33}
    .company-result:hover,.company-result:focus{background:#eef6fb;outline:none}
    .company-result strong{display:block;font-size:13px;line-height:1.3}
    .company-result .company-address{display:block;color:#607283;font-size:11px;line-height:1.35;margin-top:3px}
    .company-result .company-description{display:block;color:#536779;font-size:10.5px;line-height:1.35;margin-top:4px}
    .company-result .company-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:6px;color:#738596;font-size:10px}
    .company-source,.company-kind{display:inline-block;padding:2px 6px;border-radius:999px;font-weight:750}
    .company-source{background:#e9f2f8;color:#235d84}
    .company-kind{background:#e8f7ef;color:#136b4c}
    .company-searching{padding:10px 12px;color:#647688;font-size:11px;border-bottom:1px solid #edf1f4}
    .company-empty{padding:14px 12px;color:#647688;font-size:11px;line-height:1.45}
    .company-selected{display:none;margin-top:9px;border:1px solid #a7d6bd;background:#eefaf3;border-radius:10px;padding:10px 11px;position:relative}
    .company-selected.open{display:block}
    .company-selected strong{display:block;color:#155e42;font-size:12px;padding-right:26px}
    .company-selected span{display:block;color:#4f6d60;font-size:10px;margin-top:3px;line-height:1.35}
    .company-clear{position:absolute;right:7px;top:6px;border:0;background:transparent;color:#537566;font-size:18px;cursor:pointer;line-height:1}
    .company-picker-required{border-color:#d3847e!important;box-shadow:0 0 0 4px rgba(180,35,24,.09)!important}
  `;
  document.head.appendChild(style);

  if (panelDescription) {
    panelDescription.textContent = 'Search distributor companies only—Fuel IQ excludes gas stations and store locations.';
  }
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
  help.textContent = 'Type at least 2 characters. Fuel IQ checks its corporate distributor index and live public sources.';
  picker.insertAdjacentElement('afterend', help);

  const selectedCard = document.createElement('div');
  selectedCard.className = 'company-selected';
  selectedCard.innerHTML = '<button class="company-clear" type="button" aria-label="Clear selected company">×</button><strong></strong><span></span>';
  help.insertAdjacentElement('afterend', selectedCard);

  let selectedCompany = null;
  let timer = null;
  let requestNumber = 0;
  let activeController = null;
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

  function clearSelection({ keepValue = true } = {}) {
    selectedCompany = null;
    selectedCard.classList.remove('open');
    companyInput.classList.remove('company-picker-required');
    locationInput.value = '';
    researchButton.disabled = true;
    researchButton.textContent = 'Select a Distributor Company to Research';
    if (!keepValue) companyInput.value = '';
  }

  function updateSelectedCard(item) {
    selectedCard.querySelector('strong').textContent = item.legal_name || item.name || companyInput.value;
    const details = [
      item.headquarters,
      item.parent_company ? `Parent: ${item.parent_company}` : '',
      item.website,
      'Corporate distributor',
    ].filter(Boolean).join(' • ');
    selectedCard.querySelector('span').textContent = details || 'Corporate distributor selected; headquarters will be confirmed during research.';
    selectedCard.classList.add('open');
  }

  function finishSelection(item) {
    selectedCompany = item;
    companyInput.value = item.legal_name || item.name || companyInput.value.trim();
    locationInput.value = item.headquarters || '';
    updateSelectedCard(item);
    companyInput.classList.remove('company-picker-required');
    researchButton.disabled = false;
    researchButton.textContent = 'Research Selected Distributor with ChatGPT';
    setHelp(item.headquarters
      ? 'Corporate distributor selected. Click the research button to start the report.'
      : 'Corporate distributor selected. Fuel IQ will confirm its headquarters during research.', false);
    closeResults();
  }

  function selectCompany(item) {
    if (!item) return;
    stopLookup();
    finishSelection(item);
  }

  window.fuelIqSelectDistributorCompany = selectCompany;

  function isCorporateResult(item) {
    if (!item || typeof item !== 'object') return false;
    const type = String(item.entity_type || '').toLowerCase();
    const source = String(item.source || '').toLowerCase();
    if (/gas_station|service_station|convenience_store|retail_location|store_location|travel_center|truck_stop|map_listing/.test(type)) return false;
    if (/openstreetmap|google places|amenity\s*\/\s*fuel|amenity=fuel/.test(source)) return false;
    return Boolean(item.legal_name || item.name);
  }

  function candidateButton(item, index) {
    const name = item.legal_name || item.name || 'Corporate distributor match';
    const address = item.headquarters || 'Corporate headquarters will be confirmed during research';
    const description = item.description || item.corporate_evidence || 'Corporate fuel distributor or petroleum marketer';
    const source = item.source || 'Corporate distributor search';
    const parent = item.parent_company ? `Parent: ${item.parent_company}` : '';
    return `<button class="company-result" type="button" role="option" data-company-index="${index}">
      <strong>${escapeHtml(name)}</strong>
      <span class="company-address">${escapeHtml(address)}</span>
      <span class="company-description">${escapeHtml(description)}</span>
      <span class="company-meta"><span class="company-kind">Corporate distributor</span><span class="company-source">${escapeHtml(source)}</span>${parent ? `<span>${escapeHtml(parent)}</span>` : ''}</span>
    </button>`;
  }

  function renderCandidates(candidates, query, { searching = false, lookupFailed = false, message = '' } = {}) {
    const valid = (Array.isArray(candidates) ? candidates : []).filter(isCorporateResult);
    const status = searching
      ? '<div class="company-searching">Searching the corporate distributor index and live company sources…</div>'
      : '';
    const rows = valid.map((item, index) => candidateButton(item, index)).join('');
    const empty = !valid.length && !searching
      ? `<div class="company-empty">${escapeHtml(message || `No corporate fuel distributor was verified for “${query}”. Try the legal name, DBA, parent company, or a location hint.`)}</div>`
      : '';

    results.innerHTML = `${status}${rows}${empty}`;
    results._companyCandidates = valid;
    openResults();

    if (searching && valid.length) {
      setHelp('Corporate index matches are shown now; Fuel IQ is still checking live public sources for aliases and additional distributors.', false);
    } else if (searching) {
      setHelp('Searching corporate distributor records. Gas stations, convenience stores, and map locations are excluded.', false);
    } else if (valid.length) {
      setHelp('Select the correct corporate distributor below. Individual stations and store locations are excluded.', false);
    } else {
      setHelp(message || (lookupFailed
        ? 'Live corporate search timed out. Try the legal name, DBA, parent company, or a location hint.'
        : 'No corporate distributor match was verified. Try another company name or alias.'), lookupFailed);
    }
  }

  async function fetchSearch(query, mode, signal) {
    const response = await fetch(`/api/distributors/search?q=${encodeURIComponent(query)}&location=&mode=${encodeURIComponent(mode)}`, {
      cache: 'no-store',
      signal,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`Corporate distributor search returned ${response.status}.`); }
    if (!response.ok || !data.ok) throw new Error(data.message || `Corporate distributor search failed (${response.status}).`);
    return data;
  }

  async function searchCompanies({ force = false } = {}) {
    const query = companyInput.value.trim();
    if (query.length < 2) {
      stopLookup();
      closeResults();
      setHelp('Type at least 2 characters to find a distributor company.', false);
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
    let directoryCandidates = [];

    try {
      try {
        const directory = await fetchSearch(query, 'directory', controller.signal);
        if (thisRequest !== requestNumber || selectedCompany) return;
        directoryCandidates = Array.isArray(directory.candidates) ? directory.candidates : [];
        if (directoryCandidates.length) renderCandidates(directoryCandidates, query, { searching: true });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }

      const exhaustive = await fetchSearch(query, 'exhaustive', controller.signal);
      if (thisRequest !== requestNumber || selectedCompany) return;
      const candidates = Array.isArray(exhaustive.candidates) ? exhaustive.candidates : directoryCandidates;
      renderCandidates(candidates, query, {
        lookupFailed: Boolean(exhaustive.partial && !candidates.length),
        message: exhaustive.message || '',
      });
    } catch (error) {
      if (thisRequest !== requestNumber || selectedCompany) return;
      const timedOut = error?.name === 'AbortError';
      renderCandidates(directoryCandidates, query, {
        lookupFailed: timedOut,
        message: directoryCandidates.length
          ? 'Live verification was unavailable; showing corporate distributor-index matches.'
          : (timedOut
            ? 'Live corporate search timed out. Try the legal name, DBA, parent company, or a location hint.'
            : 'Corporate distributor search could not be completed.'),
      });
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
    timer = setTimeout(() => searchCompanies(), 400);
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
          description: 'Fuel IQ corporate distributor example',
          confidence: 'Preset corporate distributor',
          source: 'Fuel IQ example',
          entity_type: 'corporate_distributor',
        });
      }, 0);
    }
  });

  form.addEventListener('submit', event => {
    if (selectedCompany && !researchButton.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    companyInput.classList.add('company-picker-required');
    setHelp('Select a corporate distributor result before starting research.', true);
    searchCompanies({ force: true });
    companyInput.focus();
  }, true);

  const newSearchButton = document.getElementById('newSearchButton');
  if (newSearchButton) newSearchButton.addEventListener('click', () => {
    stopLookup();
    clearSelection({ keepValue: true });
  });
})();
