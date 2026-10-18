import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { isProtectedWeatherPath, isPublicWeatherPath, registerWeatherSiteAccess } from '../src/weatherSiteAccess.js';

async function fixture(t, options = {}) {
  const app = express();
  registerWeatherSiteAccess(app, {env: {}, secret: 'test-only-private-secret', publicMain: false, ...options});
  app.use((req, res) => res.set('Cache-Control', 'public, max-age=86400').json({allowed: true, path: req.originalUrl}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(base + route, {redirect: 'manual', ...options});
  const login = (password = 'care', returnTo = '/weather-fusion/', headers = {}) => request('/weather-fusion/login', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', ...headers},
    body: new URLSearchParams({password, returnTo}),
  });
  return {base, request, login};
}

const pages = ['/weather', '/weather/', '/weather-fusion', '/weather-fusion/', '/weather-fusion/index.html', '/weather-fusion/experimental-weather.html', '/weather-fusion/compare', '/weather-fusion/compare/pane', '/weathernext/', '/weather-fusion/weathernext-site.html', '/weather-fusion/app.js', '/weather-fusion/nav-week.webp', '/whats-up', '/whatsup', '/whats-up/index.html'];
const apis = ['/api/weather-fusion/forecast', '/api/weather-fusion/alerts', '/api/weather-fusion/briefing', '/api/weather-fusion/bulletins', '/api/weather-fusion/radar', '/api/weather-fusion/models', '/api/weather-fusion/winter-map', '/api/weather-fusion/compare/google', '/api/weather-fusion/compare/location', '/api/whats-up/tracker'];

test('all weather pages, assets and API methods require a password', async t => {
  const {request} = await fixture(t);
  for (const route of [...pages, ...apis]) {
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const response = await request(route, {method});
      assert.equal(response.status, 401, `${method} ${route}`);
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      if (method === 'GET') {
        const body = await response.text();
        assert.ok(!body.includes('allowed'));
        assert.ok(!body.includes('care'));
        assert.match(body, route.startsWith('/api/') ? /password required/ : /Public access is paused/);
      }
    }
  }
});

test('wrong passwords do not grant access', async t => {
  const {login} = await fixture(t);
  for (const password of ['', 'wrong', 'CARE', 'care ']) {
    const response = await login(password);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(await response.text(), /Incorrect password/);
  }
});

test('correct password grants access to every weather route with an HttpOnly cookie', async t => {
  const {request, login} = await fixture(t, {env: {NODE_ENV: 'production'}});
  const response = await login('care', '/weather-fusion/experimental-weather.html?place=Knightdale');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/weather-fusion/experimental-weather.html?place=Knightdale');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
  assert.ok(!setCookie.includes('care'));
  const cookie = setCookie.split(';')[0];
  for (const route of [...pages, ...apis]) {
    const unlocked = await request(route, {headers: {Cookie: cookie}});
    assert.equal(unlocked.status, 200, route);
    assert.equal(unlocked.headers.get('cache-control'), 'private, no-store', route);
  }
});

test('cookie tampering, malformed cookies and password-shaped cookies cannot authenticate', async t => {
  const {request, login} = await fixture(t);
  const valid = (await login()).headers.get('set-cookie').split(';')[0];
  const payload = valid.split('=')[1];
  const altered = payload.slice(0, -1) + (payload.endsWith('0') ? '1' : '0');
  for (const cookie of ['weather_site_auth=care', 'weather_site_auth=%ZZ', `weather_site_auth=${altered}`, `weather_site_auth=${payload.replace(/^\d+/, '9999999999999')}`]) {
    assert.equal((await request('/weather-fusion/', {headers: {Cookie: cookie}})).status, 401);
  }
});

test('expired sessions require the password again', async t => {
  let time = 1791720000000;
  const {request, login} = await fixture(t, {now: () => time});
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  time += 12 * 60 * 60 * 1000;
  assert.equal((await request('/weather-fusion/', {headers: {Cookie: cookie}})).status, 401);
});

test('logout clears and revokes the session', async t => {
  const {request, login} = await fixture(t);
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  const response = await request('/weather-fusion/logout', {method: 'POST', headers: {Cookie: cookie}});
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/weather-fusion/', {headers: {Cookie: cookie}})).status, 401);
});

test('health checks and unrelated applications remain available', async t => {
  const {request} = await fixture(t);
  for (const route of ['/health', '/', '/household-pl', '/deal-desk', '/api/config', '/fuel-atlas.html', '/weather-other']) {
    assert.equal((await request(route)).status, 200, route);
  }
});

