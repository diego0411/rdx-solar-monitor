import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

const syncState = { powerRows: [], existingRows: [], upserts: [], meter: null, meterError: null };

const wallOf = utc => new Date(Date.parse(utc) - 4 * 3600 * 1000)
  .toISOString().slice(0, 19).replace('T', ' ');
const minRow = (utc, eac) => ({
  interval_start: utc,
  timezone: 'America/La_Paz',
  raw_data: {
    devices: [{
      device_id: 'device-1',
      serial_number: 'MIN-1',
      data: { time: wallOf(utc), eacToday: eac, elocalLoadToday: 0, etoUserToday: 0, etoGridToday: 0 },
    }],
  },
});
const meter = {
  id: 'meter-1',
  serial_number: 'growatt-meter:DL:1',
  metadata: { datalogger_sn: 'DL', address: '1' },
};

function installSyncMocks() {
  mock.module('../src/repositories/plantPowerIntervals.repository.js', {
    exports: { listPlantPowerIntervals: async () => syncState.powerRows },
  });
  mock.module('../src/repositories/devices.repository.js', {
    exports: {
      listActiveGrowattMinDevicesByPlant: async () => [{ id: 'device-1', serial_number: 'MIN-1' }],
      listActiveGrowattMeterByPlant: async () => syncState.meter,
    },
  });
  mock.module('../src/repositories/energyIntervals.repository.js', {
    exports: {
      listEnergyIntervalsRange: async () => syncState.existingRows,
      upsertEnergyIntervals: async rows => { syncState.upserts.push(rows); },
    },
  });
  mock.module('../src/services/growattPowerHistory.service.js', {
    exports: { syncGrowattPowerHistory: async () => ({}) },
  });
  mock.module('../src/providers/growatt/GrowattProvider.js', {
    exports: {
      GrowattProvider: class {
        async getMeterHistory() {
          if (syncState.meterError) throw syncState.meterError;
          return syncState.meterSamples ?? [];
        }
      },
    },
  });
}

let syncGrowattEnergyHistory = null;
if (supportsModuleMocks) {
  installSyncMocks();
  ({ syncGrowattEnergyHistory } = await import('../src/services/growattEnergyHistory.service.js'));
}

const syncPlant = { id: 'plant-1', timezone: 'America/La_Paz' };

test('K: sin meter usa fallback MIN intacto', { skip: !supportsModuleMocks }, async () => {
  syncState.powerRows = [minRow('2026-09-27T10:00:00.000Z', 5)];
  syncState.powerRows[0].raw_data.devices[0].data.elocalLoadToday = 7;
  syncState.existingRows = [];
  syncState.upserts = [];
  syncState.meter = null;
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, false);
  assert.equal(result.skipped_degraded, false);
  assert.equal(syncState.upserts[0][0].consumption_kwh, 7);
});

test('L: fallo de meter_data usa fallback sin degradar', { skip: !supportsModuleMocks }, async () => {
  syncState.powerRows = [minRow('2026-09-27T10:00:00.000Z', 5)];
  syncState.powerRows[0].raw_data.devices[0].data.elocalLoadToday = 7;
  syncState.existingRows = [];
  syncState.upserts = [];
  syncState.meter = meter;
  syncState.meterError = new Error('Growatt rate limit');
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, false);
  assert.equal(result.skipped_degraded, false);
  assert.equal(syncState.upserts[0][0].consumption_kwh, 7);
  syncState.meterError = null;
});
