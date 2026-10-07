import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// IMPORTANTE: sin imports estáticos de código bajo mock. mock.module no
// reconecta módulos ya cargados: todo lo mockeado se importa dinámicamente
// DESPUÉS de registrar los mocks para que la cadena use los dobles.

const PLANT_ID = '11111111-1111-1111-1111-111111111111';
const TZ = 'America/La_Paz';

function minusDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function plusDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
const today = () => localDateForTimezone(new Date(), TZ);

let plantResult = null;
let rangeImpl = async () => [];
let hyxiImpl = async () => ({ fetched: 1, upserted: 1, failed: 0 });
let growattImpl = async () => ({ fetched: 1, upserted: 1, failed: 0 });

mock.module('../src/repositories/plants.repository.js', {
  namedExports: { getStoredPlantById: async () => plantResult },
});
mock.module('../src/repositories/energyIntervals.repository.js', {
  namedExports: {
    listEnergyIntervalsRange: async (...args) => rangeImpl(...args),
    upsertEnergyIntervals: async () => {},
    resolveHyxiPlant: async () => PLANT_ID,
  },
});
mock.module('../src/services/hyxiEnergyHistory.service.js', {
  namedExports: { syncHyxiEnergyHistory: async (...args) => hyxiImpl(...args) },
});
mock.module('../src/services/growattEnergyHistory.service.js', {
  namedExports: { syncGrowattEnergyHistory: async (...args) => growattImpl(...args) },
});

const { postEnergyBackfill, canRunEnergyBackfill } = await import(
  '../src/controllers/energyBackfill.controller.js'
);
const {
  checkPlantSyncable,
  runEnergyBackfill,
  validateBackfillRange,
} = await import('../src/services/energyBackfill.service.js');
const { localDateForTimezone } = await import('../src/services/hyxiPowerHistory.service.js');

function context({ role = 'rdx_admin', scope = { plantIds: null }, plantId = PLANT_ID, body = {} } = {}) {
  const response = { statusCode: 200, body: null };
  const req = { profile: { role }, scope, params: { plantId }, body };
  const res = {
    status(code) { response.statusCode = code; return res; },
    json(payload) { response.body = payload; return res; },
  };
  return { req, res, response };
}

const hyxiPlant = (overrides = {}) => ({
  id: PLANT_ID, provider: 'hyxi', external_plant_id: 'hyxi-1', active: true, timezone: TZ, ...overrides,
});
const growattPlant = (overrides = {}) => ({
  id: PLANT_ID, provider: 'growatt', external_plant_id: 'growatt-1', active: true, timezone: TZ, ...overrides,
});
const pastRange = (endAgo = 10, days = 3) => {
  const end = minusDays(today(), endAgo);
  return { start_date: minusDays(end, days - 1), end_date: end };
};

test('1-2. rdx_admin y client_admin permitidos', async () => {
  for (const role of ['rdx_admin', 'client_admin']) {
    assert.equal(canRunEnergyBackfill(role), true);
    plantResult = hyxiPlant();
    rangeImpl = async () => [];
    const { req, res, response } = context({ role, body: pastRange() });
    await postEnergyBackfill(req, res);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.provider, 'hyxi');
  }
});

test('3. client_user 403 sin tocar repositorios', async () => {
  assert.equal(canRunEnergyBackfill('client_user'), false);
  let called = false;
  plantResult = hyxiPlant();
  rangeImpl = async () => { called = true; return []; };
  const { req, res, response } = context({ role: 'client_user', body: pastRange() });
  await postEnergyBackfill(req, res);
  assert.equal(response.statusCode, 403);
  assert.equal(called, false);
});

test('4. fuera de scope 404', async () => {
  plantResult = hyxiPlant();
  const { req, res, response } = context({
    scope: { plantIds: new Set(['otra-planta']) }, body: pastRange(),
  });
  await postEnergyBackfill(req, res);
  assert.equal(response.statusCode, 404);
});

