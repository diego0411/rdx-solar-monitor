import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// IMPORTANTE: sin imports estáticos de código bajo mock. mock.module no
// reconecta módulos ya cargados: todo lo mockeado se importa dinámicamente
// DESPUÉS de registrar los mocks para que la cadena use los dobles.
// Sin llamadas reales HYXi ni BD: proveedor y repositorios están mockeados.

const PLANT_ID = '22222222-2222-2222-2222-222222222222';
const EXT_ID = 'hyxi-ext-casa-blanco';
const TZ = 'America/La_Paz';
const DATE = '2026-10-05';

let historyImpl = async () => ({ points: [], timeZone: TZ });
let existingImpl = async () => [];
let upsertCalls = [];
let upsertImpl = async rows => { upsertCalls.push(rows); };

class FakeHyxiProvider {
  async getPlantEnergyHistory(...args) {
    return historyImpl(...args);
  }
}

mock.module('../src/providers/hyxi/HyxiProvider.js', {
  namedExports: { HyxiProvider: FakeHyxiProvider },
});
mock.module('../src/repositories/energyIntervals.repository.js', {
  namedExports: {
    resolveHyxiPlant: async () => PLANT_ID,
    upsertEnergyIntervals: async rows => upsertImpl(rows),
    listEnergyIntervalsRange: async (...args) => existingImpl(...args),
  },
});
mock.module('../src/repositories/plantPowerIntervals.repository.js', {
  namedExports: { listPlantPowerIntervals: async () => [] },
});
mock.module('../src/services/growattEnergyHistory.service.js', {
  namedExports: { syncGrowattEnergyHistory: async () => ({ fetched: 0, upserted: 0, failed: 0 }) },
});

const { syncHyxiEnergyHistory } = await import('../src/services/hyxiEnergyHistory.service.js');
const { runEnergyBackfill } = await import('../src/services/energyBackfill.service.js');

function reset() {
  historyImpl = async () => ({ points: [], timeZone: TZ });
  existingImpl = async () => [];
  upsertCalls = [];
  upsertImpl = async rows => { upsertCalls.push(rows); };
}

// Punto manufacturer tal como lo entrega normalizeHyxiEnergyHistory.
const point = (time, values, raw = { timePoint: 1 }) => ({
  timestamp: `${time}.000Z`,
  timezone: TZ,
  generation_kwh: values[0],
  consumption_kwh: values[1],
  battery_charge_kwh: null,
  battery_discharge_kwh: null,
  grid_import_kwh: values[2],
  grid_export_kwh: values[3],
  raw_data: raw,
});

// Fila tal como la devuelve listEnergyIntervalsRange (ENERGY_RANGE_COLUMNS):
// SIN plant_id, SIN interval_type, SIN campos de batería.
const existingRow = (time, values, raw = { timePoint: 1 }) => ({
  interval_start: `${time}.000Z`,
  timezone: TZ,
  generation_kwh: values[0],
  consumption_kwh: values[1],
  grid_import_kwh: values[2],
  grid_export_kwh: values[3],
  provider: 'hyxi',
  updated_at: '2026-10-04T20:00:00.000Z',
  raw_data: raw,
});

function instantAt(index) {
  const base = Date.UTC(2026, 9, 5, 4, 0, 0) + index * 5 * 60 * 1000;
  return new Date(base).toISOString().slice(0, 19);
}

function valuesAt(index) {
  return [30 + index, 20 + index, 3 + (index % 5), 27 - (index % 3)];
}

test('1. 152 existentes completos + 152 candidatos equivalentes: éxito sin upsert', async () => {
  reset();
  const points = [];
  const existing = [];
  for (let index = 0; index < 152; index += 1) {
    const time = instantAt(index);
    const values = valuesAt(index);
    points.push(point(time, values));
    existing.push(existingRow(time, values));
  }
  historyImpl = async () => ({ points, timeZone: TZ });
  existingImpl = async () => existing;

  const result = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  assert.equal(result.fetched, 152);
  assert.equal(result.upserted, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.merge.unchanged, 152);
  // unchanged no genera escritura: el upsert nunca se ejecuta.
  assert.equal(upsertCalls.length, 0);
});

