(() => {
  const $id = (id) => document.getElementById(id);
  const READY_TEXT = "Address search ready — type an address";

  function installStyles() {
    if ($id("siteAddressSafetyStyles")) return;
    const style = document.createElement("style");
    style.id = "siteAddressSafetyStyles";
    style.textContent = `
      #addr {
        position: relative !important;
        z-index: 2 !important;
        pointer-events: auto !important;
      }

      .fiq-export-dock {
        pointer-events: none !important;
        padding: 8px 12px !important;
        border-top: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
      }

      .fiq-export-dock-inner {
        pointer-events: none !important;
        justify-content: flex-end !important;
      }

      .fiq-export-copy {
        display: none !important;
      }

      .fiq-export-actions {
        pointer-events: auto !important;
        width: auto !important;
        max-width: calc(100vw - 24px) !important;
        padding: 7px !important;
        border: 1px solid rgba(12, 38, 59, .12) !important;
        border-radius: 12px !important;
        background: rgba(255, 255, 255, .97) !important;
        box-shadow: 0 8px 24px rgba(9, 30, 49, .13) !important;
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
      }

      .fiq-export-actions button {
        flex: 0 0 auto !important;
      }

      body.fiq-dock-overlaps-address .fiq-export-actions {
        pointer-events: none !important;
        opacity: .42 !important;
        transform: translateY(58%) !important;
      }

      @media (max-height: 820px) {
        body.fiq-professional-layout {
          padding-bottom: 76px !important;
          background: linear-gradient(180deg, #071522 0 300px, var(--fiq-soft) 300px 100%) !important;
        }

        .fiq-topbar {
          min-height: 70px !important;
        }

        .fiq-intro {
          min-height: 190px !important;
          padding: 22px 0 26px !important;
        }

        .fiq-intro h1 {
          margin: 8px 0 10px !important;
          font-size: clamp(34px, 4.2vw, 54px) !important;
          line-height: 1 !important;
        }

        .fiq-intro > p {
          font-size: 16px !important;
          line-height: 1.45 !important;
        }

        .fiq-intro .aadt-tabs {
          margin-top: 14px !important;
        }
      }

      @media (max-width: 700px) {
        .fiq-export-dock {
          padding: 6px !important;
        }

        .fiq-export-actions {
          gap: 6px !important;
        }

        .fiq-export-actions button {
          padding: 9px 10px !important;
          font-size: 11px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setAddressReady() {
    const input = $id("addr");
    if (input) {
      input.disabled = false;
      input.readOnly = false;
      input.removeAttribute("aria-disabled");
      input.tabIndex = 0;
      input.style.pointerEvents = "auto";
    }

    const status = $id("apiStatus");
    if (status && (!status.textContent.trim() || /checking/i.test(status.textContent))) {
      status.textContent = READY_TEXT;
    }

    const quickEstimate = $id("go");
    if (quickEstimate && quickEstimate.textContent.trim() === "Estimate") {
      quickEstimate.textContent = "Quick Estimate";
    }
  }

  function syncDockOverlap() {
    const input = $id("addr");
    const dock = $id("reportExportDock");
    if (!input || !dock) {
      document.body.classList.remove("fiq-dock-overlaps-address");
      return;
    }

    const a = input.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const overlaps = a.width > 0 && a.height > 0 && d.width > 0 && d.height > 0 &&
      a.left < d.right && a.right > d.left && a.top < d.bottom && a.bottom > d.top;
    document.body.classList.toggle("fiq-dock-overlaps-address", overlaps);
  }

  function initialize() {
    installStyles();
    setAddressReady();
    requestAnimationFrame(syncDockOverlap);
    setTimeout(setAddressReady, 1200);
    setTimeout(setAddressReady, 4000);
    setTimeout(syncDockOverlap, 120);
  }

  window.addEventListener("resize", syncDockOverlap, { passive: true });
  window.addEventListener("scroll", syncDockOverlap, { passive: true });
  document.addEventListener("focusin", (event) => {
    if (event.target?.id === "addr") document.body.classList.add("fiq-address-focused");
  });
  document.addEventListener("focusout", (event) => {
    if (event.target?.id === "addr") document.body.classList.remove("fiq-address-focused");
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
