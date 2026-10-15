import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';

// Separate credentials and sessions leave existing weather access unchanged.
const PASSWORD_SALT = 'nourie-private-pages-v1';
const COOKIE = 'nourie_private_auth';
const LOGIN = '/private/login';
const LOGOUT = '/private/logout';
const HOME = '/';
const SESSION_MS = 12 * 60 * 60 * 1000;
const PREFIXES = ['/ai-council', '/api/ai-council', '/api/ai-agent', '/private/login', '/private/logout'];
const LANDING_PAGES = new Set(['/', '/index.html']);

// The gateway passes this private key to its child processes. It is never sent
// to clients; a restart invalidates sessions unless an environment key is set.
export const privatePageCookieSecret = process.env.NOURIE_PRIVATE_COOKIE_SECRET || crypto.randomBytes(32).toString('hex');

function canonicalPath(url) {
  const value = String(url || '/');
  const raw = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? new URL(value).pathname : value.split('?')[0];
  return path.posix.normalize(decodeURIComponent(raw).replace(/\\/g, '/')).toLowerCase();
}

export function isProtectedPrivatePath(url) {
  const pathname = canonicalPath(url);
  return LANDING_PAGES.has(pathname) || PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function safeReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return HOME;
  try {
    const pathname = canonicalPath(value);
    if (!isProtectedPrivatePath(value) || pathname.startsWith('/api/') || [LOGIN, LOGOUT].includes(pathname)) return HOME;
    return value;
  } catch { return HOME; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
}

function loginPage(returnTo, error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nourie | Private Access</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f2f5f7;color:#20313b;font-family:system-ui,-apple-system,Segoe UI,sans-serif}main{width:100%;max-width:360px}h1{margin:0 0 8px;font-size:28px;font-weight:600}p{margin:0 0 24px;color:#516370;line-height:1.5}label{display:block;margin-bottom:8px;font-size:15px}input,button{width:100%;min-height:46px;font:inherit;border-radius:6px}input{padding:10px 12px;border:1px solid #879ba7;background:#fff;color:#20313b}input:focus-visible,button:focus-visible{outline:3px solid #448f9a;outline-offset:3px}button{margin-top:16px;border:0;background:#176574;color:#fff;cursor:pointer}.error{margin:12px 0 0;color:#a02c32;font-size:14px}
</style></head><body><main><h1>Nourie private access</h1><p>Sign in to open the main site or AI Council. The <a href="/weather-fusion/">weather forecast</a> is public.</p><form method="post" action="${LOGIN}"><input type="hidden" name="returnTo" value="${escapeHtml(safeReturn(returnTo))}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" autofocus>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}<button type="submit">Sign in</button></form></main></body></html>`;
}

function equal(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function registerPrivatePageAccess(app, {
  env = process.env,
  secret = privatePageCookieSecret,
  now = Date.now,
} = {}) {
  const expected = env.NOURIE_PRIVATE_PASSWORD
    ? {salt: PASSWORD_SALT, digest: crypto.scryptSync(env.NOURIE_PRIVATE_PASSWORD, PASSWORD_SALT, 32).toString('hex')}
    : null;
  const failures = new Map();
  const revoked = new Map();
  const sign = payload => crypto.createHmac('sha256', secret).update(`${expected?.digest}:${payload}`).digest('hex');
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
      if (!isProtectedPrivatePath(req.originalUrl)) return next();
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

    if (!expected) return res.status(503).send('Private access is temporarily unavailable.');

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
      const ip = req.ip || req.socket.remoteAddress;
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

    if (authenticated(req)) { req.privatePageAuthenticated = true; return next(); }
    if (pathname.startsWith('/api/')) return res.status(401).json({error: 'Private site password required.', loginUrl: LOGIN});
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return res.status(401).type('html').send(loginPage(req.originalUrl));
  });
}

