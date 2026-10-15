import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerPrivatePageAccess, isProtectedPrivatePath } from '../src/privatePageAccess.js';
import { registerAiAgentRoutes } from '../src/aiAgent.js';
import { registerAiCouncilRoutes } from '../src/aiCouncil.js';
import { registerWeatherSiteAccess } from '../src/weatherSiteAccess.js';

const PASSWORD = 'test-only-private-password';
async function fixture(t, options = {}) {
  const app = express();
  registerPrivatePageAccess(app, {env: {NOURIE_PRIVATE_PASSWORD: PASSWORD}, secret: 'test-only-cookie-signing-secret', ...options});
  registerWeatherSiteAccess(app, {env: {}, secret: 'existing-weather-secret'});
  if (options.realAi) { registerAiAgentRoutes(app); registerAiCouncilRoutes(app); }
  app.use((req, res) => res.set('Cache-Control', 'public, max-age=86400').json({allowed: true, path: req.originalUrl}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(base + route, {redirect: 'manual', ...options});
  const login = (password = PASSWORD, returnTo = '/', headers = {}) => request('/private/login', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', ...headers},
    body: new URLSearchParams({password, returnTo}),
  });
  return {base, request, login};
}
const protectedPaths = ['/', '/index.html', '/ai-council', '/ai-council/', '/ai-council/index.html', '/ai-council/bots', '/ai-council/main-chat-v2.js', '/ai-council/family.html', '/api/ai-council/status', '/api/ai-council/ask', '/api/ai-council/bots/run', '/api/ai-agent/status', '/api/ai-agent/chat', '/api/ai-agent/attachment/prepare'];

test('landing page, AI Council pages, assets and APIs require server-side authentication for all methods', async t => {
  const {request} = await fixture(t);
  for (const route of protectedPaths) for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
    const response = await request(route, {method});
    assert.equal(response.status, 401, `${method} ${route}`);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    if (method === 'GET') assert.ok(!(await response.text()).includes('"allowed":true'));
  }
});

test('weather page, weather dependencies and health remain public without any cookie', async t => {
  const {request} = await fixture(t);
  for (const route of ['/weather-fusion/', '/weather-fusion', '/weather-fusion/index.html', '/weather-fusion/app.js', '/weather-fusion/nav-week.webp', '/api/weather-fusion/forecast', '/api/weather-fusion/search', '/api/weather-fusion/winter-map', '/health']) {
    for (const method of ['GET', 'HEAD']) assert.equal((await request(route, {method})).status, 200, `${method} ${route}`);
  }
  assert.equal((await request('/weather-fusion/compare')).status, 401, 'existing private weather tools retain their gate');
});

test('one password and one session unlock landing page and every AI Council route, without exposing the password', async t => {
  const {request, login} = await fixture(t);
  const response = await login(PASSWORD, '/ai-council/?tab=bots');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/ai-council/?tab=bots');
  const cookieHeader = response.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly; SameSite=Strict; Max-Age=43200/);
  assert.ok(!cookieHeader.includes(PASSWORD));
  const cookie = cookieHeader.split(';')[0];
  for (const route of protectedPaths) {
    const unlocked = await request(route, {headers: {Cookie: cookie}});
    assert.equal(unlocked.status, 200, route);
    assert.equal(unlocked.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal((await request('/weather-fusion/compare', {headers: {Cookie: cookie}})).status, 401, 'unrelated weather credentials stay separate');
});

test('missing password fails closed for private pages while public weather stays accessible', async t => {
  const {request, login} = await fixture(t, {env: {}});
  for (const route of protectedPaths) assert.equal((await request(route)).status, 503);
  assert.equal((await login()).status, 503);
  assert.equal((await request('/weather-fusion/')).status, 200);
  assert.equal((await request('/health')).status, 200);
});

test('incorrect passwords, tampered cookies and expired sessions do not unlock pages', async t => {
  let now = Date.now();
  const {request, login} = await fixture(t, {now: () => now});
  for (const password of ['', 'wrong', PASSWORD.toUpperCase(), PASSWORD + ' ']) assert.equal((await login(password)).status, 401);
  const valid = (await login()).headers.get('set-cookie').split(';')[0];
  for (const cookie of ['nourie_private_auth=wrong', valid.slice(0, -1), 'weather_site_auth=' + valid.split('=')[1]]) {
    assert.equal((await request('/', {headers: {Cookie: cookie}})).status, 401);
  }
  now += 12 * 60 * 60 * 1000;
  assert.equal((await request('/', {headers: {Cookie: valid}})).status, 401);
});

test('logout revokes the session and sign-in rejects cross-origin requests and unsafe redirects', async t => {
  const {request, login} = await fixture(t);
  assert.equal((await login(PASSWORD, '/', {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await login(PASSWORD, '/', {'Sec-Fetch-Site': 'cross-site'})).status, 403);
  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', '/api/ai-council/ask', '/private/logout', '/fuel-atlas.html']) {
    assert.equal((await login(PASSWORD, target)).headers.get('location'), '/');
  }
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/private/logout', {method: 'POST', headers: {Cookie: cookie}})).status, 303);
  assert.equal((await request('/', {headers: {Cookie: cookie}})).status, 401);
});

test('production sign-in uses secure cookies and repeated failures are rate-limited', async t => {
  const {request, login} = await fixture(t, {env: {NODE_ENV: 'production', NOURIE_PRIVATE_PASSWORD: PASSWORD}});
  assert.match((await login()).headers.get('set-cookie'), /; Secure/);
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).status, 401);
  assert.equal((await login()).status, 429);
  assert.equal((await request('/weather-fusion/')).status, 200);
});

test('encoded and normalized path aliases cannot evade private-route checks', () => {
  for (const route of ['/INDEX.HTML', '/%69ndex.html', '/AI-COUNCIL/index.html', '/ai%2dcouncil/main-chat-v2.js', '//ai-council/index.html', '/x/../ai-council/index.html', '/ai-council%5cindex.html', '/?next=weather']) {
    assert.equal(isProtectedPrivatePath(route), true, route);
  }
  for (const route of ['/weather-fusion/', '/health', '/ai-council-other']) assert.equal(isProtectedPrivatePath(route), false, route);
});

// Empty requests validate authentication without making paid AI requests.
test('signed-in session reaches both real AI handlers without a second access code', async t => {
  const {request, login} = await fixture(t, {realAi: true});
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  for (const route of ['/api/ai-agent/chat', '/api/ai-council/ask']) {
    assert.equal((await request(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 401);
    const response = await request(route, {method: 'POST', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: '{}'});
    assert.equal(response.status, 400, route);
    assert.match((await response.json()).error, /message|question/);
  }
});
