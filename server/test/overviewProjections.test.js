import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// IMPORTANTE: sin imports estáticos de código bajo mock. Todo lo mockeado
// se importa dinámicamente DESPUÉS de registrar los mocks.
// Sin BD ni fabricantes: el cliente Supabase está mockeado (parte A) o
// las variantes de repositorio están mockeadas (parte B).

const supportsModuleMocks = typeof mock.module === 'function';

// Reloj congelado al mediodía UTC (mismo patrón que dashboard.service.test):
// fixtures relativos conservan frescura y día calendario.
if (supportsModuleMocks && typeof mock.method === 'function') {
  const frozenNow = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
    12, 0, 0, 0,
  );
  mock.method(Date, 'now', () => frozenNow);
}

const now = Date.now();
const freshTs = new Date(now - 1 * 60 * 1000).toISOString();
const staleTs = new Date(now - 120 * 60 * 1000).toISOString();

// ---------- Parte A: cableado de proyecciones contra Supabase ----------

const rangeCalls = [];
let tableRows = {};
let tableError = {};

function __setRows(table, rows) {
  tableRows[table] = rows;
  delete tableError[table];
}

function __setError(table) {
  tableError[table] = true;
}

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
      if (tableError[table]) return { data: null, error: new Error('boom') };
      const rows = tableRows[table] ?? [];
      return { data: rows.slice(offset, end + 1), error: null };
    },
  };
  return builder;
}

if (supportsModuleMocks) {
  mock.module('../src/config/supabase.js', {
    namedExports: {
      supabase: { from: table => chainable(table) },
    },
  });
}

const { listStoredPlantsOverview } = supportsModuleMocks
  ? await import('../src/repositories/plants.repository.js')
  : {};
const { listStoredDevicesOverview } = supportsModuleMocks
  ? await import('../src/repositories/devices.repository.js')
  : {};
const { listDeviceLatestDataOverview } = supportsModuleMocks
  ? await import('../src/repositories/deviceLatestData.repository.js')
  : {};
const { listPlantEnergySummariesOverview } = supportsModuleMocks
  ? await import('../src/repositories/plantEnergySummary.repository.js')
  : {};

function lastCall(table) {
  const found = rangeCalls.filter(call => call.table === table);
  assert.ok(found.length > 0, `sin consulta a ${table}`);
  return found[0];
}

function assertNoStar(select) {
  assert.ok(!select.includes('*'), `proyección con *: ${select}`);
}

test('A1: plants usa proyección explícita sin * y conserva orden', { skip: !supportsModuleMocks }, async () => {
  resetSupabaseFake();
  __setRows('plants', [{ id: 'p1' }]);
  await listStoredPlantsOverview(null);
  const call = lastCall('plants');
  assertNoStar(call.select);
  for (const column of ['id', 'active', 'provider', 'external_plant_id', 'name', 'plant_type',
    'timezone', 'address', 'capacity_kwp', 'latitude', 'longitude', 'last_synced_at',
    'status', 'metadata']) {
    assert.ok(call.select.split(',').map(part => part.trim()).includes(column), `falta ${column}`);
  }
  assert.deepEqual(call.orders, [['name', { ascending: true }], ['id', { ascending: true }]]);
  assert.deepEqual(call.filters, []);
});

test('A2: plants preserva semántica de alcance (set vacío, set con ids, error)', { skip: !supportsModuleMocks }, async () => {
  resetSupabaseFake();
  __setRows('plants', []);
  await listStoredPlantsOverview(new Set());
  assert.deepEqual(lastCall('plants').filters, [['eq', 'id', '00000000-0000-0000-0000-000000000000']]);

  resetSupabaseFake();
  __setRows('plants', []);
  await listStoredPlantsOverview(new Set(['p1', 'p2']));
  assert.deepEqual(lastCall('plants').filters, [['in', 'id', ['p1', 'p2']]]);

  resetSupabaseFake();
  __setError('plants');
  await assert.rejects(listStoredPlantsOverview(null), /No se pudieron consultar las plantas almacenadas/);
});

test('A3: devices usa proyección sin join plant y conserva orden', { skip: !supportsModuleMocks }, async () => {
  resetSupabaseFake();
  __setRows('devices', [{ id: 'd1' }]);
  await listStoredDevicesOverview(null);
  const call = lastCall('devices');
  assertNoStar(call.select);
  assert.ok(!call.select.includes('plant:'), `join innecesario: ${call.select}`);
  for (const column of ['id', 'plant_id', 'provider', 'active', 'device_type', 'status', 'name',
    'model', 'serial_number', 'software_version', 'hardware_version', 'rated_power_w',
    'last_data_at', 'last_synced_at']) {
    assert.ok(call.select.split(',').map(part => part.trim()).includes(column), `falta ${column}`);
  }
  assert.deepEqual(call.orders, [['name', { ascending: true }], ['id', { ascending: true }]]);
});

