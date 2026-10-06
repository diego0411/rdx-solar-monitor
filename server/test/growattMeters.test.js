import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

import {
  buildMeterDevice,
  meterIdentity,
  normalizeGrowattMeterEntry,
  selectActiveMeter,
} from '../src/providers/growatt/normalizeGrowattMeter.js';

const supportsModuleMocks = typeof mock.module === 'function';

const SDM = {
  device_name: 'SDM_ONE', address: '1', lost: '1', device_type: '132',
  lastUpdateTime: '2026-09-15 03:14:36', datalogger_sn: 'ZOD5E6L3HT',
};
const CHNT = {
  device_name: 'CHNT_ONE', address: '1', lost: '1', device_type: '140',
  lastUpdateTime: '2026-09-28 06:27:57', datalogger_sn: 'ZOD5E6L3HT',
};
const LIVE = { ...CHNT, lost: '0' };

test('B: device_sn=meter nunca es identidad; la compuesta sí', () => {
  assert.equal(meterIdentity('ZOD5E6L3HT', '1'), 'growatt-meter:ZOD5E6L3HT:1');
  assert.notEqual(meterIdentity('ZOD5E6L3HT', '1'), meterIdentity('ZOD5E7903J', '1'));
  const device = buildMeterDevice('plant-1', normalizeGrowattMeterEntry(CHNT, 'ZOD5E6L3HT'), [
    normalizeGrowattMeterEntry(CHNT, 'ZOD5E6L3HT'),
  ]);
  assert.equal(device.external_device_id, 'growatt-meter:ZOD5E6L3HT:1');
  assert.equal(device.serial_number, 'growatt-meter:ZOD5E6L3HT:1');
  assert.equal(device.device_type, 'meter');
  assert.equal(device.status, 'unknown');
  assert.equal(device.active, true);
  assert.equal(device.model, 'CHNT_ONE');
  assert.equal(device.parent_serial_number, 'ZOD5E6L3HT');
  assert.equal(device.metadata.address, '1');
});

test('C+E: SDM stale + CHNT live misma address → un solo lógico CHNT, orden irrelevante', () => {
  for (const order of [[SDM, CHNT], [CHNT, SDM]]) {
    const { selected, candidates } = selectActiveMeter(order, 'ZOD5E6L3HT');
    assert.equal(selected.device_name, 'CHNT_ONE');
    assert.equal(candidates.length, 2);
  }
});

test('D: misma address en dos dataloggers → identidades distintas', () => {
  assert.notEqual(meterIdentity('ZOD5E6L3HT', '1'), meterIdentity('ZOD5E7903J', '1'));
});

test('selección prefiere lost=false y desempata determinísticamente', () => {
  const { selected } = selectActiveMeter([SDM, LIVE], 'ZOD5E6L3HT');
  assert.equal(selected.device_name, 'CHNT_ONE');
  const tie = selectActiveMeter([
    { device_name: 'B', address: '2', lost: '0', lastUpdateTime: '2026-09-28 06:00:00' },
    { device_name: 'A', address: '2', lost: '0', lastUpdateTime: '2026-09-28 06:00:00' },
  ], 'ZOD5E6L3HT');
  assert.equal(tie.selected.device_name, 'A');
});

// --- Mocks compartidos (registro único) ---
const linkCalls = { upserts: [], links: [] };
const linkState = {
  plantDevices: [],
  metersByLogger: {},
  meterError: null,
};
const latestCalls = { deviceTypes: [] };

