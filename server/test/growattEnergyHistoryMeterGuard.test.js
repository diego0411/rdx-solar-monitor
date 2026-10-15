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

// H04-1/H04-2 (regresión): sin meter, la medición directa previa (4.8) y su
// procedencia por campo se conservan; el candidato MIN no la pisa ni la
// mal etiqueta.
test('H04-1: sync sin meter conserva medición directa 4.8 y su procedencia (regresión)', { skip: !supportsModuleMocks }, async () => {
  const meterStoredRow = (utc, imp) => ({
    interval_start: utc,
    timezone: 'America/La_Paz',
    generation_kwh: 10, consumption_kwh: 8, grid_import_kwh: imp, grid_export_kwh: 2,
    raw_data: { energy_provenance: { grid_import_kwh: { source: 'growatt_meter' } } },
  });
  syncState.powerRows = [
    minRow('2026-09-27T10:00:00.000Z', '2026-09-27 06:00:00', 5),
    minRow('2026-09-27T14:00:00.000Z', '2026-09-27 10:00:00', 10),
  ];
  // Existing directo del meter: import=4.8, cobertura completa, provenance meter.
  syncState.existingRows = [
    meterStoredRow('2026-09-27T10:00:00.000Z', 4.8),
    meterStoredRow('2026-09-27T14:00:00.000Z', 4.8),
  ];
  syncState.upserts = [];
  syncState.meter = null; // mismo mecanismo que C: sin meter → meter_used=false
  syncState.meterSamples = [];
  syncState.meterError = null;
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, false);
  assert.equal(result.existing_nulls, 0);
  assert.equal(result.derived_nulls, 0);
  // El guard no bloquea (nulls iguales 0==0): la no-destrucción es campo a campo.
  assert.equal(result.skipped_degraded, false);
  assert.equal(syncState.upserts.length, 1);
  const restored = syncState.upserts[0]
    .find(row => row.interval_start === '2026-09-27T10:00:00.000Z');
  // Regresión H04-1: el directo 4.8 se conserva; el delta 0 del MIN no lo pisa.
  assert.equal(restored.grid_import_kwh, 4.8);
  // Regresión H04-2: la procedencia meter se arrastra solo al campo restaurado.
  assert.equal(restored.raw_data.energy_provenance.grid_import_kwh.source, 'growatt_meter');
});

// H04: la derivación rellena el null de export (2.2) sin degradar el import
// directo (4.8); la procedencia meter queda solo en el campo con claim directo.
test('H04: derived rellena export null sin degradar import directo (provenance por campo)', { skip: !supportsModuleMocks }, async () => {
  syncState.powerRows = [{
    interval_start: '2026-09-27T10:00:00.000Z',
    timezone: 'America/La_Paz',
    raw_data: {
      devices: [{
        device_id: 'device-1',
        serial_number: 'MIN-1',
        data: {
          time: '2026-09-27 06:00:00',
          eacToday: 5, elocalLoadToday: 0, etoUserToday: 0, etoGridToday: 2.2,
        },
      }],
    },
  }];
  syncState.existingRows = [{
    interval_start: '2026-09-27T10:00:00.000Z',
    timezone: 'America/La_Paz',
    generation_kwh: 10, consumption_kwh: 8, grid_import_kwh: 4.8, grid_export_kwh: null,
    raw_data: { energy_provenance: { grid_import_kwh: { source: 'growatt_meter' } } },
  }];
  syncState.upserts = [];
  syncState.meter = null;
  syncState.meterSamples = [];
  syncState.meterError = null;
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, false);
  assert.equal(result.existing_nulls, 1);
  assert.equal(result.derived_nulls, 0);
  assert.equal(result.skipped_degraded, false);
  assert.equal(syncState.upserts.length, 1);
  const row = syncState.upserts[0][0];
  assert.equal(row.grid_import_kwh, 4.8);
  assert.equal(row.raw_data.energy_provenance.grid_import_kwh.source, 'growatt_meter');
  assert.equal(row.grid_export_kwh, 2.2);
  assert.equal(row.raw_data.energy_provenance.grid_export_kwh, undefined);
});

// H04: 0 es un valor directo válido; el derivado 3 del MIN no lo sobrescribe.
test('H04: import directo 0 se conserva frente a derivado 3 (cero es valor)', { skip: !supportsModuleMocks }, async () => {
  syncState.powerRows = [{
    interval_start: '2026-09-27T10:00:00.000Z',
    timezone: 'America/La_Paz',
    raw_data: {
      devices: [{
        device_id: 'device-1',
        serial_number: 'MIN-1',
        data: {
          time: '2026-09-27 06:00:00',
          eacToday: 5, elocalLoadToday: 0, etoUserToday: 3, etoGridToday: 0,
        },
      }],
    },
  }];
  syncState.existingRows = [{
    interval_start: '2026-09-27T10:00:00.000Z',
    timezone: 'America/La_Paz',
    generation_kwh: 10, consumption_kwh: 8, grid_import_kwh: 0, grid_export_kwh: 2,
    raw_data: { energy_provenance: { grid_import_kwh: { source: 'growatt_meter' } } },
  }];
  syncState.upserts = [];
  syncState.meter = null;
  syncState.meterSamples = [];
  syncState.meterError = null;
  const result = await syncGrowattEnergyHistory(syncPlant, '2026-09-27');
  assert.equal(result.meter_used, false);
  assert.equal(result.skipped_degraded, false);
  assert.equal(syncState.upserts.length, 1);
  const row = syncState.upserts[0][0];
  assert.equal(row.grid_import_kwh, 0);
  assert.equal(row.raw_data.energy_provenance.grid_import_kwh.source, 'growatt_meter');
});
