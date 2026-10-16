const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const html = fs.readFileSync(require('node:path').join(__dirname, '../public/household-pl.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
new vm.Script(script); // Parse the complete production script, including DOM rendering.

function dashboard(base = {}, saved = {}, now = '2026-10-11T12:00:00Z', options = {}) {
  const nodes = new Map(), clock = { now };
  const stored = new Map([['nourie-household-pl-v3', options.rawSaved === undefined ? JSON.stringify(saved) : options.rawSaved]]);
  if (options.rawDeleted !== undefined) stored.set('nourie-household-pl-deleted-v3', options.rawDeleted);
  const storage = {
    getItem(key) { if (options.denyRead) throw new Error('Storage read denied'); return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { if (options.denyWrite) throw new Error('Storage write denied'); stored.set(key, value); },
    removeItem(key) { if (options.denyRemove) throw new Error('Storage removal denied'); stored.delete(key); },
  };
  const makeNode = () => {
    const children = [], selectors = new Map();
    return {
      innerHTML: '', textContent: '', value: '', children,
      classList: { contains: () => false }, querySelectorAll: () => [],
      querySelector(selector) { if (!selectors.has(selector)) selectors.set(selector, makeNode()); return selectors.get(selector); },
      appendChild(child) { children.push(child); },
    };
  };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, makeNode());
    return nodes.get(id);
  };
  const context = vm.createContext({
    __HOUSEHOLD_PL_DATA__: structuredClone(base), Intl, structuredClone,
    fetch() { throw new Error('Snapshot initialization must not fetch'); },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } },
    document: { getElementById: node, createElement: makeNode, querySelector: node, querySelectorAll: selector => selector === '.updateStatus' ? [node('updateStatus'), node('yearUpdateStatus')] : [] },
    localStorage: storage,
    setTimeout() { return 0; },
    window: { addEventListener() {} }, console,
  });
  const instrumented = script
    .replace('\n renderAll();\n})', '\n renderAll();\n globalThis.result={BASE,periods,rows,monthEdits,monthVal,setMonth,setMonthlyAll,setAnnual,forecastAnnual,snapshotBudget,makeTxList,snapshotDate,completedWeeksInfo,txAmountBetweenRows,renderSnapshotLabels,saveAndRender,startCash};\n})');
  vm.runInContext(instrumented, context);
  assert.ok(context.result, 'Dashboard initialization reached test seam');
  return { ...context.result, nodes, stored, setNow(value) { clock.now = value; } };
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


test('the real loader initializes snapshot data without fetch or browser gzip APIs', () => {
  const d = dashboard({ actualMonth: '2026-10', asOf: '2026-10-15', startingCash: 0, rows: [line()], tx: [{ d: '2026-10-15', s: 'Posted', k: 'INCOME', v: 123, m: 'Posted income' }] });
  assert.equal(d.BASE.rows[0].vals[1], 100);
  assert.equal(d.nodes.get('ki').textContent, '$100');
  assert.ok(d.nodes.get('quickBody').children.length > 0);
  assert.match(d.nodes.get('yearHead').innerHTML, /Oct 26/);
  assert.equal(d.snapshotDate(), '2026-10-15');
  assert.match(d.makeTxList(d.rows[0]), /Posted income/);
  assert.equal(d.startCash, 0);
});

test('the loader rejects compressed strings and malformed snapshot objects explicitly', () => {
  const prefix = script.slice(0, script.indexOf('// Snapshot vals:'));
  for (const invalid of ['H4sI...', null, [], {}, { rows: [], tx: {} }]) {
    const context = vm.createContext({ __HOUSEHOLD_PL_DATA__: invalid });
    vm.runInContext(prefix + '\nglobalThis.loadSnapshot=loadBase;', context);
    assert.throws(() => context.loadSnapshot(), /snapshot is unavailable/);
  }
});


test('manual monthly amount changes remain the baseline after future rollover', () => {
  const manual = { ...line(10003), manual: true, timing: 'Expected monthly', vals: [0, 0, ...Array(12).fill(75)] };
  const d = dashboard({ period: '2026-10', budgetStartMonth: '2026-10', rows: [], tx: [] }, { manualRows: [manual] });
  d.setMonthlyAll(d.rows[0], 120);
  assert.equal(d.rows[0].monthlyAmount, 120);
  const rolled = dashboard({ period: '2027-10', budgetStartMonth: '2027-10', rows: [], tx: [] }, { manualRows: d.rows, monthEdits: d.monthEdits, budgetStartMonth: '2026-10' });
  assert.equal(rolled.monthVal(rolled.rows[0], 0), 120);
  rolled.setAnnual(rolled.rows[0], 2400);
  assert.equal(rolled.rows[0].monthlyAmount, 200);
  const rolledAgain = dashboard({ period: '2028-10', budgetStartMonth: '2028-10', rows: [], tx: [] }, { manualRows: rolled.rows, monthEdits: rolled.monthEdits, budgetStartMonth: '2027-10' });
  assert.equal(rolledAgain.monthVal(rolledAgain.rows[0], 0), 200);
});


