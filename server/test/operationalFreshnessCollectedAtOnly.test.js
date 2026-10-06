import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  operationalPlantStatus,
  plantHasFreshOperationalTelemetry,
  telemetryFreshness,
} from '../src/services/telemetryFreshness.js';
import { growattDeviceState } from '../src/providers/growatt/growattStates.js';

// updated_at recién escrito por el upsert: NO es medición del inversor
// y nunca debe producir frescura operativa.
const now = Date.now();
const freshTs = new Date(now - 5 * 60 * 1000).toISOString();
const updatedFreshTs = new Date(now - 1 * 60 * 1000).toISOString();
const staleTs = new Date(now - 6 * 60 * 60 * 1000).toISOString();

function device(id, plantId, provider, type) {
  return { id, plant_id: plantId, provider, device_type: type, status: 'online', active: true };
}

function row(deviceId, collectedAt, extra = {}) {
  return { device_id: deviceId, collected_at: collectedAt, updated_at: updatedFreshTs, ac_power: 100, ...extra };
}

const byId = rows => new Map(rows.map(entry => [entry.device_id, entry]));

// 1. collected fresh + updated fresh → fresh
test('1: MIN Growatt con collected_at fresh es fresh aunque updated_at también lo sea', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('min', 'p', 'growatt', 'MIN')];
  const rows = byId([row('min', freshTs)]);
  assert.equal(plantHasFreshOperationalTelemetry(devices, id => rows.get(id), now), true);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'online');
});

// 2. collected stale + updated fresh → stale
test('2: MIN Growatt con collected_at stale es stale aunque updated_at esté recién actualizado', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('min', 'p', 'growatt', 'MIN')];
  const rows = byId([row('min', staleTs)]);
  assert.equal(plantHasFreshOperationalTelemetry(devices, id => rows.get(id), now), false);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'offline');
});

// 3. collected NULL + updated fresh → NOT fresh
test('3: MIN Growatt con collected_at NULL nunca es fresh aunque updated_at sea fresh', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('min', 'p', 'growatt', 'MIN')];
  const rows = byId([row('min', null)]);
  assert.equal(telemetryFreshness(null, now).data_status, 'no_data');
  assert.equal(plantHasFreshOperationalTelemetry(devices, id => rows.get(id), now), false);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'offline');
});

// 4. collected fresh + power 0 → fresh
test('4: MIN Growatt con collected_at fresh y potencia 0 sigue fresh', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('min', 'p', 'growatt', 'MIN')];
  const rows = byId([row('min', freshTs, { ac_power: 0, pv_power: 0 })]);
  assert.equal(plantHasFreshOperationalTelemetry(devices, id => rows.get(id), now), true);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'online');
});

// 5. meter con updated fresh nunca mantiene la planta online
test('5: meter Growatt fresh no mantiene la planta online sin MIN fresh', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [
    device('min', 'p', 'growatt', 'MIN'),
    device('met', 'p', 'growatt', 'meter'),
  ];
  const rows = byId([row('min', staleTs), row('met', freshTs)]);
  assert.equal(plantHasFreshOperationalTelemetry(devices, id => rows.get(id), now), false);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'offline');
});

// 6. caso nocturno: plant online + MIN stale + updated recién actualizado → offline
test('6: planta Growatt online con MIN stale de noche es offline operativa', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('min', 'p', 'growatt', 'MIN')];
  const rows = byId([{ device_id: 'min', collected_at: staleTs, updated_at: new Date(now).toISOString() }]);
  assert.equal(operationalPlantStatus(plant, devices, id => rows.get(id), now), 'offline');
});

// 7. HYXi sin degradación (nunca usó updated_at)
test('7: HYXi conserva su comportamiento con collected_at', () => {
  const plant = { id: 'p', status: 'online' };
  const devices = [device('d', 'p', 'hyxi', 'STRING_INVERTER')];
  assert.equal(
    operationalPlantStatus(plant, devices, id => byId([row('d', freshTs)]).get(id), now),
    'online',
  );
  assert.equal(
    operationalPlantStatus(plant, devices, id => byId([row('d', staleTs)]).get(id), now),
    'offline',
  );
  assert.equal(
    operationalPlantStatus(plant, devices, () => undefined, now),
    'offline',
  );
});

