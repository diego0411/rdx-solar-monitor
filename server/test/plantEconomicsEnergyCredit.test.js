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
  grid_export_kwh: 2,
  raw_data: {},
  ...overrides,
});
const tariff = (overrides = {}) => ({
  effective_from: '2026-01-01',
  effective_to: null,
  purchase_energy_rate: 1.068,
  export_energy_rate: null,
  currency: 'BOB',
  export_compensation_type: 'energy_credit',
  ...overrides,
});

test('energy_credit + export EXACT refleja el crédito en kWh', () => {
  const rows = [row('10:00:00.000'), row('10:15:00.000'), row('10:30:00.000')];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.metrics.energy_credit_generated_kwh, {
    value: 6, valid_intervals: 3, total_intervals: 3, complete: true, quality: 'EXACT',
  });
  assert.equal(result.export_credit_estimated_value, null);
  assert.equal(result.estimated_economic_benefit, null);
});

test('energy_credit + export PARTIAL conserva valor y conteos sin estimar', () => {
  const rows = [
    row('10:00:00.000'), row('10:15:00.000'), row('10:30:00.000'),
    row('10:45:00.000', { grid_export_kwh: null }),
    row('11:00:00.000', { grid_export_kwh: null }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.metrics.energy_credit_generated_kwh, {
    value: 6, valid_intervals: 3, total_intervals: 5, complete: false, quality: 'PARTIAL',
  });
  assert.equal(result.export_credit_estimated_value, null);
});

test('export no disponible deja el crédito no disponible', () => {
  const rows = [
    row('10:00:00.000', { grid_export_kwh: null }),
    row('10:15:00.000', { grid_export_kwh: null }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.metrics.energy_credit_generated_kwh, {
    value: null, valid_intervals: 0, total_intervals: 2, complete: false, quality: 'UNAVAILABLE',
  });
});

test('modalidad monetary conserva el comportamiento existente', () => {
  const rows = [row('10:00:00.000'), row('10:15:00.000')];
  const result = calculatePlantEconomics(rows, [tariff({
    export_compensation_type: 'monetary', export_energy_rate: 0.5,
  })], context);
  assert.equal(result.export_value, 2);
  assert.equal(result.metrics.energy_credit_generated_kwh.quality, 'UNAVAILABLE');
  assert.equal(result.metrics.energy_credit_generated_kwh.value, null);
});

test('meter_suspect no genera un crédito válido', () => {
  const rows = [
    row('10:00:00.000', { consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
    row('10:15:00.000', { consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.equal(result.coverage.meter_suspect, true);
  assert.equal(result.metrics.energy_credit_generated_kwh.quality, 'SUSPECT');
});