test('2. caso producción vía backfill: 152/152 unchanged clasifica completed', async () => {
  reset();
  const points = [];
  const existing = [];
  for (let index = 0; index < 152; index += 1) {
    const time = instantAt(index);
    const values = valuesAt(index);
    points.push(point(time, values));
    existing.push(existingRow(time, values));
  }
  historyImpl = async () => ({ points, timeZone: TZ });
  existingImpl = async () => existing;

  const outcome = await runEnergyBackfill({
    plant: { id: PLANT_ID, provider: 'hyxi', external_plant_id: EXT_ID },
    dates: [DATE],
    observeDay: async () => ({ rows: 152, nullFields: 0 }),
    syncHyxiDay: (externalId, date) => syncHyxiEnergyHistory(externalId, 1, date),
    syncGrowattDay: async () => ({ fetched: 0, upserted: 0, failed: 0 }),
  });

  assert.equal(outcome.days[0].status, 'completed');
  assert.deepEqual(outcome.summary, {
    requested: 1, completed: 1, no_manufacturer_data: 0, skipped_degraded: 0, failed: 0,
  });
  assert.equal(upsertCalls.length, 0);
});

test('3. mezcla unchanged + inserted + updated: upsert solo con cambios y columnas obligatorias', async () => {
  reset();
  const t1 = instantAt(0);
  const t2 = instantAt(1);
  const t3 = instantAt(2);
  historyImpl = async () => ({
    points: [
      point(t1, [10, 12, 3, 2]),
      point(t2, [10, 12, 3, 2]),
      point(t3, [7, 8, 1, 1]),
    ],
    timeZone: TZ,
  });
  existingImpl = async () => [
    existingRow(t1, [10, 12, 3, 2]),
    // T2 parcial: consumption NULL → el candidato directo lo rellena.
    { ...existingRow(t2, [10, 12, 3, 2]), consumption_kwh: null },
  ];

  const result = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  assert.equal(result.fetched, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.upserted, 2);
  assert.equal(result.merge.unchanged, 1);
  assert.equal(result.merge.inserted, 1);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].length, 2);
  for (const row of upsertCalls[0]) {
    assert.equal(row.plant_id, PLANT_ID);
    assert.equal(row.interval_type, 1);
  }
  const filled = upsertCalls[0].find(row => row.interval_start === `${t2}.000Z`);
  assert.equal(filled.consumption_kwh, 12);
});

test('4. candidato NULL y derivado no degradan ni escriben', async () => {
  reset();
  const t1 = instantAt(0);
  // Candidato todo-NULL frente a medición completa: preserva y es unchanged.
  historyImpl = async () => ({
    points: [{
      timestamp: `${t1}.000Z`,
      timezone: TZ,
      generation_kwh: null,
      consumption_kwh: null,
      battery_charge_kwh: null,
      battery_discharge_kwh: null,
      grid_import_kwh: null,
      grid_export_kwh: null,
      raw_data: {},
    }],
    timeZone: TZ,
  });
  existingImpl = async () => [existingRow(t1, [10, 12, 3, 2])];

  const nulled = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);
  assert.equal(nulled.failed, 0);
  assert.equal(nulled.upserted, 0);
  assert.equal(upsertCalls.length, 0);

  // Derivado con valores distintos frente a medición directa: se conserva
  // la existente, es unchanged y tampoco escribe.
  reset();
  historyImpl = async () => ({
    points: [point(t1, [999, 999, 999, 999], { derived_from: 'plant_power_intervals', interval_hours: 1 })],
    timeZone: TZ,
  });
  existingImpl = async () => [existingRow(t1, [10, 12, 3, 2])];

  const derived = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);
  assert.equal(derived.failed, 0);
  assert.equal(derived.upserted, 0);
  assert.equal(upsertCalls.length, 0);
});

test('5. error real de persistencia con cambios: failed=N, upserted=0', async () => {
  reset();
  const t1 = instantAt(0);
  historyImpl = async () => ({ points: [point(t1, [10, 12, 3, 2])], timeZone: TZ });
  existingImpl = async () => [];
  upsertImpl = async () => { throw new Error('No se pudo guardar el histórico energético'); };

  const result = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  assert.equal(result.fetched, 1);
  assert.equal(result.upserted, 0);
  assert.equal(result.failed, 1);
});

test('6. todo unchanged aunque el upsert lanzaría: éxito sin llamar al upsert', async () => {
  reset();
  const t1 = instantAt(0);
  historyImpl = async () => ({ points: [point(t1, [10, 12, 3, 2])], timeZone: TZ });
  existingImpl = async () => [existingRow(t1, [10, 12, 3, 2])];
  upsertImpl = async () => { throw new Error('no debería ejecutarse'); };

  const result = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  assert.equal(result.failed, 0);
  assert.equal(result.upserted, 0);
  assert.equal(upsertCalls.length, 0);
});
