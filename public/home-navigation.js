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
        min-width:0!important;
        min-height:46px!important;
        padding:11px 18px!important;
        border:2px solid #ffe08a!important;
        border-radius:12px!important;
        background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 55%,#ea580c 100%)!important;
        color:#071522!important;
        font-size:16px!important;
        font-weight:900!important;
        line-height:1.1!important;
        letter-spacing:.01em!important;
        text-decoration:none!important;
        text-align:center!important;
        white-space:nowrap!important;
        box-shadow:0 0 0 2px rgba(251,191,36,.14),0 8px 20px rgba(245,158,11,.28)!important;
        transform:translateY(0);
        transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;
      }
      #fuelDistributorIntelligenceTop.fiq-matched-tool-link:hover,
      #fuelDistributorIntelligenceTop.fiq-matched-tool-link:focus-visible,
      #fuelLocationAtlasTop.fiq-matched-tool-link:hover,
      #fuelLocationAtlasTop.fiq-matched-tool-link:focus-visible {
        transform:translateY(-1px)!important;
        filter:brightness(1.06)!important;
        box-shadow:0 0 0 3px rgba(251,191,36,.22),0 10px 24px rgba(245,158,11,.34)!important;
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
      #gptSummaryPanel {
        margin:16px 0 4px!important;
        padding:15px 16px!important;
        border:1px solid #c8dbe8!important;
        border-radius:12px!important;
        background:linear-gradient(180deg,#f5fbff,#eef7fc)!important;
        color:#20384b!important;
      }
      #gptSummaryPanel strong {
        display:block!important;
        margin-bottom:7px!important;
        color:#123f62!important;
        font-size:13px!important;
        letter-spacing:.04em!important;
        text-transform:uppercase!important;
      }
      #gptSummaryPanel #summary {
        color:#39566b!important;
        font-size:14px!important;
        line-height:1.55!important;
      }
      @media(max-width:720px) {
        #fuelDistributorIntelligenceTop.fiq-matched-tool-link,
        #fuelLocationAtlasTop.fiq-matched-tool-link {
          width:auto!important;
          min-height:42px!important;
          padding:9px 13px!important;
          border-radius:11px!important;
          font-size:14px!important;
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

  function limitAadtTableToFive() {
    const body = document.querySelector('#aadtTable tbody');
    if (!body) return;
    const rows = [...body.querySelectorAll('tr')];
    if (!rows.length) return;

    const distance = (row) => {
      const match = String(row.cells?.[0]?.textContent || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
    };
    rows.sort((a, b) => distance(a) - distance(b));
    rows.forEach((row) => body.appendChild(row));
    rows.slice(5).forEach((row) => row.remove());
  }

  function moveGptSummaryBelowEstimate() {
    const estimateCard = document.getElementById('estimateCard');
    const summary = document.getElementById('summary');
    if (!estimateCard || !summary) return;

    let panel = document.getElementById('gptSummaryPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'gptSummaryPanel';
      panel.innerHTML = '<strong>GPT Summary</strong>';
      const hero = estimateCard.querySelector('.hero');
      if (hero) hero.insertAdjacentElement('afterend', panel);
      else estimateCard.prepend(panel);
    }
    if (summary.parentElement !== panel) panel.appendChild(summary);

    const oldCard = [...document.querySelectorAll('.card')].find((card) =>
      card !== estimateCard && card.contains(summary) && card !== panel
    );
    if (oldCard && oldCard !== estimateCard) oldCard.remove();

    document.querySelectorAll('.card').forEach((card) => {
      if (card === estimateCard) return;
      const title = String(card.textContent || '').trim();
      if (/^Summary \(GPT\)/i.test(title) && !card.contains(summary)) card.remove();
    });
  }

  function applyNavigation() {
    if (applying) return;
    applying = true;
    try {
      ensureStyles();
      removeAadtQuickLinks();
      applySingleMapLayout();
      limitAadtTableToFive();
      moveGptSummaryBelowEstimate();

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