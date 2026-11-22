/**
 * Interactive Zero-Dependency SVG Price History & Retailer Comparison Charts.
 * Strictly renders genuine recorded observations — never invents synthetic history curves.
 */

const RETAILER_PALETTE = [
  '#38bdf8',
  '#10b981',
  '#f59e0b',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#f97316',
];

function formatMoney(v) {
  return typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : '—';
}

function formatShortDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/**
 * Render an interactive multi-retailer SVG price history chart into containerEl.
 */
export function renderPriceHistoryChart(containerEl, {
  entries = [],
  normalPrice = null,
  preferredPrice = null,
  honestyNote = '',
} = {}) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  const valid = (entries || [])
    .filter((e) => typeof e.price === 'number' && Number.isFinite(e.price) && Number.isFinite(Date.parse(e.observedAt)))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  if (!valid.length) {
    containerEl.innerHTML = `
      <div class="chart-empty">
        <div class="chart-empty-title">No price observations recorded yet for this product</div>
        <p>${honestyNote || 'Real timestamped observations begin recording immediately as the monitor sweeps this item. Historical prices are never fabricated.'}</p>
      </div>`;
    return;
  }

  const width = 760;
  const height = 290;
  const pad = { top: 24, right: 24, bottom: 42, left: 68 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const prices = valid.map((e) => e.price);
  if (typeof normalPrice === 'number' && normalPrice > 0) prices.push(normalPrice);
  if (typeof preferredPrice === 'number' && preferredPrice > 0) prices.push(preferredPrice);

  const minP = Math.max(0, Math.min(...prices) * 0.9);
  const maxP = Math.max(...prices) * 1.08 + 1;
  const minT = Date.parse(valid[0].observedAt);
  const maxT = Math.max(minT + 60000, Date.parse(valid[valid.length - 1].observedAt));

  const xOf = (iso) => {
    if (valid.length === 1) return pad.left + plotW / 2;
    return pad.left + ((Date.parse(iso) - minT) / (maxT - minT)) * plotW;
  };
  const yOf = (price) => pad.top + plotH - ((price - minP) / (maxP - minP)) * plotH;

  // Group points by retailer
  const retailers = [...new Set(valid.map((e) => e.retailerName || e.retailerId || 'Retailer'))];
  const colorMap = new Map(retailers.map((r, i) => [r, RETAILER_PALETTE[i % RETAILER_PALETTE.length]]));

  const lowestObserved = Math.min(...valid.map((e) => e.price));
  const highestObserved = Math.max(...valid.map((e) => e.price));

  // Horizontal grid lines (5 ticks)
  const yTicks = [];
  for (let i = 0; i <= 4; i += 1) {
    const val = minP + ((maxP - minP) * i) / 4;
    yTicks.push({ val, y: yOf(val) });
  }

  // Build SVG lines & points
  const seriesSvg = retailers.map((ret) => {
    const pts = valid.filter((e) => (e.retailerName || e.retailerId || 'Retailer') === ret);
    const color = colorMap.get(ret);
    const pathD = pts.length >= 2
      ? pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xOf(p.observedAt).toFixed(1)} ${yOf(p.price).toFixed(1)}`).join(' ')
      : '';
    const dots = pts.map((p, idx) => {
      const cx = xOf(p.observedAt).toFixed(1);
      const cy = yOf(p.price).toFixed(1);
      const isLow = p.price === lowestObserved;
      return `<circle class="chart-dot" data-idx="${valid.indexOf(p)}" cx="${cx}" cy="${cy}" r="${isLow ? 5.5 : 4.2}" fill="${color}" stroke="#060a13" stroke-width="2" />`;
    }).join('');
    return `
      ${pathD ? `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />` : ''}
      ${dots}`;
  }).join('');

  // Typical range shading if ≥ 2 observations
  const rangeBand = valid.length >= 2 && highestObserved > lowestObserved
    ? `<rect x="${pad.left}" y="${yOf(highestObserved).toFixed(1)}" width="${plotW}" height="${Math.max(2, yOf(lowestObserved) - yOf(highestObserved)).toFixed(1)}" fill="rgba(56, 189, 248, 0.06)" />`
    : '';

  const lowLine = `<line x1="${pad.left}" y1="${yOf(lowestObserved).toFixed(1)}" x2="${width - pad.right}" y2="${yOf(lowestObserved).toFixed(1)}" stroke="#10b981" stroke-dasharray="5 5" stroke-width="1.2" opacity="0.8" />
    <text x="${width - pad.right - 4}" y="${(yOf(lowestObserved) - 5).toFixed(1)}" text-anchor="end" fill="#10b981" font-size="11" font-weight="600">Lowest Observed ${formatMoney(lowestObserved)}</text>`;

  const normalLine = typeof normalPrice === 'number' && normalPrice > 0
    ? `<line x1="${pad.left}" y1="${yOf(normalPrice).toFixed(1)}" x2="${width - pad.right}" y2="${yOf(normalPrice).toFixed(1)}" stroke="#f59e0b" stroke-dasharray="4 4" stroke-width="1.2" opacity="0.75" />
       <text x="${pad.left + 6}" y="${(yOf(normalPrice) - 5).toFixed(1)}" text-anchor="start" fill="#f59e0b" font-size="11" font-weight="600">Baseline ${formatMoney(normalPrice)}</text>`
    : '';

  const targetLine = typeof preferredPrice === 'number' && preferredPrice > 0
    ? `<line x1="${pad.left}" y1="${yOf(preferredPrice).toFixed(1)}" x2="${width - pad.right}" y2="${yOf(preferredPrice).toFixed(1)}" stroke="#a78bfa" stroke-dasharray="3 3" stroke-width="1.2" opacity="0.8" />
       <text x="${pad.left + 6}" y="${(yOf(preferredPrice) + 13).toFixed(1)}" text-anchor="start" fill="#c4b5fd" font-size="11" font-weight="600">Target ${formatMoney(preferredPrice)}</text>`
    : '';

  const xLabels = valid.length === 1
    ? `<text x="${(pad.left + plotW / 2).toFixed(1)}" y="${height - 12}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${formatShortDate(valid[0].observedAt)}</text>`
    : [0, 0.5, 1].map((frac) => {
        const ts = minT + (maxT - minT) * frac;
        const x = pad.left + plotW * frac;
        const anchor = frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle';
        return `<text x="${x.toFixed(1)}" y="${height - 12}" text-anchor="${anchor}" fill="var(--text-muted)" font-size="11">${formatShortDate(new Date(ts).toISOString())}</text>`;
      }).join('');

  const legend = retailers.map((r) => `
    <span class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${colorMap.get(r)}"></span>
      ${r}
    </span>`).join('');

  containerEl.innerHTML = `
    <div class="chart-wrap">
      <div class="chart-legend">${legend}</div>
      <div class="chart-stage">
        <svg viewBox="0 0 ${width} ${height}" class="price-svg" role="img" aria-label="Observed price history chart">
          ${rangeBand}
          ${yTicks.map((t) => `
            <line x1="${pad.left}" y1="${t.y.toFixed(1)}" x2="${width - pad.right}" y2="${t.y.toFixed(1)}" stroke="var(--border-subtle)" stroke-width="1" />
            <text x="${pad.left - 10}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="11" class="tabular">${formatMoney(t.val)}</text>
          `).join('')}
          ${normalLine}
          ${lowLine}
          ${targetLine}
          ${seriesSvg}
          ${xLabels}
        </svg>
        <div class="chart-tooltip" hidden></div>
      </div>
      <div class="chart-footnote">${honestyNote || `Displaying ${valid.length} real recorded observation${valid.length === 1 ? '' : 's'}.`}</div>
    </div>`;

  const tooltip = containerEl.querySelector('.chart-tooltip');
  const stage = containerEl.querySelector('.chart-stage');
  for (const dot of containerEl.querySelectorAll('.chart-dot')) {
    dot.addEventListener('mouseenter', (ev) => {
      const obs = valid[Number(dot.dataset.idx)];
      if (!obs || !tooltip) return;
      tooltip.hidden = false;
      tooltip.innerHTML = `
        <strong>${formatMoney(obs.price)}</strong> · ${obs.retailerName || obs.retailerId}<br/>
        <span>${formatShortDate(obs.observedAt)}</span><br/>
        <span class="muted">Source: ${obs.sourceId || 'monitor'}${obs.allInTotal ? ` · Est. All-In ${formatMoney(obs.allInTotal)}` : ''}</span>`;
      const rect = stage.getBoundingClientRect();
      const left = Math.min(rect.width - 210, Math.max(10, ev.clientX - rect.left + 12));
      const top = Math.max(8, ev.clientY - rect.top - 58);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });
    dot.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.hidden = true;
    });
  }
}

