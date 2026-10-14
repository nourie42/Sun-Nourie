// 7-Day tab: the 7-day forecast list is hidden by default and opened from its tab
// (same pattern as the Car Wash and Gross tabs). The 7-day carousel is unaffected.
const root = document.documentElement;
function open(scroll) {
  root.classList.add('week-open');
  const b = document.querySelector('.weather-jump-card.jump-week'); if (b) b.setAttribute('aria-expanded', 'true');
  const panel = document.getElementById('daily-panel');
  if (panel && scroll) requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function init() {
  const b = document.querySelector('.weather-jump-card.jump-week');
  if (b) { b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'daily-panel');
    b.addEventListener('click', (e) => { e.preventDefault(); open(true); }); }
  if (location.hash === '#daily-panel') open(true);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
