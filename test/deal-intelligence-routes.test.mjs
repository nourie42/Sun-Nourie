import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { registerDealIntelligenceRoutes } from '../src/dealIntelligenceRoutes.js';
import { calculate } from '../src/deal-intelligence/finance.mjs';

function app() {
  const routes = new Map();
  return { routes, get: (path, fn) => routes.set(`GET ${path}`, fn), use: (path, fn) => routes.set(`USE ${path}`, fn) };
}
function response() {
  return {
    statusCode: 200, headers: {}, payload: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    type(value) { this.contentType = value; return this; },
    send(value) { this.payload = value; return this; },
    json(value) { this.payload = value; return this; },
    redirect(status, url) { this.statusCode = status; this.location = url; return this; },
  };
}
function request(path, { authenticated = true, body, headers = {}, method } = {}) {
  const req = {
    originalUrl: path, url: path, method: method || (body === undefined ? 'GET' : 'POST'),
    weatherSiteAuthenticated: authenticated, headers: { host: 'sun-nourie-live.onrender.com', 'x-forwarded-proto': 'https', ...(body === undefined ? {} : { 'content-type': 'application/json', origin: 'https://sun-nourie-live.onrender.com' }), ...headers },
    readableEnded: true, ...(body === undefined ? {} : { body }),
  };
  req.get = name => req.headers[name.toLowerCase()];
  return req;
}
function memoryStore() {
  const records = new Map();
  return {
    owners: [],
    async get(owner) { this.owners.push(owner); return structuredClone(records.get(owner) || null); },
    async put(owner, state, expected) { this.owners.push(owner); if (expected !== undefined && records.get(owner)?.updatedAt !== expected) return false; records.set(owner, structuredClone(state)); return true; },
  };
}
async function api(instance, path, options) {
  const res = response();
  await instance.routes.get('USE /api/deal-intelligence')(request(`/api/deal-intelligence${path}`, options), res);
  return res;
}
function researchResponse() {
  return new Response(JSON.stringify({
    status: 'completed', output_text: JSON.stringify({ text: 'Completed sourced research.', brief: '', targets: [], findings: [] }),
    output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://official.example/company', title: 'Official source' }] } }],
  }), { headers: { 'content-type': 'application/json' } });
}
async function waitForJob(instance, id, status) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await api(instance, `/ai/jobs/${id}`);
    if (result.payload.status === status) return result;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`Research job did not become ${status}`);
}

test('every page and API route fails closed without the verified weather session', async () => {
  const instance = app();
  let mutations = 0;
  const store = { get: async () => { mutations++; return null; }, put: async () => { mutations++; } };
  registerDealIntelligenceRoutes(instance, { env: { LOCAL_DEV: true }, store });
  for (const path of ['/deal-intelligence', '/deal-intelligence/']) {
    const res = response();
    await instance.routes.get(`GET ${path}`)(request(path, { authenticated: false }), res);
    assert.equal(res.statusCode, 303);
    assert.match(res.location, /^\/weather-fusion\/login\?returnTo=/);
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }
  const res = await api(instance, '/state', { authenticated: false, body: { state: { targets: [] } }, headers: { 'oai-authenticated-user-id': 'forged-user' } });
  assert.equal(res.statusCode, 401);
  assert.equal(mutations, 0);
});

