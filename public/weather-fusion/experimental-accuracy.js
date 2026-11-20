// Mounts the Multi-Metric Historical Model Accuracy dashboard onto /weather-fusion/experimental-weather.html
// Evaluates Weather Nourie vs NOAA HRRR, NOAA NBM, ECMWF IFS, DWD ICON, UK Met Office,
// Canadian GEM, and NOAA GFS across Temperature, Rain/Precip, Wind, Cloud Cover, and Humidity.

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RANK_MODES = [
  { id: 'overall', label: '🏆 Overall (All Metrics)' },
  { id: 'temp', label: '🌡 Temperature' },
  { id: 'rain', label: '🌧 Rain / Precip' },
  { id: 'wind', label: '💨 Wind' },
  { id: 'sky', label: '☁ Clouds & Humidity' },
];

function catmullRomPath(pts) {
  const segs = [];
  let cur = [];
  for (const p of pts) {
    if (p && finite(p.x) && finite(p.y)) cur.push(p);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs
    .map((seg) => {
      if (seg.length === 1) return `M${seg[0].x.toFixed(1)},${seg[0].y.toFixed(1)}`;
      if (seg.length === 2) return `M${seg[0].x.toFixed(1)},${seg[0].y.toFixed(1)} L${seg[1].x.toFixed(1)},${seg[1].y.toFixed(1)}`;
      let d = `M${seg[0].x.toFixed(1)},${seg[0].y.toFixed(1)}`;
      for (let i = 0; i < seg.length - 1; i++) {
        const p0 = seg[Math.max(0, i - 1)];
        const p1 = seg[i];
        const p2 = seg[i + 1];
        const p3 = seg[Math.min(seg.length - 1, i + 2)];
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
      }
      return d;
    })
    .join(' ');
}

function sortRankingsByMode(rankings, mode) {
  const copy = [...rankings];
  if (mode === 'temp') {
    copy.sort((a, b) => (a.maeF ?? 99) - (b.maeF ?? 99));
  } else if (mode === 'rain') {
    copy.sort((a, b) => (b.scores?.rain ?? -1) - (a.scores?.rain ?? -1) || (b.precipHitPct ?? -1) - (a.precipHitPct ?? -1));
  } else if (mode === 'wind') {
    copy.sort((a, b) => (a.windMaeMph ?? 99) - (b.windMaeMph ?? 99));
  } else if (mode === 'sky') {
    const skyScore = (r) => {
      const vals = [r.scores?.cloud, r.scores?.humidity].filter(finite);
      return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : -1;
    };
    copy.sort((a, b) => skyScore(b) - skyScore(a));
  } else {
    copy.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1) || (a.maeF ?? 99) - (b.maeF ?? 99));
  }
  return copy.map((item, idx) => ({ ...item, activeRank: idx + 1 }));
}

function primaryMetricDisplay(r, mode) {
  if (mode === 'temp') {
    return { val: `${r.maeF.toFixed(2)}°F`, unit: 'Temp MAE', barPct: Math.max(8, Math.min(100, r.scores?.temp ?? 60)) };
  }
  if (mode === 'rain') {
    const hit = finite(r.precipHitPct) ? `${r.precipHitPct.toFixed(0)}%` : '—';
    return { val: hit, unit: 'Rain Hit', barPct: Math.max(8, Math.min(100, r.scores?.rain ?? 50)) };
  }
  if (mode === 'wind') {
    const w = finite(r.windMaeMph) ? `${r.windMaeMph.toFixed(1)} mph` : '—';
    return { val: w, unit: 'Wind MAE', barPct: Math.max(8, Math.min(100, r.scores?.wind ?? 50)) };
  }
  if (mode === 'sky') {
    const c = finite(r.cloudMaePct) ? `±${Math.round(r.cloudMaePct)}%` : '—';
    const avg = [r.scores?.cloud, r.scores?.humidity].filter(finite);
    const pct = avg.length ? avg.reduce((s, x) => s + x, 0) / avg.length : 50;
    return { val: c, unit: 'Cloud MAE', barPct: Math.max(8, Math.min(100, pct)) };
  }
  const sc = finite(r.overallScore) ? r.overallScore.toFixed(1) : String(r.accuracyScore ?? '—');
  return { val: `${sc}`, unit: '/ 100 Overall', barPct: Math.max(8, Math.min(100, r.overallScore ?? 60)) };
}

