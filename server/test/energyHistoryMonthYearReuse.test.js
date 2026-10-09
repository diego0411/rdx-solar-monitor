import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// IMPORTANTE: sin imports estáticos de código bajo mock. Todo lo mockeado
// se importa dinámicamente DESPUÉS de registrar los mocks.
// Sin fabricantes ni BD: syncs y repositorios están mockeados.

const PLANT_ID = '44444444-4444-4444-4444-444444444444';
const EXT_ID = 'hyxi-ext-1';
const TZ = 'America/La_Paz';

let dayRowsImpl = async () => [];
let rangeCalls = [];
let rangeImpl = async () => { throw new Error('listEnergyIntervalsRange no debería llamarse'); };
let plantImpl = async () => null;
let hyxiSyncCalls = [];
let growattHistoryCalls = [];
let growattRollupCalls = [];

mock.module('../src/repositories/energyIntervals.repository.js', {
  namedExports: {
    listEnergyIntervals: async (...args) => dayRowsImpl(...args),
    listEnergyIntervalsRange: async (...args) => {
      rangeCalls.push(args);
      return rangeImpl(...args);
    },
    upsertEnergyIntervals: async () => {},
    resolveHyxiPlant: async () => PLANT_ID,
  },
});
mock.module('../src/repositories/plants.repository.js', {
  namedExports: { getStoredPlantById: async (...args) => plantImpl(...args) },
});
mock.module('../src/services/hyxiEnergyHistory.service.js', {
  namedExports: {
    syncHyxiEnergyHistory: async (...args) => { hyxiSyncCalls.push(args); return { fetched: 0, upserted: 0, failed: 0 }; },
  },
});
mock.module('../src/services/growattEnergyHistory.service.js', {
  namedExports: {
    syncGrowattEnergyHistory: async (...args) => { growattHistoryCalls.push(args); return { fetched: 0, upserted: 0, failed: 0 }; },
    syncGrowattEnergyRollups: async (...args) => { growattRollupCalls.push(args); return { fetched: 0, upserted: 0, failed: 0 }; },
  },
});

const { getStoredEnergyHistory } = await import('../src/controllers/energyHistory.controller.js');
const { aggregateHistory } = await import('../src/services/historyPeriods.js');
const { localDateKey } = await import('../src/utils/timezone.js');

function reset() {
  dayRowsImpl = async () => [];
  rangeCalls = [];
  rangeImpl = async () => { throw new Error('listEnergyIntervalsRange no debería llamarse'); };
  plantImpl = async () => null;
  hyxiSyncCalls = [];
  growattHistoryCalls = [];
  growattRollupCalls = [];
}

function context({ query, plantId = PLANT_ID }) {
  const response = { statusCode: 200, body: null };
  const req = {
    scope: { plantIds: null },
    params: { plantId },
    query,
  };
  const res = {
    status(code) { response.statusCode = code; return res; },
    json(payload) { response.body = payload; return res; },
  };
  return { req, res, response };
}

// Fila con la forma de listEnergyIntervals (proyectada: sin raw_data,
// con energy_provenance) incluyendo nulos y frontera de mes.
const monthRows = () => ([
  {
    interval_start: '2026-08-31T04:00:00.000Z', timezone: TZ,
    generation_kwh: 1, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 0,
    energy_provenance: null,
  },
  {
    interval_start: '2026-09-01T04:00:00.000Z', timezone: TZ,
    generation_kwh: 10, consumption_kwh: 12, grid_import_kwh: 3, grid_export_kwh: 2,
    energy_provenance: { grid_import_kwh: { source: 'growatt_meter', first_daily_counter: true } },
  },
  {
    interval_start: '2026-09-15T04:00:00.000Z', timezone: TZ,
    generation_kwh: null, consumption_kwh: null, grid_import_kwh: null, grid_export_kwh: null,
    energy_provenance: null,
  },
]);

const expectedAggregate = (rows, period, startTime) => aggregateHistory(rows, {
  period, selectedDate: startTime, kind: 'energy',
  localDate: row => localDateKey(row.interval_start, row.timezone),
});

