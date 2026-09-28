import test from 'node:test';
import assert from 'node:assert/strict';

import {
  alignMeterDeltas,
  deriveGrowattEnergyHistory,
  deriveMeterDeltas,
  mergeMeterEnergy,
} from '../src/services/growattEnergyHistory.service.js';
import { calculatePlantEconomics } from '../src/services/plantEconomics.service.js';

const plant = { id: 'plant-1', timezone: 'America/La_Paz' };
const minDevice = { id: 'device-1', serial_number: 'MIN-1' };
const meter = {
  id: 'meter-1',
  serial_number: 'growatt-meter:DL:1',
  metadata: { datalogger_sn: 'DL', address: '1' },
};

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
const meterSample = (wall, imp, exp) => ({
  timeText: wall,
  positiveActiveTodayEnergy: imp,
  reverseActiveTodayEnergy: exp,
});
const sum = (rows, field) => rows
  .filter(row => row[field] !== null && row[field] !== undefined)
  .reduce((total, row) => total + row[field], 0);

function arturoLike() {
  const powerRows = [
    minRow('2026-09-27T10:00:00.000Z', 0),
    minRow('2026-09-27T14:00:00.000Z', 10),
    minRow('2026-09-27T18:00:00.000Z', 36.7),
  ];
  const meterSamples = [
    meterSample('2026-09-27 06:00:00', 4.5, 0),
    meterSample('2026-09-27 10:00:00', 4.6, 10),
    meterSample('2026-09-27 14:00:00', 4.8, 31.9),
  ];
  const baseRows = deriveGrowattEnergyHistory(plant, [minDevice], powerRows);
  return mergeMeterEnergy({ plant, minDevices: [minDevice], baseRows, powerRows, meterSamples, meter });
}

test('A: Arturo gen 36.7 + meter imp 4.8/exp 31.9 → cons agregado 9.6', () => {
  const { rows, meta } = arturoLike();
  assert.equal(meta.meter_used, true);
  assert.equal(meta.invariant_ok, true);
  assert.ok(Math.abs(sum(rows, 'generation_kwh') - 36.7) < 1e-9);
  assert.ok(Math.abs(sum(rows, 'grid_import_kwh') - 4.8) < 1e-9);
  assert.ok(Math.abs(sum(rows, 'grid_export_kwh') - 31.9) < 1e-9);
  assert.ok(Math.abs(sum(rows, 'consumption_kwh') - 9.6) < 1e-9);
});

test('B/C/D: primer delta completo y Σ == último contador', () => {
  const deltas = deriveMeterDeltas([
    meterSample('2026-09-27 06:00:00', 4.5, 0),
    meterSample('2026-09-27 10:00:00', 4.6, 10),
    meterSample('2026-09-27 14:00:00', 4.8, 31.9),
  ], 'meter-1', 'America/La_Paz');
  assert.equal(deltas[0].grid_import_kwh, 4.5);
  assert.equal(deltas[0].grid_export_kwh, 0);
  assert.ok(Math.abs(deltas.reduce((s, d) => s + d.grid_import_kwh, 0) - 4.8) < 1e-9);
  assert.ok(Math.abs(deltas.reduce((s, d) => s + d.grid_export_kwh, 0) - 31.9) < 1e-9);
});

test('E: offset <150s alinea correctamente', () => {
  const { rows } = mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], [minRow('2026-09-27T10:00:00.000Z', 5)]),
    powerRows: [minRow('2026-09-27T10:00:00.000Z', 5)],
    meterSamples: [meterSample('2026-09-27 06:02:00', 1, 2)],
    meter,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].grid_import_kwh, 1);
  assert.equal(rows[0].grid_export_kwh, 2);
});

test('F/N: >150s crea fila adicional sin perder el delta', () => {
  const { rows, meta } = mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], [minRow('2026-09-27T10:00:00.000Z', 5)]),
    powerRows: [minRow('2026-09-27T10:00:00.000Z', 5)],
    meterSamples: [meterSample('2026-09-27 06:10:00', 1, 2)],
    meter,
  });
  assert.equal(rows.length, 2);
  const extra = rows.find(row => row.generation_kwh === null);
  assert.equal(extra.grid_import_kwh, 1);
  assert.equal(extra.grid_export_kwh, 2);
  assert.equal(extra.consumption_kwh, null);
  assert.equal(meta.unmatched_meter_samples, 1);
});

