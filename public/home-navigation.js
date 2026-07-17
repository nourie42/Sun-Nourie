(() => {
  'use strict';

  let applying = false;
  let timer = null;

  function ensureStyles() {
    if (document.getElementById('maProspectorNavigationStyles')) return;
    const style = document.createElement('style');
    style.id = 'maProspectorNavigationStyles';
    style.textContent = `
      #fuelLocationAtlasTop.ma-prospector-top-link {
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        min-height:46px!important;
        padding:11px 20px!important;
        border:2px solid #ffe08a!important;
        border-radius:12px!important;
        background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 55%,#ea580c 100%)!important;
        color:#071522!important;
        font-size:16px!important;
        font-weight:950!important;
        letter-spacing:.01em!important;
        text-decoration:none!important;
        white-space:nowrap!important;
        box-shadow:0 0 0 3px rgba(251,191,36,.18),0 10px 26px rgba(245,158,11,.38)!important;
        transform:translateY(0);
        transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;
      }
      #fuelLocationAtlasTop.ma-prospector-top-link:hover,
      #fuelLocationAtlasTop.ma-prospector-top-link:focus-visible {
        transform:translateY(-2px)!important;
        filter:brightness(1.08)!important;
        box-shadow:0 0 0 4px rgba(251,191,36,.28),0 14px 32px rgba(245,158,11,.48)!important;
        outline:none!important;
      }
      @media(max-width:720px) {
        #fuelLocationAtlasTop.ma-prospector-top-link {
          min-height:42px!important;
          padding:9px 14px!important;
          font-size:14px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function removeAadtQuickLinks() {
    document.querySelectorAll('.aadt-tabs, nav[aria-label*="AADT" i]').forEach((element) => element.remove());
  }

  function applyNavigation() {
    if (applying) return;
    applying = true;
    try {
      ensureStyles();
      removeAadtQuickLinks();

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
        atlas.href = '/fuel-atlas.html';
      }
      atlas.className = 'ma-prospector-top-link';
      atlas.textContent = 'M&A Prospector';
      atlas.setAttribute('aria-label', 'Open M&A Prospector');
      atlas.setAttribute('title', 'Open M&A Prospector');

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
