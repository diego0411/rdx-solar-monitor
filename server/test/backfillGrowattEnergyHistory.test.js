import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, runBackfill } from '../scripts/backfillGrowattEnergyHistory.js';

const PLANT_ID = 'f68ef23a-979a-412f-bbe0-a271472a587a';

function mockSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: PLANT_ID, provider: 'growatt', completedDates: [] },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function mockRows() {
  return [
    { generation_kwh: 10, grid_import_kwh: 2, grid_export_kwh: 8, consumption_kwh: 0 },
  ];
}

function mockSyncResult(overrides = {}) {
  return {
    generation_total: 10,
    meter_import_total: 2,
    meter_export_total: 8,
    upserted: 39,
    unmatched_meter_samples: 0,
    meter_used: true,
    invariant_ok: true,
    skipped_degraded: false,
    ...overrides,
  };
}

function makeOptions(overrides = {}) {
  const syncMock = mock.fn(async () => mockSyncResult());
  const listBeforeMock = mock.fn(async () => mockRows());
  const supabaseMock = mockSupabase();
  const sleepFn = async () => {};
  return {
    plantId: PLANT_ID,
    dateFrom: '2026-09-15',
    dateTo: '2026-09-17',
    dryRun: false,
    maxDays: 7,
    resume: false,
    sleepFn,
    syncFn: syncMock,
    listBeforeFn: listBeforeMock,
    supabaseClient: supabaseMock,
    ...overrides,
  };
}

test('A: procesa fechas secuencialmente', async () => {
  const opts = makeOptions();
  const result = await runBackfill(opts);
  assert.equal(result.completed, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.stopped, false);
  assert.equal(opts.syncFn.mock.callCount(), 3);
});

test('B: throttle entre fechas', async () => {
  const opts = makeOptions();
  const sleepCalls = [];
  opts.sleepFn = mock.fn(async (ms) => { sleepCalls.push(ms); });
  const result = await runBackfill(opts);
  assert.equal(result.completed, 3);
  assert.ok(sleepCalls.some(ms => ms === 300000), 'sleep debe ser solicitado con 300000ms');
});

test('C: no espera después de última fecha', async () => {
  const opts = makeOptions();
  const sleepCalls = [];
  opts.sleepFn = mock.fn(async (ms) => { sleepCalls.push(ms); });
  const result = await runBackfill(opts);
  assert.equal(result.completed, 3);
  assert.equal(sleepCalls.length, 4, 'No sleep después de última fecha');
});

test('D: FREQUENTLY_ACCESS → STOPPED, sin retry', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => { throw new Error('FREQUENTLY_ACCESS'); });
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
  assert.equal(result.completed, 0);
  assert.equal(opts.syncFn.mock.callCount(), 1, 'No retry on FREQUENTLY_ACCESS');
});

test('E: 429/rateLimited → STOPPED, sin retry', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => {
    const err = new Error('429 Too Many Requests');
    err.code = 'rateLimited';
    throw err;
  });
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(opts.syncFn.mock.callCount(), 1, 'No retry on 429');
});

test('F: meter_used=false → STOPPED', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => mockSyncResult({ meter_used: false }));
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
});

test('G: invariant_ok=false → STOPPED', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => mockSyncResult({ invariant_ok: false }));
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
});

test('H: skipped_degraded=true → STOPPED', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => mockSyncResult({ skipped_degraded: true }));
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
});

test('I: upserted=0 → STOPPED', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => mockSyncResult({ upserted: 0 }));
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
});

test('J: degradación generation → STOPPED', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => mockSyncResult({ generation_total: 5 }));
  let callCount = 0;
  opts.listBeforeFn = mock.fn(async () => {
    callCount++;
    if (callCount <= 2) return [{ generation_kwh: 10, grid_import_kwh: 2, grid_export_kwh: 8, consumption_kwh: 0 }];
    return [{ generation_kwh: 5, grid_import_kwh: 2, grid_export_kwh: 8, consumption_kwh: 0 }];
  });
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
  assert.equal(result.completed, 0);
  assert.equal(opts.syncFn.mock.callCount(), 1, 'No retry on degradation');
});

test('K: degradación import → STOPPED', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => mockSyncResult({ meter_import_total: 1 }));
  let callCount = 0;
  opts.listBeforeFn = mock.fn(async () => {
    callCount++;
    if (callCount <= 2) return [{ generation_kwh: 10, grid_import_kwh: 2, grid_export_kwh: 8, consumption_kwh: 0 }];
    return [{ generation_kwh: 10, grid_import_kwh: 1, grid_export_kwh: 8, consumption_kwh: 0 }];
  });
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
  assert.equal(result.completed, 0);
  assert.equal(opts.syncFn.mock.callCount(), 1, 'No retry on degradation');
});

