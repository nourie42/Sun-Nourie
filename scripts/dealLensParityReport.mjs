// Reports how the Deal Lens workbook engine treats the year-1 operator contribution (COOP!C29).
// Uses made-up round numbers only: no seller data. Output is numbers, no model text.
// Run with the mounted workbook file, or set DEAL_LENS_MODEL_FILE to a local package.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {readModelFile,isModelConfigured} from '../src/dealLensModelAssets.js';

const out = process.argv[2] || 'docs/deal-lens-parity-status.json';
function write(o) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(o, null, 2) + '\n');
  console.log(JSON.stringify(o, null, 2));
}
if (!isModelConfigured()) { console.log(JSON.stringify({status:'no-workbook',note:'The workbook file is not mounted here. No model key is required. The last verified report is preserved.'})); process.exit(0); }

try {
  const ctx = vm.createContext({ Intl, console, Blob, Buffer });
  ctx.window = ctx;
  for (const name of ['intake-state.js', 'model.js', 'original-model-data.js', 'original-engine.js', 'original-model.js']) {
    const src = name === 'original-model-data.js'
      ? readModelFile(name).toString('utf8')
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
  const baselineChanges={'COOP!C2':10,'COOP!B29':-9500000},baselineEngine=ctx.OriginalModel.compute(baselineChanges);
  const solveBaseline=cell=>{let lo=0,hi=3e7;for(let i=0;i<65;i++){const price=(lo+hi)/2,irr=ctx.OriginalModel.compute({...baselineChanges,'COOP!B29':-price}).get('COOP',cell);if(irr>.13)lo=price;else hi=price;}return (lo+hi)/2;};
  const baseline={source:ctx.OriginalModelData.source,sites:10,purchasePrice:9500000,irrB34:baselineEngine.get('COOP','B34'),irrB38:baselineEngine.get('COOP','B38'),priceAt13B34:solveBaseline('B34'),priceAt13B38:solveBaseline('B38')};
  baseline.matchesRequestedTargets=Math.abs(baseline.irrB34-.129075)<.000001&&Math.abs(baseline.irrB38-.12385)<.000002&&Math.abs(baseline.priceAt13B34-9443627)<1&&Math.abs(baseline.priceAt13B38-9089579)<1;
  const passed=baseline.matchesRequestedTargets&&Object.values(cases).every(c=>c.checks&&Object.values(c.checks).every(Boolean));
  write({ status: passed?'ok':'mismatch', generated: new Date().toISOString(), note: 'RomeoTest baseline plus synthetic contribution checks. No encryption key is used.',baseline, ...cases });
  if(!passed)process.exitCode=1;
} catch (err) {
  // Formula-engine errors can contain private formula text. Do not publish it.
  write({ status: 'error', message: 'Unable to verify the protected model. Check configuration and workbook compatibility privately.' });
  process.exitCode=1;
}
