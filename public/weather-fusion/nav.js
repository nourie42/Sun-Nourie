/* Add a weather entry without changing existing Sun-Nourie tools. */
(() => {
  let observer;
  function attach() {
    const header = document.querySelector('header');
    if (!header) return;
    observer?.disconnect();
    if (document.getElementById('weatherFusionNav')) return;
    const link = document.createElement('a');
    link.id = 'weatherFusionNav';
    link.href = '/weather-fusion';
    link.textContent = 'Weather Fusion';
    link.setAttribute('aria-label', 'Open Weather Fusion forecasts and maps');
    const style = document.createElement('style');
    style.textContent = '#weatherFusionNav{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;margin:4px;border:1px solid #b5d8ff;border-radius:12px;background:linear-gradient(135deg,#254a7d,#132742);color:#fff!important;font:700 15px system-ui;text-decoration:none;box-shadow:0 5px 16px #122d4b25}#weatherFusionNav:hover{filter:brightness(1.16)}#weatherFusionNav:focus-visible{outline:3px solid #88c5ff;outline-offset:3px}';
    document.head.appendChild(style);
    header.appendChild(link);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
  if (!document.querySelector('header')) { observer = new MutationObserver(attach); observer.observe(document.documentElement, { childList: true, subtree: true }); }
})();
