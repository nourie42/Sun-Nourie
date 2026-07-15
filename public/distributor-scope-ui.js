(() => {
  const locationInput = document.getElementById('locationHint');
  const researchFocus = document.getElementById('researchFocus');
  const researchButton = document.getElementById('researchButton');
  const form = document.getElementById('researchForm');
  if (!locationInput || !researchFocus || !researchButton || !form) return;

  const style = document.createElement('style');
  style.textContent = `
    .hero{padding-top:18px!important;padding-bottom:52px!important}
    .hero p{margin-top:0!important}
    .research-scope{margin:17px 0 0;padding:0;border:0}
    .research-scope>legend{font-size:12px;font-weight:800;color:#34495b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.055em}
    .scope-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .scope-mode{position:relative;display:block;margin:0;text-transform:none;letter-spacing:0;font-weight:inherit;cursor:pointer}
    .scope-mode input{position:absolute;opacity:0;pointer-events:none}
    .scope-mode-card{display:block;border:1px solid #d7e0e8;border-radius:11px;padding:11px 12px;background:#fbfdff;min-height:72px;transition:.15s}
    .scope-mode-card strong{display:block;font-size:13px;color:#18344d;margin-bottom:3px}
    .scope-mode-card span{display:block;font-size:10px;color:#6b7c8d;line-height:1.35}
    .scope-mode input:checked+.scope-mode-card{border-color:#2d7fb8;background:#eef7fc;box-shadow:0 0 0 3px rgba(45,127,184,.10)}
    .scope-options{display:none;margin-top:10px;border:1px solid #d7e0e8;border-radius:11px;padding:10px;background:#fbfdff;grid-template-columns:1fr 1fr;gap:7px}
    .scope-options.open{display:grid}
    .scope-option{display:flex;gap:7px;align-items:flex-start;margin:0;text-transform:none;letter-spacing:0;font-size:11px;font-weight:650;color:#34495b;cursor:pointer}
    .scope-option input{width:auto;margin:2px 0 0;box-shadow:none}
    .scope-note{font-size:10px;color:#738292;margin:8px 2px 0;line-height:1.35}
    @media(max-width:520px){.scope-modes,.scope-options{grid-template-columns:1fr}.hero{padding-top:12px!important;padding-bottom:46px!important}}
  `;
  document.head.appendChild(style);

  document.querySelector('label[for="locationHint"]')?.remove();
  document.querySelector('label[for="researchFocus"]')?.remove();
  locationInput.type = 'hidden';
  researchFocus.hidden = true;

  const categories = [
    ['identity', 'Company, ownership & history'],
    ['financials', 'Revenue, gallons & valuation'],
    ['sites', 'Sites, customers & brands'],
    ['markets', 'Markets, terminals & suppliers'],
    ['fleet', 'Fleet, drivers & safety'],
    ['leadership', 'Leadership & decision makers'],
    ['regulatory', 'Licensing, environmental & legal'],
    ['risk', 'Risks, opportunities & diligence'],
  ];

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'research-scope';
  fieldset.innerHTML = `
    <legend>Research depth</legend>
    <div class="scope-modes">
      <label class="scope-mode">
        <input type="radio" name="distributorScopeMode" value="full" checked>
        <span class="scope-mode-card"><strong>Full Search</strong><span>Exhaustive research across every category. Recommended.</span></span>
      </label>
      <label class="scope-mode">
        <input type="radio" name="distributorScopeMode" value="limited">
        <span class="scope-mode-card"><strong>Limited Search</strong><span>Select only the categories needed for a faster report.</span></span>
      </label>
    </div>
    <div class="scope-options" id="distributorScopeOptions">
      ${categories.map(([value, label], index) => `<label class="scope-option"><input type="checkbox" value="${value}" ${index < 3 ? 'checked' : ''}><span>${label}</span></label>`).join('')}
    </div>
    <p class="scope-note" id="distributorScopeNote">Full Search is selected and will research all available public-source categories.</p>
  `;
  researchButton.parentNode.insertBefore(fieldset, researchButton);

  const options = fieldset.querySelector('#distributorScopeOptions');
  const note = fieldset.querySelector('#distributorScopeNote');
  const radios = [...fieldset.querySelectorAll('input[name="distributorScopeMode"]')];
  const checks = [...fieldset.querySelectorAll('.scope-options input[type="checkbox"]')];

  function updateFocus() {
    const mode = radios.find((radio) => radio.checked)?.value || 'full';
    if (mode === 'full') {
      options.classList.remove('open');
      researchFocus.value = 'FULL SEARCH: Research every available category exhaustively, including identity, ownership, financial estimates, gallons, sites, customers, brands, markets, terminals, fleet, leadership, licensing, environmental and legal records, risks, opportunities, and acquisition diligence.';
      note.textContent = 'Full Search is selected and will research all available public-source categories.';
      return;
    }

    options.classList.add('open');
    if (!checks.some((check) => check.checked)) checks[0].checked = true;
    const selected = checks.filter((check) => check.checked).map((check) => categories.find(([value]) => value === check.value)?.[1]).filter(Boolean);
    researchFocus.value = `LIMITED SEARCH: Research only these selected categories: ${selected.join('; ')}. Still confirm the company identity and include attributable public sources. Leave unselected report sections empty.`;
    note.textContent = `Limited Search will cover ${selected.length} selected categor${selected.length === 1 ? 'y' : 'ies'}.`;
  }

  radios.forEach((radio) => radio.addEventListener('change', updateFocus));
  checks.forEach((check) => check.addEventListener('change', updateFocus));
  updateFocus();

  window.fuelIqDistributorScope = {
    mode: () => radios.find((radio) => radio.checked)?.value || 'full',
    selected: () => checks.filter((check) => check.checked).map((check) => check.value),
    update: updateFocus,
  };
})();
