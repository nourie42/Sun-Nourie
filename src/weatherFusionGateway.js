/** Additive front door: weather paths only; existing responses are never rewritten. */
import http from 'node:http';
import net from 'node:net';

export function isWeatherPath(url = '') {
  const pathname = url.split('?')[0];
  return pathname === '/weather-fusion' || pathname.startsWith('/weather-fusion/') ||
    pathname === '/api/weather-fusion' || pathname.startsWith('/api/weather-fusion/');
}

export function gatewayPorts(env = process.env) {
  function port(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a TCP port from 1 through 65535.`);
    return n;
  }
  const publicPort = port(env.PORT || 3000, 'PORT');
  const occupied = new Set([publicPort]);
  function reserve(value, name) {
    const n = port(value, name);
    if (occupied.has(n)) throw new Error(`${name} must be different from the other server ports.`);
    occupied.add(n); return n;
  }
  function next() {
    for (let i = 1; i < 65535; i += 1) {
      const n = ((publicPort - 1 + i) % 65535) + 1;
      if (!occupied.has(n)) { occupied.add(n); return n; }
    }
    throw new Error('No distinct internal port is available.');
  }
  const explicitSite = env.WEATHER_FUSION_SITE_PORT ? reserve(env.WEATHER_FUSION_SITE_PORT, 'WEATHER_FUSION_SITE_PORT') : null;
  const explicitLegacy = env.LEGACY_PORT ? reserve(env.LEGACY_PORT, 'LEGACY_PORT') : null;
  return { publicPort, sitePort: explicitSite ?? next(), legacyPort: explicitLegacy ?? next() };
}

function endToEndHeaders(headers) {
  const blocked = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
  for (const name of String(headers.connection || '').split(',')) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())));
}

export function createWeatherGateway({ sitePort, weatherHandler }) {
  if (!Number.isInteger(sitePort) || sitePort < 1 || sitePort > 65535) throw new Error('Invalid existing-site port.');
  if (typeof weatherHandler !== 'function') throw new TypeError('weatherHandler must be a request handler.');
  const sockets = new Set();
  function track(socket) { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket; }
  const server = http.createServer((req, res) => {
    if (isWeatherPath(req.url)) return weatherHandler(req, res);
    // Keep the original method, URL, Host, cookies, authorization and response bytes.
    // In particular: no body parser, home-page injection, redirect rewriting or HTML transforms.
    const upstream = http.request({ hostname: '127.0.0.1', port: sitePort,
      method: req.method, path: req.url, headers: endToEndHeaders(req.headers) }, (reply) => {
      res.writeHead(reply.statusCode || 502, reply.statusMessage, endToEndHeaders(reply.headers));
      reply.on('error', () => res.destroy());
      reply.pipe(res);
    });
    upstream.on('error', () => {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('The existing website is starting or temporarily unavailable.');
    });
    req.on('aborted', () => upstream.destroy());
    req.on('error', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  server.on('connection', track);
  // Preserve upgrades for existing routes; weather does not introduce a WebSocket service.
  server.on('upgrade', (req, socket, head) => {
    if (isWeatherPath(req.url)) return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    const upstream = track(net.connect(sitePort, '127.0.0.1'));
    upstream.once('connect', () => {
      let header = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) header += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      upstream.write(`${header}\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  });
  return { server, destroyConnections() { for (const socket of sockets) socket.destroy(); } };
}
