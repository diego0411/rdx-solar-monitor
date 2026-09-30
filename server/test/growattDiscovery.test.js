import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeGrowattDiscovery } from '../src/providers/growatt/normalizeGrowattDiscovery.js';

let plants, stored, entries, checks, meterCalls, hold, failPlant, identity;
const entry = { device_sn: 'TEST-MIN', type: 7, status: 1, device_id: 123, datalogger_sn: 'LOGGER' };
const check = { result: 1, model: 'MIN 10000TL-X2', normalPower: 10000, deviceType: 22, dtc: 5201, haveMeter: 1 };
mock.module('../src/repositories/plants.repository.js', { exports: {
  async listActiveGrowattPlants() { if (hold) await hold; return plants; },
} });
mock.module('../src/repositories/devices.repository.js', { exports: {
  async listStoredDevices() { if (hold) await hold; return stored; },
  async upsertGrowattDevice(device) {
    const index = stored.findIndex(row => row.external_device_id === device.external_device_id);
    if (index < 0) { stored.push({ ...device }); return 'inserted'; }
    stored[index] = { ...stored[index], ...device }; return 'updated';
  },
} });
mock.module('../src/services/growattDevices.service.js', { exports: {
  async linkPlantMeters(plant, real) { meterCalls.push({ plant, real }); },
} });
mock.module('../src/providers/growatt/GrowattProvider.js', { exports: {
  GrowattProvider: class {
    async listPlantDevices(id) { if (id === failPlant) throw new Error('private upstream error'); return entries; }
    async checkDeviceBySn(serial) { checks.push(serial); return identity; }
  },
} });
const { discoverGrowattPlant } = await import('../src/services/growattDiscovery.service.js');
const runGrowattDiscovery = () => discoverGrowattPlant(plants[0]);
beforeEach(() => {
  plants = [{ id: 'plant', external_plant_id: 'external' }]; stored = []; entries = [];
  checks = []; meterCalls = []; hold = null; failPlant = null; identity = check;
});

test('empty plant is retried next cycle, upsert links new device and repeated discovery is idempotent', async () => {
  assert.equal((await runGrowattDiscovery()).inserted, 0);
  entries = [entry, { device_sn: 'meter', type: 3 }];
  assert.equal((await runGrowattDiscovery()).inserted, 1);
  assert.equal(stored[0].plant_id, 'plant');
  assert.equal(stored[0].device_type, 'min');
  assert.equal(stored[0].serial_number, 'TEST-MIN');
  assert.equal(stored[0].rated_power_w, 10000);
  assert.deepEqual(stored[0].metadata, { v1_type: 7, v1_device_id: 123, v1_status: 1,
    datalogger_sn: 'LOGGER', check_device_type: 22, dtc: 5201, have_meter: 1 });
  stored[0].software_version = 'preserve'; stored[0].status = 'online'; stored[0].metadata.keep = true;
  assert.equal((await runGrowattDiscovery()).updated, 1);
  assert.equal(stored.length, 1); assert.deepEqual(checks, ['TEST-MIN']);
  assert.equal(stored[0].software_version, 'preserve'); assert.equal(stored[0].status, 'online');
  assert.equal(stored[0].metadata.keep, true);
  assert.deepEqual(meterCalls.at(-1).real, [entry]);
});

test('type 7 alone never establishes min, and placeholder is never normalized', async () => {
  assert.equal(normalizeGrowattDiscovery(entry, 'plant', null, null), null);
  assert.equal(normalizeGrowattDiscovery({ device_sn: 'meter' }, 'plant', null, check), null);
  identity = { result: 1, model: 'UNKNOWN', deviceType: 22 };
  entries = [entry];
  assert.equal((await runGrowattDiscovery()).unidentified, 1);
  assert.equal(stored.length, 0);
});

test('running guard skips overlap and releases after completion', async () => {
  let release; hold = new Promise(resolve => { release = resolve; });
  const first = runGrowattDiscovery();
  assert.deepEqual(await runGrowattDiscovery(), { skipped: true });
  release(); await first; hold = null;
  assert.equal((await runGrowattDiscovery()).plants, 1);
});

test('plant failure does not block later plants and no upstream errors escape', async () => {
  plants.unshift({ id: 'bad', external_plant_id: 'bad' }); failPlant = 'bad'; entries = [entry];
  const result = await runGrowattDiscovery();
  assert.equal(result.failed, 1); assert.equal(result.inserted, 0);
  plants.shift();
  assert.equal((await runGrowattDiscovery()).inserted, 1);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('existing unlinked identity is reused; assigned devices are not moved', async () => {
  stored = [{ provider: 'growatt', serial_number: 'TEST-MIN', external_device_id: 'legacy',
    device_type: 'min', plant_id: null, metadata: { keep: 1 }, model: 'Known model' }];
  entries = [entry];
  await runGrowattDiscovery();
  assert.equal(stored.length, 1); assert.equal(stored[0].external_device_id, 'legacy');
  assert.equal(stored[0].model, 'Known model'); assert.equal(checks.length, 0);
  plants = [{ id: 'other', external_plant_id: 'other' }];
  assert.equal((await runGrowattDiscovery()).failed, 1);
  assert.equal(stored[0].plant_id, 'plant');
});

test('scheduler starts worker inside ENABLE_SCHEDULERS; legacy zero links not completed', async () => {
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('    startGrowattDiscoveryWorker();') > source.indexOf('startAutomaticSchedulers(env.ENABLE_SCHEDULERS'));
  assert.doesNotMatch(source, /setInterval\(runGrowattDiscovery/);
  const legacy = await readFile(new URL('../src/services/growattDevices.service.js', import.meta.url), 'utf8');
  assert.match(legacy, /if \(result.linked > 0\) progress\[plant.external_plant_id\] = true/);
});
