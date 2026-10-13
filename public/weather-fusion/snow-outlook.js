// Snow outlook tile + popup (modeled on the Rain & storm outlook). Renders only when the
// server's snow outlook says snow is possible in the 7-day window. Missing data stays "n/a".
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inch = (v) => finite(v) ? `${v.toFixed(1)}"` : 'n/a';
const icon = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3v26M5 9.5l22 13M5 22.5l22-13M12 5l4 3 4-3M12 27l4-3 4 3"/></svg>';
let latest = null;
const dayName = (r) => r.index === 0 ? 'Today' : r.label;
function amount(r) { return r.range ? `${r.range[0]}–${r.range[1]}"` : finite(r.best) ? inch(r.best) : 'n/a'; }
export function snowBannerSummary(snow) {
  const days = (snow?.days || []).filter((r) => r.possible);
  if (!days.length) return snow?.wssi ? snow.wssi.title : 'Snow possible';
  const first = days[0], tot = snow.stormTotal || {};
  const vals = [tot.nws, tot.ecmwf, tot.gfs].filter(finite), lo = vals.length ? Math.min(...vals) : null, hi = vals.length ? Math.max(...vals) : null;
  const total = !vals.length ? '' : hi < 0.1 ? ' · little or no accumulation' : (hi - lo >= 0.5 ? ` · ${lo.toFixed(1)}–${hi.toFixed(1)}" total` : ` · ~${hi.toFixed(1)}" total`);
  return `${dayName(first)}${days.length > 1 ? ` · +${days.length - 1} more day${days.length > 2 ? 's' : ''}` : ''}${total}${first.index >= 3 ? ' · far out' : ''}`;
}
export function snowDetailHTML(snow, place) {
  const rows = (snow.days || []).filter((r) => r.possible || finite(r.best) && r.best > 0);
  const wpc = (r) => r.wpc?.length ? r.wpc.map((w) => `≥${w.inches}": ${esc(w.category)}`).join('<br>') : 'n/a';
  const words = (r) => r.periods?.length ? r.periods.map((p) => `${esc(p.name)}: ${esc(p.wording)}${finite(p.pop) ? ` (${Math.round(p.pop)}% precip)` : ''}`).join('<br>') : 'No snow in NWS wording';
  const body = rows.map((r) => `<tr><th scope="row">${esc(dayName(r))}<small>${esc(r.date)}</small></th><td>${words(r)}</td><td>${inch(r.nwsSnowfall)}</td><td>${inch(r.models?.ecmwf)}</td><td>${inch(r.models?.gfs)}</td><td><strong>${amount(r)}</strong></td><td>${wpc(r)}</td><td>${esc(r.confidence)}</td></tr>`).join('');
  const t = snow.stormTotal || {};
  const wssi = snow.wssi ? `<p class="snow-wssi"><strong>WPC Winter Storm Severity Index:</strong> ${esc(snow.wssi.title)}. <a href="${esc(snow.wssi.url)}" target="_blank" rel="noopener noreferrer">WSSI map ↗</a></p>` : '<p class="snow-wssi">WPC Winter Storm Severity Index: no winter impact area here.</p>';
  return `<div class="dialog-eyebrow">${esc(place || 'Your location')}</div><h2 id="forecast-window-title">Snow outlook</h2>
  <p class="forecast-window-intro">Days in the next 7 where snow is possible. Amounts are inches. Days 4+ are low confidence. "n/a" means that source has no data for that day.</p>${wssi}
  <div class="forecast-window-table-wrap"><table class="forecast-window-table snow-table"><thead><tr><th scope="col">Day</th><th scope="col">NWS wording (precip chance)</th><th scope="col">NWS snow</th><th scope="col">ECMWF</th><th scope="col">GFS</th><th scope="col">Expected</th><th scope="col">WPC probability</th><th scope="col">Confidence</th></tr></thead>
  <tbody>${body || '<tr><td colspan="8">No day-level snow signal; see WSSI above.</td></tr>'}</tbody>
  <tfoot><tr><th scope="row">7-day total</th><td></td><td>${inch(t.nws)}</td><td>${inch(t.ecmwf)}</td><td>${inch(t.gfs)}</td><td></td><td></td><td></td></tr></tfoot></table></div>
  <p class="aqi-source">Sources: NWS gridpoint snowfall (mm→in; covers about the next 3–4 days, later days n/a) and NWS forecast wording/precipitation chance (chance of any precipitation where the wording mentions snow, not a snow-only probability); Open-Meteo ECMWF IFS and GFS daily snowfall (cm→in); WPC probabilistic winter precipitation (days 1–3) and WSSI. NBM snow probabilities are not available from this feed. Expected = NWS amount, or the model range when sources differ by 0.5" or more.</p>`;
}
function open() {
  const dialog = document.getElementById('forecast-window-dialog'), content = document.getElementById('forecast-window-content');
  if (!dialog || !content || !latest?.snow) return;
  content.innerHTML = snowDetailHTML(latest.snow, latest.location?.name);
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('dialog-open');
  document.getElementById('close-forecast-window')?.addEventListener('click', () => dialog.close(), { once: true });
}
export function renderSnowOutlook(data) {
  latest = data;
  let root = document.getElementById('snow-outlook-banner');
  if (!root) {
    const anchor = document.getElementById('forecast-window-banners'); if (!anchor) return;
    root = document.createElement('section'); root.id = 'snow-outlook-banner'; root.className = 'forecast-window-banners snow-outlook-banners'; root.setAttribute('aria-label', 'Snow outlook');
    anchor.after(root);
  }
  const snow = data?.snow;
  if (!snow?.possible) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  root.innerHTML = `<button type="button" class="forecast-window-banner forecast-window-snow" data-snow-outlook aria-haspopup="dialog" aria-controls="forecast-window-dialog"><span class="forecast-window-icon">${icon}</span><span class="forecast-window-copy"><strong>Snow outlook</strong><span>${esc(snowBannerSummary(snow))}</span></span><span class="forecast-window-action">View details <b aria-hidden="true">›</b></span></button>`;
  root.querySelector('[data-snow-outlook]').addEventListener('click', open);
}
