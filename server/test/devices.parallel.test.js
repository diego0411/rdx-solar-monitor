import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let calls, deviceResolve, latestResolve, latestReject;
mock.module('../src/config/supabase.js', { exports: { supabase: {} } });
mock.module('../src/repositories/devices.repository.js', { exports: {
  listStoredDevices(scope) { calls.push(['devices', scope]); return new Promise(resolve => { deviceResolve = resolve; }); },
} });
mock.module('../src/repositories/deviceLatestData.repository.js', { exports: {
  listDeviceLatestData(scope) { calls.push(['latest', scope]); return new Promise((resolve, reject) => { latestResolve = resolve; latestReject = reject; }); },
} });
const { getDevices } = await import('../src/controllers/devices.controller.js');
const { telemetryFreshness } = await import('../src/services/telemetryFreshness.js');

test('devices and telemetry start together with identical scope and preserve contract/zero/null', async () => {
  calls = [];
  const scope = new Set(['p']);
  let body;
  const pending = getDevices({ scope: { plantIds: scope } }, { json(value) { body = value; } });
  assert.deepEqual(calls, [['devices', scope], ['latest', scope]]);
  deviceResolve([{ id: 'd', plant_id: 'p', active: true, plant: { name: 'Plant' } }]);
  await Promise.resolve();
  assert.equal(body, undefined);
  latestResolve([{ device_id: 'd', pv_power: 0, load_power: null, battery_soc: 0 }]);
  await pending;
  assert.deepEqual(body, [{ id: 'd', plant_id: 'p', active: true, provider: null,
    serial_number: null, name: null, model: null, device_type: null, status: null,
    last_data_at: null, last_synced_at: null, plant_name: 'Plant', collected_at: null,
    pv_power: 0, ac_power: null, load_power: null, battery_soc: 0, ...telemetryFreshness(null) }]);
});

test('failed telemetry read preserves 503 response', async () => {
  calls = [];
  let status, body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  const pending = getDevices({ scope: { plantIds: null } }, res);
  deviceResolve([]);
  latestReject(new Error('database unavailable'));
  await pending;
  assert.equal(status, 503);
  assert.deepEqual(body, { error: 'No se pudieron consultar los dispositivos almacenados' });
});