test('5-6. fecha inválida y start > end 400', async () => {
  plantResult = hyxiPlant();
  for (const body of [
    { start_date: 'no-fecha', end_date: minusDays(today(), 10) },
    { start_date: minusDays(today(), 9), end_date: minusDays(today(), 10) },
    {},
  ]) {
    const { req, res, response } = context({ body });
    await postEnergyBackfill(req, res);
    assert.equal(response.statusCode, 400);
  }
});

test('7. rango >7 días 400', async () => {
  plantResult = hyxiPlant();
  const end = minusDays(today(), 10);
  const { req, res, response } = context({
    body: { start_date: minusDays(end, 7), end_date: end },
  });
  await postEnergyBackfill(req, res);
  assert.equal(response.statusCode, 400);
});

test('8-9. hoy y futuro rechazados', async () => {
  plantResult = hyxiPlant();
  const now = today();
  for (const body of [
    { start_date: minusDays(now, 2), end_date: now },
    { start_date: plusDays(now, 1), end_date: plusDays(now, 2) },
  ]) {
    const { req, res, response } = context({ body });
    await postEnergyBackfill(req, res);
    assert.equal(response.statusCode, 400);
  }
});

test('10. planta no sincronizable 422', async () => {
  const end = minusDays(today(), 10);
  const body = { start_date: minusDays(end, 2), end_date: end };
  for (const plant of [
    hyxiPlant({ active: false }),
    hyxiPlant({ external_plant_id: null }),
    { ...hyxiPlant(), provider: 'desconocido' },
  ]) {
    plantResult = plant;
    const { req, res, response } = context({ body });
    await postEnergyBackfill(req, res);
    assert.equal(response.statusCode, 422);
  }
  plantResult = null;
  const { req, res, response } = context({ body });
  await postEnergyBackfill(req, res);
  assert.equal(response.statusCode, 404);
});

test('10b. checkPlantSyncable cubre casos sin HTTP', () => {
  assert.deepEqual(checkPlantSyncable(hyxiPlant()), { ok: true });
  assert.deepEqual(checkPlantSyncable(growattPlant()), { ok: true });
  assert.equal(checkPlantSyncable(hyxiPlant({ active: false })).status, 422);
  assert.equal(checkPlantSyncable({ ...hyxiPlant(), provider: 'otro' }).status, 422);
});

function serviceFakes({ observe, hyxi, growatt } = {}) {
  const calls = [];
  return {
    calls,
    observeDay: observe ?? (async () => ({ rows: 0, nullFields: 0 })),
    syncHyxiDay: hyxi ?? (async (externalId, date) => {
      calls.push(['hyxi', externalId, date]);
      return { fetched: 2, upserted: 2, failed: 0 };
    }),
    syncGrowattDay: growatt ?? (async (plant, date) => {
      calls.push(['growatt', plant.id, date]);
      return { fetched: 2, upserted: 2, failed: 0 };
    }),
  };
}

test('11. HYXi 3 días secuencial en orden start→end', async () => {
  const fakes = serviceFakes();
  const outcome = await runEnergyBackfill({
    plant: hyxiPlant(), dates: ['2026-09-08', '2026-09-09', '2026-09-10'], ...fakes,
  });
  assert.deepEqual(fakes.calls, [
    ['hyxi', 'hyxi-1', '2026-09-08'],
    ['hyxi', 'hyxi-1', '2026-09-09'],
    ['hyxi', 'hyxi-1', '2026-09-10'],
  ]);
  assert.deepEqual(outcome.days.map(day => day.status), ['completed', 'completed', 'completed']);
  assert.deepEqual(outcome.summary, {
    requested: 3, completed: 3, no_manufacturer_data: 0, skipped_degraded: 0, failed: 0,
  });
});

