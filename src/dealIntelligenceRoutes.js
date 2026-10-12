import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handleApi } from './deal-intelligence/api.mjs';

const PAGE = '/deal-intelligence/';
const API = '/api/deal-intelligence';
const OWNER = 'sun-nourie-owner';
const pageFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'deal-intelligence', 'index.html');
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";

function privateHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
}

function fileStore(directory) {
  const filename = join(directory, 'workspace.json');
  let writes = Promise.resolve();
  async function read() {
    try {
      const records = JSON.parse(await readFile(filename, 'utf8'));
      if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('Invalid workspace file');
      return records;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Workspace storage could not be read.');
    }
  }
  return {
    async get(owner) {
      await writes.catch(() => {});
      return (await read())[owner] || null;
    },
    put(owner, state, expectedUpdatedAt) {
      const operation = writes.catch(() => {}).then(async () => {
        const records = await read();
        if (expectedUpdatedAt !== undefined && records[owner]?.updatedAt !== expectedUpdatedAt) return false;
        records[owner] = state;
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${filename}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
        await chmod(temporary, 0o600);
        await rename(temporary, filename);
        return true;
      });
      writes = operation;
      return operation;
    },
  };
}

function requestOrigin(req) {
  const forwarded = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : req.secure || req.protocol === 'https' ? 'https' : 'http';
  const host = req.get?.('host') || req.headers?.host;
  if (typeof host !== 'string' || !host || /[\s\\/@?#]/.test(host)) throw new Error('Invalid host');
  const origin = new URL(`${protocol}://${host}`);
  if (origin.host.toLowerCase() !== host.toLowerCase()) throw new Error('Invalid host');
  return origin.origin;
}

function webRequest(req) {
  const origin = requestOrigin(req);
  const incoming = new URL(req.originalUrl || `${API}${req.url || '/'}`, origin);
  if (incoming.origin !== origin || (incoming.pathname !== API && !incoming.pathname.startsWith(`${API}/`))) throw new Error('Invalid API path');
  const url = new URL(`/api${incoming.pathname.slice(API.length)}${incoming.search}`, origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (lower.startsWith('oai-authenticated-') || ['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer'].includes(lower) || value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  // The existing cookie gate has authenticated the private site's owner. A client
  // cannot choose a different workspace by supplying an identity header.
  headers.set('oai-authenticated-user-id', OWNER);
  const method = String(req.method || 'GET').toUpperCase();
  const options = { method, headers };
  if (!['GET', 'HEAD'].includes(method)) {
    if (req.body !== undefined) {
      options.body = Buffer.isBuffer(req.body) || typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else if (!req.readableEnded) {
      options.body = Readable.toWeb(req);
      options.duplex = 'half';
    }
  }
  return new Request(url, options);
}

/** Shares the weather site's existing verified session; it creates no new login. */
export function registerDealIntelligenceRoutes(app, { env = process.env, store, fetchImpl = globalThis.fetch } = {}) {
  const configured = env.DEAL_INTELLIGENCE_DATA_DIR || env.DATA_DIR;
  const directory = configured ? join(resolve(configured), 'deal-intelligence') : join(tmpdir(), 'deal-intelligence');
  const storage = configured ? env.DEAL_INTELLIGENCE_STORAGE_DURABLE === 'true' ? 'durable' : 'server' : 'browser';
  const warning = storage === 'durable' ? undefined : storage === 'server'
    ? 'Server storage is configured, but persistence across deployments is not verified. Keep browser data and exported backups.'
    : 'Browser storage is primary. The server copy is temporary and may reset after a restart or deployment.';
  const apiEnv = {
    STORE: store || fileStore(directory),
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_MODEL: env.OPENAI_MODEL || 'gpt-5-mini',
    OPENAI_RESEARCH_MODEL: env.OPENAI_RESEARCH_MODEL || 'gpt-5.5',
    fetchImpl,
  };

  const signedInPage = handler => async (req, res) => {
    privateHeaders(res);
    if (req.weatherSiteAuthenticated !== true) return res.redirect(303, `/weather-fusion/login?returnTo=${encodeURIComponent(PAGE)}`);
    return handler(req, res);
  };

  // Express's default non-strict routing treats both slash variants alike.
  // Check the actual pathname before redirecting to avoid a redirect loop.
  app.get('/deal-intelligence', signedInPage(async (req, res) => {
    const pathname = String(req.originalUrl || req.url || '').split('?')[0];
    if (!pathname.endsWith('/')) return res.redirect(302, PAGE);
    try {
      const content = await readFile(pageFile, 'utf8');
      return res.type('html').send(content);
    } catch {
      return res.status(503).type('text').send('The M&A workspace is temporarily unavailable.');
    }
  }));
  app.get(PAGE, signedInPage(async (_req, res) => {
    try { return res.type('html').send(await readFile(pageFile, 'utf8')); }
    catch { return res.status(503).type('text').send('The M&A workspace is temporarily unavailable.'); }
  }));

  app.use(API, async (req, res) => {
    privateHeaders(res);
    if (req.weatherSiteAuthenticated !== true) return res.status(401).json({ error: 'Sign in to access this private workspace.', code: 'AUTH_REQUIRED', loginUrl: `/weather-fusion/login?returnTo=${encodeURIComponent(PAGE)}` });
    let request;
    try { request = webRequest(req); }
    catch { return res.status(400).json({ error: 'Invalid workspace request.', code: 'INVALID_REQUEST' }); }
    try {
      const response = await handleApi(request, apiEnv);
      let payload = await response.json();
      if (payload?.state) payload = { ...payload, storage, ...(warning ? { storageWarning: warning } : {}) };
      if (new URL(request.url).pathname === '/api/health' && response.ok) payload = { ...payload, storage, ...(warning ? { storageWarning: warning } : {}) };
      for (const [name, value] of response.headers) {
        if (name !== 'cache-control' && name !== 'content-length' && name !== 'content-type') res.setHeader(name, value);
      }
      return res.status(response.status).json(payload);
    } catch {
      return res.status(500).json({ error: 'The workspace could not complete this request.', code: 'INTERNAL_ERROR' });
    }
  });
}