test('malformed saved JSON renders defaults and cannot overwrite the unreadable saved values', () => {
  const raw = '{broken saved budget';
  const d = dashboard({ period: '2026-10', rows: [line()], tx: [] }, {}, undefined, { rawSaved: raw });
  assert.equal(d.nodes.get('ki').textContent, '$100');
  assert.equal(d.monthVal(d.rows[0], 0), 10);
  assert.equal(d.nodes.get('storageWarning').hidden, false);
  assert.match(d.nodes.get('storageWarning').textContent, /Saved budgets could not be read/);
  assert.equal(d.saveAndRender(), false);
  assert.equal(d.stored.get('nourie-household-pl-v3'), raw);
  assert.equal(d.nodes.get('updateStatus').textContent, 'Budgets could not be saved');
  // Reset is an explicit user action, so it may remove the unreadable saved values.
  d.nodes.get('reset').onclick();
  assert.equal(d.stored.has('nourie-household-pl-v3'), false);
  assert.equal(d.saveAndRender(), true);
});

test('invalid saved shapes never prevent startup or replace the original saved values', () => {
  const cases = [{ manualRows: {} }, { monthEdits: [] }, { monthEdits: { '1-0': {} } }, { startingCash: {} }, { budgetStartMonth: 'invalid' }, { manualRows: [{ ...line(10004), vals: null }] }];
  for (const saved of cases) {
    const raw = JSON.stringify(saved);
    const d = dashboard({ period: '2026-10', rows: [line()], tx: [] }, saved);
    assert.equal(d.nodes.get('ki').textContent, '$100');
    assert.equal(d.saveAndRender(), false);
    assert.equal(d.stored.get('nourie-household-pl-v3'), raw);
    assert.match(d.nodes.get('storageWarning').textContent, /Saving is blocked/);
  }
});

test('denied storage reads use defaults and every save or reset failure is visible', () => {
  const d = dashboard({ period: '2026-10', startingCash: 0, rows: [line()], tx: [] }, { monthEdits: { '1-0': 99 } }, undefined, { denyRead: true, denyRemove: true });
  assert.equal(d.startCash, 0);
  assert.equal(d.monthVal(d.rows[0], 0), 10);
  const original = d.stored.get('nourie-household-pl-v3');
  assert.equal(d.saveAndRender(), false);
  assert.doesNotThrow(() => d.nodes.get('reset').onclick());
  assert.doesNotThrow(() => d.nodes.get('restore').onclick());
  assert.equal(d.stored.get('nourie-household-pl-v3'), original);
  assert.equal(d.nodes.get('storageWarning').hidden, false);
  assert.match(d.nodes.get('storageWarning').textContent, /could not reset saved values/);
});

test('denied writes preserve valid saved budgets and never claim a successful save', () => {
  const saved = { monthEdits: { '1-0': 99 }, startingCash: 0 };
  const d = dashboard({ period: '2026-10', rows: [line()], tx: [] }, saved, undefined, { denyWrite: true });
  assert.equal(d.monthVal(d.rows[0], 0), 99);
  d.setMonth(d.rows[0], 0, 112);
  assert.equal(d.saveAndRender(), false);
  assert.equal(d.monthVal(d.rows[0], 0), 112);
  assert.equal(d.stored.get('nourie-household-pl-v3'), JSON.stringify(saved));
  assert.match(d.nodes.get('storageWarning').textContent, /could not save your budget changes/);
  assert.doesNotMatch(d.nodes.get('updateStatus').textContent, /Budgets saved/);
});

test('invalid deleted-row state and denied deletion writes preserve rows', () => {
  const d = dashboard({ period: '2026-10', rows: [line()], tx: [] }, {}, undefined, { rawDeleted: '{"invalid":true}' });
  assert.equal(d.nodes.get('quickBody').children.length, 1);
  d.nodes.get('quickBody').children[0].querySelector('.deleteBtn').onclick();
  assert.equal(d.stored.get('nourie-household-pl-deleted-v3'), '{"invalid":true}');
  assert.match(d.nodes.get('storageWarning').textContent, /Saved row selections could not be read/);
  const denied = dashboard({ period: '2026-10', rows: [line()], tx: [] }, {}, undefined, { denyWrite: true });
  assert.doesNotThrow(() => denied.nodes.get('quickBody').children[0].querySelector('.deleteBtn').onclick());
  assert.equal(denied.stored.has('nourie-household-pl-deleted-v3'), false);
  assert.match(denied.nodes.get('storageWarning').textContent, /No rows were changed/);
});

test('valid saved state remains editable and persists through the guarded writer', () => {
  const d = dashboard({ period: '2026-10', rows: [line()], tx: [] }, { monthEdits: { '1-0': 99 }, startingCash: 0 });
  d.setMonth(d.rows[0], 1, 123);
  assert.equal(d.saveAndRender(), true);
  const saved = JSON.parse(d.stored.get('nourie-household-pl-v3'));
  assert.equal(saved.monthEdits['1-2026-09'], 99);
  assert.equal(saved.monthEdits['1-2026-10'], 123);
  assert.equal(saved.startingCash, 0);
  assert.equal(d.nodes.get('storageWarning').textContent, '');
});

test('freshness rendering recomputes the calendar month for a tab left open across rollover', () => {
  const d = dashboard({ period: '2026-09', asOf: '2026-09-30', rows: [line()], tx: [] }, {}, '2026-09-30T12:00:00Z');
  assert.doesNotMatch(d.nodes.get('snapshotFreshness').textContent, /October/);
  d.setNow('2026-10-16T12:00:00Z');
  d.renderSnapshotLabels();
  assert.match(d.nodes.get('snapshotFreshness').textContent, /October 2026 data has not refreshed/);
});
