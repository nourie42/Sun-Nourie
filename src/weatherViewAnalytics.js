import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORE_FILE = path.join(DATA_DIR, 'weather-view-analytics.json');
const MAX_RECENT = 150;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

function detectDevice(ua = '', viewportWidth = 0) {
  const w = Number(viewportWidth) || 0;
  if (/ipad|tablet|kindle|playbook|silk/i.test(ua) || (w >= 600 && w < 1024 && /mobile|android|touch/i.test(ua))) {
    return 'Tablet';
  }
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua) || (w > 0 && w < 768)) {
    return 'Mobile';
  }
  return 'Desktop';
}

function normalizePageLabel(rawPath = '') {
  const p = String(rawPath || '').split('?')[0];
  if (p.includes('/v3')) return 'Beta App (/weather-fusion/v3/)';
  if (p.includes('experimental-weather')) return 'Experimental (/weather-fusion/experimental-weather.html)';
  if (p.includes('analytics')) return 'View Analytics (/weather-fusion/analytics.html)';
  if (p.includes('glance')) return 'Glance (/weather-fusion/glance.html)';
  if (p.includes('blend')) return 'Blend (/weather-fusion/blend.html)';
  if (p.includes('today')) return 'Today (/weather-fusion/today.html)';
  if (p.includes('ultimate')) return 'Ultimate (/weather-fusion/ultimate.html)';
  if (p.includes('weathernext')) return 'WeatherNext (/weathernext/)';
  return 'Main App (/weather-fusion/)';
}

function loadInitialStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && typeof parsed.totalViews === 'number') {
        return parsed;
      }
    }
  } catch {}
  return {
    totalViews: 0,
    uniqueVisitors: {},
    byPage: {},
    byLocation: {},
    byTimeZone: {},
    byDevice: { Mobile: 0, Desktop: 0, Tablet: 0 },
    byReferrer: {},
    hourlyBuckets: {},
    dailyBuckets: {},
    recentViews: []
  };
}

