import assert from 'node:assert/strict';
import test from 'node:test';

import { createScheduledSync } from '../src/services/scheduledSync.js';

const silentLogger = { info() {}, warn() {}, error() {} };

test('independent runners do not block each other', async () => {
  let releaseDevices;
  const devicesPending = new Promise(resolve => { releaseDevices = resolve; });
  let plantsRuns = 0;
  const runDevices = createScheduledSync({
    name: 'devices', sync: () => devicesPending, timeoutMs: 1000, logger: silentLogger,
  });
  const runPlants = createScheduledSync({
    name: 'plants', sync: async () => { plantsRuns += 1; }, timeoutMs: 1000, logger: silentLogger,
  });

  const pendingRun = runDevices();
  await runPlants();
  assert.equal(plantsRuns, 1);
  releaseDevices();
  await pendingRun;
});

test('a locked runner skips only itself', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const run = createScheduledSync({
    name: 'plants', sync: () => pending, timeoutMs: 1000, logger: silentLogger,
  });

  const first = run();
  assert.deepEqual(await run(), { skipped: true });
  release();
  await first;
});

test('timeout releases the lock and permits a retry', async () => {
  let attempts = 0;
  const run = createScheduledSync({
    name: 'plants',
    sync: () => ++attempts === 1 ? new Promise(() => {}) : Promise.resolve({ synced: 1 }),
    timeoutMs: 10,
    logger: silentLogger,
  });

  const timedOut = await run();
  assert.equal(timedOut.failed, true);
  assert.equal(timedOut.error.code, 'SYNC_TIMEOUT');
  assert.deepEqual(await run(), { synced: 1 });
});

test('error releases the lock and permits a retry', async () => {
  let attempts = 0;
  const run = createScheduledSync({
    name: 'plants',
    sync: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary failure');
      return { synced: 1 };
    },
    timeoutMs: 1000,
    logger: silentLogger,
  });

  const failed = await run();
  assert.equal(failed.failed, true);
  assert.deepEqual(await run(), { synced: 1 });
});
