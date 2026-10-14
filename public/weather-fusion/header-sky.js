// Sets the header sky state from the page's existing weather state (body[data-sky] + #condition text).
const header = document.querySelector('.topbar.sky-header');
const cond = document.getElementById('condition');
function state() {
  const sky = document.body.dataset.sky;
  const text = (cond ? cond.textContent : '') || '';
  const loaded = text && !/gathering/i.test(text);
  if (!loaded) { const h = new Date().getHours(); return h >= 7 && h < 19 ? 'clear' : 'night'; }
  if (sky === 'night') return 'night';
  if (/snow|sleet|flurr|ice|wintry/i.test(text)) return 'snow';
  if (sky === 'rain' || /rain|storm|shower|drizzle|thunder/i.test(text)) return 'rain';
  if (/cloud|overcast|fog|mist|haze|smoke/i.test(text) && !/mostly sunny|mostly clear/i.test(text)) return 'cloudy';
  return 'clear';
}
function apply() { const s = state(); if (header) header.dataset.hdr = s; document.documentElement.dataset.hdr = s; }
apply();
new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['data-sky'] });
if (cond) new MutationObserver(apply).observe(cond, { childList: true, characterData: true, subtree: true, attributes: true });