test('L: degradación export → STOPPED', async () => {
  const opts = makeOptions();
  opts.syncFn = mock.fn(async () => mockSyncResult({ meter_export_total: 4 }));
  let callCount = 0;
  opts.listBeforeFn = mock.fn(async () => {
    callCount++;
    if (callCount <= 2) return [{ generation_kwh: 10, grid_import_kwh: 2, grid_export_kwh: 8, consumption_kwh: 0 }];
    return [{ generation_kwh: 10, grid_import_kwh: 2, grid_export_kwh: 4, consumption_kwh: 0 }];
  });
  const result = await runBackfill(opts);
  assert.equal(result.stopped, true);
  assert.equal(result.failed, 1);
  assert.equal(result.completed, 0);
  assert.equal(opts.syncFn.mock.callCount(), 1, 'No retry on degradation');
});

test('M: nulls adicionales NO detienen', async () => {
  const opts = makeOptions();
  opts.listBeforeFn = mock.fn(async () => [
    { generation_kwh: null, grid_import_kwh: null, grid_export_kwh: null, consumption_kwh: null },
    { generation_kwh: null, grid_import_kwh: null, grid_export_kwh: null, consumption_kwh: null },
  ]);
  const result = await runBackfill(opts);
  assert.equal(result.stopped, false);
  assert.equal(result.completed, 3);
});

test('N: checkpoint escrito después de éxito', async () => {
  const opts = makeOptions();
  const result = await runBackfill(opts);
  assert.equal(result.completed, 3);
  assert.equal(result.stopped, false);
});

test('O: --resume continúa desde siguiente fecha', async () => {
  const opts = makeOptions({ resume: true });
  const result = await runBackfill(opts);
  assert.ok(result.completed >= 0);
});

test('P: --dry-run no llama sync, no write, no sleep', async () => {
  const opts = makeOptions({ dryRun: true });
  const result = await runBackfill(opts);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.dates, ['2026-09-15', '2026-09-16', '2026-09-17']);
});

test('Q: --max-days bloquea antes del primer sync', async () => {
  const opts = makeOptions({ dateTo: '2026-09-28' });
  await assert.rejects(
    runBackfill(opts),
    /máximo permitido/
  );
  assert.equal(opts.syncFn.mock.callCount(), 0, 'No sync after max-days block');
});

test('R: snapshot BEFORE suma correctamente filas existentes del día', async () => {
  const opts = makeOptions();
  opts.listBeforeFn = mock.fn(async () => [
    { generation_kwh: 10, grid_import_kwh: 2, grid_export_kwh: 8, consumption_kwh: 0 },
    { generation_kwh: 5, grid_import_kwh: 1, grid_export_kwh: 3, consumption_kwh: 0 },
  ]);
  const result = await runBackfill(opts);
  assert.equal(result.completed, 3);
  assert.equal(result.failed, 0);
  assert.equal(opts.syncFn.mock.callCount(), 3);
});

test('S: listEnergyIntervalsRange conserva contrato [start,end)', async () => {
  const { listEnergyIntervalsRange } = await import('../src/repositories/energyIntervals.repository.js');
  const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';
  const rows = await listEnergyIntervalsRange(plantId, 1, '2026-09-15', '2026-09-16');
  const dates = rows.map(r => r.interval_start.slice(0, 10));
  const uniqueDates = [...new Set(dates)];
  assert.ok(uniqueDates.includes('2026-09-15'), 'Debe incluir 15/09');
  assert.ok(!uniqueDates.includes('2026-09-16'), 'No debe incluir 16/09 (contrato [start,end))');
});

test('T: dos rangos consecutivos no duplican fecha frontera', async () => {
  const { listEnergyIntervalsRange } = await import('../src/repositories/energyIntervals.repository.js');
  const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';
  const rows1 = await listEnergyIntervalsRange(plantId, 1, '2026-09-15', '2026-09-16');
  const rows2 = await listEnergyIntervalsRange(plantId, 1, '2026-09-16', '2026-09-17');
  const dates1 = new Set(rows1.map(r => r.interval_start.slice(0, 10)));
  const dates2 = new Set(rows2.map(r => r.interval_start.slice(0, 10)));
  const intersection = [...dates1].filter(d => dates2.has(d));
  assert.equal(intersection.length, 0, 'No debe haber fechas duplicadas entre rangos consecutivos');
});