test('encoded, case-insensitive, normalized and absolute-form paths cannot bypass the lock', async t => {
  const {base, request} = await fixture(t);
  const paths = ['/%77eather-fusion/index.html', '/WEATHER-FUSION/', '/weather-fusion%2findex.html', '//weather-fusion/index.html', '/x/%2e%2e/weather-fusion/index.html', '/x/..%5cweather-fusion/index.html', '/API/%77eather-fusion/alerts'];
  for (const route of paths) {
    assert.equal(isProtectedWeatherPath(route), true, route);
    assert.equal((await request(route)).status, 401, route);
  }
  assert.equal(isProtectedWeatherPath(base + '/weather-fusion/index.html'), true);
  const response = await new Promise((resolve, reject) => {
    http.get(base, {path: base + '/weather-fusion/index.html'}, res => {res.resume(); resolve(res);}).on('error', reject);
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await request('/weather-fusion/%ZZ')).status, 400);
});

test('login rejects open redirects and escapes return paths', async t => {
  const {request, login} = await fixture(t);
  for (const returnTo of ['https://example.com', '//example.com', '/\\example.com', '/health', '/api/weather-fusion/forecast', '/weather-fusion/login']) {
    assert.equal((await login('care', returnTo)).headers.get('location'), '/weather-fusion/');
  }
  const response = await request('/weather-fusion/login?returnTo=' + encodeURIComponent('/weather-fusion/?x="<script>'));
  const html = await response.text();
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&quot;&lt;script&gt;/);
});

test('cross-site login and logout requests are rejected', async t => {
  const {request, login} = await fixture(t);
  assert.equal((await login('care', '/weather-fusion/', {Origin: 'https://example.com'})).status, 403);
  assert.equal((await login('care', '/weather-fusion/', {'Sec-Fetch-Site': 'cross-site'})).status, 403);
  assert.equal((await request('/weather-fusion/logout', {method: 'POST', headers: {Origin: 'https://example.com'}})).status, 403);
});

test('failed password attempts are limited and recover after a minute', async t => {
  let time = 1791720000000;
  const {login} = await fixture(t, {now: () => time});
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).status, 401);
  const blocked = await login('care');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  time += 60001;
  assert.equal((await login('care')).status, 303);
});

test('gateway and legacy processes accept the same signed cookie, but unrelated secrets do not', async t => {
  const first = await fixture(t), child = await fixture(t), other = await fixture(t, {secret: 'different-secret'});
  const cookie = (await first.login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await child.request('/weather-fusion/index.html', {headers: {Cookie: cookie}})).status, 200);
  assert.equal((await other.request('/weather-fusion/index.html', {headers: {Cookie: cookie}})).status, 401);
});

test('configured server password overrides the emergency hash and invalidates old cookies', async t => {
  const original = await fixture(t), configured = await fixture(t, {env: {WEATHER_SITE_PASSWORD: 'changed-test-password'}});
  assert.equal((await configured.login('care')).status, 401);
  assert.equal((await configured.login('changed-test-password')).status, 303);
  const cookie = (await original.login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await configured.request('/weather-fusion/', {headers: {Cookie: cookie}})).status, 401);
});

test('only the main weather page, its assets and read-only APIs are public', async t => {
  const {request} = await fixture(t, {publicMain: true});
  for (const route of ['/weather-fusion/', '/weather-fusion/index.html', '/weather-fusion/app.js', '/weather-fusion/header-night.webp', '/api/weather-fusion/forecast?location=knightdale', '/api/weather-fusion/winter-map?file=ppp_co_24hr_expected_sn_in_2026101409f027.kmz']) {
    assert.equal((await request(route)).status, 200, route);
  }
  for (const route of ['/weather-fusion/experimental-weather.html', '/weather-fusion/glance.html', '/weather-fusion/compare', '/weathernext/', '/whats-up/', '/deal-intelligence/', '/api/weather-fusion/compare/google', '/api/whats-up/tracker', '/api/deal-intelligence/x', '/weather-fusion/sub/app.js']) {
    assert.equal((await request(route)).status, 401, route);
  }
  assert.equal((await request('/api/weather-fusion/forecast', {method: 'POST'})).status, 401);
  assert.equal(isPublicWeatherPath('/WEATHER-FUSION/', 'GET'), true);
  assert.equal(isPublicWeatherPath('/weather-fusion/', 'DELETE'), false);
});


test('public player dependencies load without opening private player paths', async t => {
  const {request} = await fixture(t, {publicMain: true});
  for (const route of ['/weather-fusion/player/sky-player.js?v=native-20261018-1','/weather-fusion/player/vendor/three.module.js','/weather-fusion/player/assets/photo-hot.webp']) {
    assert.equal((await request(route)).status, 200, route);
    assert.equal((await request(route, {method: 'POST'})).status, 401, route);
  }
  for (const route of ['/weather-fusion/player/private.html','/weather-fusion/player/unlisted.js','/weather-fusion/compare']) {
    assert.equal((await request(route)).status, 401, route);
  }
});
