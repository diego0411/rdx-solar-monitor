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
let powerImpl = async () => [];
let powerCalls = 0;

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
    listEnergyIntervals: async (...args) => existingImpl(...args),
  },
});
mock.module('../src/repositories/plantPowerIntervals.repository.js', {
  namedExports: { listPlantPowerIntervals: async (...args) => { powerCalls += 1; return powerImpl(...args); } },
});
mock.module('../src/services/growattEnergyHistory.service.js', {
  namedExports: {
    syncGrowattEnergyHistory: async () => ({ fetched: 0, upserted: 0, failed: 0 }),
    syncGrowattEnergyRollups: async () => { throw new Error('unexpected Growatt sync'); },
  },
});
mock.module('../src/repositories/plants.repository.js', {
  exports: { getStoredPlantById: async () => ({ id: PLANT_ID, external_plant_id: EXT_ID, provider: 'hyxi', active: true }) },
});

const { syncHyxiEnergyHistory } = await import('../src/services/hyxiEnergyHistory.service.js');
const { runEnergyBackfill } = await import('../src/services/energyBackfill.service.js');
const { getStoredEnergyHistory } = await import('../src/controllers/energyHistory.controller.js');

function reset() {
  historyImpl = async () => ({ points: [], timeZone: TZ });
  existingImpl = async () => [];
  upsertCalls = [];
  upsertImpl = async rows => { upsertCalls.push(rows); };
  powerImpl = async () => [];
  powerCalls = 0;
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
  // H04-4: cobertura directa completa → sin consulta de potencia.
  assert.equal(powerCalls, 0);
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


test('GET lazy joins an in-flight monthly rollup across different dates in the same month', async () => {
  reset();
  let release;
  let calls = 0;
  let stored = [];
  const gate = new Promise(resolve => { release = resolve; });
  historyImpl = async () => {
    calls += 1;
    await gate;
    return { points: [point('2026-10-05T04:00:00', [5, 6, 1, 0])], timeZone: TZ };
  };
  existingImpl = async () => stored;
  upsertImpl = async rows => { upsertCalls.push(rows); stored = rows; };
  const scheduled = syncHyxiEnergyHistory(EXT_ID, 2, '2026-10-01');
  await new Promise(resolve => setImmediate(resolve));
  let responded = false;
  let body;
  const res = {
    status(code) { assert.equal(code, 200); return this; },
    json(value) { responded = true; body = value; return this; },
  };
  const lazy = getStoredEnergyHistory({
    scope: { plantIds: null }, params: { plantId: PLANT_ID },
    query: { timeType: '2', period: 'month', startTime: '2026-10-15' },
  }, res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responded, false);
  assert.equal(calls, 1);
  release();
  await Promise.all([scheduled, lazy]);
  assert.equal(upsertCalls.length, 1);
  assert.equal(body.buckets.find(row => row.generation_kwh === 5).consumption_kwh, 6);
});

test('backfill joins daily sync; overlapping candidate rows from distinct requests merge after settlement', async () => {
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  let stored = [];
  historyImpl = async () => {
    calls += 1;
    return { points: [point('2026-10-05T04:00:00', calls === 1 ? [5, null, null, null] : [null, 6, null, null])], timeZone: TZ };
  };
  existingImpl = async () => stored;
  upsertImpl = async rows => {
    upsertCalls.push(rows);
    if (upsertCalls.length === 1) await gate;
    stored = rows;
  };
  const daily = syncHyxiEnergyHistory(EXT_ID, 1, DATE);
  await new Promise(resolve => setImmediate(resolve));
  const backfill = runEnergyBackfill({
    plant: { id: PLANT_ID, external_plant_id: EXT_ID, provider: 'hyxi' }, dates: [DATE],
    observeDay: async () => ({ rows: stored.length, nullFields: 0 }),
    syncHyxiDay: (id, date) => syncHyxiEnergyHistory(id, 1, date),
  });
  // Providers can return rows outside the requested day: protect the whole plant.
  const nextDate = syncHyxiEnergyHistory(EXT_ID, 1, '2026-10-06');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(upsertCalls.length, 1);
  release();
  const [, report] = await Promise.all([daily, backfill, nextDate]);
  assert.equal(report.days[0].status, 'completed');
  assert.equal(calls, 2);
  assert.equal(upsertCalls.length, 2);
  assert.equal(stored[0].generation_kwh, 5);
  assert.equal(stored[0].consumption_kwh, 6);
});

// H04-4: regresión — una medición real NO impide derivar energía para otros
// intervalos; el fallback se activa por huecos (campos NULL) y combina
// directo+derivado por instante y por campo sin duplicados.
test('H04-4 regresión: energía real en un intervalo no bloquea el fallback del otro', async () => {
  reset();
  const t1 = instantAt(0);
  const t2 = instantAt(1);
  historyImpl = async () => ({
    points: [
      point(t1, [10, 12, 3, 2]),                 // intervalo con energía real
      point(t2, [null, null, null, null]),       // intervalo sin energía real
    ],
    timeZone: TZ,
  });
  // Potencia suficiente para derivar ambos intervalos (2 derivados posibles).
  powerImpl = async () => [
    { id: 'p1', interval_start: `${t1}.000Z`, timezone: TZ,
      generation_power_w: 1000, consumption_power_w: 500, grid_import_power_w: 100, grid_export_power_w: 0 },
    { id: 'p2', interval_start: `${t2}.000Z`, timezone: TZ,
      generation_power_w: 2000, consumption_power_w: 600, grid_import_power_w: 120, grid_export_power_w: 0 },
    { id: 'p3', interval_start: `${instantAt(2)}.000Z`, timezone: TZ,
      generation_power_w: 3000, consumption_power_w: 700, grid_import_power_w: 130, grid_export_power_w: 0 },
  ];
  existingImpl = async () => [];

  const result = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  assert.equal(result.failed, 0);
  assert.equal(result.fetched, 2);
  // El fallback se ejecuta aunque la ventana contiene energía real.
  assert.equal(powerCalls, 1);
  assert.equal(upsertCalls[0].length, 2, 'un solo registro por instante');
  const t1Row = upsertCalls[0].find(row => row.interval_start === `${t1}.000Z`);
  const t2Row = upsertCalls[0].find(row => row.interval_start === `${t2}.000Z`);
  // La medición directa se conserva intacta y con su procedencia.
  assert.equal(t1Row.generation_kwh, 10);
  assert.equal(t1Row.raw_data?.derived_from, undefined);
  // El segundo intervalo recibe la energía derivada de potencia (2000 W,
  // 5 min → 2000 * (5/60) / 1000) con procedencia de potencia.
  assert.ok(Math.abs(t2Row.generation_kwh - 1 / 6) < 1e-12);
  assert.equal(t2Row.raw_data?.derived_from, 'plant_power_intervals');
});

test('H04-4: campo NULL se rellena con derivado sin pisar mediciones directas', async () => {
  reset();
  const t1 = instantAt(0);
  historyImpl = async () => ({
    points: [point(t1, [10, null, 3, 2])],
    timeZone: TZ,
  });
  powerImpl = async () => [
    { id: 'p1', interval_start: `${t1}.000Z`, timezone: TZ,
      generation_power_w: 1000, consumption_power_w: 500, grid_import_power_w: 100, grid_export_power_w: 0 },
    { id: 'p2', interval_start: `${instantAt(1)}.000Z`, timezone: TZ,
      generation_power_w: 2000, consumption_power_w: 600, grid_import_power_w: 120, grid_export_power_w: 0 },
  ];
  existingImpl = async () => [];

  const result = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  assert.equal(result.fetched, 1);
  assert.equal(powerCalls, 1);
  const row = upsertCalls[0].find(item => item.interval_start === `${t1}.000Z`);
  assert.equal(row.generation_kwh, 10);
  assert.equal(row.grid_import_kwh, 3);
  assert.ok(Math.abs(row.consumption_kwh - 500 / 12 / 1000) < 1e-12);
  // Procedencia directa: la fila conserva medición del proveedor.
  assert.equal(row.raw_data?.derived_from, undefined);
});

test('H04-4: cero directo se conserva aunque el derivado proponga energía', async () => {
  reset();
  const t1 = instantAt(0);
  historyImpl = async () => ({
    points: [point(t1, [0, null, 1, 0])],
    timeZone: TZ,
  });
  powerImpl = async () => [
    { id: 'p1', interval_start: `${t1}.000Z`, timezone: TZ,
      generation_power_w: 1000, consumption_power_w: 500, grid_import_power_w: 100, grid_export_power_w: 0 },
    { id: 'p2', interval_start: `${instantAt(1)}.000Z`, timezone: TZ,
      generation_power_w: 2000, consumption_power_w: 600, grid_import_power_w: 120, grid_export_power_w: 0 },
  ];
  existingImpl = async () => [];

  await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  const row = upsertCalls[0].find(item => item.interval_start === `${t1}.000Z`);
  assert.equal(row.generation_kwh, 0);
  assert.equal(row.grid_export_kwh, 0);
  assert.ok(Math.abs(row.consumption_kwh - 500 / 12 / 1000) < 1e-12);
});

test('H04-4: agrega intervalos derivados ausentes del historial directo', async () => {
  reset();
  const t0 = new Date(Date.UTC(2026, 9, 5, 4, 0, 0) - 5 * 60 * 1000).toISOString().slice(0, 19);
  const t1 = instantAt(0);
  historyImpl = async () => ({
    points: [point(t1, [10, null, 3, 2])],   // hueco que dispara el fallback
    timeZone: TZ,
  });
  // Potencia cubre t0 (ausente del historial directo), t1 y t2.
  powerImpl = async () => [
    { id: 'p0', interval_start: `${t0}.000Z`, timezone: TZ,
      generation_power_w: 1000, consumption_power_w: 500, grid_import_power_w: 100, grid_export_power_w: 0 },
    { id: 'p1', interval_start: `${t1}.000Z`, timezone: TZ,
      generation_power_w: 2000, consumption_power_w: 600, grid_import_power_w: 120, grid_export_power_w: 0 },
    { id: 'p2', interval_start: `${instantAt(1)}.000Z`, timezone: TZ,
      generation_power_w: 3000, consumption_power_w: 700, grid_import_power_w: 130, grid_export_power_w: 0 },
  ];
  existingImpl = async () => [];

  const result = await syncHyxiEnergyHistory(EXT_ID, 1, DATE);

  assert.equal(result.fetched, 2);
  assert.equal(upsertCalls[0].length, 2);
  const instants = upsertCalls[0].map(row => row.interval_start);
  assert.equal(new Set(instants).size, 2, 'sin duplicados por instante');
  const t0Row = upsertCalls[0].find(row => row.interval_start === `${t0}.000Z`);
  assert.ok(Math.abs(t0Row.generation_kwh - 1 / 12) < 1e-12);
  assert.equal(t0Row.raw_data?.derived_from, 'plant_power_intervals');
  const t1Row = upsertCalls[0].find(row => row.interval_start === `${t1}.000Z`);
  assert.ok(Math.abs(t1Row.consumption_kwh - 600 / 12 / 1000) < 1e-12);
});