test('12. Growatt 3 días secuencial', async () => {
  const fakes = serviceFakes();
  const outcome = await runEnergyBackfill({
    plant: growattPlant(), dates: ['2026-09-08', '2026-09-09', '2026-09-10'], ...fakes,
  });
  assert.deepEqual(fakes.calls.map(call => call[2]), ['2026-09-08', '2026-09-09', '2026-09-10']);
  assert.equal(outcome.summary.completed, 3);
});

test('13-14. todos los días se procesan aunque existan filas; before/after correcto', async () => {
  const stored = {
    '2026-09-08': [{ generation_kwh: 5, consumption_kwh: null, grid_import_kwh: 1, grid_export_kwh: null }],
    '2026-09-09': [],
  };
  const written = new Set();
  const synced = [];
  const fakes = serviceFakes({
    observe: async (plantId, date) => {
      const rows = [...(stored[date] ?? []), ...(written.has(date) ? [{
        generation_kwh: 5, consumption_kwh: 6, grid_import_kwh: 1, grid_export_kwh: 2,
      }] : [])];
      const nullFields = rows.reduce((sum, row) => sum
        + ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh']
          .filter(field => row[field] === null || row[field] === undefined).length, 0);
      return { rows: rows.length, nullFields };
    },
    hyxi: async (externalId, date) => {
      synced.push(date);
      written.add(date);
      return { fetched: 1, upserted: 1, failed: 0 };
    },
  });
  const outcome = await runEnergyBackfill({
    plant: hyxiPlant(), dates: ['2026-09-08', '2026-09-09'], ...fakes,
  });
  // Día con filas existentes igual se procesó (sin regla already_complete).
  assert.deepEqual(synced, ['2026-09-08', '2026-09-09']);
  assert.deepEqual(outcome.days[0], {
    date: '2026-09-08', status: 'completed',
    rows_before: 1, rows_after: 2, null_fields_before: 2, null_fields_after: 2,
  });
  assert.deepEqual(
    [outcome.days[1].rows_before, outcome.days[1].rows_after],
    [0, 1],
  );
});

test('15. HYXi sin datos del fabricante', async () => {
  const fakes = serviceFakes({
    hyxi: async () => ({ fetched: 0, upserted: 0, failed: 0 }),
  });
  const outcome = await runEnergyBackfill({
    plant: hyxiPlant(), dates: ['2026-09-08'], ...fakes,
  });
  assert.equal(outcome.days[0].status, 'no_manufacturer_data');
  assert.equal(outcome.summary.no_manufacturer_data, 1);
});

test('16. Growatt skipped_degraded se refleja', async () => {
  const fakes = serviceFakes({
    growatt: async () => ({
      fetched: 10, upserted: 0, failed: 0, devices: 2,
      power_history_synced: true, skipped_degraded: true, meter_used: false,
    }),
  });
  const outcome = await runEnergyBackfill({
    plant: growattPlant(), dates: ['2026-09-08'], ...fakes,
  });
  assert.equal(outcome.days[0].status, 'skipped_degraded');
  assert.deepEqual(outcome.days[0].details, {
    devices: 2, fetched: 10, power_history_synced: true, meter_used: false,
  });
  assert.equal(outcome.summary.skipped_degraded, 1);
});

test('17. fallo día 2/3 no detiene el día 3; HTTP global 200', async () => {
  plantResult = hyxiPlant();
  rangeImpl = async () => [];
  let calls = 0;
  hyxiImpl = async () => {
    calls += 1;
    if (calls === 2) {
      const error = new Error('timeout');
      error.code = 'SYNC_TIMEOUT';
      throw error;
    }
    return { fetched: 1, upserted: 1, failed: 0 };
  };
  const end = minusDays(today(), 10);
  const body = { start_date: minusDays(end, 2), end_date: end };
  const { req, res, response } = context({ body });
  await postEnergyBackfill(req, res);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.days.map(day => day.status), ['completed', 'failed', 'completed']);
  assert.deepEqual(response.body.days[1].error, { code: 'SYNC_TIMEOUT', message: 'No se pudo sincronizar el día' });
  assert.deepEqual(response.body.summary, {
    requested: 3, completed: 2, no_manufacturer_data: 0, skipped_degraded: 0, failed: 1,
  });
});