test('branch adapts HTTPS proxy origin, stores state, and ignores client identity headers', async () => {
  const instance = app();
  const store = memoryStore();
  registerDealIntelligenceRoutes(instance, { env: {}, store });
  const first = await api(instance, '/state', { headers: { 'oai-authenticated-user-id': 'attacker-choice', 'oai-authenticated-user-email': 'forged@example.com' } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.storage, 'browser');
  assert.match(first.payload.storageWarning, /temporary/);
  const state = first.payload.state;
  state.settings.workspaceName = 'Private acquisition workspace';
  const saved = await api(instance, '/state', { body: { state, expectedUpdatedAt: state.updatedAt } });
  assert.equal(saved.statusCode, 200);
  assert.equal((await api(instance, '/state')).payload.state.settings.workspaceName, state.settings.workspaceName);
  assert.deepEqual([...new Set(store.owners)], ['sun-nourie-owner']);
  const rejected = await api(instance, '/state', { body: { state }, headers: { origin: 'https://unrelated.example' } });
  assert.equal(rejected.statusCode, 403);
});

test('finance requests use the exact shared engine through the protected branch', async () => {
  const instance = app();
  registerDealIntelligenceRoutes(instance, { env: {}, store: memoryStore() });
  const result = await api(instance, '/finance', { body: { inputs: { purchasePrice: 20000000 } } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, calculate({ purchasePrice: 20000000 }));
  const invalid = await api(instance, '/finance', { body: { inputs: { siteCount: 'unknown' } } });
  assert.equal(invalid.statusCode, 400);
});

test('configured file storage survives route registration and does not claim unverified durability', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nourie-deal-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { DEAL_INTELLIGENCE_DATA_DIR: directory };
  const first = app();
  registerDealIntelligenceRoutes(first, { env });
  const state = (await api(first, '/state')).payload.state;
  state.settings.workspaceName = 'Persisted server copy';
  const saved = await api(first, '/state', { body: { state } });
  assert.equal(saved.payload.storage, 'server');
  assert.match(saved.payload.storageWarning, /not verified/);
  const second = app();
  registerDealIntelligenceRoutes(second, { env });
  assert.equal((await api(second, '/state')).payload.state.settings.workspaceName, 'Persisted server copy');
});

test('slash redirect handles Express non-strict route matching without looping', async () => {
  const instance = app();
  registerDealIntelligenceRoutes(instance, { env: {}, store: memoryStore() });
  const slashless = response();
  await instance.routes.get('GET /deal-intelligence')(request('/deal-intelligence'), slashless);
  assert.equal(slashless.statusCode, 302);
  assert.equal(slashless.location, '/deal-intelligence/');
  const canonical = response();
  await instance.routes.get('GET /deal-intelligence')(request('/deal-intelligence/'), canonical);
  assert.equal(canonical.location, undefined);
  assert.ok([200, 503].includes(canonical.statusCode));
  assert.match(canonical.headers['content-security-policy'], /connect-src 'self'/);
});

test('authorized research uses only the server credential and returns sourced drafts without saving them', async () => {
  const instance = app();
  const store = memoryStore();
  let calls = 0;
  registerDealIntelligenceRoutes(instance, {
    env: { OPENAI_API_KEY: 'server-only-test-credential' }, store,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.authorization, 'Bearer server-only-test-credential');
      const body = JSON.parse(options.body);
      assert.equal(body.tools[0].type, 'web_search');
      assert.doesNotMatch(options.body, /server-only-test-credential|client-forged-credential/);
      return new Response(JSON.stringify({ status: 'completed', output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://official.example/company', title: 'Official company source' }] } },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
          text: 'Sourced research draft for review.', brief: '', findings: [], targets: [{
            name: 'Test source company', region: 'NC', website: 'https://official.example/company', businessType: 'Convenience retailer', siteCount: null,
            fitScore: 70, fitRationale: 'Subjective geography fit.', summary: 'A source-backed test draft.', sourceUrls: ['https://official.example/company'],
            claims: [{ claim: 'Company profile.', sourceUrl: 'https://official.example/company', confidence: 'reported' }], contacts: [], researchGaps: ['Verify legal ownership.'],
          }],
        }), annotations: [{ type: 'url_citation', url: 'https://official.example/company', title: 'Official company source' }] }] },
      ] }), { headers: { 'content-type': 'application/json' } });
    },
  });
  const before = (await api(instance, '/state')).payload.state;
  const unauthorized = await api(instance, '/ai', { authenticated: false, body: { mode: 'discover', prompt: 'Find an operator.' } });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(calls, 0);
  const result = await api(instance, '/ai', { body: { mode: 'discover', prompt: 'Find an operator.' }, headers: { authorization: 'Bearer client-forged-credential' } });
  assert.equal(result.statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(result.payload.data.targets.length, 1);
  assert.equal(result.payload.data.targets[0].sellerSignal, 'Unknown');
  assert.ok(result.payload.sources.length);
  assert.equal((await api(instance, '/state')).payload.state.targets.length, before.targets.length);
});