test('A4: devices preserva alcance y pagina hasta página corta', { skip: !supportsModuleMocks }, async () => {
  resetSupabaseFake();
  __setRows('devices', []);
  assert.deepEqual(await listStoredDevicesOverview(new Set()), []);
  assert.equal(rangeCalls.length, 0);

  resetSupabaseFake();
  __setRows('devices', Array.from({ length: 1002 }, (_, index) => ({ id: `d${index}` })));
  const rows = await listStoredDevicesOverview(new Set(['p1']));
  assert.equal(rows.length, 1002);
  const calls = rangeCalls.filter(call => call.table === 'devices');
  assert.deepEqual(calls.map(call => [call.offset, call.end]), [[0, 999], [1000, 1999]]);
  assert.deepEqual(calls[0].filters, [['in', 'plant_id', ['p1']]]);
});

test('A5: latest conserva raw_data/updated_at y denormaliza device_type del join', { skip: !supportsModuleMocks }, async () => {
  resetSupabaseFake();
  __setRows('device_latest_data', []);
  await listDeviceLatestDataOverview(null);
  const call = lastCall('device_latest_data');
  assertNoStar(call.select);
  for (const column of ['device_id', 'collected_at', 'updated_at', 'ac_power', 'pv_power',
    'load_power', 'grid_power', 'grid_import_power', 'grid_export_power', 'battery_power',
    'battery_charge_power', 'battery_discharge_power', 'battery_soc', 'today_energy',
    'total_energy', 'raw_data']) {
    assert.ok(call.select.includes(column), `falta ${column}`);
  }
  assert.ok(call.select.includes('device:devices!inner(device_type)'), `join incorrecto: ${call.select}`);
  assert.ok(!call.select.includes('serial_number'), 'serial_number no consumido en overview');
  assert.ok(!call.select.includes('plant:plants'), 'join anidado no consumido en overview');
  assert.deepEqual(call.orders, [['device_id', { ascending: true }]]);
  assert.deepEqual(call.filters, []);
});

test('A6: latest mapea device_type, filtra por scope y propaga error original', { skip: !supportsModuleMocks }, async () => {
  resetSupabaseFake();
  __setRows('device_latest_data', [
    { device_id: 'd1', ac_power: 5, device: { device_type: 'MIN' } },
    { device_id: 'd2', ac_power: 7, device: null },
  ]);
  const rows = await listDeviceLatestDataOverview(new Set(['p1']));
  assert.deepEqual(rows, [
    { device_id: 'd1', ac_power: 5, device_type: 'MIN' },
    { device_id: 'd2', ac_power: 7, device_type: null },
  ]);
  assert.deepEqual(lastCall('device_latest_data').filters, [['in', 'device.plant_id', ['p1']]]);
  assert.ok(!('serial_number' in rows[0]), 'serial_number debe eliminarse');
  assert.ok(!('plant_name' in rows[0]), 'plant_name debe eliminarse');
  assert.ok(!('device' in rows[0]), 'join debe desanidarse');

  resetSupabaseFake();
  assert.deepEqual(await listDeviceLatestDataOverview(new Set()), []);

  resetSupabaseFake();
  __setError('device_latest_data');
  await assert.rejects(listDeviceLatestDataOverview(null), /No se pudo consultar la última telemetría/);
});

test('A7: summaries proyecta plant_id + 8 kWh sin join y conserva orden', { skip: !supportsModuleMocks }, async () => {
  resetSupabaseFake();
  __setRows('plant_energy_summary', [{ plant_id: 'p1' }]);
  await listPlantEnergySummariesOverview(new Set(['p1']));
  const call = lastCall('plant_energy_summary');
  assertNoStar(call.select);
  assert.ok(!call.select.includes('plant:'), `join innecesario: ${call.select}`);
  for (const column of ['plant_id', 'today_generation_kwh', 'month_generation_kwh',
    'year_generation_kwh', 'total_generation_kwh', 'today_consumption_kwh',
    'month_consumption_kwh', 'year_consumption_kwh', 'total_consumption_kwh']) {
    assert.ok(call.select.split(',').map(part => part.trim()).includes(column), `falta ${column}`);
  }
  assert.deepEqual(call.orders, [['plant_id', { ascending: true }]]);
  assert.deepEqual(call.filters, [['in', 'plant_id', ['p1']]]);

  resetSupabaseFake();
  assert.deepEqual(await listPlantEnergySummariesOverview(new Set()), []);
});

