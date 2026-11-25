import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import {clientIp} from './clientIp.js';

// A server-only password hash keeps the emergency access restriction enabled
// even before deployment environment variables are configured.
const DEFAULT_PASSWORD = {
  salt: 'f508db69d2dd3ce1aa599d30b6b3a454',
  digest: 'f2bc3fbe59abd929f0f353cd818455e1fcc4b037e8c23b4f72a537bc07e7611c',
};
const COOKIE = 'weather_site_auth';
const LOGIN = '/weather-fusion/login';
const LOGOUT = '/weather-fusion/logout';
const HOME = '/weather-fusion/';
const SESSION_MS = 12 * 60 * 60 * 1000;
// The main weather app, its V3 aliases and the old weather app are public. Other experimental pages,
// WeatherNext, What's Up, Deal Intelligence and compare tools retain their gate.
// Set WEATHER_FUSION_PUBLIC=0 to re-lock public weather access.
const PUBLIC_PAGES = new Set([
  '/weather-fusion', '/weather-fusion/', '/weather-fusion/index.html',
  '/weather-fusion/v3', '/weather-fusion/v3/', '/weather-fusion/v3/index.html',
  '/weather-fusion/old', '/weather-fusion/old/',
]);
const PUBLIC_ASSET = /^\/weather-fusion\/[a-z0-9][a-z0-9._-]*\.(?:js|css|webp|png|jpe?g|svg|json|webmanifest|ico)$/;
const PUBLIC_BETA_ASSET = /^\/weather-fusion\/v3\/(?:js\/[a-z0-9][a-z0-9._-]*\.js|css\/[a-z0-9][a-z0-9._-]*\.css|vendor\/(?:three\.module\.min\.js|maplibre-gl\.(?:js|css)|maplibre-license\.txt)|textures\/earth-(?:day|night)\.jpg)$/;
const PUBLIC_APIS = new Set(['forecast', 'alerts', 'briefing', 'bulletins', 'outlook', 'search', 'radar', 'models', 'winter-map', 'accuracy', 'globe', 'globe-image', 'globe-tile', 'storm-snow/history'].map(name => `/api/weather-fusion/${name}`));
export function isPublicWeatherPath(url, method = 'GET') {
  const upperMethod = String(method).toUpperCase();
  let pathname;
  try { pathname = canonicalPath(url); } catch { return false; }
  if (!['GET', 'HEAD'].includes(upperMethod)) return false;
  return PUBLIC_PAGES.has(pathname) || PUBLIC_ASSET.test(pathname) || PUBLIC_BETA_ASSET.test(pathname) || PUBLIC_APIS.has(pathname);
}
// Deal Lens is public; its access policy is independent of the weather sites.
const PREFIXES = ['/weather', '/weather-fusion', '/weathernext', '/api/weather-fusion', '/whats-up', '/whatsup', '/api/whats-up', '/deal-intelligence', '/api/deal-intelligence', '/black-friday', '/api/black-friday'];

// The gateway passes this private key to its child processes. It is never sent
// to clients; a restart invalidates sessions unless an environment key is set.
export const weatherSiteCookieSecret = process.env.WEATHER_SITE_COOKIE_SECRET || crypto.randomBytes(32).toString('hex');

function canonicalPath(url) {
  const value = String(url || '/');
  const raw = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? new URL(value).pathname : value.split('?')[0];
  return path.posix.normalize(decodeURIComponent(raw).replace(/\\/g, '/')).toLowerCase();
}

