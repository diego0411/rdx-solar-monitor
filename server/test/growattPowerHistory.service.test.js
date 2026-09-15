import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateGrowattPowerHistory } from '../src/services/growattPowerHistory.service.js';

const plant = { id: 'plant-1', timezone: 'America/La_Paz' };
const devices = [
  { id: 'device-1', serial_number: 'MIN-1' },
  { id: 'device-2', serial_number: 'MIN-2' },
];

test('suma ceros y métricas numéricas cuando todos los MIN están alineados', () => {
  const timestamp = '2026-09-15T14:00:00.000Z';
  const points = new Map([
    ['device-1', [{ interval_start: timestamp, generation_power_w: 0, consumption_power_w: 10, raw_data: { lost: true } }]],
    ['device-2', [{ interval_start: timestamp, generation_power_w: 20, consumption_power_w: 5, raw_data: { lost: false } }]],
  ]);
  const [row] = aggregateGrowattPowerHistory(plant, devices, points);

  assert.equal(row.generation_power_w, 20);
  assert.equal(row.consumption_power_w, 15);
  assert.equal(row.grid_import_power_w, null);
  assert.equal(row.raw_data.devices.length, 2);
});

test('devuelve null para una métrica si falta la contribución de un MIN', () => {
  const timestamp = '2026-09-15T14:05:00.000Z';
  const points = new Map([
    ['device-1', [{ interval_start: timestamp, generation_power_w: 10, grid_export_power_w: 2, raw_data: {} }]],
    ['device-2', [{ interval_start: timestamp, generation_power_w: null, grid_export_power_w: 3, raw_data: {} }]],
  ]);
  const [row] = aggregateGrowattPowerHistory(plant, devices, points);

  assert.equal(row.generation_power_w, null);
  assert.equal(row.grid_export_power_w, 5);
});