test('G: un delta meter nunca se duplica en dos MIN', () => {
  const powerRows = [
    minRow('2026-09-27T10:00:00.000Z', 0),
    minRow('2026-09-27T10:01:00.000Z', 1),
    minRow('2026-09-27T10:05:00.000Z', 2),
  ];
  const { rows } = mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], powerRows),
    powerRows,
    meterSamples: [meterSample('2026-09-27 06:02:30', 3, 0)],
    meter,
  });
  const nonNull = rows.filter(row => row.grid_import_kwh !== null);
  assert.equal(nonNull.length, 1);
  assert.ok(Math.abs(sum(rows, 'grid_import_kwh') - 3) < 1e-9);
});

test('H: gen<export en un intervalo → cons null, resto intacto', () => {
  const powerRows = [minRow('2026-09-27T10:00:00.000Z', 5), minRow('2026-09-27T14:00:00.000Z', 7)];
  const { rows } = mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], powerRows),
    powerRows,
    meterSamples: [
      meterSample('2026-09-27 06:00:00', 1, 0),
      meterSample('2026-09-27 10:00:00', 1, 10),
    ],
    meter,
  });
  const bad = rows.find(row => row.interval_start === '2026-09-27T14:00:00.000Z');
  assert.equal(bad.generation_kwh, 2);
  assert.equal(bad.grid_export_kwh, 10);
  assert.equal(bad.grid_import_kwh, 0);
  assert.equal(bad.consumption_kwh, null);
});

test('I: importación sana con export 0 da consumption correcto', () => {
  const powerRows = [minRow('2026-09-27T10:00:00.000Z', 0), minRow('2026-09-27T14:00:00.000Z', 10)];
  const { rows } = mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], powerRows),
    powerRows,
    meterSamples: [
      meterSample('2026-09-27 06:00:00', 0, 0),
      meterSample('2026-09-27 10:00:00', 3, 0),
    ],
    meter,
  });
  const row = rows.find(r => r.interval_start === '2026-09-27T14:00:00.000Z');
  assert.equal(row.consumption_kwh, 13);
});

test('J: reset/drop del meter da null sin negativos (recupera como MIN)', () => {
  const deltas = deriveMeterDeltas([
    meterSample('2026-09-27 06:00:00', 4.5, 0),
    meterSample('2026-09-27 10:00:00', 4.0, 0),
    meterSample('2026-09-27 14:00:00', 4.2, 0),
  ], 'meter-1', 'America/La_Paz');
  assert.equal(deltas[0].grid_import_kwh, 4.5);
  assert.equal(deltas[1].grid_import_kwh, null);
  assert.ok(deltas[2].grid_import_kwh !== null && deltas[2].grid_import_kwh >= 0);
});

test('M: MIN parcial conserva imp/exp del meter', () => {
  const powerRows = [
    minRow('2026-09-27T10:00:00.000Z', 5),
    { ...minRow('2026-09-27T14:00:00.000Z', 9), raw_data: { devices: [{ device_id: 'device-1', serial_number: 'MIN-1', data: { time: wallOf('2026-09-27T14:00:00.000Z'), eacToday: null } }] } },
  ];
  const { rows } = mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], powerRows),
    powerRows,
    meterSamples: [
      meterSample('2026-09-27 06:00:00', 1, 2),
      meterSample('2026-09-27 10:00:00', 2, 3),
    ],
    meter,
  });
  const partial = rows.find(r => r.interval_start === '2026-09-27T14:00:00.000Z');
  assert.equal(partial.generation_kwh, null);
  assert.equal(partial.grid_import_kwh, 1);
  assert.equal(partial.grid_export_kwh, 1);
  assert.equal(partial.consumption_kwh, null);
});

test('O: invariante Σ deltas == últimos contadores', () => {
  const { meta } = arturoLike();
  assert.equal(meta.invariant_ok, true);
  assert.ok(Math.abs(meta.generation_total - 36.7) < 1e-9);
  assert.ok(Math.abs(meta.meter_import_total - 4.8) < 1e-9);
  assert.ok(Math.abs(meta.meter_export_total - 31.9) < 1e-9);
});

test('alineación: empate de distancia elige la muestra anterior', () => {
  const { byMinRow } = alignMeterDeltas(
    [{ instant: 1000, rowIndex: 0 }, { instant: 3000, rowIndex: 1 }],
    [{ instant: 2000, grid_import_kwh: 1, grid_export_kwh: 1 }],
  );
  assert.equal(byMinRow.get(0), 0);
  assert.equal(byMinRow.has(1), false);
});

