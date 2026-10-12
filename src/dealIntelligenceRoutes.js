import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { handleApi, readBody } from './deal-intelligence/api.mjs';

const PAGE = '/deal-intelligence/';
const API = '/api/deal-intelligence';
const OWNER = 'sun-nourie-owner';
const JOB_TTL = 15 * 60 * 1000;
const MAX_JOBS = 100;
const MAX_ACTIVE_JOBS = 2;
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
export function registerDealIntelligenceRoutes(app, { env = process.env, store, fetchImpl = globalThis.fetch, logger = console } = {}) {
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
    OPENAI_REQUEST_TIMEOUT_MS: env.OPENAI_REQUEST_TIMEOUT_MS,
    fetchImpl,
  };
  const configuredResearchTimeout = Number(env.OPENAI_REQUEST_TIMEOUT_MS);
  const researchEnv = {
    ...apiEnv,
    OPENAI_REQUEST_TIMEOUT_MS: Number.isFinite(configuredResearchTimeout) && configuredResearchTimeout > 0 ? configuredResearchTimeout : 180000,
  };
  const jobs = new Map();
  const active = job => job.status === 'queued' || job.status === 'running';
  function pruneJobs(makeRoom = false) {
    const expiredBefore = Date.now() - JOB_TTL;
    for (const [id, job] of jobs) if (!active(job) && job.finishedAt <= expiredBefore) jobs.delete(id);
    if (makeRoom) for (const [id, job] of jobs) {
      if (jobs.size < MAX_JOBS) break;
      if (!active(job)) jobs.delete(id);
    }
  }
  function publicJob(job) {
    const { jobId, status, createdAt, updatedAt, result, error, code, httpStatus } = job;
    return { jobId, status, createdAt, updatedAt, ...(result ? { result } : {}), ...(error ? { error, code, httpStatus } : {}) };
  }
  function researchBusy(res) {
    res.setHeader('Retry-After', '5');
    return res.status(429).json({ error: 'Two research requests are already running. Wait for one to finish before starting another.', code: 'AI_BUSY' });
  }
  async function completeResearch(job, request) {
    job.status = 'running';
    job.startedAt = Date.now();
    job.updatedAt = new Date().toISOString();
    try {
      const response = await handleApi(request, researchEnv);
      const payload = await response.json();
      if (response.ok) {
        job.result = payload;
        job.status = 'completed';
      } else {
        job.error = payload.error || 'The research request could not be completed.';
        job.code = payload.code || 'AI_ERROR';
        job.httpStatus = response.status;
        job.status = 'failed';
      }
    } catch {
      job.error = 'The research request could not be completed. Try again.';
      job.code = 'INTERNAL_ERROR';
      job.httpStatus = 500;
      job.status = 'failed';
    } finally {
      job.finishedAt = Date.now();
      job.updatedAt = new Date(job.finishedAt).toISOString();
      try {
        logger?.info?.('Deal Intelligence research job finished.', {
          mode: job.mode, status: job.status, code: job.code || 'OK',
          durationMs: job.finishedAt - job.startedAt,
        });
      } catch {}
    }
  }

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
      const url = new URL(request.url);
      if (url.pathname === '/api/ai/jobs') {
        if (request.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return res.status(405).json({ error: 'This HTTP method is not allowed.', code: 'METHOD_NOT_ALLOWED' });
        }
        const origin = request.headers.get('origin');
        if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== url.origin) return res.status(403).json({ error: 'Requests must come from this workspace.', code: 'ORIGIN_REJECTED' });
        pruneJobs(true);
        if ([...jobs.values()].filter(active).length >= MAX_ACTIVE_JOBS) return researchBusy(res);
        // Fully consume the incoming stream before returning 202. Research uses
        // this buffered request independently of the browser's connection.
        let body;
        try { body = await readBody(request); }
        catch (error) {
          const known = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
          return res.status(known ? error.status : 400).json({ error: known ? error.message : 'The request must contain valid JSON.', code: known ? error.code : 'INVALID_JSON' });
        }
        // Concurrent request streams may finish together; enforce the limit
        // again after buffering, with no await before reserving the job slot.
        pruneJobs(true);
        if ([...jobs.values()].filter(active).length >= MAX_ACTIVE_JOBS) return researchBusy(res);
        const bufferedRequest = new Request(new URL('/api/ai', url), { method: 'POST', headers: request.headers, body: JSON.stringify(body) });
        const mode = ['discover', 'research', 'analyst', 'brief', 'monitor'].includes(body.mode) ? body.mode : 'invalid';
        const job = { jobId: randomUUID(), owner: OWNER, mode, status: 'queued', createdAt: new Date().toISOString() };
        job.updatedAt = job.createdAt;
        jobs.set(job.jobId, job);
        const accepted = res.status(202).json(publicJob(job));
        queueMicrotask(() => { void completeResearch(job, bufferedRequest); });
        return accepted;
      }
      if (url.pathname.startsWith('/api/ai/jobs/')) {
        if (request.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          return res.status(405).json({ error: 'This HTTP method is not allowed.', code: 'METHOD_NOT_ALLOWED' });
        }
        pruneJobs();
        const job = jobs.get(url.pathname.slice('/api/ai/jobs/'.length));
        if (!job || job.owner !== OWNER) return res.status(404).json({ error: 'This research job expired or the service restarted. Run it again; your saved workspace is preserved.', code: 'JOB_NOT_FOUND' });
        return res.json(publicJob(job));
      }
      const response = await handleApi(request, apiEnv);
      let payload = await response.json();
      if (payload?.state) payload = { ...payload, storage, ...(warning ? { storageWarning: warning } : {}) };
      if (new URL(request.url).pathname === '/api/health' && response.ok) payload = { ...payload, storage, aiJobs: true, researchFlow: 'background-v1', ...(warning ? { storageWarning: warning } : {}) };
      for (const [name, value] of response.headers) {
        if (name !== 'cache-control' && name !== 'content-length' && name !== 'content-type') res.setHeader(name, value);
      }
      return res.status(response.status).json(payload);
    } catch {
      return res.status(500).json({ error: 'The workspace could not complete this request.', code: 'INTERNAL_ERROR' });
    }
  });
}
