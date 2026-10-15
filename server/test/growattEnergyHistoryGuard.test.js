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
let rollupTargets = new Map();
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
    listEnergyIntervalsRange: async (...args) => {
      rangeReads.push(args);
      const type = args[1];
      return type === 1 ? existingRows : (rollupTargets.get(type) ?? []);
    },
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
  rollupTargets = new Map();
}

test('day writes and month/year rollups read committed predecessors without overlap', async () => {
  reset({ power: [powerRow('2026-09-14 16:00:00', full)], existing: [] });
  rangeReads = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  beforeUpsert = async rows => {
    if (rows[0]?.interval_type === 1) await gate;
    existingRows = rows;
    // Espejo del mock type-aware: cada tipo solo ve lo escrito para ese tipo.
    if (rows[0]) rollupTargets.set(rows[0].interval_type, rows);
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

// H04-3: el rollup mensual ahora lee filas tipo 2 existentes y un bucket con
// menos evidencia NO sobrescribe el mes completo previo (regresión).
// Nota de contexto: coverage sale 'available' (no 'partial') para 1/30 días
// porque aggregateHistory solo marca partial dentro de las entradas presentes.
test('H04-3: rollup con menos sample_count conserva el mes completo (regresión)', async () => {
  // Fuente tipo 1: UN solo día observado del mes (14/30), con energía completa.
  const daySource = energyRow('2026-09-14', {
    generation_kwh: 10, consumption_kwh: 8, grid_import_kwh: 4.8, grid_export_kwh: 2,
  });
  reset({ power: [], existing: [daySource] });
  // Capturar el interval_start real del bucket mensual candidato.
  const warm = await syncGrowattEnergyRollups(plant, 'month', '2026-09-01');
  assert.equal(warm.upserted, 1);
  const candidate = upsertCalls[0][0];
  // Reejecutar con el mes tipo 2 ya completo (30 días) en el destino.
  reset({ power: [], existing: [daySource] });
  rollupTargets.set(2, [{
    plant_id: plant.id, interval_type: 2,
    interval_start: candidate.interval_start, timezone: 'UTC',
    generation_kwh: 300, consumption_kwh: 240, grid_import_kwh: 144, grid_export_kwh: 60,
    raw_data: { derived_from: 'energy_intervals.type_1', coverage: 'available', sample_count: 30 },
  }]);
  upsertCalls = [];
  rangeReads = [];
  const result = await syncGrowattEnergyRollups(plant, 'month', '2026-09-01');
  // Lectura de fuente tipo 1 Y destino tipo 2 (conjunto de tipos, orden libre).
  assert.deepEqual(new Set(rangeReads.map(read => read[1])), new Set([1, 2]));
  assert.equal(result.upserted, 0);
  assert.equal(upsertCalls.length, 0);
  assert.equal(result.skipped_degraded, true);
});

test('H04-3: corrección legítima con igual sample_count y menor energía se aplica', async () => {
  // Fuente tipo 1: un día con corrección a la baja (energía observada 5).
  const daySource = energyRow('2026-09-14', {
    generation_kwh: 5, consumption_kwh: 4, grid_import_kwh: 2, grid_export_kwh: 1,
  });
  reset({ power: [], existing: [daySource] });
  const warm = await syncGrowattEnergyRollups(plant, 'month', '2026-09-01');
  assert.equal(warm.upserted, 1);
  const candidate = upsertCalls[0][0];
  // Destino tipo 2: mes previo con el mismo conteo de muestras pero energía mayor.
  reset({ power: [], existing: [daySource] });
  rollupTargets.set(2, [{
    ...candidate,
    generation_kwh: 10, consumption_kwh: 8, grid_import_kwh: 4, grid_export_kwh: 2,
    raw_data: { ...candidate.raw_data, sample_count: 1 },
  }]);
  upsertCalls = [];
  const result = await syncGrowattEnergyRollups(plant, 'month', '2026-09-01');
  assert.equal(result.upserted, 1);
  assert.equal(result.skipped_degraded, false);
  assert.equal(upsertCalls[0][0].generation_kwh, 5);
});

test('H04-3 anual: rollup de año con menos sample_count conserva el año existente', async () => {
  const monthSource = energyRow('2026-09-01', { generation_kwh: 25 });
  reset({ power: [], existing: [monthSource] });
  rollupTargets.set(2, [monthSource]);
  // Capturar el bucket candidato real (mismo camino de código).
  const warm = await syncGrowattEnergyRollups(plant, 'year', '2026-09-14');
  assert.equal(warm.upserted, 1);
  const candidate = upsertCalls[0][0];
  // Reejecutar con un año tipo 3 existente completo (12 meses, más energía).
  reset({ power: [], existing: [monthSource] });
  rollupTargets.set(2, [monthSource]);
  rollupTargets.set(3, [{
    ...candidate,
    generation_kwh: candidate.generation_kwh + 100,
    grid_import_kwh: (candidate.grid_import_kwh ?? 0) + 50,
    grid_export_kwh: (candidate.grid_export_kwh ?? 0) + 30,
    raw_data: { ...candidate.raw_data, sample_count: 12 },
  }]);
  upsertCalls = [];
  const result = await syncGrowattEnergyRollups(plant, 'year', '2026-09-14');
  assert.equal(result.upserted, 0);
  assert.equal(result.skipped_degraded, true);
  assert.equal(upsertCalls.length, 0);
});

test('H04-3 legacy: sin sample_count en destino aplica protección por sumas', async () => {
  const daySource = energyRow('2026-09-14', { generation_kwh: 10 });
  reset({ power: [], existing: [daySource] });
  const warm = await syncGrowattEnergyRollups(plant, 'month', '2026-09-01');
  assert.equal(warm.upserted, 1);
  const candidate = upsertCalls[0][0];
  // Destino legacy: sin raw_data.sample_count y con generación mayor.
  reset({ power: [], existing: [daySource] });
  rollupTargets.set(2, [{
    ...candidate,
    generation_kwh: 300, consumption_kwh: 240, grid_import_kwh: 144, grid_export_kwh: 60,
    raw_data: { derived_from: 'energy_intervals.type_1', coverage: 'available' },
  }]);
  upsertCalls = [];
  const result = await syncGrowattEnergyRollups(plant, 'month', '2026-09-01');
  assert.equal(result.upserted, 0);
  assert.equal(result.skipped_degraded, true);
  assert.equal(upsertCalls.length, 0);
});
