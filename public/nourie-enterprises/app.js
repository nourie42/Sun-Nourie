(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const fields = {
    gallons: $('gallons'),
    cents: $('fuel-cents'),
    sales: $('inside-sales'),
    margin: $('margin-points'),
  };
  const results = {
    gallons: $('gallons-value'),
    cents: $('fuel-cents-value'),
    sales: $('inside-sales-value'),
    margin: $('margin-points-value'),
    fuel: $('fuel-value'),
    inside: $('inside-value'),
    total: $('total-value'),
  };

  function readNumber(input) {
    const raw = Number(input && input.value);
    return Number.isFinite(raw) ? raw : 0;
  }

  function setTrack(input) {
    if (!input) return;
    const min = readNumber({ value: input.min });
    const max = readNumber({ value: input.max });
    const current = readNumber(input);
    const percent = max > min ? Math.min(100, Math.max(0, ((current - min) / (max - min)) * 100)) : 0;
    input.style.setProperty('--fill', percent.toFixed(2) + '%');
  }

  function calculation() {
    const gallons = readNumber(fields.gallons);
    const cents = readNumber(fields.cents);
    const sales = readNumber(fields.sales);
    const margin = readNumber(fields.margin);
    return {
      gallons, cents, sales, margin,
      fuel: gallons * (cents / 100),
      inside: sales * (margin / 100),
      total: gallons * (cents / 100) + sales * (margin / 100)
    };
  }

  function renderCalculator() {
    if (Object.values(fields).some((element) => !element)) return;
    const value = calculation();
    results.gallons.textContent = number.format(value.gallons);
    results.cents.textContent = value.cents.toFixed(2) + '¢/gal';
    results.sales.textContent = dollars.format(value.sales);
    results.margin.textContent = value.margin.toFixed(2) + ' pp';
    results.fuel.textContent = dollars.format(value.fuel);
    results.inside.textContent = dollars.format(value.inside);
    results.total.textContent = dollars.format(value.total);
    Object.values(fields).forEach(setTrack);
  }

  function scenarioText() {
    const v = calculation();
    return [
      'NOURIE ENTERPRISES — ILLUSTRATIVE SCENARIO',
      'Annual fuel gallons: ' + number.format(v.gallons),
      'Potential fuel cost improvement: ' + v.cents.toFixed(2) + ' cents/gallon',
      'Illustrative fuel impact: ' + dollars.format(v.fuel),
      'Annual inside sales: ' + dollars.format(v.sales),
      'Inside gross margin improvement: ' + v.margin.toFixed(2) + ' percentage points',
      'Illustrative inside gross profit improvement: ' + dollars.format(v.inside),
      'ILLUSTRATIVE TOTAL ADDITIONAL GROSS PROFIT: ' + dollars.format(v.total),
      '',
      'Illustration only. Not a forecast or guaranteed savings. Excludes advisory fees,',
      'taxes, implementation costs, contractual limitations and offsetting changes.',
      'Business concept in development; no client engagements currently offered.'
    ].join('\n');
  }

  async function copyScenario() {
    const status = $('copy-status');
    if (!status) return;
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(scenarioText());
      status.textContent = 'Scenario copied. You can paste it into your notes.';
    } catch (_error) {
      status.textContent = 'Copying is unavailable here. You can still record the figures shown above.';
    }
  }

  Object.values(fields).forEach((input) => {
    if (input) input.addEventListener('input', renderCalculator);
  });

  const copy = $('copy-scenario');
  if (copy) copy.addEventListener('click', copyScenario);
  renderCalculator();

  const menuButton = $('menu-toggle');
  const navigation = $('primary-navigation');
  function setMenu(open) {
    if (!menuButton || !navigation) return;
    navigation.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
  }
  if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
      setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    });
    navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenu(false);
    });
    document.addEventListener('click', (event) => {
      if (!navigation.contains(event.target) && !menuButton.contains(event.target)) setMenu(false);
    });
  }

  const year = $('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