test('research jobs return immediately, remain private, and complete independently of the submitting connection', async () => {
  const instance = app();
  const store = memoryStore();
  const metadata = [];
  let release;
  let upstreamStarted = false;
  registerDealIntelligenceRoutes(instance, {
    env: { OPENAI_API_KEY: 'server-only-test-credential' }, store,
    logger: { info: (...entry) => metadata.push(entry) },
    fetchImpl: async (_url, options) => {
      upstreamStarted = true;
      assert.equal(options.headers.authorization, 'Bearer server-only-test-credential');
      assert.match(options.body, /Find an operator\./);
      return await new Promise(resolve => { release = () => resolve(researchResponse()); });
    },
  });
  const accepted = await api(instance, '/ai/jobs', { body: { mode: 'discover', prompt: 'Find an operator.' } });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.payload.status, 'queued');
  assert.match(accepted.payload.jobId, /^[\da-f]{8}-[\da-f-]{27}$/);
  assert.doesNotMatch(JSON.stringify(accepted.payload), /Find an operator|credential|owner/);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(upstreamStarted, true);
    assert.equal((await api(instance, `/ai/jobs/${accepted.payload.jobId}`)).payload.status, 'running');
    assert.equal((await api(instance, `/ai/jobs/${accepted.payload.jobId}`, { authenticated: false })).statusCode, 401);
    assert.equal((await api(instance, '/ai/jobs', { authenticated: false, body: { mode: 'discover', prompt: 'Private' } })).statusCode, 401);
  } finally { release?.(); }
  const completed = await waitForJob(instance, accepted.payload.jobId, 'completed');
  assert.equal(completed.payload.result.text, 'Completed sourced research.');
  assert.equal(completed.headers['cache-control'], 'private, no-store');
  assert.doesNotMatch(JSON.stringify(completed.payload), /server-only-test-credential/);
  assert.deepEqual([...new Set(store.owners)], ['sun-nourie-owner']);
  assert.equal(metadata.length, 1);
  assert.deepEqual(Object.keys(metadata[0][1]).sort(), ['code', 'durationMs', 'mode', 'status']);
  const health = await api(instance, '/health');
  assert.equal(health.payload.aiJobs, true);
  assert.equal(health.payload.researchFlow, 'background-v1');
});

test('jobs fully buffer streamed POST bodies before acknowledging them and survive a subsequent disconnect', async () => {
  const instance = app();
  let release;
  registerDealIntelligenceRoutes(instance, {
    env: { OPENAI_API_KEY: 'server-only-test-credential' }, store: memoryStore(), logger: null,
    fetchImpl: async (_url, options) => {
      assert.match(options.body, /streamed prompt/);
      return await new Promise(resolve => { release = () => resolve(researchResponse()); });
    },
  });
  const stream = new PassThrough();
  Object.assign(stream, {
    method: 'POST', originalUrl: '/api/deal-intelligence/ai/jobs', weatherSiteAuthenticated: true,
    headers: { host: 'sun-nourie-live.onrender.com', 'x-forwarded-proto': 'https', 'content-type': 'application/json', origin: 'https://sun-nourie-live.onrender.com' },
    get(name) { return this.headers[name]; },
  });
  const res = response();
  const pending = instance.routes.get('USE /api/deal-intelligence')(stream, res);
  stream.write('{"mode":"discover",');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.payload, undefined);
  stream.end('"prompt":"streamed prompt"}');
  await pending;
  assert.equal(res.statusCode, 202);
  stream.destroy();
  await new Promise(resolve => setImmediate(resolve));
  release();
  assert.equal((await waitForJob(instance, res.payload.jobId, 'completed')).payload.result.text, 'Completed sourced research.');
});

