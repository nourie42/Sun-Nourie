// Reports how the Deal Lens workbook engine treats the year-1 operator contribution (COOP!C29).
// Uses made-up round numbers only: no seller data. Output is numbers, no model text.
// Run: DEAL_LENS_MODEL_KEY=<key> node scripts/dealLensParityReport.mjs [output.json]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createDecipheriv } from 'node:crypto';

// Same decryption as src/dealLensRoutes.js, repeated here so this script needs no npm packages.
function readProtectedModelFile(name, key64) {
  const key = Buffer.from(key64 || '', 'base64');
  if (key.length !== 32) throw Error('Original model key is not configured.');
  const payload = fs.readFileSync(path.join('data/deal-lens', name + '.enc'));
  if (payload.subarray(0, 5).toString() !== 'DLME1') throw Error('Invalid model asset.');
  const d = createDecipheriv('aes-256-gcm', key, payload.subarray(5, 17));
  d.setAAD(Buffer.from(name)); d.setAuthTag(payload.subarray(17, 33));
  return Buffer.concat([d.update(payload.subarray(33)), d.final()]);
}

const out = process.argv[2] || 'docs/deal-lens-parity-status.json';
const modelKey = process.env.DEAL_LENS_MODEL_KEY;
function write(o) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(o, null, 2) + '\n');
  console.log(JSON.stringify(o, null, 2));
}
if (!modelKey) { write({ status: 'no-key', note: 'DEAL_LENS_MODEL_KEY is not set, so the model cannot be opened.' }); process.exit(0); }

try {
  const ctx = vm.createContext({ Intl, console, Blob, Buffer });
  ctx.window = ctx;
  for (const name of ['intake-state.js', 'model.js', 'original-model-data.js', 'original-engine.js', 'original-model.js']) {
    const src = name === 'original-model-data.js'
      ? readProtectedModelFile(name, modelKey).toString('utf8')
      : fs.readFileSync('public/deal-lens/' + name, 'utf8');
    vm.runInContext(src, ctx);
  }
  const r6 = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x ?? null);
  function run(sites) {
    const deal = { id: 'parity', fields: { name: 'Synthetic parity check' },
      originalInputs: { price: '9.5m', sites, gallons: '11m', fuelMargin: 37, inside: '8m', insideMargin: 30, otherIncome: '500k', opex: '6.8m', rent: 100000 } };
    const m = ctx.OriginalModel.calculate(deal);
    if (!m.result) return { sites, errors: m.errors };
    const g = (s, c) => m.result.engine.get(s, c);
    const y1 = {}; for (const row of [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32]) y1['C' + row] = r6(g('COOP', 'C' + row));
    const sum2331 = [23, 24, 25, 26, 27, 28, 29, 30, 31].reduce((a, r) => a + Number(g('COOP', 'C' + r) || 0), 0);
    return {
      sites,
      operatorPerSiteInput: r6(m.items.operatorPerSite?.value),
      year1: y1,
      year15: { Q29_exit: r6(g('COOP', 'Q29')), Q32: r6(g('COOP', 'Q32')) },
      year0: { B28: r6(g('COOP', 'B28')), B29: r6(g('COOP', 'B29')), B31: r6(g('COOP', 'B31')), B32: r6(g('COOP', 'B32')) },
      irr: { COOP_B34: r6(g('COOP', 'B34')), COOP_B38: r6(g('COOP', 'B38')), Combined_B7: r6(g('Combined', 'B7')) },
      checks: {
        draw_is_minus_50k_per_site: Math.abs(Number(g('COOP', 'C18')) + 50000 * sites) < 0.01,
        year1_contribution_present: Number(g('COOP', 'C29') || 0) !== 0,
        year1_contribution_is_plus_50k_per_site: Math.abs(Number(g('COOP', 'C29')) - 50000 * sites) < 0.01,
        year1_flow_includes_contribution: Math.abs(Number(g('COOP', 'C32')) - (Number(g('COOP', 'C22')) + sum2331)) < 0.01,
      },
    };
  }
  write({ status: 'ok', generated: new Date().toISOString(), note: 'Synthetic inputs only.', ten_sites: run(10), four_sites: run(4) });
} catch (err) {
  write({ status: 'error', message: String(err && err.message || err).slice(0, 300) });
}