export function isProtectedWeatherPath(url) {
  const pathname = canonicalPath(url);
  return PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function safeReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return HOME;
  try {
    const pathname = canonicalPath(value);
    if (!isProtectedWeatherPath(value) || pathname.startsWith('/api/') || [LOGIN, LOGOUT].includes(pathname)) return HOME;
    return value;
  } catch { return HOME; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
}

function loginPage(returnTo, error = '') {
  const destination = safeReturn(returnTo);
  const blackFriday = canonicalPath(destination).startsWith('/black-friday');
  const title = blackFriday ? 'Black Friday Command Center' : 'Nourie Weather';
  const eyebrow = blackFriday ? 'PRIVATE FAMILY SHOPPING HQ' : 'PRIVATE WEATHER TOOLS';
  const message = blackFriday
    ? 'Sign in to open wish lists, saved deals, price tracking, and family shopping tools.'
    : 'Sign in to open Weather Nourie experiments and private tools.';
  const accent = blackFriday ? '#ff5a67' : '#58d5e8';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111f"><title>${escapeHtml(title)} | Private Access</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% -10%,#253d65 0,transparent 46%),linear-gradient(145deg,#050914,#09182a 58%,#101727);color:#f8fbff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}main{position:relative;width:100%;max-width:420px;padding:30px;border:1px solid rgba(255,255,255,.24);border-radius:26px;background:linear-gradient(145deg,rgba(255,255,255,.14),rgba(255,255,255,.055));box-shadow:0 28px 80px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.26);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}main:before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.16),transparent 38%)}.eyebrow{position:relative;margin:0 0 10px;color:${accent};font-size:12px;font-weight:800;letter-spacing:.17em}h1{position:relative;margin:0 0 10px;font-size:clamp(28px,8vw,38px);line-height:1.05;letter-spacing:-.03em}p{position:relative;margin:0 0 26px;color:#c2cede;line-height:1.55}form{position:relative}label{display:block;margin-bottom:8px;color:#e7eef8;font-size:14px;font-weight:700}input,button{width:100%;min-height:52px;font:inherit;border-radius:14px}input{padding:12px 14px;border:1px solid rgba(255,255,255,.28);background:rgba(3,9,19,.62);color:#fff;box-shadow:inset 0 1px 8px rgba(0,0,0,.26)}input:focus-visible,button:focus-visible{outline:3px solid ${accent};outline-offset:3px}button{margin-top:16px;border:1px solid rgba(255,255,255,.28);background:linear-gradient(135deg,${accent},#637dff);color:#07111f;font-weight:850;cursor:pointer;box-shadow:0 12px 30px rgba(0,0,0,.26)}.error{margin:12px 0 0;color:#ff9da5;font-size:14px;font-weight:700}.privacy{margin:18px 0 0;color:#8798ad;font-size:12px;text-align:center}
</style></head><body><main><div class="eyebrow">${eyebrow}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><form method="post" action="${LOGIN}"><input type="hidden" name="returnTo" value="${escapeHtml(destination)}"><label for="password">Access password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" autofocus>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}<button type="submit">Open ${escapeHtml(blackFriday ? 'Shopping HQ' : 'private tools')}</button></form><p class="privacy">Private access · Your shopping data stays protected</p></main></body></html>`;
}

function equal(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function registerWeatherSiteAccess(app, {
  env = process.env,
  secret = weatherSiteCookieSecret,
  now = Date.now,
  publicMain = env.WEATHER_FUSION_PUBLIC !== '0',
} = {}) {
  const expected = env.WEATHER_SITE_PASSWORD
    ? {salt: DEFAULT_PASSWORD.salt, digest: crypto.scryptSync(env.WEATHER_SITE_PASSWORD, DEFAULT_PASSWORD.salt, 32).toString('hex')}
    : DEFAULT_PASSWORD;
  const failures = new Map();
  const revoked = new Map();
  const sign = payload => crypto.createHmac('sha256', secret).update(`${expected.digest}:${payload}`).digest('hex');
  const parseForm = express.urlencoded({extended: false, limit: '2kb', parameterLimit: 4});

  function cookie(req) {
    return String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  }
  function authenticated(req) {
    const value = cookie(req), match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
    if (!match || revoked.has(value)) return false;
    const expires = Number(match[1]);
    return expires > now() && expires <= now() + SESSION_MS && equal(match[3], sign(`${match[1]}.${match[2]}`));
  }
  function setCookie(req, res, value, maxAge) {
    const secure = env.NODE_ENV === 'production' || req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.get('host');
    } catch { return false; }
  }

  app.use((req, res, next) => {
    let pathname;
    try {
      pathname = canonicalPath(req.originalUrl);
      if (!isProtectedWeatherPath(req.originalUrl)) return next();
    } catch { return res.status(400).send('Invalid request path.'); }
    // Existing page/static handlers must not make authenticated content cacheable.
    const setHeader = res.setHeader;
    res.setHeader = function(name, value) {
      return setHeader.call(this, name, String(name).toLowerCase() === 'cache-control' ? 'private, no-store' : value);
    };
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.vary('Cookie');

    if ([LOGIN, LOGOUT].includes(pathname)) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      if (pathname === LOGIN && ['GET', 'HEAD'].includes(req.method)) {
        return res.status(401).type('html').send(loginPage(req.query.returnTo));
      }
      if (req.method !== 'POST') return res.status(405).set('Allow', pathname === LOGIN ? 'GET, HEAD, POST' : 'POST').send('Method not allowed.');
      if (!sameOrigin(req)) return res.status(403).send('Same-origin sign-in required.');
      if (pathname === LOGOUT) {
        const value = cookie(req);
        if (authenticated(req)) revoked.set(value, Number(value.split('.')[0]));
        for (const [token, expires] of revoked) if (expires <= now()) revoked.delete(token);
        setCookie(req, res, '', 0);
        return res.redirect(303, LOGIN);
      }
      const ip = clientIp(req,env);
      for (const [key, attempt] of failures) if (attempt.reset <= now()) failures.delete(key);
      const attempt = failures.get(ip) || {count: 0, reset: now() + 60000};
      if (attempt.count >= 10 || failures.size >= 2000) {
        return res.status(429).set('Retry-After', '60').type('html').send(loginPage(HOME, 'Too many attempts. Try again in a minute.'));
      }
      return parseForm(req, res, error => {
        if (error) return res.status(400).type('html').send(loginPage(HOME, 'Invalid sign-in request.'));
        const password = req.body?.password;
        const valid = typeof password === 'string' && password.length <= 256 && equal(crypto.scryptSync(password, expected.salt, 32).toString('hex'), expected.digest);
        if (!valid) {
          attempt.count += 1;
          failures.set(ip, attempt);
          return res.status(401).type('html').send(loginPage(req.body?.returnTo, 'Incorrect password.'));
        }
        failures.delete(ip);
        const payload = `${now() + SESSION_MS}.${crypto.randomBytes(16).toString('hex')}`;
        setCookie(req, res, `${payload}.${sign(payload)}`, SESSION_MS / 1000);
        return res.redirect(303, safeReturn(req.body?.returnTo));
      });
    }

    if (authenticated(req)) { req.weatherSiteAuthenticated = true; return next(); }
    if (publicMain && isPublicWeatherPath(req.originalUrl, req.method)) return next();
    if (pathname.startsWith('/api/')) return res.status(401).json({error: 'Weather site password required.', loginUrl: LOGIN});
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return res.status(401).type('html').send(loginPage(req.originalUrl));
  });
}

