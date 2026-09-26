import {buildForecastWindows} from './forecast-windows.js?v=blend-windows-v1';

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
  if (!first) return '';
  const title = kind === 'perfect' ? 'Perfect weather ahead' : windows.some(w=>w.level==='thunder') ? 'Rain and storm outlook' : first.title;
  const more = windows.length > 1 ? ` · +${windows.length-1} more` : '';
  return `<button type="button" class="forecast-window-banner forecast-window-${kind}" data-forecast-window="${kind}" aria-haspopup="dialog" aria-controls="forecast-window-dialog"><span class="forecast-window-icon">${icon(kind)}</span><span class="forecast-window-copy"><strong>${esc(title)}</strong><span>${esc(dayLabel(first.start,view.timeZone,now))} · ${esc(timeRange(first,view.timeZone,now))}${esc(more)}</span></span><span class="forecast-window-action">View times <b aria-hidden="true">›</b></span></button>`;
}

export function forecastWindowDetailHTML(view, kind, place, now = Date.now()) {
  const windows = view[kind] || [], zone = view.timeZone, perfect = kind === 'perfect';
  const heading = perfect ? 'Perfect weather' : 'Rain and storm outlook', groups = new Map();
  for (const w of windows) {if(!groups.has(w.date))groups.set(w.date,[]);groups.get(w.date).push(w);}
  const headers = perfect ? '<th scope="col">Hour</th><th scope="col">Feels like</th><th scope="col">Dew point</th><th scope="col">Clouds</th><th scope="col">Rain</th>' : '<th scope="col">Hour</th><th scope="col">Rain likelihood</th><th scope="col">Outlook</th>';
  const row = h => `<tr data-forecast-hour="${esc(h.time)}"><th scope="row">${esc(clock(Date.parse(h.time),zone,true))}</th>${perfect ? `<td>${value(h.feels,'°')}</td><td>${value(h.dewpoint,'°')}</td><td>${value(h.cloud,'%')}</td><td>${value(h.rainChance,'%')}</td>` : `<td>${value(h.rainChance,'%')}</td><td>${h.thunder ? 'Thunderstorms possible' : finite(h.rainChance)&&h.rainChance>=80 ? 'High rain likelihood' : 'Rain likely'}</td>`}</tr>`;
  const period = w => `<div class="forecast-window-period"><h4>${esc(timeRange(w,zone,now))}${perfect?'':` <span>${esc(w.title)}</span>`}</h4><div class="forecast-window-table-wrap"><table class="forecast-window-table"><caption class="sr-only">${esc(heading)}: ${esc(dayLabel(w.start,zone,now))}, ${esc(timeRange(w,zone,now))}</caption><thead><tr>${headers}</tr></thead><tbody>${w.hours.map(row).join('')}</tbody></table></div></div>`;
  return `<div class="dialog-eyebrow">${esc(place||'Your location')}</div><h2 id="forecast-window-title">${heading}</h2><p class="forecast-window-intro">All qualifying forecast times in the next 5 days, in local time.</p>${[...groups.values()].map(group=>`<section class="forecast-window-day"><h3>${esc(dayLabel(group[0].start,zone,now))}</h3>${group.map(period).join('')}</section>`).join('')}`;
}

function bindDialog() {
  const dialog = document.getElementById('forecast-window-dialog');
  if (!dialog || boundDialog === dialog) return dialog;
  boundDialog = dialog;
  document.getElementById('close-forecast-window')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{selectedKind=null;if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
  return dialog;
}
function openWindow(kind, now = Date.now()) {
  const dialog=bindDialog(), content=document.getElementById('forecast-window-content');
  if(!dialog||!content||!currentView?.[kind]?.length)return;
  selectedKind=kind;
  content.innerHTML=forecastWindowDetailHTML(currentView,kind,latest?.location?.name,now);
  if(!dialog.open)dialog.showModal();
  document.body.classList.add('dialog-open');
}
export function renderForecastWindowBanners(data, now = Date.now()) {
  ensureTrackerLink();
  const root=document.getElementById('forecast-window-banners');
  if(!root)return;
  latest=data;currentView=buildForecastWindows(data,now);
  const html=['perfect','rain'].map(kind=>forecastWindowBannerHTML(currentView,kind,now)).join('');
  root.hidden=!html;root.innerHTML=html;
  root.querySelectorAll('[data-forecast-window]').forEach(button=>button.addEventListener('click',()=>openWindow(button.dataset.forecastWindow)));
  if(selectedKind){if(currentView[selectedKind]?.length)openWindow(selectedKind,now);else bindDialog()?.close();}
  if(!refreshTimer)refreshTimer=setInterval(()=>{if(latest)renderForecastWindowBanners(latest);},60000);
  return currentView;
}
export function resetForecastWindowBanners() {
  latest=null;currentView=null;selectedKind=null;
  if(refreshTimer)clearInterval(refreshTimer);refreshTimer=null;
  const root=document.getElementById('forecast-window-banners');
  if(root){root.hidden=true;root.innerHTML='';}
  const dialog=document.getElementById('forecast-window-dialog');
  if(dialog?.open)dialog.close();
}
