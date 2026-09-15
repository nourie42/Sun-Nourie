(() => {
  'use strict';

  const MAX_FILES = 6;
  const MAX_FILE_BYTES = 6 * 1024 * 1024;
  const LOCATION_KEY = 'ai-user-location-v1';
  const LOCATION_MAX_AGE = 30 * 60 * 1000;

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const comma = raw.indexOf(',');
        resolve({
          name: String(file.name || 'attachment').slice(0, 160),
          type: String(file.type || 'application/octet-stream').slice(0, 120),
          size: Number(file.size || 0),
          data: comma >= 0 ? raw.slice(comma + 1) : raw,
        });
      };
      reader.onerror = () => reject(reader.error || new Error('Could not read attachment.'));
      reader.readAsDataURL(file);
    });
  }

  function setupAttachmentController({ textareaId, key = 'default', maxFiles = MAX_FILES } = {}) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return { get: () => [], clear: () => {}, has: () => false };
    const state = [];
    const host = textarea.closest('.composer, .section-card, .sheet, .form-card, .room-card') || textarea.parentElement;
    const row = textarea.closest('.compose-row') || textarea.parentElement;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.className = 'ai-attachment-input';
    input.accept = 'image/*,.pdf,.txt,.md,.csv,.json,.xml,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
    input.setAttribute('aria-label', 'Attach photos or files');
    input.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-attach-btn';
    button.textContent = '＋';
    button.title = 'Attach photo or file';
    button.setAttribute('aria-label', 'Attach photo or file');

    const strip = document.createElement('div');
    strip.className = 'ai-attachment-strip hidden';
    strip.dataset.attachmentKey = key;

    const render = () => {
      strip.replaceChildren();
      strip.classList.toggle('hidden', state.length === 0);
      state.forEach((item, index) => {
        const chip = document.createElement('span');
        chip.className = 'ai-attachment-chip';
        chip.textContent = `📎 ${item.name}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${item.name}`);
        remove.onclick = () => { state.splice(index, 1); render(); };
        chip.append(remove);
        strip.append(chip);
      });
    };

    button.onclick = () => input.click();
    input.onchange = async () => {
      const files = [...(input.files || [])];
      input.value = '';
      for (const file of files) {
        if (state.length >= maxFiles) break;
        if (file.size > MAX_FILE_BYTES) {
          alert(`${file.name} is too large. Use files under 6 MB.`);
          continue;
        }
        try { state.push(await readFile(file)); }
        catch { alert(`Could not attach ${file.name}.`); }
      }
      render();
    };

    if (row) {
      const send = row.querySelector('.send-btn, .primary, button[type="submit"]');
      if (send) row.insertBefore(button, send); else row.append(button);
    } else if (host) host.append(button);
    if (host) host.insertBefore(strip, row || host.firstChild);
    document.body.append(input);

    return {
      get: () => state.map((item) => ({ ...item })),
      clear: () => { state.splice(0); render(); },
      has: () => state.length > 0,
      names: () => state.map((item) => item.name),
    };
  }

  function countryFromLocale(locale) {
    try { return new Intl.Locale(locale || navigator.language || 'en-US').region || ''; }
    catch { return ''; }
  }

  function basicLocation() {
    const locale = navigator.language || '';
    return {
      locale,
      country: countryFromLocale(locale),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      area: '',
      city: '',
      source: 'browser',
    };
  }

  async function reverseLocation(lat, lon, accuracy, base) {
    try {
      const response = await fetch('/api/ai-agent/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, accuracy, locale: base.locale, timezone: base.timezone, country: base.country }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) return { ...base, ...data.location, lat, lon, accuracy, source: 'browser-geolocation' };
    } catch {}
    return { ...base, lat, lon, accuracy, source: 'browser-geolocation' };
  }

  async function getLocationContext({ force = false } = {}) {
    const base = basicLocation();
    try {
      const cached = JSON.parse(sessionStorage.getItem(LOCATION_KEY) || 'null');
      if (!force && cached?.at && Date.now() - cached.at < LOCATION_MAX_AGE && cached.location) return cached.location;
    } catch {}

    if (!navigator.geolocation) return base;
    const location = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        resolve(await reverseLocation(latitude, longitude, accuracy, base));
      }, () => resolve(base), { enableHighAccuracy: false, timeout: 4500, maximumAge: LOCATION_MAX_AGE });
    });
    try { sessionStorage.setItem(LOCATION_KEY, JSON.stringify({ at: Date.now(), location })); } catch {}
    return location;
  }

  function attachmentNames(list) {
    return (Array.isArray(list) ? list : []).map((item) => item?.name).filter(Boolean);
  }

  window.AIContext = { setupAttachmentController, getLocationContext, attachmentNames };
})();
