// Optional Google AI (Gemini) cleanup for deal feed titles.
//
// Deal feeds carry messy post titles ("Ninja CREAMi ... + $20 Kohl's Cash Free
// Shipping w/ $25"). When GEMINI_API_KEY is set in the server environment, each
// sweep asks Gemini to rewrite titles as clean product names and add a plain
// one-line summary. The original title is never changed (matching, dedup and
// price parsing all key off it); results land in deal.displayTitle and
// deal.aiSummary, which the page prefers when present.
//
// With no key, or on any AI error, this is a no-op and deals pass through
// untouched. Added 2026-11-22 at Daniel's direction (his paid Google AI key).

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview'; // Benchmarked 2026-11-22: ~3s per batch vs ~15-45s (and quota 429s) on gemini-3-flash-preview
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH_SIZE = 10;
const MAX_TITLES_PER_SWEEP = 240;
const SWEEP_BUDGET_MS = 150_000;

// Titles repeat across sweeps; cache by normalized raw title for the life of
// the process so repeat refreshes do not pay for the same cleanup twice.
const cache = new Map();

export function aiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function cacheKey(title) {
  return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// A cleaned title must still be about the same product: non-empty, sane
// length, and sharing at least one real word with the raw title.
function acceptable(original, cleaned) {
  if (!cleaned || typeof cleaned !== 'string') return false;
  const c = cleaned.trim();
  if (c.length < 3 || c.length > 140) return false;
  if (/\$|%|free shipping/i.test(c)) return false;
  const origWords = new Set(cacheKey(original).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const cleanWords = cacheKey(c).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return cleanWords.some((w) => origWords.has(w));
}

async function cleanBatch(titles, fetchImpl) {
  const list = titles.map((t, i) => `${i}. ${t}`).join('\n');
  const prompt = [
    'You clean up shopping deal post titles. For each numbered title, return the clean product name and a one-line summary.',
    'Rules for the product name: keep the brand, product line, model number and size/count when present. Remove prices, percent-off, shipping notes, store-cash or rewards mentions, coupon codes and hype words.',
    'Rules for the summary: one plain sentence, at most 18 words, saying what the item is and any useful included extra (for example "Earns $20 Kohl\'s Cash"). Never state a price or a percent off. If nothing extra is known, just describe the item plainly.',
    'Answer with a JSON array only, one object per title: [{"i":0,"title":"...","summary":"..."}]',
    '',
    list,
  ].join('\n');

  const res = await fetchImpl(`${API_BASE}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`gemini http ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('gemini reply was not an array');

  const out = new Map();
  for (const row of parsed) {
    const original = titles[row?.i];
    if (original === undefined) continue;
    if (!acceptable(original, row.title)) continue;
    const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
    out.set(cacheKey(original), {
      title: row.title.trim(),
      summary: summary && summary.length <= 200 && !/\$\s?\d/.test(summary) ? summary : '',
    });
  }
  return out;
}

/**
 * Fill displayTitle / aiSummary on deals that lack them. Mutates the deals.
 * Never throws: any failure leaves the deals exactly as they were.
 */
export async function cleanDealsWithAi(deals, { fetchImpl = fetch } = {}) {
  if (!aiEnabled() || !Array.isArray(deals) || deals.length === 0) return { cleaned: 0, enabled: aiEnabled() };

  const started = Date.now();
  let cleaned = 0;
  let lastError = null;
  let batchesOk = 0;
  let batchesFailed = 0;
  try {
    const wanted = new Map(); // cacheKey -> raw title
    for (const deal of deals) {
      if (deal.displayTitle || !deal.title) continue;
      const key = cacheKey(deal.title);
      if (cache.has(key)) {
        const hit = cache.get(key);
        deal.displayTitle = hit.title;
        if (hit.summary) deal.aiSummary = hit.summary;
        cleaned++;
      } else if (!wanted.has(key)) {
        wanted.set(key, deal.title);
      }
    }

    const pending = [...wanted.values()].slice(0, MAX_TITLES_PER_SWEEP);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let consecutiveFailures = 0;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (Date.now() - started > SWEEP_BUDGET_MS) break;
      if (consecutiveFailures >= 3) break; // Key or API is down; stop burning time.
      const batch = pending.slice(i, i + BATCH_SIZE);
      let results = null;
      try {
        results = await cleanBatch(batch, fetchImpl);
      } catch (err) {
        // A slow or throttled batch must not end the run (the first live
        // sweeps stopped after one batch). Wait, retry once, then move on.
        lastError = String(err?.message || err);
        await sleep(4000);
        try {
          results = await cleanBatch(batch, fetchImpl);
        } catch (err2) {
          lastError = String(err2?.message || err2);
          results = null;
        }
      }
      if (results) {
        batchesOk++;
        consecutiveFailures = 0;
        for (const [key, value] of results) cache.set(key, value);
      } else {
        batchesFailed++;
        consecutiveFailures++;
      }
      await sleep(800); // Light pacing between batches.
    }

    for (const deal of deals) {
      if (deal.displayTitle || !deal.title) continue;
      const hit = cache.get(cacheKey(deal.title));
      if (hit) {
        deal.displayTitle = hit.title;
        if (hit.summary) deal.aiSummary = hit.summary;
        cleaned++;
      }
    }
  } catch (err) {
    // AI is decoration here; the sweep must never fail because of it.
    lastError = String(err?.message || err);
  }
  const report = { cleaned, enabled: true, batchesOk, batchesFailed, lastError, elapsedMs: Date.now() - started };
  console.log('[bf-ai]', JSON.stringify(report));
  return report;
}
