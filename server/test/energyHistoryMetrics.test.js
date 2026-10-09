import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import express from 'express';

// IMPORTANTE: sin imports estáticos de código bajo mock. Todo lo mockeado
// se importa dinámicamente DESPUÉS de registrar los mocks.
// Sin fabricantes ni BD: syncs y repositorios están mockeados; tampoco
// hay sincronizaciones reales en ningún caso.

const PLANT_ID = '55555555-5555-5555-5555-555555555555';
const EXT_ID = 'hyxi-ext-9';
const TZ = 'America/La_Paz';

let dayRowsImpl = async () => [];
let rangeCalls = [];
let rangeImpl = async () => [];
let plantImpl = async () => null;
let hyxiSyncCalls = [];
let hyxiSyncImpl = async (...args) => {
  hyxiSyncCalls.push(args);
  return { fetched: 0, upserted: 0, failed: 0 };
};
let growattHistoryCalls = [];
let growattHistoryImpl = async (...args) => {
  growattHistoryCalls.push(args);
  return { fetched: 0, upserted: 0, failed: 0 };
};
let growattRollupCalls = [];
let growattRollupImpl = async (...args) => {
  growattRollupCalls.push(args);
  return { fetched: 0, upserted: 0, failed: 0 };
};

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
    syncHyxiEnergyHistory: async (...args) => hyxiSyncImpl(...args),
  },
});
mock.module('../src/services/growattEnergyHistory.service.js', {
  namedExports: {
    syncGrowattEnergyHistory: async (...args) => growattHistoryImpl(...args),
    syncGrowattEnergyRollups: async (...args) => growattRollupImpl(...args),
  },
});

const { getStoredEnergyHistory } = await import('../src/controllers/energyHistory.controller.js');
const { httpMetrics } = await import('../src/middleware/httpMetrics.middleware.js');
const { aggregateHistory } = await import('../src/services/historyPeriods.js');
const { localDateKey } = await import('../src/utils/timezone.js');

function reset() {
  dayRowsImpl = async () => [];
  rangeCalls = [];
  rangeImpl = async () => [];
  plantImpl = async () => null;
  hyxiSyncCalls = [];
  hyxiSyncImpl = async (...args) => {
    hyxiSyncCalls.push(args);
    return { fetched: 0, upserted: 0, failed: 0 };
  };
  growattHistoryCalls = [];
  growattHistoryImpl = async (...args) => {
    growattHistoryCalls.push(args);
    return { fetched: 0, upserted: 0, failed: 0 };
  };
  growattRollupCalls = [];
  growattRollupImpl = async (...args) => {
    growattRollupCalls.push(args);
    return { fetched: 0, upserted: 0, failed: 0 };
  };
}

function enableMetrics(t) {
  process.env.HTTP_METRICS_ENABLED = 'true';
  t.after(() => { delete process.env.HTTP_METRICS_ENABLED; });
}

function disableMetrics(t) {
  delete process.env.HTTP_METRICS_ENABLED;
  t.after(() => { delete process.env.HTTP_METRICS_ENABLED; });
}

function context({ query, plantId = PLANT_ID }) {
  const response = { statusCode: 200, body: null };
  const req = {
    scope: { plantIds: null },
    params: { plantId },
    query,
  };
  const res = {
    locals: {},
    status(code) { response.statusCode = code; return res; },
    json(payload) { response.body = payload; return res; },
  };
  return { req, res, response };
}

const valuedRow = (intervalStart, generation = 5) => ({
  interval_start: intervalStart, timezone: TZ,
  generation_kwh: generation, consumption_kwh: 6,
  grid_import_kwh: 1, grid_export_kwh: 0,
  energy_provenance: null,
});

const expectedAggregate = (rows, period, startTime) => aggregateHistory(rows, {
  period, selectedDate: startTime, kind: 'energy',
  localDate: row => localDateKey(row.interval_start, row.timezone),
});

function assertStage(locals, key) {
  assert.equal(typeof locals[key], 'number', `falta etapa ${key}`);
  assert.ok(locals[key] >= 0, `etapa ${key} negativa`);
}

