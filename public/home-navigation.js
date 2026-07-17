(() => {
  'use strict';

  let applying = false;
  let timer = null;

  function ensureStyles() {
    if (document.getElementById('maProspectorNavigationStyles')) return;
    const style = document.createElement('style');
    style.id = 'maProspectorNavigationStyles';
    style.textContent = `
      #fuelDistributorIntelligenceTop.fiq-matched-tool-link,
      #fuelLocationAtlasTop.fiq-matched-tool-link {
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        min-width:286px!important;
        min-height:76px!important;
        padding:14px 26px!important;
        border:2px solid #ffe08a!important;
        border-radius:20px!important;
        background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 55%,#ea580c 100%)!important;
        color:#071522!important;
        font-size:24px!important;
        font-weight:950!important;
        line-height:1!important;
        letter-spacing:.01em!important;
        text-decoration:none!important;
        text-align:center!important;
        white-space:nowrap!important;
        box-shadow:0 0 0 3px rgba(251,191,36,.18),0 10px 26px rgba(245,158,11,.38)!important;
        transform:translateY(0);
        transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;
      }
      #fuelDistributorIntelligenceTop.fiq-matched-tool-link:hover,
      #fuelDistributorIntelligenceTop.fiq-matched-tool-link:focus-visible,
      #fuelLocationAtlasTop.fiq-matched-tool-link:hover,
      #fuelLocationAtlasTop.fiq-matched-tool-link:focus-visible {
        transform:translateY(-2px)!important;
        filter:brightness(1.08)!important;
        box-shadow:0 0 0 4px rgba(251,191,36,.28),0 14px 32px rgba(245,158,11,.48)!important;
        outline:none!important;
      }
      .fiq-map-grid.fiq-single-map-layout {
        grid-template-columns:minmax(0,1fr)!important;
      }
      .fiq-map-grid.fiq-single-map-layout > .fiq-map-pane:first-child {
        width:100%!important;
        max-width:none!important;
        grid-column:1/-1!important;
      }
      .fiq-map-grid.fiq-single-map-layout #map,
      .fiq-map-grid.fiq-single-map-layout #svWrap,
      .fiq-map-grid.fiq-single-map-layout #sv {
        width:100%!important;
        max-width:none!important;
      }
      .fiq-map-grid.fiq-single-map-layout #sv {
        min-height:390px!important;
      }
      .fiq-aadt-map-hidden {
        display:none!important;
      }
      @media(max-width:720px) {
        #fuelDistributorIntelligenceTop.fiq-matched-tool-link,
        #fuelLocationAtlasTop.fiq-matched-tool-link {
          min-width:0!important;
          width:100%!important;
          min-height:54px!important;
          padding:11px 15px!important;
          border-radius:14px!important;
          font-size:17px!important;
        }
        .fiq-map-grid.fiq-single-map-layout #sv {
          min-height:320px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function removeAadtQuickLinks() {
    document.querySelectorAll('.aadt-tabs, nav[aria-label*="AADT" i]').forEach((element) => element.remove());
  }

  function applySingleMapLayout() {
    const aadtMap = document.getElementById('aadtMap');
    const mapGrid = document.querySelector('.fiq-map-grid');
    const mainMapPane = mapGrid?.querySelector('.fiq-map-pane:first-child');
    const aadtPane = aadtMap?.closest('.fiq-map-pane');

    if (mapGrid) mapGrid.classList.add('fiq-single-map-layout');
    if (mainMapPane) {
      mainMapPane.style.width = '100%';
      mainMapPane.style.maxWidth = 'none';
    }
    if (aadtPane && aadtPane !== mainMapPane) {
      aadtPane.classList.add('fiq-aadt-map-hidden');
      aadtPane.setAttribute('aria-hidden', 'true');
    }

    const streetViewWrap = document.getElementById('svWrap');
    const streetView = document.getElementById('sv');
    if (streetViewWrap) streetViewWrap.style.width = '100%';
    if (streetView) streetView.style.width = '100%';
  }

  function applyNavigation() {
    if (applying) return;
    applying = true;
    try {
      ensureStyles();
      removeAadtQuickLinks();
      applySingleMapLayout();

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
        distributor.href = '/distributors.html';
        distributor.textContent = 'Distributor Intelligence';
        distributor.setAttribute('aria-label', 'Open Distributor Intelligence');
        header.appendChild(distributor);
      }
      distributor.className = 'fiq-matched-tool-link';
      distributor.href = '/distributors.html';
      distributor.textContent = 'Distributor Intelligence';
      distributor.setAttribute('title', 'Open Distributor Intelligence');

      let atlas = document.getElementById('fuelLocationAtlasTop');
      if (!atlas) {
        atlas = document.createElement('a');
        atlas.id = 'fuelLocationAtlasTop';
        atlas.href = '/fuel-atlas.html';
      }
      atlas.className = 'fiq-matched-tool-link';
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