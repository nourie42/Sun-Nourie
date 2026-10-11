const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const html = fs.readFileSync(require('node:path').join(__dirname, '../public/household-pl.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
new vm.Script(script); // Parse the complete production script, including DOM rendering.

function dashboard(base = {}, saved = {}, now = '2026-10-11T12:00:00Z') {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', classList: { contains: () => false }, querySelectorAll: () => [] });
    return nodes.get(id);
  };
  const context = vm.createContext({
    __HOUSEHOLD_PL_DATA__: '', TEST_BASE: structuredClone(base), Intl, structuredClone,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
    document: { getElementById: node, querySelector: node, querySelectorAll: () => [] },
    localStorage: { getItem: key => key === 'nourie-household-pl-v3' ? JSON.stringify(saved) : null },
    window: { addEventListener() {} }, console,
  });
  const instrumented = script
    .replace('const BASE=await loadBase(),periods=', 'const BASE=TEST_BASE,periods=')
    .replace('\n renderAll();\n})', '\n globalThis.result={BASE,periods,rows,monthEdits,monthVal,setMonth,forecastAnnual,snapshotBudget,makeTxList,snapshotDate,completedWeeksInfo,txAmountBetweenRows,renderSnapshotLabels,startCash};\n})');
  vm.runInContext(instrumented, context);
  assert.ok(context.result, 'Dashboard initialization reached test seam');
  return { ...context.result, nodes };
}
const line = (row = 1) => ({ row, type: 'line', label: 'Income', kind: 'income', vals: [20, 100, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], keys: ['INCOME'] });

test('legacy snapshot stays September and displays a visible October freshness warning', () => {
  const d = dashboard({ rows: [line()], asOf: '2026-09-30', tx: [] });
  assert.equal(d.periods.actualMonth, '2026-09');
  assert.equal(d.periods.previousMonth, '2026-08');
  assert.equal(d.periods.months[0], '2026-09');
  d.renderSnapshotLabels();
  assert.match(d.nodes.get('snapshotFreshness').textContent, /October 2026 data has not refreshed; showing the September 2026 snapshot/);
  assert.equal(d.nodes.get('incomeLabel').textContent, 'September 2026 Income');
  assert.equal(d.nodes.get('lastPeriod').textContent, 'August 2026');
  assert.equal(d.completedWeeksInfo().month, 8);
});

test('October actuals use the matching budget month and do not receive September corrections', () => {
  const r = line(37), d = dashboard({ actualMonth: '2026-10', budgetStartMonth: '2026-09', rows: [r], asOf: '2026-10-10', tx: [] });
  assert.equal(d.BASE.rows[0].vals[1], 100);
  assert.equal(d.BASE.tx.length, 0);
  assert.equal(d.periods.actualIndex, 1);
  assert.equal(d.snapshotBudget(d.rows[0]), 20);
  assert.equal(d.forecastAnnual(d.rows[0]), 860); // All 12 budgets, replacing October's 20 with actual 100.
});

test('saved legacy edits retain their absolute September and October dates after January rollover', () => {
  const d = dashboard({ period: '2027-01', budgetStartMonth: '2027-01', rows: [line()], tx: [] }, { monthEdits: { '1-0': 900, '1-1': 800, '1-4': 700 } });
  assert.equal(d.monthEdits['1-2026-09'], 900);
  assert.equal(d.monthEdits['1-2026-10'], 800);
  assert.equal(d.monthVal(d.rows[0], 0), 700);
  assert.equal(d.periods.months[11], '2027-12');
  d.setMonth(d.rows[0], 1, 321);
  assert.equal(d.monthEdits['1-2027-02'], 321);
});

test('saved absolute edits and manual one-time rows never shift or repeat annually', () => {
  const manual = { ...line(10001), manual: true, vals: [0, 0, 75, ...Array(11).fill(0)], budgetStartMonth: '2026-09', frequency: 'one-time' };
  const d = dashboard({ period: '2027-09', budgetStartMonth: '2027-09', rows: [], tx: [] }, { monthEdits: { '10001-2026-09': 99 }, manualRows: [manual] });
  assert.equal(d.monthVal(d.rows[0], 0), 0);
  assert.equal(d.monthEdits['10001-2026-09'], 99);
});

test('drilldowns use snapshot period and exclude pending transactions', () => {
  const d = dashboard({ period: '2026-10', rows: [line()], asOf: '2026-10-10', tx: [
    { d: '2026-09-29', s: 'Posted', k: 'INCOME', v: 7, m: 'September' },
    { d: '2026-10-02', s: 'Posted', k: 'INCOME', v: 8, m: 'October posted' },
    { d: '2026-10-03', s: 'Pending', k: 'INCOME', v: 9, m: 'October pending' },
  ] });
  const list = d.makeTxList(d.rows[0]);
  assert.match(list, /October posted/);
  assert.doesNotMatch(list, /September|October pending/);
  assert.equal(d.txAmountBetweenRows(d.rows, '2026-01-01', '2026-10-10'), 15);
});


test('same-month data older than seven days warns and displays incomplete coverage', () => {
  const d = dashboard({ period: '2026-10', asOf: '2026-10-02', refreshedAt: '2026-10-02T00:00:00Z', coverageNotes: ['Missing checking account.', 'Totals are partial.'], startingCash: 0, rows: [], tx: [] });
  d.renderSnapshotLabels();
  assert.match(d.nodes.get('snapshotFreshness').textContent, /Weekly refresh overdue/);
  assert.match(d.nodes.get('snapshotFreshness').textContent, /Missing checking account. Totals are partial./);
  assert.equal(d.startCash, 0);
});

test('legacy manual monthly rows continue when their source budget year rolls', () => {
  const manual = { ...line(10002), manual: true, timing: 'Expected monthly', vals: [0, 0, ...Array(12).fill(75)] };
  const d = dashboard({ period: '2026-10', budgetStartMonth: '2026-10', rows: [], tx: [] }, { manualRows: [manual] });
  assert.equal(d.monthVal(d.rows[0], 11), 75);
  assert.equal(d.rows[0].frequency, 'monthly');
});

test('explicit September source metadata prevents legacy transaction injections', () => {
  const d = dashboard({ period: '2026-09', asOf: '2026-09-10', rows: [line(37)], tx: [] });
  assert.equal(d.BASE.rows[0].vals[1], 100);
  assert.equal(d.BASE.tx.length, 0);
});
