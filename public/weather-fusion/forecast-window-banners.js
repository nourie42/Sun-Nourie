import {buildForecastWindows} from './forecast-windows.js?v=sun-window-main-v3';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value = (n, suffix = '') => finite(n) ? `${Math.round(n)}${suffix}` : '—';
const dateKey = (t, zone) => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
const clock = (t, zone, withZone = false) => new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit',...(withZone ? {timeZoneName:'short'} : {})}).format(t).replace(':00','').replace(/\s([AP]M)/,'$1').replace(/AM|PM/g,x=>x.toLowerCase());
const dayLabel = (t, zone, now) => dateKey(t,zone) === dateKey(now,zone) ? 'Today' : new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',month:'short',day:'numeric'}).format(t);
const timeRange = (w, zone, now) => `${w.start <= now && w.end > now ? 'Now' : clock(w.start,zone)}–${clock(w.end,zone)}`;
const icon = kind => kind === 'perfect'
  ? '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6"/><path d="M16 2v4m0 20v4M2 16h4m20 0h4M6 6l3 3m14 14 3 3M6 26l3-3M23 9l3-3"/></svg>'
  : '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 20a6 6 0 1 1 1-12 8 8 0 0 1 15 3 4.5 4.5 0 0 1 0 9H8ZM10 24l-2 4m10-4-2 4m10-4-2 4"/></svg>';
let latest = null, currentView = null, selectedKind = null, boundDialog = null, refreshTimer = null;

function ensureTrackerLink() {
  if (!/\/weather-fusion\/experimental-weather\.html$/i.test(location.pathname)) return;
  if (document.getElementById('experimental-whats-up-link')) return;
  const back = document.getElementById('experimental-back'), shell = document.querySelector('.shell');
  if (!back || !shell) return;
  const link = document.createElement('a');
  link.className = 'experimental-whats-up-link';
  link.id = 'experimental-whats-up-link';
  link.href = '/whats-up';
  link.textContent = 'Perfect weather tracker';
  back.after(link);
}

export function forecastWindowBannerHTML(view, kind, now = Date.now()) {
  const windows = view[kind] || [], first = windows[0];
  const perfect = kind === 'perfect';
  const title = perfect ? 'Perfect weather ahead' : 'Rain & storm outlook';
  const summary = first
    ? `${dayLabel(first.start,view.timeZone,now)} · ${timeRange(first,view.timeZone,now)}${windows.length > 1 ? ` · +${windows.length-1} more` : ''}`