const tariff = {
  effective_from: '2026-01-01',
  effective_to: null,
  purchase_energy_rate: 1,
  export_energy_rate: 0.5,
  currency: 'BOB',
  export_compensation_type: 'monetary',
};

test('P: Economics con datos Arturo → 36.7/31.9/4.8/9.6 sin suspect', () => {
  const { rows } = arturoLike();
  const result = calculatePlantEconomics(rows, [tariff], {
    period: 'day', start: '2026-09-27', end: '2026-09-28',
  });
  assert.ok(Math.abs(result.generation_kwh - 36.7) < 1e-9);
  assert.ok(Math.abs(result.grid_export_kwh - 31.9) < 1e-9);
  assert.ok(Math.abs(result.grid_import_kwh - 4.8) < 1e-9);
  assert.ok(Math.abs(result.self_consumption_kwh - 4.8) < 1e-9);
  assert.ok(Math.abs(result.consumption_kwh - 9.6) < 1e-9);
  assert.equal(result.coverage.meter_suspect, false);
  assert.deepEqual(result.coverage.suspect_days, []);
});

test('Q: Otto-like sin meter usa fallback MIN sin regresión', () => {
  const powerRows = [
    minRow('2026-09-27T10:00:00.000Z', 0),
    minRow('2026-09-27T14:00:00.000Z', 10),
  ];
  powerRows[0].raw_data.devices[0].data.elocalLoadToday = 0;
  powerRows[1].raw_data.devices[0].data.elocalLoadToday = 12;
  powerRows[0].raw_data.devices[0].data.etoUserToday = 0;
  powerRows[1].raw_data.devices[0].data.etoUserToday = 5;
  const rows = deriveGrowattEnergyHistory(plant, [minDevice], powerRows);
  assert.equal(sum(rows, 'consumption_kwh'), 12);
  assert.equal(sum(rows, 'grid_import_kwh'), 5);
  assert.equal(sum(rows, 'grid_export_kwh'), 0);
});

test('R: Huang-like parcial sin meter conserva detección de inconsistencia', () => {  const powerRows = [
    minRow('2026-09-27T10:00:00.000Z', 10),
    minRow('2026-09-27T14:00:00.000Z', 20),
    { ...minRow('2026-09-27T18:00:00.000Z', 30), raw_data: { devices: [{ device_id: 'device-1', serial_number: 'MIN-1', data: { time: wallOf('2026-09-27T18:00:00.000Z'), eacToday: null, etoGridToday: 0 } }] } },
  ];
  powerRows[0].raw_data.devices[0].data.etoGridToday = 3;
  powerRows[1].raw_data.devices[0].data.etoGridToday = 15;
  const rows = deriveGrowattEnergyHistory(plant, [minDevice], powerRows);
  const result = calculatePlantEconomics(rows, [tariff], {
    period: 'day', start: '2026-09-27', end: '2026-09-28',
  });
  assert.equal(result.coverage.inconsistent_intervals, 1);
  assert.equal(result.coverage.status, 'partial');
});

test('S: delta cero no asociado no crea fila (se cuenta, no daña cobertura)', () => {
  const powerRows = [minRow('2026-09-27T10:00:00.000Z', 5)];
  const { rows, meta } = mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], powerRows),
    powerRows,
    meterSamples: [meterSample('2026-09-27 08:00:00', 0, 0)],
    meter,
  });
  assert.equal(rows.length, 1);
  assert.equal(meta.unmatched_meter_samples, 1);
  assert.equal(rows[0].generation_kwh, 5);
});

test('T: muestras DESC del provider igual verifican invariante', () => {
  const asc = [
    meterSample('2026-09-27 06:00:00', 4.5, 0),
    meterSample('2026-09-27 10:00:00', 4.6, 10),
  ];
  const powerRows = [minRow('2026-09-27T10:00:00.000Z', 0), minRow('2026-09-27T14:00:00.000Z', 5)];
  const run = samples => mergeMeterEnergy({
    plant,
    minDevices: [minDevice],
    baseRows: deriveGrowattEnergyHistory(plant, [minDevice], powerRows),
    powerRows,
    meterSamples: samples,
    meter,
  });
  assert.equal(run(asc).meta.invariant_ok, true);
  assert.equal(run([...asc].reverse()).meta.invariant_ok, true);
});

