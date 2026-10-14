import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createScheduledSync } from '../src/services/scheduledSync.js';

let providerCall;
let writes = 0;
let deviceReads = 0;
let detailCalls = 0;
const device = { id: 'device', device_type: 'STRING_INVERTER', serial_number: 'serial' };
mock.module('../src/providers/hyxi/HyxiProvider.js', {
  exports: { HyxiProvider: class {
    getDeviceRealtime() { return providerCall(); }
    async getDevice() { detailCalls += 1; return { data: {} }; }
  } },
});
mock.module('../src/providers/growatt/GrowattProvider.js', {
  exports: { GrowattProvider: class { queryLastData() { return providerCall(); } } },
});
mock.module('../src/config/env.js', { exports: { env: {} } });
mock.module('../src/repositories/devices.repository.js', {
  exports: {
    listActiveHyxiDevices: async () => { deviceReads += 1; return [device]; },
    listActiveGrowattDevices: async () => { deviceReads += 1; return [device]; },
    updateDeviceInfo: async () => {},
    updateGrowattDeviceName: async () => {},
    updateGrowattDeviceTelemetryState: async () => {},
  },
});
mock.module('../src/repositories/deviceLatestData.repository.js', {
  exports: {
    upsertDeviceLatestData: async () => { writes += 1; },
    upsertGrowattLatestData: async () => { writes += 1; },
  },
});
mock.module('../src/providers/hyxi/normalizeHyxiDeviceRealtime.js', {
  exports: { normalizeHyxiDeviceRealtime: () => ({ collected_at: '2026-10-13T12:00:00Z' }) },
});
mock.module('../src/providers/hyxi/normalizeHyxiDeviceInfo.js', {
  exports: { normalizeHyxiDeviceInfo: () => ({}) },
});
mock.module('../src/providers/growatt/normalizeGrowattLatestData.js', {
  exports: { normalizeGrowattLatestData: () => ({ collected_at: '2026-10-13T12:00:00Z' }) },
});
mock.module('../src/services/growattAlarmSync.service.js', {
  exports: { syncGrowattAlarmSnapshot: async () => {} },
});
const { syncHyxiRealtime } = await import('../src/services/hyxiRealtime.service.js');
const { syncHyxiDeviceDetails } = await import('../src/services/hyxiDeviceDetails.service.js');
const { syncGrowattLatest } = await import('../src/services/growattLatest.service.js');

for (const sync of [syncHyxiRealtime, syncGrowattLatest]) {
  test(`${sync.name}: automatic timeout and manual calls share one real write pass`, async () => {
    writes = 0;
    deviceReads = 0;
    let release;
    providerCall = () => new Promise(resolve => { release = resolve; });
    const run = createScheduledSync({
      name: sync.name, sync, timeoutMs: 10, logger: { info() {}, warn() {}, error() {} },
    });
    const timeout = await run();
    assert.equal(timeout.error.code, 'SYNC_TIMEOUT');
    const manual = sync();
    assert.deepEqual(await run(), { skipped: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deviceReads, 1);
    assert.equal(writes, 0);
    release({ data: {}, payload: { data: [{ deviceSn: 'serial' }] } });
    assert.equal((await manual).updated, 1);
    assert.equal(writes, 1);
    await new Promise(resolve => setImmediate(resolve));
    providerCall = async () => ({ data: {}, payload: { data: [{ deviceSn: 'serial' }] } });
    assert.equal((await run()).updated, 1);
    assert.equal(writes, 2);
  });
}

test('different HYXi device writers queue; partial failure retains counts and releases exclusion', async () => {
  deviceReads = 0;
  detailCalls = 0;
  let reject;
  providerCall = () => new Promise((_, fail) => { reject = fail; });
  const realtime = syncHyxiRealtime();
  await new Promise(resolve => setImmediate(resolve));
  const details = syncHyxiDeviceDetails();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deviceReads, 1, 'details must wait before reading device metadata');
  assert.equal(detailCalls, 0);
  reject(new Error('simulated provider failure'));
  assert.equal((await realtime).failed, 1);
  assert.equal((await details).updated, 1);
  assert.equal(detailCalls, 1);
});
