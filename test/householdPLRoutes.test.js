import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';

// Exercise the actual route module without installing Express: only its URL-encoded
// middleware factory is stubbed; the auth, filesystem, decoding and HTML injection run.
async function routes(encoded, backup = '') {
  const directory = await mkdtemp(join(tmpdir(), 'household-pl-routes-'));
  await Promise.all(['src', 'public', 'node_modules/express'].map(part => mkdir(join(directory, part), { recursive: true })));
  await Promise.all([
    copyFile(new URL('../src/householdPLRoutes.js', import.meta.url), join(directory, 'src/householdPLRoutes.js')),
    copyFile(new URL('../src/householdPLData.js', import.meta.url), join(directory, 'src/householdPLData.js')),
    copyFile(new URL('../public/household-pl.html', import.meta.url), join(directory, 'public/household-pl.html')),
    writeFile(join(directory, 'package.json'), '{"type":"module"}'),
    writeFile(join(directory, 'node_modules/express/package.json'), '{"type":"module","exports":"./index.js"}'),
    writeFile(join(directory, 'node_modules/express/index.js'), 'export default {urlencoded(){return (_req,_res,next)=>next()}};'),
  ]);
  const previous = Object.fromEntries(['HOUSEHOLD_PL_PASSWORD', 'HOUSEHOLD_PL_COOKIE_SECRET', 'HOUSEHOLD_PL_DATA_GZ', 'HOUSEHOLD_PL_LAST_GOOD_DATA_GZ'].map(key => [key, process.env[key]]));
  const logs = [], originalInfo = console.info, originalError = console.error;
  const mounted = [], gets = new Map();
  try {
    process.env.HOUSEHOLD_PL_PASSWORD = 'test-password';
    process.env.HOUSEHOLD_PL_COOKIE_SECRET = 'test-cookie-secret';
    process.env.HOUSEHOLD_PL_DATA_GZ = encoded;
    process.env.HOUSEHOLD_PL_LAST_GOOD_DATA_GZ = backup;
    console.info = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));
    const { registerHouseholdPLRoutes } = await import(pathToFileURL(join(directory, 'src/householdPLRoutes.js')));
    registerHouseholdPLRoutes({
      use(paths, handler) { mounted.push({ paths: Array.isArray(paths) ? paths : [paths], handler }); },
      get(paths, handler) { for (const path of Array.isArray(paths) ? paths : [paths]) gets.set(path, handler); },
      post() {},
    });
  } finally {
    console.info = originalInfo; console.error = originalError;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  const auth = createHmac('sha256', 'test-cookie-secret').update('household-pl:test-password').digest('hex');
  return {
    logs,
    async request(path, authenticated) {
      const req = { headers: { cookie: authenticated ? 'household_pl_auth=' + auth : '' } };
      const res = { statusCode: 200, headers: {}, body: '',
        setHeader(key, value) { this.headers[key] = value; return this; },
        status(value) { this.statusCode = value; return this; },
        type(value) { this.contentType = value; return this; },
        send(value) { this.body = value; return this; },
      };
      for (const entry of mounted) if (entry.paths.some(prefix => path === prefix || path.startsWith(prefix + '/'))) entry.handler(req, res, () => {});
      await gets.get(path)(req, res);
      return res;
    },
    close() { return rm(directory, { recursive: true, force: true }); },
  };
}

const snapshot = { actualMonth: '2026-10', asOf: '2026-10-15', rows: [{ type: 'line', row: 1, label: 'PRIVATE-SYNTHETIC </script> $& marker', vals: [0, 123] }], tx: [] };

test('authenticated route injects a decoded snapshot while unauthenticated access remains private', async () => {
  const app = await routes(gzipSync(JSON.stringify(snapshot)).toString('base64'));
  try {
    const locked = await app.request('/household-pl', false);
    assert.equal(locked.statusCode, 401);
    assert.match(locked.body, /type="password"/);
    assert.doesNotMatch(locked.body, /PRIVATE-SYNTHETIC/);
    assert.equal(locked.headers['Cache-Control'], 'no-store, private');
    const loaded = await app.request('/household-pl', true);
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.headers['Cache-Control'], 'no-store, private');
    assert.equal(loaded.headers['X-Robots-Tag'], 'noindex, nofollow, noarchive');
    const embedded = loaded.body.match(/const Z=(.*);/)[1];
    assert.deepEqual(JSON.parse(embedded), snapshot);
    assert.doesNotMatch(embedded, /<\/script>/);
    assert.doesNotMatch(loaded.body, /__HOUSEHOLD_PL_DATA__|DecompressionStream|new Response\(/);
    assert.ok(app.logs.some(line => line.includes('snapshot ready:') && line.includes('2026-10')));
    assert.ok(app.logs.every(line => !line.includes('PRIVATE-SYNTHETIC')));
  } finally { await app.close(); }
});