/**
 * Render a compact horizontal retailer price comparison bar chart.
 */
export function renderRetailerCompareBars(containerEl, offers = []) {
  if (!containerEl) return;
  const valid = (offers || []).filter((o) => typeof (o.finalAllInTotal ?? o.currentPrice) === 'number');
  if (!valid.length) {
    containerEl.innerHTML = '<div class="muted small">No comparable verified offers yet.</div>';
    return;
  }
  const maxVal = Math.max(...valid.map((o) => o.finalAllInTotal ?? o.currentPrice), 1);
  const minVal = Math.min(...valid.map((o) => o.finalAllInTotal ?? o.currentPrice));

  containerEl.innerHTML = `<div class="compare-bars">${valid.map((o) => {
    const val = o.finalAllInTotal ?? o.currentPrice;
    const pct = Math.max(12, Math.round((val / maxVal) * 100));
    const isBest = val === minVal;
    return `
      <div class="compare-bar-row ${isBest ? 'is-best' : ''}">
        <div class="compare-bar-label">
          <span>${o.retailerName || 'Retailer'}</span>
          <strong class="tabular">${formatMoney(val)} ${isBest ? '★ Best' : ''}</strong>
        </div>
        <div class="compare-bar-track">
          <div class="compare-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('')}</div>`;
}