test('18. frequentAccess aborta y no procesa días restantes con 429', async () => {
  plantResult = growattPlant();
  rangeImpl = async () => [];
  const processed = [];
  growattImpl = async (plant, date) => {
    processed.push(date);
    if (processed.length === 2) {
      const error = new Error('FREQUENTLY_ACCESS');
      error.frequentAccess = true;
      error.statusCode = 429;
      throw error;
    }
    return { fetched: 1, upserted: 1, failed: 0 };
  };
  const end = minusDays(today(), 10);
  const body = { start_date: minusDays(end, 2), end_date: end };
  const { req, res, response } = context({ body });
  await postEnergyBackfill(req, res);
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.aborted, true);
  assert.equal(response.body.days.length, 2);
  assert.deepEqual(processed, [minusDays(end, 2), minusDays(end, 1)]);
});

test('19. respuesta no filtra secretos ni payload crudo', async () => {
  const fakes = serviceFakes({
    hyxi: async () => ({
      fetched: 1, upserted: 1, failed: 0,
      raw_payload: { token: 'secreto', data: [1, 2, 3] },
      merge: { inserted: 1, filled: 0, updated: 0, preserved: 0, unchanged: 0 },
    }),
  });
  const outcome = await runEnergyBackfill({
    plant: hyxiPlant(), dates: ['2026-09-08'], ...fakes,
  });
  const serialized = JSON.stringify(outcome);
  assert.equal(serialized.includes('secreto'), false);
  assert.equal(serialized.includes('raw_payload'), false);
  assert.equal(serialized.includes('Authorization'), false);
  assert.deepEqual(outcome.days[0].details, {
    merge: { inserted: 1, filled: 0, updated: 0, preserved: 0, unchanged: 0 },
  });
  const failing = serviceFakes({
    hyxi: async () => {
      const error = new Error('boom');
      error.authorization = 'Bearer secreto';
      error.headers = { authorization: 'Bearer secreto' };
      throw error;
    },
  });
  const failed = await runEnergyBackfill({
    plant: hyxiPlant(), dates: ['2026-09-08'], ...failing,
  });
  assert.equal(JSON.stringify(failed).includes('secreto'), false);
});

test('20. reejecución del rango es segura', async () => {
  const stored = new Map();
  const fakes = serviceFakes({
    observe: async (plantId, date) => {
      const rows = stored.get(date) ?? [];
      return { rows: rows.length, nullFields: 0 };
    },
    hyxi: async (externalId, date) => {
      stored.set(date, [{ generation_kwh: 1 }]);
      return { fetched: 1, upserted: 1, failed: 0 };
    },
  });
  const args = { plant: hyxiPlant(), dates: ['2026-09-08', '2026-09-09'], ...fakes };
  const first = await runEnergyBackfill(args);
  const second = await runEnergyBackfill(args);
  assert.equal(first.summary.completed, 2);
  assert.equal(second.summary.completed, 2);
  assert.deepEqual(second.days.map(day => [day.rows_before, day.rows_after]), [[1, 1], [1, 1]]);
});

test('validateBackfillRange rechaza hoy/futuro y respeta máximo inclusivo', () => {
  const now = today();
  assert.equal(validateBackfillRange({ start_date: minusDays(now, 7), end_date: minusDays(now, 1) }, now).length, 7);
  assert.equal(validateBackfillRange({ start_date: minusDays(now, 8), end_date: minusDays(now, 1) }, now), null);
  assert.equal(validateBackfillRange({ start_date: minusDays(now, 1), end_date: minusDays(now, 1) }, now).length, 1);
  assert.equal(validateBackfillRange({ start_date: now, end_date: now }, now), null);
});