export function mountExperimentalAccuracy() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('experimental-accuracy-section')) return;

  const targetAnchor =
    document.getElementById('wn-compare-section') ||
    document.getElementById('model-explanation') ||
    document.querySelector('.forecast-grid');
  if (!targetAnchor) return;

  const section = document.createElement('section');
  section.id = 'experimental-accuracy-section';
  section.className = 'glass exp-acc-card';
  section.setAttribute('aria-labelledby', 'exp-acc-title');
  section.innerHTML = `
    <div class="exp-acc-head">
      <div>
        <span class="exp-eyebrow">MULTI-METRIC VERIFICATION · TEMP · RAIN · WIND · CLOUDS · HUMIDITY</span>
        <h2 id="exp-acc-title">Past Model Accuracy · Who Was Most Accurate Here?</h2>
        <p id="exp-acc-subtitle" class="exp-acc-sub">Evaluating Weather Nourie &amp; all global weather models against observed station &amp; ERA5 weather…</p>
      </div>
      <div class="exp-acc-filters">
        <div class="exp-seg-group" role="group" aria-label="Verification window">
          <button type="button" class="exp-seg-btn" data-acc-days="7" aria-pressed="false">7 Days</button>
          <button type="button" class="exp-seg-btn is-active" data-acc-days="10" aria-pressed="true">10 Days</button>
          <button type="button" class="exp-seg-btn" data-acc-days="14" aria-pressed="false">14 Days</button>
        </div>
        <div class="exp-seg-group" role="group" aria-label="Forecast lead time">
          <button type="button" class="exp-seg-btn is-active" data-acc-horizon="24" aria-pressed="true">24h Lead</button>
          <button type="button" class="exp-seg-btn" data-acc-horizon="48" aria-pressed="false">48h Lead</button>
        </div>
      </div>
    </div>

    <div id="exp-acc-body" class="exp-acc-body">
      <div class="exp-acc-loading">Scoring Weather Nourie against all 7 US &amp; global models across Temperature, Rain, Wind, Clouds, and Humidity…</div>
    </div>
  `;

  if (targetAnchor === document.getElementById('wn-compare-section')) {
    targetAnchor.insertAdjacentElement('afterend', section);
  } else {
    targetAnchor.insertAdjacentElement('beforebegin', section);
  }

  let curLoc = {
    name: globalThis.__weatherNourieForecast?.location?.name || 'Knightdale, NC',
    latitude: globalThis.__weatherNourieForecast?.location?.latitude ?? 35.7877,
    longitude: globalThis.__weatherNourieForecast?.location?.longitude ?? -78.4806,
  };
  let curDays = 10;
  let curHorizon = 24;
  let curRankMode = 'overall';
  let hiddenSeries = new Set();
  let lastData = null;
  let loadToken = 0;

  const bodyEl = document.getElementById('exp-acc-body');
  const subEl = document.getElementById('exp-acc-subtitle');

  function renderTimelineChart(container, data) {
    const pts = data.hourlySeries || [];
    if (pts.length < 4) {
      container.innerHTML = '<p class="muted">Not enough verified hours yet for time-series plot.</p>';
      return;
    }

    const W = container.clientWidth >= 620 ? 820 : 540;
    const compact = W < 620;
    const H = compact ? 250 : 285;
    const PL = 42;
    const PR = 16;
    const PT = 22;
    const PB = 34;

    const models = data.activeModels || [];
    const visibleModels = models.filter((m) => !hiddenSeries.has(m.id));
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of pts) {
      if (finite(row.observed)) {
        if (row.observed < lo) lo = row.observed;
        if (row.observed > hi) hi = row.observed;
      }
      for (const m of visibleModels) {
        const v = row[m.id];
        if (finite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!finite(lo) || !finite(hi)) return;
    lo = Math.floor((lo - 3) / 5) * 5;
    hi = Math.ceil((hi + 3) / 5) * 5;

    const X = (i) => PL + (i / Math.max(1, pts.length - 1)) * (W - PL - PR);
    const Y = (v) => PT + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - PT - PB);
    const drawOrder = [...visibleModels].sort((a, b) => (a.isNourie ? 1 : b.isNourie ? -1 : 0));

    const yTicks = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => {
        const val = lo + f * (hi - lo);
        const y = Y(val).toFixed(1);
        return (
          `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.10)" stroke-dasharray="3,4"/>` +
          `<text x="${PL - 6}" y="${Number(y) + 4}" text-anchor="end" font-size="11" fill="#b7cae4">${Math.round(val)}°</text>`
        );
      })
      .join('');

    const stepX = Math.max(1, Math.floor(pts.length / (compact ? 4 : 7)));
    const fmtDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const xTicks = [];
    for (let i = 0; i < pts.length; i += stepX) {
      xTicks.push(
        `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#b7cae4">${esc(fmtDate.format(new Date(pts[i].time)))}</text>`
      );
    }

    const obsPts = pts.map((r, i) => (finite(r.observed) ? { x: X(i), y: Y(r.observed) } : null));
    const obsPath = catmullRomPath(obsPts);
    const obsValid = obsPts.filter(Boolean);
    const obsArea =
      obsValid.length >= 2
        ? `${obsPath} L${obsValid.at(-1).x.toFixed(1)},${(H - PB).toFixed(1)} L${obsValid[0].x.toFixed(1)},${(H - PB).toFixed(1)} Z`
        : '';

    const seriesSvg = drawOrder
      .map((m) => {
        const mPts = pts.map((r, i) => (finite(r[m.id]) ? { x: X(i), y: Y(r[m.id]) } : null));
        const d = catmullRomPath(mPts);
        if (!d) return '';
        if (m.isNourie) {
          return (
            `<path d="${d}" fill="none" stroke="rgba(165, 243, 252, 0.30)" stroke-width="11" stroke-linecap="round"/>` +
            `<path data-acc-line="nourie" d="${d}" fill="none" stroke="#ffffff" stroke-width="4.4" stroke-linecap="round"/>`
          );
        }
        return `<path data-acc-line="${esc(m.id)}" d="${d}" fill="none" stroke="${esc(m.color)}" stroke-width="1.6" opacity="0.72" stroke-linecap="round"/>`;
      })
      .join('');

    const chipsHtml = [
      `<span class="exp-acc-chip is-fixed"><i style="background:#5ce0a0;height:3px"></i>Actual Observed</span>`,
      ...models.map((m) => {
        const off = hiddenSeries.has(m.id);
        return (
          `<button type="button" class="exp-acc-chip${m.isNourie ? ' is-nourie' : ''}${off ? ' is-off' : ''}" data-acc-toggle="${esc(m.id)}" aria-pressed="${!off}">` +
          `<i style="background:${esc(m.color)};height:${m.isNourie ? '4.5px' : '2.5px'}"></i>${esc(m.name)}</button>`
        );
      }),
    ].join('');

    container.innerHTML = `
      <div class="exp-acc-chart-head">
        <div>
          <h3>Observed Weather vs Past Model Forecasts (${data.horizonHours}h Lead)</h3>
          <p class="exp-acc-chart-note"><strong>Weather Nourie</strong> renders with the heavier luminous curve against all individual models. Tap or slide to inspect each hour.</p>
        </div>
        <div class="exp-acc-chips">${chipsHtml}</div>
      </div>
      <div class="exp-acc-svg-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="exp-acc-svg" role="img" aria-label="Observed temperature versus past Weather Nourie and peer model forecasts">
          <defs>
            <linearGradient id="exp-obs-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#5ce0a0" stop-opacity="0.18"/>
              <stop offset="100%" stop-color="#5ce0a0" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          ${yTicks}
          ${xTicks.join('')}
          ${obsArea ? `<path d="${obsArea}" fill="url(#exp-obs-area)"/>` : ''}
          <path d="${obsPath}" fill="none" stroke="#5ce0a0" stroke-width="2.6" stroke-dasharray="5,4" stroke-linecap="round"/>
          ${seriesSvg}
          <line id="exp-acc-cross" x1="0" x2="0" y1="${PT}" y2="${H - PB}" stroke="rgba(255,255,255,0.75)" stroke-width="1.5" stroke-dasharray="3,3" opacity="0"/>
        </svg>
        <div id="exp-acc-tip" class="exp-acc-tip" hidden></div>
      </div>
    `;

    container.querySelectorAll('[data-acc-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.accToggle;
        if (hiddenSeries.has(id)) hiddenSeries.delete(id);
        else hiddenSeries.add(id);
        renderTimelineChart(container, data);
      });
    });

    const svg = container.querySelector('.exp-acc-svg');
    const cross = document.getElementById('exp-acc-cross');
    const tip = document.getElementById('exp-acc-tip');

    const showTip = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
      const idx = Math.max(0, Math.min(pts.length - 1, Math.round(((sx - PL) / Math.max(1, W - PL - PR)) * (pts.length - 1))));
      const row = pts[idx];
      if (!row) return;
      const xPos = X(idx);
      cross.setAttribute('x1', xPos);
      cross.setAttribute('x2', xPos);
      cross.setAttribute('opacity', '0.85');
      const d = new Date(row.time);
      const stamp = d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' });
      const rows = visibleModels
        .filter((m) => finite(row[m.id]))
        .map((m) => {
          const err = row[m.id] - row.observed;
          const errTxt = `${err >= 0 ? '+' : ''}${err.toFixed(1)}°`;
          return `<div class="exp-tip-row${m.isNourie ? ' is-nourie' : ''}"><span><i style="background:${esc(m.color)}"></i>${esc(m.name)}</span><b>${row[m.id].toFixed(1)}° (${errTxt})</b></div>`;
        })
        .join('');
      tip.innerHTML =
        `<div class="exp-tip-time">${esc(stamp)}</div>` +
        `<div class="exp-tip-row is-obs"><span><i style="background:#5ce0a0"></i>Actual Observed</span><b>${row.observed.toFixed(1)}°F</b></div>` +
        rows;
      tip.hidden = false;
      const px = (xPos / W) * rect.width;
      const tw = tip.offsetWidth || 180;
      tip.style.left = `${Math.max(4, Math.min(rect.width - tw - 4, px > rect.width * 0.55 ? px - tw - 12 : px + 12))}px`;
    };

    svg.addEventListener('pointermove', (e) => showTip(e.clientX));
    svg.addEventListener('pointerdown', (e) => showTip(e.clientX));
    svg.addEventListener('pointerleave', () => {
      cross.setAttribute('opacity', '0');
      tip.hidden = true;
    });
  }

  function renderData(data) {
    lastData = data;
    const rawRankings = data.rankings || [];
    if (!rawRankings.length) {
      bodyEl.innerHTML = '<p class="muted">Verification history unavailable for these coordinates.</p>';
      return;
    }

    const rankings = sortRankingsByMode(rawRankings, curRankMode);
    const winner = rankings[0];
    const nourie = rankings.find((r) => r.isNourie);
    const winnerDisp = primaryMetricDisplay(winner, curRankMode);
    const nourieDisp = nourie ? primaryMetricDisplay(nourie, curRankMode) : null;
    const tSum = data.truthSummary || {};
    const truthText =
      tSum.nwsStationHours > 0
        ? `${tSum.nwsStationHours}h NWS Station (${esc(tSum.stationId)}) + ${tSum.era5Hours}h ERA5 Reanalysis`
        : `${tSum.era5Hours || tSum.totalHours}h ERA5 Reanalysis`;

    subEl.textContent = `${data.location.stationName ? `Nearest station ${data.location.stationName} · ` : ''}${data.windowDays}-day ${data.horizonHours}h-ahead verification across ${rankings.length} models (${tSum.totalHours} verified hours)`;

    bodyEl.innerHTML = `
      <div class="exp-rank-tabs" role="tablist" aria-label="Rank models by weather metric">
        ${RANK_MODES.map(
          (m) =>
            `<button type="button" role="tab" class="exp-layer-btn${curRankMode === m.id ? ' is-active' : ''}" data-rank-mode="${m.id}" aria-selected="${curRankMode === m.id}">${m.label}</button>`
        ).join('')}
      </div>

      <div class="exp-acc-banners">
        <div class="exp-acc-stat is-winner">
          <small>#1 Most Accurate (${esc(RANK_MODES.find((m) => m.id === curRankMode)?.label.replace(/^[^\s]+\s/, '') || 'Overall')})</small>
          <strong>${esc(winner.name)}</strong>
          <span>${winnerDisp.val} ${winnerDisp.unit} · ${winner.maeF.toFixed(2)}°F Temp MAE${finite(winner.precipHitPct) ? ` · ${winner.precipHitPct.toFixed(0)}% Rain Hit` : ''}</span>
        </div>
        ${
          nourie
            ? `<div class="exp-acc-stat is-nourie">
                <small>Weather Nourie Standing</small>
                <strong>Rank #${nourie.activeRank} of ${rankings.length}</strong>
                <span>${nourieDisp.val} ${nourieDisp.unit} · Temp ${nourie.maeF.toFixed(2)}°F · Wind ${finite(nourie.windMaeMph) ? `${nourie.windMaeMph.toFixed(1)} mph` : '—'}${finite(nourie.cloudMaePct) ? ` · Clouds ±${Math.round(nourie.cloudMaePct)}%` : ''}</span>
              </div>`
            : ''
        }
        <div class="exp-acc-stat">
          <small>Observed Ground Truth</small>
          <strong>${tSum.totalHours} Hours</strong>
          <span>${truthText}</span>
        </div>
      </div>

      <div class="exp-acc-grid">
        <div class="exp-acc-table-wrap">
          <h3>Leaderboard · ${esc(data.scoringFormula || 'Multi-metric verification score')}</h3>
          <div class="exp-acc-rows">
            ${rankings
              .map((r) => {
                const disp = primaryMetricDisplay(r, curRankMode);
                const biasSign =
                  r.biasF > 0.05 ? `+${r.biasF.toFixed(2)}° warm` : r.biasF < -0.05 ? `${r.biasF.toFixed(2)}° cool` : '0.0° neutral';
                return `
                  <article class="exp-acc-row${r.isNourie ? ' is-nourie' : ''}${r.activeRank === 1 ? ' is-first' : ''}">
                    <div class="exp-acc-row-top">
                      <span class="exp-acc-rank">#${r.activeRank}</span>
                      <div class="exp-acc-name">
                        <strong><i style="background:${esc(r.color)}"></i>${esc(r.name)}</strong>
                        <small>${esc(r.subtitle)}</small>
                      </div>
                      <div class="exp-acc-mae">
                        <b>${disp.val}</b>
                        <small>${disp.unit}</small>
                      </div>
                    </div>
                    <div class="exp-acc-bar-track">
                      <span class="exp-acc-bar-fill" style="width:${disp.barPct.toFixed(1)}%;background:${r.isNourie ? 'linear-gradient(90deg,#ffffff,#7fd4ff)' : esc(r.color)}"></span>
                    </div>
                    <div class="exp-acc-metrics">
                      <span>Temp: <b>${r.maeF.toFixed(2)}°F</b> (${r.within2F.toFixed(0)}% ±2°)</span>
                      ${finite(r.precipHitPct) ? `<span>Rain: <b>${r.precipHitPct.toFixed(0)}% hit</b></span>` : ''}
                      ${finite(r.windMaeMph) ? `<span>Wind: <b>±${r.windMaeMph.toFixed(1)} mph</b></span>` : ''}
                      ${finite(r.cloudMaePct) ? `<span>Clouds: <b>±${Math.round(r.cloudMaePct)}%</b></span>` : ''}
                      ${finite(r.humidityMaePct) ? `<span>RH: <b>±${Math.round(r.humidityMaePct)}%</b></span>` : ''}
                      <span>Bias: <b>${biasSign}</b></span>
                    </div>
                  </article>
                `;
              })
              .join('')}
          </div>
        </div>
      </div>

      <div id="exp-acc-timeline-box" class="exp-acc-timeline-box"></div>

      <div class="exp-acc-daily-strip">
        <h3>Recent Daily Verification (Observed High vs Predicted Highs)</h3>
        <div class="exp-acc-daily-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Observed High</th>
                ${rankings.slice(0, 6).map((r) => `<th class="${r.isNourie ? 'is-nourie-col' : ''}">${esc(r.name)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${(data.dailySeries || [])
                .slice(-7)
                .reverse()
                .map((day) => {
                  return `<tr>
                    <td><b>${esc(day.label)}</b></td>
                    <td class="is-obs-col">${finite(day.observedHighF) ? `${Math.round(day.observedHighF)}°` : '—'}</td>
                    ${rankings
                      .slice(0, 6)
                      .map((r) => {
                        const cell = day.models?.[r.id];
                        return `<td class="${r.isNourie ? 'is-nourie-col' : ''}">${cell ? `${Math.round(cell.highF)}° <small>(±${cell.maeF.toFixed(1)}°)</small>` : '—'}</td>`;
                      })
                      .join('')}
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    bodyEl.querySelectorAll('[data-rank-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        curRankMode = btn.dataset.rankMode;
        renderData(data);
      });
    });

    const chartContainer = document.getElementById('exp-acc-timeline-box');
    if (chartContainer) renderTimelineChart(chartContainer, data);
  }

  async function refreshAccuracy() {
    const token = ++loadToken;
    bodyEl.innerHTML = `<div class="exp-acc-loading">Scoring Weather Nourie &amp; all global models for ${esc(curLoc.name)} (${curDays} days, ${curHorizon}h lead)…</div>`;
    try {
      const qs = new URLSearchParams({
        latitude: String(curLoc.latitude),
        longitude: String(curLoc.longitude),
        days: String(curDays),
        horizon: String(curHorizon),
      });
      const res = await fetch(`/api/weather-fusion/accuracy?${qs}`);
      if (token !== loadToken) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (token !== loadToken) return;
      renderData(payload);
    } catch {
      if (token !== loadToken) return;
      bodyEl.innerHTML = '<p class="muted">Could not load historical verification right now. Please retry.</p>';
    }
  }

  section.querySelectorAll('[data-acc-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      curDays = Number(btn.dataset.accDays);
      section.querySelectorAll('[data-acc-days]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      refreshAccuracy();
    });
  });

  section.querySelectorAll('[data-acc-horizon]').forEach((btn) => {
    btn.addEventListener('click', () => {
      curHorizon = Number(btn.dataset.accHorizon);
      section.querySelectorAll('[data-acc-horizon]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      refreshAccuracy();
    });
  });

  document.addEventListener('weather-nourie:forecast', (e) => {
    const loc = e.detail?.location;
    if (!loc || !finite(loc.latitude) || !finite(loc.longitude)) return;
    const sameSpot =
      Math.abs(loc.latitude - curLoc.latitude) < 0.02 &&
      Math.abs(loc.longitude - curLoc.longitude) < 0.02;
    curLoc = { name: loc.name || 'Selected location', latitude: loc.latitude, longitude: loc.longitude };
    if (sameSpot && (lastData || loadToken > 0)) return;
    refreshAccuracy();
  });

  window.addEventListener('weather-nourie:accuracy-location', (e) => {
    const loc = e.detail;
    if (!loc || !finite(loc.latitude) || !finite(loc.longitude)) return;
    curLoc = { name: loc.name || 'Selected location', latitude: loc.latitude, longitude: loc.longitude };
    refreshAccuracy();
  });

  window.addEventListener('resize', () => {
    if (!lastData) return;
    const c = document.getElementById('exp-acc-timeline-box');
    if (c) renderTimelineChart(c, lastData);
  });

  refreshAccuracy();
}