// ---------- Parte B: equivalencia con filas de proyección slim ----------
// Las filas programadas contienen SOLO las columnas proyectadas (sin
// serial_number/plant_name en latest, sin joins plant(name)): si el
// servicio responde igual, nada eliminado era necesario.

const B_PLANTS = [
  {
    id: 'b-ph', active: true, provider: 'hyxi', external_plant_id: 'ext-ph',
    name: 'PH', plant_type: 'rooftop', timezone: 'UTC', address: 'Calle 1',
    capacity_kwp: 10, latitude: -16.5, longitude: -68.15,
    last_synced_at: freshTs, status: 'online', metadata: {},
  },
  {
    id: 'b-pg', active: true, provider: 'growatt', external_plant_id: 'ext-pg',
    name: 'PG', plant_type: 'rooftop', timezone: 'UTC', address: null,
    capacity_kwp: 5, latitude: null, longitude: null,
    last_synced_at: null, status: 'online', metadata: { create_date: '2024-01-01' },
  },
  {
    id: 'b-po', active: true, provider: 'hyxi', external_plant_id: 'ext-po',
    name: 'PO', plant_type: null, timezone: 'UTC', address: null,
    capacity_kwp: 7, latitude: null, longitude: null,
    last_synced_at: null, status: 'online', metadata: {},
  },
  {
    id: 'b-px', active: false, provider: 'hyxi', external_plant_id: 'ext-px',
    name: 'PX', plant_type: null, timezone: 'UTC', address: null,
    capacity_kwp: 1, latitude: null, longitude: null,
    last_synced_at: null, status: 'online', metadata: {},
  },
];

const B_DEVICES = [
  { id: 'b-dh', plant_id: 'b-ph', provider: 'hyxi', active: true, device_type: 'STRING_INVERTER', status: 'online', name: 'Inv H', model: 'M1', serial_number: 'SN-H', software_version: '1', hardware_version: '1', rated_power_w: 5000, last_data_at: freshTs, last_synced_at: freshTs },
  { id: 'b-dg', plant_id: 'b-pg', provider: 'growatt', active: true, device_type: 'MIN', status: 'online', name: 'Min G', model: 'MIN6000', serial_number: 'SN-G', software_version: '2', hardware_version: '2', rated_power_w: 6000, last_data_at: freshTs, last_synced_at: freshTs },
  { id: 'b-dc', plant_id: 'b-pg', provider: 'growatt', active: true, device_type: 'COLLECTOR', status: 'online', name: 'Col G', model: null, serial_number: 'SN-C', software_version: null, hardware_version: null, rated_power_w: null, last_data_at: freshTs, last_synced_at: freshTs },
  { id: 'b-da', plant_id: 'b-pg', provider: 'growatt', active: true, device_type: 'MIN', status: 'online', name: 'Min A', model: 'MIN6000', serial_number: 'SN-A', software_version: '2', hardware_version: '2', rated_power_w: 6000, last_data_at: freshTs, last_synced_at: freshTs },
  { id: 'b-do', plant_id: 'b-po', provider: 'hyxi', active: true, device_type: 'STRING_INVERTER', status: 'online', name: 'Inv O', model: 'M1', serial_number: 'SN-O', software_version: '1', hardware_version: '1', rated_power_w: 5000, last_data_at: staleTs, last_synced_at: staleTs },
];

const B_LATEST = [
  { device_id: 'b-dh', collected_at: freshTs, updated_at: freshTs, ac_power: 100, pv_power: 110, load_power: 50, grid_power: null, grid_import_power: 5, grid_export_power: 1, battery_power: null, battery_charge_power: null, battery_discharge_power: null, battery_soc: 80, today_energy: null, total_energy: null, raw_data: null, device: { device_type: 'STRING_INVERTER' } },
  { device_id: 'b-dg', collected_at: freshTs, updated_at: freshTs, ac_power: 200, pv_power: 210, load_power: null, grid_power: null, grid_import_power: null, grid_export_power: null, battery_power: null, battery_charge_power: null, battery_discharge_power: null, battery_soc: null, today_energy: 3, total_energy: 30, raw_data: { elocalLoadToday: 1.5 }, device: { device_type: 'MIN' } },
  { device_id: 'b-dc', collected_at: freshTs, updated_at: freshTs, ac_power: 0, pv_power: null, load_power: null, grid_power: null, grid_import_power: null, grid_export_power: null, battery_power: null, battery_charge_power: null, battery_discharge_power: null, battery_soc: null, today_energy: null, total_energy: null, raw_data: null, device: { device_type: 'COLLECTOR' } },
  { device_id: 'b-da', collected_at: freshTs, updated_at: freshTs, ac_power: 0, pv_power: 0, load_power: null, grid_power: null, grid_import_power: null, grid_export_power: null, battery_power: null, battery_charge_power: null, battery_discharge_power: null, battery_soc: null, today_energy: null, total_energy: null, raw_data: { status: 3 }, device: { device_type: 'MIN' } },
  { device_id: 'b-do', collected_at: staleTs, updated_at: staleTs, ac_power: 0, pv_power: 0, load_power: 10, grid_power: null, grid_import_power: null, grid_export_power: null, battery_power: null, battery_charge_power: null, battery_discharge_power: null, battery_soc: null, today_energy: null, total_energy: null, raw_data: null, device: { device_type: 'STRING_INVERTER' } },
];

