(() => {
  let timer = null;
  let applying = false;

  const HERO_TEXT = 'Search any petroleum marketer or fuel distributor. Fuel IQ investigates public company records, fleet data, sites, licenses, leadership, environmental history, revenue and gallon estimates, risks, and acquisition diligence—then builds an exportable Word report.';

  function cleanText(value) {
    return String(value || '')
      .replace(/Chat\s*GPT/gi, 'Fuel IQ')
      .replace(/OpenAI/gi, 'Fuel IQ')
      .replace(/\s*•\s*gpt-[a-z0-9._-]+/gi, '')
      .replace(/\bgpt-[a-z0-9._-]+\b/gi, '')
      .replace(/\bAI Ready\b/gi, 'Fuel IQ Ready')
      .replace(/Fuel IQ model:\s*[^•\n]+/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.;:])/g, '$1');
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
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
    if (metric && metric.style.display !== 'none') metric.style.display = 'none';
    const metrics = document.querySelector('.metrics');
    const layout = 'repeat(3,minmax(0,1fr))';
    if (metrics && metrics.style.gridTemplateColumns !== layout) metrics.style.gridTemplateColumns = layout;
  }

  function setFuelIqCopy() {
    setText(document.querySelector('.hero p'), HERO_TEXT);
    setText(document.querySelector('.kicker'), 'Fuel IQ M&A research');
    setText(document.querySelector('#loadingState h2, .loading h2'), 'Fuel IQ is researching the company');

    const status = document.getElementById('apiStatus');
    if (status && /AI Ready/i.test(status.textContent || '')) setText(status, 'Fuel IQ Ready');

    setText(document.getElementById('wordButton'), 'Export to Word');
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      removeUnwantedExports();
      hideModelMetric();
      setFuelIqCopy();
      sanitizeTextNodes();
    } finally {
      applying = false;
    }
  }

  function schedule() {
    if (applying || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      apply();
    }, 25);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
