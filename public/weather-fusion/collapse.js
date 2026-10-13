// Collapsible tiles: 7-day forecast and Scientific stuff start collapsed with an Expand/Collapse button.
const IDS = ['daily-panel', 'scientific-stuff'];
function setOpen(sec, open) {
  sec.classList.toggle('is-open', open);
  const b = sec.querySelector(':scope > .section-top .collapse-toggle');
  if (b) { b.innerHTML = (open ? 'Collapse' : 'Expand') + '<span class="collapse-chevron" aria-hidden="true">' + (open ? '▴' : '▾') + '</span>'; b.setAttribute('aria-expanded', String(open)); }
}
// Collapsed 7-day: compact one-row preview (day, icon, hi/lo) built from the rendered day rows.
function addWeekPreview(sec) {
  const prev = document.createElement('button');
  prev.type = 'button'; prev.className = 'wn-preview wn-week-preview'; prev.setAttribute('aria-label', 'Show the full 7-day forecast');
  prev.addEventListener('click', () => setOpen(sec, true));
  sec.querySelector(':scope > .section-top').after(prev);
  const txt = (el) => (el?.textContent || '').replace(/[^0-9\-—°]/g, '').replace(/°+/g, '°');
  const build = () => {
    const rows = [...sec.querySelectorAll('#daily .day-row')].slice(0, 7);
    if (!rows.length) { prev.innerHTML = '<span class="wn-preview-empty">Loading 7-day forecast…</span>'; return; }
    prev.innerHTML = rows.map((r) => {
      const name = (r.querySelector('.day-name-mobile') || r.querySelector('.day-name'))?.textContent.trim() || '';
      const svg = r.querySelector('.day-icon svg')?.outerHTML || '';
      const hi = txt(r.querySelector('.day-high strong') || r.querySelector('.day-high')), lo = txt(r.querySelector('.day-low strong') || r.querySelector('.day-low'));
      return `<span class="wn-pday"><b>${name.length <= 5 ? name : name.slice(0, 3)}</b>${svg}<span class="wn-phi">${hi}</span><span class="wn-plo">${lo}</span></span>`;
    }).join('');
  };
  build();
  const daily = sec.querySelector('#daily');
  if (daily) new MutationObserver(build).observe(daily, { childList: true, subtree: true });
}
function init() {
  for (const id of IDS) {
    const sec = document.getElementById(id);
    if (!sec || sec.dataset.collapsible) continue;
    sec.dataset.collapsible = '1';
    sec.classList.add('wn-collapsible');
    let top = sec.querySelector(':scope > .section-top');
    if (!top) { top = document.createElement('div'); top.className = 'section-top'; sec.prepend(top); }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'collapse-toggle text-button'; b.setAttribute('aria-controls', id);
    b.addEventListener('click', (e) => { e.stopPropagation(); setOpen(sec, !sec.classList.contains('is-open')); });
    top.appendChild(b);
    if (id === 'daily-panel') addWeekPreview(sec);
    setOpen(sec, location.hash === '#' + id);
  }
  // Jump links / "Scientific stuff further down" open the target section.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]'); if (!a) return;
    const sec = document.getElementById(a.getAttribute('href').slice(1));
    if (sec && IDS.includes(sec.id)) setOpen(sec, true);
  }, true);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
