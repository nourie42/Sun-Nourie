// Feel Meter tab: hidden by default, opened from its tab (same pattern as the Car Wash tab).
const root = document.documentElement;
function open(scroll) {
  root.classList.add('gross-open');
  const b = document.getElementById('open-gross'); if (b) b.setAttribute('aria-expanded', 'true');
  let panel = document.getElementById('dewpoint-gross-meter');
  if (!panel) {
    const anchor = document.getElementById('car-wash-forecast');
    if (anchor) {
      panel = document.createElement('section');panel.id = 'dewpoint-gross-meter';panel.className = 'glass dewpoint-gross-meter';panel.setAttribute('aria-labelledby','gross-title');
      const title = document.createElement('h2');title.id = 'gross-title';title.textContent = 'Dew Point Feel Meter';
      const status = document.createElement('p');status.setAttribute('role','status');status.textContent = 'Choose a city or allow device location to see the Feel Meter. If you have already selected a location, its weather sources are loading.';
      panel.append(title,status);anchor.insertAdjacentElement('afterend',panel);
    }
  }
  if (panel && scroll) requestAnimationFrame(() => panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
}
function init() {
  const b = document.getElementById('open-gross');
  if (b) {
    b.addEventListener('click', (e) => { e.preventDefault(); open(true); });
    b.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); open(true); } });
  }
  if (location.hash === '#dewpoint-gross-meter') open(true);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