const B_SUMMARIES = [
  { plant_id: 'b-ph', today_generation_kwh: 10, month_generation_kwh: 100, year_generation_kwh: 1000, total_generation_kwh: 9000, today_consumption_kwh: 5, month_consumption_kwh: 50, year_consumption_kwh: 500, total_consumption_kwh: 4500 },
  { plant_id: 'b-pg', today_generation_kwh: 99, month_generation_kwh: 99, year_generation_kwh: 99, total_generation_kwh: 30, today_consumption_kwh: 99, month_consumption_kwh: 99, year_consumption_kwh: 99, total_consumption_kwh: 99 },
  { plant_id: 'b-po', today_generation_kwh: 7, month_generation_kwh: 70, year_generation_kwh: 700, total_generation_kwh: 7000, today_consumption_kwh: 3, month_consumption_kwh: 30, year_consumption_kwh: 300, total_consumption_kwh: 3000 },
];

function programSlimTables() {
  resetSupabaseFake();
  __setRows('plants', B_PLANTS);
  __setRows('devices', B_DEVICES);
  __setRows('device_latest_data', B_LATEST);
  __setRows('plant_energy_summary', B_SUMMARIES);
}

const { getPlantsOverview, getPlantOverview } = supportsModuleMocks
  ? await import('../src/services/plantsOverview.service.js')
  : {};

test('B1: lista con filas slim conserva estados, potencias y energía HYXi/Growatt', { skip: !supportsModuleMocks }, async () => {
  programSlimTables();
  const rows = await getPlantsOverview(null);
  assert.deepEqual(rows.map(row => row.id), ['b-ph', 'b-pg', 'b-po']);
  const byId = new Map(rows.map(row => [row.id, row]));

  const ph = byId.get('b-ph');
  assert.equal(ph.status, 'online');
  assert.equal(ph.current_power_w, 100);
  assert.equal(ph.today_generation_kwh, 10);
  assert.equal(ph.today_consumption_kwh, 5);
  assert.equal(ph.inverter_total, 1);
  assert.equal(ph.inverter_online, 1);
  assert.equal(ph.data_status, 'fresh');

  const pg = byId.get('b-pg');
  assert.equal(pg.status, 'online');
  assert.equal(pg.current_power_w, 200);
  assert.equal(pg.today_generation_kwh, 3);
  assert.equal(pg.today_consumption_kwh, 1.5);
  assert.equal(pg.inverter_total, 2);
  assert.equal(pg.inverter_online, 0);
  assert.equal(pg.inverter_unknown, 1);
  assert.equal(pg.inverter_alarm, 1);

  const po = byId.get('b-po');
  assert.equal(po.status, 'offline');
  assert.equal(po.current_power_w, null);
  assert.equal(po.today_generation_kwh, 7);
});

test('B2: detalle Growatt con filas slim conserva metadata, alarmas y dispositivos', { skip: !supportsModuleMocks }, async () => {
  programSlimTables();
  const overview = await getPlantOverview('b-pg');
  assert.equal(overview.plant.id, 'b-pg');
  assert.equal(overview.plant.platform_created_at, '2024-01-01');
  assert.equal(overview.energy.today_generation_kwh, 3);
  assert.equal(overview.energy.total_generation_kwh, 30);
  assert.deepEqual(overview.devices.map(device => device.id), ['b-dc', 'b-da', 'b-dg']);
  assert.equal(overview.realtime.current_ac_power_w, 200);
});

test('B3: detalle HYXi con filas slim conserva energía de resumen y planta', { skip: !supportsModuleMocks }, async () => {
  programSlimTables();
  const overview = await getPlantOverview('b-ph');
  assert.equal(overview.plant.name, 'PH');
  assert.equal(overview.plant.capacity_kwp, 10);
  assert.equal(overview.energy.today_generation_kwh, 10);
  assert.equal(overview.energy.month_generation_kwh, 100);
  assert.equal(overview.realtime.battery_soc, 80);
  assert.equal(overview.devices.length, 1);
  assert.equal(overview.devices[0].rated_power_w, 5000);
});
