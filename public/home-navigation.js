(() => {
  'use strict';

  let applying = false;
  let timer = null;

  function applyNavigation() {
    if (applying) return;
    applying = true;
    try {
      const header = document.querySelector('header');
      if (!header) return;

      [...header.querySelectorAll('a')].forEach((link) => {
        const text = String(link.textContent || '').trim();
        const href = String(link.getAttribute('href') || '');
        if (/^PA AADT Map$/i.test(text) || /PA_Signals_AADT_Radius_Map/i.test(href)) link.remove();
      });

      let distributor = document.getElementById('fuelDistributorIntelligenceTop');
      if (!distributor) {
        distributor = document.createElement('a');
        distributor.id = 'fuelDistributorIntelligenceTop';
        distributor.className = 'fuel-distributor-top-link';
        distributor.href = '/distributors.html';
        distributor.textContent = 'Distributor Intelligence';
        distributor.setAttribute('aria-label', 'Open Distributor Intelligence');
        header.appendChild(distributor);
      }

      let atlas = document.getElementById('fuelLocationAtlasTop');
      if (!atlas) {
        atlas = document.createElement('a');
        atlas.id = 'fuelLocationAtlasTop';
        atlas.className = 'fuel-distributor-top-link';
        atlas.href = '/fuel-atlas.html';
        atlas.textContent = 'Fuel Location Atlas';
        atlas.setAttribute('aria-label', 'Open Fuel Location Atlas');
      }

      if (distributor.nextElementSibling !== atlas) distributor.insertAdjacentElement('afterend', atlas);
    } finally {
      applying = false;
    }
  }

  function schedule() {
    if (timer !== null || applying) return;
    timer = window.setTimeout(() => {
      timer = null;
      applyNavigation();
    }, 20);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyNavigation, { once: true });
  else applyNavigation();
})();
