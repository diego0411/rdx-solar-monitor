import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveGrowattEnergyHistory } from '../src/services/growattEnergyHistory.service.js';

const plant = { id: 'plant-1', timezone: 'America/La_Paz' };
const devices = [
  { id: 'device-1', serial_number: 'MIN-1' },
  { id: 'device-2', serial_number: 'MIN-2' },
];

function powerRow(time, first, second) {
  return {
    interval_start: `${time.replace(' ', 'T')}.000Z`,
    raw_data: { devices: [
      { device_id: 'device-1', serial_number: 'MIN-1', data: { time, ...first } },
      { device_id: 'device-2', serial_number: 'MIN-2', data: { time, ...second } },
    ] },
  };
}

test('calcula deltas alineados, conserva cero y exige contribucion de todos los MIN', () => {
  const rows = deriveGrowattEnergyHistory(plant, devices, [
    powerRow('2026-09-15 10:00:00', { eacToday: 10, elocalLoadToday: 3, lost: true }, { eacToday: 20, elocalLoadToday: 4 }),
    powerRow('2026-09-15 10:05:00', { eacToday: 11, elocalLoadToday: 3 }, { eacToday: 21, elocalLoadToday: null }),
  ]);
  assert.equal(rows[0].generation_kwh, 30);
  assert.equal(rows[0].consumption_kwh, 7);
  assert.equal(rows[1].generation_kwh, 2);
  assert.equal(rows[1].consumption_kwh, null);
  assert.equal(rows[1].raw_data.derived_from, 'plant_power_intervals.raw_data');
});

test('primera muestra valida del dia usa el contador como acumulado desde medianoche', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-15 10:00:00', { eacToday: 5 }, {}),
    powerRow('2026-09-15 10:05:00', { eacToday: null }, {}),
    powerRow('2026-09-15 10:10:00', { eacToday: 7 }, {}),
    powerRow('2026-09-15 10:15:00', { eacToday: 2 }, {}),
    powerRow('2026-09-15 10:20:00', { eacToday: 3 }, {}),
    powerRow('2026-09-16 00:00:00', { eacToday: 0 }, {}),
  ]);
  assert.deepEqual(rows.map(row => row.generation_kwh), [5, null, null, null, 1, 0]);
});

test('dia comienza con eacToday=0.4: primer generation_kwh = 0.4', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 09:54:52', { eacToday: 0.4 }, {}),
    powerRow('2026-09-25 10:00:00', { eacToday: 0.9 }, {}),
  ]);
  assert.equal(rows[0].generation_kwh, 0.4);
  assert.equal(rows[1].generation_kwh, 0.5);
});

test('dia comienza con contador=0: delta=0, no null', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 00:00:00', { eacToday: 0 }, {}),
    powerRow('2026-09-25 00:05:00', { eacToday: 0.1 }, {}),
  ]);
  assert.equal(rows[0].generation_kwh, 0);
  assert.equal(rows[1].generation_kwh, 0.1);
});

test('0.4 -> 0.7 produce deltas 0.4 y 0.3', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 09:54:52', { eacToday: 0.4 }, {}),
    powerRow('2026-09-25 10:00:00', { eacToday: 0.7 }, {}),
  ]);
  assert.equal(rows[0].generation_kwh, 0.4);
  assert.ok(Math.abs(rows[1].generation_kwh - 0.3) < 1e-9);
});

test('suma de deltas del dia = ultimo contador diario', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 09:54:52', { eacToday: 0.4 }, {}),
    powerRow('2026-09-25 10:00:00', { eacToday: 0.7 }, {}),
    powerRow('2026-09-25 10:05:00', { eacToday: 1.2 }, {}),
  ]);
  const total = rows.reduce((sum, row) => sum + row.generation_kwh, 0);
  assert.ok(Math.abs(total - 1.2) < 1e-9);
});

test('nuevo dia interpreta su primer valor como acumulado del nuevo dia', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 23:55:00', { eacToday: 18.5 }, {}),
    powerRow('2026-09-26 09:54:35', { eacToday: 0.2 }, {}),
  ]);
  assert.equal(rows[0].generation_kwh, 18.5);
  assert.equal(rows[1].generation_kwh, 0.2);
});

test('caida del contador dentro del mismo dia sigue produciendo null', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 10:00:00', { eacToday: 5 }, {}),
    powerRow('2026-09-25 10:05:00', { eacToday: 2 }, {}),
  ]);
  assert.equal(rows[0].generation_kwh, 5);
  assert.equal(rows[1].generation_kwh, null);
});

test('muestra invalida intradia: la siguiente valida NO usa delta=current', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 10:00:00', { eacToday: 5 }, {}),
    powerRow('2026-09-25 10:05:00', { eacToday: null }, {}),
    powerRow('2026-09-25 10:10:00', { eacToday: 7 }, {}),
    powerRow('2026-09-25 10:15:00', { eacToday: 9 }, {}),
  ]);
  assert.deepEqual(rows.map(row => row.generation_kwh), [5, null, null, 2]);
});

test('referencia perdida sin dia conocido no se trata como inicio', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    {
      interval_start: '2026-09-25T10:00:00.000Z',
      raw_data: { devices: [{ device_id: 'device-1', serial_number: 'MIN-1', data: { eacToday: 6 } }] },
    },
    powerRow('2026-09-25 10:05:00', { eacToday: 7 }, {}),
    powerRow('2026-09-25 10:10:00', { eacToday: 8 }, {}),
  ]);
  assert.deepEqual(rows.map(row => row.generation_kwh), [null, null, 1]);
});

