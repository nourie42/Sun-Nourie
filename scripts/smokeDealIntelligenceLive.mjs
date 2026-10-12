import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

// Run only against the owner's existing private site. No cookies, credentials,
// workspace records, research text, screenshots, or traces are written to logs.
const base = new URL(process.env.DEAL_INTELLIGENCE_BASE_URL || 'https://sun-nourie-live.onrender.com').origin;
const password = process.env.WEATHER_SITE_PASSWORD;
const expectedFlow = 'background-v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fingerprint = state => {
  // Context synchronization may save the search preference and version stamp.
  // Discovery must preserve every saved record collection and sample flag.
  const records = Object.fromEntries(Object.keys(state || {}).filter(key => Array.isArray(state[key])).sort().map(key => [key, state[key]]));
  records.sampleMode = state?.sampleMode;
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
};
const safeCode = value => /^[A-Z][A-Z_]{1,60}$/.test(String(value || '')) ? value : 'UNKNOWN_ERROR';
const canonicalSource = value => {
  try { const url = new URL(value); url.hash = ''; return url.href.replace(/\/$/, ''); }
  catch { return ''; }
};
let stage = 'configuration';
let browser;

async function main() {
  assert.ok(password, 'WEATHER_SITE_PASSWORD secret is required for live verification.');
  assert.equal(new URL(base).protocol, 'https:', 'Live verification requires HTTPS.');
  stage = 'browser startup';
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const deadline = Date.now() + 300000; // Deployment and research polling share a five-minute budget.
  const remaining = maximum => Math.max(1, Math.min(maximum, deadline - Date.now()));
  let signIns = 0;

  async function signIn() {
    assert.ok(++signIns <= 3, 'Live session did not remain available.');
    const response = await context.request.post(`${base}/weather-fusion/login`, {
      form: { password, returnTo: '/deal-intelligence/' },
      headers: { Origin: base }, maxRedirects: 0, timeout: remaining(15000),
    });
    assert.equal(response.status(), 303, 'Live sign-in failed.');
    assert.ok((await context.cookies(base)).some(cookie => cookie.name === 'weather_site_auth' && cookie.httpOnly && cookie.secure), 'Live sign-in did not establish a private session.');
  }

  stage = 'live sign-in';
  await signIn();
  stage = 'deployment readiness';
  let deployed = false;
  // Leave time for the server's three-minute research window and result checks.
  const deployDeadline = deadline - 190000;
  while (Date.now() < deployDeadline) {
    try {
      const response = await context.request.get(`${base}/api/deal-intelligence/health`, { timeout: remaining(12000) });
      if (response.status() === 401) { await signIn(); continue; }
      if (response.ok()) {
        const health = await response.json();
        if (health.aiJobs === true && health.researchFlow === expectedFlow) {
          assert.equal(health.aiConnected, true, 'Live AI is not connected.');
          deployed = true;
          break;
        }
      }
    } catch (error) {
      // Readiness may briefly fail while Render replaces the running instance.
      if (error?.code === 'ERR_ASSERTION') throw error;
    }
    await pause(Math.min(5000, Math.max(0, deployDeadline - Date.now())));
  }
  assert.ok(deployed, 'Render did not serve the background research version within the verification window.');
  console.log(`Deployment ready: ${expectedFlow}`);

  stage = 'workspace browser load';
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', () => pageErrors.push(true));
  const workspaceWrites = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/deal-intelligence/state') {
      try { workspaceWrites.push(fingerprint(request.postDataJSON()?.state)); }
      catch { workspaceWrites.push('unreadable'); }
    }
  });
  let response = await page.goto(`${base}/deal-intelligence/`, { waitUntil: 'domcontentloaded', timeout: remaining(30000) });
  if (response?.status() === 401) {
    await signIn();
    response = await page.goto(`${base}/deal-intelligence/`, { waitUntil: 'domcontentloaded', timeout: remaining(30000) });
  }
  assert.equal(response?.status(), 200, 'Live workspace page did not load.');
  await page.locator('#ai-status.connected').waitFor({ state: 'visible', timeout: remaining(20000) });
  assert.equal(await page.locator('#nav [data-nav]').count(), 9, 'Workspace navigation is incomplete.');
  await page.locator('#nav [data-nav="hunter"]').click();
  await page.locator('#hunter-form').waitFor({ state: 'visible', timeout: remaining(10000) });
  const before = await context.request.get(`${base}/api/deal-intelligence/state`, { timeout: remaining(12000) });
  assert.equal(before.status(), 200, 'Saved workspace could not be read.');
  const stateBefore = fingerprint((await before.json()).state);
  console.log('Browser loaded the private workspace and Acquisition hunter.');

  stage = 'real discovery through browser form';
  const prompt = 'Find exactly one real, privately owned fuel marketer based in North Carolina. Use its official company website as an accessed public source, identify its fuel-marketing business and North Carolina location, and return a sourced research draft. Leave owner/contact/site-count facts unknown when unsupported. Do not save or import the target.';
  await page.locator('#hunter-form textarea[name="prompt"]').fill(prompt);
  const captures = [];
  const pending = new Set();
  const capture = liveResponse => {
    const path = new URL(liveResponse.url()).pathname;
    if (!path.startsWith('/api/deal-intelligence/ai/jobs/')) return;
    const operation = (async () => {
      const record = { httpStatus: liveResponse.status() };
      if (record.httpStatus === 200) {
        try { Object.assign(record, await liveResponse.json()); }
        catch { record.unreadable = true; }
      }
      captures.push(record);
    })();
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  };
  page.on('response', capture);
  const acceptedPromise = page.waitForResponse(liveResponse => new URL(liveResponse.url()).pathname === '/api/deal-intelligence/ai/jobs' && liveResponse.request().method() === 'POST', { timeout: remaining(20000) });
  const researchStarted = Date.now();
  await page.locator('#hunter-form button[type="submit"]').click();
  const accepted = await acceptedPromise;
  stage = 'background job acceptance';
  assert.equal(accepted.status(), 202, 'Discovery did not use a background research job.');
  const job = await accepted.json();
  assert.ok(typeof job.jobId === 'string' && job.jobId.length > 10, 'Discovery did not return a job identifier.');
  assert.ok(['queued', 'running'].includes(job.status), 'Discovery returned an invalid initial job state.');
  assert.ok(Date.now() - researchStarted < 15000, 'Discovery submission held the browser request open.');
  await page.locator('#ai-progress[role="status"]').waitFor({ state: 'visible', timeout: remaining(10000) });
  console.log('Browser discovery accepted promptly as a background job.');

  stage = 'background job completion';
  let completed;
  while (Date.now() < deadline) {
    await Promise.allSettled([...pending]);
    const invalid = captures.find(record => record.httpStatus !== 200 || record.unreadable || record.jobId !== job.jobId || !['queued', 'running', 'completed', 'failed'].includes(record.status));
    if (invalid) throw new Error(`LIVE_JOB_HTTP_${Number(invalid.httpStatus) || 0}`);
    const failed = captures.find(record => record.status === 'failed');
    if (failed) throw new Error(`LIVE_RESEARCH_${safeCode(failed.code)}`);
    completed = captures.find(record => record.status === 'completed');
    if (completed) break;
    await pause(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  assert.ok(completed, 'Browser research did not complete within the verification window.');
  stage = 'sourced company verification';
  const result = completed.result;
  assert.equal(result?.engine, 'openai', 'Live research did not use OpenAI.');
  assert.equal(result?.mode, 'discover', 'Live research used an unexpected mode.');
  assert.ok(Array.isArray(result.sources) && result.sources.some(source => /^https?:\/\//.test(source.url)), 'Live research returned no accessed public sources.');
  const sourced = result.data?.targets?.filter(target => target.name?.trim() && target.sourceUrls?.some(url => /^https?:\/\//.test(url)));
  assert.ok(sourced?.length > 0, 'Live research returned no sourced company draft.');
  const accessed = new Set(result.sources.map(source => canonicalSource(source.url)).filter(Boolean));
  assert.ok(sourced.some(target => target.sourceUrls.some(url => accessed.has(canonicalSource(url)))), 'Live company draft did not cite an accessed public source.');
  stage = 'research results in browser';
  await page.locator('#main h2').filter({ hasText: /^Research results$/ }).waitFor({ state: 'visible', timeout: remaining(10000) });
  await page.locator('[data-action="save-discovered"]').waitFor({ state: 'visible', timeout: remaining(10000) });
  assert.equal(await page.locator('#hunter-form button[type="submit"]').isEnabled(), true, 'Discovery controls did not recover after completion.');
  assert.equal(pageErrors.length, 0, 'Browser raised a workspace JavaScript error.');
  assert.ok(workspaceWrites.every(value => value === stateBefore), 'Research synchronization changed saved workspace records.');
  stage = 'saved workspace preservation';
  const after = await context.request.get(`${base}/api/deal-intelligence/state`, { timeout: remaining(12000) });
  assert.equal(after.status(), 200, 'Saved workspace could not be checked after research.');
  assert.equal(fingerprint((await after.json()).state), stateBefore, 'Research changed saved workspace records automatically.');
  console.log(`Live browser research passed: ${Math.round((Date.now() - researchStarted) / 1000)}s, ${sourced.length} sourced draft(s), ${result.sources.length} public source(s), saved records unchanged.`);
  await context.close();
}

try {
  await main();
} catch (error) {
  // Playwright exceptions can include request details or DOM contents. Emit
  // only our safe status codes; never stringify upstream/browser errors.
  const code = /^LIVE_(?:RESEARCH_[A-Z_]+|JOB_HTTP_\d+)$/.test(error?.message || '') ? error.message : error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'CHECK_FAILED';
  console.error(`Deal Intelligence live verification failed during ${stage}: ${code}.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
