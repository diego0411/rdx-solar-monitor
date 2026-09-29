import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePlantEconomics } from '../src/services/plantEconomics.service.js';

const context = { period: 'day', start: '2026-09-29', end: '2026-09-30' };
const row = (time, overrides = {}) => ({
  interval_start: `2026-09-29T${time}Z`,
  timezone: 'America/La_Paz',
  generation_kwh: 3,
  consumption_kwh: 2,
  grid_import_kwh: 0,
  grid_export_kwh: 2.5,
  raw_data: {},
  ...overrides,
});
const tariff = () => ({
  effective_from: '2026-01-01',
  effective_to: null,
  purchase_energy_rate: 1.068,
  export_energy_rate: null,
  currency: 'BOB',
  export_compensation_type: 'energy_credit',
});

test('PARTIAL coherente: pares negativos aislados no marcan inconsistencia', () => {
  const rows = [
    row('10:00:00.000'), row('10:15:00.000'), row('10:30:00.000'),
    row('10:45:00.000'), row('11:00:00.000'),
    row('11:15:00.000', { grid_export_kwh: 3.2 }),
    row('11:30:00.000', { grid_export_kwh: 3.2 }),
    row('11:45:00.000', { grid_export_kwh: null }),
    row('12:00:00.000', { grid_export_kwh: null }),
    row('12:15:00.000', { grid_export_kwh: null }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.coverage.inconsistent_intervals, 0);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'PARTIAL');
  assert.equal(result.metrics.self_consumption_kwh.valid_intervals, 7);
  assert.equal(result.metrics.self_consumption_kwh.total_intervals, 10);
  assert.ok(Math.abs(result.metrics.self_consumption_kwh.value - 2.5) < 1e-9);
  assert.equal(result.metrics.self_consumption_savings.quality, 'PARTIAL');
  assert.ok(result.metrics.self_consumption_savings.value !== null);
  assert.ok(Math.abs(result.metrics.self_consumption_savings.value - 2.5 * 1.068) < 1e-9);
  assert.equal(result.coverage.meter_suspect, false);
});

test('PARTIAL materialmente negativo sigue inconsistente/no calculable', () => {
  const rows = [
    row('10:00:00.000', { generation_kwh: 1, grid_export_kwh: 3 }),
    row('10:15:00.000', { generation_kwh: 1, grid_export_kwh: 3 }),
    row('10:30:00.000', { generation_kwh: 1, grid_export_kwh: 3 }),
    row('10:45:00.000', { generation_kwh: 1, grid_export_kwh: 3 }),
    row('11:00:00.000', { generation_kwh: 1, grid_export_kwh: null }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.equal(result.coverage.status, 'partial');
  assert.ok(result.coverage.inconsistent_intervals > 0);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'PARTIAL');
});

test('SUSPECT conserva precedencia y no lo altera la coherencia parcial', () => {
  const rows = [
    row('10:00:00.000', { consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
    row('10:15:00.000', { consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
    row('10:30:00.000', { consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.equal(result.coverage.meter_suspect, true);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'SUSPECT');
  assert.equal(result.metrics.self_consumption_kwh.value, null);
  assert.equal(result.metrics.self_consumption_savings.quality, 'SUSPECT');
  assert.equal(result.metrics.self_consumption_savings.value, null);
});
