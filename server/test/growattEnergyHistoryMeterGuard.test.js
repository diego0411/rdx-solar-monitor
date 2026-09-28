import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

// Guard anti-degradación con dataset meter válido: los consumption=null
// honestos del desfase MIN/meter no bloquean import/export medidos.
// Datalogger distinto por caso: el throttle de meter_data es por
// datalogger y el mapa vive a nivel de módulo.
const syncState = {
  powerRows: [],
  existingRows: [],
  upserts: [],
  meter: null,
  meterSamples: [],
  meterError: null,
};

const wallOf = utc => new Date(Date.parse(utc) - 4 * 3600 * 1000)
  .toISOString().slice(0, 19).replace('T', ' ');
const minRow = (utc, wall, eac) => ({
  interval_start: utc,
  timezone: 'America/La_Paz',
  raw_data: {
    devices: [{
      device_id: 'device-1',
      serial_number: 'MIN-1',
      data: { time: wall, eacToday: eac, elocalLoadToday: 0, etoUserToday: 0, etoGridToday: 0 },
    }],
  },
});
const completeRow = (generation = 1) => ({
  interval_start: '2026-09-27T16:00:00.000Z',
  timezone: 'America/La_Paz',
  generation_kwh: generation, consumption_kwh: 1, grid_import_kwh: 1, grid_export_kwh: 1,
});
const meterSample = (wall, imp, exp) => ({
  timeText: wall,
  positiveActiveTodayEnergy: imp,
  reverseActiveTodayEnergy: exp,
});
const meterOf = sn => ({
  id: `meter-${sn}`,
  serial_number: `growatt-meter:${sn}:1`,
  metadata: { datalogger_sn: sn, address: '1' },
});

function installMocks() {
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
          return syncState.meterSamples;
        }
      },
    },
  });
}

let syncGrowattEnergyHistory = null;
if (supportsModuleMocks) {
  installMocks();
  ({ syncGrowattEnergyHistory } = await import('../src/services/growattEnergyHistory.service.js'));
}

const syncPlant = { id: 'plant-1', timezone: 'America/La_Paz' };

function reset({ power, existing, sn, samples }) {
  syncState.powerRows = power;
  syncState.existingRows = existing;
  syncState.upserts = [];
  syncState.meter = meterOf(sn);
  syncState.meterSamples = samples;
  syncState.meterError = null;
}

test('A: meter válido con cons PARTIAL persiste imp/exp (caso Arturo)', { skip: !supportsModuleMocks }, async () => {
  reset({
    power: [
      minRow('2026-09-27T10:00:00.000Z', '2026-09-27 06:00:00', 0),
      minRow('2026-09-27T14:00:00.000Z', '2026-09-27 10:00:00', 10),
      minRow('2026-09-27T18:00:00.000Z', '2026-09-27 14:00:00', 36.7),
    ],
    existing: [completeRow(), completeRow(), completeRow()],
    sn: 'DL-A',
    samples: [
      meterSample('2026-09-27 06:00:00', 4.5, 0),
      meterSample('2026-09-27 10:00:00', 4.6, 12),
      meterSample('2026-09-27 14:00:00', 4.8, 31.9),
    ],
  });
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, true);
  assert.equal(result.invariant_ok, true);
  assert.equal(result.skipped_degraded, false);
  assert.equal(result.upserted, 3);
  assert.equal(syncState.upserts.length, 1);
  assert.ok(Math.abs(result.meter_import_total - 4.8) < 1e-9);
  assert.ok(Math.abs(result.meter_export_total - 31.9) < 1e-9);
  assert.equal(result.null_consumption_intervals, 1);
  assert.equal(result.null_import_intervals, 0);
  assert.equal(result.null_export_intervals, 0);
});

test('B: mismo escenario con invariant_ok=false bloquea', { skip: !supportsModuleMocks }, async () => {
  // La 3ª fila MIN declara wall del 27 pero interval_start del 28:
  // Σgen(día 27) != último eacToday → invariante roto sin nulls.
  reset({
    power: [
      minRow('2026-09-27T10:00:00.000Z', '2026-09-27 06:00:00', 10),
      minRow('2026-09-27T14:00:00.000Z', '2026-09-27 10:00:00', 20),
      minRow('2026-09-28T05:00:00.000Z', '2026-09-27 20:55:00', 30),
    ],
    existing: [completeRow(), completeRow(), completeRow()],
    sn: 'DL-B',
    samples: [
      meterSample('2026-09-27 06:00:00', 4.5, 0),
      meterSample('2026-09-27 10:00:00', 4.6, 5),
      meterSample('2026-09-28 01:00:00', 5, 8),
    ],
  });
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, true);
  assert.equal(result.invariant_ok, false);
  assert.equal(result.derived_nulls, 0);
  assert.equal(result.skipped_degraded, true);
  assert.equal(syncState.upserts.length, 0);
});

test('C: meter_used=false con más nulls mantiene legacy y bloquea', { skip: !supportsModuleMocks }, async () => {
  syncState.powerRows = [
    minRow('2026-09-27T10:00:00.000Z', '2026-09-27 06:00:00', 5),
    {
      interval_start: '2026-09-27T14:00:00.000Z',
      timezone: 'America/La_Paz',
      raw_data: {
        devices: [{
          device_id: 'device-1',
          serial_number: 'MIN-1',
          data: {
            time: '2026-09-27 10:00:00',
            eacToday: null, elocalLoadToday: null, etoUserToday: null, etoGridToday: null,
          },
        }],
      },
    },
  ];
  syncState.existingRows = [completeRow(), completeRow()];
  syncState.upserts = [];
  syncState.meter = null;
  syncState.meterSamples = [];
  syncState.meterError = null;
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, false);
  assert.equal(result.skipped_degraded, true);
  assert.equal(syncState.upserts.length, 0);
});

test('D: meter válido pero generation degradada bloquea', { skip: !supportsModuleMocks }, async () => {
  reset({
    power: [
      minRow('2026-09-27T10:00:00.000Z', '2026-09-27 06:00:00', 0.5),
      minRow('2026-09-27T14:00:00.000Z', '2026-09-27 10:00:00', 0.5),
      minRow('2026-09-27T18:00:00.000Z', '2026-09-27 14:00:00', 0.5),
    ],
    existing: [completeRow(), completeRow(), completeRow()],
    sn: 'DL-D',
    samples: [
      meterSample('2026-09-27 06:00:00', 0.3, 0),
      meterSample('2026-09-27 10:00:00', 0.3, 5),
      meterSample('2026-09-27 14:00:00', 0.3, 8),
    ],
  });
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, true);
  assert.equal(result.skipped_degraded, true);
  assert.equal(syncState.upserts.length, 0);
});

test('E: meter válido pero import pierde cobertura bloquea', { skip: !supportsModuleMocks }, async () => {
  reset({
    power: [
      minRow('2026-09-27T10:00:00.000Z', '2026-09-27 06:00:00', 10),
      minRow('2026-09-27T14:00:00.000Z', '2026-09-27 10:00:00', 10),
      minRow('2026-09-27T18:00:00.000Z', '2026-09-27 14:00:00', 10),
    ],
    existing: [completeRow(), completeRow(), completeRow()],
    sn: 'DL-E',
    samples: [
      meterSample('2026-09-27 06:00:00', 1.5, 0),
      meterSample('2026-09-27 10:00:00', null, 5),
      meterSample('2026-09-27 14:00:00', 1.3, 8),
    ],
  });
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, true);
  assert.equal(result.null_import_intervals > 0, true);
  assert.equal(result.skipped_degraded, true);
  assert.equal(syncState.upserts.length, 0);
});
