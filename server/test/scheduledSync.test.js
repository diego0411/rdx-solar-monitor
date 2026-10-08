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

function recordingLogger() {
  const calls = { info: [], warn: [], error: [] };
  return {
    calls,
    info: (...args) => { calls.info.push(args); },
    warn: (...args) => { calls.warn.push(args); },
    error: (...args) => { calls.error.push(args); },
  };
}

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

function warnRunner(sync, warnAfterMs = 30) {
  const logger = recordingLogger();
  const run = createScheduledSync({ name: 'history-rollups', sync, warnAfterMs, logger });
  return { run, calls: logger.calls };
}

test('warn mode: job under threshold finishes without warning', async () => {
  const { run, calls } = warnRunner(async () => ({ rolled: 2 }));
  assert.deepEqual(await run(), { rolled: 2 });
  assert.equal(calls.warn.length, 0);
  assert.equal(calls.info.length, 2);
  assert.match(calls.info[0][0], /started/);
  assert.match(calls.info[1][0], /finished/);
  // Control liberado: la siguiente ejecución corre.
  assert.deepEqual(await run(), { rolled: 2 });
});

test('warn mode: job over threshold warns once then reports real finish', async () => {
  const { run, calls } = warnRunner(async () => { await sleep(80); return { rolled: 2 }; }, 20);
  const result = await run();
  assert.deepEqual(result, { rolled: 2 });
  assert.equal(calls.warn.length, 1);
  assert.match(calls.warn[0][0], /still running after 20 ms/);
  assert.equal(calls.info.length, 2);
  assert.match(calls.info[1][0], /finished/);
  assert.equal(calls.error.length, 0);
});

test('warn mode: second trigger while running is skipped, no overlap', async () => {
  let runs = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { run, calls } = warnRunner(async () => { runs += 1; await gate; return { rolled: 1 }; }, 20);
  const thresholdWarns = () => calls.warn.filter(args => /still running after/.test(args[0]));
  const first = run();
  assert.deepEqual(await run(), { skipped: true });
  await sleep(40);
  assert.deepEqual(await run(), { skipped: true });
  release();
  assert.deepEqual(await first, { rolled: 1 });
  assert.equal(runs, 1);
  assert.equal(thresholdWarns().length, 1);
  assert.match(thresholdWarns()[0][0], /still running after 20 ms/);
  assert.deepEqual(await run(), { rolled: 1 });
  assert.equal(runs, 2);
});

test('warn mode: failure after threshold warns once then reports failure', async () => {
  const { run, calls } = warnRunner(async () => {
    await sleep(60);
    throw new Error('late failure');
  }, 15);
  const result = await run();
  assert.equal(result.failed, true);
  assert.equal(result.error.message, 'late failure');
  assert.equal(calls.warn.length, 1);
  assert.equal(calls.error.length, 1);
  assert.match(calls.error[0][0], /sync failed/);
  // Control liberado tras el fallo real: reintento permitido.
  assert.equal((await run()).failed, true);
});

test('warn mode: synchronous throw is handled, never unhandled', async () => {
  const { run, calls } = warnRunner(() => { throw new Error('sync boom'); }, 1000);
  const result = await run();
  assert.equal(result.failed, true);
  assert.equal(calls.warn.length, 0);
  assert.equal(calls.error.length, 1);
});