test('month con datos reutiliza la primera lectura sin consulta de rango', async () => {
  reset();
  const rows = monthRows();
  dayRowsImpl = async () => rows;
  const { req, res, response } = context({
    query: { timeType: '2', startTime: '2026-09-15', period: 'month' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(rangeCalls.length, 0);
  assert.equal(hyxiSyncCalls.length, 0);
  assert.deepEqual(response.body, expectedAggregate(rows, 'month', '2026-09-15'));
});

test('year con datos reutiliza la primera lectura sin consulta de rango', async () => {
  reset();
  const rows = [
    {
      interval_start: '2026-01-01T00:00:00.000Z', timezone: 'UTC',
      generation_kwh: 100, consumption_kwh: 120, grid_import_kwh: 30, grid_export_kwh: 20,
      energy_provenance: null,
    },
    {
      interval_start: '2026-12-01T00:00:00.000Z', timezone: 'UTC',
      generation_kwh: null, consumption_kwh: null, grid_import_kwh: null, grid_export_kwh: null,
      energy_provenance: null,
    },
  ];
  dayRowsImpl = async () => rows;
  const { req, res, response } = context({
    query: { timeType: '3', startTime: '2026-06-10', period: 'year' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(rangeCalls.length, 0);
  assert.deepEqual(response.body, expectedAggregate(rows, 'year', '2026-06-10'));
});

test('month vacío HYXi: sync, relectura y agregación sin consulta de rango', async () => {
  reset();
  const fresh = monthRows().slice(1);
  let calls = 0;
  dayRowsImpl = async () => (calls++ === 0 ? [] : fresh);
  plantImpl = async () => ({
    id: PLANT_ID, provider: 'hyxi', active: true, external_plant_id: EXT_ID,
  });
  const { req, res, response } = context({
    query: { timeType: '2', startTime: '2026-09-15', period: 'month' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(hyxiSyncCalls, [[EXT_ID, 2, '2026-09-15']]);
  assert.equal(rangeCalls.length, 0);
  assert.deepEqual(response.body, expectedAggregate(fresh, 'month', '2026-09-15'));
});

test('month vacío Growatt: rollup, relectura y agregación sin consulta de rango', async () => {
  reset();
  const fresh = monthRows().slice(1);
  let calls = 0;
  dayRowsImpl = async () => (calls++ === 0 ? [] : fresh);
  const plant = { id: PLANT_ID, provider: 'growatt', active: true };
  plantImpl = async () => plant;
  const { req, res, response } = context({
    query: { timeType: '2', startTime: '2026-09-15', period: 'month' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(growattRollupCalls.length, 1);
  assert.deepEqual(growattRollupCalls[0][1], 'month');
  assert.equal(rangeCalls.length, 0);
  assert.deepEqual(response.body, expectedAggregate(fresh, 'month', '2026-09-15'));
});

test('week conserva su lectura de rango sobre el conjunto semanal', async () => {
  reset();
  const dayRow = {
    interval_start: '2026-09-08T04:00:00.000Z', timezone: TZ,
    generation_kwh: 1, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 0,
    energy_provenance: null,
  };
  const weekRows = [
    dayRow,
    {
      interval_start: '2026-09-09T04:00:00.000Z', timezone: TZ,
      generation_kwh: 9, consumption_kwh: 9, grid_import_kwh: 9, grid_export_kwh: 9,
      energy_provenance: null,
    },
  ];
  dayRowsImpl = async () => [dayRow];
  rangeImpl = async () => weekRows;
  const { req, res, response } = context({
    query: { timeType: '1', startTime: '2026-09-08', period: 'week' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(rangeCalls.length, 1);
  assert.deepEqual(rangeCalls[0], [PLANT_ID, 1, '2026-09-07', '2026-09-14']);
  assert.deepEqual(response.body, expectedAggregate(weekRows, 'week', '2026-09-08'));
});

test('day conserva su flujo de una sola lectura sin rango', async () => {
  reset();
  const rows = monthRows().slice(1);
  dayRowsImpl = async () => rows;
  const { req, res, response } = context({
    query: { timeType: '1', startTime: '2026-09-15', period: 'day' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(rangeCalls.length, 0);
  assert.equal(response.body.period, 'day');
  assert.equal(response.body.buckets.length, rows.length);
});
