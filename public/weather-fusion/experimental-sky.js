/* Experimental living sky — photographic sky background for the experimental
 * weather page. Picks the photo from live conditions (clear / clouds / rain /
 * storm / night) and crossfades when the weather changes. Experimental only;
 * the regular page keeps its existing atmosphere. */
(function () {
  function isExperimental() {
    const p = globalThis.location?.pathname || '';
    if (/\/weather-fusion\/(experimental-weather\.html)?\/?$/.test(p)) return true;
    return document.documentElement?.dataset?.weatherPage === 'experimental';
  }
  // app.js?v=low-rain-display-v1 sets data-weather-page after this module loads; refresh() re-checks
  // each run so late activation still picks up the sky.

  function sunDown(solar, nowMs, h) {
    const rise = Date.parse(solar?.sunrise), set = Date.parse(solar?.sunset);
    if (Number.isFinite(rise) && Number.isFinite(set)) { const day = 86400000, shift = Math.round(((rise + set) / 2 - nowMs) / day) * day; return !(nowMs >= rise - shift && nowMs < set - shift); }
    return h?.isDay === false;
  }
  function pickSky(hours, nowMs, solar) {
    const h = (hours || []).find((x) => {
      const t = Date.parse(x.time);
      return Number.isFinite(t) && t <= nowMs && nowMs < t + 3600000;
    }) || hours?.[0] || null;
    // The page's rendered current condition (observed sky, searched location) wins over the
    // forecast hour wording; fall back to the API current condition, then the hour.
    const shown = String(document.getElementById('condition')?.textContent || '').trim();
    const usable = shown && !/gathering|unavailable|loading/i.test(shown);
    const cond = String(usable ? shown : (last?.current?.condition || h?.condition || '')).toLowerCase();
    // Day/night comes from the page's shared state (sunrise/sunset), not the NWS hourly
    // isDaytime flag (NWS marks 6am-6pm as daytime regardless of the sun).
    const shared = document.body?.dataset?.sky;
    const night = shared ? shared === 'night' : sunDown(solar, nowMs, h);
    if (night) return 'today-sky-night-v2.webp';
    if (/thunder|storm|tornado|hail/.test(cond)) return 'today-sky-storm.webp';
    if (/rain|shower|drizzle/.test(cond) || (!usable && (h?.pop ?? 0) >= 40)) return 'today-sky-rain.webp';
    if (/cloud|overcast|fog|mist|haze/.test(cond) && !/mostly sunny|mostly clear/.test(cond)) return 'today-sky-clouds.webp';
    return 'today-sky-clear.webp';
  }

  let flip = false, last = null;
  function setSky(image) {
    const show = document.getElementById(flip ? 'exp-sky-a' : 'exp-sky-b');
    const hide = document.getElementById(flip ? 'exp-sky-b' : 'exp-sky-a');
    if (!show || show.dataset.img === image) return;
    const url = `/weather-fusion/${image}`;
    const pre = new Image();
    pre.onload = () => {
      show.style.backgroundImage = `url("${url}")`;
      show.dataset.img = image;
      show.classList.add('on');
      if (hide) hide.classList.remove('on');
      flip = !flip;
    };
    pre.onerror = () => {};
    pre.src = url;
  }

  async function refresh() {
    if (!isExperimental()) return;
    document.documentElement.classList.add('sky-active');
    try {
      const params = new URLSearchParams(globalThis.location.search);
      const loc = params.get('location') || 'knightdale';
      const res = await fetch(`/api/weather-fusion/forecast?location=${encodeURIComponent(loc)}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      last = data;
      setSky(pickSky(data?.hours, Date.now(), data?.solar));
    } catch { /* keep the previous sky */ }
  }

  refresh();
  setInterval(refresh, 10 * 60 * 1000);
  // Follow the shared day/night state the moment it changes (e.g. at sunrise/sunset).
  const repick = () => { if (last && isExperimental()) setSky(pickSky(last.hours, Date.now(), last.solar)); };
  if (document.body) new MutationObserver(repick).observe(document.body, { attributes: true, attributeFilter: ['data-sky'] });
  else document.addEventListener('DOMContentLoaded', () => new MutationObserver(repick).observe(document.body, { attributes: true, attributeFilter: ['data-sky'] }));
  const watchCond = () => { const c = document.getElementById('condition'); if (c) new MutationObserver(repick).observe(c, { childList: true, characterData: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchCond); else watchCond();
})();
