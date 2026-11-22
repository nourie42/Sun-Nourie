#!/usr/bin/env node
/**
 * Autonomous Background Price Monitoring Worker (CLI / GitHub Actions Cron / Render Cron).
 * Runs completely independently of any open browser session.
 *
 * Usage:
 *   node scripts/black-friday-worker.mjs [--output <dir>] [--data-dir <dir>]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createBlackFridayStore } from '../src/black-friday/store.js';
import { createBlackFridayEngine } from '../src/black-friday/scheduler.js';
import { BLACK_FRIDAY_VERSION } from '../src/black-friday/constants.js';

function parseArgs(argv) {
  const args = { outputDir: null, dataDir: process.env.BLACK_FRIDAY_DATA_DIR };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--output' && argv[i + 1]) {
      args.outputDir = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--data-dir' && argv[i + 1]) {
      args.dataDir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const store = createBlackFridayStore({ dataDir: args.dataDir });
const engine = createBlackFridayEngine({ store, autoStart: false });

console.log(`[black-friday-worker] Starting autonomous sweep (v${BLACK_FRIDAY_VERSION}) at ${new Date().toISOString()}`);
const result = await engine.runMonitoringSweep({
  reason: 'scheduled_worker',
  workerSource: process.env.GITHUB_ACTIONS ? 'github_actions' : 'background_worker',
  createBackup: true,
});

const dash = engine.buildDashboardPayload();
console.log(JSON.stringify({
  ok: result.ok,
  at: result.at,
  durationMs: result.durationMs,
  okSources: result.okSources,
  failedSources: result.failedSources,
  dealsFetched: result.dealsFetched,
  totalActiveDeals: dash.kpis.totalActiveDeals,
  verified25PlusCount: dash.kpis.verified25PlusCount,
  observationsAdded: result.observationsAdded,
  alertsTriggered: result.alertsTriggered,
}, null, 2));

if (args.outputDir) {
  await fs.mkdir(args.outputDir, { recursive: true });
  const snapshot = {
    schemaVersion: 1,
    appVersion: BLACK_FRIDAY_VERSION,
    publishedAt: result.at,
    workerSource: process.env.GITHUB_ACTIONS ? 'github_actions' : 'background_worker',
    kpis: dash.kpis,
    deals: Object.values(store.getState().deals || {}),
    sourceHealth: store.getState().sourceHealth,
    cashbackRates: store.getState().cashbackRates,
  };
  await fs.writeFile(path.join(args.outputDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  await fs.writeFile(path.join(args.outputDir, 'source-health.json'), JSON.stringify(dash.sourceHealth, null, 2), 'utf8');
  await fs.writeFile(path.join(args.outputDir, 'worker-status.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`[black-friday-worker] Published verified snapshot to ${args.outputDir}`);
}

if (!result.ok) {
  console.error('[black-friday-worker] All sources failed in this cycle.');
  process.exitCode = 1;
}
