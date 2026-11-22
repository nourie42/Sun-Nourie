(function () {
  if (window.__wnPwaBridgeInitialized) return;
  window.__wnPwaBridgeInitialized = true;

  var deferredPrompt = null;
  var isInstalled =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  // Existing standalone installs always launch the main page.
  if (isInstalled && /\/weather-fusion\/experimental-weather\.html\/?$/i.test(window.location.pathname || '')) {
    window.location.replace('/weather-fusion/');
    return;
  }

  if (isInstalled) {
    var keepBrandOnMain = function () {
      var brand = document.querySelector('a.brand[href="/weather-fusion/experimental-weather.html"]');
      if (brand) {
        brand.setAttribute('href', '/weather-fusion/');
        brand.setAttribute('aria-label', 'Weather Nourie home');
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', keepBrandOnMain);
    } else {
      keepBrandOnMain();
    }
  }

  var ua = (window.navigator.userAgent || '').toLowerCase();
  var isIOS = /iphone|ipad|ipod/.test(ua);
  var isAndroid = /android/.test(ua);
  var isSafariMac =
    /safari/.test(ua) && !/chrome|chromium|crios|edg|opr|fxios|firefox/.test(ua) && !isIOS;

  // 1. Register service worker safely
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/weather-fusion/sw.js', { scope: '/weather-fusion/' }).catch(function () {});
    });
  }

  function updateInstallButtonVisibility() {
    var bar = document.getElementById('wn-pwa-install-bar');
    if (bar) {
      bar.hidden = Boolean(isInstalled);
      return;
    }
    var btn = document.getElementById('wn-pwa-install-btn');
    if (btn) btn.hidden = Boolean(isInstalled);
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallButtonVisibility();
  });

  window.addEventListener('appinstalled', function () {
    isInstalled = true;
    deferredPrompt = null;
    updateInstallButtonVisibility();
    closeModal();
  });

  function getStepsHtml() {
    if (isIOS) {
      return (
        '<li>Open this page in <strong>Safari</strong> on your iPhone or iPad.</li>' +
        '<li>Tap the <strong>Share</strong> button at the bottom of Safari.</li>' +
        '<li>Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li>'
      );
    }
    if (isAndroid) {
      return (
        '<li>Open Weather Nourie in Chrome or Samsung Internet.</li>' +
        '<li>Open the browser menu and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>'
      );
    }
    if (isSafariMac) {
      return (
        '<li>In Safari, open the <strong>File</strong> menu (or click <strong>Share</strong> in the toolbar).</li>' +
        '<li>Click <strong>Add to Dock</strong> to install Weather Nourie as a standalone Mac app.</li>'
      );
    }
    return (
      '<li>Make sure this page is open in its own <strong>Chrome</strong> or <strong>Edge</strong> browser tab (not inside a preview frame).</li>' +
      '<li>Click the <strong>Install</strong> icon on the right side of the address bar, or open the browser menu and select <strong>Install Weather Nourie</strong>.</li>'
    );
  }

  function closeModal() {
    var backdrop = document.getElementById('wn-pwa-modal-backdrop');
    if (backdrop) backdrop.hidden = true;
  }

  function openModal() {
    var backdrop = document.getElementById('wn-pwa-modal-backdrop');
    if (!backdrop) return;
    var steps = backdrop.querySelector('.wn-pwa-steps');
    if (steps) steps.innerHTML = getStepsHtml();
    backdrop.hidden = false;
  }

  function mountUi() {
    // Offline banner
    var offlineBanner = document.createElement('div');
    offlineBanner.id = 'wn-pwa-offline-banner';
    offlineBanner.className = 'wn-pwa-offline-banner';
    offlineBanner.setAttribute('role', 'status');
    offlineBanner.setAttribute('aria-live', 'polite');
    offlineBanner.textContent = 'Offline Mode — Showing cached Weather Nourie data';
    offlineBanner.hidden = navigator.onLine !== false;
    document.body.appendChild(offlineBanner);

    window.addEventListener('offline', function () {
      offlineBanner.hidden = false;
    });
    window.addEventListener('online', function () {
      offlineBanner.hidden = true;
    });

    if (isInstalled) return;

    // Install App button mounted cleanly above Weather Nourie's sky header
    var installBtn = document.createElement('button');
    installBtn.id = 'wn-pwa-install-btn';
    installBtn.type = 'button';
    installBtn.className = 'wn-pwa-install-btn';
    installBtn.setAttribute('aria-label', isIOS ? 'Install Weather Nourie on iOS' : 'Install Weather Nourie app');
    installBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
      '<polyline points="7 10 12 15 17 10"/>' +
      '<line x1="12" y1="15" x2="12" y2="3"/>' +
      '</svg>' +
      '<span>Install App</span>';

    installBtn.addEventListener('click', function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice
          .then(function (choice) {
            if (choice && choice.outcome === 'accepted') {
              isInstalled = true;
              deferredPrompt = null;
              updateInstallButtonVisibility();
            }
          })
          .catch(function () {
            openModal();
          });
      } else {
        openModal();
      }
    });

    var installSlot = document.querySelector('[data-wn-install-slot]');
    var topbar = document.querySelector('header.topbar');
    if (installSlot) {
      installBtn.classList.add('mode-pill');
      installSlot.appendChild(installBtn);
    } else if (topbar && topbar.parentNode) {
      var bar = document.createElement('div');
      bar.id = 'wn-pwa-install-bar';
      bar.className = 'wn-pwa-install-bar';
      bar.appendChild(installBtn);
      topbar.parentNode.insertBefore(bar, topbar);
    } else {
      installBtn.classList.add('wn-pwa-floating');
      document.body.appendChild(installBtn);
    }

    // Install instructions modal
    var backdrop = document.createElement('div');
    backdrop.id = 'wn-pwa-modal-backdrop';
    backdrop.className = 'wn-pwa-modal-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="wn-pwa-modal" role="dialog" aria-modal="true" aria-labelledby="wn-pwa-modal-title">' +
      '<div class="wn-pwa-modal-head">' +
      '<div class="wn-pwa-modal-brand">' +
      '<img src="/weather-fusion/pwa-192x192.png?v=ice-glass" alt="Weather Nourie icon" />' +
      '<div>' +
      '<h2 id="wn-pwa-modal-title">Install Weather Nourie</h2>' +
      '<p class="wn-pwa-modal-sub">Add Weather Nourie to your Home Screen or Desktop</p>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="wn-pwa-close" id="wn-pwa-close-btn" aria-label="Close install instructions">&times;</button>' +
      '</div>' +
      '<ol class="wn-pwa-steps"></ol>' +
      '<div class="wn-pwa-modal-actions">' +
      '<button type="button" class="wn-pwa-copy-btn" id="wn-pwa-copy-btn">Copy App Link</button>' +
      '<button type="button" class="wn-pwa-done-btn" id="wn-pwa-done-btn">Done</button>' +
      '</div>' +
      '</div>';

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeModal();
    });
    document.body.appendChild(backdrop);

    var closeBtn = document.getElementById('wn-pwa-close-btn');
    var doneBtn = document.getElementById('wn-pwa-done-btn');
    var copyBtn = document.getElementById('wn-pwa-copy-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (doneBtn) doneBtn.addEventListener('click', closeModal);
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var url = window.location.origin + '/weather-fusion/';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            copyBtn.textContent = 'Link Copied!';
            setTimeout(function () {
              copyBtn.textContent = 'Copy App Link';
            }, 2000);
          }).catch(function () {});
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi);
  } else {
    mountUi();
  }
})();
