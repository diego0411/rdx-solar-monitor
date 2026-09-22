import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { normalizeGrowattDeviceCheck } from '../src/providers/growatt/normalizeGrowattDeviceCheck.js';

test('mapea modelo y potencia nominal desde check/sn', () => {
  const check = normalizeGrowattDeviceCheck({
    result: 1, model: 'MIN 6000TL-X2', normalPower: '6000', deviceType: 22, dtc: 5200, haveMeter: 1,
  });
  assert.equal(check.valid, true);
  assert.equal(check.model, 'MIN 6000TL-X2');
  assert.equal(check.rated_power_w, 6000);
  assert.deepEqual(check.metadata, { deviceType: 22, dtc: 5200, haveMeter: 1 });
});

test('respuesta con result distinto de 1 se descarta', () => {
  assert.equal(normalizeGrowattDeviceCheck(null).valid, false);
  assert.equal(normalizeGrowattDeviceCheck({ result: 0 }).valid, false);
  assert.equal(normalizeGrowattDeviceCheck({ error_code: 10012 }).valid, false);
});

test('solo valores válidos se conservan', () => {
  const check = normalizeGrowattDeviceCheck({
    result: 1, model: '  MIN 5K-X2  ', normalPower: 'not-a-number',
    deviceType: null, dtc: '', haveMeter: 'null',
  });
  assert.equal(check.model, 'MIN 5K-X2');
  assert.equal(check.rated_power_w, null);
  assert.deepEqual(check.metadata, {});
});

const supportsModuleMocks = typeof mock.module === 'function';
const upserted = [];
const checkCalls = [];
const tlxCalls = [];
let syncGrowattDevices = null;

if (supportsModuleMocks) {
  mock.module('../src/repositories/devices.repository.js', {
    exports: {
      async upsertGrowattDevice(normalized) {
        upserted.push(normalized);
        return 'updated';
      },
      async linkGrowattDeviceToPlant() {
        return 0;
      },
    },
  });
  mock.module('../src/repositories/plants.repository.js', {
    exports: {
      async listActiveGrowattPlants() {
        return [];
      },
    },
  });
  mock.module('../src/providers/growatt/GrowattProvider.js', {
    exports: {
      GrowattProvider: class {
        async listDevices() {
          return [
            { deviceType: 'min', deviceSn: 'M1' },
            { deviceType: 'sph', deviceSn: 'S1' },
            { deviceType: 'MIN', deviceSn: 'M2' },
          ];
        }

        async checkDeviceBySn(deviceSn) {
          checkCalls.push(deviceSn);
          if (deviceSn === 'M2') throw new Error('check failed');
          return {
            result: 1, model: 'MIN 6000TL-X2', normalPower: 6000,
            deviceType: 22, dtc: 5200, haveMeter: 1,
          };
        }

        async deviceTlxDataInfo(deviceSn) {
          tlxCalls.push(deviceSn);
          if (deviceSn === 'M2') throw new Error('tlx failed');
          return {
            error_code: 0,
            data: {
              fwVersion: 'AK1.0', innerVersion: 'AKAA2350',
              communicationVersion: 'ZAAA-0026', hwVersion: '',
              modelText: 'S19B09D00T00P0FU01M003C',
            },
          };
        }
      },
    },
  });
  ({ syncGrowattDevices } = await import('../src/services/growattDevices.service.js'));
}

test('syncGrowattDevices enriquece solo MIN y continúa ante fallos', { skip: !supportsModuleMocks }, async () => {
  const result = await syncGrowattDevices();

  assert.equal(result.fetched, 3);
  assert.equal(result.enriched, 1);
  assert.equal(result.check_failed, 1);
  assert.equal(result.firmware_enriched, 1);
  assert.equal(result.firmware_failed, 1);
  assert.equal(result.updated, 3);
  assert.equal(result.failed, 0);
  assert.deepEqual(checkCalls, ['M1', 'M2']);
  assert.deepEqual(tlxCalls, ['M1', 'M2']);

  const m1 = upserted.find(row => row.serial_number === 'M1');
  assert.equal(m1.model, 'MIN 6000TL-X2');
  assert.equal(m1.rated_power_w, 6000);
  assert.equal(m1.software_version, 'AK1.0');
  assert.equal(m1.metadata.innerVersion, 'AKAA2350');
  assert.equal(m1.metadata.communicationVersion, 'ZAAA-0026');
  assert.equal(Object.hasOwn(m1, 'hardware_version'), false);
  assert.equal(m1.metadata.deviceType, 22);
  assert.equal(m1.metadata.dtc, 5200);
  assert.equal(m1.metadata.haveMeter, 1);

  const s1 = upserted.find(row => row.serial_number === 'S1');
  assert.equal(Object.hasOwn(s1, 'model'), false);
  assert.equal(Object.hasOwn(s1, 'rated_power_w'), false);
  assert.equal(Object.hasOwn(s1, 'software_version'), false);
  assert.equal(Object.hasOwn(s1, 'hardware_version'), false);

  const m2 = upserted.find(row => row.serial_number === 'M2');
  assert.equal(Object.hasOwn(m2, 'model'), false);
  assert.equal(Object.hasOwn(m2, 'rated_power_w'), false);
  assert.equal(Object.hasOwn(m2, 'software_version'), false);
  assert.equal(Object.hasOwn(m2, 'hardware_version'), false);
  assert.equal(Object.hasOwn(m2.metadata, 'innerVersion'), false);
  assert.equal(Object.hasOwn(m2.metadata, 'communicationVersion'), false);
});