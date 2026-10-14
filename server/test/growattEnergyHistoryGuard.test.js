import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const plant = { id: 'plant-1', timezone: 'America/La_Paz' };
const devices = [{ id: 'device-1', serial_number: 'MIN-1' }];

function powerRow(time, data) {
  return {
    interval_start: `${time.replace(' ', 'T')}.000Z`,
    timezone: 'America/La_Paz',
    raw_data: { devices: [{ device_id: 'device-1', serial_number: 'MIN-1', data: { time, ...data } }] },
  };
}

function energyRow(date, overrides = {}) {
  return {
    interval_start: `${date}T16:00:00.000Z`,
    timezone: 'America/La_Paz',
    generation_kwh: 1, consumption_kwh: 1, grid_import_kwh: 1, grid_export_kwh: 1,
    ...overrides,
  };
}

const full = { eacToday: 1, elocalLoadToday: 1, etoUserToday: 1, etoGridToday: 1 };

let powerRows = [];
let existingRows = [];
let upsertCalls = [];
let powerSyncCalls = 0;
let beforeUpsert = async () => {};
let rangeReads = [];

mock.module('../src/repositories/plantPowerIntervals.repository.js', {
  exports: { listPlantPowerIntervals: async () => powerRows },
});
mock.module('../src/repositories/devices.repository.js', {
  exports: {
    listActiveGrowattMinDevicesByPlant: async () => devices,
    listActiveGrowattMeterByPlant: async () => null,
  },
});
mock.module('../src/repositories/energyIntervals.repository.js', {
  exports: {
    listEnergyIntervalsRange: async (...args) => { rangeReads.push(args); return existingRows; },
    upsertEnergyIntervals: async rows => { await beforeUpsert(rows); upsertCalls.push(rows); },
  },
});
mock.module('../src/services/growattPowerHistory.service.js', {
  exports: { syncGrowattPowerHistory: async () => { powerSyncCalls += 1; throw new Error('provider download forbidden'); } },
});

const { syncGrowattEnergyHistory, syncGrowattEnergyRollups } = await import('../src/services/growattEnergyHistory.service.js');

function reset({ power, existing }) {
  powerRows = power;
  existingRows = existing;
  upsertCalls = [];
  powerSyncCalls = 0;
}

test('day writes and month/year rollups read committed predecessors without overlap', async () => {
  reset({ power: [powerRow('2026-09-14 16:00:00', full)], existing: [] });
  rangeReads = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  beforeUpsert = async rows => {
    if (rows[0]?.interval_type === 1) await gate;
    existingRows = rows;
  };
  try {
    const day = syncGrowattEnergyHistory(plant, '2026-09-14');
    await new Promise(resolve => setImmediate(resolve));
    const month = syncGrowattEnergyRollups(plant, 'month', '2026-09-01');
    const sameMonth = syncGrowattEnergyRollups(plant, 'month', '2026-09-30');
    const year = syncGrowattEnergyRollups(plant, 'year', '2026-09-14');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rangeReads.length, 1, 'rollups must wait for the day write');
    assert.equal(upsertCalls.length, 0);
    release();
    const [, monthly, joined] = await Promise.all([day, month, sameMonth, year]);
    assert.deepEqual(monthly, joined);
    assert.deepEqual(upsertCalls.map(rows => rows[0].interval_type), [1, 2, 3]);
    assert.equal(upsertCalls[2][0].generation_kwh, upsertCalls[0][0].generation_kwh);
  } finally {
    release();
    beforeUpsert = async () => {};
  }
});

test('12. existing parcial + derived all-null bloquea el upsert', async () => {
  reset({
    power: [powerRow('2026-09-14 06:00:00', {})],
    existing: [energyRow('2026-09-14')],
  });
  const result = await syncGrowattEnergyHistory(plant, '2026-09-14');
  assert.equal(result.skipped_degraded, true);
  assert.equal(result.upserted, 0);
  assert.equal(upsertCalls.length, 0);
  assert.equal(powerSyncCalls, 0);
});

test('13. derived con mas NULL que existing bloquea el upsert', async () => {
  reset({
    power: [
      powerRow('2026-09-14 06:00:00', full),
      powerRow('2026-09-14 06:05:00', { ...full, etoGridToday: null, etoUserToday: null }),
    ],
    existing: [energyRow('2026-09-14', { grid_export_kwh: null })],
  });
  const result = await syncGrowattEnergyHistory(plant, '2026-09-14');
  assert.equal(result.skipped_degraded, true);
  assert.equal(upsertCalls.length, 0);
});

test('14. derived con menos NULL permite el upsert', async () => {
  reset({
    power: [
      powerRow('2026-09-14 06:00:00', full),
      powerRow('2026-09-14 06:05:00', { eacToday: 2, elocalLoadToday: 2, etoUserToday: 2, etoGridToday: 2 }),
    ],
    existing: [energyRow('2026-09-14', { grid_export_kwh: null, grid_import_kwh: null })],
  });
  const result = await syncGrowattEnergyHistory(plant, '2026-09-14');
  assert.equal(result.skipped_degraded, false);
  assert.equal(result.upserted, 2);
  assert.equal(upsertCalls.length, 1);
});

test('15. misma cobertura permite el upsert', async () => {
  reset({
    power: [
      powerRow('2026-09-14 06:00:00', full),
      powerRow('2026-09-14 06:05:00', { ...full, etoGridToday: null }),
    ],
    existing: [energyRow('2026-09-14', { grid_export_kwh: null })],
  });
  const result = await syncGrowattEnergyHistory(plant, '2026-09-14');
  assert.equal(result.skipped_degraded, false);
  assert.equal(upsertCalls.length, 1);
});

test('16. sin existing rows permite el upsert', async () => {
  reset({
    power: [powerRow('2026-09-14 06:00:00', {})],
    existing: [],
  });
  const result = await syncGrowattEnergyHistory(plant, '2026-09-14');
  assert.equal(result.skipped_degraded, false);
  assert.equal(upsertCalls.length, 1);
});

test('17. skipped_degraded devuelve metadata suficiente', async () => {
  reset({
    power: [powerRow('2026-09-14 06:00:00', {})],
    existing: [energyRow('2026-09-14')],
  });
  const result = await syncGrowattEnergyHistory(plant, '2026-09-14');
  assert.equal(result.skipped_degraded, true);
  assert.equal(result.existing_nulls, 0);
  assert.equal(result.derived_nulls, 4);
  assert.equal(result.provider, 'growatt');
});

test('18. ningun bloqueo provoca escritura parcial ni descarga', async () => {
  reset({
    power: [powerRow('2026-09-14 06:00:00', {})],
    existing: [energyRow('2026-09-14'), energyRow('2026-09-14', { generation_kwh: null })],
  });
  const before = upsertCalls.length;
  const result = await syncGrowattEnergyHistory(plant, '2026-09-14');
  assert.equal(result.skipped_degraded, true);
  assert.equal(upsertCalls.length, before);
  assert.equal(powerSyncCalls, 0);
});
