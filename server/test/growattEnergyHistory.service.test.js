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
  assert.equal(rows[0].generation_kwh, null);
  assert.equal(rows[1].generation_kwh, 2);
  assert.equal(rows[1].consumption_kwh, null);
  assert.equal(rows[1].raw_data.derived_from, 'plant_power_intervals.raw_data');
});

test('una lectura invalida rompe la referencia y el dia nuevo comienza con null', () => {
  const rows = deriveGrowattEnergyHistory(plant, [devices[0]], [
    powerRow('2026-09-15 10:00:00', { eacToday: 5 }, {}),
    powerRow('2026-09-15 10:05:00', { eacToday: null }, {}),
    powerRow('2026-09-15 10:10:00', { eacToday: 7 }, {}),
    powerRow('2026-09-15 10:15:00', { eacToday: 2 }, {}),
    powerRow('2026-09-15 10:20:00', { eacToday: 3 }, {}),
    powerRow('2026-09-16 00:00:00', { eacToday: 0 }, {}),
  ]);
  assert.deepEqual(rows.map(row => row.generation_kwh), [null, null, null, null, 1, null]);
});