function installMocks() {
  mock.module('node:fs', {
    exports: {
      existsSync: () => false,
      readFileSync: () => '{}',
      mkdirSync() {},
      writeFileSync() {},
    },
  });
  mock.module('../src/providers/growatt/GrowattProvider.js', {
    exports: {
      GrowattProvider: class {
        async listPlantDevices() {
          return linkState.plantDevices;
        }
        async listMeters(dataloggerSn) {
          if (linkState.meterError) throw linkState.meterError;
          return linkState.metersByLogger[dataloggerSn] ?? [];
        }
        async queryLastData(deviceType) {
          latestCalls.deviceTypes.push(deviceType);
          return { payload: { data: [] }, rateLimited: false };
        }
      },
    },
  });
  mock.module('../src/repositories/plants.repository.js', {
    exports: {
      async listActiveGrowattPlants() {
        return [{ id: 'plant-1', external_plant_id: '11137661' }];
      },
    },
  });
  mock.module('../src/repositories/devices.repository.js', {
    exports: {
      async upsertGrowattDevice(device) {
        linkCalls.upserts.push(device);
        return 'inserted';
      },
      async linkGrowattDeviceToPlant(serialNumber) {
        linkCalls.links.push(serialNumber);
        return 1;
      },
      async listActiveGrowattDevices() {
        return [
          { id: 'd1', serial_number: 'ZJP2E7P041', device_type: 'min', plant: { timezone: 'GMT-4' } },
          { id: 'd2', serial_number: 'growatt-meter:ZOD5E6L3HT:1', device_type: 'meter', plant: { timezone: 'GMT-4' } },
        ];
      },
      async updateGrowattDeviceName() {},
      async updateGrowattDeviceTelemetryState() {},
    },
  });
  mock.module('../src/repositories/deviceLatestData.repository.js', {
    exports: {
      async upsertDeviceLatestData() {},
      async upsertGrowattLatestData() {},
    },
  });
  // Episodios de alarma: el flujo syncGrowattLatest los toca best-effort;
  // en este archivo la telemetría es mockeada y ningún test necesita BD.
  mock.module('../src/repositories/alarms.repository.js', {
    exports: {
      async findActiveAlarm() { return null; },
      async createAlarmEpisode() { return { alarm: null, created: true }; },
      async touchActiveAlarm() { return null; },
      async resolveAlarm() { return null; },
      async listAlarms() { return []; },
    },
  });
  // env real lee .env vía fs (mockeado arriba); se sustituye por stub vacío:
  // los providers están mockeados y ningún test necesita credenciales.
  mock.module('../src/config/env.js', {
    exports: { env: {} },
  });
}

let linkNextGrowattPlantDevices = null;
let syncGrowattLatest = null;
if (supportsModuleMocks) {
  installMocks();
  ({ linkNextGrowattPlantDevices } = await import('../src/services/growattDevices.service.js'));
  ({ syncGrowattLatest } = await import('../src/services/growattLatest.service.js'));
}

const MIN_ENTRY = { device_sn: 'ZJP2E7P041', deviceType: 'min', datalogger_sn: 'ZOD5E6L3HT' };

function resetLink(deviceList, metersByLogger, meterError = null) {
  linkCalls.upserts.length = 0;
  linkCalls.links.length = 0;
  linkState.plantDevices = deviceList;
  linkState.metersByLogger = metersByLogger;
  linkState.meterError = meterError;
}

test('A: MIN + meter coexisten; identidades correctas', { skip: !supportsModuleMocks }, async () => {
  resetLink([MIN_ENTRY], { ZOD5E6L3HT: [SDM, CHNT] });
  const result = await linkNextGrowattPlantDevices();
  assert.deepEqual(linkCalls.links, ['ZJP2E7P041', 'growatt-meter:ZOD5E6L3HT:1']);
  const meterUpsert = linkCalls.upserts.find(u => u.device_type === 'meter');
  assert.equal(meterUpsert.external_device_id, 'growatt-meter:ZOD5E6L3HT:1');
  assert.equal(meterUpsert.model, 'CHNT_ONE');
  assert.equal(result.meters_linked, 1);
  assert.equal(result.meter_failed, 0);
});

test('G: planta sin meter conserva comportamiento MIN', { skip: !supportsModuleMocks }, async () => {
  resetLink([MIN_ENTRY], {});
  const result = await linkNextGrowattPlantDevices();
  assert.deepEqual(linkCalls.links, ['ZJP2E7P041']);
  assert.equal(result.meters_linked, 0);
  assert.equal(result.meters_fetched, 0);
});

test('H: error/rate-limit de meter_list no rompe el MIN', { skip: !supportsModuleMocks }, async () => {
  const rateError = new Error('Growatt rate limit');
  rateError.rateLimited = true;
  resetLink([MIN_ENTRY], {}, rateError);
  const result = await linkNextGrowattPlantDevices();
  assert.deepEqual(linkCalls.links, ['ZJP2E7P041']);
  assert.equal(result.meter_failed, 1);
  assert.equal(result.rate_limited, true);
  assert.equal(result.failed, 0);
});

test('F: meter no entra al flujo queryLastData de MIN', { skip: !supportsModuleMocks }, async () => {
  latestCalls.deviceTypes.length = 0;
  await syncGrowattLatest();
  assert.deepEqual(latestCalls.deviceTypes, ['min']);
});
