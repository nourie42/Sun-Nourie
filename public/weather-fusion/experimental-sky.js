/* Experimental living sky — photographic sky background for the experimental
 * weather page. Picks the photo from live conditions (clear / clouds / rain /
 * storm / night) and crossfades when the weather changes. Experimental only;
 * the regular page keeps its existing atmosphere. */
(function () {
  function isExperimental() {
    if (/\/weather-fusion\/experimental-weather\.html\/?$/.test(globalThis.location?.pathname || '')) return true;
    return document.documentElement?.dataset?.weatherPage === 'experimental';
  }
  // app.js sets data-weather-page after this module loads; refresh() re-checks
  // each run so late activation still picks up the sky.

  function pickSky(hours, nowMs) {
    const h = (hours || []).find((x) => {
      const t = Date.parse(x.time);
      return Number.isFinite(t) && t <= nowMs && nowMs < t + 3600000;
    }) || hours?.[0] || null;
    const cond = String(h?.condition || '').toLowerCase();
    if (h?.isDay === false) return 'today-sky-night-v2.webp';
    if (/thunder|storm|tornado|hail/.test(cond)) return 'today-sky-storm.webp';
    if (/rain|shower|drizzle/.test(cond) || (h?.pop ?? 0) >= 40) return 'today-sky-rain.webp';
    if (/cloud|overcast|fog|mist|haze/.test(cond)) return 'today-sky-clouds.webp';
    return 'today-sky-clear.webp';
  }

  let flip = false;
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
    try {
      const params = new URLSearchParams(globalThis.location.search);
      const loc = params.get('location') || 'knightdale';
      const res = await fetch(`/api/weather-fusion/forecast?location=${encodeURIComponent(loc)}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setSky(pickSky(data?.hours, Date.now()));
    } catch { /* keep the previous sky */ }
  }

  refresh();
  setInterval(refresh, 10 * 60 * 1000);
})();
