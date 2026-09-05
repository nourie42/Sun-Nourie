import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createWeatherGateway, gatewayPorts, isWeatherPath } from '../src/weatherFusionGateway.js';

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function close(server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
function request(port, url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, ...options }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end(body);
  });
}
async function fixture(t, handler) {
  const site = http.createServer(handler); const sitePort = await listen(site);
  const gateway = createWeatherGateway({ sitePort, weatherHandler: (_req, res) => res.end('Weather only') });
  const port = await listen(gateway.server);
  t.after(async () => { gateway.destroyConnections(); await close(gateway.server); await close(site); });
  return { site, port };
}

test('only the new weather namespaces are intercepted', () => {
  for (const url of ['/weather-fusion', '/weather-fusion/?a=1', '/weather-fusion/app.js', '/api/weather-fusion/forecast?location=knightdale']) assert.equal(isWeatherPath(url), true);
  for (const url of ['/', '/index.html', '/weather', '/weather-fusion-old', '/api/weather-fusionish', '/api/research?q=/weather-fusion']) assert.equal(isWeatherPath(url), false);
});
test('default and explicit ports are distinct and validated', () => {
  assert.deepEqual(gatewayPorts({}), { publicPort: 3000, sitePort: 3001, legacyPort: 3002 });
  assert.deepEqual(gatewayPorts({ LEGACY_PORT: '3001' }), { publicPort: 3000, sitePort: 3002, legacyPort: 3001 });
  assert.deepEqual(gatewayPorts({ PORT: '65535' }), { publicPort: 65535, sitePort: 1, legacyPort: 2 });
  assert.throws(() => gatewayPorts({ PORT: 'bad' }));
  assert.throws(() => gatewayPorts({ WEATHER_FUSION_SITE_PORT: '3000' }));
  assert.throws(() => gatewayPorts({ LEGACY_PORT: '3001', WEATHER_FUSION_SITE_PORT: '3001' }));
});
test('homepage bytes and security/cache headers are preserved without navigation injection', async (t) => {
  const page = Buffer.from('<!doctype html><html><body>Current website unchanged ✓</body></html>');
  const { port } = await fixture(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'", 'Cache-Control': 'private, max-age=42' }); res.end(page); });
  const response = await request(port, '/');
  assert.deepEqual(response.body, page);
  assert.equal(response.headers['content-security-policy'], "default-src 'self'");
  assert.equal(response.headers['cache-control'], 'private, max-age=42');
});
test('existing POST uploads preserve the method, URL, headers and binary body', async (t) => {
  const body = Buffer.from([0, 255, 1, 13, 10, 200, 50]);
  const { port } = await fixture(t, (req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/api/upload?q=a%2Fb');
    assert.equal(req.headers.host, 'original.example'); assert.equal(req.headers.authorization, 'Bearer fixture');
    assert.equal(req.headers.cookie, 'session=fixture');
    const chunks = []; req.on('data', (chunk) => chunks.push(chunk)); req.on('end', () => res.end(Buffer.concat(chunks)));
  });
  const response = await request(port, '/api/upload?q=a%2Fb', { method: 'POST', headers: { host: 'original.example', authorization: 'Bearer fixture', cookie: 'session=fixture', 'Content-Type': 'application/octet-stream' } }, body);
  assert.deepEqual(response.body, body);
});
test('existing redirects and multiple session cookies are preserved', async (t) => {
  const { port } = await fixture(t, (_req, res) => { res.writeHead(307, { Location: '/original-login', 'Set-Cookie': ['a=1; HttpOnly', 'b=2; SameSite=Lax'] }); res.end(); });
  const response = await request(port, '/private');
  assert.equal(response.status, 307); assert.equal(response.headers.location, '/original-login');
  assert.deepEqual(response.headers['set-cookie'], ['a=1; HttpOnly', 'b=2; SameSite=Lax']);
});
test('new weather paths do not invoke the original site', async (t) => {
  let oldRequests = 0;
  const { port } = await fixture(t, (_req, res) => { oldRequests += 1; res.end('Existing'); });
  assert.equal((await request(port, '/weather-fusion/')).body.toString(), 'Weather only');
  assert.equal((await request(port, '/api/weather-fusion/radar')).body.toString(), 'Weather only');
  assert.equal(oldRequests, 0);
  assert.equal((await request(port, '/weather')).body.toString(), 'Existing');
});
test('an unavailable existing server returns an honest error without affecting weather', async (t) => {
  const empty = http.createServer(); const unused = await listen(empty); await close(empty);
  const gateway = createWeatherGateway({ sitePort: unused, weatherHandler: (_req, res) => res.end('Weather only') });
  const port = await listen(gateway.server);
  t.after(async () => { gateway.destroyConnections(); await close(gateway.server); });
  assert.equal((await request(port, '/')).status, 502);
  assert.equal((await request(port, '/weather-fusion/')).status, 200);
});
test('existing streamed responses are delivered before completion', async (t) => {
  let release;
  const { port } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: first\n\n');
    release = () => res.end('data: last\n\n');
  });
  await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: '/api/progress' }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; if (text.includes('first') && release) { const fn = release; release = null; fn(); } });
      res.on('end', () => { assert.match(text, /first/); assert.match(text, /last/); resolve(); });
      res.on('error', reject);
    }).on('error', reject);
  });
});
test('existing HTTP upgrades are tunneled without rewriting their handshake', async (t) => {
  const { site, port } = await fixture(t, (_req, res) => res.end('Existing'));
  site.on('upgrade', (req, socket, head) => {
    assert.equal(req.url, '/original-socket');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  const client = net.connect(port, '127.0.0.1'); t.after(() => client.destroy());
  const reply = new Promise((resolve, reject) => {
    let text = '';
    client.on('data', (chunk) => { text += chunk; if (text.includes('ECHO-MARKER')) resolve(text); });
    client.on('error', reject);
  });
  client.write('GET /original-socket HTTP/1.1\r\nHost: original.example\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nECHO-MARKER');
  assert.match(await reply, /101 Switching Protocols/); client.destroy();
});
