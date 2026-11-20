import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { clientIp } from './clientIp.js';

// Do not commit the password. Set NOURIE_ENTERPRISES_PASSWORD in the hosting environment.
// This gate is deliberately separate from Weather Nourie and Fuel IQ authentication.
const PREFIX = '/nourie-enterprises';
const LOGIN = PREFIX + '/login';
const LOGOUT = PREFIX + '/logout';
const HOME = PREFIX + '/';
const COOKIE = 'nourie_enterprises_auth';
const SALT = 'nourie-enterprises-access-v1';
const SESSION_MS = 12 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 6;

export const nourieEnterprisesCookieSecret =
  process.env.NOURIE_ENTERPRISES_COOKIE_SECRET || crypto.randomBytes(32).toString('hex');

function canonicalPath(value) {
  const raw = String(value || '/').split('?')[0];
  return path.posix.normalize(decodeURIComponent(raw).replace(/\\/g, '/')).toLowerCase();
}
export function isProtectedNourieEnterprisesPath(value) {
  const name = canonicalPath(value);
  return name === PREFIX || name.startsWith(PREFIX + '/');
}
function safeReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\u0000-\u0020\\]/.test(value)) return HOME;
  try {
    const name = canonicalPath(value);
    return isProtectedNourieEnterprisesPath(value) && ![LOGIN, LOGOUT].includes(name) ? value : HOME;
  } catch { return HOME; }
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return ['https:', 'http:'].includes(origin.protocol) && origin.host === req.get('host');
  } catch { return false; }
}
function sameHash(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function loginHtml(returnTo, error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Nourie Enterprises | Private Access</title><style>
*{box-sizing:border-box}body{min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#0d1b22,#1b3a40);color:#eff7ea;margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,sans-serif}main{width:100%;max-width:420px;background:#1c343a;border:1px solid #557b6c;padding:34px;border-radius:16px;box-shadow:0 30px 80px #0004}small{font-size:11px;letter-spacing:.19em;color:#bde7af;font-weight:800}h1{font-size:31px;letter-spacing:-.05em;margin:15px 0 12px}p{font-size:14px;line-height:1.6;color:#c4d4cd;margin-bottom:25px}label{display:block;margin:0 0 8px;font-size:13px;font-weight:750}input,button{width:100%;min-height:49px;border-radius:7px;font:inherit}input{border:1px solid #668779;background:#0d2027;color:white;padding:10px 15px}button{margin-top:18px;border:0;background:#c6e9be;color:#123026;font-weight:800;cursor:pointer}button:hover{background:#d9f5ca}.error{color:#ffc7b2;margin:12px 0 0}a{color:#c6e9be}input:focus-visible,button:focus-visible{outline:3px solid #f0cb87;outline-offset:3px}
</style></head><body><main><small>PRIVATE BUSINESS PREVIEW</small><h1>Nourie Enterprises</h1><p>Enter the access password to view the independent dealer advisory concept.</p><form action="${LOGIN}" method="post"><input type="hidden" name="returnTo" value="${escapeHtml(safeReturn(returnTo))}"><label for="password">Password</label><input id="password" name="password" type="password" maxlength="256" autocomplete="current-password" autofocus required>${error ? '<p role="alert" class="error">'+escapeHtml(error)+'</p>' : ''}<button type="submit">Unlock preview →</button></form></main></body></html>`;
}
export function registerNourieEnterprisesAccess(app, {
  env = process.env,
  secret = nourieEnterprisesCookieSecret,
  now = Date.now,
} = {}) {
  const configuredPassword = env.NOURIE_ENTERPRISES_PASSWORD;
  const expected = typeof configuredPassword === 'string' && configuredPassword.length
    ? crypto.scryptSync(configuredPassword, SALT, 32).toString('hex') : null;
  const sign = payload => crypto.createHmac('sha256', secret).update(`${expected}:${payload}`).digest('hex');
  const failures = new Map();
  const revoked = new Map();
  const form = express.urlencoded({extended:false,limit:'2kb',parameterLimit:4});

  function getCookie(req) {
    return String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1) || '';
  }
  function authorized(req) {
    const cookie = getCookie(req);
    const parts = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(cookie);
    if (!parts || revoked.has(cookie)) return false;
    const expiration = Number(parts[1]);
    return expiration > now() && expiration <= now()+SESSION_MS &&
      sameHash(parts[3], sign(`${parts[1]}.${parts[2]}`));
  }
  function cookieHeader(req, res, value, seconds) {
    const https = env.NODE_ENV === 'production' || req.secure ||
      String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=${PREFIX}/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${https?'; Secure':''}`);
  }
  app.use((req,res,next) => {
    let pathname;
    try {
      pathname = canonicalPath(req.originalUrl);
      if (!isProtectedNourieEnterprisesPath(req.originalUrl)) return next();
    } catch { return res.status(400).send('Invalid path.'); }
    // The gateway and legacy server both run the gate, before static file serving.
    const originalSet = res.setHeader;
    res.setHeader = function(name,value) {
      return originalSet.call(this,name,String(name).toLowerCase()==='cache-control'?'private, no-store':value);
    };
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.vary('Cookie');
    if (!expected) return res.status(503).send('Nourie Enterprises private access is not configured.');
    if (pathname === LOGIN || pathname === LOGOUT) {
      res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      if (pathname === LOGIN && ['GET','HEAD'].includes(req.method))
        return res.status(401).type('html').send(loginHtml(req.query.returnTo));
      if (req.method !== 'POST')
        return res.status(405).set('Allow',pathname===LOGIN?'GET, HEAD, POST':'POST').send('Method not allowed.');
      if (!sameOrigin(req)) return res.status(403).send('Same-origin request required.');
      if (pathname === LOGOUT) {
        const value = getCookie(req);
        if (authorized(req)) revoked.set(value, Number(value.split('.')[0]));
        for (const [key,expiry] of revoked) if (expiry <= now()) revoked.delete(key);
        cookieHeader(req,res,'',0);
        return res.redirect(303,LOGIN);
      }
      const ip = clientIp(req,env);
      for (const [key,entry] of failures) if (entry.reset <= now()) failures.delete(key);
      const attempt = failures.get(ip) || {count:0,reset:now()+ATTEMPT_WINDOW_MS};
      if (attempt.count >= MAX_FAILURES || failures.size >= 10000)
        return res.status(429).set('Retry-After','600').type('html').send(loginHtml(HOME,'Too many attempts. Try again later.'));
      return form(req,res,error => {
        if (error) return res.status(400).type('html').send(loginHtml(HOME,'Invalid request.'));
        const input = req.body?.password;
        const valid = typeof input === 'string' && input.length <= 256 &&
          sameHash(crypto.scryptSync(input,SALT,32).toString('hex'),expected);
        if (!valid) {
          attempt.count++;
          failures.set(ip,attempt);
          return res.status(401).type('html').send(loginHtml(req.body?.returnTo,'Incorrect password.'));
        }
        failures.delete(ip);
        const payload = `${now()+SESSION_MS}.${crypto.randomBytes(16).toString('hex')}`;
        cookieHeader(req,res,`${payload}.${sign(payload)}`,Math.floor(SESSION_MS/1000));
        return res.redirect(303,safeReturn(req.body?.returnTo));
      });
    }
    if (authorized(req)) return next();
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return res.status(401).type('html').send(loginHtml(req.originalUrl));
  });
}
