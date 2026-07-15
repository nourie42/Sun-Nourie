(() => {
  const form = document.getElementById('researchForm');
  const companyName = document.getElementById('companyName');
  const locationHint = document.getElementById('locationHint');
  const researchFocus = document.getElementById('researchFocus');
  const researchButton = document.getElementById('researchButton');
  const loadingMessage = document.getElementById('loadingMessage');
  if (!form || !companyName || !locationHint || !researchFocus || !researchButton || !loadingMessage) return;

  const ACTIVE_JOB_KEY = 'fuelIqActiveDistributorResearchJobV2';
  let activeJobId = '';
  let polling = false;
  let stopped = false;
  let networkFailures = 0;

  function callGlobal(name, ...args) {
    const fn = window[name];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
  }

  function setUiLoading(message) {
    callGlobal('stopLoadingMessages');
    callGlobal('setState', 'loading');
    if (message) loadingMessage.textContent = message;
    researchButton.disabled = true;
    researchButton.textContent = 'Research Running in Background…';
  }

  function resetButton() {
    const selected = document.querySelector('.company-selected.open');
    researchButton.disabled = !selected;
    researchButton.textContent = selected ? 'Research Selected Company with ChatGPT' : 'Select a Company to Research';
  }

  function showFailure(message, detail = '') {
    stopped = true;
    polling = false;
    activeJobId = '';
    localStorage.removeItem(ACTIVE_JOB_KEY);
    callGlobal('stopLoadingMessages');
    callGlobal('setState', 'empty');
    const extra = detail && !String(message).includes(detail) ? ` ${detail}` : '';
    callGlobal('showError', `${message || 'The research could not be completed.'}${extra}`.trim());
    resetButton();
  }

  function saveActiveJob(jobId, query) {
    activeJobId = jobId;
    try {
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, query, savedAt: Date.now() }));
    } catch {}
  }

  function clearActiveJob() {
    activeJobId = '';
    try { localStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
  }

  async function fetchJson(url, options = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server returned ${response.status} without a valid response.`); }
      return { response, data };
    } finally {
      clearTimeout(timer);
    }
  }

  function statusMessage(data) {
    const elapsed = Number(data?.elapsedSeconds || 0);
    const minutes = Math.floor(elapsed / 60);
    const seconds = String(elapsed % 60).padStart(2, '0');
    const time = elapsed ? ` (${minutes}:${seconds})` : '';
    const attempt = data?.maxAttempts > 1 ? ` • attempt ${data.attempt || 1}/${data.maxAttempts}` : '';
    const model = data?.model ? ` • ${data.model}` : '';
    return `${data?.message || 'OpenAI is researching public sources…'}${time}${model}${attempt}`;
  }

  async function pollJob(jobId) {
    if (!jobId || polling || stopped) return;
    polling = true;
    try {
      const { response, data } = await fetchJson(`/api/distributors/research/${encodeURIComponent(jobId)}`, {}, 60000);
      networkFailures = 0;
      if (data?.status === 'completed' && data?.report) {
        stopped = true;
        clearActiveJob();
        callGlobal('stopLoadingMessages');
        callGlobal('displayReport', data);
        resetButton();
        return;
      }
      if (!response.ok || data?.ok === false || ['failed', 'expired', 'cancelled'].includes(data?.status)) {
        showFailure(data?.message || `Research failed (${response.status}).`, data?.detail || '');
        return;
      }
      setUiLoading(statusMessage(data));
    } catch (error) {
      networkFailures += 1;
      if (networkFailures >= 8) {
        showFailure('Fuel IQ temporarily lost contact with the research job.', 'Refresh the page to resume it, or start the search again.');
        return;
      }
      setUiLoading(`The report is still running; reconnecting to the server (${networkFailures}/8)…`);
    } finally {
      polling = false;
    }
    if (!stopped && activeJobId === jobId) setTimeout(() => pollJob(jobId), 5000);
  }

  async function startResearch(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const query = companyName.value.trim();
    if (!query) return;

    stopped = false;
    networkFailures = 0;
    setUiLoading('Starting reliable background research with OpenAI…');

    try {
      const { response, data } = await fetchJson('/api/distributors/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          location: locationHint.value.trim(),
          focus: researchFocus.value.trim(),
        }),
      }, 75000);

      if (!response.ok || !data?.ok || !data?.jobId) {
        showFailure(data?.message || `Research could not start (${response.status}).`, data?.detail || '');
        return;
      }
      saveActiveJob(data.jobId, query);
      setUiLoading(statusMessage(data));
      setTimeout(() => pollJob(data.jobId), 1500);
    } catch (error) {
      showFailure(error?.name === 'AbortError' ? 'The research job could not be started before the server timeout.' : (error?.message || String(error)));
    }
  }

  // Capture-phase interception prevents the page's old long-lived request from running.
  // The company picker registers first, so its required-selection validation still applies.
  form.addEventListener('submit', startResearch, true);

  const newSearchButton = document.getElementById('newSearchButton');
  if (newSearchButton) {
    newSearchButton.addEventListener('click', () => {
      stopped = true;
      clearActiveJob();
      resetButton();
    });
  }

  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
    if (saved?.jobId && Date.now() - Number(saved.savedAt || 0) < 24 * 60 * 60 * 1000) {
      activeJobId = saved.jobId;
      stopped = false;
      setUiLoading(`Resuming background research${saved.query ? ` for ${saved.query}` : ''}…`);
      setTimeout(() => pollJob(saved.jobId), 500);
    } else {
      localStorage.removeItem(ACTIVE_JOB_KEY);
    }
  } catch {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  }
})();