// Estado de dispositivo: sin collected_at no hay online aunque updated_at sea fresh
test('device: growattDeviceState sin collected_at no es online aunque updated_at sea fresh', () => {
  assert.equal(
    growattDeviceState({ collected_at: null, updated_at: updatedFreshTs, raw_data: { status: 1, statusText: 'Normal', lost: false } }, now),
    'unknown',
  );
  assert.equal(
    growattDeviceState({ collected_at: staleTs, updated_at: updatedFreshTs, raw_data: { status: 1, statusText: 'Normal', lost: false } }, now),
    'unknown',
  );
  assert.equal(
    growattDeviceState({ collected_at: freshTs, updated_at: updatedFreshTs, raw_data: { status: 1, statusText: 'Normal', lost: false } }, now),
    'online',
  );
});

// ---- 8. Dashboard y Plants Overview coinciden ----
const plants = [
  { id: 'PGF', name: 'G-fresh', provider: 'growatt', status: 'online', active: true, capacity_kwp: 1 },
  { id: 'PGN', name: 'G-null', provider: 'growatt', status: 'online', active: true, capacity_kwp: 1 },
  { id: 'PGS', name: 'G-stale', provider: 'growatt', status: 'online', active: true, capacity_kwp: 1 },
];
const fixtureDevices = [
  { ...device('dF', 'PGF', 'growatt', 'MIN'), status: 'unknown' },
  { ...device('dN', 'PGN', 'growatt', 'MIN'), status: 'unknown' },
  { ...device('dS', 'PGS', 'growatt', 'MIN'), status: 'unknown' },
];
const fixtureLatest = [
  // fresh real: collected + updated frescos
  { device_id: 'dF', device_type: 'MIN', collected_at: freshTs, updated_at: updatedFreshTs, ac_power: 100, today_energy: 1 },
  // falsa frescura histórica: collected NULL + updated fresh
  { device_id: 'dN', device_type: 'MIN', collected_at: null, updated_at: updatedFreshTs, ac_power: 100, today_energy: 1 },
  // stale real: collected viejo + updated recién tocado por el upsert
  { device_id: 'dS', device_type: 'MIN', collected_at: staleTs, updated_at: updatedFreshTs, ac_power: 0, today_energy: 1 },
];

mock.module('../src/repositories/dashboard.repository.js', {
  namedExports: {
    async readDashboardData() {
      return { plants, devices: fixtureDevices, latest: fixtureLatest, energy: [] };
    },
  },
});
mock.module('../src/repositories/plants.repository.js', {
  namedExports: { async listStoredPlants() { return plants; } },
});
mock.module('../src/repositories/devices.repository.js', {
  namedExports: { async listStoredDevices() { return fixtureDevices; } },
});
mock.module('../src/repositories/deviceLatestData.repository.js', {
  namedExports: { async listDeviceLatestData() { return fixtureLatest; } },
});
mock.module('../src/repositories/plantEnergySummary.repository.js', {
  namedExports: { async listPlantEnergySummaries() { return []; } },
});
mock.module('../src/repositories/plantPowerIntervals.repository.js', {
  namedExports: { async latestPlantConsumption() { return null; } },
});

const { getDashboardSummary } = await import('../src/services/dashboard.service.js');
const { getPlantsOverview } = await import('../src/services/plantsOverview.service.js');

test('8: dashboard y overview coinciden: solo collected_at fresh es online', async () => {
  const summary = await getDashboardSummary();
  assert.equal(summary.online_plants, 1);
  assert.equal(summary.offline_plants, 2);

  const rows = await getPlantsOverview();
  const byPlant = new Map(rows.map(entry => [entry.id, entry.status]));
  assert.equal(byPlant.get('PGF'), 'online');
  assert.equal(byPlant.get('PGN'), 'offline');
  assert.equal(byPlant.get('PGS'), 'offline');
});
