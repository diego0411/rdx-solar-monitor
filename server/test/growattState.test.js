import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { normalizeGrowattPlant } from '../src/providers/growatt/normalizeGrowattPlant.js';
import { normalizeGrowattLatestData } from '../src/providers/growatt/normalizeGrowattLatestData.js';

const supportsModuleMocks = typeof mock.module === 'function';

const userPlantSheetData = { plant_id: '1001', name: 'Planta Granja', status: '1', peak_power: 5.5 };
const lastDataSheet = { lost: true, status: 1, statusText: 'Normal' };
const SPANISH_MORNING = '2026-09-15 10:00:00';

test('user_plant_list status=1 mapea la planta a online', () => {
  const plant = normalizeGrowattPlant(userPlantSheetData, { user_id: 'u1' });
  assert.equal(plant.status, 'online');
  assert.equal(plant.external_plant_id, '1001');
  assert.equal(plant.capacity_kwp, 5.5);
});

test('user_plant_list status=4 mapea la planta a offline', () => {
  const plant = normalizeGrowattPlant({ ...userPlantSheetData, status: '4' }, { user_id: 'u1' });
  assert.equal(plant.status, 'offline');
  assert.equal(plant.external_plant_id, '1001');
});

test('status de planta desconocido queda unknown', () => {
  const plant = normalizeGrowattPlant({ ...userPlantSheetData, status: 9 }, { user_id: 'u1' });
  assert.equal(plant.status, 'unknown');
});

test('queryLastData lost=true con status=1 queda unknown (señal contradictoria)', () => {
  const device = normalizeGrowattLatestData({ ...lastDataSheet, time: SPANISH_MORNING }, 'd1');
  assert.equal(device.device_status, 'unknown');
  assert.equal(device.device_id, 'd1');
});

test('lost ya no decide el estado: status=1 sin pérdida queda online', () => {
  assert.equal(normalizeGrowattLatestData({ ...lastDataSheet, lost: 'true' }, 'd1').device_status, 'unknown');
  assert.equal(normalizeGrowattLatestData({ ...lastDataSheet, lost: false }, 'd1').device_status, 'online');
  assert.equal(normalizeGrowattLatestData({ ...lastDataSheet, lost: null }, 'd1').device_status, 'online');
});

test('incidencia confirmada tiene prioridad; status=2 ya no se asume como alarma', () => {
  assert.equal(
    normalizeGrowattLatestData({ status: 1, lost: false, faultType: 12, time: SPANISH_MORNING }, 'd1').device_status,
    'alarm',
  );
  assert.equal(
    normalizeGrowattLatestData({ status: 3, lost: false, time: SPANISH_MORNING }, 'd1').device_status,
    'alarm',
  );
  assert.equal(
    normalizeGrowattLatestData({ status: 2, lost: false, time: SPANISH_MORNING }, 'd1').device_status,
    'unknown',
  );
});

test('el campo time se interpreta con la timezone de la planta (GMT+4)', () => {
  const device = normalizeGrowattLatestData(
    { ...lastDataSheet, lost: false, time: '2026-09-21 00:57:30' },
    'd1',
    'GMT+4',
  );
  assert.equal(device.device_status, 'online');
  assert.equal(device.collected_at, '2026-09-20T20:57:30.000Z');
});

test('flujo simultáneo: plant sigue online mientras el device queda unknown', () => {
  const plant = normalizeGrowattPlant(userPlantSheetData);
  const device = normalizeGrowattLatestData({ ...lastDataSheet, time: SPANISH_MORNING }, 'd1');
  assert.equal(plant.status, 'online');
  assert.equal(device.device_status, 'unknown');
});

let syncGrowattLatest = null;
const deviceStateUpdates = [];
const deviceLatestRows = [];
const plantWrites = [];

if (supportsModuleMocks) {
  mock.module('../src/repositories/devices.repository.js', {
    exports: {
      async listActiveGrowattDevices() {
        return [{ id: 'd1', serial_number: 'MIN123', device_type: 'MIN', name: null, active: true, plant: { timezone: 'GMT-4' } }];
      },
      async updateGrowattDeviceName() {},
      async updateGrowattDeviceTelemetryState(id, deviceStatus, collectedAt) {
        deviceStateUpdates.push({ id, deviceStatus, collectedAt });
      },
    },
  });
  mock.module('../src/repositories/deviceLatestData.repository.js', {
    exports: {
      async upsertGrowattLatestData(normalized) {
        deviceLatestRows.push(normalized);
      },
    },
  });
  mock.module('../src/repositories/plants.repository.js', {
    exports: {
      async upsertGrowattPlant() { plantWrites.push('upsertGrowattPlant'); },
      async upsertPlant() { plantWrites.push('upsertPlant'); },
    },
  });
  mock.module('../src/providers/growatt/GrowattProvider.js', {
    exports: {
      GrowattProvider: class {
        async queryLastData() {
          return {
            payload: { data: { MIN: [
              { serialNum: 'MIN123', ...lastDataSheet, time: SPANISH_MORNING, alias: 'Inversor Granja' },
            ] } },
            rateLimited: false,
          };
        }
      },
    },
  });
  ({ syncGrowattLatest } = await import('../src/services/growattLatest.service.js'));
}

test('syncGrowattLatest marca el device unknown y nunca toca plant.status', { skip: !supportsModuleMocks }, async () => {
  const result = await syncGrowattLatest();

  assert.equal(result.processed, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.no_data, 0);
  assert.equal(result.rate_limited, false);

  assert.equal(deviceLatestRows.length, 1);
  assert.equal(deviceLatestRows[0].device_status, 'unknown');

  assert.deepEqual(deviceStateUpdates, [{
    id: 'd1', deviceStatus: 'unknown', collectedAt: '2026-09-15T14:00:00.000Z',
  }]);

  assert.deepEqual(plantWrites, []);
});