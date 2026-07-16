(() => {
  if (window.__fiqAadtAutoloadInstalled) return;
  window.__fiqAadtAutoloadInstalled = true;

  let timer = null;
  let lastKey = "";

  function selectedCoordinates() {
    const selected = window.__fiqSelectedAddress;
    const lat = Number(selected?.lat ?? selected?.normalized?.lat);
    const lon = Number(selected?.lon ?? selected?.lng ?? selected?.normalized?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  function triggerAadtLoad(force = false) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const coords = selectedCoordinates();
      const refresh = document.getElementById("refreshAadtChoices");
      if (!coords || !refresh) return;
      const key = `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      refresh.click();
    }, 80);
  }

  window.addEventListener("fiq:address-selected", () => triggerAadtLoad(true));

  document.addEventListener("change", (event) => {
    if (event.target?.id === "addr") triggerAadtLoad(false);
  }, true);
})();
