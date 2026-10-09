import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  operationalPlantStatus,
  plantHasFreshOperationalTelemetry,
} from '../src/services/telemetryFreshness.js';

const now = Date.now();
const freshTs = new Date(now - 5 * 60 * 1000).toISOString();
const staleTs = new Date(now - 6 * 60 * 60 * 1000).toISOString();

function device(id, plantId, provider, type) {
  return { id, plant_id: plantId, provider, device_type: type, status: 'online', active: true };
}

function latest(deviceId, collectedAt, extra = {}) {
  return { device_id: deviceId, collected_at: collectedAt, updated_at: collectedAt, ac_power: 0, ...extra };
}

const byId = rows => new Map(rows.map(row => [row.device_id, row]));

// A. online + fresh → online operativo
test('A: planta online con inversor fresh sigue online', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('d', 'p', 'hyxi', 'STRING_INVERTER')];
  const rows = byId([latest('d', freshTs)]);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'online');
});

// D. 0 W con telemetría reciente es válido
test('D: potencia 0 con telemetría fresh permite online', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('d', 'p', 'hyxi', 'HYBRID_INVERTER')];
  const rows = byId([latest('d', freshTs, { ac_power: 0 })]);
  assert.equal(plantHasFreshOperationalTelemetry(devices, id => rows.get(id), now), true);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'online');
});

// B/C. online + stale/sin datos → no online (cae a offline, nunca a alarm)
test('B/C: planta online con inversor stale o sin fila no es online', () => {
  const plant = { id: 'p', status: 'online' };
  const staleDevices = [device('d', 'p', 'hyxi', 'STRING_INVERTER')];
  const staleRows = byId([latest('d', staleTs)]);
  assert.equal(operationalPlantStatus(plant, staleDevices, id => staleRows.get(id), now), 'offline');
  assert.equal(operationalPlantStatus(plant, staleDevices, () => undefined, now), 'offline');
});

// F. Growatt nocturno: MIN stale + meter fresh → NO online
test('F: Growatt online con MIN stale no es online aunque el meter esté fresh', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [
    device('min', 'p', 'growatt', 'min'),
    device('met', 'p', 'growatt', 'meter'),
  ];
  const rows = byId([latest('min', staleTs), latest('met', freshTs)]);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'offline');
});

// G. HYXi: deviceState online con collect viejo → NO online
test('G: HYXi online con collected_at stale no es online', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [{ ...device('d', 'p', 'hyxi', 'STRING_INVERTER'), status: 'online' }];
  const rows = byId([latest('d', staleTs)]);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'offline');
});

// E. alarma real se conserva
test('E: planta en alarm sigue en alarm aunque esté stale', () => {
  const plant = { id: 'p', status: 'alarm' };
  const devices = [device('d', 'p', 'hyxi', 'STRING_INVERTER')];
  const rows = byId([latest('d', staleTs)]);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'alarm');
});

test('excluidos: COLLECTOR/meter/inactivos por tipo no cuentan', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [
    device('c', 'p', 'hyxi', 'COLLECTOR'),
    device('m', 'p', 'growatt', 'meter'),
  ];
  const rows = byId([latest('c', freshTs), latest('m', freshTs)]);
  assert.equal(plantHasFreshOperationalTelemetry(devices, id => rows.get(id), now), false);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'offline');
});

// ---- Integración con datos fijos ----
const plants = [
  { id: 'PH', name: 'H-fresh', provider: 'hyxi', status: 'online', active: true, capacity_kwp: 1 },
  { id: 'PS', name: 'G-stale', provider: 'growatt', status: 'online', active: true, capacity_kwp: 1 },
  { id: 'PN', name: 'H-nodata', provider: 'hyxi', status: 'online', active: true, capacity_kwp: 1 },
  { id: 'PHS', name: 'H-stale', provider: 'hyxi', status: 'online', active: true, capacity_kwp: 1 },
  { id: 'PA', name: 'H-alarm', provider: 'hyxi', status: 'alarm', active: true, capacity_kwp: 1 },
  { id: 'PO', name: 'H-off', provider: 'hyxi', status: 'offline', active: true, capacity_kwp: 1 },
];
const fixtureDevices = [
  device('dH', 'PH', 'hyxi', 'STRING_INVERTER'),
  device('dGm', 'PS', 'growatt', 'min'),
  device('dGt', 'PS', 'growatt', 'meter'),
  device('dN', 'PN', 'hyxi', 'STRING_INVERTER'),
  device('dS', 'PHS', 'hyxi', 'STRING_INVERTER'),
  device('dA', 'PA', 'hyxi', 'STRING_INVERTER'),
  device('dO', 'PO', 'hyxi', 'STRING_INVERTER'),
];
const fixtureLatest = [
  latest('dH', freshTs, { ac_power: 0 }),
  latest('dGm', staleTs),
  latest('dGt', freshTs),
  latest('dS', staleTs),
  latest('dA', staleTs),
  latest('dO', staleTs),
];

mock.module('../src/repositories/dashboard.repository.js', {
  namedExports: {
    async readDashboardData() {
      return { plants, devices: fixtureDevices, latest: fixtureLatest, energy: [] };
    },
  },
});
mock.module('../src/repositories/plants.repository.js', {
  namedExports: { async listStoredPlantsOverview() { return plants; } },
});
mock.module('../src/repositories/devices.repository.js', {
  namedExports: { async listStoredDevicesOverview() { return fixtureDevices; } },
});
mock.module('../src/repositories/deviceLatestData.repository.js', {
  namedExports: { async listDeviceLatestDataOverview() { return fixtureLatest; } },
});
mock.module('../src/repositories/plantEnergySummary.repository.js', {
  namedExports: { async listPlantEnergySummariesOverview() { return []; } },
});
mock.module('../src/repositories/plantPowerIntervals.repository.js', {
  namedExports: { async latestPlantConsumption() { return null; } },
});

const { getDashboardSummary } = await import('../src/services/dashboard.service.js');
const { getPlantsOverview } = await import('../src/services/plantsOverview.service.js');

// H. dashboard y overview coinciden en la misma foto
test('H: dashboard clasifica online solo con fresh y conserva buckets', async () => {
  const summary = await getDashboardSummary();
  assert.equal(summary.total_plants, 6);
  assert.equal(summary.online_plants, 1);
  assert.equal(summary.offline_plants, 4);
  assert.equal(summary.alarm_plants, 1);
  assert.equal(summary.unknown_plants ?? 0, 0);
});

test('H: plants overview deriva el mismo estado por planta', async () => {
  const rows = await getPlantsOverview();
  const byPlant = new Map(rows.map(row => [row.id, row.status]));
  assert.equal(byPlant.get('PH'), 'online');
  for (const id of ['PS', 'PN', 'PHS', 'PO']) assert.equal(byPlant.get(id), 'offline');
  assert.equal(byPlant.get('PA'), 'alarm');
});

// I. KPIs de telemetría mantienen universo de dispositivos
test('I: telemetry_current/stale/no_data inalterados', async () => {
  const summary = await getDashboardSummary();
  assert.equal(summary.telemetry_current, 2);
  assert.equal(summary.telemetry_stale, 4);
  assert.equal(summary.telemetry_no_data, 1);
  assert.equal(summary.total_devices, 7);
});
