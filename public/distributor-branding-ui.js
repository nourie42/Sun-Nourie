(() => {
  let scheduled = false;

  function cleanText(value) {
    return String(value || '')
      .replace(/Chat\s*GPT/gi, 'Fuel IQ')
      .replace(/OpenAI/gi, 'Fuel IQ')
      .replace(/\s*•\s*gpt-[a-z0-9._-]+/gi, '')
      .replace(/\bgpt-[a-z0-9._-]+\b/gi, '')
      .replace(/\bAI Ready\b/gi, 'Fuel IQ Ready')
      .replace(/Fuel IQ model:\s*[^•\n]+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim();
  }

  function sanitizeTextNodes(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName;
        return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(tag)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const next = cleanText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  }

  function removeUnwantedExports() {
    document.getElementById('printButton')?.remove();
    document.getElementById('jsonButton')?.remove();
    document.querySelectorAll('button, a').forEach((element) => {
      const text = String(element.textContent || '').trim();
      if (/^(Print\s*\/\s*PDF|Export JSON)$/i.test(text)) element.remove();
    });
  }

  function hideModelMetric() {
    const metric = document.getElementById('modelMetric')?.closest('.metric');
    if (metric) metric.style.display = 'none';
    const metrics = document.querySelector('.metrics');
    if (metrics) metrics.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
  }

  function setFuelIqCopy() {
    const hero = document.querySelector('.hero p');
    if (hero) {
      hero.textContent = 'Search any petroleum marketer or fuel distributor. Fuel IQ investigates public company records, fleet data, sites, licenses, leadership, environmental history, revenue and gallon estimates, risks, and acquisition diligence—then builds an exportable Word report.';
    }
    const kicker = document.querySelector('.kicker');
    if (kicker) kicker.textContent = 'Fuel IQ M&A research';
    const loadingTitle = document.querySelector('#loadingState h2, .loading h2');
    if (loadingTitle) loadingTitle.textContent = 'Fuel IQ is researching the company';
    const status = document.getElementById('apiStatus');
    if (status && /AI Ready/i.test(status.textContent || '')) status.textContent = 'Fuel IQ Ready';
    const wordButton = document.getElementById('wordButton');
    if (wordButton) wordButton.textContent = 'Export to Word';
  }

  function apply() {
    scheduled = false;
    removeUnwantedExports();
    hideModelMetric();
    setFuelIqCopy();
    sanitizeTextNodes();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(apply);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  apply();
})();
