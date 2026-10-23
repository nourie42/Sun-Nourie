import test from 'node:test';
import assert from 'node:assert/strict';
import { Cache } from '../src/weatherFusion.js';

test('large weather snapshots are evicted by payload size before the entry limit', async () => {
  const cache = new Cache(100, Date.now, { maxBytes: 1000 });
  const snapshot = { hours: [{ detail: 'x'.repeat(400) }] };
  for (let i = 0; i < 20; i++) await cache.get(`location-${i}`, 60000, async () => snapshot);
  assert.equal(cache.values.size, 2);
  assert.ok(cache.sizeBytes <= 1000);
  assert.equal(cache.values.has('location-19'), true);
  assert.equal(cache.values.has('location-0'), false);
});

test('oversized forecasts are returned successfully without evicting useful cached forecasts', async () => {
  const cache = new Cache(100, Date.now, { maxBytes: 100 });
  await cache.get('small', 60000, async () => 42);
  const large = { detail: 'x'.repeat(200) };
  assert.equal(await cache.get('large', 60000, async () => large), large);
  assert.equal(cache.values.has('large'), false);
  assert.equal(cache.values.has('small'), true);
});

test('expired assembled forecasts are released when another location is requested', async () => {
  let now = 0;
  const cache = new Cache(100, () => now, { retainExpired: false });
  await cache.get('old-location', 60000, async () => ({ temperature: 70 }));
  now = 60000;
  await cache.get('new-location', 60000, async () => ({ temperature: 75 }));
  assert.equal(cache.values.has('old-location'), false);
  assert.equal(cache.values.size, 1);
});

test('expired official guidance remains available to the existing recovery validator', async () => {
  let now = 0;
  const cache = new Cache(100, () => now);
  const official = { fetchedAt: 0, temperature: 70 };
  await cache.get('official', 60000, async () => official);
  now = 60001;
  await cache.get('other', 60000, async () => 42);
  const recovered = await cache.get('official', 60000, async () => { throw new Error('NWS unavailable'); }, {
    onError: (_error, saved) => saved,
  });
  assert.equal(recovered, official);
  assert.equal(recovered.fetchedAt, 0);
});

test('forecast assembly capacity rejects new locations but shares existing work', async () => {
  const cache = new Cache(100, Date.now, { maxPending: 2 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const load = () => { calls++; return gate; };
  const first = cache.get('first', 60000, load);
  const shared = cache.get('first', 60000, load);
  const second = cache.get('second', 60000, load);
  await assert.rejects(cache.get('third', 60000, load), error => error.status === 429);
  release(77);
  assert.deepEqual(await Promise.all([first, shared, second]), [77, 77, 77]);
  assert.equal(calls, 2);
  assert.equal(cache.pending.size, 0);
});

test('replacements and external invalidation do not leave phantom byte usage', async () => {
  let now = 0;
  const cache = new Cache(100, () => now, { maxBytes: 100 });
  await cache.get('first', 1, async () => 'x'.repeat(60));
  now = 2;
  await cache.get('first', 1, async () => 1);
  cache.values.delete('first');
  await cache.get('second', 1, async () => 'x'.repeat(60));
  assert.equal(cache.values.size, 1);
  assert.ok(cache.sizeBytes <= 100);
});