function assertAbsentStages(locals, keys) {
  for (const key of keys) {
    assert.ok(!(key in locals), `etapa ficticia presente: ${key}`);
  }
}

const SYNC_KEYS = ['energy_sync_ms', 'energy_reread_ms', 'energy_range_ms'];

test('day sin sincronización: lectura + agregación; omite sync, relectura y rango', async t => {
  enableMetrics(t);
  reset();
  const rows = [valuedRow('2026-09-15T04:00:00.000Z'), valuedRow('2026-09-15T05:00:00.000Z', 7)];
  dayRowsImpl = async () => rows;
  const { req, res, response } = context({
    query: { timeType: '1', startTime: '2026-09-15', period: 'day' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(hyxiSyncCalls.length, 0);
  assert.equal(rangeCalls.length, 0);
  assertStage(res.locals, 'energy_read_ms');
  assertStage(res.locals, 'energy_aggregate_ms');
  assertAbsentStages(res.locals, [...SYNC_KEYS, 'energy_sync_occurred']);
  assert.equal(response.body.period, 'day');
  assert.equal(response.body.buckets.length, rows.length);
  assert.deepEqual(response.body.buckets[1].generation_kwh, 7);
});

test('month sin sincronización: lectura + agregación sin consulta de rango', async t => {
  enableMetrics(t);
  reset();
  const rows = [valuedRow('2026-09-01T04:00:00.000Z', 10)];
  dayRowsImpl = async () => rows;
  const { req, res, response } = context({
    query: { timeType: '2', startTime: '2026-09-15', period: 'month' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(rangeCalls.length, 0);
  assertStage(res.locals, 'energy_read_ms');
  assertStage(res.locals, 'energy_aggregate_ms');
  assertAbsentStages(res.locals, [...SYNC_KEYS, 'energy_sync_occurred']);
  assert.deepEqual(response.body, expectedAggregate(rows, 'month', '2026-09-15'));
});

test('HYXi con sincronización: sync + bandera + relectura, respuesta intacta', async t => {
  enableMetrics(t);
  reset();
  const fresh = [valuedRow('2026-09-01T04:00:00.000Z', 10)];
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
  assertStage(res.locals, 'energy_read_ms');
  assertStage(res.locals, 'energy_sync_ms');
  assert.equal(res.locals.energy_sync_occurred, true);
  assertStage(res.locals, 'energy_reread_ms');
  assertStage(res.locals, 'energy_aggregate_ms');
  assert.ok(!('energy_range_ms' in res.locals));
  assert.deepEqual(response.body, expectedAggregate(fresh, 'month', '2026-09-15'));
});

test('Growatt day con sincronización: historial + relectura, respuesta intacta', async t => {
  enableMetrics(t);
  reset();
  const fresh = [valuedRow('2026-09-15T04:00:00.000Z', 3)];
  let calls = 0;
  dayRowsImpl = async () => (calls++ === 0 ? [] : fresh);
  const plant = { id: PLANT_ID, provider: 'growatt', active: true };
  plantImpl = async () => plant;
  const { req, res, response } = context({
    query: { timeType: '1', startTime: '2026-09-15', period: 'day' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(growattHistoryCalls.length, 1);
  assert.deepEqual(growattHistoryCalls[0][1], '2026-09-15');
  assertStage(res.locals, 'energy_read_ms');
  assertStage(res.locals, 'energy_sync_ms');
  assert.equal(res.locals.energy_sync_occurred, true);
  assertStage(res.locals, 'energy_reread_ms');
  assertStage(res.locals, 'energy_aggregate_ms');
  assert.equal(response.body.buckets.length, fresh.length);
});

test('week con datos: registra la lectura adicional de rango', async t => {
  enableMetrics(t);
  reset();
  const dayRow = valuedRow('2026-09-08T04:00:00.000Z', 1);
  const weekRows = [dayRow, valuedRow('2026-09-09T04:00:00.000Z', 9)];
  dayRowsImpl = async () => [dayRow];
  rangeImpl = async () => weekRows;
  const { req, res, response } = context({
    query: { timeType: '1', startTime: '2026-09-08', period: 'week' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(rangeCalls.length, 1);
  assertStage(res.locals, 'energy_read_ms');
  assertStage(res.locals, 'energy_range_ms');
  assertStage(res.locals, 'energy_aggregate_ms');
  assertAbsentStages(res.locals, ['energy_sync_ms', 'energy_reread_ms', 'energy_sync_occurred']);
  assert.deepEqual(response.body, expectedAggregate(weekRows, 'week', '2026-09-08'));
});

test('métricas deshabilitadas: locals intacto y respuesta idéntica', async t => {
  disableMetrics(t);
  reset();
  const rows = [valuedRow('2026-09-01T04:00:00.000Z', 10)];
  dayRowsImpl = async () => rows;
  const { req, res, response } = context({
    query: { timeType: '2', startTime: '2026-09-15', period: 'month' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(res.locals), []);
  assert.deepEqual(response.body, expectedAggregate(rows, 'month', '2026-09-15'));
});

test('error en lectura inicial: 503 sin etapas ficticias', async t => {
  enableMetrics(t);
  reset();
  dayRowsImpl = async () => { throw new Error('supabase caído'); };
  const { req, res, response } = context({
    query: { timeType: '1', startTime: '2026-09-15', period: 'day' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { error: 'No se pudo consultar el histórico energético' });
  assertAbsentStages(res.locals, [
    'energy_read_ms', 'energy_sync_ms', 'energy_reread_ms',
    'energy_range_ms', 'energy_aggregate_ms', 'energy_sync_occurred',
  ]);
});

test('error durante sync: 503 con etapas parciales ya completadas', async t => {
  enableMetrics(t);
  reset();
  dayRowsImpl = async () => [];
  plantImpl = async () => ({
    id: PLANT_ID, provider: 'hyxi', active: true, external_plant_id: EXT_ID,
  });
  hyxiSyncImpl = async (...args) => {
    hyxiSyncCalls.push(args);
    throw new Error('fabricante caído');
  };
  const { req, res, response } = context({
    query: { timeType: '2', startTime: '2026-09-15', period: 'month' },
  });
  await getStoredEnergyHistory(req, res);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { error: 'No se pudo consultar el histórico energético' });
  assertStage(res.locals, 'energy_read_ms');
  assertAbsentStages(res.locals, [
    'energy_sync_ms', 'energy_reread_ms',
    'energy_range_ms', 'energy_aggregate_ms', 'energy_sync_occurred',
  ]);
});

test('integración: http_metric incluye etapas del endpoint sin sensibles', async t => {
  enableMetrics(t);
  reset();
  const rows = [valuedRow('2026-09-01T04:00:00.000Z', 10)];
  dayRowsImpl = async () => rows;
  const entries = [];
  const original = console.info;
  console.info = (...args) => { entries.push(args); };
  t.after(() => { console.info = original; });

  const app = express();
  app.use(express.json());
  app.use(httpMetrics);
  const router = express.Router();
  router.get('/:plantId/energy-history', (req, res) => {
    req.scope = { plantIds: null };
    return getStoredEnergyHistory(req, res);
  });
  app.use('/api/plants', router);
  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(
    `${base}/api/plants/${PLANT_ID}/energy-history?timeType=2&startTime=2026-09-15&period=month`,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, expectedAggregate(rows, 'month', '2026-09-15'));

  const found = entries.filter(args => args[0] === 'http_metric').map(args => args[1]);
  assert.equal(found.length, 1);
  const entry = found[0];
  assert.equal(entry.route, '/api/plants/:plantId/energy-history');
  assert.equal(entry.status, 200);
  assert.equal(typeof entry.energy_read_ms, 'number');
  assert.equal(typeof entry.energy_aggregate_ms, 'number');
  assert.ok(entry.energy_read_ms >= 0 && entry.energy_aggregate_ms >= 0);
  assert.ok(entry.duration_ms >= entry.energy_read_ms);
  assert.ok(!('energy_sync_ms' in entry));
  assert.ok(!('energy_sync_occurred' in entry));
  const serialized = JSON.stringify(entries);
  assert.ok(!serialized.includes(PLANT_ID));
});
