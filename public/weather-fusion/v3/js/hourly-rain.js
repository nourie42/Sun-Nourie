const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

export const rainPercent = value => Number.isFinite(value) ? `${Math.round(value)}%` : '—';

export function hourlyRainInputsHTML(ledger) {
  if (!Number.isFinite(ledger?.totalPts)) return '<p>Hourly rain chance unavailable.</p>';
  if (!ledger.entries?.length) {
    const source = {
      'nws-fallback': 'Official NWS hourly rain probability',
      'open-meteo': 'Open-Meteo hourly rain probability'
    }[ledger.mode] || 'Published hourly rain chance';
    return `<p>${source} <strong>${rainPercent(ledger.totalPts)}</strong></p>`;
  }

  const rows = ledger.entries.map(entry => {
    let input = Number.isFinite(entry.amount) ? `${entry.amount.toFixed(3)} in/hr` : 'Rainfall amount unavailable';
    if (entry.kind === 'probability') input = `${rainPercent(entry.vote)} probability`;
    return `<tr><th scope="row">${esc(entry.label)}</th><td>${input}</td><td data-rain-points="${entry.shownPoints}">${entry.shownPoints}</td></tr>`;
  }).join('');
  return `<table class="math-table rain-inputs-table">
    <thead><tr><th scope="col">Source</th><th scope="col">Input used</th><th scope="col">Points</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th scope="row" colspan="2">Rain chance (rounded)</th><td><strong>${rainPercent(ledger.totalPts)}</strong></td></tr></tfoot>
  </table>`;
}
