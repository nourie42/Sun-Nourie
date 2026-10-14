// Feel Meter tab: hidden by default, opened from its tab (same pattern as the Car Wash tab).
const root = document.documentElement;
function open(scroll) {
  root.classList.add('gross-open');
  const b = document.getElementById('open-gross'); if (b) b.setAttribute('aria-expanded', 'true');
  const panel = document.getElementById('dewpoint-gross-meter');
  if (panel && scroll) requestAnimationFrame(() => panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
}
function init() {
  const b = document.getElementById('open-gross');
  if (b) b.addEventListener('click', (e) => { e.preventDefault(); open(true); });
  if (location.hash === '#dewpoint-gross-meter') open(true);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