test('multi-dispositivo sin delta valido conserva null aunque el otro aporte', () => {
  const rows = deriveGrowattEnergyHistory(plant, devices, [
    powerRow('2026-09-25 10:00:00', { eacToday: 10 }, { eacToday: null }),
    powerRow('2026-09-25 10:05:00', { eacToday: 11 }, { eacToday: 21 }),
  ]);
  assert.equal(rows[0].generation_kwh, null);
  assert.equal(rows[1].generation_kwh, null);
});

test('integracion post-fix: filas completas dan totales y cobertura available', async () => {
  const { calculatePlantEconomics } = await import('../src/services/plantEconomics.service.js');
  const derived = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-25 09:54:52', { eacToday: 0.4, elocalLoadToday: 0.2, etoUserToday: 0.1, etoGridToday: 0.3 }, {}),
    powerRow('2026-09-25 10:00:00', { eacToday: 0.9, elocalLoadToday: 0.5, etoUserToday: 0.2, etoGridToday: 0.6 }, {}),
  ]).map(row => ({ ...row, interval_start: '2026-09-25T13:54:52.000Z', timezone: 'America/La_Paz' }));
  derived[1].interval_start = '2026-09-25T14:00:00.000Z';
  const tariffs = [{
    effective_from: '2026-01-01', effective_to: null, currency: 'BOB',
    purchase_energy_rate: 1.068, export_energy_rate: null, export_compensation_type: 'energy_credit',
  }];
  const result = calculatePlantEconomics(derived, tariffs, { period: 'day', start: '2026-09-25', end: '2026-09-26' });
  assert.ok(Math.abs(result.generation_kwh - 0.9) < 1e-9);
  assert.ok(Math.abs(result.self_consumption_kwh - 0.3) < 1e-9);
  assert.ok(Math.abs(result.grid_export_kwh - 0.6) < 1e-9);
  assert.equal(result.coverage.status, 'available');
  assert.equal(result.coverage.missing_energy_intervals, 0);
});

function legacyPowerRow(time, data, serial = 'MIN-1') {
  return {
    interval_start: `${time.replace(' ', 'T')}.000Z`,
    raw_data: { devices: { [serial]: { 0: { time, ...data } } } },
  };
}

const legacyCounters = {
  eacToday: 0.4, elocalLoadToday: 0.2, etoUserToday: 0.1, etoGridToday: 0.3,
};

test('legado: resuelve por serial y deriva los cuatro contadores', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    legacyPowerRow('2026-09-14 06:08:33', legacyCounters),
    legacyPowerRow('2026-09-14 06:13:33', { eacToday: 0.9, elocalLoadToday: 0.5, etoUserToday: 0.2, etoGridToday: 0.6 }),
  ]);
  assert.equal(rows[0].generation_kwh, 0.4);
  assert.equal(rows[0].consumption_kwh, 0.2);
  assert.equal(rows[0].grid_import_kwh, 0.1);
  assert.equal(rows[0].grid_export_kwh, 0.3);
  assert.ok(Math.abs(rows[1].generation_kwh - 0.5) < 1e-9);
  assert.ok(Math.abs(rows[1].grid_export_kwh - 0.3) < 1e-9);
});

test('legado: primer contador 0 da delta 0 y >0 da current', () => {
  const zero = deriveGrowattEnergyHistory(plant, [devices[0]], [
    legacyPowerRow('2026-09-14 00:00:00', { eacToday: 0 }),
  ]);
  assert.equal(zero[0].generation_kwh, 0);
  const positive = deriveGrowattEnergyHistory(plant, [devices[0]], [
    legacyPowerRow('2026-09-14 06:08:33', { eacToday: 2.5 }),
  ]);
  assert.equal(positive[0].generation_kwh, 2.5);
});

test('legado: serial desconocido no toma payload ajeno', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    legacyPowerRow('2026-09-14 06:08:33', { eacToday: 0.4 }, 'OTHER-SN'),
    legacyPowerRow('2026-09-14 06:13:33', { eacToday: 0.9 }, 'OTHER-SN'),
  ]);
  assert.deepEqual(rows.map(row => row.generation_kwh), [null, null]);
});

test('legado: estructura ambigua no selecciona arbitrariamente', () => {
  const twoSerials = deriveGrowattEnergyHistory(plant, [devices[0]], [
    { interval_start: '2026-09-14T06:08:33.000Z',
      raw_data: { devices: { 'MIN-1': { 0: { time: '2026-09-14 06:08:33', eacToday: 1 } },
        'min-1': { 0: { time: '2026-09-14 06:08:33', eacToday: 2 } } } } },
  ]);
  assert.equal(twoSerials[0].generation_kwh, null);
  const twoSlots = deriveGrowattEnergyHistory(plant, [devices[0]], [
    { interval_start: '2026-09-14T06:08:33.000Z',
      raw_data: { devices: { 'MIN-1': { 0: { time: '2026-09-14 06:08:33', eacToday: 1 },
        1: { time: '2026-09-14 06:08:33', eacToday: 2 } } } } },
  ]);
  assert.equal(twoSlots[0].generation_kwh, null);
});
