import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

const now = Date.now();
const min = 60 * 1000;

const plants = [
  { id: 'p1', provider: 'growatt', status: 'online', capacity_kwp: 10, name: 'Planta A' },
  { id: 'p2', provider: 'growatt', status: 'offline', capacity_kwp: 5, name: 'Planta B' },
  { id: 'p3', provider: 'growatt', status: 'unknown', capacity_kwp: 7, name: 'Planta C' },
  { id: 'p4', provider: 'hyxi', status: 'online', capacity_kwp: 20, name: 'Planta D' },
  { id: 'p5', provider: 'hyxi', status: 'alarm', capacity_kwp: 3, name: 'Planta E' },
];

const devices = [
  { id: 'd1', plant_id: 'p1', provider: 'growatt', active: true, status: 'online', device_type: 'MIN', plant: { timezone: 'UTC' } },
  { id: 'd2', plant_id: 'p2', provider: 'growatt', active: true, status: 'offline', device_type: 'MIN', plant: { timezone: 'UTC' } },
  { id: 'd3', plant_id: 'p3', provider: 'growatt', active: true, status: 'unknown', device_type: 'MIN', plant: { timezone: 'UTC' } },
  { id: 'd4', plant_id: 'p1', provider: 'growatt', active: false, status: 'online', device_type: 'MIN', plant: { timezone: 'UTC' } },
  { id: 'd5', plant_id: 'p4', provider: 'hyxi', active: true, status: 'online', device_type: 'STRING_INVERTER', plant: { timezone: 'UTC' } },
  { id: 'd6', plant_id: 'p4', provider: 'hyxi', active: true, status: 'online', device_type: 'COLLECTOR', plant: { timezone: 'UTC' } },
  { id: 'd7', plant_id: 'p5', provider: 'hyxi', active: true, status: 'offline', device_type: 'STRING_INVERTER', plant: { timezone: 'UTC' } },
];

const latest = [
  { device_id: 'd1', pv_power: 1000, collected_at: new Date(now - 1 * min).toISOString(), updated_at: new Date(now).toISOString(), today_energy: 5 },
  { device_id: 'd2', pv_power: 0, collected_at: new Date(now - 120 * min).toISOString(), updated_at: new Date(now - 120 * min).toISOString(), today_energy: 2 },
  { device_id: 'd3', pv_power: 300, collected_at: null, updated_at: new Date(now).toISOString(), today_energy: 1 },
  { device_id: 'd5', pv_power: 500, collected_at: new Date(now - 2 * min).toISOString(), updated_at: new Date(now).toISOString(), today_energy: 7 },
  { device_id: 'd6', pv_power: 0, collected_at: new Date(now - 200 * min).toISOString(), updated_at: new Date(now - 200 * min).toISOString(), today_energy: 0 },
];

const energy = [
  { plant_id: 'p1', provider: 'growatt', today_generation_kwh: 5, month_generation_kwh: 30, year_generation_kwh: 300, total_generation_kwh: 900 },
  { plant_id: 'p4', provider: 'hyxi', today_generation_kwh: 7.5, month_generation_kwh: 40, year_generation_kwh: 400, total_generation_kwh: 800 },
];

let getDashboardSummary = null;

if (supportsModuleMocks) {
  mock.module('../src/repositories/dashboard.repository.js', {
    exports: {
      async readDashboardData() {
        return { plants, devices, latest, energy };
      },
    },
  });

  ({ getDashboardSummary } = await import('../src/services/dashboard.service.js'));
}

test('nuevos campos de telemetría y estados de planta', { skip: !supportsModuleMocks }, async () => {
  const summary = await getDashboardSummary();

  assert.equal(summary.total_plants, 5);
  assert.equal(summary.online_plants, 2);
  assert.equal(summary.offline_plants, 1);
  assert.equal(summary.alarm_plants, 1);
  assert.equal(summary.unknown_plants, 1);

  assert.equal(summary.telemetry_current, 3);
  assert.equal(summary.telemetry_stale, 2);
  assert.equal(summary.telemetry_no_data, 1);

  assert.equal(
    summary.telemetry_current
      + summary.telemetry_stale
      + summary.telemetry_no_data,
    summary.total_devices,
  );

  const growatt = summary.providers.find(row => row.provider === 'growatt');
  const hyxi = summary.providers.find(row => row.provider === 'hyxi');

  assert.equal(growatt.unknown_plants, 1);
  assert.equal(growatt.telemetry_current, 2);
  assert.equal(growatt.telemetry_stale, 1);
  assert.equal(growatt.telemetry_no_data, 0);

  assert.equal(hyxi.unknown_plants, 0);
  assert.equal(hyxi.telemetry_current, 1);
  assert.equal(hyxi.telemetry_stale, 1);
  assert.equal(hyxi.telemetry_no_data, 1);
});

test('top 5 plantas ordenadas por generación de hoy con datos reales', { skip: !supportsModuleMocks }, async () => {
  const summary = await getDashboardSummary();

  assert.deepEqual(
    summary.top_plants.map(plant => plant.name),
    ['Planta D', 'Planta A', 'Planta B', 'Planta C'],
  );

  assert.deepEqual(
    summary.top_plants.map(plant => plant.today_generation_kwh),
    [7.5, 5, 2, 1],
  );

  const sumTop = summary.top_plants.reduce(
    (total, plant) => total + plant.today_generation_kwh,
    0,
  );

  assert.equal(sumToFixed(sumTop), summary.today_generation_kwh);

  for (const plant of summary.top_plants) {
    assert.ok('provider' in plant);
    assert.ok('plant_id' in plant);
    assert.ok(plant.today_generation_kwh > 0);
  }

  assert.ok(
    summary.top_plants.length <= 5,
  );
});

function sumToFixed(value) {
  return Number(value.toFixed(2));
}