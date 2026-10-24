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
  function run(sites, operatorPerSite=50000) {
    const deal = { id: 'parity', fields: { name: 'Synthetic parity check' },
      originalInputs: { price: '9.5m', sites, operatorPerSite, gallons: '11m', fuelMargin: 37, inside: '8m', insideMargin: 30, otherIncome: '500k', opex: '6.8m', rent: 100000 } };
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
      return_bases: Object.fromEntries(Object.values(m.result.returnCases).map(b=>[b.cell,{label:b.label,irr:r6(b.irr),price_at_13_percent:r6(b.maxPrice),npv_at_13_percent:r6(b.npv)}])),
      display: { year1_contribution:m.result.years[0].contribution, year1_exit:m.result.years[0].exit, year15_exit:m.result.years[14].exit },
      checks: {
        c29_formula_is_minus_c18: String(ctx.OriginalModelData.sheets.COOP.C29?.f||'').replace(/[\s$]/g,'').toUpperCase()==='=-C18',
        draw_matches_operator_input: Math.abs(Number(g('COOP', 'C18')) + operatorPerSite * sites) < 0.01,
        year1_contribution_matches_operator_input: Math.abs(Number(g('COOP', 'C29')) - operatorPerSite * sites) < 0.01,
        year1_flow_includes_contribution: Math.abs(Number(g('COOP', 'C32')) - (Number(g('COOP', 'C22')) + sum2331)) < 0.01,
        lease_flow_includes_contribution: Math.abs(Number(g('COOP', 'C37')) - (Number(g('COOP', 'C20')) + sum2331)) < 0.01,
        display_contribution_matches_cell: m.result.years[0].contribution===g('COOP','C29'),
        contribution_only_in_year1: m.result.years.slice(1).every(y=>y.contribution===0),
        exit_only_in_year15: m.result.years.slice(0,14).every(y=>y.exit===0)&&m.result.years[14].exit===g('COOP','Q29'),
        prices_solve_their_own_basis: Object.entries(m.result.returnCases).every(([cell,b])=>b.maxPrice!=null&&Math.abs(ctx.OriginalModel.compute({...m.changes,'COOP!B29':-b.maxPrice}).get('COOP',cell)-.13)<1e-7),
      },
    };
  }
  const cases={ten_sites:run(10),four_sites:run(4),zero_addback:run(10,0),custom_addback:run(10,25000)};
  const passed=Object.values(cases).every(c=>c.checks&&Object.values(c.checks).every(Boolean));
  write({ status: passed?'ok':'mismatch', generated: new Date().toISOString(), note: 'Synthetic inputs only. These inputs do not establish parity with an unprovided RomeoTest baseline.', ...cases });
  if(!passed)process.exitCode=1;
} catch (err) {
  // Formula-engine errors can contain private formula text. Do not publish it.
  write({ status: 'error', message: 'Unable to verify the protected model. Check configuration and workbook compatibility privately.' });
  process.exitCode=1;
}