test('concurrent streamed submissions enforce the two-job limit without waiting for upstream research', async () => {
  const instance = app();
  const releases = [];
  registerDealIntelligenceRoutes(instance, {
    env: { OPENAI_API_KEY: 'server-only-test-credential' }, store: memoryStore(), logger: null,
    fetchImpl: async () => await new Promise(resolve => releases.push(() => resolve(researchResponse()))),
  });
  const responses = await Promise.all(Array.from({ length: 3 }, () => api(instance, '/ai/jobs', { body: { mode: 'discover', prompt: 'Find an operator.' } })));
  assert.deepEqual(responses.map(res => res.statusCode).sort(), [202, 202, 429]);
  assert.equal(responses.find(res => res.statusCode === 429).payload.code, 'AI_BUSY');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length, 2);
  for (const release of releases) release();
  for (const res of responses.filter(res => res.statusCode === 202)) await waitForJob(instance, res.payload.jobId, 'completed');
});

test('failed jobs preserve safe API errors, validate their origin and JSON, and explain expired jobs', async () => {
  const instance = app();
  registerDealIntelligenceRoutes(instance, {
    env: { OPENAI_API_KEY: 'private-test-key' }, store: memoryStore(), logger: null,
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'Secret provider details private-test-key' } }), { status: 429 }),
  });
  const crossOrigin = await api(instance, '/ai/jobs', { body: { mode: 'discover', prompt: 'Find' }, headers: { origin: 'https://unrelated.example' } });
  assert.equal(crossOrigin.statusCode, 403);
  const invalid = await api(instance, '/ai/jobs', { body: 'invalid-json' });
  assert.equal(invalid.statusCode, 400);
  const accepted = await api(instance, '/ai/jobs', { body: { mode: 'discover', prompt: 'Find' } });
  const failed = await waitForJob(instance, accepted.payload.jobId, 'failed');
  assert.equal(failed.payload.code, 'AI_QUOTA');
  assert.equal(failed.payload.httpStatus, 503);
  assert.doesNotMatch(JSON.stringify(failed.payload), /private-test-key|Secret provider/);
  const missing = await api(instance, '/ai/jobs/unknown');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.payload.code, 'JOB_NOT_FOUND');
  assert.match(missing.payload.error, /service restarted/);
});

test('an upstream body-read deadline becomes a safe timeout failure and releases the job slot', async () => {
  const instance = app();
  registerDealIntelligenceRoutes(instance, {
    env: { OPENAI_API_KEY: 'private-test-key', OPENAI_REQUEST_TIMEOUT_MS: 1 }, store: memoryStore(), logger: null,
    fetchImpl: async (_url, options) => ({
      ok: true, status: 200,
      json: async () => await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })),
    }),
  });
  const accepted = await api(instance, '/ai/jobs', { body: { mode: 'discover', prompt: 'Find' } });
  await new Promise(resolve => setTimeout(resolve, 1050));
  const failed = await waitForJob(instance, accepted.payload.jobId, 'failed');
  assert.equal(failed.payload.httpStatus, 504);
  assert.equal(failed.payload.code, 'AI_TIMEOUT');
  assert.match(failed.payload.error, /1-second limit/);
});

test('completed jobs expire after fifteen minutes and do not survive a service restart', async t => {
  const instance = app();
  const options = { env: { OPENAI_API_KEY: 'private-test-key' }, store: memoryStore(), logger: null, fetchImpl: async () => researchResponse() };
  registerDealIntelligenceRoutes(instance, options);
  const accepted = await api(instance, '/ai/jobs', { body: { mode: 'discover', prompt: 'Find' } });
  await waitForJob(instance, accepted.payload.jobId, 'completed');
  const restarted = app();
  registerDealIntelligenceRoutes(restarted, options);
  assert.equal((await api(restarted, `/ai/jobs/${accepted.payload.jobId}`)).payload.code, 'JOB_NOT_FOUND');
  const later = Date.now() + 15 * 60 * 1000 + 1;
  t.mock.method(Date, 'now', () => later);
  const expired = await api(instance, `/ai/jobs/${accepted.payload.jobId}`);
  assert.equal(expired.statusCode, 404);
  assert.equal(expired.payload.code, 'JOB_NOT_FOUND');
});