export function createWeatherViewAnalytics({ now = Date.now } = {}) {
  const store = loadInitialStore();
  let saveTimer = null;

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
      } catch {}
    }, 1200);
    if (typeof saveTimer.unref === 'function') saveTimer.unref();
  }

  function visitorHash(req) {
    const ip =
      String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || 'local')
        .split(',')[0]
        .trim();
    const ua = String(req?.headers?.['user-agent'] || 'browser').slice(0, 120);
    return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
  }

  function recordView({
    req = null,
    pagePath = '/weather-fusion/',
    city = '',
    latitude = null,
    longitude = null,
    timeZone = '',
    referrer = '',
    viewportWidth = 0
  } = {}) {
    const ts = now();
    const iso = new Date(ts).toISOString();
    const hourKey = iso.slice(0, 13) + ':00:00Z';
    const dayKey = iso.slice(0, 10);
    const ua = String(req?.headers?.['user-agent'] || '');
    const device = detectDevice(ua, viewportWidth);
    const pageLabel = normalizePageLabel(pagePath);
    const vId = visitorHash(req);

    store.totalViews = (store.totalViews || 0) + 1;
    store.uniqueVisitors[vId] = ts;
    store.byPage[pageLabel] = (store.byPage[pageLabel] || 0) + 1;
    store.byDevice[device] = (store.byDevice[device] || 0) + 1;
    store.hourlyBuckets[hourKey] = (store.hourlyBuckets[hourKey] || 0) + 1;
    store.dailyBuckets[dayKey] = (store.dailyBuckets[dayKey] || 0) + 1;

    const cleanTz = String(timeZone || '').trim() || 'America/New_York';
    store.byTimeZone[cleanTz] = (store.byTimeZone[cleanTz] || 0) + 1;

    const rawRef = String(referrer || req?.headers?.referer || '').trim();
    let refLabel = 'Direct / Bookmark';
    if (rawRef) {
      try {
        const u = new URL(rawRef, 'https://sun-nourie.onrender.com');
        if (u.pathname.includes('/v3')) refLabel = 'Weather Nourie Beta (/v3/)';
        else if (u.pathname.includes('/weather-fusion')) refLabel = 'Weather Nourie Main App';
        else refLabel = u.hostname || 'Direct / Bookmark';
      } catch {
        refLabel = 'Direct / Bookmark';
      }
    }
    store.byReferrer[refLabel] = (store.byReferrer[refLabel] || 0) + 1;

    const cleanCity = String(city || '').trim();
    const latNum = Number(latitude);
    const lonNum = Number(longitude);
    const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum) && (latNum !== 0 || lonNum !== 0);
    const locLabel =
      cleanCity && !/finding your location|selected location|choose a location/i.test(cleanCity)
        ? cleanCity
        : hasCoords
        ? `${latNum.toFixed(2)}°, ${lonNum.toFixed(2)}°`
        : '';

    if (locLabel) {
      const existing = store.byLocation[locLabel] || {
        name: locLabel,
        views: 0,
        latitude: hasCoords ? Number(latNum.toFixed(4)) : null,
        longitude: hasCoords ? Number(lonNum.toFixed(4)) : null,
        lastSeen: iso
      };
      existing.views += 1;
      existing.lastSeen = iso;
      if (hasCoords && existing.latitude === null) {
        existing.latitude = Number(latNum.toFixed(4));
        existing.longitude = Number(lonNum.toFixed(4));
      }
      store.byLocation[locLabel] = existing;
    }

    store.recentViews.unshift({
      time: iso,
      page: pageLabel,
      where: locLabel || cleanTz.replace(/^.*\//, '').replace(/_/g, ' '),
      timeZone: cleanTz,
      device,
      referrer: refLabel
    });
    if (store.recentViews.length > MAX_RECENT) {
      store.recentViews.length = MAX_RECENT;
    }

    scheduleSave();
  }

  function recordLocationLookup({ req = null, name = '', latitude = null, longitude = null, timeZone = '' } = {}) {
    const cleanCity = String(name || '').trim();
    const latNum = Number(latitude);
    const lonNum = Number(longitude);
    const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum) && (latNum !== 0 || lonNum !== 0);
    if (!cleanCity && !hasCoords) return;
    const locLabel = cleanCity || `${latNum.toFixed(2)}°, ${lonNum.toFixed(2)}°`;
    const iso = new Date(now()).toISOString();
    const existing = store.byLocation[locLabel] || {
      name: locLabel,
      views: 0,
      latitude: hasCoords ? Number(latNum.toFixed(4)) : null,
      longitude: hasCoords ? Number(lonNum.toFixed(4)) : null,
      lastSeen: iso
    };
    existing.views += 1;
    existing.lastSeen = iso;
    store.byLocation[locLabel] = existing;
    if (timeZone) {
      store.byTimeZone[timeZone] = (store.byTimeZone[timeZone] || 0) + 1;
    }
    scheduleSave();
  }

  function getSnapshot() {
    const ts = now();
    const curHourFloor = Math.floor(ts / HOUR_MS) * HOUR_MS;
    const curDayFloor = Math.floor(ts / DAY_MS) * DAY_MS;

    const last24Hours = [];
    let viewsLast24h = 0;
    for (let i = 23; i >= 0; i--) {
      const hEpoch = curHourFloor - i * HOUR_MS;
      const hKey = new Date(hEpoch).toISOString().slice(0, 13) + ':00:00Z';
      const count = store.hourlyBuckets[hKey] || 0;
      viewsLast24h += count;
      last24Hours.push({ hour: hKey, count });
    }

    const last7Days = [];
    let viewsLast7d = 0;
    for (let i = 6; i >= 0; i--) {
      const dEpoch = curDayFloor - i * DAY_MS;
      const dKey = new Date(dEpoch).toISOString().slice(0, 10);
      const count = store.dailyBuckets[dKey] || 0;
      viewsLast7d += count;
      last7Days.push({ date: dKey, count });
    }

    const todayKey = new Date(ts).toISOString().slice(0, 10);
    const viewsToday = store.dailyBuckets[todayKey] || 0;

    const locations = Object.values(store.byLocation)
      .map((loc) => ({ ...loc, label: loc.name }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 25);
    const pages = Object.entries(store.byPage)
      .map(([page, views]) => ({ page, views }))
      .sort((a, b) => b.views - a.views);
    const timeZones = Object.entries(store.byTimeZone)
      .map(([timeZone, views]) => ({ timeZone, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 15);
    const referrers = Object.entries(store.byReferrer)
      .map(([source, views]) => ({ source, views }))
      .sort((a, b) => b.views - a.views);

    return {
      generatedAt: new Date(ts).toISOString(),
      totalViews: store.totalViews || 0,
      uniqueVisitors: Object.keys(store.uniqueVisitors || {}).length,
      viewsToday,
      viewsLast24h,
      viewsLast7d,
      locationsCount: Object.keys(store.byLocation || {}).length,
      locations,
      pages,
      timeZones,
      devices: store.byDevice,
      referrers,
      last24Hours,
      last7Days,
      recentViews: (store.recentViews || []).slice(0, 40)
    };
  }

  function recordPageView(req, meta = {}) {
    return recordView({
      req,
      pagePath: meta.page || meta.pagePath || req?.path || '/weather-fusion/',
      city: meta.city || meta.locationName || meta.name || req?.headers?.['x-vercel-ip-city'] || '',
      latitude: meta.latitude,
      longitude: meta.longitude,
      timeZone: meta.timeZone || req?.headers?.['x-vercel-ip-timezone'] || '',
      referrer: meta.referrer,
      viewportWidth: meta.viewportWidth
    });
  }

  return { recordView, recordPageView, recordLocationLookup, getSnapshot };
}