test('invalid configured gzip returns a controlled response without exposing financial data', async () => {
  const app = await routes(Buffer.from('PRIVATE-SYNTHETIC bad gzip').toString('base64'));
  try {
    const locked = await app.request('/household-pl', false);
    assert.equal(locked.statusCode, 401);
    const result = await app.request('/household-pl', true);
    assert.equal(result.statusCode, 503);
    assert.match(result.body, /data is unavailable/);
    assert.doesNotMatch(result.body, /PRIVATE-SYNTHETIC|Failed to fetch/);
    assert.ok(app.logs.some(line => line.includes('HOUSEHOLD_PL_BAD_GZIP')));
    assert.ok(app.logs.every(line => !line.includes('PRIVATE-SYNTHETIC')));
  } finally { await app.close(); }
});


test('a verified backup preserves its original dates and adds visible fallback coverage', async () => {
  const backup = { ...snapshot, actualMonth: '2026-09', asOf: '2026-09-24', refreshedAt: '2026-09-25T00:00:00Z', coverageNotes: 'Checking account only.' };
  const app = await routes('invalid!', gzipSync(JSON.stringify(backup)).toString('base64'));
  try {
    const locked = await app.request('/household-pl', false);
    assert.equal(locked.statusCode, 401);
    assert.doesNotMatch(locked.body, /PRIVATE-SYNTHETIC/);
    const loaded = await app.request('/household-pl', true);
    assert.equal(loaded.statusCode, 200);
    const data = JSON.parse(loaded.body.match(/const Z=(.*);/)[1]);
    assert.equal(data.actualMonth, '2026-09');
    assert.equal(data.asOf, '2026-09-24');
    assert.equal(data.refreshedAt, backup.refreshedAt);
    assert.deepEqual(data.rows, backup.rows);
    assert.deepEqual(data.coverageNotes, ['Checking account only.', 'Latest dataset could not be read; showing last verified backup.']);
    assert.ok(app.logs.some(line => line.includes('snapshot ready:') && line.includes('"source":"backup"')));
    assert.ok(app.logs.every(line => !line.includes('PRIVATE-SYNTHETIC')));
  } finally { await app.close(); }
});

test('valid primary data takes precedence over a valid older backup', async () => {
  const backup = { ...snapshot, actualMonth: '2026-09', asOf: '2026-09-24' };
  const app = await routes(gzipSync(JSON.stringify(snapshot)).toString('base64'), gzipSync(JSON.stringify(backup)).toString('base64'));
  try {
    const loaded = await app.request('/household-pl', true);
    assert.deepEqual(JSON.parse(loaded.body.match(/const Z=(.*);/)[1]), snapshot);
    assert.ok(app.logs.some(line => line.includes('"source":"primary"')));
    assert.ok(app.logs.every(line => !line.includes('"source":"backup"')));
  } finally { await app.close(); }
});

test('invalid primary and invalid backup remain private and return controlled unavailability', async () => {
  const app = await routes('invalid!', 'invalid-backup!');
  try {
    const locked = await app.request('/household-pl.html', false);
    assert.equal(locked.statusCode, 401);
    assert.equal(locked.headers['Cache-Control'], 'no-store, private');
    const loaded = await app.request('/household-pl', true);
    assert.equal(loaded.statusCode, 503);
    assert.match(loaded.body, /data is unavailable/);
    assert.ok(app.logs.some(line => line.includes('primary HOUSEHOLD_PL_BAD_BASE64')));
    assert.ok(app.logs.some(line => line.includes('backup HOUSEHOLD_PL_BAD_BASE64')));
    assert.ok(app.logs.every(line => !line.includes('snapshot ready:')));
  } finally { await app.close(); }
});
