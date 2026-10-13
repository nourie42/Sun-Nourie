// Collapsible tiles: 7-day forecast and Scientific stuff start collapsed with an Expand/Collapse button.
const IDS = ['daily-panel', 'scientific-stuff'];
function setOpen(sec, open) {
  sec.classList.toggle('is-open', open);
  const b = sec.querySelector(':scope > .section-top .collapse-toggle');
  if (b) { b.textContent = open ? 'Collapse' : 'Expand'; b.setAttribute('aria-expanded', String(open)); }
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
