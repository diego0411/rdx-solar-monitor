import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { readFileSync } from 'node:fs';

// IMPORTANTE: sin imports estáticos de código bajo mock. Todo lo mockeado
// se importa dinámicamente DESPUÉS de registrar los mocks.
// Sin BD: el cliente Supabase está mockeado con un builder que registra
// la proyección y devuelve páginas programadas.

const rangeCalls = [];
let tableRows = {};
let tableError = {};

function resetSupabaseFake() {
  rangeCalls.length = 0;
  tableRows = {};
  tableError = {};
}

function chainable(table) {
  const state = { table, select: null, orders: [], filters: [] };
  const builder = {
    select(columns) { state.select = columns; return builder; },
    order(column, options) { state.orders.push([column, options]); return builder; },
    in(column, values) { state.filters.push(['in', column, values]); return builder; },
    eq(column, value) { state.filters.push(['eq', column, value]); return builder; },
    async range(offset, end) {
      rangeCalls.push({
        table: state.table,
        select: state.select,
        orders: state.orders.map(entry => [...entry]),
        filters: state.filters.map(entry => [...entry]),
        offset,
        end,
      });
      if (tableError[table]) return { data: null, error: new Error('supabase caído') };
      const rows = tableRows[table] ?? [];
      return { data: rows.slice(offset, end + 1), error: null };
    },
  };
  return builder;
}

mock.module('../src/config/supabase.js', {
  namedExports: {
    supabase: { from: table => chainable(table) },
  },
});

const { listDevicesCatalog } = await import('../src/repositories/devices.repository.js');
const { getDevicesCatalog } = await import('../src/controllers/devices.controller.js');

const routesSource = readFileSync(new URL('../src/routes/devices.routes.js', import.meta.url), 'utf8');

function deviceCalls() {
  return rangeCalls.filter(call => call.table === 'devices');
}

test('proyección exacta de 4 columnas sin * ni joins; no toca latest', async () => {
  resetSupabaseFake();
  __setRows();
  await listDevicesCatalog(null);
  const calls = deviceCalls();
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.select, 'id, plant_id, name, serial_number');
  }
  assert.deepEqual(calls[0].orders, [['name', { ascending: true }], ['id', { ascending: true }]]);
  assert.ok(!rangeCalls.some(call => call.table === 'device_latest_data'), 'sin consulta a latest');
});

function __setRows() {
  tableRows.devices = [{ id: 'd1', plant_id: 'p1', name: 'Inv 1', serial_number: 'SN1' }];
}

test('alcance, paginación y error con mensaje propio', async () => {
  resetSupabaseFake();
  assert.deepEqual(await listDevicesCatalog(new Set()), []);
  assert.equal(rangeCalls.length, 0);

  resetSupabaseFake();
  tableRows.devices = Array.from({ length: 1002 }, (_, index) => ({ id: `d${index}` }));
  const rows = await listDevicesCatalog(new Set(['p1']));
  assert.equal(rows.length, 1002);
  const calls = deviceCalls();
  assert.deepEqual(calls.map(call => [call.offset, call.end]), [[0, 999], [1000, 1999]]);
  assert.deepEqual(calls[0].filters, [['in', 'plant_id', ['p1']]]);

  resetSupabaseFake();
  tableRows.devices = [{ id: 'd1' }];
  await listDevicesCatalog(null);
  assert.deepEqual(deviceCalls()[0].filters, []);

  resetSupabaseFake();
  tableError.devices = true;
  await assert.rejects(listDevicesCatalog(null), /No se pudo consultar el catálogo de dispositivos/);
});

function fakeRes() {
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) { response.statusCode = code; return res; },
    json(payload) { response.body = payload; return res; },
  };
  return { res, response };
}

test('controlador sirve el catálogo y mapea errores a 503 sin tocar contratos', async () => {
  resetSupabaseFake();
  tableRows.devices = [{ id: 'd1', plant_id: 'p1', name: 'Inv 1', serial_number: 'SN1' }];
  const ok = fakeRes();
  await getDevicesCatalog({ scope: { plantIds: null } }, ok.res);
  assert.equal(ok.response.statusCode, 200);
  assert.deepEqual(ok.response.body, [{ id: 'd1', plant_id: 'p1', name: 'Inv 1', serial_number: 'SN1' }]);

  resetSupabaseFake();
  tableError.devices = true;
  const failure = fakeRes();
  await getDevicesCatalog({ scope: { plantIds: null } }, failure.res);
  assert.equal(failure.response.statusCode, 503);
  assert.deepEqual(failure.response.body, { error: 'No se pudo consultar el catálogo de dispositivos' });
});

test('ruta /catalog registrada antes de /:id con el mismo guard de módulo', () => {
  assert.ok(routesSource.includes("requireModuleAccess('devices')"));
  const catalogAt = routesSource.indexOf("'/catalog'");
  const idAt = routesSource.indexOf("'/:id'");
  assert.ok(catalogAt !== -1 && idAt !== -1 && catalogAt < idAt, '/catalog debe preceder a /:id');
});
